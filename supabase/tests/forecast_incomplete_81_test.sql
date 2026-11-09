-- 81 시험: 운영 DB 에서 돌려도 끝의 raise exception 으로 모두 되돌림(남는 자료 없음)
-- 성공하면 'OK 81 ...' 오류 문구로 끝남. 다른 오류면 실패
do $t$
declare t timestamptz := '2020-01-01 09:00+09'; r jsonb; n int; c int; ord jsonb; z real[]; g real[];
begin
  r := public.forecast_vsrt_begin(t);
  c := jsonb_array_length(r->'cells');
  ord := r->'missing';
  if ord->0->>0 <> 'T1H' or (ord->0->>1)::timestamptz <> '2020-01-01 15:00+09' then raise exception 'FAIL 첫 요청은 마지막 시각 기온: %', ord->0; end if;
  if ord->5->>0 <> 'T1H' or (ord->5->>1)::timestamptz <> '2020-01-01 10:00+09' or ord->6->>0 = 'T1H' then raise exception 'FAIL 기온 6개 먼저: %', ord; end if;
  g := array_fill(5::real, array[c]);
  z := array_fill(0::real, array[c]); z[1] := -99;                       -- 결측 칸 하나 섞인 0 격자
  r := public.forecast_vsrt_put(t, 'RN1', '2020-01-01 10:00+09', g);
  if (r->>'hours')::int <> 1 then raise exception 'FAIL 정상 저장 %', r; end if;
  r := public.forecast_vsrt_put(t, 'T1H', '2020-01-01 15:00+09', z);
  if coalesce((r->>'incomplete')::boolean, false) is not true then raise exception 'FAIL 미완성 판단 %', r; end if;
  select count(*) into n from public.forecast_vsrt_hours where tmfc = t;
  if n <> 0 then raise exception 'FAIL 미완성 발표분 값이 남음 %', n; end if;
  z[2] := 3.5;                                                           -- 0 이 아닌 칸이 하나라도 있으면 정상
  r := public.forecast_vsrt_put(t, 'T1H', '2020-01-01 15:00+09', z);
  if (r->>'hours')::int <> 1 then raise exception 'FAIL 정상 기온 저장 %', r; end if;
  if private.fc_end('2026-11-09 16:59+09') <> '2026-11-13 00:00+09' or private.fc_end('2026-11-09 17:00+09') <> '2026-11-14 00:00+09' then raise exception 'FAIL fc_end'; end if;
  raise exception 'OK 81 (모두 되돌림)';
end $t$;
