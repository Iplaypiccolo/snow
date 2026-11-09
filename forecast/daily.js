/* 일별 원값 표시와 세 예보창의 휴대폰 탭. 시간별 계산/수집 코드는 건드리지 않는다.
   2026-11-09(마이그레이션 83): 일별 자료는 격자별로 기억하고, 열려 있는 동안 10분마다 forecast_version 의 d 만 확인해 바뀐 때만 다시 받음 */
(function(){
  'use strict';
  var D={key:null,seq:0,data:null,error:false,closed:false,tab:'hourly',timer:null,busy:0,geo:{scale:null,x:null,y:null},ver:null,cache:{}};
  var ids=['fc-pin','fc-tail','fc-daily'],tabs=['hourly','three','daily'];
  function $(id){return document.getElementById(id);}
  function phone(){return window.matchMedia('(max-width:760px)').matches;}
  function esc(x){return String(x==null?'':x).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function icon(p){
    if(!p)return '';
    if(p.precip==='2'||p.precip==='WB13')return '🌨️';
    if(p.precip==='3'||p.precip==='WB11')return '❄️';
    if(p.precip==='4'||p.precip==='1'||p.precip==='WB09'||p.precip==='WB12')return '🌧️';
    return{DB01:'☀️',DB02:'🌤️',DB03:'🌥️',DB04:'☁️',WB01:'☀️',WB02:'🌤️',WB03:'🌥️',WB04:'☁️'}[p.sky]||'';
  }
  function halves(day){
    var periods=Array.isArray(day.periods)?day.periods:[],a=[null,null];
    periods.forEach(function(p){var h=new Date(Date.parse(p.forecast_at)+9*3600000).getUTCHours();if(p.period_hours===24)a=[p,p];else if(h===0||h===12)a[h===0?0:1]=p;});return a;
  }
  function table(data){
    var days=(data.days||[]).slice(0,7),html='<div class="fc-scroll" tabindex="0" aria-label="일별 예보 가로 스크롤"><table class="fc-daily-table"><thead><tr><th rowspan="2" class="lb">일별</th>';
    days.forEach(function(day,di){var d=new Date(day.date+'T00:00:00Z'),w=d.getUTCDay();html+='<th colspan="2" class="'+(w===0?'fc-sun':w===6?'fc-sat':'')+(di?' dl':'')+'">'+(d.getUTCMonth()+1)+'/'+d.getUTCDate()+'('+'일월화수목금토'[w]+')</th>';});
    html+='</tr><tr>';days.forEach(function(day,di){var h=halves(day),dl=di?' class="dl"':'';html+=h[0]&&h[0]===h[1]?'<th colspan="2"'+dl+'>하루</th>':'<th'+dl+'>오전</th><th>오후</th>';});html+='</tr></thead><tbody>';
    ['weather','temperature','pop'].forEach(function(row){
      html+='<tr><th class="lb">'+{weather:'날씨',temperature:'최저·최고<br>℃',pop:'강수확률'}[row]+'</th>';
      days.forEach(function(day,di){var hs=halves(day),whole=hs[0]&&hs[0]===hs[1];hs.forEach(function(p,i){
        if(row!=='temperature'&&whole&&i===1)return;
        var span=row!=='temperature'&&whole?' colspan="2"':'',value='-';
        if(row==='temperature'){
          var v=day[i===0?'tmin':'tmax'];
          if(v!=null&&Number.isFinite(v))value=esc(v)+'°';
        }else if(p){
          if(row==='weather')value='<span class="fc-weather-icon" aria-hidden="true">'+icon(p)+'</span><span class="fc-weather-name">'+esc(p.weather)+'</span>';
          else if(p.pop!=null)value=esc(p.pop)+'%';
        }
        html+='<td'+span+' class="'+(row==='temperature'?(i===0?'fc-low':'fc-high'):'')+(di&&i===0?' dl':'')+'">'+value+'</td>';      // dl = 날짜가 바뀌는 칸(진한 선)
      });});html+='</tr>';
    });
    return html+'</tbody></table></div>';
  }
  function visible(){var v=$('view-forecast');return !!(D.key&&!D.closed&&v&&v.offsetParent&&!document.hidden&&(!phone()||D.tab==='daily'));}
  function schedule(){clearTimeout(D.timer);D.timer=null;if(visible())D.timer=setTimeout(function(){if(D.error||!D.data)fetchDaily();else check();},D.error?180000:600000);}
  function version(fresh){return window.ForecastUI&&window.ForecastUI.version?window.ForecastUI.version(fresh):Promise.reject(Error('no version'));}
  // 83: 바뀌었을 때만 다시 받음. 확인이 안 되면 예전처럼 다시 받음
  function check(){
    if(!visible()||D.busy===D.seq)return;
    var seq=D.seq;D.busy=seq;
    version(true).then(function(v){if(D.busy===seq)D.busy=0;if(seq!==D.seq)return;if(!D.ver||v.d!==D.ver)fetchDaily(v);else schedule();},
      function(){if(D.busy===seq)D.busy=0;if(seq===D.seq)fetchDaily(null);});
  }
  function fetchDaily(known){
    if(!visible()||D.busy===D.seq)return;
    var seq=D.seq,key=D.key,xy=key.split(','),ver=known||null;D.busy=seq;
    (known!==undefined?Promise.resolve(known):version(false).catch(function(){return null;})).then(function(v){
      ver=v;if(seq!==D.seq)return {stale:true};
      return SSAuth.authed('/rest/v1/rpc/forecast_daily_cell',{method:'POST',body:{p_nx:+xy[0],p_ny:+xy[1]}});
    }).then(function(r){
      if(seq!==D.seq||r.stale)return;if(!r.ok||!r.json||!Array.isArray(r.json.days))throw Error('daily unavailable');
      D.ver=ver?ver.d:null;if(ver){D.cache[key]={d:ver.d,data:r.json};var ks=Object.keys(D.cache);if(ks.length>40)delete D.cache[ks[0]];}
      D.data=r.json;D.error=false;render();
    }).catch(function(){if(seq===D.seq){D.error=true;render();}}).then(function(){if(D.busy===seq)D.busy=0;if(seq===D.seq)schedule();});
  }
  function ensure(){
    var near=$('fc-pin');if(!near||$('fc-daily'))return;
    var parent=near.parentNode,box=document.createElement('div');box.id='fc-daily';box.className='fc-daily';box.hidden=true;parent.appendChild(box);
    var mobile=document.createElement('div');mobile.id='fc-mobile';mobile.className='fc-mobile';mobile.hidden=true;mobile.setAttribute('role','dialog');mobile.setAttribute('aria-label','선택 격자 예보');
    mobile.innerHTML='<div class="fc-mobile-head"><div role="tablist" aria-label="예보 간격">'+tabs.map(function(t,i){return '<button type="button" id="fc-tab-'+t+'" role="tab" aria-controls="'+ids[i]+'" data-fc-tab="'+t+'">'+['1시간','3시간','일별'][i]+'</button>';}).join('')+'</div><span class="fc-mobile-location"></span><button type="button" class="fc-mobile-close" aria-label="예보 닫기">×</button></div>';
    parent.appendChild(mobile);
    mobile.addEventListener('click',function(e){var t=e.target.closest('[data-fc-tab]');if(t){D.tab=t.dataset.fcTab;D.closed=false;layout();if(D.tab==='daily'&&!D.data)fetchDaily();schedule();}else if(e.target.closest('.fc-mobile-close'))window.ForecastUI.closeSelection();});
    mobile.addEventListener('keydown',function(e){var t=e.target.closest('[data-fc-tab]');if(!t)return;var i=tabs.indexOf(t.dataset.fcTab),next=e.key==='ArrowRight'?(i+1)%3:e.key==='ArrowLeft'?(i+2)%3:e.key==='Home'?0:e.key==='End'?2:-1;if(next>=0){e.preventDefault();$('fc-tab-'+tabs[next]).click();$('fc-tab-'+tabs[next]).focus();}});
    box.addEventListener('click',function(e){if(e.target.closest('.fc-daily-x')){D.closed=true;box.hidden=true;layout();schedule();}else if(e.target.closest('[data-daily-retry]'))fetchDaily();});
    document.addEventListener('visibilitychange',function(){schedule();});
    parent.addEventListener('wheel',function(e){
      if(e.ctrlKey||e.metaKey)return;
      var panel=e.target.closest('.fc-pin,.fc-tail,.fc-daily');if(!panel)return;
      var scroll=panel.querySelector('.fc-scroll');if(!scroll||scroll.scrollWidth<=scroll.clientWidth)return;
      var delta=Math.abs(e.deltaY)>=Math.abs(e.deltaX)?e.deltaY:e.deltaX;
      if(e.deltaMode===1)delta*=16;else if(e.deltaMode===2)delta*=scroll.clientWidth;
      if(delta){e.preventDefault();scroll.scrollLeft+=delta;}
    },{passive:false});
  }
  function layout(){
    var box=$('fc-daily'),mobile=$('fc-mobile'),near=$('fc-pin'),tail=$('fc-tail');if(!box||!near)return;
    var root=$('fmap').parentNode;
    if(phone()){
      ids.forEach(function(id,i){var el=$(id);if(el.parentNode!==mobile)mobile.appendChild(el);el.setAttribute('role','tabpanel');el.setAttribute('aria-labelledby','fc-tab-'+tabs[i]);el.setAttribute('aria-hidden',D.tab!==tabs[i]?'true':'false');});
      mobile.dataset.active=D.tab;mobile.hidden=!D.key;mobile.querySelector('.fc-mobile-location').textContent=(D.name||'').replace(/격자 \d+,\d+/g,'선택 격자');
      tabs.forEach(function(t){var b=$('fc-tab-'+t);b.setAttribute('aria-selected',D.tab===t?'true':'false');b.tabIndex=D.tab===t?0:-1;});
      box.hidden=!D.key;var phoneInner=box.querySelector('.fc-pin-in');if(phoneInner)phoneInner.style.zoom='';
    }else{
      mobile.hidden=true;ids.forEach(function(id){var el=$(id);if(el.parentNode!==root)root.appendChild(el);el.removeAttribute('role');el.removeAttribute('aria-hidden');el.removeAttribute('aria-labelledby');});
      box.hidden=!D.key||D.closed;if(box.hidden)return;
      if(D.geo.scale==null)D.geo.scale=window.ForecastUI.pinDefault;      // 기본 배율은 ui.js 한 곳에만
      var state=window.ForecastUI._state(),panels=ids.map(function(id,i){return{el:$(id),geo:[state.pinGeo,state.tailGeo,D.geo][i]};}).filter(function(p){return !p.el.hidden&&p.el.querySelector('.fc-pin-in');});
      var total=0,overhead=0;      // geo.w = 가로로 늘린 표 폭(배율 1 기준, 2026-11-09)
      panels.forEach(function(p){p.el.style.maxHeight='none';p.el.style.bottom='auto';p.inner=p.el.querySelector('.fc-pin-in');p.inner.style.zoom=p.geo.scale;p.inner.style.width=p.geo.w?p.geo.w+'px':'';total+=p.el.offsetHeight;overhead+=p.el.offsetHeight-p.inner.getBoundingClientRect().height;});
      var legend=$('fc-legend'),room=root.clientHeight-20-(legend?legend.offsetHeight:0)-Math.max(0,panels.length-1)*8;
      var factor=Math.min(1,Math.max(0.1,(room-overhead-2)/Math.max(1,total-overhead))),top=10;
      // 2026-11-09: 창 기본 배율 1.2 — 폭도 지도 왼쪽 여유(최대 160px)를 남기게, 줄 높이 반올림으로 넘치면 한 번 더 줄임
      var wide=Math.max.apply(null,panels.map(function(p){return p.el.offsetWidth;}).concat([1])),wroom=root.clientWidth-Math.min(160,root.clientWidth*0.25)-14;
      factor=Math.min(factor,Math.max(0.1,wroom/Math.max(1,wide-14)));      // ui.js applyBoxGeo 와 같은 폭 기준
      for(var pass=0;pass<3;pass++){
        var used=0;panels.forEach(function(p){p.inner.style.zoom=p.geo.scale*factor;used+=p.el.offsetHeight;});
        if(used<=room-2)break;factor*=Math.max(0.5,(room-2-overhead)/Math.max(1,used-overhead));
      }
      panels.forEach(function(p){p.inner.style.zoom=p.geo.scale*factor;
        if(p.geo.x==null){p.el.style.left='auto';p.el.style.right='10px';p.el.style.top=top+'px';}
        else{p.el.style.left=Math.max(0,Math.min(p.geo.x,root.clientWidth-p.el.offsetWidth))+'px';p.el.style.right='auto';p.el.style.top=Math.max(0,Math.min(p.geo.y,root.clientHeight-p.el.offsetHeight-10))+'px';}
        top+=p.el.offsetHeight+8;
      });
    }
  }
  function render(){
    var box=$('fc-daily');if(!box)return;var scroll=box.querySelector('.fc-scroll'),left=scroll?scroll.scrollLeft:0;
    box.innerHTML='<button type="button" class="fc-reset" aria-label="처음 크기·위치로">원래대로</button><button type="button" class="fc-x fc-daily-x" aria-label="일별 예보 닫기">×</button><div class="fc-pin-in"><div class="fc-daily-body">'+
      (D.data?table(D.data)+(D.error?'<p class="fc-daily-source">갱신 지연 <button type="button" data-daily-retry>다시 받기</button></p>':''):D.error?'<p>일별 예보를 불러오지 못했습니다. <button type="button" data-daily-retry>다시 받기</button></p>':'<p role="status">일별 예보를 불러오는 중…</p>')+
      '</div></div><span class="fc-pin-edge l" data-edge="l" aria-hidden="true"></span><span class="fc-pin-edge r" data-edge="r" aria-hidden="true"></span><span class="fc-pin-grip l" data-grip="l" aria-hidden="true"></span><span class="fc-pin-grip r" data-grip="r" aria-hidden="true"></span>';
    layout();scroll=box.querySelector('.fc-scroll');if(scroll)scroll.scrollLeft=left;
  }
  function sync(key,name,selection){
    ensure();if(!$('fc-daily'))return;
    if(D.key!==key||D.selection!==selection){var hit=key&&D.cache[key];D.key=key;D.selection=selection;D.seq++;D.data=hit?hit.data:null;D.ver=hit?hit.d:null;D.error=false;D.closed=false;D.tab='hourly';D.name=name;clearTimeout(D.timer);render();if(key){if(hit)check();else fetchDaily();}}
    layout();
  }
  window.addEventListener('resize',function(){layout();if(visible()&&!D.data)fetchDaily();schedule();});
  window.ForecastDaily={sync:sync,layout:layout,geo:function(){if(D.geo.scale==null)D.geo.scale=window.ForecastUI.pinDefault;return D.geo;},table:table,icon:icon};
})();
