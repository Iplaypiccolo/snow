-- 88. 일별 창 오늘 칸을 기상청 화면처럼: 이미 지난 시각은 빼고(다가올 정시부터), 가까운 6시간은 초단기 값. 2026-11-09 Claude Code.
--  사용자 결정(2026-11-09 "나로 진행해줘"): 오늘 오후 칸이 기상청과 달랐던 원인 두 가지(지난 시각 포함·초단기 미사용)를 고침.
--  1) 초단기 수집에 하늘 상태(SKY) 추가: forecast_vsrt_begin 받을 종류 4→5(10분마다 기상청 호출 24→30번), forecast_vsrt_put 허용·완료 기준 24→30, 저장 종류 규칙에 SKY
--  2) forecast_daily_cell: 다가올 정시 이후 시각만, 초단기 확률·강수형태·하늘이 다 있는 시각은 초단기 값(빗방울 5·빗방울눈날림 6·눈날림 7 포함)
--  3) forecast_version d 에 초단기 발표 완료 시각(10분마다 일별 창 오늘 칸이 바뀜)
--  수집 함수(collect-forecast)는 서버가 알려 주는 목록대로 받으므로 고치지 않음. 24시간 계산(fc_apply)은 SKY 를 쓰지 않으므로 그대로.
begin;

do $g$ begin
  if md5(pg_get_functiondef('public.forecast_vsrt_begin(timestamptz)'::regprocedure)) <> '305c08b9871b93e33494f8fac64b4a89'
  or md5(pg_get_functiondef('public.forecast_vsrt_put(timestamptz,text,timestamptz,real[])'::regprocedure)) <> 'bd93add686564f45a1b222e9b737df36'
  or md5(pg_get_functiondef('public.forecast_daily_cell(integer,integer)'::regprocedure)) <> '5b74c8b64831cddab6288c65b848de72'
  or md5(pg_get_functiondef('public.forecast_version()'::regprocedure)) <> '557ccb62404bfaa2f3b434a2aa38ad05'
  then raise exception '88: 함수가 예상과 다름(다른 곳에서 바뀜) — 중단'; end if;
end $g$;

create or replace function private.fc_patch88(p_fn regprocedure, p_old text, p_new text) returns void language plpgsql as $p$
declare d text := pg_get_functiondef(p_fn);
begin
  if (length(d) - length(replace(d, p_old, ''))) <> length(p_old) then raise exception '88: % 바꿀 곳이 한 군데가 아님: %', p_fn, left(p_old, 60); end if;
  execute replace(d, p_old, p_new);
end $p$;

-- 1) 초단기 하늘 상태
alter table public.forecast_vsrt_hours drop constraint forecast_vsrt_hours_var_check;
alter table public.forecast_vsrt_hours add constraint forecast_vsrt_hours_var_check check (var = any (array['T1H','RN1','POP','PTY','SKY']));
select private.fc_patch88('public.forecast_vsrt_begin(timestamptz)'::regprocedure,
  'unnest(array[''T1H'', ''RN1'', ''POP'', ''PTY'']) v', 'unnest(array[''T1H'', ''RN1'', ''POP'', ''PTY'', ''SKY'']) v');
select private.fc_patch88('public.forecast_vsrt_put(timestamptz,text,timestamptz,real[])'::regprocedure,
  'if p_var not in (''T1H'', ''RN1'', ''POP'', ''PTY'') then', 'if p_var not in (''T1H'', ''RN1'', ''POP'', ''PTY'', ''SKY'') then');
select private.fc_patch88('public.forecast_vsrt_put(timestamptz,text,timestamptz,real[])'::regprocedure,
  'if n < 24 then return', 'if n < 30 then return');      -- 88: 5종 × 6시각

-- 2) 일별 창
create or replace function public.forecast_daily_cell(p_nx integer, p_ny integer)
 returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare region jsonb; aux jsonb; days jsonb; today date:=(now() at time zone 'Asia/Seoul')::date; fr public.forecast_runs; ci int; vt timestamptz; vc jsonb; vi int;
