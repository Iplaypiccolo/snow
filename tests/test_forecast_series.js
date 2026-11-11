const assert=require('node:assert/strict');
const {combine,intensity,hourlyAll,skipHours}=require('../forecast/series.js');
const H=3600000;let n=0;
function test(name,fn){fn();n++;console.log('PASS '+name);}
const KST=(s)=>Date.parse(s+'+09:00');
// 가까운 24시간(upper) + 이후(hourly_tail). f(d, at) 로 i번째 시각 값 덮어쓰기
function sample(startKst='2026-11-09T21:00:00',tailN=0,f){
  const st=KST(startKst),z=(v)=>Array.from({length:24},()=>v);
  const up={s:z(0),p:z(0),t:z(5),r:z(0),sq:z(0),pq:z(0),h:z(70)};
  const tl={s:[],p:[],t:[],r:[],sq:[],pq:[],sc:[],pc:[],h:[]};for(let i=0;i<tailN;i++){tl.s.push(0);tl.p.push(0);tl.t.push(5);tl.r.push(0);tl.sq.push(false);tl.pq.push(false);tl.sc.push(null);tl.pc.push(null);tl.h.push(70);}
  const d={status:'ok',upper:{start_at:new Date(st).toISOString(),series:up},tail:{bins:[]}};
  if(tailN)d.hourly_tail={start_at:new Date(st+24*H).toISOString(),end_at:new Date(st+(24+tailN)*H).toISOString(),quantity_end_at:new Date(st+(24+tailN-1)*H).toISOString(),series:tl};
  if(f)f(d,(i)=>i<24?[up,i]:[tl,i-24]);
  return d;
}
const set=(d,at,i,k,v)=>{const [s,j]=at(i);s[k][j]=v;};
for(let h=0;h<24;h++)test('시작'+h+'시: 24시간 누락·중복 없이 KST 00·03·06… 칸(칸 = 그 시각까지 3시간)',()=>{
  const st=new Date(Date.parse('2026-11-05T00:00:00+09:00')+h*H+9*H).toISOString().slice(0,19);
  const d=sample(st),bs=combine(d);
  assert.equal(bs.reduce((s,b)=>s+b.hours,0),24);
  assert.equal(Date.parse(bs[0].first_at),Date.parse(d.upper.start_at));
  bs.forEach(b=>{assert.equal(((Date.parse(b.slot_at)+9*H)/H)%3,0);assert.ok(Date.parse(b.last_at)<=Date.parse(b.slot_at));assert.ok(b.hours>=1&&b.hours<=3);});
  for(let i=1;i<bs.length;i++)assert.equal(Date.parse(bs[i].first_at)-Date.parse(bs[i-1].last_at),H);
});
test('기온·습도 = 그 칸 시각(03시 칸이면 03시) 값, 최저·최고가 아님',()=>{
  const d=sample('2026-11-10T01:00:00',0,(d,at)=>{[[0,3],[1,9],[2,6]].forEach(([i,v])=>set(d,at,i,'t',v));[[0,90],[1,95],[2,80]].forEach(([i,v])=>set(d,at,i,'h',v));});
  const b=combine(d)[0];assert.equal(new Date(Date.parse(b.slot_at)+9*H).toISOString().slice(11,13),'03');assert.equal(b.tmp,6);assert.equal(b.reh,80);
});
test('강수확률: 비·눈이 없으면 3시간 평균을 10% 단위로 반올림(0·20·0 → 10, 30·30·0 → 20, 20·30 → 30)',()=>{
  const mk=(st,pops)=>sample(st,0,(d,at)=>pops.forEach((v,i)=>set(d,at,i,'r',v)));
  assert.equal(combine(mk('2026-11-10T04:00:00',[0,20,0]))[0].pop,10);
  assert.equal(combine(mk('2026-11-10T01:00:00',[30,30,0]))[0].pop,20);
  assert.equal(combine(mk('2026-11-10T02:00:00',[20,30]))[0].pop,30);
});
test('강수확률: 3시간 중 비가 있으면 최고(날씨누리 102,100 11/10 03시: 약한비60·보통비60·맑음0 → 60, 보통비)',()=>{
  const d=sample('2026-11-10T01:00:00',0,(d,at)=>{[60,60,0].forEach((v,i)=>set(d,at,i,'r',v));set(d,at,0,'p',2);set(d,at,1,'p',5);});
  const b=combine(d)[0];assert.equal(b.pop,60);assert.equal(intensity(b.pcp_code,false),'보통비');
});
test('강수 강도: 3시간 중 가장 센 값. ~1mm(양 0·강수형태 있음)는 약한비, 3mm 보통비, 15mm 강한비',()=>{
  const one=(p,pq)=>combine(sample('2026-11-10T01:00:00',0,(d,at)=>{set(d,at,2,'p',p);set(d,at,2,'pq',pq);}))[0].pcp_code;
  assert.deepEqual([one(0,0),one(0,1),one(1,0),one(2.9,0),one(3,0),one(14.9,0),one(15,0)],[0,1,1,1,2,2,3]);
  assert.deepEqual([0,1,2,3].map(c=>intensity(c,false)),['-','약한비','보통비','강한비']);      // 0(없음)도 '-'(2026-11-11 날씨누리처럼)
});
test('신적설 강도: ~1cm 는 보통 눈(1cm 미만), 1cm 이상 많은 눈',()=>{
  const one=(s,sq)=>combine(sample('2026-11-10T01:00:00',0,(d,at)=>{set(d,at,1,'s',s);set(d,at,1,'sq',sq);}))[0].snow_code;
  assert.deepEqual([one(0,0),one(0,1),one(1,0),one(3,0)],[0,1,2,2]);
  assert.deepEqual([0,1,2].map(c=>intensity(c,true)),['-','보통 눈','많은 눈']);
});
test('눈만 와도 강수확률은 최고(비·눈이 있는 칸)',()=>{
  const d=sample('2026-11-10T01:00:00',0,(d,at)=>{[10,40,20].forEach((v,i)=>set(d,at,i,'r',v));set(d,at,0,'sq',1);});
  assert.equal(combine(d)[0].pop,40);
});
test('기상청이 양 대신 등급만 주는 먼 시각: 그 칸 시각의 등급·확률(날씨누리 3시간, 2026-11-11 312칸 대조), 양과 섞인 칸은 더 센 쪽',()=>{
  const d=sample('2026-11-09T21:00:00',30,(d,at)=>{
    for(let i=27;i<54;i++){set(d,at,i,'p',null);set(d,at,i,'s',null);set(d,at,i,'pq',null);set(d,at,i,'sq',null);set(d,at,i,'pc',0);set(d,at,i,'sc',0);set(d,at,i,'r',30);}
    set(d,at,50,'pc',3);set(d,at,50,'r',60);set(d,at,51,'sc',2);set(d,at,51,'r',70);set(d,at,26,'p',4);});
  const bs=combine(d),st=Date.parse(d.upper.start_at),b51=bs.find(b=>b.slot_at===new Date(st+51*H).toISOString());      // 51번째 = 00시(그 칸 시각)
  assert.equal(b51.pcp_code,0);assert.equal(b51.snow_code,2);assert.equal(b51.pop,70);assert.equal(intensity(b51.snow_code,true),'많은 눈');   // 50번째(앞 시각)의 강한비·60%는 안 씀
  const last=bs.at(-1);assert.equal(last.hours,2);assert.equal(last.pop,30);      // 끝의 짧은 칸(그 칸 시각 없음)은 예전 규칙
  const mixed=bs.find(b=>Date.parse(b.first_at)<=st+26*H&&Date.parse(b.last_at)>=st+27*H);
  assert.equal(mixed.pcp_code,2);      // 양 4mm(보통비) + 등급 0 이 같은 칸(양이 섞이면 예전대로 가장 센 쪽)
});
test('먼 시각 확률: 앞 시각에만 비가 있으면 칸은 비 없음·그 시각 확률(공주 14일 02시 비 → 03시 칸 30%)',()=>{
  const d=sample('2026-11-09T21:00:00',30,(d,at)=>{
    for(let i=24;i<54;i++){set(d,at,i,'p',null);set(d,at,i,'s',null);set(d,at,i,'pq',null);set(d,at,i,'sq',null);set(d,at,i,'pc',0);set(d,at,i,'sc',0);set(d,at,i,'r',30);}
    set(d,at,28,'pc',1);set(d,at,28,'r',60);});
  const b=combine(d).find(x=>x.slot_at===new Date(Date.parse(d.upper.start_at)+30*H).toISOString());
  assert.equal(b.pcp_code,0);assert.equal(b.pop,30);assert.equal(intensity(b.pcp_code,false),'-');
});
test('모르는 등급·빠진 시각은 0 으로 만들지 않음(모두 모르면 -)',()=>{
  const d=sample('2026-11-09T21:00:00',3,(d,at)=>{for(let i=24;i<27;i++){set(d,at,i,'p',null);set(d,at,i,'pq',null);set(d,at,i,'pc',i===24?9:null);}});
  const b=combine(d).at(-1);assert.equal(b.pcp_code,null);assert.equal(intensity(b.pcp_code,false),'-');assert.equal(intensity(1.5,false),'-');
});
test('앞에서 뺀 시각(skip)은 칸에 넣지 않음, 첫 칸이 짧을 수 있음',()=>{
  const d=sample('2026-11-09T22:00:00',0,(d,at)=>set(d,at,0,'t',-9)),bs=combine(d,1);
  assert.equal(Date.parse(bs[0].first_at),Date.parse(d.upper.start_at)+H);assert.equal(bs[0].hours,2);assert.ok(bs.every(b=>b.tmp!==-9));
});
test('24시간과 이후를 이어 받은 끝까지 칸을 만듦, 입력은 바꾸지 않음',()=>{
  const d=sample('2026-11-09T21:00:00',51),before=JSON.stringify(d),bs=combine(d);
  assert.equal(bs.reduce((s,b)=>s+b.hours,0),75);assert.equal(JSON.stringify(d),before);
  assert.deepEqual(combine({status:'stale'}),[]);
  const bad=sample('2026-11-09T21:00:00',6);bad.hourly_tail.start_at=bad.upper.start_at;assert.equal(combine(bad).reduce((s,b)=>s+b.hours,0),24);
});
test('1시간 표: 양으로 주는 끝(quantity_end_at)까지만 이음',()=>{
  const d=sample('2026-11-09T21:00:00',76);d.upper.series.vn=6;d.hourly_tail.quantity_end_at=new Date(Date.parse(d.hourly_tail.start_at)+51*H).toISOString();
  const before=JSON.stringify(d),r=hourlyAll(d);
  assert.equal(r.series.s.length,76);assert.equal(r.series.h.length,76);assert.equal(r.series.vn,6);assert.equal(Date.parse(r.end_at),Date.parse(d.upper.start_at)+76*H);
  assert.deepEqual(r.series.t.slice(0,24),d.upper.series.t);assert.equal(JSON.stringify(d),before);
  d.hourly_tail.quantity_end_at=null;assert.equal(hourlyAll(d).series.s.length,24);
  delete d.hourly_tail.quantity_end_at;assert.equal(hourlyAll(d).series.s.length,100);      // 예전 서버 응답: 받은 만큼
  d.hourly_tail.start_at=d.upper.start_at;assert.equal(hourlyAll(d),d.upper);delete d.hourly_tail;assert.equal(hourlyAll(d),d.upper);
});
test('지난 시각 빼기: 08:24 → 09시부터, 08:34 → 10시부터',()=>{
  assert.equal(skipHours('2026-11-09T00:00:00Z',Date.parse('2026-11-08T23:24:00Z')),0);assert.equal(skipHours('2026-11-09T00:00:00Z',Date.parse('2026-11-08T23:34:00Z')),1);
});
console.log(`${n}/${n} 통과`);
