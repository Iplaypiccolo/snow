-- 83. 새 예보 알림만 작게 확인(계획 docs/forecast-fix-plan-20261109.md 3단계). 2026-11-09 Claude Code. 사용자 SQL 확인 후 적용.
--  격자 창·일별 창은 자료를 한 번 받아 두고, 10분마다 이 함수(응답 약 0.1KB)로 바뀌었는지만 본 뒤 바뀐 때만 다시 받는다.
--  c: 격자 창(forecast_cell_detail) 값을 바꾸는 것 — 24시간 계산 갱신 시각(초단기 10분·단기·매시 이동), 최신 단기 발표, 받는 중인 시각 수, 지금 시(時)
--  d: 일별 창(forecast_daily_cell) 값을 바꾸는 것 — 일별 날씨·중기·일별 기온 갱신 시각, 지금 시(時)(날짜·보관 기간이 시간에 따라 바뀜)
--  읽기만 함. 표·자료를 바꾸지 않음. 로그인 사용자만.
begin;
create function public.forecast_version() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.forecast_runs; h text := to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDDHH24');
begin
  if (select private.my_role()) is null then raise exception 'login required' using errcode = '42501'; end if;
  select * into r from public.forecast_runs order by tmfc desc limit 1;
  return jsonb_build_object(
    'c', concat_ws('.', h,
      floor(extract(epoch from (select max(f.updated_at) from public.forecast_cells f)))::bigint,
      floor(extract(epoch from r.tmfc))::bigint,
      case when r.tmfc is not null and r.done_at is null then (select count(*) from public.forecast_hours x where x.tmfc = r.tmfc) end),
    'd', concat_ws('.', h,
      floor(extract(epoch from greatest(
        (select max(w.updated_at) from private.forecast_daily_weather_cache w),
        (select max(m.updated_at) from private.forecast_midterm_cache m),
        (select max(a.updated_at) from private.forecast_daily_aux_hours a))))::bigint));
end $$;
revoke all on function public.forecast_version() from public, anon;
grant execute on function public.forecast_version() to authenticated;
commit;
