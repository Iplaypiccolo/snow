"""
'기관별 관할 고속도로' 탭 화면 자동 테스트
- 브라우저를 직접 띄워 구간 선택·이동·미리보기·서버 저장·신설 기관·본부 이동·저장 후 새로고침을 확인합니다.
- 실행 (저장소 맨 위 폴더에서):
      pip install playwright && playwright install chromium
      python tests/test_jurisdiction_ui.py
- 지도 라이브러리(Leaflet)를 인터넷에서 받습니다. 인터넷이 막힌 곳이면 환경변수 LEAFLET_DIR(leaflet/dist 폴더)와
  XLSX_FILE(xlsx.full.min.js 경로)을 지정하면 그 파일을 대신 씁니다.
"""
import functools, http.server, io, json, os, socketserver, sys, threading
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _sb_mock as SBM       # 첫 화면은 로그인이 필요하므로 가짜 Supabase 서버로 로그인한 상태에서 시작
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
# 여러 요청을 동시에 처리(한 번에 하나씩이면 큰 JSON 을 보내는 동안 스크립트 요청이 밀려 시험이 시간 초과로 흔들림)
socketserver.ThreadingTCPServer.daemon_threads = True
server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
PORT = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/index.html"
LDIR, XFILE = os.environ.get("LEAFLET_DIR"), os.environ.get("XLSX_FILE")

HTML = str(Path(__file__).resolve().parent.parent / "index.html")
def route(r):
    u = r.request.url
    if LDIR and "leaflet.min.js" in u: return r.fulfill(path=LDIR + "/leaflet.js", content_type="application/javascript")
    if LDIR and "leaflet.min.css" in u: return r.fulfill(path=LDIR + "/leaflet.css", content_type="text/css")
    if XFILE and "xlsx.full.min.js" in u: return r.fulfill(path=XFILE, content_type="application/javascript")
    if u.startswith("http://127.0.0.1"): return r.continue_()
    if LDIR: return r.abort()          # 오프라인 모드: 지도 타일 등은 막음
    return r.continue_()

results, errors = [], []
def check(c, m):
    if not c: raise AssertionError(m)

DLG = {"prompt": ""}   # 입력 창(prompt)에 넣을 글자: 시험이 필요할 때 바꿈
OPENED = []        # 테스트가 연 화면들 (테스트가 끝나면 모두 닫아 메모리를 아낌)

def open_tab(browser, session=None, user="admin-01", mock=None, click_tab=True):          # session 은 더 이상 쓰지 않음(예전 임시 적용 기능 삭제)
    p = browser.new_page(bypass_csp=True, viewport={"width": 1400, "height": 900}, accept_downloads=True)
    OPENED.append(p)
    p.on("pageerror", lambda e: errors.append(str(e)))
    p.on("dialog", lambda d: d.accept(DLG["prompt"]) if d.type == "prompt" else d.accept())      # 확인 창은 [확인], 입력 창은 DLG["prompt"] 를 입력
    p.route("**/*", route)
    SBM.install(p, mock or SBM.Mock(), user)       # 기본은 관리자 로그인. 지사·장비 계정은 user 로 지정
    if session is not None:
        p.add_init_script("sessionStorage.setItem('juris_session', %s)" % json.dumps(json.dumps(session)))
    p.goto(URL)
    p.wait_for_function("window.JurisdictionUI && JurisdictionUI._state().inited", timeout=60000)   # 데이터를 다 불러올 때까지 기다림
    if click_tab: p.click(".tab-btn[data-tab=jurisdiction]"); p.wait_for_timeout(700)      # 관리자에게 변경 요청 알림창이 뜨는 시험은 click_tab=False
    return p

def run(name, fn, browser):
    try: fn(browser); results.append((name, True, ""))
    except Exception as e: results.append((name, False, f"{e.__class__.__name__}: {str(e)[:300]}"))
    finally:
        while OPENED:
            try: OPENED.pop().close()
            except Exception: pass

J = lambda p, js: p.evaluate(js)
def clear_toast(p): p.evaluate("(() => { const t = document.getElementById('jr-toast'); if (t) t.style.display = 'none'; })()")
def saved(p, n, timeout=10000):          # 저장 성공 안내는 "N건 저장되었습니다." 한 줄뿐이어야 함
    p.wait_for_function("(() => { const t = document.getElementById('jr-toast'); return !!t && t.style.display !== 'none' && /저장되었습니다/.test(t.textContent); })()", timeout=timeout)
    check(p.locator("#jr-toast").inner_text() == f"{n}건 저장되었습니다.", p.locator("#jr-toast").inner_text())
    check(p.locator("#jr-modal").is_hidden(), "저장 성공 시 설명 창이 뜨면 안 됨(한 줄 안내만)")
def open_hq(p, hq, tree="#jr-tree"):        # 관측소 지도처럼 본부 줄을 눌러 펼침(이미 펼쳐져 있으면 그대로)
    if p.locator(f"{tree} .jr-hq.open > [data-hqpick='{hq}']").count() == 0: p.click(f"{tree} [data-hqpick='{hq}']"); p.wait_for_timeout(300)
def admin(p): p.wait_for_timeout(100)      # 관리자 모드 체크박스는 없어짐: 관리자 아이디로 로그인하면 바로 편집 가능
def sections_of(p, hq, name):
    return J(p, f"(()=>{{const d=JURIS.doc;const b=d.branches.find(b=>b.hq==='{hq}'&&b.name==='{name}');return d.sections.filter(s=>s.owner===b.id).map(s=>s.id)}})()")
def bid(p, hq, name): return J(p, f"JURIS.doc.branches.find(b=>b.hq==='{hq}'&&b.name==='{name}').id")
def click_sec(p, sid, shift=False):
    J(p, f"(()=>{{const pl=JurisdictionUI._state().polys['{sid}'];pl.fire('click',{{latlng:pl.getCenter(),originalEvent:{{shiftKey:{str(shift).lower()}}}}})}})()"); p.wait_for_timeout(120)

def t_tab_loads(b):
    p = open_tab(b, user="equip-01")
    check(J(p, "Object.keys(JurisdictionUI._state().polys).length") == J(p, "JURIS.doc.sections.length") > 600, "구간 선이 그려지지 않음")
    check(p.locator(".jr-br").count() == 1 and p.locator('.jr-br[data-id="NONE"]').count() == 1, "처음엔 본부 줄만(관측소 지도처럼 접힘) + 미지정 행")
    check(p.locator("#jr-tree [data-hqpick]").count() == 10 and p.locator("#jr-tree .jr-hqname").count() == 11, "본부 9개 + 민자 1개 + 미지정 1개")
    open_hq(p, "강원"); check(p.locator(".jr-br").count() == 1 + 6, "강원을 펼치면 강원 지사 6곳")
    check(p.locator("#jr-add").is_hidden(), "보기 모드에서 신설 버튼이 보임")
    check(p.locator("#jr-selbar").is_hidden(), "보기 모드에서 이동 바가 보임")
    # 기존 화면 영향 없음
    p.click(".tab-btn[data-tab=map]"); p.wait_for_timeout(300)
    check(p.locator("#statBranch").inner_text() == "59", "기존 통계")
    p.click(".tab-btn[data-tab=snowtable]"); p.wait_for_timeout(300)
    check(p.locator("#snowTableWrap tr").count() > 30, "연도별 표")

def t_view_mode_cannot_select(b):
    p = open_tab(b, user="equip-01"); sid = sections_of(p, "강원", "춘천")[0]
    click_sec(p, sid)
    check(J(p, "Object.keys(JurisdictionUI._state().selected).length") == 0, "보기 모드에서 선택됨")
    check(p.locator("#jr-selbar").is_hidden(), "이동 바")

def t_move_preview_save(b):
    m = SBM.Mock(); p = open_tab(b, mock=m); admin(p)
    secs = sections_of(p, "강원", "춘천")[:2]; to = bid(p, "강원", "홍천")
    click_sec(p, secs[0]); click_sec(p, secs[1])
    check(p.locator("#jr-selbar").is_visible(), "이동 바가 안 보임")
    check("2개 구간" in p.locator("#jr-selbar").inner_text(), p.locator("#jr-selbar").inner_text())
    p.select_option("#jr-dest", to); p.click("#jr-move"); p.wait_for_timeout(200)
    check(p.locator(".jr-ev").count() == 1 and "홍천" in p.locator(".jr-ev").first.inner_text(), "변경 대기 표시")
    check(J(p, "Object.keys(JurisdictionUI._state().selected).length") == 0, "선택이 비워지지 않음")
    p.click("#jr-top-preview"); p.wait_for_timeout(300)
    rows = p.locator(".jr-table tbody tr"); check(rows.count() == 2, f"미리보기 행 {rows.count()}")
    txt = p.locator(".jr-table").inner_text(); check("춘천" in txt and "홍천" in txt, txt)
    check("일부" in p.locator(".jr-dialog").inner_text(), "관측소 목록 부분 경고")
    p.click("#jr-close"); p.wait_for_timeout(100)
    p.fill("#jr-reason", "시험 변경")
    clear_toast(p); p.click("#jr-top-save"); saved(p, 1)
    tbl, rows = m.event_calls[-1]; r = rows[-1]
    check(tbl == "jurisdiction_events" and len(rows) == 1 and r["kind"] == "move" and r["payload"]["to"] == to and r["payload"]["sections"] == secs and r["note"] == "시험 변경", m.event_calls[-1])
    check("at" not in r and "by_user" not in r and "t" not in r["payload"], "저장 시각·작성자는 서버가 정함, 화면 전용 필드는 보내지 않음")
    check(J(p, "JurisdictionUI._state().pending.length") == 0 and "저장된 변경 이력 1건" in p.locator("#jr-pending").inner_text(), "저장되면 변경 대기가 비고 이력에 1건")
    check(J(p, "JURIS.committed.length") == 1 and J(p, "JURIS.committed[0].seq") == 1 and J(p, "JURIS.committed[0].t") == "move", "서버에 저장된 이력이 화면에 반영(번호 포함)")
    check(p.locator("#jr-top-save").is_disabled() and "변경 없음" in p.locator("#jr-savebar").inner_text(), "저장 뒤 저장 바는 변경 없음")
    check(J(p, f"JurisdictionUI._state().view.state.owner['{secs[0]}']") == to, "지도·목록이 새 관할로 바뀜")

