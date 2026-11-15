-- ============================================================
-- 강원 신속대응팀(마이그레이션 48) 시험 — SQL Editor 에 통째로 붙여넣고 실행
-- 마지막에 일부러 오류를 내서 시험 자료를 전부 되돌립니다. "전체 N, 실패 0" 이어야 합니다.
-- ============================================================
create temp table _t (n serial, name text, got text, want text, ok boolean);
create or replace function pg_temp.run_as(rl text, uid uuid, stmt text) returns text language plpgsql as $f$
declare n bigint;
begin
  perform set_config('request.jwt.claims', case when uid is null then '' else json_build_object('sub', uid, 'role', rl)::text end, true);
  if rl <> 'postgres' then execute format('set local role %I', rl); end if;
  begin execute stmt; get diagnostics n = row_count; execute 'reset role'; return 'ok:' || n;
  exception when others then execute 'reset role'; return 'err:' || sqlstate; end;
end $f$;
create or replace function pg_temp.chk(name text, rl text, uid uuid, stmt text, want text) returns void language plpgsql as $f$
declare got text := pg_temp.run_as(rl, uid, stmt); begin insert into _t(name, got, want, ok) values (name, got, want, got = want); end $f$;
create or replace function pg_temp.yes(name text, cond boolean, info text default '') returns void language plpgsql as $f$
begin insert into _t(name, got, want, ok) values (name, case when cond then 'true' else 'false ' || info end, 'true', coalesce(cond, false)); end $f$;
do $t$
declare a uuid := gen_random_uuid(); gw uuid := gen_random_uuid(); h2 uuid := gen_random_uuid(); b1 uuid := gen_random_uuid(); e uuid := gen_random_uuid();
  hgw text; hx text; rid bigint; rid2 bigint; d0 date := '2099-12-01'; fails int; total int;
  sv text := 'select public.save_gw_team(%s, ''%s'', ''%s'')';
