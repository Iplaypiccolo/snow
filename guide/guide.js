/* ============================================================
   guide/guide.js — 사용법 안내 (2026-10-30, 사용자 요청)
   - 로그인해서 강설량 측정이 처음 열리면 그 페이지 메뉴(탭)를 차례로 설명하고,
     장비 지원으로 처음 넘어가면 '지원 과정' 그림 → 탭 설명을 차례로 보여 줌. (계정별 권한 표는 2026-11-01 사용자 요청으로 뺌)
   - 오른쪽 아래 [다음](마지막은 [시작하기]) 또는 오른쪽 위 [설명 그만보기]로 닫음.
     한 번 닫으면 이 브라우저·이 아이디에서는 다시 저절로 나오지 않음(localStorage 'ss_guide:<페이지>:<아이디>', 사용자 결정 = 브라우저 기준).
   - 오른쪽 위 [사용법] 버튼을 누르면 지금 페이지의 첫 장 + 지금 탭의 칸 설명을 다시 봄(위쪽 탭 소개는 처음 한 번만, 2026-11-02).
   - 칸 설명 제목 옆에 쓰는 계정 표지(W): 관리자만 되는 것만 '관리자', 나머지는 주로 쓰는 지사·기계화부·지역본부(2026-11-02). 필터 안내는 뺌.
   - 계정에 따라 보이는 탭만 설명. 탭 소개는 그 탭이 하는 일 한 줄만(2026-11-01 사용자 결정 — 예전 '내 계정이 할 일'·요점은 뺌).
   - 칸·버튼을 하나씩 빛 테두리로 짚으며 설명(게임 튜토리얼처럼, 2026-11-01 사용자 요청). 페이지 안내 = 위쪽 탭 소개 → 지금(첫) 탭의 칸 설명,
     다른 탭의 칸 설명은 그 탭에 처음 들어갈 때 따로(localStorage 'ss_guide:<페이지>.<탭>:<아이디>', "너무 많다" 2026-11-01).
     장비 지원 칸은 안쪽 틀(equipment/index.html) 안에서 찾아 바깥 화면 기준 위치로 바꿔 계산. 내 계정 화면에 없는 칸은 건너뜀.
   - 자동 시험(브라우저 자동 조종) 중에는 저절로 열리지 않음(다른 시험의 클릭을 가리지 않게). 주소에 ?guide=auto 를 붙이면 시험에서도 열림.
   - 화면은 설명용이고 아무것도 저장하지 않음(이 브라우저의 '봤음' 표시만).
   ============================================================ */
