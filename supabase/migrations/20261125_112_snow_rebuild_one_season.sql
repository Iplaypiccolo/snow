-- ============================================================
-- 112. 적설 요약본: 하루치를 넣을 때 그 날짜의 시즌 하나만 다시 만듦 (2026-11-25 Claude Code — 버그 수정)
--  * 증상: 2026-11-17 부터 연도별 신적설 26-27 시즌 표가 11/16 에서 멈춤(원자료 snow_daily 는 11/24 까지 정상).
--  * 원인: snow_finish → admin_rebuild_snow_snapshot() 이 매번 10개 시즌(약 66만 값)을 처음부터 다시 계산.
--    핵심 계산만 6.9초(2026-11-25 실측)라 서버 API 의 시간 제한(약 8초)을 넘겨 'statement timeout' 으로 취소됨.
--    취소되면 snow_finish 전체가 되돌려져 수집 기록(collector_runs·snow_uploads)도 남지 않았음.
--  * 고침: 계산 부분을 private.snow_rebuild(p_y) 로 옮김. p_y = 시즌 시작 해(2026 = 2026-27 시즌), null = 모든 시즌.
--    - snow_finish 는 그 날짜의 시즌 하나만(26-27 시즌 실측 0.07초). 목록('snow')은 다른 시즌 줄을 그대로 두고 그 시즌 줄만 바꿈
--    - admin_rebuild_snow_snapshot() 은 예전처럼 모든 시즌(관측소 목록 stations 를 바꿨을 때 SQL 편집기에서 손으로 — API 로 부르면 시간 초과)
--  * 계산 규칙(시즌 = 첫눈~마지막 눈, 진행 중 표시, partial 등)은 47 과 똑같음. 이름·권한·화면이 읽는 모양도 그대로.
-- ============================================================
create or replace function private.snow_rebuild(p_y int) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare n_seasons int; n_values int; n_changed int := 0; idx jsonb; r record; old jsonb; lbl text;
        today date := (now() at time zone 'Asia/Seoul')::date;
begin
  -- 시즌 하나만 다시 만들 때 목록('snow')이 예전 모양(version 3 가 아님)이면 모든 시즌을 다시 만듦
  if p_y is not null then
    select body into old from public.snapshots where key = 'snow';
    if old is null or jsonb_typeof(old -> 'seasons') is distinct from 'array' then return private.snow_rebuild(null); end if;
    lbl := p_y || '-' || lpad(((p_y + 1) % 100)::text, 2, '0');
  end if;

  drop table if exists _ss;
  create temp table _ss on commit drop as
  with v as (                                    -- 관할 관측소(260곳)의 수집 기간 값 (p_y 가 있으면 그 시즌 기간만)
    select s.date, s.station_id, s.value,
           case when extract(month from s.date) >= 11 then extract(year from s.date)::int else extract(year from s.date)::int - 1 end as y
    from public.snow_daily s
    where private.snow_in_season(s.date) and exists (select 1 from public.stations t where t.id = s.station_id)
      and (p_y is null or s.date between make_date(p_y, 11, 1) and make_date(p_y + 1, 4, 30))
  ), b as (                                      -- 시즌 기간: 첫눈 ~ 마지막 눈(진행 중이면 자료가 있는 마지막 날)
    select y, today between make_date(y, 11, 1) and make_date(y + 1, 4, 30) as ongoing,
           min(date) filter (where value >= 0.1) as d0, max(date) filter (where value >= 0.1) as d_last, max(date) as d_data
    from v group by y
  ), bb as (
    select y, ongoing, d0, case when ongoing then d_data else d_last end as d1 from b where d0 is not null
  ), days as (
    select bb.y, g::date as date, row_number() over (partition by bb.y order by g) as i
    from bb, generate_series(bb.d0, bb.d1, interval '1 day') g
  ), vals as (
    select d.y, v.station_id, d.i, v.value from v join days d on d.date = v.date
  ), st as (                                     -- 시즌·관측소별 값 배열(날짜 순서, 없는 날은 null)
    select x.y, x.station_id, jsonb_agg(z.value order by dd.i) as arr
    from (select distinct y, station_id from vals) x
    join days dd on dd.y = x.y
    left join vals z on z.y = x.y and z.station_id = x.station_id and z.i = dd.i
    group by x.y, x.station_id
  )
  select bb.y, bb.y || '-' || lpad(((bb.y + 1) % 100)::text, 2, '0') as label, bb.d0, bb.d1, bb.ongoing,
    jsonb_build_object(
      'dates', (select jsonb_agg(to_char(date, 'YYYYMMDD') order by i) from days where days.y = bb.y),
      'st', coalesce((select jsonb_object_agg(station_id::text, arr) from st where st.y = bb.y), '{}'::jsonb)) as body,
    (select count(*) from days where days.y = bb.y)::int as n_days,
    (select count(distinct i) from vals where vals.y = bb.y)::int as n_data_days,
    (select count(*) from st where st.y = bb.y)::int as n_stations,
    (select jsonb_agg(to_char(c.date, 'YYYYMMDD') order by c.date) from public.snow_collect c
      where c.date between greatest(bb.d0, today - 3) and bb.d1 and cardinality(c.hours) < 24) as partial
  from bb;

  for r in select * from _ss loop
    insert into public.snapshots (key, version, built_at, body) values ('snow:' || r.label, 1, now(), r.body)
      on conflict (key) do update set version = public.snapshots.version + 1, built_at = now(), body = excluded.body
      where public.snapshots.body is distinct from excluded.body;
    if found then n_changed := n_changed + 1; end if;
  end loop;

  -- 목록 줄: 이번에 만든 시즌 + (시즌 하나만이면) 목록에 있던 다른 시즌 줄 그대로
  select coalesce(jsonb_agg(e order by e ->> 'label'), '[]'::jsonb), count(*) into idx, n_seasons from (
    select jsonb_build_object('label', label, 'start', to_char(d0, 'YYYYMMDD'), 'end', to_char(d1, 'YYYYMMDD'), 'ongoing', ongoing,
           'days', n_days, 'data_days', n_data_days, 'stations', n_stations, 'partial', partial) as e from _ss
    union all
    select e from jsonb_array_elements(case when p_y is null then '[]'::jsonb else old -> 'seasons' end) e where e ->> 'label' <> lbl
  ) q;

  -- 목록에 없는 시즌 요약본 지우기(모든 시즌이면 목록 밖 전부, 시즌 하나면 그 시즌에 눈이 하나도 없을 때 그 시즌만)
  delete from public.snapshots s where s.key like 'snow:%'
    and substr(s.key, 6) not in (select e ->> 'label' from jsonb_array_elements(idx) e)
    and (p_y is null or s.key = 'snow:' || lbl);

  insert into public.snapshots (key, version, built_at, body) values ('snow', 3, now(), jsonb_build_object('version', 3, 'seasons', idx))
    on conflict (key) do update set version = public.snapshots.version + 1, built_at = now(), body = excluded.body
    where public.snapshots.body is distinct from excluded.body;

  select count(*) into n_values from public.snow_daily;
  insert into public.audit_log (username, kind, tab, target, to_val)
    values ('collect-snow', '적설요약갱신', 'snapshots', 'snapshots:snow',
            jsonb_build_object('seasons', n_seasons, 'changed', n_changed, 'values', n_values, 'only', lbl));
  return jsonb_build_object('seasons', n_seasons, 'changed', n_changed, 'values', n_values, 'only', lbl);
