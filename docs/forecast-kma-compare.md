# 기관별 예보 ↔ 기상청 날씨누리 대조 방법

2026-11-11 Claude Code. 사용자 목표: "1시간, 3시간, 일별 예보가 기상청과 동일해야". 예약 작업(대조)과 사람이 다시 대조할 때 이 문서대로 한다.
**대조만 하고 고치지 않는다.** 차이가 나오면 원인을 적어 사용자에게 보고하고 고칠지 묻는다. 서버(Supabase)는 읽기만 하고 시험용 쓰기를 남기지 않는다.

## 1. 날씨누리 값 받기 (브라우저 창, 로그인 필요 없음)

- `https://www.weather.go.kr/w/index.do` 를 연 뒤, 그 탭에서 JavaScript 로 같은 사이트 주소를 `fetch` 한다.
- 격자 → 위경도: 기상청 람베르트 격자 역변환(아래 `g2ll`). 그 위경도로 부르면 그 격자 값이 나온다.
- 주소: `/w/wnuri-fct2021/main/digital-forecast.do?code=<시군구10자리>&unit=m%2Fs&hr1=<Y|N>&lat=<위도>&lon=<경도>`
  - `hr1=Y` = 1시간 목록 + 일별, `hr1=N` = 3시간 목록. 1시간·3시간·1~4일째 일별은 `code` 와 상관없이 위경도로 정해진다.
  - **5일째 이후 일별(중기)은 `code` 의 지역으로 정해진다** → 그 격자의 시군구 코드(앞 5자리 + `00000`, 예: 강릉 `5115000000`)를 넣어야 한다. 모르면 중기 대조는 뺀다.
- 목록: `ul.item[data-date][data-time]`(1시간·3시간 칸, `vs-item` = 초단기 시각), 일별: `.dfs-daily-slide[data-date]`.
- 칸 글에서: 기온 `/기온[^|0-9-]*(-?\d+)℃/`, 강수확률 `/강수확률: (\d+)%/`, 습도 `/습도: (\d+)%/`, 강수량 `강수량: …`(없음 `-`), 3시간 강수강도 `강수강도: 약한비|보통비|강한비`(없음 `-`).
- 일별 글: `오전 X 오후 Y 최저 : a℃ 최고 : b℃ 오전 강수확률p% 오후 강수확률q%`, 8~10일 뒤는 `종일X 최저 : a℃ 최고 : b℃ 강수확률p%`.
- 초단기 발표 시각은 `.cmp-dfs-updated` 글의 "초단기예보(…):11.11.(수) 13:10" 으로 확인 → 서버의 마지막 완료 초단기(`forecast_vsrt_runs.done_at`)와 같을 때만 앞 6시간을 비교(다르면 '발표 시각 차이'로 따로 적음).

```js
window.g2ll=function(x,y){const RE=6371.00877,GRID=5,SLAT1=30,SLAT2=60,OLON=126,OLAT=38,XO=43,YO=136,D=Math.PI/180;const re=RE/GRID,s1=SLAT1*D,s2=SLAT2*D,olon=OLON*D,olat=OLAT*D;let sn=Math.log(Math.cos(s1)/Math.cos(s2))/Math.log(Math.tan(Math.PI*0.25+s2*0.5)/Math.tan(Math.PI*0.25+s1*0.5));let sf=Math.pow(Math.tan(Math.PI*0.25+s1*0.5),sn)*Math.cos(s1)/sn;let ro=re*sf/Math.pow(Math.tan(Math.PI*0.25+olat*0.5),sn);const xn=x-XO,yn=ro-y+YO;let ra=Math.sqrt(xn*xn+yn*yn);if(sn<0)ra=-ra;let alat=Math.pow(re*sf/ra,1/sn);alat=2*Math.atan(alat)-Math.PI*0.5;let theta=Math.abs(xn)<=0?0:Math.atan2(xn,yn);return [alat/D,(theta/sn+olon)/D];};
window.kdoc=async(code,nx,ny,hr1)=>{const [la,lo]=g2ll(nx,ny);const t=await (await fetch(`/w/wnuri-fct2021/main/digital-forecast.do?code=${code}&unit=m%2Fs&hr1=${hr1}&lat=${la.toFixed(6)}&lon=${lo.toFixed(6)}`)).text();return new DOMParser().parseFromString(t,'text/html');};
```

## 2. 우리 값 받기 (Supabase SQL, 읽기만)

- 로그인 흉내: `select set_config('request.jwt.claims', json_build_object('sub',(select id from public.profiles where role='admin' and not disabled limit 1),'role','authenticated')::text, true);`
- 1시간·3시간 원자료: `public.forecast_cell_detail(nx,ny)` → `upper.start_at` + `upper.series`(24시각: t 기온, r 확률, h 습도, p·pq 강수·'~1', s·sq 적설·'~1', vn 초단기 시각 수) + `hourly_tail`(그 뒤, `sc`·`pc` = 기상청이 양 대신 주는 강도 등급, `quantity_end_at` = 1시간 표 끝).
- 일별: `public.forecast_daily_cell(nx,ny)` → `days[]`(date, tmin, tmax, periods[]: forecast_at 00시 = 오전·12시 = 오후·period_hours 24 = 하루, weather, pop, source).
- 대상 격자: `select distinct e.nx, e.ny, b.hq_id from private.grid_effective() e join public.branches b on b.id=e.branch_id` 에서 본부마다 무작위 3칸(+ 비·눈 많은 칸).

## 3. 화면 규칙(이대로 계산해 날씨누리와 비교)

- 1시간 표: 다가올 정시부터(`skipHours`) 1시간 표 끝(`quantity_end_at`)까지. 기온·습도 반올림 정수, 강수확률 그대로, 강수·적설 0 = '-', '~1' = 1 미만.
- 3시간 표(forecast/series.js `combine`): 칸 = 그 시각까지 3시간(03시 칸 = 01·02·03시). 기온·습도 = 그 시각 값.
  - 양이 있는 구간: 확률 = 비·눈 있으면 3시간 최고, 없으면 평균(10% 반올림). 강도 = 3시간 중 가장 센 것(비 3mm·15mm, 눈 1cm, '~1' 은 약한 쪽).
  - 강도만 있는 구간(칸 안 시각이 모두 `pc`·`sc`): 그 칸 시각의 확률·강도(2026-11-11 확인, 312/312).
- 일별(서버 `private.forecast_daily_cell_calc`): 오늘부터 11일. 1~3일째 반나절 = 12시간(비 시각 ≤2 한때·≤5 가끔·그 이상 계속), 4일째(강도만 있는 구간) = 3·6·9·12시(15·18·21·24시) 4개 시각(비 1 한때·2 가끔·3+ 계속), 5일째부터 중기.
- 알려진 차이(정상): 오늘 최저·최고(날씨누리 = 지난 시각 관측, 관측 수집은 2026-11-11 기상청 활용신청 대기), 초단기 발표 시각 차이.

## 4. 보고 양식

- 대조 시각, 날씨누리 초단기·단기·중기 발표 시각, 서버 발표 시각.
- 표마다 비교 칸 수·같은 수(1시간: 기온·확률·습도·강수 / 3시간: 기온·습도·확률·강도 / 일별: 날씨·확률·최저최고).
- 다른 칸: 격자·시각·날씨누리 값·우리 값과 짐작한 원인. 비·눈이 대조 범위에 있었는지(없었으면 "비·눈 숫자 미확인").
