"""
'기관별 예보' 탭 화면 자동 테스트 — 브라우저로 직접 눌러 봅니다(가짜 서버 tests/_sb_mock.py).
실행 (저장소 맨 위 폴더에서):  pip install playwright && playwright install chromium  →  python tests/test_forecast_ui.py
지도 라이브러리(Leaflet)를 인터넷에서 받습니다. 막힌 곳이면 환경변수 LEAFLET_DIR 를 지정하세요(tests/test_jurisdiction_ui.py 와 같음).
"""
import json
import sys
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import test_jurisdiction_ui as T       # 같은 서버·지도 라이브러리 설정을 재사용
import _sb_mock as SBM
from playwright.sync_api import sync_playwright

check, J = T.check, T.J
results, errors = [], T.errors
S = "ForecastUI._state()"

def open_page(browser, mock=None, user="admin-01", hash=""):
    p = browser.new_page(bypass_csp=True, viewport={"width": 1400, "height": 900})
    T.OPENED.append(p)
    p.on("pageerror", lambda e: errors.append(str(e))); p.on("dialog", lambda d: d.accept()); p.route("**/*", T.route)
    m = mock or SBM.Mock()
    p.add_init_script("window.__fcNow = function () { return Date.parse(%s) - 50 * 60000; };" % json.dumps(m.fc_start))      # 기존 시험: 예보 시작 50분 전(= 앞 정시의 10분)으로 고정 — 기상청식 시작 시각 줄이기가 끼지 않게
    if user != "admin-01": m.users[user]["profile"]["must_change"] = False
    SBM.install(p, m, user)
    p.goto(T.URL + hash); p.wait_for_function("window.ForecastUI && ForecastUI._state().inited", timeout=60000)
    return p, m

def run(name, fn, b):
    try: fn(b); results.append((name, True, ""))
    except Exception as e: results.append((name, False, f"{type(e).__name__}: {str(e)[:300]}"))
    finally:
        while T.OPENED:
            try: T.OPENED.pop().close()
            except Exception: pass

def open_phone(browser, mock=None):
    """휴대폰 화면(375×812)으로 열기"""
    p = browser.new_page(bypass_csp=True, viewport={"width": 375, "height": 812}, has_touch=True, is_mobile=True)
    T.OPENED.append(p)
    p.on("pageerror", lambda e: errors.append(str(e))); p.on("dialog", lambda d: d.accept()); p.route("**/*", T.route)
    m = mock or SBM.Mock(); p.add_init_script("window.__fcNow = function () { return Date.parse(%s) - 50 * 60000; };" % json.dumps(m.fc_start)); SBM.install(p, m, "admin-01")
    p.goto(T.URL); p.wait_for_function("window.ForecastUI && ForecastUI._state().inited", timeout=60000)
    p.evaluate("document.querySelector('.tab-btn[data-tab=forecast]').click()"); p.wait_for_timeout(900)
    return p, m

def layers(p): return J(p, f"{S}.cells.getLayers().length")
def labels(p): return p.locator("#fmap .fc-label").count()
def bid(p, name): return J(p, f"(() => {{ const s = {S}.state; return s.order.find(id => s.branches[id].name === '{name}') }})()")

def t_levels(b):
    """전체 = 노선만 / 본부 = 지사 격자(값 없음) / 지사 = 격자마다 적설·강수 값"""
    p, m = open_page(b)
    p.click(".tab-btn[data-tab=forecast]"); p.wait_for_timeout(900)
    check(p.locator("#view-forecast").is_visible(), "탭이 보여야 함")
    check(J(p, f"{S}.lines.getLayers().length") > 900 and layers(p) == 0, "전체: 고속도로 노선만(격자 없음)")
    check("발표" not in p.locator("#fc-meta").inner_text() and "24시간 합" in p.locator("#fc-meta").inner_text() and " ~ " in p.locator("#fc-meta").inner_text(), "예보 구간만(발표 기준 문구 없음, 2026-11-04): " + p.locator("#fc-meta").inner_text())
    check(p.locator("#fc-tree [data-fchq]").count() == 9 and p.locator("#fc-tree [data-fcbr]").count() == 0, "처음엔 본부 줄만(민자 없음)")
    check("최저" in p.locator(".fc-cols").inner_text() and "℃" in p.locator("#fc-tree [data-fchq='강원']").inner_text(), "본부 줄에 최저기온")
    check("cm" in p.locator("#fc-tree [data-fchq='강원']").inner_text() and "mm" in p.locator("#fc-tree [data-fchq='강원']").inner_text(), "본부 줄에 적설·강수 최댓값")
    p.click("#fc-tree [data-fchq='강원']"); p.wait_for_timeout(700)
    check(layers(p) > 0 and labels(p) == 0, f"본부: 격자는 보이고 값 글자는 없음({layers(p)}칸)")
    check(m.fc_calls and set(m.fc_calls[-1]) == set(J(p, f"{S}.state.order.filter(id => {S}.state.branches[id].hq === '강원')")), "본부의 지사들 격자만 서버에서 받음")
    d = bid(p, "대관령"); p.click(f"#fc-tree [data-fcbr='{d}']"); p.wait_for_timeout(700)
    n = len([c for c in m.fc_cells if d in c[2]])
    check(labels(p) == n and n > 0, f"지사: 격자마다 값 글자 {labels(p)} / {n}")
    lab = p.locator("#fmap .fc-label").first; check(lab.locator("b").count() == 1 and lab.locator("span").count() == 0 and lab.locator("i").count() == 0 and lab.locator("em").inner_text().endswith("°"), "격자 글자 기본 = 적설·기온(범례 체크박스 기본값)")
    check(m.fc_series_calls and m.fc_series_calls[-1] == [d], "지사를 열 때만 그 지사 추이를 받음")
    cold = min((c for c in m.fc_cells if d in c[2]), key=lambda c: c[5])
    bf0 = [x for x in m.branch_forecast if x["branch_id"] == d][0]
    check(bf0["min_tmp"] == cold[5] and f"{cold[5]:g}" in p.locator(f"#fc-tree [data-fcbr='{d}']").inner_text(), "지사 줄 최저기온 = 가장 추운 격자")
    check("최저(℃)" in p.locator(".fc-detail thead").inner_text() and "시각" in p.locator(".fc-detail thead").inner_text(), "옆 표에 최저기온·시각")
    names = J(p, f"{S}.names") or {}; first = p.locator(".fc-detail tbody tr").first; key = first.get_attribute("data-cell")
    check(len(names) > 2000 and p.locator(".fc-detail thead th").first.inner_text() == "지명" and first.locator("td").first.inner_text().startswith(names[key]) and key in first.locator("td").first.inner_text(),
          f"격자는 지명(data/grid_names.json) + 작은 번호: {first.locator('td').first.inner_text()}")
    tipname = J(p, f"(() => {{ const l = {S}.cells.getLayers().find(l => l.getLatLngs && l.getTooltip()); return l.getTooltip().getContent() }})()")
    check(any(("<b>" + v + "</b>") in tipname for v in set(names.values())), "마우스 말풍선 제목도 지명")
    poly = J(p, f"(() => {{ const ls = {S}.cells.getLayers().filter(l => l.getTooltip && l.getTooltip() && !l.options.permanent && l.getLatLngs); const t = ls[0].getTooltip().getContent(); return t }})()")
    check("<table" in poly and "fc-t3" in poly and "<svg" not in poly and "최저기온" in poly, "격자에 마우스 = 3시간 단위 표(그림 없음): " + poly[:120])
    rows = p.locator(".fc-detail tbody tr"); check(rows.count() == n, "옆 표에 격자 목록")
    top = max((c for c in m.fc_cells if d in c[2]), key=lambda c: c[3])
    check(rows.first.locator("td").nth(1).inner_text() == str(top[3]), "적설 많은 격자부터(정수, 2026-11-04)")
    bf = [x for x in m.branch_forecast if x["branch_id"] == d][0]
    sn = str(bf['max_snow_24h']) if bf['max_snow_hi'] <= bf['max_snow_24h'] else f"{bf['max_snow_24h']}~{bf['max_snow_hi']}"
    check(p.locator(f"#fc-tree [data-fcbr='{d}'] .fc-v.s").inner_text().replace("cm", "") == sn, f"지사 줄 = 지사 격자 최댓값(정수·범위): {sn}")
    p.click(f"#fc-tree [data-fcbr='{d}']"); p.wait_for_timeout(500); check(labels(p) == 0 and layers(p) > n, "지사를 다시 누르면 본부 보기로")
    p.click("#fc-tree [data-fchq='강원']"); p.wait_for_timeout(500); check(layers(p) == 0, "본부를 다시 누르면 전체(노선만)")

def t_open_from_equipment(b):
    """장비 지원 화면에서 그 지사로 바로 오기: SSOpenForecast(바깥 화면 함수)와 #fc=지사번호 주소"""
    p, m = open_page(b)
    d = bid(p, "춘천")
    J(p, f"(() => {{ SSOpenForecast('{d}'); return null }})()"); p.wait_for_timeout(1200)
    check(p.locator(".tab-btn[data-tab=forecast]").get_attribute("class").find("active") >= 0 and J(p, f"{S}.focus") == d, "강설량 측정 → 기관별 예보 → 춘천")
    check(labels(p) == len([c for c in m.fc_cells if d in c[2]]), "그 지사 격자 값이 보임")
    p2, _ = open_page(b, hash=f"#fc={d}"); p2.wait_for_timeout(1500)
    check(J(p2, f"{S}.focus") == d and p2.locator("#view-forecast").is_visible(), "#fc=지사번호 로 열어도 그 지사")

def t_branch_user_can_view(b):
    """지사 계정도 볼 수 있음(읽기만)"""
    p, m = open_page(b, user="exchungju")
    p.click(".tab-btn[data-tab=forecast]"); p.wait_for_timeout(800)
    check(p.locator("#fc-tree [data-fchq]").count() == 9, "지사 계정도 목록이 보임")

def t_first_tab_and_order(b):
    """강설량 측정 탭 순서(2026-10-05): 기관별 예보(처음 열림) → 연도별 신적설 → 관측소 지도 → 관할 → 데이터 출처 → 예보 격자 편입(권한)"""
    p, m = open_page(b); p.wait_for_timeout(800)
    tabs = [t for t in p.locator(".tab-btn").all_inner_texts()]
    check(tabs == ["기관별 예보", "연도별 신적설", "관측소 지도", "기관별 관할 고속도로", "데이터 출처", "예보 격자 편입"], tabs)
    check("active" in p.locator(".tab-btn[data-tab=forecast]").get_attribute("class") and p.locator("#view-forecast").is_visible() and not p.locator("#view-snowtable").is_visible(), "처음 열면 기관별 예보")
    check(J(p, f"{S}.lines.getLayers().length") > 900, "예보 지도가 그려짐")
    p.click(".tab-btn[data-tab=snowtable]"); p.wait_for_timeout(300)
    check(p.locator("#snowTableWrap table").is_visible() and not p.locator("#view-forecast").is_visible(), "연도별 신적설로 바꾸면 표")
    p2, _ = open_page(b, user="exchungju"); p2.wait_for_timeout(500)
    check(not p2.locator(".tab-btn[data-tab=grid]").is_visible() and p2.locator("#view-forecast").is_visible(), "권한 없으면 격자 편입 탭 없음, 첫 탭은 같음")