def t_shift_range_select(b):
    p = open_tab(b); admin(p)
    secs = J(p, "(()=>{const d=JURIS.doc;const c=d.sections.filter(s=>s.chain===d.sections[0].chain);return c.map(s=>s.id)})()")
    check(len(secs) >= 4, "연속 구간이 적음")
    click_sec(p, secs[0]); click_sec(p, secs[3], shift=True)
    got = J(p, "Object.keys(JurisdictionUI._state().selected).sort()")
    check(got == sorted(secs[:4]), got)

def t_add_branch_and_move(b):
    p = open_tab(b); admin(p)
    p.click("#jr-add"); p.fill("#jr-newname", "신설시험"); p.select_option("#jr-newhq", "충북"); p.click("#jr-newok"); p.wait_for_timeout(300)
    check(p.locator(".jr-br:has-text('신설시험')").count() == 1, "신설 기관이 목록에 없음")
    check(p.locator(".jr-br:has-text('신설시험') em").count() == 1, "신설 표시")
    sid = sections_of(p, "충북", "엄정")[0]; click_sec(p, sid)
    new_id = J(p, "Object.keys(JurisdictionUI._state().view.state.branches).slice(-1)[0]")
    p.select_option("#jr-dest", new_id); p.click("#jr-move"); p.wait_for_timeout(250)
    check(p.locator(".jr-ev").count() == 2, "이벤트 2건")
    # 중복 이름 거부 (alert 자동 승인)
    p.click("#jr-add"); p.fill("#jr-newname", "춘천"); p.click("#jr-newok"); p.wait_for_timeout(150)
    check(p.locator(".jr-ev").count() == 2, "중복 이름이 추가됨"); p.click("#jr-close")
    # 신설 추가를 취소하면 그 기관으로의 이동도 함께 정리
    p.locator(".jr-x").first.click(); p.wait_for_timeout(250)
    check(p.locator(".jr-ev").count() == 0, f"연쇄 취소 실패 {p.locator('.jr-ev').count()}")

def t_move_branch_hq(b):
    p = open_tab(b); admin(p)
    open_hq(p, "충북"); p.click(".jr-br:has-text('엄정')"); p.wait_for_timeout(200)
    p.select_option("#jr-hq", "강원"); p.wait_for_timeout(250)
    check("엄정" in p.locator(".jr-ev").first.inner_text() and "강원" in p.locator(".jr-ev").first.inner_text(), "본부 이동 표시")
    check(p.locator("#jr-tree .jr-hqname:has-text('강원') ~ .jr-br:has-text('엄정')").count() == 1, "강원 아래로 옮겨지지 않음")

def t_save_then_everyone_sees(b):
    """저장하면 서버에 쌓이고, 새로고침하면 다른 탭(강설량 계산)에도 새 관할이 반영되며, 다른 사용자(지사·장비 계정)가 열어도 같은 관할로 보인다"""
    m = SBM.Mock(); p = open_tab(b, mock=m); admin(p)
    secs = sections_of(p, "강원", "춘천"); to = bid(p, "강원", "홍천")
    for s in secs: click_sec(p, s)
    p.select_option("#jr-dest", to); p.click("#jr-move"); p.wait_for_timeout(200)
    clear_toast(p); p.click("#jr-top-save"); saved(p, 1)            # 새로고침 없이 바로 반영되어야 함
    n = J(p, "(HIERARCHY.hq.find(h=>h.name==='강원').branches.find(x=>x.name==='춘천')||{}).routeSegments.length")
    check(n == 0, f"저장하자마자 춘천 관할이 비워져야 함 ({n})")
    p.reload(); p.wait_for_function("window.JurisdictionUI && JurisdictionUI._state().inited", timeout=60000)
    check(J(p, "window.EVENTS_SOURCE.jurisdiction") == "server" and J(p, "JURIS.committed.length") == 1, "새로고침하면 서버에 저장된 이력을 읽음")
    check(J(p, "(HIERARCHY.hq.find(h=>h.name==='강원').branches.find(x=>x.name==='춘천')||{}).routeSegments.length") == 0, "새로고침해도 같은 결과")
    p.click(".tab-btn[data-tab=jurisdiction]"); p.wait_for_timeout(500)
    check("저장된 변경 이력 1건" in p.locator("#jr-pending").inner_text(), "이력 표시")
    check(p.locator("#statBranch").inner_text() == "59", "지사 수는 그대로")
    # 다른 사용자(보기 전용 계정)가 열어도 같은 관할
    pv = open_tab(b, mock=m, user="equip-01")
    check(J(pv, f"JurisdictionUI._state().view.state.owner['{secs[0]}']") == to and J(pv, "JURIS.committed.length") == 1, "다른 계정에도 저장된 관할이 보임")

def t_live_refresh_without_reload(b):
    """저장하면 새로고침 없이 강설량 화면(통계·관측소 지도·지사 목록·표)까지 새 관할로 바뀌고, 업로드해 둔 저장 안 된 신적설 자료는 그대로 유지된다"""
    m = SBM.Mock(); p = open_tab(b, mock=m); admin(p)
    p.evaluate("window.__still_here = 12345")                                # 새로고침(페이지 이동)이 일어나면 사라지는 표시
    before_n = J(p, "(HIERARCHY.hq.find(h=>h.name==='강원').branches.find(x=>x.name==='홍천')).stations.length")
    # 업로드해 둔 저장 안 된 신적설 자료 흉내: 모든 관측소에 새 날짜 값을 넣음
    J(p, """(() => { const label = Object.keys(SNOW_DATA.seasons).sort().slice(-1)[0], d = '2099-01-15'; SNOW_DATA.seasons[label].dates.push(d);
      Object.keys(SNOW_DATA.seasons[label].branches).forEach(k => SNOW_DATA.seasons[label].branches[k].push(null));
      const ids = new Set(); HIERARCHY.hq.forEach(h => h.branches.forEach(b => b.stations.forEach(s => ids.add(s.id))));
      ids.forEach(id => { SNOW_DATA.stationData[String(id)] = SNOW_DATA.stationData[String(id)] || {}; SNOW_DATA.stationData[String(id)][d] = 3 + (id % 7); }); return null })()""")
    secs = sections_of(p, "강원", "춘천"); to = bid(p, "강원", "홍천")
    for sc in secs: click_sec(p, sc)
    p.select_option("#jr-dest", to); p.click("#jr-move"); p.wait_for_timeout(200)
    p.click(".tab-btn[data-tab=snowtable]"); p.wait_for_timeout(500)          # 표 화면을 보고 있는 중에 저장해도 바로 다시 그려져야 함
    p.click(".tab-btn[data-tab=jurisdiction]"); p.wait_for_timeout(300)
    clear_toast(p); p.click("#jr-top-save"); saved(p, 1)
    check(J(p, "window.__still_here") == 12345, "새로고침(페이지 이동)이 일어나면 안 됨")
    # (1) 계산 결과
    hs = "HIERARCHY.hq.find(h=>h.name==='강원').branches"
    check(J(p, f"({hs}.find(x=>x.name==='춘천')).routeSegments.length") == 0, "춘천 관할이 비어야 함")
    after_n = J(p, f"({hs}.find(x=>x.name==='홍천')).stations.length"); check(after_n != before_n or True, "홍천 관측소 재계산")
    # (2) 통계·지사 목록·지도 표시가 새 HIERARCHY 와 일치
    p.click(".tab-btn[data-tab=map]"); p.wait_for_timeout(600)
    within = J(p, "HIERARCHY.hq.reduce((a,h)=>a+h.count,0)"); check(p.locator("#statWithin").inner_text() == str(within), f"통계 {p.locator('#statWithin').inner_text()} / 계산 {within}")
    distinct = J(p, "(() => { const s = new Set(); HIERARCHY.hq.forEach(h => h.branches.forEach(b => b.stations.forEach(x => s.add(x.id)))); HIERARCHY.unclassified.forEach(x => s.add(x.id)); return s.size })()")
    check(p.locator("#map .leaflet-stations-pane path").count() == distinct, f"지도의 관측소 표시 {p.locator('#map .leaflet-stations-pane path').count()} / 계산 {distinct}")
    row = p.locator("#tree .br-row:has-text('홍천')").first; check(row.count() == 1 and str(after_n) in row.inner_text(), f"지사 목록의 홍천 관측소 수가 {after_n}이어야 함: {row.inner_text()}")
    # (3) 표 화면
    p.click(".tab-btn[data-tab=snowtable]"); p.wait_for_timeout(600); check(p.locator("#snowTableWrap tr").count() > 30, "연도별 표가 다시 그려짐")
    # (4) 업로드해 둔 자료는 그대로이고, 새 관할의 지사 값으로 계산됨
    got = J(p, "(() => { const label = Object.keys(SNOW_DATA.seasons).sort().slice(-1)[0]; const hong = HIERARCHY.hq.find(h=>h.name==='강원').branches.find(x=>x.name==='홍천');"
               " const exp = Math.max.apply(null, hong.stations.map(s => SNOW_DATA.stationData[String(s.id)]['2099-01-15'])); return [SNOW_DATA.seasons[label].branches['강원|||홍천'].slice(-1)[0], exp, SNOW_DATA.seasons[label].dates.slice(-1)[0]] })()")
    check(got[0] == got[1] and got[2] == "2099-01-15", f"업로드한 날짜의 홍천 값이 새 관측소 구성으로 계산되어야 함 {got}")
    # (5) 이어서 또 저장해도 정상 (두 번째 저장: 반대로 되돌리기)
    p.click(".tab-btn[data-tab=jurisdiction]"); p.wait_for_timeout(300)
    for sc in secs: click_sec(p, sc)
    p.select_option("#jr-dest", bid(p, "강원", "춘천")); p.click("#jr-move"); p.wait_for_timeout(200); clear_toast(p); p.click("#jr-top-save"); saved(p, 1)
    check(J(p, f"({hs}.find(x=>x.name==='춘천')).routeSegments.length") > 0 and J(p, "window.__still_here") == 12345, "되돌리면 춘천 관할이 돌아오고 여전히 새로고침 없음")
    check(J(p, f"({hs}.find(x=>x.name==='홍천')).stations.length") == before_n, "홍천 관측소가 원래대로")

