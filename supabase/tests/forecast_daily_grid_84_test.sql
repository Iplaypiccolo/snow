-- 84 시험(운영 DB에서 실행해도 남는 것 없음: 끝에서 예외로 전부 되돌림). 성공하면 'OK 84 …' 예외 메시지.
-- 가짜 SKY(모두 흐림 4)를 최신 완료 단기 발표에 넣고, 일별 창의 가까운 날 반나절이
--  1) source=short_grid, 2) 비 없으면 '흐림', 3) 강수확률 = 12시간 평균 10% 반올림(비 있으면 최고) 인지 독립 계산과 맞춰 본다.
do $t$
declare uid uuid; fr public.forecast_runs; c record; res jsonb; p jsonb; ci int; n int := 0; d date; am boolean; exp_pop int; rain int;
begin
  select id into uid from public.profiles where role='admin' and not disabled limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated')::text, true);
  select * into fr from public.forecast_runs where done_at is not null order by tmfc desc limit 1;
  delete from private.forecast_daily_aux_hours where var='SKY';
  insert into private.forecast_daily_aux_hours(tmfc,var,tmef,vals,is_empty,empty_attempts)
  select h.tmfc,'SKY',h.tmef,(select array_agg(4::real) from jsonb_array_elements(fr.cells)),false,0
    from public.forecast_hours h where h.tmfc=fr.tmfc and h.var='TMP' and not h.is_empty;
  for c in select (x.value->>0)::int nx, (x.value->>1)::int ny, x.ordinality::int i
             from jsonb_array_elements(fr.cells) with ordinality x where x.ordinality % 97 = 1 loop
    res := public.forecast_daily_cell(c.nx, c.ny);
    for p in select pp from jsonb_array_elements(res->'days') dd, jsonb_array_elements(dd->'periods') pp
              where pp->>'source'='short_grid' loop
      d := (((p->>'forecast_at')::timestamptz) at time zone 'Asia/Seoul')::date;
      am := extract(hour from ((p->>'forecast_at')::timestamptz) at time zone 'Asia/Seoul') = 0;
      select count(*) filter (where y.vals[c.i] > 0),
             case when count(*) filter (where y.vals[c.i] > 0) > 0 then max(o.vals[c.i]) else round(avg(o.vals[c.i]::numeric)/10)*10 end
        into rain, exp_pop
        from public.forecast_hours o join public.forecast_hours y on y.tmfc=o.tmfc and y.tmef=o.tmef and y.var='PTY'
       where o.tmfc=fr.tmfc and o.var='POP' and not o.is_empty
         and ((o.tmef - interval '1 hour') at time zone 'Asia/Seoul')::date = d
         and (extract(hour from (o.tmef - interval '1 hour') at time zone 'Asia/Seoul') < 12) = am;
      if (p->>'pop')::int is distinct from exp_pop then raise exception 'FAIL pop % % %: % <> %', c.nx, c.ny, p->>'forecast_at', p->>'pop', exp_pop; end if;
      if rain = 0 and p->>'weather' <> '흐림' then raise exception 'FAIL sky % %: %', c.nx, c.ny, p->>'weather'; end if;
      if rain > 0 and p->>'precip' = '0' then raise exception 'FAIL precip % %', c.nx, c.ny; end if;
      n := n + 1;
    end loop;
  end loop;
  if n < 20 then raise exception 'FAIL too few grid halves: %', n; end if;
  raise exception 'OK 84 (% halves)', n;
end $t$;