def t_pin_chart(b):
    """격자 그림(2026-10-05): 적설 → 강수 → 기온 세 그림을 따로. 격자를 누르면 고정, 그림에 마우스를 올리면 보조선과 '몇 시 · 값', 지도 아무 데나 누르면 닫힘"""
    p, m = open_page(b); p.click(".tab-btn[data-tab=forecast]"); p.wait_for_timeout(600)
    d = bid(p, "대관령"); p.click("#fc-tree [data-fchq='강원']"); p.wait_for_timeout(500); p.click(f"#fc-tree [data-fcbr='{d}']"); p.wait_for_timeout(900)
    tip = J(p, f"(() => {{ const l = {S}.cells.getLayers().find(l => l.getLatLngs && l.getTooltip()); return l.getTooltip().getContent() }})()")
    check("<svg" not in tip and tip.count("fc-t3") == 1, "마우스 말풍선: 그래프 없이 3시간 표 하나")
    tp = p.locator(".leaflet-tooltip.fc-tip")
    sr = J(p, f"(() => {{ const l = {S}.cells.getLayers().find(l => l.getLatLngs && l.getTooltip()); l.openTooltip(); return 1 }})()"); p.wait_for_timeout(200)
    t3 = tp.locator("table.fc-t3")
    heads = [h.strip() for h in t3.locator("thead th:not(.lb)").all_inner_texts()]
    hrs = [h.split("\n")[0] for h in heads]
    check(len(hrs) == 8 and all(int(hrs[i]) == (int(hrs[0]) + 3 * i) % 24 for i in range(8)), f"3시간 표 머리글 = 3시간 간격 8칸 {hrs}")
    rows = [r.locator("th.lb").inner_text() for r in t3.locator("tbody tr").all()]
    check([x.startswith(y) for x, y in zip(rows, ["신적설", "강수", "확률", "최저기온"])] == [True] * 4 and len(rows) == 4, f"행(강수확률 포함): {rows}")
    vals = [float(x) for x in t3.locator("tbody tr").first.locator("td").all_inner_texts() if x not in ("-", "0", "")]
    import re as _re
    tiptext = tp.inner_text(); tot = float(_re.search(r"24시간 적설 ([\d.]+)cm", tiptext).group(1))
    check("24시간 합" not in tiptext and "누르면" not in tiptext and tp.locator(".fc-tt-sum").count() == 0 and "확률 최고" in tiptext, "말풍선: 표 아래 '24시간 합'부터는 없음(위 요약에 강수확률): " + tiptext[:80].replace("\n", " "))
    check(abs(sum(vals) - tot) < 0.35, f"3시간 합들의 합 = 24시간 합 ({sum(vals):.1f} ≈ {tot})")
    box = tp.locator(".fc-trend-box").bounding_box(); check(box and 270 <= box["width"] <= 296, f"말풍선 표 폭 약 20% 확대(283px): {box and box['width']}")
    # 지사를 고르면 눈여겨볼 격자(적설이 가장 많은 칸)가 고른 채로 열림(2026-10-10)
    top = max((c for c in m.fc_cells if d in c[2]), key=lambda c: (c[3], c[4], -c[5])); tk = f"{top[0]},{top[1]}"      # 같은 적설이면 강수 많은 칸 → 더 추운 칸(옆 표 순서와 같음)
    pin0 = p.locator("#fc-pin")
    check(pin0.is_visible() and J(p, f"{S}.pin") == tk and pin0.locator('.fc-pin-why').count()==0, f"지사를 열면 적설 최대 칸 고정·설명 제거: {J(p, f'{S}.pin')} / {tk}")
    check(p.locator(".fc-detail tr.sel").count() == 1 and p.locator(".fc-detail tbody tr").first.get_attribute("class") == "sel" and p.locator(".fc-detail tr.sel").get_attribute("data-cell") == tk, "옆 표 맨 윗줄이 그 칸이고 표시됨")
    # 표 머리글 날짜: 맨 처음 칸과 날짜가 바뀌는(00시) 칸에만 — 둘째 줄 첫 칸에는 붙이지 않음
    days=pin0.locator('table.fc-t1 thead tr').first.locator('th:not(.lb)')
    check(all('/' in x for x in days.all_inner_texts()),'윗행 날짜')
    check(sum(int(x.get_attribute('colspan')) for x in days.all())==48,'날짜 묶음48시각')
    hours=pin0.locator('table.fc-t1 thead tr').last.locator('th:not(.lb)').all_inner_texts()
    check(len(hours)==48 and all(x.isdigit() for x in hours),'아랫행48개 시각')
    leg = p.locator("#fc-legend")
    check(leg.locator(".fc-show").inner_text().split() == ["적설", "강수", "확률", "기온"] and leg.locator(".fc-ramp li").count() == 6 and "cm" not in leg.inner_text() and "mm" not in leg.inner_text() and "마우스" not in leg.inner_text(),
          "범례: 체크박스(적설·강수·확률·기온) + 적설량 색띠만: " + leg.inner_text().replace("\n", " "))
    check([leg.locator(f"[data-fcshow={k}]").is_checked() for k in "spot"] == [True, False, False, True], "체크박스 기본 = 적설·기온")
    prow = [r.locator("th.lb").inner_text() for r in pin0.locator("table.fc-t1").first.locator("tbody tr").all()]
    check(len(prow) == 4 and prow[2].startswith("확률") and pin0.locator(".fc-tt-sum").count()==0, f"고정 창 표의 강수확률 줄·합계 설명 제거: {prow}")
    mine = [c for c in m.fc_cells if d in c[2]]; hot = [c for c in mine if max(c[3], c[10] or 0) > 0 or max(c[4], c[9] or 0) > 0]
    check(p.locator("#fmap .fc-label.hot").count() == len(hot) and p.locator("#fmap .fc-label.calm").count() == len(mine) - len(hot) and len(hot) > 0, f"지도 칸: 적설·강수가 있는 칸만 크게({len(hot)}칸), 나머지는 흐리게")
    lab = p.locator("#fmap .fc-label").first
    check(lab.locator("i").count() == 0 and lab.locator("span").count() == 0, "기본(적설·기온)에서는 칸에 강수·확률이 없음")
    p.check("#fc-legend [data-fcshow=p]"); p.check("#fc-legend [data-fcshow=o]"); p.wait_for_timeout(200)
    lab = p.locator("#fmap .fc-label").first
    check([lab.locator(t).count() for t in ("b", "span", "i", "em")] == [1, 1, 1, 1] and lab.locator("i").inner_text().endswith("%") and p.locator("#fmap .fc-label .z").count() > 0, "모두 체크하면 적설·강수·확률(%)·기온 순서로, 0 인 숫자는 흐리게")
    top_pop = max(c[8] for c in mine)
    check("확률" in p.locator(".fc-cols").inner_text() and f"{top_pop}%" in p.locator(f"#fc-tree [data-fcbr='{d}']").inner_text() and "확률(%)" in p.locator(".fc-detail thead").inner_text(), "옆 목록: 지사 줄에 최고 강수확률, 격자 표에 확률 칸")
    p.click(".fc-pin-x"); p.wait_for_timeout(150)
    check(not p.locator("#fc-pin").is_visible() and p.locator(".fc-detail tr.sel").count() == 0, "× 로 닫으면 고정 없음")
    key = J(p, f"(() => {{ const l = {S}.cells.getLayers().find(l => l.getLatLngs && l.getTooltip()); l.fire('click'); return {S}.pin }})()"); p.wait_for_timeout(300)
    pin = p.locator("#fc-pin")
    check(pin.is_visible() and key and J(p,f'{S}.pin')==key, f"격자를 누르면 그 격자 그림 고정: {key}")
    check(pin.locator("svg").count() == 0 and pin.locator("table.fc-t1").count() == 1, "고정 창:24개 시각 한 표")
    h1 = [x.split("\n")[0] for x in pin.locator("table.fc-t1").first.locator("thead tr").last.locator("th:not(.lb)").all_inner_texts()]
    check(len(h1) == 48 and all(int(h1[i].replace("시", "")) == (int(h1[0].replace("시", "")) + i) % 24 for i in range(48)), f"1시간 표 머리글48칸 {h1}")
    pb = pin.locator(".fc-trend-box").bounding_box(); check(pb and 350 <= pb["width"] <= 400, f"왼쪽 제목을 제외한 촘촘한 표 폭: {pb and pb['width']}")
    check(J(p, f"(() => {{ const l = {S}.cells.getLayers().find(l => l.getLatLngs && l.options.weight === 4); return !!l }})()"), "고정한 격자는 굵은 테두리")
    p.wait_for_timeout(350); J(p, f"(() => {{ {S}.map.fire('click', {{ latlng: {S}.map.getCenter() }}); return null }})()"); p.wait_for_timeout(200)
    check(not p.locator("#fc-pin").is_visible() and J(p, f"{S}.pin") is None, "지도 아무 데나 누르면 닫힘")
    p.locator(".fc-detail tbody tr").first.click(); p.wait_for_timeout(300)
    check(p.locator("#fc-pin").is_visible(), "옆 표의 격자 줄을 눌러도 고정"); p.click(".fc-pin-x"); p.wait_for_timeout(150); check(not p.locator("#fc-pin").is_visible(), "× 로 닫기")

