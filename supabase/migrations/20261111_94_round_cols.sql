-- 94. 지원일 칸 수·지원일 1을 기준일자마다 저장(관리자·강원본부가 [확정]할 때 함께). 2026-11-11 Claude Code.
--  사용자(2026-11-11): "지원일 칸 수도 관리자가 늘리고 줄인 다음 저장을 누르면 그 칸수만큼만 나머지 아이디에서 볼 수 있었으면" /
--   "지원일 칸 수도 변경사항으로 만들어 확정과 함께 저장되게 해줘. 단, 강원본부 지원장비에서만 강원본부도 지원일 칸을 조정할 수 있게…
--    기관별 장비에서 강원본부가 지원일 칸을 조정할 수 없게" / "모든 작업은 오류가 있으면 안돼" /
--   "지원일 1 수정시에도 변경내용으로 확정 가능하도록 해줘".
--  * support_rounds.cols_equip·cols_team: 지원일 칸 수(2~10, 처음 4 = 지금 모든 아이디가 보는 칸 수)
--    day1_equip·day1_team: 지원일 1 날짜(없으면 기준일자 첫날 = 지금과 같음). 기준일자 기간(첫날 ~ 첫날 + days - 1) 안에서만.
--    equip = 기관별 장비, team = 강원본부 지원장비(따로 저장).
--  * private.set_round_view(기준일자, 'equip'|'team', 칸 수, 지원일 1): 준 것만 고침(null = 그대로). equip = 지원일 칸을 고치는 권한(equip.route, 관리자),
--    team = 강원 신속대응팀을 고치는 아이디(private.gw_team_editor: 관리자·강원본부). 바뀔 때만 고침(수정 기록에 남음).
--  * save_fleet·save_gw_team 에 p_cols·p_day1(없으면 그대로) — [확정] 한 번에 경로·지원 여부와 함께 저장(하나라도 안 되면 전부 취소).
--    칸 수·지원일 1만 바꾼 [확정]도 됨. 그 밖의 검사·동작은 그대로.
begin;

do $g$ begin
  if md5(pg_get_functiondef('public.save_fleet(jsonb, jsonb, bigint, jsonb)'::regprocedure)) <> 'a78d2188cb7dedb3c5909ad585ba0fae'
  or md5(pg_get_functiondef('public.save_gw_team(bigint, jsonb, jsonb)'::regprocedure)) <> '88493175ffd713ed48203badc88f8ef2'
  then raise exception '94: 저장 함수가 예상과 다름(다른 곳에서 바뀜) — 중단'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'support_rounds' and column_name in ('cols_equip', 'cols_team', 'day1_equip', 'day1_team'))
  then raise exception '94: 이미 있음 — 중단'; end if;
end $g$;

alter table public.support_rounds
  add column cols_equip integer not null default 4 check (cols_equip between 2 and 10),
  add column cols_team  integer not null default 4 check (cols_team between 2 and 10),
  add column day1_equip date,
  add column day1_team  date;
comment on column public.support_rounds.cols_equip is '기관별 장비 지원일 칸 수(관리자가 [확정]으로 정함, 모든 아이디가 이만큼 봄)';
comment on column public.support_rounds.cols_team is '강원본부 지원장비 지원일 칸 수(관리자·강원본부가 [확정]으로 정함)';
comment on column public.support_rounds.day1_equip is '기관별 장비 지원일 1 날짜(없으면 기준일자 첫날)';
comment on column public.support_rounds.day1_team is '강원본부 지원장비 지원일 1 날짜(없으면 기준일자 첫날)';

create or replace function private.set_round_view(p_round bigint, p_kind text, p_cols integer, p_day1 date) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.support_rounds;
begin
  if p_cols is null and p_day1 is null then return; end if;
  if p_kind = 'equip' then
    if not (select private.has_perm('equip.route')) then raise exception 'view: equip.route required' using errcode = '42501'; end if;
  elsif p_kind = 'team' then
    if not (select private.gw_team_editor()) then raise exception 'view: only the admin or the Gangwon HQ' using errcode = '42501'; end if;
  else raise exception 'bad kind' using errcode = '22023'; end if;
  select * into r from public.support_rounds where id = p_round;
  if not found then raise exception 'unknown round' using errcode = '23503'; end if;
  if p_cols is not null and p_cols not between 2 and 10 then raise exception 'cols must be 2..10' using errcode = '22023'; end if;
  if p_day1 is not null and (p_day1 < r.start_date or p_day1 > r.start_date + (coalesce(r.days, 10) - 1)) then
    raise exception 'day1 must be within the round' using errcode = '23514';
  end if;
  if p_kind = 'equip' then
    update public.support_rounds set cols_equip = coalesce(p_cols, cols_equip), day1_equip = coalesce(p_day1, day1_equip)
     where id = p_round and (cols_equip, day1_equip) is distinct from (coalesce(p_cols, cols_equip), coalesce(p_day1, day1_equip));
  else
    update public.support_rounds set cols_team = coalesce(p_cols, cols_team), day1_team = coalesce(p_day1, day1_team)
     where id = p_round and (cols_team, day1_team) is distinct from (coalesce(p_cols, cols_team), coalesce(p_day1, day1_team));
  end if;
