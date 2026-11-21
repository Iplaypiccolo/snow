-- 107. 6시간 뒤 신적설 = 단기 칸 조회(getVilageFcst) 소수 값(연 지사 격자만). 2026-11-21 Claude Code, 사용자 "가 적용해".
--  * 근거: docs/forecast-snow-point-20261120.md — 날씨누리 6시간 뒤 신적설은 칸 조회 값 그대로('0.5cm미만' → '~0.5', 0.8, 1.4).
--    격자 자료는 정수뿐이라 칸 조회가 필요. 전국은 기상청 하루 한도(2만 회)를 넘으므로 "연 지사만"(사용자 11/19 결정).
--  * 받는 때: 지사를 열면(forecast_point_open) 바로, 그리고 최근 3일 안에 연 지사는 10분마다 확인해 새 단기 발표(02·05·…·23시) 11분 뒤부터 미리.
--    같은 발표·같은 칸은 한 번만. 실패한 칸은 3분 뒤 다시(발표마다 3번까지). 칸 조회는 하루 4,000번까지만(기상청 한도 보호).
--  * 쓰는 곳: fc_apply(가까운 24시간: 1시간 표·지도·지사 합) · forecast_cell_detail_calc(25시간째부터 1시간 표). 칸 조회 값이 없으면 지금처럼 격자 값.
--    series.sq 는 이제 '~' 위쪽 폭(0 / 1 = 격자 '1cm 미만' / 0.5 = 칸 조회 '0.5cm미만'), snow_hi = 합 + sq 합.
--  * 함께: 25시간째부터 1시간 표의 '비/눈' 시각 신적설도 '-'(106 과 같게).
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ss_fc_apply'));

do $g$ begin
  if md5(pg_get_functiondef('private.fc_apply(timestamptz,timestamptz)'::regprocedure)) <> '0af5e3f60114213a1a1bd5c890d1a690'
  then raise exception '107: fc_apply 가 예상과 다름(다른 곳에서 바뀜) — 중단'; end if;
  if md5(pg_get_functiondef('private.forecast_cell_detail_calc(integer,integer)'::regprocedure)) <> '9391472d080bb91ec3c60f51ff105b67'
  then raise exception '107: forecast_cell_detail_calc 가 예상과 다름 — 중단'; end if;
end $g$;

-- 칸 조회 신적설: 발표·칸마다 한 줄
create table private.point_snow (
  tmfc     timestamptz not null,                              -- 단기 발표 시각
  nx       smallint not null check (nx between 1 and 149),
  ny       smallint not null check (ny between 1 and 253),
  h        jsonb,                                             -- {"<시각 epoch 초>": cm} 눈이 있는 시각만. 음수 = 'x cm 미만'(-0.5 = 0.5cm미만). null = 아직 못 받음
  last_at  timestamptz,                                       -- 1시간 간격으로 받은 마지막 시각(그때까지 h 에 없는 시각 = 적설없음)
  tries    smallint not null default 0,
  tried_at timestamptz,
  primary key (tmfc, nx, ny));
-- 연 지사(최근 3일 안에 연 지사의 격자를 미리 받음)
create table private.point_want (
  branch_id text primary key,
  opened_at timestamptz not null default now());
-- 칸 조회 사용량(한국 날짜별)
create table private.point_usage (
  usage_day date primary key,
  calls int not null default 0,
  fails int not null default 0,
  bytes bigint not null default 0);
alter table private.point_snow enable row level security;
alter table private.point_want enable row level security;
alter table private.point_usage enable row level security;
revoke all on private.point_snow, private.point_want, private.point_usage from public, anon, authenticated;

-- 지금 칸 조회로 받을 단기 발표(02·05·08·11·14·17·20·23시, 발표 11분 뒤부터)
create or replace function private.point_tmfc() returns timestamptz
language sql stable set search_path = '' as $f$
  select (date_trunc('hour', k) - make_interval(hours => (extract(hour from k)::int + 1) % 3)) at time zone 'Asia/Seoul'
    from (select (now() - interval '11 minutes') at time zone 'Asia/Seoul' as k) x
$f$;