def t_legend_show(b):
    """범례 체크박스(2026-10-10): 지도 칸에 보일 값을 고름(기본 적설·기온), 브라우저에 기억. 칸이 작아지면 적설 > 강수 > 확률 > 기온 순으로 들어가는 만큼(값이 있는 것 먼저), 더 작으면 글자 없이 색 + 강수 점"""
    p, m = open_page(b); p.click(".tab-btn[data-tab=forecast]"); p.wait_for_timeout(600)
    d = bid(p, "대관령"); p.click("#fc-tree [data-fchq='강원']"); p.wait_for_timeout(500); p.click(f"#fc-tree [data-fcbr='{d}']"); p.wait_for_timeout(1100)
    mine = [c for c in m.fc_cells if d in c[2]]
    kinds = lambda: J(p, "[...document.querySelectorAll('#fmap .fc-label')].map(e => [...e.children].map(c => c.tagName).join('+'))")
    check(labels(p) == len(mine) and set(kinds()) == {"B+EM"}, f"가까이: 기본은 칸마다 적설·기온 두 줄 {set(kinds())}")
    for k in "po": p.check(f"#fc-legend [data-fcshow={k}]")
    p.wait_for_timeout(200); check(set(kinds()) == {"B+SPAN+I+EM"}, f"모두 체크: 네 줄(적설·강수·확률·기온) {set(kinds())}")
    check(J(p, "JSON.parse(localStorage.getItem('ss_fc_show'))") == {"s": True, "p": True, "o": True, "t": True}, "체크한 값을 브라우저에 저장")
    z0 = J(p, f"{S}.map.getZoom()")
    J(p, f"(() => {{ {S}.map.setZoom({z0} - 1, {{ animate: false }}); return null }})()"); p.wait_for_timeout(400)
    ks = kinds()
    check(labels(p) == len(mine) and all(x.count("+") == 1 for x in ks), f"한 단계 축소: 칸마다 두 줄만 {set(ks)}")
    both = [c for c in mine if max(c[3], c[10] or 0) > 0 and max(c[4], c[9] or 0) > 0]      # 범위(~1)도 '있음'(62)
    check(len(both) > 0 and ks.count("B+SPAN") == len(both), f"두 줄일 때는 순서대로 적설·강수(확률·기온은 밀림): {ks.count('B+SPAN')} / {len(both)}")
    p.uncheck("#fc-legend [data-fcshow=p]"); p.uncheck("#fc-legend [data-fcshow=o]"); p.wait_for_timeout(200)
    check(set(kinds()) == {"B+EM"}, f"적설·기온만 체크하면 축소해도 그 둘 {set(kinds())}")
    p.check("#fc-legend [data-fcshow=p]"); p.wait_for_timeout(100)
    J(p, f"(() => {{ {S}.map.setZoom({z0} - 2, {{ animate: false }}); return null }})()"); p.wait_for_timeout(400)
    wet = [c for c in mine if max(c[4], c[9] or 0) > 0]
    check(labels(p) == 0 and p.locator("#fmap path.fc-dot").count() == len(wet) and len(wet) > 0, f"두 단계 축소: 글자 없이 칸 색 + 강수가 있는 칸에 점({len(wet)}칸)")
    p.uncheck("#fc-legend [data-fcshow=p]"); p.wait_for_timeout(200); check(p.locator("#fmap path.fc-dot").count() == 0, "강수 체크를 끄면 점도 없음")
    p.check("#fc-legend [data-fcshow=o]"); p.wait_for_timeout(100)
    p.reload(); p.wait_for_function("window.ForecastUI && ForecastUI._state().inited", timeout=60000); p.wait_for_timeout(800)
    p.click("#fc-tree [data-fchq='강원']"); p.wait_for_timeout(500); p.click(f"#fc-tree [data-fcbr='{d}']"); p.wait_for_timeout(1100)
    check([p.locator(f"#fc-legend [data-fcshow={k}]").is_checked() for k in "spot"] == [True, False, True, True] and set(kinds()) == {"B+I+EM"}, f"새로 열어도 체크한 값 그대로(적설·확률·기온) {set(kinds())}")

def t_auto_pick(b):
    """지사를 고르면 격자 하나를 고른 채로 엶(2026-10-10). 순서: ① 적설 ② 강수 + 24시간 안에 한 번이라도 4℃ 이하 ③ 강수 ④ 최저 4℃ 이하. 아무것도 없으면 고르지 않음"""
    def case(setup, name):
        m = SBM.Mock(); d = next(x["branch_id"] for x in m.branch_forecast if sum(1 for c in m.fc_cells if x["branch_id"] in c[2]) >= 5); cs = [c for c in m.fc_cells if d in c[2]]
        for c in cs: c[3] = 0; c[4] = 0; c[9] = None; c[10] = None; c[5] = 10.0; c[7] = {"s": [0] * 24, "p": [0] * 24, "t": [10.0] * 24, "r": [0] * 24}; c[8] = 0      # 모두 맑고 따뜻하게 만든 뒤 경우마다 바꿈
        want = setup(cs)
        p, _ = open_page(b, mock=m); J(p, f"(() => {{ SSOpenForecast('{d}'); return null }})()"); p.wait_for_timeout(1300)
        got = J(p, f"{S}.pin"); key = want and f"{want[0][0]},{want[0][1]}"
        check(J(p, f"{S}.focus") == d and got == key, f"{name}: {got} / {key}")
        if want: check(want[1] in J(p,f'{S}.pinWhy') and p.locator("#fc-pin .fc-pin-why").count()==0 and p.locator(".fc-detail tr.sel").get_attribute("data-cell") == key, f"{name}: 자동선택규칙 유지·설명제거·옆표표시")
        else: check(not p.locator("#fc-pin").is_visible(), f"{name}: 고정 창 없음")
        p.close()
    def rain(c, mm, t):                                    # 2~4시에 비 mm, 그 칸 기온 t
        c[4] = mm; c[5] = t; c[7] = {"s": [0] * 24, "p": [round(mm / 3, 1) if 2 <= i < 5 else 0 for i in range(24)], "t": [t] * 24, "r": [60] * 24}
    def s1(cs): rain(cs[0], 9.0, 1.0); cs[1][3] = 0.5; cs[1][7]["s"][5] = 0.5; cs[2][3] = 2.0; cs[2][7]["s"][5] = 2.0; return (cs[2], "적설이 가장 많은 칸")
    def s2(cs):                                            # 비 올 땐 10℃ 지만 밤(20시)에 2℃ 로 내려가는 칸도 ② — 24시간 안에 한 번이라도 4℃ 이하
        rain(cs[0], 9.0, 10.0); cs[0][5] = 2.0; cs[0][7]["t"][20] = 2.0; rain(cs[1], 3.0, 4.0); rain(cs[2], 12.0, 10.0); cs[3][5] = -8.0; cs[3][7]["t"] = [-8.0] * 24
        return (cs[0], "4℃ 이하 + 강수가 가장 많은 칸")
    def s3(cs): rain(cs[0], 2.0, 10.0); rain(cs[1], 9.0, 4.5); cs[2][5] = -8.0; cs[2][7]["t"] = [-8.0] * 24; return (cs[1], "강수가 가장 많은 칸")
    def s4(cs): cs[0][5] = 4.0; cs[0][7]["t"] = [4.0] * 24; cs[1][5] = -3.0; cs[1][7]["t"] = [-3.0] * 24; return (cs[1], "기온이 가장 낮은 칸")
    def s5(cs): cs[0][5] = 4.5; return None
    case(s1, "① 적설(강수·기온보다 먼저)"); case(s2, "② 강수 + 4℃ 이하(비가 더 많은 따뜻한 칸·더 추운 맑은 칸보다 먼저, 같은 시각이 아니어도)"); case(s3, "③ 강수(4.5℃ 는 해당 없음)")
    case(s4, "④ 최저 4℃ 이하"); case(s5, "해당 없음")

def t_top_menu(b):
    """위쪽 메뉴(2026-10-10): 1줄 페이지 전환(강설량 측정/장비 지원), 2줄은 그 페이지의 메뉴만. 장비 메뉴는 안쪽 화면의 탭을 대신 누름(안쪽 머리글은 숨김)"""
    p, m = open_page(b); p.wait_for_timeout(500)
    check(p.locator(".topnav").is_visible() and p.locator(".shell").get_attribute("data-page") == "snow", "위쪽 메뉴, 처음은 강설량 측정")
    check(p.locator(".tab-btn[data-tab=map]").is_visible() and not p.locator(".eq-btn[data-eqtab=move]").is_visible(), "강설량 페이지에서는 강설량 메뉴만")
    check(p.evaluate("getComputedStyle(document.body).fontFamily").lstrip('"').startswith('Pretendard') and p.evaluate("document.fonts.check('700 14px Pretendard')"), "글꼴 Pretendard(사이트 안 파일)")
    p.click(".page-btn[data-page=equip]"); p.wait_for_timeout(2500)
    check(p.locator(".eq-btn[data-eqtab=move]").is_visible() and not p.locator(".tab-btn[data-tab=map]").is_visible() and p.locator("#eqLogBtn").is_visible(), "장비 지원 페이지에서는 장비 메뉴만(관리자는 로그 기록도)")
    p.click(".eq-btn[data-eqtab=branch]"); p.wait_for_timeout(800)
    fr = p.frame_locator("#equipFrame")
    check(fr.locator(".tab[data-tab=branch]").get_attribute("aria-selected") == "true" and fr.locator("#panel-branch").is_visible(), "지사별 요청·편성이 열림")
    check(not fr.locator(".topbar").is_visible() and "active" in p.locator(".eq-btn[data-eqtab=branch]").get_attribute("class"), "안쪽 머리글은 숨기고 메뉴에 표시")
    p.click(".eq-btn[data-eqtab=move]"); p.wait_for_timeout(500)
    check(fr.locator("#panel-move").is_visible() and not fr.locator("#panel-branch").is_visible(), "이동 현황으로 바뀜")
    p.click(".page-btn[data-page=snow]"); p.wait_for_timeout(300); p.click(".tab-btn[data-tab=snowtable]"); p.wait_for_timeout(400)
    check(p.locator("#page-snow").is_visible() and not p.locator("#page-equip").is_visible() and p.locator("#view-snowtable").is_visible(), "강설량 측정으로 돌아와 메뉴 고르기")
    an = "getComputedStyle(document.getElementById('view-snowtable')).animationName"
    check(p.evaluate(an) == "ssFade", "움직임 4: 화면 바꿀 때 0.15초 나타나기")
    p.emulate_media(reduced_motion="reduce"); p.wait_for_timeout(100)
    check(p.evaluate(an) == "none", "컴퓨터의 '동작 줄이기'를 켜면 움직임 없음"); p.emulate_media(reduced_motion="no-preference")
    p.set_viewport_size({"width": 390, "height": 844}); p.wait_for_timeout(300)
    box = p.locator(".tn-tabs").bounding_box()
    check(p.locator(".tab-btn[data-tab=forecast]").is_visible() and box and box["width"] <= 390 and p.evaluate("document.documentElement.scrollWidth <= 392"), "휴대폰 폭: 메뉴 줄은 옆으로 밀어 보기, 화면은 가로로 넘치지 않음")

TESTS = [t_pin_chart, t_first_tab_and_order, t_levels, t_open_from_equipment, t_branch_user_can_view, t_legend_show, t_auto_pick, t_top_menu]

def t_blend_no_toggle(b):
    """2026-11-04(60): 전환 버튼 없음. 서버가 앞 6시간 초단기(신적설은 단기) + 나머지 단기로 섞어 둔 값을 그대로 — 고정 창 표의 앞 6시각 전부 색칠, 신적설은 단기"""
    m = SBM.Mock()
    for c in m.fc_cells:
        c[7]["s"] = [1] * 6 + [0] * 18
        c[3] = 6; c[10] = 6; c[7].pop("sq", None)
    p, m = open_page(b, m)
    p.click(".tab-btn[data-tab=forecast]"); p.wait_for_timeout(900)
    check(p.locator("#fc-mode, [data-fcmode]").count() == 0, "단기/초단기 전환 버튼 없음")
    meta = p.locator("#fc-meta").inner_text(); check("발표" not in meta and "초단기" not in meta and "24시간 합" in meta, "위쪽 안내 = 예보 구간만: " + meta)
    p.click("#fc-tree [data-fchq='강원']"); p.wait_for_timeout(600)
    br = J(p, f"{S}.state.order.find(id => {S}.state.branches[id].hq === '강원')")
    p.click(f"#fc-tree [data-fcbr='{br}']"); p.wait_for_timeout(800)
    t1 = p.locator(".fc-pin .fc-tt").first
    check(p.locator(".fc-pin .fc-tt").count() == 1 and t1.locator("thead tr").last.locator("th:not(.lb)").count() == 48, "48시간 한 줄 표")
    check(t1.locator("thead th.vs").count() == 6 and t1.locator("td.vs").count() == 24, "앞 6시각 전부(적설·강수·확률·기온) 색칠, 다른 시간은 색칠하지 않음")
    sn = t1.locator("tbody tr").nth(0).locator("td.vs").all_inner_texts(); check(sn == ["1"] * 6, f"앞 6시간 신적설 = 단기 값 1: {sn}")
    cap = p.locator(".fc-pin").inner_text(); check("색칠한 칸" not in cap and "크기 조절" not in cap and p.locator("#fc-pin .fc-pin-note, #fc-pin .fc-tt-cap").count()==0, "모달 하단 설명 삭제")