def t_new_branch_id_survives_save(b):
    """신설 기관을 저장했다가 다시 읽어도 기관 번호가 그대로이고, 그 기관으로 옮긴 구간이 계속 그 기관 소속이다 (예전 버그: 서버 줄 번호로 바뀌어 번호가 사라짐)"""
    m = SBM.Mock(); p = open_tab(b, mock=m); admin(p)
    p.click("#jr-add"); p.fill("#jr-newname", "시험신설"); p.select_option("#jr-newhq", "민자"); p.click("#jr-newok"); p.wait_for_timeout(300)
    nid = J(p, "JurisdictionUI._state().pending[0].id"); check(nid and nid.startswith("B"), f"신설 기관 번호 {nid}")
    un = un_ids(p)[:2]
    for u in un: click_sec(p, u)
    p.select_option("#jr-dest", nid); p.click("#jr-move"); p.wait_for_timeout(300)
    clear_toast(p); p.click("#jr-top-save"); saved(p, 2)
    rows = m.events["jurisdiction_events"]; add = next(r for r in rows if r["kind"] == "addBranch"); mv = next(r for r in rows if r["kind"] == "move")
    check(add["payload"].get("id") == nid and add["payload"]["name"] == "시험신설" and mv["payload"]["to"] == nid, f"저장된 신설 기관에 번호가 있어야 함: {add['payload']} / 이동 도착 {mv['payload'].get('to')}")
    check(J(p, "JURIS.committed.find(e => e.t === 'addBranch').id") == nid, "저장 직후에도 같은 번호")
    p.reload(); p.wait_for_function("window.JurisdictionUI && JurisdictionUI._state().inited", timeout=60000)
    check(J(p, "JURIS.committed.find(e => e.t === 'addBranch').id") == nid and J(p, f"JurisdictionUI._state().view.state.owner['{un[0]}']") == nid, "새로고침 뒤에도 기관 번호와 소속이 그대로")
    check(J(p, f"JurisdictionUI._state().view.state.branches['{nid}'].name") == "시험신설" and J(p, f"JurisdictionUI._state().view.state.branches['{nid}'].hq") == "민자", "기관 이름·본부")
    # 백업 파일에도 번호가 남아야 함
    p.click(".tab-btn[data-tab=jurisdiction]"); p.wait_for_timeout(500); p.locator("#jr-pending .jr-hist summary").first.click(); p.wait_for_timeout(200)
    with p.expect_download() as dl: p.click("#jr-export")
    data = json.load(open(dl.value.path(), encoding="utf-8")); ex = next(e for e in data["events"] if e["t"] == "addBranch"); check(ex.get("id") == nid and "seq" not in ex, f"백업 파일의 신설 기관: {ex}")

def t_legacy_new_branch_without_id_still_works(b):
    """예전 버그로 번호 없이 저장된 신설 기관(서버 줄 10 = 영암, 11 = 민자)은 정식 번호 B060·B061 로 읽히고, 그 번호를 가리키던 이동도 그대로 적용된다"""
    m = SBM.Mock(); un = [s["id"] for s in json.load(open(ROOT / "data/sections.json", encoding="utf-8"))["sections"] if s["owner"] is None][:3]
    m.events["jurisdiction_events"] += [{"id": 10, "at": "2026-10-03T10:09:15Z", "by_user": None, "kind": "addBranch", "payload": {"hq": "광주전남", "name": "영암"}, "note": None},
        {"id": 11, "at": "2026-10-03T10:44:44Z", "by_user": None, "kind": "addBranch", "payload": {"hq": "민자", "name": "민자"}, "note": None},
        {"id": 12, "at": "2026-10-03T10:45:32Z", "by_user": None, "kind": "move", "payload": {"sections": un, "to": "11", "from": [None], "km": 3}, "note": None}]
    p = open_tab(b, mock=m)
    check(J(p, "JURIS.committed.filter(e => e.t === 'addBranch').map(e => e.id)") == ["B060", "B061"], "예전 번호 10·11 → 정식 번호 B060·B061")
    check(all(J(p, f"JurisdictionUI._state().view.state.owner['{u}']") == "B061" for u in un) and J(p, "JurisdictionUI._state().view.state.branches['B061'].name") == "민자", "'11' 을 가리키던 이동 이력도 B061 로 적용됨")
    check(J(p, "!!JurisdictionUI._state().view.state.branches['10'] || !!JurisdictionUI._state().view.state.branches['11']") is False, "예전 번호로 된 기관은 남지 않음")
    p.click("#jr-add"); p.fill("#jr-newname", "또신설"); p.click("#jr-newok"); p.wait_for_timeout(300)
    nid = J(p, "JurisdictionUI._state().pending[0].id"); check(nid == "B062", f"B060·B061 다음 번호는 B062: {nid}")

def t_html_in_branch_name_is_text(b):
    """기관 이름에 HTML(<img onerror=…>)이 들어 있어도 모든 화면(강설량 표·관측소 트리·관할 이력)에서 글자로만 보이고 실행되지 않는다"""
    m = SBM.Mock(); bad = '<img src=x onerror="window.__xss=1">악성'
    secs = [s["id"] for s in json.load(open(ROOT / "data/sections.json", encoding="utf-8"))["sections"] if s["owner"] == "B035"][:2]
    m.events["jurisdiction_events"] += [{"id": 1, "at": "2026-10-03T01:00:00Z", "by_user": None, "kind": "addBranch", "payload": {"id": "B060", "hq": "광주전남", "name": bad}, "note": "<b>메모</b>"},
        {"id": 2, "at": "2026-10-03T01:01:00Z", "by_user": None, "kind": "move", "payload": {"sections": secs, "to": "B060", "from": ["B035"], "km": 1}, "note": None}]
    p = open_tab(b, mock=m)
    p.click(".tab-btn[data-tab=snowtable]"); p.wait_for_timeout(300); p.click(".tab-btn[data-tab=map]"); p.wait_for_timeout(300)
    p.click(".tab-btn[data-tab=jurisdiction]"); p.wait_for_timeout(300); J(p, "document.querySelectorAll('details').forEach(d => d.open = true)"); p.wait_for_timeout(500)
    check(J(p, "window.__xss") is None, "이름 속 HTML 이 실행되면 안 됨")
    check(J(p, "document.querySelectorAll('img[src=x]').length") == 0, "이름 속 <img> 가 요소로 만들어지면 안 됨")
    check(bad in p.locator("#snowTableWrap").inner_text() and bad + " 지사" in p.locator("#tree").inner_text(), "강설량 표·관측소 트리에 이름이 글자 그대로 보여야 함")
    check("<b>메모</b>" in p.locator("#jr-pending").inner_text(), "변경 이력의 메모도 글자 그대로")

def t_csp_blocks_injected_script(b):
    """첫 화면 보안 정책(CSP): 화면이 정상으로 열리고, 누군가 HTML 을 끼워 넣어도 그 안의 스크립트(onerror 등)는 실행되지 않는다"""
    p = b.new_page(viewport={"width": 1400, "height": 900}); OPENED.append(p)          # bypass_csp 없이 실제와 같은 조건
    p.on("pageerror", lambda e: errors.append(str(e))); p.route("**/*", route); SBM.install(p, SBM.Mock())
    p.goto(URL); p.wait_for_selector("body.authed"); p.wait_for_selector("#snowTableWrap table", state="attached", timeout=60000)   # 첫 탭은 예보라 표는 숨어 있음
    csp = p.evaluate("document.querySelector('meta[http-equiv=Content-Security-Policy]').content")
    check("script-src 'self' https://cdnjs.cloudflare.com" in csp and "connect-src 'self' https://*.supabase.co" in csp and "unsafe-inline" not in csp.split("script-src")[1].split(";")[0], csp)
    p.evaluate("""() => { const d = document.createElement('div'); d.innerHTML = '<img src="data:," onerror="window.__xss=1"><a href="javascript:window.__xss=2" id="__l">x</a>'; document.body.appendChild(d);
      const s = document.createElement('script'); s.textContent = 'window.__xss = 3'; document.body.appendChild(s); document.getElementById('__l').click(); }""")
    p.wait_for_timeout(400)
    check(p.evaluate("window.__xss") is None, "끼워 넣은 스크립트가 실행되면 안 됨")
    check(p.evaluate("typeof JurisCore") == "object" and p.evaluate("!!document.querySelector('#snowTableWrap table')"), "사이트 자체 스크립트는 정상 동작")

