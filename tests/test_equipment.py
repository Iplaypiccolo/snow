"""
장비 지원 페이지 자동 테스트 (샘플 모드 ?sample=1 — 서버 없이 같은 권한 규칙을 흉내 내는 샘플 자료로)
- 하는 일: 브라우저를 직접 띄워서 권한별 화면, 날짜별 경로 확정·기록 유지, 기준일자·확정 지사, 이동 현황 계층, 수정 기록 말풍선 등을 확인합니다.
  하나라도 틀리면 FAIL 로 표시하고 종료 코드 1을 돌려줍니다.
- 실행 방법 (저장소 맨 위 폴더에서):
      pip install playwright
      playwright install chromium
      python tests/test_equipment.py
"""
import functools, http.server, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
# 여러 요청을 동시에 처리(한 번에 하나씩이면 큰 JSON 을 보내는 동안 스크립트 요청이 밀려 시험이 시간 초과로 흔들림)
socketserver.ThreadingTCPServer.daemon_threads = True
server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
PORT = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/equipment/index.html?sample=1"

results, errors = [], []
def check(cond, msg):
    if not cond: raise AssertionError(msg)

def run(name, fn, pw_browser):
    page = pw_browser.new_page(viewport={"width": 1440, "height": 1000})
    page.on("pageerror", lambda e: None if "새로 불러옵니다" in str(e) else errors.append(f"[{name}] {e}"))   # 예전 틀 감지 후 일부러 멈추는 것은 오류 아님
    page.on("dialog", lambda d: d.accept())
    page.goto(URL); page.wait_for_selector("#matrix tbody tr", timeout=15000)
    try:
        fn(page); results.append((name, True, ""))
    except Exception as e:
        results.append((name, False, f"{e.__class__.__name__}: {e}"))
    finally:
        page.close()

def ev(p, js): return p.evaluate(js)
def as_user(p, uid): p.select_option("#userSel", uid); p.wait_for_timeout(200)
def tab(p, t): p.click(f"[data-tab={t}]"); p.wait_for_timeout(150)
def day(p, n): return ev(p, f"addDays(todayISO(), {n})")
def go_date(p, iso): p.fill("#dateInput", iso); p.dispatch_event("#dateInput", "change"); p.wait_for_timeout(200)
def toast(p): return p.locator("#toast").inner_text()
def route(p, vid, d): return ev(p, f"routeOf('{d}', '{vid}').map(bn)")
def rsel(vid, d, j=0): return f"select[data-fk='r:{d}:{vid}:{j}']"
def confirm_fleet(p): p.click("#save-fleet [data-save]"); p.wait_for_timeout(300)
def save_branch(p):          # 지사별 요청·편성: 고친 줄마다 그 줄 [저장](아래 저장 막대는 2026-11-01 없앰)
    for _ in range(40):
        bs = p.locator("#branchTable tr.changed [data-rsave]"); n = bs.count()
        if not n: break
        bs.first.click(); p.wait_for_timeout(300)
        if p.locator("#branchTable tr.changed [data-rsave]").count() >= n: break
def rows(p): return [t.strip() for t in p.locator("#matrix tbody tr th[scope=row]").all_inner_texts()]
def hqs(p): return [t.replace("\n", "") for t in p.locator("#matrix tbody th.hqc").all_inner_texts()]
def bid(p, name): return ev(p, f"S.branches.find(b => b.name === '{name}').id")

# ---------------------------------------------------------------- 테스트 목록
def t_load(p):
    names = p.locator(".tab:visible").all_inner_texts()
    check(names == ["이동 현황", "지사별 요청·편성", "기관별 장비", "기관별 배치", "강원본부 지원장비", "로그 기록"], names)   # 2026-10-30 순서 바꿈, 강원본부 지원장비(관리자·강원본부만)
    check(p.locator("#dateInput").input_value() == day(p, 0), "오늘 날짜로 시작")
    check(not p.locator("#loading").is_visible(), "불러오는 중 표시가 사라져야 함")

def t_move_hierarchy(p):
    """이동 현황: 본부 → 지사 계층, 그날 지원받는 지사만, 본부 줄은 장비 1대를 한 번만 셈"""
    check(rows(p) == ["대관령", "양양", "엄정"] and hqs(p) == ["강원", "충북"] and p.locator("#matrix tbody th.hqc").first.get_attribute("rowspan") == "2" and p.locator("#matrix tbody tr.hqrow").count() == 0, (rows(p), hqs(p)))
    head = p.locator("#matrix thead").inner_text(); check("제설차" in head and "제설기" in head and "이동정비차" not in head and "차 " not in p.locator("#matrix").inner_text(), "제설차·제설기로 정확히, 이동정비차 없음")
    hd = [h.strip() for h in p.locator("#matrix thead tr").first.locator("th").all_inner_texts()]
    check(hd[0].startswith("본부") and hd[1] == "합계" and hd[2].startswith("서울경기"), f"합계 열이 지사 이름과 첫 지원기관 사이: {hd[:3]}")
    check(p.locator("#moveTitle").inner_text().endswith("장비 지원 현황") and p.locator("#perm-move").count() == 0 and "어느 기관에서" not in p.locator("body").inner_text(), "제목·안내 정리")
    go_date(p, day(p, 2))            # 모레: V001(제설차)이 대관령 → 양양 두 곳
    go_date(p, day(p, -7))
    check(rows(p) == ["춘천", "엄정"] and hqs(p) == ["강원", "충북"], (rows(p), hqs(p)))
    go_date(p, day(p, 30)); check("이동하는 장비가 없습니다" in p.locator("#matrix").inner_text(), "빈 날")
    check(p.locator("#destList .hq-head").count() == 0, "카드 없음")

def t_dest_order_and_day_tag(p):
    heads = p.locator("#destList .hq-head").all_inner_texts(); check(heads == ["강원본부", "충북본부"], heads)
    check(p.locator(".frow .flabel").all_inner_texts() == ["지원기관", "장비"] and p.locator("[data-type='이동정비차']").count() == 0, "필터: 지원기관·장비 두 줄, 이동정비차 없음")
    check("이동정비차" not in p.locator("#destList").inner_text() and "편성 제설차" not in p.locator("#destList").inner_text(), "장비 세부에 이동정비차·편성 대수 없음")
    card = p.locator("#destList .dest").first
    check("도착 예상" in card.locator(".dest-time").inner_text() and "21:30" in card.locator(".dest-time").inner_text() and card.locator(".tag.req").count() == 0, "큰 시각 = 도착 예상, 장비가 있는 카드에는 도착 요청 표지 없음")
    names = p.locator("#destList .dest-name").evaluate_all("hs => hs.map(h => h.childNodes[0].textContent.trim())"); check(names == ["대관령", "양양", "엄정"], names)
    v1 = p.locator(".vrow[data-vid=V001]").first.inner_text(); check("일차" not in v1, v1)
    go_date(p, day(p, 1)); check("일차" not in p.locator(".vrow[data-vid=V001]").first.inner_text(), "다음 날에도 일차 표시 없음")
    p.click("[data-type='제설기']"); check(all("제설기" in x for x in p.locator("#destList .vrow").all_inner_texts()), "장비 거르기")

def t_route_choices_confirmed_only(p):
    """경로의 피지원 지사는 고른 기준일자에서 편성이 확정된 지사만(춘천은 요청만 하고 미확정)"""
    tab(p, "fleet"); d0 = day(p, 0)
    opts = p.locator(rsel("V004", d0) + " option:not([disabled])").all_inner_texts()
    check([o for o in opts if o not in ("지사 선택", "지우기")] == ["대관령", "양양", "엄정"], opts)
    old = ev(p, "S.rounds.find(r => r.start_date === addDays(todayISO(), -7)).id")
    p.select_option("#roundSelFleet", str(old)); p.wait_for_timeout(300)
    check(p.locator("#day1In").input_value() == day(p, -7), "기준일자를 고르면 지원일 1도 그 날짜로")
    opts = p.locator(rsel("V004", day(p, -7)) + " option").all_inner_texts()
    check([o for o in opts if o not in ("지사 선택", "지우기")] == ["춘천", "엄정"], opts)
    check(p.locator(rsel("V024", day(p, -7))).input_value() == bid(p, "춘천"), "지난 기록이 그대로 보임")

def t_confirm_keeps_history(p):
    """오늘 다른 지사로 확정해도 지난 날짜 경로는 남는다 — (날짜, 장비)마다 따로 저장"""
    tab(p, "fleet"); d0 = day(p, 0)
    p.select_option(rsel("V005", d0), bid(p, "대관령")); p.wait_for_timeout(200)
    check(p.locator(rsel("V005", d0)).evaluate("e => e.closest('.slot').classList.contains('changed')"), "확정 전 칸 표시")
    check("경로 1칸" in p.locator("#save-fleet .save-state").inner_text(), p.locator("#save-fleet .save-state").inner_text())
    confirm_fleet(p); check("확정했습니다" in toast(p), toast(p))
    check(ev(p, "S.draft.size") == 0 and route(p, "V005", d0) == ["대관령"], "확정 후 값")
    tab(p, "move"); p.click(".vrow[data-vid=V005]"); p.wait_for_selector("ol.vhist li")
    hist = p.locator("ol.vhist").inner_text(); check("엄정" in hist and "대관령" in hist and hist.count("\n") >= 2, hist)
    p.click("#sheetClose")
    go_date(p, day(p, -7)); check(p.locator(".vrow[data-vid=V005]").count() == 1, "1주 전 이동 기록 그대로")

def t_day1_header_and_columns(p):
    tab(p, "fleet")
    heads = lambda: [h.split("\n")[0][:5] for h in p.locator("#eqTable thead th.dayh").all_inner_texts()]
    check(heads() == ["지원일 1", "지원일 2", "지원일 3", "지원일 4"], heads())
    check(p.locator("#eqTable select[data-rv='V001']").count() >= 4, "장비마다 날짜 칸")
    p.fill("#day1In", day(p, 2)); p.dispatch_event("#day1In", "change"); p.wait_for_timeout(250)
    check(p.locator(rsel("V001", day(p, 2), 0)).input_value() == bid(p, "대관령") and p.locator(rsel("V001", day(p, 2), 1)).input_value() == bid(p, "양양"), "지원일 1을 옮기면 모든 칸이 그 날짜부터")
    check(p.locator("#eqTable thead th.dayh").nth(1).inner_text().find(ev(p, f"fmtMD('{day(p, 3)}')")) >= 0, "지원일 2 제목 = 다음 날")
    p.select_option("#colsSel", "10"); p.wait_for_timeout(200); check(len(heads()) == 10, "10칸")
    p.select_option("#colsSel", "2"); p.wait_for_timeout(200); check(len(heads()) == 2, "2칸")
    as_user(p, "eq-sg"); tab(p, "fleet")
    check(p.locator("#day1In").count() == 0 and "지원일 1" in p.locator("#eqTable thead").inner_text(), "지원장비 계정은 지원일 1 날짜를 못 바꿈(보기만)")

def t_multi_stop_add_and_delete(p):
    tab(p, "fleet"); d1 = day(p, 1)
    p.click(f"[data-stop-add='{d1}|V002']"); p.wait_for_timeout(150)
    p.select_option(f"select[data-fk='rn:{d1}:V002:1']", bid(p, "양양")); p.wait_for_timeout(200)
    check(route(p, "V002", d1) == ["대관령", "양양"], route(p, "V002", d1))
    p.select_option(rsel("V002", d1, 0), "__del"); p.wait_for_timeout(200)
    check(route(p, "V002", d1) == ["양양"], "지우기")
    p.select_option(rsel("V002", d1, 0), "__del"); p.wait_for_timeout(200)
    check(route(p, "V002", d1) == [] and ev(p, f"S.draft.get('{d1}|V002').stops.length") == 0, "모두 지우면 빈 경로(확정하면 그 날짜 줄 삭제)")
    confirm_fleet(p); check(ev(p, f"S.routes.has('{d1}|V002')") is False, "확정 후 서버에서도 삭제")

def t_route_revisit_and_order(p):
    """2026-11-04(64): 같은 지사를 다시 들를 수 있음(A→B→A), 바로 연달아는 하나로. 아래 칸 시각은 앞 지사보다 늦어야(같은 시각도 안 됨)"""
    tab(p, "fleet"); d = day(p, 1)
    vid = ev(p, f"(() => {{ const v = S.vehicles.find(v => !v.round_id && v.type === '제설차' && stOf(S.round, v.id).status === 'O' && !routeOf('{d}', v.id).length && document.querySelector(`select[data-fk='r:{d}:${{v.id}}:0']`)); return v && v.id; }})()")
    check(bool(vid), "빈 경로 장비 하나")
    opts = [o for o in p.locator(rsel(vid, d) + " option").evaluate_all("os => os.filter(o => /^B/.test(o.value) && !o.disabled).map(o => o.value)")]
    prev = ev(p, f"routeOf(addDays('{d}', -1), '{vid}').slice(-1)[0] || ''"); opts = [o for o in opts if o != prev]   # 연속지원(첫 시각 숨김)이 아니게
    A, B = opts[0], opts[1]
    p.select_option(rsel(vid, d), A); p.wait_for_timeout(200)
    p.click(f"[data-stop-add='{d}|{vid}']"); p.wait_for_timeout(150); p.select_option(f"select[data-fk='rn:{d}:{vid}:1']", B); p.wait_for_timeout(200)
    ti = lambda j: f"input[data-fk='t:{d}:{vid}:{j}']"
    p.fill(ti(0), "1300"); p.press(ti(0), "Tab"); p.wait_for_timeout(150)
    p.fill(ti(1), "1100"); p.press(ti(1), "Tab"); p.wait_for_timeout(200)
    check("늦어야" in toast(p) and p.locator(ti(1)).input_value() == "" and ev(p, f"recOf('{d}', '{vid}').times") == ["13:00", None], "앞 지사(13:00)보다 이른 11:00 은 안내하고 비움: " + toast(p))
    p.fill(ti(1), "1300"); p.press(ti(1), "Tab"); p.wait_for_timeout(200)
    check(p.locator(ti(1)).input_value() == "" and ev(p, f"recOf('{d}', '{vid}').times[1]") is None, "같은 시각(13:00)도 안 됨")
    p.fill(ti(1), "1500"); p.press(ti(1), "Tab"); p.wait_for_timeout(200)
    check(ev(p, f"recOf('{d}', '{vid}').times") == ["13:00", "15:00"], "15:00 은 됨")
    p.click(f"[data-stop-add='{d}|{vid}']"); p.wait_for_timeout(150); p.select_option(f"select[data-fk='rn:{d}:{vid}:2']", A); p.wait_for_timeout(200)
    check(ev(p, f"routeOf('{d}', '{vid}')") == [A, B, A], f"A→B→A 다시 들르기: {ev(p, f'routeOf(`{d}`, `{vid}`)')}")
    p.fill(ti(2), "1700"); p.press(ti(2), "Tab"); p.wait_for_timeout(200)
    check(ev(p, f"recOf('{d}', '{vid}').times") == ["13:00", "15:00", "17:00"], "17:00")
    p.click(f"[data-stop-add='{d}|{vid}']"); p.wait_for_timeout(150); p.select_option(f"select[data-fk='rn:{d}:{vid}:3']", A); p.wait_for_timeout(200)
    check("바로 앞과 같은 지사" in toast(p) and ev(p, f"routeOf('{d}', '{vid}')") == [A, B, A], "바로 연달아 같은 지사는 하나로(안내)")
    confirm_fleet(p); check("확정했습니다" in toast(p) and ev(p, f"S.routes.get(rk('{d}', '{vid}')).stops") == [A, B, A], "확정: " + toast(p))
    # 확정 전 한 번 더: 순서가 어긋난 칸이 남아 있으면 확정하지 않음
    ev(p, f"(S.draft.set(rk('{d}', '{vid}'), {{ stops: ['{A}', '{B}'], times: ['14:00', '12:00'], revised: false }}), updateSavebars())")
    confirm_fleet(p); check("늦어야" in toast(p) and ev(p, f"S.draft.has(rk('{d}', '{vid}'))"), "어긋난 시각이 남으면 확정 안 함: " + toast(p))
    ev(p, "(S.draft.clear(), refresh())")
    # 같은 지사를 두 번 들를 때 '지금 위치 이후의 방문'
    check(ev(p, f"occAt(['{A}', '{B}', '{A}'], '{A}', 1)") == 2 and ev(p, f"occAt(['{A}', '{B}', '{A}'], '{A}', 0)") == 0 and ev(p, f"occAt(['{A}', '{B}'], '{A}', 1)") == -1, "occAt")

def t_status_maintenance(p):
    tab(p, "fleet"); d0 = day(p, 0)
    opts = [o.get_attribute("value") for o in p.locator("[data-vs=V002] option").all()]
    check(opts == ["", "O"] and p.locator("[data-vs=V002] option").all_inner_texts() == ["", "지원"], f"지원 여부 = 빈칸 · 지원만(2026-11-04, 지원 불가·정비중 없앰): {opts}")
    p.select_option("[data-vs=V002]", ""); p.wait_for_timeout(250)
    check(p.locator(rsel("V002", d0)).input_value() == "" and route(p, "V002", d0) == ["대관령"] and ev(p, f"effRec('{d0}', 'V002').stops.length") == 0, "빈칸이면 경로를 지우지 않고 숨김(되돌리면 다시 보임)")
    check(p.locator(rsel("V002", d0)).is_disabled(), "빈칸이면 경로 입력 잠금")
    check(ev(p, "stOf(S.round, 'V002').status") == "" and ev(p, "vehById('V002').status") == "O", "지원 여부는 고른 기준일자에만(장비 줄 값은 그대로)")
    check("정비중" not in p.locator("#fleetSum tbody").inner_text() and "지원 불가" not in p.locator("#fleetSum tbody").inner_text(), "장비 현황 표에 지원 불가·정비중 없음")
    p.click("#save-fleet [data-revert]"); p.wait_for_timeout(200)
    check(route(p, "V002", d0) == ["대관령"] and p.locator("[data-vs=V002]").input_value() == "O", "되돌리기")

def t_reset_button(p):
    tab(p, "fleet"); p.click("[data-fo='서울경기']"); p.wait_for_timeout(150)
    p.click("#fleetReset"); p.wait_for_timeout(250)
    sg = ev(p, "S.vehicles.filter(v => v.org === '서울경기').map(v => v.id)")
    check(all(ev(p, f"windowDates().every(d => routeOf(d, '{v}').length === 0) && stOf(S.round, '{v}').status === ''") for v in sg), "서울경기 장비 칸이 모두 비워짐")
    check(route(p, "V014", day(p, 0)) == ["양양"], "보이지 않는(다른 기관) 장비는 그대로")
    check(ev(p, "S.routes.get(rk(todayISO(), 'V001'))") is not None, "확정 전에는 서버 값 그대로")
    p.click("#save-fleet [data-revert]"); p.wait_for_timeout(200); check(route(p, "V001", day(p, 0)) == ["대관령"], "되돌리기로 복구")

def t_permissions_equip_own(p):
    """지원장비(충북): 자기 기관 장비 추가·도공번호·지원 여부만. 경로·삭제·지원일 1·초기화는 관리자. 지사는 아무것도 못 고침"""
    as_user(p, "eq-cb"); tab(p, "fleet")
    check(p.locator("#logTabBtn").is_hidden(), "로그 탭 숨김")
    check(p.locator("[data-vs=V013]").count() == 1 and p.locator("[data-vp=V013]").count() == 1 and p.locator("[data-vs=V001]").count() == 0, "충북 장비의 도공번호·지원 여부만")
    check(p.locator("select[data-rv]").count() == 0, "경로 칸은 보기만")
    check(p.locator("#day1In").count() == 0 and p.locator("#fleetReset").count() == 0, "지원일 1·초기화 없음")
    check(p.locator("#colsSel").count() == 0 and p.locator("#eqTable thead th.dayh").count() == 4, "지원일 칸 수 고르기는 관리자만(다른 계정은 기본 4칸, 2026-10-11)")
    as_user(p, "admin1"); tab(p, "fleet"); p.select_option("#colsSel", "6"); p.wait_for_timeout(200); check(p.locator("#eqTable thead th.dayh").count() == 6, "관리자는 6칸으로")
    as_user(p, "eq-cb"); tab(p, "fleet"); check(p.locator("#colsSel").count() == 0 and p.locator("#eqTable thead th.dayh").count() == 4, "관리자가 늘려 둔 뒤에도 다른 계정은 4칸")
    check(p.locator("[data-vdel]").count() == 0 and "삭제" not in p.locator("#eqTable thead").inner_text(), "장비 삭제 버튼은 지원장비 계정에 없음(관리자만)")
    check(p.locator("[data-vb=V013]").count() == 2 and p.locator("[data-vb=V013][data-bf=blower_s]").is_enabled() == (ev(p, "vehById('V013').type") == "제설기"), "블로워 칸: 제설기일 때만 켜짐")
    check(p.locator("#nvOrg option").all_inner_texts() == ["충북"], "장비 추가는 자기 기관만")
    p.fill("#nvPlate", "950"); p.click("#vehAdd"); p.wait_for_timeout(250); check("추가했습니다" in toast(p), toast(p))
    p.select_option("[data-vs=V013]", "O" if ev(p, "stOf(S.round, 'V013').status") != "O" else ""); p.wait_for_timeout(150); s13 = ev(p, "stOf(S.round, 'V013').status"); confirm_fleet(p); check("확정했습니다" in toast(p) and ev(p, "S.rstat.get(S.round + '|V013').status") == s13, toast(p))
    check(route(p, "V014", day(p, 0)) == ["양양"], "지원장비가 지원 여부를 바꿔도 경로는 그대로(경로는 관리자)")
    ev(p, f"S.draft.set(rk('{day(p, 3)}', 'V014'), {{ stops: ['{bid(p, '양양')}'], revised: false, times: [null] }}), updateSavebars()"); confirm_fleet(p)   # 화면을 우회해 경로를 보내도 서버가 막음
    check("배정하지 않은 지사" in toast(p), toast(p))      # 2026-11-02(마이그레이션 53): 모든 지원일을 고르지만, 관리자가 배정한 지사만 — 충북은 양양을 배정받지 않음
    as_user(p, "br1"); tab(p, "fleet")
    check(p.locator("#eqTable select, #eqTable input:enabled, #vehAdd, #fleetReset").count() == 0 and not p.locator("#save-fleet").is_visible(), "지사는 기관별 장비에서 아무것도 못 고침")

def t_branch_permissions(p):
    tab(p, "branch"); b = bid(p, "대관령"); p.click(f"[data-unconfirm={b}]"); p.wait_for_timeout(300)     # 확정된 줄은 잠기므로(2026-10-05) 먼저 취소
    as_user(p, "br1"); tab(p, "branch")
    ins = set(x.get_attribute("data-rq") for x in p.locator("#branchTable [data-rq]:not([disabled])").all())
    check(ins == {b}, f"대관령 행만 입력: {ins}")
    check(p.locator(f"[data-rq={b}][data-f=assigned_truck]").count() == 0 and p.locator("[data-confirm], [data-unconfirm]").count() == 0, "편성·확정은 못 고침")
    check(p.locator("#roundMake").count() == 0, "기준일자 만들기 없음")
    as_user(p, "hq-gw"); tab(p, "branch")
    ins = set(x.get_attribute("data-rq") for x in p.locator("#branchTable [data-rq]:not([disabled])").all())
    check(ins == set(ev(p, "S.branches.filter(b => b.hq_id === S.hqs.find(h => h.name === '강원').id && !(S.reqs[b.id] || {}).confirmed).map(b => b.id)")), f"강원본부 지사들만(확정된 양양은 잠김): {ins}")
    as_user(p, "viewer"); tab(p, "branch")
    check(p.locator("#branchTable [data-rq], #branchTable [data-arr]").count() == 0 and not p.locator("#save-branch").is_visible() and not p.locator("#save-fleet").is_visible(), "보기 전용")

def t_branch_save_confirm_and_arrive(p):
    tab(p, "branch"); ch, dg = bid(p, "춘천"), bid(p, "대관령")
    check(p.locator(f"[data-arr={dg}]:not([disabled])").count() == 0, "확정된 대관령은 도착 요청도 비활성"); p.click(f"[data-unconfirm={dg}]"); p.wait_for_timeout(300)
    h = p.locator(f"[data-arr={dg}][data-part=h] option").all_inner_texts(); m = p.locator(f"[data-arr={dg}][data-part=m] option").all_inner_texts()
    check(h == [f"{i:02d}" for i in range(24)] and m == ["00", "10", "20", "30", "40", "50"], f"시 00~23, 분 10분 단위: {h} {m}")
    p.select_option(f"[data-arr={dg}][data-part=h]", "05"); p.wait_for_timeout(150); p.select_option(f"[data-arr={dg}][data-part=m]", "30"); p.wait_for_timeout(150)
    p.fill(f"[data-rq={ch}][data-f=req_blower]", "3"); p.press(f"[data-rq={ch}][data-f=req_blower]", "Tab"); p.wait_for_timeout(150)
    check("저장하지 않은 지사 2곳" in p.locator("#brDirty").inner_text() and not p.locator("#save-branch").is_visible(), p.locator("#brDirty").inner_text())
    check(p.locator(f"[data-confirm={ch}]").inner_text() == "확정" and p.locator(f"[data-confirm={dg}]").count() == 1, "확정 버튼")
    p.click(f"[data-confirm={ch}]"); p.wait_for_timeout(300)                  # 확정 = 그 지사 줄을 바로 저장(고친 요청 대수도 함께)
    check("확정했습니다" in toast(p) and ev(p, f"S.reqs['{ch}'].confirmed") is True and ev(p, f"S.reqs['{ch}'].req_blower") == 3 and "1곳" in p.locator("#brDirty").inner_text(), "확정 버튼")
    save_branch(p); check("저장했습니다" in toast(p), toast(p))
    check(ev(p, f"S.reqs['{dg}'].arrive_at") == day(p, 0) + "T05:30" and ev(p, f"S.reqs['{ch}'].confirmed") is True and ev(p, f"S.reqs['{ch}'].req_blower") == 3, "저장값")
    p.click(f"[data-confirm={dg}]"); p.wait_for_timeout(300); check(p.locator(f"[data-unconfirm={dg}]").count() == 1, "대관령 다시 확정됨 + 취소")
    tab(p, "fleet"); opts = p.locator(rsel("V004", day(p, 0)) + " option").all_inner_texts()
    check("춘천" in opts, f"확정한 지사가 경로 선택지에 생김: {opts}")
    tab(p, "move"); check("도착 요청" not in p.locator("#destList .dest").first.inner_text(), "이동 현황 장비 카드에는 도착 요청 시각을 보이지 않음")

def t_round_create(p):
    tab(p, "branch"); d = day(p, 3)
    p.fill("#newRoundDate", d); p.click("#roundMake"); p.wait_for_timeout(300)
    check("기준일자를 만들었습니다" in toast(p), toast(p))
    check(p.locator("#roundSelBranch").input_value() == str(ev(p, "S.round")) and ev(p, "curRound().start_date") == d, "새 기준일자 선택됨")
    check(ev(p, "Object.keys(S.reqs).length") == 0 and p.locator("#branchTable tr.active").count() == 0, "새 기준일자는 요청 없음(기본 보기는 모든 지사라 줄은 보임)")
    tab(p, "fleet"); check(p.locator("#day1In").input_value() == d, "지원일 1 = 새 기준일자")
    check(ev(p, "S.vehicles.every(v => { const s = stOf(S.round, v.id).status; return s === '' || (s === 'O' && stOf(S.rounds[1].id, v.id).status === 'O'); })") and ev(p, "S.vehicles.some(v => stOf(S.round, v.id).status === '')"),
          "새 기준일자는 빈칸 — 경로가 잡힌 '지원' 장비만 지원 유지(63)")
    check(p.locator("#fleetSum tr[data-fsrow='미정']").count() == 0, "장비 현황 표에 '미정' 줄 없음")
    tab(p, "branch"); p.fill("#newRoundDate", d); p.click("#roundMake"); p.wait_for_timeout(200); check("뒤 날짜" in toast(p), "같은 날짜(마지막보다 앞·같음) 거절")

def t_history_tooltip_per_cell(p):
    """수정 기록 말풍선: 지금은 꺼 둠(HIST_TIP=false → 밑줄·말풍선 없음). 켜면(HIST_TIP=true) 그 칸(그 날짜·그 장비 / 그 지사·그 열)의 오늘 수정 기록만"""
    tab(p, "fleet"); d0 = day(p, 0)
    check(ev(p, "HIST_TIP") is False and p.locator("[data-hv]").count() == 0, "기본값: 기록 밑줄·말풍선 꺼짐")
    tab(p, "branch"); check(p.locator("[data-hv]").count() == 0, "지사별 요청·편성에도 없음")
    tab(p, "fleet"); ev(p, "(HIST_TIP = true, refresh())"); d0 = day(p, 0)
    cell = p.locator(rsel("V001", d0)).locator("xpath=ancestor::div[contains(concat(' ',@class,' '),' slot ')]")
    check(cell.get_attribute("data-hv") == f"vehicle_routes:{d0},V001", "오늘 고친 칸에 기록 표시")
    check(p.locator(rsel("V001", day(p, 1))).locator("xpath=ancestor::div[contains(concat(' ',@class,' '),' slot ')]").get_attribute("data-hv") is None, "고치지 않은 칸에는 없음")
    cell.hover(); p.wait_for_timeout(150); t = p.locator("#tip").inner_text()
    check("이 칸의 오늘 수정 기록" in t and t.count("→") == 2 and "양양 → 대관령" in t, t)
    tab(p, "branch"); y = bid(p, "양양")
    p.hover(f"tr[data-b='{y}'] [data-hf=req_blower]"); p.wait_for_timeout(150); t = p.locator("#tip").inner_text()     # 확정된 양양은 잠겨 입력칸 대신 글자
    check(t.count("→") == 3 and "14 → 15" in t and "10 → 12" not in t, f"최근 3건만: {t}")
    check(p.locator(f"tr[data-b='{y}'] [data-hf=req_truck]").count() == 0, "다른 열에는 없음")
    as_user(p, "br1"); tab(p, "fleet"); check(p.locator("[data-hv]").count() == 0, "log.view 권한이 없으면 기록 표시 없음")
    ev(p, "(HIST_TIP = false, refresh())")

def t_log_tab(p):
    tab(p, "log"); check(p.locator("#logTable tbody tr").count() == 9, p.locator("#logTable tbody tr").count())
    p.click("[data-lk='추가']"); p.wait_for_timeout(100); check(p.locator("#logTable tbody tr").count() == 1, "구분 거르기")
    p.click("[data-lk='전체']"); tab(p, "fleet"); p.select_option(rsel("V002", day(p, 3)), bid(p, "엄정")); confirm_fleet(p)
    tab(p, "log"); first = p.locator("#logTable tbody tr").first.inner_text()
    check("경로" in first and "서울경기902" in first and "엄정" in first, first)

def t_plate_edit(p):
    tab(p, "fleet"); i = "[data-vp=V004]"
    check(p.locator("#eqTable thead th").first.inner_text().startswith("도공번호"), "제목은 도공번호")
    check(p.locator(i).input_value() == "904" and p.locator("tr[data-vrow=V004] .pfx").inner_text() == "서울경기", "본부(기관) 이름은 자동, 숫자만 입력")
    p.fill(i, "abc"); p.press(i, "Tab"); p.wait_for_timeout(200); check("숫자만" in toast(p) and p.locator(i).input_value() == "904", "숫자만 받음")
    p.fill(i, "901"); p.press(i, "Tab"); p.wait_for_timeout(200); check("이미 있습니다" in toast(p), "중복 검사(서울경기901)")
    p.fill(i, "999"); p.press(i, "Tab"); p.wait_for_timeout(200); confirm_fleet(p)
    check(ev(p, "vehById('V004').plate") == "서울경기999", "도공번호 확정 = 서울경기999")
    tab(p, "move"); go_date(p, day(p, 0)); check("서울경기901" in p.locator("#destList").inner_text(), "이동 현황에는 서울경기901 처럼 표시")

def t_vehicle_add_delete(p):
    tab(p, "fleet"); p.select_option("#nvOrg", "전북"); check(p.locator("#nvPfx").inner_text() == "전북" and p.locator("#nvPlate").get_attribute("placeholder") == "901", "장비 추가는 번호만(기관 이름은 자동)")
    p.select_option("#nvType", "제설기"); p.fill("#nvPlate", "전북-1"); p.click("#vehAdd"); p.wait_for_timeout(200); check("숫자만" in toast(p), "숫자만")
    p.fill("#nvPlate", "998"); p.click("#vehAdd"); p.wait_for_timeout(250)
    vid = ev(p, "(S.vehicles.find(v => v.plate === '전북998') || {}).id"); check("추가했습니다" in toast(p) and vid == "V044", f"장비 추가: {vid}")
    check(p.locator(f"[data-vp={vid}]").input_value() == "998" and p.locator(f"[data-vs={vid}]").input_value() == "", "새 장비 줄(지원 여부 미정)")
    p.click(f"[data-vdel={vid}]"); p.wait_for_timeout(250); check(p.locator(f"[data-vp={vid}]").count() == 0, "장비 삭제")

