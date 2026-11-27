-- ============================================================
-- 113. 단기 칸 조회(신적설 소수): "연 지사 격자"가 아니라 "눈이 예보된 관할 격자"를 늘 받음. 2026-11-27 Claude Code, 사용자 "눈 칸만"(권장안).
--  * 왜: 107 은 최근 3일 안에 연 지사만 받아, 아무도 안 연 지사는 '1cm 미만'을 시각마다 0~1cm 로 셈(남원 은송리 69,80: 사이트 0~9cm,
--    날씨누리 '0.5cm 미만' × 9 = 0~4.5cm). 처음 연 때가 새 발표 직후면 화면이 쓰는 앞 발표 값이 없어 다음 격자 반영(약 1시간 반)까지 같은 문제.
--  * 받을 칸 = 관할 격자 중 지금 쓰는 예보(forecast_cells, 가까운 24시간 + 25시간째~)에 신적설(1cm 미만 포함)이 한 시각이라도 있는 칸.
--    - 비·'비/눈'만 있는 칸은 칸 조회도 '적설없음'이라 격자 값과 결과가 같음 → 받지 않음(11/27 비 칸 1,103 → 하루 약 9,400회라 한도 초과).
--    - 눈 없는 칸은 연 지사여도 받지 않음(결과가 같음). 지사를 연 기록(point_want)은 순서(먼저 받기)와 화면 '받는 중' 표시에만 씀.
--    - 새 발표가 반영돼 눈이 새로 생긴 칸은 10분마다 도는 collect-point 가 그 발표 안에 받음.
--  * 하루 상한 4,000회는 그대로, 발표마다 몫을 나눔: 그날 02시 발표까지 500회, 05시 1,000회 … 23시 4,000회(남은 몫은 다음 발표로).
--    큰 눈으로 눈 칸이 많은 날에도 밤 발표까지 받게. 순서 = 최근 연 지사의 칸 → 나머지(북→남).
--  * 11/27 08시 기준 눈 칸 70 → 하루 약 560회(지금 연 지사 방식 약 3,300회보다 적음).
-- ============================================================
begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';

do $g$ begin
  if md5(pg_get_functiondef('private.point_targets(int,text)'::regprocedure)) <> '49470b687631bad3ca9c02db256da94d'
  then raise exception '113: point_targets 가 107 과 다름(다른 곳에서 바뀜) — 중단'; end if;
end $g$;

-- 발표 tmfc 까지 그날(한국 날짜) 쓸 수 있는 칸 조회 수: 02시 500, 05시 1,000, …, 23시 4,000
create or replace function private.point_cap(p_tmfc timestamptz) returns int
language sql immutable set search_path = '' as $f$
  select least(4000, greatest(1, (extract(hour from p_tmfc at time zone 'Asia/Seoul')::int + 1) / 3) * 500)
$f$;
revoke all on function private.point_cap(timestamptz) from public, anon, authenticated;

-- 받을 칸: 눈이 예보된 관할 격자 중 이번 발표 값이 없는 칸(p_branch 가 있으면 그 지사 격자만). 최근 연 지사의 칸부터
create or replace function private.point_targets(p_limit int, p_branch text default null)
returns table (nx int, ny int)
language sql stable security definer set search_path = '' as $f$
  with t as (select private.point_tmfc() as t),
  g as (select e.nx, e.ny, e.branch_id from private.grid_effective() e where p_branch is null or e.branch_id = p_branch),
  snowy as (                                     -- 지금 쓰는 예보에 신적설(s) 또는 '1cm·0.5cm 미만'(sq) 이 있는 칸
    select f.nx, f.ny from public.forecast_cells f
     where f.issued_at >= now() - interval '12 hours'
       and exists (select 1 from g where g.nx = f.nx and g.ny = f.ny)
       and exists (select 1 from jsonb_array_elements_text(coalesce(f.series -> 's', '[]') || coalesce(f.series -> 'sq', '[]')
                                                          || coalesce(f.series_x -> 's', '[]') || coalesce(f.series_x -> 'sq', '[]')) v
                    where v::numeric > 0)),
  w as (select s.nx, s.ny, max(pw.opened_at) as o
          from snowy s join g on g.nx = s.nx and g.ny = s.ny
          left join private.point_want pw on pw.branch_id = g.branch_id and pw.opened_at > now() - interval '3 days'
         group by s.nx, s.ny)
  select w.nx, w.ny from w cross join t
    left join private.point_snow ps on ps.tmfc = t.t and ps.nx = w.nx and ps.ny = w.ny
   where ps.h is null and coalesce(ps.tries, 0) < 3 and (ps.tried_at is null or ps.tried_at < now() - interval '3 minutes')
     and coalesce((select u.calls from private.point_usage u where u.usage_day = (now() at time zone 'Asia/Seoul')::date), 0) < private.point_cap(t.t)
   order by w.o desc nulls last, w.ny desc, w.nx
   limit p_limit
$f$;
revoke all on function private.point_targets(int, text) from public, anon, authenticated;

commit;
