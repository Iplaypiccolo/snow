-- 87. 3시간 칸의 습도 개수(reh_n) 빼기. 2026-11-09 Claude Code.
--  사용자 지시(2026-11-09 "정말 습도 개수값을 안쓴다면 안쓰는건 지워"): 86 에서 3시간 칸 습도를 최고값으로 바꾼 뒤 reh_n 은 화면이 쓰지 않음.
--  forecast_cell_detail 의 3시간 칸에 붙이던 reh_n 만 뺌(reh 는 그대로). 값이 있는 시각이 없으면 reh 도 붙이지 않는 것은 그대로.
begin;
do $p$ declare d text := pg_get_functiondef('public.forecast_cell_detail(integer,integer)'::regprocedure);
  o text := 'jsonb_build_object(''reh'',s.m,''reh_n'',s.n)';
  n text := 'jsonb_build_object(''reh'',s.m)';
begin
  if md5(d) <> '5f85662e74136ce984688b307d8b7586' then raise exception '87: 함수가 예상과 다름 — 중단'; end if;
  if (length(d) - length(replace(d, o, ''))) <> length(o) then raise exception '87: 바꿀 곳이 한 군데가 아님'; end if;
  execute replace(d, o, n);
end $p$;
commit;
