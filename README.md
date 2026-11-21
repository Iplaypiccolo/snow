# 고속도로 인접 적설관측소 지도

한국도로공사 59개 지사 관할 고속도로 구간(전국표준노드링크 기반)과, 그 인근 기상청 공식 적설관측지점의 신적설 데이터를 보여주는 웹사이트입니다.

## 구조

```
index.html              페이지 골격 (데이터는 fetch로 불러옴). 장비 지원 페이지는 2026-11-21 없앰(docs/equipment-archive.md)
app.js                  화면 로직 (지도, 표, 탭 전환, 업로드 병합 등)
data/roads.json         고속도로 노선 좌표 (거의 변경 없음)
data/hierarchy.json     본부/지사/관측소 배정 정보 (거의 변경 없음)
(적설)                  서버(Supabase) snow_daily → snapshots('snow'). 예전 data/snow_data.json 은 2026-10-04 서버로 옮긴 뒤 삭제(시험용 표본 tests/fixtures/snow_sample.json)

jurisdiction/           '기관별 관할 고속도로' 탭 (구간을 눌러 지사 이동, 신설 기관, 본부 이동)
  core.js                 변경 적용·관측소 배정·적설 재계산 (화면 없이 계산만)
  ui.js / style.css       화면
grid/                   '예보 격자 편입' 탭 (기상청 5km 격자를 지도에서 골라 기관에 편입, 여러 기관 공유 가능)
  core.js                 격자 변환·편입 계산·호출량 판정 / ui.js·style.css 화면
data/grid_assign.json   격자 기본 편입(칸별 기관)과 후보 칸
data/grid_changes.json  (비상용) 서버에 연결하지 못할 때 대신 읽는 격자 변경 이력 — 실제 이력은 서버(Supabase)에 저장
tools/build_grid_assign.py  격자 기본 편입 생성 도구
data/sections.json      관할 구간(IC/JC 사이) 모양과 기본 소속
data/jurisdiction_changes.json  (비상용) 서버에 연결하지 못할 때 대신 읽는 관할 변경 이력 — 실제 이력은 서버(Supabase)에 저장
data/stations.json      관측소 좌표 목록 (지금은 배정된 적 있는 관측소만)
tools/build_jurisdiction.py  구간 생성 도구 (표준노드링크에서 걸러낸 파일 필요)
tools/add_unassigned_sections.py  미지정 고속도로(어느 지사에도 속하지 않은 도로) 구간 추가 도구
docs/unassigned-sections-report.md  미지정 구간 생성 결과

  index.html              화면 틀
  css/style.css           디자인 (색, 글자, 배치)
  js/sample-data.js       샘플 데이터 (가상 차량번호·가짜 운전원. 실제 데이터 아님)
  js/api.js               서버와 주고받는 곳 (지금은 서버 없음. 서버 연결 시 이 파일만 바꿈)
  js/app.js               화면과 동작 (역할·권한, 저장, 수정기록, 탭, 이벤트)

docs/jurisdiction-rules.md  관할 고속도로 변경 탭 동작 규칙
docs/grid-assign-rules.md  예보 격자 편입 탭 동작 규칙
docs/d1-schema-design.md   Cloudflare D1 표 설계 v1(설계안), docs/d1-schema-v1.sql
docs/supabase-design.md      Supabase 구성(snow-support, 서울): 표·권한·기록·시험·남은 일
supabase/migrations/       Supabase 표·권한(RLS)·기록 트리거 SQL (실제 적용한 것)
supabase/tests/rls_test.sql  권한·기록 자동 시험(SQL Editor 에서 실행, 103항목)
supabase/tests/events_test.sql  변경 이력 표 권한·종류·원자성 시험(24항목)
supabase/tests/requests_test.sql  구간 변경 요청 표 권한·제한 시험
supabase/tests/accounts_check.sql  실제 계정 점검(낯선 가입자·임시 비밀번호 계정·관리자)
supabase/seed/            본부·지사 기준정보 SQL
supabase/functions/import-reference/  GitHub 의 data/*.json 을 서버에서 읽어 DB 로 옮기는 함수(기준정보 이전)
tools/run_all_tests.py     모든 자동 시험을 한 번에 실행하고 결과 표를 보여 줌(--fast 는 화면 시험 제외)
tools/reference_check.py   DB 와 data/*.json 이 같은지 확인하는 검증 SQL 생성
tools/fill_section_gaps.py  구간 사이 끊김을 실제 도로망으로 메우는 도구(결과 docs/section-gaps-report.md)
supabase/functions/account-admin/  계정 발급·초기화·비활성화·비밀번호 일괄 설정 함수(Edge Function)
admin/                  관리 콘솔(로그인, 비밀번호 변경, 계정 관리, 비밀번호 일괄 설정 엑셀표, 접속 로그) — docs/admin-console.md
boot.js                 첫 화면 시작 코드(보안 정책 CSP 때문에 index.html 밖으로 뺌)
auth/snow.js            적설: 서버 요약본(snapshots 'snow')을 읽어 화면 자료로 바꿈
supabase/functions/collect-snow/ 일 신적설 자동 수집(기상청 kma_snow1, 11.1~4.30 매일) → 서버 적설 표(snow_daily) → 요약본
tools/check_gaps_against_source.py  끊긴 구간을 원본 도로망과 대조(원본에 있는데 빠진 곳만 잇기) — docs/section-gaps-source-check.md
.github/workflows/supabase-keepalive.yml  서버 깨우기(월·목, 비밀값 없음) — docs/server-keepalive.md
tests/test_import_snow.mjs · tests/test_snow_snapshot.js · supabase/tests/save_check_test.sql  적설 넣기·요약본 계산·저장 검사 시험
auth/                   로그인 공통 부품(auth.js)·변경 이력 저장/읽기 부품(events.js)·첫 화면 로그인 잠금(gate.js·gate.css) — docs/login-gate.md
docs/accounts.md           계정 목록(아이디만, 비밀번호 없음)
CLAUDE.md                  Claude Code 가 매번 가장 먼저 읽는 안내판(규칙·구조·하지 말 것)
docs/claude-code-setup.md  내 컴퓨터에서 Claude Code(데스크톱 앱) 시작하기, 채팅과 이어 가는 법, 마무리 체크리스트
docs/handoff.md            채팅의 Claude 와 Claude Code 가 서로 알 수 있는 유일한 통로(인계 메모)
docs/admin-console.md       관리 콘솔 사용 안내
docs/login-gate.md          로그인 잠금·자동 로그인·아이디 저장·용어(캐시·쿠키·브라우저 저장소) 설명
tests/test_account_admin.mjs  계정 발급 함수 자동 시험(17항목)
tests/test_admin_policy_parity.mjs  화면·서버 비밀번호 규칙 일치 시험
tests/test_admin_ui.py      관리 콘솔 화면 자동 시험(가짜 서버, 19항목)
tests/test_jurisdiction_requests.py  구간 변경 요청·관리자 알림·격자 탭 관리자 전용 시험(10항목)
tests/test_import_reference.mjs  기준정보 이전 함수 자동 시험(12항목, 실제 data/*.json 사용)
tests/test_login_gate.py    첫 화면 로그인 잠금·자동 로그인·아이디 저장 자동 시험(13항목)
tests/test_hierarchy_order.py  본부·지사 순서가 강설량 측정 화면과 같은지 실제 자료로 확인(6항목)
tests/_sb_mock.py          가짜 Supabase 서버(화면 시험용)
docs/jurisdiction-build-report.md  구간 생성·끝점 보정 결과 보고서
docs/equipment-archive.md 장비 지원 페이지 보관 문서 (2026-11-21 없앰: 코드 위치·서버 구조·다시 만드는 법)
docs/equipment-rules.md   장비 지원 페이지 동작 규칙 (보관용)
docs/decisions.md         결정 사항과 배경 (서버 이전 계획, 개인정보 메모 등. 작업 이어가기용)
tests/test_grid_core.js  격자 계산 자동 테스트 (node tests/test_grid_core.js)
tests/test_grid_ui.py    격자 편입 탭 화면 자동 테스트
tests/test_jurisdiction_core.js  관할 변경 계산 자동 테스트 (node tests/test_jurisdiction_core.js)
tests/test_sections_continuity.py  구간 데이터가 끊김 없이 이어지는지·지사 구간이 그대로인지 확인(5항목)
tests/test_reapply.js       저장 후 새로고침 없이 다시 적용하는 계산이 처음부터 적용한 결과와 같은지 확인(실제 자료, 7항목)
tests/test_jurisdiction_ui.py    관할 변경 탭 화면 자동 테스트
```

