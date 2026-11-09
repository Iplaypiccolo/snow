-- 85. 1시간·3시간 표에 습도(단기 REH, %). 2026-11-09 Claude Code.
--  사용자 결정(2026-11-09 "단기습도만 받고, 1시간 3시간 표에만 넣자"). 초단기 습도는 받지 않음 → 1시간 표 앞 6시간 습도는 단기 값(기상청 화면은 초단기 값).
--  1) 일별 보강 저장 종류에 REH 추가(저장 칸 규칙 변경), 수집 대상 = SKY 와 같은 시각(단기 발표의 기온이 있는 모든 시각), 값 0~100 검사
--  2) private.fc_reh_cell: 한 격자의 시각별 최신 발표 습도
--  3) forecast_cell_detail: upper.series.h·hourly_tail.series.h(1시간 값), 3시간 칸 reh(평균, 소수 1자리)·reh_n(시각 수)
--  4) forecast_version c 에 습도 저장 시각 추가(습도가 도착하면 격자 창도 다시 받음)
begin;

do $g$ begin
  if md5(pg_get_functiondef('private.fc_daily_aux_targets(timestamptz,boolean)'::regprocedure)) <> '9b6b89cfb5828464712467e9754cab62'
  or md5(pg_get_functiondef('public.forecast_daily_aux_put(timestamptz,text,timestamptz,real[],boolean)'::regprocedure)) <> '86c1bcb9e65e40ccc190fe81a1349c06'
  or md5(pg_get_functiondef('public.forecast_cell_detail(integer,integer)'::regprocedure)) <> '43c331de4ea20fccd8ee01d2fd4ff86a'
  or md5(pg_get_functiondef('public.forecast_version()'::regprocedure)) <> '9878276a71822e0a524ea42768cbfe4e'
  then raise exception '85: 함수가 예상과 다름(다른 곳에서 바뀜) — 중단'; end if;
end $g$;

-- 1) 저장 종류
alter table private.forecast_daily_aux_hours drop constraint forecast_daily_aux_hours_var_check;
alter table private.forecast_daily_aux_hours add constraint forecast_daily_aux_hours_var_check check (var = any (array['SKY','TMN','TMX','REH']));

create or replace function private.fc_patch85(p_fn regprocedure, p_old text, p_new text) returns void language plpgsql as $p$
declare d text := pg_get_functiondef(p_fn);
begin
  if (length(d) - length(replace(d, p_old, ''))) <> length(p_old) then raise exception '85: % 바꿀 곳이 한 군데가 아님: %', p_fn, left(p_old, 60); end if;
  execute replace(d, p_old, p_new);
end $p$;

select private.fc_patch85('private.fc_daily_aux_targets(timestamptz,boolean)'::regprocedure,
  E'select ''SKY'',h.tmef from public.forecast_hours h join run r on r.tmfc=h.tmfc\n   where p_sky',
  E'select v.k,h.tmef from public.forecast_hours h join run r on r.tmfc=h.tmfc cross join(values(''SKY''),(''REH''))v(k)   -- 85: 습도\n   where p_sky');
select private.fc_patch85('public.forecast_daily_aux_put(timestamptz,text,timestamptz,real[],boolean)'::regprocedure,
  '(p_var=''SKY''and x not in(1,3,4))',
  '(p_var=''SKY''and x not in(1,3,4))or(p_var=''REH''and(x<0 or x>100))');

-- 2) 한 격자의 시각별 최신 발표 습도
create function private.fc_reh_cell(p_nx integer, p_ny integer, p_from timestamptz, p_to timestamptz)
returns table(tmef timestamptz, v real) language sql stable set search_path = '' as $f$
  select distinct on (a.tmef) a.tmef, a.vals[x.i]
    from private.forecast_daily_aux_hours a
    join (select r.tmfc, min(j.ordinality)::int i from public.forecast_runs r
            cross join lateral jsonb_array_elements(r.cells) with ordinality j
           where r.tmfc >= now() - interval '48 hours' and j.value = jsonb_build_array(p_nx, p_ny) group by r.tmfc) x on x.tmfc = a.tmfc
   where a.var = 'REH' and not a.is_empty and a.vals[x.i] is not null and a.tmef between p_from and p_to
   order by a.tmef, a.tmfc desc
