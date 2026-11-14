-- 98. 1시간 표 초단기 시각의 '빗방울'(강수형태 5·6·7)을 날씨누리처럼 이름으로. 2026-11-14 Claude Code.
--  사용자(2026-11-14, 비 오는 중 대조 뒤): "초단기, 단기, 일별예보 ... 모두 기상청과 동일해야 해 ... 지금 당장 수정 가능한 부분은 수정".
--  * 대조(11/14 09:30, 11칸, 초단기 09:10 발표끼리): 날씨누리는 초단기 강수형태가 빗방울(5)인 시각의 강수량 칸에 '빗방울'을 씀(3시각),
--    우리는 '~1'. 서버는 초단기 강수형태(PTY)를 이미 받아 둠 → 격자 상세(forecast_cell_detail)의 가까운 24시간 값에 'pt'(5·6·7만, 나머지 null)를 붙임.
--    화면(forecast/ui.js)이 pt 5·6 = 강수량 '빗방울', 6·7 = 신적설 '눈날림'으로 보임(6·7은 날씨누리 화면으로 아직 확인 못 함).
--  * 기존 값(s·p·t·r·sq·pq·h)은 그대로. 초단기가 없는 시각은 pt 없음.
--  * 저장해 둔 격자 상세 결과(private.fc_cache 'c:…')는 지움(다음에 열 때 새로 계산 — 계산 결과 보관용이라 지워도 잃는 것 없음).
begin;

do $g$ begin
  if md5(pg_get_functiondef('private.forecast_cell_detail_calc(integer, integer)'::regprocedure)) <> '39ea5854a40e0f0a0afd81fae5487c8d'
  then raise exception '98: 격자 상세 계산 함수가 예상과 다름(다른 곳에서 바뀜) — 중단'; end if;
end $g$;

do $p$
declare d text := pg_get_functiondef('private.forecast_cell_detail_calc(integer, integer)'::regprocedure);
        pairs text[] := array[
  $x$vt timestamptz; vc jsonb; vi int;    -- 89: 초단기 발표·격자 순번$x$,
  $x$vt timestamptz; vc jsonb; vi int;    -- 89: 초단기 발표·격자 순번
  v_pt jsonb;                          -- 98: 초단기 강수형태 5·6·7(빗방울·빗방울눈날림·눈날림)$x$,
  $x$  return jsonb_build_object('nx',p_nx,'ny',p_ny,'status','ok','collecting',v_collecting,$x$,
  $x$  -- 98: 가까운 24시간 중 초단기 강수형태가 빗방울(5)·빗방울눈날림(6)·눈날림(7)인 시각(날씨누리는 강수량 칸에 이름으로 씀)
  if vi is not null then
    select jsonb_agg(z.v order by x.t) into v_pt
      from generate_series(v_start,v_start+interval '23 hours',interval '1 hour') x(t)
      left join lateral (select case when h.vals[vi] in (5,6,7) then h.vals[vi]::int end v
                           from public.forecast_vsrt_hours h where h.tmfc=vt and h.var='PTY' and h.tmef=x.t limit 1) z on true;
    if not exists(select 1 from jsonb_array_elements(v_pt) e where e<>'null'::jsonb) then v_pt:=null; end if;
  end if;
  return jsonb_build_object('nx',p_nx,'ny',p_ny,'status','ok','collecting',v_collecting,$x$,
  $x$then c.series||jsonb_build_object('h',v_h) else c.series end),$x$,
  $x$then c.series||jsonb_build_object('h',v_h) else c.series end||case when v_pt is not null then jsonb_build_object('pt',v_pt) else '{}'::jsonb end),$x$];
        i int;
begin
  for i in 1 .. array_length(pairs, 1) / 2 loop
    if (length(d) - length(replace(d, pairs[2*i-1], ''))) <> length(pairs[2*i-1]) then raise exception '98: 바꿀 곳 %번이 한 군데가 아님', i; end if;
    d := replace(d, pairs[2*i-1], pairs[2*i]);
  end loop;
  execute d;
end $p$;

delete from private.fc_cache where k like 'c:%';

commit;
