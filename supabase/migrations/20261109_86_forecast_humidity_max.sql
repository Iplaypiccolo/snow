-- 86. 3시간 칸 습도를 평균 → 3시간 중 최고로. 2026-11-09 Claude Code.
--  사용자 지시(2026-11-09 "습도값은 최고값으로 바꿔줘"). forecast_cell_detail 의 3시간 칸 reh 계산 한 곳만 바꿈(reh_n = 값이 있는 시각 수는 그대로).
begin;
do $p$ declare d text := pg_get_functiondef('public.forecast_cell_detail(integer,integer)'::regprocedure);
  o text := 'round(avg((v_rh->>(floor(extract(epoch from t::timestamptz))::bigint::text))::numeric),1) m';
  n text := 'max((v_rh->>(floor(extract(epoch from t::timestamptz))::bigint::text))::numeric) m';
begin
  if md5(d) <> 'e8d3c26233812222527a7419df4cc615' then raise exception '86: 함수가 예상과 다름 — 중단'; end if;
  if (length(d) - length(replace(d, o, ''))) <> length(o) then raise exception '86: 바꿀 곳이 한 군데가 아님'; end if;
  execute replace(d, o, n);
end $p$;
commit;