$f$;
revoke all on function private.fc_reh_cell(integer, integer, timestamptz, timestamptz) from public, anon, authenticated;

-- 3) 격자 창
select private.fc_patch85('public.forecast_cell_detail(integer,integer)'::regprocedure,
  E'  v_collecting boolean; v_tail jsonb; v_hourly jsonb;\nbegin',
  E'  v_collecting boolean; v_tail jsonb; v_hourly jsonb;\n  v_rh jsonb; v_h jsonb; v_h2 jsonb;   -- 85: 습도\nbegin');
select private.fc_patch85('public.forecast_cell_detail(integer,integer)'::regprocedure,
  E'  return jsonb_build_object(''nx'',p_nx,''ny'',p_ny,''status'',''ok'',''collecting'',v_collecting,\n    ''upper'',jsonb_build_object(''tmfc'',c.issued_at,''start_at'',v_start,''end_at'',v_from,''series'',c.series),',
  E'  -- 85: 습도(단기 REH, 시각별 최신 발표). 1시간 표 h, 3시간 칸 reh(평균)·reh_n\n'
  || E'  select jsonb_object_agg(floor(extract(epoch from r.tmef))::bigint::text, r.v) into v_rh\n'
  || E'    from private.fc_reh_cell(p_nx,p_ny,v_start,greatest(coalesce(v_to,v_from),v_from+interval ''23 hours'')) r;\n'
  || E'  if v_rh is not null then\n'
  || E'    select jsonb_agg(v_rh->(floor(extract(epoch from x.t))::bigint::text) order by x.t) into v_h from generate_series(v_start,v_start+interval ''23 hours'',interval ''1 hour'') x(t);\n'
  || E'    select jsonb_agg(v_rh->(floor(extract(epoch from x.t))::bigint::text) order by x.t) into v_h2 from generate_series(v_from,v_from+interval ''23 hours'',interval ''1 hour'') x(t);\n'
  || E'    if v_hourly is not null and exists(select 1 from jsonb_array_elements(v_h2) e where e<>''null''::jsonb) then v_hourly:=jsonb_set(v_hourly,''{series,h}'',v_h2); end if;\n'
  || E'    if jsonb_typeof(v_tail->''bins'')=''array'' and jsonb_array_length(v_tail->''bins'')>0 then\n'
  || E'      v_tail:=jsonb_set(v_tail,''{bins}'',(select jsonb_agg(case when s.n>0 then b||jsonb_build_object(''reh'',s.m,''reh_n'',s.n) else b end order by o)\n'
  || E'        from jsonb_array_elements(v_tail->''bins'') with ordinality e(b,o)\n'
  || E'        cross join lateral (select count(*) n, round(avg((v_rh->>(floor(extract(epoch from t::timestamptz))::bigint::text))::numeric),1) m\n'
  || E'          from jsonb_array_elements_text(b->''times'') t where v_rh ? (floor(extract(epoch from t::timestamptz))::bigint::text)) s));\n'
  || E'    end if;\n'
  || E'  end if;\n'
  || E'  return jsonb_build_object(''nx'',p_nx,''ny'',p_ny,''status'',''ok'',''collecting'',v_collecting,\n'
  || E'    ''upper'',jsonb_build_object(''tmfc'',c.issued_at,''start_at'',v_start,''end_at'',v_from,''series'',\n'
  || E'      case when v_h is not null and exists(select 1 from jsonb_array_elements(v_h) e where e<>''null''::jsonb) then c.series||jsonb_build_object(''h'',v_h) else c.series end),');

-- 4) 습도가 도착하면 격자 창도 다시 받게
select private.fc_patch85('public.forecast_version()'::regprocedure,
  'floor(extract(epoch from r.tmfc))::bigint,',
  'floor(extract(epoch from r.tmfc))::bigint, floor(extract(epoch from (select max(a.updated_at) from private.forecast_daily_aux_hours a where a.var=''REH'')))::bigint,   -- 85');

drop function private.fc_patch85(regprocedure, text, text);
commit;