def t_dest_layout_and_jump(p):
    """이동 현황 세부내역: 장비 줄에서 지원기관·수정본·지원 칸 삭제, 본부 하나가 한 줄(안에서 지사 카드 좌우로), 표의 숫자를 누르면 그 줄로 이동"""
    go_date(p, day(p, 0))
    blocks = p.locator("#destList .hq-block"); check(blocks.count() == 2, f"본부 묶음 2개: {blocks.count()}")
    b0, b1 = blocks.nth(0).bounding_box(), blocks.nth(1).bounding_box(); mw = ev(p, "document.querySelector('#panel-move').clientWidth")
    check(b0["width"] > mw * 0.9 and b1["width"] > mw * 0.9 and b1["y"] >= b0["y"] + b0["height"] - 2, f"본부 하나가 한 줄을 모두 쓰고 위아래로: {b0} {b1}")
    cs = blocks.nth(0).locator(".hq-cards .dest"); check(cs.count() >= 2, "본부 안에 지사 카드 2개 이상(샘플)")
    c0, c1 = cs.nth(0).bounding_box(), cs.nth(1).bounding_box(); check(c1["x"] > c0["x"] + c0["width"] * 0.9 and abs(c1["y"] - c0["y"]) < 40, f"본부 안의 지사 카드는 좌우로: {c0} {c1}")
    row = p.locator("#destList .vrow").first; txt = row.inner_text()
    check("출발" not in txt and "수정본" not in txt and "최초" not in txt and row.locator(".status, .vfrom").count() == 0, f"장비 줄에 지원기관·수정본·지원 없음: {txt!r}")
    check(blocks.nth(0).locator(".dest").first.bounding_box()["width"] < ev(p, "document.querySelector('main').clientWidth") * 0.55, "카드 폭 절반 가량")
    # 숫자 → 지사 카드
    br = p.locator("#matrix tbody tr.brrow").first; bn_ = br.locator(".mnum").first; bid_ = bn_.get_attribute("data-mb")
    check(bid_ and p.locator(f"#destList .dest[data-bid={bid_}]").count() == 1, "지사 줄 숫자에 지사 번호")
    bn_.click(); p.wait_for_timeout(900)
    check(p.locator(f"#destList .dest[data-bid={bid_}].hl-card").count() == 1 and p.locator("#destList .vrow.hl").count() >= 1, "지사 숫자 → 그 카드 표시")
    vb = p.locator(f"#destList .dest[data-bid={bid_}]").bounding_box(); check(vb and -2 <= vb["y"] < 1000, f"카드가 화면 안으로 스크롤: {vb}")
    # 합계 줄 숫자 → 종류가 같은 모든 줄
    tot = p.locator("#matrix tfoot .mnum").first; p.wait_for_timeout(100); tot.click(); p.wait_for_timeout(500)
    typ = tot.get_attribute("data-mt")
    check(p.locator("#destList .vrow.hl").count() == p.locator(f"#destList .vrow[data-vt={typ}]").count() > 0, f"합계 숫자 → 같은 종류({typ}) 모든 줄")
    p.wait_for_timeout(2900); check(p.locator("#destList .hl, #destList .hl-card").count() == 0, "표시는 잠깐 뒤 사라짐")
    # 필터로 가려진 줄이어도 누르면 필터를 풀고 이동
    p.click("[data-type='제설기']"); p.wait_for_timeout(100); p.locator("#matrix tbody tr.brrow").first.locator(".mnum").first.click(); p.wait_for_timeout(500)
    check(ev(p, "S.type") == "전체" and p.locator("#destList .hl-card").count() == 1, "필터를 풀고 이동")

def t_link_numbers_no_underline_hover_bg(p):
    """다른 화면으로 가는 숫자(이동 현황 표 숫자·지사별 요청의 적설/강수/최저기온·카드의 예상 적설 태그)는 밑줄 없이, 마우스를 올리면 배경만 살짝 변함"""
    st = "(sel) => { const e = document.querySelector(sel); const s = getComputedStyle(e); return [s.textDecorationLine, s.backgroundColor, s.boxShadow] }"
    def probe(sel):
        loc = p.locator(sel).first; before = p.evaluate(st, sel); loc.hover(); p.wait_for_timeout(250); after = p.evaluate(st, sel)
        check(before[0] == "none" and after[0] == "none", f"{sel}: 밑줄 없음 {before[0]} {after[0]}")
        check(before[1:] != after[1:], f"{sel}: 마우스를 올리면 배경이 변함 {before[1:]} → {after[1:]}")
        p.mouse.move(2, 2); p.wait_for_timeout(250)
    go_date(p, day(p, 0)); probe("#matrix tbody .mnum")
    probe("#destList .tag.snow[data-fb]")
    tab(p, "branch"); check(p.locator("#branchTable .fcv").count() > 0, "지사별 요청에 연동 숫자"); probe("#branchTable [data-fb].fcv")

def t_fleet_sort_blower_delete(p):
    """기관별 장비: 기관(서울경기-충북-전북-대구경북)→종류(제설차-제설기-이동정비차) 정렬 · 블로워(소·대) · 삭제는 관리자만 · 이동 현황에 블로워 표시"""
    tab(p, "fleet")
    def order(): return ev(p, "[...document.querySelectorAll('#eqTable tbody tr[data-vrow]')].map(tr => { const v = vehById(tr.dataset.vrow); return [S.orgs.indexOf(v.org), TYPES.indexOf(v.type), v.plate] })")
    def sorted_ok(o): return all((o[i][0], o[i][1]) <= (o[i + 1][0], o[i + 1][1]) for i in range(len(o) - 1))
    o = order(); check(len(o) > 10 and sorted_ok(o), "기본 표가 기관 → 종류 순서")
    for org, typ, n in [("대구경북", "이동정비차", "880"), ("서울경기", "제설기", "881"), ("충북", "제설차", "882"), ("서울경기", "제설차", "883")]:   # 일부러 뒤죽박죽으로 추가
        p.select_option("#nvOrg", org); p.select_option("#nvType", typ); p.fill("#nvPlate", n); p.click("#vehAdd"); p.wait_for_timeout(250); check("추가했습니다" in toast(p), toast(p))
    o = order(); check(sorted_ok(o), "추가한 장비도 추가 순서가 아니라 기관 → 종류 순서로 자리잡음")
    plates = ev(p, "[...document.querySelectorAll('#eqTable tbody tr[data-vrow]')].map(tr => vehById(tr.dataset.vrow).plate)")
    check(plates.index("서울경기883") < plates.index("서울경기881") and plates.index("서울경기881") < plates.index("충북882") and plates.index("충북882") < plates.index("대구경북880"), f"서울경기 제설차 < 서울경기 제설기 < 충북 < 대구경북: {plates}")
    check("기관" not in p.locator("#eqTable thead").inner_text().replace("지원 여부", "") and "블로워" in p.locator("#eqTable thead").inner_text(), "기관 열이 블로워 열로")
    veh = {t: ev(p, f"(S.vehicles.find(v => v.type === '{t}') || {{}}).id") for t in ["제설차", "제설기", "이동정비차"]}
    for t_, vid in veh.items():
        en = p.locator(f"[data-vb={vid}][data-bf=blower_s]").is_enabled(); check(en == (t_ == "제설기"), f"{t_}: 블로워 칸 {'켜짐' if en else '꺼짐'}")
    vid = veh["제설기"]
    check(not p.locator(f"[data-vb={vid}][data-bf=blower_s]").is_checked() and not p.locator(f"[data-vb={vid}][data-bf=blower_l]").is_checked(), "처음엔 둘 다 꺼짐(둘 다 안 달 수 있음)")
    p.check(f"[data-vb={vid}][data-bf=blower_s]"); p.wait_for_timeout(100); check(ev(p, f"S.vdraft.get('{vid}').blower_s") is True, "소 체크 = 확정 전 변경")
    p.check(f"[data-vb={vid}][data-bf=blower_l]"); p.wait_for_timeout(100); confirm_fleet(p)
    check(ev(p, f"[vehById('{vid}').blower_s, vehById('{vid}').blower_l]") == [True, True] and "확정했습니다" in toast(p), "소·대 모두 확정 저장: " + toast(p))
    p.uncheck(f"[data-vb={vid}][data-bf=blower_s]"); p.wait_for_timeout(100); confirm_fleet(p)
    check(ev(p, f"[vehById('{vid}').blower_s, vehById('{vid}').blower_l]") == [False, True], "소만 끄기 가능")
    # 이동 현황: 블로워가 달린 제설기에 '블로워 대'
    mv = ev(p, "(() => { const v = S.vehicles.find(v => v.type === '제설기' && S.routes.size && [...S.routes.keys()].some(k => k.endsWith('|' + v.id))); return v ? [v.id, [...S.routes.keys()].find(k => k.endsWith('|' + v.id)).split('|')[0]] : null })()")
    check(mv is not None, "경로가 있는 제설기가 있음")
    ev(p, f"(vehById('{mv[0]}').blower_s = false, vehById('{mv[0]}').blower_l = true, 0)"); tab(p, "move"); go_date(p, mv[1])
    row = p.locator(f"#destList [data-vid={mv[0]}]").first
    check(row.count() == 1 and "블로워 대" in row.inner_text(), "이동 현황 장비 줄에 블로워 표시: " + row.inner_text())
    row.click(); p.wait_for_timeout(200); check("블로워 대" in p.locator("#sheetTitle").inner_text(), "장비 상세에도 표시"); p.click("#sheetClose")
    # 삭제는 관리자만(관리자에게는 있음)
    tab(p, "fleet"); check(p.locator("[data-vdel]").count() == ev(p, "S.vehicles.length"), "관리자에게는 모든 줄에 삭제")

def t_fleet_header_stays_on_top(p):
    """기관별 장비 표를 스크롤해도 제목 줄이 맨 위에 불투명하게 고정(입력칸·첫 열이 제목 위로 올라오지 않음)"""
    tab(p, "fleet"); p.select_option("#colsSel", "6"); p.wait_for_timeout(200)
    p.evaluate("document.querySelector('#panel-fleet .table-wrap').scrollTop = 400"); p.wait_for_timeout(200)
    r = p.evaluate("""(() => { const w = document.querySelector('#panel-fleet .table-wrap'), top = w.getBoundingClientRect().top;
      const wr = w.getBoundingClientRect();
      return [...document.querySelectorAll('#eqTable thead th')].filter(th => { const b = th.getBoundingClientRect(), cx = b.left + b.width / 2; return cx > wr.left && cx < wr.right - 12; }).map(th => { const b = th.getBoundingClientRect(), el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return [th.textContent.trim(), Math.round(b.top - top), !!(el && th.contains(el)), getComputedStyle(th).backgroundColor]; }); })()""")
    check(all(abs(x[1]) <= 2 for x in r), f"제목이 맨 위에 붙어 있어야 함: {r}")
    check(all(x[2] for x in r), f"제목 위에 다른 칸이 올라오면 안 됨: {[x[0] for x in r if not x[2]]}")
    check(all(not x[3].endswith(", 0)") and x[3] != "transparent" for x in r), f"제목 배경이 불투명해야 함: {r}")

def t_theme_toggle(p):
    btns = p.locator("[data-theme-set]").all_inner_texts(); check(btns == ["라이트 모드", "다크 모드"], btns)
    q = p.context.browser.new_page(color_scheme="dark")          # 컴퓨터가 다크 모드여도 처음엔 라이트(2026-11-01 사용자 결정)
    try:
        q.goto(URL); q.wait_for_selector("#matrix tbody tr", timeout=15000)
        bg = q.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toUpperCase()")
        check(bg != "#0F151C" and q.locator("[data-theme-set=light]").get_attribute("aria-pressed") == "true", f"기본은 라이트 모드: {bg}")
    finally: q.close()
    p.click("[data-theme-set=dark]"); p.wait_for_timeout(100)
    check(ev(p, "document.documentElement.dataset.theme") == "dark" and p.locator("[data-theme-set=dark]").get_attribute("aria-pressed") == "true", "다크 모드")
    p.reload(); p.wait_for_selector("#matrix tbody tr")
    check(ev(p, "document.documentElement.dataset.theme") == "dark", "다시 열어도 기억")
    p.click("[data-theme-set=light]"); p.wait_for_timeout(100); check(p.locator("[data-theme-set=light]").get_attribute("aria-pressed") == "true", "라이트 모드")

def t_unsaved_guard_on_user_switch(p):
    tab(p, "fleet"); p.select_option(rsel("V002", day(p, 3)), bid(p, "양양")); p.wait_for_timeout(150)
    as_user(p, "eq-sg"); check(ev(p, "S.draft.size") == 0 and route(p, "V002", day(p, 3)) == [], "아이디를 바꾸면 확정 안 한 변경은 버림")
    as_user(p, "admin1"); tab(p, "fleet"); check(p.locator(rsel("V004", day(p, 0))).is_disabled(), "지원 여부가 '지원'이 아니면 경로 칸 잠금")

def t_xss_text_is_escaped(p):
    tab(p, "branch"); b = bid(p, "대관령")       # 사유 칸은 표에서 빠졌지만(2026-10-05) 예전에 넣은 사유는 이동 현황 카드에 보임. 확정된 줄은 잠겨 취소 → 저장 → 다시 확정
    ev(p, f"(async () => {{ for (const r of [{{ confirmed: false }}, {{ reason: '<img src=x onerror=window.__x=1>' }}, {{ confirmed: true }}]) await Api.saveRequests(S.round, [{{ branch_id: '{b}', ...r }}]); await loadReqs(); refresh(); return null }})()"); p.wait_for_timeout(200)
    check(ev(p, "window.__x") is None, "스크립트가 실행됨")
    as_user(p, "admin1"); tab(p, "move"); tab(p, "log")
    check(p.locator("#branchTable img, #eqTable img, #destList img, #logTable img").count() == 0, "이미지 태그가 만들어짐")
    check("<img" in p.locator("#destList").inner_text(), "글자로 보여야 함")
    check(ev(p, "window.__x") is None, "스크립트가 실행됨")

def t_no_driver_info_anywhere(p):
    for word in ("운전원", "전화번호", "연락처"):
        check(word not in p.locator("body").inner_text(), f"화면에 '{word}'가 남아 있음")
    check(ev(p, "S.vehicles.every(v => !('driverIds' in v))"), "장비에 운전원 정보가 남아 있음")

def t_typing_then_clicking_next_input_keeps_both(p):
    """(사용자 신고 2026-10-04) 한 칸에 입력하고 바로 다른 칸을 눌러 입력해도 두 값이 모두 남아야 함(예전에는 표 전체를 다시 그려 두 번째 칸이 사라짐)"""
    tab(p, "branch"); b = bid(p, "인천")
    p.click(f"[data-rq={b}][data-f=req_blower]"); p.keyboard.press("Control+A"); p.keyboard.type("1")
    p.click(f"[data-arr={b}][data-part=d]", position={"x": 10, "y": 12}); p.keyboard.type("10042026"); p.wait_for_timeout(200)      # 날짜 칸의 맨 앞(월)부터 입력 — 칸 폭이 바뀌어도 같은 자리
    p.select_option(f"[data-arr={b}][data-part=h]", "16"); p.wait_for_timeout(150)
    p.click(f"[data-rq={b}][data-f=req_truck]"); p.keyboard.press("Control+A"); p.keyboard.type("2")
    p.click(f"[data-rq={b}][data-f=req_blower]"); p.wait_for_timeout(200)
    d = ev(p, f"S.rdraft.get('{b}')")
    check(d.get("req_blower") == 1 and d.get("req_truck") == 2 and (d.get("arrive_at") or "").endswith("T16:00"), d)
    hq = p.locator("#branchTable tr.hq").first.locator("[data-s=req_blower]").inner_text(); check(hq == "1", f"본부 합계 즉시 반영: {hq}")
    # 기관별 장비: 경로 칸을 고르고 바로 옆 칸을 골라도 둘 다 남음
    tab(p, "fleet"); d0, d3 = day(p, 0), day(p, 3)
    p.select_option(rsel("V002", d3), bid(p, "양양")); p.select_option(rsel("V003", d3), bid(p, "엄정")); p.wait_for_timeout(150)
    check(route(p, "V002", d3) == ["양양"] and route(p, "V003", d3) == ["엄정"], "두 칸 모두")

def t_round_delete(p):
    tab(p, "branch"); r = ev(p, "S.round")
    check(p.locator("#roundDel").count() == 1, "관리자에게 기준일자 삭제 버튼")
    p.click("#roundDel"); p.wait_for_timeout(300)
    check("경로가 있어" in toast(p) and ev(p, f"S.rounds.some(x => x.id === {r})") is True, "기간에 경로가 있으면 거절")
    p.select_option("#roundSelBranch", str(ev(p, "S.rounds[1].id"))); p.wait_for_timeout(300); p.click("#roundDel"); p.wait_for_timeout(300)
    check("마지막 기준일자만" in toast(p), "마지막이 아닌 기준일자는 거절")
    p.fill("#newRoundDate", day(p, 30)); p.click("#roundMake"); p.wait_for_timeout(300); r = ev(p, "S.round")
    p.click("#roundDel"); p.wait_for_timeout(300)
    check("지웠습니다" in toast(p) and ev(p, f"S.rounds.some(x => x.id === {r})") is False, "경로 없는 마지막 기준일자는 삭제")
    check(ev(p, "curRound().start_date") == day(p, 0), "남은 기준일자로 바뀜")
    check(ev(p, "S.routes.size") > 0, "장비 경로 기록은 남음")
    tab(p, "log"); row = p.locator("#logTable tbody tr").first.inner_text(); check("기준일자" in row and "삭제" in row, f"삭제 기록(맨 위 줄 = 기준일자 삭제): {row}")
    as_user(p, "br1"); tab(p, "branch"); check(p.locator("#roundDel").count() == 0, "권한 없으면 버튼 없음")

def t_pending_branches_shown_grey(p):
    """확정 전(요청만) 지사는 경로 목록에 회색(고를 수 없음)으로 보이고, 위 안내에 이름이 나옴"""
    tab(p, "fleet"); opts = p.locator(rsel("V002", day(p, 3)) + " option[disabled]").all_inner_texts()
    check(opts == ["춘천"], opts)
    check("확정 전" not in p.locator("#fleetRound").inner_text(), "기준일자 옆 설명 글 없음(2026-10-05): " + p.locator("#fleetRound").inner_text())

def t_ui_version_reload_once(p):
    """화면 틀 판번호가 맞아야 함 + 예전 틀(판번호 다름)이 남아 있으면 한 번만 새로 받음(무한 반복 없음)"""
    check(ev(p, "document.querySelector('meta[name=ui-version]').content") == ev(p, "UI_VERSION"), "index.html 과 app.js 판번호가 같아야 함")
    ver = ev(p, "UI_VERSION")                  # 예전 index.html 흉내: 판번호만 다른 틀을 돌려줌(새로 받는 주소 _v= 는 그대로 통과)
    p.route("**/equipment/index.html*", lambda r: r.fulfill(status=200, content_type="text/html; charset=utf-8",
        body=r.fetch().text().replace('content="' + ver + '"', 'content="old"')) if "_v=" not in r.request.url else r.continue_())
    p.goto(URL); p.wait_for_selector("#matrix tbody tr", timeout=15000)
    check("_v=" in p.url and p.locator("#eqTable tbody tr").count() > 0, f"한 번 새로 받아 정상 표시: {p.url}")
    p.unroute_all(behavior="ignoreErrors")

def t_route_kind_and_eta(p):
    """표 위 [최초 지원]/[수정본] 한 곳(표 전체 적용), 지사 옆 도착 예상 시각은 직접 입력 → 이동 현황 장비 줄·상세에 도착 예상"""
    tab(p, "fleet"); d3 = day(p, 3)
    check(p.locator("#modeInit").is_checked() and not p.locator("#modeRev").is_checked() and p.locator("[data-kind]").count() == 0, "구분은 표 위 한 곳(칸마다 없음)")
    enabled = lambda: [o for o in p.locator(rsel("V002", d3) + " option:not([disabled])").all_inner_texts() if o not in ("지사 선택", "지우기", "지원 불가(이날부터)")]
    check(enabled() == ["대관령", "양양", "엄정"], enabled())
    p.check("#modeRev"); p.wait_for_timeout(150)
    check(not p.locator("#modeInit").is_checked() and len(enabled()) == ev(p, "S.branches.length") and len([o for o in p.locator(rsel("V003", d3) + " option:not([disabled])").all_inner_texts() if o not in ("지사 선택", "지우기", "지원 불가(이날부터)")]) == ev(p, "S.branches.length"), "수정본이면 모든 칸에서 모든 지사")
    p.select_option(rsel("V002", d3), bid(p, "인천")); p.wait_for_timeout(150)
    ti = f"input[data-fk='t:{d3}:V002:0']"
    p.fill(ti, "735"); p.press(ti, "Tab"); p.wait_for_timeout(150); check(p.locator(ti).input_value() == "07:35", "735 → 07:35 (분은 아무 숫자)")
    p.fill(ti, "2561"); p.press(ti, "Tab"); p.wait_for_timeout(150); check("0730" in toast(p) and p.locator(ti).input_value() == "07:35", "잘못된 시각 거절")
    check(ev(p, f"JSON.stringify(recOf('{d3}', 'V002'))") == '{"stops":["%s"],"revised":true,"times":["07:35"]}' % bid(p, "인천"), ev(p, f"JSON.stringify(recOf('{d3}', 'V002'))"))
    confirm_fleet(p); check("확정했습니다" in toast(p), toast(p))
    p.check("#modeInit"); p.wait_for_timeout(150)
    check("인천 (편성 확정 전)" in p.locator(rsel("V002", d3)).inner_text() and "수정본" not in p.locator(f"td[data-cell='{d3}|V002']").inner_text(), "최초 지원 목록에서는 미확정 표시, 칸에 수정본 표지")
    tab(p, "move"); go_date(p, d3)
    row = p.locator(".vrow[data-vid=V002]").first.inner_text(); check("07:35 도착 예상" in row and "수정본" not in row, row)
    check("07:35" in p.locator(".dest", has_text="인천").locator(".dest-time").inner_text(), "카드 큰 시각 = 도착 예상")
    p.click(".vrow[data-vid=V002]"); p.wait_for_selector("ol.vhist li")
    sh = p.locator("#sheet").inner_text(); check("도착 예상" in sh and "07:35" in sh and "도착 요청" not in sh and "지원기관" in sh, sh)
    check("인천 07:35" in p.locator("ol.vhist").inner_text(), "날짜별 기록에도 시각")
    check("수정본" not in p.locator("#sheet").inner_text() and "최초" not in p.locator("#sheet").inner_text(), "장비 상세에는 수정본/최초 구분이 없음")
    p.click("#sheetClose")

def t_equip_can_edit_eta(p):
    """지원장비 계정: 자기 기관 장비의 정해진 경로에서 도착 예상 시각만 입력(지사는 못 바꿈)"""
    as_user(p, "eq-cb"); tab(p, "fleet"); d0 = day(p, 0)
    check(p.locator("select[data-rv]").count() == 0 and p.locator(f"input[data-fk='t:{d0}:V014:0']").count() == 1 and p.locator(f"input[data-fk='t:{d0}:V001:0']").count() == 0, "자기 기관 장비의 시각 칸만")
    ti = f"input[data-fk='t:{d0}:V014:0']"; p.fill(ti, "0845"); p.press(ti, "Tab"); p.wait_for_timeout(150)
    confirm_fleet(p); check("확정했습니다" in toast(p) and route(p, "V014", d0) == ["양양"] and ev(p, f"recOf('{d0}', 'V014').times[0]") == "08:45", toast(p))
    check(p.locator("#modeInit").count() == 0, "최초/수정본은 관리자만")

def t_bulk_confirm_and_no_holdings(p):
    tab(p, "branch")
    heads = p.locator("#branchTable thead").inner_text(); check("보유" not in heads and "최종" not in heads and "일괄 확정" in heads, heads)
    ch = bid(p, "춘천"); check(p.locator(f"[data-confirm={ch}]").count() == 1, "춘천 확정 전")
    p.click("#confirmAll"); p.wait_for_timeout(300)
    n = ev(p, "S.order.filter(b => !(S.hqById[b.hq_id] || {}).is_private).length") - 3       # 샘플에서 이미 확정된 3곳(대관령·양양·엄정)을 뺀 나머지 모두(요청 없는 지사도, 2026-10-05)
    check(f"{n}개 지사를 확정했습니다" in toast(p) and ev(p, f"S.reqs['{ch}'].confirmed") is True, toast(p))
    check(p.locator("#confirmAll").count() == 0 and "모두 확정" in p.locator("#branchTable thead th.cf").inner_text(), "다 확정되면 [일괄 확정] 대신 '모두 확정'")
    as_user(p, "br1"); tab(p, "branch"); check(p.locator("#confirmAll").count() == 0, "지사는 일괄 확정 없음")

def t_filters_fit_any_width(p):
    """이동 현황 필터: 지원기관 줄·장비 줄 항상 두 줄, 이름은 작은 첨자, 좁으면 글자를 줄임(글자는 항상 가로, 넘치지 않음)"""
    for w in (1440, 900, 420, 340):
        p.set_viewport_size({"width": w, "height": 800}); p.wait_for_timeout(250)
        r = p.evaluate("""(() => { const f = document.getElementById('filters'), fr = f.getBoundingClientRect(), rows = [...f.querySelectorAll('.frow')];
          const chips = [...f.querySelectorAll('.chip')]; return { rows: rows.length, tops: rows.map(r => Math.round(r.getBoundingClientRect().top)), s: +getComputedStyle(f).getPropertyValue('--s'),
          oneLine: chips.every(c => c.getBoundingClientRect().height < 40 && c.scrollHeight <= c.clientHeight + 2), inside: rows.every(r => r.getBoundingClientRect().right <= fr.right + 1 && r.scrollWidth <= f.clientWidth + 1),
          small: parseFloat(getComputedStyle(f.querySelector('.flabel')).fontSize) < parseFloat(getComputedStyle(chips[0]).fontSize) }; })()""")
        check(r["rows"] == 2 and r["tops"][0] < r["tops"][1] and r["oneLine"] and r["inside"] and r["small"], f"{w}px: {r}")
        if w >= 900: check(r["s"] == 1, f"{w}px 원래 크기: {r}")
        else: check(r["s"] < 1, f"{w}px 글자 축소: {r}")
    p.click("[data-tab=fleet]"); p.set_viewport_size({"width": 1440, "height": 800}); p.wait_for_timeout(150); p.click("[data-tab=move]"); p.wait_for_timeout(250)
    check(p.evaluate("+getComputedStyle(document.getElementById('filters')).getPropertyValue('--s')") == 1, "다른 탭에서 넓힌 뒤 돌아와도 맞게")

def t_date_in_title(p):
    """맨 위 날짜 칸은 없고, 이동 현황 제목의 큰 날짜를 눌러 바꿈(‹ › 도 제목 옆)"""
    check(p.locator(".topbar .date-nav").count() == 0, "맨 위 날짜 칸 없음")
    check(p.locator("#dateText").inner_text() == ev(p, "fmtMD(todayISO())") and "장비 지원 현황" in p.locator(".move-title").inner_text(), p.locator(".move-title").inner_text())
    p.click("#nextDay"); p.wait_for_timeout(200); check(p.locator("#dateText").inner_text() == ev(p, "fmtMD(addDays(todayISO(), 1))"), "다음날")
    go_date(p, day(p, -7)); check(p.locator("#dateText").inner_text() == ev(p, "fmtMD(addDays(todayISO(), -7))") and "춘천" in p.locator("#matrix").inner_text(), "달력으로 고른 날짜")

def t_branch_header_stays_on_top(p):
    """지사별 요청·편성 표를 스크롤해도 두 줄 제목이 겹치지 않고(둘째 줄은 첫 줄 아래), 입력칸이 제목 위로 올라오지 않음"""
    tab(p, "branch")
    p.evaluate("document.querySelector('#panel-branch .table-wrap').scrollTop = 500"); p.wait_for_timeout(200)
    r = p.evaluate("""(() => { const w = document.querySelector('#panel-branch .table-wrap'), wr = w.getBoundingClientRect(), rows = [...document.querySelectorAll('#branchTable thead tr')];
      const off = i => rows.slice(0, i).reduce((n, r) => n + r.getBoundingClientRect().height, 0);      // 줄마다 앞 줄들 높이만큼 아래(맨 위 전체 줄까지 셋째 줄)
      return [...document.querySelectorAll('#branchTable thead th')].filter(th => { const b = th.getBoundingClientRect(); return b.left + b.width / 2 < wr.right - 12; }).map(th => { const b = th.getBoundingClientRect(), el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return [th.textContent.trim(), Math.round(b.top - wr.top - off(rows.indexOf(th.parentElement))), !!(el && th.contains(el))]; }); })()""")
    check(all(abs(x[1]) <= 2 for x in r), f"제목 줄 위치: {r}")
    check(all(x[2] for x in r), f"제목이 가려짐: {[x[0] for x in r if not x[2]]}")

def badge(p, name): return p.locator(f"td[data-wcell='{bid(p, name)}'] .wb")
def t_warning_auto_badge(p):
    """대설 특보 칸은 자동 표시(체크칸 없음): 확정 전 = 지금 특보, 확정한 지사 = 확정할 때 값(칸은 빨간 네모, '고정' 글자 없음). 색은 단계별"""
    tab(p, "branch")
    head = p.locator("#branchTable thead").inner_text()
    check(p.locator("[data-f=warning]").count() == 0 and "대설특보 발표" in head and all(x in head for x in ("종류", "발표", "발효")), "대설특보 발표 아래 종류·발표·발효: " + head)
    row = p.locator(f"tr[data-b='{bid(p, '춘천')}']")
    check(row.locator("[data-wfc]").inner_text().endswith("04:00") and "오후(12~18시)" in row.locator("[data-wef]").inner_text(), "예비특보 발표 시각·발효(약속 시각 → 오후): " + row.inner_text())
    check(badge(p, "춘천").inner_text() == "예비특보" and "w1" in badge(p, "춘천").get_attribute("class"), "확정 전 춘천 = 지금 예비특보(노랑)")
    check(badge(p, "대관령").inner_text() == "대설주의보" and "w2" in badge(p, "대관령").get_attribute("class"), "대관령 = 확정 때 주의보(지금은 경보)")
    check(badge(p, "양양").inner_text() == "특보 없음" and "locked" in (p.locator(f"tr[data-b='{bid(p, '양양')}']").get_attribute("class") or "") and not "locked" in (p.locator(f"tr[data-b='{bid(p, '춘천')}']").get_attribute("class") or ""), "확정한 지사 특보 칸 = 빨간 네모")
    check(p.locator("#branchTable .wfix").count() == 0 and "고정" not in p.locator("#branchTable").inner_text(), "'고정' 글자 없음")
    badge(p, "춘천").hover(); p.wait_for_timeout(100)
    check(p.locator("#tip").is_hidden(), "지사 칸에 마우스를 올려도 설명 없음(2026-10-05)")
    wb = p.locator("#wBaseHead"); check(wb.inner_text().endswith("기준") and ev(p, "getComputedStyle(document.getElementById('wBaseHead')).borderBottomStyle") == "dashed", "대설특보 발표 아래 ○ 기준(점선): " + wb.inner_text())
    wb.hover(); p.wait_for_timeout(100); check("10분마다 업데이트" in p.locator("#tip").inner_text(), "기준에 마우스를 올리면 업데이트 주기: " + p.locator("#tip").inner_text())
    check(p.locator("#fcBaseHead").count() == 0, "24시 예보 옆 '발표 기준' 없음(2026-11-04)")
    col = ev(p, "getComputedStyle(document.getElementById('wBaseHead')).color"); check(col == ev(p, "getComputedStyle(document.querySelector('#branchTable thead th.wh')).getPropertyValue('--th-soft')") or col == "rgb(203, 217, 230)", f"기준 글자는 진한 제목 바탕에서 잘 보이는 밝은 색: {col}")
    tab(p, "move"); card = p.locator(".dest", has_text="대관령")
    check(card.locator(".tag.wb").inner_text() == "대설주의보", "이동 현황 카드도 고정값")
    tab(p, "branch"); p.click(f"[data-confirm='{bid(p, '춘천')}']"); p.wait_for_timeout(300)
    check("대설특보: 예비특보," in toast(p) and "고정" not in toast(p) and badge(p, "춘천").inner_text() == "예비특보" and "locked" in (p.locator(f"tr[data-b='{bid(p, '춘천')}']").get_attribute("class") or ""), toast(p))
    p.click(f"[data-unconfirm='{bid(p, '대관령')}']"); p.wait_for_timeout(300)
    check(badge(p, "대관령").inner_text() == "대설경보" and "w3" in badge(p, "대관령").get_attribute("class"), "확정을 풀면 다시 지금 값(경보, 빨강) — 강풍 등 다른 특보는 지사 칸에 안 나옴")
    check(p.locator(f"tr[data-b='{bid(p, '대관령')}'] [data-wef]").inner_text().endswith("06:00"), "경보 발효 시각")
    bg = [ev(p, f"getComputedStyle(document.querySelector(\"td[data-wcell='{bid(p, n)}'] .wb\")).backgroundColor") for n in ("춘천", "양양", "대관령")]
    check(len(set(bg)) == 3, f"단계마다 다른 색: {bg}")
    as_user(p, "br2"); tab(p, "branch")
    check(p.locator("#zoneMgr").count() == 1 and badge(p, "양양").count() == 1, "2026-11-10: 지사도 특보구역 관리를 엶(요청용)")

