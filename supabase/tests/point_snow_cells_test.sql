-- ============================================================
-- 칸 조회 받을 칸 = 눈이 예보된 관할 격자(마이그레이션 113) 시험 — SQL Editor 에 통째로 붙여넣어 실행. 끝에 일부러 오류를 내서 모두 되돌립니다.
-- 결과는 오류 창에 "칸 조회 대상 시험 결과 — 전체 N, 실패 0" 으로 나옵니다.
-- 확인: ① 발표별 몫(02시 500 … 23시 4,000) ② 받을 칸은 모두 눈 칸, 눈 칸은 이미 받은 칸 빼고 모두 ③ 눈 없는 칸에 눈이 생기면 대상, 눈이 없어지면 빠짐
--       ④ 지사 지정이면 그 지사 칸만 ⑤ 최근 연 지사의 칸부터 ⑥ 그날 몫을 다 쓰면 없음 ⑦ 이미 받은 칸은 빠짐 ⑧ 빠름
-- ============================================================
create temp table _t (n serial, name text, got text, want text, ok boolean);
create or replace function pg_temp.chk(name text, got text, want text) returns void language plpgsql as $f$
begin insert into _t(name, got, want, ok) values (name, got, want, got is not distinct from want); end $f$;
-- 시험용: 그 칸 예보에 눈이 있는지(113 과 같은 규칙)
create or replace function pg_temp.snowy(f public.forecast_cells) returns boolean language sql as $f$
  select f.issued_at >= now() - interval '12 hours' and exists (select 1 from jsonb_array_elements_text(coalesce(f.series -> 's', '[]') || coalesce(f.series -> 'sq', '[]')
         || coalesce(f.series_x -> 's', '[]') || coalesce(f.series_x -> 'sq', '[]')) v where v::numeric > 0) $f$;

do $t$
declare tm timestamptz := private.point_tmfc(); n_t int; n_snowy_left int; n_bad int; dry record; wx int; wy int; br text; first_br text;
        t0 timestamptz; ms int; rep text; fails int; total int; today date := (now() at time zone 'Asia/Seoul')::date;
