/* 첫 화면 시작: 로그인 잠금 → 자료 불러오기 → 화면 그리기, 그리고 위쪽 메뉴(탭 뒤로가기·휴대폰 계정 줄).
   2026-11-21 장비 지원 페이지를 없앰(사용자 결정) — 페이지 전환·장비 지원 메뉴·기준일자 칸·특보구역 요청 알림창도 지움. 보관 문서: docs/equipment-archive.md
   보안 정책(CSP) 때문에 HTML 안에 스크립트를 직접 쓰지 않고 이 파일로 뺐습니다. */
(function(){
  var META_DATE_TEXT = "수동 업로드";
  // 로그인하기 전에는 자료(data/*.json)도 화면도 불러오지 않습니다. 로그인에 성공하면 아래 bootApp 이 실행됩니다.
  function bootApp(){
  var canGrid = !!(window.SS_CAN && window.SS_CAN('grid.edit'));      // 예보 격자 편입 권한(관리자는 항상) — 로그인 잠금이 채움
  // cache:'no-cache' = 매번 서버에 '바뀌었나?'만 묻고, 그대로면 브라우저에 있던 파일을 씀(최신 반영은 그대로, 받는 양은 줄어듦)
  Promise.all([
    fetch('data/roads.json', {cache: 'no-cache'}).then(function(r){return r.json();}),
    fetch('data/hierarchy.json', {cache: 'no-cache'}).then(function(r){return r.json();}),
    SSSnow.load(),                                                         // 적설: 서버 요약본 한 줄(로그인한 사람만 읽을 수 있음)
    // 관할 구간(IC/JC 사이)·관측소 목록·변경 이력: 없어도 기존 화면은 그대로 동작
    fetch('data/sections.json', {cache: 'no-cache'}).then(function(r){return r.ok ? r.json() : null;}).catch(function(){return null;}),
    fetch('data/stations.json', {cache: 'no-cache'}).then(function(r){return r.ok ? r.json() : null;}).catch(function(){return null;}),
    // 변경 이력: 서버(Supabase)에서 읽습니다. 못 읽으면 예전 파일로 대신하고 화면에 알립니다.
    SSEvents.load('jurisdiction'),
    // 예보 격자 편입(기본 편입 + 저장된 변경): 없어도 기존 화면은 그대로 동작
    // 격자 권한이 있을 때만 불러옴: 예보 격자 편입 탭은 grid.edit 권한 계정에서만 보입니다
    canGrid ? Promise.all(['data/grid_assign.json','data/section_grid.json'].map(function(url){
      return fetch(url, {cache:'no-cache'}).then(function(r){if(!r.ok)throw new Error('grid');return r.json();});
    })).then(function(d){d[0].sectionCells=d[1].sections;return d[0];}).catch(function(){return null;}) : Promise.resolve(null),
    canGrid ? SSEvents.load('grid') : Promise.resolve({events: [], source: 'skip'})
  ]).then(function(results){
    window.ROADS_DATA = results[0];
    window.HIERARCHY = results[1];
    window.SNOW_DATA = results[2];
    window.META_DATE = META_DATE_TEXT;
    // 관할 변경 적용: 서버에 저장된 변경 이력(모든 사용자에게 같음). 예전 '이 브라우저에만 임시 적용' 기능은 저장이 바로 적용되므로 없앴습니다.
    var committed = (results[5] && results[5].events) || [];
    window.EVENTS_SOURCE = { jurisdiction: results[5].source + (results[5].error ? '-error' : ''), grid: results[7].source + (results[7].error ? '-error' : '') };
    window.GRID = { baseline: results[6], committed: results[7].events || [] };
    window.JURIS = { doc: results[3], stations: results[4], committed: committed, session: null };
    try { sessionStorage.removeItem('juris_session'); } catch(e){}
    // 서버에는 관측소별 원자료만 있으므로, 지사별 일별 값(그 지사 관측소들의 최댓값)은 여기서 관할에 맞춰 계산합니다.
    if(window.JURIS.doc && window.JurisCore){
      window.HIERARCHY_BASE = JSON.parse(JSON.stringify(window.HIERARCHY));       // 이벤트를 적용하기 전의 처음 지사 목록(저장 후 새로고침 없이 다시 적용할 때 씀)
      window.HIERARCHY = JurisCore.reapply(window.HIERARCHY_BASE, window.SNOW_DATA, window.JURIS.doc, window.JURIS.stations, committed).H;
    } else if(window.JurisCore){
      JurisCore.rebuildAllSeries(window.HIERARCHY, window.SNOW_DATA);
    }
    // 관할 변경을 저장하면 새로고침 없이 강설량·관측소 지도 화면까지 새 관할로 바꿉니다.
    window.reapplyJurisdiction = function(events){
      if(!window.JURIS.doc || !window.JurisCore || !window.HIERARCHY_BASE) return false;
      var r = JurisCore.reapply(window.HIERARCHY_BASE, window.SNOW_DATA, window.JURIS.doc, window.JURIS.stations, events);
      window.HIERARCHY = r.H;
      if(window.refreshHierarchyViews) window.refreshHierarchyViews();
      return true;
    };
    var s = document.createElement('script');
    s.src = 'app.js?v=' + Date.now();
    s.onload = function(){
      initApp(); if(window.JurisdictionUI){ JurisdictionUI.init(); }
      if(window.ForecastUI){ ForecastUI.init(); }
      var fc = /^#fc=(B\d{3})$/.exec(location.hash); if (fc) window.SSOpenForecast(fc[1]);      // 주소로 그 지사 예보 바로 열기(#fc=지사번호)
      else { var ft = document.querySelector('.tab-btn[data-tab=forecast]'); if (ft) ft.click(); }   // 첫 탭 = 기관별 24시간 예보
      var can = function(p){ return !!(window.SS_CAN && window.SS_CAN(p)); };
      // 지사가 올린 구간 변경 요청이 있으면 알림창·탭 표시 (요청을 승인할 수 있는 juris.edit 권한)
      if (can('juris.edit') && window.JurisRequests){ JurisRequests.startAdminWatch({
          nameOf: function(id){ var b = (window.JURIS.doc.branches || []).filter(function(x){ return x.id === id; })[0]; return b ? b.name + ' 지사' : id; },
          onOpen: function(){ var t = document.querySelector('.tab-btn[data-tab=jurisdiction]'); if (t) t.click(); setTimeout(function(){ if (window.JurisdictionUI) JurisdictionUI.openRequests(); }, 350); },
          onList: function(){ if (window.JurisdictionUI && window.JurisdictionUI._state().inited) JurisdictionUI.refreshRequests(); }
        }); }
      if (canGrid) {
        document.getElementById('tabGridBtn').style.display = '';                       // 예보 격자 편입: grid.edit 권한 계정에만 탭을 보여 줌
        if(window.GridUI){ GridUI.init(); }
      } else {
        var gv = document.getElementById('view-grid'); if (gv && gv.parentNode) gv.parentNode.removeChild(gv);          // 권한이 없으면 화면 자체를 없앰
        var gb = document.getElementById('tabGridBtn'); if (gb && gb.parentNode) gb.parentNode.removeChild(gb);
      }
      // 사용법 안내(guide/guide.js): 위쪽 [사용법] 버튼 + 이 브라우저·아이디로 처음이면 안내(#fc= 로 연 예보 창은 빼고)
      if (window.SSGuide) { SSGuide.init(); if (!fc) SSGuide.auto('snow'); }
    };
    document.body.appendChild(s);
  }).catch(function(err){
    var box = document.createElement('div'); box.style.cssText = 'padding:40px;font-family:sans-serif;';
    box.textContent = '자료를 불러오지 못했습니다. 새로고침(F5)해 보세요. 계속되면 관리자에게 알려 주세요. (' + (err && err.message || err) + ')';
    document.body.innerHTML = ''; document.body.appendChild(box);
  });
  }
  SSGate.start({ onReady: bootApp });
})();