def t_zone_manager(p):
    """관리자: 특보구역 관리 창에서 지사 구역을 빼고 더하면 그 지사 대설 특보가 바로 바뀜(기록 남음)"""
    tab(p, "branch"); p.click("#zoneMgr"); p.wait_for_selector("#zlist h3")
    p.select_option("#zbr", bid(p, "춘천")); p.wait_for_timeout(100)
    check([x.strip() for x in p.locator("#zlist ul").first.locator("li > span:first-child").all_inner_texts()] == ["강원도 · 춘천", "강원도 · 홍천평지", "강원도 · 홍천산지"], p.locator("#zlist").inner_text())
    p.click("[data-zset=L1022710]"); p.wait_for_timeout(200)
    check(badge(p, "춘천").inner_text() == "특보 없음" and "되살리기" in p.locator("#zlist").inner_text(), "홍천평지를 빼면 특보 없음")
    p.select_option("#zadd", "L1022520"); p.click("#zaddBtn"); p.wait_for_timeout(200)
    check(badge(p, "춘천").inner_text() == "대설주의보" and "더함" in p.locator("#zlist").inner_text(), "강릉산지(주의보)를 더하면 주의보")
    p.click("#zlist [data-zset=L1022710]"); p.wait_for_timeout(200)
    check(badge(p, "춘천").inner_text() == "대설주의보" and "뺀 구역" not in p.locator("#zlist").inner_text(), "되살려도 더 높은 주의보")
    tabs = [t.strip() for t in p.locator("#wnow .wtab").all_inner_texts()]
    check(tabs[0].startswith("대설") and len(tabs) == 5 and p.locator("#wnow .wtrow").count() == 2, f"종류별 탭(대설 먼저, 5종류라 두 줄): {tabs}")
    check(any(t.replace(" ", "") == "건조2" for t in tabs), f"탭 = 이름 + 구역 수: {tabs}")
    p.click("[data-wtab='강풍']"); p.wait_for_timeout(100); wl = p.locator("#wnow .wlist").inner_text()
    check("횡성" in wl and "주의보" in wl and "대관령" in wl and "04:00" in wl and "06:00" in wl, "강풍 탭: 구역·단계·발표·발효·이어진 지사: " + wl)
    p.click("#sheetClose"); tab(p, "log")
    check("특보구역" in p.locator("#panel-log").inner_text(), "수정 기록에 특보구역")
    as_user(p, "hq-gw"); tab(p, "branch"); check(p.locator("#zoneMgr").count() == 1, "2026-11-10: 본부도 특보구역 관리를 엶(요청용)")

def t_zone_requests(p):
    """2026-11-10: 관리자 아닌 아이디는 사유를 적어 더하기·빼기 요청(취소 가능), 관리자는 요청을 승인/반려. 처음 고르는 지사는 아이디마다"""
    yy, cc = bid(p, "양양"), bid(p, "춘천")
    as_user(p, "br2"); tab(p, "branch"); p.click("#zoneMgr"); p.wait_for_selector("#zlist h3")
    check(p.input_value("#zbr") == yy, "지사 아이디: 자기 지사부터")
    check(p.locator("#zlist [data-zset]").count() == 0 and p.locator("#zaddBtn").count() == 0 and p.locator("#zlist [data-zask]").count() > 0 and p.locator("#zaddAsk").count() == 1, "지사: 바로 바꾸는 단추 없이 요청 단추만")
    first = p.locator("#zlist [data-zask]").first; code = first.get_attribute("data-zask"); check(first.inner_text() == "빼기 요청", first.inner_text())
    first.click(); p.wait_for_selector("#zaskReason")
    p.click("#zaskSend"); p.wait_for_timeout(150); check("사유" in toast(p), "사유 없이는 못 보냄: " + toast(p))
    p.fill("#zaskReason", "고속도로가 지나지 않음"); p.click("#zaskSend"); p.wait_for_timeout(250)
    check("요청했습니다" in toast(p) and "빼기 요청 중" in p.locator("#zlist").inner_text() and p.locator("#zlist [data-zcancel]").count() == 1, "빼기 요청 → 요청 중·요청 취소: " + toast(p))
    p.click("#zlist [data-zcancel]"); p.wait_for_timeout(250)
    check("취소했습니다" in toast(p) and "요청 중" not in p.locator("#zlist").inner_text(), "요청 취소")
    p.locator(f"#zlist [data-zask='{code}']").click(); p.fill("#zaskReason", "안 지남"); p.click("#zaskSend"); p.wait_for_timeout(200)
    p.select_option("#zadd", "L1022520"); p.click("#zaddAsk"); p.wait_for_selector("#zaskReason"); p.fill("#zaskReason", "산지 구간 포함"); p.click("#zaskSend"); p.wait_for_timeout(250)
    check(p.locator("#zlist [data-zcancel]").count() == 2 and "더하기 요청 중" in p.locator("#zlist").inner_text(), "더하기 요청도: " + p.locator("#zlist").inner_text()[:200])
    p.select_option("#zbr", cc); p.wait_for_timeout(100); check(p.locator("#zlist [data-zask]").count() > 0, "다른 지사도 보고 요청할 수 있음")
    p.click("#sheetClose")
    as_user(p, "hq-gw"); tab(p, "branch"); p.click("#zoneMgr"); p.wait_for_selector("#zlist h3")
    check(p.input_value("#zbr") == ev(p, "S.order.find(b => b.hq_id === S.me.hq_id).id"), "본부 아이디: 자기 본부의 첫 지사부터")
    p.click("#sheetClose")
    as_user(p, "eq-sg"); tab(p, "branch")
    if p.locator("#zoneMgr").count():
        p.click("#zoneMgr"); p.wait_for_selector("#zlist h3"); check(p.input_value("#zbr") == ev(p, "S.order[0].id"), "기계화부 아이디: 첫 지사부터"); p.click("#sheetClose")
    as_user(p, "admin1"); tab(p, "branch"); p.click("#zoneMgr"); p.wait_for_selector("#zlist h3")
    reqs = p.locator("#zlist .zreqs li")
    check(reqs.count() == 2 and "고속도로가 지나지 않음" not in p.locator("#zlist").inner_text() and "안 지남" in p.locator("#zlist").inner_text(), "관리자: 처리를 기다리는 요청 2건(취소한 것은 없음)")
    before = badge(p, "양양").inner_text()
    p.locator("#zlist .zreqs [data-zok]").first.click(); p.wait_for_timeout(300)
    check("승인" in toast(p) and p.input_value("#zbr") == yy and p.locator("#zlist .zreqs li").count() == 1, "승인 → 그 지사 구역이 바뀜: " + toast(p))
    check(code not in [x.get_attribute("data-zset") for x in p.locator("#zlist ul").first.locator("[data-zset]").all()], "빼기 요청한 구역이 빠짐")
    p.locator("#zlist .zreqs [data-zno]").first.click(); p.wait_for_timeout(300)
    check("반려" in toast(p) and p.locator("#zlist .zreqs").count() == 0, "반려 → 요청 목록 비움")
    check("L1022520" not in [x.get_attribute("data-zset") for x in p.locator("#zlist ul").first.locator("[data-zset]").all()], "반려한 더하기는 안 들어감")

def t_private_hq_hidden_in_branch_tab(p):
    """민자는 지사별 요청·편성에 나오지 않음('요청 있는 지사만'을 꺼도)"""
    tab(p, "branch")
    hqs = [x.strip() for x in p.locator("#branchTable tr.hq td.l").all_inner_texts()]
    check("민자" not in hqs and len(hqs) == ev(p, "S.hqs.filter(h => !h.is_private).length"), f"본부 줄에 민자 없음: {hqs}")
    check(p.locator(f"#branchTable tr[data-b='{bid(p, '민자')}']").count() == 0, "민자 지사 줄 없음")

def t_snow_forecast(p):
    """24시 강설 [적설 | 강수] = 기상청 예보(앞 6시간 초단기 + 단기) 24시간 합의 지사 최댓값, 확정하면 그 값(빨간 네모), 누르면 기관별 24시간 예보로"""
    tab(p, "branch"); head = p.locator("#branchTable thead").inner_text()
    check(p.locator("[data-f=snow_cm]").count() == 0 and "24시 예보" in head and "적설" in head and "강수" in head and "기온" in head and "발표 기준" not in head and "시각" not in head, "24시 예보 아래 적설·강수·확률·기온(시각 칸·발표 기준 없음): " + head)
    check(p.locator(f"td[data-pcell='{bid(p, '춘천')}']").inner_text() == "6", "춘천 강수 6mm(정수, 2026-11-04)")
    check(p.locator(f"td[data-pcell='{bid(p, '엄정')}']").inner_text() in ("~1", "0"), "엄정 강수: 1mm 미만 = ~1(확정 전이면) — " + p.locator(f"td[data-pcell='{bid(p, '엄정')}']").inner_text())
    fc = lambda n: p.locator(f"td[data-fcell='{bid(p, n)}']").inner_text().replace(chr(10), "")
    check(fc("춘천") == "3~5" and fc("대관령") == "12" and fc("양양") == "8", f"확정 전 = 지금 예보, 확정 = 확정 때 값: {fc('춘천')} {fc('대관령')} {fc('양양')}")
    th = [x.strip().replace("\n", "") for x in p.locator("#branchTable thead tr").first.locator("th").all_inner_texts()]
    check(th[1].startswith("24시 예보") and th[2].startswith("대설특보 발표") and "최저기온" not in th and "사유" not in th, f"24시 예보 → 대설특보, 최저기온 묶음·사유 열 없음: {th}")
    tm = lambda n: p.locator(f"td[data-tcell='{bid(p, n)}']").inner_text()
    check(tm("춘천") == "-7" and tm("대관령") == "-10" and p.locator("td[data-tacell]").count() == 0, f"기온(확정 전 = 지금, 확정 = 확정 때), 시각 칸 없음: {tm('춘천')} {tm('대관령')}")
    check("cold" in p.locator(f"td[data-tcell='{bid(p, '춘천')}'] .fcv").get_attribute("class") and "locked" in p.locator(f"tr[data-b='{bid(p, '대관령')}']").get_attribute("class"), "영하는 파랑, 확정은 빨간 네모")
    check("locked" in (p.locator(f"tr[data-b='{bid(p, '대관령')}']").get_attribute("class") or "") and "locked" in (p.locator(f"tr[data-b='{bid(p, '대관령')}']").get_attribute("class") or "") and not "locked" in (p.locator(f"tr[data-b='{bid(p, '춘천')}']").get_attribute("class") or ""), "확정한 지사 적설·강수 칸 = 빨간 네모")
    p.hover(f"td[data-fcell='{bid(p, '춘천')}'] [data-fb]"); p.wait_for_timeout(100)
    check(p.locator("#tip").is_hidden(), "적설·강수 칸에 마우스를 올려도 설명 없음(누르면 이동은 그대로)")
    p.click(f"[data-confirm='{bid(p, '춘천')}']"); p.wait_for_timeout(300)
    check("적설 3~5cm·강수 6mm·최저 -7℃)" in toast(p) and fc("춘천") == "3~5" and "locked" in (p.locator(f"tr[data-b='{bid(p, '춘천')}']").get_attribute("class") or ""), toast(p))
    p.click(f"[data-unconfirm='{bid(p, '대관령')}']"); p.wait_for_timeout(300)
    check(fc("대관령") == "14", "확정을 풀면 지금 예보: " + fc("대관령"))
    tab(p, "move"); check("예상 적설 14cm · 강수 18mm · 최저 -12℃" in p.locator(".dest", has_text="대관령").inner_text(), "이동 현황 카드")
    tab(p, "branch"); ev(p, "(() => { window.open = (u, t) => { window.__opened = [u, t]; }; return null })()")
    p.click(f"td[data-pcell='{bid(p, '양양')}'] [data-fb]"); p.wait_for_timeout(100)
    check(ev(p, "window.__opened") == [f"../#fc={bid(p, '양양')}", "_top"], f"누르면 기관별 24시간 예보의 그 지사로: {ev(p, 'window.__opened')}")
    ev(p, "(() => { window.__opened = null; return null })()"); p.click(f"td[data-tcell='{bid(p, '춘천')}'] [data-fb]"); p.wait_for_timeout(100)
    check(ev(p, "window.__opened") == [f"../#fc={bid(p, '춘천')}", "_top"], "최저기온을 눌러도 그 지사 예보로")

def t_weather_manual(p):
    """기상현황 직접입력(2026-10-05): 체크하면 적설·강수 숫자, 특보 종류 선택, 발표·발효 월일시분 8자리. 밑줄·예보 이동 없음. 확정하면 빨간 네모"""
    tab(p, "branch")
    th = [x.strip().replace("\n", "") for x in p.locator("#branchTable thead tr").first.locator("th").all_inner_texts()]
    i = [k for k, x in enumerate(th) if x.startswith("대설특보 발표")][0]
    check(th[i + 1] == "기상현황직접입력" and th[i + 2] == "지사 요청", f"대설특보 발표와 지사 요청 사이: {th}")
    cj = bid(p, "춘천"); row = p.locator(f"tr[data-b='{cj}']")
    check(row.locator("[data-fb]").count() == 4 and row.locator("input[data-f=wx_snow]").count() == 0, "처음엔 자동 값 4개(적설·강수·확률·기온, 누르면 예보로)")
    # 강수확률(2026-10-10, 마이그레이션 42): 24시 강설 아래 소제목 '확률' — 지사 격자의 24시간 최고 %(시각 없이 값만), 직접입력 줄은 '-'
    sub = [x.strip().replace("\n", "") for x in p.locator("#branchTable thead tr").nth(1).locator("th").all_inner_texts()]
    check(sub[:4] == ["적설cm", "강수mm", "확률%", "기온최저 ℃"] and p.locator("#branchTable thead tr").first.locator("th.fch").first.get_attribute("colspan") == "4", f"24시 예보 = 적설·강수·확률·기온: {sub[:5]}")
    check(row.locator(f"td[data-ocell='{cj}']").inner_text() == "60" and p.locator(f"td[data-ocell='{bid(p, '대관령')}']").inner_text() == "90", "확률 칸: 예보 값(춘천 60) / 확정한 지사는 확정 때 값(대관령 90)")
    check(p.locator("#branchTable tr.hq").first.locator("td").count() == p.locator(f"tr[data-b='{cj}'] td").count(), "본부 줄과 지사 줄의 칸 수가 같음")
    row.locator("input[data-f=wx_manual]").check(); p.wait_for_timeout(200); row = p.locator(f"tr[data-b='{cj}']")
    check(row.locator("[data-fb]").count() == 0 and row.locator(".fcv").count() == 0, "체크하면 밑줄·예보 이동 없음")
    check(row.locator(f"td[data-ocell='{cj}']").inner_text() == "-" and row.locator(f"td[data-ocell='{cj}'] input").count() == 0, "직접입력 줄의 확률은 '-'(넣는 칸 없음)")
    check(row.locator("select[data-f=wx_level] option").all_inner_texts() == ["특보 없음", "예비특보", "대설주의보", "대설경보"], "특보 종류는 선택")
    row.locator("input[data-f=wx_snow]").fill("7.5"); row.locator("input[data-f=wx_snow]").dispatch_event("change")
    row.locator("input[data-f=wx_pcp]").fill("10"); row.locator("input[data-f=wx_pcp]").dispatch_event("change")
    row.locator("input[data-f=wx_tmin]").fill("-8.5"); row.locator("input[data-f=wx_tmin]").dispatch_event("change")
    rd = ev(p, "curRound().start_date"); check(row.locator("[data-tpick]").count() == 0, "최저기온 시각 넣는 칸 없음(2026-10-15)")
    row = p.locator(f"tr[data-b='{cj}']")
    row.locator("select[data-f=wx_level]").select_option("주의")
    hs = row.locator("select[data-wxt][data-f=wx_fc][data-part=h] option").all_inner_texts(); ms = row.locator("select[data-wxt][data-f=wx_fc][data-part=m] option").all_inner_texts()
    check(hs == ["--"] + [f"{i:02d}" for i in range(24)] and ms == ["00", "10", "20", "30", "40", "50"], f"발표 = 시(00~23)·분(10분 단위) 선택: {hs[:3]}… {ms}")
    check(row.locator("select[data-wxt][data-f=wx_fc][data-part=m]").is_disabled(), "시를 고르기 전에는 분 잠김")
    row.locator("select[data-wxt][data-f=wx_fc][data-part=h]").select_option("15"); p.wait_for_timeout(100)
    row.locator("select[data-wxt][data-f=wx_fc][data-part=m]").select_option("30"); p.wait_for_timeout(100)
    row.locator("select[data-wxt][data-f=wx_ef][data-part=h]").select_option("18"); p.wait_for_timeout(100)
    save_branch(p)
    r = ev(p, f"S.reqs['{cj}']")
    check(r["wx_tmin"] == -8.5, f"최저기온 직접입력 저장: {r}")
    check(r["wx_manual"] is True and r["wx_snow"] == 7.5 and r["wx_pcp"] == 10 and r["wx_level"] == "주의" and ev(p, f"fmtHM(S.reqs['{cj}'].wx_fc)") == "15:30" and ev(p, f"fmtHM(S.reqs['{cj}'].wx_ef)") == "18:00"
          and ev(p, f"localInput(S.reqs['{cj}'].wx_fc).slice(0, 10)") == ev(p, "curRound().start_date"), f"저장(날짜 = 기준일자): {r}")
    p.click(f"[data-confirm='{cj}']"); p.wait_for_timeout(300); row = p.locator(f"tr[data-b='{cj}']")
    check("locked" in (row.get_attribute("class") or "") and p.locator("#branchTable td.fixd").count() == 0, "확정하면 줄 바탕 노랑(빨간 네모 없음)")
    check("적설 7.5cm·강수 10.0mm" in toast(p) and "대설주의보" in toast(p), "확정 안내는 직접 넣은 값: " + toast(p))
    tab(p, "move"); card = p.locator(".dest", has_text="춘천")
    if card.count(): check("(직접입력)" in card.inner_text() and card.locator("[data-fb]").count() == 0, "이동 현황 카드: 직접입력 표시, 누를 수 없음")
    as_user(p, "br2"); tab(p, "branch"); row = p.locator(f"tr[data-b='{cj}']")
    check(row.locator(f"td[data-fcell='{cj}']").inner_text() == "7.5" and row.locator("input").count() == 0 and row.locator("[data-fb]").count() == 0, "다른 지사 계정: 숫자만(입력·이동 없음)")
    check(row.locator(f"td[data-tcell='{cj}']").inner_text() == "-8.5", "직접 넣은 최저기온")
    check(row.locator("td[data-wcell] .wb").inner_text() == "대설주의보" and row.locator("td[data-wfc]").inner_text() == "15:30" and row.locator("td[data-wef]").inner_text() == "18:00", row.inner_text())
    check(p.locator(f"tr[data-b='{bid(p, '양양')}']").locator("input:not([disabled]), select:not([disabled])").count() == 0, "확정된 자기 지사(양양)는 비활성")

def t_confirmed_row_locked(p):
    """확정한 지사 줄은 [취소]하기 전까지 요청·편성·도착 요청·기상현황 직접입력을 못 고침(관리자도, 서버도 막음)"""
    tab(p, "branch"); dg, cj = bid(p, "대관령"), bid(p, "춘천")
    row = lambda b: p.locator(f"tr[data-b='{b}']")
    check(row(dg).locator("input:not([disabled]), select:not([disabled])").count() == 0 and row(dg).locator("input[disabled]").count() >= 5 and row(dg).locator("[data-unconfirm]").count() == 1, "확정된 대관령: 입력칸은 비활성(회색), [취소]만")
    check(row(cj).locator("input[data-f=req_truck]").count() == 1 and row(cj).locator("input[data-f=wx_manual]").count() == 1, "확정 전 춘천: 입력 가능")
    p.click(f"[data-confirm='{cj}']"); p.wait_for_timeout(300)
    check(row(cj).locator("input:not([disabled]), select:not([disabled])").count() == 0 and "locked" in row(cj).get_attribute("class"), "확정하면 춘천도 바로 비활성")
    r = ev(p, f"Api.saveRequests(S.round, [{{ branch_id: '{dg}', req_truck: 9 }}])")
    check(r["ok"] is False and "확정을 취소한 뒤" in r["message"], f"확정 줄 저장은 서버에서도 거절: {r}")
    r = ev(p, f"Api.saveRequests(S.round, [{{ branch_id: '{dg}', confirmed: false, req_truck: 9 }}])")
    check(r["ok"] is False, "취소하면서 값 바꾸기도 거절")
    p.click(f"[data-unconfirm='{cj}']"); p.wait_for_timeout(300)
    check(row(cj).locator("input[data-f=req_truck]").count() == 1 and row(cj).locator("input[data-f=assigned_truck]").count() == 1, "취소하면 다시 고칠 수 있음")
    bg = lambda b: ev(p, f"getComputedStyle(document.querySelector(\"tr[data-b='{b}'] td\")).backgroundColor")
    check("locked" not in (row(cj).get_attribute("class") or "") and bg(cj) != bg(dg) and bg(cj) in ("rgba(0, 0, 0, 0)", "transparent", "rgb(255, 255, 255)"), f"취소하면 줄 바탕도 흰색으로(확정 줄만 노랑): {bg(cj)} / {bg(dg)}")
    as_user(p, "br2"); tab(p, "branch"); yy = bid(p, "양양")
    check(row(yy).locator("input:not([disabled]), select:not([disabled])").count() == 0 and row(yy).locator("input[data-f=wx_manual][disabled]").count() == 1, "지사 계정: 확정된 자기 지사 줄도 비활성(체크칸 포함)")
    # 다른 화면(관리자)에서 그사이 확정 → 이 화면은 아직 모름 → 저장하면 '이미 확정' 안내 + 최신으로 다시 읽음
    as_user(p, "admin1"); tab(p, "branch"); wj = bid(p, "춘천")         # 위에서 확정을 취소해 지금은 확정 전
    p.fill(f"[data-rq={wj}][data-f=req_truck]", "3"); p.press(f"[data-rq={wj}][data-f=req_truck]", "Tab"); p.wait_for_timeout(150)
    ev(p, f"Api.saveRequests(S.round, [{{ branch_id: '{wj}', confirmed: true }}])")
    save_branch(p)
    check("이미 확정되어 고칠 수 없습니다" in toast(p) and "춘천" in toast(p) and "저장하지 못했습니다" not in toast(p), "확정되어 고칠 수 없다는 안내: " + toast(p))
    check(row(wj).locator("input:not([disabled]), select:not([disabled])").count() == 0 and ev(p, f"S.rdraft.has('{wj}')") is False, "다시 읽어 그 줄은 비활성, 고친 값은 버림")

def t_confirm_all_by_hq(p):
    """본부 줄의 [일괄 확정] = 그 본부 지사 모두(요청을 저장하지 않은 지사도). 맨 위 [일괄 확정]도 저장 여부와 관계없이 모두"""
    tab(p, "branch")                                                           # 기본 = 모든 지사
    gw = ev(p, "S.hqs.find(h => h.name === '강원').id"); cb = ev(p, "S.hqs.find(h => h.name === '충북').id")
    hq = p.locator(f"#branchTable tr.hq[data-hq='{gw}']")
    check(hq.locator("[data-confirm-hq]").inner_text() == "일괄 확정" and hq.locator("[data-s=confirmed]").count() == 0, "본부 줄: 확정 개수 대신 [일괄 확정]")
    ids = ev(p, f"S.order.filter(b => b.hq_id === '{gw}').map(b => b.id)")
    hq.locator("[data-confirm-hq]").click(); p.wait_for_timeout(400)
    check(all(ev(p, f"!!(S.reqs['{i}'] || {{}}).confirmed") for i in ids), "강원 지사 모두 확정(요청 없던 지사도)")
    check("강원 본부" in toast(p) and "확정했습니다" in toast(p), toast(p))
    check(p.locator(f"#branchTable tr.hq[data-hq='{gw}']").inner_text().count("모두 확정") == 1, "다 확정되면 '모두 확정'")
    check(hq.locator("[data-unconfirm-hq]").inner_text() == "일괄 취소", "모두 확정 옆에 [일괄 취소]")
    p.locator(f"#branchTable tr.hq[data-hq='{gw}'] [data-unconfirm-hq]").click(); p.wait_for_timeout(400)
    check(not any(ev(p, f"!!(S.reqs['{i}'] || {{}}).confirmed") for i in ids) and "강원 본부" in toast(p) and "취소했습니다" in toast(p), "본부 [일괄 취소] = 그 본부 지사 확정 모두 취소: " + toast(p))
    check(p.locator(f"#branchTable tr.hq[data-hq='{gw}'] [data-confirm-hq]").count() == 1 and p.locator(f"#branchTable tr.hq[data-hq='{gw}'] [data-unconfirm-hq]").count() == 0, "취소하면 다시 [일괄 확정]만")
    p.locator(f"#branchTable tr.hq[data-hq='{gw}'] [data-confirm-hq]").click(); p.wait_for_timeout(400)
    check(ev(p, f"S.order.some(b => b.hq_id === '{cb}' && !(S.reqs[b.id] || {{}}).confirmed)"), "다른 본부(충북)는 그대로")
    p.click("#confirmAll"); p.wait_for_timeout(500)
    check(ev(p, "S.order.filter(b => !(S.hqById[b.hq_id] || {}).is_private).every(b => (S.reqs[b.id] || {}).confirmed)"), "맨 위 [일괄 확정] = 저장 안 한 지사까지 모두")
    head = p.locator("#branchTable thead th.cf")
    check(p.locator("#confirmAll").count() == 0 and "모두 확정" in head.inner_text() and p.locator("#unconfirmAll").count() == 1, "제목도 모두 확정되면 '모두 확정' + [일괄 취소]")
    p.click("#unconfirmAll"); p.wait_for_timeout(500)
    check(ev(p, "S.order.every(b => !(S.reqs[b.id] || {}).confirmed)") and "취소했습니다" in toast(p), "제목 [일괄 취소] = 모든 지사 확정 취소: " + toast(p))
    check(p.locator("#confirmAll").count() == 1 and p.locator("#unconfirmAll").count() == 0 and p.locator("#branchTable tr.locked").count() == 0, "취소하면 다시 [일괄 확정]만, 노란 줄 없음")

def t_views_and_choices_after_confirm_all(p):
    """(2026-10-06) 일괄 확정 뒤에도: '요청 있는 지사만' = 요청 1대 이상, '편성 확정된 지사만' = 확정 + 편성 1대 이상.
    기관별 장비 [최초 지원] 선택지 = 편성 확정된 지사만(일괄 확정으로 편성 0대인 지사는 안 나옴), 모든 지사는 [수정본]에서만"""
    tab(p, "branch")                                                         # 기본 = 모든 지사(2026-10-15) → 일괄 확정
    check(p.locator("#branchCtl .chip[aria-pressed=true]").count() == 0, "처음엔 보기 버튼이 하나도 안 눌림")
    p.click("#confirmAll"); p.wait_for_timeout(500)
    shown = lambda: [x.get_attribute("data-b") for x in p.locator("#branchTable tr[data-b]").all()]
    total = ev(p, "S.order.filter(b => !(S.hqById[b.hq_id] || {}).is_private).length")
    check(len(shown()) == total, f"모든 지사: {len(shown())}/{total}")
    p.click("#onlyActive"); p.wait_for_timeout(150)
    want = ev(p, "S.order.filter(b => !(S.hqById[b.hq_id] || {}).is_private && hasReq(b.id)).map(b => b.id)")
    check(set(shown()) == set(want) and 0 < len(want) < total, f"일괄 확정 뒤에도 '요청 있는 지사만'이 걸러짐: {len(shown())}/{total}")
    p.click("#onlyFixed"); p.wait_for_timeout(150)                      # 한 번에 하나만(2026-11-03): [편성]을 누르면 [요청]은 꺼짐
    check(p.locator("#branchCtl .chip[aria-pressed=true]").count() == 1, "보기 버튼은 하나만 눌림")
    fixed = ev(p, "S.order.filter(b => !(S.hqById[b.hq_id] || {}).is_private && isFixed(b.id)).map(b => b.id)")
    check(set(shown()) == set(fixed) and 0 < len(fixed) < total and p.locator("#onlyFixed").get_attribute("aria-pressed") == "true" and p.locator("#onlyActive").get_attribute("aria-pressed") == "false",
          f"'편성' = 확정 + 편성 1대 이상: {[bn for bn in fixed]}")
    check(all(ev(p, f"isConf('{x}') && (S.reqs['{x}'].assigned_truck + S.reqs['{x}'].assigned_blower) > 0") for x in shown()), "보이는 줄은 모두 편성 확정")
    p.click("#onlyFixed"); p.wait_for_timeout(150); check(len(shown()) == total, "다시 누르면 모든 지사")
    tab(p, "fleet"); d0 = day(p, 0)
    opts = [o for o in p.locator(rsel("V004", d0) + " option:not([disabled])").all_inner_texts() if o not in ("지사 선택", "지우기")]
    names = ev(p, "routeChoices().map(b => b.name)")
    check(sorted(opts) == sorted(names) and len(names) == len(fixed) and len(names) < total, f"최초 지원 = 편성 확정된 지사만: {opts}")
    p.click("#modeRev"); p.wait_for_timeout(200)
    opts2 = [o for o in p.locator(rsel("V004", d0) + " option:not([disabled])").all_inner_texts() if o not in ("지사 선택", "지우기")]
    check(len(opts2) >= total - 1, f"수정본 = 모든 지사: {len(opts2)}")

