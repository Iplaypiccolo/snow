/* ============================================================
   forecast/warn.js — "기관별 예보" 탭의 기상특보(2026-11-22 사용자)
   - 지도: 아래 범례에서 대설·한파·강풍 중 하나만 체크 → 그 특보가 난 특보구역을 칠함(색이 겹치면 안 보여 한 번에 하나).
     대설 = 빨강, 한파 = 파랑, 강풍 = 노랑 계열, 예비특보 < 주의보 < 경보 순으로 진하게. 발효 전(발표만 됨)은 빗금 + 말풍선에 발효 시각.
     특보를 켜면 예보 격자 색은 끔(칸 글자는 그대로) — ui.js drawCells 가 ForecastWarn.on() 을 봄.
   - 경계: data/warning_areas.json(tools/build_warning_areas.py — 행정동 경계 × 날씨누리 특보구역 표, 제주·섬·구례산간 뺌). 처음 켤 때 한 번 받음
   - 특보: warning_active_list(서버가 10분마다 기상청에서 받은 지금 특보 전체, 로그인한 모든 아이디). 탭을 열 때와 5분 지나 다시 그릴 때 받음
   - 옆 목록: 지사 이름 옆에 그 지사 특보구역의 대설·한파·강풍 중 가장 높은 단계(발효 전은 테두리만)
   - 특보구역 관리(범례의 단추): 지사마다 특보를 볼 구역 = 관할 고속도로가 지나는 구역(자동) − 뺀 것 + 더한 것.
     관리자 = 바로 더하기·빼기·되살리기 + 요청 승인·반려 / 지사 = 자기 지사, 본부 = 자기 본부 지사만 사유를 적어 요청(마이그레이션 92·111) / 그 밖 = 보기만
   ============================================================ */
