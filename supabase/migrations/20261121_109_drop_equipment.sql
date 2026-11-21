-- 109. 장비 지원 서버 자료·함수 지우기. 2026-11-21 Claude Code, 사용자 "장비 지원 페이지를 없애고 md 로만, 서버도 장비 지원 자료는 보존할 필요 없어"
--  * 무엇이 있었는지(열 목록·함수·마이그레이션 번호)는 docs/equipment-archive.md 에 남김. 화면 코드는 Git 커밋 709deed.
--  * 지우는 것: 표 9개(기준일자·지사 요청·배치·지원 여부·장비·경로·강원 팀 3개, 그 위 규칙·트리거 포함), 이 표만 쓰는 함수 27개.
--  * 남기는 것: 특보 수집 전부(warnings_active·warning_zones·section_zones·branch_zone_overrides·zone_requests, 사용자 "수집은 남겨"),
--    계정·권한(profiles·permissions·equip_orgs), 변경 이력 audit_log(장비 지원 기록 포함), branch_forecast, 함께 쓰는 private.stamp·audit_row.
--  * 되돌릴 수 없음: 표 안의 자료(기준일자 1·요청 61·배치 8·지원 여부 25·장비 11·강원 팀 4·팀 지원 여부 4줄)는 지운 뒤 되살릴 수 없음.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

drop table public.gw_team_routes, public.gw_team_status, public.gw_team,
           public.vehicle_routes, public.round_vehicle_status, public.round_allocations, public.round_requests,
           public.vehicles, public.support_rounds;

drop function public.create_round(date, integer);
drop function public.save_requests(bigint, jsonb);
drop function public.save_fleet(jsonb, jsonb, bigint, jsonb, integer, date);
drop function public.save_allocations(bigint, jsonb);
drop function public.save_gw_team(bigint, jsonb, jsonb, integer, date);
drop function private.governing_round(date);
drop function private.set_round_view(bigint, text, integer, date);
drop function private.vehicle_avail(text, date);
drop function private.check_route();
drop function private.check_route_avail();
drop function private.route_alloc_cap();
drop function private.vehicle_routes_guard();
drop function private.vehicles_guard();
drop function private.vehicles_del_guard();
drop function private.vehicles_pool_guard();
drop function private.vehicles_pool_status();
drop function private.rounds_del_guard();
drop function private.rvs_check();
drop function private.alloc_follow_assign();
drop function private.round_requests_guard();
drop function private.round_requests_warn();
drop function private.warn_kick_if_stale();
drop function private.warn_kick_on_round();
drop function private.gw_route_check();
drop function private.gw_status_check();
drop function private.gw_team_carry();
drop function private.gw_team_round_del();
commit;