def t_round_status_rules(p):
    """기준일자별 지원 여부(마이그레이션 38): 새 기준일자가 맡은 날짜는 옛 기준일자에서 잠김(말풍선), 빈칸(지원 아님)은 겹치는 날짜에도, 연속지원, 지원일 1 제한. '지원 불가(이날부터)'는 2026-11-04 없앰(66)"""
    d = [day(p, k) for k in range(6)]
    tab(p, "fleet"); old = ev(p, "S.round")
    # 연속지원: V002 는 오늘·내일·모레 대관령 → 내일 칸은 시각 대신 "연속지원"
    check(p.locator(f"td[data-cell='{d[1]}|V002'] .cont").inner_text() == "연속지원" and p.locator(f"input[data-fk='t:{d[1]}:V002:0']").count() == 0, "전날 마지막 지사 = 오늘 첫 지사 → 연속지원")
    check(p.locator(f"input[data-fk='t:{d[0]}:V002:0']").count() == 1, "첫날은 시각 입력")
    # V001: 모레 대관령 → 양양, 글피 대관령 → 첫 지사(대관령) ≠ 전날 마지막(양양) → 연속 아님
    check(p.locator(f"input[data-fk='t:{d[3]}:V001:0']").count() == 1, "전날 여러 곳을 들렀으면 마지막 지사만 비교(대관령→양양 다음 날 대관령은 시각 입력)")
    # 지원일 1 은 기준일자보다 앞으로 못 감
    p.fill("#day1In", day(p, -1)); p.dispatch_event("#day1In", "change"); p.wait_for_timeout(250)
    check("기준일자" in toast(p) and p.locator("#day1In").input_value() == d[0], "지원일 1을 기준일자 앞으로 고르면 거절")
    # 새 기준일자(모레) → 오늘 기준일자에서 모레부터는 잠김
    tab(p, "branch"); p.fill("#newRoundDate", d[2]); p.click("#roundMake"); p.wait_for_timeout(400); new = ev(p, "S.round")
    exp = ev(p, f"(() => {{ const o = S.vehicles.filter(v => !v.round_id).map(v => [v.id, stOf(S.round, v.id).status, stOf({old}, v.id).status === 'O' && [...S.routes.entries()].some(([k, r]) => k.endsWith('|' + v.id) && k.split('|')[0] >= '{d[2]}' && r.stops.length)]); return o; }})()")
    check(ev(p, "stOf(S.round, 'V001').status") == "O" and all((s == "O") == keep and s in ("O", "") for _, s, keep in exp), f"63: 새 기간에 경로가 잡힌 지원 장비만 지원 유지, 나머지 빈칸: {exp}")
    p.select_option("#roundSelBranch", str(old)); p.wait_for_timeout(300); tab(p, "fleet")
    lk = p.locator(f"td[data-cell='{d[2]}|V001'] .slot.locked")
    check(lk.count() == 1 and ("기준일자 " + ev(p, f"fmtMD('{d[2]}')")) in lk.get_attribute("title") and p.locator(rsel("V001", d[2])).count() == 0, "새 기준일자가 맡은 날짜는 옛 기준일자에서 고칠 수 없음(말풍선)")
    check(p.locator(rsel("V001", d[1])).count() == 1, "옛 기준일자가 맡은 날은 그대로 고칠 수 있음")
    # 새 기준일자에서 V001 빈칸(지원 아님) → 옛 기준일자의 겹치는 날짜도 경로가 안 보임, 이동 현황에서도 빠짐
    p.select_option("#roundSelFleet", str(new)); p.wait_for_timeout(300)
    p.select_option("[data-vs=V001]", ""); p.wait_for_timeout(150); confirm_fleet(p); check("확정했습니다" in toast(p), toast(p))
    p.select_option("#roundSelFleet", str(old)); p.wait_for_timeout(300)
    check(p.locator(f"td[data-cell='{d[2]}|V001']").inner_text().strip() == "-" and p.locator(rsel("V001", d[1])).is_enabled(), "옛 기준일자 화면에도 겹치는 날은 경로 없음(잠김), 앞날은 그대로")
    check(ev(p, f"recOf('{d[2]}', 'V001').stops.length") == 2, "경로는 지우지 않음")
    tab(p, "move"); go_date(p, d[2]); check(p.locator(".vrow[data-vid=V001]").count() == 0, "이동 현황에서 지원이 아닌 날은 빠짐")
    go_date(p, d[1]); check(p.locator(".vrow[data-vid=V001]").count() >= 1, "앞날은 그대로")
    # 지원 불가(이날부터)는 없음(2026-11-04): 지원일 2부터의 칸에도 그 항목이 없고, 지원장비 계정 칸에도 없음
    tab(p, "fleet"); p.select_option("#roundSelFleet", str(new)); p.wait_for_timeout(300)
    check(not any("지원 불가" in o for o in p.locator(rsel("V002", d[3]) + " option").all_inner_texts()) and p.locator("select.offsel, .slot.offday").count() == 0, "지원 불가(이날부터) 없음")
    check(ev(p, f"Api.saveFleet([], [], S.round, [{{ vehicle_id: 'V002', status: 'O', off_from: '{d[3]}' }}]).then(r => r.ok)") is False and ev(p, "Api.saveFleet([], [], S.round, [{ vehicle_id: 'V002', status: 'X', off_from: null }]).then(r => r.ok)") is False, "서버(샘플)도 지원 불가 시작일·지원 불가 값을 받지 않음")
    as_user(p, "eq-sg"); tab(p, "fleet"); p.select_option("#roundSelFleet", str(new)); p.wait_for_timeout(300)
    if ev(p, "stOf(S.round, 'V005').status") != "O": p.select_option("select[data-vs='V005']", "O"); p.wait_for_timeout(200)
    check(p.locator("select[data-off]").count() == 0 and not any("지원 불가" in o for o in p.locator("#eqTable select[data-ra] option").all_inner_texts()), "지원장비 계정 칸에도 지원 불가 없음")

def t_moves_between_branches(p):
    """지사 사이 이동(2026-10-09): 두 번째 지사부터는 그 시각에 옮겨 감. 기준 시각이 지나야 반영, 표 숫자 밑·카드에 이동 내역, 연속지원 시작 시각, 기준 시각 표시"""
    dg, yy = bid(p, "대관령"), bid(p, "양양")
    cell = lambda name: p.locator("#matrix tbody tr", has=p.locator(f"th[scope=row]:text-is('{name}')")).locator("td.tot.c1")
    # 모레: V001 대관령 → 14:00 양양(앞 날짜라 아직 안 옮김) — 대관령에 그대로, 양양 칸은 0 + 이동 내역
    go_date(p, day(p, 2))
    check("앞 날짜" in p.locator("#refTime").inner_text() and "기준 시각" in p.locator("#refTime").inner_text(), p.locator("#refTime").inner_text())
    trucks_yy = ev(p, f"S.vehicles.filter(v => v.type === '제설차' && effRec(addDays(todayISO(), 2), v.id).stops.includes('{yy}')).length")
    yt = cell("양양").inner_text(); dt = cell("대관령").inner_text()
    check(yt.split()[0].strip() == str(trucks_yy - 1) and "14:00 1대 대관령→양양" in yt and "14:00 1대 대관령→양양" in dt, ("표", yt, dt, trucks_yy))
    v1 = p.locator(f".dest[data-bid='{dg}']").locator(".vrow[data-vid=V001]").inner_text()
    check("14:00 이동(대관령→양양)" in v1 and "연속지원" in v1 and v1.index("14:00 이동") < v1.index("연속지원"), "지금 있는 지사 줄: 이동 표시가 연속지원 앞: " + v1)
    check(p.locator(f".dest[data-bid='{yy}']").locator(".vrow.incoming[data-vid=V001]").count() == 1, "갈 지사에는 '옮겨 올 장비'로 보임")
    # 오늘: 이미 지난 시각(00:00)의 이동은 반영 — 떠난 지사에서 사라지고 간 지사에서만 보임
    ev(p, f"(() => {{ const t = todayISO(), k = rk(t, 'V003'); S.routes.set(k, {{ ...(S.routes.get(k) || {{}}), stops: ['{dg}', '{yy}'], times: ['', '00:00'] }}); }})()")
    ev(p, "setDate(todayISO())"); p.wait_for_timeout(200)
    check("지난 날짜" not in p.locator("#refTime").inner_text() and "앞 날짜" not in p.locator("#refTime").inner_text(), "오늘은 기준 시각만")
    check(p.locator(f".dest[data-bid='{dg}']").locator(".vrow[data-vid=V003]").count() == 0, "떠난 지사(대관령)에서는 안 보임")
    v3 = p.locator(f".dest[data-bid='{yy}']").locator(".vrow[data-vid=V003]")
    check(v3.count() == 1 and "이동" not in v3.inner_text() and "incoming" not in (v3.get_attribute("class") or ""), "간 지사(양양)에서만, 이미 한 이동 표지는 없음: " + v3.inner_text())
    check("00:00" not in cell("양양").inner_text() and "00:00" not in cell("대관령").inner_text(), "표: 이미 한 이동은 숫자에만 반영, 내역은 안 보임")
    # 연속지원 시작 시각: 내일 대관령 = 오늘부터 이어서 지원 중('미정' 대신)
    go_date(p, day(p, 1))
    t = p.locator(f".dest[data-bid='{dg}']").locator(".dest-time").inner_text()
    check(ev(p, "fmtMD(todayISO())") + "" in t and "부터" in t and "연속지원 중" in t and "미정" not in t, "연속지원 시작: " + t)
    check(ev(p, f"JSON.stringify(contSince('V001', addDays(todayISO(), 1), '{dg}'))") == ev(p, "JSON.stringify({date: todayISO(), time: '21:30'})"), "V001 은 오늘 21:30 부터")
    go_date(p, day(p, -1)); check("지난 날짜" not in p.locator("#refTime").inner_text() and "반영" not in p.locator("#refTime").inner_text() and "기준 시각" in p.locator("#refTime").inner_text(), "지난 날짜도 기준 시각만(안내 문구 뺌, 2026-10-10)")

def t_hide_vehicle(p):
    """숨기기(삭제 옆): 고른 기준일자부터 목록에서 빠지고, 삭제 열 제목 칸의 [숨김 취소(N)]로 되돌림. 경로 기록이 있는 장비는 삭제 거절"""
    tab(p, "fleet")
    check(p.locator("#unhideBtn").count() == 0, "숨긴 장비가 없으면 [숨김 취소] 없음")
    p.click("[data-vdel=V003]"); p.wait_for_timeout(250); check("숨기기" in toast(p) and ev(p, "!!vehById('V003')"), "경로 기록이 있으면 삭제 거절")
    p.click("[data-vhide=V003]"); p.wait_for_timeout(300)
    check(p.locator("tr[data-vrow=V003]").count() == 0 and "숨김 취소(1)" in p.locator("#unhideBtn").inner_text(), "숨기면 목록에서 빠지고 [숨김 취소(1)]")
    tab(p, "move"); check(p.locator(".vrow[data-vid=V003]").count() >= 1, "이동 현황 기록은 그대로"); tab(p, "fleet")
    p.select_option("#roundSelFleet", str(ev(p, "S.rounds[1].id"))); p.wait_for_timeout(300)
    check(p.locator("tr[data-vrow=V003]").count() == 1, "이전 기준일자에서는 보임")
    p.select_option("#roundSelFleet", str(ev(p, "S.rounds[0].id"))); p.wait_for_timeout(300)
    p.click("#unhideBtn"); p.wait_for_timeout(150); check(p.locator(".unhide-pop [data-unhide=V003]").is_visible(), "숨긴 장비 목록")
    p.click(".unhide-pop [data-unhide=V003]"); p.wait_for_timeout(300)
    check(p.locator("tr[data-vrow=V003]").count() == 1 and p.locator("#unhideBtn").count() == 0, "숨김 취소")
    tab(p, "log"); check("숨김" in p.locator("#logTable").inner_text(), "기록에 숨김")

def t_allocation(p):
    """기관별 배치(마이그레이션 43): 관리자가 기관 → 지사 대수를 정하고, 기계화부(지원장비 계정)는 지원일 1의 지사를 그 안에서 고름. 넘기면 거절, 서로 바꾸기는 됨, 관리자 화면에 지정 현황"""
    d0 = day(p, 0); dg, yy, ej, cc = (bid(p, n) for n in ("대관령", "양양", "엄정", "춘천"))
    cell = lambda vid, d=None: f"#eqTable td[data-cell='{d or d0}|{vid}']"
    # ① 관리자: 기관별 배치 탭 — 편성이 확정된 지사만 줄로, 칸 = 기관별 제설차·제설기
    tab(p, "alloc")
    check([x.get_attribute("data-ab") for x in p.locator("#allocTable tbody tr").all()] == [dg, yy, ej], "확정된 지사 3곳(춘천은 요청만이라 없음)")
    check(p.locator("#allocTable thead tr").first.locator("th").all_inner_texts()[1:5] == ["서울경기", "충북", "전북", "대구경북"] and not p.locator("#save-alloc").is_hidden(), "기관 4곳 · 관리자는 저장 바")
    al = lambda org, b, f: f"#allocTable input[data-al='{org}|{b}'][data-f={f}]"
    for sel, v in ((al("서울경기", dg, "truck"), "2"), (al("서울경기", dg, "blower"), "3"), (al("서울경기", yy, "truck"), "2"), (al("서울경기", ej, "truck"), "1"), (al("충북", dg, "truck"), "2")):
        p.fill(sel, v); p.dispatch_event(sel, "change"); p.wait_for_timeout(60)
    sm = p.locator(f"#allocTable tr[data-ab='{dg}'] [data-asum=truck] span")
    check(sm.inner_text() == "4 / 6" and "al-short" in sm.get_attribute("class") and p.locator(f"#allocTable tr[data-ab='{ej}'] [data-asum=truck] span").get_attribute("class") == "al-ok", "배정 / 편성: 모자라면 주황, 맞으면 초록")
    check("4칸" in p.locator("#save-alloc .save-state").inner_text(), p.locator("#save-alloc .save-state").inner_text())
    p.click("#save-alloc [data-save]"); p.wait_for_timeout(300)
    check("기관별 배치을 확정했습니다" in toast(p) and ev(p, "S.alloc.size") == 4 and ev(p, "S.adraft.size") == 0, toast(p))
    check(p.locator("#allocTable [data-adone], #allocTable tr.al-done").count() == 0 and "장비 지정" not in p.locator("#allocTable").inner_text(), "2026-11-11: 기관별 배치 아래 '장비 지정' 줄은 없음")
    # ② 관리자의 기관별 장비: 기관 카드에 배정 요약, 넘긴 칸에 '배정 초과'(지우지 않음)
    tab(p, "fleet")
    check(p.locator("#fleetMore, #orgGrid .al-org").count() == 0, "기관별 지정 현황(표 아래 접는 칸)은 없음(2026-11-04)")
    sg = ev(p, "orgAllocSummary('서울경기')")
    check(sg["total"] == 8 and sg["over"] and any(x["type"] == "제설차" and x["used"] == 3 and x["cap"] == 2 for x in sg["items"]), f"서울경기 배정 8대, 대관령 차 3/2 초과: {sg}")
    check(p.locator(cell("V002") + " .al-flag").inner_text() == "배정 초과" and p.locator(cell("V005") + " .al-flag").count() == 0 and p.locator(cell("V002", day(p, 1)) + " .al-flag").count() == 0, "지원일 1 칸에만 표시")
    check(ev(p, "orgAllocSummary('전북').total") == 0 and p.locator(cell("V043") + " .al-flag").count() == 0, "배정이 없는 기관은 예전 그대로(표시 없음)")
    check(p.locator(cell("V014") + " .al-flag").inner_text() == "배정 없음", "충북은 대관령만 배정받음 → 양양으로 간 장비는 '배정 없음'")
    # ③ 서울경기 기계화부: 지원일 1 칸에서 배정받은 지사 중에 고름(남은 대수 표시, 찬 지사는 못 고름)
    as_user(p, "eq-sg"); tab(p, "fleet")
    sel = f"select[data-fk='ra:{d0}:V003']"
    sel2 = f"select[data-fk='ra:{day(p, 1)}:V003']"
    check(p.locator(sel).count() == 1 and p.locator(sel2).count() == 1 and p.locator("select[data-rv]").count() == 0, "지원일 1·2… 모두 고를 수 있음(2026-11-02, 관리자용 지사 목록은 없음)")
    o2 = p.locator(sel2 + " option").all_inner_texts()
    check(not any("지원 불가" in x for x in o2) and any(x.startswith("대관령 (") for x in o2), f"지원일 2: 배정 지사(그날 대수), 지원 불가 없음(2026-11-04): {o2}")
    opts = [(o.inner_text(), o.get_attribute("value"), o.is_disabled()) for o in p.locator(sel + " option").all()]
    check(("대관령 (3/2)", dg, False) in opts and ("양양 (2/2)", yy, True) in opts and ("엄정 (1/1)", ej, True) in opts and cc not in [o[1] for o in opts], f"배정받은 지사만, 찬 지사는 못 고름: {opts}")
    check(p.locator(f"select[data-fk='ra:{d0}:V004']").count() == 0, "지원이 아닌 장비(미정)는 고를 수 없음")
    check([o.inner_text() for o in p.locator(f"select[data-fk='ra:{d0}:V012'] option").all()][:4] == ["지사 선택", "대관령", "양양", "엄정"], "이동정비차는 배정받은 아무 지사(대수 표시 없음)")
    p.select_option(sel, "__del"); p.wait_for_timeout(200)
    check(route(p, "V003", d0) == [] and "대관령 (2/2)" in p.locator(f"select[data-fk='ra:{d0}:V002']").inner_text(), "하나를 지우면 다른 칸의 남은 대수도 바뀜")
    confirm_fleet(p); check("확정했습니다" in toast(p) and ev(p, f"S.routes.has(rk('{d0}', 'V003'))") is False, toast(p))
    sg = ev(p, "orgAllocSummary('서울경기')"); check(p.locator(cell("V002") + " .al-flag").count() == 0 and not sg["over"] and sg["done"] == sg["total"] == 8, f"초과가 풀리고 8대 모두 지정 완료: {sg}")
    # 화면을 우회해 보내도 서버 규칙이 막음: 대수 넘김 / 배정 없는 지사 / 둘째 날도 그날 대수로
    put = lambda vid, d, b: ev(p, f"S.draft.set(rk('{d}', '{vid}'), {{ stops: ['{b}'], revised: false, times: [null] }}), updateSavebars()")
    put("V003", d0, dg); confirm_fleet(p); check("배정받은 대수보다" in toast(p), "대수 넘김: " + toast(p))
    put("V003", d0, cc); confirm_fleet(p); check("배정하지 않은 지사" in toast(p), "배정 없는 지사: " + toast(p))
    ev(p, "S.draft.clear()"); used = ev(p, f"allocUsed('서울경기', '제설차', '{yy}', '{day(p, 1)}')"); cap = ev(p, f"allocCap('서울경기', '제설차', '{yy}')")
    put("V003", day(p, 1), yy); confirm_fleet(p)                      # 2026-11-02: 둘째 날도 고를 수 있지만 대수는 '그날' 기준으로 셈
    check(("배정받은 대수보다" in toast(p)) == (used >= cap), f"둘째 날: 그날 양양 {used}/{cap}대 — " + toast(p))
    ev(p, "S.draft.clear()"); put("V005", d0, ej); put("V007", d0, yy); confirm_fleet(p)
    check("확정했습니다" in toast(p) and route(p, "V005", d0) == ["엄정"] and route(p, "V007", d0) == ["양양"], "한 번의 확정 안에서 서로 바꾸기는 됨: " + toast(p))
    check(p.locator(f"select[data-fk='ra:{d0}:V001']").count() == 1, "V001(한 곳·최초 지원)도 고를 수 있음")
    # ④ 다른 기관·지사 계정: 배정 탭은 보기만
    as_user(p, "eq-cb"); tab(p, "alloc")
    check(p.locator("#allocTable input").count() == 0 and p.locator("#save-alloc").is_hidden() and p.locator(f"#allocTable tr[data-ab='{dg}']").inner_text().split()[1:3] == ["2", "3"], "기계화부는 배정 표를 보기만")
    tab(p, "fleet"); check(p.locator(f"select[data-fk='ra:{d0}:V017'] option").nth(1).inner_text() == "대관령 (2/2)" and p.locator(f"select[data-fk='ra:{d0}:V001']").count() == 0, "충북은 충북 장비만, 충북 배정 지사만")
    # ⑤ 관리자: 배정을 줄여도 경로는 그대로(초과 표시), 지정 현황 확인
    as_user(p, "admin1"); tab(p, "alloc")
    sa = ev(p, "orgAllocSummary('서울경기')"); check(sa["done"] == 8 and sa["total"] == 8 and not sa["over"], f"지정 현황(기관별 장비 카드와 같은 계산): {sa}")
    p.fill(al("서울경기", yy, "truck"), "1"); p.dispatch_event(al("서울경기", yy, "truck"), "change"); p.click("#save-alloc [data-save]"); p.wait_for_timeout(300)
    check(route(p, "V006", d0) == ["양양"] and route(p, "V007", d0) == ["양양"] and ev(p, "orgAllocSummary('서울경기').over"), "배정을 줄여도 경로는 남고 '배정 초과'로 봄")
    tab(p, "log"); check("기관별 배치" in p.locator("#logTable").inner_text() and "서울경기 → 양양" in p.locator("#logTable").inner_text(), "수정 기록에 배정 변경")

def t_reload(p):
    """새로고침 버튼(2026-10-11): 이동 현황·기관별 장비·지사별 요청·편성·기관별 배치에서, 다른 아이디가 넣은 자료를 화면을 새로 열지 않고 다시 읽음"""
    for tb in ("move", "fleet", "branch", "alloc"):     # 2026-11-02: 탭마다 있던 버튼 → 위쪽 탭 줄 오른쪽 하나(머리글이 붙어 있어 스크롤해도 보임)
        tab(p, tb); check(p.locator("[data-reload]").count() == 1 and p.locator("#reloadTop").is_visible() and p.locator(f"#panel-{tb} [data-reload]").count() == 0, f"{tb} 탭: 새로고침은 위쪽 한 곳")
    tab(p, "fleet"); p.mouse.wheel(0, 3000); p.wait_for_timeout(300)
    bb = p.locator("#reloadTop").bounding_box(); check(bb and 0 <= bb["y"] < 200, f"아래로 스크롤해도 새로고침 버튼이 화면 위쪽에 보임: {bb}")
    p.mouse.wheel(0, -3000); p.wait_for_timeout(200)
    d0 = day(p, 0); cj, dg = bid(p, "춘천"), bid(p, "대관령")
    # 다른 아이디가 서버에 넣은 것처럼: 시연 서버 자료만 바꾸고 화면 상태(S)는 그대로 둠
    ev(p, f"""(() => {{ const u = S.me; Api.setActor({{ role: 'admin', label: '다른 관리자', username: 'other' }});
        Api.saveRequests(S.round, [{{ branch_id: '{cj}', req_truck: 7 }}]);
        Api.saveFleet([], [{{ date: '{d0}', vehicle_id: 'V004', stops: ['{dg}'], revised: false, times: ['09:10'] }}], S.round, [{{ vehicle_id: 'V004', status: 'O' }}]);
        Api.addVehicle({{ id: 'V777', org: '충북', type: '제설차', plate: '충북977', sort: 9990 }});
        Api.saveAllocations(S.round, [{{ org: '충북', branch_id: '{dg}', truck: 4, blower: 0 }}]);
        Api.setActor(u); return null }})()""")
    tab(p, "branch")
    check(ev(p, f"rval('{cj}', 'req_truck')") == 2 and route(p, "V004", d0) == [] and ev(p, "!vehById('V777')") and ev(p, "S.alloc.size") == 0, "누르기 전에는 화면이 예전 값 그대로")
    p.click("#reloadTop"); p.wait_for_timeout(500)
    check("새로 불러왔습니다" in toast(p) and ev(p, f"rval('{cj}', 'req_truck')") == 7 and p.locator(f"#branchTable tr[data-b='{cj}'] input[data-f=req_truck]").input_value() == "7", "지사 요청이 새 값으로: " + toast(p))
    check(route(p, "V004", d0) == ["대관령"] and ev(p, "stOf(S.round, 'V004').status") == "O" and ev(p, "!!vehById('V777')") and ev(p, f"(S.alloc.get('충북|{dg}') || {{}}).truck") == 4, "경로·지원 여부·새 장비·기관별 배치도 새 값으로")
    check("불러옴" in p.locator(".tabs-reload [data-reload-at]").inner_text(), "불러온 시각 표시")
    tab(p, "fleet"); check(p.locator("#eqTable tr[data-vrow=V777]").count() == 1, "기관별 장비 표에 새 장비")
    # 저장하지 않은 변경이 있으면 물어보고(여기서는 자동으로 '예') 버린 뒤 다시 읽음
    p.select_option("[data-vs=V013]", "O"); p.wait_for_timeout(150); check(ev(p, "S.sdraft.size") == 1, "고치는 중")
    p.click("#reloadTop"); p.wait_for_timeout(500)
    check(ev(p, "S.sdraft.size") == 0 and ev(p, "stOf(S.round, 'V013').status") == "" and "새로 불러왔습니다" in toast(p), "버리고 다시 읽음")
    tab(p, "move"); p.click("#reloadTop"); p.wait_for_timeout(500); check("새로 불러왔습니다" in toast(p) and p.locator("#matrix tbody tr").count() > 0, "이동 현황에서도")

