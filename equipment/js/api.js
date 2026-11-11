/* ============================================================
   api.js — 서버와 주고받는 곳 (화면 코드 app.js 는 이 함수들만 부릅니다)
   - 기본: Supabase 서버. 로그인 정보는 auth/auth.js(SSAuth)가 보관·갱신합니다.
   - 주소에 ?sample=1 이 있으면: 서버 대신 sample-data.js 의 샘플로 움직입니다(시연·자동 시험용, 저장은 이 화면 안에만).
   - 권한 검사는 서버(DB 규칙)가 다시 합니다. 화면의 검사는 보기 좋게 정리하는 용도입니다.
   - 저장은 "바뀐 칸만" 보내고, 한 번의 [확정]/[저장]은 서버 함수 하나로 "전부 되거나 전부 안 되게" 처리합니다.
     · 기관별 장비 [확정] → save_fleet(장비 도공번호·지원 여부, (날짜, 장비)별 경로 — 경로는 관리자)
     · 지사별 요청·편성 [저장] → save_requests(기준일자, 지사별 바뀐 열)
     · 강원본부 지원장비 [확정] → save_gw_team(기준일자, 경로, 지원 여부) — 강원 신속대응팀 4대, 기관별 장비와 따로(마이그레이션 48).
       화면에서는 팀 장비도 장비처럼 다루려고 경로·지원 여부를 기관별 장비 것과 같은 모양으로 합쳐 돌려줌(team_id → vehicle_id, 번호 GW1~GW4)
     · 대설 특보 → warning_status(서버가 5분마다 기상청에서 받은 것) / 특보구역 관리(관리자) → branch_zone_list + branch_zone_overrides
     · 장비 추가(addVehicle): 장비 번호(id)는 보내지 않고 서버가 매김(여러 계정이 동시에 넣어도 겹치지 않게). 지역본부 장비(org = '지역본부')는 지원 여부 '지원'도 서버가 함께 만듦(마이그레이션 44)
   - 모든 함수는 Promise 를 돌려줍니다. 실패하면 { ok:false, message } 입니다.
   ============================================================ */
