import assert from 'node:assert/strict';
import { issue, requestFor, handle } from '../supabase/functions/probe-daily-forecast/core.mjs';
const results = [];
async function test(name, fn) { try { await fn(); results.push([name, true]); } catch(e) { results.push([name, false, e.message]); } }
const now = Date.parse('2026-11-06T16:00:00+09:00');
function world(extra = {}) {
  const w = { calls: [], key: 'secret/K+example', text: '# header\n11B00000,2026110606,맑음,10', status: 200, ...extra };
  w.deps = { now: () => now, env: () => w.key, tokenOk: async t => t === 'collector',
    fetchText: async u => { w.calls.push(u); return { status: w.status, text: w.text, bytes: w.text.length }; } };
  return w;
}
const req = (body = { kind: 'land' }, token = 'collector', method = 'POST') => new Request('https://test.invalid', {
  method, headers: token ? { 'x-collector-token': token } : {}, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
});
await test('중기 최근06시 발표 선택', () => assert.equal(issue(now), '2026110606'));
await test('중기 생산 직후 이전 발표 유지', () => assert.equal(issue(Date.parse('2026-11-06T18:10:00+09:00')), '2026110606'));
await test('중기 자정 이전 날짜18시 선택', () => assert.equal(issue(Date.parse('2026-11-06T00:10:00+09:00')), '2026110518'));
await test('단기14시 선택', () => assert.equal(issue(now, false), '2026110614'));
await test('단기 연말 경계', () => assert.equal(issue(Date.parse('2027-01-01T00:10:00+09:00'), false), '2026123120'));
await test('모르는 종류는 요청 없음', () => assert.equal(requestFor('https://evil.invalid', now), null));
await test('구역 목록은 최신만', () => assert.deepEqual(requestFor('regions', now).params, { tmfc: '0' }));
await test('최저/최고기온 다음날06/15시', () => {
  assert.equal(requestFor('TMN', now).params.tmef, '2026110706');
  assert.equal(requestFor('TMX', now).params.tmef, '2026110715');
});
await test('인증 없이 API 호출 안 함', async () => { const w = world(); assert.equal((await handle(req({}, ''), w.deps)).status, 401); assert.equal(w.calls.length, 0); });
await test('틀린 토큰 거부', async () => { const w = world(); assert.equal((await handle(req({}, 'wrong'), w.deps)).status, 401); });
await test('GET 거부', async () => assert.equal((await handle(req({}, '', 'GET'), world().deps)).status, 405));
await test('임의 URL/발표시각 입력 거부', async () => { const w = world(); assert.equal((await handle(req({ kind: 'land', url: 'https://evil.invalid' }), w.deps)).status, 400); assert.equal(w.calls.length, 0); });
await test('키 없으면 호출 안 함', async () => { const w = world({ key: '' }); assert.equal((await handle(req(), w.deps)).status, 503); assert.equal(w.calls.length, 0); });
await test('키는 요청 서버에만 첨부', async () => { const w = world(); const b = await (await handle(req(), w.deps)).json(); assert.equal(b.ok, true); assert.equal(new URL(w.calls[0]).searchParams.get('authKey'), w.key); assert(!JSON.stringify(b).includes(w.key)); });
await test('기존 수집기와 같이 키 앞뒤 공백 제거', async () => { const w = world({ key: ' secret/K+example\r\n' }); await handle(req(), w.deps); assert.equal(new URL(w.calls[0]).searchParams.get('authKey'), w.key.trim()); });
await test('폼 인코딩된 키 반사도 제거', async () => { const w = world({ key: "secret~with!punctuation'" }); const encoded = new URLSearchParams({authKey:w.key}).toString().slice(8); w.text = '<html>' + encoded + '</html>'; const b = await (await handle(req(),w.deps)).json(); assert(!b.text.includes(encoded)); });
await test('API 오류 키 반사 제거', async () => { const w = world(); w.text = '<html>ERROR ' + w.key + ' ' + encodeURIComponent(w.key) + '</html>'; const b = await (await handle(req(), w.deps)).json(); assert.equal(b.ok, false); assert(!JSON.stringify(b).includes(w.key)); assert(!JSON.stringify(b).includes(encodeURIComponent(w.key))); });
await test('통신 예외 주소/키 미출력', async () => { const w = world(); w.deps.fetchText = async () => { throw new Error(w.key); }; const r = await handle(req(), w.deps); assert.equal(r.status, 502); assert(!(await r.text()).includes(w.key)); });
await test('미제공 격자는 성공으로 처리 안 함', async () => { const w = world({ text: '# dfs_file_read error' }); const b = await (await handle(req({ kind: 'SKY' }), w.deps)).json(); assert.equal(b.ok, false); });
await test('유효 격자 요약만 반환', async () => { const w = world({ text: Array(149 * 253).fill('1').join(',') }); const b = await (await handle(req({ kind: 'SKY' }), w.deps)).json(); assert.equal(b.ok, true); assert.equal(b.stats.n, 37697); assert.equal(b.text, undefined); });
await test('큰 응답 절단 표시', async () => { const w = world({ text: '11B00000,' + 'x'.repeat(90000) }); const b = await (await handle(req(), w.deps)).json(); assert.equal(b.truncated, true); assert.equal(b.text.length, 80000); });
await test('공식구역정보JSON·페이지요청', () => { const s=requestFor('zones',now,{page:2});assert.equal(s.params.pageNo,'2');assert.equal(s.params.numOfRows,'1000');assert(s.url.endsWith('/FcstZoneInfoService/getFcstZoneCd')); });
await test('구역코드와페이지범위검사', () => { assert.equal(requestFor('zones',now,{page:21}),null);assert.equal(requestFor('zones',now,{regId:'../secret'}),null);assert.equal(requestFor('zones',now,{page:'2'}),null); });
await test('좌표·상위구역·전체개수해석', async () => {const w=world({text:JSON.stringify({response:{header:{resultCode:'00'},body:{totalCount:2,items:{item:[{regId:'11B10101',regName:'서울',regSp:'C',regUp:'11B00000',lat:'37.57',lon:'126.97',tmSt:'199001010000',tmEd:'210012310000'}]}}}})});const b=await(await handle(req({kind:'zones',page:1}),w.deps)).json();assert(b.ok);assert.equal(b.totalCount,2);assert.equal(b.items[0].lat,37.57);assert.equal(b.items[0].regUp,'11B00000');});
await test('구역단일객체도배열로해석', async()=>{const w=world({text:JSON.stringify({response:{header:{resultCode:'00'},body:{totalCount:1,items:{item:{regId:'11B00000',lat:0,lon:0}}}}})});const b=await(await handle(req({kind:'zones',regId:'11B00000'}),w.deps)).json();assert(b.ok);assert.equal(b.items[0].lat,null);});
await test('구역API오류에서키가리기',async()=>{const w=world();w.text=JSON.stringify({response:{header:{resultCode:'30',resultMsg:w.key}}});const b=await(await handle(req({kind:'zones'}),w.deps)).json();assert.equal(b.ok,false);assert(!JSON.stringify(b).includes(w.key));});
await test('구역API임의주소입력거부',async()=>{const w=world();assert.equal((await handle(req({kind:'zones',url:'https://evil.invalid'}),w.deps)).status,400);assert.equal(w.calls.length,0);});
await test('단기 육상 두 형식은 공식 고정 URL·최신 발표만',()=>{
  for(const [kind,path]of[['shortland','fct_afs_dl.php'],['shortland2','fct_afs_dl2.php']]){
    const s=requestFor(kind,now);assert.equal(s.path,'url/'+path);assert.deepEqual(s.params,{reg:'',disp:'1',help:'1'});
  }
});
await test('단기 육상 임의 구역·기간 입력 거부',async()=>{
  const w=world();assert.equal((await handle(req({kind:'shortland',reg:'11B10101'}),w.deps)).status,400);
  assert.equal((await handle(req({kind:'shortland2',tmfc1:'2013121106'}),w.deps)).status,400);assert.equal(w.calls.length,0);
});
await test('절단 뒤에 있는 단기 육상 표본도 전체에서 추출',async()=>{
  const w=world({text:'# '+'x'.repeat(81000)+'\n11B10101,2026110617,2026110700,A02\n11D20201,2026110617,2026110700,A02\n11H20201,excluded\n#7777END'});
  const b=await(await handle(req({kind:'shortland'}),w.deps)).json();assert(b.truncated);assert.equal(b.sampleRows.length,2);assert(b.sampleRows[1].startsWith('11D20201,'));assert(b.tail.endsWith('#7777END'));
});
await test('단기 육상 표본에도 키 반사 제거',async()=>{
  const w=world();w.text='11B10101,'+w.key+'\n'+encodeURIComponent(w.key);
  const b=await(await handle(req({kind:'shortland2'}),w.deps)).json();assert(!JSON.stringify(b).includes(w.key));assert(!b.tail.includes(encodeURIComponent(w.key)));
});
await test('단기 육상 표본 과다 출력 제한',async()=>{
  const w=world({text:Array(100).fill('11B10101,value').join('\n')});const b=await(await handle(req({kind:'shortland'}),w.deps)).json();assert.equal(b.sampleRows.length,60);
});
await test('격자 표본에서0과결측구분',async()=>{
  const values=Array(149*253).fill('1');values[(127-1)*149+60-1]='0';values[(130-1)*149+89-1]='-999';
  const b=await(await handle(req({kind:'TMN'}),world({text:values.join(',')}).deps)).json();assert.equal(b.samples[0].value,0);assert.equal(b.samples[1].value,null);assert.equal(b.samples.length,5);
});
await test('칸 하나 단기조회: 최신 단기 발표·고정 주소',()=>{
  const s=requestFor('vilage',now,{nx:60,ny:127});assert(s.url.endsWith('/VilageFcstInfoService_2.0/getVilageFcst'));
  assert.equal(s.params.base_date,'20261106');assert.equal(s.params.base_time,'1400');assert.equal(s.params.nx,'60');assert.equal(s.params.ny,'127');
});
await test('칸 하나 초단기조회: 45분 지난 정시 30분 발표',()=>{
  assert.equal(requestFor('ultra',Date.parse('2026-11-06T16:44:00+09:00'),{nx:60,ny:127}).params.base_time,'1530');
  assert.equal(requestFor('ultra',Date.parse('2026-11-06T16:46:00+09:00'),{nx:60,ny:127}).params.base_time,'1630');
  assert.equal(requestFor('ultra',Date.parse('2026-11-07T00:10:00+09:00'),{nx:60,ny:127}).params.base_date,'20261106');
});
await test('칸 하나 조회 좌표 검사',async()=>{
  for(const q of[{},{nx:0,ny:1},{nx:150,ny:1},{nx:1,ny:254},{nx:'60',ny:127},{nx:1.5,ny:2}])assert.equal(requestFor('vilage',now,q),null);
  const w=world();assert.equal((await handle(req({kind:'vilage',nx:60,ny:127,base_date:'20200101'}),w.deps)).status,400);assert.equal(w.calls.length,0);
});
await test('칸 하나 조회: 신적설·강수 원문 그대로, 다른 종류 뺌',async()=>{
  const item=[{category:'SNO',fcstDate:'20261106',fcstTime:'1800',fcstValue:'1.3cm'},{category:'SNO',fcstDate:'20261106',fcstTime:'1900',fcstValue:'1cm 미만'},
    {category:'PCP',fcstDate:'20261106',fcstTime:'1800',fcstValue:'2.5mm'},{category:'WSD',fcstDate:'20261106',fcstTime:'1800',fcstValue:'3'}];
  const w=world({text:JSON.stringify({response:{header:{resultCode:'00'},body:{items:{item}}}})});
  const b=await(await handle(req({kind:'vilage',nx:60,ny:127}),w.deps)).json();assert(b.ok);assert.equal(b.items.length,3);
  assert.deepEqual(b.distinct.SNO,['1.3cm','1cm 미만']);assert.equal(b.distinct.WSD,undefined);
});
await test('칸 하나 조회 오류에서 키 가리기',async()=>{
  const w=world();w.text='<OpenAPI_ServiceResponse>'+w.key+'</OpenAPI_ServiceResponse>';const b=await(await handle(req({kind:'ultra',nx:60,ny:127}),w.deps)).json();
  assert.equal(b.ok,false);assert.equal(b.error,'point_api_error');assert(!JSON.stringify(b).includes(w.key));
});
await test('칸 조회 줄 수·최신 발표 선택',()=>{
  const s=requestFor('vilage',now,{nx:60,ny:127,rows:1500,lag:10});assert.equal(s.params.numOfRows,'1500');assert.equal(s.params.base_time,'1400');
  assert.equal(requestFor('vilage',Date.parse('2026-11-06T14:05:00+09:00'),{nx:60,ny:127,lag:10}).params.base_time,'1100');
  assert.equal(requestFor('vilage',Date.parse('2026-11-06T14:12:00+09:00'),{nx:60,ny:127,lag:10}).params.base_time,'1400');
  assert.equal(requestFor('vilage',now,{nx:60,ny:127,rows:5000}),null);assert.equal(requestFor('vilage',now,{nx:60,ny:127,lag:5}),null);
});
await test('여러 칸 시험: 개수·동시 수 검사',()=>{
  assert.equal(requestFor('vilage_batch',now,{cells:[]}),null);assert.equal(requestFor('vilage_batch',now,{cells:Array(41).fill([60,127])}),null);
  assert.equal(requestFor('vilage_batch',now,{cells:[[60,127]],par:9}),null);assert.equal(requestFor('vilage_batch',now,{cells:[[0,1]]}),null);
  assert.equal(requestFor('vilage_batch',now,{cells:[[60,127],[61,128]]}).batch.length,2);
});
await test('여러 칸 시험: 칸마다 상태·줄 수만, 키 없음',async()=>{
  const item=[{category:'SNO',fcstDate:'20261106',fcstTime:'1800',fcstValue:'1.3cm'},{category:'TMP',fcstDate:'20261110',fcstTime:'0000',fcstValue:'3'}];
  const w=world({text:JSON.stringify({response:{header:{resultCode:'00'},body:{totalCount:1234,items:{item}}}})});
  const b=await(await handle(req({kind:'vilage_batch',cells:[[60,127],[61,128],[62,129]],par:2}),w.deps)).json();
  assert(b.ok);assert.equal(b.results.length,3);assert.equal(w.calls.length,3);assert.equal(b.results[0].totalCount,1234);assert.equal(b.results[0].last,'202611100000');
  assert.equal(b.results[0].cats,undefined);assert(!JSON.stringify(b).includes(w.key));assert.equal(new URL(w.calls[0]).searchParams.get('numOfRows'),'1500');
});
await test('여러 칸 시험: 오류 응답도 키 가림',async()=>{
  const w=world();w.text='<html>'+w.key+'</html>';const b=await(await handle(req({kind:'vilage_batch',cells:[[60,127]]}),w.deps)).json();
  assert.equal(b.ok,false);assert.equal(b.results[0].code,'not_json');assert(!JSON.stringify(b).includes(w.key));
});
await test('칸 하나 조회: 전체 줄 수·마지막 시각',async()=>{
  const item=[{category:'SNO',fcstDate:'20261106',fcstTime:'1800',fcstValue:'1.3cm'},{category:'WSD',fcstDate:'20261109',fcstTime:'2300',fcstValue:'3'}];
  const w=world({text:JSON.stringify({response:{header:{resultCode:'00'},body:{totalCount:900,items:{item}}}})});
  const b=await(await handle(req({kind:'vilage',nx:60,ny:127,rows:1500}),w.deps)).json();assert.equal(b.totalCount,900);assert.equal(b.got,2);assert.equal(b.last,'202611092300');assert.equal(b.cats.WSD,1);
});
for (const [n, ok, e] of results) console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${e ? ': ' + e : ''}`);
const passed = results.filter(r => r[1]).length;
console.log(`${passed}/${results.length} 통과`);
process.exitCode = passed === results.length ? 0 : 1;
