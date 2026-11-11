/* ============================================================
   이동 현황 → 1쪽 보고서 「신속대응팀 제설장비 지원 현황」 (2026-11-02 사용자 요청, 사용자가 준 한글 양식을 본뜸)
   - [보고서 보기]: 화면에 같은 모양으로 미리 보기 / [Word 받기]: .docx(워드) 파일로 내려받기
   - 자료는 이동 현황 표와 같은 계산(app.js 의 movesOn·장비가 지금 있는 지사 m.pos·강원 신속대응팀 체크)을 그대로 씀
   - 도착일시: 그 지사로 새로 오는 장비 중 가장 빠른 시각. 새로 오는 장비가 없고 전날부터 이어 지원 중이면 처음 온 때 + '(연속)'
   - 지원장비 칸: 기계화부 = 기관 이름(서울경기 1), 지역본부 장비 = 보낸 지사 이름(시흥 2 — 2026-11-02 사용자 요청), 강원 신속대응팀 = 강원팀
   - 아래 네모: 기계화부 N대(서울경기 10, …) / 지역본부 N대(서울경기 2대, …) / 강원 신속대응팀 N대 — 있는 것만
   - 강설량·특보(2026-11-03 사용자 요청, 지사당 두 줄): 강설량 = 24시간 예보 cm, 특보 = 대설만 주의보·경보·예비(발효시각). 이동 현황 카드와 같은 값(확정한 지사는 확정 순간 값)
     날짜별 예보는 없으므로 오늘 보고서에만 값을 넣고 다른 날짜는 '-'
   - 워드 파일은 외부 프로그램 없이 여기서 직접 만듦(.docx = 압축 파일 안의 XML). 한글(HWP)에서도 열 수 있음
   ============================================================ */