begin
  -- 기존 함수의 로그인/현재 편입격자 검사를 그대로 통과해야 한다.
  aux:=public.forecast_daily_aux_cell(p_nx,p_ny);
  region:=private.fc_daily_region(p_nx,p_ny);
  if region->>'status'='ok' then
    region:=region||jsonb_build_object(
      'short_land_name',(select v->>'name' from private.forecast_midterm_cache c
        cross join lateral jsonb_array_elements(c.payload)v
        where c.kind='regions' and v->>'reg_id'=region->>'temp_id' limit 1),
      'midterm_land_name',(select v->>'name' from private.forecast_midterm_cache c
        cross join lateral jsonb_array_elements(c.payload)v
        where c.kind='regions' and v->>'reg_id'=region->>'land_id' limit 1));
  end if;
  -- 84: 최신 완료 단기 발표와 그 안에서 이 격자의 순번
  select * into fr from public.forecast_runs where done_at is not null order by tmfc desc limit 1;
  if found then
    select min(j.ordinality)::int into ci from jsonb_array_elements(fr.cells) with ordinality j where j.value=jsonb_build_array(p_nx,p_ny);
  end if;
  -- 88: 가까운 시각은 초단기(기상청 화면과 같이). 24시간 계산(fc_apply)과 같은 기준으로 고른 최신 완성 초단기 발표
  select v.tmfc, v.cells into vt, vc from public.forecast_vsrt_runs v
   where v.done_at is not null and v.tmfc > now() - interval '3 hours'
     and not exists (select 1 from public.forecast_vsrt_hours z where z.tmfc = v.tmfc and z.var = 'T1H'
                       and not exists (select 1 from unnest(z.vals) q where q > -90 and q <> 0))
   order by v.tmfc desc limit 1;
  if vt is not null then
    select min(j.ordinality)::int into vi from jsonb_array_elements(vc) with ordinality j where j.value=jsonb_build_array(p_nx,p_ny);
  end if;
  with near_weather as materialized(
    select v,c.issued_at from private.forecast_daily_weather_cache c
      cross join lateral jsonb_array_elements(c.payload)v
    where c.issued_at>=now()-interval '36 hours' and v->>'reg_id'=region->>'temp_id'),
  far_weather as materialized(
    select v,c.issued_at from private.forecast_midterm_cache c
      cross join lateral jsonb_array_elements(c.payload)v
    where c.kind='land' and c.issued_at>=now()-interval '36 hours' and v->>'reg_id'=region->>'land_id'),
  far_temps as materialized(
    select v,c.issued_at from private.forecast_midterm_cache c
      cross join lateral jsonb_array_elements(c.payload)v
    where c.kind='temperature' and c.issued_at>=now()-interval '36 hours' and v->>'reg_id'=region->>'temp_id'),
  -- 84: 격자 시간별 강수확률·강수형태(최신 완료 발표)
  gh as materialized(
    -- 빈 시각(기상청이 전 칸 0 으로 주는 시각, 예: 4일째 23시)은 자리만 세고 값 계산에서는 뺌
    select h.tmef, bool_or(h.is_empty) e,
           max(case when not h.is_empty then h.vals[ci] end) filter(where h.var='POP') pop,
           max(case when not h.is_empty then h.vals[ci] end) filter(where h.var='PTY') pty
      from public.forecast_hours h
     where ci is not null and h.tmfc=fr.tmfc and h.var in('POP','PTY')
     group by h.tmef),
  -- 84: 시각별 가장 최근 발표의 하늘 상태(새 발표 SKY 가 다 오기 전에는 앞 발표 값)
  sk as materialized(
    select distinct on(a.tmef) a.tmef, a.tmfc, a.vals[x.i] sky
      from private.forecast_daily_aux_hours a
      join (select rr.tmfc, min(j.ordinality)::int i from public.forecast_runs rr
              cross join lateral jsonb_array_elements(rr.cells) with ordinality j
             where rr.tmfc>=now()-interval '48 hours' and j.value=jsonb_build_array(p_nx,p_ny) group by rr.tmfc) x on x.tmfc=a.tmfc
     where a.var='SKY' and not a.is_empty and a.vals[x.i] is not null and a.tmef in(select tmef from gh where not e)
     order by a.tmef, a.tmfc desc),
  vs as materialized(
    select h.tmef,
           max(h.vals[vi]) filter(where h.var='POP') pop, max(h.vals[vi]) filter(where h.var='PTY') pty,
           max(h.vals[vi]) filter(where h.var='SKY') sky
      from public.forecast_vsrt_hours h
     where vi is not null and h.tmfc=vt and h.var in('POP','PTY','SKY')
     group by h.tmef),
  -- 88: 초단기 세 값이 다 있는 시각은 초단기 값, 아니면 단기 값
  gv as(
    select g.tmef, v.pop is not null and v.pop>=0 and v.pty is not null and v.pty>=0 and v.sky in(1,3,4) vok,
           g.e, g.pop, g.pty, v.pop vpop, v.pty vpty, v.sky vsky
      from gh g left join vs v on v.tmef=g.tmef),
  hh as(
    select g.tmef, g.e and not g.vok e,
           case when g.vok then g.vpop else g.pop end pop, case when g.vok then g.vpty else g.pty end pty,
           case when g.vok then g.vsky else s.sky end sky, case when g.vok then vt else s.tmfc end sky_tmfc,
           ((g.tmef-interval '1 hour') at time zone 'Asia/Seoul')::date d,
           extract(hour from (g.tmef-interval '1 hour') at time zone 'Asia/Seoul')<12 am
      from gv g left join sk s on s.tmef=g.tmef
     where g.tmef>now()      -- 88: 이미 지난 시각은 빼고 다가올 정시부터(기상청 화면과 같이)
       and ((g.e and not g.vok) or (case when g.vok then g.vpop else g.pop end)>=0 and (case when g.vok then g.vpty else g.pty end)>=0)),
  halfs as(
    -- 강수형태: 단기 1 비·2 비/눈·3 눈·4 소나기, 초단기 5 빗방울·6 빗방울눈날림·7 눈날림
    select d, am, count(*) n, count(*) filter(where not e) ne, count(sky) ns, count(*) filter(where pty>0) rain,
           max(pop) mx, avg(pop::numeric) av,
           avg(case sky when 1 then 1 when 3 then 2 when 4 then 3 end) sv,
           bool_or(pty in(2,6)) or (bool_or(pty in(3,7)) and bool_or(pty in(1,4,5))) mixed,
           bool_and(pty in(0,3,7)) snow_only, bool_and(pty in(0,4)) shower_only, max(sky_tmfc) sky_at
      from hh where d>=today group by d, am),
  grid_weather as(
    select (q.d+case when q.am then 0 else 12 end*interval '1 hour') at time zone 'Asia/Seoul' t,
           q.*, case when q.mixed then '비/눈' when q.snow_only then '눈' when q.shower_only then '소나기' else '비' end kind,
           case when q.mixed then '2' when q.snow_only then '3' when q.shower_only then '4' else '1' end pcode,
           round(q.sv)::int lv
      from halfs q
     where q.ne>0 and q.ns=q.ne and (q.n=12 or (q.d=today and (q.d+case when q.am then 12 else 24 end*interval '1 hour') at time zone 'Asia/Seoul'>now()))),
  grid_periods as(
    select t, jsonb_build_object('forecast_at',t,'period_hours',12,
             'pop',(case when rain>0 then mx else round(av/10)*10 end)::int,
             'sky','DB0'||case lv when 1 then '1' when 2 then '3' else '4' end,
             'precip',case when rain>0 then pcode else '0' end,
             'weather',case when rain=0 then case lv when 1 then '맑음' when 2 then '구름많음' else '흐림' end
                            when rain<=2 then '한때 '||kind when rain<=5 then '가끔 '||kind else kind||' 계속' end,
             'source','short_grid','issued_at',fr.tmfc,'sky_issued_at',sky_at,'hours',n) v
      from grid_weather),
  calendar as(select today+i d from generate_series(0,6)i),
  combined as(
    select d,
      (select jsonb_agg(w.r order by w.t)from(
        select distinct on(t) t,r from(
          select t,-1 priority,v r from grid_periods
          union all select(v->>'forecast_at')::timestamptz t,0 priority,
            v||jsonb_build_object('source','short_land','issued_at',issued_at)r from near_weather
          union all select(v->>'forecast_at')::timestamptz,1,
            v||jsonb_build_object('source','midterm_land','issued_at',issued_at)from far_weather
        )all_weather where(t at time zone 'Asia/Seoul')::date=d order by t,priority
      )w) periods,
      (select v from jsonb_array_elements(aux->'temperatures')v where(v->>'date')::date=d) nt,
      (select v||jsonb_build_object('issued_at',issued_at)from far_temps where(v->>'date')::date=d) ft,
      exists(select 1 from near_weather where((v->>'forecast_at')::timestamptz at time zone 'Asia/Seoul')::date=d) near_day
    from calendar)
  select jsonb_agg(jsonb_build_object('date',d,'periods',coalesce(periods,'[]'::jsonb),
    'tmin',case when nt is not null or near_day then nt->'tmin' else ft->'tmin'end,
    'tmax',case when nt is not null or near_day then nt->'tmax' else ft->'tmax'end,
    'tmin_issued_at',case when nt is not null or near_day then nt->'tmin_issued_at' else ft->'issued_at'end,
    'tmax_issued_at',case when nt is not null or near_day then nt->'tmax_issued_at' else ft->'issued_at'end,
    'temperature_source',case when nt is not null or near_day then 'grid_aux'
      when ft is not null then 'midterm_temperature' else null end)order by d) into days from combined;
  return jsonb_build_object('nx',p_nx,'ny',p_ny,'region',region,'days',days,
    'status',case when exists(select 1 from jsonb_array_elements(days)x
      where jsonb_array_length(x->'periods')>0 or x->'tmin'<>'null'::jsonb or x->'tmax'<>'null'::jsonb)
      then 'ok' else 'no_data'end);
end $function$;

-- 3) 초단기가 바뀌면 일별 창도 다시 받게
select private.fc_patch88('public.forecast_version()'::regprocedure,
  '(select max(x.done_at) from public.forecast_runs x)',
  '(select max(x.done_at) from public.forecast_runs x),(select max(y.done_at) from public.forecast_vsrt_runs y)');

drop function private.fc_patch88(regprocedure, text, text);
commit;
