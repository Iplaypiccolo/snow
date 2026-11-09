const assert=require('node:assert/strict');
const {combine,qualitative,hourly48}=require('../forecast/series.js');
const H=3600000;let n=0;
function test(name,fn){fn();n++;console.log('PASS '+name);}
function sample(h=13){const start=Date.parse('2026-11-05T00:00:00+09:00')+h*H;
 const a=Array.from({length:24},(_,i)=>i%3);
 return {status:'ok',upper:{start_at:new Date(start).toISOString(),series:{s:a,p:a,t:a.map(x=>x-4),r:a.map(x=>x*20),sq:a.map(x=>x===0?1:0),pq:a.map(x=>x===0?1:0)}},tail:{bins:[]}};}
for(let h=0;h<24;h++)test('시작'+h+'시:24시간 누락·중복 없이 KST 정시 정렬',()=>{
 const d=sample(h),bs=combine(d);assert.equal(bs.reduce((s,b)=>s+b.hours,0),24);
 assert.equal(bs.reduce((s,b)=>s+b.pcp,0),24);assert.equal(bs.reduce((s,b)=>s+b.pcp_hi,0),32);
 assert.equal(Date.parse(bs[0].first_at),Date.parse(d.upper.start_at));
 bs.forEach(b=>assert.equal((Date.parse(b.last_at)+9*H)/H%3===0 || b===bs.at(-1),true));
 for(let i=1;i<bs.length;i++)assert.equal(Date.parse(bs[i].first_at)-Date.parse(bs[i-1].last_at),H);
});
test('초단기 혼합 캐시의 값 그대로 합산·최저·최고',()=>{const d=sample();d.upper.series.p[0]=7;const b=combine(d)[0];assert.equal(b.pcp,10);assert.equal(b.tmin,-4);assert.equal(b.pop,40);});
test('24시간 경계의 같은3시간 칸은 합치고 중복하지 않음',()=>{
 const d=sample(14),t=Date.parse(d.upper.start_at)+24*H;
 d.tail.bins=[{first_at:new Date(t).toISOString(),last_at:new Date(t+H).toISOString(),hours:2,snow:4,snow_hi:5,pcp:8,pcp_hi:9,tmin:-9,pop:80}];
 const bs=combine(d),last=bs.at(-1);assert.equal(last.hours,3);assert.equal(last.pcp,10);assert.equal(last.tmin,-9);assert.equal(last.pop,80);
 assert.equal(bs.reduce((s,b)=>s+b.hours,0),26);
});
test('코드·혼합·양 결측인 먼 칸도 기온/확률이 있으면 유지',()=>{const d=sample(),t=Date.parse(d.upper.start_at)+24*H;
 d.tail.bins=[0,1,2].map((i)=>({first_at:new Date(t+i*3*H).toISOString(),last_at:new Date(t+(i*3+2)*H).toISOString(),hours:3,snow:i===2?1:null,pcp:null,pop:90,tmin:4,code_hours:i===1?1:0}));
 assert.equal(combine(d).length,combine({...d,tail:{bins:[]}}).length+3);
});

test('적설 정성 코드2는 많은 눈이며2cm 합계가 아님',()=>{const q=qualitative({amount_kind:'code',snow_code:2},'snow');assert.equal(q.text,'많은 눈');assert.ok(q.title.includes('시간당 1cm 이상'));});
test('강수 정성 코드1·2·3의 강도 표현',()=>{assert.deepEqual([1,2,3].map(pcp_code=>qualitative({amount_kind:'code',pcp_code},'pcp').text),['약한 비','비','강한 비']);});
test('정성0은빈칸(미수집은-)·미확인코드는0으로만들지않음',()=>{assert.equal(qualitative({amount_kind:'code',snow_code:0},'snow').text,'');assert.equal(qualitative({amount_kind:'code',pcp_code:0},'pcp').text,'');for(const snow_code of [null,9,-1,1.5])assert.equal(qualitative({amount_kind:'code',snow_code},'snow').text,'-');});
test('혼합 구간은 양으로 합산하지 않고 정성 포함 표시',()=>{assert.equal(qualitative({amount_kind:'mixed'},'pcp').text,'정성 포함');assert.equal(qualitative({amount_kind:'numeric'},'pcp'),null);});
test('먼 정성 한 칸이 도착하면 즉시 한 칸 추가·기온/확률 유지',()=>{const d=sample(13),before=combine(d).length,t=Date.parse(d.upper.start_at)+24*H;
 d.tail.bins=[{first_at:new Date(t).toISOString(),last_at:new Date(t+2*H).toISOString(),hours:3,amount_kind:'code',snow:2,pcp:3,snow_code:2,pcp_code:3,tmin:-4,pop:90}];
 const bs=combine(d);assert.equal(bs.length,before+1);assert.equal(bs.at(-1).snow,null);assert.equal(bs.at(-1).pcp,null);assert.equal(bs.at(-1).pop,90);assert.equal(qualitative(bs.at(-1),'snow').text,'많은 눈');});