-- 받을 칸: 최근 3일 안에 연 지사의 격자 중 이번 발표 값이 없는 칸(최근 연 지사부터). 오늘 4,000번을 넘으면 없음
create or replace function private.point_targets(p_limit int, p_branch text default null)
returns table (nx int, ny int)
language sql stable security definer set search_path = '' as $f$
  with t as (select private.point_tmfc() as t),
  w as (select g.nx, g.ny, max(pw.opened_at) as o
          from private.point_want pw join private.grid_effective() g on g.branch_id = pw.branch_id
         where pw.opened_at > now() - interval '3 days' and (p_branch is null or pw.branch_id = p_branch)
         group by g.nx, g.ny)
  select w.nx, w.ny from w cross join t
    left join private.point_snow ps on ps.tmfc = t.t and ps.nx = w.nx and ps.ny = w.ny
   where ps.h is null and coalesce(ps.tries, 0) < 3 and (ps.tried_at is null or ps.tried_at < now() - interval '3 minutes')
     and coalesce((select u.calls from private.point_usage u where u.usage_day = (now() at time zone 'Asia/Seoul')::date), 0) < 4000
   order by w.o desc, w.ny, w.nx
   limit p_limit
$f$;

-- 수집 함수 부르기(받을 칸이 있을 때만, 3분 안에 다시 부르지 않음)
create or replace function private.kick_point() returns bigint
language plpgsql security definer set search_path = '' as $f$
begin
  if not exists (select 1 from private.point_targets(1)) then return null; end if;
  if coalesce((select started_at from public.collector_state where job = 'forecast_point_kick'), 'epoch') > now() - interval '3 minutes' then return 0; end if;
  insert into public.collector_state as s (job, started_at) values ('forecast_point_kick', now())
  on conflict (job) do update set started_at = now();
  return net.http_post(
    url := 'https://yzwbnohzhnctdvufntig.supabase.co/functions/v1/collect-forecast',
    body := '{"point":true}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-collector-token', (select token from private.collector_token where id = 1)),
    timeout_milliseconds := 150000);
end $f$;

-- 화면: 지사를 열면 부름 → 연 지사로 기억하고, 이번 발표 칸 조회가 없으면 받기 시작. pending = 받는 중
create or replace function public.forecast_point_open(p_branch text) returns jsonb
language plpgsql security definer set search_path = '' as $f$
begin
  if (select private.my_role()) is null then raise exception 'login required' using errcode = '42501'; end if;
  if p_branch is null or not exists (select 1 from private.grid_effective() g where g.branch_id = p_branch) then
    return jsonb_build_object('ok', false);
  end if;
  insert into private.point_want as w (branch_id, opened_at) values (p_branch, now())
  on conflict (branch_id) do update set opened_at = now() where w.opened_at < now() - interval '1 minute';
  if not exists (select 1 from private.point_targets(1, p_branch)) then return jsonb_build_object('ok', true, 'pending', false); end if;
  perform private.kick_point();
  return jsonb_build_object('ok', true, 'pending', true);
end $f$;
revoke all on function public.forecast_point_open(text) from public, anon;
grant execute on function public.forecast_point_open(text) to authenticated;

-- 수집 함수(서비스 키)용: 받을 발표·칸(한 번에 400칸까지)
create or replace function public.forecast_point_plan() returns jsonb
language sql stable security definer set search_path = '' as $f$
  select jsonb_build_object('tmfc', private.point_tmfc(),
    'cells', coalesce((select jsonb_agg(jsonb_build_array(t.nx, t.ny)) from private.point_targets(400) t), '[]'::jsonb))
$f$;
revoke all on function public.forecast_point_plan() from public, anon, authenticated;