def t_pin_move_resize(b):
    """2026-11-03: 격자 창을 끌어 옮기고 모서리로 크기를 바꿈(글자도 같은 비율). 다른 격자를 눌러도 그대로, 다시 열어도 기억. 지도 밖으로 나가지 않음"""
    p, m = open_page(b)
    p.click(".tab-btn[data-tab=forecast]"); p.wait_for_timeout(800)
    p.click("#fc-tree [data-fchq='강원']"); p.wait_for_timeout(600)
    p.locator("#fc-tree [data-fcbr]").first.click(); p.wait_for_timeout(900)
    box = lambda: p.locator("#fc-pin").bounding_box()
    tdw = lambda: p.locator(".fc-pin .fc-tt td").first.bounding_box()
    b0 = box(); w0 = tdw()
    check(abs(b0["width"] - 454) <= 3, f"세 창을 위한 촘촘한 기본 크기: {b0}")
    # 옮기기
    h = p.locator("#fc-pin .fc-pin-head").bounding_box(); p.mouse.move(h["x"] + 60, h["y"] + 8); p.mouse.down(); p.mouse.move(h["x"] - 200, h["y"] + 120, steps=4); p.mouse.up(); p.wait_for_timeout(100)
    b1 = box(); check(abs(b1["x"] - (b0["x"] - 260)) <= 2 and abs(b1["y"] - (b0["y"] + 112)) <= 2 and abs(b1["width"] - b0["width"]) <= 1, f"제목을 끌면 옮겨짐: {b0} → {b1}")
    # 오른쪽 아래 모서리로 키우기: 왼쪽 위 그대로, 표·글자도 커짐
    g = p.locator("#fc-pin .fc-pin-grip.r").bounding_box(); p.mouse.move(g["x"] + 8, g["y"] + 8); p.mouse.down(); p.mouse.move(g["x"] + 108, g["y"] + 8, steps=4); p.mouse.up(); p.wait_for_timeout(100)
    b2 = box(); z = J(p, "+document.querySelector('.fc-pin-in').style.zoom")
    check(abs(b2["x"] - b1["x"]) <= 2 and abs(b2["width"] - (b1["width"] + 100)) <= 3 and z > 1.2 and b2["height"] <= b1["height"] * 1.5, f"모서리로 커짐: {b1} → {b2}, 배율 {z}")
    check(tdw()["width"] > w0["width"] * 1.15, "표 칸·글자도 같은 비율로 커짐")
    fs = J(p, "(() => { const c = document.querySelector('.fc-pin .fc-tt td'); const r = document.createRange(); r.selectNodeContents(c); return r.getBoundingClientRect().height; })()")
    # 다른 격자를 눌러도 그대로
    p.locator(".fc-detail tbody tr").nth(1).click(); p.wait_for_timeout(300)
    b3 = box(); check(abs(b3["x"] - b2["x"]) <= 1 and abs(b3["y"] - b2["y"]) <= 1 and abs(b3["width"] - b2["width"]) <= 1, f"다른 격자: 위치·크기 그대로 {b2} {b3}")
    # 닫았다 열어도, 왼쪽 모서리로 줄이면 오른쪽 끝 그대로
    p.locator(".fc-pin-x").click(); p.wait_for_timeout(100); p.locator(".fc-detail tbody tr").nth(2).click(); p.wait_for_timeout(200)
    b4 = box(); check(abs(b4["x"] - b2["x"]) <= 1 and abs(b4["width"] - b2["width"]) <= 1, "닫았다 열어도 그대로")
    g = p.locator("#fc-pin .fc-pin-grip.l").bounding_box(); right = b4["x"] + b4["width"]
    p.mouse.move(g["x"] + 8, g["y"] + 8); p.mouse.down(); p.mouse.move(g["x"] + 58, g["y"] + 8, steps=4); p.mouse.up(); p.wait_for_timeout(100)
    b5 = box(); check(abs(b5["x"] + b5["width"] - right) <= 2 and b5["width"] < b4["width"] - 30, f"왼쪽 모서리: 오른쪽 끝 고정 {b4} {b5}")
    # 지도 밖으로 못 나감, 지도보다 안 커짐
    mb = p.locator("#view-forecast .jr-mapbox").bounding_box()
    h = p.locator("#fc-pin .fc-pin-head").bounding_box(); p.mouse.move(h["x"] + 60, h["y"] + 8); p.mouse.down(); p.mouse.move(mb["x"] + mb["width"] + 500, mb["y"] + mb["height"] + 500, steps=4); p.mouse.up(); p.wait_for_timeout(100)
    b6 = box(); check(b6["x"] + b6["width"] <= mb["x"] + mb["width"] + 1 and b6["y"] + b6["height"] <= mb["y"] + mb["height"] + 1, f"지도 안에 머묾: {b6} {mb}")
    g = p.locator("#fc-pin .fc-pin-grip.l").bounding_box(); p.mouse.move(g["x"] + 8, g["y"] + 8); p.mouse.down(); p.mouse.move(mb["x"] - 3000, g["y"] + 8, steps=4); p.mouse.up(); p.wait_for_timeout(100)
    b7 = box(); check(b7["x"] >= mb["x"] - 1 and b7["width"] <= mb["width"] + 1 and b7["height"] <= mb["height"] + 1, f"지도보다 안 커짐: {b7} {mb}")
    # 아주 작게도 안 됨
    saved = J(p, "JSON.parse(localStorage.getItem('ss_fc_pin'))"); check(saved["scale"] >= 0.8 and saved["x"] is not None, f"이 브라우저에 기억: {saved}")
    g = p.locator("#fc-pin .fc-pin-grip.r").bounding_box(); p.mouse.move(g["x"] + 8, g["y"] + 8); p.mouse.down(); p.mouse.move(g["x"] - 3000, g["y"], steps=4); p.mouse.up(); p.wait_for_timeout(100)
    z = J(p, "+document.querySelector('.fc-pin-in').style.zoom"); check(z >= 0.8 - 0.001, f"너무 작아지지 않음: {z}")
    # 새로 열어도 기억
    b8 = box(); p.reload(); p.wait_for_function("window.ForecastUI && ForecastUI._state().inited", timeout=60000)
    p.click(".tab-btn[data-tab=forecast]"); p.wait_for_timeout(800); p.click("#fc-tree [data-fchq='강원']"); p.wait_for_timeout(600); p.locator("#fc-tree [data-fcbr]").first.click(); p.wait_for_timeout(900)
    b9 = box(); check(abs(b9["x"] - b8["x"]) <= 2 and abs(b9["width"] - b8["width"]) <= 2, f"새로 열어도 기억: {b8} {b9}")

def t_phone_fit(b):
    """2026-11-03: 휴대폰에서 목록·격자 표·추이 표가 화면 폭을 넘지 않음(예전: 목록 440px, 추이 표 418px)"""
    p, m = open_phone(b)
    box = lambda s: J(p, f"(() => {{ const r = document.querySelector('{s}').getBoundingClientRect(); return [r.left, r.right, r.width, r.height]; }})()")
    def fits(tag):
        w = J(p, "innerWidth"); check(w == 375 and J(p, "document.scrollingElement.scrollWidth") <= 375, f"{tag}: 화면이 옆으로 밀리지 않음 {w}, {J(p, 'document.scrollingElement.scrollWidth')}")
        over = J(p, """[...document.querySelectorAll('#view-forecast .jr-side *, #fc-pin *, #fc-tail *')].filter(e => { if(e.closest('.fc-scroll')) return false; const r = e.getBoundingClientRect(); return r.width && r.right > innerWidth + 0.5; }).map(e => e.tagName + '.' + e.className + ':' + Math.round(e.getBoundingClientRect().right)).slice(0, 5)""")
        check(not over, f"{tag}: 넘치는 칸 {over}")
        clip = J(p, """[...document.querySelectorAll('.fc-tt td, .fc-tt th, .fc-detail td, .fc-detail th, .fc-row .fc-v')].filter(c => c.offsetParent && c.scrollWidth > c.clientWidth + 1).map(c => c.textContent.trim() + ' ' + c.scrollWidth + '>' + c.clientWidth).slice(0, 5)""")
        check(not clip, f"{tag}: 글자가 잘림 {clip}")
    check(box("#view-forecast .jr-side")[2] == 375 and box("#view-forecast .jr-mapbox")[2] == 375, f"목록·지도 폭 같음: {box('#view-forecast .jr-side')} {box('#view-forecast .jr-mapbox')}")
    fits("전체")
    p.locator("#fc-tree [data-fchq='강원']").click(); p.wait_for_timeout(600)
    p.locator("#fc-tree [data-fcbr]").first.click(); p.wait_for_timeout(1000)
    fits("지사")
    pin = box("#fc-pin"); check(p.locator("#fc-pin").is_visible() and pin[0] >= 0 and pin[1] <= 375 and pin[3] <= box("#view-forecast .jr-mapbox")[3], f"추이 표가 지도 안에: {pin}")
    p.locator(".fc-detail tbody tr").nth(1).click(); p.wait_for_timeout(400); fits("격자 누름")
    check(p.locator("#fc-pin").is_visible(), "격자를 누르면 표가 뜸")
    p.locator(".fc-mobile-close").click(); p.wait_for_timeout(200); check(not p.locator("#fc-mobile").is_visible(), "공통 닫기 버튼으로 닫힘")
    # 모바일에는 옮기기·크기 조절 없음(컴퓨터에서 기억한 값이 있어도)
    p.evaluate("localStorage.setItem('ss_fc_pin', JSON.stringify({scale: 1.6, x: 500, y: 300}))"); p.reload(); p.wait_for_function("window.ForecastUI && ForecastUI._state().inited", timeout=60000)
    p.evaluate("document.querySelector('.tab-btn[data-tab=forecast]').click()"); p.wait_for_timeout(800)
    p.locator("#fc-tree [data-fchq='강원']").click(); p.wait_for_timeout(600); p.locator("#fc-tree [data-fcbr]").first.click(); p.wait_for_timeout(900)
    pin = box("#fc-pin"); mobile=box('#fc-mobile'); check(not p.locator("#fc-pin .fc-pin-grip.r").is_visible() and J(p, "document.querySelector('.fc-pin-in').style.zoom") == "" and mobile[0] == 8 and mobile[1] == 367 and pin[0]>=mobile[0] and pin[1]<=mobile[1], f"모바일: 크기 조절 없음, 공통 창 안 화면 폭에 맞음 {pin}")
    fits("모바일 기억값 무시")

