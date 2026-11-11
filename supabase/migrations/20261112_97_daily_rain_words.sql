-- 97. 일별 1~3일째 비 문구를 날씨누리와 같게: 반나절 12시간 중 비 오는 시각 3개까지 '한때', 6개까지 '가끔', 7개부터 '계속'. 2026-11-12 Claude Code.
--  사용자(2026-11-12, 예약 대조 결과에 답): "1. 수정".
--  * 대조(11/12 00:40, 30칸, 단기 11/11 23시 발표끼리): 11/14 오전·오후 60칸에서 비 시각 수와 날씨누리 문구 —
--    1·2·3개 = 한때, 4·5·6개 = 가끔, 7~12개 = 계속(어긋남 0). 지금 규칙(2개·5개)이면 3개·6개인 칸이 한 단계 세게 나옴.
--  * 4일째(기상청이 양 대신 강도만 주는 구간, 4개 시각) 규칙 1·2·3+ 은 그대로(95).
--  * 저장해 둔 일별 결과(private.fc_cache 'd:…')는 지움(다음에 열 때 새로 계산 — 계산 결과 보관용이라 지워도 잃는 것 없음).
begin;

do $g$ begin
  if md5(pg_get_functiondef('private.forecast_daily_cell_calc(integer, integer)'::regprocedure)) <> 'ca696d56d5473c0cbbe6b6c0c8f5fe82'
  then raise exception '97: 일별 계산 함수가 예상과 다름(다른 곳에서 바뀜) — 중단'; end if;
end $g$;

do $p$
declare d text := pg_get_functiondef('private.forecast_daily_cell_calc(integer, integer)'::regprocedure);
        a text := $x$when rain<=case when far then 1 else 2 end then '한때 '||kind when rain<=case when far then 2 else 5 end then '가끔 '||kind$x$;
        b text := $x$when rain<=case when far then 1 else 3 end then '한때 '||kind when rain<=case when far then 2 else 6 end then '가끔 '||kind$x$;
begin
  if (length(d) - length(replace(d, a, ''))) <> length(a) then raise exception '97: 바꿀 곳이 한 군데가 아님'; end if;
  execute replace(d, a, b);
end $p$;

delete from private.fc_cache where k like 'd:%';

commit;