const Api = (() => {
  const SAMPLE = new URLSearchParams(location.search).has("sample");
  const ERR = { "42501": "권한이 없습니다(다른 기관·지사 자료이거나 권한이 바뀌었습니다).", "23505": "이미 있는 값입니다(도공번호·기준일자 중복).",
    "23514": "값의 형식이 올바르지 않습니다.", "23503": "없는 지사·장비·기준일자입니다.", "22023": "저장할 내용이 없습니다.", "54000": "한 번에 너무 많이 저장하려고 합니다.",
    "55000": "확정한 지사는 확정을 취소한 뒤에 고칠 수 있습니다.",
    // 기계화부(지원장비 계정)가 지원일 1의 지사를 고를 때(마이그레이션 43)
    "SA001": "관리자가 이 기관에 배정하지 않은 지사입니다. 기관별 배치을 확인해 주세요.", "SA002": "배정받은 대수보다 많은 장비를 같은 지사로 보낼 수 없습니다.",
    "SA003": "지원일마다 피지원 지사 한 곳만 고를 수 있습니다(하루 여러 곳·수정본·관리자가 정한 경로는 관리자가 고칩니다).",
    // 지역본부 장비(마이그레이션 44)
    "SA004": "이 지사의 '타지사 지원 가능' 대수가 확정된 뒤에 장비를 등록할 수 있습니다.", "SA005": "지역본부 장비는 자기(출발) 지사로 보낼 수 없습니다.",
    "SA006": "기관별 배치 합계는 그 지사의 편성 대수(제설차·제설기 각각)보다 많을 수 없습니다.",
    "SA007": "값이 방금 바뀌어 이번 확정은 취소했습니다. 새 값을 확인한 뒤 필요하면 다시 눌러 주세요.",
    "SA008": "아래 칸(다음 지사)의 도착 예상 시각은 앞 지사보다 늦어야 합니다. 시각을 고친 뒤 다시 확정하세요." };
  const TEAM_ERR = { "42501": "강원본부 지원장비는 관리자와 강원본부 계정만 고칠 수 있습니다.", "23514": "다른 기준일자가 맡은 날짜이거나, 그날 지원 가능이 아닌 장비의 경로입니다. 새로고침(F5) 후 다시 확인해 주세요.", "22023": "저장할 내용이 없거나 기준일자가 없습니다." };
  const isTeamId = id => /^GW\d+$/.test(String(id || ""));
  const POOL = "지역본부", VCOLS = "id,org,type,plate,status,sort,active,blower_s,blower_l,hidden_after,round_id,home_branch,rented";
  // over = 이 요청에서만 쓰는 오류 설명(예: { "23503": "…" }) — 같은 오류 번호라도 상황마다 뜻이 달라서
  const fail = (r, fallback, over) => { const c = r && r.json && r.json.code; return { ok: false, message: (over && over[c]) || ERR[c] || fallback || "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", code: c }; };
  // 저장 함수(save_fleet)의 23514 = 다른 기준일자가 맡은 날짜이거나, 그날 지원 가능이 아닌 장비의 경로(마이그레이션 38)
  const FLEET_ERR = { "23514": "다른 기준일자가 맡은 날짜이거나, 그날 지원 가능이 아닌 장비의 경로입니다. 새로고침(F5) 후 다시 확인해 주세요.", "22023": "저장할 내용이 없거나 기준일자가 없습니다." };
  const ROUND_ERR = { "23514": "새 기준일자는 마지막 기준일자보다 뒤 날짜여야 하고, 기준일자는 마지막 것이면서 그 기간에 경로가 없을 때만 지울 수 있습니다." };
  const ALLOC_ERR = { "23514": "편성이 확정된 지사에만 배정할 수 있습니다.", "23503": "없는 기관·지사·기준일자입니다." };
  const VDEL_ERR = { "23503": "경로 기록이 있는 장비는 지울 수 없습니다. [숨기기]를 쓰세요." };
  const NET = () => ({ ok: false, message: (window.SSAuth && SSAuth.NET_MSG) || "서버에 연결할 수 없습니다." });
  const zfail = (r, fallback) => { const m = r && r.json && r.json.message; return m && /[가-힣]/.test(m) ? { ok: false, message: m } : fail(r, fallback); };      // 서버가 한국어로 알려 준 까닭(중복 요청 등)
  const EQUIP_TABS = "vehicles,vehicle_routes,round_vehicle_status,round_requests,round_allocations,support_rounds,branch_zone_overrides,gw_team_routes,gw_team_status";
  const asVeh = x => ({ ...x, vehicle_id: x.team_id });          // 팀 경로·지원 여부를 장비 것과 같은 모양으로

  /* ---------- 서버(Supabase) ---------- */
  // 서버는 한 번에 1,000줄까지만 돌려주고 그 이상은 말없이 자름 → 줄 수가 늘 수 있는 표(장비·경로·지원 여부)는 1,000줄씩 나눠 끝까지 읽음.
  // 나눠 읽는 동안 순서가 흔들리지 않게 order 는 겹치지 않는 열까지 적을 것. path 에는 '?' 가 이미 들어 있어야 함
  const PAGE = 1000;
  const restAll = (path, off = 0, acc = []) => SSAuth.rest(`${path}&limit=${PAGE}&offset=${off}`).then(r => {
    if (!r.ok) return r;
    const rows = r.json || []; acc = acc.concat(rows);
    return rows.length === PAGE ? restAll(path, off + PAGE, acc) : { ...r, json: acc };
  });
  const server = {
    load() {
      const R = SSAuth.rest;
      return Promise.all([SSAuth.restore(), R("hqs?select=id,name,sort,is_private&order=sort"), R("branches?select=id,name,hq_id,status&order=id"),
        restAll("vehicles?select=" + VCOLS + "&order=sort,id"), R("support_rounds?select=id,name,start_date,days,cols_equip,cols_team,day1_equip,day1_team&order=start_date.desc"), R("equip_orgs?select=name"), R("gw_team?select=id,name,sort&order=sort")])
        .then(([me, h, b, v, s, o, t]) => {
          if (!me.ok) return { ok: false, message: me.message || "로그인이 필요합니다.", login: true };
          if (![h, b, v, s].every(r => r.ok)) return { ok: false, message: "자료를 불러오지 못했습니다." };
          return { ok: true, me: me.me, hqs: h.json, branches: b.json.filter(x => x.status !== "closed"), vehicles: v.json, rounds: s.json, orgs: (o.json || []).map(x => x.name), team: t.ok ? t.json || [] : [], holdings: null };
        }).catch(NET);
    },
    reload() {         // [새로고침] 버튼: 다른 아이디가 바꿨을 수 있는 장비·기준일자 목록만 다시 읽음(본부·지사·로그인은 그대로). 나머지 표는 화면이 이어서 읽음
      const R = SSAuth.rest;
      return Promise.all([restAll("vehicles?select=" + VCOLS + "&order=sort,id"), R("support_rounds?select=id,name,start_date,days,cols_equip,cols_team,day1_equip,day1_team&order=start_date.desc")])
        .then(([v, s]) => v.ok && s.ok ? { ok: true, vehicles: v.json, rounds: s.json } : fail(v.ok ? s : v, "자료를 불러오지 못했습니다.")).catch(NET);
    },
    routes(from, to) {        // 장비 경로 + 강원 신속대응팀 경로(같은 모양)
      return Promise.all([restAll(`vehicle_routes?select=date,vehicle_id,stops,revised,times,confirmed_at&date=gte.${from}&date=lte.${to}&order=date,vehicle_id`),
        restAll(`gw_team_routes?select=date,team_id,stops,revised,times,confirmed_at&date=gte.${from}&date=lte.${to}&order=date,team_id`)])
        .then(([r, t]) => r.ok && t.ok ? { ok: true, rows: r.json.concat(t.json.map(asVeh)) } : fail(r.ok ? t : r, "경로를 불러오지 못했습니다.")).catch(NET);
    },
    statuses(ids) {      // 기준일자별 지원 여부(마이그레이션 38) + 강원 신속대응팀(48). 기준일자마다 따로, 1,000줄이 넘으면 나눠 읽음
      return Promise.all([...ids.map(id => restAll(`round_vehicle_status?select=round_id,vehicle_id,status,off_from,crew,updated_at&round_id=eq.${+id}&order=vehicle_id`)),
        restAll(`gw_team_status?select=round_id,team_id,status,off_from,updated_at&round_id=in.(${ids.map(Number).join(",")})&order=round_id,team_id`).then(r => r.ok ? { ...r, json: r.json.map(asVeh) } : r)])
        .then(rs => rs.every(r => r.ok) ? { ok: true, rows: rs.flatMap(r => r.json) } : fail(rs.find(r => !r.ok), "지원 여부를 불러오지 못했습니다.")).catch(NET);
    },
    vehicleHistory(vid) {
      const q = isTeamId(vid) ? `gw_team_routes?select=date,team_id,stops,revised,times&team_id=eq.${encodeURIComponent(vid)}&order=date.desc&limit=400`
        : `vehicle_routes?select=date,vehicle_id,stops,revised,times&vehicle_id=eq.${encodeURIComponent(vid)}&order=date.desc&limit=400`;
      return SSAuth.rest(q).then(r => r.ok ? { ok: true, rows: r.json } : fail(r)).catch(NET);
    },
    saveTeam(round, routes, status, cols, day1) {      // routes = [{date, team_id, stops, times}], status = [{team_id, status, off_from}], cols·day1 = 지원일 칸 수·지원일 1(바꿨을 때만, 94)
      return SSAuth.authed("/rest/v1/rpc/save_gw_team", { method: "POST", body: { p_round: round, p_routes: routes, p_status: status, ...(cols != null ? { p_cols: cols } : {}), ...(day1 != null ? { p_day1: day1 } : {}) } }).then(r => r.ok ? { ok: true, result: r.json } : fail(r, null, TEAM_ERR)).catch(NET);
    },
    requests(round) {
      return SSAuth.rest(`round_requests?select=round_id,branch_id,req_truck,req_blower,assigned_truck,assigned_blower,offer_truck,saved_at,saved_lv,updated_at,arrive_at,reason,confirmed,warn_level,warn_zones,warn_base,warn_at,warn_note,fc_snow,fc_pcp,fc_snow_hi,fc_pcp_hi,fc_pop,fc_tmin,fc_tmin_at,fc_tmfc,fc_at,wx_manual,wx_snow,wx_pcp,wx_tmin,wx_tmin_at,wx_level,wx_fc,wx_ef&round_id=eq.${+round}`)
        .then(r => r.ok ? { ok: true, rows: r.json } : fail(r, "요청을 불러오지 못했습니다.")).catch(NET);
    },
    allocations(round) {     // 기관별 배치(기준일자, 기관, 지사) → 제설차·제설기 대수
      return SSAuth.rest(`round_allocations?select=round_id,org,branch_id,truck,blower&round_id=eq.${+round}`).then(r => r.ok ? { ok: true, rows: r.json } : fail(r, "기관별 배치을 불러오지 못했습니다.")).catch(NET);
    },
    saveAllocations(round, rows) {
      return SSAuth.authed("/rest/v1/rpc/save_allocations", { method: "POST", body: { p_round: round, p_rows: rows } }).then(r => r.ok ? { ok: true, result: r.json } : fail(r, null, ALLOC_ERR)).catch(NET);
    },
    warnings() {
      return SSAuth.authed("/rest/v1/rpc/warning_status", { method: "POST", body: {} }).then(r => r.ok ? { ok: true, status: r.json } : fail(r, "특보를 불러오지 못했습니다.")).catch(NET);
    },
    forecast(stamp) {         // 지사별 예상 적설(59줄)
      // 2026-11-11: stamp = 앞서 받은 것의 마지막 수정 시각. 같으면 다시 받지 않음(마지막 수정 시각 한 칸만 확인, 약 0.1KB). 확인이 안 되면 예전처럼 전부 받음
      const full = () => SSAuth.rest("branch_forecast?select=branch_id,issued_at,max_snow_24h,max_pcp_24h,max_snow_hi,max_pcp_hi,max_pop_24h,min_tmp,min_tmp_at,worst_nx,worst_ny,detail,updated_at")
        .then(r => r.ok ? { ok: true, rows: r.json, stamp: (r.json || []).reduce((a, x) => x.updated_at && (!a || x.updated_at > a) ? x.updated_at : a, null) } : fail(r, "예상 적설을 불러오지 못했습니다.")).catch(NET);
      if (!stamp) return full();
      return SSAuth.rest("branch_forecast?select=updated_at&order=updated_at.desc.nullslast&limit=1")
        .then(r => r.ok && Array.isArray(r.json) && r.json[0] && r.json[0].updated_at === stamp ? { ok: true, same: true } : full()).catch(full);
    },
    zoneData() {
      return Promise.all([SSAuth.authed("/rest/v1/rpc/branch_zone_list", { method: "POST", body: {} }), SSAuth.rest("branch_zone_overrides?select=branch_id,zone_code,include"),
        SSAuth.rest("warning_zones?select=zone_code,name,sp,up_code&zone_code=like.L*&order=zone_code"), SSAuth.authed("/rest/v1/rpc/warning_active_list", { method: "POST", body: {} })])
        .then(([a, o, z, w]) => a.ok && o.ok && z.ok ? { ok: true, list: a.json || {}, overrides: o.json, zones: z.json, active: w.ok ? w.json : null } : fail(!a.ok ? a : !o.ok ? o : z, "특보구역을 불러오지 못했습니다.")).catch(NET);
    },
    // 특보구역 요청(마이그레이션 92): 관리자 아닌 아이디가 더하기·빼기를 요청, 관리자가 승인/반려. 서버 오류 글(한국어)을 그대로 보여 줌
    zoneReqs() {
      return SSAuth.authed("/rest/v1/rpc/zone_request_list", { method: "POST", body: {} }).then(r => r.ok ? { ok: true, rows: r.json || [] } : fail(r, "특보구역 요청을 불러오지 못했습니다.")).catch(NET);
    },
    zoneReq(branch, zone, action, reason) {
      return SSAuth.authed("/rest/v1/rpc/zone_request_create", { method: "POST", body: { p_branch: branch, p_zone: zone, p_action: action, p_reason: reason } }).then(r => r.ok ? { ok: true } : zfail(r, "요청을 보내지 못했습니다.")).catch(NET);
    },
    zoneReqCancel(id) {
      return SSAuth.authed("/rest/v1/rpc/zone_request_cancel", { method: "POST", body: { p_id: id } }).then(r => r.ok ? { ok: true } : zfail(r, "요청을 취소하지 못했습니다.")).catch(NET);
    },
    zoneReqResolve(id, approve) {
      return SSAuth.authed("/rest/v1/rpc/zone_request_resolve", { method: "POST", body: { p_id: id, p_approve: !!approve } }).then(r => r.ok ? { ok: true } : zfail(r, "요청을 처리하지 못했습니다.")).catch(NET);
    },
    setZone(branch, zone, include) {       // include null = 손댄 것을 지움(자동대로)
      const q = `branch_zone_overrides?branch_id=eq.${encodeURIComponent(branch)}&zone_code=eq.${encodeURIComponent(zone)}`;
      const p = include === null ? SSAuth.authed("/rest/v1/" + q, { method: "DELETE", headers: { Prefer: "return=representation" } })
        : SSAuth.authed("/rest/v1/branch_zone_overrides?on_conflict=branch_id,zone_code", { method: "POST", body: { branch_id: branch, zone_code: zone, include }, headers: { Prefer: "resolution=merge-duplicates,return=representation" } });
      return p.then(r => r.ok ? { ok: true } : fail(r, "특보구역을 바꾸지 못했습니다(관리자만).")).catch(NET);
    },
    audit() {         // 장비 지원 관련 수정 기록(최근 300건). log.view 권한이 없으면 서버가 0건을 돌려줌
      return SSAuth.rest(`audit_log?select=id,at,username,kind,tab,target,from_val,to_val,ip&tab=in.(${EQUIP_TABS})&order=id.desc&limit=300`)
        .then(r => ({ ok: r.ok, rows: r.ok ? r.json.slice().reverse() : [] })).catch(() => ({ ok: false, rows: [] }));
    },
    saveFleet(vehicles, routes, round, status, cols, day1) {      // cols·day1 = 지원일 칸 수·지원일 1(바꿨을 때만, 94 — 경로·지원 여부와 한 번에 저장)
      return SSAuth.authed("/rest/v1/rpc/save_fleet", { method: "POST", body: { p_vehicles: vehicles, p_routes: routes, p_round: round, p_status: status, ...(cols != null ? { p_cols: cols } : {}), ...(day1 != null ? { p_day1: day1 } : {}) } }).then(r => r.ok ? { ok: true, result: r.json } : fail(r, null, FLEET_ERR)).catch(NET);
    },
    saveRequests(round, rows) {
      return SSAuth.authed("/rest/v1/rpc/save_requests", { method: "POST", body: { p_round: round, p_rows: rows } }).then(r => r.ok ? { ok: true, result: r.json } : fail(r)).catch(NET);
    },
    createRound(date) {          // 서버 함수가 기준일자를 만들고 전체 장비 지원 여부 줄을 만듦 — 빈칸, 새 기간에 경로가 잡힌 '지원' 장비만 지원 유지(마이그레이션 63)
      return SSAuth.authed("/rest/v1/rpc/create_round", { method: "POST", body: { p_date: date } })
        .then(r => r.ok && r.json && r.json.id ? { ok: true, round: { id: r.json.id, name: r.json.name, start_date: r.json.start_date, days: r.json.days } } : fail(r, "기준일자를 만들지 못했습니다.", ROUND_ERR)).catch(NET);
    },
    deleteRound(id) {           // 그 기준일자의 지사 요청은 DB 가 함께 지움(외래키 cascade, 지운 줄은 수정 기록에 남음)
      return SSAuth.authed(`/rest/v1/support_rounds?id=eq.${+id}&select=id`, { method: "DELETE", headers: { Prefer: "return=representation" } })
        .then(r => r.ok && r.json && r.json.length ? { ok: true } : fail(r, "기준일자를 지우지 못했습니다(권한이 없을 수 있습니다).", ROUND_ERR)).catch(NET);
    },
    addVehicle(v) {
      return SSAuth.authed("/rest/v1/vehicles?select=" + VCOLS, { method: "POST", body: v, headers: { Prefer: "return=representation" } })
        .then(r => r.ok && r.json && r.json[0] ? { ok: true, vehicle: r.json[0] } : fail(r, "장비를 추가하지 못했습니다.")).catch(NET);
    },
    deleteVehicle(id) {
      return SSAuth.authed(`/rest/v1/vehicles?id=eq.${encodeURIComponent(id)}&select=id`, { method: "DELETE", headers: { Prefer: "return=representation" } })
        .then(r => r.ok && r.json && r.json.length ? { ok: true } : fail(r, "장비를 지우지 못했습니다(권한이 없을 수 있습니다).", VDEL_ERR)).catch(NET);
    },
    hideVehicle(id, after) {    // 숨기기(after = 이 날짜보다 늦게 시작하는 기준일자부터 안 보임) / 숨김 취소(after = null). 관리자만
      return SSAuth.authed(`/rest/v1/vehicles?id=eq.${encodeURIComponent(id)}&select=id,hidden_after`, { method: "PATCH", body: { hidden_after: after }, headers: { Prefer: "return=representation" } })
        .then(r => r.ok && r.json && r.json.length ? { ok: true } : fail(r, "숨기기를 바꾸지 못했습니다(관리자만).")).catch(NET);
    }
  };

  /* ---------- 샘플(브라우저 안에서만) — 서버와 같은 권한 규칙을 흉내 ---------- */
  const sample = (() => {
    let db = null, actor = null;
    const clone = x => JSON.parse(JSON.stringify(x));
    const can = p => !!actor && (actor.role === "admin" || (actor.perms || []).includes(p));
    // 지역본부 장비는 그 지사 계정(req.edit.own + 자기 지사)과 관리자
    const poolOwn = v => can("req.edit.own") && !!actor.branch_id && v.home_branch === actor.branch_id;
    const vehOk = vid => { const v = db.vehicles.find(x => x.id === vid); return v && (can("equip.edit.all") || (v.org === POOL ? poolOwn(v) : can("equip.edit.own") && v.org === actor.org)); };
    const bname = id => (db.branches.find(b => b.id === id) || {}).name || "";
    const poolNameOk = v => { const pfx = bname(v.home_branch) + (v.rented ? "임차" : ""); return !!bname(v.home_branch) && String(v.plate).startsWith(pfx) && /^\d{1,5}$/.test(String(v.plate).slice(pfx.length)); };
    const err = (c, msg) => ({ ok: false, message: msg || ERR[c], code: c });
    // 서버 흉내(마이그레이션 64): 시각이 있는 칸끼리 앞보다 늦어야 함. 첫 지사가 연속지원(전날 마지막 지사)이면 첫 칸은 뺌
    const prevISO = iso => { const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
    const simTimesOk = r => {
      const pd = prevISO(r.date), pr = r.team_id ? db.teamRoutes.find(x => x.team_id === r.team_id && x.date === pd) : db.routes.find(x => x.vehicle_id === r.vehicle_id && x.date === pd);
      const cont = !!pr && pr.stops.length > 0 && pr.stops[pr.stops.length - 1] === r.stops[0]; let last = null;
      return (r.times || []).every((x, i) => { if (!x || (i === 0 && cont)) return true; const ok = !last || x > last; last = x; return ok; });
    };
    const repeated = r => r.stops.some((s, i) => i > 0 && s === r.stops[i - 1]);
    // 강원 신속대응팀(마이그레이션 48): 관리자 또는 강원본부 계정만
    const teamOk = () => !!actor && (actor.role === "admin" || (actor.role === "hq" && (db.hqs.find(h => h.id === actor.hq_id) || {}).name === "강원"));
    // 서버 흉내(마이그레이션 46): 편성이 확정될 때 배정이 편성보다 많으면 — 편성 0 은 그 종류 배정을 지우고, 한 기관만 배정받았으면 그 기관을 편성 대수로(여러 기관이면 그대로)
    const followAssign = (rid, q) => [["truck", "assigned_truck"], ["blower", "assigned_blower"]].forEach(([f, af]) => {
      const mine = db.allocations.filter(a => a.round_id === rid && a.branch_id === q.branch_id && a[f] > 0), cap = q[af] || 0, sum = mine.reduce((n, a) => n + a[f], 0);
      if (sum <= cap || (cap > 0 && mine.length !== 1)) return;
      mine.forEach(a => { const t = `round_allocations:${rid},${a.org},${a.branch_id}`, was = a[f]; a[f] = cap === 0 ? 0 : cap;
        if (!a.truck && !a.blower) { db.allocations.splice(db.allocations.indexOf(a), 1); log("삭제", "round_allocations", t, { [f]: was }, null); }
        else log("수정", "round_allocations", t, { [f]: was }, { [f]: a[f] }); });
    });
    const nextId = () => "V" + String(Math.max(0, ...db.vehicles.map(x => +x.id.slice(1) || 0)) + 1).padStart(3, "0");      // 서버 트리거 흉내: 가장 큰 번호 + 1(1000번부터는 네 자리)
    const log = (kind, tab, target, from_val, to_val) => db.audit.push({ at: new Date().toISOString(), username: actor.username || actor.label, ip: "-", kind, tab, target, from_val, to_val });
    const done = x => Promise.resolve(x);
    // 서버 규칙 흉내(마이그레이션 38): 날짜를 맡은 기준일자 = 그 날짜를 기간 안에 둔 기준일자 중 시작일이 가장 늦은 것
    const addD = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
    const gov = d => db.rounds.filter(r => r.start_date <= d && d <= addD(r.start_date, (r.days || 10) - 1)).sort((a, b) => b.start_date.localeCompare(a.start_date))[0] || null;
    const stRow = (rid, vid) => db.status.find(x => x.round_id === rid && x.vehicle_id === vid);
    const colsBad = n => !Number.isInteger(n) || n < 2 || n > 10;
    const setCols = (rid, f, n) => { const r = db.rounds.find(x => x.id === rid); if (r && (r[f] ?? 4) !== n) { log("수정", "support_rounds", "support_rounds:" + rid, { [f]: r[f] ?? 4 }, { [f]: n }); r[f] = n; } };   // 94
    const day1Bad = (rid, v) => { const r = db.rounds.find(x => x.id === rid); return !r || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v < r.start_date || v > addD(r.start_date, (r.days || 10) - 1); };
    const setDay1 = (rid, f, v) => { const r = db.rounds.find(x => x.id === rid); if (r && (r[f] || null) !== v) { log("수정", "support_rounds", "support_rounds:" + rid, { [f]: r[f] || null }, { [f]: v }); r[f] = v; } };
    const avail = (vid, d) => { const r = gov(d), x = r && stRow(r.id, vid); return !!x && x.status === "O" && (!x.off_from || d < x.off_from); };
    // 샘플 대설 특보: 서버 warning_status 와 같은 모양(지사 구역 중 가장 높은 단계)
    const RANK = { "예비": 1, "주의": 2, "경보": 3 };
    const zname = c => (db.zones.find(z => z.zone_code === c) || {}).name || c;
    function zonesOf(b) { return [...(db.zoneAuto[b] || []).filter(z => !db.zoneOver.some(o => o.branch_id === b && o.zone_code === z)), ...db.zoneOver.filter(o => o.branch_id === b && o.include).map(o => o.zone_code)]; }
    function warnStatus() {
      const branches = {};
      db.branches.forEach(b => {
        const zs = zonesOf(b.id).filter(z => db.warnActive[z] && !db.warnActive[z].includes(":")).map(z => { const lv = db.warnActive[z]; return [z, zname(z), lv, "대설", db.warnFc, lv === "예비" ? db.warnEfPre : db.warnEf]; })
          .sort((x, y) => RANK[y[2]] - RANK[x[2]] || x[1].localeCompare(y[1]));      // 지사별은 대설만(서버와 같음)
        if (zs.length) branches[b.id] = { level: zs[0][2], kind: "대설", zones: zs };
      });
      return { ok: true, paused: false, all: false, base: db.warnBase, fetched_at: new Date().toISOString(), branches, note: null };
    }
    return {
      setActor(a) { actor = a; },
      load(today) {
        db = makeSample(today);
        return done({ ok: true, me: null, hqs: clone(db.hqs), branches: clone(db.branches), vehicles: clone(db.vehicles), rounds: clone(db.rounds), orgs: db.orgs.slice(), team: clone(db.team), holdings: clone(db.holdings) });
      },
      reload() { return done({ ok: true, vehicles: clone(db.vehicles), rounds: clone(db.rounds) }); },
      statuses(ids) { return done({ ok: true, rows: clone([...db.status.filter(x => ids.includes(x.round_id)), ...db.teamStatus.filter(x => ids.includes(x.round_id)).map(asVeh)]) }); },
      routes(from, to) { return done({ ok: true, rows: clone([...db.routes, ...db.teamRoutes.map(asVeh)].filter(r => r.date >= from && r.date <= to)) }); },
      vehicleHistory(vid) { return done({ ok: true, rows: clone((isTeamId(vid) ? db.teamRoutes.filter(r => r.team_id === vid) : db.routes.filter(r => r.vehicle_id === vid)).sort((a, b) => b.date.localeCompare(a.date))) }); },
      saveTeam(round, routes, status, cols, day1) {      // 서버 save_gw_team 흉내: 관리자·강원본부만, 지원 여부 먼저 → 경로(그 날짜를 맡은 기준일자에서 '지원'인 날만). 하나라도 안 되면 전부 취소. cols = 지원일 칸 수(94)
        if (!teamOk()) return done(err("42501", TEAM_ERR["42501"]));
        const rd = db.rounds.find(r => r.id === +round); if (!rd || (!routes.length && !status.length && cols == null && day1 == null)) return done(err("22023", TEAM_ERR["22023"]));
        if (cols != null && colsBad(cols)) return done(err("22023", TEAM_ERR["22023"]));
        if (day1 != null && day1Bad(+round, day1)) return done(err("23514", "지원일 1은 기준일자 기간 안에서만 고를 수 있습니다."));
        if (status.some(x => !["", "O"].includes(x.status || "") || x.off_from)) return done(err("23514", "지원 여부는 빈칸 또는 '지원'만 됩니다."));      // 66
        if (routes.some(r => (gov(r.date) || {}).id !== +round || r.stops.some(b => !db.branches.some(x => x.id === b)) || r.stops.some((s, i) => i > 0 && s === r.stops[i - 1]))) return done(err("23514", TEAM_ERR["23514"]));      // 64: 바로 연달아 같은 지사만 거절
        if (routes.some(r => !simTimesOk(r))) return done(err("SA008"));
        const keep = clone(db.teamStatus), row = tid => db.teamStatus.find(x => x.round_id === +round && x.team_id === tid);
        status.forEach(x => { let w = row(x.team_id); if (!w) { w = { round_id: +round, team_id: x.team_id, status: "", off_from: null }; db.teamStatus.push(w); }
          w.status = x.status || ""; w.off_from = w.status === "O" ? x.off_from || null : null; w.updated_at = new Date().toISOString(); });
        const ok = (tid, d) => { const g = gov(d), w = g && db.teamStatus.find(x => x.round_id === g.id && x.team_id === tid); return !!w && w.status === "O" && (!w.off_from || d < w.off_from); };
        if (routes.some(r => r.stops.length && !ok(r.team_id, r.date))) { db.teamStatus = keep; return done(err("23514", TEAM_ERR["23514"])); }
        status.forEach(x => log("수정", "gw_team_status", `gw_team_status:${round},${x.team_id}`, null, { status: x.status, off_from: x.off_from || null }));
        routes.forEach(r => {
          const i = db.teamRoutes.findIndex(x => x.date === r.date && x.team_id === r.team_id), t = `gw_team_routes:${r.date},${r.team_id}`;
          const nr = { date: r.date, team_id: r.team_id, stops: r.stops.slice(), revised: false, times: r.times ? r.times.slice() : null, confirmed_at: new Date().toISOString() };
          if (!r.stops.length) { if (i >= 0) { log("삭제", "gw_team_routes", t, clone(db.teamRoutes[i]), null); db.teamRoutes.splice(i, 1); } }
          else if (i < 0) { db.teamRoutes.push(nr); log("추가", "gw_team_routes", t, null, clone(nr)); }
          else { log("수정", "gw_team_routes", t, { stops: db.teamRoutes[i].stops, times: db.teamRoutes[i].times }, { stops: nr.stops, times: nr.times }); db.teamRoutes[i] = nr; }
        });
        if (cols != null) setCols(+round, "cols_team", cols);
        if (day1 != null) setDay1(+round, "day1_team", day1);
        return done({ ok: true });
      },
      requests(round) { return done({ ok: true, rows: clone(db.requests.filter(r => r.round_id === +round)) }); },
      allocations(round) { return done({ ok: true, rows: clone(db.allocations.filter(a => a.round_id === +round)) }); },
      saveAllocations(round, rows) {       // 서버 save_allocations 흉내: 관리자(equip.route)만, 편성이 확정된 지사만, 둘 다 0 이면 줄 삭제
        if (!can("equip.route")) return done({ ok: false, message: ERR["42501"], code: "42501" });
        if (rows.some(x => x.org === POOL && x.blower)) return done(err("23514", "지역본부는 제설차만 배정합니다."));
        if (rows.some(x => (x.truck || x.blower) && !db.requests.some(q => q.round_id === +round && q.branch_id === x.branch_id && q.confirmed))) return done({ ok: false, message: ALLOC_ERR["23514"], code: "23514" });
        const sums = bid => db.allocations.filter(a => a.round_id === +round && a.branch_id === bid).reduce((m, a) => ({ t: m.t + a.truck, b: m.b + a.blower }), { t: 0, b: 0 });
        const bids = [...new Set(rows.map(x => x.branch_id))], before = Object.fromEntries(bids.map(b => [b, sums(b)])), keep = clone(db.allocations);
        rows.forEach(x => {
          const i = db.allocations.findIndex(a => a.round_id === +round && a.org === x.org && a.branch_id === x.branch_id), t = `round_allocations:${round},${x.org},${x.branch_id}`, old = i >= 0 ? db.allocations[i] : null;
          const nv = { round_id: +round, org: x.org, branch_id: x.branch_id, truck: x.truck || 0, blower: x.blower || 0 };
          if (!nv.truck && !nv.blower) { if (old) { log("삭제", "round_allocations", t, clone(old), null); db.allocations.splice(i, 1); } }
          else if (!old) { db.allocations.push(nv); log("추가", "round_allocations", t, null, clone(nv)); }
          else if (old.truck !== nv.truck || old.blower !== nv.blower) { log("수정", "round_allocations", t, { truck: old.truck, blower: old.blower }, { truck: nv.truck, blower: nv.blower }); db.allocations[i] = nv; }
        });
        // 서버 흉내(마이그레이션 46): 저장 뒤 합계가 편성을 넘고, 저장 전보다 늘었으면 전부 취소(SA006)
        const bad = bids.some(b => { const q = db.requests.find(x => x.round_id === +round && x.branch_id === b) || {}, a = sums(b), o = before[b];
          return (a.t > (q.assigned_truck || 0) && a.t > o.t) || (a.b > (q.assigned_blower || 0) && a.b > o.b); });
        if (bad) { db.allocations = keep; return done(err("SA006")); }
        return done({ ok: true });
      },
      audit() { return done({ ok: true, rows: can("log.view") ? clone(db.audit) : [] }); },
      warnings() { return done({ ok: true, status: clone(warnStatus()) }); },
      forecast() { return done({ ok: true, rows: clone(db.forecast) }); },
      zoneData() {
        if (!actor) return done({ ok: false, message: ERR["42501"] });
        const list = {};
        Object.entries(db.zoneAuto).forEach(([b, zs]) => { list[b] = zs.filter(z => !db.zoneOver.some(o => o.branch_id === b && o.zone_code === z)).map(z => [z, zname(z), "auto"]); });
        db.zoneOver.filter(o => o.include).forEach(o => (list[o.branch_id] = list[o.branch_id] || []).push([o.zone_code, zname(o.zone_code), "manual"]));
        const rows = Object.entries(db.warnActive).map(([zone, v]) => { const [level, kind] = v.split(":"); return { zone, name: zname(zone), kind: kind || "대설", level, tm_fc: db.warnFc, tm_ef: level === "예비" ? db.warnEfPre : db.warnEf, branches: db.branches.filter(b => zonesOf(b.id).includes(zone)).map(b => b.id) }; })
          .sort((x, y) => RANK[y.level] - RANK[x.level] || x.kind.localeCompare(y.kind));
        return done({ ok: true, list, overrides: clone(db.zoneOver), zones: clone(db.zones), active: { state: { fetched_at: new Date().toISOString(), ok: true }, needed: true, all: true, rows } });
      },
      zoneReqs() {
        if (!actor) return done({ ok: false, message: ERR["42501"] });
        const me = actor.username || actor.label, rows = (db.zoneReq || []).filter(q => q.status === "pending" && (actor.role === "admin" || q.by_id === me))
          .map(q => ({ id: q.id, branch_id: q.branch_id, zone_code: q.zone_code, zone_name: zname(q.zone_code), action: q.action, reason: q.reason, created_at: q.created_at, mine: q.by_id === me, by: q.by_id }));
        return done({ ok: true, rows: clone(rows) });
      },
      zoneReq(branch, zone, action, reason) {
        if (!actor) return done({ ok: false, message: ERR["42501"] });
        if (actor.role === "admin") return done({ ok: false, message: "관리자는 요청 없이 바로 바꿉니다" });
        reason = String(reason || "").trim(); if (!reason || reason.length > 200) return done({ ok: false, message: "사유를 1~200자로 적어 주세요" });
        db.zoneReq = db.zoneReq || [];
        if ((action === "add") === zonesOf(branch).includes(zone)) return done({ ok: false, message: action === "add" ? "이미 들어간 구역입니다" : "들어가 있지 않은 구역입니다" });
        if (db.zoneReq.some(q => q.branch_id === branch && q.zone_code === zone && q.status === "pending")) return done({ ok: false, message: "이 지사·구역에 처리를 기다리는 요청이 이미 있습니다" });
        const q = { id: db.zoneReq.length + 1, branch_id: branch, zone_code: zone, action, reason, status: "pending", by_id: actor.username || actor.label, created_at: new Date().toISOString() };
        db.zoneReq.push(q); log("추가", "zone_requests", String(q.id), null, { branch_id: branch, zone_code: zone, action, reason });
        return done({ ok: true });
      },
      zoneReqCancel(id) {
        const q = (db.zoneReq || []).find(x => x.id === id && x.status === "pending" && x.by_id === (actor && (actor.username || actor.label)));
        if (!q) return done({ ok: false, message: "취소할 수 있는 요청이 아닙니다" });
        q.status = "cancelled"; return done({ ok: true });
      },
      zoneReqResolve(id, approve) {
        if (!actor || actor.role !== "admin") return done({ ok: false, message: ERR["42501"] });
        const q = (db.zoneReq || []).find(x => x.id === id && x.status === "pending"); if (!q) return done({ ok: false, message: "처리를 기다리는 요청이 아닙니다" });
        if (approve) {
          const i = db.zoneOver.findIndex(o => o.branch_id === q.branch_id && o.zone_code === q.zone_code), o = db.zoneOver[i], inn = zonesOf(q.branch_id).includes(q.zone_code);
          if (q.action === "add" && !inn) { if (o && !o.include) db.zoneOver.splice(i, 1); else if (o) o.include = true; else db.zoneOver.push({ branch_id: q.branch_id, zone_code: q.zone_code, include: true }); }
          if (q.action === "remove" && inn) { if (o && o.include) db.zoneOver.splice(i, 1); else if (o) o.include = false; else db.zoneOver.push({ branch_id: q.branch_id, zone_code: q.zone_code, include: false }); }
        }
        q.status = approve ? "approved" : "rejected"; return done({ ok: true });
      },
      setZone(branch, zone, include) {
        if (!actor || actor.role !== "admin") return done({ ok: false, message: ERR["42501"] });
        const i = db.zoneOver.findIndex(o => o.branch_id === branch && o.zone_code === zone), t = `branch_zone_overrides:${branch},${zone}`;
        if (include === null) { if (i >= 0) { log("삭제", "branch_zone_overrides", t, db.zoneOver[i], null); db.zoneOver.splice(i, 1); } }
        else if (i >= 0) db.zoneOver[i].include = include;
        else { db.zoneOver.push({ branch_id: branch, zone_code: zone, include }); log("추가", "branch_zone_overrides", t, null, { include }); }
        return done({ ok: true });
      },
      saveFleet(vehicles, routes, round, status, cols, day1) {      // cols·day1 = 지원일 칸 수·지원일 1(94): 관리자(equip.route)만, 경로·지원 여부와 한 번에
        if ((cols != null || day1 != null) && !can("equip.route")) return done(err("42501", "지원일 칸 수·지원일 1은 관리자만 바꿀 수 있습니다."));
        if (cols != null && (colsBad(cols) || !db.rounds.some(r => r.id === +round))) return done(err("22023", FLEET_ERR["22023"]));
        if (day1 != null && day1Bad(+round, day1)) return done(err("23514", "지원일 1은 기준일자 기간 안에서만 고를 수 있습니다."));
        const addDaysISO = (iso, n) => { const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
        status = status || [];
        // 경로는 관리자(equip.route, 2026-11-02 — 'equip.edit.all' 만 받은 지원장비 아이디는 기계화부와 같음). 기계화부(지원장비)는 자기 기관 장비의 ① 정해진 경로의 도착 예상 시각 ② 지원일 1의 지사 한 곳(배정받은 지사·대수 안에서, 마이그레이션 43)
        // 지원일 칸: 자기 기관 장비(지역본부 장비는 자기 지사 것)만 — 'equip.edit.all' 이 있어도(서버 vehicle_routes_guard 흉내)
        const routeOk = vid => { const v = db.vehicles.find(x => x.id === vid); return !!v && (v.org === POOL ? poolOwn(v) : (can("equip.edit.own") || can("equip.edit.all")) && v.org === actor.org); };
        const allocOf = (org, bid) => db.allocations.find(a => a.round_id === +round && a.org === org && a.branch_id === bid);
        const ownRoutesErr = () => {      // 서버 트리거 흉내: 오류 번호 또는 null. 대수는 이번 저장을 모두 적용한 뒤에 셈(서로 바꾸기 허용)
          const rd0 = db.rounds.find(r => r.id === +round), sim = new Map(db.routes.map(x => [x.date + "|" + x.vehicle_id, x])), touched = [];
          for (const r of routes) {
            if (!routeOk(r.vehicle_id)) return "42501";
            const k = r.date + "|" + r.vehicle_id, old = sim.get(k), v = db.vehicles.find(x => x.id === r.vehicle_id);
            if (old && JSON.stringify(old.stops) === JSON.stringify(r.stops)) continue;                 // 시각만
            if (v.org === POOL) return "42501";                                                        // 지역본부 장비의 지사는 관리자만(마이그레이션 55), 지사는 위의 시각만
            const inRound = rd0 && r.date >= rd0.start_date && r.date < addDaysISO(rd0.start_date, rd0.days || 10);     // 2026-11-02: 기준일자의 모든 지원일
            if (!inRound || (old && (old.revised || old.stops.length !== 1)) || r.stops.length > 1) return "SA003";
            if (!r.stops.length) { sim.delete(k); continue; }
            const a = allocOf(v.org, r.stops[0]);
            if (!a || (v.type === "제설차" && !a.truck) || (v.type === "제설기" && !a.blower)) return "SA001";
            sim.set(k, { ...r, revised: false }); touched.push([v, r.stops[0], r.date]);
          }
          for (const [v, bid, day] of touched) {
            if (v.type === "이동정비차") continue;
            const cur = sim.get(day + "|" + v.id); if (!cur || cur.stops[0] !== bid) continue;
            const a = allocOf(v.org, bid), cap = a ? (v.type === "제설차" ? a.truck : a.blower) : 0;
            const n = [...sim.values()].filter(x => { const y = db.vehicles.find(z => z.id === x.vehicle_id); return x.date === day && x.stops[0] === bid && y && y.org === v.org && y.type === v.type; }).length;
            if (n > cap) return "SA002";
          }
          return null;
        };
        if (vehicles.some(v => "status" in v)) return done({ ok: false, message: "저장할 내용이 없거나 기준일자가 없습니다.", code: "22023" });
        if ((routes.length || status.length) && !db.rounds.some(r => r.id === +round)) return done({ ok: false, message: "저장할 내용이 없거나 기준일자가 없습니다.", code: "22023" });
        if (vehicles.some(v => !vehOk(v.id)) || status.some(x => !vehOk(x.vehicle_id))) return done({ ok: false, message: ERR["42501"], code: "42501" });
        const vof = id => db.vehicles.find(x => x.id === id) || {};
        if (routes.some(repeated)) return done(err("23514", "바로 앞과 같은 지사는 한 번만 들어갑니다."));      // 64
        if (routes.some(r => r.stops.length && !simTimesOk(r))) return done(err("SA008"));
        if (status.some(x => x.crew!==undefined&&!SSCrew.valid(x.crew))) return done(err("23514", "인원은 코드가 다른 두 명까지 선택할 수 있습니다."));
        if (status.some(x => !["", "O"].includes(x.status || "") || x.off_from)) return done(err("23514", "지원 여부는 빈칸 또는 '지원'만 됩니다."));      // 66
        if (status.some(x => vof(x.vehicle_id).org === POOL && (x.status !== "O" || x.off_from))) return done(err("23514", "지역본부 장비의 지원 여부는 늘 '지원'입니다."));
        if (can("equip.route") && routes.some(r => { const h = vof(r.vehicle_id).home_branch; return h && r.stops.includes(h); })) return done(err("SA005"));   // 지사 계정은 아래에서 먼저 42501(서버와 같은 순서, 55)
        if (!can("equip.route")) { const c = ownRoutesErr(); if (c) return done({ ok: false, message: ERR[c], code: c }); }
        if (!can("equip.route")) routes = routes.map(r => { const x = db.routes.find(y => y.date === r.date && y.vehicle_id === r.vehicle_id); return { ...r, revised: !!(x && x.revised) }; });
        if (!can("equip.edit.all") && vehicles.some(v => Object.keys(v).some(k => !["id", "plate", "blower_s", "blower_l", "rented"].includes(k)))) return done({ ok: false, message: ERR["42501"] });
        if (vehicles.some(p => { const v = vof(p.id), n = { ...v, ...p }; return v.org === POOL ? !poolNameOk(n) : !!n.rented; })) return done(err("23514"));
        if (vehicles.some(p => (p.blower_s || p.blower_l) && (db.vehicles.find(x => x.id === p.id) || {}).type !== "제설기")) return done({ ok: false, message: ERR["23514"] || "값이 규칙에 맞지 않습니다." });
        const pk = (v, plate) => (v.round_id || "") + "|" + plate;      // 이름 중복: 기계화부 장비는 전체에서, 지역본부 장비는 같은 기준일자 안에서
        const plates = new Map(db.vehicles.map(v => [v.id, pk(v, v.plate)])); vehicles.forEach(v => { if ("plate" in v) plates.set(v.id, pk(vof(v.id), v.plate)); });
        if (new Set(plates.values()).size !== plates.size) return done({ ok: false, message: ERR["23505"] });
        const rd = db.rounds.find(r => r.id === +round);
        if (status.some(x => x.status === "O" && x.off_from && x.off_from < rd.start_date)) return done({ ok: false, message: FLEET_ERR["23514"] });
        if (routes.some(r => (gov(r.date) || {}).id !== +round)) return done({ ok: false, message: FLEET_ERR["23514"] });
        const before = clone(db.status);                                           // 하나라도 안 되면 전부 취소(서버 함수와 같게)
        status.forEach(x => { let row = stRow(+round, x.vehicle_id); if (!row) { row = { round_id: +round, vehicle_id: x.vehicle_id, status: "", off_from: null }; db.status.push(row); }
          if(x.crew!==undefined)row.crew=x.crew.slice(); row.status = x.status || ""; row.off_from = row.status === "O" ? x.off_from || null : null; row.updated_at = new Date().toISOString(); });
        if (routes.some(r => r.stops.length && !avail(r.vehicle_id, r.date))) { db.status = before; return done({ ok: false, message: FLEET_ERR["23514"] }); }
        status.forEach(x => log("수정", "round_vehicle_status", `round_vehicle_status:${round},${x.vehicle_id}`, null, { status: x.status, off_from: x.off_from || null, ...(x.crew!==undefined?{crew:x.crew}: {}) }));
        vehicles.forEach(p => { const v = db.vehicles.find(x => x.id === p.id), from = {}, to = {}; Object.keys(p).filter(k => k !== "id" && v[k] !== p[k]).forEach(k => { from[k] = v[k]; to[k] = p[k]; v[k] = p[k]; }); if (Object.keys(to).length) log("수정", "vehicles", "vehicles:" + v.id, from, to); });
        routes.forEach(r => {
          const i = db.routes.findIndex(x => x.date === r.date && x.vehicle_id === r.vehicle_id), t = `vehicle_routes:${r.date},${r.vehicle_id}`;
          const nr = { date: r.date, vehicle_id: r.vehicle_id, stops: r.stops.slice(), revised: !!r.revised, times: r.times ? r.times.slice() : null, confirmed_at: new Date().toISOString() };
          if (!r.stops.length) { if (i >= 0) { log("삭제", "vehicle_routes", t, clone(db.routes[i]), null); db.routes.splice(i, 1); } }
          else if (i < 0) { db.routes.push(nr); log("추가", "vehicle_routes", t, null, clone(nr)); }
          else { const o = db.routes[i], from = {}, to = {};
            ["stops", "revised", "times"].forEach(f => { if (JSON.stringify(o[f] ?? null) !== JSON.stringify(nr[f] ?? null)) { from[f] = o[f] ?? null; to[f] = nr[f]; } });
            if (Object.keys(to).length) { log("수정", "vehicle_routes", t, from, to); db.routes[i] = nr; } }
        });
        if (cols != null) setCols(+round, "cols_equip", cols);
        if (day1 != null) setDay1(+round, "day1_equip", day1);
        return done({ ok: true });
      },
      saveRequests(round, rows) {
        const br = id => db.branches.find(b => b.id === id);
        const ok = r => can("req.confirm") || (can("req.edit.own") && actor.branch_id === r.branch_id) || (can("req.edit.hq") && br(r.branch_id) && br(r.branch_id).hq_id === actor.hq_id);
        if (rows.some(r => !ok(r)) || (!can("req.confirm") && rows.some(r => "assigned_truck" in r || "assigned_blower" in r || "confirmed" in r))) return done({ ok: false, message: ERR["42501"] });
        // 서버 흉내(마이그레이션 56): 확정 때 보낸 수정 시각이 지금과 다르면 전부 취소
        const META = ["branch_id", "confirmed", "expect_at"];
        if (rows.some(r => "expect_at" in r && (((db.requests.find(x => x.round_id === +round && x.branch_id === r.branch_id) || {}).updated_at ?? null) !== r.expect_at))) return done(err("SA007"));
        // 서버 트리거 흉내(마이그레이션 35): 확정한 줄은 확정 열 말고는 못 바꿈(취소하면서 바꾸는 것도)
        const locked = r => { const c = db.requests.find(x => x.round_id === +round && x.branch_id === r.branch_id); return c && c.confirmed && Object.keys(r).some(k => !META.includes(k) && JSON.stringify(r[k] ?? null) !== JSON.stringify(c[k] ?? null)); };
        if (rows.some(locked)) return done({ ok: false, message: ERR["55000"], code: "55000" });
        if (rows.some(r => "offer_truck" in r && !(r.offer_truck >= 0 && r.offer_truck <= 99))) return done(err("23514"));
        const versions = {};
        rows.forEach(p => {
          let cur = db.requests.find(x => x.round_id === +round && x.branch_id === p.branch_id), from = {}, to = {};
          if (!cur) { cur = { round_id: +round, branch_id: p.branch_id, req_truck: 0, req_blower: 0, assigned_truck: 0, assigned_blower: 0, offer_truck: 0, arrive_at: null, reason: null, confirmed: false,
            wx_manual: false, wx_snow: null, wx_pcp: null, wx_tmin: null, wx_tmin_at: null, wx_level: null, wx_fc: null, wx_ef: null }; db.requests.push(cur); }
          const was = cur.confirmed;
          Object.keys(p).filter(k => k !== "branch_id" && k !== "expect_at").forEach(k => { from[k] = cur[k]; to[k] = p[k]; cur[k] = p[k]; });
          versions[p.branch_id] = cur.updated_at = new Date().toISOString();
          if (!("confirmed" in p) || Object.keys(p).some(k => !META.includes(k))) Object.assign(cur, { saved_at: new Date().toISOString(), saved_lv: can("req.confirm") ? "admin" : can("req.edit.hq") ? "hq" : "branch" });   // 서버 흉내(마이그레이션 50): 누가 저장했는지
          if (cur.confirmed && !was) followAssign(+round, cur);                         // 편성이 확정되면 배정이 따라감
          if (cur.confirmed && !was) { const w = warnStatus().branches[cur.branch_id]; Object.assign(cur, { warn_level: w ? w.level : null, warn_zones: w ? w.zones : [], warn_base: db.warnBase, warn_at: new Date().toISOString(), warn_note: null }); to.warn_level = cur.warn_level; }   // 서버 트리거 흉내: 확정 순간 특보 고정
          if (cur.confirmed && !was) { const f = db.forecast.find(x => x.branch_id === cur.branch_id); Object.assign(cur, { fc_snow: f ? f.max_snow_24h : null, fc_pcp: f ? f.max_pcp_24h : null, fc_snow_hi: f ? f.max_snow_hi ?? null : null, fc_pcp_hi: f ? f.max_pcp_hi ?? null : null, fc_pop: f && f.max_pop_24h != null ? f.max_pop_24h : null, fc_tmin: f ? f.min_tmp : null, fc_tmin_at: f ? f.min_tmp_at : null, fc_tmfc: f ? f.issued_at : null, fc_at: new Date().toISOString() }); }
          if (!cur.confirmed) Object.assign(cur, { warn_level: null, warn_zones: null, warn_base: null, warn_at: null, warn_note: null, fc_snow: null, fc_pcp: null, fc_snow_hi: null, fc_pcp_hi: null, fc_pop: null, fc_tmin: null, fc_tmin_at: null, fc_tmfc: null, fc_at: null });
          log("수정", "round_requests", `round_requests:${round},${p.branch_id}`, from, to);
        });
        return done({ ok: true, result: { rows: rows.length, versions } });
      },
      createRound(date) {
        if (!can("req.confirm")) return done({ ok: false, message: ERR["42501"] });
        if (db.rounds.some(r => r.start_date >= date)) return done({ ok: false, message: ROUND_ERR["23514"] });
        const prev = db.rounds.slice().sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
        const r = { id: Math.max(0, ...db.rounds.map(x => x.id)) + 1, name: date + " 기준", start_date: date, days: 10 }; db.rounds.push(r); log("추가", "support_rounds", "support_rounds:" + r.id, null, r);
        db.vehicles.filter(v => v.active !== false && !v.round_id && (!v.hidden_after || date <= v.hidden_after)).forEach(v => {      // 지역본부 장비(round_id 있음)는 이어받지 않음     // 전체 장비 지원 여부 이어받기(정비중·지원 불가 포함)
          const p = prev && stRow(prev.id, v.id), keep = !!p && p.status === "O" && db.routes.some(x => x.vehicle_id === v.id && x.date >= date && x.stops.length && (!p.off_from || x.date < p.off_from));      // 63: 빈칸, 새 기간에 경로가 잡힌 지원 장비만 유지
          db.status.push({ round_id: r.id, vehicle_id: v.id, crew: p&&p.crew?p.crew.slice():[], status: keep ? "O" : "", off_from: keep && p.off_from > date ? p.off_from : null, updated_at: new Date().toISOString() });
        });
        db.team.forEach(t => { const p = prev && db.teamStatus.find(x => x.round_id === prev.id && x.team_id === t.id), keep = !!p && p.status === "O" && db.teamRoutes.some(x => x.team_id === t.id && x.date >= date && x.stops.length && (!p.off_from || x.date < p.off_from));      // 강원 신속대응팀(63 같은 규칙)
          db.teamStatus.push({ round_id: r.id, team_id: t.id, status: keep ? "O" : "", off_from: keep && p.off_from > date ? p.off_from : null, updated_at: new Date().toISOString() }); });
        return done({ ok: true, round: clone(r) });
      },
      deleteRound(id) {
        if (!can("req.confirm")) return done({ ok: false, message: ERR["42501"] });
        const r = db.rounds.find(x => x.id === +id); if (!r) return done({ ok: false, message: ERR["23503"] });
        if (db.rounds.some(x => x.start_date > r.start_date) || db.routes.some(x => { const v = db.vehicles.find(y => y.id === x.vehicle_id) || {};      // 다른 기준일자에 딸린 지역본부 장비의 경로는 세지 않음(마이그레이션 45)
          return x.date >= r.start_date && x.date <= addD(r.start_date, (r.days || 10) - 1) && !(v.round_id && v.round_id !== r.id); })) return done({ ok: false, message: ROUND_ERR["23514"] });
        db.requests.filter(x => x.round_id === +id).forEach(x => log("삭제", "round_requests", `round_requests:${id},${x.branch_id}`, clone(x), null));
        db.requests = db.requests.filter(x => x.round_id !== +id); db.status = db.status.filter(x => x.round_id !== +id); db.rounds = db.rounds.filter(x => x.id !== +id);
        db.vehicles = db.vehicles.filter(x => x.round_id !== +id); db.allocations = db.allocations.filter(x => x.round_id !== +id);      // 그 기준일자에 딸린 지역본부 장비·배정도 함께
        const rEnd = addD(r.start_date, (r.days || 10) - 1);                                                                                // 강원 신속대응팀: 그 기간 경로·지원 여부도 함께(마이그레이션 48)
        db.teamRoutes.filter(x => x.date >= r.start_date && x.date <= rEnd).forEach(x => log("삭제", "gw_team_routes", `gw_team_routes:${x.date},${x.team_id}`, clone(x), null));
        db.teamRoutes = db.teamRoutes.filter(x => !(x.date >= r.start_date && x.date <= rEnd)); db.teamStatus = db.teamStatus.filter(x => x.round_id !== +id);
        log("삭제", "support_rounds", "support_rounds:" + id, r, null);
        return done({ ok: true });
      },
      addVehicle(v) {
        if (v.org === POOL) {           // 지역본부 장비(서버 트리거 흉내): 그 지사 계정·관리자, 지원 가능 대수가 확정된 기준일자, 이름 형식, 같은 기준일자 안 중복 불가
          if (!(can("equip.edit.all") || poolOwn(v))) return done(err("42501"));
          const q = db.requests.find(x => x.round_id === +v.round_id && x.branch_id === v.home_branch);
          if (v.type !== "제설차" || !poolNameOk(v) || !db.rounds.some(r => r.id === +v.round_id)) return done(err("23514"));
          if (!q || !q.confirmed || !(q.offer_truck >= 1)) return done(err("SA004"));
          if (db.vehicles.some(x => x.round_id === +v.round_id && x.plate === v.plate)) return done(err("23505"));
          const id = nextId();
          const nv = { status: "", active: true, sort: 0, blower_s: false, blower_l: false, hidden_after: null, ...v, id, round_id: +v.round_id, rented: !!v.rented };
          db.vehicles.push(nv); db.status.push({ round_id: nv.round_id, vehicle_id: id, status: "O", off_from: null, updated_at: new Date().toISOString() });
          log("추가", "vehicles", "vehicles:" + id, null, nv); return done({ ok: true, vehicle: clone(nv) });
        }
        if (!(can("equip.edit.all") || (can("equip.edit.own") && v.org === actor.org))) return done({ ok: false, message: ERR["42501"] });
        if (db.vehicles.some(x => (!x.round_id && x.plate === v.plate) || (v.id && x.id === v.id))) return done({ ok: false, message: ERR["23505"] });
        const nv = { status: "", active: true, ...v, id: v.id || nextId() }; db.vehicles.push(nv); log("추가", "vehicles", "vehicles:" + nv.id, null, nv); return done({ ok: true, vehicle: clone(nv) });
      },
      deleteVehicle(id) {
        const v = db.vehicles.find(x => x.id === id);
        if (!(can("equip.edit.all") || (v && v.org === POOL && poolOwn(v)))) return done({ ok: false, message: ERR["42501"] });      // 장비 삭제는 관리자, 지역본부 장비는 그 지사 계정도
        if (db.routes.some(x => x.vehicle_id === id)) return done({ ok: false, message: VDEL_ERR["23503"], code: "23503" });   // 경로 기록이 있으면 숨기기를 써야 함
        db.vehicles = db.vehicles.filter(x => x.id !== id); db.status = db.status.filter(x => x.vehicle_id !== id); log("삭제", "vehicles", "vehicles:" + id, { id }, null); return done({ ok: true });
      },
      hideVehicle(id, after) {
        if (!can("equip.edit.all")) return done({ ok: false, message: ERR["42501"] });
        const v = db.vehicles.find(x => x.id === id); if (!v) return done({ ok: false, message: ERR["23503"] });
        log("수정", "vehicles", "vehicles:" + id, { hidden_after: v.hidden_after || null }, { hidden_after: after }); v.hidden_after = after; return done({ ok: true });
      }
    };
  })();

  const b = SAMPLE ? sample : server;
  return { sample: SAMPLE, setActor: a => { if (SAMPLE) sample.setActor(a); }, ...Object.fromEntries(Object.keys(server).map(k => [k, (...a) => b[k](...a)])) };
})();
