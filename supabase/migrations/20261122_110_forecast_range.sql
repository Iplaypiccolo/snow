-- 110. 기관별 예보 기간 고르기(24시간·48시간·최대·기간 지정). 2026-11-22 Claude Code, 사용자 "72시간 대신 최대(62시간)", "기간 지정은 날짜와 시각으로".
--  * 지금 격자마다 가까운 24시간 값(forecast_cells.series)만 있음 → 25시간째부터 기상청 1시간 양 예보 끝(fc_quantity_end, 보통 2.5~3일 뒤)까지
--    시간별 값을 series_x 에 더 저장(fc_apply 끝에서 private.fc_apply_ext). 신적설은 칸 조회 소수(107)·'비/눈' 시각 '-'(106)과 같은 규칙.
--  * 고른 기간의 합·최저·최대: public.forecast_range(시작, 끝, 지사들) — 지사별 값(목록) + 고른 지사들의 격자별 값(지도, forecast_grid 와 같은 모양).
--    시작·끝 = 포함하는 첫·마지막 정시(값은 그 시각까지 1시간 양). 쓸 수 있는 범위 = 24시간 창 첫 시각 ~ series_x 끝.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '90s';
select pg_advisory_xact_lock(hashtext('ss_fc_apply'));

do $g$ begin
  if md5(pg_get_functiondef('private.fc_apply(timestamptz,timestamptz)'::regprocedure)) <> 'c3d5ee74cf43c44669db3fb71d585103'
  then raise exception '110: fc_apply 가 예상과 다름 — 중단'; end if;
end $g$;

alter table public.forecast_cells add column if not exists series_x jsonb;      -- {start_at, s, p, t, r, sq, pq}: 25시간째(start_at)부터 1시간씩

create or replace function private.fc_apply_ext(p_tmfc timestamptz, p_start timestamptz) returns integer
language plpgsql security definer set search_path = '' as $f$
declare r public.forecast_runs; n int; v_from timestamptz := p_start + interval '24 hours';
begin
  select * into r from public.forecast_runs where tmfc = p_tmfc;
  if not found then return 0; end if;
  drop table if exists _fx;
  create temp table _fx on commit drop as
    with cell as (select (c.value ->> 0)::int as nx, (c.value ->> 1)::int as ny from jsonb_array_elements(r.cells) c),
    picked as materialized (select * from private.fc_hours(p_tmfc, v_from, p_start + interval '95 hours', false) q where q.quantity),
    qend as (select max(tmef) as e from picked),
    source_cells as materialized (
      select rr.tmfc, (c.value ->> 0)::int nx, (c.value ->> 1)::int ny, c.ordinality::int i
        from public.forecast_runs rr cross join lateral jsonb_array_elements(rr.cells) with ordinality c
       where exists (select 1 from picked q where q.tmfc = rr.tmfc)),
    pts as materialized (
      select ps.tmfc, ps.nx, ps.ny, ps.h, ps.last_at from private.point_snow ps
       where ps.h is not null and exists (select 1 from picked q where q.tmfc = ps.tmfc)),
    -- 시각마다 전국 값 묶음을 한 번만 풀어 칸 순번으로(칸마다 q.s[i] 로 꺼내면 묶음을 매번 다시 풀어 몇 초 걸림)
    un as materialized (
      select q.tmfc, q.tmef, u.i::int i, u.s, u.p, u.t, u.o, u.y
        from picked q cross join lateral unnest(q.s, q.p, q.t, q.o, q.y) with ordinality u(s, p, t, o, y, i)),
    cu as materialized (select un.*, sc.nx, sc.ny from un join source_cells sc on sc.tmfc = un.tmfc and sc.i = un.i),
    hh as (
      select cell.nx, cell.ny, h.tmef,
             case when pt.tmfc is not null and h.tmef <= pt.last_at then greatest(coalesce((pt.h ->> floor(extract(epoch from h.tmef))::bigint::text)::double precision, 0), 0)
                  when cu.s is not null then greatest(cu.s, 0) end::double precision s,
             case when pt.tmfc is not null and h.tmef <= pt.last_at then greatest(-coalesce((pt.h ->> floor(extract(epoch from h.tmef))::bigint::text)::double precision, 0), 0) end::double precision sl,
             case when cu.p is not null then greatest(cu.p, 0) end::double precision p,
             case when cu.t > -90 then cu.t end::double precision t,
             case when cu.o >= 0 then least(cu.o, 100) end::int o,
             case when cu.y >= 0 then cu.y end::int y
        from cell cross join qend cross join generate_series(v_from, qend.e, interval '1 hour') h(tmef)
        left join cu on cu.nx = cell.nx and cu.ny = cell.ny and cu.tmef = h.tmef
        left join pts pt on pt.tmfc = cu.tmfc and pt.nx = cell.nx and pt.ny = cell.ny)
    select nx, ny, jsonb_build_object('start_at', v_from,
             's', jsonb_agg(round(s::numeric, 1) order by tmef), 'p', jsonb_agg(round(p::numeric, 1) order by tmef),
             't', jsonb_agg(round(t::numeric, 1) order by tmef), 'r', jsonb_agg(o order by tmef),
             'sq', jsonb_agg(case when sl is not null then sl when s = 0 and coalesce(y, 0) = 3 then 1 else 0 end order by tmef),   -- 106·107 과 같은 '~' 위쪽 폭
             'pq', jsonb_agg(case when p = 0 and coalesce(y, 0) > 0 then 1 else 0 end order by tmef)) as x
      from hh group by nx, ny;
  update public.forecast_cells f set series_x = x.x from _fx x where x.nx = f.nx and x.ny = f.ny and f.series_x is distinct from x.x;
  get diagnostics n = row_count;
  update public.forecast_cells f set series_x = null where f.series_x is not null and not exists (select 1 from _fx x where x.nx = f.nx and x.ny = f.ny);
  return n;
