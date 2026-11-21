-- 105. 앞 6시간(초단기 시각) 신적설을 날씨누리처럼 계산. 2026-11-21 Claude Code, 사용자 "적용해"(계산식 안 + 1℃ 규칙).
--  * 근거: docs/forecast-snow-point-20261120.md 1-3 (날씨누리 161개 발표·8,639칸·시각 대조).
--    날씨누리 앞 6시간 신적설은 단기 신적설이 아니라 초단기 강수형태·강수량·기온으로 따로 셈한 0.6cm 단위 값.
--  * 숫자를 보이는 때: 초단기 강수형태 '눈'(3) 이고 (기온 0℃ 이하 또는 1℃·강수 1mm 이상). 그 밖(비/눈·눈날림·2℃ 이상 등)은 0('-').
--  * 값: 아래 표(날씨누리에서 가장 자주 나온 값, 3.0 = '3~'). 강수 0 = '1mm 미만'('~1').
--  * 6시간 뒤(단기 시각)는 그대로(단기 격자 정수 + '~1'). 초단기 시각은 '~1'(sq) 표시 안 함.
--  * 이 값이 24시간 합(지도·지사 값)에도 들어감. 저장해 둔 격자 상세 결과(private.fc_cache 'c:…')는 지움(다음에 열 때 새로 계산).
begin;
set local lock_timeout = '10s';
set local statement_timeout = '45s';
select pg_advisory_xact_lock(hashtext('ss_fc_apply'));

do $g$ begin
  if md5(pg_get_functiondef('private.fc_apply(timestamptz,timestamptz)'::regprocedure)) <> '7f5e41b89bab8f84d648d63dd8c0297c'
  then raise exception '105: fc_apply 가 예상과 다름(다른 곳에서 바뀜) — 중단'; end if;
end $g$;

-- 강수(mm, 0 = 1mm 미만)·기온(℃) → 신적설(cm). 숫자를 보일지는 fc_apply 에서 정함
create or replace function private.fc_vsrt_snow(p double precision, t double precision)
returns double precision language sql immutable set search_path = '' as $f$
  select case when p is null or t is null then null
    when round(t) >= 1  then case when p < 3 then 0.6 when p < 4 then 1.2 when p < 6 then 1.8 when p < 8 then 2.4 else 3.0 end
    when round(t) = 0   then case when p < 2 then 0.6 when p < 3 then 1.2 when p < 4 then 1.8 else 3.0 end
    when round(t) = -1  then case when p < 1 then 0.6 when p < 2 then 1.2 when p < 3 then 1.8 else 3.0 end
    else                     case when p < 1 then 0.6 when p < 2 then 1.8 when p < 3 then 2.4 else 3.0 end
  end
$f$;
revoke all on function private.fc_vsrt_snow(double precision, double precision) from public, anon, authenticated;

do $p$
declare d text := pg_get_functiondef('private.fc_apply(timestamptz,timestamptz)'::regprocedure);
        pairs text[] := array[
  $x$             sh.s as s, coalesce(vx.p, sh.p) as p,$x$,
  $x$             case when vx.tmef is null or vx.p is null then sh.s      -- 105: 초단기 시각 신적설 = 날씨누리처럼 계산
                  when vx.y = 3 and (round(vx.t) <= 0 or (round(vx.t) = 1 and vx.p >= 1)) then private.fc_vsrt_snow(vx.p, vx.t)
                  else 0 end as s, coalesce(vx.p, sh.p) as p,$x$,
  $x$(m.s = 0 and coalesce(m.sy, 0) in (2, 3, 6, 7)) as sq$x$,
  $x$(not m.vs and m.s = 0 and coalesce(m.sy, 0) in (2, 3, 6, 7)) as sq      -- 105: 초단기 시각은 계산 값만$x$];
        i int;
begin
  for i in 1 .. array_length(pairs, 1) / 2 loop
    if (length(d) - length(replace(d, pairs[2*i-1], ''))) <> length(pairs[2*i-1]) then raise exception '105: 바꿀 곳 %번이 한 군데가 아님', i; end if;
    d := replace(d, pairs[2*i-1], pairs[2*i]);
  end loop;
  execute d;
end $p$;

delete from private.fc_cache where k like 'c:%';

commit;