end $$;
revoke all on function private.snow_rebuild(int) from public, anon, authenticated;

-- 모든 시즌 다시 만들기(이름·권한 그대로). 오래 걸리므로 SQL 편집기에서 손으로만
create or replace function public.admin_rebuild_snow_snapshot() returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin return private.snow_rebuild(null); end $$;
revoke all on function public.admin_rebuild_snow_snapshot() from public, anon, authenticated;
grant execute on function public.admin_rebuild_snow_snapshot() to service_role;

-- 하루를 마칠 때: 새 값이 있었거나 하루를 다 받았으면 그 날짜의 시즌 요약본만 다시 만들기 + 수집 기록 (47 과 다른 곳은 첫 줄뿐)
create or replace function public.snow_finish(p_date date, p_hours int, p_written int, p_note text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r jsonb := null;
begin
  if p_written > 0 or p_hours = 24 then
    r := private.snow_rebuild(case when extract(month from p_date) >= 11 then extract(year from p_date)::int else extract(year from p_date)::int - 1 end);
  end if;
  insert into public.snow_uploads (date_from, date_to, stations, rows_written, ok, note)
    values (p_date, p_date, null, p_written, p_hours = 24, left(p_note, 300));
  insert into public.collector_state as s (job, cursor, started_at, finished_at, ok, note) values ('snow', to_char(p_date, 'YYYYMMDD'), now(), now(), p_hours = 24, left(p_note, 500))
  on conflict (job) do update set cursor = excluded.cursor, finished_at = now(), ok = excluded.ok, note = excluded.note;
  insert into public.collector_runs (job, started_at, finished_at, ok, calls, error) values ('snow', now(), now(), p_hours = 24, p_hours, case when p_hours = 24 then null else left(p_note, 500) end);
  delete from public.collector_runs where job = 'snow' and started_at < now() - interval '30 days';
  return jsonb_build_object('snapshot', r);
end $$;
revoke all on function public.snow_finish(date, int, int, text) from public, anon, authenticated;
grant execute on function public.snow_finish(date, int, int, text) to service_role;

-- 11/17 부터 멈춘 요약본을 지금 한 번 모두 다시 만듦(이 파일을 SQL 편집기·관리 도구로 적용할 때는 시간 제한이 넉넉함)
select public.admin_rebuild_snow_snapshot();