(function (root) {
  'use strict';
  var doc = root.document;
  var KEY = 'ss_guide:';
  var AUTO = !root.navigator.webdriver || /[?&]guide=auto(&|$)/.test(root.location.search);
  var st = null, hqName = null, inited = false, waiting = {}, initP = Promise.resolve();

  function $(id) { return doc.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function me() { return root.SS_ME || null; }
  function can(p) { return !!(root.SS_CAN && root.SS_CAN(p)); }
  function key(page) { var m = me(); return KEY + page + ':' + (m && m.username || '-'); }
  function seen(page) { try { return localStorage.getItem(key(page)) === '1'; } catch (e) { return false; } }
  function markSeen(page) { try { localStorage.setItem(key(page), '1'); } catch (e) {} }
  function curPage() { var s = $('shell'); return s && s.dataset.page === 'equip' ? 'equip' : 'snow'; }

  // 계정 구분: 지역본부 중 '강원'만 강원본부 지원장비 탭이 있음
  function roleKey() {
    var m = me(); if (!m) return 'viewer';
    if (m.role === 'hq') return hqName === '강원' ? 'gw' : 'hq';
    return m.role === 'admin' || m.role === 'branch' || m.role === 'equip' ? m.role : 'viewer';
  }
  var ROLE = { admin: '관리자 (재난처·교통처)', gw: '강원본부', hq: '지역본부', branch: '지사', equip: '기계화부', viewer: '보기 전용' };

  /* ---------------- 내용 ---------------- */

  /* 지원 과정 그림(SVG) — 넓은 화면은 가로, 좁은 화면은 세로. 두 흐름이 '교통처 배정'에서 하나로 합쳐짐 */
  var FLOW = {
    A1: { who: '지사', title: '지원 요청', sub: ['요청 대수 · 도착 요청 시각'], tab: '지사별 요청·편성', c: 'cy', roles: ['branch', 'hq', 'gw'] },
    A2: { who: '재난처', title: '승인', sub: ['편성 대수 확정'], tab: '지사별 요청·편성', c: 'vi', roles: ['admin'] },
    B1: { who: '기계화부 · 지사', title: '지원 가능 대수 확인', sub: ['기계화부: 장비 지원 여부', '지사: 타지사 지원 가능 대수'], tab: '기관별 장비 · 요청·편성', c: 'te', roles: ['equip', 'branch', 'hq', 'gw'] },
    M: { who: '교통처', title: '배정', sub: ['어느 기관이', '어느 지사에 몇 대'], tab: '기관별 배치', c: 'bl', roles: ['admin'], merge: true },
    N: { who: '기계화부', title: '장비 지정 · 도착 시간', sub: ['보낼 장비 ·', '도착 예상 시각'], tab: '기관별 장비', c: 'te', roles: ['equip'] },
    E: { who: '모든 계정', title: '장비 지원현황', sub: ['어디로 몇 대가', '언제 도착하는지'], tab: '장비 지원현황', c: 'em' },
    G: { who: '강원본부', title: '강원 신속대응팀 직접 지원', sub: ['요청·승인·배정과 상관없이 보냄', '제설차 4대 (원주·양양·대관령·강릉)'], tab: '강원본부 지원장비', c: 'am', roles: ['gw'], dashed: true }
  };
  var LAYOUT = {
    h: { w: 960, h: 412, pos: { A1: [10, 30, 172, 108], A2: [206, 30, 172, 108], B1: [10, 166, 368, 108], M: [432, 98, 172, 108], N: [628, 98, 172, 108], E: [824, 98, 128, 108], G: [10, 302, 368, 100] },
      links: [['A1A2', 'M182,84 H204'], ['A2M', 'M378,84 C405,84 405,140 430,140'], ['B1M', 'M378,220 C405,220 405,164 430,164'], ['MN', 'M604,152 H626'], ['NE', 'M800,152 H822'], ['GE', 'M378,352 H888 V208', 'g']],
      labels: [[10, 20, '① 요청 → 승인'], [10, 157, '② 지원 가능 대수 확인'], [10, 293, '③ 강원본부 별도'], [518, 80, '합류', 'mid']] },
    v: { w: 360, h: 848, pos: { A1: [10, 30, 166, 108], A2: [10, 170, 166, 108], B1: [184, 30, 166, 248], M: [70, 324, 220, 108], N: [70, 464, 220, 108], E: [70, 604, 220, 100], G: [10, 742, 340, 100] },
      links: [['A1A2', 'M93,138 V168'], ['A2M', 'M93,278 C93,302 150,300 150,322'], ['B1M', 'M267,278 C267,302 210,300 210,322'], ['MN', 'M180,432 V462'], ['NE', 'M180,572 V602'], ['GE', 'M180,742 V706', 'g']],
      labels: [[10, 20, '① 요청 → 승인'], [184, 20, '② 지원 가능'], [10, 734, '③ 강원본부 별도'], [180, 307, '합류', 'mid']] }
  };
  function flowSvg(kind) {
    var L = LAYOUT[kind], rk = roleKey(), id = 'sgA' + kind;
    var s = '<svg class="sg-flow ' + kind + '" viewBox="0 0 ' + L.w + ' ' + L.h + '" role="img" aria-label="장비 지원 과정: 지사 요청, 재난처 승인과 기계화부·지사 지원 가능 대수 확인이 교통처 배정으로 합쳐지고, 기계화부 장비 지정·도착 시간을 거쳐 이동 현황. 강원본부 신속대응팀은 따로 이동 현황으로.">' +
      '<defs><marker id="' + id + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="sg-ah"/></marker>' +
      '<marker id="' + id + 'g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="sg-ah g"/></marker>' +
      '<linearGradient id="' + id + 'm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5ee7ff"/><stop offset=".55" stop-color="#6d8bff"/><stop offset="1" stop-color="#b48cff"/></linearGradient></defs>';
    L.labels.forEach(function (t) { s += '<text class="sg-lane' + (t[3] ? ' ' + t[3] : '') + '" x="' + t[0] + '" y="' + t[1] + '"' + (t[3] === 'mid' ? ' text-anchor="middle"' : '') + '>' + esc(t[2]) + '</text>'; });
    L.links.forEach(function (k) { s += '<path class="sg-link' + (k[2] ? ' g' : '') + '" d="' + k[1] + '" marker-end="url(#' + id + (k[2] ? 'g' : '') + ')"/>'; });
    Object.keys(L.pos).forEach(function (n) {
      var p = L.pos[n], d = FLOW[n], x = p[0], y = p[1], w = p[2], hh = p[3], cx = x + w / 2, mine = (d.roles || []).indexOf(rk) >= 0;
      var lines = 18 + 8 + 18 + 4 + d.sub.length * 15 + 19, ty = y + (hh - lines) / 2;
      s += '<g class="sg-node ' + d.c + (d.merge ? ' merge' : '') + (d.dashed ? ' dashed' : '') + (mine ? ' me' : '') + '">' +
        '<rect class="sg-box" x="' + x + '" y="' + y + '" width="' + w + '" height="' + hh + '" rx="14"' + (d.merge ? ' stroke="url(#' + id + 'm)"' : '') + '/>';
      var cw = Math.max(46, d.who.length * 11 + 18);
      s += '<rect class="sg-chip" x="' + (cx - cw / 2) + '" y="' + ty + '" width="' + cw + '" height="18" rx="9"/><text class="sg-who" x="' + cx + '" y="' + (ty + 13) + '" text-anchor="middle">' + esc(d.who) + '</text>';
      s += '<text class="sg-t" x="' + cx + '" y="' + (ty + 26 + 15) + '" text-anchor="middle">' + esc(d.title) + '</text>';
      d.sub.forEach(function (t, i) { s += '<text class="sg-s" x="' + cx + '" y="' + (ty + 48 + 12 + i * 15) + '" text-anchor="middle">' + esc(t) + '</text>'; });
      s += '<text class="sg-tab" x="' + cx + '" y="' + (ty + lines - 3) + '" text-anchor="middle">' + esc(d.tab) + ' 탭</text>';
      if (mine) s += '<rect class="sg-me" x="' + (x + w - 52) + '" y="' + (y - 9) + '" width="56" height="18" rx="9"/><text class="sg-me-t" x="' + (x + w - 24) + '" y="' + (y + 4) + '" text-anchor="middle">내 역할</text>';
      s += '</g>';
    });
    return s + '</svg>';
  }
  function processHtml() {
    return '<div class="sg-flow-box">' + flowSvg('h') + flowSvg('v') + '</div>' +
      '<div class="sg-notes">' +
      '<div class="sg-note am"><span class="sg-note-ic" aria-hidden="true">!</span><div><b>강원본부 신속대응팀</b><br>요청·승인·배정 없이 직접 지원 → 이동 현황에만 합산</div></div>' +
      '<div class="sg-note lock"><span class="sg-note-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 11h12v9H6z M9 11V8a3 3 0 0 1 6 0v3"/></svg></span><div><b>차량번호 · 운전원 인적사항</b><br>시스템 입력 없음 → 내부망 별도 송부</div></div>' +
      '</div>';
  }

  // 칸·버튼 하나씩 짚기(게임 튜토리얼처럼 — 사용자 요청 2026-11-01)
  //  at = 찾을 곳 목록: 앞에서부터 화면에 보이는 첫 것. 항목 = 선택자 | 함수(문서 → 칸 또는 칸 목록) | { s: 선택자·함수, desc, points }(그것으로 찾으면 문구를 바꿈)
  //  못 찾으면(내 계정에 없는 칸, 자료 없음) 그 단계는 건너뜀. 장비 지원은 안쪽 틀 안에서 찾음
  function shown(el) {
    if (!el || !el.getBoundingClientRect || (el.closest && el.closest('[hidden]'))) return false;
    var r = el.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false;
    var cs = el.ownerDocument.defaultView.getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none';
  }
  function q1(d, sel) { var l = d.querySelectorAll(sel); for (var i = 0; i < l.length; i++) if (shown(l[i])) return l[i]; return null; }
  function inRow(first, others) { return function (d) { var a = q1(d, first); if (!a) return null; var tr = a.closest('tr') || d; return [a].concat((others || []).map(function (x) { return q1(tr, x); }).filter(Boolean)); }; }
  function hostQ(sel) { return function () { var e = q1(doc, sel); return e ? [e] : null; }; }      // 첫 화면 쪽 칸(위쪽 메뉴의 기준일자)
  function both(sels) { return function (d) { var l = sels.map(function (x) { return q1(d, x); }).filter(Boolean); return l.length ? l : null; }; }
  function th(text) { return function (d) { var l = d.querySelectorAll('th'); for (var i = 0; i < l.length; i++) if (shown(l[i]) && l[i].textContent.replace(/\s+/g, ' ').trim().indexOf(text) === 0) return l[i]; return null; }; }
  // 누가 쓰는 칸·버튼인지(2026-11-02 사용자 결정): 관리자만 할 수 있는 것만 '관리자', 나머지는 주로 쓰는 계정(지사 · 기계화부 · 지역본부)
  var ADM = ['관리자'], BRH = ['지사', '지역본부'], MEC = ['기계화부'];
  function W(who, more) { var o = { who: who }; for (var k in more || {}) o[k] = more[k]; return o; }
  function E(tab, title, at, desc, points, more) { var o = { tab: tab, title: title, at: at, desc: desc, points: points || [] }; for (var k in more || {}) o[k] = more[k]; return o; }

  // 시연(게임 튜토리얼처럼 — 2026-11-01 사용자: "격자가 지도에 안 보여 무슨 말인지 모르겠다"):
  //  화면에 바로 안 보이는 것은 안내가 대신 눌러 예시로 띄운 뒤 짚음. 보기만 바뀌고(펼치기·고르기·열기) 자료는 바꾸지 않음.
  //  demo(문서, undo) → 그 단계를 떠날 때 되돌릴 함수(선택). undo(이름, 함수) = 안내를 닫을 때 되돌릴 것
  function tap(el) { if (el) el.click(); return el; }
  function myBranch() { var m = me(); return m && m.role === 'branch' && m.branch_id ? m.branch_id : null; }
  function fcState() { try { return root.ForecastUI && root.ForecastUI._state(); } catch (e) { return null; } }
  function fcHq(d, undo) {                                                            // 24시간 예보: 본부 하나 펼치기(내 지사가 있으면 그 본부)
    if (d.querySelector('#fc-tree .jr-hqpick.on')) return;
    var fs = fcState(), b = myBranch(), hq = b && fs && fs.state && fs.state.branches[b] ? fs.state.branches[b].hq : null;
    if (tap(hq ? d.querySelector('#fc-tree [data-fchq="' + hq + '"]') : q1(d, '#fc-tree [data-fchq]')))
      undo('fc', function () { tap(doc.querySelector('#fc-tree .jr-hqpick.on')); });          // 닫을 때 전국 보기로
  }
  function fcBranch(d, undo) {                                                        // 24시간 예보: 지사 하나 고르기 → 그 지사 격자
    fcHq(d, undo);
    if (d.querySelector('#fc-tree .jr-br.on')) return;
    var b = myBranch(); tap((b && d.querySelector('#fc-tree [data-fcbr="' + b + '"]')) || q1(d, '#fc-tree [data-fcbr]'));
  }
  function fcCell(d) {                                                                // 지도 가운데에 가깝고 추이 그림에 가리지 않는 격자 하나
    var m = d.getElementById('fmap'), pin = d.getElementById('fc-pin'); if (!m) return null;
    var mr = m.getBoundingClientRect(), pr = pin && !pin.hidden ? pin.getBoundingClientRect() : null, cx = mr.left + mr.width / 2, cy = mr.top + mr.height / 2, best = null, bd = Infinity;
    [].forEach.call(m.querySelectorAll('.leaflet-overlay-pane path.leaflet-interactive'), function (el) {
      var r = el.getBoundingClientRect(); if (r.width < 8 || r.left < mr.left || r.top < mr.top || r.right > mr.right || r.bottom > mr.bottom) return;
      if (pr && !(r.right < pr.left || r.left > pr.right || r.bottom < pr.top || r.top > pr.bottom)) return;
      var dd = Math.pow(r.left + r.width / 2 - cx, 2) + Math.pow(r.top + r.height / 2 - cy, 2); if (dd < bd) { bd = dd; best = el; }
    });
    return best;
  }
  function stTree(d) {                                                                // 관측소 지도: 본부 → 지사 펼치기
    if (!d.querySelector('#tree .hq-row.open')) tap(q1(d, '#tree .hq-row'));
    if (!d.querySelector('#tree .br-row.open')) tap(q1(d, '#tree .hq-children.expanded .br-row'));
  }
  function jrHq(d) { if (!d.querySelector('#jr-tree .jr-hqpick.on')) tap(q1(d, '#jr-tree [data-hqpick]')); }
  function jrBranch(d) {                                                              // 관할: 지사 하나 → 구간 목록
    jrHq(d);
    if (!d.querySelector('#jr-tree .jr-br.on')) {
      var b = myBranch(); tap((b && d.querySelector('#jr-tree .jr-br[data-id="' + b + '"]')) || q1(d, '#jr-tree .jr-hq.open .jr-br:not([data-id="NONE"])'));
    }
  }
  function jrSec(d, undo) {                                                           // 관할: 구간 하나 체크(선택만, 이동·요청은 안 함)
    jrBranch(d);
    if (d.querySelector('#jr-tree .jr-sec.sel')) return;
    if (tap(q1(d, '#jr-tree .jr-br.on + * .jr-sec input[type=checkbox]') || q1(d, '#jr-tree .jr-sec input[type=checkbox]')))
      undo('jrsel', function () { tap(doc.getElementById('jr-clear')); });
  }
  function upTo(sel, up) { return function (d) { var a = q1(d, sel); return a ? a.closest(up) : null; }; }

  // 탭 소개 = 그 탭이 하는 일 한 줄(사용자 결정 2026-11-01) → 그 탭의 칸·버튼. only = 그 탭이 보이는 계정에서만
  function snowSteps() {
    var rk = roleKey(), jEdit = can('juris.edit'), jReq = can('juris.request'), g = can('grid.edit');
    var steps = [
      { center: true, kicker: 'WELCOME', title: '제설 업무 시스템', html:
        '<div class="sg-who-card"><span class="sg-dot"></span><div><small>접속 계정</small><b>' + esc((me() || {}).display_name || '') + '</b><span class="sg-role">' + esc(ROLE[rk]) + '</span></div></div>' +
        '<div class="sg-two"><div class="sg-tile"><i class="cy"></i><b>강설량 측정</b><span>예보 · 신적설 · 관측소 · 관할</span></div><div class="sg-tile"><i class="vi"></i><b>장비 지원</b><span>요청 · 승인 · 배정 · 이동</span></div></div>' },
      { tab: 'forecast', title: '기관별 예보', desc: '기관별 앞으로 24시간 예상 적설 · 강수 · 최저기온 확인' },
      E('forecast', '예보 구간', ['#fc-meta'], '다음 정시부터 24시간 (합 · 최저)', ['앞 6시간 = 초단기예보(10분마다) · 적설 항목이 없어 0', '나머지 = 단기예보']),
      E('forecast', '본부 목록', ['#fc-tree .fc-row'], '본부별 24시간 최대 적설 · 강수 · 확률 · 최저기온', ['본부 클릭 → 지사 목록']),
      E('forecast', '본부 펼치기', [upTo('#fc-tree .jr-hqpick.on', '.jr-hq')], '본부 클릭 → 지사 목록 · 지도에 그 본부 격자', [], { demo: fcHq }),
      E('forecast', '지사 고르기', [both(['#fc-tree .jr-br.on', '#fc-tree .fc-detail'])], '지사 클릭 → 그 지사 격자별 값 (적설 많은 순)', ['지명 클릭 → 지도에서 그 격자'], { demo: fcBranch }),
      E('forecast', '5km 격자', [fcCell], '기상청 예보 단위 = 5km × 5km 칸', ['칸 색 = 예상 적설 · 칸 글자 = 적설 / 강수', '마우스 → 그 칸 24시간 추이'], { demo: fcBranch }),
      E('forecast', '시간별 추이', ['#fc-pin'], '격자 클릭 → 24시간·3시간 예보를 별도 창으로 (적설 · 강수 · 기온)', ['그림에 마우스 → 시각별 값', '지도 빈 곳 클릭 → 닫힘'],
        { demo: function (d, undo) { fcBranch(d, undo); var pin = d.getElementById('fc-pin'); if (pin && pin.hidden) tap(q1(d, '#fc-tree tr[data-cell]')); } }),
      E('forecast', '칸 표시 · 범례', ['#fc-legend'], '지도 칸에 보일 값 고르기 · 적설량 색 기준', [], { demo: fcBranch }),
      { tab: 'snowtable', title: '연도별 신적설', desc: '지사 · 본부별 하루 신적설을 시즌 단위로 확인' },
      E('snowtable', '시즌 선택', ['#seasonSelect'], '최근 3시즌 중 고르기'),
      E('snowtable', '엑셀 내보내기', ['#exportXlsxBtn'], '지금 보이는 표 → xlsx 파일'),
      E('snowtable', '지난 시즌', ['#oldSeasonBox'], '이전 시즌 고르기 → [엑셀 받기]', ['화면 표는 최근 3시즌만']),
      E('snowtable', '합계 · 평균', ['#snowTableWrap .sum-col-head'], '지사 줄 = 시즌 합계 · 본부 줄 = 지사 평균'),
      E('snowtable', '날짜 칸', ['#snowTableWrap .sum-col-head + th'], '그날 신적설(cm) · 한 칸 = 하루'),
      { tab: 'map', title: '관측소 지도', desc: '기관별 관할 고속도로와 인접한 관측소의 적설량 확인' },
      E('map', '요약 숫자', ['#view-map .statbar'], '노선 · 본부 · 지사 · 적설관측소 · 미분류 수'),
      E('map', '검색', ['#searchBox'], '본부 · 지사 · 관측소 이름으로 찾기'),
      E('map', '일자 선택', [both(['#dateBtn', '#datePop'])], '달력에서 날짜 → 관측소별 그날 신적설', ['자료 있는 날만 누를 수 있음'],
        { demo: function (d) { var pop = d.getElementById('datePop'); if (pop && pop.hidden) tap(d.getElementById('dateBtn')); return function () { if (pop) pop.hidden = true; }; } }),
      E('map', '관측소 목록', ['#tree .hq-row'], '본부 → 지사 → 관측소 · 숫자 = 관측소 수'),
      E('map', '지사 펼치기', [both(['#tree .br-row.open', '#tree .br-children.expanded'])], '지사 클릭 → 관할 고속도로 근처 관측소', ['지도도 그 지사로 이동'], { demo: stTree }),
      E('map', '관측소', ['#tree .br-children.expanded .st-row'], '관측소 이름 · 번호 · 노선', ['오른쪽 = 고속도로까지 거리(km)', '날짜를 고르면 그날 신적설'], { demo: stTree }),
      E('map', '지도', ['#map'], '점 = 적설관측소 · 색 = 고속도로까지 거리', ['초록 0~3km · 주황 3~6km · 빨강 6~8km']),
      { tab: 'jurisdiction', title: '기관별 관할 고속도로', desc: '지사마다 맡은 고속도로 구간 확인 · 변경' },
      E('jurisdiction', '지사 검색', ['#jr-search'], '지사 이름으로 찾기'),
      E('jurisdiction', '+ 신설 기관', ['#jr-add'], '새 지사 만들기 → 구간 넣기', [], W(ADM)),
      E('jurisdiction', '변경 요청', ['#jr-requests'], jEdit ? '지사가 보낸 구간 변경 요청 → 승인 · 반려' : '내가 보낸 구간 변경 요청 · 처리 상태', [], W(['지사'])),
      E('jurisdiction', '관할 목록', ['#jr-tree .jr-hqpick', '#jr-tree'], '본부별 지사 수 · 관할 길이(km)', ['미지정 고속도로 = 어느 지사에도 없는 구간']),
      E('jurisdiction', '지사 → 구간', [both(['#jr-tree .jr-br.on', '#jr-tree .jr-br.on + *'])], '지사 클릭 → 관할 구간(IC · JC 사이) 목록', ['지도에서 그 지사 강조'], { demo: jrBranch }),
      E('jurisdiction', '구간 고르기', ['#jr-tree .jr-sec.sel'], '구간 체크 (또는 지도에서 구간 클릭)', [], W(['지사'], { demo: jrSec, only: jEdit || jReq })),
      E('jurisdiction', '선택 막대', ['#jr-selbar'], jEdit ? '이동할 지사 → [이동 대기에 추가] → [저장]' : '[구간 변경 요청] → 관리자에게 보냄', ['[선택 해제] = 취소'], W(['지사'], { demo: jrSec, only: jEdit || jReq })),
      E('jurisdiction', '지도', ['#jmap'], jEdit ? '구간 클릭 → 선택 → 다른 지사로 옮기기' : jReq ? '구간 클릭 → 선택 → [구간 변경 요청]' : '색 = 관할 지사'),
      E('jurisdiction', '저장', ['#jr-savebar'], '[미리보기] 바뀌는 관측소 · [모두 취소] · [저장]', [], W(ADM, { only: jEdit })),
      { tab: 'sources', title: '데이터 출처', desc: '자료 출처와 계산 방법 안내' },
      E('sources', '보유 시즌', ['#seasonsTable'], '시즌별 기간 · 자료 있는 날 수'),
      { tab: 'grid', only: g, badge: '관리자', title: '예보 격자 편입', desc: '기상청 5km 예보 격자를 지사에 연결 (24시간 예보의 기준)' },
      E('grid', '편입 현황', ['#gr-summary'], '편입 격자 수 · 지사별 칸 수', [], { only: g }),
      E('grid', '기관 검색', ['#gr-search'], '지사 이름으로 찾기', [], { only: g }),
      E('grid', '기관 목록', ['#gr-tree .jr-hqpick', '#gr-tree'], '본부 → 지사 · 칸 = 편입 격자 수', [], { only: g }),
      E('grid', '영역 선택', ['#gr-box'], '지도에서 끌어서 여러 칸 한꺼번에 고르기', [], W(ADM, { only: g })),
      E('grid', '지도', ['#gmap'], '격자 클릭 → 고르기 → 기관에 편입 · 제외', ['색: 기관 편입 · 여러 기관 공유 · 후보'], W(ADM, { only: g })),
      E('grid', '저장', ['#gr-savebar'], '[미리보기] · [모두 취소] · [저장] = 전체 적용', [], W(ADM, { only: g })),
      { target: '#sgHelp', kicker: 'HELP', title: '사용법 다시 보기', desc: '오른쪽 위 [? 사용법]', points: ['다른 탭: 처음 들어갈 때 칸 · 버튼 설명'], last: true }
    ];
    return steps.filter(function (x) { return x.only !== false; });
  }

  function equipSteps() {
    var rk = roleKey(), gwOk = rk === 'admin' || rk === 'gw', lg = can('log.view');
    var steps = [
      { center: true, wide: true, kicker: 'PROCESS', title: '장비 지원 절차', html: processHtml() },
      // 이동 현황
      { tab: 'move', title: '장비 지원현황', desc: '날짜별로 어느 기관 장비가 어느 지사로 가는지 확인' },
      E('move', '날짜', [both(['#prevDay', '#dateText', '#nextDay'])], '‹ › 하루씩 이동 · 날짜 클릭 → 달력'),
      E('move', '요약 · 기준 시각', ['#summaryNote'], '그날 지원 대수 · 기준 시각', ['최신 자료는 위쪽 [새로고침]']),
      E('move', '강원 신속대응팀', ['.team-tg'], '체크 해제 → 표 · 카드에서 빠짐'),
      E('move', '1쪽 보고서', [both(['#rptView', '#rptDoc'])], '[보고서 보기] = 이 날짜를 1쪽 양식으로 · [Word 받기] = 워드 파일', ['도착일시 = 그 지사에 가장 먼저 도착하는 시각']),
      E('move', '이동 표', ['#matrix'], '줄 = 피지원 지사 · 열 = 지원기관', ['칸 숫자 = 대수 (제설차 · 제설기)']),
      E('move', '숫자', ['#matrix button.mnum'], '칸 숫자 = 그 기관이 그 지사에 보낸 대수', ['클릭 → 아래 지사 카드로']),
      E('move', '숫자 클릭', ['#destList .hl-card'], '그 지사 카드로 이동 · 해당 장비 강조', [], { demo: function (d) { if (!d.querySelector('#destList .hl-card')) tap(q1(d, '#matrix button.mnum')); } }),
      E('move', '지사 카드', ['#destList .dest-head'], '피지원 지사 · 도착 예상 시각 · 대설특보'),
      E('move', '장비 줄', ['#destList .vrow'], '도공번호 · 종류 · 도착 예상'),
      E('move', '장비 정보', ['#sheet'], '장비 클릭 → 들르는 지사 · 도착 예상 · 날짜별 경로 기록', ['[닫기] 또는 바깥 클릭 → 닫힘'],
        { demo: function (d) { var sh = d.getElementById('sheet'); if (sh && sh.hidden) tap(q1(d, '#destList .vrow')); return function () { var bd = d.getElementById('backdrop'); if (bd && !bd.hidden) bd.click(); }; } }),
      // 지사별 요청·편성
      { tab: 'branch', title: '지사별 요청·편성', desc: '지사가 필요한 장비를 요청하고 재난처가 지원 대수를 확정' },
      E('branch', '기준일자', [hostQ('.eq-round .eq-round-sel')], '지원 회차 고르기 · 어느 탭에서나 위쪽에 늘 보임', ['요청 · 편성 · 장비 지원 여부 · 배정은 기준일자마다 따로']),
      E('branch', '기준일자 삭제 · 만들기', [hostQ('.eq-round .eq-round-tools button, .eq-round .eq-round-more')], '삭제 · 새 기준일자 [만들기] (좁은 화면은 [+]를 눌러 엶)', ['장비 지원 여부는 이전 기준일자에서 이어받음', '삭제는 되돌릴 수 없음'], W(ADM)),
      E('branch', '전체 합계', ['#branchTable tr.tot'], '맨 위 줄 = 지사 요청 · 타지사 지원 가능 · 편성의 전체 대수', ['편성은 편성 대수 / 기관별 장비의 지원 가능 대수']),
      E('branch', '24시 예보', ['#branchTable th.fch'], '지사별 예상 적설 · 강수 · 확률 · 최저기온', ['숫자 클릭 → 강설량 측정의 그 지사 예보']),
      E('branch', '대설특보', ['#branchTable th.wh'], '기상청 특보 자동 표시 (종류 · 발표 · 발효)'),
      E('branch', '기상현황 직접입력', ['#branchTable input[aria-label$="기상현황 직접입력"]:not(:disabled)'], '체크 → 특보 종류를 직접 고름', [], W(BRH)),
      E('branch', '지사 요청', [inRow('#branchTable input[aria-label$="요청 제설차"]:not(:disabled)', ['input[aria-label$="요청 제설기"]']),
        { s: inRow('#branchTable tr.mine.locked input[aria-label$="요청 제설차"]', ['input[aria-label$="요청 제설기"]']), desc: '우리 지사 필요 대수 · 확정되면 잠김 (재난처 [취소] 후 수정)' },
        { s: th('지사 요청'), desc: '지사가 넣은 필요 대수 (보기)' }], '필요한 제설차 · 제설기 대수 입력', [], W(BRH)),
      E('branch', '도착 요청', [inRow('#branchTable input[aria-label$="도착 요청 날짜"]:not(:disabled)', ['select[aria-label$="도착 시"]', 'select[aria-label$="도착 분"]']),
        { s: inRow('#branchTable tr.mine.locked input[aria-label$="도착 요청 날짜"]', ['select[aria-label$="도착 시"]', 'select[aria-label$="도착 분"]']), desc: '우리 지사 도착 요청 시각 · 확정되면 잠김' },
        { s: th('도착 요청'), desc: '지사가 원하는 도착 시각 (보기)' }], '날짜 먼저 → 시 · 분', [], W(BRH)),
      E('branch', '타지사 지원 가능', ['#branchTable input[aria-label$="타지사 지원 가능 제설차"]:not(:disabled)',
        { s: '#branchTable tr.mine.locked input[aria-label$="타지사 지원 가능 제설차"]', desc: '우리 지사가 다른 지사에 보낼 수 있는 제설차 · 확정되면 잠김' },
        { s: th('타지사'), desc: '다른 지사에 보낼 수 있는 제설차 (보기)' }], '우리 지사가 다른 지사에 보낼 수 있는 제설차 대수', [], W(BRH)),
      E('branch', '저장', ['#branchTable tr[data-b] [data-rsave]', { s: '#branchTable th.svh', desc: '저장한 줄 = 지사저장 · 본부저장 · 본사저장' }], '그 지사 줄 [저장] → 누가 저장했는지 표시',
        ['지사 계정 = 지사저장 · 본부 계정 = 본부저장 · 관리자 = 본사저장', '[저장] 전에는 반영 안 됨', '0대도 저장 = 요청 없음 알림'], W(BRH)),
      E('branch', '일괄 저장', ['#branchTable [data-rsave-hq]'], '본부 줄 [일괄 저장] → 그 본부 지사를 한꺼번에 저장', ['지사가 저장한 줄도 고치지 않고 → 본부저장(본부 확인 표시)'], W(['지역본부'])),
      E('branch', '편성', [inRow('#branchTable input[aria-label$="편성 제설차"]:not(:disabled)', ['input[aria-label$="편성 제설기"]']),
        { s: th('편성'), desc: '재난처가 정한 지원 대수 (보기)' }], '재난처: 실제 지원할 대수 입력', [], W(ADM)),
      E('branch', '확정', [both(['#branchTable [data-confirm]', '#confirmAll']), { s: th('확정'), desc: '재난처 확정 여부 · 확정되면 줄 잠김' }],
        '[확정] → 줄 잠김 · [취소]로 풀기', ['본부 줄 · 맨 위 [일괄 확정]'], W(ADM)),
      // 기관별 장비
      { tab: 'fleet', title: '기관별 장비', desc: '기관 장비의 지원 여부와 날짜별 지원 지사 · 도착 시각 입력' },
      E('fleet', '장비 현황', ['#fleetSum'], '기관 · 장비별 지원 대수', ['맨 앞 칸 = 전체']),
      E('fleet', '세부내역', ['#fleetSum tr.fs-asgn'], '기관 · 장비별로 어느 지사에 몇 대 배치됐는지', ['[배치]의 화살표를 눌러 펴고 접음']),
      E('fleet', '장비 추가', [both(['#nvOrg', '#nvType', '#nvPlate', '#vehAdd'])], '기관 · 종류 · 도공번호 → [추가]', ['지사: 지역본부 장비(타지사 지원 가능 확정 뒤)'], W(['기계화부', '지사'])),
      E('fleet', '지원일 칸 수', ['#colsSel'], '표에 보이는 날짜 칸 수', ['[확정]하면 모든 아이디가 이 칸 수로 봄'], W(ADM)),
      E('fleet', '지원일 1', ['#day1In'], '첫 날짜 · 나머지 칸은 하루씩 자동', ['[확정]하면 모든 아이디가 이 날짜부터 봄'], W(ADM)),
      E('fleet', '지원 여부', ['#eqTable button[data-vs]', { s: '#eqTable tbody td .status', desc: '기관이 정한 지원 여부 (보기)' }],
        '[지원] 누름 → 지원 · 다시 누름 → 빈칸', ['새 기준일자는 빈칸으로 시작', '지원 → 날짜 칸이 열림'], W(MEC)),
      E('fleet', '블로워', [inRow('#eqTable input[aria-label$="블로워 소"]:not(:disabled)', ['input[aria-label$="블로워 대"]'])], '장착한 블로워 체크 (소 · 대)', [], W(MEC)),
      E('fleet', '지원 지사', ['#eqTable .slot select[data-rv]:not(:disabled)',
        { s: '#eqTable .slot select[data-ra]:not(:disabled)', desc: '그날 갈 지사 고르기', points: ['교통처가 배정한 지사 · 대수 안에서 (하루 한 곳)', '여러 지사 · 수정본 · 지역본부 장비는 관리자'] }], '그날 갈 지사 고르기', [], W(['기계화부'])),
      E('fleet', '도착 예상 시각', ['#eqTable .slot input.tm:not(:disabled)'], '그 지사 도착 시각 (예: 21:30)', ['지사: 관리자가 지사를 정한 지역본부 장비'], W(['기계화부', '지사'])),
      E('fleet', '＋ 지사 추가', ['#eqTable .slot button[aria-label$="들르는 지사 추가"]:not(:disabled)'], '하루에 여러 지사를 들를 때', [], W(ADM)),
      E('fleet', '숨기기 · 삭제', [inRow('#eqTable [data-vhide]', ['[data-vdel]'])], '숨기기 = 목록에서만 뺌 · 삭제 = 지움', [], W(MEC)),
      E('fleet', '확정', ['#save-fleet'], '바뀐 칸 → [확정]해야 저장', ['[되돌리기] = 마지막 확정 상태로'], W(['기계화부', '지사'])),
      // 기관별 배치
      { tab: 'alloc', title: '기관별 배치', desc: '교통처가 기관별로 지사에 보낼 장비 대수를 배정' },
      E('alloc', '배정 대수', ['#allocTable input.num:not(:disabled)', { s: '#allocTable tbody td', desc: '교통처가 정한 배정 대수 (보기)' }], '기관 → 지사 보낼 대수 입력', [], W(ADM)),
      E('alloc', '배정 / 편성', [th('배정 / 편성')], '지사별 배정 합 / 편성 대수', ['초록 일치 · 주황 부족 · 빨강 초과']),
      E('alloc', '배정 / 지원 가능', [th('배정 / 지원 가능')], '기관별 배치 합 / 지원 가능 대수'),
      E('alloc', '확정', ['#save-alloc'], '[확정] → 기계화부에 배정 전달', ['[되돌리기] = 마지막 확정 상태로'], W(ADM)),
      // 강원본부 지원장비
      { tab: 'gwteam', only: gwOk, badge: '강원본부', title: '강원본부 지원장비', desc: '강원 신속대응팀 제설차 4대를 요청 없이 지사에 직접 지원' },
      E('gwteam', '지원 여부', ['#teamTable button[data-vs]'], '[지원] 누름 → 지원 · 다시 누름 → 빈칸', ['새 기준일자는 빈칸으로 시작', '지원 → 날짜 칸이 열림'], W(['강원본부'], { only: gwOk })),
      E('gwteam', '지원일 1', ['#day1InTeam'], '첫 날짜 · 나머지 칸은 하루씩 자동', ['[확정]하면 이 날짜부터 저장'], W(['강원본부'], { only: gwOk })),
      E('gwteam', '지원 지사', ['#teamTable .slot select:not(:disabled)'], '그날 갈 지사 · 옆 칸 = 도착 시각', [], W(['강원본부'], { only: gwOk })),
      E('gwteam', '확정', ['#save-gwteam'], '바뀐 칸 → [확정]해야 저장', [], W(['강원본부'], { only: gwOk })),
      // 로그 기록
      { tab: 'log', only: lg, badge: '권한', title: '로그 기록', desc: '장비 지원 화면의 변경 이력 조회' },
      E('log', '기록 표', ['#logTable thead'], '일시 · 아이디 · 구분 · 표 · 대상 · 내용 · IP', [], { only: lg }),
      { target: '#sgHelp', kicker: 'HELP', title: '사용법 다시 보기', desc: '오른쪽 위 [? 사용법]', points: ['다른 탭: 처음 들어갈 때 칸 · 버튼 설명'], last: true }
    ];
    return steps.filter(function (x) { return x.only !== false; });
  }

  /* ---------------- 화면 ---------------- */
  function build() {
    var el = doc.createElement('div'); el.id = 'sgRoot'; el.className = 'sg-root';
    el.innerHTML = '<div class="sg-shield"></div><div class="sg-dim"></div><div class="sg-ring" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
      '<section class="sg-card" role="dialog" aria-modal="true" aria-labelledby="sgTitle"><span class="sg-arrow" aria-hidden="true"></span><div class="sg-in"></div></section>' +
      '<button type="button" class="sg-stop" id="sgStop"><span aria-hidden="true">✕</span> 설명 그만보기</button>';
    doc.body.appendChild(el);
    el.querySelector('#sgStop').onclick = function () { stop(); };
    el.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-sg]'); if (!b) return;
      if (b.dataset.sg === 'next') next(); else if (b.dataset.sg === 'prev') go(st.i - 1);
    });
    return el;
  }
  function tabBtn(page, name) { return doc.querySelector(page === 'equip' ? '.eq-btn[data-eqtab="' + name + '"]' : '.tab-btn[data-tab="' + name + '"]'); }
  function fdoc() { var f = $('equipFrame'); try { return f && f.getAttribute('src') && f.contentDocument && f.contentDocument.readyState !== 'loading' ? f.contentDocument : null; } catch (e) { return null; } }
  var TABNAME = { forecast: '기관별 예보', snowtable: '연도별 신적설', map: '관측소 지도', jurisdiction: '기관별 관할 고속도로', sources: '데이터 출처', grid: '예보 격자 편입',
    move: '장비 지원현황', branch: '지사별 요청·편성', fleet: '기관별 장비', alloc: '기관별 배치', gwteam: '강원본부 지원장비', log: '로그 기록' };

  // 단계의 칸 찾기 → { els, item }
  function resolve(s) {
    var d = st.page === 'equip' ? fdoc() : doc; if (!d) return null;
    for (var i = 0; i < s.at.length; i++) {
      var it = s.at[i], f = it && it.s ? it.s : it, r = typeof f === 'function' ? f(d) : q1(d, f);
      if (r && !Array.isArray(r)) r = [r];
      if (r && r.length) return { els: r, item: it && it.s ? it : null };
    }
    return null;
  }
  // 칸들의 화면 위치(안쪽 틀이면 틀 위치를 더하고, 틀 밖은 잘라 냄)
  function rectOf(els) {
    var L = Infinity, T = Infinity, R = -Infinity, B = -Infinity, c = { l: 0, t: 0, r: root.innerWidth, b: root.innerHeight };
    els.forEach(function (e) {
      if (!e || !e.isConnected) return;
      var w = e.ownerDocument.defaultView, fx = 0, fy = 0, fe = w !== root ? w.frameElement : null;
      if (fe) { var fr = fe.getBoundingClientRect(); fx = fr.left; fy = fr.top; c = { l: Math.max(c.l, fr.left), t: Math.max(c.t, fr.top), r: Math.min(c.r, fr.right), b: Math.min(c.b, fr.bottom) }; }
      var r = e.getBoundingClientRect(); L = Math.min(L, r.left + fx); T = Math.min(T, r.top + fy); R = Math.max(R, r.right + fx); B = Math.max(B, r.bottom + fy);
    });
    L = Math.max(L, c.l); T = Math.max(T, c.t); R = Math.min(R, c.r); B = Math.min(B, c.b);
    return R - L >= 2 && B - T >= 2 ? { left: L, top: T, right: R, bottom: B, width: R - L, height: B - T } : null;
  }

  // 제목 옆 표지: 탭 표지(관리자 등) · 쓰는 계정(관리자 / 지사 · 기계화부 · 지역본부) · 예시
  function badges(s) {
    var h = (s.badge ? '<span class="sg-badge">' + esc(s.badge) + '</span>' : '') +
      (s.who || []).map(function (w) { return '<span class="sg-badge who' + (w === '관리자' ? ' adm' : '') + '" title="이 칸 · 버튼을 쓰는 계정">' + esc(w) + '</span>'; }).join('') +
      (s.demo ? '<span class="sg-badge demo" title="안내가 대신 눌러 보여 주는 예시 — 자료는 바뀌지 않음">예시</span>' : '');
    return h ? '<span class="sg-badges">' + h + '</span>' : '';
  }
  function body(s, item) {
    if (s.html) return s.html;
    var desc = item && item.desc || s.desc, pts = item && item.points || s.points;
    var h = '<p class="sg-desc">' + desc + '</p>';
    if (pts && pts.length) h += '<ul class="sg-pts">' + pts.map(function (p) { return '<li>' + p + '</li>'; }).join('') + '</ul>';
    if (s.mine) h += '<div class="sg-mine"><span class="sg-mine-k">내 계정 · ' + esc(ROLE[roleKey()]) + '</span><p>' + esc(s.mine) + '</p></div>';
    return h;
  }

  function render() {
    if (st.leave) { var lv = st.leave; st.leave = null; try { lv(); } catch (e) {} }   // 앞 단계 시연 되돌리기(열어 둔 창 닫기 등)
    var s = st.steps[st.i], my = ++st.tok;
    if (s.tab) {                                                                       // 칸 설명이면 그 탭 화면을 띄움(탭 소개는 버튼만 짚음)
      var b = tabBtn(st.page, s.tab);
      if (!shown(b)) return skip();
      if (!s.ov && !b.classList.contains('active')) { b.click(); st.openedAt = Date.now(); }
    }
    if (!s.at) { var t = s.tab ? tabBtn(st.page, s.tab) : s.target ? doc.querySelector(s.target) : null; return draw(s, t && shown(t) ? [t] : null, null); }
    if (s.demo) st.openedAt = Date.now();                                            // 시연은 화면이 바뀔 때까지 기다림
    var until = (st.openedAt || 0) + 2500;                                          // 탭을 연 지 2.5초까지만 기다림(그 뒤엔 없는 칸 → 바로 건너뜀)
    function find() {                                                                // 화면이 그려질 때까지 잠깐 기다림(장비 지원 자료 등)
      if (!st || st.tok !== my) return;
      if (s.demo) { var dd = st.page === 'equip' ? fdoc() : doc; if (dd) try { var lv2 = s.demo(dd, function (k, f) { st.undo[k] = f; }); if (typeof lv2 === 'function' && !st.leave) st.leave = lv2; } catch (e) {} }
      var r = resolve(s);
      if (r) return draw(s, r.els, r.item);
      if (Date.now() >= until) return skip();
      setTimeout(find, 120);
    }
    if (s.demo) setTimeout(find, 30); else find();                                   // 시연은 [다음] 클릭이 다 끝난 뒤(바깥 클릭에 닫히는 창이 있음)
  }
  function skip() {                                                                   // 내 계정 화면에 없는 칸: 그 단계를 빼고 같은 방향으로
    st.steps.splice(st.i, 1);
    if (!st.steps.length) return stop();
    if (st.dir < 0) st.i -= 1;
    st.i = Math.max(0, Math.min(st.steps.length - 1, st.i));
    render();
  }
  function draw(s, els, item) {
    var n = st.steps.length, el = st.el, card = el.querySelector('.sg-card'), ring = el.querySelector('.sg-ring');
    if (els && els[0].scrollIntoView) { try { els[0].scrollIntoView(s.at ? { block: 'center', inline: 'nearest' } : { block: 'nearest', inline: 'center' }); } catch (e) {} }   // 칸은 가운데로(아래쪽 고정 막대에 가리지 않게)
    st.cur = els;
    var center = !els, isTab = s.tab && !s.at, tb = s.tab ? tabBtn(st.page, s.tab) : null;
    var ico = tb ? (tb.querySelector('svg') || {}).outerHTML || '' : '';
    var pg = st.page === 'equip' ? '장비 지원' : '강설량 측정', kick = s.kicker || (s.at ? TABNAME[s.tab] || 'STEP' : 'TAB');
    var pct = Math.round((st.i + 1) / n * 100);
    el.querySelector('.sg-in').innerHTML =
      '<div class="sg-head"><span class="sg-step"><i></i><b class="sg-k">' + esc(kick) + '</b> · ' + String(st.i + 1).padStart(2, '0') + ' / ' + String(n).padStart(2, '0') + '</span><span class="sg-pg">' + pg + ' 사용법</span></div>' +
      '<div class="sg-title">' + (isTab && ico ? '<span class="sg-ico">' + ico + '</span>' : s.at ? '<span class="sg-pin" aria-hidden="true"></span>' : '') + '<h2 id="sgTitle">' + esc(s.title) + '</h2>' + badges(s) + '</div>' +
      '<div class="sg-body">' + body(s, item) + '</div>' +
      '<div class="sg-foot"><div class="sg-prog" aria-hidden="true"><span style="width:' + pct + '%"></span></div>' +
      '<div class="sg-btns">' + (st.i > 0 ? '<button type="button" class="sg-prev" data-sg="prev">이전</button>' : '') +
      '<button type="button" class="sg-next" data-sg="next">' + (st.i === n - 1 ? '시작하기' : '다음') + ' <span aria-hidden="true">→</span></button></div></div>';
    card.className = 'sg-card' + (center ? ' center' : '') + (s.wide ? ' wide' : '') + (s.at ? ' mini' : '');
    el.classList.toggle('is-center', center);
    card.classList.remove('anim'); void card.offsetWidth; card.classList.add('anim');
    place(els ? rectOf(els) : null, card, ring);
    clearTimeout(st.rp); st.rp = setTimeout(onResize, 350);                           // 늦게 끝나는 스크롤·그리기 뒤 다시 맞춤
    var nb = card.querySelector('.sg-next'); if (nb) try { nb.focus({ preventScroll: true }); } catch (e) { nb.focus(); }
    card.querySelector('.sg-body').scrollTop = 0; card.querySelector('.sg-in').scrollTop = 0;   // 휴대폰은 카드 전체가 스크롤됨 → 새 장은 맨 위부터
  }
  // 카드 자리: 아래 → 위 → 오른쪽 → 왼쪽 중 들어가는 곳. 큰 칸(지도 등)이라 다 안 되면 화면 오른쪽 아래
  function place(r, card, ring) {
    var arrow = card.querySelector('.sg-arrow');
    card.style.left = card.style.top = card.style.bottom = '';
    if (!r) { ring.style.opacity = '0'; arrow.style.display = 'none'; return; }
    var pad = 5, vw = root.innerWidth, vh = root.innerHeight, gap = 18;
    ring.style.opacity = '1';
    ring.style.left = (r.left - pad) + 'px'; ring.style.top = (r.top - pad) + 'px'; ring.style.width = (r.width + pad * 2) + 'px'; ring.style.height = (r.height + pad * 2) + 'px';
    if (vw <= 640) {                                                                   // 휴대폰: 아래쪽 카드(CSS). 짚은 칸이 아래쪽이라 가리면 위쪽으로
      arrow.style.display = 'none'; card.classList.toggle('top', r.bottom > vh - card.offsetHeight - 16 && r.top > card.offsetHeight + 64); return;
    }
    var cw = card.offsetWidth, ch = card.offsetHeight, cx = r.left + r.width / 2, cy = r.top + r.height / 2, x, y, side = null;
    function clampX(v) { return Math.min(Math.max(12, v), vw - cw - 12); }
    function clampY(v) { return Math.min(Math.max(12, v), vh - ch - 12); }
    if (r.bottom + gap + ch <= vh - 8) { side = 'up'; x = clampX(cx - cw / 2); y = r.bottom + gap; }
    else if (r.top - gap - ch >= 8) { side = 'down'; x = clampX(cx - cw / 2); y = r.top - gap - ch; }
    else if (r.right + gap + cw <= vw - 8) { side = 'left'; x = r.right + gap; y = clampY(cy - ch / 2); }
    else if (r.left - gap - cw >= 8) { side = 'right'; x = r.left - gap - cw; y = clampY(cy - ch / 2); }
    else { x = vw - cw - 20; y = vh - ch - 20; }
    card.style.left = x + 'px'; card.style.top = y + 'px';
    if (!side) { arrow.style.display = 'none'; return; }
    arrow.style.display = ''; arrow.className = 'sg-arrow ' + side; arrow.style.left = arrow.style.top = '';
    if (side === 'up' || side === 'down') arrow.style.left = Math.min(Math.max(18, cx - x), cw - 18) + 'px';
    else arrow.style.top = Math.min(Math.max(18, cy - y), ch - 18) + 'px';
  }

  function go(i) { if (!st) return; var j = Math.max(0, Math.min(st.steps.length - 1, i)); st.dir = j < st.i ? -1 : 1; st.i = j; render(); }
  function next() { if (!st) return; if (st.i >= st.steps.length - 1) stop(); else go(st.i + 1); }
  function stop() {
    if (!st) return;
    var s = st; st = null; if (s.mode === 'page') markSeen(s.page); markSeen(s.page + '.' + s.tab); clearTimeout(s.rp);
    clearInterval(s.tick);
    if (s.leave) try { s.leave(); } catch (e) {}
    Object.keys(s.undo).forEach(function (k) { try { s.undo[k](); } catch (e) {} });       // 시연으로 바꾼 보기를 원래대로
    if (s.css && s.css.parentNode) s.css.parentNode.removeChild(s.css);
    doc.removeEventListener('keydown', onKey, true); root.removeEventListener('resize', onResize); doc.removeEventListener('scroll', onResize, true);
    if (s.fd) try { s.fd.removeEventListener('scroll', onResize, true); } catch (e) {}
    s.el.classList.add('out'); setTimeout(function () { if (s.el.parentNode) s.el.parentNode.removeChild(s.el); }, 220);
    if (s.back && shown(s.back) && !s.back.classList.contains('active')) s.back.click();   // 안내 전에 보던 탭으로
    var h = $('sgHelp'); if (h) try { h.focus({ preventScroll: true }); } catch (e) {}
  }
  function onKey(e) {
    if (!st) return;
    if (e.key === 'Escape') { e.preventDefault(); stop(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(st.i - 1); }
    else if (e.key === 'Tab') {                                                       // 안내 안에서만 돌게
      var f = [].slice.call(st.el.querySelectorAll('button')).filter(shown); if (!f.length) return;
      var a = doc.activeElement, i = f.indexOf(a);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  }
  var rz = 0;
  function onResize() { if (!st) return; cancelAnimationFrame(rz); rz = requestAnimationFrame(function () { if (!st) return;
    var s = st.steps[st.i];
    if (st.cur && s && s.at && st.cur.some(function (e) { return !e.isConnected; })) { var r = resolve(s); if (r) st.cur = r.els; }   // 화면이 다시 그려져 짚던 칸이 바뀐 경우(목록을 늦게 다시 그림 등)
    place(st.cur ? rectOf(st.cur) : null, st.el.querySelector('.sg-card'), st.el.querySelector('.sg-ring')); }); }

  // 안내 묶기(2026-11-01 사용자 결정 — "너무 많다"): 페이지 안내 = 첫 장 → 위쪽 탭 소개(탭을 바꾸지 않고 버튼만 짚음) → 지금 탭의 칸 설명 → 다시 보기.
  // 다른 탭의 칸 설명은 그 탭에 처음 들어갈 때 따로(탭 안내). 처음 로그인하면 지금 탭 = 첫 탭(24시간 예보 / 이동 현황)
  // manual = [? 사용법]으로 다시 볼 때: 위쪽 탭 소개(처음 한 번이면 됨)와 마지막 '다시 보기' 장은 빼고 첫 장 → 지금 탭 칸 설명만(2026-11-02 사용자 결정)
  function pageSteps(page, tab, manual) {
    var all = page === 'equip' ? equipSteps() : snowSteps();
    if (manual) return all.filter(function (x) { return !x.at && !x.tab && !x.last; }).concat(all.filter(function (x) { return x.at && x.tab === tab; }));
    return all.filter(function (x) { return !x.at && !x.last; }).map(function (x) { return x.tab ? Object.assign({ ov: true }, x) : x; })
      .concat(all.filter(function (x) { return x.at && x.tab === tab; }), all.filter(function (x) { return x.last; }));
  }
  function tabSteps(page, tab) { return (page === 'equip' ? equipSteps() : snowSteps()).filter(function (x) { return x.at && x.tab === tab; }); }
  function activeTab(page) { var b = doc.querySelector(page === 'equip' ? '.eq-btn.active' : '.tab-btn.active'); return b ? (page === 'equip' ? b.dataset.eqtab : b.dataset.tab) : null; }

  function start(page, onlyTab, manual) {
    if (!me() || !doc.body.classList.contains('authed')) return;
    if (st) stop();
    page = page || curPage();
    var back = doc.querySelector(page === 'equip' ? '.eq-btn.active' : '.tab-btn.active'), tab = onlyTab || activeTab(page) || (page === 'equip' ? 'move' : 'forecast');
    var steps = onlyTab ? tabSteps(page, onlyTab) : pageSteps(page, tab, manual);
    if (!steps.length) return;
    st = { page: page, tab: tab, mode: onlyTab ? 'tab' : 'page', steps: steps, i: 0, dir: 1, tok: 0, cur: null, el: build(), back: back, openedAt: Date.now(), fd: page === 'equip' ? fdoc() : null, undo: {}, leave: null, css: null };
    st.tick = setInterval(onResize, 400);                                            // 지도 이동·늦게 그려지는 목록을 따라 테두리 위치를 맞춤
    if (st.fd) try {                                                                   // 안내 중에는 마우스를 올려야 보이던 [＋] 등도 보이게
      st.css = st.fd.createElement('style'); st.css.textContent = '.slot .btn.sm{opacity:1 !important}'; st.fd.head.appendChild(st.css);
    } catch (e) {}
    doc.addEventListener('keydown', onKey, true); root.addEventListener('resize', onResize); doc.addEventListener('scroll', onResize, true);
    if (st.fd) try { st.fd.addEventListener('scroll', onResize, true); } catch (e) {}   // 장비 지원 안쪽 화면이 스크롤돼도 테두리가 따라감
    render();
  }
  // 저절로 열기: 그 페이지를 이 브라우저·아이디로 처음 볼 때 한 번
  function auto(page) {
    if (!AUTO || st || waiting[page] || seen(page) || !me()) return;
    waiting[page] = true;
    initP.then(function () { setTimeout(function () { waiting[page] = false; if (!st && !seen(page) && curPage() === page) start(page); }, page === 'equip' ? 1200 : 700); });
  }
  // 탭에 처음 들어가면 그 탭 칸 설명(사람이 직접 누른 탭만 — 안내가 대신 누른 것은 isTrusted 가 아님). 페이지 안내를 아직 안 봤으면 페이지 안내가 먼저
  function autoTab(page, tab) {
    if (!AUTO || st || !tab || !seen(page) || seen(page + '.' + tab) || waiting[page + '.' + tab]) return;
    waiting[page + '.' + tab] = true;
    setTimeout(function () { waiting[page + '.' + tab] = false; if (!st && curPage() === page && activeTab(page) === tab && !seen(page + '.' + tab)) start(page, tab); }, page === 'equip' ? 600 : 400);
  }
  function init() {
    if (inited || !me()) return; inited = true;
    var box = $('ssUser'), host = box && box.parentNode;
    if (host && !$('sgHelp')) {
      var b = doc.createElement('button'); b.type = 'button'; b.id = 'sgHelp'; b.className = 'sg-help'; b.title = '이 페이지 사용법 다시 보기';
      b.innerHTML = '<span class="sg-help-q" aria-hidden="true">?</span>사용법';
      b.onclick = function () { start(curPage(), null, true); };
      host.insertBefore(b, box);
    }
    doc.addEventListener('click', function (e) {
      if (!e.isTrusted || st) return;
      var t = e.target.closest && e.target.closest('.tab-btn[data-tab], .eq-btn[data-eqtab]'); if (!t) return;
      if (t.classList.contains('eq-btn')) autoTab('equip', t.dataset.eqtab); else autoTab('snow', t.dataset.tab);
    });
    var m = me();
    if (m.role === 'hq' && m.hq_id && root.SSAuth && root.SSAuth.rest) {           // 강원본부인지(본부 이름) — 안내 내용만 달라짐
      initP = root.SSAuth.rest('hqs?select=id,name&id=eq.' + encodeURIComponent(m.hq_id)).then(function (r) {
        var h = r && r.ok && Array.isArray(r.json) ? r.json.filter(function (x) { return x.id === m.hq_id; })[0] : null; hqName = h ? h.name : null;
      }).catch(function () {});
    }
    return initP;
  }
  root.SSGuide = { init: init, auto: auto, start: start, stop: stop, active: function () { return st ? { page: st.page, mode: st.mode, i: st.i, n: st.steps.length, title: st.steps[st.i].title, tab: st.steps[st.i].tab || null, el: !!st.steps[st.i].at, titles: st.steps.map(function (x) { return x.title; }) } : null; } };
})(window);
