-- 103 (2026-11-19 사용자 '적용해'): 단기예보 칸 조회(getVilageFcst) 안정성 하루 측정 — 임시
--  * 단기 발표(02·05·08·11·14·17·20·23시) 뒤 11·14·20분에 점검 함수(probe-daily-forecast, kind=vilage_batch)로
--    고정 40칸을 8칸씩 동시에 불러 칸마다 성공 여부·걸린 시간·줄 수만 남긴다. 예보 값은 저장하지 않는다.
--  * 2026-11-21 00:30(한국) 이후에는 기상청을 부르지 않는다(저절로 멈춤). 분석이 끝나면 예약 2개와 표를 지운다(사용자 확인 후).
--  * 기상청 사용량: 하루 약 24번 × 40칸 = 960회, 약 0.13GB.

create table if not exists private.point_probe_log (
  req_id    bigint primary key,
  sent_at   timestamptz not null default now(),
  status    int,
  timed_out boolean,
  error     text,
  body      jsonb
);
revoke all on private.point_probe_log from public, anon, authenticated;

select cron.schedule('probe-point-measure', '11,14,20 2,5,8,11,14,17,20,23 * * *', $cmd$
insert into private.point_probe_log(req_id)
select net.http_post(
  url := 'https://yzwbnohzhnctdvufntig.supabase.co/functions/v1/probe-daily-forecast',
  headers := jsonb_build_object('Content-Type','application/json','x-collector-token',(select token from private.collector_token where id=1)),
  body := '{"kind":"vilage_batch","rows":1100,"lag":10,"par":8,"cells":[[58,63],[66,67],[50,71],[79,72],[79,74],[63,76],[79,77],[90,78],[100,79],[86,81],[98,82],[56,84],[78,85],[58,87],[67,88],[102,89],[64,91],[93,92],[85,94],[100,95],[77,97],[58,99],[102,100],[77,102],[78,103],[89,104],[90,106],[65,109],[61,111],[69,113],[66,115],[68,117],[71,119],[71,121],[64,123],[59,125],[83,126],[57,129],[93,130],[92,132]]}'::jsonb,
  timeout_milliseconds := 120000)
where now() < timestamptz '2026-11-21 00:30+09'
$cmd$);

-- 응답(pg_net 은 6시간만 보관)을 5분마다 기록 표로 옮긴다
select cron.schedule('probe-point-log', '*/5 * * * *', $cmd$
update private.point_probe_log l
   set status = r.status_code, timed_out = r.timed_out, error = left(r.error_msg, 300),
       body = case when r.content like '{%' then r.content::jsonb end
  from net._http_response r
 where r.id = l.req_id and l.status is null and l.timed_out is null
$cmd$);
