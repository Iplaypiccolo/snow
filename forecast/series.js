/* 시간별 캐시와 이후 집계를 KST 3시간 칸으로 연결. 서버 자료는 수정하지 않는다. */
(function(root){
  'use strict';
  var H=3600000;
  function slotEnd(t){return Math.floor((t-H)/ (3*H))*(3*H)+3*H;}
  function add(a,b){return a==null||b==null?null:a+b;}
  function minimum(a,b){return a==null?b:b==null?a:Math.min(a,b);}
  function maximum(a,b){return a==null?b:b==null?a:Math.max(a,b);}
  function kind(b){return b.amount_kind || ((b.code_hours||0)>0 ? (b.quantity_hours>0?'mixed':'code') : 'numeric');}
  function qualitative(b,field){
    if(kind(b)==='numeric')return null;
    if(kind(b)==='mixed')return {text:'정성 포함',title:'정량과 정성 예보가 함께 있는 구간으로 합계량을 표시하지 않습니다.'};
    var snow=field==='snow',code=b[field+'_code'],labels=snow?['','보통 눈','많은 눈']:['','약한 비','비','강한 비'];   // 2026-11-09 사용자: 없음은 다른 칸처럼 빈칸(미수집은 '-')
    var bounds=snow?['강설 없음','시간당 1cm 미만','시간당 1cm 이상']:['강수 없음','시간당 3mm 미만','시간당 3mm 이상 15mm 미만','시간당 15mm 이상'];
    return Number.isInteger(code)&&code>=0&&code<labels.length?{text:labels[code],title:'정성 예보: '+bounds[code]+'. 3시간 누적량이 아닙니다.'}:{text:'-',title:'강수·적설 강도를 확인할 수 없습니다.'};
  }
  // 기상청 날씨누리처럼 곧 다가올 시각은 빼고 보여 줌(2026-11-09 사용자 결정): 지금을 가장 가까운 정시로 반올림한 시각의 다음 정시부터.
  // 예) 08:24 → 09시부터, 08:34·08:50 → 10시부터. 반환값 = 표 시작(start)에서 앞의 몇 시각을 뺄지
  function skipHours(start,now){var s=Date.parse(start);if(!Number.isFinite(s)||!Number.isFinite(now))return 0;var cut=Math.floor((now+30*60000)/H)*H+H;return Math.max(0,Math.min(24,Math.round((cut-s)/H)));}
  function combine(data,skip){
    if(!data || data.status!=='ok' || !data.upper) return [];
    var upper=data.upper,sr=upper.series||{},start=Date.parse(upper.start_at),groups={};
    if(!Number.isFinite(start)) return [];
    function insert(b){
      var key=slotEnd(Date.parse(b.first_at)),old=groups[key];
      if(!old){groups[key]=Object.assign({},b,{amount_kind:kind(b)});if(kind(b)!=='numeric')['snow','snow_hi','pcp','pcp_hi'].forEach(function(k){groups[key][k]=null;});return;}
      var ak=kind(old),bk=kind(b);
      old.amount_kind=ak===bk?ak:'mixed';
      ['snow_code','pcp_code'].forEach(function(k){old[k]=old[k]==null||b[k]==null?null:Math.max(old[k],b[k]);});
      old.last_at=new Date(Math.max(Date.parse(old.last_at),Date.parse(b.last_at))).toISOString();
      old.hours+=b.hours;
      ['snow','snow_hi','pcp','pcp_hi'].forEach(function(k){old[k]=old.amount_kind==='numeric'?add(old[k],b[k]):null;});
      old.tmin=minimum(old.tmin,b.tmin);old.pop=maximum(old.pop,b.pop);
    }
    for(var i=skip||0;i<24;i++){
      var t=start+i*H,iso=new Date(t).toISOString();
      var snow=sr.s && sr.s[i],rain=sr.p && sr.p[i];
      insert({first_at:iso,last_at:iso,hours:1,snow:snow==null?null:snow,snow_hi:snow==null?null:snow+((sr.sq||[])[i]?1:0),pcp:rain==null?null:rain,pcp_hi:rain==null?null:rain+((sr.pq||[])[i]?1:0),tmin:sr.t && sr.t[i],pop:sr.r && sr.r[i]});
    }
    (data.tail && data.tail.bins || []).forEach(function(b){
      // 정성 구간도 시간 칸을 유지하며 코드 강도를 합계량에 넣지 않는다.
      if(Date.parse(b.first_at)<start+24*H) return;
      insert(b);
    });
    return Object.keys(groups).sort(function(a,b){return +a-+b;}).map(function(k){
      var b=groups[k];b.expected_hours=(Date.parse(b.last_at)-Date.parse(b.first_at))/H+1;
      b.partial=b.hours<3 || b.hours<b.expected_hours;return b;
    }).filter(function(b){return b.snow!=null || b.pcp!=null || b.tmin!=null || b.pop!=null || b.snow_code!=null || b.pcp_code!=null;});
  }
  function hourly48(data){
    var upper=data.upper,extra=data.hourly_tail;
    if(!extra||!extra.series||Date.parse(extra.start_at)!==Date.parse(upper.start_at)+24*H)return upper;
    var series={vn:upper.series.vn||0};
    ['s','p','t','r','sq','pq'].forEach(function(k){
      series[k]=Array.from({length:48},function(_,i){var a=i<24?upper.series:extra.series,j=i%24;return a[k]&&a[k][j]!=null?a[k][j]:null;});
    });
    return{start_at:upper.start_at,end_at:extra.end_at,series:series};
  }
  var api={combine:combine,qualitative:qualitative,hourly48:hourly48,skipHours:skipHours};
  if(typeof module!=='undefined' && module.exports) module.exports=api;else root.ForecastSeries=api;
})(typeof window!=='undefined'?window:this);
