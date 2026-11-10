/* 첫 화면 시작: 로그인 잠금 → 자료 불러오기 → 화면 그리기, 그리고 맨 위 페이지 전환(강설량 측정 / 장비 지원).
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
      var fc = /^#fc=(B\d{3})$/.exec(location.hash); if (fc) window.SSOpenForecast(fc[1]);      // 장비 지원에서 따로 열린 경우(#fc=지사번호)
      else {
        var openSnow = function(){ var ft = document.querySelector('.tab-btn[data-tab=forecast]'); if (ft) ft.click(); };   // 강설량 측정의 첫 탭 = 기관별 24시간 예보
        if (document.getElementById('shell').dataset.page === 'equip') window.SSSnowPending = openSnow;   // 장비 지원을 보는 중이면 강설량 측정을 처음 열 때(지도는 화면이 보일 때 그려야 함, 자료도 그때 받음)
        else openSnow();
      }
      var can = function(p){ return !!(window.SS_CAN && window.SS_CAN(p)); };
      if (can('log.view')) { var elb = document.getElementById('eqLogBtn'); if (elb) elb.hidden = false; }   // 왼쪽 메뉴 '로그 기록': 장비 화면과 같은 권한(log.view)
      // 지사가 올린 구간 변경 요청이 있으면 알림창·탭 표시 (요청을 승인할 수 있는 juris.edit 권한)
      if (can('juris.edit') && window.JurisRequests){ JurisRequests.startAdminWatch({
          nameOf: function(id){ var b = (window.JURIS.doc.branches || []).filter(function(x){ return x.id === id; })[0]; return b ? b.name + ' 지사' : id; },
          onOpen: function(){ var t = document.querySelector('.tab-btn[data-tab=jurisdiction]'); if (t) t.click(); setTimeout(function(){ if (window.JurisdictionUI) JurisdictionUI.openRequests(); }, 350); },
          onList: function(){ if (window.JurisdictionUI && window.JurisdictionUI._state().inited) JurisdictionUI.refreshRequests(); }
        }); }
      // 특보구역 요청(2026-11-10 사용자, 마이그레이션 92): 관리자가 로그인하면 처리를 기다리는 요청 알림창 → [지금 보기] = 장비 지원 · 지사별 요청/편성의 특보구역 관리 창
      zoneNotice();
      if (canGrid) {
        document.getElementById('tabGridBtn').style.display = '';                       // 예보 격자 편입: grid.edit 권한 계정에만 탭을 보여 줌
        if(window.GridUI){ GridUI.init(); }
      } else {
        var gv = document.getElementById('view-grid'); if (gv && gv.parentNode) gv.parentNode.removeChild(gv);          // 권한이 없으면 화면 자체를 없앰
        var gb = document.getElementById('tabGridBtn'); if (gb && gb.parentNode) gb.parentNode.removeChild(gb);
      }
      // 사용법 안내(guide/guide.js): 위쪽 [사용법] 버튼 + 이 브라우저·아이디로 처음이면 지금 페이지 안내(장비 지원에서 따로 연 예보 창은 빼고)
      if (window.SSGuide) { SSGuide.init(); if (!fc) SSGuide.auto(document.getElementById('shell').dataset.page); }
    };
    document.body.appendChild(s);
  }).catch(function(err){
    var box = document.createElement('div'); box.style.cssText = 'padding:40px;font-family:sans-serif;';
    box.textContent = '자료를 불러오지 못했습니다. 새로고침(F5)해 보세요. 계속되면 관리자에게 알려 주세요. (' + (err && err.message || err) + ')';
    document.body.innerHTML = ''; document.body.appendChild(box);
  });
  }
  function zoneNotice(){
    if (!window.SSAuth || !SSAuth.authed) return;
    SSAuth.authed('/rest/v1/rpc/zone_request_list', { method: 'POST', body: {} }).then(function(r){
      var rows = r && r.ok && Array.isArray(r.json) ? r.json.filter(function(q){ return !q.mine; }) : [];      // 관리자만 남의 요청을 받음
      if (!rows.length) return;
      var top = rows.reduce(function(m, q){ return Math.max(m, q.id); }, 0), seen = 0;
      try { seen = parseInt(sessionStorage.getItem('ss_zone_seen') || '0', 10) || 0; } catch(e){}
      if (top <= seen) return;                                                        // 같은 로그인에서 이미 본 요청은 다시 안 띄움
      try { sessionStorage.setItem('ss_zone_seen', String(top)); } catch(e){}
      var names = {}; ((window.JURIS && window.JURIS.doc && window.JURIS.doc.branches) || []).forEach(function(b){ names[b.id] = b.name; });
      var esc = function(t){ return String(t == null ? '' : t).replace(/[&<>"']/g, function(c){ return '&#' + c.charCodeAt(0) + ';'; }); };
      var old = document.getElementById('zoneNotice'); if (old) old.remove();
      var m = document.createElement('div'); m.id = 'zoneNotice'; m.className = 'jr-notice'; m.setAttribute('role', 'alertdialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'zoneNoticeT');
      m.innerHTML = '<div class="jr-notice-card"><div class="jr-notice-ico" aria-hidden="true">🔔</div><h3 id="zoneNoticeT">특보구역 요청이 있습니다</h3>' +
        '<p>처리를 기다리는 요청이 <b>' + rows.length + '건</b> 있습니다.</p><ul>' + rows.slice(0, 8).map(function(q){
          return '<li><b>' + esc((names[q.branch_id] || q.branch_id) + ' 지사') + '</b> ' + esc(q.zone_name) + ' ' + (q.action === 'add' ? '더하기' : '빼기') + '</li>'; }).join('') +
        (rows.length > 8 ? '<li>… 외 ' + (rows.length - 8) + '건</li>' : '') + '</ul>' +
        '<div class="jr-notice-btns"><button type="button" class="jr-btn jr-primary" id="zoneNoticeGo">지금 보기</button><button type="button" class="jr-btn" id="zoneNoticeLater">나중에</button></div></div>';
      document.body.appendChild(m);
      var close = function(){ var x = document.getElementById('zoneNotice'); if (x) x.remove(); };
      document.getElementById('zoneNoticeGo').focus();
      document.getElementById('zoneNoticeLater').onclick = close;
      m.addEventListener('keydown', function(e){ if (e.key === 'Escape') close(); });
      document.getElementById('zoneNoticeGo').onclick = function(){
        close();
        var b = document.querySelector('.eq-btn[data-eqtab=branch]'); if (b) b.click();            // 장비 지원 · 지사별 요청/편성
        var frame = document.getElementById('equipFrame'), tries = 0, bid = rows[0].branch_id;
        (function wait(){ var w = null; try { w = frame.contentWindow; } catch(e){}
          if (w && w.SSOpenZones && w.SSOpenZones(bid)) return;                             // 안쪽 화면이 준비되면 특보구역 관리 창을 엶
          if (++tries < 80) setTimeout(wait, 250); })();
      };
    }).catch(function(){});
  }
  // 로그인 뒤 첫 화면 = 장비 지원(2026-11-03 사용자 요청, index.html 의 data-first). 장비 지원을 먼저 보여 주고 강설량 측정 자료는 뒤에서 읽음. #fc= 로 열린 예보 창은 예외
  function bootFirst(profile){
    if (document.getElementById('shell').dataset.first === 'equip' && !/^#fc=/.test(location.hash)) setTimeout(function(){ if (window.SSShowPage) SSShowPage('equip'); }, 0);
    bootApp(profile);
  }
  SSGate.start({ onReady: bootFirst });
})();

/* 위쪽 메뉴(2026-10-10): 강설량 측정 / 장비 지원 전환 + 그 페이지의 메뉴 줄. 장비 지원은 안쪽 화면(iframe)이라 그 화면의 탭을 대신 눌러 줍니다.
   장비 지원은 처음 열 때 불러오고, 안쪽 화면에서는 자기 머리글·탭을 숨깁니다(equipment/index.html 의 embedded). */
