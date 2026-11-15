-- 101. 일별 보강 수집(collect-daily-aux) 예약 10분 → 5분. 2026-11-16 Claude Code.
--  사용자(2026-11-16): "일별 보강 수집 시간을 120초 늘리기 및 5분마다 돌리기는 너의 추천대로 하자" (11/9 제안: 새 발표 하늘상태·습도를 15~20분 안에).
--  * 받을 것이 없으면 함수·기상청 호출을 하지 않음(kick_daily_aux 의 미수집 확인, 3분 중복 방지 그대로) → 기상청 호출 수는 늘지 않고 빨리 받기만 함.
--  * 함수 한 번 시간 85→120초는 collect-daily-aux 함수(core.mjs BUDGET) 배포로.
do $g$ begin
  if not exists(select 1 from cron.job where jobname='collect-daily-aux' and schedule='*/10 * * * *') then
    raise exception '101: collect-daily-aux 예약이 예상(*/10)과 다름 — 중단'; end if;
end $g$;
select cron.alter_job(job_id := (select jobid from cron.job where jobname='collect-daily-aux'), schedule := '*/5 * * * *');