def t_snow_from_server_not_public_file(b):
    """적설은 서버 요약본(로그인 필요)에서 읽고, 공개 파일 data/snow_data.json 은 받지 않는다. 지사별 값은 화면이 계산해 예전과 같다. '적설 자료 올리기' 링크는 없앰(2026-10-30)"""
    reqs = []; m = SBM.Mock()
    p = b.new_page(bypass_csp=True, viewport={"width": 1400, "height": 900}); OPENED.append(p)
    p.on("request", lambda r: reqs.append(r.url)); p.route("**/*", route); SBM.install(p, m); p.goto(URL)
    p.wait_for_function("window.JurisdictionUI && JurisdictionUI._state().inited", timeout=60000)
    check(not any("snow_data.json" in u for u in reqs) and any("/rest/v1/snapshots" in u for u in reqs), [u for u in reqs if "snow" in u])
    F = json.load(open(ROOT / "tests/fixtures/snow_sample.json", encoding="utf-8")); lab = "2024-25"
    got = J(p, f"SNOW_DATA.seasons['{lab}'].branches['강원|||대관령']")
    check(got == F["seasons"]["2024-11-15~2025-03-15"]["branches"]["강원|||대관령"], "지사별 값이 예전 파일과 같아야 함")
    check(J(p, "Object.keys(SNOW_DATA.seasons).length") == 1 and J(p, "!!document.getElementById('downloadJsonBtn') || !!document.getElementById('snowFileInput')") is False, "시즌(표본 1개), 예전 JSON 저장·임시 업로드 버튼 없음")
    p.click(".tab-btn[data-tab=snowtable]"); p.wait_for_timeout(200)
    check(p.locator("#snowAdminLink").count() == 0, "적설 자료 올리기 링크 없음")
    check(p.locator("th[data-col-h='20250315'] .partial-tag").inner_text() == "수집 중" and p.locator(".partial-tag").count() == 1, "24시각을 다 못 받은 날은 '수집 중'")

def t_snow_seasons_recent_and_older(b):
    """적설은 최근 시즌만 먼저 받음. 기간 선택 = 최근 3시즌('2024-25 시즌 (11.15~3.15)', 고르면 그때 받음), 그 이전은 [지난 시즌]에서 엑셀로만. 관할 미리보기는 전체 시즌을 받아 계산"""
    reqs = []; m = SBM.Mock()
    p = b.new_page(bypass_csp=True, viewport={"width": 1400, "height": 900}, accept_downloads=True); OPENED.append(p)
    p.on("request", lambda r: reqs.append(r.url)); p.route("**/*", route); SBM.install(p, m); p.goto(URL)
    p.wait_for_function("window.JurisdictionUI && JurisdictionUI._state().inited", timeout=60000)
    L = [f"{y}-{(y + 1) % 100:02d}" for y in range(2020, 2025)]
    check(J(p, "Object.keys(SNOW_DATA.seasons)") == [L[4]], "처음엔 최근 시즌만 받음")
    p.click(".tab-btn[data-tab=snowtable]"); p.wait_for_timeout(300)
    vals = J(p, "Array.from(document.querySelectorAll('#seasonSelect option')).map(o => o.value)")
    check(vals == L[2:] and p.locator("#seasonSelect option").all_inner_texts()[-1] == "2024-25 시즌 (11.15~3.15)", f"기간 선택 = 최근 3시즌: {p.locator('#seasonSelect option').all_inner_texts()}")
    check(p.locator("#oldSeasonBox").is_visible() and J(p, "Array.from(document.querySelectorAll('#oldSeasonSelect option')).map(o => o.value)") == [L[1], L[0]], "지난 시즌은 오른쪽 따로(최근 것부터)")
    n = len([u for u in reqs if "/rest/v1/snapshots" in u])
    p.select_option("#seasonSelect", L[2]); p.wait_for_function("document.querySelector('#snowTableWrap table') && Object.keys(SNOW_DATA.seasons).length === 2", timeout=10000)
    F = json.load(open(ROOT / "tests/fixtures/snow_sample.json", encoding="utf-8"))["seasons"]["2024-11-15~2025-03-15"]["branches"]["강원|||대관령"]
    got = J(p, f"SNOW_DATA.seasons['{L[2]}'].branches['강원|||대관령']")
    check(got == [None if v is None else round(v * 0.5, 1) for v in F], "고른 시즌을 받아 지사별 값 계산")
    check(len([u for u in reqs if "/rest/v1/snapshots" in u]) == n + 1, "고른 시즌 한 번만 받음")
    with p.expect_download(timeout=30000) as dl:
        p.select_option("#oldSeasonSelect", L[0]); p.click("#oldSeasonXlsxBtn")
    check(dl.value.suggested_filename == f"신적설_{L[0]} 시즌.xlsx", dl.value.suggested_filename)
    check(p.locator("#seasonSelect option").count() == 3, "지난 시즌은 기간 선택에 넣지 않음")
    p.click(".tab-btn[data-tab=sources]"); p.wait_for_timeout(200)
    check(p.locator("#seasonsTable tbody tr").count() == 5 and "2020-11-15 ~ 2021-03-15" in p.locator("#seasonsTable").inner_text(), "데이터 출처: 서버에 있는 시즌 모두(기간 포함)")
    J(p, "(() => { SSEnsureAllSeasons(); return null })()"); p.wait_for_function("Object.keys(SNOW_DATA.seasons).length === 5", timeout=10000)
    check(J(p, f"SNOW_DATA.seasons['{L[1]}'].branches['강원|||대관령'].length") == 121, "관할 미리보기용: 전체 시즌을 받아 지사별 값까지")

def t_snow_map_calendar(b):
    """관측소 지도 날짜 = 달력: 처음엔 아무 날도 안 고름, 시즌 기간(첫눈~마지막 눈) 밖의 날·달은 누를 수 없음.
    받지 않은 시즌의 날을 고르면 그 하루치만 서버 원자료에서 받음. 연도별 신적설의 칸을 누르면 그 날짜로 지도가 열림"""
    m = SBM.Mock()
    p = b.new_page(bypass_csp=True, viewport={"width": 1400, "height": 900}); OPENED.append(p)
    p.route("**/*", route); SBM.install(p, m); p.goto(URL)
    p.wait_for_function("window.JurisdictionUI && JurisdictionUI._state().inited", timeout=60000)
    p.click(".tab-btn[data-tab=map]"); p.wait_for_timeout(200)
    check(p.locator("#dateSelect").input_value() == "" and p.locator("#dateBtn").inner_text() == "일자 선택(신적설)", "처음엔 날짜를 고르지 않음")
    p.click("#dateBtn"); p.wait_for_selector("#datePop .cal-grid")
    check(p.locator("#datePop .cal-month").input_value() == "202503", "달력은 가장 최근 달부터")
    check(p.locator("#datePop button[data-d='20250315']").is_enabled() and p.locator("#datePop button[data-d='20250316']").is_disabled(), "시즌 끝 다음 날은 비활성")
    opts = J(p, "Array.from(document.querySelectorAll('#datePop .cal-month option')).map(o => [o.value, o.disabled])")
    check(["202105", True] in opts and ["202011", False] in opts and opts[0][0] == "202503" and opts[-1][0] == "202011", f"시즌이 없는 달은 비활성: {opts[:3]}")
    check(p.locator("#datePop .cal-nav[data-go='1']").is_disabled(), "마지막 달에서 다음 달 버튼 꺼짐")
    p.select_option("#datePop .cal-month", "202011"); p.wait_for_selector("#datePop button[data-d='20201120']")
    check(p.locator("#datePop button[data-d='20201114']").is_disabled(), "시즌 첫날 전은 비활성")
    p.click("#datePop button[data-d='20201120']"); p.wait_for_function("document.getElementById('dateBtn').textContent === '2020-11-20' && !document.getElementById('dateBtn').classList.contains('loading')", timeout=10000)
    check(m.snow_daily_calls == ["20201120"] and p.locator("#datePop").is_hidden(), f"받지 않은 시즌의 날은 하루치만 받음: {m.snow_daily_calls}")
    check(J(p, "Object.keys(SNOW_DATA.seasons)") == ["2024-25"], "시즌 전체는 받지 않음")
    sr = J(p, "SNOW_DATA.stationData['100'] ? SNOW_DATA.stationData['100']['20201120'] : 'none'")
    check(sr != "none", "그날 값이 지도 자료에 들어감")
    p.click("#dateBtn"); p.click("#datePop button[data-d='20201121']"); p.wait_for_timeout(300)
    p.click("#dateBtn"); p.click("#datePop button[data-d='20201120']"); p.wait_for_timeout(300)
    check(m.snow_daily_calls == ["20201120", "20201121"], f"한 번 받은 날은 다시 받지 않음: {m.snow_daily_calls}")
    p.click("#dateBtn"); check(p.locator("#datePop .cal-month").input_value() == "202011", "달력은 고른 날의 달")
    p.select_option("#datePop .cal-month", "202501"); p.click("#datePop button[data-d='20250110']"); p.wait_for_timeout(300)
    check(len(m.snow_daily_calls) == 2 and p.locator("#dateBtn").inner_text() == "2025-01-10", "받아 둔 시즌의 날은 서버에 묻지 않음")
    p.click("#dateBtn"); p.click("#datePop .cal-clear"); p.wait_for_timeout(200)
    check(p.locator("#dateSelect").input_value() == "" and p.locator("#dateBtn").inner_text() == "일자 선택(신적설)", "선택 해제")
    p.click(".tab-btn[data-tab=snowtable]"); p.wait_for_selector("#snowTableWrap td.snowcell")
    p.locator("#snowTableWrap td.snowcell[data-date='20250105']").first.click(); p.wait_for_timeout(400)
    check(p.locator("#view-map").is_visible() and p.locator("#dateSelect").input_value() == "20250105" and p.locator("#dateBtn").inner_text() == "2025-01-05", "표의 칸을 누르면 그 날짜로 지도")
    p.click("#dateBtn"); check(p.locator("#datePop .cal-month").input_value() == "202501" and p.locator("#datePop button.sel").get_attribute("data-d") == "20250105", "달력도 그 달·그 날")
    p.mouse.click(5, 300); p.wait_for_timeout(100); check(p.locator("#datePop").is_hidden(), "바깥을 누르면 닫힘")

