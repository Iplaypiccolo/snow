"""
가짜 Supabase 서버 — 실제 Supabase 에 접속하지 않고 시험하기 위한 흉내 (tests/test_admin_ui.py, test_login_gate.py, 기존 화면 시험이 함께 씀)
흉내 내는 것: 로그인·토큰 갱신·로그아웃, 내 정보/계정 목록/지사·본부/접속 로그 읽기(권한 규칙 포함), 비밀번호 변경, 계정 발급 함수(일괄 설정·초기화·비활성화)
"""
import json, re, time, datetime
from pathlib import Path
from urllib.parse import urlparse, parse_qs

_SNAP = {}
def snow_snapshot_text():
    """서버의 적설 요약본(snapshots 'snow')을 시험용 표본(tests/fixtures/snow_sample.json)으로 흉내 — DB 함수 admin_rebuild_snow_snapshot 과 같은 규칙(결측 -99.9 제외, 시즌별 11/15~3/15 전체 날짜)"""
    if "t" not in _SNAP:
        sd = json.load(open(Path(__file__).resolve().parent / "fixtures" / "snow_sample.json", encoding="utf-8"))["stationData"]
        def y_of(d): return int(d[:4]) if int(d[4:6]) >= 11 else int(d[:4]) - 1
        seasons = {}
        for stn, rec in sd.items():
            for d, v in rec.items():
                if v < 0: continue
                y = y_of(d); lab = f"{y}-11-15~{y + 1}-03-15"
                if lab not in seasons:
                    dates, cur = [], datetime.date(y, 11, 15)
                    while cur <= datetime.date(y + 1, 3, 15): dates.append(cur.strftime("%Y%m%d")); cur += datetime.timedelta(days=1)
                    seasons[lab] = {"dates": dates, "idx": {x: i for i, x in enumerate(dates)}, "st": {}}
                S = seasons[lab]; arr = S["st"].setdefault(stn, [None] * len(S["dates"])); arr[S["idx"][d]] = v
        for S in seasons.values(): del S["idx"]
        _SNAP["t"] = json.dumps([{"body": {"version": 1, "seasons": seasons}, "built_at": "2026-10-04T00:00:00Z"}])
    return _SNAP["t"]

def snow_v2_rows():
    """시즌별 요약본(마이그레이션 31·47): 'snow' = 목록(version 3: label 'YYYY-YY', start·end·ongoing·partial), 'snow:<시즌>' = 그 시즌. 화면이 쓰는 관측소(data/stations.json)만.
    표본은 2024-25 한 시즌뿐이라, 그 값을 반으로 줄인 2020~2023 시즌을 덧붙여 5시즌으로 만듦(최근 3 + 지난 2). 기간은 표본 그대로 11/15~3/15, 2024-25 의 3/15 는 '수집 중'(partial)"""
    if "v2" not in _SNAP:
        base = json.loads(snow_snapshot_text())[0]["body"]["seasons"]
        real_label = sorted(base)[-1]; real = base[real_label]
        ids = {str(x["id"]) for x in json.load(open(Path(__file__).resolve().parent.parent / "data" / "stations.json", encoding="utf-8"))["stations"]}
        rows, index = {}, []
        for y in range(2020, 2025):
            dates, cur = [], datetime.date(y, 11, 15)
            while cur <= datetime.date(y + 1, 3, 15): dates.append(cur.strftime("%Y%m%d")); cur += datetime.timedelta(days=1)
            st = {}
            for stn, arr in real["st"].items():
                if stn not in ids: continue
                a = [(arr[i] if y == 2024 else (None if arr[i] is None else round(arr[i] * 0.5, 1))) if i < len(arr) else None for i in range(len(dates))]
                st[stn] = a
            lab = f"{y}-{(y + 1) % 100:02d}"
            rows["snow:" + lab] = {"key": "snow:" + lab, "body": {"dates": dates, "st": st}, "built_at": f"2026-10-0{y - 2019}T00:00:00Z"}
            index.append({"label": lab, "start": dates[0], "end": dates[-1], "ongoing": False, "partial": [dates[-1]] if y == 2024 else None,
                          "days": len(dates), "data_days": sum(1 for i in range(len(dates)) if any(v[i] is not None for v in st.values())), "stations": len(st)})
        rows["snow"] = {"key": "snow", "body": {"version": 3, "seasons": index}, "built_at": "2026-10-05T00:00:00Z"}
        _SNAP["v2"] = rows
    return _SNAP["v2"]

SB = "https://yzwbnohzhnctdvufntig.supabase.co"
DOMAIN = "snow-support.invalid"
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*"}
ADMIN_PW = "Admin#Pass-2026x!"
# 서버 표 permissions 와 같은 목록(마이그레이션 15)
PERMS = [("juris.request", "관할 구간 변경 요청", ["branch"]), ("juris.edit", "관할 변경 저장·요청 승인", []), ("grid.edit", "예보 격자 편입", []),
         ("req.edit.own", "자기 지사 요청 입력", ["branch"]), ("req.edit.hq", "자기 본부 지사 요청 입력", ["hq"]), ("req.confirm", "요청 확정·편성·기준일자", []),
         ("equip.edit.own", "자기 기관 장비·경로 입력", ["equip"]), ("equip.edit.all", "모든 기관 장비 입력·장비 삭제·숨기기", []), ("equip.route", "지원일 칸(경로) 전부 입력", []), ("log.view", "접속·수정 기록 보기", [])]
def default_perms(role): return [k for k, _, r in PERMS if role in r]
TEMP_PW = "Tmp#Start-Ab12Cd34"