def bn_in(p, vid, d): return p.locator(f"#eqTable td[data-cell='{d}|{vid}'] .sl-n").count() == 1
def t_pool_vehicles(p):
    """지역본부 장비(2026-10-12, 마이그레이션 44): 지사가 '타지사 지원 가능' 대수를 내고 관리자가 확정 → 그 지사·관리자가 그 기준일자의 제설차를 등록.
    피지원 지사는 관리자만, 지사는 번호·임차·도착 시각·삭제. 이름 '인천 252호'/'인천 임차 1호'. 카드 5개·기관 버튼 여러 개·표 칸 순서·배정 '지역본부' 칸·이동 현황 연동"""
    d0 = day(p, 0); ic, sw, dg, yy, cj = (bid(p, n) for n in ("인천", "수원", "대관령", "양양", "춘천"))
    vid = lambda name: ev(p, f"(S.vehicles.find(v => isPool(v) && vname(v) === '{name}') || {{}}).id || null")
    setnum = lambda sel, v: (p.fill(sel, str(v)), p.press(sel, "Tab"), p.wait_for_timeout(150))
    # ── 지사별 요청·편성: 칸 순서, 관리자 영역 경계선, 보기 버튼 3개, 직접입력을 켜도 칸 폭 그대로
    tab(p, "branch")
    heads = [x.replace("\n", " ").strip() for x in p.locator("#branchTable thead tr:first-child th").all_inner_texts()]
    heads = [h for h in heads if h]                 # 저장·편성 사이 빈 칸(표 나눔, 2026-11-02) 제외
    check([h.split(" ")[0] for h in heads] == ["지사", "24시", "대설특보", "기상현황", "지사", "도착", "타지사", "저장", "편성", "확정"] and "지원 가능" in heads[6], f"칸 순서: {heads}")
    check(ev(p, "getComputedStyle(document.querySelector('#branchTable tbody td.adm0')).borderLeftWidth") != "3px" and p.locator("#branchTable thead th.adm").count() == 8, "편성·확정 앞은 굵은 경계선 대신 빈 칸(2026-11-02)")
    check(ev(p, f"(() => {{ const tr = document.querySelector(\"#branchTable tr[data-b='{cj}']\"), bg = c => getComputedStyle(tr.querySelector(c)).backgroundColor; return bg('td.adm') !== bg('td.ofc') }})()"), "관리자 칸은 바탕이 다름")
    check([x.strip() for x in p.locator("#branchCtl .chip").all_inner_texts()] == ["요청", "편성", "지원", "저장안함"], "보기 버튼 순서(저장 안 한 지사만은 맨 오른쪽)")
    widths = lambda: ev(p, "[...document.querySelectorAll('#branchTable thead tr:nth-child(2) th')].map(th => Math.round(th.getBoundingClientRect().width * 2) / 2)")
    w0 = widths(); p.check(f"input[data-rq={cj}][data-f=wx_manual]"); p.wait_for_timeout(200); w1 = widths()
    check(p.locator(f"#branchTable tr[data-b='{cj}'] input.wxn").count() == 3 and w0 == w1, f"직접입력을 켜도 칸 폭이 같아야 함: {w0} → {w1}")
    p.uncheck(f"input[data-rq={cj}][data-f=wx_manual]"); p.wait_for_timeout(200); w2 = widths(); check(w2 == w0, f"끄면 처음 그대로: {w0} → {w2}"); ev(p, "(S.rdraft.clear(), refresh())"); p.wait_for_timeout(150)
    p.set_viewport_size({"width": 1920, "height": 1000}); p.wait_for_timeout(200); w3 = widths(); p.check(f"input[data-rq={cj}][data-f=wx_manual]"); p.wait_for_timeout(200); w4 = widths()
    check(w3 == w4, f"넓은 화면에서도 칸 폭이 같아야 함: {w3} → {w4}"); ev(p, "(S.rdraft.clear(), refresh())"); p.set_viewport_size({"width": 1440, "height": 1000}); p.wait_for_timeout(200)
    check(ev(p, "(() => { const t = document.querySelector('#branchTable'); return t.scrollWidth - t.parentElement.clientWidth })()") <= 8, "1440 화면에서 표가 옆으로 넘치지 않음(편성·확정 칸이 한 화면에)")
    # ── 지사(인천): 자기 줄에 지원 가능 3대, 확정 전에는 장비 등록 안내만
    as_user(p, "br-ic"); tab(p, "branch"); row = lambda b: p.locator(f"#branchTable tr[data-b='{b}']")
    check(row(ic).count() == 1 and row(ic).locator("input[data-f=offer_truck]").count() == 1 and row(ic).locator("input[data-f=assigned_truck]").count() == 0, "인천지사: 자기 줄의 지원 가능 칸만(편성은 관리자)")
    setnum(f"[data-rq={ic}][data-f=offer_truck]", 3); save_branch(p); check("저장했습니다" in toast(p) and ev(p, f"offerOf('{ic}')") == 3 and not ev(p, f"offerOk('{ic}')"), toast(p))
    tab(p, "fleet"); check(p.locator("#poolWait").is_visible() and p.locator("#vehAdd").count() == 0 and not p.locator("#save-fleet").is_visible(), "확정 전에는 등록할 수 없고 안내만")
    check(ev(p, f"Api.addVehicle({{ org: '지역본부', type: '제설차', plate: '인천252', round_id: S.round, home_branch: '{ic}', rented: false }}).then(r => r.code)") == "SA004", "서버도 확정 전 등록 거절")
    as_user(p, "hq-gw"); tab(p, "branch"); check(row(cj).locator("input[data-f=offer_truck]").count() == 1 and row(ic).locator("input").count() == 0, "본부: 자기 본부 지사의 지원 가능 칸")
    tab(p, "fleet"); check(p.locator("#nvOrg, #poolWait, #vehAdd").count() == 0, "본부 계정은 장비 등록 없음")
    # ── 관리자: 지원 가능 지사만 보기 → 확정(편성과 한 번에) → 잠금
    as_user(p, "admin1"); tab(p, "branch"); p.click("#onlyOffer"); p.wait_for_timeout(150)
    shown = lambda: [x for x in ev(p, "[...document.querySelectorAll('#branchTable tr[data-b]')].map(r => r.dataset.b)")]
    check(shown() == [ic] and p.locator("#onlyOffer").get_attribute("aria-pressed") == "true" and p.locator("#onlyActive").get_attribute("aria-pressed") == "false", f"지원 가능 지사만: {shown()}")
    check(p.locator(f"#branchTable tr.hq[data-hq='{ev(p, 'S.brById[' + repr(ic) + '].hq_id')}'] [data-s=offer_truck]").inner_text() == "3", "본부 줄에 지원 가능 합계")
    p.click(f"[data-confirm={ic}]"); p.wait_for_timeout(350); check("확정했습니다" in toast(p) and ev(p, f"offerOk('{ic}')") and row(ic).locator("input[data-f=offer_truck]").is_disabled(), "확정하면 지원 가능 칸도 잠김: " + toast(p))
    check(ev(p, f"Api.saveRequests(S.round, [{{ branch_id: '{ic}', offer_truck: 9 }}]).then(r => r.code)") == "55000", "서버도 확정한 줄의 지원 가능 대수는 잠금")
    p.click("#onlyOffer"); p.wait_for_timeout(150); setnum(f"[data-rq={sw}][data-f=offer_truck]", 2); p.click(f"[data-confirm={sw}]"); p.wait_for_timeout(350); check(ev(p, f"offerOk('{sw}')"), "수원도 확정(고친 값과 함께): " + toast(p))
    # ── 기관별 장비(관리자): 카드 5개 같은 폭, 0대 카드 흐림, 기관 버튼, 장비 추가 목록의 경계선 아래 지사
    tab(p, "fleet")
    check(ev(p, "offerBranches().reduce((n, b) => n + offerOf(b.id), 0)") == 5 and ev(p, "poolVehs().length") == 0, "지역본부: 지원 가능(확정) 5대, 등록 0대")
    check(p.locator("[data-fo]").count() == 5 and p.locator("[data-fo='전체']").count() == 0 and p.locator("[data-fo='지역본부']").is_disabled() and not p.locator("[data-fo='전북']").is_disabled(), "장비 0대인 지역본부 버튼은 비활성")
    opts = ev(p, "[...document.querySelectorAll('#nvOrg option')].map(o => [o.value, o.textContent, o.disabled])")
    check([o[0] for o in opts if not o[2]] == ["서울경기", "충북", "전북", "대구경북", "B:" + ic, "B:" + sw] and opts[4][2] and "─" in opts[4][1], f"기관 4곳 ─ 경계선 ─ 확정된 지사: {opts}")
    p.select_option("#nvOrg", "B:" + ic); p.wait_for_timeout(150)
    check(p.locator("#nvType").count() == 0 and p.locator("#nvRent").count() == 1 and p.locator("#nvPfx").inner_text() == "인천" and p.locator("#vehAdd").inner_text() == "등록", "지사를 고르면 장비 종류 대신 임차 체크")
    p.fill("#nvPlate", "252"); p.click("#vehAdd"); p.wait_for_timeout(300); check("등록했습니다 (인천 252호)" in toast(p), toast(p)); v1 = vid("인천 252호")
    check(p.locator("#nvOrg").input_value() == "B:" + ic, "등록한 뒤에도 고른 지사 그대로(이어서 등록)")
    check(p.locator("#nvPlate").get_attribute("placeholder") == "252", "일반 장비 번호 예시는 252")
    p.check("#nvRent"); p.wait_for_timeout(150); check(p.locator("#nvPfx").inner_text() == "인천 임차" and p.locator("#nvPlate").get_attribute("placeholder") == "1", "임차를 켜면 이름 앞부분이 바뀌고 번호 예시는 1")
    p.fill("#nvPlate", "1"); p.click("#vehAdd"); p.wait_for_timeout(300); check("인천 임차 1호" in toast(p), toast(p)); v2 = vid("인천 임차 1호")
    p.fill("#nvPlate", "1"); p.click("#vehAdd"); p.wait_for_timeout(250); check("같은 이름" in toast(p), "같은 기준일자에 같은 이름은 거절: " + toast(p))
    p.uncheck("#nvRent"); p.wait_for_timeout(100); p.fill("#nvPlate", "1"); p.click("#vehAdd"); p.wait_for_timeout(300); check("인천 1호" in toast(p), "임차 번호와 일반 번호는 따로: " + toast(p)); v3 = vid("인천 1호")
    check(v1 and v2 and v3 and ev(p, f"vehById('{v2}').plate") == "인천임차1" and ev(p, f"stOf(S.round, '{v1}').status") == "O", "저장 값·지원 여부 자동")
    vr = lambda v: p.locator(f"#eqTable tr[data-vrow='{v}']")
    check(ev(p, "[...document.querySelectorAll('#eqTable tr.pool')].map(r => r.dataset.vrow)") == [v3, v1, v2], "지역본부 장비는 맨 아래, 일반(숫자 순) → 임차")
    check("지원" == vr(v1).locator("td:nth-child(2)").inner_text().strip() and vr(v1).locator("[data-vs], [data-vhide]").count() == 0 and vr(v1).locator("[data-vdel]").count() == 1, "지원 여부는 늘 지원, 숨기기 없음, 삭제 있음")
    check(vr("V001").locator(".sfx").inner_text() == "호", "기계화부 장비도 끝에 '호'")
    pn = lambda b: ev(p, f"poolVehs().filter(v => v.home_branch === '{b}').length")
    check(ev(p, "poolVehs().length") == 3 and pn(ic) == 3 and ev(p, f"offerOf('{ic}')") == 3 and pn(sw) == 0 and ev(p, f"offerOf('{sw}')") == 2, "지역본부 등록 3대: 인천 3/3, 수원 0/2")
    # 기관 버튼: 한 번에 하나만, '모든 기관' 버튼은 없음(끄면 모든 장비)
    nrows = lambda: p.locator("#eqTable tbody tr[data-vrow]").count(); total = nrows()
    p.click("[data-fo='지역본부']"); p.wait_for_timeout(150); check(nrows() == 3 and p.locator("#fleetFilters .chip[aria-pressed=true]").count() == 1, "지역본부만")
    p.click("[data-fo='서울경기']"); p.wait_for_timeout(150); check(nrows() == 12 and p.locator("[data-fo='지역본부']").get_attribute("aria-pressed") == "false" and p.locator("[data-fo='서울경기']").get_attribute("aria-pressed") == "true", f"다른 기관을 누르면 그 기관만: {nrows()}")
    p.click("[data-fo='서울경기']"); p.wait_for_timeout(150); check(nrows() == total and p.locator("#fleetFilters .chip[aria-pressed=true]").count() == 0, "다시 누르면 모든 장비")
    # ── 경로는 관리자: 자기 지사는 목록에 없음
    p.check("#modeRev"); p.wait_for_timeout(150); o = ev(p, f"[...document.querySelectorAll(\"select[data-fk='r:{d0}:{v1}:0'] option\")].map(o => o.value)")
    check(ic not in o and sw in o and dg in o, "자기(출발) 지사는 고를 수 없음")
    check(ev(p, f"Api.saveFleet([], [{{ date: '{d0}', vehicle_id: '{v1}', stops: ['{ic}'], revised: true, times: null }}], S.round, []).then(r => r.code)") == "SA005", "서버도 자기 지사로는 거절")
    p.check("#modeInit"); p.wait_for_timeout(150)
    p.select_option(rsel(v1, d0), dg); p.wait_for_timeout(150); confirm_fleet(p); check("확정했습니다" in toast(p) and route(p, v1, d0) == ["대관령"], toast(p))
    # ── 이동 현황: 지역본부 열에 실제 대수, 카드에 '인천 252호'
    tab(p, "move"); check("연동 예정" not in p.locator("#matrix").inner_text(), "'연동 예정' 글자 없음")
    check(p.locator(f"#matrix button.mnum[data-mb='{dg}'][data-mo='지역본부'][data-mt='제설차']").inner_text() == "1", "지역본부 열에 대관령 제설차 1대")
    check(p.locator(f"#destList [data-bid='{dg}'] .vrow[data-vid='{v1}'] .plate").inner_text() == "인천 252호", "지사 카드에 인천 252호")
    p.click("#filters [data-org='지역본부']"); p.wait_for_timeout(150); check(p.locator("#destList .vrow").count() == 1, "지원기관 '지역본부'로 거르기"); p.click("#filters [data-org='전체']")
    # ── 기관별 배치: 지역본부 칸(제설차만), 지원 가능 = 확정된 대수 합계, 장비 지정, 배정 초과·배정 없음 표지
    tab(p, "alloc"); key = f"지역본부|{dg}"
    check("지역본부" in p.locator("#allocTable thead").inner_text() and p.locator(f"[data-al='{key}'][data-f=truck]").count() == 1 and p.locator(f"[data-al='{key}'][data-f=blower]").count() == 0, "지역본부는 제설차 칸만")
    setnum(f"[data-al='{key}'][data-f=truck]", 1); p.click("#save-alloc [data-save]"); p.wait_for_timeout(300); check("확정했습니다" in toast(p), toast(p))
    check(p.locator("#allocTable [data-apool=av]").inner_text().strip() == "1 / 5", "배정 1 / 지원 가능 5")
    check(ev(p, f"Api.saveAllocations(S.round, [{{ org: '지역본부', branch_id: '{dg}', truck: 1, blower: 1 }}]).then(r => r.code)") == "23514", "서버: 지역본부 제설기 배정 거절")
    tab(p, "fleet"); cell = lambda v: f"#eqTable td[data-cell='{d0}|{v}']"
    pa = ev(p, "orgAllocSummary('지역본부')"); check(p.locator(cell(v1) + " .al-flag").count() == 0 and not pa["over"] and pa["done"] == pa["total"], f"배정 안이면 표지 없음: {pa}")
    p.select_option(rsel(v2, d0), dg); p.wait_for_timeout(200); check("배정 초과" in p.locator(cell(v2) + " .al-flag").inner_text(), "배정(1대)보다 많이 보내면 배정 초과")
    p.select_option(rsel(v2, d0), yy); p.wait_for_timeout(200); check("배정 없음" in p.locator(cell(v2) + " .al-flag").inner_text(), "배정이 없는 지사는 배정 없음")
    p.select_option(rsel(v2, d0), "__del"); p.wait_for_timeout(200); check(ev(p, "S.draft.size") == 0, "지움")
    # ── 지사(인천): 자기 장비의 번호·임차·도착 시각·삭제. 피지원 지사는 관리자만(마이그레이션 55)
    as_user(p, "br-ic"); tab(p, "fleet")
    check(ev(p, "[...document.querySelectorAll('#nvOrg option')].map(o => o.value)") == ["B:" + ic] and p.locator("#save-fleet").is_visible(), "지사: 자기 지사만 등록, 저장 바 보임")
    check(vr(v1).locator("[data-vp], [data-vr], [data-vdel]").count() == 3 and p.locator("#eqTable select[data-rv]").count() == 0 and vr("V001").locator("input:enabled, select").count() == 0, "자기 장비만 고칠 수 있고 관리자용 지사 목록은 없음")
    check(p.locator(f"select[data-ra='{v1}']").count() == 0 and bn_in(p, v1, d0), "지사: 지원일 칸에 지사 드롭다운 없음, 관리자가 정한 지사 이름만(마이그레이션 55)")
    ti = f"input[data-fk='t:{d0}:{v1}:0']"; p.fill(ti, "0830"); p.press(ti, "Tab"); p.wait_for_timeout(150); confirm_fleet(p)
    check("확정했습니다" in toast(p) and ev(p, f"recOf('{d0}', '{v1}').times[0]") == "08:30", "지사: 도착 예상 시각 — " + toast(p))
    check(ev(p, f"Api.saveFleet([], [{{ date: '{d0}', vehicle_id: '{v1}', stops: ['{yy}'], revised: false, times: null }}], S.round, []).then(r => r.code)") == "42501", "서버: 지사는 지사를 바꿀 수 없음(55)")
    check(ev(p, f"Api.saveFleet([], [{{ date: '{d0}', vehicle_id: '{v1}', stops: ['{ic}'], revised: false, times: null }}], S.round, []).then(r => r.code)") == "42501", "서버: 자기 지사로도 거절(55)")
    setnum(f"[data-vp='{v2}']", 7)
    p.check(f"[data-vr='{v3}']"); p.wait_for_timeout(150); check(ev(p, f"vval(vehById('{v3}'), 'plate')") == "인천임차1" and ev(p, "S.vdraft.size") == 2, "번호·임차를 고치면 이름(저장 값)도 함께")
    confirm_fleet(p); check("확정했습니다" in toast(p) and ev(p, f"vname(vehById('{v2}'))") == "인천 임차 7호" and ev(p, f"vname(vehById('{v3}'))") == "인천 임차 1호", toast(p))
    setnum(f"[data-vp='{v3}']", 7); check("같은 이름" in toast(p) and ev(p, "S.vdraft.size") == 0, "같은 이름으로는 못 바꿈: " + toast(p))
    p.click(f"[data-vdel='{v1}']"); p.wait_for_timeout(250); check("경로가 있는 장비" in toast(p) and vr(v1).count() == 1, "경로가 있으면 못 지움: " + toast(p))
    p.click(f"[data-vdel='{v3}']"); p.wait_for_timeout(250); check("지웠습니다" in toast(p) and vr(v3).count() == 0, toast(p))
    p.fill("#nvPlate", "300"); p.click("#vehAdd"); p.wait_for_timeout(300); check("인천 300호" in toast(p), "지사 계정이 직접 등록: " + toast(p)); v4 = vid("인천 300호")
    check(ev(p, f"Api.addVehicle({{ org: '지역본부', type: '제설차', plate: '수원1', round_id: S.round, home_branch: '{sw}', rented: false }}).then(r => r.code)") == "42501", "서버: 다른 지사 이름으로는 등록 거절")
    # ── 다른 지사·기계화부: 보기만
    as_user(p, "br-sw"); tab(p, "fleet"); check(vr(v1).locator("input:enabled, select, button").count() == 0 and ev(p, "[...document.querySelectorAll('#nvOrg option')].map(o => o.value)") == ["B:" + sw], "수원지사: 인천 장비는 보기만, 자기 지사만 등록")
    as_user(p, "eq-sg"); tab(p, "fleet"); check(vr(v1).locator("input:enabled, select, button").count() == 0 and ev(p, "[...document.querySelectorAll('#nvOrg option')].map(o => o.value)") == ["서울경기"], "기계화부: 지역본부 장비는 보기만, 지사는 목록에 없음")
    check(vr(v1).locator(".plate").inner_text() == "인천 252호", "보기 전용 이름")
    # ── 확정 취소: 장비·경로는 남고 '확정 전' 표지, 새 등록만 막힘
    as_user(p, "admin1"); tab(p, "branch"); p.click("#onlyOffer"); p.wait_for_timeout(150); p.click(f"[data-unconfirm={ic}]"); p.wait_for_timeout(350)
    tab(p, "fleet"); check(vr(v1).locator(".pool-wait").count() == 1 and vr(v4).count() == 1 and route(p, v1, d0) == ["대관령"], "확정을 취소해도 장비·경로는 그대로, '확정 전' 표지")
    check("B:" + ic not in ev(p, "[...document.querySelectorAll('#nvOrg option')].map(o => o.value)") and not ev(p, f"offerOk('{ic}')"), "새 등록 목록에서 빠짐(확정 전)")
    as_user(p, "br-ic"); tab(p, "fleet"); check(p.locator("#poolWait").is_visible() and p.locator("#vehAdd").count() == 0 and vr(v1).locator("[data-vp]").count() == 1, "지사: 다시 확정될 때까지 새 등록 불가(있는 장비는 고칠 수 있음)")
    # 대수를 등록 대수(3대)보다 적게 줄여 다시 확정해도 됨
    tab(p, "branch"); setnum(f"[data-rq={ic}][data-f=offer_truck]", 1); save_branch(p); as_user(p, "admin1"); tab(p, "branch"); p.click(f"[data-confirm={ic}]"); p.wait_for_timeout(350)
    check(ev(p, f"offerOk('{ic}') && offerOf('{ic}')") == 1 and ev(p, f"poolVehs('{ic}').length") == 3, "등록 3대보다 적은 1대로도 저장·확정")
    # ── 새 기준일자: 지역본부 장비는 이어받지 않음(그 기준일자에서만 보임)
    p.click("#onlyOffer"); p.wait_for_timeout(100); old = ev(p, "S.round"); p.fill("#newRoundDate", day(p, 2)); p.click("#roundMake"); p.wait_for_timeout(400); new = ev(p, "S.round")
    tab(p, "fleet"); check(new != old and p.locator("#eqTable tr.pool").count() == 0 and ev(p, "poolVehs().length") == 0 and p.locator("[data-fo='지역본부']").is_disabled(), "새 기준일자에는 지역본부 장비가 안 보임")
    check(ev(p, f"stOf({new}, '{v1}').status") == "" and ev(p, f"!availOn('{v1}', '{day(p, 2)}')") and ev(p, f"availOn('{v1}', '{d0}')"), "새 기준일자부터는 지원 없음(앞 날짜 기록은 그대로)")
    tab(p, "move"); check(p.locator(f"#matrix button.mnum[data-mb='{dg}'][data-mo='지역본부'][data-mt='제설차']").inner_text() == "1", "오늘 이동 현황에는 그대로")
    tab(p, "fleet"); p.select_option("#roundSelFleet", str(old)); p.wait_for_timeout(400); check(p.locator("#eqTable tr.pool").count() == 3, "예전 기준일자로 돌아가면 다시 보임")

def t_fleet_only_go(p):
    """기관별 장비 [지원 장비만](2026-10-13): 지원 여부가 '지원'인 장비만 보기. 기관 버튼과 함께 쓰이고, 고치는 중인 줄은 확정 전까지 남음"""
    tab(p, "fleet"); rows = lambda: ev(p, "[...document.querySelectorAll('#eqTable tbody tr[data-vrow]')].map(r => r.dataset.vrow)")
    total = len(rows()); go = ev(p, "S.vehicles.filter(v => stOf(S.round, v.id).status === 'O').map(v => v.id)")
    check(p.locator("#onlyGo").inner_text() == "지원 장비만" and p.locator("#onlyGo").get_attribute("aria-pressed") == "false" and 0 < len(go) < total, "기관 버튼 줄에 [지원 장비만]")
    p.click("#onlyGo"); p.wait_for_timeout(150)
    check(sorted(rows()) == sorted(go) and p.locator("#onlyGo").get_attribute("aria-pressed") == "true" and p.locator("#eqTable select[data-vs]").evaluate_all("xs => xs.every(x => x.value === 'O')"), f"지원인 장비만: {len(rows())} / {total}")
    p.click("[data-fo='충북']"); p.wait_for_timeout(150); check(p.locator("#onlyGo").get_attribute("aria-pressed") == "false" and len(rows()) == ev(p, "S.vehicles.filter(v => v.org === '충북' && shownIn(v, curRound())).length") and len(rows()) > 0, "기관을 누르면 [지원 장비만]은 꺼지고 그 기관 전체")
    p.click("#onlyGo"); p.wait_for_timeout(150); check(sorted(rows()) == sorted(go) and p.locator("[data-fo='충북']").get_attribute("aria-pressed") == "false", "[지원 장비만]을 누르면 기관 버튼은 꺼짐")
    ev(p, "(S.fleetOrgs = new Set(['전북']), renderFleet())"); p.wait_for_timeout(100); check(rows() == [] and "지원 여부가 '지원'인 장비가 없습니다" in p.locator("#eqTable").inner_text(), "지원 장비가 없을 때 안내")
    ev(p, "(S.fleetOrgs = new Set(), renderFleet())"); p.wait_for_timeout(100)
    p.select_option("[data-vs=V014]", ""); p.wait_for_timeout(150); check("V014" in rows(), "고치는 중인 줄은 바로 사라지지 않음")
    confirm_fleet(p); check("확정했습니다" in toast(p) and "V014" not in rows() and len(rows()) == len(go) - 1, "확정하면 목록에서 빠짐: " + toast(p))
    p.click("#onlyGo"); p.wait_for_timeout(150); check(len(rows()) == total and p.locator("#onlyGo").get_attribute("aria-pressed") == "false", "다시 누르면 모든 장비")

def t_pool_round_delete(p):
    """(코드 검토 2026-10-13, 마이그레이션 45) 앞 기준일자의 지역본부 장비 경로가 새 기준일자 기간에 남아 있어도 새 기준일자를 지울 수 있음.
    그 장비는 새 기준일자 화면에 안 나오고 앞 기준일자 화면에서는 그 날짜가 잠겨, 예전에는 경로를 지울 방법이 없어 잘못 만든 기준일자를 지울 수 없었음"""
    ic, dg, d4 = bid(p, "인천"), bid(p, "대관령"), day(p, 4)
    v = ev(p, f"""(async () => {{ await Api.saveRequests(S.round, [{{ branch_id: '{ic}', offer_truck: 1, confirmed: true }}]);
        const a = await Api.addVehicle({{ org: '지역본부', type: '제설차', plate: '인천252', round_id: S.round, home_branch: '{ic}', rented: false }});
        const r = await Api.saveFleet([], [{{ date: '{d4}', vehicle_id: 'V001', stops: [], revised: false, times: null }}, {{ date: '{d4}', vehicle_id: a.vehicle.id, stops: ['{dg}'], revised: false, times: null }}], S.round, []);
        return r.ok ? a.vehicle.id : null }})()""")
    check(v, "준비: 인천 252호를 닷새째에 대관령으로(그날 기계화부 경로는 비움)")
    tab(p, "branch"); p.click("#reloadTop"); p.wait_for_timeout(500); old = ev(p, "S.round"); check(route(p, v, d4) == ["대관령"], "앞 기준일자에서 보임")
    p.fill("#newRoundDate", d4); p.click("#roundMake"); p.wait_for_timeout(400); new = ev(p, "S.round")
    check(new != old and ev(p, f"effRec('{d4}', '{v}').stops.length") == 0 and ev(p, f"recOf('{d4}', '{v}').stops.length") == 1, "새 기준일자가 그날을 맡아 경로는 숨겨짐(기록은 남음)")
    tab(p, "fleet"); check(p.locator("#eqTable tr.pool").count() == 0, "새 기준일자 화면에는 그 장비가 없어 경로를 지울 칸이 없음")
    tab(p, "branch"); p.click("#roundDel"); p.wait_for_timeout(400)
    check("지웠습니다" in toast(p) and ev(p, "S.round") == old, "그래도 새 기준일자를 지울 수 있음: " + toast(p))
    check(route(p, v, d4) == ["대관령"] and ev(p, f"effRec('{d4}', '{v}').stops.length") == 1, "지우면 앞 기준일자가 다시 맡아 경로가 그대로 되살아남")
    # 기계화부 장비의 경로가 그 기간에 있으면 예전처럼 막음
    ev(p, f"Api.saveFleet([], [{{ date: '{d4}', vehicle_id: 'V001', stops: ['{dg}'], revised: false, times: null }}], S.round, [])"); p.click("#reloadTop"); p.wait_for_timeout(500)
    p.fill("#newRoundDate", d4); p.click("#roundMake"); p.wait_for_timeout(400); p.click("#roundDel"); p.wait_for_timeout(400)
    check("경로가 있어" in toast(p) and ev(p, "S.round") != old, "기계화부 장비 경로가 있으면 여전히 거절: " + toast(p))

def t_branch_bulk_save(p):
    """2026-11-01: 아래 저장 막대(되돌리기·저장) 없앰 → 줄 [저장] · 본부 줄 [일괄 저장] · 관리자도 줄 [저장](확정과 따로)"""
    tab(p, "branch"); ch, dg = bid(p, "춘천"), bid(p, "대관령")
    p.click(f"[data-unconfirm={dg}]"); p.wait_for_timeout(300)
    i = f"[data-rq={dg}][data-f=assigned_truck]"; p.fill(i, "4"); p.press(i, "Tab"); p.wait_for_timeout(150)
    check(not p.locator("#save-branch").is_visible() and "1곳" in p.locator("#brDirty").inner_text(), "아래 저장 막대 없음, 위에 저장 안 한 지사 수")
    check(p.locator(f"[data-rsave='{dg}']").count() == 1, "관리자: 고친 줄에 [저장]")
    p.click(f"[data-rsave='{dg}']"); p.wait_for_timeout(300)
    check(ev(p, f"S.reqs['{dg}'].assigned_truck") == 4 and not ev(p, f"S.reqs['{dg}'].confirmed") and ev(p, f"S.reqs['{dg}'].saved_lv") == "admin" and not p.locator("#brDirty").is_visible()
          and p.locator(f"#branchTable td[data-svcell='{dg}']").inner_text().strip() == "본사저장",
          "관리자 [저장] = 편성만 저장(확정 아님), 표시는 본사저장(2026-11-02)")
    # 본부 계정: 본부 줄 [일괄 저장] → 그 본부에서 [저장]이 보이는 지사 모두
    as_user(p, "hq-gw"); tab(p, "branch"); gw = ev(p, "S.hqs.find(h => h.name === '강원').id")
    for b, v in ((ch, 2), (dg, 1)):
        i = f"[data-rq={b}][data-f=req_truck]"; p.fill(i, str(v)); p.press(i, "Tab"); p.wait_for_timeout(150)
    hb = p.locator(f"#branchTable tr.hq[data-hq='{gw}'] [data-rsave-hq]")
    check(hb.count() == 1 and hb.inner_text().strip() == "일괄 저장", "본부 줄에 [일괄 저장]")
    want = ev(p, f"S.order.filter(b => b.hq_id === '{gw}' && canReq(b) && canRowSave(b)).map(b => b.id)")
    hb.click(); p.wait_for_timeout(400)
    check("강원 본부" in toast(p) and f"{len(want)}개 지사를 저장했습니다" in toast(p), toast(p))
    check(ev(p, f"S.reqs['{ch}'].req_truck") == 2 and ev(p, f"S.reqs['{dg}'].req_truck") == 1 and all(ev(p, f"S.reqs['{b}'].saved_lv") == "hq" for b in want), "고친 값 + 본부저장")
    check("모두 본부저장" in p.locator(f"#branchTable tr.hq[data-hq='{gw}'] [data-svhq]").inner_text() and p.locator("#branchTable [data-rsave]").count() == 0, "다 저장하면 '모두 본부저장'")
    # 지사 계정(자기 줄 하나)에는 [일괄 저장] 없음
    as_user(p, "br2"); tab(p, "branch"); check(p.locator("[data-rsave-hq]").count() == 0, "지사 계정은 일괄 저장 없음")

def t_branch_two_tables(p):
    """2026-11-02: 요청·편성 표를 빈 칸으로 둘로 나눔(위치 그대로), 내 계정의 표를 파랗게, 제목 '지사' 가운데"""
    tab(p, "branch")
    gaps = ev(p, """(() => [...document.querySelectorAll('#branchTable tbody tr')].every(tr => { const c = [...tr.children], g = c.findIndex(x => x.classList.contains('blk-gap')); return g >= 0 && c[g + 1].classList.contains('adm0') && c[g - 1].classList.contains('svc'); }))()""")
    check(gaps, "모든 줄: 저장 칸과 편성 칸 사이에 빈 칸")
    cs = lambda sel, prop: ev(p, f"getComputedStyle(document.querySelector('{sel}')).{prop}")
    check(cs("#branchTable thead th", "textAlign") == "center" and p.locator("#branchTable thead th").first.inner_text().strip() == "지사", "제목 '지사' 가운데")
    check(cs("#branchTable td.adm0", "borderLeftWidth") != "3px" and ev(p, "document.querySelector('#branchTable .blk-gap').getBoundingClientRect().width") >= 10, "진한 세로줄 대신 빈 칸")
    check(ev(p, "document.querySelector('#branchTable').classList.contains('mine-right')") and "내가 입력하는 표" in p.locator("#branchCtl").inner_text(), "관리자: 오른쪽 표(편성·확정)가 내 표")
    left, right = cs("#branchTable thead th.fch", "backgroundColor"), cs("#branchTable thead th.adm", "backgroundColor")
    check(left != right, f"내 표 제목은 색이 다름: {left} {right}")
    as_user(p, "br2"); tab(p, "branch")
    check(ev(p, "(() => { const c = document.querySelector('#branchTable').classList; return c.contains('mine-left') && !c.contains('mine-right'); })()"), "지사: 왼쪽 표가 내 표")
    as_user(p, "hq-gw"); tab(p, "branch"); check(ev(p, "document.querySelector('#branchTable').classList.contains('mine-left')"), "본부: 왼쪽 표가 내 표")
    as_user(p, "viewer"); tab(p, "branch")
    check(ev(p, "(() => { const c = document.querySelector('#branchTable').classList; return !c.contains('mine-left') && !c.contains('mine-right'); })()") and "내가 입력하는 표" not in p.locator("#branchCtl").inner_text(), "보기 전용: 강조 없음")

def t_branch_compact(p):
    """2026-11-02: 한 화면에 더 많은 지사 — 줄·제목을 줄이고 표 창을 화면 아래 끝까지(화면 크기가 바뀌어도 맞춤)"""
    tab(p, "branch")
    m = lambda: ev(p, """(() => { const t = document.querySelector('#branchTable'), w = t.parentElement, r = w.getBoundingClientRect();
      return { row: t.querySelector('tbody tr[data-b]').getBoundingClientRect().height, head: t.tHead.getBoundingClientRect().height, bottom: r.bottom, h: innerHeight, wrap: r.height, table: t.getBoundingClientRect().height }; })()""")
    a = m(); check(a["row"] <= 32 and 80 <= a["head"] <= 120, f"줄·제목 높이(제목은 컴퓨터에서 조금 넓게, 2026-11-03): {a}")
    check(a["table"] <= a["wrap"] or a["h"] - 16 <= a["bottom"] <= a["h"], f"표 창이 화면 아래 끝까지: {a}")
    check(ev(p, "document.scrollingElement.scrollHeight <= innerHeight + 1"), "표 창 밖의 바깥 스크롤 없음(넓은 화면)")
    p.set_viewport_size({"width": 1440, "height": 700}); p.wait_for_timeout(250); b = m()
    check(b["table"] <= b["wrap"] or b["h"] - 16 <= b["bottom"] <= b["h"], f"창 높이가 바뀌어도 맞춤: {b}")
    p.set_viewport_size({"width": 375, "height": 700}); p.wait_for_timeout(250); c = m()
    check(c["row"] <= 32, f"휴대폰 줄 높이: {c}")
    check(ev(p, "(() => { const b = document.querySelector('#panel-branch .round-bar').getBoundingClientRect(); return b.height <= 48; })()"), "휴대폰: 기준일자 줄은 한 줄(옆으로 밀어서 봄)")
    check(ev(p, "document.documentElement.scrollWidth <= 376"), "휴대폰: 화면 자체는 옆으로 안 넘침")
    p.set_viewport_size({"width": 1440, "height": 1000})

def t_fixed_columns(p):
    """2026-11-03: 표 칸 폭은 글자 수·계정·입력값에 따라 변하지 않음. 지원일 칸만 칸 수가 늘면 줄어들고, 글자가 잘리지 않는 최소 폭 아래로는 안 줄어듦(옆으로 밀어서 봄)"""
    cols = lambda tid: ev(p, f"[...document.querySelector('#{tid}').querySelectorAll('colgroup col')].map(c => Math.round(c.getBoundingClientRect().width * 2) / 2)")
    widths = lambda tid: ev(p, f"""(() => {{ const r = [...document.querySelectorAll('#{tid} tr')].filter(x => x.cells.length).sort((a, b) => b.cells.length - a.cells.length)[0]; return [...r.cells].map(c => Math.round(c.getBoundingClientRect().width)); }})()""")
    over = lambda tid: ev(p, f"[...document.querySelectorAll('#{tid} th, #{tid} td')].filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.textContent.trim().slice(0, 20) + ' ' + c.scrollWidth + '>' + c.clientWidth).slice(0, 5)")
    base = {}
    for tb, tid in (("move", "matrix"), ("branch", "branchTable"), ("alloc", "allocTable")):
        tab(p, tb); base[tid] = widths(tid); check(ev(p, f"getComputedStyle(document.querySelector('#{tid}')).tableLayout") == "fixed", f"{tid}: 칸 폭 고정")
    for u in ("hq-gw", "br1", "eq-sg", "viewer"):                     # 계정이 바뀌어도 같은 폭(예전: 지사 칸 72~121, 도착 요청 133~290)
        as_user(p, u)
        for tb, tid in (("move", "matrix"), ("branch", "branchTable"), ("alloc", "allocTable")):
            tab(p, tb); check(widths(tid) == base[tid], f"{u} {tid}: {widths(tid)} / {base[tid]}"); check(not over(tid), f"{u} {tid} 넘침: {over(tid)}")
        tab(p, "fleet"); check(not over("eqTable"), f"{u} 기관별 장비 넘침: {over('eqTable')}")
    as_user(p, "admin1"); tab(p, "branch"); ch = bid(p, "춘천"); w0 = widths("branchTable")     # 입력해도 같은 폭(직접입력·큰 숫자·날짜)
    p.check(f"input[data-rq={ch}][data-f=wx_manual]"); p.wait_for_timeout(200); i = f"[data-rq={ch}][data-f=req_truck]"; p.fill(i, "999"); p.press(i, "Tab"); p.wait_for_timeout(150)
    p.fill(f"[data-arr={ch}][data-part=d]", day(p, 0)); p.dispatch_event(f"[data-arr={ch}][data-part=d]", "change"); p.wait_for_timeout(200)
    check(widths("branchTable") == w0 and not over("branchTable"), f"입력해도 같은 폭: {w0} → {widths('branchTable')} {over('branchTable')}")
    ev(p, "(S.rdraft.clear(), refresh())"); p.wait_for_timeout(150)
    # 기관별 장비·강원본부 지원장비(2026-11-03): 지원일 칸은 늘 같은 폭, 칸 수만큼 표가 줄고 늘어남. 드롭다운은 글자보다 좁아지지 않음
    wrap = lambda tid: f"document.querySelector('#{tid}').parentElement"
    p.set_viewport_size({"width": 1366, "height": 800}); p.wait_for_timeout(150)
    for tb, tid, sel, fixed in (("fleet", "eqTable", "#colsSel", 3), ("gwteam", "teamTable", "#colsSelTeam", 2)):
        tab(p, tb); tw = lambda: ev(p, f"Math.round(document.querySelector('#{tid}').getBoundingClientRect().width)")
        p.select_option(sel, "6"); p.wait_for_timeout(250); w6 = widths(tid); t6 = tw()
        check(not ev(p, f"{wrap(tid)}.scrollWidth > {wrap(tid)}.clientWidth + 1"), f"{tid}: 지원일 6칸은 1366 화면에 스크롤 없이: {t6}")
        check(not over(tid), f"{tid}: 6칸 넘침 {over(tid)}")
        p.select_option(sel, "2"); p.wait_for_timeout(250); w2 = widths(tid); t2 = tw()
        check(w2[:fixed] == w6[:fixed] and w2[fixed] == w6[fixed] and t2 < t6 - 250, f"{tid}: 2칸이면 칸 폭 그대로, 표가 줄어듦 {t6} → {t2}")
        check(not over(tid), f"{tid}: 2칸 넘침 {over(tid)}")
        p.select_option(sel, "10"); p.wait_for_timeout(250); w10 = widths(tid); t10 = tw()
        check(len(w10) >= 12, f"{tid}: 10칸 {w10}")
        check(not ev(p, f"{wrap(tid)}.scrollWidth > {wrap(tid)}.clientWidth + 1"), f"{tid}: 10칸도 옆으로 밀지 않고 다 보임 {t10}")
        small = ev(p, f"Math.min(...[...document.querySelectorAll('#{tid} .slot select.ci')].filter(x => x.offsetParent).map(x => x.getBoundingClientRect().width), 999)")
        check(small >= 66, f"{tid}: 드롭다운이 글자보다 좁아지지 않음 {small}")
        p.select_option(sel, "4"); p.wait_for_timeout(250)
    p.set_viewport_size({"width": 1400, "height": 900}); p.wait_for_timeout(150)
    # 이동 현황: 칸 안 이동 글자가 길어도 칸은 그대로(줄바꿈)
    tab(p, "move"); w0 = widths("matrix"); go_date(p, day(p, 2)); check(not over("matrix"), f"이동 글자 넘침: {over('matrix')}"); check(widths("matrix") == w0, f"날짜가 바뀌어도 같은 폭: {w0} {widths('matrix')}")
    go_date(p, day(p, 0))