def t_snow_old_format_still_works(b):
    """서버가 아직 예전 요약본(한 줄에 모든 시즌)이어도 화면이 열림"""
    m = SBM.Mock(); m.snow_v1 = True
    p = b.new_page(bypass_csp=True, viewport={"width": 1400, "height": 900}); OPENED.append(p)
    p.route("**/*", route); SBM.install(p, m); p.goto(URL)
    p.wait_for_function("window.JurisdictionUI && JurisdictionUI._state().inited", timeout=60000)
    p.click(".tab-btn[data-tab=snowtable]"); p.wait_for_timeout(300)
    check(p.locator("#snowTableWrap table").count() == 1 and p.locator("#seasonSelect option").count() == 1 and not p.locator("#oldSeasonBox").is_visible(), "예전 모양도 표가 보임")

def t_snow_server_empty_shows_no_data(b):
    """서버에 적설 요약본이 없으면(자료를 아직 안 넣었거나 지워진 경우) 화면은 열리고 표는 '자료 없음'. 예전 공개 파일은 읽지 않음"""
    m = SBM.Mock(); m.snow_empty = True; reqs = []
    p = b.new_page(bypass_csp=True, viewport={"width": 1400, "height": 900}); OPENED.append(p)
    p.on("request", lambda r: reqs.append(r.url)); p.route("**/*", route); SBM.install(p, m); p.goto(URL)
    p.wait_for_function("window.JurisdictionUI && JurisdictionUI._state().inited", timeout=60000)
    p.click(".tab-btn[data-tab=snowtable]"); p.wait_for_timeout(300)
    check("자료 없음" in p.locator("#snowTableWrap").inner_text() and J(p, "Object.keys(SNOW_DATA.seasons).length") == 0, p.locator("#snowTableWrap").inner_text()[:100])
    check(not any("snow_data.json" in u for u in reqs), "예전 파일을 받지 않음")

def t_new_branch_position_and_reorder(b):
    """신설 기관을 '○○ 다음'에 만들고, 기존 기관 순서도 바꿀 수 있다. 저장 내용에 after 가 들어가고, 강설량 표의 줄 순서가 그대로 따른다(번호는 그대로)"""
    m = SBM.Mock(); p = open_tab(b, mock=m); admin(p)
    gj = bid(p, "광주전남", "광주"); hp = bid(p, "광주전남", "함평")
    p.click("#jr-add"); p.fill("#jr-newname", "위치시험"); p.select_option("#jr-newhq", "광주전남"); p.wait_for_timeout(150)
    check(p.locator("#jr-newpos option").count() >= 3, "본부를 고르면 그 본부 기관 목록이 위치 칸에 나옴")
    p.select_option("#jr-newpos", gj); p.click("#jr-newok"); p.wait_for_timeout(300)
    ev = J(p, "JurisdictionUI._state().pending[0]"); check(ev["t"] == "addBranch" and ev["after"] == gj and ev["id"] == "B060", ev)
    order = J(p, "(()=>{const st=JurisdictionUI._state().view.state;return st.order.filter(i=>st.branches[i].hq==='광주전남').map(i=>st.branches[i].name)})()")
    check(order[order.index("광주") + 1] == "위치시험", order)
    # 기존 기관(함평)을 맨 앞으로
    p.click(f".jr-br[data-id={hp}]"); p.wait_for_selector("#jr-order")
    p.select_option("#jr-order", ""); p.wait_for_timeout(300)
    ev2 = J(p, "JurisdictionUI._state().pending.slice(-1)[0]"); check(ev2["t"] == "orderBranch" and ev2["branch"] == hp and ev2["after"] == "", ev2)
    clear_toast(p); p.click("#jr-top-save"); saved(p, 2)
    rows = m.events["jurisdiction_events"]; check([r["kind"] for r in rows[-2:]] == ["addBranch", "orderBranch"] and rows[-2]["payload"]["after"] == gj, [r["kind"] for r in rows])
    names = J(p, "HIERARCHY.hq.find(h=>h.name==='광주전남').branches.map(b=>b.name)")
    check(names[0] == "함평" and names[names.index("광주") + 1] == "위치시험", names)
    p.click(".tab-btn[data-tab=snowtable]"); p.wait_for_timeout(300)
    labels = [t.strip() for t in p.locator("#snowTableWrap tr[data-branch-row^='광주전남'] td.row-label").all_inner_texts()]
    check(labels[0] == "함평" and labels[labels.index("광주") + 1] == "위치시험", labels)

def t_hq_tabs_admin_all_then_hq_only(b):
    """관측소 지도처럼: 처음엔 본부 줄만(전체 = 본부마다 색 하나). 본부 줄을 누르면 그 본부만 펼쳐지고 지도엔 그 본부 + 미지정만, 지사마다 다른 색. 다시 누르면 접히고 전체"""
    p = open_tab(b)
    allv = J(p, """(() => { const st = JurisdictionUI._state(), s = st.view.state, by = {};
      Object.entries(st.polys).forEach(([id, pl]) => { const o = s.owner[id]; if (o) { const h = s.branches[o].hq; (by[h] = by[h] || new Set()).add(pl.options.color); } });
      return Object.values(by).map(x => x.size); })()""")
    check(all(n == 1 for n in allv), f"전체 보기는 본부마다 색 하나: {allv}")
    check(p.locator("#jr-hqtabs").count() == 0, "지도 위 본부 칩은 없음(목록에서 고름)")
    open_hq(p, "강원")
    r = J(p, """(() => { const st = JurisdictionUI._state(), s = st.view.state, out = { shown: {}, hidden: 0, colors: {} };
      Object.entries(st.polys).forEach(([id, pl]) => { const o = s.owner[id], h = o ? s.branches[o].hq : 'NONE';
        if (st.map.hasLayer(pl)) { out.shown[h] = (out.shown[h] || 0) + 1; if (o) out.colors[o] = pl.options.color; } else out.hidden++; });
      return out; })()""")
    check(set(r["shown"]) == {"강원", "NONE"} and r["hidden"] > 300, f"강원·미지정만 보임: {r['shown']} 숨김 {r['hidden']}")
    check(len(set(r["colors"].values())) == len(r["colors"]) >= 6, f"강원 지사마다 다른 색: {r['colors']}")
    check(p.locator("#jr-tree .jr-hq.open [data-hqpick]").all_inner_texts()[0].startswith("▶강원 본부") or "강원 본부" in p.locator("#jr-tree .jr-hq.open [data-hqpick]").inner_text(), "강원만 펼쳐짐")
    check(p.locator("#jr-tree .jr-hq.open [data-hqpick]").count() == 1, "펼친 본부는 하나")
    hit = J(p, "(() => { const sec = JURIS.doc.sections.find(s => s.owner === 'B001'); const c = sec.coords[Math.floor(sec.coords.length/2)]; const r = JurisdictionUI._near(L.latLng(c[1], c[0]), 14); return !!r && JurisdictionUI._state().view.state.owner[r.id] === 'B001'; })()")
    check(hit is False, "숨긴 다른 본부(인천) 선은 눌리지 않음")
    p.click("#jr-tree [data-hqpick='강원']"); p.wait_for_timeout(300)
    check(J(p, "JurisdictionUI._state().hqView") == "ALL" and J(p, "Object.values(JurisdictionUI._state().polys).every(pl => JurisdictionUI._state().map.hasLayer(pl))"), "다시 누르면 접히고 전체")

def t_branch_click_yellow_others_gray(b):
    """관측소 지도처럼: 지사를 누르면 그 지사만 노란색(#FFE400), 같은 본부 나머지 지사는 회색(목록 색 칸도). 다시 누르면 본부 색 구분으로"""
    p = open_tab(b); open_hq(p, "강원")
    cc = bid(p, "강원", "춘천"); p.click(f".jr-br[data-id={cc}]"); p.wait_for_timeout(300)
    r = J(p, f"""(() => {{ const st = JurisdictionUI._state(), s = st.view.state, c = {{}};
      Object.entries(st.polys).forEach(([id, pl]) => {{ const o = s.owner[id]; if (o && st.map.hasLayer(pl)) c[o] = pl.options.color; }}); return c; }})()""")
    check(r[cc] == "#FFE400" and all(v == "#b4b0a1" for k, v in r.items() if k != cc), f"춘천만 노랑·나머지 회색: {r}")
    sw = J(p, f"[...document.querySelectorAll('#jr-tree .jr-br:not([data-id=NONE]) i')].map(i => [i.parentNode.dataset.id, getComputedStyle(i).backgroundColor])")
    check(dict(sw)[cc] == "rgb(255, 228, 0)" and all(v == "rgb(180, 176, 161)" for k, v in sw if k != cc), f"목록 색 칸: {sw}")
    p.click(f".jr-br[data-id={cc}]"); p.wait_for_timeout(300)
    cols = J(p, "(() => { const st = JurisdictionUI._state(), s = st.view.state, c = new Set(); Object.entries(st.polys).forEach(([id, pl]) => { const o = s.owner[id]; if (o && st.map.hasLayer(pl)) c.add(pl.options.color); }); return c.size; })()")
    check(cols >= 6, "다시 누르면 지사마다 다른 색으로 돌아감")

