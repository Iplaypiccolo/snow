-- 81. 예보 값 정확성(계획 docs/forecast-fix-plan-20261109.md 1단계). 2026-11-09 Claude Code. 사용자 SQL 확인 후 적용.
--  1) 초단기: 기온(T1H)의 유효 칸(결측 -99 제외)이 모두 0 인 시각이 있으면 그 발표분은 미완성으로 본다.
--     - forecast_vsrt_put: 그런 기온이 들어오면 그 발표분의 받은 값을 지우고 {incomplete:true} → 수집기가 한 칸 앞 발표분을 받고, 다음 예약에 다시 시도
--     - forecast_vsrt_begin: 기온을 마지막 시각부터 먼저 받게 순서만 바꿈(미완성이면 첫 요청에서 바로 알아챔)
--     - fc_apply: 이미 다 받은 발표분이라도 그런 시각이 있으면 섞지 않음(단기만). 61의 "q <> 0" 이 결측 -99 때문에 통과되던 것 수정
--  2) 단기: 기온 유효 칸이 모두 0 으로 저장된 시각(수집기 빈 시각 판단 오류로 들어온 4일째 23시 등)을 빈 시각(is_empty)으로 고침
--     값이 아닌 "빈 시각" 표시만 바꿈. 예보 묶음(forecast_hours) 외 다른 표는 건드리지 않음
--  3) fc_end: 계산 결과는 같고(2026~2027 10분 간격 105,120개 비교, 차이 0) 시간대 표 없이 UTC+9 고정 계산 → IMMUTABLE 표시와 맞춤
--  끝에 24시간 예보를 다시 계산(fc_refresh) — 지금 섞인 10:00 초단기(16시 전국 0)가 빠짐
begin;
set local lock_timeout = '10s';
set local statement_timeout = '45s';
do $m$
declare d text; o text; n text;
begin
  if not pg_try_advisory_xact_lock(hashtext('ss_fc_apply')) then raise exception 'forecast busy; no changes made'; end if;
  if md5(pg_get_functiondef('private.fc_apply(timestamptz,timestamptz)'::regprocedure)) <> 'f7a0ccd66a3cf963c52a6cba7418a4e2' then raise exception 'fc_apply changed since review'; end if;
  if md5(pg_get_functiondef('public.forecast_vsrt_put(timestamptz,text,timestamptz,real[])'::regprocedure)) <> 'd12a3f5934ec5078877fb25b10130caa' then raise exception 'forecast_vsrt_put changed since review'; end if;
  if md5(pg_get_functiondef('public.forecast_vsrt_begin(timestamptz)'::regprocedure)) <> 'c86bd534083fb582a303207a49ee89ee' then raise exception 'forecast_vsrt_begin changed since review'; end if;
  if md5(pg_get_functiondef('private.fc_end(timestamptz)'::regprocedure)) <> 'e18e423517f354d221e44ce189ee675f' then raise exception 'fc_end changed since review'; end if;

  -- fc_apply: 섞을 초단기 고르기 + 시각 조건
  d := pg_get_functiondef('private.fc_apply(timestamptz,timestamptz)'::regprocedure);
  o := $o$where v.done_at is not null and v.tmfc > now() - interval '3 hours' order by v.tmfc desc limit 1;$o$;
  n := $n$where v.done_at is not null and v.tmfc > now() - interval '3 hours'
     and not exists (select 1 from public.forecast_vsrt_hours z where z.tmfc = v.tmfc and z.var = 'T1H' and not exists (select 1 from unnest(z.vals) q where q > -90 and q <> 0))      -- 81: 기온 유효 칸이 모두 0 인 시각이 있으면 미완성 발표분 → 통째로 섞지 않음
   order by v.tmfc desc limit 1;$n$;
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then raise exception 'fc_apply patch 1 not unique'; end if;
  d := replace(d, o, n);
  o := $o$exists (select 1 from unnest(z.vals) q where q <> 0))      -- 61:$o$;
  n := $n$exists (select 1 from unnest(z.vals) q where q > -90 and q <> 0))      -- 61(81: 결측 -99 제외):$n$;
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then raise exception 'fc_apply patch 2 not unique'; end if;
  execute replace(d, o, n);

  -- forecast_vsrt_put: 미완성 기온이면 그 발표분 받은 값을 지우고 알림
  d := pg_get_functiondef('public.forecast_vsrt_put(timestamptz,text,timestamptz,real[])'::regprocedure);
  o := $o$  insert into public.forecast_vsrt_hours (tmfc, var, tmef, vals) values (p_tmfc, p_var, p_tmef, p_vals)$o$;
  n := $n$  if p_var = 'T1H' and not exists (select 1 from unnest(p_vals) q where q > -90 and q <> 0) then      -- 81: 기온 유효 칸이 모두 0 = 기상청이 아직 다 만들지 않은 발표분
    delete from public.forecast_vsrt_hours where tmfc = p_tmfc;
    return jsonb_build_object('ok', true, 'incomplete', true);
  end if;
  insert into public.forecast_vsrt_hours (tmfc, var, tmef, vals) values (p_tmfc, p_var, p_tmef, p_vals)$n$;
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then raise exception 'forecast_vsrt_put patch not unique'; end if;
  execute replace(d, o, n);

  -- forecast_vsrt_begin: 기온을 마지막 시각부터 먼저, 나머지는 시각·종류 순
  d := pg_get_functiondef('public.forecast_vsrt_begin(timestamptz)'::regprocedure);
  o := $o$jsonb_agg(jsonb_build_array(v, h) order by h, v)$o$;
  n := $n$jsonb_agg(jsonb_build_array(v, h) order by v <> 'T1H', case when v = 'T1H' then h end desc, h, v)$n$;
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then raise exception 'forecast_vsrt_begin patch not unique'; end if;
  execute replace(d, o, n);
end $m$;

create or replace function private.fc_end(p_tmfc timestamptz) returns timestamptz
language sql immutable set search_path = '' as $$
  -- 81: 한국 시각 = UTC+9 고정(일광절약 없음). 17시 전 발표 → 발표일+4일 0시, 17시 이후 → +5일 0시(68과 같은 결과)
  select to_timestamp((floor((extract(epoch from p_tmfc) + 32400) / 86400)
    + case when floor(mod((extract(epoch from p_tmfc) + 32400)::numeric, 86400) / 3600) < 17 then 4 else 5 end) * 86400 - 32400)
$$;

-- 단기: 기온 유효 칸이 모두 0 으로 저장된 시각 → 5종 모두 빈 시각
update public.forecast_hours h set vals = array_fill(0::real, array[array_length(h.vals, 1)]), is_empty = true
  from (select t.tmfc, t.tmef from public.forecast_hours t
         where t.var = 'TMP' and not t.is_empty and not exists (select 1 from unnest(t.vals) q where q > -90 and q <> 0)) e
 where h.tmfc = e.tmfc and h.tmef = e.tmef and not h.is_empty;

select private.fc_refresh();
commit;
