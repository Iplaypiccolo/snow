# 장비 지원 페이지 — 보관 문서 (2026-11-21 화면·서버에서 지움)

사용자 결정(2026-11-21): "장비 지원 시스템은 더 이상 사용하지 않을 예정. 페이지를 없애고 나중에 사용할 수 있게 md 파일로만. 서버도 장비 지원 자료는 보존할 필요 없음."
이 문서는 **나중에 다시 만들 때** 무엇이 있었고 어디를 보면 되는지 정리한 것이다. 동작 규칙의 자세한 설명은 아래 두 문서가 그대로 남아 있다.

- 동작 규칙(권한 표, 저장·로그·개인정보 규칙, 기준일자·경로 관계): [`docs/equipment-rules.md`](equipment-rules.md)
- 운전원·정비원 고르기와 엑셀 내려받기: [`docs/equipment-crew-export.md`](equipment-crew-export.md)
- 사용자 결정 기록: `docs/decisions.md` 에서 '장비', '기준일자', '지원', '배정', '강원' 으로 찾기

## 1. 코드가 남아 있는 곳

화면 코드는 저장소에서 지웠지만 **Git 기록에 그대로 있다.** 지우기 직전 커밋: `709deed` (2026-11-21).

```
git show 709deed:equipment/js/app.js      # 한 파일 보기
git checkout 709deed -- equipment         # 폴더 통째로 되살리기
```

| 파일 (커밋 709deed) | 줄 | 하는 일 |
|---|---|---|
| `equipment/index.html` | 138 | 장비 지원 화면 틀(첫 화면 안에 iframe 으로 띄움, `?sample=1` = 샘플 시연) |
| `equipment/js/app.js` | 1,847 | 화면 전체: 권한, 이동 현황, 기관별 장비, 지사별 요청·편성, 기관별 배치, 강원본부 지원장비, 로그 기록 |
| `equipment/js/api.js` | 485 | 서버 읽기·저장(아래 2의 표·함수) |
| `equipment/js/report.js` | 211 | 엑셀(지원 현황표) 만들기 |
| `equipment/js/crew.js` | 25 | 운전원 a~z·정비원 가~하 고르기 계산 |
| `equipment/js/sample-data.js` | 113 | 샘플 시연 자료 |
| `equipment/css/style.css` | 1,080 | 화면 모양(밝게·어둡게) |

첫 화면 쪽에 있던 연결(함께 지움): `index.html` 위쪽 [장비 지원 / 강설량 측정] 전환과 장비 지원 메뉴 줄·기준일자 칸·[새로고침]·화면 밝기,
`boot.js` 의 페이지 전환·뒤로가기 기록·장비 창 뒤로가기(SSSheetOpen/Close)·기준일자 칸(SSEqRound)·강원 탭(SSEqTeamTab)·특보구역 요청 알림창(zoneNotice),
`guide/guide.js` 의 '장비 지원 절차' 그림(FLOW·LAYOUT·flowSvg)과 탭별 안내(equipSteps).
시험: `tests/test_equipment.py`, `tests/test_equipment_crew.py`, `tests/test_equipment_crew_core.js`, 다른 시험 속 장비 지원 항목.

## 2. 탭과 기능 (요약 — 자세한 규칙은 equipment-rules.md)

| 탭 | 누가 | 하는 일 |
|---|---|---|
| 장비 지원현황(이동 현황) | 모든 계정 | 날짜별로 어느 기관 장비가 어느 지사로 가는지, 도착 예상 시각. 강원 신속대응팀 열 |
| 지사별 요청·편성 | 지사·지역본부(요청), 관리자(편성·확정) | 지사가 요청 대수·도착 요청 시각·사유 → 재난처가 편성·확정. 줄마다 대설특보·24시간 예상 적설·강수·확률·최저기온(확정 순간 값 저장), 기상현황 직접입력, 특보구역 관리 |
| 기관별 장비 | 기계화부(자기 기관), 관리자 | 장비 추가(도공번호), 블로워 소·대, 지원 여부 [지원] 단추, 날짜별 지원 지사·도착 시각, 숨기기·삭제, 운전원·정비원, [확정] |
| 기관별 배치 | 관리자(교통처) | 기관 → 지사 보낼 대수 배정, 배정/편성·배정/지원 가능 비교 |
| 강원본부 지원장비 | 관리자·강원본부 | 강원 신속대응팀 제설차 4대(원주·양양·대관령·강릉)를 요청 없이 지사로 |
| 로그 기록 | log.view 권한 | 변경 이력(audit_log) 조회 — 장비뿐 아니라 계정·관할·적설 올리기 기록도 보였음 |

흐름: ① 지사 요청 → 재난처 승인 ② 기계화부 지원 여부·지사 타지사 지원 가능 대수 → ③ 교통처 배정(합류) → 기계화부 장비 지정·도착 시간 → 이동 현황. 강원본부는 따로 직접 지원.
기준일자(support_rounds): 지원 회차. 모든 요청·편성·지원 여부·배정이 기준일자에 딸림. 위쪽 메뉴에 늘 보였고 관리자가 만들기·삭제.