def t_eq_round_bar(b):
    """2026-11-03: 기준일자는 위쪽 메뉴에 늘 보임(노란 칸). 넓은 화면 = 탭 줄 오른쪽, 좁으면 [+]로 삭제·만들기, 휴대폰 = 사용법 아래. 탭을 가리지 않음"""
    p, m = open_page(b)
    p.click(".page-btn[data-page=equip]"); p.wait_for_timeout(2000); fr = p.frame("equipFrame") or p.frames[1]
    frame = next(f for f in p.frames if "equipment/index.html" in f.url)
    wide, row = p.locator("#eqRoundWide"), p.locator("#eqRoundRow")
    def no_cover():
        tabs = J(p, """[...document.querySelectorAll('.eq-btn')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect()).map(r => [r.left, r.right, r.top, r.bottom])""")
        boxes = J(p, """[...document.querySelectorAll('.eq-round, .eq-reload')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect()).map(r => [r.left, r.right, r.top, r.bottom])""")
        hit = [(t, x) for t in tabs for x in boxes if t[0] < x[1] - 1 and x[0] < t[1] - 1 and t[2] < x[3] - 1 and x[2] < t[3] - 1]
        check(not hit, f"탭을 가리지 않음: {hit[:2]}")
    # 넓은 화면(1600): 탭 줄에 전부
    p.set_viewport_size({"width": 1600, "height": 900}); p.wait_for_timeout(200)
    check(wide.locator(".eq-round-sel").is_visible() and not row.is_visible() and wide.locator("[data-rd=make]").is_visible() and wide.locator("[data-rd=del]").is_visible() and not wide.locator("[data-rd=more]").is_visible(), "1600: 탭 줄에 기준일자·삭제·만들기")
    no_cover()
    check(J(p, "getComputedStyle(document.querySelector('#eqRoundWide .eq-round-sel')).backgroundColor") == "rgb(255, 243, 176)", "기준일자 칸 하이라이트")
    check(not frame.locator("#branchRound").is_visible(), "안쪽 탭의 기준일자 줄은 숨김")
    for t in ("branch", "fleet", "alloc", "move"):
        p.click(f".eq-btn[data-eqtab={t}]"); p.wait_for_timeout(200); check(wide.locator(".eq-round-sel").is_visible(), f"{t} 탭에서도 보임")
    # 안쪽 화면과 같은 기준일자
    rid = frame.evaluate("S.round"); check(wide.locator(".eq-round-sel").input_value() == str(rid), "안쪽 화면과 같은 기준일자")
    # 만들기·고르기·삭제
    d = frame.evaluate("addDays(nextRoundMin(), 3)"); wide.locator("[data-rd=date]").fill(d); wide.locator("[data-rd=make]").click(); p.wait_for_timeout(600)
    r2 = frame.evaluate("S.round"); check(r2 != rid and frame.evaluate("curRound().start_date") == d and wide.locator(".eq-round-sel").input_value() == str(r2), f"만들기: {d}")
    wide.locator(".eq-round-sel").select_option(str(rid)); p.wait_for_timeout(500); check(frame.evaluate("S.round") == rid, "고르면 안쪽 화면도 바뀜")
    wide.locator(".eq-round-sel").select_option(str(r2)); p.wait_for_timeout(500); wide.locator("[data-rd=del]").click(); p.wait_for_timeout(600)
    check("지우지 못했습니다" in frame.locator("#toast").inner_text(), "삭제 버튼 → 안쪽 화면의 기준일자 삭제까지 이어짐(이 가짜 서버는 삭제를 막음, 실제 삭제 규칙은 test_equipment): " + frame.locator("#toast").inner_text())
    # 중간(1366): 탭 줄에 기준일자와 [+], 삭제·만들기는 눌러야
    p.set_viewport_size({"width": 1366, "height": 800}); p.wait_for_timeout(200); no_cover()
    check(wide.locator(".eq-round-sel").is_visible() and wide.locator("[data-rd=more]").is_visible() and not wide.locator("[data-rd=make]").is_visible() and not row.is_visible(), "1366: 기준일자와 [+]만")
    top0 = p.locator("#equipFrame").bounding_box()["y"]; wide.locator("[data-rd=more]").click(); p.wait_for_timeout(150); no_cover()
    check(row.is_visible() and row.locator("[data-rd=make]").is_visible() and row.locator("[data-rd=del]").is_visible() and not row.locator(".eq-round-sel").is_visible(), "[+]: 삭제·만들기 줄이 펼쳐짐")
    check(p.locator("#equipFrame").bounding_box()["y"] > top0, "표를 가리지 않고 아래로 밂")
    wide.locator("[data-rd=more]").click(); p.wait_for_timeout(100); check(not row.is_visible(), "다시 누르면 닫힘")
    # 휴대폰: 사용법 아래에 드롭다운과 [+]
    p.set_viewport_size({"width": 390, "height": 844}); p.wait_for_timeout(250); no_cover()
    check(row.locator(".eq-round-sel").is_visible() and row.locator("[data-rd=more]").is_visible() and not row.locator("[data-rd=make]").is_visible() and not wide.is_visible(), "휴대폰: 드롭다운과 [+]만")
    rb = row.bounding_box(); ub = p.locator(".tn-row").bounding_box(); tb = p.locator(".tn-tabs").bounding_box()
    check(rb["y"] >= ub["y"] + ub["height"] - 1 and rb["y"] + rb["height"] <= tb["y"] + 1 and rb["x"] + rb["width"] <= 391, f"머리글 아래, 탭 위: {ub} {rb} {tb}")
    # 2026-11-03: 화면·사용법·계정 줄은 [▾]로 접고 폄(처음 접힘), 페이지 전환 옆. 새로고침과 기준일자는 늘 보임
    more = p.locator("#tnMore"); user = p.locator("#ssUser")
    check(more.is_visible() and not user.is_visible() and not p.locator("#snTheme").is_visible() and p.locator("#snReload").is_visible(), "처음엔 접힘, 새로고침은 보임")
    mb = more.bounding_box(); pb = p.locator(".tn-pages").bounding_box()
    check(abs((mb["y"] + mb["height"] / 2) - (pb["y"] + pb["height"] / 2)) <= 3 and mb["x"] >= pb["x"] + pb["width"] - 1 and mb["x"] + mb["width"] <= 391, f"페이지 전환 옆: {pb} {mb}")
    check(J(p, "document.scrollingElement.scrollWidth") <= 390, "화면이 옆으로 밀리지 않음")
    y0 = p.locator(".tn-tabs").bounding_box()["y"]; more.click(); p.wait_for_timeout(100)
    check(user.is_visible() and p.locator("#snTheme").is_visible() and more.get_attribute("aria-expanded") == "true" and p.locator(".tn-tabs").bounding_box()["y"] > y0, "누르면 펴지고 탭을 아래로 밂")
    more.click(); p.wait_for_timeout(100); check(not user.is_visible() and p.locator(".tn-tabs").bounding_box()["y"] == y0, "다시 누르면 접힘"); no_cover()
    rb = row.bounding_box(); tb = p.locator(".tn-tabs").bounding_box()
    tabs_y = tb["y"]; row.locator("[data-rd=more]").click(); p.wait_for_timeout(150); no_cover()
    check(row.locator("[data-rd=make]").is_visible() and p.locator(".tn-tabs").bounding_box()["y"] > tabs_y and J(p, "document.scrollingElement.scrollWidth") <= 390, "[+]: 탭을 아래로 밀며 펼침(가리지 않음)")
    check(p.locator(".eq-btn[data-eqtab=branch]").is_visible(), "탭 그대로")
    check(p.locator(".page-btn").all_inner_texts() == ["장비 지원", "강설량 측정"], "2026-11-03: 장비 지원이 앞")
    row.locator("[data-rd=more]").click(); p.wait_for_timeout(100)
    # 강설량 측정에서는 안 보임
    p.click(".page-btn[data-page=snow]"); p.wait_for_timeout(200); check(not row.is_visible() and not wide.is_visible(), "강설량 측정에서는 안 보임")

def t_eq_round_no_edit(b):
    """권한 없는 계정: 드롭다운만, [+] 없음"""
    p, m = open_page(b, user="exchungju")
    p.click(".page-btn[data-page=equip]"); p.wait_for_timeout(2000)
    w = p.locator("#eqRoundWide"); check(w.locator(".eq-round-sel").is_visible() and w.locator("[data-rd=more]").count() == 0 and w.locator("[data-rd=make]").count() == 0, "드롭다운만")

def t_first_page_equip(b):
    """2026-11-03: 로그인 뒤 첫 화면 = 장비 지원. 강설량 측정은 처음 열 때 자료를 받고 지도가 제대로 그려짐. 뒤로가기 끝도 장비 지원"""
    T.FIRST["snow"] = False
    try:
        p, m = open_page(b); p.wait_for_timeout(1500)
        frame = next(f for f in p.frames if "equipment/index.html" in f.url)
        check(p.locator("#shell").get_attribute("data-page") == "equip" and "active" in p.locator(".page-btn[data-page=equip]").get_attribute("class") and "active" not in p.locator(".page-btn[data-page=snow]").get_attribute("class"), "첫 화면 = 장비 지원")
        check(p.locator("#page-equip").is_visible() and not p.locator("#page-snow").is_visible() and p.locator(".eq-btn[data-eqtab=move]").is_visible() and not p.locator(".tab-btn[data-tab=map]").is_visible(), "장비 지원 메뉴")
        frame.wait_for_selector("#matrix tbody tr", timeout=20000); check(p.locator(".eq-btn[data-eqtab=move]").get_attribute("class").count("active") == 1, "첫 탭 = 이동 현황")
        check(not m.fc_calls and J(p, f"{S}.map === null"), "강설량 측정 자료·지도는 아직 안 만듦")
        p.click(".page-btn[data-page=snow]"); p.wait_for_timeout(1200)
        check(p.locator("#view-forecast").is_visible() and "active" in p.locator(".tab-btn[data-tab=forecast]").get_attribute("class"), "강설량 측정 = 기관별 예보부터")
        check(J(p, f"{S}.map.getSize().x") > 300 and J(p, f"{S}.lines.getLayers().length") > 900 and p.locator("#fc-tree [data-fchq]").count() == 9, "지도·목록이 제대로 그려짐")
        p.click(".tab-btn[data-tab=map]"); p.wait_for_timeout(900)
        size = J(p, "(() => { const m = document.querySelector('#view-map .leaflet-container') || document.querySelector('#map'); return m ? m.getBoundingClientRect().width : 0; })()")
        check(p.locator("#view-map").is_visible() and size > 300, f"관측소 지도도 제대로: {size}")
        p.click(".page-btn[data-page=equip]"); p.wait_for_timeout(300); p.click(".page-btn[data-page=snow]"); p.wait_for_timeout(300)
        check("active" in p.locator(".tab-btn[data-tab=map]").get_attribute("class"), "다시 와도 보던 탭 그대로")
        # 뒤로가기: 처음 칸 = 장비 지원
        p.go_back(); p.wait_for_timeout(300); p.go_back(); p.wait_for_timeout(300); p.go_back(); p.wait_for_timeout(300); p.go_back(); p.wait_for_timeout(400)
        check(p.locator("#shell").get_attribute("data-page") == "equip", "뒤로가기 끝 = 첫 화면(장비 지원)")
        # 요청·편성에서 예보로 넘어가면 강설량 측정의 그 지사(첫 화면이 장비 지원이어도)
        br = J(p, f"{S}.state ? {S}.state.order[0] : null")
        p.evaluate(f"SSOpenForecast('{br}')"); p.wait_for_timeout(800)
        check(p.locator("#shell").get_attribute("data-page") == "snow" and J(p, f"{S}.focus") == br, "예보로 넘어가기")
    finally:
        T.FIRST["snow"] = True