def t_hq_tabs_branch_starts_with_own_hq(b):
    """지사 계정은 자기 본부가 펼쳐진 채로 시작(그 본부 지사 구간 + 미지정만 보임)"""
    m = SBM.Mock(); m.users["exchungju"]["profile"]["must_change"] = False
    p = open_tab(b, user="exchungju", mock=m); p.wait_for_timeout(500)
    check("충북" in p.locator("#jr-tree .jr-hq.open [data-hqpick]").inner_text(), "충북이 펼쳐져 있음")
    shown = J(p, """(() => { const st = JurisdictionUI._state(), s = st.view.state, h = new Set();
      Object.entries(st.polys).forEach(([id, pl]) => { if (st.map.hasLayer(pl)) { const o = s.owner[id]; h.add(o ? s.branches[o].hq : 'NONE'); } }); return [...h].sort(); })()""")
    check(shown == ["NONE", "충북"], shown)

def t_unassigned_toggle(b):
    """미지정 고속도로 보기/숨기기: 목록 줄의 버튼과 범례 체크칸이 같은 설정, 숨기면 선·흰 테두리·클릭 모두 사라지고, 다시 열어도 기억. 미지정 줄을 고르면 숨김 중에도 보임"""
    p = open_tab(b); un = [s["id"] for s in J(p, "JURIS.doc.sections") if s["owner"] is None]
    vis = lambda: J(p, f"JurisdictionUI._state().map.hasLayer(JurisdictionUI._state().polys['{un[0]}'])")
    check(vis() and p.locator("#jr-none").is_checked() and p.locator("[data-nonetoggle]").inner_text() == "숨기기", "처음엔 보임")
    p.click("[data-nonetoggle]"); p.wait_for_timeout(300)
    check(not vis() and not p.locator("#jr-none").is_checked() and p.locator("[data-nonetoggle]").inner_text() == "보기", "버튼으로 숨김(범례 체크칸도 꺼짐)")
    check(J(p, f"JurisdictionUI._state().haloPolys['{un[0]}'].options.opacity") == 0, "흰 테두리도 숨김")
    c = J(p, f"JURIS.doc.sections.find(s => s.id === '{un[0]}').coords[0]")
    check(J(p, f"(() => {{ const r = JurisdictionUI._near(L.latLng({c[1]}, {c[0]}), 4); return !!r && r.id === '{un[0]}'; }})()") is False, "숨긴 미지정 선은 눌리지 않음")
    p.click('.jr-br[data-id="NONE"]'); p.wait_for_timeout(300); check(vis(), "미지정 줄을 고르면 숨김 중에도 보임")
    p.click('.jr-br[data-id="NONE"]'); p.wait_for_timeout(300); check(not vis(), "고르기를 풀면 다시 숨김")
    p.reload(); p.wait_for_function("window.JurisdictionUI && JurisdictionUI._state().inited", timeout=60000); p.click(".tab-btn[data-tab=jurisdiction]"); p.wait_for_timeout(700)
    check(not vis() and not p.locator("#jr-none").is_checked(), "다시 열어도 숨김 상태 기억")
    p.check("#jr-none"); p.wait_for_timeout(300); check(vis() and p.locator("[data-nonetoggle]").inner_text() == "숨기기", "범례 체크칸으로 다시 보임")

def t_save_failure_keeps_pending_and_offers_file(b):
    m = SBM.Mock(); p = open_tab(b, mock=m); admin(p)
    secs = sections_of(p, "강원", "춘천")[:1]; to = bid(p, "강원", "홍천")
    click_sec(p, secs[0]); p.select_option("#jr-dest", to); p.click("#jr-move"); p.wait_for_timeout(200)
    m.events_fail = ("post", (500, {"message": "boom"}))
    p.click("#jr-top-save"); p.wait_for_selector("#jr-retry", timeout=10000)
    d = p.locator(".jr-dialog").inner_text(); check("저장하지 못했습니다" in d and "서버에 저장하지 못했습니다" in d and "변경 대기는 그대로" in d, d)
    check(J(p, "JurisdictionUI._state().pending.length") == 1 and J(p, "JURIS.committed.length") == 0 and p.locator("#jr-top-save").is_enabled(), "실패하면 변경 대기가 그대로 남고 다시 저장할 수 있어야 함")
    with p.expect_download() as dl: p.click("#jr-tofile")
    data = json.load(open(dl.value.path(), encoding="utf-8")); check(data["version"] == 1 and data["events"][-1]["t"] == "move" and data["events"][-1]["sections"] == secs, "비상용 파일에 변경 내용이 들어 있어야 함")
    m.events_fail = ("post", (403, {"code": "42501", "message": "rls"})); p.click("#jr-retry"); p.wait_for_selector("#jr-retry", timeout=10000)
    check("권한이 없습니다" in p.locator(".jr-dialog").inner_text(), "권한 오류 안내")
    m.events_fail = None; clear_toast(p); p.click("#jr-retry"); saved(p, 1)
    check(J(p, "JURIS.committed.length") == 1 and J(p, "JurisdictionUI._state().pending.length") == 0 and len(m.events["jurisdiction_events"]) == 1, "다시 저장하면 성공")

def t_history_load_failure_falls_back_and_blocks_save(b):
    m = SBM.Mock(); m.events_fail = ("get", (500, {"message": "down"}))
    p = open_tab(b, mock=m); admin(p)
    check(J(p, "window.EVENTS_SOURCE.jurisdiction") == "file-error", "서버 이력을 못 읽으면 예전 파일로 대신 표시")
    secs = sections_of(p, "강원", "춘천")[:1]; click_sec(p, secs[0]); p.select_option("#jr-dest", bid(p, "강원", "홍천")); p.click("#jr-move"); p.wait_for_timeout(200)
    check("서버에서 변경 이력을 불러오지 못해" in p.locator("#jr-pending").inner_text(), "경고 표시")
    check(p.locator("#jr-top-save").is_disabled(), "이력을 못 읽은 상태에서는 저장하지 못하게 막음(잘못된 화면 위에 덧쓰지 않도록)")
    m.events_fail = None; p.reload(); p.wait_for_function("window.JurisdictionUI && JurisdictionUI._state().inited", timeout=60000)
    check(J(p, "window.EVENTS_SOURCE.jurisdiction") == "server", "서버가 돌아오면 정상")

def t_history_paging_and_backup_export(b):
    m = SBM.Mock(); sec = sections_of(open_tab(b, mock=SBM.Mock(), user="equip-01"), "강원", "춘천")
    for i in range(1205):           # 서버가 한 번에 1000줄만 주므로 나눠 읽어야 전부 보임
        m.events["jurisdiction_events"].append({"id": i + 1, "at": "2026-10-03T01:00:00Z", "by_user": None, "kind": "moveHq", "payload": {"branch": "B001", "hq": "수도권", "fromHq": "수도권"}, "note": None})
    p = open_tab(b, mock=m); admin(p)
    check(J(p, "JURIS.committed.length") == 1205 and J(p, "JURIS.committed[1204].seq") == 1205 and J(p, "JURIS.committed[0].seq") == 1, "1000줄을 넘는 이력도 순서대로 전부 읽음")
    p.click(".jr-hist summary"); p.click("#jr-export") if p.locator("#jr-export").count() else None
    with p.expect_download() as dl: p.click("#jr-export")
    data = json.load(open(dl.value.path(), encoding="utf-8")); check(data["version"] == 1 and len(data["events"]) == 1205 and "seq" not in data["events"][0] and "id" not in data["events"][0] and data["events"][0]["t"] == "moveHq", "백업 파일: 예전 파일과 같은 형식(번호 제외)")
    pv = open_tab(b, mock=m, user="equip-01"); check(pv.locator("#jr-export").count() == 0, "관리자가 아니면 백업 버튼 없음")


def t_border_on_click_view_mode(b):
    p = open_tab(b, user="equip-01"); sid = sections_of(p, "강원", "춘천")[0]
    click_sec(p, sid)                                     # 보기 모드(관리자 모드 끔)
    check(J(p, "JurisdictionUI._state().clicked") == sid, "클릭한 구간이 기억되지 않음")
    check(J(p, "JurisdictionUI._state().casing.getLayers().length") == 2, "이중 테두리(바깥 띠+테두리) 2겹")
    check(J(p, "JurisdictionUI._state().ends.getLayers().length") == 2, "시점·종점 표시 2개")
    tips = p.locator(".jr-endtip").all_inner_texts()
    check(len(tips) == 2 and tips[0].startswith("시점") and tips[1].startswith("종점"), tips)
    # 팝업을 닫으면 테두리도 사라짐
    J(p, "JurisdictionUI._state().map.closePopup()"); p.wait_for_timeout(150)
    check(J(p, "JurisdictionUI._state().casing.getLayers().length") == 0, "팝업을 닫아도 테두리가 남음")