## 3. 서버 구조 (2026-11-21 20:28 지움 — 마이그레이션 109, `supabase/migrations/20261121_109_drop_equipment.sql`)

### 표 9개 (지울 때 줄 수)
| 표 | 줄 | 열 |
|---|---|---|
| `support_rounds` 기준일자 | 1 | id, name, start_date, end_date, status, created_by, created_at, days, cols_equip, cols_team, day1_equip, day1_team |
| `round_requests` 지사 요청·편성 | 61 | round_id, branch_id, req_truck, req_blower, assigned_truck, assigned_blower, arrive_at, reason, confirmed, offer_truck, saved_at/by/lv, warn_level·warn_zones·warn_base·warn_at·warn_note(확정 순간 특보), fc_snow·fc_snow_hi·fc_pcp·fc_pcp_hi·fc_pop·fc_tmin·fc_tmin_at·fc_tmfc·fc_at(확정 순간 예보), wx_manual·wx_snow·wx_pcp·wx_level·wx_fc·wx_ef·wx_tmin·wx_tmin_at(직접입력), updated_by/at |
| `round_allocations` 기관별 배치 | 8 | round_id, org, branch_id, truck, blower, updated_by/at |
| `round_vehicle_status` 기준일자별 지원 여부·운전원 | 25 | round_id, vehicle_id, status('' 또는 'O'), off_from, crew(text[]), updated_by/at |
| `vehicles` 장비 | 11 | id, org, type(제설차·제설기·이동정비차), plate, status, sort, active, blower_s, blower_l, hidden_after, round_id·home_branch·rented(지역본부 장비), updated_by/at |
| `vehicle_routes` 날짜별 경로 | 0 | date, vehicle_id, stops(text[] 지사), times(text[] 도착 시각), revised, confirmed_by/at |
| `gw_team` 강원 신속대응팀 | 4 | id, name, sort |
| `gw_team_routes` 팀 날짜별 경로 | 0 | date, team_id, stops, times, revised, confirmed_by/at |
| `gw_team_status` 팀 지원 여부 | 4 | round_id, team_id, status, off_from, updated_by/at |

### 함수 27개
- 화면이 부르던 것: `create_round(date,int)`, `save_requests(bigint,jsonb)`, `save_fleet(jsonb,jsonb,bigint,jsonb,int,date)`, `save_allocations(bigint,jsonb)`, `save_gw_team(bigint,jsonb,jsonb,int,date)`
- 서버 안(private) 규칙·트리거: `governing_round`, `set_round_view`, `vehicle_avail`, `check_route`, `check_route_avail`, `route_alloc_cap`, `vehicle_routes_guard`, `vehicles_guard`, `vehicles_del_guard`, `vehicles_pool_guard`, `vehicles_pool_status`, `rounds_del_guard`, `rvs_check`, `alloc_follow_assign`, `round_requests_guard`, `round_requests_warn`(확정 순간 특보 남기기), `warn_kick_if_stale`, `warn_kick_on_round`(기준일자를 만들면 특보 새로 받기), `gw_route_check`, `gw_status_check`, `gw_team_carry`, `gw_team_round_del`
- 함께 쓰던 `private.stamp`(수정 시각), `private.audit_row`(변경 이력)는 다른 표도 써서 남김.
- 표를 만든 마이그레이션: 01·02(처음 표·보안), 16~21(장비 서버·저장), 33·35(직접입력·확정 잠금), 37·38·39(블로워·지원 여부·요청 잠금), 43~46(배치·지역본부 장비), 48·54·65(강원 팀), 49·50·53·55·56·59·63·64·66(경로·저장 규칙), 72(운전원), 94(지원일 칸 수). 파일은 `supabase/migrations/` 에 그대로 있음.

### 남긴 것 (다른 화면이 쓰거나 나중에 씀)
- 지사별 예보 값 `branch_forecast`(기관별 예보 화면), 계정·권한(`profiles`, `permissions` 의 equip.*·req.* 키, `equip_orgs`, 지원장비 계정 4개)
- 특보 수집 전부(`warnings_active`, `warning_zones`, `section_zones`, `branch_zone_overrides`, `zone_requests`, collect-warnings 함수·예약) — 사용자 "수집은 남겨. 강설량 현황 파악할 때 나중에 붙일 거야"
- 변경 이력 `audit_log`(장비 지원 기록 포함) — 보는 화면만 없어짐

## 4. 다시 만들 때
1. `git checkout 709deed -- equipment tests/test_equipment.py tests/test_equipment_crew.py tests/test_equipment_crew_core.js` 로 화면·시험을 되살린다.
2. 서버 표·함수는 위 마이그레이션 파일을 차례로 다시 적용하는 대신, 3의 열 목록으로 새 마이그레이션을 하나 만드는 편이 빠르다(중간에 바뀐 규칙이 많음).
3. 첫 화면 연결(index.html 위쪽 전환·메뉴, boot.js 페이지 전환)은 커밋 709deed 의 `index.html`·`boot.js` 를 참고해 다시 붙인다.
4. 예보·특보 값은 지금 서버 함수(`branch_forecast`, `warning_status`, `warning_active_list`, `branch_zone_list`)를 그대로 쓸 수 있다.