-- 수집 함수(서비스 키)용: 받은 값 저장. p_rows = [{nx, ny, h:{epoch:cm}|null(실패), last_at}]. 받은 칸이 있으면 24시간 예보를 다시 섞음
create or replace function public.forecast_point_put(p_tmfc timestamptz, p_rows jsonb, p_calls int, p_fails int, p_bytes bigint) returns jsonb
language plpgsql security definer set search_path = '' as $f$
declare n_ok int := 0; n_fail int := 0; mixed boolean := null;
begin
  if p_tmfc is null or p_tmfc <> date_trunc('hour', p_tmfc) or p_tmfc < now() - interval '1 day' or p_tmfc > now()
     or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 1000
     or p_calls is null or p_calls < 0 or p_calls > 2000 or p_fails is null or p_fails < 0 or p_fails > p_calls
     or p_bytes is null or p_bytes < 0 or p_bytes > 2000000000 then raise exception 'bad point put' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r
              where jsonb_typeof(r -> 'nx') <> 'number' or jsonb_typeof(r -> 'ny') <> 'number'
                 or (r ->> 'nx')::int not between 1 and 149 or (r ->> 'ny')::int not between 1 and 253
                 or (jsonb_typeof(r -> 'h') = 'object' and (r ->> 'last_at') is null)
                 or (jsonb_typeof(r -> 'h') = 'object' and exists (select 1 from jsonb_each(r -> 'h') e
                       where e.key !~ '^[0-9]{10}$' or jsonb_typeof(e.value) <> 'number' or (e.value::text)::numeric not between -10 and 200))) then
    raise exception 'bad point rows' using errcode = '22023';
  end if;
  insert into private.point_snow as p (tmfc, nx, ny, h, last_at, tries, tried_at)
  select p_tmfc, (r ->> 'nx')::int, (r ->> 'ny')::int,
         case when jsonb_typeof(r -> 'h') = 'object' then r -> 'h' end,
         case when jsonb_typeof(r -> 'h') = 'object' then (r ->> 'last_at')::timestamptz end, 1, now()
    from jsonb_array_elements(p_rows) r
  on conflict (tmfc, nx, ny) do update
    set h = coalesce(excluded.h, p.h), last_at = coalesce(excluded.last_at, p.last_at), tries = p.tries + 1, tried_at = now();
  select count(*) filter (where jsonb_typeof(r -> 'h') = 'object'), count(*) filter (where jsonb_typeof(r -> 'h') is distinct from 'object')
    into n_ok, n_fail from jsonb_array_elements(p_rows) r;
  insert into private.point_usage as u (usage_day, calls, fails, bytes)
  values ((now() at time zone 'Asia/Seoul')::date, p_calls, p_fails, p_bytes)
  on conflict (usage_day) do update set calls = u.calls + excluded.calls, fails = u.fails + excluded.fails, bytes = u.bytes + excluded.bytes;
  delete from private.point_snow where tmfc < now() - interval '1 day';
  delete from private.point_want where opened_at < now() - interval '7 days';
  delete from private.point_usage where usage_day < (now() at time zone 'Asia/Seoul')::date - 14;
  insert into public.collector_state as s (job, cursor, started_at, finished_at, ok, note)
  values ('forecast_point', to_char(p_tmfc at time zone 'Asia/Seoul', 'YYYYMMDDHH24MI'), now(), now(), n_fail = 0,
          case when n_fail > 0 then n_fail || '칸 실패(3분 뒤 다시)' end)
  on conflict (job) do update set cursor = excluded.cursor, finished_at = now(), ok = excluded.ok, note = excluded.note;
  update public.collector_state set started_at = now() - interval '1 hour' where job = 'forecast_point_kick';      -- 다 끝남 → 새로 연 지사는 바로 받을 수 있게
  if n_ok > 0 then
    begin
      mixed := private.fc_refresh();
    exception when others then
      mixed := false;
      update public.collector_state set note = left('24시간 예보에 섞기 실패: ' || sqlerrm, 500) where job = 'forecast_point';
    end;
  end if;
  if n_ok > 0 and exists (select 1 from private.point_targets(1)) then perform private.kick_point(); end if;      -- 그동안 새로 연 지사·남은 칸(받은 칸이 있을 때만 → 아직 안 나온 발표로 되풀이하지 않음)
  return jsonb_build_object('ok', true, 'saved', n_ok, 'failed', n_fail, 'mixed', mixed);
end $f$;
revoke all on function public.forecast_point_put(timestamptz, jsonb, int, int, bigint) from public, anon, authenticated;
revoke all on function private.point_tmfc(), private.point_targets(int, text), private.kick_point() from public, anon, authenticated;

