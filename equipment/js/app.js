/* ============================================================
   app.js — 장비 지원 화면 전체 (권한, 이동 현황, 기관별 장비, 지사별 요청·편성, 로그 기록)
   불러오는 순서: auth/auth.js → sample-data.js → api.js → app.js
   - 자료는 서버(Supabase)에서 읽고 api.js 로 저장합니다. 주소에 ?sample=1 이면 샘플 자료로 시연합니다.
   - 권한은 계정의 세부 권한(perms)으로 판단합니다. 관리자는 모든 권한.
       equip.edit.own  자기 출발 기관 장비 추가·도공번호·지원 여부(기준일자별) / equip.edit.all  모든 기관 장비 추가·삭제·숨기기 / equip.route  날짜별 경로(지원일 칸) 전부 + 지원일 1 날짜 + 초기화
       req.edit.own    자기 지사 요청 / req.edit.hq  자기 본부 지사들 요청 / req.confirm  편성·확정·기준일자 만들기 / log.view  수정 기록
     ⚠ 화면의 권한 검사는 보기 좋게 정리하는 용도이고, 실제로 막는 것은 서버 규칙(RLS·트리거)입니다.
   - 경로는 (날짜, 장비)마다 한 줄로 서버에 남습니다. 다른 날짜를 확정해도 지난 날짜 경로는 지워지지 않습니다.
   - 특보: 서버가 10분마다 기상청에서 받아 둔 것(warning_status)을 자동 표시. 확정한 지사는 확정 순간 값을 서버가 남김(warn_* 열)
     24시 예보 [적설 | 강수 | 확률 | 기온](2026-10-15 '24시 강설'에서 이름 바꿈, 최저기온 묶음을 합침): 확률 = 지사 격자의 24시간 중 가장 높은 강수확률(%, branch_forecast.max_pop_24h — 시각 없이 값만. 직접입력 줄은 '-').
     적설·강수: 기상청 예보 격자의 1시간 신적설(cm)·1시간 강수량(mm) 24시간 합 중 지사 격자의 가장 큰 값(branch_forecast).
     2026-11-04(마이그레이션 60): 앞 6시간 = 초단기예보(강수·확률·기온, 적설 항목이 없어 적설 0), 나머지 = 단기예보(서버가 섞어 저장). 제목 옆 '○시 발표 기준'은 뺌
     확정하면 서버가 그 순간 값을 남김(fc_* 열). 값을 누르면 강설량 측정 → 기관별 24시간 예보의 그 지사로 이동. 확정한 지사 줄은 바탕이 노랑
     기온: 같은 예보의 1시간 기온 24시간 중 가장 낮은 값(지사 격자 중 가장 추운 곳, branch_forecast.min_tmp). 그 시각 칸은 2026-10-15 뺌
     [기상현황 직접입력]을 켜면 적설·강수·최저기온·대설특보(종류·발표·발효)를 지사가 직접 넣음(wx_* 열) — 자동 값 대신 보이고, 눌러도 예보로 가지 않음
     지사별 요청·편성은 대설특보(예비·주의보·경보)만: [종류 | 발표 | 발효] 세 칸. 다른 특보는 관리자 [특보구역 관리] 아래 종류별 탭에서만
   - 지역본부 장비(마이그레이션 44): 다른 지사를 도울 수 있는 지사가 '타지사 지원 가능' 대수를 내고 관리자가 확정하면, 그 지사(와 관리자)가 그 기준일자에 보낼 제설차를 등록.
     장비는 그 기준일자에만 딸림(org = '지역본부', round_id, home_branch = 출발 지사, rented = 임차). 이름은 '인천 252호' / '인천 임차 1호'(저장 값 plate = 인천252 / 인천임차1).
     피지원 지사는 관리자가 정하고, 지사는 번호·임차·도착 예상 시각·삭제(경로 없을 때)만. 지원 여부는 늘 '지원'.
   - 강원본부 지원장비(마이그레이션 48, 2026-10-30): 강원 신속대응팀 제설차 4대(원주·양양·대관령·강릉, 이름 고정 — 2026-11-02 홍천 → 양양). 기관별 장비·배정과 따로 움직이고 기준일자만 함께 씀.
     관리자와 강원본부 계정만 고침. 요청이 없는 지사로도 보냄(전국 모든 지사). 화면에서는 팀 장비도 장비처럼(S.team, 번호 GW1~4) 같은 경로·지원 여부 칸(S.routes·S.rstat)을 씀.
     이동 현황에는 지역본부 다음 겹세로줄 뒤 '강원 신속대응팀' 열(제설차만) — 체크박스 하나로 열·합계·아래 카드에서 함께 빼고 넣음(이 브라우저에 기억)
   - 사람이 읽는 규칙 설명: docs/equipment-rules.md
   ============================================================ */