def t_reqs_read_fail(p):
    """2026-11-03: 요청 자료를 못 읽으면 0대·미확정으로 보여 주지 않음 — 표를 숨기고 저장·확정을 막음, [다시 읽기]로 복구"""
    tab(p, "branch"); check(p.locator("#confirmAll").count() == 1, "처음엔 일괄 확정 있음")
    n0 = ev(p, "Object.keys(S.reqs).length")
    ev(p, "(window.__rq = Api.requests, Api.requests = async () => ({ ok: false, message: '시험 오류' }), null)")
    ev(p, "reloadAll()"); p.wait_for_timeout(400)
    check("불러오지 못했습니다" in p.locator("#branchTable").inner_text() and p.locator("#confirmAll, [data-confirm], [data-confirm-hq], #branchTable [data-rq]").count() == 0, "표를 숨겨 잘못 확정할 수 없음")
    ev(p, "saveBranchRows([S.order[0].id], { confirmed: true }, 'x')"); p.wait_for_timeout(200); check("저장할 수 없습니다" in toast(p), "저장도 막음: " + toast(p))
    tab(p, "alloc"); check("불러오지 못했습니다" in p.locator("#allocTable").inner_text() and "편성이 확정된 지사가 없습니다" not in p.locator("#allocTable").inner_text(), "기관별 배치도 '없음'으로 보이지 않음")
    tab(p, "branch"); ev(p, "(Api.requests = window.__rq, null)"); p.click("#branchTable [data-reload]"); p.wait_for_timeout(400)
    check(p.locator("#confirmAll").count() == 1 and ev(p, "Object.keys(S.reqs).length") == n0 and not ev(p, "S.reqsBad"), "다시 읽기로 복구")

def t_confirm_stale(p):
    """2026-11-03(마이그레이션 56): 화면을 연 뒤 다른 사람이 값을 고치면 [확정]은 거절 → 새 값을 다시 읽어 보여 줌, 다시 누르면 확정. 일괄 확정은 전부 취소. 내가 방금 저장한 줄의 확정은 거절 안 됨"""
    tab(p, "branch"); ch, dg = bid(p, "춘천"), bid(p, "대관령")
    other = lambda b, n: ev(p, f"Api.saveRequests(S.round, [{{ branch_id: '{b}', req_truck: {n} }}]).then(r => r.ok)")     # 다른 사람의 저장: 서버만 바뀌고 이 화면은 그대로
    check(ev(p, f"rval('{ch}', 'req_truck')") != 7, "시작 값"); check(other(ch, 7), "다른 사람이 저장")
    p.click(f"[data-confirm={ch}]"); p.wait_for_timeout(300)
    check("춘천" in toast(p) and "이번 확정은 취소" in toast(p), "못 본 값 확정 거절: " + toast(p))
    check(ev(p, f"rval('{ch}', 'req_truck')") == 7 and not ev(p, f"isConf('{ch}')"), "새 값을 다시 읽어 보여 줌, 확정 안 됨")
    p.click(f"[data-confirm={ch}]"); p.wait_for_timeout(300); check(ev(p, f"isConf('{ch}')"), "새 값을 본 뒤 다시 누르면 확정")
    p.click(f"[data-unconfirm={ch}]"); p.wait_for_timeout(300); check(not ev(p, f"isConf('{ch}')"), "취소는 시각 확인 없이 됨")
    # 내가 저장한 직후의 확정, 고치던 값 유지
    i = f"[data-rq={ch}][data-f=req_truck]"; p.fill(i, "8"); p.press(i, "Tab"); p.wait_for_timeout(100)
    check(other(ch, 9), "다른 사람이 또 저장"); p.click(f"[data-confirm={ch}]"); p.wait_for_timeout(300)
    check("이번 확정은 취소" in toast(p) and ev(p, f"rval('{ch}', 'req_truck')") == 8 and ev(p, f"rbase('{ch}', 'req_truck')") == 9, "거절돼도 내가 고치던 값은 남고 서버 값은 새로 읽음")
    ev(p, f"saveBranchRows(['{ch}'], null, '저장')"); p.wait_for_timeout(300)
    check(ev(p, f"rbase('{ch}', 'req_truck')") == 8 and ev(p, f"!!S.reqs['{ch}'].updated_at"), "저장하면 수정 시각을 받음")
    p.click(f"[data-confirm={ch}]"); p.wait_for_timeout(300); check(ev(p, f"isConf('{ch}')"), "내가 방금 저장한 줄의 확정은 거절 안 됨: " + toast(p))
    p.click(f"[data-unconfirm={ch}]"); p.wait_for_timeout(300)
    # 일괄 확정: 한 지사라도 바뀌었으면 전부 취소, 다시 누르면 전부 확정
    if ev(p, f"isConf('{dg}')"): p.click(f"[data-unconfirm={dg}]"); p.wait_for_timeout(300)
    check(other(dg, 5), "다른 사람이 대관령 저장"); n = ev(p, "S.order.filter(b => isConf(b.id)).length")
    p.click("#confirmAll"); p.wait_for_timeout(300)
    check("대관령" in toast(p) and "이번 확정은 취소" in toast(p) and "확정되지 않았습니다" in toast(p), "일괄 확정 거절: " + toast(p))
    check(ev(p, "S.order.filter(b => isConf(b.id)).length") == n and ev(p, f"rval('{dg}', 'req_truck')") == 5, "한 지사도 확정 안 됨, 새 값 보임")
    p.click("#confirmAll"); p.wait_for_timeout(300); check(p.locator("#confirmAll").count() == 0, "다시 누르면 전부 확정")

def t_fleet_sum(p):
    """2026-11-03: 기관별 장비의 요약 표 — 열 = 기관 > 장비(이동정비차 없음, 지역본부는 제설차만, 맨 끝 전체), 행 = 상태·계·배정, 배정 칸의 화살표로 배정지 줄을 펴고 접음"""
    tab(p, "fleet")
    check(p.locator("#orgGrid .org").count() == 0 and p.locator("#fleetSum").count() == 1, "카드 대신 표")
    h1 = [x.strip() for x in p.locator("#fleetSum thead tr").nth(0).locator("th").all_inner_texts()]
    check(h1 == ["상태", "전체", "서울경기", "충북", "전북", "대구경북", "지역본부"], f"첫 줄 = 전체(서울경기 왼쪽) + 기관: {h1}")
    h2 = [x.strip() for x in p.locator("#fleetSum thead tr").nth(1).locator("th").all_inner_texts()]
    check(h2 == ["제설차", "제설기"] * 5 + ["제설차"], f"둘째 줄 = 장비, 지역본부는 제설차만: {h2}")
    bg = lambda sel: ev(p, "getComputedStyle(document.querySelector(`" + sel + "`)).backgroundColor")
    check(bg("#fleetSum thead th.tot") == "rgb(255, 243, 176)" and bg("#fleetSum tr[data-fsrow='지원'] td.tot") == "rgb(255, 243, 176)" and bg("#fleetSum tr[data-fsrow='지원'] td:not(.tot)") != "rgb(255, 243, 176)", "전체 칸 강조")
    check("이동정비차" not in p.locator("#orgGrid").inner_text(), "이동정비차 없음")
    rows = [x.replace("▾", "").replace("▴", "").strip() for x in p.locator("#fleetSum tbody tr > th").all_inner_texts()]
    check(rows == ["지원", "배정"], f"행 = 지원 · 배정만(2026-11-04: 지원 불가·정비중·계 줄 없앰): {rows}")
    cnt = lambda o, t, st: ev(p, f"(() => {{ const r = curRound(); return S.vehicles.filter(v => shownIn(v, r) && v.type === '{t}' && ({'true' if o is None else repr(o) + ' === v.org'}) && stOf(r.id, v.id).status === '{st}').length; }})()")
    c = lambda k: int(p.locator(f"#fleetSum [data-fs='{k}']").inner_text())
    for o in ("서울경기", "충북", "전북", "대구경북"):
        for t in ("제설차", "제설기"):
            check(c(f"{o}:{t}:O") == cnt(o, t, "O"), f"{o} {t} 지원")
    for t in ("제설차", "제설기"):
        check(c(f"전체:{t}:O") == cnt(None, t, "O"), f"전체 {t} 지원")
    # 지원 여부를 바꾸면 바로 바뀜
    vid, org = ev(p, "(() => { const v = S.vehicles.find(v => v.type === '제설차' && !v.home_branch && shownIn(v, curRound()) && stOf(S.round, v.id).status === 'O'); return [v.id, v.org]; })()")
    a0 = c(f"{org}:제설차:O")
    p.select_option(f"select[data-vs='{vid}']", ""); p.wait_for_timeout(200); check(c(f"{org}:제설차:O") == a0 - 1, "빈칸으로 바꾸면 표가 바로 바뀜")
    ev(p, "(S.sdraft.clear(), refresh())"); p.wait_for_timeout(100)
    # 배정지: 칸마다 지사 이름 + 대수 한 줄씩, 확정된 지사만
    bs = ev(p, "S.order.filter(b => isFixed(b.id)).slice(0, 2).map(b => [b.id, b.name])"); check(len(bs) == 2, f"확정 지사 2곳: {bs}")
    ev(p, f"(S.alloc.clear(), S.fleetAssignOpen = true, S.alloc.set(ak('서울경기', '{bs[0][0]}'), {{ truck: 2, blower: 0 }}), S.alloc.set(ak('충북', '{bs[0][0]}'), {{ truck: 1, blower: 1 }}), S.alloc.set(ak('서울경기', '{bs[1][0]}'), {{ truck: 1, blower: 0 }}), refresh())"); p.wait_for_timeout(150)
    lst = lambda k: p.locator(f"#fleetSum [data-fsl='{k}'] > div").all_inner_texts()
    check(lst("서울경기:제설차") == [f"{bs[0][1]} 2", f"{bs[1][1]} 1"], f"서울경기 제설차: {lst('서울경기:제설차')}")
    check(lst("충북:제설기") == [f"{bs[0][1]} 1"] and lst("전체:제설차") == [f"{bs[0][1]} 3", f"{bs[1][1]} 1"], "칸마다 줄바꿈, 전체는 합")
    check(p.locator("#fleetSum [data-fsa='서울경기:제설차']").inner_text() == "3" and p.locator("#fleetSum [data-fsa='전체:제설차']").inner_text() == "4", "배정 대수 줄")
    # 접고 펴기: 배정 대수 줄은 그대로
    tog = p.locator("#fleetSum tr[data-fsrow='배정'] th [data-fsopen]"); check(tog.get_attribute("aria-expanded") == "true" and "배정" in tog.inner_text() and "배정지" not in tog.inner_text(), "화살표는 배정 칸에")
    check(p.locator("#fleetSum tr.fs-asg th").inner_text() == "배정지", "펴면 배정지 줄이 나타남")
    tog.click(); p.wait_for_timeout(100)
    check(p.locator("#fleetSum [data-fsl]").count() == 0 and p.locator("#fleetSum [data-fsopen]").get_attribute("aria-expanded") == "false" and p.locator("#fleetSum [data-fsa='서울경기:제설차']").inner_text() == "3", "접으면 지사 줄만 사라짐")
    ev(p, "refresh()"); p.wait_for_timeout(100); check(p.locator("#fleetSum [data-fsl]").count() == 0 and p.locator("#fleetSum tr.fs-asg").count() == 0, "다시 그려도 접힌 그대로, 배정지 줄 자체가 없음")
    p.locator("#fleetSum [data-fsopen]").click(); p.wait_for_timeout(100); check(p.locator("#fleetSum [data-fsl]").count() > 0, "다시 펴짐")
    # 처음엔 접힘
    ids = ev(p, "S.order.slice(0, 8).map(b => b.id)")
    ev(p, f"(S.fleetAssignOpen = null, S.rdraft.clear(), {ids}.forEach(id => {{ S.reqs[id] = {{ ...REQ_DEF, ...(S.reqs[id] || {{}}), confirmed: true, assigned_truck: 1 }}; S.alloc.set(ak('서울경기', id), {{ truck: 1, blower: 0 }}); }}), refresh())"); p.wait_for_timeout(150)
    check(p.locator("#fleetSum [data-fsopen]").get_attribute("aria-expanded") == "false" and p.locator("#fleetSum [data-fsl]").count() == 0, "처음엔 접힘")
    # 좁은 화면: 표만 옆으로 밀림, 맨 왼쪽 칸 고정
    p.set_viewport_size({"width": 375, "height": 800}); p.wait_for_timeout(200)
    check(ev(p, "document.scrollingElement.scrollWidth") <= 376 and ev(p, "(() => { const w = document.querySelector('.fs-wrap'); return w.scrollWidth > w.clientWidth; })()"), "휴대폰: 화면은 그대로, 표만 옆으로")
    check(ev(p, "getComputedStyle(document.querySelector('#fleetSum th.l')).position") == "sticky", "상태 칸 고정")
    p.set_viewport_size({"width": 1400, "height": 900})

def t_tables_sizes(p):
    """2026-11-03 C안: 기관별 장비·기관별 배치·강원본부 지원장비 표. 컴퓨터 = 글자 14~16px, 잘리는 글자 없음, 지원일 6칸이 스크롤 없이 들어옴, 위쪽 줄과 표가 같은 폭. 휴대폰 = 작은 글자(줄 34px 이하), 칸 구성 그대로. 번호 칸은 숫자 4개, 지역본부 장비 이름이 옆 칸과 겹치지 않음"""
    fs = lambda sel: ev(p, f"parseFloat(getComputedStyle(document.querySelector('{sel}')).fontSize)")
    rowh = lambda tid: ev(p, f"[...document.querySelectorAll('#{tid} tbody tr')].map(r => r.getBoundingClientRect().height).sort((a, b) => a - b)[Math.floor(document.querySelectorAll('#{tid} tbody tr').length / 2)]")      # 보통 줄(경유지가 여럿인 줄은 더 높음)
    over = lambda tid: ev(p, f"[...document.querySelectorAll('#{tid} th, #{tid} td')].filter(c => c.offsetParent && c.scrollWidth > c.clientWidth + 1).map(c => c.textContent.trim().slice(0, 18) + ' ' + c.scrollWidth + '>' + c.clientWidth).slice(0, 5)")
    clip = lambda tid: ev(p, f"[...document.querySelectorAll('#{tid} select.ci, #{tid} input.ci:not([type=checkbox])')].filter(i => i.offsetParent && i.scrollWidth > i.clientWidth + 1).map(i => (i.value || i.placeholder) + ' ' + i.scrollWidth + '>' + i.clientWidth).slice(0, 5)")
    def sel_ok(tid):
        ws = ev(p, f"Math.min(...[...document.querySelectorAll('#{tid} .slot select.ci')].filter(x => x.offsetParent).map(x => x.getBoundingClientRect().width), 999)")
        check(ws >= fs("#" + tid) * 4.9, f"{tid}: 드롭다운 폭 {ws}")
    for w, want in ((1366, 14.2), (1920, 16)):
        p.set_viewport_size({"width": w, "height": 900}); p.wait_for_timeout(350)
        tab(p, "fleet"); p.select_option("#colsSel", "6"); p.wait_for_timeout(300)
        check(abs(fs("#eqTable") - want) < .5, f"{w}: 글자 {fs('#eqTable')}")
        wr = "document.querySelector('#eqTable').parentElement"
        check(not ev(p, f"{wr}.scrollWidth > {wr}.clientWidth + 1"), f"{w}: 지원일 6칸은 스크롤 없이 {ev(p, f'{wr}.scrollWidth')} {ev(p, f'{wr}.clientWidth')}")
        check(not over("eqTable"), f"{w}: 기관별 장비 넘침 {over('eqTable')}"); check(not clip("eqTable"), f"{w}: 입력칸 글자 잘림 {clip('eqTable')}"); sel_ok("eqTable")
        tw = ev(p, "document.querySelector('#eqTable').getBoundingClientRect().width"); pw = ev(p, "document.querySelector('#panel-fleet').getBoundingClientRect().width")
        check(abs(pw - tw) <= 3 and tw <= (1460 if w == 1920 else w - 40), f"{w}: 위쪽 줄과 표가 같은 폭 {tw} / {pw}")
        check(rowh("eqTable") >= 55, f"{w}: 줄 높이 {rowh('eqTable')}")
        sc = ev(p, """[...document.querySelectorAll('#eqTable select[data-vs]')].filter(s => s.offsetParent).map(s => { s.value = 'O'; const c = document.createElement('canvas').getContext('2d'), cs = getComputedStyle(s); c.font = cs.fontSize + ' ' + cs.fontFamily; return s.clientWidth - c.measureText('지원').width; })""")
        ev(p, "refresh()"); p.wait_for_timeout(100)
        check(sc and min(sc) >= 16, f"{w}: 지원 여부 '지원'이 칸에 들어감 {sc[:1]}")
        dt = ev(p, """(() => { const i = document.querySelector('#day1In'), th = i.closest('th'); const c = document.createElement('canvas').getContext('2d'), cs = getComputedStyle(i); c.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; const q = i.getBoundingClientRect(), t = th.getBoundingClientRect(); return [q.right - (t.right - parseFloat(getComputedStyle(th).paddingRight)), q.width - (c.measureText(i.value).width + parseFloat(cs.fontSize) * .85 + 10 * parseFloat(cs.letterSpacing || 0))]; })()""")
        check(dt[0] <= 1 and dt[1] >= 0, f"{w}: 지원일 1 날짜가 칸 안에 다 보임 {dt}")
        p.select_option("#colsSel", "4"); p.wait_for_timeout(250)
        tab(p, "gwteam"); check(not over("teamTable") and not clip("teamTable"), f"{w}: 강원본부 넘침 {over('teamTable')} {clip('teamTable')}"); check(abs(fs("#teamTable") - want) < .5, "강원본부 글자")
        tab(p, "alloc"); check(not over("allocTable"), f"{w}: 기관별 배치 넘침 {over('allocTable')}"); check(abs(fs("#allocTable") - want) < .5, "기관별 배치 글자")
        check(ev(p, "document.querySelector('#allocTable').getBoundingClientRect().width") >= 860, f"{w}: 기관별 배치가 너무 작지 않음")
        check(rowh("allocTable") >= 45, f"{w}: 기관별 배치 줄 높이 {rowh('allocTable')}")
        check(not ev(p, "(() => { const w = document.querySelector('#allocTable').parentElement; return w.scrollWidth > w.clientWidth + 1; })()"), f"{w}: 기관별 배치 스크롤 없음")
    p.set_viewport_size({"width": 1400, "height": 900}); p.wait_for_timeout(350); tab(p, "fleet")
    inp = ev(p, "(() => { const i = document.querySelector('#eqTable input[data-vp]'); i.value = '8888'; return [i.scrollWidth, i.clientWidth, i.maxLength]; })()")
    check(inp[0] <= inp[1] and inp[2] == 4, f"번호 칸: 숫자 4개가 들어감 {inp}")
    ev(p, "refresh()"); p.wait_for_timeout(100)
    # 지역본부 장비: 지사 이름이 길어도 이름·임차·번호가 제설차 칸과 겹치지 않음
    tab(p, "branch"); ic = bid(p, "인천")
    ev(p, f"Api.saveRequests(S.round, [{{ branch_id: '{ic}', offer_truck: 3, confirmed: true }}]).then(() => loadReqs()).then(() => refresh())"); tab(p, "fleet"); p.wait_for_timeout(100)
    p.select_option("#nvOrg", "B:" + ic); p.wait_for_timeout(100); p.check("#nvRent"); p.fill("#nvPlate", "12"); p.click("#vehAdd"); p.wait_for_timeout(300); check("임차 12호" in toast(p), toast(p))
    ev(p, f"(S.brById['{ic}'].name = '남양주휴게소', refresh())"); p.wait_for_timeout(100)      # 이름이 긴 지사
    gap = lambda: ev(p, """(() => { const tr = document.querySelector('#eqTable tr.pool'), a = tr.querySelector('td'), last = [...a.querySelectorAll('input, label, span')].map(e => e.getBoundingClientRect().right), t = tr.cells[1].getBoundingClientRect().left; return t - Math.max(...last); })()""")
    check(gap() >= 0, f"이름·임차·번호가 옆 칸 앞에서 끝남: {gap()}")
    as_user(p, "viewer"); tab(p, "fleet"); p.wait_for_timeout(100)
    check(gap() >= 0 and p.locator("#eqTable tr.pool .plate").count() == 1, f"보기 전용 계정: 이름 글자도 겹치지 않음 {gap()}")
    as_user(p, "admin1")
    # 표를 둘러싼 흰 상자도 표만큼만
    p.select_option("#colsSel", "2"); p.wait_for_timeout(200)
    check(ev(p, "(() => { const w = document.querySelector('#eqTable').parentElement.getBoundingClientRect().width, t = document.querySelector('#eqTable').getBoundingClientRect().width; return w - t <= 4; })()"), "지원일 2칸: 상자도 표 폭으로 줄어듦")
    p.select_option("#colsSel", "4"); p.wait_for_timeout(200)
    # 휴대폰: 작은 글자, 세로가 짧음, 칸 폭은 그대로
    p.set_viewport_size({"width": 375, "height": 800}); p.wait_for_timeout(350); tab(p, "fleet")
    check(fs("#eqTable") == 12.5 and rowh("eqTable") <= 65, f"휴대폰: 인원 두 줄을 포함한 글자 {fs('#eqTable')}, 줄 {rowh('eqTable')}")
    check(ev(p, "document.querySelector('#eqTable colgroup col:nth-child(6)').style.width") == "176px", "휴대폰 인원 열 다음 지원일 칸 폭은 그대로")
    check(ev(p, "[...document.querySelectorAll('#eqTable thead th')].slice(0, 4).map(t => t.textContent)") == ["도공번호", "장비", "블로워", "지원 여부"] and p.locator("#eqTable .vid2").count() == 0, "휴대폰 칸 구성은 그대로")
    check(ev(p, "document.querySelector('#panel-fleet').style.maxWidth") == "", "휴대폰은 폭을 맞추지 않음")
    check(ev(p, "document.scrollingElement.scrollWidth") <= 376, "휴대폰: 화면이 옆으로 밀리지 않음")
    check(ev(p, "document.querySelector('#fleetFilters').getBoundingClientRect().height") <= 110, "휴대폰: 버튼 줄이 한 줄씩")
    tab(p, "alloc"); check(fs("#allocTable") == 12.5, "휴대폰 기관별 배치 글자")
    p.set_viewport_size({"width": 1400, "height": 900}); p.wait_for_timeout(300)

def t_fleet_sum_fixed(p):
    """2026-11-03: 기관별 장비의 지원일 칸을 늘리거나 줄여도 위쪽 장비 현황 표는 같은 크기, 아래 표만 달라짐. 휴대폰은 그대로"""
    box = lambda sel: ev(p, f"(() => {{ const r = document.querySelector('{sel}').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }})()")
    for w in (1366, 1920):
        p.set_viewport_size({"width": w, "height": 900}); p.wait_for_timeout(350); tab(p, "fleet"); got = []
        for n in ("2", "4", "6", "8", "10"):
            p.select_option("#colsSel", n); p.wait_for_timeout(200); got.append((box(".fs-table"), box("#eqTable")[0]))
        check(len({tuple(x[0]) for x in got}) == 1, f"{w}: 위쪽 표 크기 그대로 {[x[0] for x in got]}")
        lw = [x[1] for x in got]; check(lw[0] < lw[1] < lw[2] <= lw[-1] + 40, f"{w}: 아래 표만 달라짐 {lw}")
        p.select_option("#colsSel", "4"); p.wait_for_timeout(200)
        check(abs(box(".fs-wrap")[0] - box("#eqTable")[0]) <= 3, f"{w}: 4칸이면 위아래 폭이 같음 {box('.fs-wrap')} {box('#eqTable')}")
    p.set_viewport_size({"width": 375, "height": 800}); p.wait_for_timeout(350); tab(p, "fleet")
    check(ev(p, "document.querySelector('#orgGrid').style.maxWidth") == "", "휴대폰은 폭을 정하지 않음")
    p.set_viewport_size({"width": 1440, "height": 1000}); p.wait_for_timeout(300)

def t_no_hscroll_real_bars(p):
    """2026-11-03: 실제 브라우저처럼 스크롤 막대를 켠 상태(시험 기본은 숨김이라 표 안 세로 막대 탓 가로 스크롤을 못 잡았음). 지원일 2~10칸 모두 가로 스크롤 없음, 넘치거나 잘리는 글자 없음, 위쪽 표는 같은 크기로 화면 가운데"""
    b2 = p.context.browser.browser_type.launch(ignore_default_args=["--hide-scrollbars"])
    try:
        for w in (1280, 1366, 1536, 1920, 2560):
            q = b2.new_page(viewport={"width": w, "height": 900}); q.goto(URL); q.wait_for_selector("#matrix tbody tr"); tab(q, "fleet")
            check(q.evaluate("SBW") >= 10, f"스크롤 막대가 켜져 있어야 함: {q.evaluate('SBW')}")
            sizes = set()
            for tb, tid, sel in (("fleet", "eqTable", "#colsSel"), ("gwteam", "teamTable", "#colsSelTeam")):
                tab(q, tb)
                for n in ("2", "3", "4", "5", "6", "7", "8", "9", "10"):
                    q.select_option(sel, n); q.wait_for_timeout(120)
                    r = q.evaluate(f"""(() => {{ const t = document.querySelector('#{tid}'), w = t.parentElement, cw = document.documentElement.clientWidth, sel = [...t.querySelectorAll('.slot select.ci')].filter(s => s.offsetParent), c = document.createElement('canvas').getContext('2d'); let tight = 999; sel.forEach(s => {{ const cs = getComputedStyle(s); c.font = cs.fontSize + ' ' + cs.fontFamily; tight = Math.min(tight, s.clientWidth - c.measureText('지사 선택').width); }});
                      const ti = t.querySelector('th.dayh input'), tq = ti && ti.getBoundingClientRect(), tth = ti && ti.closest('th').getBoundingClientRect();
                      return {{ font: parseFloat(getComputedStyle(t).fontSize), tw: t.getBoundingClientRect().width, h: w.scrollWidth - w.clientWidth, page: document.documentElement.scrollWidth - cw, over: [...t.querySelectorAll('td,th')].filter(c => c.offsetParent && c.scrollWidth > c.clientWidth + 1).length, tight, off: Math.abs(w.getBoundingClientRect().left + w.getBoundingClientRect().width / 2 - cw / 2), dateIn: !ti || tq.right <= tth.right, dateW: ti ? ti.clientWidth : 999, dfont: ti ? parseFloat(getComputedStyle(ti).fontSize) : 0 }}; }})()""")
                    tag = f"{w} {tid} {n}칸 {r}"
                    check(r["h"] <= 1 and r["page"] <= 0, "가로 스크롤 없음: " + tag)
                    check(r["over"] == 0 and r["dateIn"], "넘치는 글자 없음: " + tag)
                    check(r["font"] >= 12 and r["off"] <= 2, "글자 12px 이상, 표는 가운데: " + tag)
                    check(r["tight"] >= 16, "지사 선택 글자가 드롭다운에 들어감: " + tag)
                    check(not r["dfont"] or r["dateW"] >= r["dfont"] * 6.4, "지원일 1 날짜가 칸에 들어감: " + tag)
                    if tid == "eqTable":
                        tab(q, "fleet"); sizes.add(q.evaluate("(() => { const r = document.querySelector('.fs-wrap').getBoundingClientRect(), cw = document.documentElement.clientWidth; return [Math.round(r.width), Math.round(r.height), Math.round(Math.abs(r.left + r.width / 2 - cw / 2)) <= 1]; })()").__str__())
            check(len(sizes) == 1 and "True" in next(iter(sizes)), f"{w}: 위쪽 표는 같은 크기로 화면 가운데 {sizes}")
            tab(q, "alloc"); check(q.evaluate("(() => { const w = document.querySelector('#allocTable').parentElement; return w.scrollWidth - w.clientWidth; })()") <= 1, f"{w}: 기관별 배치 가로 스크롤 없음")
            tab(q, "move"); check(q.evaluate("(() => { const w = document.querySelector('.matrix-wrap'); w.style.maxHeight = '120px'; const h = w.scrollWidth - w.clientWidth; w.style.maxHeight = ''; return h; })()") <= 1, f"{w}: 이동 현황 표는 세로 막대가 생겨도 가로 스크롤 없음")
            q.close()
    finally:
        b2.close()

def t_table_look(p):
    """2026-11-03: 이동 현황 ~ 강원본부 지원장비. 제목·내용·바탕 색이 뚜렷이 다름, 제목은 흰 글자, 모두 가운데 정렬. 다크 모드도 같음"""
    lum = lambda c: (lambda v: .2126 * v[0] + .7152 * v[1] + .0722 * v[2])([float(x) for x in c[c.index("(") + 1:-1].replace(",", " ").split()[:3]])
    style = lambda sel, f: ev(p, f"(() => {{ const e = document.querySelector({sel!r}); return e ? getComputedStyle(e).{f} : null; }})()")
    page = lambda: ev(p, "getComputedStyle(document.body).backgroundColor")
    def look(tag):
        for tb, head, cell in (("move", "#matrix thead th.orgh:not(.tot)", "#matrix tbody td:not(.tot)"), ("move", "#matrix thead tr:nth-child(2) th:not(.tot)", "#matrix tbody th[scope=row]"), ("branch", "#branchTable thead th.fch", "#branchTable tbody tr[data-b] td:nth-child(2)"), ("fleet", "#eqTable thead th", "#eqTable tbody td[data-cell]"), ("fleet", "#fleetSum thead th:not(.tot)", "#fleetSum tbody td:not(.tot)"), ("alloc", "#allocTable thead th", "#allocTable tbody td:nth-child(2)"), ("gwteam", "#teamTable thead th", "#teamTable tbody td[data-cell]")):
            tab(p, tb); p.wait_for_timeout(120)
            hb, hc = style(head, "backgroundColor"), style(head, "color")
            check(abs(lum(hb) - lum(page())) >= 30 and abs(lum(hb) - lum(hc)) >= 120, f"{tag} {head}: 제목이 바탕·글자와 뚜렷이 다름 {hb} {hc} {page()}")
            check(style(head, "textAlign") == "center", f"{tag} {head}: 제목 가운데")
            check(style(cell, "textAlign") == "center", f"{tag} {cell}: 내용 가운데")
    # 제목 줄 안의 입력칸·버튼: 글자가 자기 바탕과 뚜렷이 다름(제목의 흰 글자를 물려받으면 안 보임)
    def inner(tag):
        for tb in ("branch", "fleet", "gwteam"):
            tab(p, tb); p.wait_for_timeout(120)
            r = ev(p, """[...document.querySelectorAll('#panel-branch thead :is(.btn, input, select), #panel-fleet thead :is(.btn, input, select), #panel-gwteam thead :is(.btn, input, select)')].filter(e => e.offsetParent).map(e => { const c = getComputedStyle(e); return [e.textContent.trim().slice(0, 8) || e.id, c.color, c.backgroundColor]; })""")
            check(r, f"{tag} {tb}: 제목 줄의 입력칸·버튼을 찾음")
            for name, fg, bgc in r:
                check(abs(lum(fg) - lum(bgc)) >= 90, f"{tag} {tb} {name}: 글자가 보임 {fg} / {bgc}")
    look("밝은"); inner("밝은")
    # 이동 현황: 합계 열은 장비 현황 표의 전체 칸과 같은 노랑, 본부 칸·합계 줄은 중간 색, 내용은 흰색
    tab(p, "move"); yellow = "rgb(255, 243, 176)"
    check(style("#matrix thead th.tot", "backgroundColor") == yellow and style("#matrix tbody td.tot", "backgroundColor") == yellow and style("#matrix tfoot td.tot", "backgroundColor") == yellow, "합계 열 노랑")
    check(style("#matrix tbody th.hqc", "backgroundColor") == style("#matrix tfoot th", "backgroundColor") != style("#matrix tbody td:not(.tot)", "backgroundColor"), "본부 칸·합계 줄 색")
    check(style("#matrix tbody td.tm", "backgroundColor") == "rgb(255, 255, 255)", "신속대응팀 칸도 내용과 같은 흰색")
    check(style("#matrix tfoot th", "textAlign") == "center", "합계 글자 가운데")
    tab(p, "branch"); check(style("#branchTable thead th.fch", "backgroundColor") != style("#branchTable tbody tr.hq td", "backgroundColor") != page(), "묶음 줄 색도 다름")
    check(style("#branchTable tbody tr[data-b] td.l", "textAlign") == "center" and style("#branchTable tbody tr.hq td", "textAlign") == "center", "지사 이름·본부 줄도 가운데")
    tab(p, "fleet"); check(style("#fleetSum tbody .l", "textAlign") == "center", "장비 현황 맨 왼쪽 열도 가운데")
    off = ev(p, "(() => { const c = document.querySelector('#eqTable tbody td:first-child'), a = c.querySelector('.pnum, .plate').getBoundingClientRect(), r = c.getBoundingClientRect(); return Math.abs(a.left + a.width / 2 - (r.left + r.width / 2)); })()")
    check(off <= 6, f"도공번호 칸도 가운데: {off}")
    ev(p, "document.documentElement.dataset.theme = 'dark'"); p.wait_for_timeout(150); look("다크"); inner("다크")
    ev(p, "document.documentElement.dataset.theme = 'light'"); p.wait_for_timeout(100)
    # 휴대폰: 지사별 요청·편성 제목은 넓히지 않음
    tab(p, "branch"); h = lambda: ev(p, "document.querySelector('#branchTable thead tr:first-child').getBoundingClientRect().height")
    wide = h(); p.set_viewport_size({"width": 375, "height": 800}); p.wait_for_timeout(300); check(h() < wide + 30, f"휴대폰 제목 높이 {h()} / {wide}")
    p.set_viewport_size({"width": 1440, "height": 1000}); p.wait_for_timeout(300)