/* 위쪽 메뉴: 탭 뒤로가기 기록, 휴대폰 계정 줄 접고 펴기, 지사 예보 바로 열기(SSOpenForecast).
   2026-11-21 장비 지원 페이지를 없애 페이지 전환(강설량 측정 / 장비 지원)·장비 지원 메뉴·기준일자 칸·장비 창 뒤로가기는 지움 */
(function(){
  /* 뒤로가기 = 이전 탭(2026-11-02 사용자 요청). 사람이 누른 탭 바꾸기마다 브라우저 기록에 한 칸을 남기고,
     뒤로가기(popstate)가 오면 그 칸의 탭으로 되돌림. 코드가 대신 누른 클릭(isTrusted=false)은 남기지 않음 */
  var navLock = false;
  function snowTab(){ var a = document.querySelector('.tab-btn.active'); return a ? a.dataset.tab : null; }
  function pushNav(){
    if (navLock) return;
    var s = { ss: 1, sp: 'snow', st: snowTab() };
    if (history.state && history.state.ss && history.state.st === s.st) return;
    try{ history.pushState(s, '', location.pathname + location.search); }catch(e){}
  }
  window.addEventListener('popstate', function(e){
    var s = e.state && e.state.ss ? e.state : { st: 'forecast' };                 // 처음 칸(기록 없음) = 첫 탭
    navLock = true;
    try{ var t = s.st && document.querySelector('.tab-btn[data-tab="' + s.st + '"]'); if (t && !t.classList.contains('active')) t.click(); }
    finally { navLock = false; }
  });
  // 탭 바꾸기(app.js 의 switchTab)가 이 다음에 돌 수도 있어 기록은 한 박자 뒤에(바뀐 탭으로 남도록)
  document.querySelectorAll('.tab-btn').forEach(function(b){ b.addEventListener('click', function(e){ if (e.isTrusted) setTimeout(pushNav, 0); }); });
  // 휴대폰 머리글 접고 펴기(2026-11-03): 사용법·계정 줄. 처음엔 접힘
  var tnMore = document.getElementById('tnMore');
  if (tnMore) tnMore.addEventListener('click', function(){
    var row = tnMore.closest('.tn-row'), on = row.classList.toggle('more-open');
    tnMore.setAttribute('aria-expanded', String(on)); tnMore.setAttribute('aria-label', '계정 메뉴 ' + (on ? '접기' : '펴기')); tnMore.textContent = on ? '▴' : '▾';
  });
  // 그 지사의 기관별 24시간 예보 열기(#fc=지사번호 주소, 시험)
  window.SSOpenForecast = function(id){
    if(window.ForecastUI){ ForecastUI.openBranch(id); }
    var t = document.querySelector('.tab-btn[data-tab=forecast]'); if(t){ t.click(); }
    pushNav();
  };
  // 예전 주소의 #equip 은 지움
  if(location.hash === '#equip'){ try{ history.replaceState(null, '', location.pathname + location.search); }catch(e){} }
})();