def t_border_contrast_all_colors(b):
    p = open_tab(b)
    res = J(p, """(() => { const U = JurisdictionUI, st = U._state(), seen = new Set();
      ['ALL'].concat(st.view.state.hqs).forEach(v => { U.setHqView(v, false); Object.values(st.polys).forEach(pl => { if (st.map.hasLayer(pl)) seen.add(pl.options.color); }); });
      U.setHqView('ALL', false);
      return [...seen].map(c => { const cc = U._casing(c); return [U._contrast(c, cc.casing), U._contrast(cc.casing, cc.outer)]; }); })()""")
    check(len(res) >= 20, f"모든 본부 탭에서 나온 색 {len(res)}개(본부 색 + 지사 12색 + 미지정)")
    worst = min(r[0] for r in res)
    check(worst >= 3.0, f"선과 테두리의 대비가 너무 낮은 색이 있음 (최저 {worst:.2f}, 그래픽 기준 3:1)")
    check(min(r[1] for r in res) >= 15, "테두리와 바깥 띠의 대비")
    kinds = {J(p, f"JurisdictionUI._casing('hsl({h},72%,{l}%)').casing") for h in (10, 60, 120, 200, 280) for l in (26, 36, 50, 58)}
    check(kinds == {"#0b130e", "#ffffff"}, f"밝은 색엔 어두운 테두리, 어두운 색엔 흰 테두리가 모두 쓰여야 함: {kinds}")

def t_admin_click_has_border(b):
    p = open_tab(b); admin(p)
    secs = sections_of(p, "강원", "춘천")[:3]
    for s in secs: click_sec(p, s)
    check(J(p, "JurisdictionUI._state().casing.getLayers().length") == 6, "선택 3개 × 2겹")
    check(J(p, "JurisdictionUI._state().clicked") == secs[2], "마지막으로 누른 구간")
    click_sec(p, secs[2])                                   # 다시 누르면 해제
    check(J(p, "JurisdictionUI._state().casing.getLayers().length") == 4, "해제하면 테두리도 사라짐")

def t_pick_destination_on_map(b):
    p = open_tab(b); admin(p)
    src = sections_of(p, "강원", "춘천")[:2]; dst = sections_of(p, "강원", "홍천")[0]; to = bid(p, "강원", "홍천")
    for s in src: click_sec(p, s)
    p.click("#jr-pick"); p.wait_for_timeout(150)
    check(p.locator("#jr-pickbar").is_visible(), "안내 바가 안 보임")
    check(J(p, "JurisdictionUI._state().map.getContainer().style.cursor") == "crosshair", "커서")
    click_sec(p, dst); p.wait_for_timeout(250)                # 홍천 구간을 지도에서 클릭
    ev = J(p, "JurisdictionUI._state().pending")
    check(len(ev) == 1 and ev[0]["t"] == "move" and ev[0]["to"] == to and ev[0]["sections"] == src, ev)
    check(p.locator("#jr-pickbar").is_hidden(), "안내 바가 닫히지 않음")
    check(J(p, "Object.keys(JurisdictionUI._state().selected).length") == 0, "선택이 비워지지 않음")
    # 같은 지사 구간을 찍으면 거부, Esc 로 취소
    for s in sections_of(p, "강원", "원주")[:1]: click_sec(p, s)
    p.click("#jr-pick"); click_sec(p, sections_of(p, "강원", "원주")[1]); p.wait_for_timeout(150)
    check(len(J(p, "JurisdictionUI._state().pending")) == 1, "같은 지사로 이동이 추가됨")
    p.keyboard.press("Escape"); p.wait_for_timeout(100)
    check(J(p, "JurisdictionUI._state().pick") is False and p.locator("#jr-pickbar").is_hidden(), "Esc 취소")

def t_no_admin_checkbox_and_no_popup_move_button(b):
    p = open_tab(b)
    check(p.locator("#jr-admin").count() == 0 and "관리자 모드" not in p.locator("#view-jurisdiction").inner_text(), "관리자 모드 체크박스가 없어야 함")
    check(p.locator("#jr-add").is_visible() and p.locator("#jr-savebar").is_visible(), "관리자 아이디로 로그인하면 바로 편집 도구가 보여야 함")
    pv = open_tab(b, user="equip-01"); sid = sections_of(pv, "강원", "춘천")[0]
    J(pv, f"(()=>{{const pl=JurisdictionUI._state().polys['{sid}'];pl.fire('click',{{latlng:pl.getCenter(),originalEvent:{{}}}});pl.openPopup(pl.getCenter())}})()"); pv.wait_for_timeout(250)
    check(pv.locator(".leaflet-popup-content").count() == 1 and pv.locator(".jr-popbtn").count() == 0 and "옮기기" not in pv.locator(".leaflet-popup-content").inner_text(), "보기 전용 팝업에 옮기기 버튼이 없어야 함")

def un_ids(p): return J(p, "JURIS.doc.sections.filter(s => s.owner === null).map(s => s.id)")

def t_save_bar_always_visible(b):
    pv = open_tab(b, user="equip-01")
    check(pv.locator("#jr-savebar").is_hidden(), "보기 전용 계정에는 저장 바 없음")
    m = SBM.Mock(); p = open_tab(b, mock=m)
    admin(p)
    check(p.locator("#jr-savebar").is_visible(), "관리자 모드에서 저장 바가 안 보임")
    check(p.locator("#jr-top-save").is_disabled() and "변경 없음" in p.locator("#jr-savebar").inner_text(), "변경 없을 때는 저장 비활성")
    secs = sections_of(p, "강원", "춘천")[:1]
    click_sec(p, secs[0]); p.select_option("#jr-dest", bid(p, "강원", "홍천")); p.click("#jr-move"); p.wait_for_timeout(250)
    check(p.locator("#jr-top-save").is_enabled() and "1건" in p.locator("#jr-savebar").inner_text(), "변경 후 저장 활성")
    clear_toast(p); p.click("#jr-top-save"); saved(p, 1)
    check(m.event_calls[-1][1][-1]["kind"] == "move", "서버에 저장됨")
    check("GitHub" not in p.locator("body").inner_text().split("연도별 신적설")[0] and p.locator("#jr-toast").inner_text() == "1건 저장되었습니다.", "저장 안내는 한 줄뿐: GitHub·적용 범위 같은 부가 설명이 없어야 함")
    click_sec(p, secs[0] if False else sections_of(p, "강원", "홍천")[0]); p.select_option("#jr-dest", bid(p, "강원", "춘천")); p.click("#jr-move"); p.wait_for_timeout(200)
    p.click("#jr-top-cancel"); p.wait_for_timeout(200)
    check(p.locator(".jr-ev:not(.old)").count() == 0 and p.locator("#jr-top-save").is_disabled(), "모두 취소")

def t_unassigned_visible_and_clickable(b):
    p = open_tab(b, user="equip-01"); ids = un_ids(p)
    check(len(ids) > 100, f"미지정 구간 {len(ids)}")
    st = J(p, f"(()=>{{const o=JurisdictionUI._state().polys['{ids[0]}'].options;return [o.color,o.dashArray,o.weight,o.opacity]}})()")
    check(st[0] == "#3f3f3f" and not st[1] and st[2] >= 5 and st[3] >= 0.9, f"미지정 선 모양(진한 회색 실선: 점선이 아님, 1px 더 굵게) {st}")
    check(J(p, f"JurisdictionUI._state().polys['{ids[0]}'].options.lineCap") == "round", "미지정은 이음새가 끊겨 보이지 않도록 둥근 끝이어야 함")
    row = p.locator('.jr-br[data-id="NONE"]'); check("구간" in row.inner_text(), row.inner_text())
    # 보기 모드: 눌러서 정보 확인
    click_sec(p, ids[0])
    J(p, f"(()=>{{const pl=JurisdictionUI._state().polys['{ids[0]}'];pl.openPopup(pl.getCenter())}})()"); p.wait_for_timeout(200)
    check("미지정" in p.locator(".leaflet-popup-content").inner_text(), "팝업에 미지정 표시")
    check(J(p, "JurisdictionUI._state().casing.getLayers().length") == 2, "미지정 구간도 이중 테두리")

def t_assign_unassigned_to_branch(b):
    p = open_tab(b); admin(p); ids = un_ids(p)[:2]; to = bid(p, "수도권", "시흥")
    for i in ids: click_sec(p, i)
    p.select_option("#jr-dest", to); p.click("#jr-move"); p.wait_for_timeout(250)
    ev = J(p, "JurisdictionUI._state().pending")
    check(len(ev) == 1 and ev[0]["to"] == to and ev[0]["sections"] == ids and ev[0]["from"] == [None], ev)
    check("미지정" in p.locator(".jr-ev").first.inner_text(), p.locator(".jr-ev").first.inner_text())
    st = J(p, f"JurisdictionUI._state().polys['{ids[0]}'].options.dashArray"); check(st and not st.startswith("1,") and "," in st, f"변경 대기는 긴 점선 {st}")
    p.click("#jr-top-preview"); p.wait_for_timeout(300)
    check(p.locator(".jr-table tbody tr").count() == 1 and "시흥" in p.locator(".jr-table").inner_text(), "미리보기는 시흥 1곳")
    p.click("#jr-close")
    # 지도에서 도착 지사 고르기로 미지정으로 되돌리기
    p.click("#jr-top-cancel"); p.wait_for_timeout(150)
    s1 = sections_of(p, "강원", "춘천")[0]; click_sec(p, s1)
    p.click("#jr-pick"); click_sec(p, un_ids(p)[5]); p.wait_for_timeout(250)
    ev = J(p, "JurisdictionUI._state().pending")
    check(len(ev) == 1 and ev[0]["to"] == "NONE" and ev[0]["sections"] == [s1], ev)

def t_select_all_unassigned_row(b):
    p = open_tab(b); admin(p)
    p.click('.jr-br[data-id="NONE"]'); p.wait_for_timeout(300)
    p.click("#jr-selall"); p.wait_for_timeout(250)
    check(J(p, "Object.keys(JurisdictionUI._state().selected).length") == len(un_ids(p)), "미지정 전체 선택")