def t_first_page_equip_first_forecast(b):
    """장비 지원에서 강설량 측정을 한 번도 안 열고 바로 예보로 넘어가도 그 지사가 열림. #fc= 로 연 창은 강설량 측정 그대로"""
    T.FIRST["snow"] = False
    try:
        p, m = open_page(b); p.wait_for_timeout(1500)
        br = p.evaluate("(window.JURIS.doc.branches[0] || {}).id"); p.evaluate(f"SSOpenForecast('{br}')"); p.wait_for_timeout(1000)
        check(p.locator("#shell").get_attribute("data-page") == "snow" and J(p, f"{S}.focus") == br and J(p, f"{S}.map.getSize().x") > 300, f"바로 예보로: {J(p, S + '.focus')}")
        q, m2 = open_page(b, hash=f"#fc={br}"); q.wait_for_timeout(1500)
        check(q.locator("#shell").get_attribute("data-page") == "snow" and not q.locator("#equipFrame").get_attribute("src"), "#fc= 창은 강설량 측정, 장비 지원은 안 불러옴")
    finally:
        T.FIRST["snow"] = True

def t_int_and_range(b):
    """2026-11-04(62): 적설·강수는 정수로, '1mm·1cm 미만' 시각이 있으면 범위(0~3, 한 시각이면 ~1). 고정 창 표의 그 시각 칸은 '~1'"""
    p, m = open_page(b)
    p.click(".tab-btn[data-tab=forecast]"); p.wait_for_timeout(800)
    txt = p.locator("#fc-tree").inner_text(); check("." not in txt.replace("본부", ""), "목록에 소수점 없음: " + txt[:120].replace("\n", " "))
    c = next(c for c in m.fc_cells if c[9] > c[4] or c[10] > c[3]); d = c[2][0]
    J(p, f"(() => {{ SSOpenForecast('{d}'); return null }})()"); p.wait_for_timeout(1300)
    bf = [x for x in m.branch_forecast if x["branch_id"] == d][0]
    want = lambda lo, hi: str(lo) if hi <= lo else ("~1" if lo == 0 and hi == 1 else f"{lo}~{hi}")
    row = p.locator(f"#fc-tree [data-fcbr='{d}']")
    check(row.locator(".fc-v.s").inner_text().replace("cm", "") == want(bf["max_snow_24h"], bf["max_snow_hi"]) and row.locator(".fc-v.p").inner_text().replace("mm", "") == want(bf["max_pcp_24h"], bf["max_pcp_hi"]),
          f"지사 줄 범위: {row.inner_text()} / {bf}")
    tr = p.locator(f".fc-detail tr[data-cell='{c[0]},{c[1]}'] td")
    check(tr.nth(1).inner_text() == want(c[3], c[10]) and tr.nth(2).inner_text() == want(c[4], c[9]), f"격자 표 범위: {tr.all_inner_texts()}")
    p.locator(f".fc-detail tr[data-cell='{c[0]},{c[1]}']").click(); p.wait_for_timeout(500)
    tds = p.locator(".fc-pin .fc-tt td.tr").all_inner_texts()
    check(tds == ["~1"], f"고정 창: '~1' 칸 하나: {tds}")
    check(p.locator(".fc-pin .fc-tt-sum").count()==0, "불필요한 합계 설명 제거")

TESTS += [t_int_and_range, t_blend_no_toggle, t_pin_move_resize, t_phone_fit, t_eq_round_bar, t_eq_round_no_edit, t_first_page_equip, t_first_page_equip_first_forecast]

def t_tail_separate(b):
    # 22시대 동적 자료에는 첫 칸23~24만 있고22~24가 없을 수 있다.
    # 자정 표기를 검증하는 이 시험의 예보창만 고정한다.
    m=SBM.Mock();m.fc_start='2026-11-06T10:00:00+09:00';m.fc_end='2026-11-07T10:00:00+09:00'
    for row in m.branch_forecast:row['detail'].update(start_at=m.fc_start,end_at=m.fc_end)
    p,m=open_page(b,m)
    d=m.fc_cells[0][2][0]
    J(p, f"(() => {{ SSOpenForecast('{d}'); return null }})()")
    p.locator(".fc-detail tbody tr").first.click()
    p.wait_for_function("document.querySelector('#fc-tail .fc-tt')")
    check(p.locator("#fc-pin").is_visible() and p.locator("#fc-tail").is_visible(), "별도 예보 창 두 개")
    check(p.locator("#fc-pin #fc-tail").count()==0, "한 창 안에 넣지 않음")
    check(p.locator('#fc-tail thead tr').count()==2 and p.locator('#fc-pin thead tr').count()==2,'날짜/시각 머리글 두 행')
    check('/' in p.locator('#fc-tail thead tr').first.inner_text() and '~' in p.locator('#fc-tail thead tr').last.inner_text(),'일자 위·시간 범위 아래')
    check(p.locator('#fc-tail table').count()==1 and p.locator('#fc-pin table').count()==1,'두 표 각각 한 줄')
    widths=J(p,"Array.from(document.querySelectorAll('.fc-scroll')).map(x=>[x.scrollWidth,x.clientWidth])")
    check(all(a>b for a,b in widths),'두 표 가로 스크롤')
    labels=p.locator('#fc-tail thead tr').last.locator('th:not(.lb)').all_inner_texts()
    check(len(labels)>8,'가까운24시간 포함한 정량 구간')
    check('22~24' in labels and all('시' not in x.split('\n')[0] for x in labels),'자정 끝24 표기·시 단위 생략')
    dates=p.locator('#fc-tail thead tr').first.locator('th:not(.lb)').all_inner_texts()
    check(all('~' not in x for x in dates),'시작 날짜 하나만 표시')
    for root in ('#fc-pin','#fc-tail'):
        check(p.locator(root+' thead .lb').all_inner_texts()==['일자','시간'],'머리글 좌측 일자/시간')
        check(p.locator(root+' .fc-pin-note').count()==0,'하단 설명 제거')
        align=J(p,"Array.from(document.querySelectorAll('"+root+" .fc-tt th,"+root+" .fc-tt td')).every(x=>getComputedStyle(x).textAlign==='center')")
        check(align,'모든 표 칸 가운데 정렬')
    clip=J(p,"Array.from(document.querySelectorAll('#fc-tail .fc-tt th,#fc-tail .fc-tt td')).some(x=>x.scrollWidth>x.clientWidth+1)")
    check(not clip,'3시간 칸 글자 안 잘림')

    amounts=p.locator('#fc-tail tbody tr').nth(0).locator('td').all_inner_texts()+p.locator('#fc-tail tbody tr').nth(1).locator('td').all_inner_texts()
    check('-' not in amounts and '많은 눈' in amounts and '강한 비' in amounts,'먼 정성 칸도 강도 표현으로 유지(영하 기온 유지)')
    check('강설 없음' in amounts and '강수 없음' in amounts,'정성0은빈칸대신없음표시')
    check(p.locator('#fc-tail .fc-qual-label').count()==0 and '정성' not in p.locator('#fc-tail').inner_text(),'정성예보안내단어제거')
    check(p.locator('#fc-tail tbody tr').nth(0).locator('td.fc-qual').count()==3 and p.locator('#fc-tail tbody tr').nth(2).locator('td.fc-qual').count()==0,'적설강수만정성·확률기온숫자유지')
    p.screenshot(path="../../outputs/72_desktop.png")
    p.locator(".fc-tail-x").click()
    check(not p.locator("#fc-tail").is_visible() and p.locator("#fc-pin").is_visible(), "이후 창만 닫기")
    p.locator(".fc-detail tbody tr").nth(1).click()
    p.wait_for_function("document.querySelector('#fc-tail .fc-tt')")
    p.locator(".fc-pin-x").click()
    check(p.locator("#fc-tail").is_visible() and not p.locator("#fc-pin").is_visible(), "24시간 창만 닫기")

def t_tail_phone(b):
    p,m=open_phone(b)
    d=m.fc_cells[0][2][0]
    J(p, f"(() => {{ SSOpenForecast('{d}'); return null }})()")
    p.locator(".fc-detail tbody tr").first.click()
    p.wait_for_function("document.querySelector('#fc-tail .fc-tt')")
    a=p.locator('#fc-mobile').bounding_box()
    check(a['x']>=0 and a['x']+a['width']<=375, '휴대폰 폭 안 하나의 예보창')
    check(p.locator('#fc-pin').is_visible() and not p.locator('#fc-tail').is_visible(), '처음은1시간 탭')
    p.locator('#fc-tab-three').click()
    check(p.locator('#fc-tail').is_visible() and not p.locator('#fc-pin').is_visible(), '3시간 탭 전환')
    p.screenshot(path='../../outputs/72_phone.png')

def t_tail_failure(b):
    p,m=open_page(b)
    p.route('**/rpc/forecast_cell_detail', lambda route: route.fulfill(status=503,content_type='application/json',body='{}'))
    d=m.fc_cells[0][2][0]
    J(p, f"(() => {{ SSOpenForecast('{d}'); return null }})()")
    p.locator(".fc-detail tbody tr").first.click()
    p.locator('[data-tail-retry]').wait_for()
    check(p.locator('#fc-pin .fc-t1').count()==1, '이후 조회 실패해도 기존24시간 유지')
    p.unroute('**/rpc/forecast_cell_detail')
    p.locator('[data-tail-retry]').click()
    p.wait_for_function("document.querySelector('#fc-tail .fc-tt')")
    check(p.locator('#fc-tail .fc-tt').count()==1,'다시 받기 성공')

TESTS += [t_tail_separate,t_tail_phone,t_tail_failure]

