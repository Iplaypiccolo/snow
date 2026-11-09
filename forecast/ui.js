/* ============================================================
   forecast/ui.js — "기관별 예보" 탭
   - 기상청 단기예보(5km 격자)의 24시간 예상 적설(cm)·강수량(mm) 합과 최저기온(℃, 그 시각)을 지사 관할 노선도 위에 보여 줍니다.
     값은 서버가 매시 정각에 "다음 정시부터 24시간"으로 다시 계산한 격자별 값(forecast_cells)입니다(예보 자료는 3시간마다 새로 받음).
   - 단계: 전체 = 고속도로 노선만(본부 색) / 본부 = 그 본부 지사들의 격자(지사 색) / 지사 = 그 지사 격자마다 적설·강수·최저기온,
     격자에 마우스를 올리면 24시간 추이(적설·강수 막대, 기온 선 — 따로 세 그림). 격자를 누르면 그 그림이 지도 오른쪽 위에 고정되고
     그림에 마우스를 올리면 세로·가로 보조선과 "몇 시 · 값". 지도 아무 데나 누르면 닫힘. 추이는 지사를 열 때만 서버에서 받음
   - 장비 지원의 지사별 요청·편성에서 예상 적설·강수를 누르면 이 탭의 그 지사로 바로 옵니다(window.ForecastUI.openBranch).
   - 격자는 번호 대신 지명(시군구 읍면동, data/grid_names.json — tools/build_grid_names.py 가 만듦)으로 보이고 번호는 작게 곁들임
   - 값(2026-11-04, 마이그레이션 67): 앞 6시간 = 초단기예보(10분마다, 강수·확률·기온. 신적설은 모든 시각 단기예보), 나머지 시각 = 단기예보.
     서버가 섞어 저장하므로 지사별 요청·편성·확정 값과 같음. 고정 창 표에서 초단기 시각은 색칠(series.vn). 전환 버튼·'발표 기준' 문구는 없앰
   - 격자를 누르면 뜨는 창(컴퓨터 화면만): 제목 줄을 끌어 옮기고, 아래쪽 모서리를 끌어 크기를 바꿈(글자도 같은 비율). 다른 격자를 눌러도 그대로이고 이 브라우저에 기억
   - 서버 읽기: branch_forecast(지사 59줄) 한 번 + 본부를 열 때 forecast_grid(그 본부 지사들의 격자, 수 KB) + 지사를 열 때 그 지사 추이(약 10KB)
   - 격자 창(2026-11-09, 마이그레이션 83): 격자 자료(forecast_cell_detail, 약 11KB)는 처음 한 번 받아 격자별로 기억하고, 열려 있는 동안
     10분(받는 중이면 3분)마다 forecast_version(약 0.1KB)으로 바뀌었는지만 확인 → 바뀐 때만 다시 받음. 확인이 실패하면 예전처럼 다시 받음
   ============================================================ */
