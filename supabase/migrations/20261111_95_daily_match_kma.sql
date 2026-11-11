-- 95. 일별 창을 날씨누리와 같게: 4일째(기상청이 양 대신 강도만 주는 구간) 오전·오후는 3시간 간격 4개 시각, 날짜는 오늘부터 11일. 2026-11-11 Claude Code.
--  사용자(2026-11-11): "1시간, 3시간, 일별 예보가 기상청과 동일해야 한다" / "너가 분석한게 맞다면 그렇게 바꿔줘".
--  * 대조(39칸): 날씨누리 4일째 오전(01~12시)·오후(13~24시)는 12시간이 아니라 03·06·09·12시(오후 15·18·21·24시) 4개 시각으로 정함.
--    비 오는 시각 1개 = 한때, 2개 = 가끔, 3개 이상 = 계속. 확률 = 비가 있으면 4개 중 최고, 없으면 평균(10% 단위). 하늘도 4개 시각 평균.
--    이 규칙으로 78/78 같음(지금 12시간 규칙은 39일 중 14일만 같음). 2·3일째(양이 있는 구간)는 지금 규칙 그대로(78/78 같음).
--  * 구간 = 그 발표의 양 끝(private.fc_quantity_end) 뒤. 오늘·가까운 날 계산과 지역 대표값은 그대로.
--  * 사용자 "1~3도 바꿔줘. 기상청과 동일하게": 7일 → 11일(날씨누리처럼 오늘~10일 뒤, 8~10일 뒤는 중기 하루 한 칸). 받아 둔 중기예보로 계산(새로 받는 것 없음).
--  * 저장해 둔 일별 결과(private.fc_cache 'd:…')는 지움(다음에 열 때 새로 계산 — 계산 결과 보관용이라 지워도 잃는 것 없음).
begin;

do $g$ begin
  if md5(pg_get_functiondef('private.forecast_daily_cell_calc(integer, integer)'::regprocedure)) <> '55e40ee7859f20e2d059a08a6833d04b'
  then raise exception '95: 일별 계산 함수가 예상과 다름(다른 곳에서 바뀜) — 중단'; end if;
end $g$;

create or replace function pg_temp.patch_fn(p_sig text, p_pairs text[]) returns text language plpgsql as $f$
declare d text := pg_get_functiondef(p_sig::regprocedure); i int;
begin
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(d) - length(replace(d, p_pairs[2*i-1], ''))) <> length(p_pairs[2*i-1]) then raise exception '95: % 바꿀 곳 %번이 한 군데가 아님', p_sig, i; end if;
    d := replace(d, p_pairs[2*i-1], p_pairs[2*i]);
  end loop;
  return d;
end $f$;

do $p$ begin
  execute pg_temp.patch_fn('private.forecast_daily_cell_calc(integer, integer)', array[
    -- 1) 시각마다 '양이 없는 구간'인지
    $x$extract(hour from (g.tmef-interval '1 hour') at time zone 'Asia/Seoul')<12 am
      from gv g left join sk s on s.tmef=g.tmef$x$,
    $x$extract(hour from (g.tmef-interval '1 hour') at time zone 'Asia/Seoul')<12 am,
           coalesce(g.tmef>private.fc_quantity_end(fr.tmfc),false) far      -- 95: 기상청이 양 대신 강도만 주는 구간
      from gv g left join sk s on s.tmef=g.tmef$x$,
    -- 2) 그 구간의 반나절은 3시간 간격 시각만
    $x$select d, am, count(*) n,$x$,
    $x$select d, am, bool_and(far) far, count(*) n,$x$,
    $x$      from hh where d>=today group by d, am),$x$,
    $x$      from hh where d>=today and (not far or extract(hour from tmef at time zone 'Asia/Seoul')::int % 3 = 0) group by d, am),      -- 95$x$,
    -- 3) 다 찬 반나절: 12시각(그 구간은 4시각)
    $x$(q.n=12 or (q.d=today$x$,
    $x$(q.n=case when q.far then 4 else 12 end or (q.d=today$x$,
    -- 4) 한때·가끔·계속: 그 구간은 비 시각 1개·2개·3개 이상
    $x$when rain<=2 then '한때 '||kind when rain<=5 then '가끔 '||kind else kind||' 계속' end$x$,
    $x$when rain<=case when far then 1 else 2 end then '한때 '||kind when rain<=case when far then 2 else 5 end then '가끔 '||kind else kind||' 계속' end$x$,
    -- 5) 오늘부터 11일
    $x$calendar as(select today+i d from generate_series(0,6)i),$x$,
    $x$calendar as(select today+i d from generate_series(0,10)i),      -- 95: 날씨누리처럼 11일$x$]);
end $p$;

delete from private.fc_cache where k like 'd:%';

commit;