test('숫자와 코드가 같은 칸 경계에서 합쳐져도 합계로 만들지 않음',()=>{const d=sample(14),t=Date.parse(d.upper.start_at)+24*H;d.tail.bins=[{first_at:new Date(t).toISOString(),last_at:new Date(t+H).toISOString(),hours:2,amount_kind:'code',snow_code:2,pcp_code:3,tmin:-9,pop:80}];const b=combine(d).at(-1);assert.equal(b.amount_kind,'mixed');assert.equal(b.snow,null);assert.equal(b.pcp,null);assert.equal(b.tmin,-9);});
test('정량0은 시간 칸 유지·미량 상한 유지',()=>{const d=sample();d.upper.series.s.fill(0);d.upper.series.p.fill(0);const bs=combine(d);assert.equal(bs.length,8);assert.equal(bs[0].pcp,0);assert.ok(bs[0].pcp_hi>0);});
test('자정 칸은22~00 양쪽 날짜를 보존',()=>{const b=combine(sample(22))[0];assert.equal(b.hours,3);assert.notEqual(b.first_at.slice(0,10),new Date(Date.parse(b.last_at)+9*H).toISOString().slice(0,10));});
test('빈 이후 자료여도 가까운24시간 유지·입력 불변',()=>{const d=sample(),before=JSON.stringify(d);assert.ok(combine(d).length);assert.equal(JSON.stringify(d),before);assert.deepEqual(combine({status:'stale'}),[]);});
test('48시간은원래24시간과별도시간별원값을그대로연결',()=>{const d=sample();d.upper.series.vn=6;d.hourly_tail={start_at:new Date(Date.parse(d.upper.start_at)+24*H).toISOString(),end_at:new Date(Date.parse(d.upper.start_at)+48*H).toISOString(),series:{s:[0,2],p:[1,3],t:[0,-5],r:[0,80],sq:[false,true],pq:[true,false]}};const before=JSON.stringify(d),r=hourly48(d);assert.equal(r.series.s.length,48);assert.deepEqual(r.series.s.slice(0,24),d.upper.series.s);assert.deepEqual(r.series.s.slice(24,27),[0,2,null]);assert.equal(r.series.t[24],0);assert.equal(r.series.r[24],0);assert.equal(r.series.vn,6);assert.equal(r.series.sq[25],true);assert.equal(JSON.stringify(d),before);});
test('추가원값없음/연결시각오류때3시간합계를분할하지않음',()=>{const d=sample();assert.equal(hourly48(d),d.upper);d.hourly_tail={start_at:d.upper.start_at,series:{s:[100]}};assert.equal(hourly48(d),d.upper);});
test('86: 3시간 칸 습도는 그 칸 시각 중 최고, 없으면 null',()=>{const {combine}=require('../forecast/series.js');const st='2026-11-09T00:00:00Z';const mk=(h)=>({status:'ok',upper:{start_at:st,series:{s:Array(24).fill(0),p:Array(24).fill(0),t:Array(24).fill(1),r:Array(24).fill(0),h}},tail:{bins:[]}});const bs=combine(mk(Array.from({length:24},(_,i)=>i<3?[60,70,80][i]:50)));assert.equal(bs[0].hours,1);assert.equal(bs[0].reh,60);assert.equal(bs[1].hours,3);assert.equal(bs[1].reh,80);assert(bs.every(b=>b.reh!=null));const none=combine(mk(undefined));assert(none.every(b=>b.reh==null));});
console.log(`${n}/${n} 통과`);