def t_right_dock_and_tail_drag(b):
    p,m=open_page(b)
    d=m.fc_cells[0][2][0]
    J(p,f"(() => {{ SSOpenForecast('{d}'); return null }})()")
    p.wait_for_function("document.querySelector('#fc-tail table')")
    p.wait_for_timeout(250)  # fcPop opens at scale .97; measure after the .15s animation.
    a=p.locator('#fc-pin').bounding_box();z=p.locator('#fc-tail').bounding_box();mb=p.locator('#fmap').bounding_box()
    check(abs(a['x']+a['width']-mb['x']-mb['width']+10)<=2 and abs(z['x']+z['width']-mb['x']-mb['width']+10)<=2,f'두 창 지도 오른쪽에 배치 {a} {z} {mb}')
    check(z['y']>=a['y']+a['height'],'오른쪽에 세로로 겹치지 않게')
    point=J(p,f"(() => {{const k={S}.pin.split(',');const q={S}.map.latLngToContainerPoint(GridCore.cellCenter(+k[0],+k[1]));return {{x:q.x,y:q.y}};}})()")
    check(mb['x']+point['x']<a['x'],'선택 격자는 창 왼쪽에 보임')
    p.screenshot(path='../../outputs/73_docked.png')
    scale=J(p,"document.querySelector('#fc-tail .fc-pin-in').style.zoom")
    h=p.locator('#fc-tail .fc-pin-head').bounding_box()
    p.mouse.move(h['x']+60,h['y']+10);p.mouse.down();p.mouse.move(h['x']-60,h['y']+70,steps=5);p.mouse.up()
    moved=p.locator('#fc-tail').bounding_box()
    check(abs(moved['width']-z['width'])<=1 and abs(moved['height']-z['height'])<=1,'제목 이동 후 폭과 높이 유지')
    check(abs(moved['x']-z['x']+120)<=2 and abs(moved['y']-z['y']-60)<=2,'위치만 이동')
    check(J(p,"document.querySelector('#fc-tail .fc-pin-in').style.zoom")==scale,'이동 중 글자 배율 유지')
    J(p,"window.dispatchEvent(new Event('resize'))")
    after=p.locator('#fc-tail').bounding_box()
    check(abs(after['width']-z['width'])<=1 and abs(after['height']-z['height'])<=1,'화면 재배치 후에도 이동한 창 크기 유지')
    p.screenshot(path='../../outputs/73_desktop.png')
    q,m2=open_page(b);q.set_viewport_size({'width':1024,'height':900})
    J(q,f"(() => {{SSOpenForecast('{d}');return null}})()")
    q.wait_for_function("document.querySelector('#fc-tail table')");q.wait_for_timeout(250)
    visible=J(q,f"(() => {{const s={S},k=s.pin.split(','),xs=GridCore.cellCorners(+k[0],+k[1]).map(c=>s.map.latLngToContainerPoint(c).x),r=document.querySelector('#fc-pin').getBoundingClientRect(),m=document.querySelector('#fmap').getBoundingClientRect();return {{left:Math.min(...xs),right:Math.max(...xs),pane:r.left-m.left}};}})()")
    check(visible['left']>=0 and visible['right']<visible['pane'],f'1024px에서도 선택 격자 전체가 창 왼쪽에 보임 {visible}')

TESTS += [t_right_dock_and_tail_drag]

def tail_refresh_page(b):
    import copy,json
    p,m=open_page(b)
    d=m.fc_cells[0][2][0]
    J(p,f"(() => {{SSOpenForecast('{d}');return null}})()")
    p.wait_for_function("document.querySelector('#fc-tail table')")
    data=J(p,f'{S}.tailData')
    complete=copy.deepcopy(data['tail']['bins'])
    data['collecting']=True;data['tail']['bins']=complete[:2]
    state={'data':data,'calls':0,'fail':False}
    def reply(route):
        state['calls']+=1
        route.fulfill(status=503 if state['fail'] else 200,content_type='application/json',body=json.dumps(state['data']))
    p.route('**/rpc/forecast_cell_detail',reply)
    p.clock.install()
    p.locator('.fc-detail tbody tr').nth(1).click()
    p.wait_for_function('ForecastUI._state().tailData && ForecastUI._state().tailData.collecting===true')
    return p,state,complete

def t_tail_progressive_refresh(b):
    p,state,complete=tail_refresh_page(b)
    before=p.locator('#fc-tail tbody tr').first.locator('td').count()
    J(p,"document.querySelector('#fc-tail .fc-scroll').scrollLeft=100")
    scroll=J(p,"document.querySelector('#fc-tail .fc-scroll').scrollLeft")
    geo=p.locator('#fc-tail').bounding_box()
    state['data']['tail']['bins']=complete[:3]
    p.clock.fast_forward(180000)
    p.wait_for_function(f"document.querySelectorAll('#fc-tail tbody tr:first-child td').length==={before+1}")
    check(state['calls']==2,'하루치가 아닌 다음 한 칸 도착 시 자동 추가')
    check(p.locator('#fc-pin .fc-tt tbody tr').first.locator('td').count()==48,'윗창 48시간 유지')
    check(J(p,"document.querySelector('#fc-tail .fc-scroll').scrollLeft")==scroll,'자동 추가 뒤 가로 스크롤 유지')
    after=p.locator('#fc-tail').bounding_box()
    check(abs(after['x']-geo['x'])<=1 and abs(after['width']-geo['width'])<=1,'창 위치와 크기 유지')