(function () {
  "use strict";
  const TITLE = "신속대응팀 제설장비 지원 현황";
  const mdDow = iso => { const [y, m, d] = iso.split("-").map(Number); return `${m}.${d}(${WD[new Date(y, m - 1, d).getDay()]})`; };
  const fullDate = iso => { const [y, m, d] = iso.split("-").map(Number); return `${y}. ${m}. ${d}.(${WD[new Date(y, m - 1, d).getDay()]})`; };
  const hqOf = bid => S.hqById[(S.brById[bid] || {}).hq_id] || null;

  // 표 칸에 쓰는 지원기관 이름과 정렬 순서(기계화부 기관 순서 → 지역본부 장비(보낸 지사, 지사 순서) → 강원팀)
  // 지역본부 장비는 표에는 '보낸 지사'(시흥 2), 아래 네모에는 그 지사의 본부(수도권 2대) — 2026-11-02 사용자 요청
  function srcLabel(v) {
    if (isTeam(v)) return { label: "강원팀", key: 9000 };
    if (isPool(v)) { const i = S.order.findIndex(b => b.id === v.home_branch); return { label: bn(v.home_branch), key: 100 + (i < 0 ? 999 : i) }; }
    const i = S.orgs.indexOf(v.org); return { label: v.org, key: i < 0 ? 50 : i };
  }
  const group = list => {          // [{label, n}] 순서대로
    const g = new Map(); list.forEach(m => { const s = srcLabel(m.v), k = s.key + "|" + s.label; g.set(k, { ...s, n: ((g.get(k) || {}).n || 0) + 1 }); });
    return [...g.values()].sort((a, b) => a.key - b.key || a.label.localeCompare(b.label, "ko"));
  };

  // 지사 한 곳의 강설량·특보 글자. lv = 강조할 단계(주의보·경보만)
  const WX_NAME = { "예비": "예비", "주의": "주의보", "경보": "경보" };
  function wxText(w) {
    if (w.none) return "-";
    if (!w.level) return "특보 없음";
    const name = WX_NAME[w.level] || w.level, t = w.ef ? new Date(w.ef) : null; if (!t || isNaN(t)) return name;
    const hm = `${p2(t.getHours())}:${p2(t.getMinutes())}`, slot = w.level === "예비" && EF_SLOT[hm] ? (EF_SLOT[hm].match(/\d+~\d+시/) || [hm])[0] : hm;      // 예비특보의 발효는 기상청 약속 시각 → 시간대
    return `${name}(${t.getMonth() + 1}.${t.getDate()} ${slot})`;
  }
  function wxOf(id, d) {
    if (d !== todayISO()) return { snow: "-", warn: "-", lv: null };
    const f = fcOf(id), w = warnOf(id);
    return { snow: f && !f.none && f.snow != null ? `${fcAmt(f, "snow")}cm` : "-", warn: wxText(w), lv: !w.none && (w.level === "주의" || w.level === "경보") ? w.level : null };
  }

  // 보고서 자료(날짜 하나)
  function model(d) {
    const moves = movesOn(d).filter(m => m.pos), byB = new Map();
    moves.forEach(m => { if (!byB.has(m.pos)) byB.set(m.pos, []); byB.get(m.pos).push(m); });
    const groups = [];
    S.hqs.forEach(h => {
      const rows = S.order.filter(b => b.hq_id === h.id && byB.has(b.id)).map(b => {
        const list = byB.get(b.id), at = m => m.p;      // 지금 있는 방문(같은 지사를 두 번 들를 수 있음, 64)
        const isC = m => at(m) === 0 && isCont(m.v.id, d, b.id);
        const etas = list.filter(m => !isC(m)).map(m => (m.rec.times || [])[at(m)]).filter(Boolean).sort();
        let eta = "미정";
        if (etas.length) eta = `${mdDow(d)} ${etas[0]}`;
        else if (list.some(isC)) {
          const s = list.filter(isC).map(m => contSince(m.v.id, d, b.id)).sort((x, y) => (x.date + (x.time || "")).localeCompare(y.date + (y.time || "")))[0];
          eta = `${mdDow(s.date)}${s.time ? " " + s.time : ""} (연속)`;
        }
        return { id: b.id, name: b.name, n: list.length, wx: wxOf(b.id, d), truck: group(list.filter(m => m.v.type === "제설차")), blower: group(list.filter(m => m.v.type === "제설기")), eta };
      });
      if (rows.length) groups.push({ hq: h.name, rows });
    });
    const trucks = moves.filter(m => m.v.type === "제설차").length, blowers = moves.filter(m => m.v.type === "제설기").length;
    const mech = S.orgs.map(o => ({ o, n: moves.filter(m => m.v.org === o).length })).filter(x => x.n);
    const pool = S.hqs.map(h => ({ o: h.name, n: moves.filter(m => isPool(m.v) && hqOf(m.v.home_branch) === h).length })).filter(x => x.n);
    const team = moves.filter(m => isTeam(m.v)).length, sum = a => a.reduce((n, x) => n + x.n, 0);
    const notes = [];
    if (mech.length) notes.push(`기계화부 ${sum(mech)}대(${mech.map(x => `${x.o} ${x.n}`).join(", ")})`);
    if (pool.length) notes.push(`지역본부 ${sum(pool)}대(${pool.map(x => `${x.o} ${x.n}`).join(", ")})`);      // 2026-11-11 사용자: 괄호 안은 '대' 없이(기계화부와 같게)
    if (team) notes.push(`${TEAM} ${team}대`);
    return { date: d, total: moves.length, trucks, blowers, branches: groups.reduce((n, g) => n + g.rows.length, 0), groups, notes };
  }

  // 표 칸 폭(워드와 미리 보기가 같음, 글자 길이와 상관없이 고정 — 2026-11-02 사용자 요청). 합 = A4 폭 - 여백 = 9906 twips
  const COLW = [1050, 1050, 650, 760, 1950, 1400, 1400, 1646], COLW_SUM = COLW.reduce((a, b) => a + b, 0);
  /* ---------- 미리 보기(화면) ---------- */
  const cellLines = arr => arr.map(x => `<div class="rp-src"><span>${esc(x.label)}</span><span>${x.n}</span></div>`).join("");
  function html(M) {
    let body = "";
    M.groups.forEach(g => g.rows.forEach((r, i) => {
      body += `<tr class="${i ? "in" : "first"}">${i ? "" : `<th class="rp-hq" rowspan="${g.rows.length * 2}">${esc(g.hq)}</th>`}<th class="rp-br" rowspan="2">${esc(r.name)}</th><td class="c" rowspan="2">${r.n}</td><td class="rp-l">강설량</td><td class="c">${esc(r.wx.snow)}</td><td rowspan="2">${cellLines(r.truck)}</td><td rowspan="2">${cellLines(r.blower)}</td><td class="c" rowspan="2">${esc(r.eta).replace(" (연속)", "<br>(연속)")}</td></tr>` +
        `<tr class="rp-w2"><td class="rp-l">특보</td><td class="c${r.wx.lv ? " rp-on" : ""}">${esc(r.wx.warn)}</td></tr>`;
    }));
    return `<div class="rp-page" id="rpPage"><div class="rp-title">${TITLE}</div><div class="rp-date">${esc(fullDate(M.date))}</div>
      <div class="rp-sum"><b>□ 장비지원 : 총 ${M.total}대 (<span class="red">제설차 ${M.trucks}대, 제설기 ${M.blowers}대</span>)</b><span class="rp-cnt">※ ${M.branches}개 기관 지원</span></div>
      <table class="rp-t"><colgroup>${COLW.map(w => `<col style="width:${(w / COLW_SUM * 100).toFixed(2)}%">`).join("")}</colgroup><thead><tr><th colspan="2" rowspan="2">피지원기관</th><th rowspan="2">대 수</th><th colspan="2" rowspan="2">강설량(24시간)·특보</th><th colspan="2">신속대응팀 지원장비</th><th rowspan="2">비 고<br>(도착일시)</th></tr><tr><th>제설차</th><th>제설기</th></tr>
      <tr class="rp-tot"><th colspan="2">계</th><th>${M.total}</th><th colspan="2"></th><th>${M.trucks}</th><th>${M.blowers}</th><th></th></tr></thead>
      <tbody>${body || `<tr><td colspan="8" class="c">${esc(fmtMD(M.date))}에 지원하는 장비가 없습니다.</td></tr>`}</tbody></table>
      <div class="rp-nt">※ 기관별 지원 현황</div><div class="rp-box">${M.notes.length ? M.notes.map(n => `<div>○ ${esc(n)}</div>`).join("") : "<div>○ 없음</div>"}</div></div>`;
  }
  function openPreview() {
    const M = model(S.date);
    sheet.classList.add("wide");
    sheet.innerHTML = `<button type="button" class="sheet-close" id="sheetClose">닫기</button><h2 id="sheetTitle" class="sr-only">1쪽 보고서</h2>
      <p><button type="button" class="btn primary" id="rptDocIn">Word 받기</button></p><div class="rp-wrap" id="rpWrap">${html(M)}</div>`;
    sheet.hidden = false; backdrop.hidden = false; fitPage();
    $("sheetClose").focus(); $("sheetClose").onclick = () => { sheet.classList.remove("wide"); closeSheet(); };
    $("rptDocIn").onclick = () => download();
  }

  // A4 한 장 모양 그대로(2026-11-02 사용자 요청 — 휴대폰에서 표가 깨지지 않게): 종이는 늘 794×1123px(A4, 96dpi)로 그리고
  // ① 내용이 길면 표 글자를 줄여 한 장 안에 넣고 ② 화면 폭에 맞게 종이 전체를 줄여 보여 줌(글자는 작아져도 모양은 같음)
  const A4W = 794, A4H = 1123;
  function fitPage() {
    const wrap = $("rpWrap"), pg = $("rpPage"); if (!wrap || !pg) return;
    pg.style.setProperty("--rp-fs", "13px");
    for (let fs = 13; fs > 6 && pg.scrollHeight > A4H; fs -= 0.5) pg.style.setProperty("--rp-fs", fs + "px");
    const k = Math.min(1, wrap.clientWidth / A4W);
    pg.style.transform = `scale(${k})`; wrap.style.height = Math.ceil(A4H * k) + "px";
  }
  addEventListener("resize", () => { if (!sheet.hidden && $("rpWrap")) fitPage(); });

  /* ---------- 워드(.docx) ---------- */
  const x = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const FONT = '<w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕" w:cs="맑은 고딕"/>';
  const run = (t, o = {}) => `<w:r><w:rPr>${FONT}${o.b ? "<w:b/>" : ""}${o.color ? `<w:color w:val="${o.color}"/>` : ""}<w:sz w:val="${o.sz || 20}"/><w:szCs w:val="${o.sz || 20}"/></w:rPr><w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
  // 단락 서식은 워드 규격 순서대로(autoSpace → spacing → ind → jc). 한글·숫자 사이 자동 띄움은 끔("20대"가 "20 대"로 보이지 않게)
  const para = (runs, o = {}) => `<w:p><w:pPr>${o.tab ? `<w:tabs><w:tab w:val="right" w:pos="${o.tab}"/></w:tabs>` : ""}<w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/><w:spacing w:before="${o.before || 0}" w:after="${o.after || 0}" w:line="${o.line || 240}" w:lineRule="${o.exact ? "exact" : "auto"}"/>${o.ind ? `<w:ind w:left="${o.ind}" w:right="${o.ind}"/>` : ""}${o.jc ? `<w:jc w:val="${o.jc}"/>` : ""}</w:pPr>${runs}</w:p>`;
  const B = (v, sz = 4) => v === "nil" ? `w:val="nil"` : `w:val="${v}" w:sz="${sz}" w:space="0" w:color="000000"`;
  function cell(w, content, o = {}) {
    const bd = o.bd || {};
    const borders = ["top", "left", "bottom", "right"].filter(k => bd[k]).map(k => `<w:${k} ${bd[k]}/>`).join("");
    return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.span ? `<w:gridSpan w:val="${o.span}"/>` : ""}${o.vm ? `<w:vMerge${o.vm === "restart" ? ' w:val="restart"' : ""}/>` : ""}` +
      `${borders ? `<w:tcBorders>${borders}</w:tcBorders>` : ""}${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ""}<w:vAlign w:val="center"/></w:tcPr>${content || para("")}</w:tc>`;
  }
  function docXml(M) {
    const W = COLW, TW = COLW_SUM;
    const lines = M.groups.reduce((n, g) => n + g.rows.reduce((k, r) => k + Math.max(2, r.truck.length, r.blower.length), 0), 0);
    // 1쪽에 들어가게: 표에 쓸 수 있는 높이(약 175mm ≈ 496pt, 제목·요약·머리줄·아래 네모를 뺀 것)를 줄 수로 나눠 한 줄 높이를 정함(최대 18pt)
    // 글자는 줄 높이의 약 75%(5.5pt~10.5pt). 지사가 아주 많으면(줄 70개 이상) 글자가 너무 작아져 2쪽이 될 수 있음
    const hp = Math.min(18, 450 / Math.max(lines, 1)), sz = Math.max(11, Math.min(21, Math.round(hp * 0.75 * 2))), line = Math.round(hp * 20);
    const hc = (t, o = {}) => para(run(t, { sz: 19, b: 1 }), { jc: "center", before: 30, after: 30 });     // 머리줄·계: 글자 크기 고정(9.5pt)
    const c = (t, o = {}) => para(run(t, { sz, b: o.b, color: o.color }), { jc: o.jc || "center", line, exact: 1, ind: o.ind });
    // 지원장비 칸: 이름은 왼쪽, 대수는 오른쪽 고정 위치(탭) — 이름 길이에 따라 글자 사이가 벌어지지 않게(예전 'distribute' 대신)
    const TAB = W[5] - 80 - 120, srcCell = arr => arr.length ? arr.map(s => para(run(s.label, { sz }) + `<w:r><w:rPr>${FONT}<w:sz w:val="${sz}"/></w:rPr><w:tab/></w:r>` + run(String(s.n), { sz }), { jc: "left", line, exact: 1, ind: 120, tab: TAB })).join("") : c("");
    const thick = B("single", 12), thin = B("single", 4), dot = B("dotted", 4);
    const tblPr = (w, extra = "") => `<w:tblPr><w:tblW w:w="${w}" w:type="dxa"/><w:jc w:val="center"/>${extra}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="40" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
    const grid = `<w:tblGrid>${W.map(w => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;
    const tblB = `<w:tblBorders><w:top ${thick}/><w:left ${thick}/><w:bottom ${thick}/><w:right ${thick}/><w:insideH ${thin}/><w:insideV ${thin}/></w:tblBorders>`;
    const hb = { bd: { bottom: B("single", 8) } };
    let t = `<w:tbl>${tblPr(TW, tblB)}${grid}`;
    // 머리 두 줄 + 계
    t += `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell(W[0] + W[1], hc("피지원기관", { b: 1 }), { span: 2, vm: "restart", fill: "F2F2F2" })}${cell(W[2], hc("대 수", { b: 1 }), { vm: "restart", fill: "F2F2F2" })}${cell(W[3] + W[4], hc("강설량(24시간)·특보", { b: 1 }), { span: 2, vm: "restart", fill: "F2F2F2" })}` +
      `${cell(W[5] + W[6], hc("신속대응팀 지원장비", { b: 1 }), { span: 2, fill: "F2F2F2" })}${cell(W[7], hc("비 고", { b: 1 }) + c("(도착일시)", { b: 1 }), { vm: "restart", fill: "F2F2F2" })}</w:tr>`;
    t += `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell(W[0] + W[1], "", { span: 2, vm: "c", fill: "F2F2F2", ...hb })}${cell(W[2], "", { vm: "c", fill: "F2F2F2", ...hb })}${cell(W[3] + W[4], "", { span: 2, vm: "c", fill: "F2F2F2", ...hb })}${cell(W[5], hc("제설차", { b: 1 }), { fill: "F2F2F2", ...hb })}${cell(W[6], hc("제설기", { b: 1 }), { fill: "F2F2F2", ...hb })}${cell(W[7], "", { vm: "c", fill: "F2F2F2", ...hb })}</w:tr>`;
    const tot = { fill: "FFFF00", bd: { bottom: B("single", 8) } };
    t += `<w:tr>${cell(W[0] + W[1], hc("계", { b: 1 }), { span: 2, ...tot })}${cell(W[2], hc(M.total, { b: 1 }), tot)}${cell(W[3] + W[4], hc(""), { span: 2, ...tot })}${cell(W[5], hc(M.trucks, { b: 1 }), tot)}${cell(W[6], hc(M.blowers, { b: 1 }), tot)}${cell(W[7], hc(""), tot)}</w:tr>`;
    if (!M.groups.length) t += `<w:tr>${cell(TW, c(`${fmtMD(M.date)}에 지원하는 장비가 없습니다.`), { span: 8 })}</w:tr>`;
    M.groups.forEach((g, gi) => g.rows.forEach((r, i) => {
      const top = { top: i ? dot : (gi ? B("single", 8) : thin) };               // 같은 본부 안은 점선, 본부가 바뀌면 굵은 선
      // 지사마다 두 줄(강설량 / 특보). 나머지 칸은 두 줄을 합침. 값 글자는 칸에 한 줄로 들어가도록 9.5pt 까지
      const vs = Math.min(sz, 19), vc = (t, o = {}) => para(run(t, { sz: vs, b: o.b, color: o.color }), { jc: "center", line, exact: 1 }), etas = r.eta.split(" (연속)");
      const etaCell = etas.length > 1 ? c(etas[0]) + c("(연속)") : c(r.eta), lb = { fill: "F2F2F2" };
      t += `<w:tr><w:trPr><w:cantSplit/></w:trPr>${i ? cell(W[0], "", { vm: "c", bd: { top: "w:val=\"nil\"" } }) : cell(W[0], c(g.hq, { jc: "distribute", ind: 40 }), { vm: "restart", bd: top })}` +
        `${cell(W[1], c(r.name, { jc: "distribute", ind: 40 }), { vm: "restart", bd: top })}${cell(W[2], c(r.n), { vm: "restart", bd: top })}${cell(W[3], vc("강설량", { b: 1 }), { ...lb, bd: top })}${cell(W[4], vc(r.wx.snow), { bd: top })}` +
        `${cell(W[5], srcCell(r.truck), { vm: "restart", bd: top })}${cell(W[6], srcCell(r.blower), { vm: "restart", bd: top })}${cell(W[7], etaCell, { vm: "restart", bd: top })}</w:tr>` +
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(W[0], "", { vm: "c" })}${cell(W[1], "", { vm: "c" })}${cell(W[2], "", { vm: "c" })}${cell(W[3], vc("특보", { b: 1 }), lb)}${cell(W[4], vc(r.wx.warn, r.wx.lv ? { b: 1, color: "FF0000" } : {}))}${cell(W[5], "", { vm: "c" })}${cell(W[6], "", { vm: "c" })}${cell(W[7], "", { vm: "c" })}</w:tr>`;
    }));
    t += `</w:tbl>`;
    // 제목(회색 상자) · 날짜 · 요약 · 표 · 아래 네모(점선)
    const title = `<w:tbl>${tblPr(TW, `<w:tblBorders><w:top ${B("double", 6)}/><w:left ${B("single", 6)}/><w:bottom ${B("double", 6)}/><w:right ${B("single", 6)}/></w:tblBorders>`)}<w:tblGrid><w:gridCol w:w="${TW}"/></w:tblGrid>` +
      `<w:tr><w:trPr><w:trHeight w:val="760"/></w:trPr>${cell(TW, para(run(TITLE, { sz: 40, b: 1 }), { jc: "center" }), { fill: "D9D9D9" })}</w:tr></w:tbl>`;
    const box = `<w:tbl>${tblPr(TW, `<w:tblBorders><w:top ${B("dashed", 6)}/><w:left ${B("dashed", 6)}/><w:bottom ${B("dashed", 6)}/><w:right ${B("dashed", 6)}/></w:tblBorders>`)}<w:tblGrid><w:gridCol w:w="${TW}"/></w:tblGrid>` +
      `<w:tr>${cell(TW, (M.notes.length ? M.notes : ["없음"]).map(n => para(run(`○ ${n}`, { sz: 22 }), { before: 100, after: 100, ind: 200 })).join(""))}</w:tr></w:tbl>`;
    const body = title + para(run(fullDate(M.date), { sz: 22 }), { jc: "right", before: 120, after: 60 }) +
      para(run(`□ 장비지원 : 총 ${M.total}대 (`, { sz: 25, b: 1 }) + run(`제설차 ${M.trucks}대, 제설기 ${M.blowers}대`, { sz: 25, b: 1, color: "FF0000" }) + run(")", { sz: 25, b: 1 }) + run(`      ※ ${M.branches}개 기관 지원`, { sz: 23, b: 1 }), { after: 100 }) +
      t + para(run("※ 기관별 지원 현황", { sz: 22 }), { before: 160, after: 80 }) + box +
      `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="1000" w:bottom="800" w:left="1000" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  }
  const FILES = M => ({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${x(TITLE)} ${x(M.date)}</dc:title></cp:coreProperties>`,
    "word/document.xml": docXml(M),
  });

  /* ---------- 압축(zip, 압축 없이 담기만) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], cent = []; let off = 0;
    const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    Object.entries(files).forEach(([name, text]) => {
      const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
      const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)];
      const local = new Uint8Array([0x50, 0x4B, 0x03, 0x04, ...common, ...nb]);
      parts.push(local, data);
      cent.push(new Uint8Array([0x50, 0x4B, 0x01, 0x02, ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off), ...nb]));
      off += local.length + data.length;
    });
    const csize = cent.reduce((n, a) => n + a.length, 0), n = cent.length;
    const end = new Uint8Array([0x50, 0x4B, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(n), ...u16(n), ...u32(csize), ...u32(off), ...u16(0)]);
    return new Blob([...parts, ...cent, end], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }
  function download() {
    const M = model(S.date), blob = zip(FILES(M)), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `신속대응팀_제설장비_지원현황_${M.date}.docx`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast(`${fmtMD(M.date)} 보고서(워드)를 내려받았습니다`);
  }

  window.SSReport = { model, html, docXml, files: FILES, zip, open: openPreview, download, srcLabel, fitPage, wxText };
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest("#rptView, #rptDoc"); if (!t) return;
    if (t.id === "rptView") openPreview(); else download();
  });
})();