end $f$;
revoke all on function private.fc_apply_ext(timestamptz, timestamptz) from public, anon, authenticated;

-- fc_apply 끝에서 series_x 도 함께
do $p$
declare d text := pg_get_functiondef('private.fc_apply(timestamptz,timestamptz)'::regprocedure);
        a text := '  return true;' || chr(13) || chr(10) || 'end';
        b text := '  perform private.fc_apply_ext(p_tmfc, p_start);      -- 110: 25시간째~양 예보 끝 시간별 값(기간 합용)' || chr(13) || chr(10) || '  return true;' || chr(13) || chr(10) || 'end';
begin
  if (length(d) - length(replace(d, a, ''))) <> length(a) then raise exception '110: fc_apply 끝을 한 군데로 찾지 못함'; end if;
  execute replace(d, a, b);
end $p$;

-- 기간 합 계산(캐시 없이). p_from·p_to = 포함하는 첫·마지막 정시. p_branches 가 있으면 그 지사들의 격자별 값도
create or replace function private.forecast_range_calc(p_from timestamptz, p_to timestamptz, p_branches text[])
returns jsonb language plpgsql security definer set search_path = '' as $f$
declare v_start timestamptz; v_last timestamptz; i0 int; i1 int; res jsonb; cells jsonb := null;
begin
  if (select private.my_role()) is null then raise exception 'login required' using errcode = '42501'; end if;
  select (b.detail ->> 'start_at')::timestamptz into v_start from public.branch_forecast b order by b.issued_at desc, b.updated_at desc limit 1;
  if v_start is null then return jsonb_build_object('status', 'no_data'); end if;
  select coalesce(max((f.series_x ->> 'start_at')::timestamptz + (jsonb_array_length(f.series_x -> 's') - 1) * interval '1 hour'), v_start + interval '23 hours')
    into v_last from public.forecast_cells f where f.series_x is not null and (f.series_x ->> 'start_at')::timestamptz = v_start + interval '24 hours';
  -- 비우면 처음·끝(최대), 쓸 수 있는 범위를 넘으면 그 끝으로 자름(돌려주는 from·to 가 실제 기간)
  p_from := greatest(coalesce(p_from, v_start), v_start); p_to := least(coalesce(p_to, v_last), v_last);
  if p_from <> date_trunc('hour', p_from) or p_to <> date_trunc('hour', p_to) or p_to < p_from
     or (p_branches is not null and (cardinality(p_branches) = 0 or cardinality(p_branches) > 30)) then
    raise exception 'bad range' using errcode = '22023';
  end if;
  i0 := (extract(epoch from p_from - v_start) / 3600)::int; i1 := (extract(epoch from p_to - v_start) / 3600)::int;
  drop table if exists _fr;
  create temp table _fr on commit drop as
    with cv as materialized (
      select f.nx, f.ny,
             (f.series -> 's') || coalesce(f.series_x -> 's', '[]') s,
             coalesce(f.series -> 'sq', (select jsonb_agg(0) from generate_series(1, 24))) || coalesce(f.series_x -> 'sq', '[]') sq,
             (f.series -> 'p') || coalesce(f.series_x -> 'p', '[]') p,
             coalesce(f.series -> 'pq', (select jsonb_agg(0) from generate_series(1, 24))) || coalesce(f.series_x -> 'pq', '[]') pq,
             (f.series -> 't') || coalesce(f.series_x -> 't', '[]') t,
             coalesce(f.series -> 'r', (select jsonb_agg(null::int) from generate_series(1, 24))) || coalesce(f.series_x -> 'r', '[]') r
        from public.forecast_cells f
       where f.issued_at >= now() - interval '12 hours'
         and (f.series_x is null or (f.series_x ->> 'start_at')::timestamptz = v_start + interval '24 hours')),
    -- 칸마다 묶음을 한 번만 풀어 차례로(값 하나씩 ->> i 로 꺼내면 묶음을 매번 다시 풀어 수십 초)
    e as (
      select cv.nx, cv.ny, (z.n - 1)::int i, (z.s #>> '{}')::double precision s, coalesce((z.sq #>> '{}')::double precision, 0) sq,
             (z.p #>> '{}')::double precision p, coalesce((z.pq #>> '{}')::double precision, 0) pq,
             (z.t #>> '{}')::double precision t, (z.r #>> '{}')::int o
        from cv cross join lateral rows from (jsonb_array_elements(cv.s), jsonb_array_elements(cv.sq), jsonb_array_elements(cv.p),
                                               jsonb_array_elements(cv.pq), jsonb_array_elements(cv.t), jsonb_array_elements(cv.r)) with ordinality z(s, sq, p, pq, t, r, n)
       where z.n - 1 between i0 and i1)
    select nx, ny, round(sum(s)::numeric, 1)::double precision snow, round((sum(s) + sum(sq))::numeric, 1)::double precision snow_hi,
           round(sum(p)::numeric, 1)::double precision pcp, round((sum(p) + sum(pq))::numeric, 1)::double precision pcp_hi,
           max(o) pop, min(t) tmin, (array_agg(v_start + i * interval '1 hour' order by t, i) filter (where t is not null))[1] tmin_at
      from e group by nx, ny;
  -- 지사별(fc_apply 와 같은 규칙: 적설·강수는 가장 큰 격자, 위쪽 폭도 가장 큰 값, 최저기온은 가장 추운 격자)
  select coalesce(jsonb_agg(jsonb_build_object('branch_id', b.branch_id, 'issued_at', (select max(issued_at) from public.forecast_cells),
           'max_snow_24h', b.snow, 'max_snow_hi', b.snow_hi, 'max_pcp_24h', b.pcp, 'max_pcp_hi', b.pcp_hi, 'max_pop_24h', b.pop,
           'min_tmp', b.tmin, 'min_tmp_at', b.tmin_at)), '[]'::jsonb) into res
    from (select g.branch_id, max(x.snow) snow, max(x.snow_hi) snow_hi, max(x.pcp) pcp, max(x.pcp_hi) pcp_hi, max(x.pop) pop, min(x.tmin) tmin,
                 (array_agg(x.tmin_at order by x.tmin asc nulls last, x.tmin_at))[1] tmin_at
            from private.grid_effective() g join _fr x on x.nx = g.nx and x.ny = g.ny group by g.branch_id) b;
  if p_branches is not null then
    -- 격자별(지도·지사 격자 표): forecast_grid 와 같은 칸 순서 [nx, ny, 지사들, 적설, 강수, 최저, 최저 시각, null, 확률, 강수 위쪽, 적설 위쪽, 최고 습도]
    with g as materialized (
      select e.nx, e.ny, jsonb_agg(e.branch_id order by e.branch_id) bs from private.grid_effective() e where e.branch_id = any(p_branches) group by e.nx, e.ny),
    ah as materialized (
      select distinct on (a.tmef) a.tmfc, a.tmef, a.vals from private.forecast_daily_aux_hours a
       where a.var = 'REH' and not a.is_empty and a.tmef between p_from and p_to and a.tmfc >= now() - interval '48 hours'
       order by a.tmef, a.tmfc desc),
    rc as materialized (
      select r.tmfc, j.ordinality::int i, g.nx, g.ny from public.forecast_runs r cross join lateral jsonb_array_elements(r.cells) with ordinality j
        join g on g.nx = (j.value ->> 0)::int and g.ny = (j.value ->> 1)::int where r.tmfc in (select distinct tmfc from ah)),
    aux as (select rc.nx, rc.ny, ah.tmef, ah.vals[rc.i] v from ah join rc on rc.tmfc = ah.tmfc where ah.vals[rc.i] between 0 and 100),
    vr as (select v.tmfc, v.cells from public.forecast_vsrt_runs v
            where v.done_at is not null and v.tmfc > now() - interval '3 hours'
              and not exists (select 1 from public.forecast_vsrt_hours z where z.tmfc = v.tmfc and z.var = 'T1H' and not exists (select 1 from unnest(z.vals) q where q > -90 and q <> 0))
            order by v.tmfc desc limit 1),
    vc as materialized (select j.ordinality::int i, g.nx, g.ny from vr cross join lateral jsonb_array_elements(vr.cells) with ordinality j join g on g.nx = (j.value ->> 0)::int and g.ny = (j.value ->> 1)::int),
    vs as (select vc.nx, vc.ny, h.tmef, h.vals[vc.i] v from vr join public.forecast_vsrt_hours h on h.tmfc = vr.tmfc and h.var = 'REH' cross join vc
            where h.tmef between p_from and p_to and h.vals[vc.i] between 0 and 100),
    hm as (select coalesce(vs.nx, aux.nx) nx, coalesce(vs.ny, aux.ny) ny, max(coalesce(vs.v, aux.v)) hmax
             from aux full join vs on vs.nx = aux.nx and vs.ny = aux.ny and vs.tmef = aux.tmef group by 1, 2)
    select coalesce(jsonb_agg(jsonb_build_array(g.nx, g.ny, g.bs, x.snow, x.pcp, x.tmin, x.tmin_at, null, x.pop, x.pcp_hi, x.snow_hi, hm.hmax) order by g.ny, g.nx), '[]'::jsonb)
      into cells
      from g left join _fr x on x.nx = g.nx and x.ny = g.ny left join hm on hm.nx = g.nx and hm.ny = g.ny;
  end if;
  return jsonb_build_object('status', 'ok', 'from', p_from, 'to', p_to, 'start_at', v_start, 'last_at', v_last,
    'tmfc', (select max(issued_at) from public.forecast_cells), 'bf', res, 'cells', cells);
end $f$;
revoke all on function private.forecast_range_calc(timestamptz, timestamptz, text[]) from public, anon, authenticated;

-- 화면용(같은 예보·같은 기간은 서버에 10분 기억 — forecast_grid 와 같은 방식)
create or replace function public.forecast_range(p_from timestamptz, p_to timestamptz, p_branches text[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $f$
declare k text; v text; r jsonb;
begin
  if (select private.my_role()) is null then raise exception 'login required' using errcode = '42501'; end if;
  k := 'r:' || coalesce(extract(epoch from p_from)::bigint::text, '-') || ':' || coalesce(extract(epoch from p_to)::bigint::text, '-') || ':' || coalesce(p_branches::text, '');
  v := private.fc_cache_ver();
  r := private.fc_cache_hit(k, v); if r is not null then return r; end if;
  perform pg_advisory_xact_lock(hashtextextended(k, 93));
  r := private.fc_cache_hit(k, v); if r is not null then return r; end if;
  r := private.forecast_range_calc(p_from, p_to, p_branches);
  if r is not null and r ->> 'status' = 'ok' then perform private.fc_cache_put(k, v, r); end if;
  delete from private.fc_cache c where c.k like 'r:%' and c.at < now() - interval '1 hour';      -- 기간은 사람마다 달라 기억이 쌓이지 않게
  return r;
end $f$;
revoke all on function public.forecast_range(timestamptz, timestamptz, text[]) from public, anon;
grant execute on function public.forecast_range(timestamptz, timestamptz, text[]) to authenticated;

select private.fc_refresh();      -- 지금 예보로 series_x 바로 채움
delete from private.fc_cache where k like 'c:%' or k like 'r:%';
commit;
