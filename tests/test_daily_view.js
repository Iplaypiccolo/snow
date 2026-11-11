const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const ctx={window:{addEventListener(){}},console};vm.createContext(ctx);vm.runInContext(fs.readFileSync('forecast/daily.js','utf8'),ctx);
const V=ctx.window.ForecastDaily,tests=[];function test(name,fn){try{fn();tests.push([name,true]);}catch(e){tests.push([name,false,e.message]);}}
const p={forecast_at:'2026-11-07T00:00:00+09:00',period_hours:12,sky:'DB01',precip:'0',pop:0,weather:'맑음',issued_at:'2026-11-06T17:00:00+09:00'};
const day={date:'2026-11-07',periods:[p],tmin:0,tmax:9,temperature_source:'grid_aux',tmin_issued_at:p.issued_at,tmax_issued_at:p.issued_at};
test('한국 날짜·토/일 색 구분·오전오후',()=>{const h=V.table({days:[day,{...day,date:'2026-11-08'}]});assert(h.includes('11/7(토)'));assert(h.includes('11/8(일)'));assert(h.includes('fc-sat'));assert(h.includes('fc-sun'));assert(h.includes('오전'));assert(h.includes('오후'));});
test('0℃·0%와 결측 구분',()=>{const h=V.table({days:[day]});assert(h.includes('0°'));assert(h.includes('0%'));assert(h.includes('>-</td>'));const n=V.table({days:[{...day,tmin:null,tmax:null,periods:[]}]});assert(!n.includes('0°'));assert(!n.includes('0%'));});
test('기온원값순서유지·모달의마우스설명제거',()=>{const h=V.table({days:[{...day,tmin:11,tmax:5}]});assert(h.indexOf('11°')<h.indexOf('5°'));assert(!h.includes(' title='));});
test('하루 원값은 오전오후로 복제하지 않음',()=>{const h=V.table({days:[{...day,periods:[{...p,period_hours:24,pop:60}]}]});assert(h.includes('>하루</th>'));assert.equal((h.match(/60%/g)||[]).length,1);assert.equal((h.match(/fc-weather-icon/g)||[]).length,1);});
test('날씨 원문 HTML은 문자로만',()=>{const h=V.table({days:[{...day,periods:[{...p,weather:'<img src=x onerror=alert(1)>'}]}]});assert(!h.includes('<img'));assert(h.includes('&lt;img'));});
test('11일만 표시(2026-11-11 날씨누리처럼)·누락 자료 빈칸',()=>{const h=V.table({days:Array.from({length:12},(_,i)=>({...day,date:'2026-11-'+String(7+i).padStart(2,'0')}))});assert(h.includes('11/17(화)'));assert(!h.includes('11/18'));});
test('단기/중기 하늘·강수 코드 해석·소나기4',()=>{assert.equal(V.icon(p),'☀️');assert.equal(V.icon({...p,precip:'3'}),'❄️');assert.equal(V.icon({...p,precip:'4'}),'🌧️');assert.equal(V.icon({...p,sky:'WB03',precip:'WB00'}),'🌥️');assert.equal(V.icon({...p,precip:'WB13'}),'🌨️');assert.equal(V.icon(null),'');});
for(const[n,ok,error]of tests)console.log(`${ok?'PASS':'FAIL'} ${n}${error?' '+error:''}`);const n=tests.filter(t=>t[1]).length;console.log(`${n}/${tests.length} 통과`);process.exitCode=n===tests.length?0:1;
