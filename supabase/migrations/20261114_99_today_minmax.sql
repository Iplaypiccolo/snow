-- 99. 일별 '오늘' 최저·최고를 날씨누리와 같게(관측 + 남은 예보). 2026-11-14 Claude Code.
--  사용자(2026-11-14): "모두 기상청과 동일해야" → 대조 결과 설명 뒤 "적용해".
--  * 대조(11/14 10:50, 무작위 60칸, 날씨누리 단기 08:00): 지금(최신 발표 TMN·TMX) 최저 17/60·최고 43/60 같음.
--    - 최저 = 오늘 01시~지금 격자 관측(초단기실황 T1H, 마이그레이션 96 수집)의 최저와 남은 시각 예보(초단기 T1H·단기 TMP) 최저 중 낮은 것, 반올림 → 59/60
--      (다른 1칸 = 관측 9.5℃, 날씨누리 9 — x.5 반올림 방향).
--    - 최고 = 오늘 나온 단기 발표들의 TMX 중 최고·오늘 01시~지금 관측 최고·남은 시각 예보 최고 중 높은 것, 반올림 → 59/60.
--  * 아직 모르는 점: 같은 날 09:30 에는 날씨누리 최저가 몇 칸 1℃ 낮았음(10:50 에는 위 규칙과 같음) → 오후·밤 예약 대조로 계속 확인.
--  * 관측이 없으면(자정~01시, 수집 실패) 최저는 예전 값, 최고는 남은 값들 중 최고(모두 없으면 예전 값).
--  * 저장해 둔 일별 결과(private.fc_cache 'd:…')는 지움(다음에 열 때 새로 계산 — 계산 결과 보관용이라 지워도 잃는 것 없음).
begin;

do $g$ begin
  if md5(pg_get_functiondef('private.forecast_daily_cell_calc(integer, integer)'::regprocedure)) <> '5cc26ca312a593c6efd6e56fd6634889'
  then raise exception '99: 일별 계산 함수가 예상과 다름(다른 곳에서 바뀜) — 중단'; end if;
end $g$;

do $p$
declare d text := pg_get_functiondef('private.forecast_daily_cell_calc(integer, integer)'::regprocedure);
        pairs text[] := array[
  $x$declare region jsonb; aux jsonb; days jsonb; today date:=(now() at time zone 'Asia/Seoul')::date; fr public.forecast_runs; ci int; vt timestamptz; vc jsonb; vi int;$x$,
  $x$declare region jsonb; aux jsonb; days jsonb; today date:=(now() at time zone 'Asia/Seoul')::date; fr public.forecast_runs; ci int; vt timestamptz; vc jsonb; vi int;
  v_omin numeric; v_omax numeric; v_fmin numeric; v_fmax numeric; v_xt numeric; v_tmin numeric; v_tmax numeric;   -- 99: 오늘 최저·최고$x$,
  $x$  with near_weather as materialized($x$,
  $x$  -- 99: 오늘 최저·최고(날씨누리와 같게). 관측 = 오늘 01시~지금 격자 관측, 예보 = 지금 뒤~오늘 24시(초단기 있으면 초단기)
  select min(o.v), max(o.v) into v_omin, v_omax from (
    select h.vals[(select min(j.ordinality)::int from jsonb_array_elements(h.cells) with ordinality j where j.value=jsonb_build_array(p_nx,p_ny))]::numeric v
      from private.forecast_obs_hours h
     where h.tmef >= (today::timestamp + interval '1 hour') at time zone 'Asia/Seoul' and h.tmef <= now()) o
   where o.v between -60 and 60;
  select min(z.t), max(z.t) into v_fmin, v_fmax from (
    select v.vals[vi]::numeric t from public.forecast_vsrt_hours v
     where vi is not null and v.tmfc=vt and v.var='T1H' and v.tmef>now() and v.tmef<=(today::timestamp + interval '24 hours') at time zone 'Asia/Seoul' and v.vals[vi]>-50
    union all
    select h.vals[ci]::numeric from public.forecast_hours h
     where ci is not null and h.tmfc=fr.tmfc and h.var='TMP' and not h.is_empty and h.tmef>now() and h.tmef<=(today::timestamp + interval '24 hours') at time zone 'Asia/Seoul' and h.vals[ci]>-50
       and not exists(select 1 from public.forecast_vsrt_hours v where vi is not null and v.tmfc=vt and v.var='T1H' and v.tmef=h.tmef and v.vals[vi]>-50)) z;
  select max(a.vals[x.i])::numeric into v_xt from private.forecast_daily_aux_hours a
    join (select rr.tmfc, min(j.ordinality)::int i from public.forecast_runs rr
            cross join lateral jsonb_array_elements(rr.cells) with ordinality j
           where (rr.tmfc at time zone 'Asia/Seoul')::date=today and j.value=jsonb_build_array(p_nx,p_ny) group by rr.tmfc) x on x.tmfc=a.tmfc
   where a.var='TMX' and not a.is_empty and (a.tmef at time zone 'Asia/Seoul')::date=today and a.vals[x.i]>-50;
  if v_omin is not null then v_tmin := least(round(v_omin), round(v_fmin)); end if;
  v_tmax := greatest(round(v_xt), round(v_omax), round(v_fmax));
  with near_weather as materialized($x$,
  $x$    'tmin',case when nt is not null or near_day then nt->'tmin' else ft->'tmin'end,$x$,
  $x$    'tmin',case when d=today and v_tmin is not null then to_jsonb(v_tmin::int) when nt is not null or near_day then nt->'tmin' else ft->'tmin'end,      -- 99$x$,
  $x$    'tmax',case when nt is not null or near_day then nt->'tmax' else ft->'tmax'end,$x$,
  $x$    'tmax',case when d=today and v_tmax is not null then to_jsonb(v_tmax::int) when nt is not null or near_day then nt->'tmax' else ft->'tmax'end,      -- 99$x$];
        i int;
begin
  for i in 1 .. array_length(pairs, 1) / 2 loop
    if (length(d) - length(replace(d, pairs[2*i-1], ''))) <> length(pairs[2*i-1]) then raise exception '99: 바꿀 곳 %번이 한 군데가 아님', i; end if;
    d := replace(d, pairs[2*i-1], pairs[2*i]);
  end loop;
  execute d;
end $p$;

delete from private.fc_cache where k like 'd:%';

commit;