def t_branch_names_sticky(p):
    """2026-11-03: 지사별 요청·편성을 옆으로 밀어도 본부·지사 이름이 보임(맨 왼쪽 칸 고정). 밑의 칸이 비치지 않게 바탕이 불투명. 계정·줄 종류마다 확인"""
    p.set_viewport_size({"width": 375, "height": 800}); p.wait_for_timeout(300)
    for u in ("admin1", "hq-gw", "br1", "viewer"):
        as_user(p, u); tab(p, "branch"); p.wait_for_timeout(150)
        r = ev(p, """(() => { const t = document.querySelector('#branchTable'), w = t.parentElement; w.scrollLeft = 500; const wl = w.getBoundingClientRect().left;
          const cells = [t.tHead.rows[0].cells[0], t.querySelector('thead tr.tot th'), ...t.querySelectorAll('tbody tr.hq td:first-child'), ...t.querySelectorAll('tbody tr[data-b]:not(.locked) td:first-child'), ...t.querySelectorAll('tbody tr.locked td:first-child')].filter(c => c && c.offsetParent);
          const bad = cells.filter(c => { const b = getComputedStyle(c).backgroundColor; return Math.abs(c.getBoundingClientRect().left - wl) > 1.5 || b.includes('/') || b.startsWith('rgba') || b === 'transparent'; }).map(c => c.textContent.trim().slice(0, 8) + ' ' + getComputedStyle(c).backgroundColor);
          const c0 = t.querySelector('tbody tr[data-b] td:first-child').getBoundingClientRect(), hit = document.elementFromPoint(c0.left + c0.width / 2, c0.top + c0.height / 2);
          const h0 = t.tHead.rows[0].cells[0].getBoundingClientRect(), hh = document.elementFromPoint(h0.left + h0.width / 2, h0.top + h0.height / 2);
          return { scrolled: w.scrollLeft, n: cells.length, leak: cells.filter(c => getComputedStyle(c).left !== '-1px').length, bad, onTop: !!hit && !!hit.closest('td:first-child'), headTop: !!hh && hh === t.tHead.rows[0].cells[0], w: c0.width }; })()""")
        check(r["scrolled"] > 100 and r["n"] >= 10, f"{u}: 옆으로 밀림 {r}")
        check(not r["bad"], f"{u}: 첫 칸이 왼쪽에 붙고 바탕이 불투명 {r['bad']}")
        check(r["leak"] == 0, f"{u}: 왼쪽 테두리 틈으로 밀린 글자가 비치지 않음 {r['leak']}")
        check(r["onTop"] and r["headTop"], f"{u}: 이름 칸이 다른 칸보다 위에 {r}")
        ev(p, "document.querySelector('#branchTable').parentElement.scrollLeft = 0")
    as_user(p, "admin1"); p.set_viewport_size({"width": 1440, "height": 1000}); p.wait_for_timeout(300)

def t_first_col_fixed_opaque(p):
    """2026-11-03: 기관별 장비·기관별 배치·강원본부 지원장비(+장비 현황 표)를 옆으로 밀어도 맨 왼쪽 칸이 고정되고, 칸도 조상도 투명하지 않아 밀린 글자가 비치지 않음. 지원이 아닌 줄의 흐림은 글자에만"""
    p.set_viewport_size({"width": 375, "height": 800}); p.wait_for_timeout(300)
    Q = """(tid) => { const t = document.querySelector(tid), w = t.parentElement; w.scrollLeft = 300; const wl = w.getBoundingClientRect().left;
      const cells = [...t.querySelectorAll('thead tr:first-child > :first-child, tbody tr > :first-child, tfoot tr > :first-child')].filter(c => c.offsetParent && !c.classList.contains('empty') && !c.closest('tr').querySelector('.empty'));
      const see = c => { for (let e = c; e && e !== t; e = e.parentElement) if (parseFloat(getComputedStyle(e).opacity) < 1) return true; return false; };
      const bad = cells.filter(c => { const b = getComputedStyle(c).backgroundColor; return Math.abs(c.getBoundingClientRect().left - wl) > 1.5 || b.includes('/') || b.startsWith('rgba') || b === 'transparent' || see(c); }).map(c => c.textContent.trim().slice(0, 12) + ' | ' + getComputedStyle(c).backgroundColor + ' | ' + getComputedStyle(c).opacity + ' | ' + Math.round(c.getBoundingClientRect().left - wl));
      const dim = [...t.querySelectorAll('tbody tr')].filter(r => { const s = r.querySelector('select[data-vs]'); return s && s.value !== 'O'; }).map(r => { const k = r.cells[0].firstElementChild; return k ? parseFloat(getComputedStyle(k).opacity) : 1; });
      const wr = w.getBoundingClientRect(), sb = [...document.querySelectorAll('.savebar')].filter(x => x.offsetParent).map(x => x.getBoundingClientRect().top), low = Math.min(innerHeight, wr.bottom, ...sb), top = Math.max(0, wr.top + (t.tHead ? t.tHead.getBoundingClientRect().height : 0));
      const on = cells.filter(c => { if (c.closest('thead')) return false; const r = c.getBoundingClientRect(); if (r.bottom > low || r.top < top) return false; const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !(h && (h === c || c.contains(h))); }).map(c => c.textContent.trim().slice(0, 12));
      const res = { scrolled: w.scrollLeft, n: cells.length, bad, dim, on }; w.scrollLeft = 0; return res; }"""
    for u in ("admin1", "hq-gw", "br1", "eq-sg", "viewer"):
        as_user(p, u)
        for tb, tid in (("fleet", "#eqTable"), ("fleet", "#fleetSum"), ("alloc", "#allocTable"), ("gwteam", "#teamTable")):
            if not p.locator(f"[data-tab={tb}]").is_visible(): continue
            tab(p, tb); p.wait_for_timeout(120)
            if not p.locator(tid).count() or not p.locator(tid).is_visible(): continue
            r = p.evaluate(Q, tid)
            check(r["n"] >= 2 and r["scrolled"] > 20, f"{u} {tid}: 옆으로 밀림 {r['scrolled']} / {r['n']}칸")
            check(not r["bad"], f"{u} {tid}: 첫 칸이 왼쪽에 붙고 불투명 {r['bad'][:4]}")
            check(not r["on"], f"{u} {tid}: 첫 칸이 다른 칸 위에 {r['on'][:4]}")
            check(all(x < 1 for x in r["dim"]), f"{u} {tid}: 지원이 아닌 줄의 글자는 여전히 흐림 {r['dim'][:4]}")
    as_user(p, "admin1"); p.set_viewport_size({"width": 1440, "height": 1000}); p.wait_for_timeout(300)

def t_move_compact(p):
    """2026-11-03 2안: 이동 현황 표는 숫자 칸 80px, 표와 카드가 같은 폭으로 가운데에, 넓은 화면은 카드 3열. 휴대폰은 그대로"""
    cols = lambda: ev(p, "getComputedStyle(document.querySelector('.hq-cards')).gridTemplateColumns.split(' ').length")
    for w in (1366, 1920):
        p.set_viewport_size({"width": w, "height": 900}); p.wait_for_timeout(350); tab(p, "move")
        r = ev(p, """(() => { const t = document.querySelector('#matrix').getBoundingClientRect(), m = document.querySelector('#panel-move').getBoundingClientRect(), c = document.querySelector('#matrix td.c1').getBoundingClientRect(); return [t.width, m.width, m.left, innerWidth - m.right, c.width]; })()""")
        check(r[0] <= 1240 and r[1] <= 1292 and abs(r[2] - r[3]) <= 20 and r[4] == 80, f"{w}: 표 {r}")
        check(not ev(p, "(() => { const w = document.querySelector('.matrix-wrap'); return w.scrollWidth > w.clientWidth + 1; })()"), f"{w}: 표가 옆으로 안 밀림")
        check(cols() == 3, f"{w}: 카드 3열 {cols()}")
        check(ev(p, "(() => { const d = document.querySelector('.dest'), v = d.querySelector('.vrow'); return d.getBoundingClientRect().width <= 425 && v.getBoundingClientRect().height <= 38 && !([...d.querySelectorAll('.vrow')].some(x => x.scrollWidth > x.clientWidth + 1)); })()"), f"{w}: 카드가 작고 안 넘침")
    p.set_viewport_size({"width": 1920, "height": 900}); p.wait_for_timeout(350)
    ev(p, "setDate(addDays(todayISO(), 2))"); p.wait_for_timeout(300)       # 이동 안내가 있는 날: 칸 밖으로 안 넘침
    check(not ev(p, "[...document.querySelectorAll('#matrix td')].some(c => c.scrollWidth > c.clientWidth + 1)"), "이동 안내가 칸 안에 들어감")
    check(not ev(p, "[...document.querySelectorAll('#destList .vrow')].some(x => x.scrollWidth > x.clientWidth + 1)"), "카드의 이동 표시가 안 넘침")
    ev(p, "setDate(todayISO())"); p.wait_for_timeout(200)
    p.set_viewport_size({"width": 375, "height": 800}); p.wait_for_timeout(350)
    check(cols() == 1 and ev(p, "document.querySelector('#panel-move').getBoundingClientRect().width") <= 376, "휴대폰: 카드 1열")
    check(ev(p, "document.querySelector('#matrix td.c1').getBoundingClientRect().width") == 76, "휴대폰 숫자 칸 폭은 그대로")
    gap = ev(p, "document.querySelector('#matrix tbody tr').getBoundingClientRect().top - document.querySelector('#matrix thead tr:nth-child(2) th').getBoundingClientRect().bottom")
    check(gap >= -1, f"휴대폰: 머리글 둘째 줄이 첫 줄을 가리지 않음 {gap}")
    p.set_viewport_size({"width": 1440, "height": 1000}); p.wait_for_timeout(300)

def t_round_ten_days(p):
    """2026-11-03: 기준일자 기간 10일 — 지원일 10칸까지 잠기지 않음, 명칭 '기관별 배치'"""
    tab(p, "fleet"); ev(p, "(S.rounds.forEach(r => r.days = 10), refresh())"); p.select_option("#colsSel", "10"); p.wait_for_timeout(300)
    check(ev(p, "curRound().days") == 10 and ev(p, "addDays(S.day1, 9) <= roundEnd(curRound())"), "기간 10일")
    v = ev(p, "fleetRows().find(v => !v.home_branch && stOf(S.round, v.id).status === 'O').id"); d = ev(p, "addDays(S.day1, 9)")
    check(p.locator(f"td[data-cell='{d}|{v}'] select").count() >= 1 and p.locator(f"td[data-cell='{d}|{v}'] .slot.locked").count() == 0, "지원일 10도 지정 가능")
    p.select_option("#colsSel", "4"); p.wait_for_timeout(200)
    check(p.locator("[data-tab=alloc]").first.inner_text().strip() == "기관별 배치", "탭 이름")

def t_alloc_fixed_only(p):
    """2026-11-03: 기관별 배치에는 편성이 확정된 지사만. 확정을 취소하면 안 보이고, 다시 확정하면 배정 그대로 돌아옴"""
    tab(p, "branch"); dg = bid(p, "대관령")
    check(ev(p, f"isFixed('{dg}')"), "대관령은 확정된 상태")
    ev(p, f"(S.alloc.set(ak('서울경기', '{dg}'), {{ truck: 1, blower: 0 }}), refresh())"); tab(p, "alloc")
    row = lambda: p.locator(f"#allocTable tr[data-ab='{dg}']").count()
    check(row() == 1 and ev(p, "[...document.querySelectorAll('#allocTable tbody tr[data-ab]')].every(tr => isFixed(tr.dataset.ab))"), "확정된 지사만")
    tab(p, "branch"); p.click(f"[data-unconfirm={dg}]"); p.wait_for_timeout(300); tab(p, "alloc")
    check(row() == 0 and "확정 취소됨" not in p.locator("#allocTable").inner_text(), "확정을 취소하면 안 보임")
    tab(p, "branch"); p.click(f"[data-confirm={dg}]"); p.wait_for_timeout(300); tab(p, "alloc")
    check(row() == 1 and ev(p, f"aval('서울경기', '{dg}').truck") == 1, "다시 확정하면 배정 그대로")

def t_branch_totals(p):
    """2026-11-03: 지사별 요청·편성 표 맨 위 = 지사 요청·타지사 지원 가능·편성의 전체 합계. 편성은 편성 / 기관별 장비의 지원 가능 대수. 스크롤해도 보임"""
    tab(p, "branch")
    tot = lambda k: p.locator(f"#branchTable tr.tot [data-t='{k}']").inner_text().strip()
    sums = lambda f: ev(p, f"S.order.filter(b => !(S.hqById[b.hq_id] || {{}}).is_private).reduce((a, b) => a + (+rval(b.id, '{f}') || 0), 0)")
    av = lambda t: ev(p, f"(() => {{ const r = curRound(); return S.vehicles.filter(v => shownIn(v, r) && v.type === '{t}' && stOf(r.id, v.id).status === 'O').length; }})()")
    check(p.locator("#branchTable thead tr.tot").count() == 1 and p.locator("#branchTable thead tr.tot th").first.inner_text().strip() == "전체", "맨 위 전체 줄")
    for k in ("req_truck", "req_blower", "offer_truck"): check(tot(k) == str(sums(k)), f"{k}: {tot(k)} {sums(k)}")
    check(tot("assigned_truck") == f"{sums('assigned_truck')}/{av('제설차')}" and tot("assigned_blower") == f"{sums('assigned_blower')}/{av('제설기')}", f"편성/지원 가능: {tot('assigned_truck')} {tot('assigned_blower')}")
    # 칸이 제목과 맞음(지사 요청·타지사·편성 칸 위치)
    x = lambda sel: ev(p, f"Math.round(document.querySelector('{sel}').getBoundingClientRect().left)")
    tdx = lambda f: ev(p, f"Math.round(document.querySelector('#branchTable tbody tr:not(.hq) [data-f={f}]').closest('td').getBoundingClientRect().left)")
    for f in ("req_truck", "req_blower", "offer_truck", "assigned_truck", "assigned_blower"): check(x(f"#branchTable tr.tot [data-t={f}]") == tdx(f), f"{f} 칸 위치가 아래 칸과 같음")
    # 입력하면 바로 바뀜
    ch = bid(p, "춘천"); i = f"[data-rq={ch}][data-f=req_truck]"; before = sums("req_truck"); cur = int(p.locator(i).input_value())
    p.fill(i, str(cur + 3)); p.press(i, "Tab"); p.wait_for_timeout(100); check(tot("req_truck") == str(before + 3), "지사 요청을 고치면 바로 합계 반영: " + tot("req_truck"))
    ev(p, "(S.rdraft.clear(), refresh())"); p.wait_for_timeout(100)
    # 넘치면 빨강
    a0 = av("제설차"); j = f"[data-rq={ch}][data-f=assigned_truck]"; p.fill(j, str(a0 + 50)); p.press(j, "Tab"); p.wait_for_timeout(100)
    check(p.locator("#branchTable tr.tot [data-t='assigned_truck'] .al-over").count() == 1, "지원 가능보다 많으면 빨강")
    ev(p, "(S.rdraft.clear(), refresh())"); p.wait_for_timeout(100)
    # 표를 내려도 보임
    w = "document.querySelector('#branchTable').parentElement"; ev(p, f"({w}.scrollTop = 600, null)"); p.wait_for_timeout(100)
    tr = ev(p, f"document.querySelector('#branchTable tr.tot th').getBoundingClientRect().top - {w}.getBoundingClientRect().top")
    check(tr < 120 and ev(p, f"{w}.scrollTop") > 0, f"스크롤해도 맨 위에 붙음: {tr}"); ev(p, f"({w}.scrollTop = 0, null)")

def t_removed_hints(p):
    """2026-11-03: 강원본부 지원장비·기관별 배치의 긴 설명 문구 삭제"""
    tab(p, "gwteam"); check("직접 보내는" not in p.locator("#teamRound").inner_text() and p.locator("#roundSelTeam").count() == 1, "강원본부 지원장비 설명 없음")
    tab(p, "alloc"); check("몇 대 보낼지" not in p.locator("#allocRound").inner_text() and p.locator("#roundSelAlloc").count() == 1, "기관별 배치 설명 없음")

def t_branch_saved(p):
    """(2026-10-15, 마이그레이션 46) 지사·본부는 요청·지원 가능이 0이어도 [저장] → '저장 완료'(타지사 지원 가능 다음 칸). 관리자 저장·확정은 남기지 않음.
    보기 버튼은 처음에 아무것도 안 눌림, [저장 안 한 지사만]은 맨 오른쪽"""
    tab(p, "branch"); dg, yy, cj = bid(p, "대관령"), bid(p, "양양"), bid(p, "춘천")
    cell = lambda b: p.locator(f"#branchTable td[data-svcell='{b}']")
    check(p.locator("#branchCtl .chip[aria-pressed=true]").count() == 0 and p.locator("#branchCtl .chip").last.inner_text() == "저장안함", "기본 보기 = 아무 버튼도 안 눌림, [저장안함]은 맨 오른쪽")
    check(cell(cj).locator("button").count() == 0 and cell(cj).inner_text().strip() == "-", "관리자에게는 [저장] 버튼 없음(확정하면 그만)")
    as_user(p, "br2"); tab(p, "branch")                                       # 양양지사(확정된 줄)
    check(cell(yy).locator("button").count() == 0, "확정된 줄은 [저장] 없음")
    as_user(p, "br1"); tab(p, "branch")                                       # 대관령지사: 확정된 줄 → 관리자가 취소해야 저장 가능
    as_user(p, "admin1"); tab(p, "branch"); p.click(f"[data-unconfirm={dg}]"); p.wait_for_timeout(300)
    as_user(p, "hq-gw"); tab(p, "branch")
    check(cell(cj).locator("[data-rsave]").count() == 1 and cell(dg).locator("[data-rsave]").count() == 1, "본부: 자기 본부 지사 줄마다 [저장]")
    check(ev(p, f"rval('{cj}', 'req_truck')") == 2, "춘천은 요청 있음(그대로 저장)")
    p.click(f"[data-rsave='{cj}']"); p.wait_for_timeout(300)
    check("춘천 지사를 저장했습니다" in toast(p) and cell(cj).inner_text().strip() == "본부저장" and ev(p, f"!!S.reqs['{cj}'].saved_at"), "바꾼 것 없이 눌러도 저장 → 본부저장: " + toast(p))
    # 요청 0 인 지사: 0 그대로 저장 가능
    wj = bid(p, "원주"); check(ev(p, f"rval('{wj}', 'req_truck') + rval('{wj}', 'req_blower') + rval('{wj}', 'offer_truck')") == 0, "원주는 요청·지원 가능 모두 0")
    p.click(f"[data-rsave='{wj}']"); p.wait_for_timeout(300); check(cell(wj).inner_text().strip() == "본부저장", "0이어도 저장 → 본부저장(요청 안 함도 알림)")
    # 고치면 다시 [저장] → 저장 완료
    i = f"[data-rq={wj}][data-f=offer_truck]"; p.fill(i, "1"); p.press(i, "Tab"); p.wait_for_timeout(150)
    check(cell(wj).locator("[data-rsave]").count() == 1, "저장한 뒤 고치면 다시 [저장]")
    save_branch(p); check(cell(wj).inner_text().strip() == "본부저장" and ev(p, f"S.reqs['{wj}'].offer_truck") == 1, "다시 [저장] → 저장 완료")
    # 관리자: 저장 안 한 지사만 / 관리자 저장은 저장 완료가 아님
    as_user(p, "admin1"); tab(p, "branch"); p.click("#onlyUnsaved"); p.wait_for_timeout(150)
    shown = ev(p, "[...document.querySelectorAll('#branchTable tr[data-b]')].map(r => r.dataset.b)")
    check(cj not in shown and wj not in shown and dg in shown and len(shown) > 10 and p.locator("#onlyUnsaved").get_attribute("aria-pressed") == "true", f"저장 안 한 지사만: {len(shown)}줄")
    i = f"[data-rq={dg}][data-f=req_truck]"; p.fill(i, "5"); p.press(i, "Tab"); save_branch(p)
    check(ev(p, f"S.reqs['{dg}'].saved_lv") == "admin" and ev(p, f"savedLabel('{dg}')") == "본사저장" and dg not in ev(p, "[...document.querySelectorAll('#branchTable tr[data-b]')].map(r => r.dataset.b)"),
          "관리자가 고쳐 저장하면 본사저장 → [저장안함]에서 빠짐(2026-11-02 사용자 결정)")
    # 지사 계정이 저장하면 지사저장(마지막에 저장한 쪽이 보임)
    as_user(p, "br1"); tab(p, "branch"); i = f"[data-rq={dg}][data-f=req_truck]"; p.fill(i, "4"); p.press(i, "Tab"); save_branch(p)
    check(cell(dg).inner_text().strip() == "지사저장" and ev(p, f"S.reqs['{dg}'].saved_lv") == "branch", f"지사 계정 저장 = 지사저장: {cell(dg).inner_text()}")
    as_user(p, "admin1"); tab(p, "branch")
    p.click("#onlyUnsaved"); p.wait_for_timeout(150); check(p.locator("#branchCtl .chip[aria-pressed=true]").count() == 0, "다시 누르면 모든 지사")

def t_hq_bulk_marks_branch_saved(p):
    """2026-11-02: 지사가 저장한 줄(지사저장)은 본부에게 줄 [저장]이 안 나오지만, 본부 줄 [일괄 저장]으로 고치지 않아도 한 번에 '본부저장'(본부가 확인했다는 표시)"""
    tab(p, "branch"); dg, ch = bid(p, "대관령"), bid(p, "춘천"); gw = ev(p, "S.hqs.find(h => h.name === '강원').id")
    p.click(f"[data-unconfirm={dg}]"); p.wait_for_timeout(300)
    cell = lambda b: p.locator(f"#branchTable td[data-svcell='{b}']"); hb = lambda: p.locator(f"#branchTable tr.hq[data-hq='{gw}'] [data-svhq]")
    as_user(p, "br1"); tab(p, "branch"); p.click(f"[data-rsave='{dg}']"); p.wait_for_timeout(300)
    check(cell(dg).inner_text().strip() == "지사저장", "지사가 저장 → 지사저장")
    as_user(p, "hq-gw"); tab(p, "branch")
    check(cell(dg).locator("[data-rsave]").count() == 0 and cell(dg).inner_text().strip() == "지사저장", "본부에게 지사저장 줄의 [저장]은 안 나옴(고치지 않았으면)")
    want = ev(p, f"S.order.filter(b => b.hq_id === '{gw}' && canReq(b) && bulkOk(b)).map(b => b.id)")
    check(dg in want and hb().locator("[data-rsave-hq]").count() == 1, f"본부 줄 [일괄 저장]에 지사저장 줄도 들어감: {want}")
    hb().locator("[data-rsave-hq]").click(); p.wait_for_timeout(400)
    check(f"{len(want)}개 지사를 저장했습니다" in toast(p), toast(p))
    check(cell(dg).inner_text().strip() == "본부저장" and all(ev(p, f"S.reqs['{b}'].saved_lv") == "hq" for b in want), "일괄 저장 → 모두 본부저장")
    check("모두 본부저장" in hb().inner_text() and hb().locator("[data-rsave-hq]").count() == 0, "다 바꾸면 '모두 본부저장', 버튼 없음")
    as_user(p, "br1"); tab(p, "branch"); check(cell(dg).inner_text().strip() == "본부저장", "지사 화면에서도 본부저장으로 보임(본부가 확인함)")

