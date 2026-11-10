-- 92. 특보구역 더하기·빼기 요청(관리자 아닌 아이디 → 관리자 승인). 2026-11-10 Claude Code.
--  사용자(2026-11-10): "특보구역 관리는 모든 아이디에서 볼 수 있어야 해. 관리자 아이디만 더하기 버튼이 있고, 나머지 기관은 요청하기 버튼으로 요청…
--   관리자 아이디로 로그인했을 때 해당 요청이 보이고, 승인하기를 통해 편입이 가능해야 해" / "둘 다 요청(더하기·빼기)" / "사유는 적게, 요청 취소도" /
--   "로그인 시에 알림창이 모달로" / "(요청한 사람이 결과를 보는 목록은) 필요없어".
--  * zone_requests: 요청 한 줄 = 지사·구역·더하기/빼기·사유. 표는 직접 읽고 쓰지 못하고(권한 규칙만 켬) 아래 함수로만.
--  * zone_request_create: 관리자 아닌 아이디(지사·본부·기계화부)가 아무 지사에나 요청(사유 1~200자). 같은 지사·구역에 대기 중인 요청이 있으면 거절,
--    지금 상태와 맞지 않는 요청(이미 들어간 구역 더하기, 없는 구역 빼기)도 거절. 한 아이디 대기 요청 30건까지.
--  * zone_request_cancel: 자기 요청만, 대기 중일 때만.
--  * zone_request_list: 관리자 = 대기 중인 요청 전체, 그 밖 = 자기 대기 요청(화면에서 '요청 중'·[요청 취소] 표시용).
--  * zone_request_resolve(관리자): 승인하면 그 자리에서 특보구역을 바꿈(관리자가 직접 더하기·빼기·되살리기 한 것과 같음, 수정 기록에 남음), 반려는 상태만.
--  * warning_active_list(지금 받은 특보 전국): 관리자만 → 로그인한 모든 아이디(특보구역 관리 창을 모두 보므로).
begin;

do $g$ begin
  if md5(pg_get_functiondef('public.warning_active_list()'::regprocedure)) <> 'dfc38343f6af49d861ae1805e34e1f33'
  then raise exception '92: 함수가 예상과 다름(다른 곳에서 바뀜) — 중단'; end if;
  if to_regclass('public.zone_requests') is not null then raise exception '92: 이미 있음 — 중단'; end if;
end $g$;

create table public.zone_requests (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  requested_by uuid not null,
  branch_id    text not null references public.branches(id) on delete cascade,
  zone_code    text not null references public.warning_zones(zone_code),
  action       text not null check (action in ('add', 'remove')),
  reason       text not null check (length(reason) between 1 and 200),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  resolved_by  uuid,
  resolved_at  timestamptz
);
create unique index zone_requests_one_pending on public.zone_requests(branch_id, zone_code) where status = 'pending';
create index zone_requests_status_idx on public.zone_requests(status, id);
alter table public.zone_requests enable row level security;      -- 정책 없음 = 함수로만
create trigger audit_zone_requests after insert or update on public.zone_requests for each row execute function private.audit_row('id');

-- 지금 그 지사에 들어간 구역인가(자동 − 뺀 것 + 더한 것) — branch_zone_list 와 같은 기준
create or replace function private.zone_in_branch(p_branch text, p_zone text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.branch_zones() z where z.branch_id = p_branch and z.zone_code = p_zone)
$$;
revoke all on function private.zone_in_branch(text, text) from public, anon, authenticated;

