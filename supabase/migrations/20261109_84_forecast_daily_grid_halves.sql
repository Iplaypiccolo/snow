-- 84. 일별 창의 가까운 날 오전/오후 날씨·강수확률을 격자 시간별 값의 요약으로(기상청 날씨누리 방식). 2026-11-09 Claude Code.
--  사용자 결정(2026-11-09 "가안으로 하자"): 지역 대표값(단기 육상예보) 대신 선택 격자의 시간별 값으로 계산. 사용자는 SQL 원문 대신 작용 설명으로 확인.
--  기상청 날씨누리 110개 격자(무작위) 대조로 찾은 규칙(docs/forecast-daily-grid-halves.md):
--   - 오전 = 01~12시, 오후 = 13~24시(그 시각까지의 1시간 값) 12시간
--   - 강수확률: 비·눈 오는 시각(강수형태>0)이 있으면 12시간 최고, 없으면 평균을 10% 단위 반올림(5는 올림)
--   - 하늘: 맑음1·구름많음2·흐림3 의 평균을 반올림
--   - 비·눈 문구: 오는 시각 1~2 '한때', 3~5 '가끔', 6 이상 '… 계속'. 눈·비/눈·소나기 문구는 아직 기상청과 대조 못 함(눈 예보 없던 날)
--  1) 일별 보강 수집이 하늘 상태(SKY)도 받음, 예약 20분 → 10분 간격(수집기 collect-daily-aux 는 이미 sky:true 를 지원)
--  2) forecast_daily_cell: 최신 완료 단기 발표의 시간별 강수확률·강수형태 + 시각별 최신 SKY 로 반나절 값을 만들고, 12시간이 다 있는 반나절만 사용
--     (오늘은 남은 반나절이면 있는 시각만). SKY 가 빠진 반나절은 예전처럼 지역 대표값 → 중기. 응답 모양은 같고 source 만 'short_grid'
--  3) forecast_version d 에 단기 발표 완료 시각 추가(새 발표 강수확률이 나오면 일별 창도 다시 받음)
begin;

do $g$ begin
  if md5(pg_get_functiondef('private.kick_daily_aux()'::regprocedure)) <> '8042870190104b3f06422ddc36052ac7'
  or md5(pg_get_functiondef('public.forecast_daily_cell(integer,integer)'::regprocedure)) <> '73f70251a7e119da3eb06776ea0095f3'
  or md5(pg_get_functiondef('public.forecast_version()'::regprocedure)) <> '88be6c7ab43d69494977219c55e651db'
  then raise exception '84: 함수가 예상과 다름(다른 곳에서 바뀜) — 중단'; end if;
end $g$;

-- 1) SKY 수집 켜기
do $k$ declare d text := pg_get_functiondef('private.kick_daily_aux()'::regprocedure); begin
  if (length(d) - length(replace(d, 'forecast_daily_aux_plan(false)', ''))) <> length('forecast_daily_aux_plan(false)')
  or (length(d) - length(replace(d, 'jsonb_build_object(''sky'',false)', ''))) <> length('jsonb_build_object(''sky'',false)')
  then raise exception '84: kick_daily_aux 바꿀 곳이 한 군데가 아님'; end if;
  execute replace(replace(d, 'forecast_daily_aux_plan(false)', 'forecast_daily_aux_plan(true)'),
                  'jsonb_build_object(''sky'',false)', 'jsonb_build_object(''sky'',true)');
end $k$;
select cron.schedule('collect-daily-aux', '*/10 * * * *', 'select private.kick_daily_aux()');

-- 2) 일별 창
create or replace function public.forecast_daily_cell(p_nx integer, p_ny integer)
 returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare region jsonb; aux jsonb; days jsonb; today date:=(now() at time zone 'Asia/Seoul')::date; fr public.forecast_runs; ci int;
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
  hh as(
    select g.tmef, g.e, g.pop, g.pty, s.sky, s.tmfc sky_tmfc,
           ((g.tmef-interval '1 hour') at time zone 'Asia/Seoul')::date d,
           extract(hour from (g.tmef-interval '1 hour') at time zone 'Asia/Seoul')<12 am
      from gh g left join sk s on s.tmef=g.tmef
     where g.e or (g.pop>=0 and g.pty>=0)),
  halfs as(
    select d, am, count(*) n, count(*) filter(where not e) ne, count(sky) ns, count(*) filter(where pty>0) rain,
           max(pop) mx, avg(pop::numeric) av,
           avg(case sky when 1 then 1 when 3 then 2 when 4 then 3 end) sv,
           bool_or(pty=2) or (bool_or(pty=3) and bool_or(pty in(1,4))) mixed,
           bool_and(pty in(0,3)) snow_only, bool_and(pty in(0,4)) shower_only, max(sky_tmfc) sky_at
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

-- 3) 새 단기 발표가 끝나면 일별 창도 다시 받게
create or replace function public.forecast_version() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.forecast_runs; h text := to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDDHH24');
begin
  if (select private.my_role()) is null then raise exception 'login required' using errcode = '42501'; end if;
  select * into r from public.forecast_runs order by tmfc desc limit 1;
  return jsonb_build_object(
    'c', concat_ws('.', h,
      floor(extract(epoch from (select max(f.updated_at) from public.forecast_cells f)))::bigint,
      floor(extract(epoch from r.tmfc))::bigint,
      case when r.tmfc is not null and r.done_at is null then (select count(*) from public.forecast_hours x where x.tmfc = r.tmfc) end),
    'd', concat_ws('.', h,
      floor(extract(epoch from greatest(
        (select max(w.updated_at) from private.forecast_daily_weather_cache w),
        (select max(m.updated_at) from private.forecast_midterm_cache m),
        (select max(a.updated_at) from private.forecast_daily_aux_hours a),
        (select max(x.done_at) from public.forecast_runs x))))::bigint));   -- 84
end $$;
commit;