// 배포 직후 브라우저에 예전 index.html(최대 10분 저장)이 남아 있으면 새 app.js 와 화면 틀이 맞지 않아 탭이 비어 보임
// (GitHub Pages 는 ?v= 꼬리표와 관계없이 최신 파일을 줌). 판번호가 다르면 주소를 바꿔 한 번만 새로 받는다.
const UI_VERSION = "2026110501";
(() => {
  const m = document.querySelector('meta[name="ui-version"]');
  if ((m && m.content) === UI_VERSION) return;
  let first = true; try { const k = "eq_reload_" + UI_VERSION; first = !sessionStorage.getItem(k); sessionStorage.setItem(k, "1"); } catch (e) {}
  if (first) { const u = new URL(location.href); u.searchParams.set("_v", UI_VERSION); location.replace(u.href); throw new Error("화면 틀이 예전 판이라 새로 불러옵니다"); }
})();
const $ = id => document.getElementById(id);
function esc(v) {   // XSS 방지: 화면에 글자를 넣을 땐 항상 이 함수를 거칩니다
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const p2 = n => String(n).padStart(2, "0");
const TYPES = ["제설차", "제설기", "이동정비차"];
const POOL = "지역본부";                              // 지역본부 장비의 기관 이름(기계화부 4곳과 따로)
const isPool = v => !!v && v.org === POOL;
const TEAM = "강원 신속대응팀";                         // 강원본부 지원장비(마이그레이션 48)의 기관 이름 — 서버에는 기관이 아니고 따로 된 표(gw_team)
const isTeam = v => !!v && v.org === TEAM;
const STATUS = { "": ["wait", ""], O: ["go", "지원"] };     // 지원 여부 = 지원 또는 빈칸(2026-11-04 사용자 결정: 지원 불가·정비중 없앰, 서버 마이그레이션 66도 이 둘만 받음)
// 지원 여부 드롭다운: 빈칸 · 지원(빈칸으로 되돌릴 수 있음)
const statusOpts = (vid, st) => Object.keys(STATUS).map(k => `<option value="${k}" ${st === k ? "selected" : ""}>${STATUS[k][1]}</option>`).join("");
const WD = "일월화수목금토";
const todayISO = () => { const t = new Date(); return `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`; };
function addDays(iso, n) { const [y, m, d] = iso.split("-").map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`; }
function fmtMD(iso) { const [y, m, d] = iso.split("-").map(Number); return `${m}/${d}(${WD[new Date(y, m - 1, d).getDay()]})`; }
function localInput(iso) { if (!iso) return null; const d = new Date(iso); return isNaN(d) ? null : `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; }
function fmtTime(local) { if (!local) return "미정"; const [d, t] = local.split("T"); const [, m, dd] = d.split("-").map(Number); return `${m}월 ${dd}일 ${t}`; }
function fmtShort(iso) { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; }
const sameDay = iso => new Date(iso).toDateString() === new Date().toDateString();

/* ============================================================
   [1] 상태와 권한
   ============================================================ */
// 접속 아이디(데모): 정식 출시 전까지 유지(사용자 결정 2026-10-04). 서버에 연결된 화면에서는 "미리보기"이고 저장은 내 아이디로만.
const DEMO = [
  { id: "admin1", label: "관리자1", role: "admin", g: "관리자" }, { id: "admin2", label: "관리자2", role: "admin", g: "관리자" },
  { id: "hq-gw", label: "강원본부", role: "hq", hq: "강원", perms: ["req.edit.hq"], g: "지역본부" },
  { id: "br1", label: "대관령지사", role: "branch", branch: "대관령", perms: ["juris.request", "req.edit.own"], g: "피지원지사" },
  { id: "br2", label: "양양지사", role: "branch", branch: "양양", perms: ["juris.request", "req.edit.own"], g: "피지원지사" },
  { id: "br3", label: "엄정지사", role: "branch", branch: "엄정", perms: ["juris.request", "req.edit.own"], g: "피지원지사" },
  { id: "br-ic", label: "인천지사", role: "branch", branch: "인천", perms: ["juris.request", "req.edit.own"], g: "지원지사(지역본부 장비)" },
  { id: "br-sw", label: "수원지사", role: "branch", branch: "수원", perms: ["juris.request", "req.edit.own"], g: "지원지사(지역본부 장비)" },
  { id: "eq-sg", label: "서울경기 지원장비", role: "equip", org: "서울경기", perms: ["equip.edit.own"], g: "지원장비" },
  { id: "eq-cb", label: "충북 지원장비", role: "equip", org: "충북", perms: ["equip.edit.own"], g: "지원장비" },
  { id: "viewer", label: "보기 전용", role: "viewer", perms: [], g: "보기 전용" }
];
const S = {
  me: null, real: null, uid: "admin1", preview: false,
  hqs: [], branches: [], order: [], brById: {}, hqById: {}, vehicles: [], rounds: [], orgs: [], holdings: null,
  routes: new Map(), rmeta: new Map(), loaded: null, reqs: {}, audit: [],
  alloc: new Map(), adraft: new Map(),                                              // 기관별 배치(고른 기준일자): "기관|지사" → { truck, blower } / adraft = 아직 확정 안 한 변경
  rstat: new Map(), stLoaded: new Set(), sdraft: new Map(), unhideOpen: false,   // rstat: "기준일자|장비" → 지원 여부 {status, off_from, updated_at} / sdraft: 고른 기준일자의 아직 확정 안 한 지원 여부(장비 → 값)
  draft: new Map(), vdraft: new Map(), rdraft: new Map(), revisedMode: false,   // revisedMode: 표 위 [최초 지원]/[수정본] — 고르는 지사 목록과 저장 구분          // 아직 확정·저장하지 않은 변경(경로 / 장비 / 지사 요청)
  date: todayISO(), colsDraft: new Map(), day1Draft: new Map(), round: null,      // 확정 전 지원일 칸 수·지원일 1("기준일자|equip·team" → 값, 94)
  org: "전체", type: "전체", fleetOrgs: new Set(), bviews: new Set(), closedHq: new Set(), extraStop: new Set(),   // fleetOrgs: 기관별 장비에서 고른 기관(한 곳, 비어 있으면 모든 기관) / bview: 지사별 요청·편성 보기 = all(기본, 아무 버튼도 안 눌림) / req(요청 있는 지사만) / fixed(편성 확정된 지사만) / offer(지원 가능 지사만) / unsaved(저장 안 한 지사만)
  fleetGo: false,                                                                  // 기관별 장비 [지원 장비만]: 고른 기준일자에서 지원 여부가 '지원'인 장비만 보기
  team: [], showTeam: true,                                                        // 강원 신속대응팀 4대(장비 모양) / 이동 현황에 보일지(체크박스, 이 브라우저에 기억)
  nvSel: "", nvRent: false,                                                         // 장비 추가 줄에서 고른 기관(또는 "B:지사번호")·임차 체크
  logUser: "전체", logKind: "전체", logToday: false,
  warn: null, zdata: null, wtab: null, fc: {}                                      // warn: 지금 대설 특보(서버 요약) / zdata: 특보구역 관리 창 자료
};
// 장비 정렬 규칙(사용자 지정): ① 기관 서울경기 → 충북 → 전북 → 대구경북(S.orgs 순서) → 지역본부 ② 종류 제설차 → 제설기 → 이동정비차(TYPES 순서) ③ 도공번호 숫자 순
//   지역본부 장비끼리는 출발 지사(본부·지사 순서) → 일반 → 임차 → 숫자 순
const vehNo = v => { const m = /(\d+)$/.exec(v.plate || ""); return m ? +m[1] : 1e9; };
const brIdx = id => { const i = S.order.findIndex(b => b.id === id); return i < 0 ? 999 : i; };
const vehCmp = (a, b) => (((S.orgs.indexOf(a.org) + 1) || 99) - ((S.orgs.indexOf(b.org) + 1) || 99)) || (isPool(a) && isPool(b) ? (brIdx(a.home_branch) - brIdx(b.home_branch)) || ((a.rented ? 1 : 0) - (b.rented ? 1 : 0)) : 0) ||
  (((TYPES.indexOf(a.type) + 1) || 99) - ((TYPES.indexOf(b.type) + 1) || 99)) || (vehNo(a) - vehNo(b)) || String(a.id).localeCompare(String(b.id));
const sortVehicles = () => { S.vehicles.sort(vehCmp); };
const SOURCE_ORGS = () => [...S.orgs, POOL];             // 이동 현황 지원기관 열·기관별 장비 기관 버튼: 기계화부 4곳 + 지역본부
const can = p => !!S.me && (S.me.role === "admin" || (S.me.perms || []).includes(p));
// 지역본부 장비는 그 지사 계정(자기 지사 요청 권한 req.edit.own)과 관리자만 고침. 본부·기계화부 계정은 못 함
const canPoolAdd = () => !!S.me && !can("equip.edit.all") && can("req.edit.own") && !!S.me.branch_id;
// 강원 신속대응팀: 관리자와 강원본부 계정만(서버 규칙 private.gw_team_editor 와 같음)
const canTeam = () => !!S.me && (S.me.role === "admin" || (S.me.role === "hq" && (S.hqById[S.me.hq_id] || {}).name === "강원"));
const canVeh = v => isTeam(v) ? canTeam() : can("equip.edit.all") || (isPool(v) ? canPoolAdd() && v.home_branch === S.me.branch_id : can("equip.edit.own") && v.org === S.me.org);
const canReq = b => can("req.confirm") || (can("req.edit.own") && S.me.branch_id === b.id) || (can("req.edit.hq") && b.hq_id === S.me.hq_id);
const canAnyReq = () => can("req.confirm") || can("req.edit.own") || can("req.edit.hq");
const bn = id => (S.brById[id] || {}).name || id;
const vehById = id => S.vehicles.find(v => v.id === id) || S.team.find(v => v.id === id);
const isTeamId = id => S.team.some(v => v.id === id);
// 화면에 보이는 장비 이름(저장 값 plate 는 그대로): 기계화부 '서울경기901호' / 지역본부 '인천 252호'·'인천 임차 1호'
const poolNum = v => { const m = /(\d{1,5})$/.exec(vval(v, "plate") || ""); return m ? m[1] : ""; };
const poolPlate = (bid, rented, num) => bn(bid) + (rented ? "임차" : "") + num;
// 지역본부 장비의 저장 이름을 만들고 같은 기준일자 안에서 겹치는지 검사(등록·번호 고치기·임차 바꾸기가 함께 씀). 겹치면 안내하고 null
function poolPlateFree(bid, rented, num, exceptId) {
  const plate = poolPlate(bid, rented, num);
  if (poolVehs().some(x => x.id !== exceptId && vval(x, "plate") === plate)) { toast("이 기준일자에 같은 이름의 장비가 이미 있습니다", true); return null; }
  return plate;
}
const vname = v => !v ? "" : isTeam(v) ? `신속대응팀 ${v.name}` : isPool(v) ? `${bn(v.home_branch)} ${vval(v, "rented") ? "임차 " : ""}${poolNum(v)}호` : vval(v, "plate") + (plateNum(v) ? "호" : "");
const plateOf = id => { const v = vehById(id); return v ? vname(v) : id; };
const curRound = () => S.rounds.find(r => r.id === S.round) || null;

/* ---------- 값: 서버 값 + 아직 확정하지 않은 변경 ---------- */
const rk = (date, vid) => date + "|" + vid;
// 경로 한 칸 = { stops: 들르는 지사들, revised: 수정본인지(아니면 최초 지원), times: 지사마다 도착 예상 시각 "HH:MM" 또는 null }
const EMPTY = { stops: [], revised: false, times: [] };
function normRec(r) {
  r = r || EMPTY; const stops = [], times = [];      // 2026-11-04(64): 같은 지사를 다시 들를 수 있음(인천→시흥→인천) — 바로 연달아 같은 지사만 하나로
  (r.stops || []).forEach((s, i) => { if (s && s !== stops[stops.length - 1]) { stops.push(s); times.push((r.times || [])[i] || null); } });
  return stops.length ? { stops, revised: !!r.revised, times } : EMPTY;
}
const recOf = (date, vid) => { const k = rk(date, vid); return S.draft.has(k) ? S.draft.get(k) : (S.routes.get(k) || EMPTY); };
const routeOf = (date, vid) => recOf(date, vid).stops;
const vval = (v, f) => { const d = S.vdraft.get(v.id); return d && f in d ? d[f] : v[f]; };
/* ---------- 기준일자별 지원 여부(마이그레이션 38) ----------
   규칙: 어떤 날짜의 지원 여부는, 그 날짜를 기간 안에 둔 기준일자 중 시작일이 가장 늦은 것(govRound)이 정한다.
   - 경로는 (날짜, 장비) 한 줄을 모든 기준일자가 함께 씀. 지원 가능이 아닌 날의 경로는 지우지 않고 숨김(effRec) — 다시 지원 가능으로 하면 되살아남
   - 지원 불가 시작일(off_from): 2026-11-04 '지원 불가(이날부터)'를 없애 늘 비어 있음(서버도 막음). 예전 값을 읽을 때만 계산에 남겨 둠 */
const roundEnd = r => addDays(r.start_date, (r.days || 10) - 1);
const govRound = d => S.rounds.find(r => r.start_date <= d && d <= roundEnd(r)) || null;      // S.rounds 는 시작일이 늦은 순
const ST0 = { status: "", off_from: null, crew: [] };
const stOf = (rid, vid) => { const b = S.rstat.get(rid + "|" + vid) || ST0, d = rid === S.round ? S.sdraft.get(vid) : null; return d ? { ...b, ...d } : b; };
const availOn = (vid, d) => { const r = govRound(d); if (!r) return false; const x = stOf(r.id, vid); return x.status === "O" && (!x.off_from || d < x.off_from); };
const effRec = (d, vid) => availOn(vid, d) ? recOf(d, vid) : EMPTY;                       // 화면에 보이는 경로(지원 불가인 날은 없음)
// 연속지원: 전날 마지막으로 들른 지사 = 오늘 첫 번째 지사 → 오늘 그 지사의 도착 시각 대신 "연속지원"(사용자 결정 2026-10-08)
// 하루 경로의 도착 예상 시각 순서(2026-11-04, 서버 마이그레이션 64와 같은 규칙): 시각이 있는 칸끼리 앞 칸보다 늦어야 함(같은 시각도 안 됨), 빈 칸은 건너뜀.
// 첫 지사가 연속지원이면 첫 칸 시각은 화면에 안 보이므로 뺌. 어긋나면 { j: 뒤 칸, i: 앞 칸 } 을 돌려줌
function timeOrderBad(d, vid, rec) {
  const st = rec.stops, tm = rec.times || []; let last = -1;
  for (let j = 0; j < st.length; j++) { const x = tm[j]; if (!x || (j === 0 && isCont(vid, d, st[0]))) continue; if (last >= 0 && x <= tm[last]) return { j, i: last }; last = j; }
  return null;
}
const timeOrderMsg = (rec, b) => `${bn(rec.stops[b.j])} 도착 시각(${rec.times[b.j]})은 앞 지사 ${bn(rec.stops[b.i])}(${rec.times[b.i]})보다 늦어야 합니다`;
// 같은 지사를 하루에 두 번 들를 수 있어(64), 지사 카드·보고서는 '지금 있는 곳(p) 이후의 그 지사 방문'을 씀
const occAt = (stops, bid, p = 0) => { for (let i = p; i < stops.length; i++) if (stops[i] === bid) return i; return -1; };
const isCont = (vid, d, stop) => { if (!stop) return false; const p = effRec(addDays(d, -1), vid).stops; return p.length > 0 && p[p.length - 1] === stop; };
// 숨긴 장비(hidden_after): 그 날짜보다 늦게 시작하는 기준일자부터 기관별 장비 목록에서 안 보임(이전 기준일자·이동 현황 기록은 그대로)
// 지역본부 장비는 등록한 기준일자에서만 보임(다른 기준일자에서는 목록·카드·대수에 안 나옴)
const shownIn = (v, r) => isPool(v) ? !!r && v.round_id === r.id : (!v.hidden_after || (!!r && r.start_date <= v.hidden_after));
/* ---------- 기관별 배치(마이그레이션 43): 관리자가 "기관 → 지사 몇 대", 기계화부는 그 안에서 지원일 1의 장비별 지사를 고름 ---------- */
const ak = (org, bid) => org + "|" + bid, A0 = { truck: 0, blower: 0 }, AF = { "제설차": "truck", "제설기": "blower" };
const aval = (org, bid) => S.adraft.get(ak(org, bid)) || S.alloc.get(ak(org, bid)) || A0;      // 배정 탭에 보이는 값(고치는 중 포함)
const allocDirty = () => S.adraft.size > 0;
// 기관별 배치 합계(그 지사, 모든 기관 — 고치는 중 포함)와 편성 대수(저장된 것). 배정 합계는 편성을 넘을 수 없음(마이그레이션 46)
const asg = (bid, f) => +rbase(bid, f === "truck" ? "assigned_truck" : "assigned_blower") || 0;
const allocSum = (bid, f, except) => [...S.orgs, POOL].reduce((n, o) => n + (o === except ? 0 : aval(o, bid)[f] || 0), 0);
const orgHasAlloc = org => [...S.alloc.keys()].some(k => k.startsWith(org + "|"));               // 이 기준일자에 그 기관 배정이 하나라도 있는지(저장된 것)
// 저장된 배정 대수. 이동정비차는 배정하지 않으므로 '배정받은 지사이면 1 이상'
const allocCap = (org, type, bid) => { const a = S.alloc.get(ak(org, bid)); return !a ? 0 : type === "이동정비차" ? a.truck + a.blower : a[AF[type]] || 0; };
const day1Stop = vid => { const r = curRound(); return r ? effRec(r.start_date, vid).stops[0] || null : null; };   // 지원일 1(기준일자 첫날)의 첫 지사
const stopOn = (d, vid) => effRec(d, vid).stops[0] || null;                                   // 그날의 첫 지사
// 그 지사로 보낸 대수(그날 기준, 날짜를 안 주면 지원일 1). 2026-11-02: 기계화부·지사도 기준일자의 모든 지원일을 고르므로 날마다 셈
const allocUsed = (org, type, bid, d) => { const r = curRound(), day = d || (r && r.start_date); return S.vehicles.filter(v => v.org === org && v.type === type && shownIn(v, r) && day && stopOn(day, v.id) === bid).length; };
const allocBranches = (org, type) => S.order.filter(b => allocCap(org, type, b.id) > 0);
// 배정 초과 표시: 그 기관에 배정이 있는 기준일자에서만(배정을 쓰지 않는 기준일자는 예전처럼 아무 표시 없음). "over" 대수 넘음 / "none" 배정 없는 지사
const allocFlag = (v, bid) => { if (!bid || !orgHasAlloc(v.org)) return ""; const cap = allocCap(v.org, v.type, bid); return cap === 0 ? "none" : v.type !== "이동정비차" && allocUsed(v.org, v.type, bid) > cap ? "over" : ""; };
const flagTag = f => f ? `<span class="tag warn al-flag">${f === "none" ? "배정 없음" : "배정 초과"}</span>` : "";
function orgAllocSummary(org) {     // 기관별: 배정 합계·기계화부가 지정한 대수·지사별 줄
  const items = []; let total = 0, done = 0, over = false;
  S.order.forEach(b => ["제설차", "제설기"].forEach(t => { const cap = (S.alloc.get(ak(org, b.id)) || A0)[AF[t]] || 0; if (!cap) return;
    const used = allocUsed(org, t, b.id); items.push({ bid: b.id, type: t, cap, used }); total += cap; done += Math.min(used, cap); if (used > cap) over = true; }));
  return { items, total, done, over };
}
const REQ_DEF = { req_truck: 0, req_blower: 0, assigned_truck: 0, assigned_blower: 0, offer_truck: 0, arrive_at: null, reason: null, confirmed: false, saved_at: null, saved_lv: null,
  wx_manual: false, wx_snow: null, wx_pcp: null, wx_tmin: null, wx_tmin_at: null, wx_level: null, wx_fc: null, wx_ef: null };
const rbase = (b, f) => { const r = S.reqs[b]; return r ? r[f] : REQ_DEF[f]; };
const rval = (b, f) => { const d = S.rdraft.get(b); return d && f in d ? d[f] : rbase(b, f); };
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isManual = bid => !!rval(bid, "wx_manual");                       // 기상현황 직접입력을 켠 지사
const isConf = bid => !!(S.reqs[bid] && S.reqs[bid].confirmed);          // 저장된 확정(줄 바탕 노랑)
// 요청 있음 = 요청 제설차·제설기가 1대 이상(일괄 확정으로 줄만 생긴 지사는 아님). 편성 확정 = 확정했고 편성 대수가 1대 이상(저장된 것 기준)
const hasReq = bid => (+rval(bid, "req_truck") || 0) + (+rval(bid, "req_blower") || 0) > 0;
const isFixed = bid => isConf(bid) && (+rbase(bid, "assigned_truck") || 0) + (+rbase(bid, "assigned_blower") || 0) > 0;
// 타지사 지원 가능(제설차): 넣은 값 있음(입력 중 포함) / 확정됨(저장된 것 — 이때부터 그 지사가 지역본부 장비를 등록할 수 있음)
const hasOffer = bid => (+rval(bid, "offer_truck") || 0) > 0;
const offerOf = bid => +rbase(bid, "offer_truck") || 0;
const offerOk = bid => isConf(bid) && offerOf(bid) > 0;
const offerBranches = () => S.order.filter(b => offerOk(b.id));
const poolVehs = bid => S.vehicles.filter(v => isPool(v) && shownIn(v, curRound()) && (!bid || v.home_branch === bid));   // 고른 기준일자의 지역본부 장비
const canEdit = b => canReq(b) && !isConf(b.id);
// 저장 완료(마이그레이션 46): 지사·본부 계정이 그 줄을 저장한 적이 있음(요청·지원 가능이 0이어도). 관리자는 확정으로 충분해 [저장] 칸이 없음
const isSaved = bid => !!rbase(bid, "saved_at");
// 누가 저장했는지(2026-11-02, 마이그레이션 50): 지사 계정 = 지사저장, 본부 계정 = 본부저장, 관리자 = 본사저장. 마지막에 저장한 쪽이 보임
const SAVE_LV = { branch: "지사저장", hq: "본부저장", admin: "본사저장" };
const myLv = () => can("req.confirm") ? "admin" : can("req.edit.hq") ? "hq" : "branch";
const savedLabel = bid => SAVE_LV[rbase(bid, "saved_lv")] || "저장 완료";
// 지사별 요청·편성 보기 버튼(짧은 이름, 2026-11-03: 한 번에 하나만). [키, id, 이름, 설명]
const BVIEWS = [["req", "onlyActive", "요청", "요청 있는 지사만"], ["fixed", "onlyFixed", "편성", "편성 확정된 지사만"],
  ["offer", "onlyOffer", "지원", "타지사 지원 가능 대수가 있는 지사만"], ["unsaved", "onlyUnsaved", "저장안함", "아직 저장하지 않은 지사만"]];
const canMarkSave = b => canEdit(b) && !can("req.confirm");                         // 확정한 줄은 [취소]하기 전까지 아무도 못 고침(서버도 막음, 마이그레이션 35)
const dis = bid => isConf(bid) ? " disabled" : "";                       // 확정한 줄의 입력칸 = 비활성(보이기만)
/* ---------- 특보 — 지사 관할 특보구역 중 가장 높은 단계. 확정한 지사는 확정 순간 값(서버가 고정), 자료가 없으면 특보 없음 ---------- */
const WLV = { "예비": ["w1", "예비특보"], "주의": ["w2", "대설주의보"], "경보": ["w3", "대설경보"] };
// 단계 + 종류 → 이름(대설은 예전 그대로: 예비특보·대설주의보·대설경보 / 다른 종류: 강풍 예비특보·강풍주의보·강풍경보)
const wlabel = (level, kind) => !level ? "특보 없음" : (!kind || kind === "대설") ? (WLV[level] || [0, level])[1] : kind + (level === "예비" ? " 예비특보" : level === "주의" ? "주의보" : "경보");
// 지사 특보(대설만): { level, kind, zones:[[코드, 이름, 단계, 종류, 발표, 발효]…], fc, ef, base, note, fixed, at } — fc·ef 는 가장 높은 단계 구역의 발표·발효 시각
function warnOf(bid) {
  const r = S.reqs[bid];
  if (isManual(bid)) return { level: rval(bid, "wx_level") || null, kind: "대설", fc: rval(bid, "wx_fc"), ef: rval(bid, "wx_ef"), zones: [], manual: true, fixed: isConf(bid) };
  const top = z => ({ kind: z.length ? z[0][3] || "대설" : null, fc: z.length ? z[0][4] || null : null, ef: z.length ? z[0][5] || null : null });
  if (r && r.confirmed) { const z = r.warn_zones || []; return r.warn_at ? { level: r.warn_level || null, ...top(z), zones: z, base: r.warn_base, note: r.warn_note, fixed: true, at: r.warn_at } : { none: true }; }
  const w = S.warn || {}, x = (w.branches || {})[bid], z = x ? x.zones : [];
  return { level: x ? x.level : null, ...top(z), zones: z, base: w.base, note: w.ok ? null : (w.note || "기상청 자료를 받지 못함"), fixed: false };
}
// 예비특보의 발효 시각은 기상청 약속 시각(시:분 → 때)
const EF_SLOT = { "02:59": "새벽(00~03시)", "05:59": "새벽(03~06시)", "08:59": "아침(06~09시)", "11:59": "오전(09~12시)", "14:59": "낮(12~15시)", "17:59": "늦은 오후(15~18시)",
  "20:59": "저녁(18~21시)", "23:59": "밤(21~24시)", "11:58": "오전(06~12시)", "17:58": "오후(12~18시)", "05:58": "새벽(00~06시)", "23:58": "밤(18~24시)", "14:58": "오후(12~18시)" };
function fmtWarnTime(iso, level, ef) {     // "10/5 04:00", 예비특보 발효는 "10/5 새벽(00~06시)"
  if (!iso) return "-";
  const d = new Date(iso); if (isNaN(d)) return "-";
  const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`, md = `${d.getMonth() + 1}/${d.getDate()}`;
  return ef && level === "예비" && EF_SLOT[hm] ? `${md} ${EF_SLOT[hm]}` : `${md} ${hm}`;
}
function warnBadge(bid) {
  const w = warnOf(bid);
  if (w.none) return `<span class="muted">-</span>`;
  const cls = (WLV[w.level] || ["w0"])[0];
  return `<span class="wb ${cls}" data-wb="${esc(bid)}">${esc(wlabel(w.level, "대설"))}</span>`;
}
// 직접입력 대설특보 발표·발효 시각: [시 ▾]:[분 ▾] (시 00~23, 분 10분 단위). 날짜는 기준일자, 시를 '--'로 두면 비움
function hmSelects(bid, f, label) {
  const v = rval(bid, f), d = v ? new Date(v) : null, ok = d && !isNaN(d), hh = ok ? p2(d.getHours()) : "", mm = ok ? p2(d.getMinutes()) : "00";
  const mins = MINS.includes(mm) ? MINS : [...MINS, mm].sort(), a = `data-wxt="${esc(bid)}" data-f="${f}"`;
  return `<span class="hm"><select class="ci" ${a} data-part="h" data-fk="wh:${esc(bid)}:${f}" aria-label="${esc(label)} 시"${dis(bid)}><option value=""${hh ? "" : " selected"}>--</option>` +
    HOURS.map(x => `<option${x === hh ? " selected" : ""}>${x}</option>`).join("") + `</select>:` +
    `<select class="ci" ${a} data-part="m" data-fk="wm:${esc(bid)}:${f}" aria-label="${esc(label)} 분"${hh && !isConf(bid) ? "" : " disabled"}>` +
    mins.map(x => `<option${x === mm ? " selected" : ""}>${x}</option>`).join("") + `</select></span>`;
}
// 지사 줄의 [종류 | 발표 | 발효] 세 칸. 직접입력이면 종류 = 선택, 발표·발효 = 시:분 선택
function warnCells(bid) {
  const w = warnOf(bid), dash = '<span class="muted">-</span>', b = S.brById[bid];
  if (w.manual && b && canReq(b)) {
    const lv = rval(bid, "wx_level") || "", inp = f => hmSelects(bid, f, `${b.name} 특보 ${f === "wx_fc" ? "발표" : "발효"}`);
    return `<td class="wxe" data-wcell="${esc(bid)}"><select class="ci" data-rq="${esc(bid)}" data-f="wx_level" data-fk="q:${esc(bid)}:wx_level" aria-label="${esc(b.name)} 특보 종류"${dis(bid)}>` +
      [["", "특보 없음"], ["예비", "예비특보"], ["주의", "대설주의보"], ["경보", "대설경보"]].map(([v, l]) => `<option value="${v}"${v === lv ? " selected" : ""}>${l}</option>`).join("") + `</select></td>` +
      `<td class="wt wxe" data-wfc="${esc(bid)}">${inp("wx_fc")}</td><td class="wt wxe" data-wef="${esc(bid)}">${inp("wx_ef")}</td>`;
  }
  const t = (v, ef) => w.none || !w.level || !v ? dash : esc(w.manual ? fmtHM(v) : fmtWarnTime(v, w.level, ef));
  return `<td class="" data-wcell="${esc(bid)}">${warnBadge(bid)}</td><td class="wt" data-wfc="${esc(bid)}">${t(w.fc)}</td><td class="wt" data-wef="${esc(bid)}"><span class="wef">${t(w.ef, true)}</span></td>`;
}
const fmtBase = b => b && /^\d{12}$/.test(b) ? `${+b.slice(4, 6)}/${+b.slice(6, 8)} ${b.slice(8, 10)}:${b.slice(10, 12)}` : "-";
async function loadWarn() {      // 2026-11-11: 예상 적설은 바뀌었을 때만 다시 받음(S.fcStamp = 받은 것의 마지막 수정 시각)
  const [r, f] = await Promise.all([Api.warnings(), Api.forecast(S.fcStamp)]); if (r.ok) S.warn = r.status;
  if (f.ok && !f.same) { S.fc = Object.fromEntries(f.rows.map(x => [x.branch_id, x])); S.fcStamp = f.stamp || null; }
}
/* ---------- 예상 적설 — 기상청 단기예보 24시간 신적설 합의 지사 최댓값(발표 후 12시간 안). 확정한 지사는 확정 순간 값 ---------- */
function fcOf(bid) {      // { snow, pcp, pop, tmin, tmin_at, tmfc, start, end, nx, ny, pnx, pny, fixed, at, manual } 또는 { none } / null(예보 없음)
  const r = S.reqs[bid];
  if (isManual(bid)) return { snow: rval(bid, "wx_snow"), pcp: rval(bid, "wx_pcp"), tmin: rval(bid, "wx_tmin"), tmin_at: rval(bid, "wx_tmin_at"), manual: true, fixed: isConf(bid) };
  if (r && r.confirmed) return r.fc_at ? { snow: r.fc_snow, pcp: r.fc_pcp, snow_hi: r.fc_snow_hi, pcp_hi: r.fc_pcp_hi, pop: r.fc_pop, tmin: r.fc_tmin, tmin_at: r.fc_tmin_at, tmfc: r.fc_tmfc, fixed: true, at: r.fc_at } : { none: true };
  const f = S.fc[bid];
  if (!f || Date.now() - Date.parse(f.issued_at) > 12 * 3600e3) return null;
  const d = f.detail || {};
  return { snow: f.max_snow_24h, pcp: f.max_pcp_24h, snow_hi: f.max_snow_hi, pcp_hi: f.max_pcp_hi, pop: f.max_pop_24h, tmin: f.min_tmp, tmin_at: f.min_tmp_at, tmfc: f.issued_at, start: d.start_at, end: d.end_at, nx: f.worst_nx, ny: f.worst_ny, pnx: d.pcp_nx, pny: d.pcp_ny, fixed: false };
}
const fmtCm = v => v == null ? "-" : (Math.round(v * 10) / 10).toFixed(1);
// 예보 적설·강수(2026-11-04): 기상청 격자 값은 정수로만 옴 → 소수점 없이. '1mm·1cm 미만' 시각이 있으면 범위(아래~위, 위 = '~1' 시각마다 +1, 0~1 은 '~1'). 직접입력 값은 넣은 그대로(소수점 한 자리)
const rngTxt = (lo, hi) => { if (lo == null) return "-"; const a = Math.round(lo), b = hi == null ? a : Math.round(hi); return b > a ? (a === 0 && b === 1 ? "~1" : `${a}~${b}`) : String(a); };
const fcAmt = (f, k) => !f || f.none || f[k] == null ? "-" : f.manual ? fmtCm(f[k]) : rngTxt(f[k], f[k + "_hi"]);
const fmtTmp = v => v == null ? "-" : String(Math.round(v * 10) / 10);                        // 기온(℃): -5, 1.5
const fmtHM = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? `${p2(d.getHours())}:${p2(d.getMinutes())}` : "-"; };   // 직접입력 특보 시각(시:분)
// k = "snow"(적설 cm) / "pcp"(강수 mm) / "pop"(강수확률 % — 예보 값만, 직접입력 줄은 '-') / "tmin"(최저기온 ℃). 값을 누르면 기관별 24시간 예보의 그 지사로.
// 직접입력이면 입력칸(고칠 수 없으면 값만, 누를 수 없음)
const WX_FIELD = { snow: "wx_snow", pcp: "wx_pcp", tmin: "wx_tmin" };      // 최저기온 시각 칸은 2026-10-15 사용자 요청으로 뺌(값은 서버에 그대로)
const fcText = (k, v) => k === "tmin" ? fmtTmp(v) : k === "pop" ? String(Math.round(v)) : fmtCm(v);      // 직접입력 줄 값
function fcInner(bid, k = "snow") {
  const f = fcOf(bid), v = f && !f.none ? f[k] : null;
  if (f && f.manual) {
    if (k === "pop") return `<span class="muted">-</span>`;          // 강수확률은 직접 넣지 않음
    const b = S.brById[bid], fld = WX_FIELD[k];
    if (b && canReq(b)) {
      const rng = k === "tmin" ? 'min="-60" max="50"' : 'min="0" max="999"';
      return `<input class="ci num wxn" type="number" inputmode="decimal" step="0.1" ${rng} data-rq="${esc(bid)}" data-f="${fld}" data-fk="q:${esc(bid)}:${fld}" value="${esc(v ?? "")}" aria-label="${esc(b.name)} ${{ snow: "적설(cm)", pcp: "강수(mm)", tmin: "최저기온(℃)" }[k]}"${dis(bid)}>`;
    }
    return `<span class="fcm">${v == null ? "-" : esc(fcText(k, v))}</span>`;
  }
  if (!f) return `<span class="muted fcv" data-fb="${esc(bid)}" data-fk2="${k}" tabindex="0">-</span>`;
  if (f.none) return `<span class="muted">-</span>`;
  const vh = k === "snow" || k === "pcp" ? Math.max(v || 0, f[k + "_hi"] || 0) : v;      // 범위가 있으면 위쪽으로 색
  const cls = k === "snow" ? (vh >= 5 ? " hi" : vh > 0 ? " some" : "") : k === "pcp" ? (vh >= 30 ? " hi" : vh > 0 ? " wet" : "") : k === "pop" ? (v >= 60 ? " wet" : "")
    : k === "tmin" ? (v != null && v <= -10 ? " cold2" : v != null && v <= 0 ? " cold" : "") : " at";
  return `<span class="fcv${cls}" data-fb="${esc(bid)}" data-fk2="${k}" tabindex="0" role="link">${v == null ? "-" : esc(k === "snow" || k === "pcp" ? fcAmt(f, k) : fcText(k, v))}</span>`;
}
function warnBase() {
  const w = S.warn; if (!w || !w.ok || !w.fetched_at) return "자료 없음";
  return `${fmtShort(w.fetched_at)} 기준`;
}
function openForecast(bid) {          // 강설량 측정 → 기관별 24시간 예보 → 그 지사
  try { if (window.top !== window && window.top.SSOpenForecast) return window.top.SSOpenForecast(bid); } catch (e) {}
  window.open("../#fc=" + encodeURIComponent(bid), "_top");
}
const fmtHour = iso => { const d = new Date(iso); return isNaN(d) ? "-" : `${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}시`; };
function paintWarn() {                // 자동 값만 새로 그림(직접입력 줄은 입력 중일 수 있어 그대로)
  document.querySelectorAll("[data-fcell]").forEach(td => { if (!isManual(td.dataset.fcell)) td.innerHTML = fcInner(td.dataset.fcell, "snow"); });
  document.querySelectorAll("[data-pcell]").forEach(td => { if (!isManual(td.dataset.pcell)) td.innerHTML = fcInner(td.dataset.pcell, "pcp"); });
  document.querySelectorAll("[data-ocell]").forEach(td => { if (!isManual(td.dataset.ocell)) td.innerHTML = fcInner(td.dataset.ocell, "pop"); });
  document.querySelectorAll("[data-tcell]").forEach(td => { if (!isManual(td.dataset.tcell)) td.innerHTML = fcInner(td.dataset.tcell, "tmin"); });
  const wb = document.getElementById("wBaseHead"); if (wb) wb.textContent = warnBase();
  document.querySelectorAll("tr[data-b]").forEach(tr => {
    const td = tr.querySelector("[data-wcell]"); if (!td || isManual(tr.dataset.b)) return;
    const t = document.createElement("tr"); t.innerHTML = warnCells(tr.dataset.b);
    [...t.children].forEach((n, i) => { const o = tr.querySelector(["[data-wcell]", "[data-wfc]", "[data-wef]"][i]); if (o) o.innerHTML = n.innerHTML; });
  });
}
function setRoute(date, vid, rec) {
  rec = normRec(rec); const k = rk(date, vid);
  if (same(rec, S.routes.get(k) || EMPTY)) S.draft.delete(k); else S.draft.set(k, rec);
}
function setVeh(vid, f, val) {
  const v = vehById(vid), d = { ...(S.vdraft.get(vid) || {}) };
  if (same(val, v[f])) delete d[f]; else d[f] = val;
  if (Object.keys(d).length) S.vdraft.set(vid, d); else S.vdraft.delete(vid);
}
function setStat(vid, patch) {           // 고른 기준일자의 지원 여부(지원/빈칸)
  const b = S.rstat.get(S.round + "|" + vid) || ST0, m = { status: b.status, off_from: b.off_from || null, crew: b.crew || [], ...(S.sdraft.get(vid) || {}), ...patch };
  if (m.status !== "O") m.off_from = null;
  if (m.status === b.status && (m.off_from || null) === (b.off_from || null) && same(m.crew, b.crew || [])) S.sdraft.delete(vid); else S.sdraft.set(vid, { status: m.status, off_from: m.off_from || null, crew: m.crew.slice() });
  [...S.draft].forEach(([k, x]) => { const [d, v] = k.split("|"); if (v === vid && x.stops.length && !availOn(vid, d)) S.draft.delete(k); });   // 지원 불가가 된 날의 고친 경로는 버림(서버가 받지 않음)
}
function setReq(b, f, val) {
  const d = { ...(S.rdraft.get(b) || {}) };
  if (same(val, rbase(b, f))) delete d[f]; else d[f] = val;
  if (Object.keys(d).length) S.rdraft.set(b, d); else S.rdraft.delete(b);
}
// 경로·지원 여부 변경(S.draft·S.sdraft)은 기관별 장비와 신속대응팀이 함께 씀 → 장비 번호로 나눠 셈
const draftKeys = team => [...S.draft.keys()].filter(k => isTeamId(k.split("|")[1]) === team);
const sdraftKeys = team => [...S.sdraft.keys()].filter(id => isTeamId(id) === team);
const fleetDataDirty = () => draftKeys(false).length > 0 || S.vdraft.size > 0 || sdraftKeys(false).length > 0;      // 경로·지원 여부·장비(엑셀 저장 전에 확정해야 하는 것)
const fleetDirty = () => fleetDataDirty() || colsDraftOf("equip") != null || day1DraftOf("equip") != null;      // + 보기 칸(지원일 1·칸 수, 94)
const teamDirty = () => draftKeys(true).length > 0 || sdraftKeys(true).length > 0 || colsDraftOf("team") != null || day1DraftOf("team") != null;
function clearDrafts(team) { draftKeys(team).forEach(k => S.draft.delete(k)); sdraftKeys(team).forEach(id => S.sdraft.delete(id)); [...S.extraStop].filter(k => isTeamId(k.split("|")[1]) === team).forEach(k => S.extraStop.delete(k)); if (!team) S.vdraft.clear();
  [S.colsDraft, S.day1Draft].forEach(m => [...m.keys()].filter(k => k.endsWith(team ? "|team" : "|equip")).forEach(k => m.delete(k))); }
const anyDirty = () => fleetDirty() || teamDirty() || branchDirty() || allocDirty();
const branchDirty = () => S.rdraft.size > 0;

/* ============================================================
   [2] 불러오기
   ============================================================ */
function identityOf(d) {
  const br = d.branch ? S.branches.find(b => b.name === d.branch) : null, hq = d.hq ? S.hqs.find(h => h.name === d.hq) : null;
  return { label: d.label, username: d.label, role: d.role, perms: d.perms || [], branch_id: br ? br.id : null, org: d.org || null, hq_id: hq ? hq.id : br ? br.hq_id : null };
}
// 94(2026-11-11 사용자): 지원일 칸 수 = 기준일자마다 저장한 값(기관별 장비 cols_equip · 강원본부 지원장비 cols_team, 처음 4). 모든 아이디가 이만큼 봄.
//  바꾸기: 기관별 장비 = 관리자(equip.route), 강원본부 지원장비 = 관리자·강원본부(canTeam). 바꾸면 '확정하지 않은 변경'이 되고 그 탭의 [확정]으로 함께 저장
const COLS_F = { equip: "cols_equip", team: "cols_team" };
const colsSaved = kind => { const r = curRound(), v = r ? Number(r[COLS_F[kind]]) : NaN; return Number.isInteger(v) && v >= 2 && v <= 10 ? v : 4; };
const colsDraftOf = kind => { const r = curRound(); if (!r) return null; const v = S.colsDraft.get(r.id + "|" + kind); return v != null && v !== colsSaved(kind) ? v : null; };
const colsOf = kind => colsDraftOf(kind) ?? colsSaved(kind);
function setColsDraft(kind, n) { const r = curRound(); if (!r) return; n = Math.min(10, Math.max(2, Math.round(+n) || 4)); const k = r.id + "|" + kind; if (n === colsSaved(kind)) S.colsDraft.delete(k); else S.colsDraft.set(k, n); }
// 지원일 1(94): 기준일자마다 저장한 날짜(day1_equip·day1_team, 없으면 기준일자 첫날), 기준일자 기간 안에서만. 바꾸는 사람·저장은 칸 수와 같음
const DAY1_F = { equip: "day1_equip", team: "day1_team" };
const day1Saved = kind => { const r = curRound(); if (!r) return todayISO(); const v = typeof r[DAY1_F[kind]] === "string" ? r[DAY1_F[kind]].slice(0, 10) : ""; return v && v >= r.start_date && v <= roundEnd(r) ? v : r.start_date; };
const day1DraftOf = kind => { const r = curRound(); if (!r) return null; const v = S.day1Draft.get(r.id + "|" + kind); return v != null && v !== day1Saved(kind) ? v : null; };
const day1Of = kind => day1DraftOf(kind) ?? day1Saved(kind);
function setDay1Draft(kind, v) { const r = curRound(); if (!r) return; const k = r.id + "|" + kind; if (v === day1Saved(kind)) S.day1Draft.delete(k); else S.day1Draft.set(k, v); }
function windowDates(kind) { kind = kind || "equip"; const d1 = day1Of(kind); return Array.from({ length: colsOf(kind) }, (_, i) => addDays(d1, i)); }
async function ensureRoutes() {          // 기관별 장비 칸(지원일 1~n)과 이동 현황 날짜 앞뒤 2주를 불러 둠
  const ds = ["equip", "team"].flatMap(k => [day1Of(k), addDays(day1Of(k), colsOf(k) - 1)]).concat([addDays(S.date, -14), addDays(S.date, 14)]).sort();
  let from = ds[0], to = ds[ds.length - 1];
  if (S.loaded && from >= S.loaded[0] && to <= S.loaded[1]) return ensureStatus();
  if (S.loaded) { from = from < S.loaded[0] ? from : S.loaded[0]; to = to > S.loaded[1] ? to : S.loaded[1]; }
  const r = await Api.routes(from, to);
  if (!r.ok) return toast(r.message, true);
  [...S.routes.keys()].forEach(k => { const d = k.split("|")[0]; if (d >= from && d <= to) S.routes.delete(k); });
  r.rows.forEach(x => { S.routes.set(rk(x.date, x.vehicle_id), normRec(x)); if (x.confirmed_at) S.rmeta.set(rk(x.date, x.vehicle_id), x.confirmed_at); });
  S.loaded = [from, to];
  await ensureStatus();
}
async function ensureStatus() {          // 불러 둔 날짜 범위에 걸치는 기준일자(+ 고른 기준일자)의 지원 여부
  const [from, to] = S.loaded || [S.date, S.date];
  const ids = S.rounds.filter(r => r.id === S.round || (r.start_date <= to && roundEnd(r) >= from)).map(r => r.id).filter(id => !S.stLoaded.has(id));
  if (!ids.length) return;
  const r = await Api.statuses(ids);
  if (!r.ok) return toast(r.message, true);
  ids.forEach(id => S.stLoaded.add(id));
  r.rows.forEach(x => S.rstat.set(x.round_id + "|" + x.vehicle_id, { status: x.status || "", off_from: x.off_from || null, crew: (x.crew || []).slice(), updated_at: x.updated_at || null }));
}
async function loadReqs() {        // 못 읽으면 S.reqsBad: 값이 0대·미확정으로 보여 잘못 확정·저장하지 않도록 표를 숨기고 저장을 막음(2026-11-03)
  S.reqsBad = false;
  if (!S.round) { S.reqs = {}; return; }
  const r = await Api.requests(S.round);
  S.reqs = {};
  if (!r.ok) { S.reqsBad = true; return toast(r.message, true); }
  r.rows.forEach(x => { S.reqs[x.branch_id] = { ...x, arrive_at: localInput(x.arrive_at), reason: x.reason || null }; });
}
/* ---------- [새로고침]: 다른 아이디가 넣은 자료를 화면을 새로 열지 않고 다시 읽음(이동 현황·기관별 장비·지사별 요청·편성·기관별 배치 공통) ---------- */
let reloading = false;
// 새로고침 버튼은 위쪽 탭 줄 오른쪽 하나(2026-11-02 — 스크롤해도 늘 보이게). 첫 화면 안에서는 바깥 메뉴 줄의 버튼이 SSEqReload 를 부름
function paintReload() {
  const at = S.reloadedAt ? fmtShort(S.reloadedAt).split(" ")[1] + " 불러옴" : "";
  document.querySelectorAll("[data-reload]").forEach(b => { b.disabled = reloading; b.textContent = reloading ? "불러오는 중…" : "새로고침"; });
  document.querySelectorAll("[data-reload-at]").forEach(x => { x.textContent = at; });
  try { if (window.top !== window && window.top.SSEqReloadState) window.top.SSEqReloadState(reloading, at); } catch (e) {}
}
window.SSEqReload = () => reloadAll();
async function reloadAll() {
  if (reloading) return;
  if (anyDirty() && !confirm("확정·저장하지 않은 변경이 있습니다. 버리고 새로 불러올까요?")) return;
  reloading = true; paintReload();
  const r = await Api.reload();
  if (!r.ok) { reloading = false; paintReload(); refresh(); return toast(r.message, true); }
  S.draft.clear(); S.vdraft.clear(); S.sdraft.clear(); S.rdraft.clear(); S.adraft.clear(); S.extraStop.clear(); S.colsDraft.clear(); S.day1Draft.clear();
  S.vehicles = r.vehicles.filter(v => v.active !== false); sortVehicles();
  S.rounds = r.rounds.slice().sort((a, b) => b.start_date.localeCompare(a.start_date));
  if (!curRound()) S.round = pickRound();      // 보고 있던 기준일자가 지워졌으면 가장 최근 것으로(지원일 1은 그 기준일자에 저장된 날짜, 94)
  S.loaded = null; S.routes.clear(); S.rmeta.clear(); S.rstat.clear(); S.stLoaded.clear();
  await Promise.all([ensureRoutes(), loadReqs(), loadAudit(), loadWarn(), loadAlloc()]);
  S.reloadedAt = new Date().toISOString(); reloading = false; paintReload();
  if (!sheet.hidden) closeSheet();
  refresh(); toast("새로 불러왔습니다");
}
async function loadAlloc() {
  S.alloc = new Map(); if (!S.round) return;
  const r = await Api.allocations(S.round);
  if (!r.ok) return toast(r.message, true);
  r.rows.forEach(x => S.alloc.set(ak(x.org, x.branch_id), { truck: x.truck || 0, blower: x.blower || 0 }));
}
async function loadAudit() { const r = await Api.audit(); S.audit = r.ok ? r.rows : []; }
function pickRound() {      // 기준일자: 오늘 이전 것 중 가장 최근, 없으면 가장 이른 것
  const t = todayISO(), past = S.rounds.filter(r => r.start_date <= t);
  return (past[0] || S.rounds[S.rounds.length - 1] || {}).id || null;
}
async function boot() {
  const r = await Api.load(todayISO());
  if (!r.ok) {
    $("loading").innerHTML = `<b>${esc(r.message)}</b>` + (r.login ? `<p><a href="../" target="_top">첫 화면으로 가서 로그인하세요</a></p>` : `<p>새로고침(F5)해 보세요.</p>`);
    return;
  }
  S.hqs = r.hqs.slice().sort((a, b) => a.sort - b.sort); S.branches = r.branches; S.vehicles = r.vehicles.filter(v => v.active !== false);
  S.rounds = r.rounds.slice().sort((a, b) => b.start_date.localeCompare(a.start_date)); S.holdings = r.holdings;
  const OO = ["서울경기", "충북", "전북", "대구경북"];
  const mech = r.orgs.filter(o => o !== POOL);                     // 기관 목록의 '지역본부'는 기계화부가 아님(따로 다룸)
  S.orgs = (mech.length ? mech : OO).slice().sort((a, b) => ((OO.indexOf(a) + 1) || 99) - ((OO.indexOf(b) + 1) || 99));
  S.hqById = Object.fromEntries(S.hqs.map(h => [h.id, h])); S.brById = Object.fromEntries(S.branches.map(b => [b.id, b]));
  S.team = (r.team || []).map(t => ({ id: t.id, name: t.name, sort: t.sort, org: TEAM, type: "제설차", plate: t.name, active: true }));   // 강원 신속대응팀(장비 모양)
  S.order = S.hqs.flatMap(h => S.branches.filter(b => b.hq_id === h.id));               // 본부(순서) → 지사(번호 순) = 강설량 화면과 같은 계층
  sortVehicles();
  if (r.me) {
    S.real = { label: r.me.display_name, username: r.me.username, role: r.me.role, perms: r.me.perms || [], branch_id: r.me.branch_id, org: r.me.org, hq_id: r.me.hq_id || (S.brById[r.me.branch_id] || {}).hq_id || null };
    S.me = S.real; S.uid = "__me";
  } else { S.me = identityOf(DEMO[0]); S.uid = DEMO[0].id; }
  Api.setActor(S.me);
  S.round = pickRound();
  buildUserSel();
  await Promise.all([ensureRoutes(), loadReqs(), loadAudit(), loadWarn(), loadAlloc()]);
  S.reloadedAt = new Date().toISOString(); paintReload();   // 처음 연 시각도 메뉴 줄 [새로고침] 옆에
  $("loading").hidden = true; document.querySelector("main").hidden = false;
  try { refresh(); }
  catch (e) {          // 그리다가 오류가 나면 빈 탭 대신 알림(원인 찾기용)
    toast("화면을 그리다 오류가 났습니다. Ctrl+F5 로 새로고침해 보세요. (" + (e && e.message) + ")", true); throw e;
  }
}

/* ============================================================
   [3] 공통: 알림·말풍선(수정 기록)·안내
   ============================================================ */
let toastTimer;
function toast(msg, isErr) {
  const el = $("toast"); el.textContent = msg; el.className = "toast" + (isErr ? " err" : ""); el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}
const TAB_LABEL = { gw_team_routes: "신속대응팀 경로", gw_team_status: "신속대응팀 지원 여부", vehicles: "장비", vehicle_routes: "경로", round_vehicle_status: "지원 여부", round_requests: "지사 요청", round_allocations: "기관별 배치", support_rounds: "기준일자", branch_zone_overrides: "특보구역" };
const FIELD = { crew: "운전원", offer_truck: "타지사 지원 가능", rented: "임차", home_branch: "출발 지사", truck: "배정 제설차", blower: "배정 제설기", fc_snow: "확정 예상 적설", fc_pcp: "확정 예상 강수", fc_pop: "확정 강수확률", wx_manual: "기상현황 직접입력", wx_snow: "직접 적설", wx_pcp: "직접 강수", wx_tmin: "직접 최저기온", wx_tmin_at: "직접 최저기온 시각", fc_tmin: "확정 최저기온", wx_level: "직접 대설특보", wx_fc: "직접 특보 발표", wx_ef: "직접 특보 발효", plate: "도공번호", status: "지원 여부", stops: "경로", revised: "구분", times: "도착 예상", snow_cm: "예상 적설", warning: "특보", req_truck: "요청 제설차", req_blower: "요청 제설기",
  blower_s: "블로워 소", blower_l: "블로워 대", off_from: "지원 불가 시작일", hidden_after: "숨김", days: "기간(일)", cols_equip: "기관별 장비 지원일 칸", cols_team: "강원본부 지원장비 지원일 칸", day1_equip: "기관별 장비 지원일 1", day1_team: "강원본부 지원장비 지원일 1", assigned_truck: "편성 제설차", assigned_blower: "편성 제설기", arrive_at: "도착 요청", reason: "사유", confirmed: "확정", start_date: "기준일자", type: "장비", org: "기관", warn_level: "확정 특보", include: "특보구역" };
const HIDE = new Set(["fc_tmfc", "fc_at", "zone_code", "warn_zones", "warn_base", "warn_at", "warn_note", "updated_by", "updated_at", "confirmed_by", "confirmed_at", "created_by", "created_at", "round_id", "branch_id", "vehicle_id", "team_id", "date", "id", "sort", "active", "name", "end_date"]);
function fmtField(f, v) {
  if (f === "warn_level" || f === "wx_level") return v ? (WLV[v] || [0, v])[1].replace("대설", "") || v : "특보 없음";
  if (f === "wx_manual") return v ? "켬" : "끔";
  if (f === "rented") return v ? "임차" : "일반";
  if (f === "home_branch") return v ? bn(v) : "-";
  if ((f === "wx_fc" || f === "wx_ef") && v) return fmtHM(v);
  if (f === "wx_tmin_at" && v) return fmtWarnTime(v);
  if (f === "include") return v == null ? "자동대로" : v ? "더함" : "뺌";
  if ((f === "cols_equip" || f === "cols_team") && v != null) return v + "칸";
  if (f === "day1_equip" || f === "day1_team") return v ? fmtMD(v) : "기준일자 첫날";
  if (v == null || v === "") return f === "stops" ? "(없음)" : f === "hidden_after" ? "숨기지 않음" : f === "off_from" ? "(없음)" : "(빈칸)";
  if (f === "stops") return v.length ? v.map(bn).join(" → ") : "(없음)";
  if (f === "revised") return v ? "수정본" : "최초 지원";
  if (f === "times") return v.some(Boolean) ? v.map(x => x || "-").join(" → ") : "(없음)";
  if (f === "status") return v ? (STATUS[v] || STATUS[""])[1] : "빈칸";
  if (f === "off_from" || f === "start_date") return fmtMD(v) + (f === "off_from" ? "부터" : "");
  if (f === "hidden_after") return fmtMD(addDays(v, 1)) + " 기준일자부터 숨김";
  if (f === "warning") return v ? "발효" : "없음";
  if (f === "confirmed") return v ? "확정" : "미확정";
  if (f === "arrive_at") return fmtTime(localInput(v));
  if (f === "snow_cm" || f === "fc_snow") return v + "cm";
  if (f === "fc_pcp") return v + "mm";
  if (f === "fc_pop") return v + "%";
  return String(v);
}
// 칸 하나(target)의 오늘 수정 기록. field 를 주면 그 열이 바뀐 기록만
const histOf = (target, field) => S.audit.filter(a => a.target === target && sameDay(a.at) && (!field || (a.to_val && field in a.to_val) || (a.from_val && field in a.from_val)));
let HIST_TIP = false;     // 수정 기록 말풍선(밑줄 + 마우스를 올리면 기록): 지금은 꺼 둠(2026-10-07 사용자 요청). 다시 쓰려면 true — 코드·시험은 그대로 남아 있음
const hvA = (target, field = "") => HIST_TIP && can("log.view") && histOf(target, field).length ? ` data-hv="${esc(target)}" data-hf="${esc(field)}" tabindex="0"` : "";
const H = (target, field, html) => { const a = hvA(target, field); return a ? `<span${a}>${html}</span>` : html; };
const tip = $("tip");
function showTip(el) {
  const t = el.dataset.hv, f = el.dataset.hf || "stops", list = histOf(t, el.dataset.hf).slice(-3).reverse();
  if (!list.length) return;
  tip.innerHTML = `<b>이 칸의 오늘 수정 기록</b>` + list.map(h => `<div>${esc(p2(new Date(h.at).getHours()) + ":" + p2(new Date(h.at).getMinutes()))} · ${esc(h.username || "-")}<br>` +
    `${esc(fmtField(f, h.from_val ? h.from_val[f] : null))} → ${esc(fmtField(f, h.to_val ? h.to_val[f] : null))}</div>`).join("");
  placeTip(el);
}
function placeTip(el) {
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  let top = r.bottom + 8; if (top + tip.offsetHeight > innerHeight - 8) top = Math.max(8, r.top - tip.offsetHeight - 8);
  tip.style.top = top + "px"; tip.style.left = Math.max(8, Math.min(r.left, innerWidth - tip.offsetWidth - 8)) + "px";
}
// 표 제목의 '○시 기준'(점선)에 마우스를 올리면 얼마마다 새로 받는지
const BASE_TIP = { warn: "10분마다 업데이트 — 매시 01·11·21·31·41·51분" };
function showBaseTip(el) { tip.innerHTML = `<b>${esc(BASE_TIP[el.dataset.bt] || "")}</b>`; placeTip(el); }
const hideTip = () => { tip.hidden = true; };
["mouseover", "focusin"].forEach(ev => document.addEventListener(ev, e => { if (!e.target.closest) return; const bt = e.target.closest("[data-bt]"); if (bt) return showBaseTip(bt); const el = e.target.closest("[data-hv]"); if (el) showTip(el); }));
["mouseout", "focusout"].forEach(ev => document.addEventListener(ev, e => { if (e.target.closest && e.target.closest("[data-hv], [data-bt]")) hideTip(); }));
function banner(id) {           // 미리보기(다른 아이디 권한으로 보기) 중일 때만 짧게 알림
  const el = $(id); el.className = "perm"; el.hidden = !S.preview;
  el.innerHTML = S.preview ? `<b class="pv">미리보기: ${esc(S.me.label)} (저장 안 됨)</b>` : "";
}
function roundSel(id) {
  return `<label class="ctl">기준일자 <select class="ci" id="${id}" data-round>${S.rounds.length ? S.rounds.map(r => `<option value="${r.id}" ${r.id === S.round ? "selected" : ""}>${esc(fmtMD(r.start_date))} ${esc(r.start_date.slice(0, 4))}</option>`).join("") : '<option value="">(없음)</option>'}</select></label>`;
}

/* ============================================================
   [4] 이동 현황 (모두 보기만)
   ============================================================ */
const MOVE_TYPES = ["제설차", "제설기"];          // 이동 현황은 제설차·제설기만(이동정비차는 보이지 않음)
// 지사 사이 이동(사용자 결정 2026-10-09): 하루에 여러 지사를 들르면 두 번째 지사부터는 '그 지사의 시각에 앞 지사에서 옮겨 감'.
// 기준 시각(지금)이 지난 이동만 반영 — 지난 날짜는 모두 반영, 앞 날짜는 하나도 반영 안 함, 오늘은 시각이 지난 것만(시각이 없으면 오늘 안에는 반영 안 함).
// 이동은 순서대로만 반영(앞 이동이 안 끝났으면 뒤 이동도 안 끝난 것으로)
const nowHM = () => { const t = new Date(); return `${p2(t.getHours())}:${p2(t.getMinutes())}`; };
const moveDone = (date, t) => { const today = todayISO(); return date < today || (date === today && !!t && t <= nowHM()); };
function legsOf(date, rec) {
  const st = rec.stops, tm = rec.times || [], legs = []; let p = 0;
  for (let j = 1; j < st.length; j++) { const done = p === j - 1 && moveDone(date, tm[j] || ""); if (done) p = j; legs.push({ j, t: tm[j] || "", from: st[j - 1], to: st[j], done }); }
  return { p, pos: st[p], legs };          // p = 지금 있는 지사의 순번, pos = 지금 있는 지사
}
const moveVehs = () => S.showTeam ? S.vehicles.concat(S.team) : S.vehicles;          // 체크박스를 끄면 신속대응팀은 열·합계·카드에서 모두 빠짐
const moveOrgs = () => S.showTeam ? [...SOURCE_ORGS(), TEAM] : SOURCE_ORGS();
const colTypes = o => o === TEAM ? ["제설차"] : MOVE_TYPES;                           // 신속대응팀은 제설차만(제설기 칸 없음)
const movesOn = date => moveVehs().filter(v => MOVE_TYPES.includes(v.type)).map(v => { const rec = effRec(date, v.id); return { v, rec, stops: rec.stops, ...legsOf(date, rec) }; }).filter(m => m.stops.length);
const legText = l => `${l.t || "시각 미정"} 이동(${bn(l.from)}→${bn(l.to)})`;
// 연속지원이 언제부터인지: 전날로 거슬러 올라가며 그 지사에 처음 들어온 날·시각(불러온 날짜 범위 안에서)
function contSince(vid, d, bid) {
  let k = d;
  for (let i = 0; i < 60; i++) {
    const prev = addDays(k, -1), r = effRec(prev, vid), st = r.stops, j = st.length - 1;
    if (j < 0 || st[j] !== bid) return { date: k, time: null };
    if (j === 0 && isCont(vid, prev, bid)) { k = prev; continue; }
    return { date: prev, time: (r.times || [])[j] || null };
  }
  return { date: k, time: null };
}
// 표 위의 기준 시각. 앞 날짜는 이동 반영 전임을 함께(지난 날짜 안내는 사용자 요청으로 뺌, 2026-10-10)
function refTimeText() {
  const today = todayISO(), base = `기준 시각 ${fmtMD(today)} ${nowHM()}`;
  return S.date > today ? base + " (앞 날짜 — 이동 반영 전)" : base;
}
function renderMatrix() {
  // 세로 = 본부 → 지사(그날 지원받는 지사만), 가로 = 지원기관마다 제설차·제설기. 본부 줄·합계는 장비 1대를 한 번만 셈(여러 지사를 들러도)
  const moves = movesOn(S.date), src = moveOrgs(), cols = [null, ...src],   // 합계 열을 맨 앞(지사 이름 바로 옆)에. 신속대응팀 열은 맨 끝(겹세로줄)
     used = new Set(moves.flatMap(m => m.stops));
  const sel = (org, type) => moves.filter(m => (org == null || m.v.org === org) && m.v.type === type);
  const cnt = (org, ids, type) => sel(org, type).filter(m => !ids || ids.has(m.pos)).length;        // 지금(기준 시각) 있는 지사로 셈
  // 그 지사로 들어오거나 나갈 이동(아직 안 한 것만): "06:00 1대 인천→수원"(같은 시각·같은 길은 묶음). 이미 한 이동은 안 보임(숫자에만 반영, 사용자 결정 2026-10-09)
  const notes = (org, ids, type) => { if (!ids) return ""; const g = new Map();
    sel(org, type).forEach(m => m.legs.forEach(l => { if (l.done || (!ids.has(l.from) && !ids.has(l.to))) return; const k = [l.t, l.from, l.to].join("|"); g.set(k, { ...l, n: ((g.get(k) || {}).n || 0) + 1 }); }));
    return [...g.values()].sort((a, b) => (a.t || "99").localeCompare(b.t || "99")).map(l => `<span class="mvn">${esc(l.t || "시각 미정")} ${l.n}대 ${esc(bn(l.from))}→${esc(bn(l.to))}</span>`).join(""); };
  // 숫자를 누르면 아래 세부내역의 그 지사(본부)·지원기관·장비 종류 줄로 이동(jumpToDetail). sc = 줄 범위(본부 data-mh / 지사 data-mb / 합계 없음)
  const cells = (ids, sc = "") => cols.map(o => colTypes(o).map((t, k) => { const n = cnt(o, ids, t), mv = notes(o, ids, t);
    return `<td class="${k ? "c2" : "c1"}${o == null ? " tot" : ""}${o === TEAM ? " tm" : ""}${n || mv ? "" : " zero"}">${n ? `<button type="button" class="mnum" ${sc} data-mo="${o == null ? "" : esc(o)}" data-mt="${t}" title="아래 세부내역으로 이동">${n}</button>` : mv ? `<span class="mnum0">0</span>` : "·"}${mv}</td>`; }).join("")).join("");
  let body = "";
  S.hqs.forEach(h => {
    const brs = S.order.filter(b => b.hq_id === h.id && used.has(b.id)); if (!brs.length) return;
    brs.forEach((b, i) => { body += `<tr class="brrow${i === brs.length - 1 ? " grpend" : ""}">${i ? "" : `<th class="hqc" scope="rowgroup" rowspan="${brs.length}">${esc(h.name)}</th>`}<th scope="row">${esc(b.name)}</th>${cells(new Set([b.id]), `data-mb="${esc(b.id)}"`)}</tr>`; });
  });
  $("matrix").innerHTML = `<thead><tr><th class="l" scope="col" rowspan="2" colspan="2">본부 · 피지원 지사</th>${cols.map(o => `<th scope="colgroup" colspan="${colTypes(o).length}" class="orgh${o == null ? " tot" : ""}${o === TEAM ? " tm" : ""}">${o == null ? "합계" : esc(o)}</th>`).join("")}</tr>` +
    `<tr>${cols.map(o => colTypes(o).map((t, k) => `<th scope="col" class="${k ? "c2" : "c1"}${o == null ? " tot" : ""}${o === TEAM ? " tm" : ""}">${t}</th>`).join("")).join("")}</tr></thead>` +
    `<tbody>${body || `<tr><td class="empty" colspan="${cols.reduce((n, o) => n + colTypes(o).length, 0) + 2}">${esc(fmtMD(S.date))}에 이동하는 장비가 없습니다.</td></tr>`}</tbody>` +
    `<tfoot><tr><th scope="row" colspan="2">합계</th>${cells(null, 'data-mall="1"')}</tr></tfoot>`;
  const numN = cols.flatMap(o => o === TEAM ? [] : colTypes(o)).length, numW = Math.max(60, Math.min(80, Math.floor((tableRoom() - 28 - 168 - 104) / numN)));      // 컴퓨터: 숫자 칸 80px, 화면이 좁으면 가로 스크롤이 안 생기게 60px 까지 줄임
  fixCols($("matrix"), isPhoneW() ? [84, 92, ...cols.flatMap(o => colTypes(o).map(() => o === TEAM ? 110 : 76))] : [76, 92, ...cols.flatMap(o => colTypes(o).map(() => o === TEAM ? 104 : numW))], !isPhoneW());
  stickHead($("matrix"));
  const tr = moves.filter(m => m.v.type === "제설차").length, bl = moves.filter(m => m.v.type === "제설기").length;
  $("dateText").textContent = fmtMD(S.date); $("dateInput").value = S.date;      // 제목의 큰 날짜(누르면 달력)
  $("summaryNote").innerHTML = `<b>제설차 ${tr}대</b> · <b>제설기 ${bl}대</b> · <span id="refTime">${esc(refTimeText())}</span>` +
    `<label class="team-tg" title="끄면 강원 신속대응팀이 표의 열·합계와 아래 지사 카드에서 모두 빠집니다"><input type="checkbox" id="showTeam"${S.showTeam ? " checked" : ""}> ${TEAM}</label>` +
    // 1쪽 보고서(2026-11-02, report.js): 미리 보기 / 워드(.docx) 받기 — 이 날짜·이 표와 같은 자료
    `<span class="rpt-btns"><button type="button" class="btn sm" id="rptView" title="이 날짜 자료를 '신속대응팀 제설장비 지원 현황' 1쪽 양식으로 봅니다">보고서 보기</button><button type="button" class="btn sm" id="rptDoc" title="같은 1쪽 보고서를 워드(.docx) 파일로 받습니다">Word 받기</button></span>`;
}
// 이동 현황 표의 숫자 → 아래 세부내역에서 그 줄(지사 카드·본부 묶음·해당 지원기관·장비 종류)로 스크롤하고 잠깐 색으로 표시
let flashTimer;
function jumpToDetail(d) {
  const find = () => d.mb ? document.querySelector(`#destList [data-bid="${CSS.escape(d.mb)}"]`) : d.mh ? document.querySelector(`#destList [data-hqb="${CSS.escape(d.mh)}"]`) : $("destList");
  const pick = () => { const sc = find(); return { sc, rows: sc ? [...sc.querySelectorAll(".vrow")].filter(r => (!d.mo || r.dataset.vo === d.mo) && (!d.mt || r.dataset.vt === d.mt)) : [] }; };
  let { sc: scope, rows } = pick();
  if (!rows.length && (S.org !== "전체" || S.type !== "전체")) { S.org = "전체"; S.type = "전체"; renderFilters(); renderDest(); ({ sc: scope, rows } = pick()); }   // 아래 필터 때문에 가려졌으면 필터를 풀고 다시
  if (!scope) return;
  const card = d.mb ? scope : (rows[0] || scope).closest(".dest") || scope;
  document.querySelectorAll("#destList .hl, #destList .hl-card").forEach(el => el.classList.remove("hl", "hl-card"));
  rows.forEach(r => r.classList.add("hl")); card.classList.add("hl-card");
  card.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  clearTimeout(flashTimer); flashTimer = setTimeout(() => document.querySelectorAll("#destList .hl, #destList .hl-card").forEach(el => el.classList.remove("hl", "hl-card")), 2600);
}
function renderFilters() {
  const f = $("filters"); f.className = "filters two";
  f.innerHTML = `<div class="frow" role="group" aria-label="지원기관"><span class="flabel">지원기관</span><span class="chips">` +
    ["전체", ...SOURCE_ORGS()].map(o => `<button type="button" class="chip" data-org="${esc(o)}" aria-pressed="${S.org === o}">${o === "전체" ? "모든 기관" : esc(o)}</button>`).join("") + `</span></div>` +      // 신속대응팀은 '모든 기관'에서 보임(휴대폰 폭에 버튼 하나 더는 안 들어감)
    `<div class="frow" role="group" aria-label="장비 종류"><span class="flabel">장비</span><span class="chips">` +
    ["전체", ...MOVE_TYPES].map(t => `<button type="button" class="chip" data-type="${esc(t)}" aria-pressed="${S.type === t}">${t === "전체" ? "모든 장비" : esc(t)}</button>`).join("") + `</span></div>`;
  fitFilters();
}
// 지원기관 줄·장비 줄은 항상 두 줄. 화면이 좁아 한 줄에 안 들어가면 버튼 글자·여백을 같은 비율로 줄임(글자는 항상 가로, 최소 55%)
function fitFilters() {
  const f = $("filters"); if (!f || !f.offsetWidth) return;
  const rows = [...f.querySelectorAll(".frow")], over = () => Math.max(...rows.map(r => r.scrollWidth)) - (f.clientWidth - 2);
  let s = 1; f.style.setProperty("--s", s);
  for (let i = 0; i < 6 && over() > 0 && s > 0.55; i++) {          // 이름표는 그대로라 비율만으로는 모자랄 수 있어 다시 재며 줄임
    s = Math.max(0.55, s * (f.clientWidth - 2) / (f.clientWidth - 2 + over()) - 0.01); f.style.setProperty("--s", s.toFixed(3));
  }
}
addEventListener("resize", fitFilters);
if (window.ResizeObserver) new ResizeObserver(() => fitFilters()).observe($("filters"));   // 탭을 옮겨 다시 보일 때·iframe 크기가 바뀔 때도
const matches = v => (S.org === "전체" || v.org === S.org) && (S.type === "전체" || v.type === S.type);
function vehicleRow(v, stops, rec, bid, m) {
  const k = rec && bid ? occAt(rec.stops, bid, m ? m.p : 0) : -1;      // 같은 지사를 두 번 들르면 지금 있는 곳 이후의 방문(64)
  const cont = !!(rec && bid && k === 0 && isCont(v.id, S.date, bid));   // 전날부터 이어서 지원(연속지원)
  const eta = rec && bid && k === 0 && !cont ? (rec.times || [])[0] : null;   // 첫 지사에 도착할 예상 시각(두 번째 지사부터는 '이동' 시각)
  // 이동 표시(아직 안 한 이동만): 지금 있는 지사 = 다음에 나갈 이동, 앞으로 갈 지사 = 들어올 이동. 이미 한 이동은 안 보임
  const lg = m && k >= 0 ? (k === m.p ? [m.legs[k]] : [m.legs[k - 1]]).filter(l => l && !l.done) : [];
  const mvTags = lg.map(l => `<span class="tag mv">${esc(legText(l))}</span>`).join("");
  return `<button type="button" class="vrow${m && k > m.p ? " incoming" : ""}${isTeam(v) ? " team" : ""}" data-vid="${esc(v.id)}" data-vo="${esc(v.org)}" data-vt="${esc(v.type)}"><span class="plate">${esc(vname(v))}</span><span class="vtype">${esc(v.type)}</span>
    <span class="status-wrap">${hasBlower(v) ? `<span class="tag blw-tag">블로워 ${esc(blowerText(v))}</span>` : ""}${mvTags}${cont ? `<span class="tag eta">연속지원</span>` : eta ? `<span class="tag eta">${esc(eta)} 도착 예상</span>` : ""}</span></button>`;
}
function renderDest() {
  const moves = movesOn(S.date), filtered = S.org !== "전체" || S.type !== "전체", out = [];
  S.hqs.forEach(h => {
    const cards = [];
    S.order.filter(b => b.hq_id === h.id).forEach(b => {
      const list = moves.filter(m => occAt(m.stops, b.id, m.p) >= 0 && matches(m.v)), arr = rval(b.id, "arrive_at");   // 이미 떠난 지사에서는 안 보임(다시 들를 예정이면 보임)
      const arriveToday = arr && arr.slice(0, 10) === S.date && rval(b.id, "confirmed");
      if (!list.length && (filtered || !arriveToday)) return;       // 그날 이동도, 확정된 도착 요청도 없는 지사는 숨김
      const t = `round_requests:${S.round},${b.id}`, fc = fcOf(b.id), snow = fc && !fc.none ? fc.snow : null, why = rval(b.id, "reason");
      const contOf = m => occAt(m.rec.stops, b.id, m.p) === 0 && isCont(m.v.id, S.date, b.id);
      const etas = [...new Set(list.filter(m => !contOf(m)).map(m => (m.rec.times || [])[occAt(m.rec.stops, b.id, m.p)]).filter(Boolean))].sort();   // 연속지원 장비는 도착 시각 계산에서 뺌
      // 새로 오는 장비의 시각이 없고 연속지원 장비가 있으면 '미정' 대신 그 지사에 처음 와 있던 때(전날부터 이어서 지원 중)
      const since = etas.length ? null : list.filter(contOf).map(m => contSince(m.v.id, S.date, b.id)).sort((x, y) => (x.date + (x.time || "")).localeCompare(y.date + (y.time || "")))[0];
      cards.push(`<article class="dest" data-bid="${esc(b.id)}"><div class="dest-head">
        <h3 class="dest-name">${esc(b.name)}<span>${esc(h.name)}본부</span></h3>
        <div class="dest-time">${since ? `<strong>${esc(fmtMD(since.date) + (since.time ? " " + since.time : ""))}부터</strong><small>연속지원 중</small>` : `<strong>${etas.length ? esc(fmtMD(S.date) + " " + etas[0]) : "미정"}</strong><small>도착 예상${etas.length > 1 ? " (가장 이른 장비, 장비마다 다름)" : ""}</small>`}</div>
        <div class="dest-meta">${list.length ? "" : `<span class="tag req">도착 요청 ${esc(fmtTime(arr))}</span>`}${snow != null ? (fc.manual ? `<span class="tag snow">적설 ${esc(fmtCm(snow))}cm · 강수 ${esc(fmtCm(fc.pcp))}mm${fc.tmin != null ? ` · 최저 ${esc(fmtTmp(fc.tmin))}℃` : ""} (직접입력)</span>` : `<span class="tag snow" data-fb="${esc(b.id)}" tabindex="0">예상 적설 ${esc(fcAmt(fc, "snow"))}cm · 강수 ${esc(fcAmt(fc, "pcp"))}mm${fc.tmin != null ? ` · 최저 ${esc(fmtTmp(fc.tmin))}℃` : ""}</span>`) : ""}${warnOf(b.id).level ? `<span class="tag wb ${WLV[warnOf(b.id).level][0]}" data-wb="${esc(b.id)}">${esc(wlabel(warnOf(b.id).level, "대설"))}</span>` : ""}
          ${why ? `<span class="tag">사유: ${H(t, "reason", esc(why))}</span>` : ""}</div></div>
        ${list.length ? list.map(m => vehicleRow(m.v, m.stops, m.rec, b.id, m)).join("") : `<div class="empty-state" style="border:0">조건에 맞는 장비가 없습니다.</div>`}</article>`);
    });
    if (cards.length) out.push(`<section class="hq-block" data-hqb="${esc(h.id)}"><h3 class="hq-head">${esc(h.name)}본부</h3><div class="hq-cards">` + cards.join("") + `</div></section>`);   // 본부 하나가 한 줄을 모두 쓰고, 그 안에서 지사 카드는 넓은 화면 3열, 그보다 좁으면 2열·1열
  });
  $("destList").innerHTML = out.length ? out.join("") : `<div class="empty-state">${esc(fmtMD(S.date))}에 이동하는 장비가 없습니다.</div>`;
}

/* ============================================================
   [5] 기관별 장비 — 도공번호·지원 여부·날짜별 경로. [확정]을 눌러야 서버에 날짜별로 저장
   ============================================================ */
// [최초 지원]에서 고를 수 있는 피지원 지사 = 고른 기준일자에서 편성 확정된 지사(확정 + 편성 1대 이상, 저장된 것 기준).
// 일괄 확정으로 편성 0대인 지사까지 확정돼도 여기에는 안 나옴. 모든 지사는 [수정본]에서만
const routeChoices = () => S.order.filter(b => isFixed(b.id));
// 요청은 있지만 아직 편성 확정 전인 지사: 목록에 회색(고를 수 없음)으로 보여서 "왜 없지?"를 바로 알게 함
const pendingChoices = () => S.order.filter(b => hasReq(b.id) && !isFixed(b.id));
// [지원 장비만]을 켜면 지원 여부가 '지원'인 장비만(고치는 중인 줄은 확정 전까지 그대로 보임 — 고르는 순간 줄이 사라지지 않게)
const isGo = v => { const r = curRound(); return !!r && stOf(r.id, v.id).status === "O"; };
const fleetRows = () => S.vehicles.filter(v => (!S.fleetOrgs.size || S.fleetOrgs.has(v.org)) && shownIn(v, curRound()) && (!S.fleetGo || isGo(v) || S.sdraft.has(v.id)));
const nextRoundMin = () => S.rounds.length ? addDays(S.rounds[0].start_date, 1) : "2000-01-01";       // 새 기준일자는 마지막 기준일자보다 뒤
const hiddenNow = () => S.vehicles.filter(v => v.hidden_after && !shownIn(v, curRound()));          // 지금 고른 기준일자에서 숨겨진 장비(숨김 취소 목록)
// 지원일 칸(경로)의 지사 선택 전부·지원일 1 날짜·지원일 칸 수·초기화·최초 지원/수정본, 기관별 배치 대수 = 관리자(권한 equip.route)만 (2026-11-02 사용자 요청)
const canRoute = () => can("equip.route");
// 모든 기관 장비 추가·삭제·숨기기 = equip.edit.all(관리자 + 이 권한을 받은 지원장비 아이디). 지원일 칸은 이 권한으로 열리지 않음
const canAllVeh = () => can("equip.edit.all");
// 관리자가 아닌 계정이 지원일 칸에서 고칠 수 있는 장비: 기계화부 = 자기 기관 장비, 지사 = 자기 지사 지역본부 장비 — 둘 다 첫날 한 곳(관리자 배정 안)·도착 시각(2026-11-02)
const routeOwn = v => !!S.me && (isPool(v) ? can("req.edit.own") && v.home_branch === S.me.branch_id : (can("equip.edit.own") || can("equip.edit.all")) && v.org === S.me.org);
const NUM_RE = /^\d{1,5}$/;                                           // 도공번호 = 출발 기관 이름 + 숫자(예: 서울경기901). 입력은 숫자만
const plateNum = v => { const p = vval(v, "plate") || ""; return p.startsWith(v.org) ? p.slice(v.org.length) : ""; };
function renderFleet() {
  const choices = routeChoices(), r = curRound(), all = canAllVeh(), rt = canRoute(), pend = pendingChoices();      // all = 모든 기관 장비(추가·삭제·숨기기), rt = 지원일 칸(관리자)
  banner("perm-fleet");
  $("fleetRound").innerHTML = roundSel("roundSelFleet") + (r ? "" : `<span class="hint">기준일자가 없습니다.</span>`);
  renderOrgGrid();
  // 기관 버튼: 여러 개를 함께 고를 수 있음('모든 기관'은 혼자). 이 기준일자에 장비가 0대인 기관은 누를 수 없음
  const cntOrg = o => S.vehicles.filter(v => v.org === o && shownIn(v, r)).length;
  [...S.fleetOrgs].forEach(o => { if (!cntOrg(o)) S.fleetOrgs.delete(o); });
  const orgChip = o => `<button type="button" class="chip" data-fo="${esc(o)}" aria-pressed="${S.fleetOrgs.has(o)}"${cntOrg(o) ? "" : ' disabled title="이 기준일자에 장비가 없습니다"'}>${esc(o)}</button>`;
  // 장비 추가: 관리자 = 기관 4곳 ─ 경계선 ─ 지원 가능이 확정된 지사 / 기계화부 = 자기 기관 / 지사 = 자기 지사(지원 가능 확정 뒤)
  const orgOpts = all ? S.orgs : can("equip.edit.own") ? S.orgs.filter(o => o === S.me.org) : [];
  const myB = canPoolAdd() ? S.me.branch_id : null, brOpts = !r ? [] : all ? offerBranches() : myB && offerOk(myB) && S.brById[myB] ? [S.brById[myB]] : [];
  const vals = [...orgOpts, ...brOpts.map(b => "B:" + b.id)];
  if (!vals.includes(S.nvSel)) S.nvSel = vals[0] || "";
  const pb = S.nvSel.startsWith("B:") ? S.nvSel.slice(2) : null;      // 지사를 골랐으면 그 지사 번호(지역본부 장비 등록)
  const sep = `<option disabled>──────────</option>`;
  const addRow = vals.length ? `<span class="tb-label">장비 추가</span><select class="ci" id="nvOrg" aria-label="새 장비 기관(또는 지역본부 지사)">${orgOpts.map(o => `<option value="${esc(o)}"${S.nvSel === o ? " selected" : ""}>${esc(o)}</option>`).join("")}` +
      (all ? sep + (brOpts.length ? "" : `<option disabled>지역본부: 지원 가능이 확정된 지사 없음</option>`) : "") +
      brOpts.map(b => `<option value="B:${esc(b.id)}"${S.nvSel === "B:" + b.id ? " selected" : ""}>${esc(b.name)}${all ? "" : " (지역본부 장비)"}</option>`).join("") + `</select>` +
      (pb ? `<label class="rent"><input type="checkbox" id="nvRent"${S.nvRent ? " checked" : ""}> 임차</label>`
          : `<select class="ci" id="nvType" aria-label="새 장비 종류">${TYPES.map(t => `<option>${t}</option>`).join("")}</select>`) +
      `<span class="pnum"><span class="pfx" id="nvPfx">${esc(pb ? bn(pb) + (S.nvRent ? " 임차" : "") : S.nvSel)}</span><input class="ci" id="nvPlate" inputmode="numeric" maxlength="4" placeholder="${pb ? (S.nvRent ? "1" : "252") : "901"}" aria-label="${pb ? "새 장비 번호(숫자만)" : "새 장비 도공번호(숫자만)"}"><span class="sfx">호</span></span><button type="button" class="btn" id="vehAdd">${pb ? "등록" : "추가"}</button>`
    : myB ? `<span class="tb-label">장비 추가</span><span class="hint" id="poolWait">지사별 요청·편성에서 '타지사 지원 가능' 대수를 넣고 관리자가 확정하면 ${esc(bn(myB))} 지사의 장비를 등록할 수 있습니다.</span>` : "";
  $("fleetFilters").innerHTML =
    `<div class="tb-row"><span class="tb-label">기관</span><span class="fgroup">${SOURCE_ORGS().map(orgChip).join("")}</span>` +
    `<span class="tb-sep" aria-hidden="true"></span><button type="button" class="chip" id="onlyGo" aria-pressed="${S.fleetGo}" title="지원 여부가 '지원'인 장비만 보기(다시 누르면 모든 장비)">지원 장비만</button>` +
    `<span class="tb-right">` + (rt ? `<label class="ctl">지원일 칸 <select class="ci" id="colsSel">${Array.from({ length: 9 }, (_, k) => k + 2).map(n => `<option value="${n}" ${n === colsOf("equip") ? "selected" : ""}>${n}개</option>`).join("")}</select></label>` : "") +      // 지원일 칸 수 고르기는 관리자만(다른 계정은 저장된 칸 수, 94)
    (rt ? `<button type="button" class="btn" id="fleetReset">초기화</button>` : "") + `</span></div>` +
    (addRow || rt ? `<div class="tb-row">` + addRow +
      (rt ? `<span class="tb-right mode" role="group" aria-label="지원 구분"><label><input type="checkbox" id="modeInit" ${S.revisedMode ? "" : "checked"}> 최초 지원</label>` +
        `<label><input type="checkbox" id="modeRev" ${S.revisedMode ? "checked" : ""}> 수정본</label></span>` : "") + `</div>` : "");
  const dates = windowDates(), head = dates.map((d, i) => `<th class="dayh">지원일 ${i + 1}<span class="sub">` +
    (i === 0 && rt ? `<input class="ci" type="date" id="day1In" value="${esc(d)}"${r ? ` min="${esc(r.start_date)}" max="${esc(roundEnd(r))}"` : ""} aria-label="지원일 1 날짜(나머지 지원일은 하루씩 자동, 기준일자보다 앞은 안 됨)">` : esc(fmtMD(d))) + `</span></th>`).join("");
  const rows = fleetRows().map(v => fleetRowHtml(v, dates, choices, all)).join("");
  $("eqTable").innerHTML = `<thead><tr>${isPhoneW() ? "<th>도공번호</th><th>장비</th><th>블로워</th>" : "<th>도공번호 · 장비 · 블로워</th>"}<th>지원 여부</th><th>운전원</th>${head}${actCol() ? `<th class="unh">${canAllVeh() ? unhideHead() : ""}</th>` : ""}</tr></thead><tbody>${rows || `<tr><td colspan="${(isPhoneW() ? 6 : 4) + dates.length}" class="empty">${S.fleetGo ? "지원 여부가 '지원'인 장비가 없습니다." : "장비가 없습니다."}${addRow && !S.fleetGo ? " 위의 [장비 추가]로 넣으세요." : ""}</td></tr>`}</tbody>`;
  const eqFixed = isPhoneW() ? [plateEm(), 5.8, 5.4, 5.8, 5.4] : [plateEm(), 5.8, 5.4], eqAct = actCol() ? (isPhoneW() ? (canAllVeh() ? 7 : 4) : 4.2) : 0;
  dayCols($("eqTable"), eqFixed, dates.length, eqAct, 10.8);
  // 위쪽 장비 현황 표는 지원일 칸 수와 상관없이 같은 크기(글자 그대로, 지원일 4칸 표의 폭)로 가운데에(2026-11-03 사용자 요청). 칸 수에 따라 달라지는 건 아래 표뿐
  const sumW = isPhoneW() ? 0 : em(plateEm()) + em(5.8) + em(5.4) + em(10.8) * 4 + em(eqAct);
  $("orgGrid").style.maxWidth = sumW ? sumW + 2 + "px" : ""; fitPanel($("eqTable"), sumW + 2);
  placeUnhide();
}
// 컴퓨터: 도공번호 칸 아래에 장비·블로워를 함께(칸이 둘 줄어 표가 좁아짐, 2026-11-03 C안). 휴대폰: 칸을 따로
const idCells = (id, type, blower) => isPhoneW() ? `<td>${id}</td><td>${type}</td><td>${blower}</td>` : `<td>${id}<div class="vid2"><span>${type}</span>${blower}</div></td>`;
// 도공번호 칸 폭: 보통 장비 = 기관 이름 + 숫자 4자리. 지역본부 장비는 지사 이름 + 임차 + 숫자라 더 길어서, 보이는 장비 중 가장 긴 이름에 맞춤(제설차 칸과 겹치지 않게, 2026-11-03)
function plateEm() {
  const base = isPhoneW() ? 9.2 : 10.8;
  return fleetRows().reduce((w, v) => Math.max(w, !isPool(v) ? base : canVeh(v) ? bn(v.home_branch).length * 1.04 + 9 : vname(v).length + 1.2), base);
}
const myPoolN = () => canPoolAdd() ? poolVehs(S.me.branch_id).length : 0;            // 지사 계정: 이 기준일자에 등록한 자기 지사 장비 수
const actCol = () => canAllVeh() || myPoolN() > 0;       // 맨 끝 칸(숨기기·삭제): 관리자, 그리고 자기 지사 지역본부 장비가 있는 지사 계정
// 블로워(소·대) 체크: 제설기만 켜지고(둘 다 안 켤 수도 있음), 다른 장비·고칠 권한이 없는 줄은 꺼진 칸
const hasBlower = v => !!(vval(v, "blower_s") || vval(v, "blower_l"));
const blowerText = v => [vval(v, "blower_s") ? "소" : "", vval(v, "blower_l") ? "대" : ""].filter(Boolean).join("·");
function blowerCell(v, ed) {
  const on = ed && v.type === "제설기", box = (f, lab) => `<label class="bl${on ? "" : " off"}"><input type="checkbox" data-vb="${esc(v.id)}" data-bf="${f}" data-fk="vb:${esc(v.id)}:${f}"${vval(v, f) ? " checked" : ""}${on ? "" : " disabled"} aria-label="${esc(vname(v))} 블로워 ${lab}"> ${lab}</label>`;
  return `<span class="blw">${box("blower_s", "소")}${box("blower_l", "대")}</span>`;
}
// 지역본부 장비 한 줄: 이름 = 지사 + [임차] + 숫자 + '호', 지원 여부는 늘 '지원', 피지원 지사는 관리자만(지사 계정은 도착 예상 시각), 숨기기 없음
function poolRowHtml(v, dates, choices) {
  const ed = canVeh(v), bid = v.home_branch, id = esc(v.id), nm = esc(vname(v));
  const nameCell = ed ? `<span class="pnum pool"><span class="pfx">${esc(bn(bid))}</span><label class="rent"><input type="checkbox" data-vr="${id}" data-fk="vr:${id}"${vval(v, "rented") ? " checked" : ""} aria-label="${nm} 임차"> 임차</label>` +
      `<input class="ci" inputmode="numeric" maxlength="4" data-vp="${id}" data-fk="vp:${id}" value="${esc(poolNum(v))}" placeholder="${vval(v, "rented") ? "1" : "252"}" aria-label="${nm} 번호 숫자"><span class="sfx">호</span></span>`
    : `<span class="plate">${nm}</span>`;
  return `<tr class="pool${S.vdraft.has(v.id) ? " changed" : ""}" data-vrow="${id}" data-home="${esc(bid)}">${idCells(nameCell, esc(v.type), blowerCell(v, false))}` +
    `<td><span class="status go">지원</span>${offerOk(bid) ? "" : ` <span class="tag warn pool-wait" title="이 지사의 타지사 지원 가능 대수가 확정되지 않았습니다(확정이 취소됨)">확정 전</span>`}</td>` +
    `<td class="crew-cell"><span class="muted">—</span></td>` + dates.map(d => `<td data-cell="${esc(rk(d, v.id))}">${slotCell(v, d, canRoute(), choices)}</td>`).join("") +
    (actCol() ? `<td class="vact">${ed ? `<button type="button" class="btn sm danger" data-vdel="${id}">삭제</button>` : ""}</td>` : "") + `</tr>`;
}
function fleetRowHtml(v, dates, choices, all) {
    if (isPool(v)) return poolRowHtml(v, dates, choices);
    const ed = canVeh(v), r = curRound(), st = r ? stOf(r.id, v.id).status : "", [cls, label] = STATUS[st] || STATUS[""], tv = "vehicles:" + v.id;
    // 지원 여부 = 고른 기준일자의 값(기준일자가 바뀌면 따로). 기준일자가 없으면 고칠 수 없음
    const statusCell = ed && r ? `<select class="ci" data-vs="${esc(v.id)}" data-fk="vs:${esc(v.id)}" aria-label="${esc(vname(v))} 지원 여부"${S.sdraft.has(v.id) ? ' data-changed="1"' : ""}>${statusOpts(v.id, st)}</select>`
      : r ? (label ? `<span class="status ${cls}">${label}</span>` : "") : '<span class="muted">-</span>';
    const old = !plateNum(v) && vval(v, "plate");      // 예전 차량번호 형식이 남은 장비: 숫자를 새로 넣어야 함
    const plateCell = ed ? `<span class="pnum"${hvA(tv, "plate")}><span class="pfx">${esc(v.org)}</span><input class="ci" inputmode="numeric" maxlength="4" data-vp="${esc(v.id)}" data-fk="vp:${esc(v.id)}" value="${esc(plateNum(v))}" placeholder="901" aria-label="도공번호 숫자"><span class="sfx">호</span></span>${old ? `<div class="muted sm">예전 번호 ${esc(old)}</div>` : ""}`
      : H(tv, "plate", `<span class="plate">${esc(vname(v))}</span>`);
    const changed = S.vdraft.has(v.id) || S.sdraft.has(v.id) ? " changed" : "";
    return `<tr class="${changed}" data-vrow="${esc(v.id)}">${idCells(plateCell, esc(v.type), blowerCell(v, ed))}<td>${statusCell}</td><td class="crew-cell">${crewCell(v)}</td>${dates.map(d => `<td data-cell="${esc(rk(d, v.id))}">${slotCell(v, d, canRoute(), choices)}</td>`).join("")}` +
      (canAllVeh() ? `<td class="vact"><button type="button" class="btn sm" data-vhide="${esc(v.id)}">숨기기</button><button type="button" class="btn sm danger" data-vdel="${esc(v.id)}">삭제</button></td>` : actCol() ? `<td class="vact"></td>` : "") + `</tr>`;
}

let crewPick = null;
function crewCell(v) {
  const r=curRound(), crew=r?(stOf(r.id,v.id).crew||[]):[];
  return [0,1].map(i=>canVeh(v)&&r?`<button type="button" class="crew-slot" data-crew="${esc(v.id)}" aria-label="${esc(vname(v))} 운전원 ${i+1} 선택">${esc(crew[i]||`선택 ${i+1}`)}</button>`:`<span class="crew-code">${esc(crew[i]||'—')}</span>`).join('');
}
function openCrew(id) {
  const v=vehById(id);if(!v||isPool(v)||!canVeh(v)||!curRound())return;
  lastFocus=document.activeElement;crewPick={id,tab:'driver',crew:[...(stOf(S.round,id).crew||[])]};renderCrewPicker();
  sheet.querySelector('[role="tab"]').focus();
}
function renderCrewPicker() {
  if(!crewPick)return;
  const p=crewPick, list=p.tab==='driver'?SSCrew.drivers:SSCrew.mechanics;
  sheet.classList.add('crew-sheet');sheet.hidden=false;backdrop.hidden=false;
  sheet.innerHTML=`<button type="button" class="sheet-close" id="sheetClose">취소</button><h2 id="sheetTitle">${esc(vname(vehById(p.id)))} 인원 선택</h2><div class="crew-tabs" role="tablist" aria-label="인원 구분">${[['driver','운전원'],['mechanic','정비원']].map(([id,name])=>`<button type="button" role="tab" data-crewtab="${id}" aria-selected="${p.tab===id}">${name}</button>`).join('')}</div><div class="crew-options" role="tabpanel" aria-label="${p.tab==='driver'?'운전원':'정비원'} 코드">${list.map(c=>`<label><input type="checkbox" data-crewcode="${c}" aria-label="${c}" ${p.crew.includes(c)?'checked':p.crew.length===2?'disabled':''}><span>${c}</span></label>`).join('')}</div><p class="crew-selected">선택: ${p.crew.map(esc).join(', ')||'없음'} <span class="muted">(최대 2명)</span></p><div class="crew-actions"><button type="button" class="btn" data-crewclear>선택 해제</button><button type="button" class="btn primary" data-crewapply>적용</button></div>`;
  $('sheetClose').onclick=closeSheet;
}
async function downloadFleet() {
  const round=curRound();if(!round)return toast('기준일자를 선택해 주세요.',true);
  if(fleetDataDirty())return toast('변경사항을 먼저 확정한 뒤 저장해 주세요.',true);      // 94: 지원일 1·칸 수만 바꾼 것은 엑셀(기준일자 첫날)과 상관없음
  const date=round.start_date, button=$('fleetDownload');button.disabled=true;
  try {
    const [routes,status]=await Promise.all([Api.routes(date,date),Api.statuses([round.id])]);
    if(!routes.ok||!status.ok)return toast(!routes.ok?routes.message:status.message,true);
    const route=new Map(routes.rows.map(x=>[x.vehicle_id,x])), stat=new Map(status.rows.filter(x=>+x.round_id===+round.id).map(x=>[x.vehicle_id,x]));
    const records=S.vehicles.filter(v=>shownIn(v,round)&&(!S.fleetOrgs.size||S.fleetOrgs.has(v.org))).map(v=>({org:v.org,type:v.type,number:plateNum(v),mechanized:S.orgs.includes(v.org)&&!isPool(v),support:(stat.get(v.id)||{}).status==='O',destination:((route.get(v.id)||{}).stops||[]).map(bn).join(' → '),crew:(stat.get(v.id)||{}).crew||[]}));
    if(records.some(x=>x.mechanized&&x.support&&x.destination&&!x.number))return toast('도공번호가 없는 지원 장비가 있습니다. 번호를 확정한 뒤 저장해 주세요.',true);
    const rows=SSCrew.rows(records);if(!rows.length)return toast('첫 지원일에 지원기관이 배정된 기계화부 지원 장비가 없습니다.',true);
    const blob=new Blob([SSReport.zip(SSCrew.xlsxFiles(rows))],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download=`기계화부_지원장비_${date}.xlsx`;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
    toast(`${fmtMD(date)} 지원 장비 ${rows.length}대를 저장했습니다.`);
  } catch(e) { toast('엑셀 파일을 만들지 못했습니다. 다시 시도해 주세요.',true); }
  finally { button.disabled=false; }
}

function placeUnhide() {        // 숨김 취소 목록: 표가 가로로 스크롤되는 상자 안이라 잘리지 않게 화면 기준으로 버튼 아래에 띄움
  const b = $("unhideBtn"), pop = document.querySelector(".unhide-pop"); if (!b || !pop) return;
  const r = b.getBoundingClientRect(); pop.style.top = (r.bottom + 4) + "px"; pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + "px";
}
addEventListener("scroll", () => { if (S.unhideOpen) placeUnhide(); }, true);
// 삭제 열 제목 칸의 [숨김 취소(N)]: 누르면 지금 숨겨진 장비 목록이 열리고 하나씩 취소(관리자만, 숨긴 장비가 없으면 안 보임)
function unhideHead() {
  const l = hiddenNow(); if (!l.length) { S.unhideOpen = false; return ""; }
  return `<button type="button" class="btn sm" id="unhideBtn" aria-expanded="${S.unhideOpen}">숨김 취소(${l.length})</button>` +
    (S.unhideOpen ? `<div class="unhide-pop" role="dialog" aria-label="숨긴 장비">${l.map(v => `<div class="uh-row"><span class="plate">${esc(vname(v))}</span><span class="muted">${esc(v.type)}</span><button type="button" class="btn sm" data-unhide="${esc(v.id)}">숨김 취소</button></div>`).join("")}</div>` : "");
}
// 장비 현황 표(2026-11-03 사용자 요청, 기관 카드 대신): 열 = 전체·기관(서울경기…지역본부) 아래 장비(제설차·제설기, 이동정비차 뺌), 행 = 지원·지원 불가·정비중·미정·계, 그 아래 배정 대수. 배정 칸의 화살표를 누르면 배정지 줄이 나타남
// 지원 가능 대수(status O)는 지사별 요청·편성의 맨 위 줄에도 씀
const fleetCount = (t, st, orgs) => { const r = curRound(); return !r ? 0 : S.vehicles.filter(v => shownIn(v, r) && (!t || v.type === t) && MOVE_TYPES.includes(v.type) && (!orgs || !orgs.size || orgs.has(v.org)) && (st === null || stOf(r.id, v.id).status === st)).length; };
function renderOrgGrid() {
  const rowsDef = [["O", "지원", "go"]], AO = [...S.orgs, POOL];      // 2026-11-04: 지원 줄만(지원 불가·정비중·계 줄 없앰)
  const OC = [[null, MOVE_TYPES], ...S.orgs.map(o => [o, MOVE_TYPES]), [POOL, ["제설차"]]];        // 맨 앞 = 전체(강조), 지역본부는 제설차만
  const cols = OC.flatMap(([o, ts]) => ts.map(t => ({ o, t, k: `${o || "전체"}:${t}`, f: t === "제설차" ? "truck" : "blower" })));
  const last = c => c.o === null ? " tot" : "", edge = c => OC.find(x => x[0] === c.o)[1][0] === c.t ? " ed" : "";
  const num = (c, st) => { const n = fleetCount(c.t, st, c.o ? new Set([c.o]) : null); return `<td class="${(n ? "" : "z") + last(c) + edge(c)}" data-fs="${esc(c.k)}:${st === null ? "sum" : st || "none"}">${n}</td>`; };
  const assign = c => S.order.filter(b => isFixed(b.id)).map(b => [b, (c.o ? [c.o] : AO).reduce((n, o) => n + (aval(o, b.id)[c.f] || 0), 0)]).filter(x => x[1] > 0);
  const lists = cols.map(assign), maxLines = Math.max(0, ...lists.map(l => l.length));
  const open = !!S.fleetAssignOpen && maxLines > 0;                // 처음엔 접힘. 누르면 그대로 기억(이 화면 안에서)
  $("orgGrid").innerHTML = `<div class="fs-wrap"><table class="fs-table" id="fleetSum"><thead><tr><th class="l" rowspan="2">상태</th>${OC.map(([o, ts]) => `<th colspan="${ts.length}" class="ed${o ? "" : " tot"}">${esc(o || "전체")}</th>`).join("")}</tr>` +
    `<tr>${cols.map(c => `<th class="${(edge(c) + last(c)).trim()}">${c.t}</th>`).join("")}</tr></thead><tbody>` +
    rowsDef.map(([st, lab, cls]) => `<tr data-fsrow="${esc(lab)}"><th class="l"><span class="status ${cls}">${lab}</span></th>${cols.map(c => num(c, st)).join("")}</tr>`).join("") +
    `<tr class="fs-asgn" data-fsrow="배정"><th class="l">${maxLines ? `<button type="button" class="fs-tog" data-fsopen aria-expanded="${open}" aria-label="세부내역 ${open ? "접기" : "펴기"}">배치 <span aria-hidden="true">${open ? "▴" : "▾"}</span></button>` : "배치"}</th>${cols.map((c, i) => { const n = lists[i].reduce((a, x) => a + x[1], 0); return `<td class="${(n ? "" : "z") + last(c) + edge(c)}" data-fsa="${esc(c.k)}">${n}</td>`; }).join("")}</tr>` +
    (open ? `<tr class="fs-asg"><th class="l">세부내역</th>${cols.map((c, i) => `<td class="${last(c).trim()}${edge(c)}" data-fsl="${esc(c.k)}">${lists[i].length ? lists[i].map(([b, n]) => `<div data-fsb="${esc(b.id)}">${esc(b.name)} ${n}</div>`).join("") : '<span class="muted">-</span>'}</td>`).join("")}</tr>` : "") + `</tbody></table></div>`;
}
// 바뀐 장비 한 줄 / 칸 하나만 다시 그림. 그 칸에 있던 커서는 되살림
function keepFocus(fn) { const a = document.activeElement, fk = a && a.dataset && a.dataset.fk; fn(); if (fk) { const n = [...document.querySelectorAll("[data-fk]")].find(i => i.dataset.fk === fk); if (n && n !== document.activeElement) n.focus(); } }
function patchVehicle(vid) {
  const v = vehById(vid), tr = document.querySelector(`${isTeam(v) ? "#teamTable" : "#eqTable"} tr[data-vrow="${CSS.escape(vid)}"]`);
  if (v && tr) keepFocus(() => { tr.outerHTML = isTeam(v) ? teamRowHtml(v, windowDates("team")) : fleetRowHtml(v, windowDates("equip"), routeChoices(), can("equip.edit.all")); });
  if (!isTeam(v)) renderOrgGrid();
  afterAnyChange();
}
function patchCell(vid, d) {
  const v = vehById(vid), td = document.querySelector(`td[data-cell="${CSS.escape(rk(d, vid))}"]`);
  if (v && td) keepFocus(() => { td.innerHTML = slotCell(v, d, isTeam(v) ? canTeam() : canRoute(), routeChoices()); });
  afterAnyChange();
}
function afterAnyChange() { hideTip(); renderMatrix(); renderDest(); updateSavebars(); }   // 다른 탭(이동 현황)과 저장 바만 새로
// 도착 예상 시각: 직접 입력. 0730 / 730 / 7:30 → 07:30, 7 → 07:00, 빈칸 → 없음. 잘못된 값은 undefined
function normTime(x) {
  x = String(x || "").trim(); if (!x) return null;
  let h, m; const c = x.match(/^(\d{1,2}):(\d{1,2})$/);
  if (c) { h = +c[1]; m = +c[2]; }
  else if (/^\d{1,4}$/.test(x)) { if (x.length <= 2) { h = +x; m = 0; } else { h = +x.slice(0, -2); m = +x.slice(-2); } }
  else return undefined;
  return h <= 23 && m <= 59 ? p2(h) + ":" + p2(m) : undefined;
}
// 다른 기준일자가 맡은 날짜(또는 어느 기준일자에도 없는 날짜)의 칸: 고칠 수 없고, 마우스를 올리면 어느 기준일자에서 언제 고쳤는지
function lockedCell(v, d, g) {
  const rec = effRec(d, v.id), st = g ? stOf(g.id, v.id) : null;
  const at = [S.rmeta.get(rk(d, v.id)), st && st.updated_at].filter(Boolean).sort().pop();
  const tip = g ? `기준일자 ${fmtMD(g.start_date)}에서 수정${at ? " · " + fmtShort(at) : ""}` : "어느 기준일자 기간에도 들지 않는 날짜";
  const body = rec.stops.length ? rec.stops.map((x, j) => `<div class="sl-x slot-x"><span class="sl-n">${esc(bn(x))}</span> <small>${j === 0 && isCont(v.id, d, x) ? "연속지원" : esc(rec.times[j] || "")}</small></div>`).join("")
    : '<span class="muted">-</span>';
  return `<div class="slot locked" title="${esc(tip)}" data-lock="${esc(g ? g.start_date : "")}">${body}</div>`;
}
function slotCell(v, d, ed, confirmed) {
  const g = govRound(d), cr = curRound();
  if (!g || !cr || g.id !== cr.id) return lockedCell(v, d, g);          // 고른 기준일자가 맡지 않은 날짜 = 고칠 수 없음
  const st = stOf(cr.id, v.id);
  const rec = effRec(d, v.id), stops = rec.stops, k = rk(d, v.id), t = `vehicle_routes:${d},${v.id}`, changed = S.draft.has(k), vid = esc(v.id);
  const cont = j => j === 0 && isCont(v.id, d, stops[0]);            // 전날 마지막 지사 = 오늘 첫 지사 → 시각 대신 "연속지원"(입력해 둔 시각은 그대로 남음)
  const tIn = (val, j, extra, dis) => !extra && cont(j) ? `<span class="cont">연속지원</span>` : `<input class="ci tm" data-rt="${vid}" data-rd="${d}" data-fk="${extra ? "tn" : "t"}:${d}:${vid}:${j}" value="${esc(val || "")}" placeholder="--:--" maxlength="5" inputmode="numeric" ${dis ? "disabled" : ""} aria-label="${esc(vname(v))} ${esc(fmtMD(d))} 지사 ${j + 1} 도착 예상 시각">`;
  const flag = d === cr.start_date ? flagTag(allocFlag(v, stops[0])) : "";       // 지원일 1: 관리자 배정을 넘겼거나 배정 없는 지사
  if (!ed) {                     // 지원장비(기계화부) 계정: 자기 기관 장비의 도착 예상 시각 + 지원일 1의 지사 한 곳(배정받은 지사 중, 마이그레이션 43)
    const timeEd = routeOwn(v);                                       // 예전 수준: 자기 기관(지사는 자기 지사 지역본부) 장비만 — '모든 기관' 권한이 있어도 지원일 칸은 자기 기관만
    // 2026-11-02: 지원일 1만이 아니라 관리자가 정한 기준일자의 모든 지원일(govRound 가 지금 기준일자인 날)에서 하루 한 곳씩
    // 지역본부 장비의 지사는 관리자만(마이그레이션 55) — 지사 계정은 아래 칸에서 정해진 지사 이름을 보고 도착 시각만 넣음
    if (timeEd && !isPool(v) && orgHasAlloc(v.org) && st.status === "O" && (!stops.length || (stops.length === 1 && !rec.revised))) {
      const cur = stops[0] || "", list = allocBranches(v.org, v.type).filter(b => b.id !== v.home_branch), ids = new Set(list.map(b => b.id)), free = v.type === "이동정비차";
      const full = b => !free && b.id !== cur && allocUsed(v.org, v.type, b.id, d) >= allocCap(v.org, v.type, b.id);
      const opts = `<option value="">${list.length ? "지사 선택" : "배정받은 지사 없음"}</option>` +
        list.map(b => `<option value="${b.id}"${cur === b.id ? " selected" : ""}${full(b) ? " disabled" : ""}>${esc(b.name)}${free ? "" : ` (${allocUsed(v.org, v.type, b.id, d)}/${allocCap(v.org, v.type, b.id)})`}</option>`).join("") +
        (cur && !ids.has(cur) ? `<option value="${esc(cur)}" selected>${esc(bn(cur))} (배정 없음)</option>` : "") +
        (cur ? `<option value="__del">지우기</option>` : "");
      return `<div class="slot${changed ? " changed" : ""}"${hvA(t)}><div class="slot-x"><select class="ci" data-ra="${vid}" data-rd="${d}" data-fk="ra:${d}:${vid}" aria-label="${esc(vname(v))} ${esc(fmtMD(d))} 피지원 지사(배정받은 지사 중)">${opts}</select>${cur ? tIn(rec.times[0], 0, false, false) : ""}</div>${flag}</div>`;
    }
    if (!stops.length) return `<span class="muted">-</span>`;
    return `<div class="slot${changed ? " changed" : ""}"${hvA(t)}>${stops.map((x, j) => `<div class="sl-x slot-x"><span class="sl-n">${esc(bn(x))}</span>${timeEd ? tIn(rec.times[j], j, false, false) : cont(j) ? ` <small>연속지원</small>` : rec.times[j] ? ` <small>${esc(rec.times[j])}</small>` : ""}</div>`).join("")}${flag}</div>`;
  }
  // 표 위 [최초 지원] = 이 기준일자에 편성 확정된 지사만 / [수정본] = 모든 지사 (한 번에 적용)
  const home = isPool(v) ? v.home_branch : null, tm = isTeam(v);         // 지역본부 장비는 자기(출발) 지사로 못 보냄 → 목록에서 뺌
  // 신속대응팀: 요청·편성과 상관없이 모든 지사(강원본부 지사가 맨 위)
  const choices = tm ? S.order : (S.revisedMode ? S.order : confirmed).filter(b => b.id !== home), off = st.status !== "O", ids = new Set(choices.map(b => b.id)), pend = tm || S.revisedMode ? [] : pendingChoices().filter(b => b.id !== home);
  const hqOrder = tm ? [...S.hqs.filter(h => h.name === "강원"), ...S.hqs.filter(h => h.name !== "강원")] : S.hqs;
  const opts = (cur, j) => `<option value="">지사 선택</option>` + hqOrder.map(h => { const l = choices.filter(b => b.hq_id === h.id); return l.length ? `<optgroup label="${esc(h.name)}">${l.map(b => `<option value="${b.id}" ${cur === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</optgroup>` : ""; }).join("") +
    (cur && !ids.has(cur) ? `<option value="${esc(cur)}" selected>${esc(bn(cur))} (편성 확정 전)</option>` : "") +
    (pend.length ? `<optgroup label="편성 확정 전(요청만) — 고를 수 없음">${pend.map(b => `<option disabled>${esc(b.name)}</option>`).join("")}</optgroup>` : "") +
    `<option value="__del">지우기</option>`;
  const sel = (cur, j, extra) => `<select class="ci" data-rv="${vid}" data-rd="${d}" data-fk="${extra ? "rn" : "r"}:${d}:${vid}:${j}" ${off ? "disabled" : ""} aria-label="${esc(vname(v))} ${esc(fmtMD(d))} 피지원 지사 ${j + 1}">${opts(cur, extra ? 1 : j)}</select>` +
    tIn(extra ? "" : rec.times[j], j, extra, off);
  const extra = S.extraStop.has(k), list = stops.length ? stops : [""];
  const plus = `<button type="button" class="btn sm" data-stop-add="${esc(k)}" ${off || !stops.length ? "disabled" : ""} aria-label="${esc(vname(v))} ${esc(fmtMD(d))}에 들르는 지사 추가">＋</button>`;
  return `<div class="slot${changed ? " changed" : ""}"${hvA(t)}>${list.map((x, j) => `<div class="slot-x">${sel(x, j, false)}${j === list.length - 1 && !extra ? plus : ""}</div>`).join("")}${extra ? `<div class="slot-x">${sel("", list.length, true)}</div>` : ""}${flag}</div>`;
}
// 칸 안의 줄(지사 + 도착 예상 시각)을 모아 경로 기록으로. 지사를 고치면 구분 = 표 위 [최초 지원]/[수정본], 시각만 고치면 구분은 그대로
function readCell(vid, d, timeOnly) {
  const td = document.querySelector(`td[data-cell="${CSS.escape(rk(d, vid))}"]`), rec = recOf(d, vid), stops = [], times = [];        // 기관별 장비·신속대응팀 표 모두(장비 번호가 서로 다름)
  if (td) td.querySelectorAll(".slot-x").forEach((row, j) => { const s = row.querySelector("select[data-rv]"), tm = row.querySelector("input[data-rt]");
    const stop = s ? s.value : rec.stops[j];
    if (stop && stop !== "__del" && stop !== "__off") { stops.push(stop); times.push(tm ? normTime(tm.value) || null : rec.times[j] || null); } });
  return { stops, times, revised: isTeamId(vid) ? false : timeOnly ? rec.revised : S.revisedMode };     // 신속대응팀은 최초 지원/수정본 구분 없음
}
// 확정 전에 고친 경로의 시각 순서를 한 번 더 봄(지사를 바꿔 숨었던 첫 칸 시각이 다시 보이는 경우 등). 어긋나면 안내하고 확정하지 않음
function orderBlock(keys) {
  for (const k of keys) { const [d, vid] = k.split("|"), x = S.draft.get(k), b = x && x.stops.length ? timeOrderBad(d, vid, x) : null;
    if (b) { toast(`${fmtMD(d)} ${vname(vehById(vid))}: ${timeOrderMsg(x, b)}. 시각을 고친 뒤 다시 확정하세요.`, true); return true; } }
  return false;
}
async function confirmFleet() {
  if (S.preview) return toast("미리보기에서는 확정할 수 없습니다. '내 아이디'로 돌아오세요.", true);
  const vehicles = [...S.vdraft].map(([id, f]) => ({ id, ...f })), routes = draftKeys(false).map(k => { const [date, vehicle_id] = k.split("|"), x = S.draft.get(k);
    return { date, vehicle_id, stops: x.stops, revised: x.revised, times: x.times.some(Boolean) ? x.times : null }; });
  const status = sdraftKeys(false).map(vehicle_id => { const x = S.sdraft.get(vehicle_id); return { vehicle_id, status: x.status, off_from: x.off_from || null, crew: (x.crew || []).slice() }; });       // 신속대응팀 변경은 그 탭의 [확정]으로
  const cols = colsDraftOf("equip"), day1 = day1DraftOf("equip");      // 94: 지원일 칸 수·지원일 1(바꿨을 때만, 관리자)
  if (orderBlock(draftKeys(false))) return;
  if (!vehicles.length && !routes.length && !status.length && cols == null && day1 == null) return;
  if ((routes.length || status.length || cols != null || day1 != null) && !S.round) return toast("기준일자가 없어 지원 여부·경로를 확정할 수 없습니다. 지사별 요청·편성에서 기준일자를 먼저 만드세요.", true);
  const what = [routes.length ? `경로 ${routes.length}칸` : "", status.length ? `지원 여부·운전원 ${status.length}대` : "", vehicles.length ? `장비 ${vehicles.length}대(번호·블로워)` : "", day1 != null ? `지원일 1 ${fmtMD(day1)}` : "", cols != null ? `지원일 칸 ${cols}개` : ""].filter(Boolean).join(", ");
  if (!confirm(`${what} 변경을 확정할까요?\n지원 여부는 기준일자 ${fmtMD(curRound().start_date)} 것으로 저장되고, 경로는 날짜별로 남습니다.`)) return;
  busy("fleet", true);
  const r = await Api.saveFleet(vehicles, routes, S.round, status, cols, day1);
  busy("fleet", false);
  if (!r.ok) return toast(r.message, true);
  const now = new Date().toISOString();
  vehicles.forEach(p => Object.assign(vehById(p.id), p)); sortVehicles();
  if (cols != null && curRound()) curRound().cols_equip = cols;      // 94: 저장된 칸 수·지원일 1
  if (day1 != null && curRound()) curRound().day1_equip = day1;
  status.forEach(x => S.rstat.set(S.round + "|" + x.vehicle_id, { status: x.status, off_from: x.off_from, crew: (x.crew || []).slice(), updated_at: now }));
  routes.forEach(x => { const k = rk(x.date, x.vehicle_id); if (x.stops.length) { S.routes.set(k, normRec(x)); S.rmeta.set(k, now); } else S.routes.delete(k); });
  clearDrafts(false);
  await loadAudit(); refresh();
  toast(`확정했습니다 (${what})`);
}
function resetFleet() {          // 보이는 장비의 지원 여부(고른 기준일자)와, 고른 기준일자가 맡은 날짜의 경로를 비움(확정 전 되돌리기 가능)
  const vs = fleetRows().filter(canVeh), cr = curRound(), ds = windowDates("equip").filter(d => cr && (govRound(d) || {}).id === cr.id);
  if (!vs.length || !canRoute() || !cr) return;
  if (!confirm(`보이는 장비 ${vs.length}대의 지원 여부와 ${ds.length ? `지원일 ${fmtMD(ds[0])} ~ ${fmtMD(ds[ds.length - 1])} 경로를` : "경로를"} 모두 비울까요?\n[확정]을 눌러야 서버에 반영되고, 그 전에는 [되돌리기]로 돌아갈 수 있습니다.`)) return;
  vs.forEach(v => { ds.forEach(d => setRoute(d, v.id, EMPTY)); if (!isPool(v)) setStat(v.id, { status: "" }); });      // 지역본부 장비의 지원 여부는 늘 '지원'(경로만 비움)
  S.extraStop.clear(); refresh(); toast("입력을 비웠습니다. [확정]을 눌러야 저장됩니다.");
}
/* ============================================================
   [5-2] 강원본부 지원장비 — 강원 신속대응팀 4대. 기관별 장비 아래 표와 같은 방식(지원 여부·날짜별 경로), 관리자·강원본부만 고침
   ============================================================ */
function renderTeam() {
  const r = curRound(), ed = canTeam(), dates = windowDates("team");
  $("teamRound").innerHTML = roundSel("roundSelTeam") + (r ? "" : `<span class="hint">기준일자가 없습니다.</span>`);
  $("teamFilters").innerHTML = ed ? `<div class="tb-row"><span class="tb-right"><label class="ctl">지원일 칸 <select class="ci" id="colsSelTeam">${Array.from({ length: 9 }, (_, k) => k + 2).map(n => `<option value="${n}" ${n === colsOf("team") ? "selected" : ""}>${n}개</option>`).join("")}</select></label></span></div>` : "";
  const head = dates.map((d, i) => `<th class="dayh">지원일 ${i + 1}<span class="sub">` +
    (i === 0 && ed ? `<input class="ci" type="date" id="day1InTeam" value="${esc(d)}"${r ? ` min="${esc(r.start_date)}" max="${esc(roundEnd(r))}"` : ""} aria-label="지원일 1 날짜(나머지 지원일은 하루씩 자동, 기준일자보다 앞은 안 됨)">` : esc(fmtMD(d))) + `</span></th>`).join("");
  $("teamTable").innerHTML = `<thead><tr><th>장비</th><th>지원 여부</th>${head}</tr></thead><tbody>${S.team.map(v => teamRowHtml(v, dates)).join("") || `<tr><td colspan="${2 + dates.length}" class="empty">장비가 없습니다.</td></tr>`}</tbody>`;
  dayCols($("teamTable"), [11.5, 5.8], dates.length, 0); fitPanel($("teamTable"));
}
function teamRowHtml(v, dates) {
  const ed = canTeam(), r = curRound(), st = r ? stOf(r.id, v.id).status : "", [cls, label] = STATUS[st] || STATUS[""], id = esc(v.id);
  const statusCell = ed && r ? `<select class="ci" data-vs="${id}" data-fk="vs:${id}" aria-label="${esc(vname(v))} 지원 여부">${statusOpts(v.id, st)}</select>`
    : r ? (label ? `<span class="status ${cls}">${label}</span>` : "") : '<span class="muted">-</span>';
  return `<tr class="${S.sdraft.has(v.id) ? "changed" : ""}" data-vrow="${id}"><td><span class="plate">${esc(v.name)}</span> <span class="muted sm">제설차</span></td><td>${statusCell}</td>` +
    dates.map(d => `<td data-cell="${esc(rk(d, v.id))}">${slotCell(v, d, ed, null)}</td>`).join("") + `</tr>`;
}
async function confirmTeam() {
  if (S.preview) return toast("미리보기에서는 확정할 수 없습니다. '내 아이디'로 돌아오세요.", true);
  const routes = draftKeys(true).map(k => { const [date, team_id] = k.split("|"), x = S.draft.get(k); return { date, team_id, stops: x.stops, revised: false, times: x.times.some(Boolean) ? x.times : null }; });
  const status = sdraftKeys(true).map(team_id => { const x = S.sdraft.get(team_id); return { team_id, status: x.status, off_from: x.off_from || null }; });
  const cols = colsDraftOf("team"), day1 = day1DraftOf("team");      // 94: 지원일 칸 수·지원일 1(바꿨을 때만, 관리자·강원본부)
  if (!routes.length && !status.length && cols == null && day1 == null) return;
  if (orderBlock(draftKeys(true))) return;
  if (!S.round) return toast("기준일자가 없어 확정할 수 없습니다. 지사별 요청·편성에서 기준일자를 먼저 만드세요.", true);
  const what = [routes.length ? `경로 ${routes.length}칸` : "", status.length ? `지원 여부 ${status.length}대` : "", day1 != null ? `지원일 1 ${fmtMD(day1)}` : "", cols != null ? `지원일 칸 ${cols}개` : ""].filter(Boolean).join(", ");
  if (!confirm(`강원 신속대응팀 ${what} 변경을 확정할까요?
지원 여부는 기준일자 ${fmtMD(curRound().start_date)} 것으로 저장되고, 경로는 날짜별로 남습니다.`)) return;
  busy("gwteam", true);
  const r = await Api.saveTeam(S.round, routes, status, cols, day1);
  busy("gwteam", false);
  if (!r.ok) return toast(r.message, true);
  const now = new Date().toISOString();
  if (cols != null && curRound()) curRound().cols_team = cols;      // 94: 저장된 칸 수·지원일 1
  if (day1 != null && curRound()) curRound().day1_team = day1;
  status.forEach(x => S.rstat.set(S.round + "|" + x.team_id, { status: x.status, off_from: x.off_from, updated_at: now }));
  routes.forEach(x => { const k = rk(x.date, x.team_id); if (x.stops.length) { S.routes.set(k, normRec(x)); S.rmeta.set(k, now); } else S.routes.delete(k); });
  clearDrafts(true);
  await loadAudit(); refresh();
  toast(`확정했습니다 (강원 신속대응팀 ${what})`);
}
async function addVehicle() {
  const num = $("nvPlate").value.replace(/\s/g, ""), org = $("nvOrg").value;
  if (org.startsWith("B:")) return addPoolVehicle(org.slice(2), num);
  const plate = org + num;
  if (!NUM_RE.test(num)) return toast("도공번호는 숫자만 넣으세요 (예: 901 → " + org + "901호)", true);
  if (S.vehicles.some(v => !isPool(v) && vval(v, "plate") === plate)) return toast("같은 도공번호가 이미 있습니다", true);
  if (!can("equip.edit.all") && org !== S.me.org) return toast("자기 기관 장비만 추가할 수 있습니다", true);
  if (S.preview) return toast("미리보기에서는 장비를 추가할 수 없습니다.", true);
  // 장비 번호(id)는 보내지 않음 — 서버가 매김(화면이 가진 목록이 낡았을 때 다른 계정이 그사이 넣은 장비와 번호가 겹치던 문제, 2026-10-13)
  const r = await Api.addVehicle({ org, type: $("nvType").value, plate, sort: Math.max(0, ...S.vehicles.map(x => x.sort || 0)) + 10 });
  if (!r.ok) return toast(r.message, true);
  S.vehicles.push(r.vehicle); sortVehicles(); await loadAudit(); refresh(); toast(`장비를 추가했습니다 (${vname(r.vehicle)})`);
}
// 지역본부 장비 등록: 그 지사 계정과 관리자. 그 기준일자에 지원 가능 대수가 확정된 지사만(서버도 같은 검사). 장비 번호(id)는 서버가 매김
async function addPoolVehicle(bid, num) {
  const b = S.brById[bid], r = curRound(), rented = !!($("nvRent") || {}).checked;
  if (!b || !r) return;
  if (!NUM_RE.test(num)) return toast(`번호는 숫자만 넣으세요 (예: ${rented ? `1 → ${b.name} 임차 1호` : `252 → ${b.name} 252호`})`, true);
  if (!(can("equip.edit.all") || (canPoolAdd() && S.me.branch_id === bid))) return toast("자기 지사의 장비만 등록할 수 있습니다", true);
  if (!offerOk(bid)) return toast(`${b.name} 지사의 '타지사 지원 가능' 대수가 확정된 뒤에 등록할 수 있습니다`, true);
  const plate = poolPlateFree(bid, rented, num); if (!plate) return;
  if (S.preview) return toast("미리보기에서는 장비를 등록할 수 없습니다.", true);
  const res = await Api.addVehicle({ org: POOL, type: "제설차", plate, round_id: r.id, home_branch: bid, rented });
  if (!res.ok) return toast(res.message, true);
  S.vehicles.push(res.vehicle); sortVehicles();
  S.rstat.set(r.id + "|" + res.vehicle.id, { status: "O", off_from: null, updated_at: new Date().toISOString() });   // 서버가 지원 여부 '지원'을 함께 만듦
  await loadAudit(); refresh(); toast(`장비를 등록했습니다 (${vname(res.vehicle)})`);
}
async function deleteVehicle(id) {
  const v = vehById(id); if (!v || !(canAllVeh() || (isPool(v) && canVeh(v)))) return;       // 장비 삭제는 관리자(equip.edit.all), 지역본부 장비는 그 지사 계정도. 경로 기록이 있는 장비는 서버가 거절
  if (S.preview) return toast("미리보기에서는 장비를 지울 수 없습니다.", true);
  if (!confirm(`${vname(v)} (${v.org} ${v.type})를 지울까요?`)) return;
  const r = await Api.deleteVehicle(id);
  if (!r.ok) return toast(isPool(v) && r.code === "23503" ? "경로가 있는 장비는 지울 수 없습니다. 관리자가 이 장비의 경로를 먼저 지워야 합니다." : r.message, true);
  S.vehicles = S.vehicles.filter(x => x.id !== id); S.vdraft.delete(id); S.sdraft.delete(id);
  [...S.draft.keys()].filter(k => k.endsWith("|" + id)).forEach(k => S.draft.delete(k)); [...S.routes.keys()].filter(k => k.endsWith("|" + id)).forEach(k => S.routes.delete(k));
  [...S.rstat.keys()].filter(k => k.endsWith("|" + id)).forEach(k => S.rstat.delete(k));
  await loadAudit(); refresh(); toast("장비를 지웠습니다");
}
// 숨기기: 고른 기준일자부터 기관별 장비 목록에서 안 보임(hidden_after = 그 전날). 이전 기준일자·이동 현황 기록은 그대로. 관리자만
async function hideVehicle(id, show) {
  const v = vehById(id); if (!v || !canAllVeh()) return;
  if (S.preview) return toast("미리보기에서는 바꿀 수 없습니다.", true);
  const after = show ? null : addDays((curRound() || {}).start_date || todayISO(), -1);
  if (!show && !confirm(`${vname(v)} 장비를 숨길까요?`)) return;
  const r = await Api.hideVehicle(id, after);
  if (!r.ok) return toast(r.message, true);
  v.hidden_after = after;
  if (!show) { S.vdraft.delete(id); S.sdraft.delete(id); [...S.draft.keys()].filter(k => k.endsWith("|" + id)).forEach(k => S.draft.delete(k)); }
  if (!hiddenNow().length) S.unhideOpen = false;
  await loadAudit(); refresh(); toast(show ? `${vname(v)} 숨김을 취소했습니다` : `${vname(v)} 장비를 숨겼습니다`);
}

/* ============================================================
   [6] 지사별 요청·편성 — 기준일자마다 지사별 요청, 편성 대수, 확정
   ============================================================ */
const HOURS = Array.from({ length: 24 }, (_, i) => p2(i)), MINS = ["00", "10", "20", "30", "40", "50"];
function arriveCell(b, ed, t) {          // ed = 입력칸을 보일지(고칠 권한). 확정한 줄이면 비활성
  const v = rval(b.id, "arrive_at"), lk = isConf(b.id);
  if (!ed) return v ? H(t, "arrive_at", esc(fmtTime(v))) : '<span class="muted">-</span>';
  const [d, tm] = v ? v.split("T") : ["", ""], [hh, mm] = tm ? tm.split(":") : ["", ""];
  const mins = MINS.includes(mm) || !mm ? MINS : [...MINS, mm].sort();
  // 시는 00~23, 분은 10분 단위 — 고르는 목록이라 위아래 끝에서 멈춤(무한히 돌지 않음)
  return `<span class="arr"${hvA(t, "arrive_at")}><input class="ci" type="date" data-arr="${b.id}" data-part="d" data-fk="ad:${b.id}" value="${esc(d)}" aria-label="${esc(b.name)} 도착 요청 날짜"${lk ? " disabled" : ""}>` +
    `<select class="ci" data-arr="${b.id}" data-part="h" data-fk="ah:${b.id}" ${d && !lk ? "" : "disabled"} aria-label="${esc(b.name)} 도착 시">${HOURS.map(x => `<option ${x === (hh || "00") ? "selected" : ""}>${x}</option>`).join("")}</select>시 ` +
    `<select class="ci" data-arr="${b.id}" data-part="m" data-fk="am:${b.id}" ${d && !lk ? "" : "disabled"} aria-label="${esc(b.name)} 도착 분">${mins.map(x => `<option ${x === (mm || "00") ? "selected" : ""}>${x}</option>`).join("")}</select>분</span>`;
}
// 표 맨 위 전체 줄(2026-11-03 사용자 요청): 지사 요청·타지사 지원 가능·편성의 전국 합계. 편성은 '편성 / 기관별 장비의 지원 가능 대수'
function totalSums() { const rows = S.order.filter(b => !(S.hqById[b.hq_id] || {}).is_private), sum = f => rows.reduce((a, b) => a + (+rval(b.id, f) || 0), 0); return { req_truck: sum("req_truck"), req_blower: sum("req_blower"), offer_truck: sum("offer_truck"), assigned_truck: sum("assigned_truck"), assigned_blower: sum("assigned_blower") }; }
function totalCell(k, t) { const v = totalSums()[k]; if (!t) return String(v); const av = fleetCount(t, "O"); return `<span class="${v > av ? "al-over" : ""}" title="편성 ${v}대 / 기관별 장비의 지원 가능 ${av}대">${v}<small>/${av}</small></span>`; }
const TOTAL_TYPE = { assigned_truck: "제설차", assigned_blower: "제설기" };
function totalRow() {
  const c = (k, cls = "") => `<th class="${cls}" data-t="${k}">${totalCell(k, TOTAL_TYPE[k])}</th>`;
  return `<tr class="tot" data-tot><th class="l">전체</th><th colspan="8"></th>${c("req_truck")}${c("req_blower")}<th></th>${c("offer_truck")}<th></th><th class="blk-gap" aria-hidden="true"></th>${c("assigned_truck", "adm adm0")}${c("assigned_blower", "adm")}<th class="adm"></th></tr>`;
}
function patchTotals() { document.querySelectorAll("#branchTable [data-tot] [data-t]").forEach(x => { x.innerHTML = totalCell(x.dataset.t, TOTAL_TYPE[x.dataset.t]); }); }
const HQ_SUM_KEYS = ["req_truck", "req_blower", "offer_truck", "assigned_truck", "assigned_blower", "confirmed"];
function hqSums(hid) {
  const rows = S.order.filter(b => b.hq_id === hid), sum = f => rows.reduce((a, b) => a + (+rval(b.id, f) || 0), 0);
  return { req_truck: sum("req_truck"), req_blower: sum("req_blower"), offer_truck: sum("offer_truck"), assigned_truck: sum("assigned_truck"), assigned_blower: sum("assigned_blower"), confirmed: rows.filter(b => rval(b.id, "confirmed")).length || "" };
}
// 내용이 바뀔 때만 다시 그림 — 값을 넣고 바로 [저장]을 누르면 입력칸의 change 가 누르는 도중에 와서, 버튼을 새로 그리면 그 클릭이 사라짐(2026-11-01)
const cellH = (attrs, html) => `<td ${attrs} data-h="${esc(html)}">${html}</td>`;     // setCell 이 비교할 처음 내용을 함께 적어 둠
function setCell(el, html) { if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; } }
function afterReq(id) {          // 지사 요청 칸을 고친 뒤: 그 줄 표시·최종 대수·본부 합계·도착 시각 칸 잠금만 고침(입력 중인 칸은 그대로)
  const b = S.brById[id], tr = document.querySelector(`#branchTable tr[data-b="${id}"]`);
  if (tr) {
    tr.classList.toggle("changed", S.rdraft.has(id)); tr.classList.add("active");
    const sv = tr.querySelector("[data-svcell]"); if (sv && b) setCell(sv, saveCell(b));          // 고치면 다시 [저장]
    const hasDate = !!rval(id, "arrive_at"); tr.querySelectorAll('[data-arr][data-part="h"], [data-arr][data-part="m"]').forEach(x => { x.disabled = !hasDate || isConf(id); });
  }
  const hr = b && document.querySelector(`#branchTable tr.hq[data-hq="${b.hq_id}"]`);
  if (hr) { const sm = hqSums(b.hq_id); HQ_SUM_KEYS.forEach(k => { const c = hr.querySelector(`[data-s="${k}"]`); if (c) c.textContent = sm[k]; });
    const sh = hr.querySelector("[data-svhq]"); if (sh) setCell(sh, bulkSaveCell(b.hq_id)); }
  patchTotals(); afterAnyChange();
}
// 제목 줄이 두 줄인 표: 스크롤해도 두 줄이 겹치지 않게, 둘째 줄은 첫 줄 높이만큼 아래에 붙임(높이는 화면 폭에 따라 달라서 매번 잼)
// 표 칸 폭 고정(2026-11-03 사용자 요청 — 글자 수에 따라 들쭉날쭉하지 않게). cols = 칸마다 폭(px)
// fit = true: 표 폭 = 칸 폭 합계. fit 이 아니면 화면이 합계보다 넓을 때 같은 비율로 넓어지고, 좁으면 옆으로 밀어서 봄
function fixCols(table, cols, fit) {
  const sum = cols.reduce((n, w) => n + w, 0);
  table.classList.add("fixcols");
  table.style.minWidth = sum + "px"; table.style.width = fit ? sum + "px" : "";
  table.insertAdjacentHTML("afterbegin", `<colgroup>${cols.map(w => `<col style="width:${w}px">`).join("")}</colgroup>`);
}
// 기관별 장비·강원본부 지원장비·기관별 배치의 칸 크기(2026-11-03 사용자 요청: 컴퓨터에서 보기 좋게, 글자가 잘리지 않게). 칸 폭은 글자 크기(em)로 정해 글자와 함께 커짐
// 글자 크기: 컴퓨터 13~16px = 지원일 6칸(약 92em)이 화면과 표의 스크롤 막대를 빼고 들어오는 크기, 휴대폰 12.5px. CSS 는 --eq-fp 를 씀
const SBW = (() => { const d = document.createElement("div"); d.style.cssText = "position:absolute;top:-99px;width:50px;height:50px;overflow:scroll"; document.documentElement.append(d); const w = d.offsetWidth - d.clientWidth; d.remove(); return w; })();   // 이 브라우저의 스크롤 막대 폭(숨겨져 있으면 0)
const tableRoom = () => Math.min(innerWidth, 1680) - 48 - SBW * 2;      // 표가 쓸 수 있는 폭: main 여백 40 + 테두리 등 8 + 화면·표의 세로 스크롤 막대
const isPhoneW = () => innerWidth <= 860;
const FP = () => isPhoneW() ? 12.5 : Math.max(13, Math.min(16, Math.floor(tableRoom() / 92 * 10) / 10));
const syncFP = () => document.documentElement.style.setProperty("--eq-fp", FP() + "px");
syncFP();
const em = n => Math.round(n * FP());
// 지원일 칸(2026-11-03 사용자 요청: 칸이 많아도 컴퓨터에서는 가로 스크롤 없이 다 보이게): 보통은 지사·시각을 한 줄로(11.7em).
// 다 안 들어오면 글자를 13px 까지 줄이고, 그래도 안 들어오면 지사·시각을 위아래 두 줄로(칸 폭 6.9~11.7em, 표 폭을 화면에 맞춤). 휴대폰은 176px 에 옆으로 밀어서 봄
function dayFit(fixedEm, n, dayEm = 11.7) {
  if (isPhoneW()) return { fp: 12.5, day: 176 / 12.5, stack: false };
  const room = tableRoom(), tenth = x => Math.floor(x * 10) / 10, one = room / (fixedEm + dayEm * n);
  if (one >= 13) return { fp: Math.min(FP(), tenth(one)), day: dayEm, stack: false };
  const fp = Math.max(12, Math.min(FP(), tenth(room / (fixedEm + 6.9 * n))));
  return { fp, day: Math.max(6.9, Math.min(11.7, tenth((room / fp - fixedEm) / n))), stack: true };
}
function dayCols(table, fixedEm, n, actEm, dayEm = 11.7) {
  const f = dayFit(fixedEm.reduce((a, w) => a + w, 0) + actEm, n, dayEm), px = w => Math.round(w * f.fp);
  table.style.fontSize = isPhoneW() ? "" : f.fp + "px"; table.classList.toggle("stack", f.stack);
  fixCols(table, [...fixedEm.map(px), ...Array(n).fill(px(f.day)), ...(actEm ? [px(actEm)] : [])], true);
}
// 컴퓨터: 기준일자·현황 표·버튼 줄·저장 줄을 표와 같은 폭으로 맞춰 가운데에 둠(2026-11-03 C안). 표가 아주 좁아도 위쪽 줄이 들어가도록 860px 아래로는 안 줄임
function fitPanel(table, min = 0) { table.closest(".panel").style.maxWidth = isPhoneW() ? "" : Math.max(parseFloat(table.style.width) + 2 + SBW, min, 860) + "px"; }      // 표 안에 세로 스크롤 막대가 생겨도 가로 스크롤이 안 생기게 그 폭까지
let lastPageKey = innerWidth;
addEventListener("resize", () => { if (innerWidth !== lastPageKey && S.me) { lastPageKey = innerWidth; clearTimeout(S.resizeT); S.resizeT = setTimeout(() => { syncFP(); renderMatrix(); renderFleet(); renderTeam(); renderAlloc(); }, 150); } });   // 창 폭이 바뀌면 칸 폭을 다시 계산
function stickHead(table) {
  if (!table || !table.tHead || !table.offsetParent) return;
  let top = 0;
  [...table.tHead.rows].forEach(tr => { [...tr.cells].forEach(th => { if (th.rowSpan <= 1 || tr.rowIndex === 0) th.style.top = (th.rowSpan > 1 ? 0 : top) + "px"; }); top += tr.getBoundingClientRect().height; });
}
// 지사별 요청·편성: 표 창을 화면 아래 끝까지(2026-11-02 사용자 요청 "내릴 수 있는 길이가 적음") — 위쪽 버튼 줄 높이가 화면 폭에 따라 달라서 매번 잼
function fitBranch() {
  const w = $("branchTable").parentElement; if (!w || !w.offsetParent) return;
  w.style.maxHeight = Math.max(240, Math.floor(innerHeight - w.getBoundingClientRect().top - scrollY - 8)) + "px";
}
addEventListener("resize", () => { stickHead($("branchTable")); stickHead($("matrix")); stickHead($("allocTable")); fitBranch(); });
// 글꼴이 늦게 오면 머리글 높이가 달라져 둘째 줄이 첫 줄 숫자를 가림(휴대폰 이동 현황) → 글꼴이 온 뒤 다시 잼
if (document.fonts) document.fonts.ready.then(() => { stickHead($("branchTable")); stickHead($("matrix")); stickHead($("allocTable")); });
const reqsBadHtml = () => `<tbody><tr><td class="empty">요청·편성 자료를 불러오지 못했습니다. <button type="button" class="btn sm" data-reload>다시 읽기</button></td></tr></tbody>`;
function renderBranch() {
  const m = S.me, r = curRound();
  banner("perm-branch", canAnyReq(),
    can("req.confirm") ? "모든 지사의 요청·편성·확정을 고칠 수 있습니다. 확정한 지사만 기관별 장비에서 피지원 지사로 고를 수 있습니다. 고친 뒤 아래 [저장]을 눌러 주세요."
      : can("req.edit.hq") ? `${(S.hqById[m.hq_id] || {}).name || ""}본부 지사들의 요청을 고칠 수 있습니다(편성·확정은 관리자). 고친 뒤 [저장]을 눌러 주세요.`
      : `${bn(m.branch_id)} 지사 행의 요청만 고칠 수 있습니다(편성·확정은 관리자). 고친 뒤 [저장]을 눌러 주세요.`,
    "보기만 가능합니다.");
  $("branchRound").innerHTML = roundSel("roundSelBranch") +
    (can("req.confirm") && r ? `<button type="button" class="btn danger" id="roundDel">기준일자 삭제</button>` : "") +
    (can("req.confirm") ? `<span class="sep"></span><label class="ctl">새 기준일자 <input class="ci" type="date" id="newRoundDate" value="${esc(nextRoundMin() > todayISO() ? nextRoundMin() : todayISO())}" min="${esc(nextRoundMin())}"></label><button type="button" class="btn" id="roundMake">만들기</button>` : "");
  const myBlk = can("req.confirm") ? "right" : canAnyReq() ? "left" : "";
  $("branchCtl").innerHTML = r ? `<div class="tb-row"><span class="tb-label">보기</span>` + BVIEWS.map(([k, id, lab, tip]) => `<button type="button" class="chip" id="${id}" data-bv="${k}" aria-pressed="${S.bviews.has(k)}" title="${tip}">${lab}</button>`).join("") +
    `<span class="tb-right">${myBlk ? `<span class="my-blk"><i aria-hidden="true"></i>파란 표 = 내가 입력하는 표</span>` : ""}<span class="br-dirty" id="brDirty" role="status" hidden></span></span>` +
    `<button type="button" class="btn sm" id="zoneMgr">특보구역 관리</button>` + `</div>` : "";      // 2026-11-10 사용자: 모든 아이디가 봄(관리자 아닌 아이디는 요청)
  if (!r) { $("branchTable").innerHTML = `<tbody><tr><td class="empty">기준일자가 없습니다.</td></tr></tbody>`; return; }
  if (S.reqsBad) { $("branchTable").classList.remove("fixcols"); $("branchTable").style.minWidth = ""; $("branchTable").innerHTML = reqsBadHtml(); return; }
  const conf = can("req.confirm");
  // 칸 순서: 지사 | 기상(24시 예보[적설·강수·확률·기온]·대설특보·직접입력) | 지사 요청 | 도착 요청 | 타지사 지원 가능 | 저장 ║ 편성 | 확정
  // ║ = 빈 칸(blk-gap)으로 표 둘처럼 나눔: 왼쪽 = 지사·본부가 넣는 표, 오른쪽(adm) = 관리자가 넣는 표. 내 계정의 표는 파란색(mine-left / mine-right)
  let h = `<thead><tr><th class="l" rowspan="2">지사</th><th colspan="4" class="fch">24시 예보</th><th colspan="3" class="wh">대설특보 발표 <small class="fcbase" id="wBaseHead" data-bt="warn" tabindex="0">${esc(warnBase())}</small></th><th class="wxh" rowspan="2">기상현황<br>직접입력</th><th colspan="2">지사 요청</th><th class="l" rowspan="2">도착 요청</th><th class="ofh" rowspan="2">타지사<br>지원 가능<small class="thsub">제설차</small></th><th class="svh" rowspan="2">저장</th><th class="blk-gap" rowspan="2" aria-hidden="true"></th><th colspan="2" class="adm adm0">편성</th><th class="adm">확정</th></tr>
    <tr><th class="fch c-sn">적설<small class="thsub">cm</small></th><th class="fch c-sn">강수<small class="thsub">mm</small></th><th class="fch">확률<small class="thsub">%</small></th><th class="fch tmh c-sn" title="24시간 중 가장 낮은 기온">기온<small class="thsub">최저 ℃</small></th><th class="wh c-wk">종류</th><th class="wh c-wt">발표</th><th class="wh c-wt c-we">발효</th><th>제설차</th><th>제설기</th><th class="adm adm0">제설차</th><th class="adm">제설기</th><th class="cf adm">${conf ? bulkCell(null) : ""}</th></tr>${totalRow()}</thead><tbody>`;
  const has = b => hasReq(b.id) || S.rdraft.has(b.id);                  // 요청 있음(입력 중 포함)
  const mine = b => (m.branch_id === b.id) || (can("req.edit.hq") && !can("req.confirm") && b.hq_id === m.hq_id);
  const test = { req: has, fixed: b => isFixed(b.id), offer: b => hasOffer(b.id), unsaved: b => !isSaved(b.id) };
  const view = b => [...S.bviews].every(k => test[k](b));             // 보기는 한 번에 하나만 켜짐(아래 [data-bv])
  S.hqs.forEach(hq => {
    if (hq.is_private) return;                                   // 민자는 지사별 요청·편성에 나오지 않음
    const rows = S.order.filter(b => b.hq_id === hq.id), shown = rows.filter(b => !S.bviews.size || mine(b) || view(b));
    if (!shown.length) return;
    const closed = S.closedHq.has(hq.id), hsum = hqSums(hq.id), sc = (k, cls = "") => `<td${cls ? ` class="${cls}"` : ""} data-s="${k}">${hsum[k]}</td>`;
    h += `<tr class="hq ${closed ? "closed" : ""}" data-hq="${hq.id}" tabindex="0"><td class="l">${esc(hq.name)}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
      ${sc("req_truck")}${sc("req_blower")}<td></td>${sc("offer_truck")}${cellH(`class="svc" data-svhq="${hq.id}"`, bulkSaveCell(hq.id))}<td class="blk-gap" aria-hidden="true"></td>${sc("assigned_truck", "adm adm0")}${sc("assigned_blower", "adm")}${conf ? `<td class="cf adm">${bulkCell(hq.id)}</td>` : sc("confirmed", "adm")}</tr>`;
    if (closed) return;
    shown.forEach(b => {
      const ed = canReq(b), t = `round_requests:${S.round},${b.id}`, on = has(b), d0 = dis(b.id);      // ed = 입력칸을 보임, 확정한 줄이면 비활성(d0)
      const num = (f, lab, editable, max = 999, show = on) => editable ? `<input class="ci num" type="number" inputmode="numeric" min="0" max="${max}" data-rq="${b.id}" data-f="${f}" data-fk="q:${b.id}:${f}" value="${esc(rval(b.id, f) ?? 0)}" aria-label="${esc(b.name)} ${lab}"${hvA(t, f)}${d0}>`
        : (show ? H(t, f, esc(rval(b.id, f) ?? 0)) : "-");
      const ok = rval(b.id, "confirmed");
      h += `<tr class="${on ? "active" : ""} ${m.branch_id === b.id ? "mine" : ""} ${S.rdraft.has(b.id) ? "changed" : ""} ${isConf(b.id) ? "locked" : ""}" data-b="${b.id}"><td class="l">${esc(b.name)}${m.branch_id === b.id ? ' <span class="tag">내 지사</span>' : ""}</td>
        <td class="${isManual(b.id) ? "wxe" : ""}" data-fcell="${b.id}">${fcInner(b.id, "snow")}</td><td class="${isManual(b.id) ? "wxe" : ""}" data-pcell="${b.id}">${fcInner(b.id, "pcp")}</td><td data-ocell="${b.id}">${fcInner(b.id, "pop")}</td>
        <td class="${isManual(b.id) ? "wxe" : ""}" data-tcell="${b.id}">${fcInner(b.id, "tmin")}</td>
        ${warnCells(b.id)}
        <td class="wxm">${ed ? `<input type="checkbox" data-rq="${b.id}" data-f="wx_manual" data-fk="q:${b.id}:wx_manual"${isManual(b.id) ? " checked" : ""} aria-label="${esc(b.name)} 기상현황 직접입력"${hvA(t, "wx_manual")}${d0}>` : (isManual(b.id) ? H(t, "wx_manual", "✓") : '<span class="muted">-</span>')}</td>
        <td>${num("req_truck", "요청 제설차", ed)}</td><td>${num("req_blower", "요청 제설기", ed)}</td>
        <td class="l">${arriveCell(b, ed, t)}</td>
        <td class="ofc" data-ofcell="${b.id}">${num("offer_truck", "타지사 지원 가능 제설차", ed, 99, hasOffer(b.id))}</td>
        ${cellH(`class="svc" data-svcell="${b.id}"`, saveCell(b))}<td class="blk-gap" aria-hidden="true"></td>
        <td class="adm adm0">${num("assigned_truck", "편성 제설차", ed && conf)}</td><td class="adm">${num("assigned_blower", "편성 제설기", ed && conf)}</td>
        <td class="cf adm">${conf ? H(t, "confirmed", ok ? `<span class="status go">확정됨</span> <button type="button" class="btn sm" data-unconfirm="${b.id}">취소</button>`
                                                     : `<button type="button" class="btn sm primary" data-confirm="${b.id}">확정</button>`)
                                 : (ok ? H(t, "confirmed", '<span class="status go">확정</span>') : '<span class="muted">-</span>')}</td>
</tr>`;
    });
  });
  $("branchTable").innerHTML = h + "</tbody>";
  fixCols($("branchTable"), [98, 50, 50, 36, 50, 92, 88, 88, 54, 52, 52, 238, 56, 70, 10, 52, 52, 136]);
  $("branchTable").classList.toggle("mine-right", myBlk === "right"); $("branchTable").classList.toggle("mine-left", myBlk === "left");
  stickHead($("branchTable")); fitBranch();
}
// [저장] 칸: 지사·본부 계정은 아직 저장하지 않았거나 고친 값이 있으면 [저장](0이어도 저장 가능 — "요청 안 함"도 알림), 저장했으면 '저장 완료'
// 관리자(req.confirm)는 고친 줄만 [저장] — 편성 대수만 저장해 두고 확정은 나중에(2026-11-01, 아래 저장 막대를 없애며)
const canRowSave = b => canMarkSave(b) ? !isSaved(b.id) || S.rdraft.has(b.id) : can("req.confirm") && canEdit(b) && S.rdraft.has(b.id);
function saveCell(b) {
  if (canRowSave(b)) return `<button type="button" class="btn sm" data-rsave="${esc(b.id)}" aria-label="${esc(b.name)} 지사 줄 저장">저장</button>`;
  return isSaved(b.id) ? `<span class="status go sv lv-${esc(rbase(b.id, "saved_lv") || "x")}" title="${esc(fmtShort(rbase(b.id, "saved_at")))} 저장">${savedLabel(b.id)}</span>` : '<span class="muted">-</span>';
}
// 지사 줄 저장(바뀐 열만). extra 는 그 줄에 더할 값(확정 버튼: { confirmed: true/false })
async function saveBranchRows(ids, extra, msg) {
  if (S.reqsBad) return toast("요청·편성 자료를 불러오지 못해 저장할 수 없습니다. [다시 읽기]를 눌러 주세요.", true);
  if (S.preview) return toast("미리보기에서는 저장할 수 없습니다. '내 아이디'로 돌아오세요.", true);
  const list = ids.map(b => { const f = { ...(S.rdraft.get(b) || {}), ...(extra || {}) }, o = { branch_id: b };
    Object.entries(f).forEach(([k, v]) => { o[k] = k === "arrive_at" ? (v ? new Date(v).toISOString() : null) : k === "reason" ? (v || "") : v; });
    if (extra && extra.confirmed === true) o.expect_at = (S.reqs[b] || {}).updated_at ?? null;   // 확정: 내가 본 값 그대로일 때만(서버가 수정 시각을 비교, 마이그레이션 56)
    return { o, f }; });
  if (!list.length) return;
  busy("branch", true);
  const r = await Api.saveRequests(S.round, list.map(x => x.o));
  busy("branch", false);
  if (!r.ok && r.code === "55000") {                    // 그사이 다른 화면(관리자)에서 확정됨 → 최신으로 다시 읽고, 그 지사 줄의 고친 값은 버림
    await loadReqs(); const done = ids.filter(isConf); done.forEach(id => S.rdraft.delete(id)); refresh();
    const rest = done.length ? ids.length - done.length : 0;        // 묶음 저장은 전부 저장되거나 전부 취소됨(한 줄이 막히면 나머지도 저장 안 됨)
    return toast(`${(done.length ? done : ids).map(bn).join(", ")} 지사는 이미 확정되어 고칠 수 없습니다. 확정이 취소된 뒤에 고쳐 주세요.` + (rest ? ` 나머지 ${rest}개 지사도 저장되지 않았으니 다시 눌러 주세요.` : ""), true);
  }
  if (!r.ok && r.code === "SA007") {                    // 그사이 값이 바뀜 → 새 값을 다시 읽어 보여 줌(내가 고친 값은 그대로, 확정은 다시 눌러야 함). 묶음이면 전부 취소됨
    const seen = ids.map(id => (S.reqs[id] || {}).updated_at ?? null);
    await loadReqs(); refresh(); if (S.reqsBad) return;
    const moved = ids.filter((id, i) => ((S.reqs[id] || {}).updated_at ?? null) !== seen[i]), rest = moved.length ? ids.length - moved.length : 0;
    return toast(`${(moved.length ? moved : ids).map(bn).join(", ")} 지사의 ${r.message}` + (rest ? ` 나머지 ${rest}개 지사도 확정되지 않았습니다.` : ""), true);
  }
  if (!r.ok) return toast(r.message, true);
  // 저장 = 누가 저장했는지 남김(지사·본부·관리자 모두, 2026-11-02). 확정·확정 취소만 한 줄(고친 값 없음)은 남기지 않음 — 서버도 같은 규칙(마이그레이션 50)
  const now = new Date().toISOString(), mark = f => !("confirmed" in f) || Object.keys(f).some(k => k !== "confirmed") ? { saved_at: now, saved_lv: myLv() } : {};
  const vers = (r.result && r.result.versions) || {};   // 저장 뒤 수정 시각(마이그레이션 56) — 이걸 알아야 내 저장 뒤의 [확정]이 거절되지 않음
  list.forEach(({ o, f }) => { S.reqs[o.branch_id] = { ...REQ_DEF, round_id: S.round, branch_id: o.branch_id, ...(S.reqs[o.branch_id] || {}), ...f, ...mark(f), updated_at: vers[o.branch_id] ?? (S.reqs[o.branch_id] || {}).updated_at }; S.rdraft.delete(o.branch_id); });
  if (extra && "confirmed" in extra) {                // 확정하면 서버가 그 순간 대설 특보·예보를 남김 → 다시 읽어 표시
    await loadReqs();
    if (extra.confirmed && ids.length === 1) { const f = fcOf(ids[0]); msg += ` (대설특보: ${wlabel(warnOf(ids[0]).level, "대설")}, 적설 ${f && f.snow != null ? fcAmt(f, "snow") + "cm" : "없음"}·강수 ${f && f.pcp != null ? fcAmt(f, "pcp") + "mm" : "없음"}·최저 ${f && f.tmin != null ? fmtTmp(f.tmin) + "℃" : "없음"})`; }
  }
  await loadAudit(); refresh(); toast(msg); if (extra && extra.confirmed) flashRows(ids);
}
function flashRows(ids) {             // 방금 확정한 지사 줄을 잠깐 표시(취소는 바로 흰색)(움직임 4: 0.9초, 동작 줄이기 설정이면 CSS 가 끔)
  ids.forEach(id => { const tr = document.querySelector(`#branchTable tr[data-b="${CSS.escape(id)}"]`); if (!tr) return;
    tr.classList.remove("just"); void tr.offsetWidth; tr.classList.add("just"); setTimeout(() => tr.classList.remove("just"), 1000); });
}
const saveBranch = () => saveBranchRows([...S.rdraft.keys()], null, `저장했습니다 (${S.rdraft.size}개 지사)`);
const scopeIds = hq => S.order.filter(b => !(S.hqById[b.hq_id] || {}).is_private && (!hq || b.hq_id === hq)).map(b => b.id);   // 일괄 확정·취소 대상(민자 제외, hq = 그 본부만)
function bulkCell(hq) {
  const ids = scopeIds(hq), all = ids.length && ids.every(id => rval(id, "confirmed")), any = ids.some(isConf), a = hq ? ` data-hq-scope="${esc(hq)}"` : "";
  return `<span class="bulk">${all ? '<span class="status go">모두 확정</span>' : `<button type="button" class="btn sm primary" ${hq ? `data-confirm-hq="${esc(hq)}"` : 'id="confirmAll"'}>일괄 확정</button>`}` +
    (any ? `<button type="button" class="btn sm" ${hq ? `data-unconfirm-hq="${esc(hq)}"` : 'id="unconfirmAll"'}>일괄 취소</button>` : "") + `</span>`;
}
// 본부 줄의 저장 칸: [일괄 저장](그 본부에서 [저장]이 보이는 줄 모두) / 지사·본부 계정은 다 저장했으면 '모두 저장'(2026-11-01 사용자 요청)
// [일괄 저장] 대상(2026-11-02 사용자 요청): 줄 [저장]이 보이는 줄 + 본부 계정이면 지사가 저장한 줄(지사저장)도 → 고치지 않아도 한 번에 '본부저장'
//  (본부가 확인했다는 표시. 줄마다의 [저장] 버튼은 그대로 안 나옴. 확정한 줄은 빠짐)
const bulkOk = b => canRowSave(b) || (canMarkSave(b) && isSaved(b.id) && rbase(b.id, "saved_lv") !== myLv());
function bulkSaveCell(hq) {
  const rows = S.order.filter(b => b.hq_id === hq && canReq(b)); if (rows.length < 2) return "";
  const n = rows.filter(bulkOk).length;
  if (n) return `<button type="button" class="btn sm" data-rsave-hq="${esc(hq)}" aria-label="${esc((S.hqById[hq] || {}).name || "")} 본부 ${n}개 지사 일괄 저장">일괄 저장</button>`;
  return !can("req.confirm") && rows.every(b => isSaved(b.id) || isConf(b.id)) ? `<span class="status go sv">모두 ${can("req.edit.hq") ? "본부저장" : "저장"}</span>` : "";
}
function saveHq(hq) {
  const hn = `${(S.hqById[hq] || {}).name || ""} 본부 `, ids = S.order.filter(b => b.hq_id === hq && canReq(b) && bulkOk(b)).map(b => b.id);
  if (!ids.length) return toast(`${hn}저장할 지사가 없습니다`);
  const blank = can("req.confirm") ? [] : ids.filter(id => !S.rdraft.has(id)), lab = SAVE_LV[myLv()];   // 고치지 않은 줄 = 지금 값 그대로 저장(지사가 저장한 줄도 → 본부저장)
  if (!confirm(`${hn}${ids.length}개 지사를 ${lab}할까요?\n${ids.map(bn).join(", ")}` + (blank.length ? `\n고치지 않은 ${blank.map(bn).join(", ")} 지사는 지금 값 그대로 '${lab}'으로 남습니다.` : ""))) return;
  saveBranchRows(ids, null, `${hn}${ids.length}개 지사를 저장했습니다`);
}
function unconfirmAll(hq) {           // 확정된 지사를 모두 확정 취소(hq = 그 본부만)
  if (!can("req.confirm")) return;
  const hn = hq ? `${(S.hqById[hq] || {}).name || ""} 본부 ` : "", ids = scopeIds(hq).filter(isConf);
  if (!ids.length) return toast(`${hn || "모든 "}지사 중 확정된 지사가 없습니다`);
  if (!confirm(`${hn}${ids.length}개 지사의 확정을 취소할까요? 바로 저장됩니다.\n${ids.map(bn).join(", ")}\n기관별 장비 선택지에서 빠집니다(이미 넣은 경로는 그대로).`)) return;
  saveBranchRows(ids, { confirmed: false }, `${hn}${ids.length}개 지사의 확정을 취소했습니다`);
}
function confirmAll(hq) {             // 아직 확정 안 된 지사를 모두 확정(요청을 저장하지 않은 지사도 — 개별 [확정]과 같음). hq = 그 본부만
  if (!can("req.confirm")) return;
  const hn = hq ? `${(S.hqById[hq] || {}).name || ""} 본부 ` : "";
  const ids = S.order.filter(b => !(S.hqById[b.hq_id] || {}).is_private && (!hq || b.hq_id === hq) && !rval(b.id, "confirmed")).map(b => b.id);
  if (!ids.length) return toast(`${hn || "모든 "}지사가 이미 확정됐습니다`);
  if (!confirm(`${hn}${ids.length}개 지사를 확정할까요? 바로 저장됩니다.\n${ids.map(bn).join(", ")}\n이 지사 줄에서 고친 값도 함께 저장되고, 확정하면 [취소]하기 전까지 고칠 수 없습니다.`)) return;
  saveBranchRows(ids, { confirmed: true }, `${hn}${ids.length}개 지사를 확정했습니다`);
}
function confirmBranch(id, on) {
  const b = S.brById[id]; if (!b || !can("req.confirm")) return;
  const more = S.rdraft.has(id) ? "\n이 지사 줄에서 고친 값도 함께 저장됩니다." : "";
  const of = +rval(id, "offer_truck") || 0, reg = poolVehs(id).length;      // 타지사 지원 가능 대수도 같은 [확정]으로 함께 확정·잠금
  const ofOn = of ? `\n타지사 지원 가능 ${of}대도 함께 확정됩니다(이 지사가 지역본부 장비를 등록할 수 있게 됩니다).` : "", ofOff = offerOk(id) ? `\n타지사 지원 가능 ${offerOf(id)}대 확정도 함께 취소됩니다${reg ? ` — 이미 등록한 장비 ${reg}대와 경로는 그대로 남고, 새 등록만 막힙니다` : ""}.` : "";
  if (!confirm(on ? `${b.name} 지사의 편성을 확정할까요? 바로 저장되고, 기관별 장비에서 이 지사를 고를 수 있습니다.\n확정하면 [취소]하기 전까지 이 줄은 고칠 수 없습니다.${ofOn}${more}` : `${b.name} 지사의 확정을 취소할까요? 기관별 장비 선택지에서 빠집니다(이미 넣은 경로는 그대로).${ofOff}${more}`)) return;
  saveBranchRows([id], { confirmed: on }, on ? `${b.name} 지사를 확정했습니다` : `${b.name} 지사 확정을 취소했습니다`);
}
async function makeRound(date) {
  const d = date || $("newRoundDate").value;
  if (!d) return toast("기준일자 날짜를 고르세요", true);
  if (S.preview) return toast("미리보기에서는 만들 수 없습니다.", true);
  if (S.rounds.some(r => r.start_date >= d)) return toast("새 기준일자는 마지막 기준일자보다 뒤 날짜여야 합니다", true);
  if (!confirm(`${d} 기준일자를 만들까요?\n장비 지원 여부는 이전 기준일자의 것을 그대로 이어받습니다(나중에 고칠 수 있음).`)) return;
  const r = await Api.createRound(d);
  if (!r.ok) return toast(r.message, true);
  S.rounds.push(r.round); S.rounds.sort((a, b) => b.start_date.localeCompare(a.start_date));
  await loadAudit(); await switchRound(r.round.id, true); toast("기준일자를 만들었습니다");
}
async function deleteRound() {
  const r = curRound(); if (!r) return;
  if (S.preview) return toast("미리보기에서는 지울 수 없습니다.", true);
  const n = Object.keys(S.reqs).length;
  if (S.rounds[0] && S.rounds[0].id !== r.id) return toast("가장 마지막 기준일자만 지울 수 있습니다", true);
  // 다른 기준일자에 딸린 지역본부 장비의 경로는 세지 않음(이 기준일자 화면에서는 지울 수 없는 경로 — 이 기준일자를 지우면 앞 기준일자가 다시 맡아 그대로 되살아남, 마이그레이션 45)
  if ([...S.routes.keys()].some(k => { const [d, vid] = k.split("|"), v = vehById(vid); return d >= r.start_date && d <= roundEnd(r) && !isTeam(v) && !(isPool(v) && v.round_id !== r.id); })) return toast("이 기준일자 기간에 경로가 있어 지울 수 없습니다. 경로를 먼저 비우세요.", true);
  const teamN = [...S.routes.keys()].filter(k => { const [d, vid] = k.split("|"); return isTeamId(vid) && d >= r.start_date && d <= roundEnd(r); }).length;   // 신속대응팀 경로는 함께 지움(사용자 결정)
  if (!confirm(`기준일자 ${r.start_date}를 지울까요?\n이 기준일자의 지사 요청·편성 ${n}건과 장비 지원 여부${teamN ? `, 강원 신속대응팀 경로 ${teamN}칸` : ""}도 함께 지워집니다(지운 내용은 수정 기록에 남음).`)) return;
  const res = await Api.deleteRound(r.id);
  if (!res.ok) return toast(res.message, true);
  [...S.routes.keys()].filter(k => { const [d, vid] = k.split("|"); return isTeamId(vid) && d >= r.start_date && d <= roundEnd(r); }).forEach(k => S.routes.delete(k));    // 서버가 함께 지운 신속대응팀 경로
  S.rounds = S.rounds.filter(x => x.id !== r.id); S.stLoaded.delete(r.id); S.vehicles = S.vehicles.filter(v => v.round_id !== r.id);      // 그 기준일자에 딸린 지역본부 장비는 서버가 함께 지움 [...S.rstat.keys()].filter(k => k.startsWith(r.id + "|")).forEach(k => S.rstat.delete(k));
  await loadAudit(); await switchRound(pickRound(), true); toast("기준일자를 지웠습니다");
}
async function switchRound(id, force) {
  if (!force && anyDirty() && !confirm("확정·저장하지 않은 변경이 있습니다. 버리고 기준일자를 바꿀까요?")) { refresh(); return; }
  S.rdraft.clear(); S.draft.clear(); S.vdraft.clear(); S.sdraft.clear(); S.adraft.clear(); S.extraStop.clear(); S.colsDraft.clear(); S.day1Draft.clear(); S.unhideOpen = false; S.nvSel = ""; S.nvRent = false; S.round = +id || null;   // 지원 여부·경로 변경은 기준일자마다 따로라 버림
  await Promise.all([loadReqs(), ensureRoutes(), loadWarn(), loadAlloc()]); refresh();
}

/* ============================================================
   [6-2] 기관별 배치 — 관리자: 편성이 확정된 지사에 기관별 제설차·제설기 대수. 기준일자 전체에 한 번(지원일 1 기준)
   ============================================================ */
function renderAlloc() {
  const r = curRound(), ed = canRoute() && !!r, AO = [...S.orgs, POOL];        // 배정 대수는 관리자(equip.route)만 — 2026-11-02        // 칸: 기계화부 4곳(제설차·제설기) + 지역본부(제설차만)
  banner("perm-alloc");
  $("allocRound").innerHTML = roundSel("roundSelAlloc") + (r ? "" : `<span class="hint">기준일자가 없습니다.</span>`);
  if (S.reqsBad) { $("allocTable").classList.remove("fixcols"); $("allocTable").style.minWidth = ""; $("allocTable").innerHTML = reqsBadHtml(); return; }
  const rows = r ? S.order.filter(b => isFixed(b.id)) : [];      // 편성이 확정된 지사만(2026-11-03 사용자 요청, 확정을 취소하면 안 보이고 다시 확정하면 배정이 그대로 돌아옴)
  if (!rows.length) { $("allocTable").classList.remove("fixcols"); $("allocTable").style.minWidth = ""; $("allocTable").innerHTML = `<tbody><tr><td class="empty">${r ? "편성이 확정된 지사가 없습니다. 지사별 요청·편성에서 편성 대수를 넣고 [확정]하면 여기에 나옵니다." : "기준일자가 없습니다."}</td></tr></tbody>`; return; }
  const sum = (bid, f) => AO.reduce((n, o) => n + (aval(o, bid)[f] || 0), 0), osum = (o, f) => rows.reduce((n, b) => n + (aval(o, b.id)[f] || 0), 0);
  const availN = (o, t) => S.vehicles.filter(v => v.org === o && v.type === t && shownIn(v, r) && stOf(r.id, v.id).status === "O").length;
  const poolCap = offerBranches().reduce((n, b) => n + offerOf(b.id), 0);                    // 지역본부의 '지원 가능' = 확정된 타지사 지원 가능 대수 합계
  // 배정 / 기준: 같으면 초록, 모자라면 주황, 넘으면 빨강
  const cmp = (got, want, tip) => `<span class="${got === want ? "al-ok" : got < want ? "al-short" : "al-over"}" title="${got === want ? "맞음" : got < want ? `${want - got}대 모자람` : `${got - want}대 초과`}${tip || ""}">${got} / ${want}</span>`;
  const cell = (o, b, f, lab) => { const v = aval(o, b.id)[f] || 0, k = ak(o, b.id);
    return ed && isFixed(b.id) && (asg(b.id, f) > 0 || v > 0) ? `<input class="ci num" type="number" inputmode="numeric" min="0" max="99" data-al="${esc(k)}" data-f="${f}" data-fk="al:${esc(k)}:${f}" value="${v}" aria-label="${esc(o)} → ${esc(b.name)} ${lab}">` : (v ? String(v) : '<span class="muted">-</span>'); };
  const head = `<thead><tr><th class="l" rowspan="2">피지원 지사</th>${S.orgs.map(o => `<th colspan="2">${esc(o)}</th>`).join("")}<th class="al-pool">${POOL}</th><th colspan="2">배정 / 편성</th></tr>` +
    `<tr>${S.orgs.map(() => "<th>제설차</th><th>제설기</th>").join("")}<th class="al-pool">제설차</th><th>제설차</th><th>제설기</th></tr></thead>`;
  const over = b => ["truck", "blower"].some(f => allocSum(b.id, f) > asg(b.id, f));       // 편성보다 많이 배정됨(여러 기관에 나뉜 채 편성을 줄인 경우 — 자동으로 안 줄임)
  const body = rows.map(b => `<tr class="${AO.some(o => S.adraft.has(ak(o, b.id))) ? "changed" : ""}" data-ab="${b.id}"><td class="l">${esc(b.name)}${over(b) ? ' <span class="tag warn al-overasg">편성보다 많음 — 줄여 주세요</span>' : ""}</td>` +
    S.orgs.map(o => `<td>${cell(o, b, "truck", "제설차")}</td><td>${cell(o, b, "blower", "제설기")}</td>`).join("") + `<td class="al-pool">${cell(POOL, b, "truck", "제설차")}</td>` +
    `<td data-asum="truck">${cmp(sum(b.id, "truck"), +rbase(b.id, "assigned_truck") || 0)}</td><td data-asum="blower">${cmp(sum(b.id, "blower"), +rbase(b.id, "assigned_blower") || 0)}</td></tr>`).join("");
  const tot = f => rows.reduce((n, b) => n + sum(b.id, f), 0), want = f => rows.reduce((n, b) => n + (isFixed(b.id) ? +rbase(b.id, f) || 0 : 0), 0);
  const avc = (o, f, t) => { const got = osum(o, f), av = o === POOL ? poolCap : availN(o, t); return `<td${o === POOL ? ' class="al-pool" data-apool="av"' : ""}><span class="${got > av ? "al-over" : ""}" title="배정 ${got}대 / ${o === POOL ? "확정된 타지사 지원 가능" : "지원 가능"} ${av}대">${got} / ${av}</span></td>`; };
  const foot = `<tfoot><tr class="al-sum"><th class="l">배정 합계</th>${S.orgs.map(o => `<td>${osum(o, "truck")}</td><td>${osum(o, "blower")}</td>`).join("")}<td class="al-pool">${osum(POOL, "truck")}</td><td>${cmp(tot("truck"), want("assigned_truck"))}</td><td>${cmp(tot("blower"), want("assigned_blower"))}</td></tr>` +
    `<tr class="al-av"><th class="l">배정 / 지원 가능</th>${S.orgs.map(o => avc(o, "truck", "제설차") + avc(o, "blower", "제설기")).join("")}${avc(POOL, "truck", "제설차")}<td></td><td></td></tr></tfoot>`;      // 2026-11-11 사용자: 아래 '장비 지정' 줄은 뺌(관리자만 보고 숫자도 헷갈림)
  $("allocTable").innerHTML = head + `<tbody>${body}</tbody>` + foot;
  const alCols = (isPhoneW() ? [7.7, ...S.orgs.flatMap(() => [4.3, 4.3]), 5, 5, 5] : [8.6, ...S.orgs.flatMap(() => [4.9, 4.9]), 4.9, 5.6, 5.6]).map(em);
  fixCols($("allocTable"), alCols, true); fitPanel($("allocTable"));
  stickHead($("allocTable"));
}
async function saveAlloc() {
  if (S.preview) return toast("미리보기에서는 확정할 수 없습니다. '내 아이디'로 돌아오세요.", true);
  const rows = [...S.adraft].map(([k, x]) => { const [org, branch_id] = k.split("|"); return { org, branch_id, truck: x.truck || 0, blower: x.blower || 0 }; });
  if (!rows.length || !S.round) return;
  busy("alloc", true);
  const r = await Api.saveAllocations(S.round, rows);
  busy("alloc", false);
  if (!r.ok) return toast(r.message, true);
  rows.forEach(x => { const k = ak(x.org, x.branch_id); if (x.truck + x.blower > 0) S.alloc.set(k, { truck: x.truck, blower: x.blower }); else S.alloc.delete(k); });
  S.adraft.clear(); await loadAudit(); refresh(); toast(`기관별 배치을 확정했습니다 (${rows.length}칸)`);
}

/* ============================================================
   [7] 로그 기록 (log.view 권한) — 서버의 접속·수정 기록 중 장비 지원 관련
   ============================================================ */
function describeTarget(a) {
  const [tab, rest = ""] = (a.target || "").split(":"), p = rest.split(",");
  if (tab === "vehicle_routes" || tab === "gw_team_routes") return `${plateOf(p[1])} · ${fmtMD(p[0])}`;
  if (tab === "vehicles") return plateOf(p[0]);
  if (tab === "round_vehicle_status" || tab === "gw_team_status") { const r = S.rounds.find(x => x.id === +p[0]); return `${plateOf(p[1])} · 기준일자 ${r ? fmtMD(r.start_date) : p[0]}`; }
  if (tab === "round_requests") { const r = S.rounds.find(x => x.id === +p[0]); return `${bn(p[1])} · 기준일자 ${r ? fmtMD(r.start_date) : p[0]}`; }
  if (tab === "branch_zone_overrides") return `${bn(p[0])} · 특보구역 ${p[1]}`;
  if (tab === "round_allocations") { const r = S.rounds.find(x => x.id === +p[0]); return `${p[1]} → ${bn(p[2])} · 기준일자 ${r ? fmtMD(r.start_date) : p[0]}`; }
  if (tab === "support_rounds") { const r = S.rounds.find(x => x.id === +p[0]); return `기준일자 ${r ? r.start_date : p[0]}`; }
  return a.target || "-";
}
function describeChange(a) {
  const det = a.tab === "vehicle_routes" || a.tab === "gw_team_routes" || a.tab === "branch_zone_overrides";
  if (a.kind === "추가" && !det) return "새로 만듦";
  if (a.kind === "삭제" && !det) return "지움";
  const keys = [...new Set([...Object.keys(a.from_val || {}), ...Object.keys(a.to_val || {})])].filter(k => !HIDE.has(k));
  return keys.map(k => `${FIELD[k] || k}: ${fmtField(k, a.from_val ? a.from_val[k] : null)} → ${fmtField(k, a.to_val ? a.to_val[k] : null)}`).join(" / ") || "-";
}
function renderLog() {
  const box = $("logTable");
  if (!can("log.view")) { box.innerHTML = ""; $("logFilters").innerHTML = ""; return; }
  const pm = $("perm-log"); pm.className = "perm can";
  pm.textContent = ""; pm.hidden = true;
  const users = [...new Set(S.audit.map(l => l.username || "-"))];
  $("logFilters").innerHTML = ["전체", "추가", "수정", "삭제"].map(k => `<button type="button" class="chip" data-lk="${k}" aria-pressed="${S.logKind === k}">${k === "전체" ? "모든 구분" : k}</button>`).join("") +
    `<select class="ci" id="logUser" aria-label="아이디로 필터"><option value="전체">모든 아이디</option>${users.map(u => `<option ${S.logUser === u ? "selected" : ""}>${esc(u)}</option>`).join("")}</select>` +
    `<button type="button" class="chip" id="logToday" aria-pressed="${S.logToday}">오늘만</button>`;
  const rows = S.audit.filter(l => (S.logKind === "전체" || l.kind === S.logKind) && (S.logUser === "전체" || (l.username || "-") === S.logUser) && (!S.logToday || sameDay(l.at)))
    .slice().reverse().slice(0, 300).map(l => `<tr><td class="t">${esc(fmtShort(l.at))}</td><td>${esc(l.username || "-")}</td><td><span class="status ${l.kind === "삭제" ? "stop" : "go"}">${esc(l.kind)}</span></td>
      <td>${esc(TAB_LABEL[l.tab] || l.tab || "-")}</td><td>${esc(describeTarget(l))}</td><td>${esc(describeChange(l))}</td><td class="ip">${esc(l.ip || "-")}</td></tr>`).join("");
  box.innerHTML = `<thead><tr><th>일시</th><th>아이디</th><th>구분</th><th>표</th><th>대상</th><th>내용</th><th>IP</th></tr></thead><tbody>${rows || `<tr><td colspan="7" class="muted" style="text-align:center;padding:28px">조건에 맞는 기록이 없습니다.</td></tr>`}</tbody>`;
}

/* ============================================================
   [8] 장비 상세 — 날짜별 경로 기록 전체
   ============================================================ */
const sheet = $("sheet"), backdrop = $("backdrop");
let lastFocus = null;
async function openSheet(vid) {
  const v = vehById(vid); if (!v) return;
  const g = govRound(S.date), st = g ? stOf(g.id, v.id).status : "", [cls, label] = STATUS[st] || STATUS[""], rec = effRec(S.date, v.id), cur = rec.stops;   // 지원 여부 = 그 날짜를 맡은 기준일자의 값
  sheet.innerHTML = `<button type="button" class="sheet-close" id="sheetClose">닫기</button><span class="plate" style="font-size:18px">${esc(vname(v))}</span>
    <h2 id="sheetTitle">${esc(v.org)} ${esc(v.type)}${hasBlower(v) ? ` · 블로워 ${esc(blowerText(v))}` : ""}</h2>${g && label ? `<span class="status ${cls}">${label}</span>` : ""}
    <section><h3>${esc(fmtMD(S.date))} 이동</h3><dl class="kv"><dt>지원기관</dt><dd>${isPool(v) ? POOL : isTeam(v) ? TEAM : esc(v.org) + " 기계화부"}</dd>
      <dt>들르는 지사</dt><dd>${cur.length ? cur.map(x => esc(bn(x))).join(" → ") + "" : "-"}</dd>
      <dt>도착 예상</dt><dd>${cur.length ? cur.map((x, j) => `${esc(bn(x))} ${esc(j === 0 && isCont(v.id, S.date, x) ? "연속지원" : rec.times[j] ? fmtMD(S.date) + " " + rec.times[j] : "미정")}`).join("<br>") : "-"}</dd></dl></section>
    <section><h3>날짜별 경로 기록</h3><div id="vhist" class="muted">불러오는 중…</div></section>`;
  sheet.hidden = false; backdrop.hidden = false;
  if (!lastFocus) lastFocus = document.activeElement;
  $("sheetClose").focus(); $("sheetClose").onclick = closeSheet;
  const r = await Api.vehicleHistory(vid);
  if (sheet.hidden || !$("vhist")) return;
  $("vhist").className = "";
  $("vhist").innerHTML = !r.ok ? esc(r.message) : r.rows.length ? `<ol class="vhist">${r.rows.map(x => `<li class="${x.date === S.date ? "on" : ""}"><b>${esc(fmtMD(x.date))}</b> ${esc(x.date.slice(0, 4))} · ${esc(x.stops.map((s, j) => bn(s) + (x.times && x.times[j] ? " " + x.times[j] : "")).join(" → "))}</li>`).join("")}</ol>` : "확정된 경로 기록이 없습니다.";
}
/* ---------- 특보구역 관리 — 지사마다 대설 특보를 볼 기상청 특보구역. 자동 목록은 관할 고속도로가 지나는 시·군에서 계산
   2026-11-10 사용자: 모든 아이디가 모든 지사를 봄. 관리자만 바로 더하기·빼기, 나머지는 사유를 적어 [요청](마이그레이션 92) → 관리자가 승인/반려
   처음 고르는 지사: 지사 아이디 = 자기 지사, 본부 = 자기 본부의 첫 지사, 기계화부·관리자 = 첫 지사 ---------- */
function zoneFirst() {
  const m = S.me || {};
  if (m.role === "branch" && m.branch_id && S.brById[m.branch_id]) return m.branch_id;
  if (m.role === "hq") { const b = S.order.find(x => x.hq_id === m.hq_id); if (b) return b.id; }
  return S.order.length ? S.order[0].id : null;
}
const zAdmin = () => !!S.me && S.me.role === "admin";
async function openZones(bid) {
  sheet.innerHTML = `<button type="button" class="sheet-close" id="sheetClose">닫기</button><h2 id="sheetTitle">특보구역 관리</h2>
    <label class="ctl">지사 <select class="ci" id="zbr">${S.order.map(b => `<option value="${b.id}">${esc((S.hqById[b.hq_id] || {}).name || "")} · ${esc(b.name)}</option>`).join("")}</select></label>
    <div id="zlist" class="muted">불러오는 중…</div><div id="wnow"></div>`;
  sheet.hidden = false; backdrop.hidden = false;
  if (!lastFocus) lastFocus = document.activeElement;
  $("sheetClose").focus(); $("sheetClose").onclick = closeSheet;
  $("zbr").value = bid || zoneFirst() || "";
  const [r, q] = await Promise.all([Api.zoneData(), Api.zoneReqs()]);
  if (!r.ok) { if ($("zlist")) $("zlist").textContent = r.message; return; }
  S.zdata = r; S.zreq = q.ok ? q.rows : []; S.zask = null; renderZones(); renderWarnNow();
}
async function reloadZones(msg) {
  const [z, q] = await Promise.all([Api.zoneData(), Api.zoneReqs()]);
  if (z.ok) S.zdata = z; if (q.ok) S.zreq = q.rows; S.zask = null; renderZones(); renderWarnNow();
  if (msg) toast(msg);
}
// 관리자: 처리를 기다리는 요청 — 지사·구역·더하기/빼기·사유·요청한 아이디 [승인][반려]
function zoneReqsHtml() {
  const rows = S.zreq || []; if (!zAdmin() || !rows.length) return "";
  return `<h3>처리를 기다리는 요청 ${rows.length}건</h3><ul class="zlist zreqs">${rows.map(q => `<li><span><b>${esc(bn(q.branch_id))}</b> · ${esc(zoneLabel(q.zone_code))} <span class="tag">${q.action === "add" ? "더하기" : "빼기"}</span>
      <br><span class="muted">${esc(q.reason)} — ${esc(q.by || "")}</span></span>
      <span class="zreq-btns"><button type="button" class="btn sm primary" data-zok="${q.id}">승인</button><button type="button" class="btn sm" data-zno="${q.id}">반려</button></span></li>`).join("")}</ul>`;
}
// 관리자 아닌 아이디: 요청 사유 적는 칸(누른 단추 아래)
function zoneAskHtml(code, action) {
  const k = S.zask; if (!k || k.code !== code || k.action !== action) return "";
  return `<div class="zask"><input class="ci" id="zaskReason" maxlength="200" placeholder="사유(꼭 적어 주세요)" aria-label="${action === "add" ? "더하기" : "빼기"} 요청 사유">
    <button type="button" class="btn sm primary" id="zaskSend">요청 보내기</button><button type="button" class="btn sm" id="zaskCancel">취소</button></div>`;
}
// 지금 서버에 받아 둔 특보 전체(전국, 지사와 이어지지 않은 섬 등 포함) — 종류별 탭(대설 맨 앞, 종류가 5개 이상이면 두 줄)
// 탭 = 특보 이름 + 발표된 구역 수, 누르면 아래에 구역마다 단계·발표·발효 시각과 이어진 지사
const wlv2 = l => l === "예비" ? "예비특보" : l === "주의" ? "주의보" : l === "경보" ? "경보" : l;
function renderWarnNow() {
  const el = $("wnow"), d = S.zdata && S.zdata.active; if (!el || !d) return;
  const st = d.state || {}, rows = d.rows || [], by = {};
  rows.forEach(x => (by[x.kind] = by[x.kind] || []).push(x));
  const zc = k => new Set((by[k] || []).map(x => x.zone)).size;
  const kinds = ["대설", ...Object.keys(by).filter(k => k !== "대설").sort((a, b) => zc(b) - zc(a) || a.localeCompare(b, "ko"))];
  if (!kinds.includes(S.wtab)) S.wtab = kinds.find(k => zc(k)) || "대설";
  const tab = k => `<button type="button" class="chip wtab" role="tab" data-wtab="${esc(k)}" aria-selected="${k === S.wtab}" aria-pressed="${k === S.wtab}">${esc(k)} <b>${zc(k)}</b></button>`;
  const half = kinds.length > 4 ? Math.ceil(kinds.length / 2) : kinds.length;
  const list = (by[S.wtab] || []).slice().sort((a, b) => (WLV_RANK[b.level] || 0) - (WLV_RANK[a.level] || 0) || a.name.localeCompare(b.name, "ko"));
  el.innerHTML = `<h3>지금 받은 특보 (전국 ${rows.length}건)</h3>
    <p class="muted">${st.fetched_at ? `기상청에서 받은 시각 ${esc(fmtShort(st.fetched_at))}` : "아직 받지 못함"}${st.ok === false && st.note ? ` · 최근 실패: ${esc(st.note)}` : ""} ·
      ${d.needed ? "수집 중" : "수집 쉬는 중"}</p>
    <div class="wtabs" role="tablist"><div class="wtrow">${kinds.slice(0, half).map(tab).join("")}</div>${half < kinds.length ? `<div class="wtrow">${kinds.slice(half).map(tab).join("")}</div>` : ""}</div>` +
    (list.length ? `<table class="wlist"><thead><tr><th class="l">구역</th><th>단계</th><th>발표</th><th>발효</th><th class="l">이어진 지사</th></tr></thead><tbody>${list.map(x =>
      `<tr><td class="l">${esc(x.name)}</td><td><span class="wb ${(WLV[x.level] || ["w0"])[0]}">${esc(wlv2(x.level))}</span></td><td>${esc(fmtWarnTime(x.tm_fc, x.level))}</td><td>${esc(fmtWarnTime(x.tm_ef, x.level, true))}</td>
       <td class="l muted">${x.branches.length ? esc(x.branches.map(bn).join(", ")) : "없음"}</td></tr>`).join("")}</tbody></table>`
      : `<p class="muted">지금 발효·예정된 ${esc(S.wtab)} 특보가 없습니다.</p>`);
}
const WLV_RANK = { "예비": 1, "주의": 2, "경보": 3 };
function zoneLabel(code) {          // 시·도 · 구역 이름
  const zs = S.zdata.byCode, z = zs[code]; if (!z) return code;
  let u = zs[z.up_code]; while (u && !/02$/.test(u.sp || "") && zs[u.up_code]) u = zs[u.up_code];
  return (u && u.zone_code !== code && /02$/.test(u.sp || "") ? u.name + " · " : "") + z.name;
}
function renderZones() {
  const el = $("zlist"), d = S.zdata; if (!el || !d) return;
  if (!d.byCode) d.byCode = Object.fromEntries(d.zones.map(z => [z.zone_code, z]));
  const bid = $("zbr").value, cur = d.list[bid] || [], has = new Set(cur.map(z => z[0])), adm = zAdmin();
  const mine = c => (S.zreq || []).find(q => q.branch_id === bid && q.zone_code === c && (adm || q.mine));      // 이 지사·구역에 대기 중인 요청
  const pend = c => { const q = mine(c); return q ? `<span class="tag req">${q.action === "add" ? "더하기" : "빼기"} 요청 중</span>` + (!adm && q.mine ? `<button type="button" class="btn sm" data-zcancel="${q.id}">요청 취소</button>` : "") : ""; };
  const act = (c, action, label, inc) => mine(c) ? pend(c) : adm ? `<button type="button" class="btn sm" data-zset="${esc(c)}" data-zinc="${inc}">${label}</button>`
    : `<button type="button" class="btn sm" data-zask="${esc(c)}" data-zact="${action}">${label} 요청</button>`;
  const out = d.overrides.filter(o => o.branch_id === bid && !o.include);
  const leaf = d.zones.filter(z => /1[34]$/.test(z.sp || "") && !has.has(z.zone_code)).map(z => [z.zone_code, zoneLabel(z.zone_code)]).sort((a, b) => a[1].localeCompare(b[1], "ko"));
  el.className = "";
  const sel = $("zadd") ? $("zadd").value : "";
  el.innerHTML = zoneReqsHtml() + (adm ? "" : `<p class="muted">더하기·빼기는 사유를 적어 관리자에게 요청합니다. 관리자가 승인하면 바뀝니다.</p>`) +
    `<h3>들어간 구역 ${cur.length}곳</h3>` + (cur.length ? `<ul class="zlist">${cur.map(z => `<li><span>${esc(zoneLabel(z[0]))}</span><span class="tag">${z[2] === "manual" ? "더함" : "자동"}</span>
      ${act(z[0], "remove", "빼기", z[2] === "manual" ? "" : "0")}${zoneAskHtml(z[0], "remove")}</li>`).join("")}</ul>` : `<p class="muted">없음 — 이 지사의 관할 고속도로가 없거나 모두 뺐습니다.</p>`) +
    (out.length ? `<h3>뺀 구역</h3><ul class="zlist">${out.map(o => `<li><span>${esc(zoneLabel(o.zone_code))}</span>${act(o.zone_code, "add", "되살리기", "")}${zoneAskHtml(o.zone_code, "add")}</li>`).join("")}</ul>` : "") +
    `<h3>구역 더하기</h3><div class="zadd"><select class="ci" id="zadd"><option value="">구역 고르기</option>${leaf.map(([c, n]) => `<option value="${esc(c)}"${c === sel ? " selected" : ""}>${esc(n)}${mine(c) ? " (요청 중)" : ""}</option>`).join("")}</select>
      ${adm ? `<button type="button" class="btn sm primary" id="zaddBtn">더하기</button>` : `<button type="button" class="btn sm primary" id="zaddAsk">더하기 요청</button>`}</div>` +
    (S.zask && S.zask.free ? zoneAskHtml(S.zask.code, "add") : "") +
    (!adm ? `${(S.zreq || []).filter(q => q.mine && q.branch_id === bid && !has.has(q.zone_code) && !out.some(o => o.zone_code === q.zone_code)).map(q => `<p class="muted">${esc(zoneLabel(q.zone_code))} — 더하기 요청 중 <button type="button" class="btn sm" data-zcancel="${q.id}">요청 취소</button></p>`).join("")}` : "");
  if (S.zask && $("zaskReason")) $("zaskReason").focus();
}
async function setZone(code, include) {   // include: true 더함 / false 자동에서 뺌 / null 손댄 것을 없앰(자동대로)
  const bid = $("zbr") && $("zbr").value; if (!bid || S.me.role !== "admin") return;
  if (S.preview) return toast("미리보기에서는 바꿀 수 없습니다.", true);
  const r = await Api.setZone(bid, code, include);
  if (!r.ok) return toast(r.message, true);
  const z = await Api.zoneData(); if (z.ok) { S.zdata = z; renderZones(); renderWarnNow(); }
  await Promise.all([loadWarn(), loadAudit()]); paintWarn(); renderLog(); if (!$("panel-move").hidden) renderDest(); toast(`${bn(bid)} 지사 특보구역을 바꿨습니다`);
}
async function sendZoneReq() {
  const k = S.zask, bid = $("zbr") && $("zbr").value, reason = (($("zaskReason") || {}).value || "").trim();
  if (!k || !bid) return;
  if (!reason) { toast("사유를 적어 주세요", true); if ($("zaskReason")) $("zaskReason").focus(); return; }
  if (S.preview) return toast("미리보기에서는 요청할 수 없습니다.", true);
  const r = await Api.zoneReq(bid, k.code, k.action, reason);
  if (!r.ok) return toast(r.message, true);
  reloadZones(`${bn(bid)} 지사 ${zoneLabel(k.code)} ${k.action === "add" ? "더하기" : "빼기"}를 요청했습니다`);
}
async function resolveZoneReq(id, approve) {
  if (!zAdmin()) return;
  const q = (S.zreq || []).find(x => x.id === id);
  const r = await Api.zoneReqResolve(id, approve);
  if (!r.ok) return toast(r.message, true);
  if (q && $("zbr")) $("zbr").value = q.branch_id;
  await reloadZones(approve ? "요청을 승인해 특보구역을 바꿨습니다" : "요청을 반려했습니다");
  if (approve) { await Promise.all([loadWarn(), loadAudit()]); paintWarn(); renderLog(); if (!$("panel-move").hidden) renderDest(); }
}
// 바깥 화면(로그인 알림창의 [지금 보기])이 부름: 지사별 요청·편성 탭에서 특보구역 관리 창을 엶
window.SSOpenZones = (bid) => { if (!S.me) return false; openZones(bid || null); return true; };
function closeSheet() { crewPick=null; sheet.classList.remove("wide", "crew-sheet"); sheet.hidden = true; backdrop.hidden = true; hideTip(); if (lastFocus) lastFocus.focus(); lastFocus = null;
  if (history.state && history.state.ssSheet) { try { history.back(); } catch (e) {} } }      // 창을 열 때 남긴 기록 한 칸을 지움(뒤로가기로 닫은 경우는 이미 지워짐)
// 뒤로가기(2026-11-02 사용자 요청): 창(장비 상세·보고서 미리 보기 등)이 열리면 기록 한 칸 → 뒤로가기는 창만 닫음. 장비 화면만 따로 열었으면 이전 탭으로
new MutationObserver(() => { if (!sheet.hidden && !(history.state && history.state.ssSheet)) { try { history.pushState({ ...(history.state || {}), ssSheet: 1 }, ""); } catch (e) {} } })
  .observe(sheet, { attributes: true, attributeFilter: ["hidden"] });
window.addEventListener("popstate", e => {
  if (!sheet.hidden) return closeSheet();
  if (window.top !== window) return;
  const name = (e.state && e.state.eqTab) || "move", t = document.querySelector(`.tab[data-tab="${name}"]`);
  if (t && !t.hidden && t.getAttribute("aria-selected") !== "true") t.click();
});
backdrop.onclick = closeSheet;
document.addEventListener("keydown", e => { if (e.key === "Escape" && !sheet.hidden) closeSheet(); });

/* ============================================================
   [9] 저장 바·그리기
   ============================================================ */
function busy(t, on) { const bar = $("save-" + t); bar.classList.toggle("busy", on); bar.querySelectorAll("button").forEach(b => { b.disabled = on || b.disabled; }); if(t === "fleet") $("fleetDownload").disabled = on; }
// 저장 바 글에 지원일 칸 수 변경을 덧붙임(94). base = 다른 변경 글(없으면 "")
const colsNote = (kind, base) => { const c = colsDraftOf(kind), d1 = day1DraftOf(kind);
  const t = [d1 != null ? `지원일 1 ${fmtMD(day1Saved(kind))} → ${fmtMD(d1)}` : "", c != null ? `지원일 칸 ${colsSaved(kind)}개 → ${c}개` : ""].filter(Boolean).join(" · ");
  return !t ? base : base ? base + " · " + t : "확정하지 않은 변경: " + t; };
function updateSavebars() {
  const fb = $("save-fleet"), bb = $("save-branch"), ab = $("save-alloc");
  fb.hidden = !(can("equip.edit.all") || can("equip.edit.own") || myPoolN() > 0 || (canPoolAdd() && fleetDirty())); bb.hidden = true; ab.hidden = !canRoute() || !S.round;
  const fd = fleetDirty(), bd = branchDirty(), ad = allocDirty(), td = teamDirty(), tb = $("save-gwteam");
  tb.hidden = !canTeam() || !S.round; tb.classList.toggle("dirty", td);
  tb.querySelector(".save-state").textContent = td ? colsNote("team", draftKeys(true).length || sdraftKeys(true).length ? `확정하지 않은 변경: 경로 ${draftKeys(true).length}칸${sdraftKeys(true).length ? ` · 지원 여부 ${sdraftKeys(true).length}대` : ""}` : "") + (S.preview ? " (미리보기 — 확정 불가)" : "") : "변경 사항 없음";
  tb.querySelector("[data-revert]").disabled = !td; tb.querySelector("[data-save]").disabled = !td || S.preview;
  fb.classList.toggle("dirty", fd); bb.classList.toggle("dirty", bd); ab.classList.toggle("dirty", ad);
  ab.querySelector(".save-state").textContent = ad ? `확정하지 않은 변경: ${S.adraft.size}칸` + (S.preview ? " (미리보기 — 확정 불가)" : "") : "변경 사항 없음";
  ab.querySelector("[data-revert]").disabled = !ad; ab.querySelector("[data-save]").disabled = !ad || S.preview;
  fb.querySelector(".save-state").textContent = fd ? colsNote("equip", draftKeys(false).length || sdraftKeys(false).length || S.vdraft.size ? `확정하지 않은 변경: 경로 ${draftKeys(false).length}칸${sdraftKeys(false).length ? ` · 지원 여부·운전원 ${sdraftKeys(false).length}대` : ""}${S.vdraft.size ? ` · 장비 ${S.vdraft.size}대` : ""}` : "") + (S.preview ? " (미리보기 — 확정 불가)" : "") : "변경 사항 없음";
  bb.querySelector(".save-state").textContent = bd ? `저장하지 않은 변경: ${S.rdraft.size}개 지사` + (S.preview ? " (미리보기 — 저장 불가)" : "") : "변경 사항 없음";
  const bdn = $("brDirty"); if (bdn) { bdn.textContent = bd ? `저장하지 않은 지사 ${S.rdraft.size}곳` + (S.preview ? " (미리보기 — 저장 불가)" : "") : ""; bdn.hidden = !bd; }
  fb.querySelector("[data-revert]").disabled = !fd; fb.querySelector("[data-save]").disabled = !fd || S.preview;
  bb.querySelector("[data-revert]").disabled = !bd; bb.querySelector("[data-save]").disabled = !bd || S.preview;
}
addEventListener("beforeunload", e => { if (anyDirty()) { e.preventDefault(); e.returnValue = ""; } });
// 기준일자는 첫 화면 위쪽 메뉴에 늘 보임(2026-11-03 사용자 요청, boot.js SSEqRound). 첫 화면 안에서는 탭마다 있던 기준일자 줄을 숨김(.embedded .round-bar), 이 화면만 따로 열면 그 줄이 위에 붙음
function syncRoundTop() {
  document.documentElement.style.setProperty("--topbar-h", (document.querySelector(".topbar") || {}).offsetHeight + "px");
  let t = null; try { t = window.top !== window && window.top.SSEqRound; } catch (e) {} if (!t) return;
  const min = nextRoundMin();
  t({ rounds: S.rounds.map(x => ({ id: x.id, label: `${fmtMD(x.start_date)} ${x.start_date.slice(0, 4)}` })), round: S.round, canEdit: can("req.confirm"), min, def: min > todayISO() ? min : todayISO() });
}
window.SSEqRoundAct = (act, v) => act === "select" ? switchRound(v) : act === "del" ? deleteRound() : makeRound(v);
function refresh() {
  hideTip();
  renderMatrix(); renderFilters(); renderDest(); renderFleet(); renderBranch(); renderAlloc(); renderTeam(); renderLog(); updateSavebars();
  $("logTabBtn").hidden = !can("log.view"); $("teamTabBtn").hidden = !canTeam();
  try { if (window.top !== window && window.top.SSEqTeamTab) window.top.SSEqTeamTab(canTeam()); } catch (e) {}       // 첫 화면 위쪽 메뉴의 '강원본부 지원장비'도 같이
  syncRoundTop();
  if ((!can("log.view") && !$("panel-log").hidden) || (!canTeam() && !$("panel-gwteam").hidden)) document.querySelector('[data-tab="move"]').click();
}
function refreshKeepFocus() {   // 값을 고친 뒤 화면을 다시 그리되, 커서 위치는 유지
  const a = document.activeElement, fk = a && a.dataset && a.dataset.fk;
  refresh();
  if (fk) { const n = [...document.querySelectorAll("[data-fk]")].find(i => i.dataset.fk === fk); if (n) n.focus(); }
}

/* ============================================================
   [10] 입력 처리 — 한 곳에서
   ============================================================ */
// 표 가독성(2026-10-30): 0·빈칸을 흐리게 하는 CSS 가 value 속성을 보므로, 입력하는 동안에도 속성을 맞춰 둠
document.addEventListener("input", e => { const t = e.target; if (t.matches && t.matches("input.num, input[type=date]")) t.setAttribute("value", t.value); });
document.addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "userSel") return switchUser(t.value);
  if (t.dataset.round !== undefined) return switchRound(t.value);
  if (t.id === "showTeam") {                // 이동 현황: 강원 신속대응팀 보기(열·합계·카드 함께). 이 브라우저에 기억
    S.showTeam = t.checked; try { localStorage.setItem(TEAM_KEY, S.showTeam ? "1" : "0"); } catch (e2) {}
    if (!S.showTeam && S.org === TEAM) S.org = "전체";
    renderMatrix(); renderFilters(); return renderDest();
  }
  if (t.id === "day1In" || t.id === "day1InTeam") {          // 지원일 1: 기준일자 기간 안. 94: 확정 전 변경 → [확정]으로 저장(기관별 장비 = 관리자, 강원본부 지원장비 = 관리자·강원본부, 따로)
    const kind = t.id === "day1In" ? "equip" : "team", r = curRound();
    if (!r || !t.value || !(kind === "equip" ? canRoute() : canTeam())) return refresh();
    if (t.value < r.start_date) { toast(`지원일은 기준일자(${fmtMD(r.start_date)})부터 고를 수 있습니다`, true); return refresh(); }
    if (t.value > roundEnd(r)) { toast(`지원일 1은 기준일자 기간(${fmtMD(r.start_date)} ~ ${fmtMD(roundEnd(r))}) 안에서 고를 수 있습니다`, true); return refresh(); }
    setDay1Draft(kind, t.value); S.extraStop.clear(); await ensureRoutes(); return refresh();
  }
  if (t.id === "colsSelTeam") { if (!canTeam() || !curRound()) return refresh(); setColsDraft("team", t.value); await ensureRoutes(); return refresh(); }      // 94: 확정 전 변경(강원본부 지원장비 = 관리자·강원본부)
  if (t.id === "colsSel") { if (!canRoute() || !curRound()) return refresh(); setColsDraft("equip", t.value); await ensureRoutes(); return refresh(); }      // 94: 확정 전 변경(기관별 장비 = 관리자만)
  if (t.id === "logUser") { S.logUser = t.value; return renderLog(); }
  if (t.id === "zbr") { S.zask = null; return renderZones(); }
  if (t.dataset.rv) {                       // 경로 칸(관리자): 그 (날짜, 장비)의 지사 목록을 다시 모음
    const vid = t.dataset.rv, d = t.dataset.rd, v = vehById(vid); if (!v || !(isTeam(v) ? canTeam() : canRoute())) return refresh();
    const rc = readCell(vid, d);
    if (rc.stops.some((s, i) => i > 0 && s === rc.stops[i - 1])) toast("바로 앞과 같은 지사는 한 번만 들어갑니다(다른 지사를 들렀다 다시 오는 것은 됩니다)", true);
    S.extraStop.delete(rk(d, vid)); setRoute(d, vid, rc); return patchCell(vid, d);
  }
  if (t.dataset.ra) {                       // 기계화부: 그 지원일의 피지원 지사(배정받은 지사 중 한 곳, 2026-11-02 모든 지원일). 다른 칸의 남은 대수 표시도 바뀌므로 표를 다시 그림
    const vid = t.dataset.ra, d = t.dataset.rd, v = vehById(vid), cr = curRound(), g = govRound(d); if (!v || isPool(v) || !routeOwn(v) || !cr || !g || g.id !== cr.id) return refresh();
    const rec = recOf(d, vid), val = t.value === "__del" ? "" : t.value;
    setRoute(d, vid, val ? { stops: [val], times: [rec.stops[0] === val ? rec.times[0] || null : null], revised: false } : EMPTY);
    keepFocus(() => renderFleet()); return afterAnyChange();
  }
  if (t.dataset.al) {                       // 기관별 배치(관리자): 칸 하나 = (기관, 지사)의 제설차 또는 제설기 대수
    const [org, bid] = t.dataset.al.split("|"), f = t.dataset.f, b = S.brById[bid]; if (!b || !canRoute() || !isFixed(bid) || !["truck", "blower"].includes(f)) return refresh();
    let want = t.value === "" ? 0 : Math.max(0, Math.min(99, Math.floor(+t.value) || 0));
    const old = aval(org, bid)[f] || 0, room = asg(bid, f) - allocSum(bid, f, org);          // 편성 - 다른 기관 배정 = 이 칸에 넣을 수 있는 최대
    if (want > old && want > room) { want = Math.max(old, room); toast(`${b.name} 편성(${f === "truck" ? "제설차" : "제설기"} ${asg(bid, f)}대)보다 많이 배정할 수 없습니다`, true); }
    const nv = { ...aval(org, bid), [f]: want }, base = S.alloc.get(ak(org, bid)) || A0;
    if (nv.truck === base.truck && nv.blower === base.blower) S.adraft.delete(ak(org, bid)); else S.adraft.set(ak(org, bid), nv);
    keepFocus(() => renderAlloc()); return updateSavebars();
  }
  if (t.dataset.rt) {                       // 도착 예상 시각(관리자, 또는 지원장비 = 자기 기관 장비의 정해진 경로)
    const vid = t.dataset.rt, d = t.dataset.rd, v = vehById(vid); if (!v || !(isTeam(v) ? canTeam() : canRoute() || routeOwn(v))) return refresh();
    const nt = normTime(t.value);
    if (nt === undefined) { toast("시각은 0730 또는 07:30 처럼 넣으세요 (00:00~23:59)", true); return patchCell(vid, d); }
    t.value = nt || ""; const rc = readCell(vid, d, true), bad = nt ? timeOrderBad(d, vid, rc) : null;
    if (bad) {                              // 앞 지사보다 늦어야 함(2026-11-04): 방금 넣은 칸을 비우고 안내
      const td = t.closest("td"), rows = td ? [...td.querySelectorAll(".slot-x")].filter(r => { const s = r.querySelector("select[data-rv]"); return !s || (s.value && s.value !== "__del" && s.value !== "__off"); }) : [];
      const me = rows.findIndex(r => r.contains(t)); toast(timeOrderMsg(rc, bad), true);
      if (me >= 0 && me < rc.times.length) rc.times[me] = null; t.value = "";
    }
    setRoute(d, vid, rc); return patchCell(vid, d);
  }
  if (t.id === "modeInit" || t.id === "modeRev") {     // [최초 지원]/[수정본]: 둘 중 하나, 표 전체에 한 번에 적용
    S.revisedMode = t.id === "modeRev" ? t.checked : !t.checked; return renderFleet();
  }
  if(t.dataset.crewcode && crewPick) { const code=t.dataset.crewcode; crewPick.crew=t.checked?crewPick.crew.concat(code):crewPick.crew.filter(c=>c!==code); renderCrewPicker(); const item=sheet.querySelector(`[data-crewcode="${CSS.escape(code)}"]`);if(item)item.focus();return; }
  if (t.dataset.vs) {                       // 지원 여부(고른 기준일자): 지원이 아니면 그 기준일자가 맡은 날의 경로는 숨겨짐(지우지 않음 — 다시 지원으로 하면 보임)
    const v = vehById(t.dataset.vs); if (!v || !canVeh(v) || !S.round) return refresh();
    setStat(v.id, { status: t.value }); return patchVehicle(v.id);
  }
  if (t.dataset.vb) {                       // 블로워 소·대: 제설기만, 둘 다 꺼도 됨
    const v = vehById(t.dataset.vb); if (!v || !canVeh(v) || v.type !== "제설기") return refresh();
    setVeh(v.id, t.dataset.bf, t.checked); return patchVehicle(v.id);
  }
  if (t.id === "nvOrg" || t.id === "nvRent") {      // 장비 추가 줄: 기관(또는 지역본부 지사)·임차를 바꾸면 줄 모양이 바뀜(넣던 숫자는 그대로)
    if (t.id === "nvOrg") S.nvSel = t.value; else S.nvRent = t.checked;
    const n = ($("nvPlate") || {}).value || ""; renderFleet(); if ($("nvPlate")) $("nvPlate").value = n; const f = $(t.id); if (f) f.focus(); return;
  }
  if (t.dataset.vr) {                       // 지역본부 장비의 임차 체크: 이름(저장 값)도 함께 바뀜(인천252 ↔ 인천임차252)
    const v = vehById(t.dataset.vr); if (!v || !isPool(v) || !canVeh(v)) return refresh();
    const val = poolPlateFree(v.home_branch, t.checked, poolNum(v), v.id); if (!val) return refresh();
    setVeh(v.id, "rented", t.checked); setVeh(v.id, "plate", val); return patchVehicle(v.id);
  }
  if (t.dataset.vp) {                       // 도공번호: 숫자만 받아 기관 이름을 붙임(예: 901 → 서울경기901), 중복 검사. 지역본부 장비는 지사 이름 + [임차] + 숫자
    const v = vehById(t.dataset.vp), num = t.value.replace(/\s/g, ""); if (!v || !canVeh(v)) return refresh();
    if (!NUM_RE.test(num)) { toast(isPool(v) ? "번호는 숫자만 넣으세요 (예: 252)" : "도공번호는 숫자만 넣으세요 (예: 901 → " + v.org + "901호)", true); return refresh(); }
    const val = isPool(v) ? poolPlateFree(v.home_branch, vval(v, "rented"), num, v.id) : v.org + num; if (!val) return refresh();
    if (!isPool(v) && S.vehicles.some(x => !isPool(x) && x.id !== v.id && vval(x, "plate") === val)) { toast("같은 도공번호가 이미 있습니다", true); return refresh(); }
    setVeh(v.id, "plate", val); const tr = t.closest("tr"); if (tr) tr.classList.toggle("changed", S.vdraft.has(v.id)); return afterAnyChange();
  }
  if (t.dataset.arr) {                      // 도착 요청: 날짜 + 시(00~23) + 분(10분 단위)
    const b = S.brById[t.dataset.arr]; if (!b || !canEdit(b)) return refresh();
    const get = p => (document.querySelector(`[data-arr="${b.id}"][data-part="${p}"]`) || {}).value || "";
    const d = get("d"); setReq(b.id, "arrive_at", d ? `${d}T${get("h") || "00"}:${get("m") || "00"}` : null); return afterReq(b.id);
  }
  if (t.dataset.wxt) {                      // 직접입력 특보 발표·발효: 시·분 → 기준일자의 그 시각
    const b = S.brById[t.dataset.wxt], f = t.dataset.f; if (!b || !canEdit(b)) return refresh();
    const get = part => (document.querySelector(`[data-wxt="${b.id}"][data-f="${f}"][data-part="${part}"]`) || {}).value || "";
    const hh = get("h"), day = (curRound() || {}).start_date || todayISO();
    setReq(b.id, f, hh ? new Date(`${day}T${hh}:${get("m") || "00"}`).toISOString() : null);
    const m = document.querySelector(`[data-wxt="${b.id}"][data-f="${f}"][data-part="m"]`); if (m) m.disabled = !hh;
    return afterReq(b.id);
  }
  if (t.dataset.rq) {
    const b = S.brById[t.dataset.rq], f = t.dataset.f; if (!b || !canEdit(b) || (["assigned_truck", "assigned_blower", "confirmed"].includes(f) && !can("req.confirm"))) return refresh();
    let v;
    if (f === "wx_manual") { setReq(b.id, f, t.checked); afterReq(b.id); return renderBranch(); }   // 켜고 끄면 그 줄 칸 모양이 바뀜
    if (f === "wx_level") { setReq(b.id, f, t.value || null); return afterReq(b.id); }
    if (f === "wx_tmin") { setReq(b.id, f, t.value === "" ? null : Math.max(-60, Math.min(50, Math.round(+t.value * 10) / 10 || 0))); return afterReq(b.id); }
    if (f === "confirmed") v = t.checked;
    else if (f === "wx_snow" || f === "wx_pcp") v = t.value === "" ? null : Math.max(0, Math.min(999, Math.round(+t.value * 10) / 10 || 0));
    else if (f === "reason") v = t.value.trim() || null;
    else v = t.value === "" ? 0 : Math.max(0, Math.min(f === "offer_truck" ? 99 : 999, Math.floor(+t.value) || 0));
    setReq(b.id, f, v); return afterReq(b.id);
  }
});
document.addEventListener("click", e => {
  const c = sel => e.target.closest && e.target.closest(sel);
  let x;
  if ((x = c(".mnum"))) return jumpToDetail(x.dataset);
  if ((x = c("[data-stop-add]"))) { S.extraStop.add(x.dataset.stopAdd); const [d, vid] = x.dataset.stopAdd.split("|"); patchCell(vid, d); const n = [...document.querySelectorAll("[data-fk]")].find(i => i.dataset.fk.startsWith(`rn:${d}:${vid}:`)); if (n) n.focus(); return; }
  if (c("[data-reload]")) return reloadAll();
  if ((x = c("[data-save]"))) return x.dataset.save === "fleet" ? confirmFleet() : x.dataset.save === "gwteam" ? confirmTeam() : x.dataset.save === "alloc" ? saveAlloc() : saveBranch();
  if ((x = c("[data-revert]"))) { if (!confirm("확정·저장하지 않은 변경을 모두 취소할까요?")) return; if (x.dataset.revert === "fleet") clearDrafts(false); else if (x.dataset.revert === "gwteam") clearDrafts(true); else if (x.dataset.revert === "alloc") S.adraft.clear(); else S.rdraft.clear(); return refresh(); }
  if((x=c("[data-crew]")))return openCrew(x.dataset.crew);
  if((x=c("[data-crewtab]"))&&crewPick){crewPick.tab=x.dataset.crewtab;renderCrewPicker();return;}
  if(c("[data-crewclear]")&&crewPick){crewPick.crew=[];return renderCrewPicker();}
  if(c("[data-crewapply]")&&crewPick){const p=crewPick;if(!SSCrew.valid(p.crew))return;setStat(p.id,{crew:p.crew});closeSheet();return refresh();}
  if(c("#fleetDownload"))return downloadFleet();
  if (c("#fleetReset")) return resetFleet();
  if (c("#vehAdd")) return addVehicle();
  if ((x = c("[data-vdel]"))) return deleteVehicle(x.dataset.vdel);
  if ((x = c("[data-vhide]"))) return hideVehicle(x.dataset.vhide, false);
  if ((x = c("[data-unhide]"))) return hideVehicle(x.dataset.unhide, true);
  if (c("#unhideBtn")) { S.unhideOpen = !S.unhideOpen; return renderFleet(); }
  if (c("#roundMake")) return makeRound();
  if (c("#confirmAll")) return confirmAll();
  if ((x = c("[data-rsave-hq]"))) return saveHq(x.dataset.rsaveHq);                  // 본부 줄의 [일괄 저장](줄 접기보다 먼저)
  if ((x = c("[data-confirm-hq]"))) return confirmAll(x.dataset.confirmHq);          // 본부 줄의 [일괄 확정](줄 접기보다 먼저)
  if (c("#unconfirmAll")) return unconfirmAll();
  if ((x = c("[data-unconfirm-hq]"))) return unconfirmAll(x.dataset.unconfirmHq);    // 본부 줄의 [일괄 취소]
  if ((x = c("[data-confirm]"))) return confirmBranch(x.dataset.confirm, true);
  if ((x = c("[data-unconfirm]"))) return confirmBranch(x.dataset.unconfirm, false);
  if (c("[data-fsopen]")) { const b = c("[data-fsopen]"); S.fleetAssignOpen = b.getAttribute("aria-expanded") !== "true"; renderOrgGrid(); return; }
  if (c("#roundDel")) return deleteRound();
  if (c("#zoneMgr")) return openZones();
  if ((x = c("[data-zset]"))) return setZone(x.dataset.zset, x.dataset.zinc === "" ? null : x.dataset.zinc === "1");
  if ((x = c("[data-zask]"))) { S.zask = { code: x.dataset.zask, action: x.dataset.zact }; return renderZones(); }
  if (c("#zaddAsk")) { const v = ($("zadd") || {}).value; if (!v) return toast("요청할 구역을 고르세요", true); S.zask = { code: v, action: "add", free: true }; return renderZones(); }
  if (c("#zaskCancel")) { S.zask = null; return renderZones(); }
  if (c("#zaskSend")) return sendZoneReq();
  if ((x = c("[data-zcancel]"))) return (async () => { const r = await Api.zoneReqCancel(+x.dataset.zcancel); if (!r.ok) return toast(r.message, true); reloadZones("요청을 취소했습니다"); })();
  if ((x = c("[data-zok]")) || (x = c("[data-zno]"))) return resolveZoneReq(+(x.dataset.zok || x.dataset.zno), !!x.dataset.zok);
  if ((x = c("[data-fb]"))) return openForecast(x.dataset.fb);
  if ((x = c("[data-wtab]"))) { S.wtab = x.dataset.wtab; return renderWarnNow(); }
  if (c("#zaddBtn")) { const v = ($("zadd") || {}).value; return v ? setZone(v, true) : toast("더할 구역을 고르세요", true); }
  { const bv = c("[data-bv]"); if (bv) { const k = bv.dataset.bv, was = S.bviews.has(k); S.bviews.clear(); if (!was) S.bviews.add(k); return renderBranch(); } }   // 보기: 한 번에 하나만, 다시 누르면 끔(끄면 모든 지사, 2026-11-03 사용자 요청)
  if ((x = c("[data-rsave]"))) { const b = S.brById[x.dataset.rsave]; return b && canRowSave(b) ? saveBranchRows([b.id], null, `${b.name} 지사를 저장했습니다`) : null; }
  // 기관 버튼·[지원 장비만]: 한 번에 하나만, 다시 누르면 끔(끄면 모든 장비, 2026-11-03 사용자 요청)
  if (c("#onlyGo")) { S.fleetGo = !S.fleetGo; S.fleetOrgs.clear(); return renderFleet(); }
  if ((x = c("[data-fo]"))) { const o = x.dataset.fo, was = S.fleetOrgs.has(o); S.fleetOrgs.clear(); S.fleetGo = false; if (!was) S.fleetOrgs.add(o); return renderFleet(); }
  if ((x = c("[data-org]"))) { S.org = x.dataset.org; renderFilters(); return renderDest(); }
  if ((x = c("[data-type]")) && x.classList.contains("chip")) { S.type = x.dataset.type; renderFilters(); return renderDest(); }
  if ((x = c("[data-lk]"))) { S.logKind = x.dataset.lk; return renderLog(); }
  if (c("#logToday")) { S.logToday = !S.logToday; return renderLog(); }
  if ((x = c(".vrow"))) return openSheet(x.dataset.vid);
  if ((x = c("tr.hq"))) { const id = x.dataset.hq; S.closedHq.has(id) ? S.closedHq.delete(id) : S.closedHq.add(id); return renderBranch(); }
});
document.addEventListener("keydown", e => { const tr = e.target.closest && e.target.closest("tr.hq"); if (tr && e.target === tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); tr.click(); } });

/* ---------- 탭·날짜·화면 모드·아이디 ---------- */
document.querySelectorAll(".tab").forEach(t => t.onclick = e => {
  if (e && e.isTrusted && window.top === window && !(history.state && history.state.eqTab === t.dataset.tab)) { try { history.pushState({ eqTab: t.dataset.tab }, ""); } catch (er) {} }   // 장비 화면만 따로 열었을 때: 뒤로가기 = 이전 탭(2026-11-02)
  document.querySelectorAll(".tab").forEach(x => x.setAttribute("aria-selected", x === t));
  document.querySelectorAll(".panel").forEach(p => p.hidden = p.id !== "panel-" + t.dataset.tab);
  try { if (window.top !== window && window.top.SSEqTabChanged) window.top.SSEqTabChanged(t.dataset.tab); } catch (e) {}   // 첫 화면 왼쪽 메뉴도 같은 탭 표시
  hideTip(); if (t.dataset.tab === "move") { fitFilters(); stickHead($("matrix")); } if (t.dataset.tab === "branch") { stickHead($("branchTable")); fitBranch(); } if (t.dataset.tab === "alloc") stickHead($("allocTable"));
});
const dateInput = $("dateInput"); dateInput.value = S.date;
async function setDate(v) { if (!v) return; S.date = v; dateInput.value = v; await ensureRoutes(); renderMatrix(); renderDest(); }   // 이동 현황은 고른 날짜 기준
dateInput.onchange = () => setDate(dateInput.value);
dateInput.addEventListener("click", () => { try { dateInput.showPicker(); } catch (e) {} });   // 제목의 큰 날짜를 누르면 달력이 바로 열림
$("prevDay").onclick = () => setDate(addDays(S.date, -1));
$("nextDay").onclick = () => setDate(addDays(S.date, 1));
// 기준 시각: 20초마다 확인해 글자를 새로 쓰고, 이동 시각이 지나 장비 위치가 바뀌면(또는 날이 바뀌면) 표·카드를 다시 그림
let mvSig = "";
setInterval(() => { if (!S.date || !$("refTime")) return; const sig = S.date + "|" + todayISO() + "|" + movesOn(S.date).map(m => m.p).join(",");
  if (sig !== mvSig) { const first = !mvSig; mvSig = sig; if (!first) { renderMatrix(); renderDest(); return; } } $("refTime").textContent = refTimeText(); }, 20000);
// 화면 모드: [라이트 모드] [다크 모드] 두 칸 버튼. 고른 모드는 이 브라우저에 기억
const THEME_KEY = "eq_theme", TEAM_KEY = "eq_show_team";
try { S.showTeam = localStorage.getItem(TEAM_KEY) !== "0"; } catch (e) {}           // 기본은 보임
function curTheme() { return document.documentElement.dataset.theme === "dark" ? "dark" : "light"; }      // 기본 라이트(2026-11-01), 고른 사람만 다크
function paintThemeBtns() { document.querySelectorAll("[data-theme-set]").forEach(b => b.setAttribute("aria-pressed", b.dataset.themeSet === curTheme())); }
function setTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem(THEME_KEY, t); } catch (e) {} paintThemeBtns(); }
try { const t = localStorage.getItem(THEME_KEY); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch (e) {}
document.querySelectorAll("[data-theme-set]").forEach(b => b.onclick = () => setTheme(b.dataset.themeSet));
paintThemeBtns();
function buildUserSel() {
  const box = $("userSel").closest(".user-box"); if (box) box.hidden = !!S.real;     // 로그인한 실제 화면에서는 없음(?sample=1 시연·자동 시험에서만)
  if (S.real) return;
  const groups = [...new Set(DEMO.map(d => d.g))];
  $("userSel").innerHTML = (S.real ? `<option value="__me">내 아이디 · ${esc(S.real.label)}</option>` : "") +
    groups.map(g => `<optgroup label="${S.real ? "미리보기(저장 안 됨) · " : ""}${esc(g)}">${DEMO.filter(d => d.g === g).map(d => `<option value="${d.id}">${esc(d.label)}</option>`).join("")}</optgroup>`).join("");
  $("userSel").value = S.uid;
}
async function switchUser(uid) {
  if (anyDirty() && !confirm("확정·저장하지 않은 변경이 있습니다. 버리고 아이디를 바꿀까요?")) { $("userSel").value = S.uid; return; }
  S.draft.clear(); S.vdraft.clear(); S.sdraft.clear(); S.rdraft.clear(); S.adraft.clear(); S.extraStop.clear(); S.colsDraft.clear(); S.day1Draft.clear();
  S.uid = uid; S.me = uid === "__me" ? S.real : identityOf(DEMO.find(d => d.id === uid));
  S.preview = !!S.real && uid !== "__me";
  Api.setActor(S.me); if (!sheet.hidden) closeSheet();
  await loadAudit(); refresh();
}

// 특보는 서버가 매시 01·11·21…분에 받으므로 화면은 그 1분 뒤(02·12·22…분)에, 보이는 동안만 다시 읽어 특보 칸만 고침.
// 서버 수집이 쉬는 중(확정을 기다리는 기준일자 없음)이면 읽지 않음 → 기준일자를 바꾸거나 새로 열 때 다시 읽음
let warnAt = 0;
async function tickWarn(force) {
  if (!S.me || (!force && (document.hidden || (S.warn && S.warn.paused)))) return;
  warnAt = Date.now(); await loadWarn(); paintWarn(); if (!$("panel-move").hidden) renderDest();
}
(function schedWarn() { const now = new Date(), m = (12 - now.getMinutes() % 10) % 10 || 10; setTimeout(() => { tickWarn(); schedWarn(); }, (m * 60 - now.getSeconds()) * 1000); })();
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - warnAt > 10 * 60e3) tickWarn(); });

boot();