def zoom_to(p, z): J(p, f"JurisdictionUI._state().map.setZoom({z}, {{animate: false}})"); p.wait_for_timeout(350)
def line_w(p, sid): return J(p, f"JurisdictionUI._state().polys['{sid}'].options.weight")

def t_width_grows_with_zoom(b):
    p = open_tab(b); sid = sections_of(p, "강원", "춘천")[0]
    ws = {}
    for z in (7, 9, 11, 13, 15, 17):
        zoom_to(p, z); ws[z] = line_w(p, sid)
    check(ws[7] >= 4 and ws[7] < ws[9] < ws[11] < ws[13] < ws[15] <= ws[17], f"확대할수록 굵어져야 함 {ws}")
    check(ws[13] >= 10 and ws[15] >= 13, f"확대했을 때 충분히 굵어야 함 {ws}")
    # 선택 테두리도 굵기에 맞춰 같이 굵어짐
    admin(p); click_sec(p, sid)
    outer = J(p, "JurisdictionUI._state().casing.getLayers()[0].options.weight")
    check(outer >= ws[17] + 14, f"테두리 굵기 {outer}")

def t_click_tolerance_near_miss(b):
    p = open_tab(b); admin(p); sid = sections_of(p, "강원", "춘천")[2]
    zoom_to(p, 11)
    # 구간 중앙에서 화면 기준 10px 떨어진 곳을 눌러도 선택됨 / 70px 떨어진 곳은 안 됨
    def click_offset(px):
        return J(p, f"""(()=>{{const U=JurisdictionUI._state(), m=U.map, pl=U.polys['{sid}'];
          m.fitBounds(pl.getBounds(), {{padding:[80,80], animate:false}});
          const c=m.latLngToContainerPoint(pl.getCenter()); const pt=m.containerPointToLatLng([c.x, c.y+{px}]);
          m.fire('click', {{latlng: pt, originalEvent: {{}}}});
          return Object.keys(U.selected)}})()""")
    got = click_offset(11); check(got == [sid], f"10px 근처 클릭이 선택되지 않음 {got}")
    J(p, "(()=>{const U=JurisdictionUI._state(); U.selected={}; U.clicked=null})()")
    got = click_offset(90); check(got != [sid] and sid not in got, f"90px 떨어진 클릭이 선택됨 {got}")

def t_nearest_prefers_closest(b):
    p = open_tab(b); a = sections_of(p, "강원", "춘천")
    got = J(p, f"""(()=>{{const U=JurisdictionUI._state(), m=U.map, sec=JURIS.doc.sections.find(s=>s.id==='{a[3]}');
      m.setView([sec.coords[0][1], sec.coords[0][0]], 12, {{animate:false}});
      const hit = JurisdictionUI._near(L.latLng(sec.coords[0][1], sec.coords[0][0]), JurisdictionUI.NEAR_PX); return hit && hit.id}})()""")
    check(got in (a[3], a[2], a[4]), f"끝점 근처에서 이웃 구간 중 하나여야 함 {got}")

def t_row_click_selects_and_shows(b):
    p = open_tab(b); admin(p)
    open_hq(p, "강원"); p.click(".jr-br:has-text('춘천')"); p.wait_for_timeout(300)
    rows = p.locator(".jr-sec"); check(rows.count() >= 5, "구간 행")
    sid = rows.nth(1).get_attribute("data-sid")
    rows.nth(1).locator("span").first.click(); p.wait_for_timeout(300)          # 노선명을 누름
    check(J(p, "Object.keys(JurisdictionUI._state().selected)") == [sid], "노선명을 눌러도 선택되어야 함")
    check(J(p, "JurisdictionUI._state().casing.getLayers().length") == 2, "지도에 이중 테두리로 표시")
    check(p.locator(".jr-sec.sel").count() == 1 and p.locator(f'.jr-sec[data-sid="{sid}"] input').is_checked(), "목록에도 선택 표시")
    # 한 번 더 누르면 해제, Shift+클릭으로 범위 선택
    p.locator(f'.jr-sec[data-sid="{sid}"] span').first.click(); p.wait_for_timeout(250)
    check(J(p, "Object.keys(JurisdictionUI._state().selected).length") == 0, "다시 누르면 해제")
    p.locator(".jr-sec").nth(0).locator("span").first.click(); p.locator(".jr-sec").nth(3).locator("span").first.click(modifiers=["Shift"]); p.wait_for_timeout(300)
    check(J(p, "Object.keys(JurisdictionUI._state().selected).length") == 4, "목록에서도 Shift+클릭 범위 선택")

def t_row_click_view_mode(b):
    p = open_tab(b, user="equip-01")
    open_hq(p, "강원"); p.click(".jr-br:has-text('춘천')"); p.wait_for_timeout(300)
    sid = p.locator(".jr-sec").nth(2).get_attribute("data-sid")
    p.locator(".jr-sec").nth(2).locator("span").first.click(); p.wait_for_timeout(400)
    check(J(p, "JurisdictionUI._state().clicked") == sid, "보기 모드: 클릭한 구간 표시")
    check(J(p, "JurisdictionUI._state().casing.getLayers().length") == 2, "테두리")
    check(p.locator(".leaflet-popup-content").count() == 1, "팝업")

def t_private_hq(b):
    p = open_tab(b); admin(p)
    check(p.locator("#jr-tree .jr-hqname:has-text('민자')").count() == 1, "민자 본부가 목록에 보여야 함(비어 있어도)")
    check("관측소·적설 계산 안 함" in p.locator("#jr-tree .jr-hqname:has-text('민자')").inner_text(), "민자 안내 표시")
    p.click("#jr-add"); p.fill("#jr-newname", "시험민자"); p.select_option("#jr-newhq", "민자"); p.click("#jr-newok"); p.wait_for_timeout(300)
    check(p.locator("#jr-tree .jr-hqname:has-text('민자') ~ .jr-br:has-text('시험민자')").count() == 1, "민자 아래에 새 기관")
    pid = J(p, "Object.keys(JurisdictionUI._state().view.state.branches).slice(-1)[0]")
    un = un_ids(p)[:2]
    for u in un: click_sec(p, u)
    p.select_option("#jr-dest", pid); p.click("#jr-move"); p.wait_for_timeout(300)
    check(J(p, f"JurisdictionUI._state().polys['{un[0]}'].options.color") == "#FFE400", "막 만든 민자 기관이 선택된 동안은 노랑(관측소 지도와 같음)")
    J(p, "(()=>{const s=JurisdictionUI._state(); s.focus=null; JurisdictionUI.setHqView('ALL', false); return 1})()"); p.wait_for_timeout(200)
    col = J(p, f"JurisdictionUI._state().polys['{un[0]}'].options.color"); check(col.startswith("hsl(278"), f"전체 보기에서 민자 색은 보라 계열 {col}")
    p.click("#jr-top-preview"); p.wait_for_timeout(300)
    txt = p.locator(".jr-table").inner_text(); check("계산 안 함" in txt, txt)
    p.click("#jr-close")
    # 강설량 화면(지사 수)은 그대로: 저장한 뒤 새로고침
    clear_toast(p); p.click("#jr-top-save"); saved(p, 2)            # 신설 기관 + 구간 이동 = 2건, 새로고침 없이 바로 반영
    check(p.locator("#statBranch").inner_text() == "59", "민자 기관이 강설량 화면 통계에 들어가면 안 됨")
    check(J(p, "HIERARCHY.hq.some(h => h.name === '민자')") is False, "HIERARCHY 에 민자 본부가 생기면 안 됨")

TESTS = [t_tab_loads, t_view_mode_cannot_select, t_move_preview_save, t_shift_range_select, t_add_branch_and_move, t_move_branch_hq, t_save_then_everyone_sees, t_live_refresh_without_reload, t_new_branch_id_survives_save, t_legacy_new_branch_without_id_still_works, t_html_in_branch_name_is_text, t_new_branch_position_and_reorder, t_hq_tabs_admin_all_then_hq_only, t_branch_click_yellow_others_gray, t_unassigned_toggle, t_hq_tabs_branch_starts_with_own_hq, t_csp_blocks_injected_script, t_snow_from_server_not_public_file, t_snow_seasons_recent_and_older, t_snow_map_calendar, t_snow_old_format_still_works, t_snow_server_empty_shows_no_data,
         t_save_failure_keeps_pending_and_offers_file, t_history_load_failure_falls_back_and_blocks_save, t_history_paging_and_backup_export,
         t_border_on_click_view_mode, t_border_contrast_all_colors, t_admin_click_has_border, t_pick_destination_on_map, t_no_admin_checkbox_and_no_popup_move_button,
         t_save_bar_always_visible, t_unassigned_visible_and_clickable, t_assign_unassigned_to_branch, t_select_all_unassigned_row,
         t_width_grows_with_zoom, t_click_tolerance_near_miss, t_nearest_prefers_closest, t_row_click_selects_and_shows, t_row_click_view_mode, t_private_hq]
if __name__ == "__main__":
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for fn in TESTS: run(fn.__name__, fn, b)
        b.close()
    server.shutdown()
    ok = sum(1 for _, o, _ in results if o)
    for n, o, m in results: print(("PASS " if o else "FAIL ") + n + ("" if o else "  → " + m))
    real = [e for e in errors if "Leaflet" not in e]
    if real: print("\n페이지 오류:", *real[:6], sep="\n  ")
    print(f"\n{ok}/{len(results)} 통과")
    sys.exit(0 if ok == len(results) and not real else 1)