def t_tail_refresh_visibility(b):
    p,state,complete=tail_refresh_page(b)
    J(p,"Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
    p.clock.fast_forward(180000)
    check(state['calls']==1,'브라우저가 안 보이면 조회 중단')
    J(p,"Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))")
    p.wait_for_function('ForecastUI._state().tailBusy==null')
    check(state['calls']==2,'다시 보이면 밀린 자료 확인')
    J(p,"document.querySelector('#view-forecast').style.display='none'")
    p.clock.fast_forward(180000)
    check(state['calls']==2,'다른 탭으로 이동하면 조회 중단')
    J(p,"document.querySelector('#view-forecast').style.display='';document.dispatchEvent(new Event('visibilitychange'))")
    p.wait_for_function('ForecastUI._state().tailBusy==null')
    check(state['calls']==3,'예보 화면으로 돌아오면 재개')
    p.locator('.fc-tail-x').click();p.locator('.fc-pin-x').click()
    p.clock.fast_forward(600000)
    check(state['calls']==3,'두 창을 모두 닫으면 조회 중단')

def t_tail_refresh_failure_keeps_data(b):
    p,state,complete=tail_refresh_page(b)
    before=p.locator('#fc-tail tbody').inner_text();state['fail']=True
    p.clock.fast_forward(180000)
    p.wait_for_function('ForecastUI._state().tailRetry===true')
    check(p.locator('#fc-tail tbody').inner_text()==before,'갱신 실패 때 기존 준비 자료 유지')
    state['fail']=False;state['data']['tail']['bins']=complete[:3]
    p.clock.fast_forward(180000)
    p.wait_for_function('ForecastUI._state().tailRetry===false')
    check(state['calls']==3,'실패 후 다음 주기에 재시도')

TESTS += [t_tail_progressive_refresh,t_tail_refresh_visibility,t_tail_refresh_failure_keeps_data]

def t_tail_code_cell_arrives(b):
    p,state,complete=tail_refresh_page(b)
    state['data']['tail']['bins']=complete[:5]
    p.clock.fast_forward(180000)
    p.wait_for_function('ForecastUI._state().tailData.tail.bins.length===5')
    before=p.locator('#fc-tail tbody tr').first.locator('td').count()
    state['data']['tail']['bins']=complete[:6]
    p.clock.fast_forward(180000)
    p.wait_for_function(f"document.querySelectorAll('#fc-tail tbody tr:first-child td').length==={before+1}")
    rows=p.locator('#fc-tail tbody tr')
    check(rows.nth(0).locator('td').last.inner_text()=='보통 눈','먼 칸의 눈 강도 표현')
    check(rows.nth(1).locator('td').last.inner_text()=='비','강수 코드2를2mm로 더하지 않음')
    check(rows.nth(2).locator('td').last.inner_text()=='80' and rows.nth(3).locator('td').last.inner_text()=='-2','먼 칸 확률/기온 유지')
    check(p.locator('#fc-tail [title]').count()==0,'마우스설명제거')

TESTS += [t_tail_code_cell_arrives]

def t_weekday_and_hourly_title(b):
    m=SBM.Mock();m.fc_start='2026-11-06T23:00:00+09:00';m.fc_end='2026-11-07T23:00:00+09:00'
    for row in m.branch_forecast:row['detail'].update(start_at=m.fc_start,end_at=m.fc_end)
    p,m=open_page(b,m)
    J(p,f"(() => {{SSOpenForecast('{m.fc_cells[0][2][0]}');return null}})()")
    p.wait_for_function("document.querySelector('#fc-tail table')")
    check(p.locator('.tab-btn[data-tab=forecast]').inner_text()=='기관별 예보','상단 메뉴 이름')
    check(p.locator('#fc-pin .fc-period').inner_text()=='1시간','왼쪽 제목은1시간')
    days=p.locator('#fc-pin thead tr').first.inner_text()
    check('11/6(금)' in days and '11/7(토)' in days,'한국 날짜의 요일과 자정 경계')
    for root in ['#fc-pin','#fc-tail']:
        labels=p.locator(root+' thead tr').first.locator('th:not(.lb)').all_inner_texts()
        check(all(any('('+d+')' in label for d in '일월화수목금토') for label in labels),'두 표의 날짜 뒤 요일')
    check('(금)' in p.locator('#fc-meta').inner_text() and '(토)' in p.locator('#fc-meta').inner_text(),'예보 구간 요일')

TESTS += [t_weekday_and_hourly_title]

def t_daily_desktop(b):
    p,m=open_page(b)
    d=m.fc_cells[0][2][0]
    J(p,f"SSOpenForecast('{d}')")
    p.locator('.fc-detail tbody tr').first.click()
    p.wait_for_selector('#fc-daily table')
    check(all(p.locator('#'+i).is_visible() for i in ['fc-pin','fc-tail','fc-daily']), 'PC 독립3창')
    check(p.locator('#fc-daily thead tr').first.locator('th[colspan="2"]').count()==7,'오늘 포함7일')
    text=p.locator('#fc-daily').inner_text()
    check(p.locator('#fc-daily [title]').count()==0 and p.locator('#fc-daily details').count()==0,'일별마우스설명도모두제거')
    check('0%' in text and '0°' in text,'0 원값 유지')
    p.screenshot(path='../../outputs/97_daily_desktop.png')
    a=p.locator('#fc-tail').bounding_box();z=p.locator('#fc-daily').bounding_box();mb=p.locator('#fmap').bounding_box()
    check(z['y']>=a['y']+a['height'] and abs(z['x']+z['width']-(mb['x']+mb['width']-10))<3,'일별은3시간 아래 오른쪽')
    height=z['height'];h=p.locator('#fc-daily .fc-pin-head').bounding_box()
    p.mouse.move(h['x']+40,h['y']+10);p.mouse.down();p.mouse.move(h['x']+20,h['y']-15,steps=4);p.mouse.up()
    check(abs(p.locator('#fc-daily').bounding_box()['height']-height)<2,'일별 이동 중 높이 유지')
    p.locator('.fc-daily-x').click()
    check(not p.locator('#fc-daily').is_visible() and p.locator('#fc-tail').is_visible(),'일별만 닫기')

def t_daily_phone_tabs(b):
    p,m=open_phone(b);d=m.fc_cells[0][2][0]
    J(p,f"SSOpenForecast('{d}')");p.locator('.fc-detail tbody tr').first.click()
    check(p.locator('#fc-mobile [role=tab]').count()==3,'휴대폰1창3탭')
    check(p.locator('#fc-pin').is_visible() and not p.locator('#fc-tail').is_visible(),'초기1시간 탭')
    p.locator('#fc-tab-daily').click();p.wait_for_selector('#fc-daily table')
    check(not p.locator('#fc-pin').is_visible() and not p.locator('#fc-tail').is_visible() and p.locator('#fc-daily').is_visible(),'일별 탭만 표시')
    check(p.locator('#fc-tab-daily').get_attribute('aria-selected')=='true','선택 탭 접근성')
    p.screenshot(path='../../outputs/97_daily_phone.png')
    p.locator('#fc-tab-daily').press('ArrowLeft')
    check(p.locator('#fc-tail').is_visible(),'키보드 탭 이동')
    p.locator('.fc-mobile-close').click()
    check(not p.locator('#fc-mobile').is_visible(),'하나의 닫기 버튼')

def t_daily_failure_and_late_response(b):
    p,m=open_page(b);d=m.fc_cells[0][2][0]
    p.route('**/rpc/forecast_daily_cell',lambda route:route.fulfill(status=503,content_type='application/json',body='{}'))
    J(p,f"SSOpenForecast('{d}')");p.locator('.fc-detail tbody tr').first.click()
    p.wait_for_selector('[data-daily-retry]')
    check(p.locator('#fc-pin .fc-tt').is_visible() and p.locator('#fc-tail .fc-tt').is_visible(),'일별 실패해도 시간표 유지')
    p.unroute('**/rpc/forecast_daily_cell');p.locator('[data-daily-retry]').click();p.wait_for_selector('#fc-daily table')
    p.set_viewport_size({'width':375,'height':812});p.locator('#fc-tab-daily').click()
    check(p.locator('#fc-daily').is_visible() and not p.locator('#fc-pin').is_visible(),'PC→휴대폰 전환')
    p.set_viewport_size({'width':1400,'height':900})
    check(all(p.locator('#'+i).is_visible() for i in ['fc-pin','fc-tail','fc-daily']),'휴대폰→PC3창 복원')

TESTS += [t_daily_desktop,t_daily_phone_tabs,t_daily_failure_and_late_response]

def t_daily_late_selection(b):
    p,m=open_page(b);d=m.fc_cells[0][2][0]
    J(p,"""(() => {const old=SSAuth.authed;let first=true;SSAuth.authed=function(path,options){if(path.includes('/forecast_daily_cell')&&first){first=false;return new Promise(resolve=>{window.finishOldDaily=resolve;});}return old.apply(this,arguments);};return null;})()""")
    J(p,f"SSOpenForecast('{d}')");p.wait_for_function("typeof window.finishOldDaily==='function'")
    p.locator('.fc-detail tbody tr').nth(1).click();p.wait_for_selector('#fc-daily table')
    J(p,"""finishOldDaily({ok:true,json:{days:[{date:'2026-11-07',periods:[{forecast_at:'2026-11-07T00:00:00+09:00',period_hours:12,pop:99,weather:'old'}]}]}})""")
    p.wait_for_timeout(100)
    check('99%' not in p.locator('#fc-daily').inner_text(),'이전 선택의 늦은 일별 응답 무시')
    p.locator('.fc-daily-x').click();p.locator('.fc-detail tbody tr').nth(1).click();p.wait_for_selector('#fc-daily table')
    check(p.locator('#fc-daily').is_visible(),'같은 격자를 다시 선택하면 일별도 열림')

TESTS += [t_daily_late_selection]

def t_compact_modals_and_wheel(b):
    p,m=open_page(b);d=m.fc_cells[0][2][0]
    J(p,f"SSOpenForecast('{d}')");p.locator('.fc-detail tbody tr').first.click();p.wait_for_selector('#fc-daily table')
    for width,height in [(1400,900),(1280,720),(1024,600),(1024,500)]:
        p.set_viewport_size({'width':width,'height':height});p.wait_for_timeout(200)
        mapbox=p.locator('#fmap').bounding_box();previous=mapbox['y']
        for root in ['#fc-pin','#fc-tail','#fc-daily']:
            r=p.locator(root).bounding_box()
            legend=p.locator('#fc-legend').bounding_box()
            check(r['y']>=previous-1 and r['y']+r['height']<=legend['y']+1,f'{width}x{height} 세창이화면안·범례안가림 {root} {r}')
            previous=r['y']+r['height']
            check(p.locator(root).evaluate('(x)=>x.scrollHeight<=x.clientHeight+1'),'창세로스크롤없음')
            check(p.locator(root+' .fc-pin-head').bounding_box()['x']<p.locator(root+' table').bounding_box()['x'],'제목은표왼쪽')
        check(p.locator('.fc-tt-sum,.fc-daily details').count()==0,'하단설명없음')
    for root in ['#fc-pin','#fc-tail','#fc-daily']:
        p.locator(root+' .fc-pin-head').hover();p.mouse.wheel(0,220);p.wait_for_timeout(100)
        check(p.locator(root+' .fc-scroll').evaluate('(x)=>x.scrollLeft')>0,'창위휠을가로스크롤로변환 '+root)
    p.screenshot(path='../../outputs/98_compact_desktop.png')

def t_centered_mobile_label(b):
    import re
    p,m=open_phone(b);d=m.fc_cells[0][2][0]
    J(p,f"SSOpenForecast('{d}')");p.locator('.fc-detail tbody tr').first.click();p.wait_for_selector('#fc-mobile')
    for tab in ['hourly','three','daily']:
        p.locator('#fc-tab-'+tab).click()
        if tab=='daily':p.wait_for_selector('#fc-daily table')
        r=p.locator('#fc-mobile').bounding_box()
        check(abs(r['y']+r['height']/2-406)<2,'휴대폰창세로중앙')
        check(p.locator('#fc-mobile .fc-pin-head:visible').count()==0,'패널별중복제목없음')
        label=p.locator('.fc-mobile-location').inner_text()
        check(bool(label) and not re.search(r'\d+\s*,\s*\d+',label) and '예보' not in label,'탭옆지명·지사만표시')
    p.locator('.fc-detail tbody tr').nth(1).click()
    check(p.locator('#fc-mobile').is_visible(),'창을닫지않고다른격자선택')
    p.wait_for_timeout(200);p.screenshot(path='../../outputs/98_centered_phone.png')

TESTS += [t_compact_modals_and_wheel,t_centered_mobile_label]

def t_hourly_48_without_hover_notes(b):
    p,m=open_page(b);d=m.fc_cells[0][2][0]
    J(p,"""(() => {const old=SSAuth.authed;SSAuth.authed=function(path,options){return old.apply(this,arguments).then(r=>{if(path.includes('/forecast_cell_detail')&&r.json&&r.json.hourly_tail)r.json.hourly_tail.series.s[1]=null;return r;});};return null;})()""")
    J(p,f"SSOpenForecast('{d}')");p.locator('.fc-detail tbody tr').first.click()
    p.wait_for_function("document.querySelectorAll('#fc-pin thead tr:last-child th:not(.lb)').length===48")
    rows=p.locator('#fc-pin tbody tr')
    check(rows.nth(0).locator('td').nth(24).inner_text()=='1' and rows.nth(0).locator('td').nth(25).inner_text()=='-','추가시간별원값·결측보존')
    check(rows.nth(1).locator('td').nth(24).inner_text()=='2' and rows.nth(3).locator('td').nth(24).inner_text()=='-2','시간별강수기온원값')
    p.wait_for_selector('#fc-daily table')
    for root in ['#fc-pin','#fc-tail','#fc-daily']:
        check(p.locator(root+' [title]').count()==0 and p.locator(root+' svg title').count()==0,'모든모달마우스설명없음 '+root)
        check('정성' not in p.locator(root).inner_text(),'정성예보문구없음 '+root)

TESTS += [t_hourly_48_without_hover_notes]

def t_kma_start_hour(b):
    """2026-11-09: 격자 창의 1시간·3시간 표는 기상청처럼 곧 다가올 시각을 뺌. 매시 30분 전 = 다음 정시부터, 30분부터 = 그다음 정시부터"""
    p, m = open_page(b); p.click(".tab-btn[data-tab=forecast]"); p.wait_for_timeout(600)
    d = bid(p, "대관령"); p.click("#fc-tree [data-fchq='강원']"); p.wait_for_timeout(500); p.click(f"#fc-tree [data-fcbr='{d}']"); p.wait_for_timeout(900)
    p.wait_for_function("document.querySelectorAll('#fc-pin thead tr:last-child th:not(.lb)').length===48")
    hrs = lambda: p.locator('#fc-pin table.fc-t1 thead tr').last.locator('th:not(.lb)').all_inner_texts()
    h10 = hrs(); check(len(h10) == 48, f"매시 10분: 48칸 그대로 {len(h10)}")
    n3a = p.locator('#fc-tail table.fc-three tbody tr').first.locator('td').count()
    p.add_init_script("window.__fcNow = function () { return Date.parse(%s) - 20 * 60000; };" % json.dumps(m.fc_start))      # 시작 20분 전 = 앞 정시의 40분. 나중에 넣은 것이 이김
    p.reload(); p.wait_for_function("window.ForecastUI && ForecastUI._state().inited", timeout=60000)
    p.click(".tab-btn[data-tab=forecast]"); p.wait_for_timeout(600); p.click("#fc-tree [data-fchq='강원']"); p.wait_for_timeout(500); p.click(f"#fc-tree [data-fcbr='{d}']"); p.wait_for_timeout(900)
    p.wait_for_function("document.querySelectorAll('#fc-pin thead tr:last-child th:not(.lb)').length===47")
    h40 = hrs()
    check(len(h40) == 47 and h40[0] == h10[1], f"매시 40분: 첫 시각을 빼고 그다음 정시부터 {h40[:3]} / {h10[:3]}")
    n3b = p.locator('#fc-tail table.fc-three tbody tr').first.locator('td').count()
    first3 = J(p, f"ForecastSeries.combine({S}.tailData, 1)[0].first_at") ; st = J(p, f"{S}.tailData.upper.start_at")
    check(J(p, f"Date.parse('{first3}') - Date.parse('{st}')") == 3600000 and n3b <= n3a, f"3시간 표도 같은 시각부터: {first3} / {st}")
    check(J(p, "ForecastSeries.skipHours('2026-11-09T00:00:00Z', Date.parse('2026-11-08T23:24:00Z'))") == 0 and J(p, "ForecastSeries.skipHours('2026-11-09T00:00:00Z', Date.parse('2026-11-08T23:34:00Z'))") == 1 and J(p, "ForecastSeries.skipHours('2026-11-09T00:00:00Z', Date.parse('2026-11-08T23:50:00Z'))") == 1, "08:24 → 다음 정시부터, 08:34·08:50 → 그다음 정시부터")
TESTS += [t_kma_start_hour]

if __name__ == "__main__":
    only = sys.argv[1:]
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for fn in TESTS:
            if not only or fn.__name__ in only: run(fn.__name__, fn, b)
        b.close()
    ok = sum(1 for _, o, _ in results if o)
    for name, o, msg in results: print(("PASS " if o else "FAIL ") + name + ("" if o else f"  → {msg}"))
    errs = [e for e in errors if "favicon" not in e]
    if errs: print("\n페이지 오류:", *errs[:10], sep="\n  ")
    print(f"\n{ok}/{len(results)} 통과" + ("" if not errs else f", 페이지 오류 {len(errs)}건"))
    sys.exit(0 if ok == len(results) and not errs else 1)