(function(){
  var shell = document.getElementById('shell');
  var btns = document.querySelectorAll('.page-btn');
  var eqBtns = document.querySelectorAll('.eq-btn');
  var snow = document.getElementById('page-snow');
  var equip = document.getElementById('page-equip');
  var frame = document.getElementById('equipFrame');
  var theme = document.getElementById('snTheme');
  var eqTab = 'move';
  function frameDoc(){ try { return frame.getAttribute('src') && frame.contentDocument && frame.contentDocument.readyState !== 'loading' ? frame.contentDocument : null; } catch(e){ return null; } }
  function paintEq(){ eqBtns.forEach(function(b){ b.classList.toggle('active', b.dataset.eqtab === eqTab); }); }
  function paintTheme(){
    var d = frameDoc(); if (!d) return;
    var t = d.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';   // 장비 지원 기본 = 라이트(2026-11-01)
    theme.querySelectorAll('[data-eqtheme]').forEach(function(b){ b.setAttribute('aria-pressed', String(b.dataset.eqtheme === t)); });
  }
  function applyEqTab(){       // 안쪽 화면이 준비됐으면 그 탭을 누름(아직이면 불러온 뒤 load 에서)
    var d = frameDoc(); if (!d) return;
    var t = d.querySelector('.tab[data-tab="' + eqTab + '"]');
    if (t && !t.hidden && t.getAttribute('aria-selected') !== 'true') t.click();
  }
  function show(name){
    if(name === 'equip' && !document.body.classList.contains('authed')) return;      // 장비 지원은 로그인한 뒤에만(로그인 전에 열면 '로그인 필요'가 남음)
    btns.forEach(function(b){ b.classList.toggle('active', b.dataset.page === name); });
    shell.dataset.page = name;
    snow.style.display = (name === 'snow') ? '' : 'none';
    equip.style.display = (name === 'equip') ? 'block' : 'none';
    theme.hidden = name !== 'equip';
    if(name === 'equip' && !frame.getAttribute('src')){ frame.setAttribute('src', frame.dataset.src); }
    if(name === 'equip'){ paintEq(); applyEqTab(); paintTheme(); if (window.SSGuide) SSGuide.auto('equip'); }   // 장비 지원을 처음 열면 그 페이지 사용법(지원 과정 그림)
    if(name === 'snow'){
      if (window.SSSnowPending) { var open1 = window.SSSnowPending; window.SSSnowPending = null; open1(); }        // 장비 지원부터 열었으면 이때 첫 탭을 엶
      if (window.SSGuide) SSGuide.auto('snow');
      setTimeout(function(){ window.dispatchEvent(new Event('resize')); }, 50);                                   // 지도 크기 다시 맞춤
    }
  }
  /* 뒤로가기 = 이전 탭(2026-11-02 사용자 요청). 사람이 누른 탭 바꾸기(위쪽 강설량 측정/장비 지원, 강설량 측정 탭, 장비 지원 탭)마다
     브라우저 기록에 한 칸을 남기고, 뒤로가기(popstate)가 오면 그 칸의 화면·탭으로 되돌림. 코드가 대신 누른 클릭(isTrusted=false)은 남기지 않음 */
  var navLock = false;
  function snowTab(){ var a = document.querySelector('.tab-btn.active'); return a ? a.dataset.tab : null; }
  function navState(){ return { ss: 1, sp: shell.dataset.page || 'snow', st: snowTab(), et: eqTab }; }
  function sameNav(a, b){ return !!a && !!b && a.sp === b.sp && a.st === b.st && (a.sp !== 'equip' || a.et === b.et); }
  function pushNav(){
    if (navLock) return;
    var s = navState(); if (sameNav(history.state, s)) return;
    try{ history.pushState(s, '', s.sp === 'equip' ? '#equip' : location.pathname + location.search); }catch(e){}
  }
  window.addEventListener('popstate', function(e){
    var s = e.state && e.state.ss ? e.state : (e.state && e.state.ssSheet ? null : shell.dataset.first === 'equip' ? { sp: 'equip', et: 'move' } : { sp: 'snow', st: 'forecast' });   // 처음 칸(기록 없음) = 첫 화면
    if (!s) return;
    navLock = true;
    try{
      if (s.sp === 'equip' && document.body.classList.contains('authed')) { eqTab = s.et || 'move'; show('equip'); }
      else { show('snow'); var t = s.st && document.querySelector('.tab-btn[data-tab="' + s.st + '"]'); if (t && !t.classList.contains('active')) t.click(); }
    } finally { navLock = false; }
  });
  btns.forEach(function(b){ b.addEventListener('click', function(e){ show(b.dataset.page); if (e.isTrusted) pushNav(); }); });
  // 강설량 측정 메뉴: 화면 바꾸기는 app.js 가, 여기서는 그 페이지를 보여 주기만
  // 탭 바꾸기(app.js 의 switchTab)가 이 다음에 돌 수도 있어 기록은 한 박자 뒤에(바뀐 탭으로 남도록)
  document.querySelectorAll('.tab-btn').forEach(function(b){ b.addEventListener('click', function(e){ if (shell.dataset.page !== 'snow') show('snow'); if (e.isTrusted) setTimeout(pushNav, 0); }); });
  eqBtns.forEach(function(b){ b.addEventListener('click', function(e){ eqTab = b.dataset.eqtab; show('equip'); if (e.isTrusted) pushNav(); }); });
  frame.addEventListener('load', function(){ applyEqTab(); paintTheme(); });
  // 안쪽 화면이 스스로 탭을 바꾼 경우(권한이 바뀌어 이동 현황으로 돌아가는 등) 메뉴도 따라감
  window.SSEqTabChanged = function(name){ eqTab = name; paintEq(); };
  // 새로고침(2026-11-02): 장비 지원 메뉴 줄 오른쪽 버튼 → 안쪽 화면이 다시 읽음. 안쪽 화면이 '불러오는 중'·'○○:○○ 불러옴'을 알려 줌
  var rlBtn = document.getElementById('eqReload'), rlAt = document.getElementById('eqReloadAt');
  var rlBtns = [rlBtn, document.getElementById('snReload')].filter(Boolean);          // 넓은 화면 = 탭 줄, 휴대폰 = 머리글(탭을 가리지 않게, 2026-11-02)
  rlBtns.forEach(function(b){ b.addEventListener('click', function(){ var w = null; try { w = frame.contentWindow; } catch(e){} if (w && w.SSEqReload) w.SSEqReload(); }); });
  window.SSEqReloadState = function(busy, at){ rlBtns.forEach(function(b){ b.disabled = !!busy; b.textContent = busy ? '불러오는 중…' : '새로고침'; }); if (rlAt) rlAt.textContent = at || ''; };
  // 휴대폰 머리글 접고 펴기(2026-11-03): 화면·사용법·계정 줄. 처음엔 접힘
  var tnMore = document.getElementById('tnMore');
  if (tnMore) tnMore.addEventListener('click', function(){
    var row = tnMore.closest('.tn-row'), on = row.classList.toggle('more-open');
    tnMore.setAttribute('aria-expanded', String(on)); tnMore.setAttribute('aria-label', '화면·계정 메뉴 ' + (on ? '접기' : '펴기')); tnMore.textContent = on ? '▴' : '▾';
  });
  // 기준일자(2026-11-03 사용자 요청): 탭을 바꿔도 늘 보이게 위쪽 메뉴에. 목록·권한은 안쪽 화면이 알려 주고(SSEqRound), 고르기·삭제·만들기는 안쪽 화면이 함(SSEqRoundAct)
  var rdBoxes = [document.getElementById('eqRoundWide'), document.getElementById('eqRoundRow')].filter(Boolean), rdKey = '', rdS = null, rdOpen = false;
  function rdEsc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function rdPaint(){
    if (!rdS) return;
    var key = JSON.stringify([rdS, rdOpen]); if (key === rdKey) return; rdKey = key;      // 안쪽 화면은 자주 다시 그리므로 바뀔 때만(날짜를 넣는 중에 지워지지 않게)
    var opts = rdS.rounds.length ? rdS.rounds.map(function(r){ return '<option value="' + rdEsc(r.id) + '"' + (r.id === rdS.round ? ' selected' : '') + '>' + rdEsc(r.label) + '</option>'; }).join('') : '<option value="">(없음)</option>';
    var html = '<label class="eq-round-lab">기준일자 <select class="eq-round-sel" data-rd="sel" aria-label="기준일자">' + opts + '</select></label>' + (rdS.canEdit
      ? '<button type="button" class="eq-round-more" data-rd="more" aria-expanded="' + rdOpen + '" aria-label="기준일자 삭제·만들기 ' + (rdOpen ? '닫기' : '열기') + '">' + (rdOpen ? '−' : '+') + '</button>' +
        '<span class="eq-round-tools">' + (rdS.round ? '<button type="button" data-rd="del">삭제</button>' : '') +
        '<label>새 기준일자 <input type="date" data-rd="date" value="' + rdEsc(rdS.def) + '" min="' + rdEsc(rdS.min) + '"></label><button type="button" data-rd="make">만들기</button></span>' : '');
    rdBoxes.forEach(function(b){ b.innerHTML = html; b.hidden = false; b.classList.toggle('open', rdOpen && !!rdS.canEdit); });
  }
  function rdAct(act, v){ var w = null; try { w = frame.contentWindow; } catch(e){} if (w && w.SSEqRoundAct) w.SSEqRoundAct(act, v); }
  window.SSEqRound = function(st){ rdS = st; if (!st.canEdit) rdOpen = false; rdPaint(); };
  rdBoxes.forEach(function(b){
    b.addEventListener('change', function(e){ if (e.target.dataset.rd === 'sel') rdAct('select', e.target.value); });
    b.addEventListener('click', function(e){
      var t = e.target.closest ? e.target.closest('button[data-rd]') : null; if (!t) return;
      if (t.dataset.rd === 'more') { rdOpen = !rdOpen; rdPaint(); return; }
      if (t.dataset.rd === 'del') { rdAct('del'); return; }
      var d = b.querySelector('[data-rd="date"]'); rdAct('make', d ? d.value : '');
    });
  });
  // '강원본부 지원장비' 메뉴: 관리자·강원본부 계정만(안쪽 장비 화면이 권한을 확인해 알려 줌, 2026-10-30)
  window.SSEqTeamTab = function(on){ var b = document.getElementById('eqTeamBtn'); if (b) b.hidden = !on; if (!on && eqTab === 'gwteam') { eqTab = 'move'; paintEq(); } };
  theme.querySelectorAll('[data-eqtheme]').forEach(function(b){ b.addEventListener('click', function(){
    var d = frameDoc(); var t = d && d.querySelector('[data-theme-set="' + b.dataset.eqtheme + '"]'); if (t) t.click(); paintTheme();
  }); });
  // 장비 지원(안쪽 화면)의 예상 적설·강수를 누르면: 강설량 측정 → 기관별 24시간 예보 → 그 지사
  window.SSOpenForecast = function(id){
    show('snow');
    if(window.ForecastUI){ ForecastUI.openBranch(id); }
    var t = document.querySelector('.tab-btn[data-tab=forecast]'); if(t){ t.click(); }
    pushNav();                                     // 장비 지원에서 넘어왔으면 뒤로가기로 장비 지원에 돌아감
  };
  window.SSShowPage = show;
  // 새로 열거나 다시 로그인하면 항상 첫 화면(장비 지원)부터. 예전 주소의 #equip 은 지움
  if(location.hash === '#equip'){ try{ history.replaceState(null, '', location.pathname + location.search); }catch(e){} }
})();
