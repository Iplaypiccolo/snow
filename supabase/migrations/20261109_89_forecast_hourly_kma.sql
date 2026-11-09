-- 89. 1시간·3시간 표를 기상청 날씨누리 화면처럼. 2026-11-09 Claude Code.
--  사용자 결정(2026-11-09 "1. 같이 진행해 2. 강도만 둬. 기상청처럼 3. 날씨줄과 1시간표 강도줄은 빼. 1시간표는 76시간처럼"):
--  1) 초단기 수집에 습도(REH) 추가: forecast_vsrt_begin 받을 종류 5→6(10분마다 기상청 호출 30→36번), forecast_vsrt_put 허용·완료 기준 30→36, 저장 종류 규칙에 REH
--  2) forecast_cell_detail
--     · hourly_tail: 25시간째부터 받은 끝까지 1시간 값(예전 24시간만). 기상청이 양 대신 강도 등급만 주는 시각은 sc(눈 0~2)·pc(비 0~3),
--       quantity_end_at = 양으로 주는 마지막 시각(1시간 표의 끝 = 날씨누리 1시간 화면의 끝)
--     · 습도: 가까운 6시각은 초단기 습도(날씨누리와 같이). 초단기 발표는 24시간 계산(fc_apply)과 같은 기준으로 고른 최신 완성분
--     · tail.bins(예전 3시간 묶음)는 업데이트 전에 열어 둔 화면을 위해 그대로 둠. 새 화면은 hourly_tail 로 3시간 칸을 만듦(forecast/series.js)
--  수집 함수(collect-forecast)는 서버가 알려 주는 목록대로 받음. 24시간 계산(fc_apply)은 습도를 쓰지 않으므로 그대로.
begin;

do $g$ begin
  if md5(pg_get_functiondef('public.forecast_vsrt_begin(timestamptz)'::regprocedure)) <> '38819c297c9fee81766c7acbf2dd686d'
  or md5(pg_get_functiondef('public.forecast_vsrt_put(timestamptz,text,timestamptz,real[])'::regprocedure)) <> 'b756f02b48428dad10fc7da7547bc48c'
  or md5(pg_get_functiondef('public.forecast_cell_detail(integer,integer)'::regprocedure)) <> '7edbc25d4877d0a3438353b6c84a3adc'
  then raise exception '89: 함수가 예상과 다름(다른 곳에서 바뀜) — 중단'; end if;
end $g$;

create or replace function private.fc_patch89(p_fn regprocedure, p_old text, p_new text) returns void language plpgsql as $p$
declare d text := pg_get_functiondef(p_fn);
begin
  if (length(d) - length(replace(d, p_old, ''))) <> length(p_old) then raise exception '89: % 바꿀 곳이 한 군데가 아님: %', p_fn, left(p_old, 60); end if;
  execute replace(d, p_old, p_new);
end $p$;

-- 1) 초단기 습도
alter table public.forecast_vsrt_hours drop constraint forecast_vsrt_hours_var_check;
alter table public.forecast_vsrt_hours add constraint forecast_vsrt_hours_var_check check (var = any (array['T1H','RN1','POP','PTY','SKY','REH']));
select private.fc_patch89('public.forecast_vsrt_begin(timestamptz)'::regprocedure,
  'unnest(array[''T1H'', ''RN1'', ''POP'', ''PTY'', ''SKY'']) v', 'unnest(array[''T1H'', ''RN1'', ''POP'', ''PTY'', ''SKY'', ''REH'']) v');
select private.fc_patch89('public.forecast_vsrt_put(timestamptz,text,timestamptz,real[])'::regprocedure,
  'if p_var not in (''T1H'', ''RN1'', ''POP'', ''PTY'', ''SKY'') then', 'if p_var not in (''T1H'', ''RN1'', ''POP'', ''PTY'', ''SKY'', ''REH'') then');
select private.fc_patch89('public.forecast_vsrt_put(timestamptz,text,timestamptz,real[])'::regprocedure,
  'if n < 30 then return', 'if n < 36 then return');      -- 89: 6종 × 6시각

drop function private.fc_patch89(regprocedure, text, text);

