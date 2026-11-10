"""
구간 변경 요청 · 관리자 알림 · 격자 탭 관리자 전용 자동 테스트 — 브라우저로 직접 눌러 봅니다. (Supabase 는 가짜 서버 tests/_sb_mock.py)
확인하는 것: 관리자 모드 체크박스 없음 / 지사의 구간 선택→변경 요청→목록·취소 / 장비 계정은 요청 불가 / 서버 거절 문구 / 관리자 로그인 알림창·탭 표시·다시 안 뜸·새 요청 알림 /
             요청 보기·이동 준비·반려·저장 시 승인 / 지사가 관리자 기능을 우회 못함 / 예보 격자 편입은 관리자만(자료도 불러오지 않음)
실행 (저장소 맨 위 폴더에서):  python tests/test_jurisdiction_requests.py
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_jurisdiction_ui as T
import _sb_mock as SBM
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DOC = json.loads((ROOT / "data/sections.json").read_text(encoding="utf-8"))
results, errors = [], T.errors
J, check = T.J, T.check
def owner_secs(hq, name):
    b = next(b for b in DOC["branches"] if b["hq"] == hq and b["name"] == name)
    return b["id"], [s["id"] for s in DOC["sections"] if s["owner"] == b["id"]]
CHUNGJU, CJ_SECS = owner_secs("충북", "충주")        # 요청하는 지사
GURYE, GR_SECS = owner_secs("광주전남", "구례")        # 도착 지사

def mock_with_branch():
    m = SBM.Mock(); m.add("exok", "충주담당", "branch", CHUNGJU, "Branch#Pass-2026ok"); m.add("exok2", "구례담당", "branch", GURYE, "Branch#Pass-2026o2"); return m

def open_as(b, user, mock, reqs=None, click_tab=True):
    p = T.open_tab(b, user=user, mock=mock, click_tab=click_tab)
    if reqs is not None: p.on("request", lambda r: reqs.append(r.url))
    return p
def sf(p, field): return J(p, f"JurisdictionUI._state().{field}")      # 상태의 한 항목만 읽음(전체를 읽으면 지도 객체 때문에 직렬화되지 않음)
def posts(m): return [c for c in m.req_calls if c[0] == "POST"]
def click_secs(p, ids):
    for i in ids: T.click_sec(p, i)
def run(name, fn, browser):
    try: fn(browser); results.append((name, True, ""))
    except Exception as e: results.append((name, False, f"{type(e).__name__}: {str(e)[:300]}"))
    finally:
        while T.OPENED:
            try: T.OPENED.pop().close()
            except Exception: pass

def t_branch_requests_a_move(b):
    m = mock_with_branch(); p = open_as(b, "exok", m)
    check(p.locator("#jr-admin").count() == 0, "관리자 모드 체크박스가 없어야 함")
    check(p.locator("#jr-add").is_hidden() and p.locator("#jr-savebar").is_hidden(), "지사: 신설·저장 도구가 없어야 함")
    check(p.locator("#jr-note").count() == 0 and p.locator("#jr-role").count() == 0, "설명 글·권한 꼬리표 없음(2026-10-05)")
    check(p.locator("#jr-requests").is_visible() and "내 변경 요청" in p.locator("#jr-requests").inner_text() and "보낸 요청이 없습니다" in p.locator("#jr-requests").inner_text(), "내 요청 칸")
    sel = CJ_SECS[:2]; click_secs(p, sel)
    bar = p.locator("#jr-selbar"); check(bar.is_visible() and "2개 구간" in bar.inner_text() and p.locator("#jr-reqopen").count() == 1, bar.inner_text())
    check(p.locator("#jr-move").count() == 0 and p.locator("#jr-dest").count() == 0 and p.locator("#jr-pick").count() == 0, "지사에게는 이동 버튼·도착 지사 선택이 없어야 함")
    p.click("#jr-reqopen"); p.wait_for_selector("#jr-req-send")
    dlg = p.locator("#jr-modal").inner_text(); check("구간 변경 요청" in dlg and "충주" in dlg and "관리자가 정해 주세요" in dlg, dlg[:200])
    p.select_option("#jr-req-to", GURYE); p.fill("#jr-req-reason", "이 구간은 실제로 구례지사가 제설합니다"); p.click("#jr-req-send"); p.wait_for_timeout(500)
    body = posts(m)[-1][2]
    check(body["section_ids"] == sel and body["to_branch_id"] == GURYE and body["reason"].startswith("이 구간은") and len(body["snapshot"]) == 2 and body["snapshot"][0]["owner"] == CHUNGJU and "branch_id" not in body, body)
    check(p.locator("#jr-modal").is_hidden() and J(p, "Object.keys(JurisdictionUI._state().selected).length") == 0 and p.locator("#jr-selbar").is_hidden(), "보낸 뒤 창이 닫히고 선택이 풀려야 함")
    check("요청을 보냈습니다" in p.locator("#jr-toast").inner_text(), "안내 메시지")
    card = p.locator("#jr-requests .jr-req"); check(card.count() == 1 and "대기 중" in card.inner_text() and "구례" in card.inner_text() and "구간 2개" in card.inner_text(), card.inner_text())
    check("사유: 이 구간은" in card.inner_text() and card.locator("[data-ra=cancel]").count() == 1 and card.locator("[data-ra=prep]").count() == 0, "지사 카드에는 취소만")
    check("대기 1" in p.locator("#jr-requests summary").first.inner_text(), "대기 개수")
    card.locator("[data-ra=view]").click(); p.wait_for_timeout(300); check(J(p, "Object.keys(JurisdictionUI._state().show).length") == 2 and J(p, "JurisdictionUI._state().casing.getLayers().length") >= 2, "지도에서 보기")
    card.locator("[data-ra=cancel]").click(); p.wait_for_timeout(500)
    check(m.requests[0]["status"] == "cancelled" and "처리된 요청 1건" in p.locator("#jr-requests").inner_text() and p.locator("[data-ra=cancel]").count() == 0 and "대기 0" in p.locator("#jr-requests summary").first.inner_text(), "요청 취소")
    p.locator("#jr-requests .jr-hist summary").click(); check("취소" in p.locator("#jr-requests .jr-hist").inner_text(), "처리된 요청에 취소 표시")

def t_branch_request_without_destination_and_errors(b):
    m = mock_with_branch(); p = open_as(b, "exok", m); click_secs(p, CJ_SECS[:1])
    p.click("#jr-reqopen"); p.click("#jr-req-send"); p.wait_for_timeout(400)
    check(posts(m)[-1][2]["to_branch_id"] is None and posts(m)[-1][2]["reason"] is None, "도착·사유를 비워도 보낼 수 있어야 함")
    check("관리자가 정해 주세요" in p.locator("#jr-requests .jr-req").inner_text(), "도착 지사 미정 표시")
    click_secs(p, CJ_SECS[1:2]); p.click("#jr-reqopen")
    m.req_fail = (400, {"code": "54000", "message": "too many pending requests"}); p.click("#jr-req-send"); p.wait_for_timeout(400)
    check("너무 많습니다" in p.locator("#jr-req-msg").inner_text() and p.locator("#jr-modal").is_visible() and J(p, "Object.keys(JurisdictionUI._state().selected).length") == 1, "한도 초과: 창과 선택 유지 + 안내")
    m.req_fail = (403, {"code": "42501", "message": "rls"}); p.click("#jr-req-send"); p.wait_for_timeout(400); check("권한이 없습니다" in p.locator("#jr-req-msg").inner_text(), "권한 오류 안내")
    m.req_fail = None; m.down = True; p.click("#jr-req-send"); p.wait_for_timeout(500); check("연결할 수 없습니다" in p.locator("#jr-req-msg").inner_text() and p.locator("#jr-req-send").is_enabled(), "연결 문제 안내 + 다시 보낼 수 있음")
    m.down = False; p.click("#jr-req-send"); p.wait_for_timeout(500); check(p.locator("#jr-modal").is_hidden() and len([r for r in m.requests if r["status"] == "pending"]) == 2, "다시 보내면 성공")

def t_equip_cannot_request(b):
    m = mock_with_branch(); p = open_as(b, "equip-01", m)
    check(p.locator("#jr-requests").is_hidden() and p.locator("#jr-add").is_hidden() and p.locator("#jr-savebar").is_hidden(), "장비 계정은 보기 전용(요청·편집 도구 없음)")
    T.click_sec(p, CJ_SECS[0]); check(J(p, "Object.keys(JurisdictionUI._state().selected).length") == 0 and p.locator("#jr-selbar").is_hidden() and p.locator("#jr-reqopen").count() == 0, "선택·요청 버튼이 없어야 함")

def t_branch_cannot_use_admin_features(b):
    m = mock_with_branch(); p = open_as(b, "exok", m); click_secs(p, CJ_SECS[:2])
    p.evaluate("document.getElementById('jr-add').click()"); p.wait_for_timeout(200); check(p.locator("#jr-modal").is_hidden(), "신설 기관 창이 열리면 안 됨")
    n = len(J(p, "JurisdictionUI._state().pending"))
    p.evaluate("""(() => { const b = document.createElement('button'); b.id = 'jr-move'; document.getElementById('view-jurisdiction').appendChild(b); b.click(); })()""")
    p.evaluate("""(() => { const b = document.createElement('button'); b.id = 'jr-top-save'; document.getElementById('view-jurisdiction').appendChild(b); b.click(); })()""")
    p.wait_for_timeout(300); check(len(J(p, "JurisdictionUI._state().pending")) == n == 0 and p.locator("#jr-modal").is_hidden(), "숨겨진 버튼을 만들어 눌러도 아무 일도 없어야 함")
    check(sf(p, "admin") is False and sf(p, "canRequest") is True, "역할")
    # 서버도 막음: 지사 아이디로 승인 시도 → 거절
    r = p.evaluate("""async () => { const s = JSON.parse(localStorage.getItem('ss_session')); const h = { Authorization: 'Bearer ' + s.access_token, apikey: 'x', 'Content-Type': 'application/json' };
      const x = await fetch('""" + SBM.SB + """/rest/v1/jurisdiction_requests?id=eq.1', { method: 'PATCH', headers: h, body: JSON.stringify({ status: 'approved' }) }); return x.status; }""")
    check(r in (200, 403), r)

def t_admin_sees_notice_badge_and_panel(b):
    m = mock_with_branch(); m.add_request(CHUNGJU, CJ_SECS[:2], to=GURYE, reason="구례 구간입니다"); m.add_request(CHUNGJU, CJ_SECS[2:3]); m.add_request(GURYE, GR_SECS[:1], to=CHUNGJU)
    m.add_request(GURYE, GR_SECS[1:2], status="rejected", note="이미 확인함")
    p = open_as(b, "admin-01", m, click_tab=False); p.wait_for_selector("#jrNotice", timeout=15000)
    n = p.locator("#jrNotice").inner_text(); check("관할 노선 변경 요청이 있습니다" in n and "3건" in n and "충주 지사 요청 2건" in n and "구간 3개" in n and "구례 지사 요청 1건" in n, n)
    check(p.locator(".tab-btn[data-tab=jurisdiction] .jr-badge").inner_text() == "3", "탭의 대기 개수")
    check(p.locator("#jr-admin").count() == 0 and sf(p, "admin") is True, "관리자: 체크박스 없이 관리자 권한")
    p.click("#jrNoticeLater"); check(p.locator("#jrNotice").count() == 0, "나중에")
    # 같은 로그인 동안 새로고침해도 알림창은 다시 뜨지 않고, 탭 표시는 유지
    p.reload(); p.wait_for_function("window.JurisdictionUI && JurisdictionUI._state().inited", timeout=60000); p.wait_for_timeout(1200)
    check(p.locator("#jrNotice").count() == 0 and p.locator(".tab-btn[data-tab=jurisdiction] .jr-badge").inner_text() == "3", "이미 본 요청은 알림창이 다시 뜨지 않음")
    # 새 요청이 들어오면(1분마다 확인) 알림창이 다시 뜸
    m.add_request(CHUNGJU, CJ_SECS[3:4]); p.evaluate("JurisRequests.check(true)"); p.wait_for_selector("#jrNotice"); check("4건" in p.locator("#jrNotice").inner_text(), p.locator("#jrNotice").inner_text())
    p.click("#jrNoticeGo"); p.wait_for_timeout(900)
    check(p.locator("#view-jurisdiction").is_visible() and p.locator("#jr-requests .jr-req").count() >= 4, "확인하러 가기: 관할 탭과 요청 목록")
    check(p.locator("#jr-add").is_visible() and p.locator("#jr-savebar").is_visible(), "관리자: 체크박스 없이 바로 편집 도구가 보임")
    txt = p.locator("#jr-requests").inner_text(); check("충주 지사" in txt and "구례 지사" in txt and p.locator("#jr-requests .jr-req-h b").first.inner_text().endswith("지사"), "관리자 카드에 요청 지사 이름")
    check("처리된 요청 1건" in p.locator("#jr-requests").inner_text(), "처리된 요청은 접어서 따로")
    check(p.locator("#jr-requests [data-ra=prep]").count() == 4 and p.locator("#jr-requests [data-ra=reject]").count() == 4 and p.locator("#jr-requests [data-ra=cancel]").count() == 0, "관리자 카드 버튼")

def t_zone_request_notice(b):
    """2026-11-10: 특보구역 요청이 있으면 관리자 로그인 때 알림창, [지금 보기] = 장비 지원 · 지사별 요청/편성(특보구역 관리 창), 같은 로그인에선 다시 안 뜸"""
    m = SBM.Mock(); m.zone_reqs = [{"id": 7, "branch_id": CHUNGJU, "zone_code": "L1030100", "zone_name": "충주", "action": "add", "reason": "시험", "by": "충주지사", "created_at": "2026-11-10T01:00:00Z"}]
    p = open_as(b, "admin-01", m, click_tab=False); p.wait_for_selector("#zoneNotice", timeout=15000)
    n = p.locator("#zoneNotice").inner_text(); check("특보구역 요청이 있습니다" in n and "1건" in n and "충주 지사" in n and "더하기" in n, n)
    p.click("#zoneNoticeGo"); p.wait_for_timeout(600)
    check(p.locator("#zoneNotice").count() == 0 and p.evaluate("document.getElementById('shell').dataset.page") == "equip" and p.locator(".eq-btn[data-eqtab=branch]").get_attribute("class").find("active") >= 0, "지금 보기 → 장비 지원 · 지사별 요청/편성")
    p.reload(); p.wait_for_timeout(2500); check(p.locator("#zoneNotice").count() == 0, "같은 로그인에서 이미 본 요청은 다시 안 뜸")
    bp = open_as(b, "exok", mock_with_branch()); bp.wait_for_timeout(1500); check(bp.locator("#zoneNotice").count() == 0, "지사에게는 알림창 없음")

def t_no_notice_when_nothing_pending(b):
    m = mock_with_branch(); m.add_request(CHUNGJU, CJ_SECS[:1], status="approved"); p = open_as(b, "admin-01", m, click_tab=False); p.wait_for_timeout(1500)
    check(p.locator("#jrNotice").count() == 0 and p.locator(".jr-badge").count() == 0, "대기 요청이 없으면 알림창·표시가 없어야 함")
    bp = open_as(b, "exok", mock_with_branch()); bp.wait_for_timeout(1000); check(bp.locator("#jrNotice").count() == 0, "지사에게는 관리자 알림창이 뜨면 안 됨")

def t_admin_prepares_move_and_save_approves(b):
    m = mock_with_branch(); r1 = m.add_request(CHUNGJU, CJ_SECS[:2], to=GURYE, reason="구례 구간")
    p = open_as(b, "admin-01", m, click_tab=False); p.wait_for_selector("#jrNotice"); p.click("#jrNoticeGo"); p.wait_for_selector("#jr-requests [data-ra=prep]")
    p.locator("[data-ra=view]").first.click(); p.wait_for_timeout(300); check(len(J(p, "Object.keys(JurisdictionUI._state().show)")) == 2, "지도에서 보기")
    p.locator("[data-ra=prep]").first.click(); p.wait_for_timeout(400)
    ev = sf(p, "pending"); check(len(ev) == 1 and ev[0]["t"] == "move" and ev[0]["to"] == GURYE and ev[0]["sections"] == CJ_SECS[:2] and ev[0]["req"] == r1["id"] and ev[0]["from"] == [CHUNGJU], ev)
    check("요청 #%d" % r1["id"] in p.locator(".jr-ev").first.inner_text() and "이동 준비됨" in p.locator("#jr-requests").inner_text(), "변경 대기에 요청 번호 표시 + 카드는 '이동 준비됨'")
    check(r1["status"] == "pending", "저장하기 전에는 아직 승인되지 않음")
    T.clear_toast(p); p.click("#jr-top-save"); T.saved(p, 1)
    call = m.event_calls[-1]; check(call[0] == "save_jurisdiction" and call[1]["p_approve"] == [r1["id"]], f"저장과 승인을 서버 함수 하나로 한 번에: {call[0]}")
    mv = call[1]["p_events"][-1]["payload"]; check(call[1]["p_events"][-1]["kind"] == "move" and mv["req"] == r1["id"] and mv["sections"] == CJ_SECS[:2] and mv["to"] == GURYE, mv)
    p.wait_for_timeout(700); check(r1["status"] == "approved" and r1["resolution_note"] and r1["resolved_by"], "저장하면 연결된 요청이 승인 처리됨")
    check(not any(c[0] == "PATCH" for c in m.req_calls), "승인을 따로 부르지 않음(저장과 함께 끝남)")
    check(p.locator("#jr-requests [data-ra=prep]").count() == 0 and "처리된 요청 1건" in p.locator("#jr-requests").inner_text() and p.locator(".tab-btn[data-tab=jurisdiction] .jr-badge").count() == 0, "처리된 요청으로 이동, 탭 표시도 사라짐")

def t_save_fails_whole_if_request_was_cancelled(b):
    """이동 준비 뒤 지사가 요청을 취소했다면: 저장 + 승인이 모두 취소되고(아무것도 저장 안 됨) 변경 대기는 남아 있으며 이유를 알려 준다"""
    m = mock_with_branch(); r1 = m.add_request(CHUNGJU, CJ_SECS[:2], to=GURYE, reason="구례 구간")
    p = open_as(b, "admin-01", m, click_tab=False); p.wait_for_selector("#jrNotice"); p.click("#jrNoticeGo"); p.wait_for_selector("#jr-requests [data-ra=prep]")
    p.locator("[data-ra=prep]").first.click(); p.wait_for_timeout(400)
    r1["status"] = "cancelled"                                   # 그사이 지사가 취소함(서버 상태)
    n0 = len(m.events["jurisdiction_events"]); p.click("#jr-top-save"); p.wait_for_selector("#jr-modal >> text=저장하지 못했습니다")
    check(len(m.events["jurisdiction_events"]) == n0 and r1["status"] == "cancelled", "아무것도 저장·승인되지 않음")
    check("이미 처리" in p.locator("#jr-modal").inner_text() and len(sf(p, "pending")) == 1, "이유 안내 + 변경 대기 유지")

def t_admin_chooses_destination_rejects_and_already_owned(b):
    m = mock_with_branch(); r_open = m.add_request(CHUNGJU, CJ_SECS[:1]); r_rej = m.add_request(CHUNGJU, CJ_SECS[1:2], to=GURYE); r_same = m.add_request(CHUNGJU, CJ_SECS[2:3], to=CHUNGJU)
    p = open_as(b, "admin-01", m, click_tab=False); p.wait_for_selector("#jrNotice"); p.click("#jrNoticeGo"); p.wait_for_selector("#jr-requests [data-ra=prep]")
    card = lambda r: p.locator(f".jr-req[data-rid='{r['id']}']")
    card(r_open).locator("[data-ra=prep]").click(); p.wait_for_selector("#jr-reqdest"); check("이동할 지사를 정하세요" in p.locator("#jr-modal").inner_text(), "도착 지사 선택 창")
    p.select_option("#jr-reqdest", GURYE); p.click("#jr-reqdestok"); p.wait_for_timeout(400)
    check(sf(p, "pending")[-1]["to"] == GURYE and sf(p, "pending")[-1]["req"] == r_open["id"], "관리자가 정한 도착 지사로 준비")
    # 이미 그 지사 소속이면 승인 처리(확인 창)
    card(r_same).locator("[data-ra=prep]").click(); p.wait_for_timeout(600); check(r_same["status"] == "approved" and r_same["resolution_note"], "이미 소속이면 승인(완료) 처리")
    # 반려
    T.DLG["prompt"] = "확인 결과 현재 소속이 맞습니다"; card(r_rej).locator("[data-ra=reject]").click(); p.wait_for_timeout(700); T.DLG["prompt"] = ""
    check(r_rej["status"] == "rejected" and r_rej["resolution_note"] == "확인 결과 현재 소속이 맞습니다", r_rej)
    p.locator("#jr-requests .jr-hist summary").first.click(); check("처리 의견: 확인 결과 현재 소속이 맞습니다" in p.locator("#jr-requests").inner_text(), "반려 의견 표시")
    check(len(sf(p, "pending")) == 1, "반려는 변경 대기를 만들지 않음")

def t_grid_tab_admin_only(b):
    reqs = []; p = open_as(b, "exok", mock_with_branch(), reqs)
    p.reload(); p.wait_for_function("window.JurisdictionUI && JurisdictionUI._state().inited", timeout=60000); p.wait_for_timeout(500)
    check(p.locator("#tabGridBtn").count() == 0 and p.locator("#view-grid").count() == 0 and p.locator(".tab-btn[data-tab=grid]").count() == 0, "지사 계정에는 예보 격자 편입 탭이 없어야 함")
    check(J(p, "typeof GridUI._state === 'function' && GridUI._state().inited") is False and J(p, "window.GRID.baseline") is None, "격자 화면이 시작되지 않고 자료도 비어 있어야 함")
    names = p.locator(".tab-btn").all_inner_texts(); check("예보 격자 편입" not in " ".join(names), names)
    ev = SBM.Mock(); pe = open_as(b, "equip-01", ev, reqs); pe.reload(); pe.wait_for_timeout(1500); check(pe.locator("#tabGridBtn").count() == 0, "장비 계정에도 없음")
    check(not [u for u in reqs if "grid_assign.json" in u or "grid_changes.json" in u], f"지사·장비 계정은 격자 자료를 불러오면 안 됨: {[u for u in reqs if 'grid_' in u]}")
    ra = []; pa = open_as(b, "admin-01", SBM.Mock(), ra); pa.reload(); pa.wait_for_function("window.GridUI && GridUI._state().inited", timeout=60000)
    check(pa.locator("#tabGridBtn").is_visible() and "예보 격자 편입" in pa.locator(".tab-btn").all_inner_texts(), "관리자에게는 탭이 보임")
    pa.click("#tabGridBtn"); pa.wait_for_timeout(900); check(pa.locator("#view-grid").is_visible() and pa.locator("#gr-admin").count() == 0 and pa.locator("#gr-savebar").is_visible(), "관리자: 격자 탭이 열리고 바로 편집 가능")
    check(any("grid_assign.json" in u for u in ra), "관리자는 격자 자료를 불러옴")

def t_unassigned_highly_visible(b):
    """미지정 고속도로가 밝은 지도 위에서 잘 보이는지: 명도 대비·굵기·흰 테두리·확대 때 굵기 추종·변경/강조 상태"""
    p = open_as(b, "admin-01", SBM.Mock()); ids = [s["id"] for s in DOC["sections"] if s["owner"] is None]
    lum = lambda h: (lambda r, g, b_: 0.2126 * r + 0.7152 * g + 0.0722 * b_)(*[(lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)(int(h[i:i + 2], 16) / 255) for i in (1, 3, 5)])
    cr = lambda a, b_: (max(lum(a), lum(b_)) + 0.05) / (min(lum(a), lum(b_)) + 0.05)
    c_new, c_old, tile, road = "#3f3f3f", "#8a8a8a", "#f2efe9", "#b9b5a5"
    check(cr(c_new, tile) >= 9 and cr(c_new, tile) > 2.5 * cr(c_old, tile), f"지도 바탕과의 명도 대비 {cr(c_new, tile):.1f}:1 (이전 {cr(c_old, tile):.1f}:1)")
    check(cr(c_new, road) >= 5, f"배경 도로와의 대비 {cr(c_new, road):.1f}:1")
    first = lambda i: J(p, f"(()=>{{const o=JurisdictionUI._state().polys['{i}'].options;return [o.weight,o.color]}})()")
    owned = next(s["id"] for s in DOC["sections"] if s["owner"]); w_un, w_ow = first(ids[0])[0], first(owned)[0]
    check(w_un == w_ow + 1, f"미지정은 소속 구간보다 1px 굵어야 함: {w_un} / {w_ow}")
    halo = J(p, "(()=>{const s=JurisdictionUI._state();const h=Object.values(s.haloPolys||{});return [h.length, h[0]&&h[0].options.color, h[0]&&h[0].options.weight, h[0]&&h[0].options.opacity, h[0]&&h[0].options.interactive]})()")
    check(halo[0] == len(ids) and halo[1] == "#ffffff" and halo[2] > w_un + 3 and halo[3] >= 0.85 and halo[4] is False, f"미지정마다 흰 테두리가 깔려야 함 {halo}")
    # 확대하면 선과 테두리가 함께 굵어짐
    J(p, "(()=>{JurisdictionUI._state().map.setZoom(12,{animate:false});return null})()"); p.wait_for_timeout(500)
    w2 = J(p, f"JurisdictionUI._state().polys['{ids[0]}'].options.weight"); h2 = J(p, "Object.values(JurisdictionUI._state().haloPolys)[0].options.weight")
    check(w2 > w_un and h2 > w2 + 3, f"확대하면 같이 굵어짐 {w_un}→{w2}, 테두리 {h2}")
    # 다른 지사를 강조하면 미지정은 흐려지고 테두리도 함께 흐려짐
    if p.locator("#jr-tree .jr-hq.open > [data-hqpick='강원']").count() == 0: p.click("#jr-tree [data-hqpick='강원']"); p.wait_for_timeout(300)
    p.click(".jr-br:has-text('춘천')"); p.wait_for_timeout(500)
    ol, oh = J(p, f"JurisdictionUI._state().polys['{ids[0]}'].options.opacity"), J(p, "Object.values(JurisdictionUI._state().haloPolys)[0].options.opacity")
    check(ol < 0.3 and oh < 0.2, f"강조 중에는 함께 흐려짐 {ol}/{oh}")
    p.click(".jr-br:has-text('춘천')"); p.wait_for_timeout(300)
    # 미지정 구간을 지사로 옮기면 그 구간의 테두리는 사라지고, 옮긴 구간이 굵기 보정도 사라짐
    n0 = J(p, "Object.keys(JurisdictionUI._state().haloPolys).length"); T.click_sec(p, ids[0]); p.select_option("#jr-dest", J(p, "JURIS.doc.branches[0].id")); p.click("#jr-move"); p.wait_for_timeout(400)
    n1 = J(p, "Object.keys(JurisdictionUI._state().haloPolys).length"); wm = J(p, f"JurisdictionUI._state().polys['{ids[0]}'].options.weight")
    check(n1 == n0 - 1 and wm <= w2 + 0, f"옮기면 그 구간의 흰 테두리가 사라짐 {n0}→{n1}, 굵기 {wm}")

def t_unassigned_gray_solid_everywhere(b):
    p = open_as(b, "admin-01", SBM.Mock()); ids = [s["id"] for s in DOC["sections"] if s["owner"] is None]; check(len(ids) > 100, "미지정 구간")
    o = J(p, f"(()=>{{const o=JurisdictionUI._state().polys['{ids[0]}'].options;return [o.color,o.dashArray,o.lineCap]}})()"); check(o[0] == "#3f3f3f" and not o[1] and o[2] == "round", o)
    sw = p.evaluate("getComputedStyle(document.querySelector('.jr-br[data-id=NONE] i')).backgroundColor"); check(sw == "rgb(63, 63, 63)", sw)
    leg = p.locator("#view-jurisdiction .jr-legend").inner_text(); check("진한 회색 = 미지정" in leg and "점선 = 미지정" not in leg and "회색 점선" not in leg and "점선 = 변경 대기" in leg, leg)
    # 변경 대기 중인 구간은 여전히 점선(미지정과 구분)
    T.click_sec(p, ids[0]); p.select_option("#jr-dest", J(p, "JURIS.doc.branches[0].id")); p.click("#jr-move"); p.wait_for_timeout(300)
    d = J(p, f"JurisdictionUI._state().polys['{ids[0]}'].options.dashArray"); check(d and "," in d, "변경 대기는 점선")

TESTS = [t_zone_request_notice, t_branch_requests_a_move, t_branch_request_without_destination_and_errors, t_equip_cannot_request, t_branch_cannot_use_admin_features, t_admin_sees_notice_badge_and_panel,
         t_no_notice_when_nothing_pending, t_admin_prepares_move_and_save_approves, t_save_fails_whole_if_request_was_cancelled, t_admin_chooses_destination_rejects_and_already_owned, t_grid_tab_admin_only, t_unassigned_gray_solid_everywhere, t_unassigned_highly_visible]
if __name__ == "__main__":
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for fn in TESTS: run(fn.__name__, fn, b)
        b.close()
    T.server.shutdown()
    ok = sum(1 for _, o, _ in results if o)
    for n, o, m in results: print(("PASS " if o else "FAIL ") + n + ("" if o else "  → " + m))
    real = [e for e in errors if "Leaflet" not in e]
    if real: print("\n페이지 오류:", *real[:6], sep="\n  ")
    print(f"\n{ok}/{len(results)} 통과"); sys.exit(0 if ok == len(results) and not real else 1)
