-- 90. 기관별 예보 지도 칸에 24시간 최고 습도. 2026-11-10 Claude Code.
--  사용자 지시(2026-11-10 "기관별 예보 범례에 최대 습도도 추가해줘. 최대 습도도 두 줄로 적어줘").
--  forecast_grid 의 격자마다 12번째 값 = 24시간 창(가까운 24시간 표와 같은 시각) 중 최고 습도(%).
--  가까운 6시각은 초단기 습도(24시간 계산·격자 창과 같은 기준의 최신 완성 발표), 나머지는 단기 습도(시각마다 가장 최근 발표).
--  예전 11개 값은 그대로(화면이 모르는 값이 하나 더 붙을 뿐). 되돌린 시험: 8개 지사 142칸 0.15초(예전 함수와 비슷).
begin;

do $g$ begin
  if md5(pg_get_functiondef('public.forecast_grid(text[],boolean)'::regprocedure)) <> 'c1c8f399c0de451819a38f35528b73aa'
  then raise exception '90: 함수가 예상과 다름(다른 곳에서 바뀜) — 중단'; end if;
end $g$;

create or replace function public.forecast_grid(p_branches text[], p_series boolean DEFAULT false)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare res jsonb; v_start timestamptz;
begin
  if (select private.my_role()) is null then raise exception 'login required' using errcode = '42501'; end if;
  if p_branches is null or cardinality(p_branches) = 0 or cardinality(p_branches) > 30 then raise exception 'bad branches' using errcode = '22023'; end if;
  if p_series and cardinality(p_branches) > 1 then raise exception 'series for one branch only' using errcode = '22023'; end if;
  select (b.detail ->> 'start_at')::timestamptz into v_start from public.branch_forecast b order by b.issued_at desc limit 1;
  with g as materialized (
    select e.nx, e.ny, jsonb_agg(e.branch_id order by e.branch_id) as bs
      from private.grid_effective() e where e.branch_id = any(p_branches) group by e.nx, e.ny),
  -- 90: 24시간 최고 습도. 단기: 시각마다 습도가 있는 가장 최근 발표 하나
  ah as materialized (
    select distinct on (a.tmef) a.tmfc, a.tmef, a.vals from private.forecast_daily_aux_hours a
     where a.var = 'REH' and not a.is_empty and a.tmef between v_start and v_start + interval '23 hours' and a.tmfc >= now() - interval '48 hours'
     order by a.tmef, a.tmfc desc),
  rc as materialized (
    select r.tmfc, j.ordinality::int i, g.nx, g.ny from public.forecast_runs r cross join lateral jsonb_array_elements(r.cells) with ordinality j
      join g on g.nx = (j.value->>0)::int and g.ny = (j.value->>1)::int where r.tmfc in (select distinct tmfc from ah)),
  aux as (select rc.nx, rc.ny, ah.tmef, ah.vals[rc.i] v from ah join rc on rc.tmfc = ah.tmfc where ah.vals[rc.i] between 0 and 100),
  -- 초단기: 24시간 계산(fc_apply)과 같은 기준의 최신 완성 발표
  vr as (select v.tmfc, v.cells from public.forecast_vsrt_runs v
          where v.done_at is not null and v.tmfc > now() - interval '3 hours'
            and not exists (select 1 from public.forecast_vsrt_hours z where z.tmfc = v.tmfc and z.var = 'T1H' and not exists (select 1 from unnest(z.vals) q where q > -90 and q <> 0))
          order by v.tmfc desc limit 1),
  vc as materialized (select j.ordinality::int i, g.nx, g.ny from vr cross join lateral jsonb_array_elements(vr.cells) with ordinality j join g on g.nx = (j.value->>0)::int and g.ny = (j.value->>1)::int),
  vs as (select vc.nx, vc.ny, h.tmef, h.vals[vc.i] v from vr join public.forecast_vsrt_hours h on h.tmfc = vr.tmfc and h.var = 'REH' cross join vc
          where h.tmef between v_start and v_start + interval '23 hours' and h.vals[vc.i] between 0 and 100),
  hm as (select coalesce(vs.nx, aux.nx) nx, coalesce(vs.ny, aux.ny) ny, max(coalesce(vs.v, aux.v)) hmax
          from aux full join vs on vs.nx = aux.nx and vs.ny = aux.ny and vs.tmef = aux.tmef group by 1, 2)
  select jsonb_build_object(
    'tmfc', (select max(issued_at) from public.forecast_cells),
    'start_at', (select detail ->> 'start_at' from public.branch_forecast order by issued_at desc limit 1),
    'end_at', (select detail ->> 'end_at' from public.branch_forecast order by issued_at desc limit 1),
    'cells', coalesce(jsonb_agg(jsonb_build_array(g.nx, g.ny, g.bs,
               case when ok then c.snow_24h end, case when ok then c.pcp_24h end,
               case when ok then c.tmin end, case when ok then c.tmin_at end,
               case when ok and p_series then c.series end,
               case when ok then c.pop_24h end,
               case when ok then c.pcp_hi end, case when ok then c.snow_hi end,
               case when ok then hm.hmax end) order by g.ny, g.nx), '[]'::jsonb))
    into res
    from g
    left join public.forecast_cells c on c.nx = g.nx and c.ny = g.ny
    left join hm on hm.nx = g.nx and hm.ny = g.ny
    cross join lateral (select c.issued_at >= now() - interval '12 hours' as ok) k;
  return res;
end $function$;

commit;
