-- 96. 관측 기온(초단기실황 격자 T1H) 매시 받기 — 일별 '오늘' 최저·최고를 날씨누리처럼(지난 시각은 관측) 만들기 위한 1단계. 2026-11-11 Claude Code.
--  사용자(2026-11-11): "1~3도 바꿔줘. 기상청과 동일하게" / "관측기온 수집 시작하자" / (오늘 칸에 쓰는 것으로) "좋아 진행해".
--  * 이번에는 모으기만 함(화면·일별 계산은 그대로). 하루 이상 모아 날씨누리 오늘 최저·최고와 대조해 규칙을 확인한 뒤 일별 계산에 넣음(다음 마이그레이션).
--  * private.forecast_obs_hours: 정시(tmef)마다 우리 격자(지사 편입 격자, 초단기와 같은 순서) 기온. 3일치만 보관.
--  * forecast_obs_plan / forecast_obs_put: 수집 함수(collect-forecast {"obs":true}, 서비스 키)만 부름. 지난 30시간 중 없는 정시를 한 번에 10개까지(오래된 것부터).
--  * private.kick_obs + 예약 collect-obs(매시 20·35·50분): 지난 정시 값이 있으면 부르지 않음. 기상청 호출 = 하루 약 24번(+처음 한 번 30시간 채우기).
begin;

do $g$ begin
  if to_regclass('private.forecast_obs_hours') is not null then raise exception '96: 이미 있음 — 중단'; end if;
  if exists (select 1 from cron.job where jobname = 'collect-obs') then raise exception '96: 예약 collect-obs 이미 있음 — 중단'; end if;
end $g$;

create table private.forecast_obs_hours (
  tmef   timestamptz primary key,          -- 관측 정시
  cells  jsonb not null,                   -- [[nx,ny]…] (vals 와 같은 순서)
  vals   real[] not null,                  -- 기온 ℃(결측 -90 이하)
  got_at timestamptz not null default now()
);
alter table private.forecast_obs_hours enable row level security;      -- 정책 없음 = 서버 함수로만
revoke all on private.forecast_obs_hours from public, anon, authenticated;

-- 지금 우리 격자(초단기 수집과 같은 목록·순서)
create or replace function private.fc_obs_cells() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_array(c.nx, c.ny) order by c.ny, c.nx), '[]'::jsonb)
    from (select distinct e.nx, e.ny from private.grid_effective() e) c
$$;
revoke all on function private.fc_obs_cells() from public, anon, authenticated;

create or replace function public.forecast_obs_plan() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cells jsonb := private.fc_obs_cells(); h1 timestamptz := date_trunc('hour', now() - interval '15 minutes');
begin
  return jsonb_build_object('cells', cells, 'cells_tmfc', md5(cells::text),
    'missing', (select coalesce(jsonb_agg(h order by h), '[]'::jsonb) from (
        select h from generate_series(h1 - interval '29 hours', h1, interval '1 hour') h
         where not exists (select 1 from private.forecast_obs_hours o where o.tmef = h)
         order by h limit 10) z));
end $$;

create or replace function public.forecast_obs_put(p_tmef timestamptz, p_cells_tmfc text, p_vals real[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cells jsonb := private.fc_obs_cells();
begin
  if p_tmef is null or p_tmef <> date_trunc('hour', p_tmef) or p_tmef > now() or p_tmef < now() - interval '3 days' then raise exception 'bad time' using errcode = '22023'; end if;
  if p_cells_tmfc is distinct from md5(cells::text) then raise exception 'cells changed' using errcode = '22023'; end if;      -- 받는 사이 격자가 바뀜 → 다음 예약 때 다시
  if p_vals is null or cardinality(p_vals) <> jsonb_array_length(cells) then raise exception 'bad vals' using errcode = '22023'; end if;
  insert into private.forecast_obs_hours (tmef, cells, vals) values (p_tmef, cells, p_vals)
  on conflict (tmef) do update set cells = excluded.cells, vals = excluded.vals, got_at = now();
  delete from private.forecast_obs_hours where tmef < now() - interval '3 days';
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.forecast_obs_plan(), public.forecast_obs_put(timestamptz, text, real[]) from public, anon, authenticated;
grant execute on function public.forecast_obs_plan(), public.forecast_obs_put(timestamptz, text, real[]) to service_role;

create or replace function private.kick_obs() returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.forecast_obs_hours where tmef = date_trunc('hour', now() - interval '15 minutes')) then return null; end if;      -- 지난 정시 값이 있으면 쉼(빈 앞 시각은 정시가 빌 때 함께 채움)
  if coalesce((select started_at from public.collector_state where job = 'forecast_obs_kick'), 'epoch') > now() - interval '3 minutes' then return null; end if;
  insert into public.collector_state as s (job, started_at) values ('forecast_obs_kick', now())
  on conflict (job) do update set started_at = now();
  return net.http_post(
    url := 'https://yzwbnohzhnctdvufntig.supabase.co/functions/v1/collect-forecast',
    body := '{"obs":true}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-collector-token', (select token from private.collector_token where id = 1)),
    timeout_milliseconds := 150000);
end $$;
revoke all on function private.kick_obs() from public, anon, authenticated;

select cron.schedule('collect-obs', '20,35,50 * * * *', 'select private.kick_obs()');

commit;