-- 2) 격자 하나의 자세한 예보
create or replace function public.forecast_cell_detail(p_nx integer, p_ny integer)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
-- 82: forecast_cell_tail(3시간 묶음)과 25시간째 이후 1시간 값을 한 번의 fc_hours 로 계산
-- 89: 1시간 값은 받은 끝까지(정성 구간 sc·pc, quantity_end_at), 가까운 6시각 습도는 초단기
declare
  c public.forecast_cells;
  v_start timestamptz; v_from timestamptz; v_to timestamptz; v_cap timestamptz; v_end timestamptz;
  v_collecting boolean; v_tail jsonb; v_hourly jsonb;
  v_rh jsonb; v_h jsonb; v_h2 jsonb;   -- 85: 습도
  vt timestamptz; vc jsonb; vi int;    -- 89: 초단기 발표·격자 순번
begin
  if (select private.my_role()) is null then raise exception 'login required' using errcode='42501'; end if;
  if p_nx is null or p_ny is null or p_nx not between 1 and 149 or p_ny not between 1 and 253 then
    raise exception 'bad cell' using errcode='22023';
  end if;
  if not exists(select 1 from private.grid_effective() g where g.nx=p_nx and g.ny=p_ny) then
    raise exception 'bad cell' using errcode='22023';
  end if;
  select r.tmfc,r.done_at is null into v_cap,v_collecting from public.forecast_runs r order by r.tmfc desc limit 1;
  v_collecting:=coalesce(v_collecting,false);
  select * into c from public.forecast_cells where nx=p_nx and ny=p_ny;
  if not found then return jsonb_build_object('nx',p_nx,'ny',p_ny,'status','no_data','collecting',v_collecting,'upper',null,'tail',jsonb_build_object('bins','[]'::jsonb),'hourly_tail',null); end if;
  if c.issued_at is null or c.issued_at<now()-interval '12 hours' then
    return jsonb_build_object('nx',p_nx,'ny',p_ny,'status','stale','collecting',v_collecting,'upper',null,'tail',jsonb_build_object('bins','[]'::jsonb),'hourly_tail',null);
  end if;
  select (b.detail->>'start_at')::timestamptz into v_start
    from public.branch_forecast b where b.issued_at=c.issued_at order by b.updated_at desc limit 1;
  if v_start is null or v_start<>date_trunc('hour',v_start)
    or jsonb_array_length(c.series->'s') is distinct from 24
    or jsonb_array_length(c.series->'p') is distinct from 24
    or jsonb_array_length(c.series->'t') is distinct from 24 then
    return jsonb_build_object('nx',p_nx,'ny',p_ny,'status','no_data','collecting',v_collecting,'upper',null,'tail',jsonb_build_object('bins','[]'::jsonb),'hourly_tail',null);
  end if;
  v_from:=v_start+interval '24 hours';
  v_cap:=coalesce(v_cap,c.issued_at);
  select least(max(coalesce(r.end_at,private.fc_end(r.tmfc))),v_start+interval '119 hours') into v_to
    from public.forecast_runs r where r.tmfc<=v_cap;
  v_end:=greatest(coalesce(v_to,v_from),v_from+interval '23 hours');      -- 89: 1시간 값의 끝(예전 v_from+23시간)

  with picked as materialized(
    select * from private.fc_hours(v_cap,v_from,v_end,true,p_nx,p_ny)),
  ix as materialized(
    select r.tmfc,min(j.ordinality)::int i from public.forecast_runs r
    join(select distinct tmfc from picked) k on k.tmfc=r.tmfc
    cross join lateral jsonb_array_elements(r.cells) with ordinality j
    where j.value=jsonb_build_array(p_nx,p_ny) group by r.tmfc),
  raw as materialized(
    select q.tmfc,q.tmef,q.quantity,q.s[ix.i] s0,q.p[ix.i] p0,q.t[ix.i] t0,q.o[ix.i] o0,q.y[ix.i] y0
      from picked q join ix on ix.tmfc=q.tmfc),
  -- 3시간 묶음(forecast_cell_tail 과 같은 계산, v_to 까지) — 업데이트 전 화면용
  points as materialized(
    select q.tmfc,q.tmef,q.quantity,
      case when not q.quantity and q.s0 in (0,1,2) then q.s0::int end sc,
      case when not q.quantity and q.p0 in (0,1,2,3) then q.p0::int end pc,
      case when q.s0 is not null then greatest(q.s0,0) end::double precision s,
      case when q.p0 is not null then greatest(q.p0,0) end::double precision p,
      case when q.t0>-90 then q.t0 end::double precision t,
      case when q.o0>=0 then least(q.o0,100) end::int o,
      case when q.y0>=0 then q.y0 end::int y
    from raw q where v_to is not null and v_to>=v_from and q.tmef<=v_to),
  framed as(
    select a.*,date_bin(interval '3 hours',a.tmef-interval '1 hour',timestamptz '2000-01-01 00:00+09')+interval '3 hours' slot_end,
      max(a.tmef) over() available_end
    from points a),
  grouped as(
    select slot_end,greatest(slot_end-interval '2 hours',v_from) first_at,least(slot_end,max(available_end)) last_at,
      count(*)::int hours,bool_and(quantity) all_numeric,count(*) filter(where quantity)::int quantity_hours,
      sum(s) s,sum(p) p,min(t) t,max(o) o,
      max(sc) sc,max(pc) pc,count(sc)::int scn,count(pc)::int pcn,
      count(*) filter(where s=0 and y in(2,3,6,7))::int sq,
      count(*) filter(where p=0 and y>0)::int pq,
      jsonb_agg(tmef order by tmef) times
    from framed group by slot_end),
  bins as(
    select first_at,last_at,jsonb_build_object(
      'first_at',first_at,'last_at',last_at,'slot_end_at',slot_end,
      'expected_hours',(extract(epoch from(last_at-first_at))/3600)::int+1,
      'hours',hours,'times',times,
      'partial',hours<3 or last_at-first_at<interval '2 hours',
      'quantity_hours',quantity_hours,'code_hours',hours-quantity_hours,
      'amount_kind',case when all_numeric then 'numeric' when quantity_hours=0 then 'code' else 'mixed' end,
      'snow_code',case when hours>quantity_hours and scn=hours-quantity_hours then sc end,
      'pcp_code',case when hours>quantity_hours and pcn=hours-quantity_hours then pc end,
      'snow',case when all_numeric then round(s::numeric,1) end,
      'snow_hi',case when all_numeric then round((s+sq)::numeric,1) end,
      'pcp',case when all_numeric then round(p::numeric,1) end,
      'pcp_hi',case when all_numeric then round((p+pq)::numeric,1) end,
      'tmin',t,'pop',o) val from grouped),
  tailj as(
    select jsonb_build_object('window_start_at',v_from,
      'first_at',(select min(tmef) from points),'last_at',(select max(tmef) from points),
      'bins',coalesce(jsonb_agg(val order by first_at),'[]'::jsonb)) j from bins),
  -- 25시간째부터 받은 끝까지 1시간 값(89: 정성 구간은 양 대신 강도 등급 sc·pc)
  hp as(
    select q.tmef,q.quantity,
      case when q.quantity and q.s0 is not null then greatest(q.s0,0) end s,
      case when q.quantity and q.p0 is not null then greatest(q.p0,0) end p,
      case when q.t0>-90 then q.t0 end t,
      case when q.o0>=0 then least(q.o0,100) end o,
      case when q.quantity and q.s0 is not null then q.s0=0 and q.y0 in(2,3,6,7) end sq,
      case when q.quantity and q.p0 is not null then q.p0=0 and q.y0>0 end pq,
      case when not q.quantity and q.s0 in (0,1,2) then q.s0::int end sc,
      case when not q.quantity and q.p0 in (0,1,2,3) then q.p0::int end pc
    from raw q where q.tmef<=v_end),
  hourj as(
    select jsonb_build_object('start_at',v_from,'end_at',v_end+interval '1 hour',
      'quantity_end_at',(select max(z.tmef) from hp z where z.quantity),
      'series',jsonb_build_object('s',jsonb_agg(p.s order by x.t),'p',jsonb_agg(p.p order by x.t),
        't',jsonb_agg(p.t order by x.t),'r',jsonb_agg(p.o order by x.t),
        'sq',jsonb_agg(p.sq order by x.t),'pq',jsonb_agg(p.pq order by x.t),
        'sc',jsonb_agg(p.sc order by x.t),'pc',jsonb_agg(p.pc order by x.t),'vn',0)) j
    from generate_series(v_from,v_end,interval '1 hour') x(t) left join hp p on p.tmef=x.t)
  select (select j from tailj),(select j from hourj) into v_tail,v_hourly;

  if v_to is null or v_to<v_from then
    v_tail:=jsonb_build_object('window_start_at',v_from,'first_at',null,'last_at',null,'bins','[]'::jsonb);
  end if;
  -- 85: 습도(단기 REH, 시각별 최신 발표). 1시간 값 h, 3시간 묶음 reh(최고)
  select jsonb_object_agg(floor(extract(epoch from r.tmef))::bigint::text, r.v) into v_rh
    from private.fc_reh_cell(p_nx,p_ny,v_start,v_end) r;
  -- 89: 가까운 6시각은 초단기 습도(날씨누리와 같이). 24시간 계산(fc_apply)과 같은 기준의 최신 완성 발표
  select v.tmfc, v.cells into vt, vc from public.forecast_vsrt_runs v
   where v.done_at is not null and v.tmfc > now() - interval '3 hours'
     and not exists (select 1 from public.forecast_vsrt_hours z where z.tmfc = v.tmfc and z.var = 'T1H'
                       and not exists (select 1 from unnest(z.vals) q where q > -90 and q <> 0))
   order by v.tmfc desc limit 1;
  if vt is not null then
    select min(j.ordinality)::int into vi from jsonb_array_elements(vc) with ordinality j where j.value=jsonb_build_array(p_nx,p_ny);
  end if;
  if vi is not null then
    select nullif(coalesce(v_rh,'{}'::jsonb)||coalesce(jsonb_object_agg(floor(extract(epoch from h.tmef))::bigint::text, to_jsonb(h.vals[vi])),'{}'::jsonb),'{}'::jsonb) into v_rh
      from public.forecast_vsrt_hours h
     where h.tmfc=vt and h.var='REH' and h.vals[vi] between 0 and 100 and h.tmef between v_start and v_end;
  end if;
  if v_rh is not null then
    select jsonb_agg(v_rh->(floor(extract(epoch from x.t))::bigint::text) order by x.t) into v_h from generate_series(v_start,v_start+interval '23 hours',interval '1 hour') x(t);
    select jsonb_agg(v_rh->(floor(extract(epoch from x.t))::bigint::text) order by x.t) into v_h2 from generate_series(v_from,v_end,interval '1 hour') x(t);
    if v_hourly is not null and exists(select 1 from jsonb_array_elements(v_h2) e where e<>'null'::jsonb) then v_hourly:=jsonb_set(v_hourly,'{series,h}',v_h2); end if;
    if jsonb_typeof(v_tail->'bins')='array' and jsonb_array_length(v_tail->'bins')>0 then
      v_tail:=jsonb_set(v_tail,'{bins}',(select jsonb_agg(case when s.n>0 then b||jsonb_build_object('reh',s.m) else b end order by o)
        from jsonb_array_elements(v_tail->'bins') with ordinality e(b,o)
        cross join lateral (select count(*) n, max((v_rh->>(floor(extract(epoch from t::timestamptz))::bigint::text))::numeric) m
          from jsonb_array_elements_text(b->'times') t where v_rh ? (floor(extract(epoch from t::timestamptz))::bigint::text)) s));
    end if;
  end if;
  return jsonb_build_object('nx',p_nx,'ny',p_ny,'status','ok','collecting',v_collecting,
    'upper',jsonb_build_object('tmfc',c.issued_at,'start_at',v_start,'end_at',v_from,'series',
      case when v_h is not null and exists(select 1 from jsonb_array_elements(v_h) e where e<>'null'::jsonb) then c.series||jsonb_build_object('h',v_h) else c.series end),
    'tail',v_tail,'hourly_tail',v_hourly);
end $function$;

commit;