(function () {
  'use strict';
  var KINDS = ['대설', '한파', '강풍'];
  var COL = { '대설': ['#f4b4ab', '#e0584a', '#a3150f'], '한파': ['#b9d2f3', '#4f86d9', '#163a8f'], '강풍': ['#f8e79a', '#f0bd1e', '#a87900'] };      // 예비·주의보·경보
  var LV = { '예비': 0, '주의': 1, '경보': 2 }, LVN = { '예비': '예비특보', '주의': '주의보', '경보': '경보' };
  var KEY = 'ss_fc_warn', ACT_TTL = 5 * 60e3;
  var W = { kind: loadKind(), areas: null, areasP: null, act: null, actAt: 0, actP: null, pane: null, rend: null, layer: null, ll: {}, pend: null, mgr: null };
  var hooks = { redraw: function () {} };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function p2(n) { return String(n).padStart(2, '0'); }
  function loadKind() { try { var k = localStorage.getItem(KEY); return KINDS.indexOf(k) >= 0 ? k : ''; } catch (e) { return ''; } }
  function saveKind() { try { localStorage.setItem(KEY, W.kind); } catch (e) {} }
  function me() { return window.SS_ME || null; }
  function now() { return typeof window.__fcNow === 'function' ? window.__fcNow() : Date.now(); }
  // 예비특보 발효 시각은 기상청 약속(02:59 = 00~03시 …) → "새벽(00~03시)"
  var SLOT = ['새벽', '새벽', '아침', '오전', '낮', '늦은 오후', '저녁', '밤'];
  function fmtT(iso, level, ef) {
    var d = iso ? new Date(iso) : null; if (!d || isNaN(d)) return '-';
    var md = (d.getMonth() + 1) + '/' + d.getDate(), h = d.getHours(), m = d.getMinutes();
    if (ef && level === '예비' && m >= 58 && (h + 1) % 3 === 0) { var e = (h + 1) % 24 || 24; return md + ' ' + SLOT[(e / 3 - 1) | 0] + '(' + p2(e - 3) + '~' + p2(e) + '시)'; }
    return md + ' ' + p2(h) + ':' + p2(m);
  }
  function started(r) { return !r.tm_ef || Date.parse(r.tm_ef) <= now(); }

  /* ---------- 서버·자료 ---------- */
  function refresh(force) {
    if (!force && W.act && now() - W.actAt < ACT_TTL) return Promise.resolve(W.act);
    if (W.actP) return W.actP;
    W.actP = SSAuth.authed('/rest/v1/rpc/warning_active_list', { method: 'POST', body: {} }).then(function (r) {
      W.actP = null; if (r && r.ok && r.json) { W.act = r.json; W.actAt = now(); } return W.act;
    }).catch(function () { W.actP = null; return W.act; });
    var m = me(); if (m && m.role === 'admin') loadPending();
    return W.actP;
  }
  function loadPending() {
    return SSAuth.authed('/rest/v1/rpc/zone_request_list', { method: 'POST', body: {} }).then(function (r) {
      if (r && r.ok && Array.isArray(r.json)) { W.pend = r.json.length; paintMgrBtn(); }
    }).catch(function () {});
  }
  function ensureAreas() {
    if (W.areas) return Promise.resolve(W.areas);
    if (!W.areasP) W.areasP = fetch('data/warning_areas.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { W.areas = j; return j; }).catch(function () { W.areasP = null; return null; });
    return W.areasP;
  }
  function latlngs(code) {           // 0.001도 정수 차분 → [[ [lat,lng]… ]…]
    if (W.ll[code]) return W.ll[code];
    var z = W.areas.zones[code], sc = W.areas.scale;
    W.ll[code] = z.p.map(function (poly) { return poly.map(function (r) { var x = 0, y = 0, o = []; for (var i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; o.push([y / sc, x / sc]); } return o; }); });
    return W.ll[code];
  }
  // 종류 하나의 구역별 상태 { code: {now: 단계|null, fut: 단계|null, rows:[…]} }
  function zoneMap(kind) {
    var out = {}; ((W.act && W.act.rows) || []).forEach(function (r) {
      if (r.kind !== kind) return;
      var z = out[r.zone] || (out[r.zone] = { now: null, fut: null, rows: [], name: r.name });
      z.rows.push(r);
      var k = started(r) ? 'now' : 'fut';
      if (z[k] == null || LV[r.level] > LV[z[k]]) z[k] = r.level;
    });
    return out;
  }

  /* ---------- 지도 ---------- */
  function ensurePane(map) {
    if (W.pane) return;
    W.pane = map.createPane('fwPane'); W.pane.style.zIndex = 390;        // 노선·격자(400)보다 아래
    W.rend = L.svg({ pane: 'fwPane' }); W.layer = L.layerGroup().addTo(map);
    var css = '', defs = '';
    KINDS.forEach(function (k, ki) { COL[k].forEach(function (c, li) {
      var id = 'fw-h-' + ki + '-' + li;
      defs += '<pattern id="' + id + '" patternUnits="userSpaceOnUse" width="9" height="9" patternTransform="rotate(45)"><rect width="9" height="9" fill="#fff" fill-opacity=".35"/><rect width="4" height="9" fill="' + c + '"/></pattern>';
      css += '.leaflet-pane path.' + id + '{fill:url(#' + id + ')}';
    }); });
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    W.defs = defs;
  }
  function addDefs() {
    var svg = W.rend && W.rend._container; if (!svg || svg.querySelector('#fw-h-0-0')) return;
    var d = document.createElementNS('http://www.w3.org/2000/svg', 'defs'); d.innerHTML = W.defs; svg.insertBefore(d, svg.firstChild);
  }
  function tip(name, rows) {
    return '<b>' + esc(name) + '</b>' + rows.slice().sort(function (a, b) { return LV[b.level] - LV[a.level]; }).map(function (r) {
      return '<br>' + esc(r.kind + (r.level === '예비' ? ' 예비특보' : r.level === '주의' ? '주의보' : '경보')) + ' · 발표 ' + esc(fmtT(r.tm_fc)) + ' · ' + (started(r) ? '발효 ' : '<b>발효 예정 ') + esc(fmtT(r.tm_ef, r.level, true)) + (started(r) ? '' : '</b>');
    }).join('');
  }
  function draw(map) {
    if (!map) return;
    ensurePane(map); W.layer.clearLayers();
    if (!W.kind) return;
    if (!W.areas) { ensureAreas().then(function (a) { if (a) hooks.redraw(); }); return; }
    var ki = KINDS.indexOf(W.kind), zm = zoneMap(W.kind), codes = Object.keys(W.areas.zones);
    codes.forEach(function (code) {           // 모든 구역 테두리(옅게) — 어디까지가 한 구역인지
      L.polygon(latlngs(code), { renderer: W.rend, interactive: false, fill: false, color: '#3d4852', weight: 1.1, opacity: 0.75 }).addTo(W.layer);
    });
    codes.forEach(function (code) {
      var z = zm[code]; if (!z) return;
      var lv = z.now != null ? z.now : z.fut, li = LV[lv], fut = z.now == null, c = COL[W.kind][li];
      var poly = L.polygon(latlngs(code), { renderer: W.rend, color: COL[W.kind][2], weight: fut ? 1.2 : 1.4, dashArray: fut ? '5 4' : null, opacity: 0.9,
        fillColor: c, fillOpacity: fut ? 0.9 : 0.6, className: fut ? 'fw-h-' + ki + '-' + li : '' });
      poly.bindTooltip(tip(W.areas.zones[code].n, z.rows), { sticky: true, opacity: 1, className: 'gr-tip' });
      poly.addTo(W.layer);
    });
    addDefs();
  }

  /* ---------- 범례·목록 ---------- */
  function stamp() {
    var s = W.act && W.act.state; if (!s || !s.fetched_at) return W.act ? '아직 받지 못함' : '';
    var d = new Date(s.fetched_at), old = now() - d > 30 * 60e3;
    return (old ? '<span class="fc-stale">' : '') + '기상청 ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ' 받음' + (old ? '(30분 넘음)</span>' : '');
  }
  function legendHtml() {
    var k = W.kind, zm = k ? zoneMap(k) : {}, n = W.areas ? Object.keys(zm).filter(function (c) { return W.areas.zones[c]; }).length : 0;      // 지도에 칠한 구역만(제주·섬·구례산간 특보는 안 셈)
    var chk = KINDS.map(function (x, i) {
      return '<label class="fw-k k' + i + '"><input type="checkbox" data-fwk="' + x + '"' + (k === x ? ' checked' : '') + '><span>' + x + '</span></label>';
    }).join('');
    var ramp = k ? '<span class="fw-ramp">' + ['예비', '주의', '경보'].map(function (l, i) { return '<span><i style="background:' + COL[k][i] + '"></i>' + LVN[l] + '</span>'; }).join('') +
      '<span><i class="fw-hatch" style="background:repeating-linear-gradient(45deg,' + COL[k][1] + ' 0 3px,#fff 3px 6px)"></i>발효 전</span></span>' +
      '<span class="fw-n">' + (W.areas ? n + '곳' : '불러오는 중…') + '</span>' : '';
    var m = me();
    return '<span class="fw-leg" role="group" aria-label="지도에 칠할 특보(하나만)"><span class="fc-legend-t fw-t">특보</span>' + chk + ramp +
      '<span class="fw-st">' + stamp() + '</span>' +
      (m ? '<button type="button" class="fw-mgr" data-fwmgr>' + mgrLabel() + '</button>' : '') +
      (k ? '<span class="fw-src">경계: 통계청 SGIS 행정동(vuski/admdongkor)</span>' : '') + '</span>';
  }
  function mgrLabel() { return '특보구역 관리' + (W.pend ? ' <b class="fw-pend">요청 ' + W.pend + '</b>' : ''); }
  function paintMgrBtn() { var b = document.querySelector('#view-forecast [data-fwmgr]'); if (b) b.innerHTML = mgrLabel(); }
  // 지사 한 곳의 특보 표시(대설·한파·강풍 중 있는 것, 종류마다 가장 높은 단계)
  function badges(bid) {
    var rows = (W.act && W.act.rows) || [], best = {};
    rows.forEach(function (r) {
      if (KINDS.indexOf(r.kind) < 0 || !r.branches || r.branches.indexOf(bid) < 0) return;
      var b = best[r.kind], s = started(r), rank = LV[r.level] + (s ? 10 : 0);
      if (!b || rank > b.rank) best[r.kind] = { rank: rank, level: r.level, now: s };
    });
    return KINDS.filter(function (k) { return best[k]; }).map(function (k) {
      var b = best[k], i = KINDS.indexOf(k), c = COL[k][LV[b.level]];
      return '<b class="fw-b' + (b.now ? '' : ' fut') + '" style="' + (b.now ? 'background:' + c + ';border-color:' + COL[k][2] + (LV[b.level] === 2 ? ';color:#fff' : '') : 'border-color:' + COL[k][2] + ';color:' + COL[k][2]) +
        '" title="' + esc(k + ' ' + LVN[b.level] + (b.now ? '' : ' (발효 전)')) + '">' + k + (b.level === '예비' ? '예비' : b.level === '주의' ? '주의' : '경보') + '</b>';
    }).join('');
  }

  /* ---------- 특보구역 관리 창 ---------- */
  function fail(r, msg) { var m = r && r.json && r.json.message; return m && /[가-힣]/.test(m) ? m : msg; }
  function mgrLoad() {
    var a = SSAuth.authed('/rest/v1/rpc/branch_zone_list', { method: 'POST', body: {} }),
        o = SSAuth.rest('branch_zone_overrides?select=branch_id,zone_code,include'),
        z = SSAuth.rest('warning_zones?select=zone_code,name,sp,up_code&zone_code=like.L*&order=zone_code'),
        q = SSAuth.authed('/rest/v1/rpc/zone_request_list', { method: 'POST', body: {} }),
        b = SSAuth.rest('branches?select=id,name,hq_id&order=id'),
        h = SSAuth.rest('hqs?select=id,name,is_private,sort&order=sort.asc.nullslast,id.asc');
    return Promise.all([a, o, z, q, b, h]).then(function (x) {
      if (!x[0].ok || !x[1].ok || !x[2].ok || !x[4].ok) return { err: '특보구역을 불러오지 못했습니다.' };
      var zones = x[2].json, byCode = {}; zones.forEach(function (z) { byCode[z.zone_code] = z; });
      var hq = {}, ord = {}; (x[5].ok ? x[5].json : []).forEach(function (r, i) { if (!r.is_private) { hq[r.id] = r.name; ord[r.id] = i; } });
      var brs = (x[4].json || []).filter(function (b) { return !x[5].ok || hq[b.hq_id] != null; })      // 본부 목록을 못 받으면 지사는 모두(본부 이름 없이)
        .sort(function (a, b) { return (ord[a.hq_id] || 0) - (ord[b.hq_id] || 0) || (a.id < b.id ? -1 : 1); });      // 본부 순서 → 지사 번호
      return { list: x[0].json || {}, over: x[1].json || [], zones: zones, byCode: byCode, reqs: x[3].ok ? x[3].json || [] : [], branches: brs, hq: hq };
    }).catch(function () { return { err: SSAuth.NET_MSG }; });
  }
  function canAsk(bid) {
    var m = me(), b = W.mgr && W.mgr.d.branches.filter(function (x) { return x.id === bid; })[0]; if (!m || !b) return false;
    return (m.role === 'branch' && m.branch_id === bid) || (m.role === 'hq' && m.hq_id === b.hq_id);
  }
  function zlabel(code) {
    var d = W.mgr.d, z = d.byCode[code]; if (!z) return code;
    var u = d.byCode[z.up_code]; while (u && !/02$/.test(u.sp || '') && d.byCode[u.up_code]) u = d.byCode[u.up_code];
    return (u && u.zone_code !== code && /02$/.test(u.sp || '') ? u.name + ' · ' : '') + z.name;
  }
  function firstBranch() {
    var m = me() || {}, bs = W.mgr.d.branches;
    if (m.role === 'branch' && m.branch_id) return m.branch_id;
    if (m.role === 'hq') { var f = bs.filter(function (b) { return b.hq_id === m.hq_id; })[0]; if (f) return f.id; }
    return bs.length ? bs[0].id : '';
  }
  function openMgr(bid) {
    closeMgr();
    var box = document.createElement('div'); box.className = 'fw-modal'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', '특보구역 관리');
    box.innerHTML = '<div class="fw-back" data-fwclose></div><div class="fw-sheet"><button type="button" class="fw-x" data-fwclose aria-label="닫기">닫기</button><h2>특보구역 관리</h2><div id="fw-body" class="muted">불러오는 중…</div></div>';
    document.body.appendChild(box);
    W.mgr = { box: box, d: null, bid: bid || null, ask: null, last: document.activeElement };
    box.addEventListener('click', mgrClick); document.addEventListener('keydown', mgrKey);      // 다시 그리면 누른 단추가 사라져 창 밖에 초점이 갈 수 있어 문서 전체에서
    box.querySelector('.fw-x').focus();
    mgrLoad().then(function (d) {
      if (!W.mgr || W.mgr.box !== box) return;
      if (d.err) { $('fw-body').textContent = d.err; return; }
      W.mgr.d = d; if (!W.mgr.bid) W.mgr.bid = firstBranch(); renderMgr();
    });
  }
  function mgrKey(e) { if (e.key === 'Escape' && W.mgr) closeMgr(); }
  function closeMgr() { if (!W.mgr) return; var l = W.mgr.last; document.removeEventListener('keydown', mgrKey); W.mgr.box.remove(); W.mgr = null; if (l && l.focus) l.focus(); }
  function renderMgr() {
    var M = W.mgr, d = M.d, bid = M.bid, m = me() || {}, adm = m.role === 'admin', ask = canAsk(bid);
    var cur = d.list[bid] || [], has = {}; cur.forEach(function (z) { has[z[0]] = 1; });
    var pendOf = function (c) { return d.reqs.filter(function (q) { return q.branch_id === bid && q.zone_code === c; })[0]; };
    var bname = function (id) { var b = d.branches.filter(function (x) { return x.id === id; })[0]; return b ? b.name : id; };
    var act = function (c, action, label, inc) {
      var q = pendOf(c); if (q) return '<span class="fw-tag req">' + (q.action === 'add' ? '더하기' : '빼기') + ' 요청 중</span>' + (q.mine ? '<button type="button" class="fw-btn" data-fwcancel="' + q.id + '">요청 취소</button>' : '');
      if (adm) return '<button type="button" class="fw-btn" data-fwset="' + esc(c) + '" data-fwinc="' + inc + '">' + label + '</button>';
      return ask ? '<button type="button" class="fw-btn" data-fwask="' + esc(c) + '" data-fwact="' + action + '">' + label + ' 요청</button>' : '';
    };
    var askBox = function (c, action) {
      var k = M.ask; if (!k || k.code !== c || k.action !== action) return '';
      return '<div class="fw-ask"><input id="fw-reason" maxlength="200" placeholder="사유(꼭 적어 주세요)" aria-label="' + (action === 'add' ? '더하기' : '빼기') + ' 요청 사유">' +
        '<button type="button" class="fw-btn pri" data-fwsend>요청 보내기</button><button type="button" class="fw-btn" data-fwaskx>취소</button></div>';
    };
    var out = d.over.filter(function (o) { return o.branch_id === bid && !o.include; });
    var leaf = d.zones.filter(function (z) { return /1[34]$/.test(z.sp || '') && !has[z.zone_code] && !/^L109/.test(z.zone_code); })
      .map(function (z) { return [z.zone_code, zlabel(z.zone_code)]; }).sort(function (a, b) { return a[1].localeCompare(b[1], 'ko'); });
    var reqs = adm && d.reqs.length ? '<h3>처리를 기다리는 요청 ' + d.reqs.length + '건</h3><ul class="fw-list">' + d.reqs.map(function (q) {
      return '<li><span><b>' + esc(bname(q.branch_id)) + '</b> · ' + esc(zlabel(q.zone_code)) + ' <span class="fw-tag">' + (q.action === 'add' ? '더하기' : '빼기') + '</span><br><span class="muted">' + esc(q.reason) + ' — ' + esc(q.by || '') + '</span></span>' +
        '<span><button type="button" class="fw-btn pri" data-fwok="' + q.id + '">승인</button><button type="button" class="fw-btn" data-fwno="' + q.id + '">반려</button></span></li>';
    }).join('') + '</ul>' : '';
    var opts = d.branches.map(function (b) { return '<option value="' + esc(b.id) + '"' + (b.id === bid ? ' selected' : '') + '>' + esc((d.hq[b.hq_id] ? d.hq[b.hq_id] + ' · ' : '') + b.name) + '</option>'; }).join('');
    var who = adm ? '관리자는 바로 더하고 뺍니다.' : ask ? '더하기·빼기는 사유를 적어 관리자에게 요청합니다. 관리자가 승인하면 바뀝니다.'
      : m.role === 'branch' || m.role === 'hq' ? '이 지사는 볼 수만 있습니다(' + (m.role === 'branch' ? '자기 지사' : '자기 본부 지사') + '만 요청할 수 있음).' : '볼 수만 있습니다(요청은 지사·본부 아이디).';
    $('fw-body').className = '';
    $('fw-body').innerHTML = reqs + '<label class="fw-pick">지사 <select id="fw-br">' + opts + '</select></label><p class="muted">' + esc(who) + ' 자동 = 관할 고속도로가 지나는 구역.</p>' +
      '<h3>들어간 구역 ' + cur.length + '곳</h3>' + (cur.length ? '<ul class="fw-list">' + cur.map(function (z) {
        return '<li><span>' + esc(zlabel(z[0])) + ' <span class="fw-tag">' + (z[2] === 'manual' ? '더함' : '자동') + '</span></span><span>' + act(z[0], 'remove', '빼기', z[2] === 'manual' ? '' : '0') + '</span>' + askBox(z[0], 'remove') + '</li>';
      }).join('') + '</ul>' : '<p class="muted">없음 — 관할 고속도로가 없거나 모두 뺐습니다.</p>') +
      (out.length ? '<h3>뺀 구역</h3><ul class="fw-list">' + out.map(function (o) { return '<li><span>' + esc(zlabel(o.zone_code)) + '</span><span>' + act(o.zone_code, 'add', '되살리기', '') + '</span>' + askBox(o.zone_code, 'add') + '</li>'; }).join('') + '</ul>' : '') +
      (adm || ask ? '<h3>구역 더하기</h3><div class="fw-add"><select id="fw-add"><option value="">구역 고르기</option>' + leaf.map(function (z) { return '<option value="' + esc(z[0]) + '">' + esc(z[1]) + (pendOf(z[0]) ? ' (요청 중)' : '') + '</option>'; }).join('') + '</select>' +
        '<button type="button" class="fw-btn pri" data-fwaddbtn>' + (adm ? '더하기' : '더하기 요청') + '</button></div>' + (M.ask && M.ask.free ? askBox(M.ask.code, 'add') : '') : '') +
      (!adm ? d.reqs.filter(function (q) { return q.mine && q.branch_id === bid && !has[q.zone_code] && !out.some(function (o) { return o.zone_code === q.zone_code; }); })
        .map(function (q) { return '<p class="muted">' + esc(zlabel(q.zone_code)) + ' — 더하기 요청 중 <button type="button" class="fw-btn" data-fwcancel="' + q.id + '">요청 취소</button></p>'; }).join('') : '');
    var sel = $('fw-br'); if (sel) sel.onchange = function () { M.bid = sel.value; M.ask = null; renderMgr(); };
    if (M.ask && $('fw-reason')) $('fw-reason').focus();
  }
  function reloadMgr(msg) {
    return mgrLoad().then(function (d) {
      if (!W.mgr) return; if (!d.err) W.mgr.d = d; W.mgr.ask = null; renderMgr(); if (msg) note(msg);
      refresh(true).then(function () { hooks.redraw(); });
    });
  }
  function note(msg, bad) {
    var b = $('fw-body'); if (!b) return; var p = document.createElement('p'); p.className = 'fw-note' + (bad ? ' bad' : ''); p.textContent = msg; b.insertBefore(p, b.firstChild);
  }
  function mgrClick(e) {
    var t = e.target, M = W.mgr; if (!M) return;
    if (t.closest('[data-fwclose]')) { closeMgr(); return; }
    var bid = M.bid, x;
    if ((x = t.closest('[data-fwset]'))) {
      var inc = x.dataset.fwinc, code = x.dataset.fwset, body = inc === '' ? null : inc === '0' ? false : true;
      var q = 'branch_zone_overrides?branch_id=eq.' + encodeURIComponent(bid) + '&zone_code=eq.' + encodeURIComponent(code);
      var p = body === null ? SSAuth.authed('/rest/v1/' + q, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
        : SSAuth.authed('/rest/v1/branch_zone_overrides?on_conflict=branch_id,zone_code', { method: 'POST', body: { branch_id: bid, zone_code: code, include: body }, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
      p.then(function (r) { if (!r.ok) return note(fail(r, '바꾸지 못했습니다(관리자만).'), true); reloadMgr('특보구역을 바꿨습니다.'); }).catch(function () { note(SSAuth.NET_MSG, true); });
      return;
    }
    if (t.closest('[data-fwaddbtn]')) {
      var c = ($('fw-add') || {}).value; if (!c) return note('더할 구역을 고르세요.', true);
      var m = me() || {};
      if (m.role === 'admin') {
        var o = M.d.over.filter(function (v) { return v.branch_id === bid && v.zone_code === c; })[0];
        var pr = o && !o.include ? SSAuth.authed('/rest/v1/branch_zone_overrides?branch_id=eq.' + encodeURIComponent(bid) + '&zone_code=eq.' + encodeURIComponent(c), { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
          : SSAuth.authed('/rest/v1/branch_zone_overrides?on_conflict=branch_id,zone_code', { method: 'POST', body: { branch_id: bid, zone_code: c, include: true }, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
        pr.then(function (r) { if (!r.ok) return note(fail(r, '바꾸지 못했습니다(관리자만).'), true); reloadMgr('구역을 더했습니다.'); }).catch(function () { note(SSAuth.NET_MSG, true); });
      } else { M.ask = { code: c, action: 'add', free: true }; renderMgr(); }
      return;
    }
    if ((x = t.closest('[data-fwask]'))) { M.ask = { code: x.dataset.fwask, action: x.dataset.fwact }; renderMgr(); return; }
    if (t.closest('[data-fwaskx]')) { M.ask = null; renderMgr(); return; }
    if (t.closest('[data-fwsend]')) {
      var reason = (($('fw-reason') || {}).value || '').trim(); if (!reason) { note('사유를 적어 주세요.', true); return; }
      SSAuth.authed('/rest/v1/rpc/zone_request_create', { method: 'POST', body: { p_branch: bid, p_zone: M.ask.code, p_action: M.ask.action, p_reason: reason } })
        .then(function (r) { if (!r.ok) return note(fail(r, '요청을 보내지 못했습니다.'), true); reloadMgr('요청했습니다. 관리자가 승인하면 바뀝니다.'); }).catch(function () { note(SSAuth.NET_MSG, true); });
      return;
    }
    if ((x = t.closest('[data-fwcancel]'))) {
      SSAuth.authed('/rest/v1/rpc/zone_request_cancel', { method: 'POST', body: { p_id: +x.dataset.fwcancel } })
        .then(function (r) { if (!r.ok) return note(fail(r, '취소하지 못했습니다.'), true); reloadMgr('요청을 취소했습니다.'); }).catch(function () { note(SSAuth.NET_MSG, true); });
      return;
    }
    if ((x = t.closest('[data-fwok],[data-fwno]'))) {
      var ok = !!x.dataset.fwok, id = +(x.dataset.fwok || x.dataset.fwno), rq = M.d.reqs.filter(function (v) { return v.id === id; })[0];
      SSAuth.authed('/rest/v1/rpc/zone_request_resolve', { method: 'POST', body: { p_id: id, p_approve: ok } })
        .then(function (r) { if (!r.ok) return note(fail(r, '처리하지 못했습니다.'), true); if (rq) M.bid = rq.branch_id; W.pend = Math.max(0, (W.pend || 1) - 1); paintMgrBtn();
          reloadMgr(ok ? '승인해 특보구역을 바꿨습니다.' : '반려했습니다.'); }).catch(function () { note(SSAuth.NET_MSG, true); });
    }
  }

  /* ---------- ui.js 와 잇기 ---------- */
  function onChange(e) {
    var k = e.target && e.target.dataset && e.target.dataset.fwk; if (!k) return false;
    W.kind = e.target.checked ? k : ''; saveKind();                // 하나만: 다른 종류는 저절로 풀림(범례를 다시 그림)
    if (W.kind) { ensureAreas().then(function () { hooks.redraw(); }); refresh(); }
    hooks.redraw(); return true;
  }
  function onClick(e, bid) {
    var b = e.target.closest && e.target.closest('[data-fwmgr]'); if (!b) return false;
    openMgr(bid); return true;
  }
  window.ForecastWarn = {
    on: function () { return !!W.kind; }, kind: function () { return W.kind; }, refresh: refresh, draw: draw, legendHtml: legendHtml, badges: badges,
    onChange: onChange, onClick: onClick, openMgr: openMgr, setRedraw: function (f) { hooks.redraw = f; }, _state: function () { return W; }
  };
})();