## 장비 지원 페이지 (2026-11-21 없앰)

화면과 서버 자료를 지웠습니다. 다시 만들 때는 `docs/equipment-archive.md` 를 보세요.

## 데이터 갱신 방식 — 서버 자동 수집

1. 매년 **11월 1일 ~ 익년 4월 30일**, 서버(Supabase)가 매일 01:10(한국 시각)에 전날 하루치를 기상청 API허브(`kma_snow1.php`)에서 받아 저장합니다. 못 받은 시각은 11:40까지 30분마다 다시 받습니다.
2. 시즌은 그 기간의 **첫눈 ~ 마지막 눈**(지사 관측소 260곳 중 한 곳이라도 0.1cm 이상인 날)이고 이름은 "2025-26 시즌"처럼 씁니다.
3. 손으로 올리는 기능(관리 콘솔 '적설 자료')은 2026-10-30 없앴습니다.

## 신적설 계산 방식

하루 00시~23시, 1시간 간격으로 그 시각까지의 누적 적설(`sd=day`)을 조회한 뒤, 관측소별로 **그날의 최댓값**을 그 날짜의 신적설로 사용합니다.

## 관측소 배정 기준

각 지사 관할구간 기준 반경 **5km**를 기본으로 하되, 5km 이내 관측소가 5대 이하이면 6km→7km→8km까지 단계적으로 확대합니다. 한 관측소가 여러 지사와 가까우면 중복으로 포함될 수 있습니다.