end $$;
revoke all on function private.set_round_view(bigint, text, integer, date) from public, anon;
grant execute on function private.set_round_view(bigint, text, integer, date) to authenticated;      -- save_fleet·save_gw_team(부른 아이디 권한으로 실행)이 부름. 권한 검사는 함수 안에서

-- 고칠 곳마다 정확히 한 번 있어야 바꿈(아니면 전부 중단). 바꾼 정의로 다시 만들고 실행 권한을 예전대로(authenticated·service_role)
create or replace function pg_temp.patch_fn(p_sig text, p_pairs text[]) returns text language plpgsql as $f$
declare d text := pg_get_functiondef(p_sig::regprocedure); i int;
begin
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(d) - length(replace(d, p_pairs[2*i-1], ''))) <> length(p_pairs[2*i-1]) then raise exception '94: % 바꿀 곳 %번이 한 군데가 아님', p_sig, i; end if;
    d := replace(d, p_pairs[2*i-1], p_pairs[2*i]);
  end loop;
  return d;
end $f$;

do $p$ declare d text;
begin
  d := pg_temp.patch_fn('public.save_fleet(jsonb, jsonb, bigint, jsonb)', array[
    $x$p_status jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb$x$, $x$p_status jsonb DEFAULT '[]'::jsonb, p_cols integer DEFAULT NULL::integer, p_day1 date DEFAULT NULL::date)
 RETURNS jsonb$x$,
    $x$jsonb_array_length(p_vehicles) + jsonb_array_length(p_routes) + jsonb_array_length(p_status) = 0 then raise exception 'nothing to save'$x$,
    $x$jsonb_array_length(p_vehicles) + jsonb_array_length(p_routes) + jsonb_array_length(p_status) = 0 and p_cols is null and p_day1 is null then raise exception 'nothing to save'$x$,
    $x$if jsonb_array_length(p_routes) + jsonb_array_length(p_status) > 0 then$x$,
    $x$if jsonb_array_length(p_routes) + jsonb_array_length(p_status) > 0 or p_cols is not null or p_day1 is not null then$x$,
    $x$  end if;
  for r in select * from jsonb_array_elements(p_vehicles) loop$x$,
    $x$  end if;
  perform private.set_round_view(p_round, 'equip', p_cols, p_day1);      -- 94: 지원일 칸 수·지원일 1(준 것만)
  for r in select * from jsonb_array_elements(p_vehicles) loop$x$]);
  drop function public.save_fleet(jsonb, jsonb, bigint, jsonb);
  execute d;

  d := pg_temp.patch_fn('public.save_gw_team(bigint, jsonb, jsonb)', array[
    $x$p_status jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb$x$, $x$p_status jsonb DEFAULT '[]'::jsonb, p_cols integer DEFAULT NULL::integer, p_day1 date DEFAULT NULL::date)
 RETURNS jsonb$x$,
    $x$jsonb_array_length(p_routes) + jsonb_array_length(p_status) = 0 then raise exception 'nothing to save'$x$,
    $x$jsonb_array_length(p_routes) + jsonb_array_length(p_status) = 0 and p_cols is null and p_day1 is null then raise exception 'nothing to save'$x$,
    $x$then raise exception 'unknown round' using errcode = '23503'; end if;
$x$,
    $x$then raise exception 'unknown round' using errcode = '23503'; end if;
  perform private.set_round_view(p_round, 'team', p_cols, p_day1);      -- 94: 지원일 칸 수·지원일 1(준 것만)
$x$]);
  drop function public.save_gw_team(bigint, jsonb, jsonb);
  execute d;
end $p$;
revoke all on function public.save_fleet(jsonb, jsonb, bigint, jsonb, integer, date), public.save_gw_team(bigint, jsonb, jsonb, integer, date) from public, anon;
grant execute on function public.save_fleet(jsonb, jsonb, bigint, jsonb, integer, date), public.save_gw_team(bigint, jsonb, jsonb, integer, date) to authenticated, service_role;

commit;
