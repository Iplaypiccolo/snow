"""
사용법 안내(guide/guide.js) 자동 테스트 — 브라우저로 직접 눌러 봅니다. (Supabase 는 가짜 서버 tests/_sb_mock.py)
확인하는 것: 처음 로그인하면 강설량 측정 안내가 저절로 열림 / [다음]·[설명 그만보기]·Esc 로 닫힘 / 한 번 닫으면 이 브라우저·아이디로는 다시 안 열림(다른 아이디는 열림) /
             [사용법] 버튼으로 다시 봄 / 장비 지원을 처음 열면 지원 과정 그림부터 / 계정별로 설명하는 탭이 다름(관리자·강원본부·다른 본부·지사·기계화부, 권한 표는 없음) /
             안내 전에 보던 탭으로 돌아감 / 탭 안 칸·버튼을 하나씩 짚음(장비 지원은 안쪽 틀, 안 보이는 것은 예시로 띄움) / 휴대폰 폭에서 화면 밖으로 안 나감
- 자동 시험 중에는 안내가 저절로 열리지 않으므로(다른 시험을 가리지 않게) 주소에 ?guide=auto 를 붙여 엽니다.
실행 (저장소 맨 위 폴더에서):  python tests/test_guide.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_jurisdiction_ui as T          # 같은 서버·지도 라이브러리 설정
import _sb_mock as SBM
from playwright.sync_api import sync_playwright

results, errors = [], T.errors
def check(c, m="실패"):
    if not c: raise AssertionError(m)
PW = {"admin-01": SBM.ADMIN_PW, "exgangwon": "Gw#Pass-2030kk", "exseoul": "Hq#Pass-2030kk", "exchungju": "Snow#Ride-2030k", "equip-01": "Equip#Pass-8821xY"}

def prep(m):
    m.add("exgangwon", "강원본부", "hq", None, PW["exgangwon"], hq_id="H03", perms=SBM.default_perms("hq"))
    m.add("exseoul", "서울경기본부", "hq", None, PW["exseoul"], hq_id="H02", perms=SBM.default_perms("hq"))
    x = m.users["exchungju"]; x["password"] = PW["exchungju"]; x["profile"]["must_change"] = False

def open_site(ctx, m, w=1400, h=900, auto=True):
    p = ctx.new_page(); p.set_viewport_size({"width": w, "height": h})
    p.on("pageerror", lambda e: errors.append(str(e))); p.on("dialog", lambda d: d.accept())
    p.route("**/*", T.route); p.route(SBM.SB + "/**", m.handle)
    p.goto(T.URL + ("?guide=auto" if auto else "")); p.wait_for_selector("#ssU", timeout=20000)
    return p

def login(p, user):
    p.fill("#ssU", user); p.fill("#ssP", PW[user]); p.click("#ssGo"); p.wait_for_selector("body.authed", timeout=20000)

def wait_js(p, expr, timeout=30000):
    for _ in range(timeout // 100):
        if p.evaluate(expr): return
        p.wait_for_timeout(100)
    raise AssertionError("시간 안에 안 됨: " + expr)

def guide(p): return p.evaluate("window.SSGuide && SSGuide.active()")
def wait_open(p, page): wait_js(p, f"!!(window.SSGuide && SSGuide.active() && SSGuide.active().page === '{page}')")
def wait_closed(p): wait_js(p, "!document.getElementById('sgRoot')")
def titles(p):
    """안내를 끝까지 넘기며 제목 목록을 모음(마지막 [시작하기]로 닫힘)"""
    out = []
    while guide(p):
        a = guide(p); out.append(a["title"])
        check(p.locator(".sg-next").is_visible(), "오른쪽 아래 [다음]이 보여야 함")
        p.click(".sg-next"); p.wait_for_timeout(120)
        if len(out) > 90: raise AssertionError("안내가 끝나지 않음")
    return out

def go_to(p, title, tab):
    """[다음]을 눌러 그 탭의 그 단계까지 가서, 칸을 찾아 그릴 때까지 기다림"""
    for _ in range(90):
        a = guide(p)
        if a and a["title"] == title and a["tab"] == tab: break
        check(a, f"'{title}' 단계 전에 안내가 끝남"); p.click(".sg-next"); p.wait_for_timeout(80)
    else: raise AssertionError(f"'{title}' 단계 없음")
    p.wait_for_timeout(900)

def ring_on(p, box, msg):
    r = p.locator(".sg-ring").bounding_box()
    check(r["x"] <= box["x"] + 1 and r["y"] <= box["y"] + 1 and r["x"] + r["width"] >= box["x"] + box["width"] - 1 and r["y"] + r["height"] >= box["y"] + box["height"] - 1
          and r["width"] < box["width"] + 40 and r["height"] < box["height"] + 40, f"{msg}: 빛 테두리 {r} / 칸 {box}")

def run(name, fn, browser):
    m = SBM.Mock(); prep(m); ctx = browser.new_context()
    try: fn(browser, ctx, m); results.append((name, True, ""))
    except Exception as e: results.append((name, False, f"{type(e).__name__}: {str(e)[:300]}"))
    finally:
        try: ctx.close()
        except Exception: pass

def t_first_login_admin(b, ctx, m):
    p = open_site(ctx, m); login(p, "admin-01"); wait_open(p, "snow")
    check(p.locator("#sgHelp").is_visible() and "사용법" in p.locator("#sgHelp").inner_text(), "오른쪽 위 [사용법] 버튼")
    check(p.locator("#sgStop").is_visible() and "설명 그만보기" in p.locator("#sgStop").inner_text(), "오른쪽 위 [설명 그만보기]")
    box, vw = p.locator("#sgStop").bounding_box(), 1400
    check(box["x"] + box["width"] > vw - 40 and box["y"] < 40, f"[설명 그만보기]는 화면 오른쪽 위: {box}")
    nb = p.locator(".sg-next").bounding_box(); cb = p.locator(".sg-card").bounding_box()
    check(nb["x"] + nb["width"] > cb["x"] + cb["width"] - 40 and nb["y"] + nb["height"] > cb["y"] + cb["height"] - 40, "[다음]은 카드 오른쪽 아래")
    check("관리자1" in p.locator(".sg-card").inner_text() and "재난처" in p.locator(".sg-card").inner_text(), "첫 장에 지금 계정")
    t = titles(p)
    check(t[0] == "제설 업무 시스템" and t[1] == "기관별 예보" and t[-1] == "사용법 다시 보기", t)
    check(not any("계정별" in x for x in t), f"계정별 권한 표는 뺐음(2026-11-01): {t}")
    for x in ["기관별 예보", "연도별 신적설", "관측소 지도", "기관별 관할 고속도로", "데이터 출처", "예보 격자 편입"]: check(x in t, f"관리자 강설량 안내에 '{x}' 없음: {t}")
    check(t.index("예보 격자 편입") < t.index("예보 구간") < t.index("사용법 다시 보기") and "시즌 선택" not in t and "검색" not in t,
          f"위쪽 탭 소개를 다 한 뒤 첫 탭(24시간 예보) 칸 설명만, 다른 탭 칸은 그 탭에 들어갈 때: {t}")
    wait_closed(p)
    check(p.evaluate("localStorage.getItem('ss_guide:snow:admin-01')") == "1", "끝까지 보면 이 브라우저에 봤음 표시")
    check(p.locator(".tab-btn.active").get_attribute("data-tab") == "forecast", "안내 전에 보던 탭(첫 탭)으로 돌아와야 함")
    # 장비 지원을 처음 열면: 지원 과정 그림 → 탭들 (계정별 권한 표 없음)
    p.click(".page-btn[data-page=equip]"); wait_open(p, "equip")
    card = p.locator(".sg-card").inner_text()
    check(guide(p)["title"] == "장비 지원 절차" and p.locator(".sg-card svg.sg-flow").count() == 2, "장비 지원 첫 장 = 지원 과정 그림")
    for x in ["지사", "재난처", "교통처", "기계화부", "장비 지원현황", "강원본부 신속대응팀", "차량번호 · 운전원 인적사항", "내부망 별도 송부"]: check(x in card, f"지원 과정에 '{x}' 없음")
    svg = p.locator(".sg-flow.h").text_content()
    for x in ["지원 요청", "승인", "지원 가능 대수 확인", "배정", "장비 지정 · 도착 시간", "강원 신속대응팀 직접 지원"]: check(x in svg, f"그림에 '{x}' 없음")
    check(p.locator(".sg-flow.h .sg-node.merge").count() == 1 and "교통처" in p.locator(".sg-flow.h .sg-node.merge").text_content(), "합쳐지는 곳 = 교통처 배정")
    t = titles(p)
    check(t[1] == "장비 지원현황" and not any("계정별" in x for x in t), f"그림 다음은 바로 탭 설명: {t}")
    check(t.index("로그 기록") < t.index("날짜") and "지원 여부" not in t and "지사 요청" not in t, f"탭 소개 다음 이동 현황 칸 설명만: {t}")
    for x in ["장비 지원현황", "지사별 요청·편성", "기관별 장비", "기관별 배치", "강원본부 지원장비", "로그 기록"]: check(x in t, f"관리자 장비 안내에 '{x}' 없음: {t}")
    wait_closed(p); check(p.locator(".eq-btn.active").get_attribute("data-eqtab") == "move", "장비 지원도 보던 탭(이동 현황)으로")
    # 다시 들어와도 저절로 안 열림 / [사용법]으로 다시 봄
    p.reload(); p.wait_for_selector("body.authed", timeout=20000); wait_js(p, "!!document.getElementById('sgHelp')"); p.wait_for_timeout(1500)
    check(not guide(p), "한 번 본 뒤에는 저절로 안 열려야 함")
    p.click("#sgHelp"); wait_open(p, "snow"); p.click("#sgStop"); wait_closed(p)
    p.click(".page-btn[data-page=equip]"); p.wait_for_timeout(2000); check(not guide(p), "장비 지원도 한 번 본 뒤에는 안 열림")
    p.click("#sgHelp"); wait_open(p, "equip"); check(guide(p)["i"] == 0 and guide(p)["title"] == "장비 지원 절차", "[사용법]은 지금 페이지 안내를 처음부터")

def t_stop_and_keys(b, ctx, m):
    p = open_site(ctx, m); login(p, "exchungju"); wait_open(p, "snow")
    p.click(".sg-next"); wait_js(p, "SSGuide.active().i === 1")
    check(guide(p)["title"] == "기관별 예보", "첫 장 다음 = 위쪽 탭 소개")
    p.keyboard.press("ArrowRight"); wait_js(p, "SSGuide.active().i === 2"); check(guide(p)["title"] == "연도별 신적설", "→ 키로 다음 탭 소개")
    p.wait_for_timeout(600); ring_on(p, p.locator(".tab-btn[data-tab=snowtable]").bounding_box(), "탭 소개는 위쪽 탭 버튼을 짚음")
    check(p.locator(".tab-btn.active").get_attribute("data-tab") == "forecast", "탭 소개 때는 탭을 바꾸지 않음(들어가야 칸 설명)")
    p.keyboard.press("ArrowLeft"); wait_js(p, "SSGuide.active().i === 1")
    p.wait_for_timeout(600); ring = p.locator(".sg-ring").bounding_box(); tb = p.locator(".tab-btn[data-tab=forecast]").bounding_box()
    check(ring["x"] <= tb["x"] and ring["x"] + ring["width"] >= tb["x"] + tb["width"] and ring["y"] <= tb["y"], "빛 고리가 그 탭 버튼을 둘러쌈")
    p.click("#sgStop"); wait_closed(p)
    check(p.evaluate("localStorage.getItem('ss_guide:snow:exchungju')") == "1", "[설명 그만보기]도 봤음으로 침")
    check(p.evaluate("localStorage.getItem('ss_guide:equip:exchungju')") is None, "장비 지원 안내는 따로 셈")
    p.click("#sgHelp"); wait_open(p, "snow"); p.keyboard.press("Escape"); wait_closed(p)
    # 같은 브라우저에서 다른 아이디는 처음이므로 다시 열림
    p.click("#ssLogout"); p.wait_for_selector("#ssU", timeout=20000); login(p, "equip-01"); wait_open(p, "snow")

def t_role_tabs(b, ctx, m):
    exp = {  # 아이디 → (장비 지원 안내에 있어야 할 것, 없어야 할 것)
        "exgangwon": (["강원본부 지원장비"], ["로그 기록"]),
        "exseoul": ([], ["강원본부 지원장비", "로그 기록"]),
        "exchungju": ([], ["강원본부 지원장비", "로그 기록"]),
        "equip-01": ([], ["강원본부 지원장비", "로그 기록"]),
    }
    for u, (yes, no) in exp.items():
        p = open_site(ctx, m); login(p, u); wait_open(p, "snow")
        p.evaluate("SSGuide.stop()"); wait_closed(p)
        st = p.evaluate("() => { SSGuide.start('snow'); const t = SSGuide.active().titles; SSGuide.stop(); return t; }")
        check("예보 격자 편입" not in st and "영역 선택" not in st, f"{u}: 예보 격자 편입(관리자) 설명이 없어야 함 {st}")
        p.click(".page-btn[data-page=equip]"); wait_open(p, "equip")
        mine = p.locator(".sg-flow.h .sg-node.me").all_text_contents()
        if u == "exgangwon": check(any("강원 신속대응팀" in x for x in mine), f"강원본부는 신속대응팀 단계가 '내 역할': {mine}")
        else: check(not any("강원 신속대응팀" in x for x in mine), f"{u}: 신속대응팀은 내 역할 아님")
        if u == "equip-01": check(any("장비 지정" in x for x in mine), "기계화부 = 장비 지정·도착 시간")
        t = titles(p)
        for x in yes: check(x in t, f"{u}: '{x}' 설명이 있어야 함 {t}")
        for x in no: check(x not in t, f"{u}: '{x}' 설명이 없어야 함 {t}")
        p.close()

def t_tab_intro_role_only(b, ctx, m):
    p = open_site(ctx, m); login(p, "exchungju"); wait_open(p, "snow"); p.evaluate("SSGuide.stop()"); wait_closed(p)
    p.click(".page-btn[data-page=equip]"); wait_open(p, "equip")
    go_to(p, "지사별 요청·편성", "branch")
    body = p.locator(".sg-body").inner_text().strip()
    check(body == "지사가 필요한 장비를 요청하고 재난처가 지원 대수를 확정" and p.locator(".sg-body .sg-pts, .sg-body .sg-mine").count() == 0,
          f"탭 소개는 그 탭이 하는 일 한 줄만(2026-11-01): {body!r}")
    ring_on(p, p.locator(".eq-btn[data-eqtab=branch]").bounding_box(), "위쪽 탭 버튼을 짚음")

def t_element_steps(b, ctx, m):
    """탭에 처음 들어가면 그 탭의 칸·버튼을 하나씩 빛 테두리로 짚음(2026-11-01). 장비 지원은 안쪽 틀 안의 칸"""
    p = open_site(ctx, m); login(p, "admin-01"); wait_open(p, "snow"); p.click("#sgStop"); wait_closed(p)
    p.click(".tab-btn[data-tab=snowtable]"); wait_open(p, "snow")
    check(guide(p)["mode"] == "tab" and guide(p)["title"] == "시즌 선택", f"연도별 신적설에 처음 들어가면 그 탭 칸 설명: {guide(p)}")
    p.wait_for_timeout(900); ring_on(p, p.locator("#seasonSelect").bounding_box(), "시즌 선택 드롭다운")
    check("최근 3시즌" in p.locator(".sg-card").inner_text() and "연도별 신적설" in p.locator(".sg-step").inner_text(), "칸 설명 + 위에 탭 이름")
    cb, rb = p.locator(".sg-card").bounding_box(), p.locator(".sg-ring").bounding_box()
    check(cb["y"] >= rb["y"] + rb["height"] or cb["y"] + cb["height"] <= rb["y"] or cb["x"] >= rb["x"] + rb["width"] or cb["x"] + cb["width"] <= rb["x"], "카드가 짚은 칸을 가리지 않음")
    check(all(x in ["시즌 선택", "엑셀 내보내기", "지난 시즌", "합계 · 평균", "날짜 칸"] for x in guide(p)["titles"]), f"그 탭 칸만: {guide(p)['titles']}")
    p.click("#sgStop"); wait_closed(p)
    check(p.evaluate("localStorage.getItem('ss_guide:snow.snowtable:admin-01')") == "1", "탭별로 봤음 표시")
    p.click(".tab-btn[data-tab=map]"); wait_open(p, "snow"); check(guide(p)["title"] == "요약 숫자", "다른 탭도 처음이면 그 탭 칸 설명"); p.click("#sgStop"); wait_closed(p)
    p.click(".tab-btn[data-tab=snowtable]"); p.wait_for_timeout(1200); check(not guide(p), "한 번 본 탭은 다시 안 열림")
    p.click(".page-btn[data-page=equip]"); wait_open(p, "equip"); p.click("#sgStop"); wait_closed(p)
    p.click(".eq-btn[data-eqtab=fleet]"); wait_open(p, "equip")
    go_to(p, "지원 여부", "fleet")
    fr = p.frame_locator("#equipFrame"); box = fr.locator("#eqTable button[data-vs]").first.bounding_box()
    ring_on(p, box, "기관별 장비의 [지원] 단추(안쪽 틀)")
    check("지원 · 다시 누름 → 빈칸" in p.locator(".sg-card").inner_text() and "정비중" not in p.locator(".sg-card").inner_text() and "미정" not in p.locator(".sg-card").inner_text(), "지원 여부 고르는 곳 설명(지원 · 빈칸만)")
    check(p.locator(".eq-btn.active").get_attribute("data-eqtab") == "fleet", "그 탭 화면")
    p.keyboard.press("ArrowLeft"); p.wait_for_timeout(700); check(guide(p)["tab"] == "fleet" and guide(p)["el"], "← 이전 칸")
    # 지사 계정: 화면에 없는 [삭제]·[만들기]는 건너뜀
    ctx2 = b.new_context(); q = open_site(ctx2, m); login(q, "exchungju"); wait_open(q, "snow"); q.evaluate("SSGuide.stop()"); wait_closed(q)
    q.click(".page-btn[data-page=equip]"); wait_open(q, "equip"); q.click("#sgStop"); wait_closed(q)
    q.click(".eq-btn[data-eqtab=branch]"); wait_open(q, "equip")
    check("기준일자 삭제 · 만들기" in q.evaluate("SSGuide.active().titles"), "목록에는 있어도(아래에서 건너뜀)")
    go_to(q, "전체 합계", "branch")
    q.keyboard.press("ArrowLeft"); wait_js(q, "SSGuide.active().title === '기준일자'", 6000)
    check("기준일자 삭제 · 만들기" not in q.evaluate("SSGuide.active().titles"), "건너뛴 단계는 목록에서도 빠짐")
    ctx2.close()

def t_demo_steps(b, ctx, m):
    """시연(2026-11-01): 화면에 바로 안 보이는 것은 안내가 대신 눌러 예시로 띄우고 짚음 — 닫으면 원래 보기로"""
    p = open_site(ctx, m); login(p, "admin-01"); wait_open(p, "snow")
    go_to(p, "5km 격자", "forecast")
    check(p.locator("#fc-tree .jr-br.on").count() == 1 and "예시" in p.locator(".sg-card .sg-badge").inner_text(), "지사를 대신 골라 격자를 띄움 + '예시' 표시")
    hit = p.evaluate("""(() => { const r = document.querySelector('.sg-ring').getBoundingClientRect();
      return document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2).some(e => e.closest && e.closest('#fmap') && e.tagName === 'path'); })()""")
    check(hit, "빛 테두리 가운데 = 지도의 격자 한 칸")
    p.click(".sg-next"); wait_js(p, "SSGuide.active().title === '시간별 추이'"); p.wait_for_timeout(900)
    ring_on(p, p.locator("#fc-pin").bounding_box(), "격자 24시간 추이 그림")
    p.click("#sgStop"); wait_closed(p); p.wait_for_timeout(500)
    check(p.locator("#fc-tree .jr-hqpick.on").count() == 0, "안내를 닫으면 24시간 예보는 전국 보기로 돌아감")
    p.click(".page-btn[data-page=equip]"); wait_open(p, "equip")
    go_to(p, "장비 정보", "move")
    fr = p.frame_locator("#equipFrame")
    check(fr.locator("#sheet").is_visible(), "장비를 대신 눌러 정보 창을 띄움")
    p.click(".sg-next"); p.wait_for_timeout(600); check(not fr.locator("#sheet").is_visible(), "다음 단계로 가면 정보 창을 닫음")

def t_mobile_reload(b, ctx, m):
    """2026-11-02: 휴대폰 장비 지원 — [새로고침]을 탭 줄에서 머리글로 올림(탭 줄에 있으면 탭을 가림). 넓은 화면은 탭 줄 오른쪽 그대로"""
    p = open_site(ctx, m, w=375, h=740, auto=False); login(p, "admin-01"); wait_js(p, "!!document.getElementById('sgHelp')")
    check(not p.locator("#snReload").is_visible(), "강설량 측정에는 없음")
    p.click(".page-btn[data-page=equip]"); fr = p.frame_locator("#equipFrame"); fr.locator("#matrix tbody tr").first.wait_for(timeout=20000)
    rb, tb = p.locator("#snReload").bounding_box(), p.locator(".eq-btn[data-eqtab=move]").bounding_box()
    check(p.locator("#snReload").is_visible() and rb["y"] + rb["height"] <= tb["y"] and rb["x"] + rb["width"] <= 375, f"탭 위, 화면 안: {rb} / 탭 {tb}")
    check(not p.locator("#eqReload").is_visible(), "탭 줄의 새로고침은 숨김(탭을 가리지 않음)")
    p.click("#snReload"); wait_js(p, "!document.getElementById('snReload').disabled", 15000)
    check("새로 불러왔습니다" in fr.locator("#toast").inner_text(), "눌러서 다시 읽음")
    p.set_viewport_size({"width": 1400, "height": 900}); p.wait_for_timeout(300)
    check(not p.locator("#snReload").is_visible() and p.locator("#eqReload").is_visible(), "넓은 화면: 탭 줄 오른쪽 그대로")

def t_no_auto_in_automation(b, ctx, m):
    p = open_site(ctx, m, auto=False); login(p, "admin-01"); wait_js(p, "!!document.getElementById('sgHelp')"); p.wait_for_timeout(1500)
    check(not guide(p) and p.evaluate("localStorage.getItem('ss_guide:snow:admin-01')") is None, "자동 시험 중에는 저절로 열지 않음")
    p.click("#sgHelp"); wait_open(p, "snow")

def t_phone(b, ctx, m):
    p = open_site(ctx, m, w=375, h=740); login(p, "exchungju"); wait_open(p, "snow")
    for i in range(4):
        cb = p.locator(".sg-card").bounding_box()
        check(cb["x"] >= 0 and cb["x"] + cb["width"] <= 375 and cb["y"] >= 0 and cb["y"] + cb["height"] <= 740, f"{i}장: 카드가 화면 밖 {cb}")
        nb = p.locator(".sg-next").bounding_box(); check(nb["y"] + nb["height"] <= 740, "[다음]이 화면 안")
        p.click(".sg-next"); p.wait_for_timeout(150)
    # 안내 화면 때문에 가로 스크롤이 생기면 안 됨(24시간 예보 탭은 원래 휴대폰 폭보다 넓어서 안내를 숨겼을 때와 비교)
    w = p.evaluate("(() => { const r = document.getElementById('sgRoot'), a = document.documentElement.scrollWidth; r.style.display = 'none'; const b = document.documentElement.scrollWidth; r.style.display = ''; return [a, b]; })()")
    check(w[0] <= max(375, w[1]), f"안내 때문에 가로 스크롤: {w}")
    p.click("#sgStop"); wait_closed(p); p.click(".page-btn[data-page=equip]"); wait_open(p, "equip")
    check(p.locator(".sg-flow.v").is_visible() and not p.locator(".sg-flow.h").is_visible(), "좁은 화면은 세로 그림")
    cb = p.locator(".sg-card").bounding_box(); check(cb["x"] >= 0 and cb["x"] + cb["width"] <= 375 and cb["y"] + cb["height"] <= 740, f"그림 카드가 화면 밖 {cb}")

def t_phone_short(b, ctx, m):
    """2026-11-02: 키 작은 휴대폰(높이 560) — 긴 설명은 카드를 밀어 내려 읽고, [다음]은 늘 화면 안·눌림"""
    p = open_site(ctx, m, w=360, h=560); login(p, "admin-01"); wait_open(p, "snow")
    for i in range(3):
        nb = p.locator(".sg-next").bounding_box(); check(nb and nb["y"] >= 0 and nb["y"] + nb["height"] <= 560, f"{i}장: [다음]이 화면 안 {nb}")
        p.click(".sg-next"); p.wait_for_timeout(150)
    p.click("#sgStop"); wait_closed(p); p.click(".page-btn[data-page=equip]"); wait_open(p, "equip")
    sc = p.evaluate("(() => { const x = document.querySelector('.sg-card .sg-in'); return [x.scrollHeight, x.clientHeight]; })()")
    check(sc[0] > sc[1], f"그림 카드는 키 작은 화면에서 넘침 → 스크롤되어야: {sc}")
    nb0 = p.locator(".sg-next").bounding_box(); check(nb0["y"] + nb0["height"] <= 560, f"스크롤 전 [다음]이 화면 안 {nb0}")
    p.locator(".sg-card .sg-in").hover(); p.mouse.wheel(0, 400); p.wait_for_timeout(200)
    top = p.evaluate("document.querySelector('.sg-card .sg-in').scrollTop"); check(top > 0, f"카드 내용이 밀려 내려감: {top}")
    nb1 = p.locator(".sg-next").bounding_box(); check(nb1["y"] + nb1["height"] <= 560, f"스크롤 뒤에도 [다음]이 화면 안 {nb1}")
    k0 = p.locator(".sg-card h2").inner_text(); p.click(".sg-next"); p.wait_for_timeout(200)
    check(p.locator(".sg-card h2").inner_text() != k0, "[다음]이 눌림")
    check(p.evaluate("document.querySelector('.sg-card .sg-in').scrollTop") == 0, "새 장은 맨 위부터")

def t_help_and_who(b, ctx, m):
    """2026-11-02: [? 사용법]으로 다시 볼 때는 위쪽 탭 소개 없이 지금 탭 칸 설명만 · 칸마다 쓰는 계정 표지(관리자만 되는 것만 '관리자') · 필터 안내 없음"""
    p = open_site(ctx, m); login(p, "admin-01"); wait_open(p, "snow"); p.click("#sgStop"); wait_closed(p)
    p.click("#sgHelp"); wait_open(p, "snow"); t = titles(p)
    check(t[0] == "제설 업무 시스템" and "예보 구간" in t and not any(x in t for x in ["기관별 예보", "연도별 신적설", "관측소 지도", "예보 격자 편입", "사용법 다시 보기"]),
          f"[사용법] = 첫 장 + 지금 탭 칸만(탭 소개·다시 보기 장 없음): {t}")
    p.click(".page-btn[data-page=equip]"); wait_open(p, "equip"); p.click("#sgStop"); wait_closed(p)
    p.click(".eq-btn[data-eqtab=branch]"); wait_open(p, "equip")
    check("보기 필터" not in guide(p)["titles"], f"필터 안내 없음: {guide(p)['titles']}")
    who = lambda: [x.strip() for x in p.locator(".sg-card .sg-badge.who").all_inner_texts()]
    go_to(p, "기준일자 삭제 · 만들기", "branch"); check(who() == ["관리자"], f"기준일자 만들기 = 관리자: {who()}")
    go_to(p, "저장", "branch"); check(who() == ["지사", "지역본부"], f"지사 줄 [저장] = 지사 · 지역본부(관리자 뺌): {who()}")
    go_to(p, "확정", "branch"); check(who() == ["관리자"], f"확정 = 관리자: {who()}")
    p.click("#sgStop"); wait_closed(p)
    p.click(".eq-btn[data-eqtab=fleet]"); wait_open(p, "equip")
    check(not any(x == "필터" for x in guide(p)["titles"]), "기관별 장비 필터 안내 없음")
    go_to(p, "지원 여부", "fleet"); check(who() == ["기계화부"], f"지원 여부 = 기계화부: {who()}")
    go_to(p, "＋ 지사 추가", "fleet"); check(who() == ["관리자"], f"하루 여러 지사 = 관리자: {who()}")
    p.click("#sgStop"); wait_closed(p)
    p.click(".eq-btn[data-eqtab=move]"); p.wait_for_timeout(300); p.click("#sgHelp"); wait_open(p, "equip")
    t = titles(p); check("필터" not in t and "장비 지원현황" not in t and "날짜" in t, f"장비 지원현황: 필터 안내 없음, [사용법]은 탭 소개 없음: {t}")

def t_back_button_tabs(b, ctx, m):
    """2026-11-02: 첫 화면의 뒤로가기 = 이전 탭(강설량 측정 탭 ↔ 장비 지원 ↔ 장비 지원 탭). 사이트를 떠나지 않음"""
    p = open_site(ctx, m, auto=False); login(p, "admin-01"); p.wait_for_timeout(800)
    st = lambda: p.evaluate("[document.getElementById('shell').dataset.page, (document.querySelector('.tab-btn.active') || {}).dataset ? document.querySelector('.tab-btn.active').dataset.tab : null, (document.querySelector('.eq-btn.active') || {dataset:{}}).dataset.eqtab]")
    p.click(".tab-btn[data-tab=map]"); p.wait_for_timeout(200)
    p.click(".page-btn[data-page=equip]"); p.wait_for_timeout(1500)
    p.click(".eq-btn[data-eqtab=branch]"); p.wait_for_timeout(500)
    check(st()[0] == "equip" and st()[2] == "branch", st())
    p.go_back(); p.wait_for_timeout(500); check(st()[0] == "equip" and st()[2] == "move", f"뒤로 → 장비 지원 이동 현황: {st()}")
    p.go_back(); p.wait_for_timeout(500); check(st()[0] == "snow" and st()[1] == "map", f"뒤로 → 강설량 측정 관측소 지도: {st()}")
    p.go_back(); p.wait_for_timeout(500); check(st()[0] == "snow" and st()[1] == "forecast" and p.locator("body.authed").count() == 1, f"뒤로 → 첫 탭(사이트 그대로): {st()}")
    p.go_forward(); p.wait_for_timeout(500); check(st()[1] == "map", f"앞으로 → 관측소 지도: {st()}")

def t_sheet_in_frame(b, ctx, m):
    """2026-11-11 사용자 제보: 기관별 장비에서 운전원을 고르면 지사별 요청·편성으로 넘어감.
    원인 = 첫 화면 안(iframe)의 창이 따로 뒤로가기 기록을 남겨, 기록 순서가 섞이면 창을 닫을 때 바깥 화면이 한 칸 뒤로 감.
    고침 = 창 기록은 바깥 화면이 남기고 지움. 창을 열고 닫아도 탭은 그대로, 뒤로가기는 창만 닫거나 바로 이전 탭으로"""
    p = open_site(ctx, m, auto=False); login(p, "admin-01"); p.wait_for_timeout(800)
    p.click(".page-btn[data-page=equip]"); p.wait_for_timeout(2500)
    fr = [x for x in p.frames if "equipment" in x.url][0]
    tab = lambda: (p.evaluate("(document.querySelector('.eq-btn.active') || {dataset:{}}).dataset.eqtab"), fr.evaluate("(document.querySelector('.tab[aria-selected=true]') || {dataset:{}}).dataset.tab"))
    open_ = lambda: fr.evaluate("!document.getElementById('sheet').hidden")
    p.click(".eq-btn[data-eqtab=branch]"); p.wait_for_timeout(800)
    p.click(".eq-btn[data-eqtab=fleet]"); p.wait_for_timeout(1000)
    vid = fr.evaluate("document.querySelector('[data-crew]').dataset.crew")
    fr.locator(f'[data-crew="{vid}"]').first.click(); p.wait_for_timeout(300)
    fr.locator('[data-crewcode="a"]').check(); p.wait_for_timeout(300)
    check(open_() and tab() == ("fleet", "fleet"), f"운전원 1명 고름: 창 그대로, 탭 그대로 {tab()}")
    fr.locator("[data-crewapply]").click(); p.wait_for_timeout(800)
    check(not open_() and tab() == ("fleet", "fleet"), f"[적용]: 창 닫힘, 기관별 장비 그대로 {tab()}")
    fr.locator(f'[data-crew="{vid}"]').first.click(); p.wait_for_timeout(300)
    p.go_back(); p.wait_for_timeout(600)
    check(not open_() and tab() == ("fleet", "fleet"), f"창 열고 뒤로가기 = 창만 닫힘 {tab()}")
    fr.locator(f'[data-crew="{vid}"]').first.click(); p.wait_for_timeout(300)
    p.click(".eq-btn[data-eqtab=branch]"); p.wait_for_timeout(800)
    check(not open_() and tab() == ("branch", "branch"), f"창을 연 채 위 메뉴 탭: 창 닫히고 그 탭 {tab()}")
    p.click(".eq-btn[data-eqtab=fleet]"); p.wait_for_timeout(800)
    fr.locator(f'[data-crew="{vid}"]').first.click(); p.wait_for_timeout(300); fr.locator("#sheetClose").click(); p.wait_for_timeout(800)
    check(tab() == ("fleet", "fleet"), f"섞인 뒤에도 [취소]로 닫으면 탭 그대로 {tab()}")
    p.go_back(); p.wait_for_timeout(600); check(tab() == ("branch", "branch"), f"뒤로가기 = 바로 이전 탭(지사별 요청·편성) {tab()}")
    p.go_back(); p.wait_for_timeout(600); check(tab() == ("fleet", "fleet"), f"한 번 더 = 그 전 탭(기관별 장비, 빈 칸 없음) {tab()}")

TESTS = [t_help_and_who, t_first_login_admin, t_stop_and_keys, t_role_tabs, t_tab_intro_role_only, t_element_steps, t_demo_steps, t_mobile_reload, t_no_auto_in_automation, t_phone, t_phone_short, t_back_button_tabs, t_sheet_in_frame]
if __name__ == "__main__":
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for fn in TESTS: run(fn.__name__, fn, b)
        b.close()
    T.server.shutdown()
    ok = sum(1 for _, o, _ in results if o)
    for n, o, msg in results: print(("PASS " if o else "FAIL ") + n + ("" if o else "  → " + msg))
    if errors: print("페이지 오류:", errors[:5])
    print(f"\n{ok}/{len(results)} 통과")
    sys.exit(0 if ok == len(results) and not errors else 1)
