-- 82. 서버 부담 줄이기(계획 docs/forecast-fix-plan-20261109.md 2단계). 2026-11-09 Claude Code. 사용자 SQL 확인 후 적용.
--  1) 옛 발표분의 시간별 값(forecast_hours) 정리: 새 발표분을 끝까지 받으면(done) 그보다 옛 발표분의 시간별 값을 지운다.
--     받는 중에는 직전 완성 발표분이 남아 있음(그 시각들을 대신 채움). 발표 목록(forecast_runs)은 지우지 않음 —
--     일별 최저·최고기온(forecast_daily_aux_hours, 48시간 보관)이 목록을 참조하고, 지우면 함께 지워짐(cascade).
--     근거: 새 발표분은 받기 시작한 다음 정시부터 끝 시각까지 모두 가짐(끝 시각은 옛 발표와 같거나 늦음). 시험에서 지운 뒤에도 고르는 발표분이 61/61시간 같음.
--     지금 남은 옛 값(약 13,525줄, 5MB)도 한 번 정리.
--  2) 격자 창 조회(forecast_cell_detail): 같은 무거운 계산(fc_hours)을 두 번 하던 것을 한 번으로. 결과는 그대로(전 격자 비교 후 적용).
--     forecast_cell_tail 은 그대로 둠(화면은 쓰지 않지만 호환용).
begin;
set local lock_timeout = '10s';
set local statement_timeout = '45s';
do $m$
declare d text; o text; n text;
begin
  if not pg_try_advisory_xact_lock(hashtext('ss_fc_apply')) then raise exception 'forecast busy; no changes made'; end if;
  if md5(pg_get_functiondef('private.fc_progress(timestamptz)'::regprocedure)) <> 'b0aa5f3a341f065919209aefac9c5c1d' then raise exception 'fc_progress changed since review'; end if;
  if md5(pg_get_functiondef('public.forecast_cell_detail(integer,integer)'::regprocedure)) <> '05d7ab45dc4d9f9e5358d5fabc6d946d' then raise exception 'forecast_cell_detail changed since review'; end if;
  if md5(pg_get_functiondef('public.forecast_cell_tail(integer,integer)'::regprocedure)) <> '4b1a680806949b44a69bb26319afa940' then raise exception 'forecast_cell_tail changed since review'; end if;
  if md5(pg_get_functiondef('private.fc_hours(timestamptz,timestamptz,timestamptz,boolean,integer,integer)'::regprocedure)) <> '80e1b594ff8fd762dee9917cbe088c53' then raise exception 'fc_hours changed since review'; end if;

  d := pg_get_functiondef('private.fc_progress(timestamptz)'::regprocedure);
  o := $o$    delete from public.forecast_runs where tmfc<>p_tmfc and coalesce(end_at,private.fc_end(tmfc)) < now();$o$;
  n := $n$    delete from public.forecast_runs where tmfc<>p_tmfc and coalesce(end_at,private.fc_end(tmfc)) < now();
    delete from public.forecast_hours where tmfc<p_tmfc;   -- 82: 새 발표분을 다 받으면 옛 발표분의 시간별 값은 필요 없음(목록은 일별 기온이 참조해 남김)$n$;
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then raise exception 'fc_progress patch not unique'; end if;
  execute replace(d, o, n);
end $m$;

-- 옛 값 한 번 정리: 가장 최근 완성 발표분보다 옛 발표분의 시간별 값
delete from public.forecast_hours
 where tmfc < (select max(r.tmfc) from public.forecast_runs r where r.done_at is not null);

create or replace function public.forecast_cell_detail(p_nx integer, p_ny integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
-- 82: forecast_cell_tail(3시간 묶음)과 25~48시간 1시간 값을 한 번의 fc_hours 로 계산. 응답 모양·값은 80 과 같음
declare
  c public.forecast_cells;
  v_start timestamptz; v_from timestamptz; v_to timestamptz; v_cap timestamptz;
  v_collecting boolean; v_tail jsonb; v_hourly jsonb;
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

  with picked as materialized(
    select * from private.fc_hours(v_cap,v_from,greatest(coalesce(v_to,v_from),v_from+interval '23 hours'),true,p_nx,p_ny)),
  ix as materialized(
    select r.tmfc,min(j.ordinality)::int i from public.forecast_runs r
    join(select distinct tmfc from picked) k on k.tmfc=r.tmfc
    cross join lateral jsonb_array_elements(r.cells) with ordinality j
    where j.value=jsonb_build_array(p_nx,p_ny) group by r.tmfc),
  raw as materialized(
    select q.tmfc,q.tmef,q.quantity,q.s[ix.i] s0,q.p[ix.i] p0,q.t[ix.i] t0,q.o[ix.i] o0,q.y[ix.i] y0
      from picked q join ix on ix.tmfc=q.tmfc),
  -- 3시간 묶음(forecast_cell_tail 과 같은 계산, v_to 까지)
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
  -- 25~48시간 1시간 값(80 과 같은 계산)
  hp as(
    select q.tmef,
      case when q.quantity and q.s0 is not null then greatest(q.s0,0) end s,
      case when q.quantity and q.p0 is not null then greatest(q.p0,0) end p,
      case when q.t0>-90 then q.t0 end t,
      case when q.o0>=0 then least(q.o0,100) end o,
      case when q.quantity and q.s0 is not null then q.s0=0 and q.y0 in(2,3,6,7) end sq,
      case when q.quantity and q.p0 is not null then q.p0=0 and q.y0>0 end pq
    from raw q where q.tmef<=v_from+interval '23 hours'),
  hourj as(
    select jsonb_build_object('start_at',v_from,'end_at',v_from+interval '24 hours',
      'series',jsonb_build_object('s',jsonb_agg(p.s order by x.t),'p',jsonb_agg(p.p order by x.t),
        't',jsonb_agg(p.t order by x.t),'r',jsonb_agg(p.o order by x.t),
        'sq',jsonb_agg(p.sq order by x.t),'pq',jsonb_agg(p.pq order by x.t),'vn',0)) j
    from generate_series(v_from,v_from+interval '23 hours',interval '1 hour') x(t) left join hp p on p.tmef=x.t)
  select (select j from tailj),(select j from hourj) into v_tail,v_hourly;

  if v_to is null or v_to<v_from then
    v_tail:=jsonb_build_object('window_start_at',v_from,'first_at',null,'last_at',null,'bins','[]'::jsonb);
  end if;
  return jsonb_build_object('nx',p_nx,'ny',p_ny,'status','ok','collecting',v_collecting,
    'upper',jsonb_build_object('tmfc',c.issued_at,'start_at',v_start,'end_at',v_from,'series',c.series),
    'tail',v_tail,'hourly_tail',v_hourly);
end $$;
commit;
