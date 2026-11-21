-- 106. 6시간 뒤(단기) '비/눈' 시각 신적설은 날씨누리처럼 '-'. 2026-11-21 Claude Code, 사용자 "적용해"(신적설 날씨누리와 같게).
--  * 근거: 날씨누리 6시간 뒤 '비/눈' 시각 신적설은 늘 '-'(11/19~21 대조 회차마다 예외 0, 11/21 16:10 발표 45칸 대조에서 우리만 '~1' 4곳).
--    단기 칸 조회(getVilageFcst)도 그 시각은 '적설없음'.
--  * 바꾸는 것: '1cm 미만'(sq) 표시를 단기 강수형태 '눈'(3) 시각에만. 신적설 값(s) 자체는 그대로.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '45s';
select pg_advisory_xact_lock(hashtext('ss_fc_apply'));

do $p$
declare d text := pg_get_functiondef('private.fc_apply(timestamptz,timestamptz)'::regprocedure);
        a text := $x$(not m.vs and m.s = 0 and coalesce(m.sy, 0) in (2, 3, 6, 7)) as sq      -- 105: 초단기 시각은 계산 값만$x$;
        b text := $x$(not m.vs and m.s = 0 and coalesce(m.sy, 0) = 3) as sq      -- 105: 초단기 시각은 계산 값만. 106: '비/눈'(2) 시각은 '-'$x$;
begin
  if (length(d) - length(replace(d, a, ''))) <> length(a) then raise exception '106: 바꿀 곳이 한 군데가 아님(fc_apply 가 105 뒤에 바뀜) — 중단'; end if;
  execute replace(d, a, b);
end $p$;

delete from private.fc_cache where k like 'c:%';

commit;
