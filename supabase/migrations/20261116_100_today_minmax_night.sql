-- 100. 일별 '오늘' 최저·최고 — 자정~관측 전(밤) 보완. 2026-11-16 Claude Code.
--  사용자(2026-11-16): "오늘 최저 최고 시간은 다시 확인해서 ... 당장 필요하다면 즉시 실행해".
--  * 대조(11/16 00:45, 48칸, 날씨누리 단기 11/15 23:00): 99 규칙은 오늘 나온 단기 발표가 아직 없는 밤에 최고를 '남은 시간 예보 최고'로만 셈 → 35/48.
--    '마지막 발표 TMX 와 남은 예보 최고 중 높은 것' = 47/48. 최저는 관측이 아직 없어 예전 값(TMN)을 써서 41/48,
--    'TMN 과 남은 예보 최저 중 낮은 것' = 46/48.
--  * 바꿈: ① 최고의 TMX 후보 = 오늘 나온 발표들 + 마지막 완료 발표(밤에는 어제 23시 발표). 낮(10:50 대조 59/60)에는 마지막 발표가 오늘 발표라 결과 같음.
--          ② 관측이 없을 때(00~01시) 최저 = TMN 과 남은 예보 최저 중 낮은 것(예전: TMN 만).
--  * 오전(09:30 무렵)에는 날씨누리 최저가 관측 규칙과 다르게 나온 기록이 있음(11/14 예약 대조) → 시각별 대조로 계속 확인.
--  * 저장해 둔 일별 결과(private.fc_cache 'd:…')는 지움(다음에 열 때 새로 계산).
begin;

do $g$ begin
  if md5(pg_get_functiondef('private.forecast_daily_cell_calc(integer, integer)'::regprocedure)) <> '7882d850790e55841b407f0f11455d42'
  then raise exception '100: 일별 계산 함수가 예상과 다름(다른 곳에서 바뀜) — 중단'; end if;
end $g$;

do $p$
declare d text := pg_get_functiondef('private.forecast_daily_cell_calc(integer, integer)'::regprocedure);
        pairs text[] := array[
  $x$           where (rr.tmfc at time zone 'Asia/Seoul')::date=today and j.value=jsonb_build_array(p_nx,p_ny) group by rr.tmfc) x on x.tmfc=a.tmfc$x$,
  $x$           where ((rr.tmfc at time zone 'Asia/Seoul')::date=today or rr.tmfc=fr.tmfc) and j.value=jsonb_build_array(p_nx,p_ny) group by rr.tmfc) x on x.tmfc=a.tmfc      -- 100: 밤에는 마지막 발표 TMX$x$,
  $x$  if v_omin is not null then v_tmin := least(round(v_omin), round(v_fmin)); end if;$x$,
  $x$  if v_omin is not null then v_tmin := least(round(v_omin), round(v_fmin));
  else v_tmin := least((select (t->>'tmin')::numeric from jsonb_array_elements(aux->'temperatures') t where (t->>'date')::date=today limit 1), round(v_fmin));      -- 100: 관측 전(밤) = TMN 과 남은 예보 최저 중 낮은 것
  end if;$x$];
        i int;
begin
  for i in 1 .. array_length(pairs, 1) / 2 loop
    if (length(d) - length(replace(d, pairs[2*i-1], ''))) <> length(pairs[2*i-1]) then raise exception '100: 바꿀 곳 %번이 한 군데가 아님', i; end if;
    d := replace(d, pairs[2*i-1], pairs[2*i]);
  end loop;
  execute d;
end $p$;

delete from private.fc_cache where k like 'd:%';

commit;
