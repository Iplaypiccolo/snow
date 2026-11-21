-- 104 (2026-11-20 사용자 "둘 다 진행" = 측정 끝나면 지워도 됨): 103 의 칸 조회 측정 정리
--  * 측정 예약 2개(probe-point-measure, probe-point-log)를 지우고 기록 표 private.point_probe_log 를 지운다.
--  * 결과는 docs/forecast-snow-point-20261120.md 1-4 에 옮겨 적음(27회 × 40칸).
--  * 점검 함수 probe-daily-forecast 는 그대로 둔다(부를 때만 동작).
select cron.unschedule(jobid) from cron.job where jobname in ('probe-point-measure','probe-point-log');
drop table if exists private.point_probe_log;
