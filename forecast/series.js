/* 격자 하나의 시간별 값(가까운 24시간 + 이후)을 1시간 표 범위와 KST 3시간 칸으로. 서버 자료는 수정하지 않는다. */
(function(root){
  'use strict';
  var H=3600000;
  function slotEnd(t){return Math.floor((t-H)/ (3*H))*(3*H)+3*H;}
  function num(v){return typeof v==='number'&&isFinite(v);}
  // 89(2026-11-09 사용자 "기상청처럼"): 강도 등급. 가까운 구간은 시간당 양에서(비 3mm·15mm, 눈 1cm 기준, '~1'은 약한 쪽),
  // 그 뒤 구간은 기상청이 양 대신 주는 등급(pc 1~3·sc 1~2)을 그대로. 0 = 없음, null = 모름
  function rainCode(h){if(h.pc!=null)return Number.isInteger(h.pc)&&h.pc>=0&&h.pc<=3?h.pc:null;if(!num(h.p))return null;return h.p>=15?3:h.p>=3?2:h.p>0||h.pq?1:0;}
  function snowCode(h){if(h.sc!=null)return Number.isInteger(h.sc)&&h.sc>=0&&h.sc<=2?h.sc:null;if(!num(h.s))return null;return h.s>=1?2:h.s>0||h.sq?1:0;}
  function intensity(code,snow){var L=snow?['-','보통 눈','많은 눈']:['-','약한비','보통비','강한비'];return Number.isInteger(code)&&code>=0&&code<L.length?L[code]:'-';}   // 비 이름은 날씨누리 화면 그대로, 0(없음)도 날씨누리처럼 '-'(2026-11-11)
  // 기상청 날씨누리처럼 곧 다가올 시각은 빼고 보여 줌(2026-11-09 사용자 결정): 지금을 가장 가까운 정시로 반올림한 시각의 다음 정시부터.
  // 예) 08:24 → 09시부터, 08:34·08:50 → 10시부터. 반환값 = 표 시작(start)에서 앞의 몇 시각을 뺄지
  function skipHours(start,now){var s=Date.parse(start);if(!Number.isFinite(s)||!Number.isFinite(now))return 0;var cut=Math.floor((now+30*60000)/H)*H+H;return Math.max(0,Math.min(24,Math.round((cut-s)/H)));}
  function at(a,i){return a&&a[i]!=null?a[i]:null;}
  // 89: 시간별 값 한 줄 = 가까운 24시간(초단기 섞임) + 이후 받은 끝까지(hourly_tail). 입력은 바꾸지 않음
  function hours(data){
    if(!data||data.status!=='ok'||!data.upper)return [];
    var up=data.upper,ex=data.hourly_tail,st=Date.parse(up.start_at),out=[];
    if(!Number.isFinite(st))return [];
    function push(sr,i,t){out.push({t:t,s:at(sr.s,i),p:at(sr.p,i),sq:!!at(sr.sq,i),pq:!!at(sr.pq,i),sc:at(sr.sc,i),pc:at(sr.pc,i),tmp:at(sr.t,i),pop:at(sr.r,i),reh:at(sr.h,i)});}
    for(var i=0;i<24;i++)push(up.series||{},i,st+i*H);
    if(ex&&ex.series&&Date.parse(ex.start_at)===st+24*H){var es=ex.series,n=(es.t||es.s||[]).length;for(var j=0;j<n;j++)push(es,j,st+(24+j)*H);}
    return out;
  }
  // 3시간 칸(기상청 날씨누리 3시간 화면과 같은 규칙, 2026-11-09 625칸 대조): 칸 = 그 시각까지 3시간(03시 칸 = 01·02·03시)
  //  기온·습도 = 그 시각 값, 강수확률 = 비·눈이 있으면 최고·없으면 평균(10% 단위 반올림), 강수·신적설 = 3시간 중 가장 센 강도
  //  2026-11-11(39칸 312칸 대조): 기상청이 양 대신 강도만 주는 구간(칸 안 시각이 모두 강도뿐)은 날씨누리도 그 칸 시각 값만 씀(강수확률·강수·신적설)
  function combine(data,skip){
    var groups={},order=[];
    hours(data).slice(skip||0).forEach(function(h){var k=slotEnd(h.t);if(!groups[k]){groups[k]=[];order.push(k);}groups[k].push(h);});
    function top(a){var x=a.filter(function(v){return v!=null;});return x.length?Math.max.apply(null,x):null;}
    return order.map(function(k){
      var g=groups[k],slot=g.filter(function(h){return h.t===+k;})[0]||null,rc=g.map(rainCode),sc=g.map(snowCode);
      if(slot&&g.every(function(h){return h.pc!=null||h.sc!=null;}))      // 강도만 주는 구간: 그 칸 시각 값
        return {first_at:new Date(g[0].t).toISOString(),last_at:new Date(g[g.length-1].t).toISOString(),slot_at:new Date(+k).toISOString(),hours:g.length,
          tmp:slot.tmp,reh:slot.reh,pop:num(slot.pop)?slot.pop:null,pcp_code:rainCode(slot),snow_code:snowCode(slot)};
      var wet=rc.some(function(c){return c>0;})||sc.some(function(c){return c>0;});
      var pops=g.map(function(h){return h.pop;}).filter(num);
      var pop=!pops.length?null:wet?Math.max.apply(null,pops):Math.floor(pops.reduce(function(a,v){return a+v;},0)/pops.length/10+0.5)*10;
      return {first_at:new Date(g[0].t).toISOString(),last_at:new Date(g[g.length-1].t).toISOString(),slot_at:new Date(+k).toISOString(),hours:g.length,
        tmp:slot?slot.tmp:null,reh:slot?slot.reh:null,pop:pop,pcp_code:top(rc),snow_code:top(sc)};
    }).filter(function(b){return b.tmp!=null||b.pop!=null||b.pcp_code!=null||b.snow_code!=null;});
  }
  // 1시간 표: 가까운 24시간 + 이후 중 기상청이 양(mm·cm)으로 주는 끝까지(quantity_end_at, 날씨누리 1시간 화면과 같은 범위)
  function hourlyAll(data){
    var upper=data.upper,extra=data.hourly_tail;
    if(!extra||!extra.series||Date.parse(extra.start_at)!==Date.parse(upper.start_at)+24*H)return upper;
    var es=extra.series,st=Date.parse(extra.start_at),n=(es.t||es.s||[]).length;
    if(Object.prototype.hasOwnProperty.call(extra,'quantity_end_at')){var qe=Date.parse(extra.quantity_end_at);n=Number.isFinite(qe)?Math.max(0,Math.min(n,Math.round((qe-st)/H)+1)):0;}
    var series={vn:upper.series.vn||0};
    ['s','p','t','r','sq','pq','h'].forEach(function(k){
      series[k]=Array.from({length:24+n},function(_,i){var a=i<24?upper.series:es,j=i<24?i:i-24;return a[k]&&a[k][j]!=null?a[k][j]:null;});
    });
    return{start_at:upper.start_at,end_at:new Date(st+n*H).toISOString(),series:series};
  }
  var api={combine:combine,intensity:intensity,hourlyAll:hourlyAll,skipHours:skipHours};
  if(typeof module!=='undefined' && module.exports) module.exports=api;else root.ForecastSeries=api;
})(typeof window!=='undefined'?window:this);
