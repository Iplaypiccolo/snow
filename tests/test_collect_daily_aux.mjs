import assert from 'node:assert/strict';
import {handle,parseGrid}from '../supabase/functions/collect-daily-aux/core.mjs';
const tests=[];
async function test(name,fn){try{await fn();tests.push({name,ok:true});}catch(e){tests.push({name,ok:false,error:e.message});}}
const NOW=Date.parse('2026-11-06T22:00:00+09:00'),ISSUE='2026-11-06T11:00:00Z',MIN='2026-11-06T21:00:00Z',MAX='2026-11-07T06:00:00Z';
const cells=[[60,127],[89,130]],matrix=(n=3)=>Array(149*253).fill(String(n)),index=([x,y])=>(y-1)*149+x-1;
const grid=(a,b)=>{const v=matrix();v[index(cells[0])]=String(a);v[index(cells[1])]=String(b);return v.join(',');};
function world(extra={}){
 const w={clock:NOW,calls:[],puts:[],usages:[],plans:[],key:' example/key+value\r\n',queue:[{status:200,text:grid(0,-5)},{status:200,text:grid(9,5)}],
  jobs:[['TMN',MIN],['TMX',MAX]],...extra};
 w.deps={now:()=>w.clock,env:()=>w.key,sleep:async ms=>{w.clock+=ms;},tokenOk:async t=>t==='collector',
  plan:async sky=>{w.plans.push(sky);return w.plan??{tmfc:ISSUE,cells,missing:w.jobs,done:w.jobs.length===0,waiting:false};},
  fetchText:async url=>{w.calls.push(url);const r=w.queue.shift();if(r instanceof Error)throw r;return{...r,bytes:r?.text?.length??0};},
  put:async(...args)=>{w.puts.push(args);w.jobs=w.jobs.filter(j=>j[0]!==args[1]||j[1]!==args[2]);return true;},
  usage:async(...args)=>{w.usages.push(args);return true;}};return w;
}
const request=(body={},token='collector',method='POST')=>new Request('https://test.invalid',{method,headers:token?{'x-collector-token':token}:{},...(method==='POST'?{body:JSON.stringify(body)}:{})});
const run=async(w,body={})=>(await handle(request(body),w.deps)).json();
await test('공식0℃·음수·격자 위치 추출',()=>assert.deepEqual(parseGrid(grid(0,-5),'TMN',cells),{empty:false,values:[0,-5]}));
await test('기존격자형식의끝쉼표·줄바꿈도허용',()=>assert.deepEqual(parseGrid(' \r\n'+grid(0,-5)+',\r\n','TMN',cells).values,[0,-5]));
await test('결측을null로 보존',()=>assert.deepEqual(parseGrid(grid(-999,5),'TMX',cells).values,[null,5]));
await test('전국0·전국센티널은빈자료',()=>{for(const n of[0,-999])assert.deepEqual(parseGrid(matrix(n).join(','),'TMN',cells),{empty:true,values:null});});
await test('격자 밖에 있는 잘못된 값도 전체 응답 거부',()=>{const a=matrix();a[0]='html';assert.throws(()=>parseGrid(a.join(','),'TMX',cells),/bad_grid/);});
await test('절단·NaN·범위·SKY코드 검증',()=>{
 assert.throws(()=>parseGrid('1,2','TMN',cells),/bad_grid/);assert.throws(()=>parseGrid(grid('NaN',2),'TMN',cells),/bad_grid/);
 assert.throws(()=>parseGrid(grid(71,2),'TMX',cells),/bad_grid/);assert.throws(()=>parseGrid(grid(2,4),'SKY',cells),/bad_grid/);
 assert.deepEqual(parseGrid(grid(0,4),'SKY',cells).values,[null,4]);
});
await test('인증·메서드 검사 후에만DB/API접근',async()=>{
 const w=world();assert.equal((await handle(request({},'', 'POST'),w.deps)).status,401);assert.equal((await handle(request({},'bad'),w.deps)).status,401);
 assert.equal((await handle(request({},'collector','GET'),w.deps)).status,405);assert.equal(w.calls.length,0);assert.equal(w.plans.length,0);
});
await test('인증 장애의 비밀 오류는 노출 안 함',async()=>{const w=world();w.deps.tokenOk=async()=>{throw Error(w.key);};const r=await handle(request(),w.deps);assert.equal(r.status,503);assert(!(await r.text()).includes(w.key));});
await test('임의URL·기간·잘못된sky입력거부',async()=>{for(const body of[{url:'https://evil.invalid'},[],null,{sky:'true'},{tmfc:ISSUE}]){const w=world();assert.equal((await handle(request(body),w.deps)).status,400);assert.equal(w.plans.length,0);}});
await test('기본기온만 수집·정상값 저장·사용량계측',async()=>{
 const w=world(),r=await run(w);assert(r.ok&&r.done);assert.equal(r.saved,2);assert(w.plans.every(s=>s===false));
 assert.deepEqual(w.puts[0].slice(1),['TMN',MIN,[0,-5],false]);assert.equal(r.usage.calls,2);assert.equal(w.usages[0][1],2);
 assert.equal(new URL(w.calls[0]).searchParams.get('authKey'),w.key.trim());assert(!JSON.stringify(r).includes(w.key.trim()));
});
await test('완료/대기 때 API호출·키 조회없음',async()=>{
 for(const plan of[{done:true,missing:[]},{waiting:true,missing:[]}]){const w=world({plan});w.deps.env=()=>{throw Error('must not read key');};const r=await run(w);assert(r.ok);assert.equal(w.calls.length,0);}
});
await test('잘못된셀·중복·미래발표·시간/종류는API전거부',async()=>{
 const plans=[{cells:[[150,1]]},{cells:[cells[0],cells[0]]},{tmfc:'2026-11-08T11:00:00Z'},
  {missing:[['TMP',MIN]]},{missing:[['TMN',MAX]]},{missing:[['TMN',MIN],['TMN',MIN]]}];
 for(const p of plans){const w=world();w.plan={tmfc:ISSUE,cells,missing:w.jobs,...p};const r=await run(w);assert.equal(r.error,'bad_plan');assert.equal(w.calls.length,0);}
});
await test('키 없으면API호출없음',async()=>{const w=world({key:''});assert.equal((await run(w)).error,'missing_kma_key');assert.equal(w.calls.length,0);});
await test('5xx한번만재시도·실제요청계측',async()=>{const w=world();w.queue.unshift({status:503,text:'temporary'});const r=await run(w);assert(r.ok);assert.equal(w.calls.length,3);assert.equal(r.usage.retries,1);});
await test('403은재시도/저장없이키노출안함',async()=>{const w=world();w.queue=[{status:403,text:w.key}];const r=await run(w);assert.equal(r.error,'upstream_auth');assert.equal(w.calls.length,1);assert.equal(w.puts.length,0);assert(!JSON.stringify(r).includes(w.key));});
await test('파일미제공/형식오류를빈성공으로저장안함',async()=>{const w=world({queue:[{status:200,text:'# dfs_file_read error'}]});assert.equal((await run(w)).error,'bad_grid');assert.equal(w.puts.length,0);});
await test('국가전체0만empty로저장',async()=>{const w=world({queue:[{status:200,text:matrix(0).join(',')},{status:200,text:grid(9,5)}]});const r=await run(w);assert(r.ok);assert.equal(r.empty,1);assert.deepEqual(w.puts[0].slice(3),[null,true]);});
await test('DB저장실패후더받지않음',async()=>{const w=world();w.deps.put=async()=>false;assert.equal((await run(w)).error,'store_failed');assert.equal(w.calls.length,1);});
await test('사용량기록실패가저장성공을뒤집지않음',async()=>{const w=world();w.deps.usage=async()=>{throw Error(w.key);};const r=await run(w);assert(r.ok&&r.done);assert.equal(r.usage.saved,false);});
await test('85: 습도(REH) 0~100%만 허용, 결측 null',()=>{
 assert.deepEqual(parseGrid(grid(0,100),'REH',cells).values,[0,100]);assert.deepEqual(parseGrid(grid(-99,55),'REH',cells).values,[null,55]);
 assert.throws(()=>parseGrid(grid(101,5),'REH',cells),/bad_grid/);assert.throws(()=>parseGrid(grid(-5,5),'REH',cells),/bad_grid/);
});
await test('85: 습도도 sky:true 일 때만 수집',async()=>{
 const w=world({jobs:[['REH',MIN]],queue:[{status:200,text:grid(80,60)}]});assert.equal((await run(w)).error,'bad_plan');assert.equal(w.calls.length,0);
 const yes=world({jobs:[['SKY',MIN],['REH',MIN]],queue:[{status:200,text:grid(1,4)},{status:200,text:grid(80,60)}]});const r=await run(yes,{sky:true});assert(r.ok);assert.deepEqual(yes.puts[1].slice(1),['REH',MIN,[80,60],false]);
});
await test('SKY는명시적으로켰을때만수집',async()=>{
 const w=world({jobs:[['SKY',MIN]],queue:[{status:200,text:grid(1,4)}]});assert.equal((await run(w)).error,'bad_plan');assert.equal(w.calls.length,0);
 const yes=world({jobs:[['SKY',MIN]],queue:[{status:200,text:grid(1,4)}]});assert((await run(yes,{sky:true})).ok);assert.equal(yes.plans[0],true);
});
await test('작업예산종료후다음호출에서이어받음',async()=>{
 const w=world();const fetch=w.deps.fetchText;w.deps.fetchText=async url=>{const r=await fetch(url);w.clock+=80000;return r;};
 const r=await run(w);assert(r.ok&&!r.done);assert.equal(r.error,'time_budget');assert.equal(r.saved,1);assert.equal(w.calls.length,1);assert.equal(r.remaining,1);
});
await test('미수집항목만받으며다시호출시중복API없음',async()=>{
 const w=world({jobs:[['TMX',MAX]],queue:[{status:200,text:grid(9,5)}]});assert((await run(w)).done);assert((await run(w)).done);assert.equal(w.calls.length,1);
});
await test('인증·계획시간도전체예산에포함',async()=>{
 const w=world();w.deps.tokenOk=async()=>{w.clock+=80000;return true;};const r=await run(w);assert.equal(r.error,'time_budget');assert.equal(w.calls.length,0);
});
await test('자정전후실제API요청을한국날짜별계측',async()=>{
 const w=world({clock:Date.parse('2026-11-06T23:59:59+09:00')});const fetch=w.deps.fetchText;
 w.deps.fetchText=async url=>{const r=await fetch(url);w.clock+=2000;return r;};assert((await run(w)).ok);
 assert.deepEqual(w.usages.map(u=>[u[0],u[1]]),[['2026-11-06',1],['2026-11-07',1]]);
});
for(const r of tests)console.log(`${r.ok?'PASS':'FAIL'} ${r.name}${r.error?': '+r.error:''}`);
const passed=tests.filter(r=>r.ok).length;console.log(`${passed}/${tests.length} 통과`);process.exitCode=passed===tests.length?0:1;