begin
  -- ① 발표별 몫
  perform pg_temp.chk('02시 발표 몫 500', private.point_cap('2026-11-27 02:00+09')::text, '500');
  perform pg_temp.chk('05시 발표 몫 1,000', private.point_cap('2026-11-27 05:00+09')::text, '1000');
  perform pg_temp.chk('14시 발표 몫 2,500', private.point_cap('2026-11-27 14:00+09')::text, '2500');
  perform pg_temp.chk('23시 발표 몫 4,000', private.point_cap('2026-11-27 23:00+09')::text, '4000');

  -- 시험 중 몫에 걸리지 않게 오늘 사용량을 0 으로(끝에서 되돌려짐)
  update private.point_usage set calls = 0 where usage_day = today;

  -- ② 지금 받을 칸 = 눈 칸 중 이번 발표 값이 없는 칸
  select count(*) into n_t from private.point_targets(5000);
  select count(*) into n_snowy_left from public.forecast_cells f
   where pg_temp.snowy(f) and exists (select 1 from private.grid_effective() g where g.nx = f.nx and g.ny = f.ny)
     and not exists (select 1 from private.point_snow ps where ps.tmfc = tm and ps.nx = f.nx and ps.ny = f.ny and (ps.h is not null or ps.tries >= 3 or ps.tried_at >= now() - interval '3 minutes'));
  perform pg_temp.chk('받을 칸 수 = 아직 안 받은 눈 칸 수(' || n_t || ')', n_t::text, n_snowy_left::text);
  select count(*) into n_bad from private.point_targets(5000) t join public.forecast_cells f on f.nx = t.nx and f.ny = t.ny where not pg_temp.snowy(f);
  perform pg_temp.chk('받을 칸에 눈 없는 칸이 없음', n_bad::text, '0');

  -- ③ 눈 없는 관할 칸에 눈을 넣으면 대상, 눈 칸의 눈을 지우면 빠짐
  select f.nx, f.ny into dry from public.forecast_cells f join (select distinct nx, ny from private.grid_effective()) g using (nx, ny)
   where not pg_temp.snowy(f) and f.issued_at >= now() - interval '12 hours'
     and not exists (select 1 from private.point_snow ps where ps.tmfc = tm and ps.nx = f.nx and ps.ny = f.ny) order by f.ny, f.nx limit 1;
  perform pg_temp.chk('눈 없는 칸은 대상 아님', exists (select 1 from private.point_targets(5000) t where t.nx = dry.nx and t.ny = dry.ny)::text, 'false');
  update public.forecast_cells set series_x = jsonb_set(coalesce(series_x, '{}'), '{sq}', '[0, 0.5, 0]') where nx = dry.nx and ny = dry.ny;
  perform pg_temp.chk('25시간째 뒤에 0.5cm 미만이 생기면 대상', exists (select 1 from private.point_targets(5000) t where t.nx = dry.nx and t.ny = dry.ny)::text, 'true');
  select t.nx, t.ny into wx, wy from private.point_targets(5000) t where (t.nx, t.ny) <> (dry.nx, dry.ny) limit 1;
  if wx is not null then
    update public.forecast_cells set series = series - 'sq' || jsonb_build_object('s', (select jsonb_agg(0) from generate_series(1, 24))), series_x = null where nx = wx and ny = wy;
    perform pg_temp.chk('눈을 지우면 대상에서 빠짐', exists (select 1 from private.point_targets(5000) t where t.nx = wx and t.ny = wy)::text, 'false');
  end if;
  update public.forecast_cells set issued_at = now() - interval '13 hours' where nx = dry.nx and ny = dry.ny;
  perform pg_temp.chk('12시간 넘은 예보 칸은 대상 아님', exists (select 1 from private.point_targets(5000) t where t.nx = dry.nx and t.ny = dry.ny)::text, 'false');
  update public.forecast_cells set issued_at = now() where nx = dry.nx and ny = dry.ny;

  -- ④ 지사 지정: 그 지사 칸만
  select g.branch_id into br from private.grid_effective() g where g.nx = dry.nx and g.ny = dry.ny limit 1;
  select count(*) into n_bad from private.point_targets(5000, br) t where not exists (select 1 from private.grid_effective() g where g.branch_id = br and g.nx = t.nx and g.ny = t.ny);
  perform pg_temp.chk('지사 지정이면 그 지사 칸만', n_bad::text, '0');
  perform pg_temp.chk('지사 지정에 그 지사 눈 칸이 들어감', exists (select 1 from private.point_targets(5000, br) t where t.nx = dry.nx and t.ny = dry.ny)::text, 'true');

  -- ⑤ 방금 연 지사의 칸이 맨 앞
  insert into private.point_want (branch_id, opened_at) values (br, now()) on conflict (branch_id) do update set opened_at = now();
  select (select g.branch_id from private.grid_effective() g where g.nx = t.nx and g.ny = t.ny and g.branch_id = br limit 1) into first_br from private.point_targets(1) t;
  perform pg_temp.chk('방금 연 지사의 칸부터', first_br, br);

  -- ⑦ 이미 받은 칸은 빠짐, 실패 3번이면 빠짐
  insert into private.point_snow (tmfc, nx, ny, h, last_at, tries, tried_at) values (tm, dry.nx, dry.ny, '{}', tm + interval '3 days', 1, now() - interval '1 hour')
  on conflict (tmfc, nx, ny) do update set h = '{}', last_at = excluded.last_at, tries = 1, tried_at = excluded.tried_at;
  perform pg_temp.chk('이미 받은 칸은 빠짐', exists (select 1 from private.point_targets(5000) t where t.nx = dry.nx and t.ny = dry.ny)::text, 'false');
  update private.point_snow set h = null, tries = 3 where tmfc = tm and nx = dry.nx and ny = dry.ny;
  perform pg_temp.chk('3번 실패한 칸은 빠짐', exists (select 1 from private.point_targets(5000) t where t.nx = dry.nx and t.ny = dry.ny)::text, 'false');
  update private.point_snow set tries = 1, tried_at = now() where tmfc = tm and nx = dry.nx and ny = dry.ny;
  perform pg_temp.chk('방금 실패한 칸은 3분 뒤에', exists (select 1 from private.point_targets(5000) t where t.nx = dry.nx and t.ny = dry.ny)::text, 'false');
  update private.point_snow set tried_at = now() - interval '4 minutes' where tmfc = tm and nx = dry.nx and ny = dry.ny;
  perform pg_temp.chk('실패 3분 뒤 다시 대상', exists (select 1 from private.point_targets(5000) t where t.nx = dry.nx and t.ny = dry.ny)::text, 'true');

  -- ⑥ 그날 몫
  insert into private.point_usage as u (usage_day, calls) values (today, private.point_cap(tm) - 1) on conflict (usage_day) do update set calls = excluded.calls;
  perform pg_temp.chk('몫 1번 남으면 받음', (select count(*) > 0 from private.point_targets(1))::text, 'true');
  update private.point_usage set calls = private.point_cap(tm) where usage_day = today;
  perform pg_temp.chk('몫을 다 쓰면 없음', (select count(*) from private.point_targets(5000))::text, '0');
  perform pg_temp.chk('몫을 다 쓰면 수집 함수를 부르지 않음', private.kick_point()::text, null);
  update private.point_usage set calls = 0 where usage_day = today;

  -- ⑧ 빠름(10분마다·저장 때마다 부름)
  t0 := clock_timestamp(); perform count(*) from private.point_targets(400); ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
  perform pg_temp.chk('point_targets(400) 1초 안(' || ms || 'ms)', (ms < 1000)::text, 'true');

  select count(*), count(*) filter (where not ok) into total, fails from _t;
  select string_agg(case when ok then 'O ' else 'X ' end || name || case when ok then '' else ' (got ' || coalesce(got, 'null') || ', want ' || coalesce(want, 'null') || ')' end, E'\n' order by n) into rep from _t;
  raise exception E'칸 조회 대상 시험 결과 — 전체 %, 실패 %\n%', total, fails, rep;
end $t$;