(function () {
  'use strict';
  var G = window.GridCore, JC = window.JurisCore;
  var S = { tailCache: {}, inited: false, map: null, lines: null, cells: null, hq: 'ALL', focus: null, state: null, bf: {}, grid: {}, series: {}, pin: null, pinAt: 0, names: null, meta: null, loading: false, pendingFocus: null, pinGeo: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function p2(n) { return String(n).padStart(2, '0'); }
  function kstDateLabel(iso) { var d=new Date(Date.parse(iso)+9*3600e3); return isNaN(d)?'-':(d.getUTCMonth()+1)+'/'+d.getUTCDate()+'('+ '일월화수목금토'[d.getUTCDay()]+')'; }
  function fmtHour(iso) { var d = new Date(Date.parse(iso)+9*3600e3); return isNaN(d) ? '-' : kstDateLabel(iso) + ' ' + p2(d.getUTCHours()) + '시'; }
  function num(v) { return v == null ? '-' : String(Math.round(v)); }                             // 적설·강수(2026-11-04): 기상청 격자 값은 정수로만 옴 → 소수점 없이
  // 범위(마이그레이션 62): '1mm·1cm 미만' 시각마다 위쪽 +1 → '0~3', 한 시각뿐이면 '~1'. hi 가 없으면(예전 자료) 아래쪽만
  function rng(lo, hi) { if (lo == null) return '-'; var a = Math.round(lo), b = hi == null ? a : Math.round(hi); return b > a ? (a === 0 && b === 1 ? '~1' : a + '~' + b) : String(a); }
  function tmp(v) { return v == null ? '-' : String(Math.round(v * 10) / 10); }                 // 기온(℃): -5, 1.5
  function pct(v) { return v == null ? '-' : String(Math.round(v)); }                             // 강수확률(%): 60
  function hh(iso) { var d = iso ? new Date(iso) : null; return d && !isNaN(d) ? p2(d.getHours()) + '시' : '-'; }
  var STALE = 12 * 3600e3;                                 // 발표 후 12시간이 지난 예보는 쓰지 않음(장비 지원 화면과 같음)
  // 24시간 예상 적설(cm) → 칸 색
  var SCALE = [[20, '#c0392b', '20+'], [10, '#8e44ad', '10+'], [5, '#2e5fb8', '5+'], [1, '#5b9be0', '1+'], [0.1, '#a9cdf2', '<1'], [0, '#eef3f8', '0']];
  function snowColor(v) { if (v == null) return '#d8d6cc'; for (var i = 0; i < SCALE.length; i++) if (v >= SCALE[i][0]) return SCALE[i][1]; return '#eef3f8'; }

  // 지도 칸에 보일 값 — 범례의 체크박스(2026-10-10). 기본 = 적설·기온. 이 브라우저에 기억(localStorage)
  var SHOW_KEY = 'ss_fc_show', SHOW_ITEMS = [['s', '적설'], ['p', '강수'], ['o', '최대<br>확률'], ['t', '최저<br>기온']];      // 이름에 <br> = 두 줄(2026-11-09 사용자)
  function loadShow() {
    var d = { s: true, p: false, o: false, t: true };
    try { var j = JSON.parse(localStorage.getItem(SHOW_KEY) || 'null'); if (j && typeof j === 'object') SHOW_ITEMS.forEach(function (x) { if (typeof j[x[0]] === 'boolean') d[x[0]] = j[x[0]]; }); } catch (e) {}
    return d;
  }
  function saveShow() { try { localStorage.setItem(SHOW_KEY, JSON.stringify(S.show)); } catch (e) {} }
  // 지금 축척에서 격자 한 칸의 화면 크기(px) → 칸에 들어가는 줄 수(0 = 글자 없이 색만)
  function cellPx() {
    var g = S.grid[S.hq]; if (!S.map || !g || !g.cells || !g.cells.length) return 0;
    var k = G.cellCorners(g.cells[0][0], g.cells[0][1]), a = S.map.latLngToLayerPoint(L.latLng(k[0])), b = S.map.latLngToLayerPoint(L.latLng(k[2]));
    return Math.min(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }
  function fitLines(px) { return px < 34 ? 0 : Math.max(1, Math.min(4, Math.floor((px - 10) / 15))); }

  function st() { return S.state; }
  function bname(id) { var b = st().branches[id]; return b ? b.name : id; }
  function hqOf(id) { var b = st().branches[id]; return b ? b.hq : null; }
  function branchesOf(hq) { return st().order.filter(function (id) { return st().branches[id].hq === hq; }); }
  // 격자 지명(없으면 '격자 번호'). 번호는 작게 곁들일 때 cellNo
  function cellName(nx, ny) { var n = S.names && S.names[nx + ',' + ny]; return n || '격자 ' + nx + ',' + ny; }
  function cellNo(nx, ny) { return S.names && S.names[nx + ',' + ny] ? ' <small class="fc-no">' + nx + ',' + ny + '</small>' : ''; }
  function loadNames() {
    if (S.names) return Promise.resolve(S.names);
    return fetch('data/grid_names.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
      .then(function (m) { S.names = m || {}; return S.names; });
  }
  function bval(id) { var f = S.bf[id]; if (!f || Date.now() - Date.parse(f.issued_at) > STALE) return null; return f; }

  /* ---------- 뼈대 ---------- */
  // 2026-11-09 사용자: 왼쪽 기관별 예보 목록을 접었다 폈다(이 브라우저에서 기억)
  var SIDE_KEY = 'ss_fc_side';
  function sideFolded() { try { return localStorage.getItem(SIDE_KEY) === 'fold'; } catch (e) { return false; } }
  function toggleSide() {
    var side = document.querySelector('#view-forecast .jr-side'), btn = side && side.querySelector('.fc-side-tog'); if (!side) return;
    var fold = !side.classList.contains('fold'); side.classList.toggle('fold', fold);
    btn.textContent = fold ? '▶' : '◀'; btn.setAttribute('aria-expanded', String(!fold));
    try { localStorage.setItem(SIDE_KEY, fold ? 'fold' : 'open'); } catch (e) {}
    if (S.map) S.map.invalidateSize({ pan: false });
    applyPinGeo();
  }
  function buildShell() {
    $('view-forecast').innerHTML =
      '<div class="jr-wrap">' +
      '<div class="jr-side' + (sideFolded() ? ' fold' : '') + '">' +
        '<div class="jr-head"><b>기관별 예보</b><button type="button" class="fc-side-tog" aria-expanded="' + !sideFolded() + '" aria-label="기관별 예보 목록 접기·펴기">' + (sideFolded() ? '▶' : '◀') + '</button></div>' +
        '<div id="fc-meta" class="fc-meta"></div>' +
        '<div id="fc-tree" class="jr-tree"></div>' +
      '</div>' +
      '<div class="jr-mapbox"><div id="fmap"></div><div id="fc-pin" class="fc-pin" hidden></div><div id="fc-tail" class="fc-tail" hidden></div>' +
        '<div class="jr-legend fc-legend" id="fc-legend"></div>' +
      '</div></div>';
  }

  /* ---------- 서버 ---------- */
  function loadOverview() {
    return SSAuth.rest('branch_forecast?select=*').then(function (r) {
      S.bf = {}; if (!r.ok) return;
      r.json.forEach(function (x) { S.bf[x.branch_id] = x; });
      var latest = r.json.reduce(function (a, x) { return !a || x.issued_at > a.issued_at ? x : a; }, null);
      S.meta = latest ? { tmfc: latest.issued_at, start: latest.detail && latest.detail.start_at, end: latest.detail && latest.detail.end_at } : null;
    }).catch(function () {});
  }
  function loadGrid(hq) {
    if (S.grid[hq]) return Promise.resolve(S.grid[hq]);
    var ids = st().order.filter(function (id) { return st().branches[id].hq === hq && !JC.isPrivate(hq); });
    if (!ids.length) return Promise.resolve(null);
    return SSAuth.authed('/rest/v1/rpc/forecast_grid', { method: 'POST', body: { p_branches: ids } }).then(function (r) {
      if (!r.ok || !r.json) return null;
      S.grid[hq] = r.json; return r.json;
    }).catch(function () { return null; });
  }
  // 지사 하나의 격자별 24시간 추이 { "nx,ny": {s:[24], p:[24], t:[24]} }
  function loadSeries(id) {
    if (S.series[id]) return Promise.resolve(S.series[id]);
    return SSAuth.authed('/rest/v1/rpc/forecast_grid', { method: 'POST', body: { p_branches: [id], p_series: true } }).then(function (r) {
      if (!r.ok || !r.json || !r.json.cells) return null;
      var m = {}; r.json.cells.forEach(function (c) { if (c[7]) m[c[0] + ',' + c[1]] = c[7]; });
      m._start = r.json.start_at; S.series[id] = m; return m;
    }).catch(function () { return null; });
  }
  // 시각별 표(그림 대신) — 값(start 의 정시부터 1시간씩). s = 적설(cm), p = 강수(mm), t = 기온(℃)
  //  · 마우스 말풍선: 3시간 창과 같은 칸(threeRows)  · 1시간 창: 1시간 단위 한 줄 가로 스크롤
  function hourAt(start, i) { var d = start ? new Date(Date.parse(start) + i * 3600e3) : null; return d && !isNaN(d) ? d : null; }
  function hourLabel(start, i) { var d = hourAt(start, i); return d ? p2(d.getHours()) + '시' : ''; }
  function cellPop(v) { return v == null ? '<td class="z">-</td>' : v === 0 ? '<td class="z">0</td>' : '<td class="v">' + pct(v) + '</td>'; }
  function cellNum(v, tc) { if (v == null) return '<td class="z">-</td>'; if (tc) return '<td class="v tr">' + rng(v, v + tc) + '</td>'; return v === 0 ? '<td class="z"></td>' : '<td class="v">' + num(v) + '</td>'; }      // tc = 그 칸의 '~1' 시각 수
  function cellHum(v) { return v == null ? '<td class="z">-</td>' : '<td class="v">' + Math.round(v) + '</td>'; }      // 85: 습도(%)
  function cellTmp(v) { return v == null ? '<td class="z">-</td>' : '<td class="v' + (v < 0 ? ' neg' : '') + '">' + tmp(v) + '</td>'; }
  function forecastHeader(slots, hourly, label) {
    function date(x){return kstDateLabel(x);}
    function hour(x){return p2(new Date(Date.parse(x)+9*3600e3).getUTCHours());}
    var days=[],times='',label0=label||'시간';      // 2026-11-09 사용자: 창 왼쪽 제목(1시간·3시간)을 표의 시간 칸 이름으로
    slots.forEach(function(b){
      // 89: 3시간 칸은 기상청처럼 그 시각 하나(03·06…, 자정은 앞날의 24)
      var at=hourly?b.first_at:new Date(Date.parse(b.slot_at)-3600e3).toISOString(), day=date(at), label=hourly?hour(b.first_at):hour(b.slot_at);
      if(!hourly && label==='00') label='24';
      var prev=days[days.length-1],dl=!!prev&&prev.day!==day;if(prev&&!dl)prev.n++;else days.push({day:day,n:1});
      times+='<th'+(b.vs||dl?' class="'+(b.vs?'vs':'')+(dl?' dl':'')+'"':'')+'>'+label+'</th>';
    });
    return '<tr><th class="lb">일자</th>'+days.map(function(d,i){return '<th colspan="'+d.n+'"'+(i?' class="dl"':'')+'>'+esc(d.day)+'</th>';}).join('')+'</tr><tr><th class="lb">'+esc(label0)+'</th>'+times+'</tr>';
  }
  // 1시간 창 표: from~to(번호) 시각의 값 그대로(합치지 않음)
  function hourTable(sr, start, from, to) {
    var rs = '', rp = '', rt = '', ro = '', rh = '', hasPop = !!(sr.r && sr.r.length), vn = sr.vn || 0;
    var hasHum = !!(sr.h && sr.h.slice(from, to).some(function (v) { return v != null; }));      // r = 강수확률, h = 습도(85): 서버에 있을 때만 줄을 보임. vn = 앞에서 몇 시각이 초단기 값인지
    var dayAt = function (i) { var d = hourAt(start, i); return d ? kstDateLabel(d.toISOString()) : ''; };
    function mark(html, i, vs) { var c = (vs && i < vn ? 'vs ' : '') + (i > from && dayAt(i) !== dayAt(i - 1) ? 'dl ' : ''); return c ? html.replace('<td class="', '<td class="' + c) : html; }      // dl = 날짜가 바뀌는 칸(진한 선)
    function at(k, i) { var a = sr[k]; return a && a[i] != null ? a[i] : null; }
    for (var i = from; i < to; i++) {
      rs += mark(cellNum(at('s', i), at('sq', i) ? 1 : 0), i, 1); rp += mark(cellNum(at('p', i), at('pq', i) ? 1 : 0), i, 1); rt += mark(cellTmp(at('t', i)), i, 1);
      if (hasPop) ro += mark(cellPop(at('r', i)), i, 1);
      if (hasHum) rh += mark(cellHum(at('h', i)), i, 0);
    }
    var slots = [];
    for (var j = from; j < to; j++) { var stamp = new Date(Date.parse(start) + j * 3600e3).toISOString(); slots.push({ first_at: stamp, last_at: stamp, vs: j < vn }); }
    return '<table class="fc-tt fc-t1"><thead>' + forecastHeader(slots, true, '1시간') + '</thead><tbody>' +
      '<tr><th class="lb s">신적설<small>cm</small></th>' + rs + '</tr><tr><th class="lb p">강수<small>mm</small></th>' + rp + '</tr>' +
      (hasPop ? '<tr><th class="lb o">강수확률<small>%</small></th>' + ro + '</tr>' : '') +      // 2026-11-09 사용자: '확률' → '강수확률'
      '<tr><th class="lb t">기온<small>℃</small></th>' + rt + '</tr>' +
      (hasHum ? '<tr><th class="lb h">습도<small>%</small></th>' + rh + '</tr>' : '') + '</tbody></table>';
  }

  // big = false: 마우스 말풍선, true: 24개 시각을 한 줄로 가로 스크롤
  function fcNow() { return typeof window.__fcNow === 'function' ? window.__fcNow() : Date.now(); }      // 시험에서 시각을 정할 수 있게
  function trendBox(sr, start, big) {
    if (!sr) return '';
    if (!big) {      // 2026-11-09 사용자: 지도 마우스 말풍선도 3시간 창처럼(가까운 24시간)
      var bins = window.ForecastSeries.combine({ status: 'ok', upper: { start_at: start, series: sr } }, window.ForecastSeries.skipHours(start, fcNow()));
      if (!bins.length) return '';
      var hd = bins.map(function (b) { var h = p2(new Date(Date.parse(b.slot_at) + 9 * 3600e3).getUTCHours()); return '<th>' + (h === '00' ? '24' : h) + '</th>'; }).join('');
      return '<div class="fc-trend-box"><table class="fc-tt fc-t3"><thead><tr><th class="lb">3시간</th>' + hd + '</tr></thead><tbody>' + threeRows(bins) + '</tbody></table></div>';
    }
    return '<div class="fc-trend-box big"><div class="fc-scroll" tabindex="0" aria-label="시간별 예보 가로 스크롤">'+hourTable(sr,start,window.ForecastSeries.skipHours(start,fcNow()),(sr.s||[]).length)+'</div></div>';
  }
  // 고정 창 위치·크기(컴퓨터 화면만, 2026-11-03): scale = 글자·표 배율, x·y = 지도 안 왼쪽 위(null = 처음 자리 오른쪽 위). 지도보다 커지거나 밖으로 나가지 않게 맞춤
  var PIN_KEY = 'ss_fc_pin', PIN_PAD = 14, PIN_MIN = 0.8, PIN_DEFAULT = 1.2, PIN_W_MIN = 300;      // PIN_PAD = 창 안팎 여백(px). PIN_DEFAULT = 세 창 기본 배율(2026-11-09 20% 크게). PIN_W_MIN = 가로로 줄일 때 표 폭 하한(배율 1 기준)
  function isPhone() { return window.matchMedia('(max-width:760px)').matches; }
  // geo = {scale, x, y, w, user}: user 가 참이면 사람이 옮기거나 크기를 바꾼 창 → 그 배율·폭·자리를 그대로(다른 창 배치와 무관)
  function loadPinGeo() { try { var j = JSON.parse(localStorage.getItem(PIN_KEY) || 'null'); if (j && j.scale > 0 && j.layout==='compact-v4') return j; } catch (e) {} return { scale: PIN_DEFAULT, x: null, y: null, layout:'compact-v4' }; }
  function savePinGeo() { try { localStorage.setItem(PIN_KEY, JSON.stringify(S.pinGeo)); } catch (e) {} }
  function phoneBox(box) { var inner = box && box.querySelector('.fc-pin-in'); if (!inner) return; box.style.left = box.style.top = box.style.right = ''; inner.style.zoom = ''; inner.style.width = ''; }
  function applyPinGeo() { if (isPhone()) { phoneBox($('fc-pin')); renderTail(); return; } layoutPanels(); }
  // 세 창 배치(컴퓨터 화면, 2026-11-09 사용자: 한 창을 옮기거나 늘리거나 '원래대로'를 눌러도 다른 창은 그대로)
  //  1) 보이는 창을 모두 기본 상태(배율 1.2·기본 폭)로 놓고 재서, 지도 높이·폭에 맞는 공통 계수와 오른쪽 위부터 쌓는 기본 자리를 정함
  //     → 사람이 손댄 창도 이 계산에는 기본 상태로만 들어가므로, 손대지 않은 창의 크기·자리는 다른 창을 바꿔도 같음
  //  2) 손대지 않은 창은 그 기본 배율·자리, 손댄 창(geo.user)은 그 창의 배율·폭·자리를 그대로
  function geoKey(g) { return [g.scale, g.w || 0, g.x, g.y].join(','); }
  function geoOf(id) { return id === 'fc-daily' ? (window.ForecastDaily ? window.ForecastDaily.geo() : null) : id === 'fc-tail' ? S.tailGeo : S.pinGeo; }
  function placeUser(box, g) {
    var mb = box.parentNode, mw = mb.clientWidth, mh = mb.clientHeight;
    box.style.right = 'auto'; box.style.bottom = 'auto';
    box.style.left = Math.max(0, Math.min(g.x, mw - box.offsetWidth)) + 'px'; box.style.top = Math.max(0, Math.min(g.y, mh - box.offsetHeight - 10)) + 'px';
  }
  function layoutPanels() {
    if (isPhone()) return;
    var root = $('fmap') && $('fmap').parentNode; if (!root) return;
    var mw = root.clientWidth, mh = root.clientHeight; if (!mw || !mh) return;
    var ps = ['fc-pin', 'fc-tail', 'fc-daily'].map(function (id) { var el = $(id); return { el: el, geo: geoOf(id), inner: el && el.querySelector('.fc-pin-in') }; })
      .filter(function (p) { return p.el && !p.el.hidden && p.inner && p.geo && p.el.parentNode === root; });
    if (!ps.length) return;
    ps.forEach(function (p) {
      var st = p.el.style, is = p.inner.style;
      p.keep = p.geo.user && p.inner._g === geoKey(p.geo) ? [is.zoom, is.width, st.left, st.top, st.right] : null;      // 손댄 창이 이미 그 값대로면 재고 나서 글자 하나 다르지 않게 되돌림(반올림 차이 방지)
      st.maxHeight = 'none'; st.bottom = 'auto'; is.zoom = PIN_DEFAULT; is.width = '';
    });
    var total = 0, overhead = 0;
    ps.forEach(function (p) { var h = p.el.offsetHeight; total += h; overhead += h - p.inner.getBoundingClientRect().height; });
    var legend = $('fc-legend'), room = mh - 20 - (legend ? legend.offsetHeight : 0) - Math.max(0, ps.length - 1) * 8;
    var f = Math.min(1, Math.max(0.1, (room - overhead - 2) / Math.max(1, total - overhead)));
    var wide = Math.max.apply(null, ps.map(function (p) { return p.el.offsetWidth; })), wroom = mw - Math.min(160, mw * 0.25) - PIN_PAD;
    f = Math.min(f, Math.max(0.1, wroom / Math.max(1, wide - PIN_PAD)));      // 지도 왼쪽 여유(최대 160px)를 남기게
    for (var pass = 0; pass < 3; pass++) {                 // 줄 높이 반올림으로 넘치면 한 번 더 줄임
      var used = 0; ps.forEach(function (p) { p.inner.style.zoom = PIN_DEFAULT * f; used += p.el.offsetHeight; });
      if (used <= room - 2) break; f *= Math.max(0.5, (room - 2 - overhead) / Math.max(1, used - overhead));
    }
    var top = 10; ps.forEach(function (p) { p.top0 = top; top += p.el.offsetHeight + 8; });
    ps.forEach(function (p) {
      var g = p.geo;
      if (!g.user) { p.inner.style.zoom = PIN_DEFAULT * f; p.el.style.left = 'auto'; p.el.style.right = '10px'; p.el.style.top = p.top0 + 'px'; return; }
      if (p.keep) { p.inner.style.zoom = p.keep[0]; p.inner.style.width = p.keep[1]; p.el.style.left = p.keep[2]; p.el.style.top = p.keep[3]; p.el.style.right = p.keep[4]; return; }
      p.inner.style.zoom = g.scale; p.inner.style.width = g.w ? g.w + 'px' : ''; placeUser(p.el, g); p.inner._g = geoKey(g);
    });
  }
  function frontBox(box) { ['fc-pin','fc-tail','fc-daily'].forEach(function (id) { var el = $(id); if (el) el.style.zIndex = el === box ? '802' : '801'; }); }
  // 원래대로(2026-11-09 사용자): 그 창만 처음 크기·자리로. 다른 창은 그대로
  function resetBox(box) {
    var geo = geoOf(box.id); if (!geo) return;
    geo.scale = PIN_DEFAULT; geo.x = null; geo.y = null; geo.user = false; delete geo.w;
    if (box.id === 'fc-pin') savePinGeo();
    layoutPanels();
  }
  function movePinBox(box,geo,x,y,w,h) {
    // 위치 이동은 위/아래 동시 지정을 피하고 크기·글자 배율을 다시 계산하지 않는다.
    box.style.right='auto';box.style.bottom='auto';
    geo.x=Math.max(0,Math.min(x,box.parentNode.clientWidth-w));
    geo.y=Math.max(0,Math.min(y,box.parentNode.clientHeight-h-10));
    box.style.left=geo.x+'px';box.style.top=geo.y+'px';var bi=box.querySelector('.fc-pin-in');if(bi)bi._g=geoKey(geo);
  }
  function forecastRightPadding() {
    if(isPhone() || !S.pin) return 40;
    var map=$('fmap'),mw=map.clientWidth,reserve=40;
    ['fc-pin','fc-tail','fc-daily'].forEach(function(id){var b=$(id);if(b&&!b.hidden&&Math.abs(mw-b.offsetLeft-b.offsetWidth)<=20)reserve=Math.max(reserve,b.offsetWidth+30);});
    return Math.min(reserve,Math.max(40,mw-40));
  }
  function revealForecastCell() {
    if(isPhone() || !S.map || !S.pin) return;
    var xy=S.pin.split(','),p=S.map.latLngToContainerPoint(G.cellCenter(+xy[0],+xy[1])),free=S.map.getSize().x-forecastRightPadding();
    if(p.x>free-20 || p.x<20) S.map.panBy([p.x-free/2,0],{animate:false});
  }
  function pinDrag(e) {
    if (isPhone()) return;
    var hit = e.target.closest && e.target.closest('.fc-pin,.fc-tail,.fc-daily'); if (hit) frontBox(hit);      // 2026-11-09 사용자: 겹친 창은 창 안 어디를 눌러도 앞으로
    // 옮기기: 표 왼쪽 항목 칸(th.lb)이나 창 테두리 여백을 끌기(2026-11-09 왼쪽 제목 칸을 없앤 뒤)
    // 크기(2026-11-09 사용자): 창 왼쪽·오른쪽 옆면 = 글자 그대로 표 폭만(좌우 화살표), 아래 모서리 = 글자·표 배율(대각선 화살표)
    var t = e.target, grip = t.closest && (t.closest('.fc-pin-grip') || t.closest('.fc-pin-edge')), cl = t.classList || { contains: function () { return false; } };
    var handle = t.closest && (t.closest('.fc-pin th.lb,.fc-tail th.lb,.fc-daily th.lb') || cl.contains('fc-pin') || cl.contains('fc-tail') || cl.contains('fc-daily') || cl.contains('fc-pin-in'));
    if (!grip && (!handle || t.closest('button'))) return;
    var box = t.closest('.fc-pin,.fc-tail,.fc-daily'), geo = geoOf(box.id), r = box.getBoundingClientRect(), mr = box.parentNode.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, x0 = r.left - mr.left, y0 = r.top - mr.top, w0 = r.width, left = !!grip && (grip.dataset.grip || grip.dataset.edge) === 'l', mode = grip ? (grip.dataset.edge ? 'w' : 'z') : null;
    e.preventDefault();
    // 손대는 순간 지금 보이는 배율·자리를 그 창의 값으로(이후 다른 창 배치와 무관, 시작할 때 크기가 바뀌지 않게)
    var inner0 = box.querySelector('.fc-pin-in'), z0 = parseFloat(inner0 && inner0.style.zoom) || geo.scale || 1, iw0 = (w0 - PIN_PAD) / z0, mw = box.parentNode.clientWidth;
    geo.user = true; geo.scale = z0; geo.x = x0; geo.y = y0;
    function mv(ev) {
      var dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!grip) { movePinBox(box,geo,x0+dx,y0+dy,w0,r.height); return; }
      var bw = Math.min(mw, Math.max(0, left ? w0 - dx : w0 + dx));      // 바라는 창 폭(지도보다 넓지 않게)
      if (mode === 'w') { geo.w = Math.max(PIN_W_MIN, (bw - PIN_PAD) / z0); inner0.style.width = geo.w + 'px'; }      // 옆면: 배율 그대로 표 폭만
      else { geo.scale = Math.max(PIN_MIN, (bw - PIN_PAD) / iw0); inner0.style.zoom = geo.scale; }      // 모서리: 폭 그대로 배율만
      geo.x = left ? x0 + w0 - box.offsetWidth : x0;      // 왼쪽 손잡이: 오른쪽 끝 그대로
      placeUser(box, geo); geo.x = box.offsetLeft; geo.y = box.offsetTop; inner0._g = geoKey(geo);
    }
    function up() { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); document.body.classList.remove('fc-pin-moving'); if (box.id === 'fc-pin') savePinGeo(); }
    document.body.classList.add('fc-pin-moving');
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }
  // 이후 예보는 선택한 한 격자만 조회한다. 늦게 도착한 이전 선택 응답은 무시한다.
  function tailRange(a, b) {
    function f(x) { var d = new Date(Date.parse(x) + 9 * 3600e3); return (d.getUTCMonth()+1)+'/'+d.getUTCDate()+' '+p2(d.getUTCHours())+'시'; }
    return f(a) + '~' + f(b);
  }
  // 89(2026-11-09 사용자 "기상청처럼"): 신적설·강수는 강도만, 기온·습도는 그 시각 값, 강수확률은 기상청 규칙(series.js combine). 3시간 창과 지도 말풍선이 같이 씀
  function threeRows(bins) {
    var rows=[['신적설','snow'],['강수강도','pcp'],['강수확률 %','pop'],['기온 ℃','tmp']];      // 2026-11-09 사용자: '강수' → '강수강도'
    if(bins.some(function(b){return b.reh!=null;}))rows.push(['습도 %','reh']);
    var dl=bins.map(function(b,i){return i>0&&kstDateLabel(new Date(Date.parse(b.slot_at)-3600e3).toISOString())!==kstDateLabel(new Date(Date.parse(bins[i-1].slot_at)-3600e3).toISOString());});
    return rows.map(function(row){
      var k=row[1],code=k==='snow'||k==='pcp';
      return '<tr><th class="lb">'+row[0]+'</th>'+bins.map(function(b,i){
        var value=code?window.ForecastSeries.intensity(b[k+'_code'],k==='snow'):k==='tmp'?tmp(b.tmp):pct(b[k]),c=(code?'fc-qual':'')+(dl[i]?' dl':'');
        return '<td'+(c?' class="'+c.trim()+'"':'')+'>'+esc(value)+'</td>';
      }).join('')+'</tr>';
    }).join('');
  }
  function tailTables(data) {
    var bins=window.ForecastSeries.combine(data,window.ForecastSeries.skipHours(data&&data.upper&&data.upper.start_at,fcNow()));
    if(!bins.length)return '<p>표시할 예보 자료가 없습니다.</p>';
    return '<div class="fc-scroll" tabindex="0" aria-label="3시간 예보 가로 스크롤"><table class="fc-tt fc-three"><thead>'+forecastHeader(bins,false,'3시간')+'</thead><tbody>'+threeRows(bins)+'</tbody></table></div>';
  }
  function syncForecastMapSize() {
    var map=$('fmap'); if(!map || !S.map) return;
    if(S.tailMapHeight!==map.clientHeight){S.tailMapHeight=map.clientHeight; S.map.invalidateSize({pan:false});}
  }
  function renderTail() {
    var box=$('fc-tail'); if (!box) return;
    if (!S.pin || S.tailClosed) { box.hidden=true; syncForecastMapSize(); return; }
    var d=S.tailData, k=S.pin.split(',');
    box.innerHTML='<button type="button" class="fc-reset" aria-label="처음 크기·위치로">원래대로</button><button class="fc-x fc-tail-x" type="button" aria-label="3시간 예보 닫기">×</button><div class="fc-pin-in"><div class="fc-tail-body">'+
      (S.tailError?'<p>이후 예보를 불러오지 못했습니다. <button type="button" data-tail-retry>다시 받기</button></p>':!d?'<p role="status">이후 예보를 불러오는 중…</p>':d.status!=='ok'?'<p>최신 예보 자료가 없습니다.</p>':tailTables(d))+
      '</div></div><span class="fc-pin-edge l" data-edge="l" aria-hidden="true"></span><span class="fc-pin-edge r" data-edge="r" aria-hidden="true"></span><span class="fc-pin-grip l" data-grip="l" aria-hidden="true"></span><span class="fc-pin-grip r" data-grip="r" aria-hidden="true"></span>';
    box.hidden=false;
    var legend=$('fc-legend'), near=$('fc-pin'), lh=legend?legend.offsetHeight:0;
    if(isPhone()) {
      box.style.top='';box.style.bottom=(lh+20)+'px';
      box.style.maxHeight=Math.max(80,box.parentNode.clientHeight-(near&&!near.hidden?near.offsetHeight:0)-lh-40)+'px';
      phoneBox(box);
    }
    syncForecastMapSize();
    if(window.ForecastDaily)window.ForecastDaily.layout(); else layoutPanels();      // 컴퓨터 화면 배치는 layoutPanels 한 곳
  }
  function tailVisible() {
    var view=$('view-forecast');
    return !!(view && view.offsetParent && !document.hidden && S.pin && !(S.nearClosed && S.tailClosed));
  }
  function clearTailTimer() { clearTimeout(S.tailTimer); S.tailTimer=null; }
  // 83: 예보가 바뀌었는지만 확인(약 0.1KB). 30초 안에 다시 물으면 앞 답을 씀(격자 창·일별 창이 같이 씀)
  var VER={v:null,at:0,p:null};
  function fcVersion(fresh) {
    if(!fresh && VER.v && Date.now()-VER.at<30000) return Promise.resolve(VER.v);
    if(VER.p) return VER.p;
    VER.p=SSAuth.authed('/rest/v1/rpc/forecast_version',{method:'POST',body:{}}).then(function(r){
      VER.p=null;
      if(!r.ok || !r.json || typeof r.json.c!=='string' || typeof r.json.d!=='string') throw new Error('version unavailable');
      VER.v=r.json; VER.at=Date.now(); return VER.v;
    },function(e){ VER.p=null; throw e; });
    return VER.p;
  }
  function scheduleTail() {
    clearTailTimer();
    if(!tailVisible() || !S.tailKey) return;
    var key=S.tailKey, delay=S.tailRetry || !S.tailData || S.tailData.collecting ? 180000 : 600000;
    S.tailTimer=setTimeout(function(){
      S.tailTimer=null;
      if(S.tailKey===key && tailVisible()) { if(S.tailRetry || !S.tailData) fetchTail(key,true); else checkTail(key); }
    },delay);
  }
  // 83: 바뀌었을 때만 다시 받음. 확인이 안 되면 예전처럼 다시 받음
  function checkTail(key) {
    if(S.tailBusy===key) return;
    S.tailBusy=key;
    fcVersion(true).then(function(v){
      if(S.tailBusy===key) S.tailBusy=null;
      if(S.tailKey!==key) return;
      S.tailFetchedAt=Date.now();
      if(!S.tailVer || v.c!==S.tailVer) fetchTail(key,true,v); else scheduleTail();
    },function(){
      if(S.tailBusy===key) S.tailBusy=null;
      if(S.tailKey===key) fetchTail(key,true,null);
    });
  }
  function fetchTail(key,refresh,known) {
    if(S.tailBusy===key) return;
    S.tailBusy=key;
    var pin=S.pin, xy=pin.split(','), ver=known||null;
    (known!==undefined ? Promise.resolve(known) : fcVersion(false).catch(function(){ return null; })).then(function(v){
      ver=v;
      if(S.tailKey!==key || !S.pin) return { ok: false, stale: true };
      return SSAuth.authed('/rest/v1/rpc/forecast_cell_detail',{method:'POST',body:{p_nx:+xy[0],p_ny:+xy[1]}});
    }).then(function(r){
      if(S.tailKey!==key || !S.pin || r.stale) return;
      if(!r.ok || !r.json) throw new Error('forecast unavailable');
      S.tailFetchedAt=Date.now(); S.tailRetry=false; S.tailError=false;
      S.tailVer=ver ? ver.c : null;
      if(ver && r.json.status==='ok') { S.tailCache[pin]={c:ver.c,data:r.json}; var ks=Object.keys(S.tailCache); if(ks.length>40) delete S.tailCache[ks[0]]; }
      if(refresh && JSON.stringify(S.tailData)===JSON.stringify(r.json)) return;
      var scrolls=['fc-pin','fc-tail'].map(function(id){var el=$(id).querySelector('.fc-scroll');return el?el.scrollLeft:0;});
      S.tailData=r.json; renderPin();
      ['fc-pin','fc-tail'].forEach(function(id,i){var el=$(id).querySelector('.fc-scroll');if(el)el.scrollLeft=scrolls[i];});
    }).catch(function(){
      if(S.tailKey===key && S.pin){S.tailRetry=true;if(!S.tailData){S.tailError=true;renderTail();}}
    }).then(function(){
      if(S.tailBusy===key) S.tailBusy=null;
      if(S.tailKey===key) scheduleTail();
    });
  }
  function ensureTail() {
    var key=S.focus+':'+S.pin+':'+S.pinAt;
    if(S.tailKey===key) return;
    clearTailTimer();
    var hit=S.tailCache[S.pin];                                   // 83: 이미 받은 격자는 기억한 값을 바로 보이고 바뀌었는지만 확인
    S.tailKey=key; S.tailData=hit?hit.data:null; S.tailVer=hit?hit.c:null; S.tailError=false; S.tailRetry=false; S.tailClosed=false; S.nearClosed=false;
    S.tailGeo=S.tailGeo || {scale:PIN_DEFAULT,x:null,y:null}; renderTail();
    if(hit) checkTail(key); else fetchTail(key,false);
  }
  // 격자를 누르면 그 격자의 그림을 지도 오른쪽 위에 고정(지도 아무 데나 누르면 닫힘)
  function renderPin() {
    var box = $('fc-pin'); if (!box) return;
    var sr = S.pin && S.focus && S.series[S.focus] ? S.series[S.focus][S.pin] : null;
    if (!sr) { clearTailTimer(); box.hidden = true; box.innerHTML = ''; S.tailKey=null; $('fc-tail').hidden=true; if(window.ForecastDaily)window.ForecastDaily.sync(null); syncForecastMapSize(); return; }
    ensureTail();
    var start=S.series[S.focus]._start;
    if(S.tailData && S.tailData.status==='ok') { var hourly=window.ForecastSeries.hourlyAll(S.tailData);sr=hourly.series; start=hourly.start_at; }
    renderTail();
    var k = S.pin.split(','), g = S.grid[S.hq], c = g && g.cells ? g.cells.filter(function (x) { return x[0] === +k[0] && x[1] === +k[1]; })[0] : null;
    box.innerHTML = '<button type="button" class="fc-reset" aria-label="처음 크기·위치로">원래대로</button><button type="button" class="fc-x fc-pin-x" aria-label="1시간 예보 닫기">×</button><div class="fc-pin-in">' + trendBox(sr, start, true) +
      '</div>' +
      '<span class="fc-pin-edge l" data-edge="l" aria-hidden="true"></span><span class="fc-pin-edge r" data-edge="r" aria-hidden="true"></span><span class="fc-pin-grip l" data-grip="l" aria-hidden="true"></span><span class="fc-pin-grip r" data-grip="r" aria-hidden="true"></span>';
    box.hidden = !!S.nearClosed; applyPinGeo();
    if(window.ForecastDaily)window.ForecastDaily.sync(S.pin,cellName(+k[0],+k[1])+(c?' · '+(c[2]||[]).map(bname).join(', '):''),S.pinAt);
  }
  function markSel() { var rows = document.querySelectorAll('#fc-tree .fc-detail tr[data-cell]'); for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('sel', !S.nearClosed && rows[i].dataset.cell === S.pin); }
  function pinCell(key) { S.pin = key; S.pinWhy = null; S.pinAt = Date.now(); renderPin(); drawCells(); markSel(); revealForecastCell(); }
  function unpin() { if (!S.pin) return; S.pin = null; S.pinWhy = null; renderPin(); drawCells(); markSel(); }
  // 지사를 고르면 눈여겨볼 격자 하나를 골라 1시간 표를 바로 엶(2026-10-10). 순서: ① 적설 있음 ② 강수 있음 + 24시간 안에 한 번이라도 4℃ 이하 ③ 강수 있음 ④ 최저기온 4℃ 이하
  //  각 단계에서는 값이 가장 센 칸(적설 최대 / 강수 최대 / 강수 최대 / 기온 최저). 해당하는 칸이 없으면 고르지 않음
  var COLD = 4, WHY = ['적설이 가장 많은 칸', '4℃ 이하 + 강수가 가장 많은 칸', '강수가 가장 많은 칸', '기온이 가장 낮은 칸'];
  function autoPick(id) {
    var g = S.grid[hqOf(id)], all = S.series[id]; if (!g || !g.cells || !all) return null;
    if (!(g.tmfc && Date.now() - Date.parse(g.tmfc) <= STALE)) return null;
    var best = [null, null, null, null];
    function put(i, key, v, c) {                               // 같은 값이면 옆 표 순서대로(강수 많은 칸 → 더 추운 칸)
      var b = best[i], p = c[4] || 0, t = c[5] == null ? 99 : c[5];
      if (!b || v > b.v || (v === b.v && (p > b.p || (p === b.p && t < b.t)))) best[i] = { key: key, v: v, p: p, t: t };
    }
    g.cells.forEach(function (c) {
      if ((c[2] || []).indexOf(id) < 0) return;
      var key = c[0] + ',' + c[1], sr = all[key]; if (!sr) return;
      var sv = Math.max(c[3] || 0, c[10] || 0), pv = Math.max(c[4] || 0, c[9] || 0);      // 범위가 있으면 위쪽 값으로(62)
      if (sv > 0) put(0, key, sv, c);
      if (pv > 0 && c[5] != null && c[5] <= COLD) put(1, key, pv, c);
      if (pv > 0) put(2, key, pv, c);
      if (c[5] != null && c[5] <= COLD) put(3, key, -c[5], c);
    });
    for (var i = 0; i < best.length; i++) if (best[i]) return { key: best[i].key, why: WHY[i] };
    return null;
  }

  /* ---------- 지도 ---------- */
  function lineColor(owner) {
    if (!owner) return '#9a9a9a';
    if (S.focus) return owner === S.focus ? '#FFC400' : '#b4b0a1';
    if (S.hq !== 'ALL' && hqOf(owner) !== S.hq) return '#c9c6b8';
    return JC.colorOf(st(), owner, S.hq);
  }
  function drawLines() {
    S.lines.clearLayers();
    window.JURIS.doc.sections.forEach(function (sec) {
      var o = st().owner[sec.id];
      L.polyline(sec.coords.map(function (c) { return [c[1], c[0]]; }), { weight: S.focus && o === S.focus ? 5 : 3, opacity: 0.85, interactive: false, color: lineColor(o) }).addTo(S.lines);
    });
  }
  function drawCells() {
    S.cells.clearLayers();
    if (S.hq === 'ALL') return;
    var g = S.grid[S.hq]; if (!g || !g.cells) return;
    var fresh = g.tmfc && Date.now() - Date.parse(g.tmfc) <= STALE, fit = fitLines(cellPx());
    g.cells.forEach(function (c) {
      var nx = c[0], ny = c[1], bs = c[2] || [], snow = fresh ? c[3] : null, pcp = fresh ? c[4] : null, tmin = fresh ? c[5] : null, tat = fresh ? c[6] : null, pop = fresh && c[8] != null ? c[8] : null, phi = fresh ? c[9] : null, shi = fresh ? c[10] : null;      // phi·shi = 범위 위쪽(62)
      var mine = S.focus ? bs.indexOf(S.focus) >= 0 : true;
      if (S.focus && !mine) return;                                  // 지사를 고르면 그 지사 격자만
      var col = S.focus ? snowColor(snow > 0 ? snow : shi > 0 ? 0.5 : snow) : JC.colorOf(st(), bs[0], S.hq);      // ~1cm 만 있으면 '<1' 색
      var key = nx + ',' + ny, pinned = S.focus && S.pin === key;
      var poly = L.polygon(G.cellCorners(nx, ny), { weight: pinned ? 4 : S.focus ? 1.5 : 1, color: pinned ? '#FFC400' : S.focus ? '#33424f' : col, fillColor: col, fillOpacity: S.focus ? 0.7 : 0.28, opacity: 0.9 });
      var sr = S.focus && fresh && S.series[S.focus] ? S.series[S.focus][key] : null;
      poly.bindTooltip('<b>' + esc(cellName(nx, ny)) + '</b>' + cellNo(nx, ny) + '<br>' + bs.map(function (b) { return esc(bname(b)); }).join(', ') +
        (S.focus ? '<br>24시간 적설 <b>' + rng(snow, shi) + 'cm</b> · 강수 <b>' + rng(pcp, phi) + 'mm</b>' + (pop != null ? ' · 확률 최고 <b>' + pct(pop) + '%</b>' : '') + '<br>최저기온 <b>' + tmp(tmin) + '℃</b> (' + esc(hh(tat)) + ')' +
          (sr ? trendBox(sr, S.series[S.focus]._start, false) : '') : ''),
        { sticky: true, opacity: 1, className: 'gr-tip' + (sr ? ' fc-tip' : '') });
      poly.on('click', function () {
        if (!S.focus) { if (bs.length) focusBranch(bs[0]); return; }
        if (sr) { poly.closeTooltip(); pinCell(key); }                         // 지사 격자: 그 격자 그림 고정
      });
      poly.addTo(S.cells);
      if (S.focus) {                                                 // 지사: 격자마다 값(적설 / 강수)
        var sv = Math.max(snow || 0, shi || 0), pv = Math.max(pcp || 0, phi || 0);      // 범위가 있으면 위쪽으로 '있음' 판단
        var hot = sv > 0 || pv > 0, zc = function (v) { return v > 0 ? '' : ' class="z"'; };      // 적설·강수가 있는 칸만 크게, 0 은 흐리게
        var has = { s: sv > 0, p: pv > 0, o: pop > 0, t: tmin != null };
        var html = { s: '<b' + zc(sv) + '>' + rng(snow, shi) + '</b>', p: '<span' + zc(pv) + '>' + rng(pcp, phi) + '</span>', o: '<i' + zc(pop) + '>' + pct(pop) + '%</i>', t: '<em>' + tmp(tmin) + '°</em>' };
        var on = ['s', 'p', 'o', 't'].filter(function (k) { return S.show[k] && !(k === 'o' && pop == null); });      // 체크한 값(적설 > 강수 > 확률 > 기온 순)
        if (on.length > fit) {                                       // 다 못 넣으면: 값이 있는 것 먼저, 같은 조건이면 위 순서대로
          var pick = on.filter(function (k) { return has[k]; }).concat(on.filter(function (k) { return !has[k]; })).slice(0, fit);
          on = on.filter(function (k) { return pick.indexOf(k) >= 0; });
        }
        if (on.length) L.tooltip({ permanent: true, direction: 'center', className: 'fc-label ' + (hot ? 'hot' : 'calm') + (fit < 3 ? ' tight' : ''), interactive: false })
          .setLatLng(G.cellCenter(nx, ny)).setContent(on.map(function (k) { return html[k]; }).join('')).addTo(S.cells);
        else if (!fit && S.show.p && pv > 0)                        // 글자가 안 들어가는 크기: 칸 색(적설) + 강수가 있으면 초록 점
          L.circleMarker(G.cellCenter(nx, ny), { radius: pcp >= 10 ? 4 : 2.5, color: '#14532d', weight: 1, fillColor: '#2f7d4f', fillOpacity: 1, interactive: false, className: 'fc-dot' }).addTo(S.cells);
      }
    });
  }
  function fitTo() {
    if (S.hq === 'ALL') { S.map.setView([36.4, 127.9], 7); return; }
    var g = S.grid[S.hq]; if (!g || !g.cells || !g.cells.length) return;
    var pts = g.cells.filter(function (c) { return !S.focus || (c[2] || []).indexOf(S.focus) >= 0; }).map(function (c) { return G.cellCenter(c[0], c[1]); });
    if (pts.length) {
      S.map.fitBounds(L.latLngBounds(pts), {padding:[40,40],maxZoom:S.focus?11:9,animate:false});
      if(!isPhone() && S.pin){
        var minX=Math.min.apply(null,pts.map(function(p){return S.map.latLngToContainerPoint(p).x;}));
        var shift=Math.min(forecastRightPadding()/2,Math.max(0,minX-40));
        if(shift>0)S.map.panBy([shift,0],{animate:false});
        revealForecastCell();
      }
    }
  }
  function ensureMap() {
    if (S.map) { setTimeout(function () { S.map.invalidateSize(); }, 50); return; }
    S.map = L.map('fmap', { zoomControl: true }).setView([36.4, 127.9], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(S.map);
    S.lines = L.layerGroup().addTo(S.map); S.cells = L.layerGroup().addTo(S.map);
    S.map.on('click', function () { if (Date.now() - S.pinAt > 300) unpin(); });
    S.map.on('zoomend', function () { if (S.focus) drawCells(); });           // 축척이 바뀌면 칸에 들어가는 줄 수를 다시 맞춤      // 지도 아무 데나 누르면 고정 그림 닫기(격자를 누른 그 순간은 제외)
    setTimeout(function () { S.map.invalidateSize(); }, 50);
  }

  /* ---------- 옆 목록 ---------- */
  function renderMeta() {
    var m = S.meta, fresh = m && Date.now() - Date.parse(m.tmfc) <= STALE;
    $('fc-meta').innerHTML = m ? (m.start ? '<b>' + esc(fmtHour(m.start)) + ' ~ ' + esc(fmtHour(m.end)) + '</b> (24시간 합·최저)' : '') +
        (fresh ? '' : '<div class="fc-stale">예보 없음(12시간 넘게 새 예보를 받지 못함)</div>')
      : '<span class="fc-stale">예보 없음</span>';
  }
  function cellPair(f) {
    return f ? '<span class="fc-v s">' + rng(f.max_snow_24h, f.max_snow_hi) + '<i>cm</i></span><span class="fc-v p">' + rng(f.max_pcp_24h, f.max_pcp_hi) + '<i>mm</i></span><span class="fc-v o">' + pct(f.max_pop_24h) + (f.max_pop_24h == null ? '' : '<i>%</i>') + '</span><span class="fc-v t">' + tmp(f.min_tmp) + '<i>℃</i></span>'
      : '<span class="fc-v s">-</span><span class="fc-v p">-</span><span class="fc-v o">-</span><span class="fc-v t">-</span>';
  }
  function hqMax(hq) {               // 본부 줄: 적설·강수는 가장 큰 지사, 최저기온은 가장 추운 지사
    var s = null, p = null, t = null, o = null, sh = null, ph = null;
    branchesOf(hq).forEach(function (id) { var f = bval(id); if (!f) return; if (s == null || f.max_snow_24h > s) s = f.max_snow_24h; if (p == null || f.max_pcp_24h > p) p = f.max_pcp_24h;
      if (f.max_snow_hi != null && (sh == null || f.max_snow_hi > sh)) sh = f.max_snow_hi; if (f.max_pcp_hi != null && (ph == null || f.max_pcp_hi > ph)) ph = f.max_pcp_hi;
      if (f.max_pop_24h != null && (o == null || f.max_pop_24h > o)) o = f.max_pop_24h;
      if (f.min_tmp != null && (t == null || f.min_tmp < t)) t = f.min_tmp; });
    return s == null && p == null ? null : { max_snow_24h: s, max_pcp_24h: p, max_snow_hi: sh, max_pcp_hi: ph, max_pop_24h: o, min_tmp: t };
  }
  function renderTree() {
    var html = '<div class="fc-cols"><span></span><span>적설</span><span>강수</span><span>확률</span><span>최저</span></div>' + st().hqs.filter(function (h) { return !JC.isPrivate(h); }).map(function (hq) {
      var ids = branchesOf(hq); if (!ids.length) return '';
      var open = S.hq === hq;
      return '<div class="jr-hq' + (open ? ' open' : '') + '"><div class="jr-hqname jr-hqpick fc-row' + (open ? ' on' : '') + '" data-fchq="' + esc(hq) + '">' +
        '<span class="chev">▶</span><span class="hn">' + esc(hq) + ' 본부</span>' + cellPair(hqMax(hq)) + '</div>' +
        (open ? ids.map(function (id) {
          return '<div class="jr-br fc-row' + (S.focus === id ? ' on' : '') + '" data-fcbr="' + esc(id) + '"><i style="background:' + JC.colorOf(st(), id, hq) + '"></i><span class="n">' + esc(bname(id)) + '</span>' + cellPair(bval(id)) + '</div>' +
            (S.focus === id ? detailHtml(id) : '');
        }).join('') : '') + '</div>';
    }).join('');
    $('fc-tree').innerHTML = html; markSel();
  }
  function detailHtml(id) {
    var g = S.grid[S.hq]; if (!g || !g.cells) return '<div class="fc-detail muted">격자를 불러오는 중…</div>';
    var fresh = g.tmfc && Date.now() - Date.parse(g.tmfc) <= STALE;
    var rows = g.cells.filter(function (c) { return (c[2] || []).indexOf(id) >= 0; })
      .map(function (c) { return { nx: c[0], ny: c[1], s: fresh ? c[3] : null, p: fresh ? c[4] : null, t: fresh ? c[5] : null, ta: fresh ? c[6] : null, o: fresh && c[8] != null ? c[8] : null, ph: fresh ? c[9] : null, sh: fresh ? c[10] : null }; })
      .sort(function (a, b) { return (b.s || 0) - (a.s || 0) || (b.p || 0) - (a.p || 0) || (a.t == null ? 99 : a.t) - (b.t == null ? 99 : b.t); });
    return '<div class="fc-detail"><table><thead><tr><th>지명</th><th>적설(cm)</th><th>강수(mm)</th><th>확률(%)</th><th>최저(℃)</th><th>시각</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr data-cell="' + r.nx + ',' + r.ny + '"><td>' + esc(cellName(r.nx, r.ny)) + cellNo(r.nx, r.ny) + '</td><td>' + rng(r.s, r.sh) + '</td><td>' + rng(r.p, r.ph) + '</td><td>' + pct(r.o) + '</td><td>' + tmp(r.t) + '</td><td>' + esc(hh(r.ta)) + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
  }
  function renderLegend() {             // 범례(2026-10-10 간단히): 칸 숫자 순서 + 적설량 색띠만
    $('fc-legend').innerHTML = S.focus ? '<span class="fc-legend-t">24시간</span><span class="fc-show" role="group" aria-label="지도 칸에 보일 값(24시간)">' + SHOW_ITEMS.map(function (x) {
          return '<label class="fc-chk ' + x[0] + '"><input type="checkbox" data-fcshow="' + x[0] + '"' + (S.show[x[0]] ? ' checked' : '') + '><span>' + x[1] + '</span></label>'; }).join('') + '</span>' +
        '<span class="fc-ramp"><span class="fc-ramp-t">적설량</span><ol>' + SCALE.slice().reverse().map(function (x) { return '<li><i style="background:' + x[1] + '"></i>' + esc(x[2]) + '</li>'; }).join('') + '</ol></span>'
      : '';
    $('fc-legend').style.display = S.focus ? '' : 'none';
  }
  function render() { drawLines(); drawCells(); renderMeta(); renderTree(); renderLegend(); renderPin(); }

  /* ---------- 단계 이동 ---------- */
  function setHq(hq) {
    S.hq = hq; S.focus = null; S.pin = null; S.pinWhy = null; render(); fitTo();
    if (hq !== 'ALL' && !S.grid[hq]) loadGrid(hq).then(function () { if (S.hq === hq) { render(); fitTo(); } });
  }
  function focusBranch(id) {
    var hq = hqOf(id); if (!hq) return;
    S.pin = null; S.pinWhy = null;
    if (S.focus === id) { S.focus = null; render(); fitTo(); return; }
    S.hq = hq; S.focus = id; render();
    Promise.all([loadGrid(hq), loadSeries(id)]).then(function () {
      if (S.focus !== id) return;
      var a = S.pin ? null : autoPick(id); if (a) { S.pin = a.key; S.pinWhy = a.why; S.pinAt = Date.now(); }      // 눈여겨볼 격자를 고른 채로 엶
      render(); fitTo();
    });
  }

  function bind() {
    document.addEventListener('visibilitychange',function(){
      clearTailTimer();
      if(tailVisible() && S.tailKey){
        if(Date.now()-(S.tailFetchedAt||0)>=60000) { if(S.tailRetry || !S.tailData) fetchTail(S.tailKey,true); else checkTail(S.tailKey); } else scheduleTail();
      }
    });
    $('view-forecast').addEventListener('pointerdown', pinDrag);
    window.addEventListener('resize', applyPinGeo);
    $('view-forecast').addEventListener('change', function (e) {         // 범례 체크박스: 지도 칸에 보일 값
      var k = e.target && e.target.dataset && e.target.dataset.fcshow; if (!k) return;
      S.show[k] = !!e.target.checked; saveShow(); drawCells();
    });
    $('view-forecast').addEventListener('click', function (e) {
      var t = e.target, h = t.closest && t.closest('[data-fchq]'); if (h) { setHq(S.hq === h.dataset.fchq ? 'ALL' : h.dataset.fchq); return; }
      if (t.closest && t.closest('.fc-side-tog')) { toggleSide(); return; }
      var rb = t.closest && t.closest('.fc-reset'); if (rb) { resetBox(rb.closest('.fc-pin,.fc-tail,.fc-daily')); return; }
      var b = t.closest && t.closest('[data-fcbr]'); if (b) { focusBranch(b.dataset.fcbr); return; }
      if (t.closest && t.closest('.fc-tail-x')) { S.tailClosed=true; renderTail(); scheduleTail(); return; }
      if (t.closest && t.closest('[data-tail-retry]')) { S.tailKey=null; ensureTail(); return; }
      if (t.closest && t.closest('.fc-pin-x')) { S.nearClosed=true; $('fc-pin').hidden=true; markSel(); renderTail(); scheduleTail(); return; }
      var c = t.closest && t.closest('[data-cell]'); if (c && S.map) { var k = c.dataset.cell.split(','); S.map.setView(G.cellCenter(+k[0], +k[1]), Math.max(S.map.getZoom(), 11)); if (S.focus) pinCell(c.dataset.cell); }
    });
  }

  function init() {
    var root = $('view-forecast'); if (!root) return;
    if (!G || !JC || !window.JURIS || !window.JURIS.doc) { root.innerHTML = '<div class="jr-empty" style="padding:30px">노선 자료를 불러오지 못했습니다.</div>'; return; }
    S.state = JC.resolve(window.JURIS.doc, window.JURIS.session || window.JURIS.committed || []);
    S.show = loadShow(); S.pinGeo = loadPinGeo(); buildShell(); bind(); S.inited = true;
  }
  function show() {
    if (!S.inited) return;
    S.state = JC.resolve(window.JURIS.doc, window.JURIS.session || window.JURIS.committed || []);    // 관할을 바꿨으면 반영
    ensureMap(); S.grid = {}; S.series = {}; S.pin = null; S.pinWhy = null;
    Promise.all([loadOverview(), loadNames()]).then(function () {
      var id = S.pendingFocus; S.pendingFocus = null;
      if (id && st().branches[id]) { S.hq = 'ALL'; S.focus = null; focusBranch(id); } else { render(); fitTo(); }
    });
    render();
  }
  // 다른 화면(장비 지원)에서 그 지사로 바로 오기
  function openBranch(id) { S.pendingFocus = id; }
  window.ForecastUI = { init: init, show: show, openBranch: openBranch, closeSelection: unpin, version: fcVersion, pinDefault: PIN_DEFAULT, layoutPanels: layoutPanels, _state: function () { return S; } };
})();
