-- 93. 기관별 예보 결과를 저장해 두고 같은 예보 동안 다시 씀(100명이 동시에 열어도 계산은 한 번). 2026-11-11 Claude Code.
--  사용자(2026-11-11): "100명이 동시 접속하면 기관별 예보 로딩도 느려지나?" → 미리 만들어 두기 / "둘 다 적용해".
--  * 지금은 지도 칸(forecast_grid)·1시간·3시간 표(forecast_cell_detail)·일별 표(forecast_daily_cell)를 부를 때마다 새로 계산(0.03~0.3초).
--    → 계산 함수는 private.*_calc 로 옮기고, 같은 이름의 public 함수가 "지금 예보 표시(fc_cache_ver)"가 같으면 저장해 둔 결과를 돌려줌.
--      처음 부른 사람만 계산(동시에 온 사람은 그 계산이 끝나길 잠깐 기다렸다가 같은 결과를 받음). 저장한 지 10분 넘은 것은 다시 계산.
--  * 예보 표시 = forecast_version 의 c·d + 격자 편입 기록 마지막 번호. 단기·초단기·중기·일별 자료·격자 편입이 바뀌면 달라짐.
--  * forecast_version 의 c 에 초단기 마지막 완료 시각을 더함: 1시간·3시간 창의 가까운 6시각(초단기)이 10분마다 바뀌는 것을 화면도 10분마다 따라감
--    (지금까지는 c 가 초단기를 보지 않아 정시에만 다시 받았음).
--  * 저장 칸(private.fc_cache)은 지사 묶음·격자마다 한 줄을 덮어씀(쌓이지 않음, 많아야 2천 줄 남짓). 화면에서 직접 못 읽음.
--  * 앞으로 계산 내용을 고칠 때는 private.forecast_grid_calc / forecast_cell_detail_calc / forecast_daily_cell_calc 를 고칠 것(public 것은 저장만).
begin;

do $g$ begin
  if md5(pg_get_functiondef('public.forecast_grid(text[], boolean)'::regprocedure)) <> '69e22f05cff2cbefd848e54b6bed695f'
  or md5(pg_get_functiondef('public.forecast_cell_detail(integer, integer)'::regprocedure)) <> '60da96a7c6ff1044225f4d068d3efdba'
  or md5(pg_get_functiondef('public.forecast_daily_cell(integer, integer)'::regprocedure)) <> '16888e0b3a06245d8fbd2aa4a38e7250'
  or md5(pg_get_functiondef('public.forecast_version()'::regprocedure)) <> '74402b09699eda6d27f4e1664fc413a9'
  then raise exception '93: 예보 함수가 예상과 다름(다른 곳에서 바뀜) — 중단'; end if;
  if to_regclass('private.fc_cache') is not null then raise exception '93: 이미 있음 — 중단'; end if;
end $g$;

-- 1) forecast_version: c 에 초단기 마지막 완료 시각
do $p$ declare d text := pg_get_functiondef('public.forecast_version()'::regprocedure);
  a text := 'floor(extract(epoch from r.tmfc))::bigint,';
  b text := 'floor(extract(epoch from r.tmfc))::bigint, floor(extract(epoch from (select max(y.done_at) from public.forecast_vsrt_runs y)))::bigint,';      -- 93
begin
  if (length(d) - length(replace(d, a, ''))) <> length(a) then raise exception '93: forecast_version 바꿀 곳이 한 군데가 아님'; end if;
  execute replace(d, a, b);
end $p$;

-- 2) 저장 칸
create table private.fc_cache (
  k    text primary key,              -- 'g:<지사 묶음>' · 'c:<nx,ny>' · 'd:<nx,ny>'
  ver  text not null,                 -- 계산할 때의 예보 표시
  data jsonb not null,
  at   timestamptz not null default now()
);
alter table private.fc_cache enable row level security;
revoke all on private.fc_cache from public, anon, authenticated;

create or replace function private.fc_cache_ver() returns text
language sql stable security definer set search_path = '' as $$
  select concat_ws('|', v ->> 'c', v ->> 'd', (select max(e.id) from public.grid_events e)) from (select public.forecast_version() v) x
