// ============================================================
// collect-snow — 일 신적설 자동 수집: 기상청 kma_snow1.php(sd=day)를 그날 00~23시 받아 관측소별 그날 최댓값을 서버에 넣는다
//  * 손으로 받던 콘솔 스크립트(데이터 출처 탭)와 같은 계산: 시각마다 "그날 0시부터의 신적설"을 받고, 관측소마다 가장 큰 값 = 일 신적설
//  * 부르는 곳: pg_cron(수집 기간 11.1~4.30 에만 한국 01:10부터 30분마다 11:40까지 — 하루치를 다 받으면 그 뒤는 부르지 않음) → private.kick_snow() → pg_net (헤더 x-collector-token)
//    날짜를 정해 부를 수도 있음: { date:'YYYYMMDD', dry:true } (dry = 넣지 않고 기존 값과 비교만). 지난 시즌 빠진 날 받기(snow-backfill, 마이그레이션 47)도 이것으로
//  * 서버(snow_plan)가 이미 받은 시각을 알려 주면 남은 시각만 받음. 시각마다 snow_put(더 큰 값만 반영), 끝에 snow_finish(요약본 다시 만들기)
//  * 기상청이 가끔 응답이 늦거나 504(30초 시간 초과)를 줌: 정상 응답은 1초 안팎이라 15초 넘게 걸리면 끊고 1초 뒤 한 번 더.
//    함수 한 번은 약 115초 안에 끝냄(무료 플랜 최대 150초). 못 받은 시각은 다음 예약(30분마다, 11:40까지) 때 그 시각만.
//  * 기상청 키는 함수 비밀값 KMA_AUTH_KEY 에만. 키가 들어간 주소는 오류·기록에 남기지 않는다.
//  * 관측소 위치(2026-11-10 사용자: 고속도로 근처 빠진 관측소 추가): 본문 {"stations":true,"date":"YYYYMMDD","hour":12} → 그 시각 글의 관측소 번호·이름·경도·위도만 돌려줌(저장 안 함, 기상청 1번)
//  * 순수 로직은 Node 로 시험: tests/test_collect_snow.mjs
// ============================================================
export const SNOW_URL = 'https://apihub.kma.go.kr/api/typ01/url/kma_snow1.php';
export const CALL_MS = 15000;                                           // 기상청 한 번 기다리는 최대 시간(index.ts 가 끊음)
const BUDGET_MS = 115000, GAP_MS = 300, RETRY_MS = 1000, TRIES = 2;   // 무료 플랜 함수 한 번 최대 150초

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

// 기상청 글 → { 관측소번호: 값 }. 줄 모양: "YYYYMMDDHHMI, 관측소, 이름, 경도, 위도, 종류, 신적설(cm),="
// 다른 시각의 줄은 버림. 관측 줄이 하나도 없으면 null(형식이 다르거나 오류 글)
export function parseSnow(text, tm) {
  if (typeof text !== 'string' || !text.includes('#START7777')) return null;
  const out = {}; let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const p = line.split(',').map((s) => s.trim());
    if (p.length < 7 || p[0] !== tm) continue;
    const stn = p[1], v = Number(p[6]);
    if (!/^\d{1,6}$/.test(stn) || p[6] === '' || !Number.isFinite(v)) continue;
    out[stn] = v; n++;
  }
  return n ? out : null;
}

// 기상청 글 → 관측소 위치 [[번호, 이름, 경도, 위도], …] (값이 비었거나 결측이어도 위치는 씀). 줄이 없으면 null
export function parseStations(text) {
  if (typeof text !== 'string' || !text.includes('#START7777')) return null;
  const seen = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const p = line.split(',').map((s) => s.trim());
    if (p.length < 6 || !/^\d{1,6}$/.test(p[1])) continue;
    const lon = Number(p[3]), lat = Number(p[4]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < 120 || lon > 135 || lat < 30 || lat > 45) continue;
    if (!seen.has(p[1])) seen.set(p[1], [Number(p[1]), p[2], Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]);
  }
  return seen.size ? [...seen.values()].sort((a, b) => a[0] - b[0]) : null;
}

async function allowed(req, deps) {
  const t = req.headers.get('x-collector-token');
  if (t) return { ok: await deps.store.tokenOk(t), admin: false };
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return { ok: false };
  const u = await deps.auth.getUser(jwt);
  if (!u || !u.id) return { ok: false };
  const p = await deps.store.getProfileById(u.id);
  return { ok: !!(p && p.role === 'admin' && !p.disabled), admin: true };
}

