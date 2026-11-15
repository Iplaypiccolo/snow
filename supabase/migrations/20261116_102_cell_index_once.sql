-- 102. 격자 순번 찾기를 한 번만(서버 부담 줄이기). 2026-11-16 Claude Code.
--  사용자(2026-11-16): "11 검토항목은 서버나 화면에 부담을 덜 주는 선으로 정리해봐" — 11/9 검토 항목 '서버의 격자 위치 반복 계산'.
--  * 지금: 일별 계산·일별 기온·습도 조회가 격자 한 칸마다 최근 48시간 단기 발표 16개의 격자 목록(1,538칸)을 처음부터 훑어 순번을 찾음 → 한 번 약 26ms, 한 칸 계산에 여러 번.
--  * 확인(11/16): 48시간 발표 16개·관측 26시각·초단기 발표의 격자 목록이 모두 똑같음.
--  * 바꿈: private.fc_run_ix(nx,ny) — 가장 최근 발표에서 한 번 찾고, 다른 발표는 그 자리에 같은 격자가 있는지만 확인(다르면 그 발표만 다시 찾음). 결과는 예전과 같음, 약 3ms.
--    쓰는 곳: forecast_daily_cell_calc(하늘 상태·오늘 최고 TMX·관측·초단기 순번), forecast_daily_aux_cell(일별 기온), fc_reh_cell(습도).
--  * 계산 결과는 바뀌지 않음(되돌린 시험으로 같은지 확인). 저장해 둔 계산 결과는 그대로 둠.
begin;

do $g$ begin
  if md5(pg_get_functiondef('private.forecast_daily_cell_calc(integer, integer)'::regprocedure)) <> '4ff3ac542b923c0d03347af8946da594'
     or md5(pg_get_functiondef('public.forecast_daily_aux_cell(integer, integer)'::regprocedure)) <> 'e449add4a280060ed567ae6421e79501'
     or md5(pg_get_functiondef('private.fc_reh_cell(integer,integer,timestamptz,timestamptz)'::regprocedure)) <> '6b9017d1305341dbf8b401ad1f6a276e'
  then raise exception '102: 바꿀 함수가 예상과 다름(다른 곳에서 바뀜) — 중단'; end if;
end $g$;

create or replace function private.fc_run_ix(p_nx integer, p_ny integer)
returns table(tmfc timestamptz, i integer)
language sql stable set search_path = '' as $f$
  -- 최근 48시간 단기 발표마다 이 격자의 순번(1부터). 발표들의 격자 목록이 같으면 한 번만 훑음(102)
  with r as (select rr.tmfc, rr.cells from public.forecast_runs rr where rr.tmfc >= now() - interval '48 hours'),
  ref as (select (select min(j.ordinality)::int from jsonb_array_elements(r.cells) with ordinality j where j.value = jsonb_build_array(p_nx, p_ny)) i
            from r order by r.tmfc desc limit 1),
  x as (select r.tmfc,
               case when ref.i is not null and r.cells -> (ref.i - 1) = jsonb_build_array(p_nx, p_ny) then ref.i
                    else (select min(j.ordinality)::int from jsonb_array_elements(r.cells) with ordinality j where j.value = jsonb_build_array(p_nx, p_ny)) end i
          from r cross join ref)
  select x.tmfc, x.i from x where x.i is not null
$f$;
revoke all on function private.fc_run_ix(integer, integer) from public;

create or replace function pg_temp.patch_fn(p_sig text, p_pairs text[]) returns void language plpgsql as $f$
declare d text := pg_get_functiondef(p_sig::regprocedure); i int;
begin
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(d) - length(replace(d, p_pairs[2*i-1], ''))) <> length(p_pairs[2*i-1]) then raise exception '102: % 바꿀 곳 %번이 한 군데가 아님', p_sig, i; end if;
    d := replace(d, p_pairs[2*i-1], p_pairs[2*i]);
  end loop;
  execute d;
end $f$;

select pg_temp.patch_fn('private.forecast_daily_cell_calc(integer, integer)', array[
  $x$  if vt is not null then
    select min(j.ordinality)::int into vi from jsonb_array_elements(vc) with ordinality j where j.value=jsonb_build_array(p_nx,p_ny);
  end if;$x$,
  $x$  if vt is not null then
    if ci is not null and vc->(ci-1)=jsonb_build_array(p_nx,p_ny) then vi:=ci;      -- 102: 초단기 격자 목록이 단기와 같으면 그 순번
    else select min(j.ordinality)::int into vi from jsonb_array_elements(vc) with ordinality j where j.value=jsonb_build_array(p_nx,p_ny); end if;
  end if;$x$,
  $x$      join (select rr.tmfc, min(j.ordinality)::int i from public.forecast_runs rr
              cross join lateral jsonb_array_elements(rr.cells) with ordinality j
             where rr.tmfc>=now()-interval '48 hours' and j.value=jsonb_build_array(p_nx,p_ny) group by rr.tmfc) x on x.tmfc=a.tmfc$x$,
  $x$      join private.fc_run_ix(p_nx,p_ny) x on x.tmfc=a.tmfc      -- 102$x$,
  $x$    join (select rr.tmfc, min(j.ordinality)::int i from public.forecast_runs rr
            cross join lateral jsonb_array_elements(rr.cells) with ordinality j
           where ((rr.tmfc at time zone 'Asia/Seoul')::date=today or rr.tmfc=fr.tmfc) and j.value=jsonb_build_array(p_nx,p_ny) group by rr.tmfc) x on x.tmfc=a.tmfc      -- 100: 밤에는 마지막 발표 TMX$x$,
  $x$    join (select z.tmfc, z.i from private.fc_run_ix(p_nx,p_ny) z where (z.tmfc at time zone 'Asia/Seoul')::date=today or z.tmfc=fr.tmfc) x on x.tmfc=a.tmfc      -- 100: 밤에는 마지막 발표 TMX, 102$x$,
  $x$    select h.vals[(select min(j.ordinality)::int from jsonb_array_elements(h.cells) with ordinality j where j.value=jsonb_build_array(p_nx,p_ny))]::numeric v$x$,
  $x$    select h.vals[case when h.cells->(ci-1)=jsonb_build_array(p_nx,p_ny) then ci else (select min(j.ordinality)::int from jsonb_array_elements(h.cells) with ordinality j where j.value=jsonb_build_array(p_nx,p_ny)) end]::numeric v      -- 102$x$]);

select pg_temp.patch_fn('public.forecast_daily_aux_cell(integer, integer)', array[
  $x$    select r.tmfc,min(j.ordinality)::int i from public.forecast_runs r
    cross join lateral jsonb_array_elements(r.cells)with ordinality j
    where r.tmfc>=now()-interval '48 hours' and j.value=jsonb_build_array(p_nx,p_ny)
    group by r.tmfc),$x$,
  $x$    select z.tmfc,z.i from private.fc_run_ix(p_nx,p_ny) z),      -- 102$x$]);

select pg_temp.patch_fn('private.fc_reh_cell(integer,integer,timestamptz,timestamptz)', array[
  $x$    join (select r.tmfc, min(j.ordinality)::int i from public.forecast_runs r
            cross join lateral jsonb_array_elements(r.cells) with ordinality j
           where r.tmfc >= now() - interval '48 hours' and j.value = jsonb_build_array(p_nx, p_ny) group by r.tmfc) x on x.tmfc = a.tmfc$x$,
  $x$    join private.fc_run_ix(p_nx, p_ny) x on x.tmfc = a.tmfc      -- 102$x$]);

commit;