def t_report(p):
    """2026-11-02: 이동 현황 → 1쪽 보고서(신속대응팀 제설장비 지원 현황). [보고서 보기] 미리 보기 · [Word 받기] .docx
    숫자는 이동 현황 표와 같고, 도착일시 = 그 지사로 새로 오는 장비 중 가장 빠른 시각, 아래 네모 = 기계화부(기관별)·지역본부(본부별)"""
    import zipfile, io, re, xml.dom.minidom as md
    d0 = ev(p, "S.date")
    check(p.locator("#rptView").is_visible() and p.locator("#rptDoc").is_visible(), "이동 현황에 [보고서 보기]·[Word 받기]")
    M = ev(p, "SSReport.model(S.date)")
    tr = ev(p, "movesOn(S.date).filter(m => m.v.type === '제설차').length"); bl = ev(p, "movesOn(S.date).filter(m => m.v.type === '제설기').length")
    check(M["trucks"] == tr and M["blowers"] == bl and M["total"] == tr + bl, f"합계가 이동 현황과 같음: {M['trucks']}/{tr}, {M['blowers']}/{bl}")
    check(sum(r["n"] for g in M["groups"] for r in g["rows"]) == M["total"] and M["branches"] == sum(len(g["rows"]) for g in M["groups"]), "지사별 대수의 합 = 총 대수")
    # 도착일시: 같은 지사로 가는 두 장비 중 이른 시각(장비마다 다름)
    row = next(r for g in M["groups"] for r in g["rows"] if r["n"] >= 2)
    vids = ev(p, f"movesOn(S.date).filter(m => m.pos === '{row['id']}' && m.rec.stops[0] === '{row['id']}' && !isCont(m.v.id, S.date, '{row['id']}')).map(m => m.v.id)")
    check(len(vids) >= 2, f"샘플에 같은 지사로 새로 오는 장비 2대 이상: {vids}")
    if len(vids) >= 2:
        ev(p, f"S.draft.set(rk(S.date, '{vids[0]}'), {{ ...recOf(S.date, '{vids[0]}'), times: ['09:40'] }}); S.draft.set(rk(S.date, '{vids[1]}'), {{ ...recOf(S.date, '{vids[1]}'), times: ['07:05'] }})")
        r2 = next(r for g in ev(p, "SSReport.model(S.date)")["groups"] for r in g["rows"] if r["id"] == row["id"])
        check(r2["eta"].endswith(" 07:05"), f"가장 빠른 도착 시각: {r2['eta']}")
        ev(p, "S.draft.clear()")
    check(M["notes"] and M["notes"][0].startswith("기계화부 ") and "(" in M["notes"][0], f"아래 네모 = 기계화부 N대(기관별): {M['notes']}")
    # 지역본부 장비가 있으면 본부 단위로(서울경기 N대)
    pool = ev(p, "SSReport.model(S.date).notes.find(n => n.startsWith('지역본부'))")
    if pool: check(re.match(r"지역본부 \d+대\(.+ \d+대", pool), pool)
    # 2026-11-02: 지역본부 장비는 표에는 보낸 지사 이름(시흥 2), 아래 네모에는 그 본부(수도권 2대)
    sh = bid(p, "시흥")
    lab = ev(p, f"SSReport.srcLabel({{ id: 'VX', org: POOL, type: '제설차', home_branch: '{sh}' }})")
    check(lab["label"] == "시흥", f"지역본부 장비의 표 이름 = 보낸 지사: {lab}")
    check(ev(p, "SSReport.srcLabel(vehById('V001')).label") == ev(p, "vehById('V001').org"), "기계화부 장비는 기관 이름 그대로")
    # 미리 보기
    p.click("#rptView"); p.wait_for_selector("#rpPage")
    pg = p.locator("#rpPage").inner_text()
    check("신속대응팀 제설장비 지원 현황" in pg and f"총 {M['total']}대" in pg and f"{M['branches']}개 기관 지원" in pg and row["name"] in pg, pg[:200])
    # 워드 받기(미리 보기 안의 버튼) → 압축 안 XML 이 올바르고 같은 내용
    with p.expect_download() as dl: p.click("#rptDocIn")
    f = dl.value; check(f.suggested_filename == f"신속대응팀_제설장비_지원현황_{d0}.docx", f.suggested_filename)
    z = zipfile.ZipFile(io.BytesIO(open(f.path(), "rb").read()))
    check(sorted(z.namelist()) == sorted(["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "word/document.xml"]), z.namelist())
    for n in z.namelist(): md.parseString(z.read(n))                      # 모두 올바른 XML
    doc = z.read("word/document.xml").decode("utf-8"); txt = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", doc))
    check("신속대응팀 제설장비 지원 현황" in txt and f"총 {M['total']}대 (" in txt and row["name"] in txt and "기관별 지원 현황" in txt and M["notes"][0] in txt, txt[:300])
    check("<w:pgSz w:w=\"11906\" w:h=\"16838\"/>" in doc, "A4 세로")
    check('<w:tblLayout w:type="fixed"/>' in doc and '<w:tab w:val="right"' in doc and "<w:tab/>" in doc, "칸 폭 고정, 지원장비 칸은 이름 왼쪽·대수 오른쪽 고정 위치(탭)")
    check(ev(p, "getComputedStyle(document.querySelector('#rpPage .rp-t')).tableLayout") == "fixed" and ev(p, "document.querySelectorAll('#rpPage .rp-t col').length") == 8, "미리 보기도 칸 폭 고정")
    # A4 한 장 모양(794×1123) 그대로, 화면 폭에 맞게 줄여 보임(2026-11-02) — 휴대폰 폭에서도 표가 깨지지 않음
    box = ev(p, "(() => { const pg = document.querySelector('#rpPage'); return [pg.offsetWidth, pg.offsetHeight, pg.scrollHeight] })()")
    check(box[0] == 794 and box[1] == 1123 and box[2] <= 1123, f"종이 = A4 794×1123, 내용이 한 장 안: {box}")
    p.set_viewport_size({"width": 375, "height": 800}); p.wait_for_timeout(300)
    bb = p.locator("#rpPage").bounding_box(); sw = ev(p, "document.querySelector('#rpWrap').clientWidth")
    check(bb["width"] <= sw + 1 and bb["width"] < 375 and abs(bb["height"] / bb["width"] - 1123 / 794) < 0.02 and ev(p, "document.documentElement.scrollWidth") <= 375,
          f"휴대폰 폭: 종이 전체를 줄여 A4 비율 그대로(가로 스크롤 없음): {bb}")
    p.set_viewport_size({"width": 1440, "height": 1000}); p.wait_for_timeout(200)
    p.click("#sheetClose")
    with p.expect_download() as dl2: p.click("#rptDoc")              # 이동 현황 위의 [Word 받기]도
    check(dl2.value.suggested_filename.endswith(".docx"), "위쪽 [Word 받기]")

def t_report_snow_warning(p):
    """2026-11-03: 보고서의 대수와 지원장비 사이에 강설량·특보(지사당 두 줄). 특보는 대설 글자 없이 주의보·경보·예비(발효시각). 오늘 보고서에만 값, 다른 날짜는 '-'. 미리 보기와 워드가 같음"""
    import re, xml.dom.minidom as md
    wt = lambda js: ev(p, f"SSReport.wxText({js})")
    check(wt("{ level: '주의', ef: '2026-11-03T06:00:00+09:00' }") == "주의보(11.3 06:00)", wt("{ level: '주의', ef: '2026-11-03T06:00:00+09:00' }"))
    check(wt("{ level: '경보', ef: '2026-12-25T23:10:00+09:00' }") == "경보(12.25 23:10)", "경보")
    check(wt("{ level: '예비', ef: '2026-11-03T17:58:00+09:00' }") == "예비(11.3 12~18시)", wt("{ level: '예비', ef: '2026-11-03T17:58:00+09:00' }"))
    check(wt("{ level: '예비', ef: '2026-11-03T16:20:00+09:00' }") == "예비(11.3 16:20)", "약속 시각이 아닌 예비")
    check(wt("{ level: '주의', ef: null }") == "주의보" and wt("{ level: null }") == "특보 없음" and wt("{ none: true }") == "-", "발효 없음·특보 없음·값 없음")
    tab(p, "move"); ev(p, "setDate(todayISO())"); p.wait_for_timeout(200)
    M = ev(p, "SSReport.model(S.date)"); rows = [r for g in M["groups"] for r in g["rows"]]; check(rows, "보고서 지사 있음")
    for r in rows:
        want = ev(p, f"(() => {{ const f = fcOf('{r['id']}'); return f && !f.none && f.snow != null ? fcAmt(f, 'snow') + 'cm' : '-'; }})()")
        check(r["wx"]["snow"] == want, f"{r['name']}: 강설량 = 이동 현황 카드와 같은 값 {r['wx']} / {want}")
        check("대설" not in r["wx"]["warn"] and re.fullmatch(r"(주의보|경보|예비)(\(\d+\.\d+ .+\))?|특보 없음|-", r["wx"]["warn"]), f"{r['name']}: 특보 글자 {r['wx']}")
    on = [r for r in rows if r["wx"]["lv"]]; check(on, f"샘플에 주의보·경보 지사: {[r['wx'] for r in rows]}")
    p.click("#rptView"); p.wait_for_selector("#rpPage"); p.wait_for_timeout(150)
    r = ev(p, """(() => { const t = document.querySelector('#rpPage .rp-t'), body = t.tBodies[0], on = t.querySelector('td.rp-on');
      return { head: t.tHead.innerText, rows: body.rows.length, labels: [...t.querySelectorAll('td.rp-l')].map(c => c.textContent), red: on && getComputedStyle(on).color, over: [...t.querySelectorAll('td,th')].filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.textContent.trim().slice(0, 18)), first: [...t.rows[0].cells].map(c => c.textContent.trim()) }; })()""")
    check("강설량(24시간)" in r["head"] and "특보" in r["head"], r["head"]); check(r["first"][:3] == ["피지원기관", "대 수", "강설량(24시간)·특보"], f"대수 다음 칸: {r['first']}")
    check(r["rows"] == len(rows) * 2 and r["labels"] == ["강설량", "특보"] * len(rows), f"지사당 두 줄: {r['rows']} {r['labels']}")
    check(r["red"] == "rgb(238, 0, 0)", f"주의보·경보 강조 {r['red']}"); check(not r["over"], f"글자가 칸을 넘지 않음: {r['over']}")
    check(ev(p, "document.querySelector('#rpPage').scrollHeight") <= 1123, "한 장 안")
    p.click("#sheetClose"); p.wait_for_timeout(100)
    doc = ev(p, "SSReport.docXml(SSReport.model(S.date))"); md.parseString(doc); txt = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", doc))
    check("강설량(24시간)·특보" in txt and txt.count("강설량") == len(rows) + 1 and on[0]["wx"]["warn"] in txt and on[0]["wx"]["snow"] in txt, "워드도 같은 내용: " + txt[:200])
    check('<w:gridCol w:w="760"/>' in doc and doc.count("<w:vMerge/>") >= len(rows) * 6, "워드: 강설량·특보 두 줄, 나머지 칸은 합침")
    check(all(r.count("<w:tc>") in (1, 4, 5, 6, 7, 8) for r in re.findall(r"<w:tr>.*?</w:tr>|<w:tr .*?</w:tr>", doc)), "워드: 줄마다 칸 수 정상")
    # 다른 날짜: 날짜별 예보가 없으므로 '-'
    ev(p, "setDate(addDays(todayISO(), 1))"); p.wait_for_timeout(250)
    o = [r["wx"] for g in ev(p, "SSReport.model(S.date)")["groups"] for r in g["rows"]]
    check(o and all(w["snow"] == "-" and w["warn"] == "-" and not w["lv"] for w in o), f"내일 보고서는 '-': {o}")
    ev(p, "setDate(todayISO())"); p.wait_for_timeout(200)

def t_back_button(p):
    """2026-11-02: 뒤로가기 = 이전 탭(페이지를 떠나지 않음). 창(장비 상세 등)이 열려 있으면 뒤로가기는 창만 닫음"""
    sel = lambda: ev(p, "document.querySelector('.tab[aria-selected=true]').dataset.tab")
    tab(p, "branch"); tab(p, "fleet"); check(sel() == "fleet", sel())
    p.go_back(); p.wait_for_timeout(300); check(sel() == "branch" and "sample=1" in p.url, f"뒤로가기 → 지사별 요청·편성: {sel()} {p.url}")
    p.go_back(); p.wait_for_timeout(300); check(sel() == "move" and "sample=1" in p.url, f"한 번 더 → 이동 현황(아직 같은 페이지): {sel()}")
    p.go_forward(); p.wait_for_timeout(300); check(sel() == "branch", "앞으로 가기도 탭으로")
    tab(p, "move"); p.locator("#destList .vrow").first.click(); p.wait_for_timeout(300); check(p.locator("#sheet").is_visible(), "장비 상세 창 열림")
    p.go_back(); p.wait_for_timeout(300); check(not p.locator("#sheet").is_visible() and sel() == "move", "뒤로가기 = 창만 닫힘, 탭은 그대로")
    p.locator("#destList .vrow").first.click(); p.wait_for_timeout(300); p.click("#sheetClose"); p.wait_for_timeout(300)
    p.go_back(); p.wait_for_timeout(300); check(sel() == "branch", f"[닫기]로 닫은 뒤의 뒤로가기는 바로 이전 탭으로(빈 칸 없음): {sel()}")

def t_alloc_follow_assign(p):
    """(2026-10-15, 마이그레이션 46) 기관별 배치 합계는 편성보다 많을 수 없음. 편성을 줄여 다시 확정하면 — 한 기관만 배정받았으면 그 기관이 편성에 맞춰 줄고,
    여러 기관이면 그대로 두고 '편성보다 많음' 표시, 편성 0이면 배정을 지움. 확정만 취소한 동안에는 그대로"""
    dg, yy = bid(p, "대관령"), bid(p, "양양")                                  # 대관령 편성 제설차 6·제설기 4, 양양 8·2 (확정됨)
    tab(p, "alloc"); inp = lambda o, b, f: f"[data-al='{o}|{b}'][data-f={f}]"
    setv = lambda sel, v: (p.fill(sel, str(v)), p.press(sel, "Tab"), p.wait_for_timeout(150))
    setv(inp("서울경기", dg, "truck"), 9); check(p.locator(inp("서울경기", dg, "truck")).input_value() == "6" and "많이 배정할 수 없습니다" in toast(p), "편성(6)보다 많이 넣으면 6으로: " + toast(p))
    setv(inp("충북", dg, "truck"), 2); check(p.locator(inp("충북", dg, "truck")).input_value() == "0", "다른 기관 몫까지 합쳐 6을 넘을 수 없음")
    setv(inp("서울경기", dg, "truck"), 4); setv(inp("충북", dg, "truck"), 2); setv(inp("서울경기", yy, "truck"), 8); setv(inp("서울경기", yy, "blower"), 2)
    p.click("#save-alloc [data-save]"); p.wait_for_timeout(300); check("확정했습니다" in toast(p), toast(p))
    check(ev(p, f"Api.saveAllocations(S.round, [{{ org: '충북', branch_id: '{dg}', truck: 3, blower: 0 }}]).then(r => r.code)") == "SA006", "서버도 편성보다 많은 배정은 거절(SA006)")
    # 편성을 줄여 다시 확정: 양양(서울경기 한 곳) 8→5 → 자동으로 5, 대관령(두 기관) 6→3 → 그대로 + 표시, 제설기 0 → 지움
    tab(p, "branch")
    for b, f, v in ((yy, "assigned_truck", 5), (yy, "assigned_blower", 0), (dg, "assigned_truck", 3)):
        p.click(f"[data-unconfirm={b}]") if p.locator(f"[data-unconfirm={b}]").count() else None; p.wait_for_timeout(300)
        sel = f"[data-rq={b}][data-f={f}]"; p.fill(sel, str(v)); p.press(sel, "Tab"); p.wait_for_timeout(100)
    tab(p, "alloc"); check(ev(p, f"(S.alloc.get('서울경기|{yy}') || {{}}).truck") == 8, "확정을 취소한 동안에는 배정 그대로")
    tab(p, "branch"); p.click(f"[data-confirm={yy}]"); p.wait_for_timeout(350); p.click(f"[data-confirm={dg}]"); p.wait_for_timeout(350)
    tab(p, "alloc"); p.click("#reloadTop"); p.wait_for_timeout(500)
    check(ev(p, f"JSON.stringify(S.alloc.get('서울경기|{yy}'))") == '{"truck":5,"blower":0}', f"한 기관만 → 편성에 맞춰 줄고 제설기(편성 0)는 지워짐: {ev(p, f'JSON.stringify(S.alloc.get(\"서울경기|{yy}\"))')}")
    check(ev(p, f"(S.alloc.get('서울경기|{dg}') || {{}}).truck") == 4 and ev(p, f"(S.alloc.get('충북|{dg}') || {{}}).truck") == 2, "여러 기관 → 자동으로 안 줄임")
    check("편성보다 많음" in p.locator(f"#allocTable tr[data-ab='{dg}']").inner_text() and "편성보다 많음" not in p.locator(f"#allocTable tr[data-ab='{yy}']").inner_text(), "여러 기관이면 '편성보다 많음' 표시")
    setv(inp("충북", dg, "truck"), 0); p.click("#save-alloc [data-save]"); p.wait_for_timeout(300)
    check("확정했습니다" in toast(p) and "편성보다 많음" in p.locator(f"#allocTable tr[data-ab='{dg}']").inner_text(), "아직 넘어도 줄이는 저장은 됨(4 > 3): " + toast(p))
    # 편성 0 으로 확정 → 배정이 지워져 표에서 빠짐(예전에는 '확정 취소됨'으로 잠겨 고칠 수 없었음)
    tab(p, "branch"); p.click(f"[data-unconfirm={dg}]"); p.wait_for_timeout(300)
    for f in ("assigned_truck", "assigned_blower"): sel = f"[data-rq={dg}][data-f={f}]"; p.fill(sel, "0"); p.press(sel, "Tab"); p.wait_for_timeout(100)
    p.click(f"[data-confirm={dg}]"); p.wait_for_timeout(350)
    tab(p, "alloc"); p.click("#reloadTop"); p.wait_for_timeout(500)
    check(ev(p, f"[...S.alloc.keys()].some(k => k.endsWith('|{dg}'))") is False and p.locator(f"#allocTable tr[data-ab='{dg}']").count() == 0, "편성 0 확정 → 배정 지움, 표에서 빠짐")

def t_gw_team(p):
    """강원본부 지원장비(마이그레이션 48): 탭은 관리자·강원본부만, 요청 없는 지사로도 보냄(강원 지사가 목록 맨 위), 요청·편성·기관별 장비는 그대로,
    이동 현황 = 지역본부 다음 겹세로줄 뒤 '강원 신속대응팀' 열(제설차만) + 합계·아래 카드에 더해짐, 체크박스 하나로 함께 빼고 넣음(기억), 로그 기록"""
    d0, hc = day(p, 0), bid(p, "홍천")
    car = "movesOn(S.date).filter(m => m.v.type === '제설차').length"; tot0 = ev(p, car)
    for uid, on in (("admin1", True), ("hq-gw", True), ("br1", False), ("eq-sg", False), ("viewer", False)):
        as_user(p, uid); check(p.locator("#teamTabBtn").is_visible() == on, f"{uid}: 탭 보임 {on}")
    as_user(p, "hq-gw"); tab(p, "gwteam")
    check(p.locator("#teamTable tbody td:first-child .plate").all_inner_texts() == ["원주", "대관령", "강릉", "양양"], "4대, 이름 고정(2026-11-02 홍천 → 양양)")
    check(p.locator(rsel("GW1", d0)).is_disabled(), "미정이면 경로 칸이 꺼져 있음")
    p.select_option("#teamTable select[data-vs=GW1]", "O"); p.wait_for_timeout(100)
    groups = ev(p, f"[...document.querySelector(\"{rsel('GW1', d0)}\").querySelectorAll('optgroup')].map(g => g.label)")
    check(groups[0] == "강원" and len(groups) >= 9 and not any("편성 확정 전" in g for g in groups), f"모든 본부, 강원 먼저: {groups}")
    check(not ev(p, f"hasReq('{hc}')") and not ev(p, f"isFixed('{hc}')"), "홍천은 요청·편성 없음")
    p.select_option(rsel("GW1", d0), hc); p.wait_for_timeout(100)
    t = f"input[data-fk='t:{d0}:GW1:0']"; p.fill(t, "0730"); p.press(t, "Tab"); p.wait_for_timeout(150)
    reqs0 = ev(p, "JSON.stringify(S.reqs)")
    check(ev(p, "teamDirty() && !fleetDirty()") and p.locator("#save-fleet").is_hidden(), "기관별 장비 저장 바와 따로")
    p.click("#save-gwteam [data-save]"); p.wait_for_timeout(300)
    check("확정했습니다" in toast(p) and route(p, "GW1", d0) == ["홍천"] and ev(p, f"recOf('{d0}', 'GW1').times[0]") == "07:30", toast(p))
    check(ev(p, "JSON.stringify(S.reqs)") == reqs0 and not ev(p, "teamDirty()"), "지사 요청·편성 숫자는 그대로")
    tab(p, "move")
    heads = [h.strip() for h in p.locator("#matrix thead tr:first-child th").all_inner_texts()]
    check(heads[-1] == "강원 신속대응팀" and heads[-2] == "지역본부", f"지역본부 다음: {heads}")
    check(ev(p, "getComputedStyle(document.querySelector('#matrix th.tm.orgh')).borderLeftStyle") == "double" and p.locator("#matrix thead tr:nth-child(2) th.tm").count() == 1, "겹세로줄, 제설차 칸 하나")
    tr = p.locator("#matrix tbody tr", has=p.locator("th[scope=row]", has_text="홍천"))
    check(tr.locator("td.tm").inner_text().strip().startswith("1") and tr.locator("td.tot.c1").inner_text().strip().startswith("1"), "홍천: 신속대응팀 1대, 합계 1대")
    check(ev(p, car) == tot0 + 1 and p.locator(f"#destList [data-bid='{hc}'] .vrow.team").count() == 1, "합계·아래 홍천 카드에 더해짐")
    p.uncheck("#showTeam"); p.wait_for_timeout(200)
    check(p.locator("#matrix .tm").count() == 0 and "홍천" not in rows(p) and p.locator("#destList .vrow.team").count() == 0 and ev(p, car) == tot0, "끄면 열·합계·카드에서 함께 빠짐")
    p.check("#showTeam"); p.wait_for_timeout(200); check(p.locator("#matrix th.tm").count() == 2, "다시 켜면 보임")
    as_user(p, "br1"); check(ev(p, "Api.saveTeam(S.round, [], [{ team_id: 'GW2', status: 'O' }]).then(r => r.ok)") is False, "지사 계정은 서버가 거절")
    as_user(p, "admin1"); tab(p, "log")
    check("신속대응팀 경로" in p.locator("#logTable").inner_text() and "신속대응팀 원주" in p.locator("#logTable").inner_text(), "로그 기록에 남음")
    tab(p, "move"); p.uncheck("#showTeam"); p.reload(); p.wait_for_selector("#matrix tbody tr")
    check(not p.locator("#showTeam").is_checked() and p.locator("#matrix .tm").count() == 0, "끈 상태를 이 브라우저에 기억")

def t_route_perm_admin_only(p):
    """지원장비 아이디에 '모든 기관'(equip.edit.all)을 줘도 지원일 칸은 예전 수준(자기 기관 첫날 한 곳·도착 시각) — 지원일 칸 전부는 관리자(equip.route)만 (migration 49)"""
    as_user(p, "eq-sg")
    ev(p, "S.me = { ...S.me, perms: ['equip.edit.own', 'equip.edit.all'] }, Api.setActor(S.me), refresh()"); tab(p, "fleet")
    check(p.locator("#eqTable select[data-rv]").count() == 0, "지사 목록 칸(관리자용) 없음")
    check(p.locator("#day1In").count() == 0 and p.locator("#fleetReset").count() == 0 and p.locator("#modeRev").count() == 0 and p.locator("#colsSel").count() == 0, "지원일 1·초기화·최초/수정본·칸 수 없음")
    check(p.locator("[data-vdel=V013]").count() == 1 and p.locator("[data-vhide=V013]").count() == 1, "모든 기관 장비의 삭제·숨기기는 그대로")
    check(len(p.locator("#nvOrg option:not([disabled])").all_inner_texts()) >= 4, "모든 기관 장비 추가는 그대로")
    check(p.locator("#eqTable [data-rt=V014], #eqTable [data-ra=V014]").count() == 0, "다른 기관(충북) 장비의 지원일 칸은 못 고침")
    check(p.locator("#eqTable [data-rt=V002], #eqTable [data-ra=V002]").count() > 0, "자기 기관 장비는 예전처럼(첫날 한 곳 또는 도착 시각)")
    ev(p, f"S.draft.set(rk('{day(p, 1)}', 'V014'), {{ stops: ['{bid(p, '양양')}', '{bid(p, '대관령')}'], revised: false, times: [null, null] }}), updateSavebars()"); confirm_fleet(p)
    check("권한이 없습니다" in toast(p), "화면을 우회해 다른 기관 경로를 보내도 거절: " + toast(p))
    as_user(p, "admin1"); tab(p, "fleet"); check(p.locator("#eqTable select[data-rv]").count() > 0 and p.locator("#day1In").count() == 1, "관리자는 지원일 칸 전부")

TESTS = [t_route_revisit_and_order, t_route_perm_admin_only, t_gw_team, t_branch_two_tables, t_branch_compact, t_fixed_columns, t_reqs_read_fail, t_confirm_stale, t_fleet_sum, t_tables_sizes, t_fleet_sum_fixed, t_no_hscroll_real_bars, t_table_look, t_branch_names_sticky, t_first_col_fixed_opaque, t_move_compact, t_round_ten_days, t_alloc_fixed_only, t_branch_totals, t_removed_hints, t_branch_bulk_save, t_hq_bulk_marks_branch_saved, t_report, t_report_snow_warning, t_back_button, t_branch_saved, t_alloc_follow_assign, t_pool_round_delete, t_fleet_only_go, t_pool_vehicles, t_reload, t_allocation, t_moves_between_branches, t_round_status_rules, t_hide_vehicle, t_views_and_choices_after_confirm_all, t_confirm_all_by_hq, t_confirmed_row_locked, t_weather_manual, t_load, t_move_hierarchy, t_dest_order_and_day_tag, t_route_choices_confirmed_only, t_confirm_keeps_history, t_day1_header_and_columns,
         t_multi_stop_add_and_delete, t_status_maintenance, t_reset_button, t_permissions_equip_own, t_branch_permissions, t_branch_save_confirm_and_arrive,
         t_round_create, t_history_tooltip_per_cell, t_log_tab, t_plate_edit, t_vehicle_add_delete, t_dest_layout_and_jump, t_link_numbers_no_underline_hover_bg, t_fleet_sort_blower_delete, t_fleet_header_stays_on_top, t_theme_toggle,
         t_unsaved_guard_on_user_switch, t_xss_text_is_escaped, t_no_driver_info_anywhere,
         t_typing_then_clicking_next_input_keeps_both, t_round_delete, t_pending_branches_shown_grey, t_ui_version_reload_once,
         t_route_kind_and_eta, t_equip_can_edit_eta, t_bulk_confirm_and_no_holdings, t_filters_fit_any_width, t_date_in_title, t_branch_header_stays_on_top,
         t_warning_auto_badge, t_zone_manager, t_zone_requests, t_snow_forecast, t_private_hq_hidden_in_branch_tab]

# ---------------------------------------------------------------- 서버 모드(가짜 Supabase, tests/_sb_mock.py) — 실제 로그인 권한·저장 함수 호출
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _sb_mock import Mock, install
SERVER_URL = f"http://127.0.0.1:{PORT}/equipment/index.html"

def server_page(b, mock, user):
    p = b.new_page(viewport={"width": 1440, "height": 1000}); p.on("dialog", lambda d: d.accept())
    p.on("pageerror", lambda e: errors.append(f"[server] {e}"))
    install(p, mock, user); p.goto(SERVER_URL); p.wait_for_selector("#matrix tbody tr", timeout=15000); return p

def t_server_many_vehicles(b):
    """(코드 검토 2026-10-13) 장비가 1,000줄을 넘어도 모두 읽음: 서버는 한 번에 1,000줄만 주고, 지역본부 장비(sort 0)가 앞에 와서 예전에는 기계화부 장비가 잘려 사라졌음"""
    m = Mock(); mech = len(m.vehicles)
    m.vehicles = [{"id": "V%05d" % (10000 + i), "org": "지역본부", "type": "제설차", "plate": "인천%d" % i, "status": "", "sort": 0, "active": True, "round_id": 999, "home_branch": "B001", "rented": False} for i in range(1005)] + m.vehicles
    p = server_page(b, m, "admin-01")
    check(ev(p, "S.vehicles.length") == 1005 + mech and ev(p, "S.vehicles.filter(v => !isPool(v)).length") == mech, f"장비 {1005 + mech}줄을 모두 읽음: {ev(p, 'S.vehicles.length')}")
    tab(p, "fleet"); check(p.locator("#eqTable tbody tr[data-vrow]").count() == mech and p.locator("#eqTable tr.pool").count() == 0, "기계화부 장비가 그대로 보이고, 다른 기준일자의 지역본부 장비는 안 보임")
    p.close()

def t_server_equip_confirm(b):
    """지원장비 계정(서울경기)으로 로그인: 자기 기관 장비만, [확정]은 save_fleet 에 바뀐 칸만 보냄. 접속 아이디(데모·미리보기) 선택은 없음"""
    m = Mock(); p = server_page(b, m, "equip-01")
    check(p.locator(".user-box").is_hidden(), "로그인한 화면에는 접속 아이디(데모) 선택이 없음(2026-10-05)")
    tab(p, "fleet"); check(p.locator("[data-vs=V001]").count() == 1 and p.locator("[data-vs=V002]").count() == 0 and p.locator("select[data-rv]").count() == 0, "자기 기관 도공번호·지원 여부만(경로는 관리자)")
    d0 = m.today
    p.select_option("[data-vs=V001]", "O" if ev(p, "stOf(S.round, 'V001').status") != "O" else ""); s1 = ev(p, "stOf(S.round, 'V001').status"); p.fill("[data-vp=V001]", "911"); p.press("[data-vp=V001]", "Tab"); p.wait_for_timeout(150); confirm_fleet(p)
    check(m.eq_calls[-1] == ("save_fleet", {"p_vehicles": [{"id": "V001", "plate": "서울경기911"}], "p_routes": [], "p_round": 1, "p_status": [{"vehicle_id": "V001", "status": s1, "off_from": None, "crew": []}]}), m.eq_calls)
    check(next(x for x in m.rstatus if x["round_id"] == 1 and x["vehicle_id"] == "V001")["status"] == s1, "서버의 기준일자별 지원 여부에 저장")
    check("확정했습니다" in toast(p), toast(p))
    p.close()
    p = server_page(b, m, "admin-01"); tab(p, "fleet")
    opts = p.locator(rsel("V002", d0) + " option:not([disabled])").all_inner_texts()
    check([o for o in opts if o not in ("지사 선택", "지우기")] == ["충주"], f"관리자: 확정된 지사만: {opts}")
    p.close()

def t_server_branch_save(b):
    """지사 계정: 자기 지사 행만, [저장]은 save_requests 에 바뀐 열만(도착 시각은 ISO)"""
    m = Mock(); m.users["exchungju"]["profile"]["must_change"] = False
    m.round_reqs[0]["confirmed"] = False                                   # 확정된 줄은 잠기므로(2026-10-05) 확정 전 줄로
    p = server_page(b, m, "exchungju"); tab(p, "branch")
    check(set(x.get_attribute("data-rq") for x in p.locator("#branchTable [data-rq]").all()) == {"B019"}, "자기 지사만")
    p.fill("[data-rq=B019][data-f=req_truck]", "5"); p.press("[data-rq=B019][data-f=req_truck]", "Tab"); p.wait_for_timeout(150)
    p.select_option("[data-arr=B019][data-part=m]", "40"); p.wait_for_timeout(150)
    save_branch(p)
    name, body = m.eq_calls[-1]; row = body["p_rows"][0]
    check(name == "save_requests" and body["p_round"] == 1 and set(row) == {"branch_id", "req_truck", "arrive_at"} and row["req_truck"] == 5, m.eq_calls)
    check(row["arrive_at"].endswith("Z") and ev(p, f"localInput('{row['arrive_at']}')").endswith(":40"), row)
    check("저장했습니다" in toast(p), toast(p)); p.close()

def t_server_warning(b):
    """서버 모드: warning_status 를 불러 특보 표시, 확정한 지사는 서버가 고정한 값(warn_*)을 보여 줌"""
    m = Mock(); m.users["exchungju"]["profile"]["must_change"] = False
    p = server_page(b, m, "exchungju"); tab(p, "branch")
    check(any(c[0] == "warning_status" for c in m.eq_calls), "특보 요약을 서버에서 읽음")
    w = p.locator("td[data-wcell='B019'] .wb"); check(w.inner_text() == "대설경보" and "locked" in p.locator("tr[data-b='B019']").get_attribute("class"), w.inner_text())
    check("기준" in p.locator("#wBaseHead").inner_text(), "서버 모드: 대설특보 기준 시각 " + p.locator("#wBaseHead").inner_text())
    p.close()

def t_server_lock_and_confirm_all(b):
    """서버 모드(로그인 화면): 확정하면 그 줄 비활성, 본부 [일괄 확정]은 요청 없는 지사까지, 지사 화면이 모른 채 저장하면 '이미 확정' 안내"""
    m = Mock(); m.users["exchungju"]["profile"]["must_change"] = False
    m.round_reqs[0]["confirmed"] = False
    p = server_page(b, m, "admin-01"); tab(p, "branch")
    row = p.locator("tr[data-b='B019']"); en = "input:not([disabled]), select:not([disabled])"
    check(row.locator(en).count() > 3, "확정 전: 입력 가능")
    p.click("[data-confirm='B019']"); p.wait_for_timeout(500)
    check(row.locator(en).count() == 0 and row.locator("[data-unconfirm]").count() == 1, "확정하면 그 줄 비활성")
    check(p.locator(f"#branchTable tr.hq[data-hq='{ev(p, "S.branches.find(x => x.id === 'B019').hq_id")}']").inner_text().count("모두 확정") == 1, "충북(충주 하나)은 모두 확정")
    hq = ev(p, "S.hqs.find(h => h.name === '강원').id"); ids = ev(p, f"S.order.filter(x => x.hq_id === '{hq}').map(x => x.id)")
    p.click(f"[data-confirm-hq='{hq}']"); p.wait_for_timeout(500)
    saved = {r["branch_id"] for r in m.round_reqs if r.get("confirmed")}
    check(set(ids) <= saved and "확정했습니다" in toast(p), f"본부 일괄 확정 = 요청 없던 지사까지 서버에 저장: {sorted(set(ids) - saved)}")
    # 마이그레이션 56: 확정 때 내가 본 수정 시각을 보냄, 그사이 다른 사람이 저장했으면 거절 → 새 값을 읽음(서버 오류 코드 경로)
    o = ev(p, "S.order.find(x => !isConf(x.id) && !S.reqs[x.id] && !(S.hqById[x.hq_id] || {}).is_private).id")
    m.round_reqs.append({"round_id": 1, "branch_id": o, "req_truck": 4, "req_blower": 0, "assigned_truck": 0, "assigned_blower": 0, "confirmed": False, "updated_at": "2026-11-03T01:00:00.123456+00:00"})
    p.click(f"[data-confirm='{o}']"); p.wait_for_timeout(500)
    _, body = m.eq_calls[-1]; check(body["p_rows"][0].get("expect_at", "x") is None, f"빈 줄을 봤으면 null 을 보냄: {body}")
    check("이번 확정은 취소" in toast(p) and ev(p, f"rval('{o}', 'req_truck')") == 4 and not ev(p, f"isConf('{o}')"), "못 본 값 확정 거절: " + toast(p))
    p.click(f"[data-confirm='{o}']"); p.wait_for_timeout(500)
    _, body = m.eq_calls[-1]; check(body["p_rows"][0].get("expect_at") == "2026-11-03T01:00:00.123456+00:00" and ev(p, f"isConf('{o}')"), f"다시 누르면 새 시각으로 확정: {body}")
    p.close()
    # 지사 화면: 관리자가 확정하기 전에 열어 둔 화면(아직 확정 전으로 보임)에서 고치고 저장
    m2 = Mock(); m2.users["exchungju"]["profile"]["must_change"] = False; m2.round_reqs[0]["confirmed"] = False
    p = server_page(b, m2, "exchungju"); tab(p, "branch")
    p.fill("[data-rq=B019][data-f=req_truck]", "7"); p.press("[data-rq=B019][data-f=req_truck]", "Tab"); p.wait_for_timeout(150)
    m2.round_reqs[0]["confirmed"] = True                                       # 그사이 관리자가 확정
    save_branch(p)
    check("이미 확정되어 고칠 수 없습니다" in toast(p) and "저장하지 못했습니다" not in toast(p), "안내: " + toast(p))
    check(p.locator("tr[data-b='B019']").locator("input:not([disabled]), select:not([disabled])").count() == 0, "다시 읽어 그 줄 비활성")
    p.close()

def t_server_forecast_if_changed(b):
    """2026-11-11: 10분마다 특보를 다시 읽을 때 예상 적설(지사 59줄)은 마지막 수정 시각만 확인하고, 바뀌었을 때만 전부 받음"""
    m = Mock(); m.users["exchungju"]["profile"]["must_change"] = False
    p = server_page(b, m, "exchungju"); tab(p, "branch")
    full = lambda: sum(1 for s in m.bf_selects if s != "updated_at"); probe = lambda: sum(1 for s in m.bf_selects if s == "updated_at")
    f0, p0 = full(), probe()
    check(f0 >= 1 and ev(p, "S.fcStamp") == m.fc_issued, f"처음엔 전부 받고 마지막 수정 시각을 기억: {m.bf_selects} / {ev(p, 'S.fcStamp')}")
    ev(p, "tickWarn(true)"); p.wait_for_timeout(300)
    check(full() == f0 and probe() == p0 + 1, f"안 바뀌었으면 확인만: {m.bf_selects}")
    b19 = next(x for x in m.branch_forecast if x["branch_id"] == "B019"); b19["max_snow_24h"] = 12.3; b19["updated_at"] = "2099-01-01T00:00:00+00:00"
    ev(p, "tickWarn(true)"); p.wait_for_timeout(300)
    check(full() == f0 + 1 and ev(p, "S.fc.B019.max_snow_24h") == 12.3 and ev(p, "S.fcStamp") == "2099-01-01T00:00:00+00:00", f"바뀌었으면 다시 받음: {m.bf_selects}")
    p.close()

SERVER_TESTS = [t_server_many_vehicles, t_server_equip_confirm, t_server_branch_save, t_server_warning, t_server_lock_and_confirm_all, t_server_forecast_if_changed]

if __name__ == "__main__":
    only = sys.argv[1:]
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for fn in TESTS:
            if not only or fn.__name__ in only: run(fn.__name__, fn, b)
        for fn in SERVER_TESTS:
            if only and fn.__name__ not in only: continue
            try: fn(b); results.append((fn.__name__, True, ""))
            except Exception as e: results.append((fn.__name__, False, f"{e.__class__.__name__}: {e}"))
        b.close()
    server.shutdown()
    ok = sum(1 for _, o, _ in results if o)
    for name, o, msg in results: print(("PASS " if o else "FAIL ") + name + ("" if o else f"  → {msg}"))
    if errors: print("\n페이지 오류:", *errors, sep="\n  ")
    print(f"\n{ok}/{len(results)} 통과" + ("" if not errors else f", 페이지 오류 {len(errors)}건"))
    sys.exit(0 if ok == len(results) and not errors else 1)