$$;
create or replace function private.fc_cache_hit(p_k text, p_ver text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select c.data from private.fc_cache c where c.k = p_k and c.ver = p_ver and c.at > now() - interval '10 minutes'
$$;
create or replace function private.fc_cache_put(p_k text, p_ver text, p_data jsonb) returns void
language sql volatile security definer set search_path = '' as $$
  insert into private.fc_cache (k, ver, data, at) values (p_k, p_ver, p_data, now())
  on conflict (k) do update set ver = excluded.ver, data = excluded.data, at = excluded.at
$$;

-- 3) 계산 함수는 private 으로(이름 *_calc). 화면이 직접 부르지 못함
alter function public.forecast_grid(text[], boolean) rename to forecast_grid_calc;
alter function public.forecast_grid_calc(text[], boolean) set schema private;
alter function public.forecast_cell_detail(integer, integer) rename to forecast_cell_detail_calc;
alter function public.forecast_cell_detail_calc(integer, integer) set schema private;
alter function public.forecast_daily_cell(integer, integer) rename to forecast_daily_cell_calc;
alter function public.forecast_daily_cell_calc(integer, integer) set schema private;
revoke all on function private.forecast_grid_calc(text[], boolean), private.forecast_cell_detail_calc(integer, integer), private.forecast_daily_cell_calc(integer, integer),
  private.fc_cache_ver(), private.fc_cache_hit(text, text), private.fc_cache_put(text, text, jsonb) from public, anon, authenticated;

-- 4) 같은 이름의 public 함수: 저장해 둔 것이 있으면 그것, 없으면 계산해서 저장(같은 칸을 동시에 계산하지 않게 잠금)
create or replace function public.forecast_grid(p_branches text[], p_series boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare k text; v text; r jsonb;
begin
  if (select private.my_role()) is null then raise exception 'login required' using errcode = '42501'; end if;
  if p_branches is null or cardinality(p_branches) = 0 or cardinality(p_branches) > 30 then return private.forecast_grid_calc(p_branches, p_series); end if;   -- 잘못된 입력은 계산 함수가 거절
  k := 'g:' || coalesce(p_series, false)::text || ':' || p_branches::text; v := private.fc_cache_ver();
  r := private.fc_cache_hit(k, v); if r is not null then return r; end if;
  perform pg_advisory_xact_lock(hashtextextended(k, 93));
  r := private.fc_cache_hit(k, v); if r is not null then return r; end if;          -- 기다리는 사이 앞사람이 계산해 둠
  r := private.forecast_grid_calc(p_branches, p_series);
  if r is not null then perform private.fc_cache_put(k, v, r); end if;
  return r;
end $$;

create or replace function public.forecast_cell_detail(p_nx integer, p_ny integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare k text := 'c:' || p_nx || ',' || p_ny; v text; r jsonb;
begin
  if (select private.my_role()) is null then raise exception 'login required' using errcode = '42501'; end if;
  if p_nx is null or p_ny is null then return private.forecast_cell_detail_calc(p_nx, p_ny); end if;
  v := private.fc_cache_ver();
  r := private.fc_cache_hit(k, v); if r is not null then return r; end if;
  perform pg_advisory_xact_lock(hashtextextended(k, 93));
  r := private.fc_cache_hit(k, v); if r is not null then return r; end if;
  r := private.forecast_cell_detail_calc(p_nx, p_ny);      -- 없는 격자 등은 여기서 거절(저장 안 함)
  if r is not null then perform private.fc_cache_put(k, v, r); end if;
  return r;
end $$;

create or replace function public.forecast_daily_cell(p_nx integer, p_ny integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare k text := 'd:' || p_nx || ',' || p_ny; v text; r jsonb;
begin
  if (select private.my_role()) is null then raise exception 'login required' using errcode = '42501'; end if;
  if p_nx is null or p_ny is null then return private.forecast_daily_cell_calc(p_nx, p_ny); end if;
  v := private.fc_cache_ver();
  r := private.fc_cache_hit(k, v); if r is not null then return r; end if;
  perform pg_advisory_xact_lock(hashtextextended(k, 93));
  r := private.fc_cache_hit(k, v); if r is not null then return r; end if;
  r := private.forecast_daily_cell_calc(p_nx, p_ny);
  if r is not null then perform private.fc_cache_put(k, v, r); end if;
  return r;
end $$;

revoke all on function public.forecast_grid(text[], boolean), public.forecast_cell_detail(integer, integer), public.forecast_daily_cell(integer, integer) from public, anon;
grant execute on function public.forecast_grid(text[], boolean), public.forecast_cell_detail(integer, integer), public.forecast_daily_cell(integer, integer) to authenticated;

commit;