-- fc_apply: 가까운 24시간 단기 신적설에 칸 조회 값
do $p$
declare d text := pg_get_functiondef('private.fc_apply(timestamptz,timestamptz)'::regprocedure);
        pairs text[] := array[
  $x$    sh as ($x$,
  $x$    pts as materialized (      -- 107: 단기 칸 조회 신적설(연 지사 격자만)
      select ps.tmfc, ps.nx, ps.ny, ps.h, ps.last_at from private.point_snow ps
       where ps.h is not null and exists (select 1 from picked q where q.tmfc = ps.tmfc)),
    sh as ($x$,
  $x$             case when q.quantity and q.s[sc.i] is not null then greatest(q.s[sc.i],0) end::double precision s,$x$,
  $x$             case when q.quantity and pt.tmfc is not null and h.tmef <= pt.last_at then greatest(coalesce((pt.h ->> floor(extract(epoch from h.tmef))::bigint::text)::double precision, 0), 0)
                  when q.quantity and q.s[sc.i] is not null then greatest(q.s[sc.i],0) end::double precision s,
             case when q.quantity and pt.tmfc is not null and h.tmef <= pt.last_at then greatest(-coalesce((pt.h ->> floor(extract(epoch from h.tmef))::bigint::text)::double precision, 0), 0) end::double precision sl,      -- 107: 칸 조회 값이 있으면 'x cm 미만'의 x(아니면 0), 칸 조회가 없으면 null$x$,
  $x$        left join source_cells sc on sc.tmfc=q.tmfc and sc.nx=cell.nx and sc.ny=cell.ny),$x$,
  $x$        left join source_cells sc on sc.tmfc=q.tmfc and sc.nx=cell.nx and sc.ny=cell.ny
        left join pts pt on pt.tmfc=q.tmfc and pt.nx=cell.nx and pt.ny=cell.ny),$x$,
  $x$sh.y as sy$x$,
  $x$sh.y as sy, sh.sl$x$,
  $x$(not m.vs and m.s = 0 and coalesce(m.sy, 0) = 3) as sq$x$,
  $x$(case when m.vs then 0 when m.sl is not null then m.sl when m.s = 0 and coalesce(m.sy, 0) = 3 then 1 else 0 end)::double precision as sq$x$,
  $x$round((sum(x.s) + count(*) filter (where x.sq))::numeric, 1)::double precision as snow_hi,$x$,
  $x$round((sum(x.s) + sum(x.sq))::numeric, 1)::double precision as snow_hi,      -- 107: sq = '~' 위쪽 폭(1 또는 0.5)$x$,
  $x$|| case when count(*) filter (where x.sq) > 0 then jsonb_build_object('sq', jsonb_agg(x.sq::int order by x.tmef)) else '{}'::jsonb end$x$,
  $x$|| case when sum(x.sq) > 0 then jsonb_build_object('sq', jsonb_agg(x.sq order by x.tmef)) else '{}'::jsonb end$x$];
        i int;
begin
  for i in 1 .. array_length(pairs, 1) / 2 loop
    if (length(d) - length(replace(d, pairs[2*i-1], ''))) <> length(pairs[2*i-1]) then raise exception '107: fc_apply 바꿀 곳 %번이 한 군데가 아님', i; end if;
    d := replace(d, pairs[2*i-1], pairs[2*i]);
  end loop;
  execute d;
end $p$;

-- forecast_cell_detail_calc: 25시간째부터 1시간 표 신적설에 칸 조회 값, '비/눈' 시각은 '-'
do $p$
declare d text := pg_get_functiondef('private.forecast_cell_detail_calc(integer,integer)'::regprocedure);
        pairs text[] := array[
  $x$q.y[ix.i] y0$x$,
  $x$q.y[ix.i] y0,
      case when ps.tmfc is not null and q.tmef <= ps.last_at then coalesce((ps.h ->> floor(extract(epoch from q.tmef))::bigint::text)::double precision, 0) end pv      -- 107: 칸 조회 신적설(음수 = 'x cm 미만')$x$,
  $x$      from picked q join ix on ix.tmfc=q.tmfc),$x$,
  $x$      from picked q join ix on ix.tmfc=q.tmfc
      left join private.point_snow ps on ps.tmfc=q.tmfc and ps.nx=p_nx and ps.ny=p_ny and ps.h is not null),$x$,
  $x$      case when q.quantity and q.s0 is not null then greatest(q.s0,0) end s,$x$,
  $x$      case when q.quantity and q.pv is not null then greatest(q.pv,0) when q.quantity and q.s0 is not null then greatest(q.s0,0) end s,$x$,
  $x$      case when q.quantity and q.s0 is not null then q.s0=0 and q.y0 in(2,3,6,7) end sq,$x$,
  $x$      case when q.quantity and q.pv is not null then greatest(-q.pv,0) when q.quantity and q.s0 is not null then case when q.s0=0 and q.y0=3 then 1 else 0 end end sq,      -- 106·107: '비/눈' 시각은 '-', 칸 조회 'x cm 미만'은 위쪽 폭 x$x$];
        i int;
begin
  for i in 1 .. array_length(pairs, 1) / 2 loop
    if (length(d) - length(replace(d, pairs[2*i-1], ''))) <> length(pairs[2*i-1]) then raise exception '107: 격자 창 계산 바꿀 곳 %번이 한 군데가 아님', i; end if;
    d := replace(d, pairs[2*i-1], pairs[2*i]);
  end loop;
  execute d;
end $p$;

-- 10분마다(발표 12·22·…분): 연 지사 중 이번 발표 칸 조회가 없는 칸이 있으면 수집 함수를 부름
select cron.schedule('collect-point', '2-59/10 * * * *', $c$select private.kick_point()$c$);

delete from private.fc_cache where k like 'c:%';
commit;
