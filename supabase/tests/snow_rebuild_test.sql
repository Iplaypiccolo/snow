-- ============================================================
-- 적설 요약본 시즌 하나만 다시 만들기(마이그레이션 112) 시험 — SQL Editor 에 통째로 붙여넣어 실행. 끝에 일부러 오류를 내서 모두 되돌립니다.
-- 결과는 오류 창에 "적설 요약본 시험 결과 — 전체 N, 실패 0" 으로 나옵니다.
-- 확인: ① 시즌마다 하나만 다시 만든 결과 = 모든 시즌을 다시 만든 결과(목록 'snow' 포함, 글자 하나까지)
--       ② snow_finish 는 그 날짜의 시즌만, 시간 제한(약 8초) 안에 ③ 눈 없는 시즌이 되면 그 시즌만 목록·요약본에서 빠짐
--       ④ 로그인 사용자는 함수를 직접 부를 수 없음
-- ============================================================
create temp table _t (n serial, name text, got text, want text, ok boolean);
create or replace function pg_temp.run_as(rl text, stmt text) returns text language plpgsql as $f$
begin
  if rl <> 'postgres' then execute format('set local role %I', rl); end if;
  begin execute stmt; execute 'reset role'; return 'ok';
  exception when others then execute 'reset role'; return 'err:' || sqlstate; end;
end $f$;
create or replace function pg_temp.chk(name text, got text, want text) returns void language plpgsql as $f$
begin insert into _t(name, got, want, ok) values (name, got, want, got is not distinct from want); end $f$;

do $t$
declare r record; res jsonb; t0 timestamptz; ms int; n_bad int; rep text; fails int; total int; seasons_before int;
begin
  -- 기준: 모든 시즌 다시 만들기
  perform public.admin_rebuild_snow_snapshot();
  create temp table _full on commit drop as select key, body from public.snapshots where key like 'snow%';
  select jsonb_array_length(body -> 'seasons') into seasons_before from _full where key = 'snow';
  perform pg_temp.chk('기준 목록에 시즌이 있음', (seasons_before > 0)::text, 'true');

  -- ① 시즌마다 하나만 다시 만들어도 결과가 같음
  for r in select (e ->> 'label') as label, substr(e ->> 'label', 1, 4)::int as y from _full, jsonb_array_elements(body -> 'seasons') e where key = 'snow' loop
    res := private.snow_rebuild(r.y);
    perform pg_temp.chk(r.label || ' 시즌만: only 표시', res ->> 'only', r.label);
    select count(*) into n_bad from (
      select coalesce(a.key, b.key) from (select key, body from public.snapshots where key like 'snow%') a
      full join _full b on a.key = b.key where a.body is distinct from b.body) q;
    perform pg_temp.chk(r.label || ' 시즌만 다시 만든 뒤 모든 요약본이 기준과 같음', n_bad::text, '0');
  end loop;

  -- ② snow_finish: 그 날짜의 시즌만, 빠르게
  t0 := clock_timestamp();
  res := public.snow_finish('2026-11-24', 24, 0, '시험');
  ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
  perform pg_temp.chk('snow_finish(11/24) → 2026-27 시즌만', res #>> '{snapshot,only}', '2026-27');
  perform pg_temp.chk('snow_finish(3/1) → 2025-26 시즌만', public.snow_finish('2026-03-01', 24, 0, '시험') #>> '{snapshot,only}', '2025-26');
  perform pg_temp.chk('snow_finish 가 2초 안에 끝남(' || ms || 'ms)', (ms < 2000)::text, 'true');
  perform pg_temp.chk('새 값 없고 24시각 미만이면 다시 만들지 않음', public.snow_finish('2026-11-24', 23, 0, '시험') ->> 'snapshot', null);

  -- ③ 2017-18 시즌 값을 모두 0 으로 → 그 시즌만 빠지고 나머지는 그대로
  update public.snow_daily set value = 0 where date between '2017-11-01' and '2018-04-30' and value > 0;
  perform private.snow_rebuild(2017);
  perform pg_temp.chk('눈 없는 시즌 요약본 지워짐', (select count(*) from public.snapshots where key = 'snow:2017-18')::text, '0');
  perform pg_temp.chk('목록에서 그 시즌만 빠짐', (select jsonb_array_length(body -> 'seasons') from public.snapshots where key = 'snow')::text, (seasons_before - 1)::text);
  perform pg_temp.chk('다른 시즌 요약본은 그대로', (select count(*) from public.snapshots a join _full b using (key) where a.key like 'snow:%' and a.body is distinct from b.body)::text, '0');

  -- ④ 권한
  perform pg_temp.chk('로그인 사용자: private.snow_rebuild 불가', pg_temp.run_as('authenticated', 'select private.snow_rebuild(2026)'), 'err:42501');
  perform pg_temp.chk('로그인 사용자: snow_finish 불가', pg_temp.run_as('authenticated', $$select public.snow_finish('2026-11-24', 24, 0, 'x')$$), 'err:42501');
  perform pg_temp.chk('로그인 사용자: admin_rebuild_snow_snapshot 불가', pg_temp.run_as('authenticated', 'select public.admin_rebuild_snow_snapshot()'), 'err:42501');

  select count(*), count(*) filter (where not ok) into total, fails from _t;
  select string_agg(case when ok then 'O ' else 'X ' end || name || case when ok then '' else ' (got ' || coalesce(got, 'null') || ', want ' || coalesce(want, 'null') || ')' end, E'\n' order by n) into rep from _t;
  raise exception E'적설 요약본 시험 결과 — 전체 %, 실패 %\n%', total, fails, rep;
end $t$;
