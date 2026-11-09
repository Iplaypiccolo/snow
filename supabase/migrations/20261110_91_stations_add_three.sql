-- 91. 지사 관측소 3곳 추가(빠지는 곳 없음). 2026-11-10 Claude Code.
--  사용자(2026-11-10 "관측소는 빠뜨리지 마. 이전 버젼으로 다시 적용해"): 배정 규칙은 그대로(관할 노선 5km 이하, 5곳 이하면 6→7→8km).
--  기상청 kma_snow1 글의 관측소 위치 668곳(collect-snow v12 stations 기능, 2026-01-20 12시)으로 59개 지사를 다시 골랐더니
--  기존 384건은 모두 그대로, 새로 3건: 파주(B005) 동두천 98 4.999km, 엄정(B021) 백운 325 7.995km, 청송(B049) 영덕읍 844 5.893km.
--  관측소 표에 3곳, 지사별 관측소에 3건을 더하고 적설 요약(시즌별)을 다시 만든다. 지우는 것 없음.
begin;

do $g$ begin
  if (select count(*) from public.stations) <> 260 or (select count(*) from public.branch_stations) <> 384
     or exists (select 1 from public.stations where id in (98, 325, 844))
  then raise exception '91: 관측소 표가 예상과 다름 — 중단'; end if;
end $g$;

insert into public.stations (id, name, addr, lat, lon) values
  (98, '동두천', null, 37.90186, 127.06069),
  (325, '백운', null, 37.14449, 128.02526),
  (844, '영덕읍', null, 36.43551, 129.35859);

insert into public.branch_stations (branch_id, station_id, dist_km, road) values
  ('B005', 98, 4.999, '수도권제2순환선(파주~양주)'),
  ('B021', 325, 7.995, '평택제천선'),
  ('B049', 844, 5.893, '서산영덕선(상주~영덕)');

select public.admin_rebuild_snow_snapshot();

commit;