create or replace function public.zone_request_create(p_branch text, p_zone text, p_action text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r text := private.my_role(); v_reason text := btrim(coalesce(p_reason, '')); v_id bigint;
begin
  if r is null then raise exception 'login required' using errcode = '42501'; end if;
  if r = 'admin' then raise exception '관리자는 요청 없이 바로 바꿉니다' using errcode = '22023'; end if;
  if p_action not in ('add', 'remove') then raise exception 'bad action' using errcode = '22023'; end if;
  if v_reason = '' or length(v_reason) > 200 then raise exception '사유를 1~200자로 적어 주세요' using errcode = '22023'; end if;
  if not exists (select 1 from public.branches b where b.id = p_branch) then raise exception 'bad branch' using errcode = '22023'; end if;
  if not exists (select 1 from public.warning_zones z where z.zone_code = p_zone) then raise exception 'bad zone' using errcode = '22023'; end if;
  if (p_action = 'add') = private.zone_in_branch(p_branch, p_zone) then
    raise exception '%', case when p_action = 'add' then '이미 들어간 구역입니다' else '들어가 있지 않은 구역입니다' end using errcode = '22023';
  end if;
  if exists (select 1 from public.zone_requests q where q.branch_id = p_branch and q.zone_code = p_zone and q.status = 'pending') then
    raise exception '이 지사·구역에 처리를 기다리는 요청이 이미 있습니다' using errcode = '23505';
  end if;
  if (select count(*) from public.zone_requests q where q.requested_by = (select auth.uid()) and q.status = 'pending') >= 30 then
    raise exception '처리를 기다리는 요청이 30건을 넘었습니다' using errcode = '54000';
  end if;
  insert into public.zone_requests (requested_by, branch_id, zone_code, action, reason)
  values ((select auth.uid()), p_branch, p_zone, p_action, v_reason) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.zone_request_cancel(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if private.my_role() is null then raise exception 'login required' using errcode = '42501'; end if;
  update public.zone_requests q set status = 'cancelled', resolved_by = (select auth.uid()), resolved_at = now()
   where q.id = p_id and q.status = 'pending' and q.requested_by = (select auth.uid());
  if not found then raise exception '취소할 수 있는 요청이 아닙니다' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.zone_request_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when (select private.my_role()) is null then null else coalesce((
    select jsonb_agg(jsonb_build_object('id', q.id, 'branch_id', q.branch_id, 'zone_code', q.zone_code, 'zone_name', coalesce(z.name, q.zone_code),
             'action', q.action, 'reason', q.reason, 'created_at', q.created_at, 'mine', q.requested_by = (select auth.uid()),
             'by', coalesce(nullif(p.display_name, ''), p.username)) order by q.id)
      from public.zone_requests q
      left join public.warning_zones z on z.zone_code = q.zone_code
      left join public.profiles p on p.id = q.requested_by
     where q.status = 'pending' and ((select private.my_role()) = 'admin' or q.requested_by = (select auth.uid()))), '[]'::jsonb) end
$$;

create or replace function public.zone_request_resolve(p_id bigint, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.zone_requests; o public.branch_zone_overrides;
begin
  if private.my_role() is distinct from 'admin' then raise exception 'admin only' using errcode = '42501'; end if;
  select * into q from public.zone_requests where id = p_id and status = 'pending' for update;
  if not found then raise exception '처리를 기다리는 요청이 아닙니다' using errcode = '22023'; end if;
  if p_approve then
    select * into o from public.branch_zone_overrides where branch_id = q.branch_id and zone_code = q.zone_code;
    if q.action = 'add' and not private.zone_in_branch(q.branch_id, q.zone_code) then
      if found and not o.include then delete from public.branch_zone_overrides where branch_id = q.branch_id and zone_code = q.zone_code;      -- 자동에서 뺀 것을 되살림
      else insert into public.branch_zone_overrides (branch_id, zone_code, include) values (q.branch_id, q.zone_code, true)
             on conflict (branch_id, zone_code) do update set include = true; end if;
    elsif q.action = 'remove' and private.zone_in_branch(q.branch_id, q.zone_code) then
      if found and o.include then delete from public.branch_zone_overrides where branch_id = q.branch_id and zone_code = q.zone_code;        -- 손으로 더한 것을 지움
      else insert into public.branch_zone_overrides (branch_id, zone_code, include) values (q.branch_id, q.zone_code, false)
             on conflict (branch_id, zone_code) do update set include = false; end if;
    end if;      -- 그사이 관리자가 이미 같은 상태로 바꿨으면 그대로 승인만
  end if;
  update public.zone_requests set status = case when p_approve then 'approved' else 'rejected' end, resolved_by = (select auth.uid()), resolved_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.zone_request_create(text, text, text, text), public.zone_request_cancel(bigint), public.zone_request_list(), public.zone_request_resolve(bigint, boolean) from public, anon;
grant execute on function public.zone_request_create(text, text, text, text), public.zone_request_cancel(bigint), public.zone_request_list(), public.zone_request_resolve(bigint, boolean) to authenticated;

-- 지금 받은 특보(전국): 로그인한 모든 아이디
do $p$ declare d text := pg_get_functiondef('public.warning_active_list()'::regprocedure);
  a text := 'case when (select private.my_role()) <> ''admin'' then null else';
  b text := 'case when (select private.my_role()) is null then null else';
begin
  if (length(d) - length(replace(d, a, ''))) <> length(a) then raise exception '92: warning_active_list 바꿀 곳이 한 군데가 아님'; end if;
  execute replace(d, a, b);
end $p$;

commit;