export async function handle(req, deps) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method' });
  const who = await allowed(req, deps);
  if (!who.ok) return json(401, { ok: false, error: 'unauthorized' });
  let body = {}; try { body = JSON.parse((await req.text()) || '{}') || {}; } catch { return json(400, { ok: false, error: 'bad_request' }); }
  const date = typeof body.date === 'string' && /^\d{8}$/.test(body.date) ? body.date : null;   // 지난 날짜 다시 받기·비교(서버 안 토큰 또는 관리자)
  const dry = body.dry === true;
  const key = String(deps.env('KMA_AUTH_KEY') || '').trim();
  if (!key) return json(200, { ok: false, error: 'no_key' });
  if (body.stations === true) {                                      // 관측소 위치만(저장 안 함)
    const h = Number.isInteger(body.hour) && body.hour >= 0 && body.hour <= 23 ? body.hour : 12;
    if (!date) return json(400, { ok: false, error: 'date' });
    const tm = date + String(h).padStart(2, '0') + '00';
    const r = await deps.fetchText(`${SNOW_URL}?sd=day&tm=${tm}&help=0&authKey=${encodeURIComponent(key)}`);
    const list = r.status === 200 ? parseStations(r.text) : null;
    return json(200, { ok: !!list, tm, status: r.status, count: list ? list.length : 0, stations: list || [] });
  }

  const { data: plan, error } = await deps.store.plan(date ? date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : null);
  if (error || !plan) return json(500, { ok: false, error: 'db' });
  if (!plan.in_season) return json(200, { ok: true, skipped: 'out_of_season', date: plan.date });
  const done = new Set(dry ? [] : plan.done || []);
  const hours = [...Array(24).keys()].filter((h) => !done.has(h));
  if (!hours.length) return json(200, { ok: true, done: true, date: plan.date });

  const t0 = deps.now(), iso = plan.date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  let got = 0, written = 0, lastErr = null; const counts = { new: 0, higher: 0, same: 0, lower: 0 }, dayMax = {};
  for (const h of hours) {
    const tm = plan.date + String(h).padStart(2, '0') + '00';
    const url = `${SNOW_URL}?sd=day&tm=${tm}&help=0&authKey=${encodeURIComponent(key)}`;
    let vals = null, err = null;
    for (let i = 0; i < TRIES && !vals; i++) {
      if (deps.now() - t0 + CALL_MS > BUDGET_MS) { err = err || 'budget'; break; }   // 다음 요청이 시간 안에 못 끝날 수 있으면 멈춤
      if (i) await deps.sleep(RETRY_MS);
      const r = await deps.fetchText(url);
      if (r.status === 200) { vals = parseSnow(r.text, tm); if (!vals) err = `${tm} 형식`; }
      else err = `${tm} HTTP ${r.status}`;
      if (r.status === 401 || r.status === 403) break;               // 키·활용신청 문제는 다시 해도 같음
    }
    if (!vals) lastErr = err;
    if (err === 'budget') break;
    if (vals && dry) { got++; for (const [k, v] of Object.entries(vals)) if (!(k in dayMax) || v > dayMax[k]) dayMax[k] = v; }   // 비교: 그날 최댓값을 모아 끝에 한 번
    else if (vals) {
      const { data: c, error: e } = await deps.store.put(iso, h, vals, false);
      if (e || !c) { lastErr = `${tm} 저장 실패`; break; }
      got++; written += c.written || 0; for (const k of Object.keys(counts)) counts[k] += c[k] || 0;
    }
    await deps.sleep(GAP_MS);
  }
  const total = done.size + got;
  if (dry) {                                                         // 그날 최댓값 vs 서버에 있는 값(new = 서버에 없음, higher/lower = 서버 값보다 큼/작음)
    const { data: c } = got ? await deps.store.put(iso, 0, dayMax, true) : { data: null };
    return json(200, { ok: true, dry: true, date: plan.date, hours: got, stations: Object.keys(dayMax).length, counts: c || counts, error: lastErr });
  }
  const note = total === 24 ? `자동 수집(kma_snow1) ${plan.date} 24시각` : `자동 수집 ${plan.date} ${total}/24시각${lastErr ? ' — ' + lastErr : ''}`;
  await deps.store.finish(iso, total, written, note);
  return json(200, { ok: total === 24, date: plan.date, hours: total, fetched: got, written, counts, error: total === 24 ? null : lastErr });
}