begin
  select id into hgw from public.hqs where name = '강원';
  select id into hx from public.hqs where name <> '강원' order by id limit 1;
  insert into auth.users (id, aud, role, email) values (a,'authenticated','authenticated','ga@t.test'),(gw,'authenticated','authenticated','gg@t.test'),
    (h2,'authenticated','authenticated','gh@t.test'),(b1,'authenticated','authenticated','gb@t.test'),(e,'authenticated','authenticated','ge@t.test');
  insert into public.profiles (id,username,display_name,role,branch_id,org,hq_id,perms,must_change) values
    (a,'gt-adm','관리자','admin',null,null,null,'{}',false),(gw,'gt-gw','강원본부','hq',null,null,hgw,'{req.edit.hq}',false),
    (h2,'gt-hq','다른본부','hq',null,null,hx,'{req.edit.hq}',false),(b1,'gt-br','지사','branch','B001',null,null,'{req.edit.own}',false),
    (e,'gt-eq','기계화부','equip',null,'서울경기',null,'{equip.edit.own,equip.edit.all}',false);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select (public.create_round(d0, 4) ->> 'id')::bigint into rid;

  -- ① 기준일자를 만들면 4대 모두 지원 여부 줄(미정)이 생김
  perform pg_temp.yes('새 기준일자: 팀 4대 미정', (select count(*) = 4 and bool_and(status = '') from public.gw_team_status where round_id = rid));
  perform pg_temp.chk('지사: 팀 장비 읽기','authenticated',b1,'select 1 from public.gw_team','ok:4');

  -- ② 권한: 관리자·강원본부만
  perform pg_temp.chk('강원본부: 원주 지원 + 첫날 B003행','authenticated',gw,format(sv, rid, format('[{"date":"%s","team_id":"GW1","stops":["B003"],"times":["07:30"]}]', d0), '[{"team_id":"GW1","status":"O"}]'),'ok:1');
  perform pg_temp.yes('경로 저장됨(요청·배정과 상관없이)', exists (select 1 from public.gw_team_routes where date = d0 and team_id = 'GW1' and stops = '{B003}' and times = '{07:30}'));
  perform pg_temp.chk('관리자: 홍천 지원 + 둘째 날 두 곳','authenticated',a,format(sv, rid, format('[{"date":"%s","team_id":"GW2","stops":["B002","B004"]}]', d0 + 1), '[{"team_id":"GW2","status":"O"}]'),'ok:1');
  perform pg_temp.chk('다른 본부는 거절','authenticated',h2,format(sv, rid, '[]', '[{"team_id":"GW3","status":"O"}]'),'err:42501');
  perform pg_temp.chk('지사는 거절','authenticated',b1,format(sv, rid, '[]', '[{"team_id":"GW3","status":"O"}]'),'err:42501');
  perform pg_temp.chk('모든 장비 권한(기계화부)도 거절','authenticated',e,format(sv, rid, '[]', '[{"team_id":"GW3","status":"O"}]'),'err:42501');
  perform pg_temp.chk('지사: 표에 직접 쓰기 거절','authenticated',b1,format('insert into public.gw_team_status (round_id, team_id, status) values (%s, ''GW3'', ''O'') on conflict (round_id, team_id) do update set status = ''O''', rid),'err:42501');
  perform pg_temp.chk('지사: 경로 직접 지우기는 0줄','authenticated',b1,'delete from public.gw_team_routes','ok:0');

  -- ③ 규칙: 지원이 아니면 경로 안 됨, 기준일자 밖, 없는 지사, 같은 지사 두 번, 시각 형식(2026-11-16: 지원 불가·정비중 없앰 → 그 시험 뺌)
  perform pg_temp.chk('미정인 장비(대관령)의 경로 거절','authenticated',gw,format(sv, rid, format('[{"date":"%s","team_id":"GW3","stops":["B003"]}]', d0), '[]'),'err:23514');
  perform pg_temp.chk('기준일자 기간 밖 날짜 거절','authenticated',gw,format(sv, rid, format('[{"date":"%s","team_id":"GW1","stops":["B003"]}]', d0 + 10), '[]'),'err:23514');
  perform pg_temp.chk('없는 지사 거절','authenticated',gw,format(sv, rid, format('[{"date":"%s","team_id":"GW1","stops":["B999"]}]', d0 + 1), '[]'),'err:23503');
  perform pg_temp.chk('같은 지사 두 번 거절','authenticated',gw,format(sv, rid, format('[{"date":"%s","team_id":"GW1","stops":["B003","B003"]}]', d0 + 1), '[]'),'err:23514');
  perform pg_temp.chk('시각 형식 거절','authenticated',gw,format(sv, rid, format('[{"date":"%s","team_id":"GW1","stops":["B003"],"times":["7시"]}]', d0 + 1), '[]'),'err:23514');
  perform pg_temp.chk('경로 지우기(빈 목록)','authenticated',gw,format(sv, rid, format('[{"date":"%s","team_id":"GW2","stops":[]}]', d0 + 1), '[]'),'ok:1');
  perform pg_temp.yes('지워짐', not exists (select 1 from public.gw_team_routes where date = d0 + 1 and team_id = 'GW2'));

  -- ④ 기존 장비 지원과 섞이지 않음
  perform pg_temp.yes('기존 장비 경로·배정 표는 그대로', not exists (select 1 from public.vehicle_routes where date >= d0) and not exists (select 1 from public.round_allocations where round_id = rid));
  perform pg_temp.yes('수정 기록에 남음', exists (select 1 from public.audit_log where tab = 'gw_team_routes' and target = 'gw_team_routes:' || d0 || ',GW1' and kind = '추가'));

  -- ⑤ 새 기준일자는 지원 여부를 이어받지 않음 — 4대 모두 빈칸(63)
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select (public.create_round(d0 + 3, 4) ->> 'id')::bigint into rid2;
  perform pg_temp.yes('63: 이어받지 않음 — 4대 모두 빈칸',
    (select string_agg(team_id || '=' || status, ',' order by team_id) from public.gw_team_status where round_id = rid2) = 'GW1=,GW2=,GW3=,GW4=');
  perform pg_temp.chk('새 기준일자에 홍천 경로','authenticated',gw,format(sv, rid2, format('[{"date":"%s","team_id":"GW2","stops":["B005"]}]', d0 + 4), '[{"team_id":"GW2","status":"O"}]'),'ok:1');      -- 63: 새 기준일자는 빈칸이라 지원으로 고른 뒤

  -- ⑥ 기준일자를 지우면 그 기간의 팀 경로·지원 여부도 함께
  perform pg_temp.chk('새 기준일자 지우기','authenticated',a,format('delete from public.support_rounds where id = %s', rid2),'ok:1');
  perform pg_temp.yes('그 기간 팀 경로·지원 여부 지워짐', not exists (select 1 from public.gw_team_routes where date >= d0 + 3) and not exists (select 1 from public.gw_team_status where round_id = rid2));
  perform pg_temp.yes('앞 기준일자 경로는 그대로', exists (select 1 from public.gw_team_routes where date = d0 and team_id = 'GW1'));

  select count(*), count(*) filter (where not ok) into total, fails from _t;
  raise exception E'강원 신속대응팀 시험 — 전체 %, 실패 %\n%', total, fails, (select string_agg('FAIL ' || name || ' → ' || got || ' / ' || want, E'\n' order by n) from _t where not ok);
end $t$;
