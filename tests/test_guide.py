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
    # 다시 들어와도 저절로 안 열림 / [사용법]으로 다시 봄
    p.reload(); p.wait_for_selector("body.authed", timeout=20000); wait_js(p, "!!document.getElementById('sgHelp')"); p.wait_for_timeout(1500)
    check(not guide(p), "한 번 본 뒤에는 저절로 안 열려야 함")
    p.click("#sgHelp"); wait_open(p, "snow"); p.click("#sgStop"); wait_closed(p)

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
    p.click("#sgHelp"); wait_open(p, "snow"); p.keyboard.press("Escape"); wait_closed(p)
    # 같은 브라우저에서 다른 아이디는 처음이므로 다시 열림
    p.click("#ssLogout"); p.wait_for_selector("#ssU", timeout=20000); login(p, "equip-01"); wait_open(p, "snow")

def t_role_tabs(b, ctx, m):
    exp = {  # 아이디 → (장비 지원 안내는 2026-11-21 페이지와 함께 없앰. 강설량 측정 안내만 확인)
        "exgangwon": ([], []),
        "exseoul": ([], []),
        "exchungju": ([], []),
        "equip-01": ([], []),
    }
    for u, (yes, no) in exp.items():
        p = open_site(ctx, m); login(p, u); wait_open(p, "snow")
        p.evaluate("SSGuide.stop()"); wait_closed(p)
        st = p.evaluate("() => { SSGuide.start('snow'); const t = SSGuide.active().titles; SSGuide.stop(); return t; }")
        check("예보 격자 편입" not in st and "영역 선택" not in st, f"{u}: 예보 격자 편입(관리자) 설명이 없어야 함 {st}")
        p.close()

def t_element_steps(b, ctx, m):
    """탭에 처음 들어가면 그 탭의 칸·버튼을 하나씩 빛 테두리로 짚음(2026-11-01)"""
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

def t_phone_short(b, ctx, m):
    """2026-11-02: 키 작은 휴대폰(높이 560) — [다음]은 늘 화면 안·눌림(긴 그림 카드 스크롤 시험은 장비 지원 안내와 함께 2026-11-21 없앰)"""
    p = open_site(ctx, m, w=360, h=560); login(p, "admin-01"); wait_open(p, "snow")
    for i in range(3):
        nb = p.locator(".sg-next").bounding_box(); check(nb and nb["y"] >= 0 and nb["y"] + nb["height"] <= 560, f"{i}장: [다음]이 화면 안 {nb}")
        p.click(".sg-next"); p.wait_for_timeout(150)

def t_help_and_who(b, ctx, m):
    """2026-11-02: [? 사용법]으로 다시 볼 때는 위쪽 탭 소개 없이 지금 탭 칸 설명만"""
    p = open_site(ctx, m); login(p, "admin-01"); wait_open(p, "snow"); p.click("#sgStop"); wait_closed(p)
    p.click("#sgHelp"); wait_open(p, "snow"); t = titles(p)
    check(t[0] == "제설 업무 시스템" and "예보 구간" in t and not any(x in t for x in ["기관별 예보", "연도별 신적설", "관측소 지도", "예보 격자 편입", "사용법 다시 보기"]),
          f"[사용법] = 첫 장 + 지금 탭 칸만(탭 소개·다시 보기 장 없음): {t}")

def t_back_button_tabs(b, ctx, m):
    """2026-11-02: 첫 화면의 뒤로가기 = 이전 탭. 사이트를 떠나지 않음(2026-11-21 장비 지원을 없애 강설량 측정 탭만)"""
    p = open_site(ctx, m, auto=False); login(p, "admin-01"); p.wait_for_timeout(800)
    st = lambda: p.evaluate("(document.querySelector('.tab-btn.active') || {dataset:{}}).dataset.tab")
    p.click(".tab-btn[data-tab=map]"); p.wait_for_timeout(300)
    p.click(".tab-btn[data-tab=snowtable]"); p.wait_for_timeout(300)
    check(st() == "snowtable", st())
    p.go_back(); p.wait_for_timeout(500); check(st() == "map", f"뒤로 → 관측소 지도: {st()}")
    p.go_back(); p.wait_for_timeout(500); check(st() == "forecast" and p.locator("body.authed").count() == 1, f"뒤로 → 첫 탭(사이트 그대로): {st()}")
    p.go_forward(); p.wait_for_timeout(500); check(st() == "map", f"앞으로 → 관측소 지도: {st()}")

TESTS = [t_help_and_who, t_first_login_admin, t_stop_and_keys, t_role_tabs, t_element_steps, t_demo_steps, t_no_auto_in_automation, t_phone, t_phone_short, t_back_button_tabs]
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