class Mock:
    def __init__(self):
        self.users, self.tokens, self.fn_calls, self.put_calls, self.n = {}, {}, [], [], 0
        self.fn_override = None; self.delay = 0
        self.requests, self.rid, self.req_calls = [], 0, []          # 구간 변경 요청(jurisdiction_requests)
        self.events = {"jurisdiction_events": [], "grid_events": []}  # 변경 이력 표 (저장하면 쌓이고, 모든 사용자가 같은 것을 읽음)
        self.event_calls, self.events_fail = [], None                 # 저장 요청 기록 / 저장·읽기 오류 흉내 (status, body)
        self.snow_daily_calls, self.snow_empty = [], False            # 하루치 원자료 읽기 기록 / 요약본이 아직 없는 상황 흉내
        self.add("admin-01", "관리자1", "admin", None, ADMIN_PW)
        self.add("admin-02", "관리자2", "admin", None, "Second#Admin-77qZ")
        names = [("exchungju", "충주지사", "B019", "H04"), ("exdongseoul", "동서울지사", "B006", "H02"), ("exgurye", "구례지사", "B039", "H07"), ("exwonju", "원주지사", "B011", "H03"),
                 ("exincheon", "인천지사", "B001", "H01"), ("exsiheung", "시흥지사", "B002", "H01"), ("exgunpo", "군포지사", "B003", "H01"), ("exhwaseong", "화성지사", "B004", "H01")]
        for u, d, b, h in names: self.add(u, d, "branch", b, TEMP_PW, must_change=True)
        self.add("equip-01", "지원장비", "equip", None, "Equip#Pass-8821xY", org="서울경기")
        self.orgs = ["서울경기", "충북", "전북", "대구경북", "지역본부"]      # 실제 서버처럼 '지역본부'도 들어 있음(장비·배정용 — 계정 소속으로는 화면이 빼야 함)
        # 장비 지원(마이그레이션 16·17): 장비, 날짜별 경로, 기준일자, 지사 요청. 저장 함수 호출은 eq_calls 에 기록
        import datetime as _dt
        self.today = _dt.date.today().isoformat()
        self.vehicles = [{"id": "V001", "org": "서울경기", "type": "제설차", "plate": "서울경기901", "status": "O", "sort": 10, "active": True},
                         {"id": "V002", "org": "충북", "type": "제설기", "plate": "충북901", "status": "O", "sort": 20, "active": True}]
        self.routes = [{"date": self.today, "vehicle_id": "V002", "stops": ["B019"]}]
        self.rounds = [{"id": 1, "name": self.today + " 기준", "start_date": self.today, "days": 10}]
        # 기준일자별 지원 여부(마이그레이션 38)
        self.rstatus = [{"round_id": 1, "vehicle_id": v["id"], "status": v["status"], "off_from": None, "updated_at": "2026-10-08T00:00:00Z"} for v in self.vehicles]
        self.round_reqs = [{"round_id": 1, "branch_id": "B019", "req_truck": 2, "req_blower": 0, "assigned_truck": 1, "assigned_blower": 0,
                            "arrive_at": self.today + "T13:00:00+00:00", "reason": None, "confirmed": True,
                            "warn_level": "경보", "warn_zones": [["L1041100", "충주", "경보"]], "warn_base": "202612150600", "warn_at": "2026-12-14T21:10:00Z", "warn_note": None}]
        self.eq_calls = []
        # 대설 특보(마이그레이션 23): warning_status 결과. 확정한 B019 는 확정할 때 경보로 고정돼 있고 지금은 주의보
        self.warn_status = {"ok": True, "base": "202612150700", "fetched_at": "2026-12-14T22:00:00Z", "note": None,
                            "branches": {"B019": {"level": "주의", "zones": [["L1041100", "충주", "주의"]]}, "B011": {"level": "예비", "zones": [["L1021300", "횡성", "예비"]]}}}
        # 예상 적설·강수(마이그레이션 27·28): 격자 = data/grid_assign.json 기본 편입, 값 = 격자 번호로 만든 가짜 값(한 시간 전 발표)
        import json as _json, os as _os
        _ga = _json.load(open(_os.path.join(_os.path.dirname(__file__), "..", "data", "grid_assign.json"), encoding="utf-8"))
        _iss = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
        self.fc_issued = _iss.isoformat(); self.fc_start = (_iss + _dt.timedelta(hours=2)).isoformat(); self.fc_end = (_iss + _dt.timedelta(hours=26)).isoformat()
        self.fc_humidity = True   # 85: 격자 창 습도(단기 REH)
        # 격자 = [nx, ny, 지사들, 적설, 강수, 최저기온, 최저 시각, 추이{s,p,t,r,vn,pq,sq}, 최고 강수확률, 강수 범위 위쪽, 적설 범위 위쪽] (마이그레이션 34·42·60·62)
        #  적설·강수는 정수(기상청 격자 값). 적설이 있고 강수 0 인 칸 = 12시 '~1mm'(pq), 강수가 있고 적설 0 인 칸 = 14시 '~1cm'(sq) → 범위 위쪽 +1
        def _cell(c):
            s, p, t, k = (c[0] + c[1]) % 7, (c[0] * c[1]) % 9, -float((c[0] * 3 + c[1]) % 12), (c[0] % 10) + 3
            o = ((c[0] + 2 * c[1]) % 10) * 10                    # 최고 강수확률(%): 0~90
            sr = {"s": [1 if 6 <= i < 6 + s else 0 for i in range(24)], "p": [1 if 2 <= i < 2 + p else 0 for i in range(24)], "t": [t + abs(i - k) * 0.5 for i in range(24)],
                  "r": [o if 2 <= i < 8 else max(o - 30, 0) for i in range(24)], "vn": 6}      # vn = 앞 6시각은 초단기예보 값(마이그레이션 60, 서버가 섞어 저장)
            ph, sh = p, s
            if s > 0 and p == 0: sr["pq"] = [1 if i == 12 else 0 for i in range(24)]; ph = 1
            if p > 0 and s == 0: sr["sq"] = [1 if i == 14 else 0 for i in range(24)]; sh = 1
            return [c[0], c[1], sorted(c[2]), s, p, t, (_iss + _dt.timedelta(hours=2 + k)).isoformat(), sr, o, ph, sh]
        self.fc_cells = [_cell(c) for c in _ga["cells"] if c[2]]
        _best = {}
        for nx, ny, bs, s, p, t, ta, _sr, pop, ph, sh in self.fc_cells:
            for b in bs:
                o = _best.setdefault(b, {"branch_id": b, "issued_at": self.fc_issued, "max_snow_24h": -1, "max_pcp_24h": -1, "max_snow_hi": -1, "max_pcp_hi": -1, "max_pop_24h": -1, "min_tmp": 99, "min_tmp_at": None, "worst_nx": nx, "worst_ny": ny, "detail": {"start_at": self.fc_start, "end_at": self.fc_end}})
                if s > o["max_snow_24h"]: o.update(max_snow_24h=s, worst_nx=nx, worst_ny=ny)
                if p > o["max_pcp_24h"]: o["max_pcp_24h"] = p; o["detail"].update(pcp_nx=nx, pcp_ny=ny)
                if t < o["min_tmp"]: o.update(min_tmp=t, min_tmp_at=ta)
                if pop > o["max_pop_24h"]: o["max_pop_24h"] = pop
                o["max_pcp_hi"] = max(o["max_pcp_hi"], ph); o["max_snow_hi"] = max(o["max_snow_hi"], sh)
        self.branch_forecast = list(_best.values()); self.fc_calls = []; self.fc_series_calls = []
        self.branches = [{"id": b, "name": d.replace("지사", ""), "hq_id": h} for _, d, b, h in names]
        self.hqs = [{"id": "H01", "name": "수도권", "sort": 1}, {"id": "H02", "name": "서울경기", "sort": 2}, {"id": "H03", "name": "강원", "sort": 3}, {"id": "H04", "name": "충북", "sort": 4}, {"id": "H07", "name": "광주전남", "sort": 7}]
        self.users["stranger"] = {"id": "id-stranger", "username": "stranger", "password": "Stranger#Pass-123", "profile": None}
        self.add("exdisabled", "비활성지사", "branch", "B001", "Disabled#Pass-123q", disabled=True)
        self.audit = [{"id": 3, "at": "2026-10-02T14:22:22Z", "username": "bootstrap", "role": None, "kind": "계정생성", "tab": "account-admin", "target": "exchungju (branch:B019)", "ip": "203.0.113.5"},
                      {"id": 2, "at": "2026-10-02T14:21:44Z", "username": "bootstrap", "role": None, "kind": "계정생성", "tab": "account-admin", "target": "admin-02 (admin)", "ip": "203.0.113.5"},
                      {"id": 1, "at": "2026-10-02T13:00:00Z", "username": "admin-01", "role": "admin", "kind": "수정", "tab": "vehicles", "target": "vehicles:11가1111", "ip": "198.51.100.2"}]
    def add_request(self, branch_id, section_ids, to=None, reason=None, status="pending", snapshot=None, created_at="2026-10-03T01:00:00Z", note=None):
        """화면 시험에서 미리 넣어 두는 구간 변경 요청"""
        self.rid += 1
        row = {"id": self.rid, "created_at": created_at, "requested_by": None, "branch_id": branch_id, "section_ids": list(section_ids),
               "snapshot": snapshot if snapshot is not None else [{"id": i, "route": "경부선", "from": "A", "to": "B", "km": 2.0, "owner": branch_id} for i in section_ids],
               "to_branch_id": to, "reason": reason, "status": status, "resolved_by": None, "resolved_at": None, "resolution_note": note}
        self.requests.append(row); return row
    def add(self, username, display, role, branch, pw, must_change=False, disabled=False, org=None, hq_id=None, perms=None, sort=None):
        self.n += 1
        self.users[username] = {"id": f"id-{username}", "username": username, "password": pw,
            "profile": {"id": f"id-{username}", "username": username, "display_name": display, "role": role, "branch_id": branch, "org": org, "hq_id": hq_id,
                        "perms": list(default_perms(role) if perms is None else perms), "sort": sort, "must_change": must_change, "disabled": disabled}}
    def can(self, u, perm):
        """private.has_perm 흉내: 관리자는 모든 권한, 나머지는 켜 둔 권한만(임시 비밀번호·비활성은 없음)"""
        p = u and u["profile"]; return bool(p and not p["must_change"] and not p["disabled"] and (p["role"] == "admin" or perm in (p.get("perms") or [])))
    def by_token(self, req):
        m = re.match(r"Bearer (.+)", req.headers.get("authorization", ""))
        uid = self.tokens.get(m.group(1)) if m else None
        return next((u for u in self.users.values() if u["id"] == uid), None)
    def issue(self, u):
        self.n += 1; at, rt = f"at-{self.n}", f"rt-{self.n}"; self.tokens[at] = u["id"]; self.tokens[rt] = u["id"]
        return {"access_token": at, "refresh_token": rt, "expires_in": 3600, "token_type": "bearer", "user": {"id": u["id"]}}
    def active_admin(self, u): p = u and u["profile"]; return bool(p and p["role"] == "admin" and not p["must_change"] and not p["disabled"])
    def usable(self, u): p = u and u["profile"]; return bool(p and not p["must_change"] and not p["disabled"])
    def events_api(self, tbl, req, u, q, body, send):
        """변경 이력 표와 같은 권한 규칙: 읽기=활성 로그인 사용자(임시 비밀번호·비활성 제외), 쓰기=관리자만(종류 검사, 한 줄이라도 틀리면 전부 취소), 지우기·고치기 없음"""
        kinds = {"jurisdiction_events": ("move", "addBranch", "moveHq", "orderBranch"), "grid_events": ("cellAdd", "cellRemove")}[tbl]
        rows = self.events[tbl]
        if self.events_fail and (req.method != "GET" or self.events_fail[0] == "get"):
            return send(*self.events_fail[1])
        if req.method == "GET":
            if not self.usable(u): return send(200, [])
            off, lim = int(q.get("offset", ["0"])[0]), int(q.get("limit", ["1000"])[0])
            return send(200, sorted(rows, key=lambda r: r["id"])[off: off + min(lim, 1000)])        # 서버는 한 번에 최대 1000줄
        if req.method == "POST":
            self.event_calls.append((tbl, body))
            if not self.can(u, "juris.edit" if tbl == "jurisdiction_events" else "grid.edit"): return send(403, {"code": "42501", "message": "new row violates row-level security policy"})
            if not isinstance(body, list) or any(not isinstance(b, dict) or b.get("kind") not in kinds or not isinstance(b.get("payload"), dict) for b in body): return send(400, {"code": "23514", "message": "check violation"})
            for b in body:
                rows.append({"id": len(rows) + 1 + getattr(self, "event_id_base", 0), "at": "2026-10-03T05:00:%02dZ" % (len(rows) % 60), "by_user": u["id"], "kind": b["kind"], "payload": b["payload"], "note": b.get("note")})
            return send(201)
        return send(405, {"message": "no"})
    def save_rpc(self, u, body, send):
        """DB 함수 save_jurisdiction 흉내: 이력 저장 + 요청 승인을 한 번에(하나라도 안 되면 아무것도 안 바뀜)"""
        evs, ids = (body or {}).get("p_events"), (body or {}).get("p_approve") or []
        self.event_calls.append(("save_jurisdiction", body))
        if self.events_fail and self.events_fail[0] != "get": return send(*self.events_fail[1])
        if not self.can(u, "juris.edit"): return send(403, {"code": "42501", "message": "new row violates row-level security policy"})
        if not isinstance(evs, list) or not evs or any(not isinstance(b, dict) or b.get("kind") not in ("move", "addBranch", "moveHq", "orderBranch") or not isinstance(b.get("payload"), dict) for b in evs): return send(400, {"code": "23514", "message": "check violation"})
        reqs = [r for r in self.requests if r["id"] in set(ids)]
        if len(reqs) != len(set(ids)) or any(r["status"] != "pending" for r in reqs): return send(400, {"code": "55000", "message": "request_not_pending"})
        rows = self.events["jurisdiction_events"]
        for b in evs:
            rows.append({"id": len(rows) + 1 + getattr(self, "event_id_base", 0), "at": "2026-10-03T05:00:%02dZ" % (len(rows) % 60), "by_user": u["id"], "kind": b["kind"], "payload": b["payload"], "note": b.get("note")})
        for r in reqs: r["status"] = "approved"; r["resolution_note"] = body.get("p_note") or "관할 변경 저장 시 승인"; r["resolved_by"] = u["id"]
        return send(200, {"events": len(evs), "approved": len(reqs)})
    def requests_api(self, route, req, u, q, body, send):
        """구간 변경 요청 표와 같은 권한 규칙을 흉내: 지사만 요청·자기 지사 것만 읽기·관리자만 승인/반려·지사는 자기 대기 요청만 취소"""
        import re as _re
        p = u["profile"]; usable = self.usable(u); is_branch = self.can(u, "juris.request") and bool(p.get("branch_id")); is_admin = self.can(u, "juris.edit")
        self.req_calls.append((req.method, req.url.split("?", 1)[-1] if "?" in req.url else "", body))
        if getattr(self, "req_fail", None) and req.method != "GET": return send(*self.req_fail)
        def visible(): return list(self.requests) if is_admin else [r for r in self.requests if is_branch and r["branch_id"] == p["branch_id"]]
        if req.method == "GET":
            rows = visible(); st = q.get("status", [""])[0]
            if st.startswith("eq."): rows = [r for r in rows if r["status"] == st[3:]]
            return send(200, sorted(rows, key=lambda r: -r["id"])[: int(q.get("limit", ["200"])[0])])
        if req.method == "POST":
            if not is_branch: return send(403, {"code": "42501", "message": "new row violates row-level security policy"})
            ids = body.get("section_ids") or []
            if not (1 <= len(ids) <= 60 and all(_re.fullmatch(r"S[0-9]{4}", i) for i in ids)) or len(body.get("reason") or "") > 200: return send(400, {"code": "23514", "message": "check violation"})
            if len([r for r in self.requests if r["branch_id"] == p["branch_id"] and r["status"] == "pending"]) >= 20: return send(400, {"code": "54000", "message": "too many pending requests"})
            row = self.add_request(p["branch_id"], ids, to=body.get("to_branch_id"), reason=body.get("reason"), snapshot=body.get("snapshot") or [], created_at="2026-10-03T02:00:00Z")
            row["requested_by"] = u["id"]; return send(201, [row])
        if req.method == "PATCH":
            idf = q.get("id", [""])[0]; stf = q.get("status", [""])[0]
            ids = [int(x) for x in _re.findall(r"\d+", idf)] if idf.startswith(("eq.", "in.")) else []
            rows = [r for r in visible() if r["id"] in ids and (not stf.startswith("eq.") or r["status"] == stf[3:])]
            out = []
            for r in rows:
                if r["status"] != "pending": return send(403, {"code": "42501", "message": "request already resolved"})
                new = body.get("status")
                if is_admin and new in ("approved", "rejected"): r["resolution_note"] = body.get("resolution_note")
                elif is_branch and new == "cancelled" and r["requested_by"] == u["id"]: pass
                else: return send(403, {"code": "42501", "message": "not allowed"})
                r["status"] = new; r["resolved_by"] = u["id"]; r["resolved_at"] = "2026-10-03T03:00:00Z"; out.append(r)
            return send(200, out)
        return send(405, {"message": "no"})
    def handle(self, route):
        req = route.request; url = urlparse(req.url); path, q = url.path, parse_qs(url.query)
        def send(status, body=None, extra=None):
            h = {**CORS, "content-type": "application/json"}; h.update(extra or {})
            route.fulfill(status=status, headers=h, body=json.dumps(body) if body is not None else "")
        if getattr(self, 'down', False): return route.abort()          # 서버에 연결할 수 없는 상황 흉내
        if req.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
        if self.delay: __import__('time').sleep(self.delay)         # 느린 서버 흉내
        body = json.loads(req.post_data) if req.post_data else None
        if path == "/auth/v1/token" and q.get("grant_type") == ["password"]:
            email = (body or {}).get("email", ""); name = email.split("@")[0]; u = self.users.get(name)
            if not u or email != f"{name}@{DOMAIN}" or u["password"] != body.get("password"): return send(400, {"error_code": "invalid_credentials", "msg": "Invalid login credentials"})
            return send(200, self.issue(u))
        if path == "/auth/v1/token" and q.get("grant_type") == ["refresh_token"]:
            uid = self.tokens.get(body.get("refresh_token")); u = next((x for x in self.users.values() if x["id"] == uid), None)
            return send(200, self.issue(u)) if u else send(400, {"error_code": "refresh_token_not_found"})
        if path == "/auth/v1/logout": self.logout_urls = getattr(self, "logout_urls", []) + [req.url]; return send(204)
        u = self.by_token(req)
        if path == "/auth/v1/user" and req.method == "PUT":
            if not u: return send(401, {"msg": "bad jwt"})
            self.put_calls.append(body)
            if body.get("current_password") != u["password"]: return send(400, {"error_code": "current_password_mismatch", "msg": "Incorrect current password"})
            if len(body.get("password", "")) < 12: return send(422, {"error_code": "weak_password"})
            u["password"] = body["password"]; u["profile"]["must_change"] = False       # DB 트리거 흉내
            return send(200, {"id": u["id"]})
        if path.startswith("/rest/v1/"):
            if not u: return send(401, {"message": "JWT required"})
            tbl = path.split("/")[-1]; idf = q.get("id", [""])[0]
            if tbl == "profiles":
                if idf.startswith("eq."): rows = [x["profile"] for x in self.users.values() if x["id"] == idf[3:] and x["profile"]]
                elif self.active_admin(u): rows = sorted([x["profile"] for x in self.users.values() if x["profile"]], key=lambda p: p["username"])
                else: rows = [u["profile"]] if u["profile"] else []
                if not idf.startswith("eq.") and not self.active_admin(u): rows = [r for r in rows if r["id"] == u["id"]]
                return send(200, rows)
            if tbl in ("branches", "hqs"): return send(200, (self.branches if tbl == "branches" else self.hqs) if self.usable(u) else [])
            if tbl == "permissions": return send(200, [{"key": k, "label": l, "description": l + " 설명", "default_roles": r} for k, l, r in PERMS] if self.usable(u) else [])
            if tbl == "equip_orgs": return send(200, [{"name": o} for o in self.orgs] if self.usable(u) else [])
            if tbl == "jurisdiction_requests": return self.requests_api(route, req, u, q, body, send)
            if tbl in self.events: return self.events_api(tbl, req, u, q, body, send)
            if tbl == "snapshots":
                if not self.usable(u) or self.snow_empty: return send(200, [])
                kf, sel = (q.get("key") or [""])[0], (q.get("select") or [""])[0]
                self.snow_selects = getattr(self, "snow_selects", []) + [kf + "|" + sel]
                if getattr(self, "snow_v1", False):                                       # 예전 모양(한 줄에 모든 시즌)
                    if kf not in ("eq.snow", "like.snow*", 'in.("snow")'): return send(200, [])
                    rows = [dict(r, key="snow") for r in json.loads(snow_snapshot_text())]
                else:
                    allrows = snow_v2_rows()
                    if kf == "like.snow*": rows = list(allrows.values())
                    elif kf.startswith("in.("): rows = [allrows[k] for k in re.findall(r'"([^"]+)"', kf) if k in allrows]
                    elif kf.startswith("eq."): rows = [allrows[kf[3:]]] if kf[3:] in allrows else []
                    else: rows = []
                cols = sel.split(",")
                return send(200, [{c: r.get(c) for c in cols} for r in rows])
            if tbl == "snow_daily":                                                       # 관측소 지도 달력에서 받지 않은 시즌의 하루치(auth/snow.js loadDate)
                if not self.usable(u): return send(200, [])
                d = (q.get("date") or [""])[0].replace("eq.", "").replace("-", ""); self.snow_daily_calls.append(d); out = []
                for k, r in snow_v2_rows().items():
                    if k == "snow" or d not in r["body"]["dates"]: continue
                    i = r["body"]["dates"].index(d); out += [{"station_id": int(stn), "value": arr[i]} for stn, arr in r["body"]["st"].items() if arr[i] is not None]
                return send(200, out)
            if tbl == "save_jurisdiction" and "/rpc/" in path: return self.save_rpc(u, body, send)
            if tbl == "branch_forecast": return send(200, self.branch_forecast if self.usable(u) else [])
            if tbl == "forecast_version" and "/rpc/" in path:                               # 83: 예보가 바뀌었는지(작은 조회)
                if not self.usable(u): return send(401, {"message": "login"})
                self.fc_version_calls = getattr(self, "fc_version_calls", 0) + 1
                return send(200, {"c": getattr(self, "fc_ver_c", "c1"), "d": getattr(self, "fc_ver_d", "d1")})
            if tbl == "forecast_daily_cell" and "/rpc/" in path:
                if not self.usable(u): return send(401, {"message": "login"})
                import datetime as dt
                c = next((c for c in self.fc_cells if c[0] == body.get("p_nx") and c[1] == body.get("p_ny")), None)
                if not c: return send(400, {"message": "cell"})
                tz = dt.timezone(dt.timedelta(hours=9)); today = dt.datetime.now(tz).date(); days = []
                for i in range(7):
                    date = today + dt.timedelta(days=i)
                    periods = [{"reg_id":"11D20201" if i<5 else "11D20000", "forecast_at":dt.datetime.combine(date,dt.time(h),tz).isoformat(),"period_hours":12,"sky":"DB01" if i<5 else "WB03","precip":"0" if i<5 else "WB09","pop":0 if i<5 else 60,"weather":"맑음" if i<5 else "구름많고 비","source":"short_land" if i<5 else "midterm_land","issued_at":self.fc_issued} for h in (0,12)]
                    days.append({"date":date.isoformat(),"periods":periods,"tmin":0 if i==0 else -3,"tmax":9,"temperature_source":"grid_aux" if i<5 else "midterm_temperature","tmin_issued_at":self.fc_issued,"tmax_issued_at":self.fc_issued})
                return send(200,{"nx":c[0],"ny":c[1],"status":"ok","region":{"temp_id":"11D20201","land_id":"11D20000","label":"평창군 대관령면","method":"named_place","distance_km":1.2,"short_land_name":"대관령","midterm_land_name":"강원영서"},"days":days})
            if tbl in ("forecast_cell_tail", "forecast_cell_detail") and "/rpc/" in path:
                if not self.usable(u): return send(401, {"message": "login"})
                import datetime as dt
                c = next((c for c in self.fc_cells if c[0] == body.get("p_nx") and c[1] == body.get("p_ny")), None)
                if not c: return send(400, {"message": "cell"})
                start = dt.datetime.fromisoformat(self.fc_end.replace("Z", "+00:00"))
                bins = []
                a = start
                for i in range(8):
                    # Match the real RPC's end-aligned KST00/03/06 bins, including a short first bin.
                    b = dt.datetime.fromtimestamp(((int(a.timestamp())-3600)//10800)*10800+10800, a.tzinfo)
                    expected = int((b-a).total_seconds()/3600)+1
                    hours = expected-1 if i==0 and expected>1 else expected
                    bins.append({"reh": 70.0, "reh_n": hours, "first_at": a.isoformat(), "last_at": b.isoformat(), "hours": hours, "expected_hours": expected, "partial": hours<3, "snow": 3 if i<5 else None, "snow_hi": 4 if i<5 else None, "pcp": 6 if i<5 else None, "pcp_hi": 6 if i<5 else None, "tmin": -2, "pop": 80, "amount_kind":"numeric" if i<5 else "code", "quantity_hours":hours if i<5 else 0, "code_hours":0 if i<5 else hours, "snow_code":None if i<5 else [1,2,0][i-5], "pcp_code":None if i<5 else [2,3,0][i-5]})
                    a = b + dt.timedelta(hours=1)
                payload={"status":"ok", "upper":{"series":(dict(c[7],h=[60+i for i in range(24)]) if self.fc_humidity and isinstance(c[7],dict) else c[7]), "start_at":self.fc_start,"end_at":self.fc_end}, "tail":{"bins":bins}}
                if tbl == 'forecast_cell_detail':
                    # 별도의 가짜 시간별 원값. 실제 코드는3시간합계를나누지않는다.
                    hourly={'s':[],'p':[],'t':[],'r':[],'sq':[],'pq':[],'vn':0}
                    for i in range(24):
                        t=start+dt.timedelta(hours=i)
                        source=next((b for b in bins if dt.datetime.fromisoformat(b['first_at'])<=t<=dt.datetime.fromisoformat(b['last_at'])),None)
                        numeric=source is not None and source['amount_kind']=='numeric'
                        for k,v in [('s',1 if numeric else None),('p',2 if numeric else None),('t',-2 if source else None),('r',80 if source else None),('sq',False if numeric else None),('pq',False if numeric else None)]:hourly[k].append(v)
                    if self.fc_humidity: hourly['h']=[85]*24
                    payload['hourly_tail']={'start_at':start.isoformat(),'end_at':(start+dt.timedelta(hours=24)).isoformat(),'series':hourly}
                return send(200,payload)
            if tbl == "forecast_grid" and "/rpc/" in path:
                if not self.usable(u): return send(401, {"message": "login"})
                ids = set((body or {}).get("p_branches") or []); ser = bool((body or {}).get("p_series"))
                if ser and len(ids) > 1: return send(400, {"message": "series for one branch only"})
                (self.fc_series_calls if ser else self.fc_calls).append(sorted(ids))
                return send(200, {"tmfc": self.fc_issued, "start_at": self.fc_start, "end_at": self.fc_end,
                                  "cells": [[nx, ny, [b for b in bs if b in ids], s, p, t, ta, sr if ser else None, pop, ph, sh] for nx, ny, bs, s, p, t, ta, sr, pop, ph, sh in self.fc_cells if ids & set(bs)]})
            if tbl == "warning_status" and "/rpc/" in path:
                self.eq_calls.append((tbl, body)); return send(200, self.warn_status) if self.usable(u) else send(401, {"message": "login"})
            if tbl in ("save_fleet", "save_requests") and "/rpc/" in path:
                self.eq_calls.append((tbl, body))
                if tbl == "save_fleet":
                    # 지원일 칸(마이그레이션 49): 전부 = equip.route(관리자), 아니면 자기 기관 장비만('모든 기관' 권한이 있어도)
                    route_ok = lambda vid: self.can(u, "equip.route") or ((self.can(u, "equip.edit.own") or self.can(u, "equip.edit.all")) and next((v for v in self.vehicles if v["id"] == vid), {}).get("org") == u["profile"].get("org"))
                    ok = lambda vid: self.can(u, "equip.edit.all") or (self.can(u, "equip.edit.own") and next((v for v in self.vehicles if v["id"] == vid), {}).get("org") == u["profile"].get("org"))
                    st, rid = body.get("p_status") or [], body.get("p_round")
                    if any("status" in v for v in body["p_vehicles"]) or ((body["p_routes"] or st) and not any(r["id"] == rid for r in self.rounds)): return send(400, {"code": "22023", "message": "bad input"})
                    if any(not ok(v["id"]) for v in body["p_vehicles"]) or any(not ok(x["vehicle_id"]) for x in st) or any(not route_ok(r["vehicle_id"]) for r in body["p_routes"]): return send(403, {"code": "42501", "message": "route not allowed"})
                    if any(x.get("status") not in ("", "O") or x.get("off_from") for x in st): return send(400, {"code": "23514", "message": "new row violates check constraint"})   # 66: 빈칸·지원만, 지원 불가 시작일 없음
                    allowed_crew='abcdefghijklmnopqrstuvwxyz가나다라마바사아자차카타파하'
                    if any('crew' in x and (not isinstance(x['crew'],list) or len(x['crew'])>2 or any(not isinstance(c,str) or len(c)!=1 or c not in allowed_crew for c in x['crew']) or len(set(x['crew']))!=len(x['crew'])) for x in st): return send(400, {'code':'23514','message':'bad crew'})
                    for x in st:
                        cur = next((y for y in self.rstatus if y["round_id"] == rid and y["vehicle_id"] == x["vehicle_id"]), None)
                        if not cur: cur = {"round_id": rid, "vehicle_id": x["vehicle_id"]}; self.rstatus.append(cur)
                        cur.update(status=x["status"], off_from=x.get("off_from") if x["status"] == "O" else None, updated_at="2026-10-08T01:00:00Z")
                    for r in body["p_routes"]:
                        self.routes = [x for x in self.routes if not (x["date"] == r["date"] and x["vehicle_id"] == r["vehicle_id"])] + ([r] if r["stops"] else [])
                    return send(200, {"vehicles": len(body["p_vehicles"]), "status": len(st), "routes_saved": len(body["p_routes"]), "routes_deleted": 0})
                # save_requests: 실제로 반영(서버 트리거 흉내 — 확정한 줄은 확정 열 말고는 못 바꿈 55000, 확정·편성은 req.confirm)
                rid = body["p_round"]; LOCK = ("req_truck", "req_blower", "assigned_truck", "assigned_blower", "arrive_at", "reason", "wx_manual", "wx_snow", "wx_pcp", "wx_tmin", "wx_tmin_at", "wx_level", "wx_fc", "wx_ef")
                for r in body["p_rows"]:
                    cur = next((x for x in self.round_reqs if x["round_id"] == rid and x["branch_id"] == r["branch_id"]), None)
                    if "expect_at" in r and (cur or {}).get("updated_at") != r["expect_at"]: return send(400, {"code": "SA007", "message": "row changed"})   # 마이그레이션 56
                    if cur and cur.get("confirmed") and any(k in LOCK and r[k] != cur.get(k) for k in r): return send(400, {"code": "55000", "message": "confirmed row is locked"})
                    if not self.can(u, "req.confirm") and any(k in r for k in ("assigned_truck", "assigned_blower", "confirmed")): return send(403, {"code": "42501", "message": "assignment needs req.confirm"})
                versions = {}
                for r in body["p_rows"]:
                    cur = next((x for x in self.round_reqs if x["round_id"] == rid and x["branch_id"] == r["branch_id"]), None)
                    if not cur: cur = {"round_id": rid, "branch_id": r["branch_id"], "req_truck": 0, "req_blower": 0, "assigned_truck": 0, "assigned_blower": 0, "confirmed": False}; self.round_reqs.append(cur)
                    cur.update({k: v for k, v in r.items() if k not in ("branch_id", "expect_at")})
                    versions[r["branch_id"]] = cur["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                    if "confirmed" not in r or any(k not in ("branch_id", "confirmed", "expect_at") for k in r):       # 누가 저장했는지(마이그레이션 50) — 확정·취소만이면 남기지 않음
                        cur.update(saved_at="2026-11-02T04:00:00Z", saved_lv="admin" if self.can(u, "req.confirm") else "hq" if self.can(u, "req.edit.hq") else "branch")
                return send(200, {"rows": len(body["p_rows"]), "versions": versions})
            if tbl == "create_round" and "/rpc/" in path:          # 새 기준일자 + 전체 장비 지원 여부 줄: 빈칸, 새 기간에 경로가 잡힌 지원 장비만 유지(마이그레이션 63)
                self.eq_calls.append((tbl, body)); d = body["p_date"]
                if not self.can(u, "req.confirm"): return send(403, {"code": "42501", "message": "no"})
                if any(r["start_date"] >= d for r in self.rounds): return send(400, {"code": "23514", "message": "round must start after the latest one"})
                prev = max(self.rounds, key=lambda r: r["start_date"]) if self.rounds else None
                nr = {"id": max([r["id"] for r in self.rounds] + [0]) + 1, "name": d + " 기준", "start_date": d, "days": 10}; self.rounds.append(nr)
                for v in self.vehicles:
                    if v.get("hidden_after") and d > v["hidden_after"]: continue
                    p = next((x for x in self.rstatus if prev and x["round_id"] == prev["id"] and x["vehicle_id"] == v["id"]), None)
                    keep = bool(p) and p["status"] == "O" and any(x["vehicle_id"] == v["id"] and x["date"] >= d and x["stops"] and (not p.get("off_from") or x["date"] < p["off_from"]) for x in self.routes)
                    self.rstatus.append({"round_id": nr["id"], "vehicle_id": v["id"], "status": "O" if keep else "", "crew": list(p.get("crew",[])) if p else [], "off_from": p.get("off_from") if keep and (p.get("off_from") or "") > d else None, "updated_at": "2026-10-08T00:00:00Z"})
                return send(200, dict(nr, carried=len(self.vehicles)))
            if tbl in ("gw_team", "gw_team_routes", "gw_team_status") and req.method == "GET":     # 강원 신속대응팀(마이그레이션 48): 4대 고정, 경로·지원 여부는 비어 있음
                if not self.usable(u): return send(200, [])
                return send(200, [{"id": g, "name": n, "sort": i + 1} for i, (g, n) in enumerate([("GW1", "원주"), ("GW3", "대관령"), ("GW4", "강릉"), ("GW2", "양양")])] if tbl == "gw_team" else [])
            if tbl == "round_vehicle_status" and req.method == "GET":
                if not self.usable(u): return send(200, [])
                return send(200, [x for x in self.rstatus if "eq.%d" % x["round_id"] in q.get("round_id", [""])])
            if tbl == "vehicles" and req.method == "PATCH":         # 숨기기·숨김 취소(관리자만)
                self.eq_calls.append(("vehicles.patch", body))
                if not self.can(u, "equip.edit.all"): return send(200, [])
                vid = q.get("id", [""])[0].replace("eq.", "", 1); v = next((x for x in self.vehicles if x["id"] == vid), None)
                if not v: return send(200, [])
                v.update(body); return send(200, [{"id": vid, "hidden_after": v.get("hidden_after")}])
            if tbl in ("vehicles", "vehicle_routes", "support_rounds", "round_requests") and req.method == "GET":
                if not self.usable(u): return send(200, [])
                if tbl == "vehicles":                                  # 실제 서버처럼 한 번에 최대 1000줄(limit·offset 으로 나눠 읽어야 다 받음)
                    off, lim = int(q.get("offset", ["0"])[0]), int(q.get("limit", ["1000"])[0])
                    return send(200, self.vehicles[off: off + min(lim, 1000)])
                if tbl == "support_rounds": return send(200, self.rounds)
                if tbl == "round_requests": return send(200, [r for r in self.round_reqs if "eq.%d" % r["round_id"] in q.get("round_id", [""])])
                rows = self.routes; dates = q.get("date", [])
                for c in dates:
                    op, v = c.split(".", 1); rows = [r for r in rows if (r["date"] >= v if op == "gte" else r["date"] <= v)]
                if q.get("vehicle_id"): rows = [r for r in rows if "eq." + r["vehicle_id"] == q["vehicle_id"][0]]
                return send(200, rows)
            if tbl == "audit_log":
                rows = self.audit if self.can(u, "log.view") else []
                k = q.get("kind", [""])[0]
                if k.startswith("eq."): rows = [r for r in rows if r["kind"] == k[3:]]
                return send(200, rows)
            return send(404, {"message": "no table"})
        if path == "/functions/v1/account-admin":
            if not self.active_admin(u): return send(403, {"ok": False, "error": "forbidden", "message": "관리자만 할 수 있는 작업입니다."})
            self.fn_calls.append(body)
            if self.fn_override:
                r = self.fn_override(body)
                if r: return send(*r)
            a = body.get("action")
            if a == "set_passwords":
                for it in body["items"]:
                    x = self.users.get(it["username"]); x["password"] = it["password"]; x["profile"]["must_change"] = body.get("require_change", True)
                return send(200, {"ok": True, "updated": len(body["items"]), "failed": [], "require_change": body.get("require_change", True)})
            if a == "reset":
                x = self.users[body["username"]]; x["password"] = "Tmp#Reset-Zx98Yw76"; x["profile"]["must_change"] = True
                return send(200, {"ok": True, "username": x["username"], "creds": [{"username": x["username"], "temp_password": "Tmp#Reset-Zx98Yw76"}]})
            if a == "create":
                if any(x.get("role") == "admin" for x in body["users"]): return send(400, {"ok": False, "error": "validation", "message": "입력을 확인하세요.", "details": [{"index": 0, "username": "x", "error": "관리자 계정은 여기서 만들 수 없음"}]})
                taken = [x["username"] for x in body["users"] if x["username"] in self.users]
                if taken: return send(409, {"ok": False, "error": "exists", "message": "이미 있는 아이디가 있습니다.", "details": taken})
                creds = []
                for i, x in enumerate(body["users"]):
                    pw = "Tmp#New-%02dAbCd%02d" % (i, i)
                    self.add(x["username"], x["display_name"], x["role"], x.get("branch_id"), pw, must_change=True, org=x.get("org"), hq_id=x.get("hq_id"), perms=x.get("perms"), sort=x.get("sort"))
                    creds.append({"username": x["username"], "display_name": x["display_name"], "role": x["role"], "temp_password": pw})
                return send(201, {"ok": True, "created": len(creds), "failed": [], "creds": creds})
            if a == "update":
                done, failed = 0, []
                for it in body["items"]:
                    x = self.users.get(it["username"])
                    if not x or not x["profile"]: failed.append({"username": it["username"], "error": "계정을 찾을 수 없음"}); continue
                    if x["profile"]["role"] == "admin": failed.append({"username": it["username"], "error": "관리자 계정은 모든 권한이 있어 고칠 것이 없음"}); continue
                    for k in ("display_name", "perms", "sort"):
                        if k in it: x["profile"][k] = it[k]
                    done += 1
                return send(207 if failed else 200, {"ok": not failed, "updated": done, "failed": failed})
            if a in ("disable", "enable"):
                x = self.users[body["username"]]; x["profile"]["disabled"] = (a == "disable"); return send(200, {"ok": True, "username": x["username"], "disabled": a == "disable"})
            return send(400, {"ok": False, "error": "bad_action", "message": "알 수 없는 작업"})
        return send(404, {"message": "unknown"})


def session_for(mock, username, persist=True, auto_days=30):
    """이미 로그인한 상태의 저장소 내용을 만들어 줌 (화면 시험이 로그인 과정을 건너뛸 때 사용)"""
    u = mock.users[username]; tok = mock.issue(u)
    return {"access_token": tok["access_token"], "refresh_token": tok["refresh_token"], "expires_at": int(time.time() * 1000) + 3600 * 1000,
            "user_id": u["id"], "persist": persist, "auto_until": int(time.time() * 1000) + auto_days * 86400 * 1000, "username": username}

def install(page, mock, username="admin-01"):
    """페이지에 가짜 서버를 연결하고, 해당 계정으로 이미 로그인한 상태로 시작하게 함"""
    page.route(SB + "/**", mock.handle)
    s = session_for(mock, username)
    page.add_init_script("try { localStorage.setItem('ss_session', %s); } catch (e) {}" % json.dumps(json.dumps(s)))
    return s
