// ============================================================
// collect-forecast — 기상청 단기예보 격자(SNO = 1시간 신적설 cm, PCP = 1시간 강수량 mm, TMP = 기온 ℃, POP = 강수확률 %)를 1시간치씩 받아 지사 격자만 골라 서버에 넣는다
//  * 부르는 곳: pg_cron(발표 시각 15·25·35·45분, 받을 필요가 있을 때만) 또는 기준일자를 만들 때 → private.kick_forecast() → pg_net
//    (헤더 x-collector-token = 서버 안 전용 토큰). 관리자 로그인 토큰으로도 직접 부를 수 있음.
//  * 서버(forecast_plan)가 "가장 최근 발표분 · 받기 시작한 시각의 다음 정시부터 24시간" 중 아직 없는 [종류, 시각](적설 24 + 강수 24 = 48)을 알려 주면
//    한 시각씩 요청(요청 1번 = 전국 149×253 격자 1시간치, 약 340KB) → 지사 격자만 골라 forecast_put.
//    48개가 다 모이면 서버가 격자별 24시간 합(forecast_cells)과 지사별 최댓값(branch_forecast)을 만든다.
//  * 기상청이 자주 504(시간 초과)를 주므로 2초 뒤 최대 3번 다시. 요청 사이 0.5초. 120초가 넘으면 멈추고 다음 예약 때 이어서.
//  * 기상청 키는 함수 비밀값 KMA_AUTH_KEY 에만. 키가 들어간 주소는 오류·기록에 남기지 않는다.
//  * 받을 종류·순서는 서버(forecast_plan)가 정함: 적설·강수·기온 먼저, 강수확률은 그다음(마이그레이션 42). 이 함수는 목록대로 받기만 함
//  * 시험 호출 {"probe":"POP"}: 그 종류를 한 시각만 받아 요약(개수·최소·최대)만 돌려줌. 저장하지 않음 — 새 종류를 넣기 전에 기상청이 주는지 확인하는 용도
//  * 초단기예보(마이그레이션 57): 본문 {"vsrt":true} → 10분 간격 발표분을 서버가 알려 준 종류(지금 T1H·RN1·POP·PTY·SKY·REH, 89)·6시각만큼 받아 forecast_vsrt_put. 89: 첫 1개는 혼자(안 나온 발표분이면 1번만 부름), 그다음은 3개씩 동시에 받고 저장은 차례대로. 단기예보 값은 건드리지 않음(화면에서 전환해 봄).
//    아직 안 나온 발표분은 200 + '# dfs_file_read error' → 한 칸 앞 발표분을 받음(실패로 기록 안 함). 시험 호출 {"vsrt":true,"probe":"T1H"}: 저장 없이 요약만
//    기온이 유효 칸 모두 0 인 시각이 오면(정각 발표분에서 2026-11-09 두 번 관찰) 서버가 {incomplete:true} → 그 발표분은 버리고 한 칸 앞(마이그레이션 81)
//  * 빈 시각 판단: 결측(-90 이하, 바다 칸 -99 포함)을 뺀 유효 칸이 모두 0. 실제 격자는 바다 칸이 -99 라 '모든 칸이 유효' 조건은 맞지 않음(81)
//  * 처리 중 예상 못 한 오류는 수집 실패(forecast_fail / forecast_vsrt_fail)에 남기고 오류 응답(키는 가림)
//  * 순수 로직은 Node 로 시험: tests/test_collect_forecast.mjs
// ============================================================
export const GRID_URL = 'https://apihub.kma.go.kr/api/typ01/cgi-bin/url/nph-dfs_shrt_grd';
export const VSRT_URL = 'https://apihub.kma.go.kr/api/typ01/cgi-bin/url/nph-dfs_vsrt_grd';
export const VSRT_VARS = ['T1H', 'RN1', 'POP', 'PTY', 'SKY', 'REH'];      // 시험 호출로 받아 볼 수 있는 초단기 종류. 실제로 받을 종류는 서버(forecast_vsrt_begin)가 정함
export const NX = 149, NY = 253;
const BUDGET_MS = 120000, GAP_MS = 500, RETRY_MS = 2000, TRIES = 4;   // 무료 플랜 함수 한 번 최대 150초
const VSRT_PAR = 3;      // 89: 초단기 동시에 받는 수(기상청이 느릴 때 2분 안에 끝나게). 부르는 횟수는 그대로

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

// ISO 시각 → 'YYYYMMDDHH'(한국 시각)
export const kstHour = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().replace(/[-T:]/g, '').slice(0, 10);

// ISO 시각 → 'YYYYMMDDHHmm'(한국 시각) — 초단기예보 발표 시각은 분까지
export const kstMinute = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().replace(/[-T:]/g, '').slice(0, 12);

// 격자 글(쉼표·빈칸으로 나뉜 37,697개 값, 첫 줄 = 남쪽 ny=1) → 고른 격자 [[nx, ny]…] 순서의 값. 형식이 다르면 null
export function pickCells(text, cells) {
  if (typeof text !== 'string') return null;
  const v = text.split(/[\s,]+/); if (v.length && v[v.length - 1] === '') v.pop(); if (v.length && v[0] === '') v.shift();   // 앞뒤 빈칸·줄 끝 쉼표
  if (v.length !== NX * NY) return null;
  const out = new Array(cells.length);
  for (let k = 0; k < cells.length; k++) {
    const [nx, ny] = cells[k], x = Number(v[(ny - 1) * NX + (nx - 1)]);
    if (!Number.isFinite(x)) return null;
    out[k] = x;
  }
  return out;
}

// 격자 글 전체의 요약(시험 호출용): 값 개수, 없는 값(-90 이하)을 뺀 최소·최대, 서로 다른 값 몇 개
export const PROBE_VARS = ['SNO', 'PCP', 'TMP', 'POP', 'PTY'];
export function gridStats(text) {
  if (typeof text !== 'string') return null;
  const v = text.split(/[\s,]+/).filter((x) => x !== '').map(Number);
  if (v.length !== NX * NY || v.some((x) => !Number.isFinite(x))) return { n: v.length, ok: false };
  const good = v.filter((x) => x > -90), uniq = [...new Set(good)].sort((a, b) => a - b);
  return { n: v.length, ok: true, valid: good.length, min: good.length ? uniq[0] : null, max: good.length ? uniq[uniq.length - 1] : null, distinct: uniq.length, sample: uniq.slice(0, 12) };
}
// 빈 시각: 유효 칸이 있고 모두 0(바다 칸 -99 는 셈에서 뺌)
export const allZero = (s) => !!(s && s.ok && s.valid > 0 && s.min === 0 && s.max === 0);

async function allowed(req, deps) {
  const t = req.headers.get('x-collector-token');
  if (t) return await deps.store.tokenOk(t);
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return false;
  const u = await deps.auth.getUser(jwt);
  if (!u || !u.id) return false;
  const p = await deps.store.getProfileById(u.id);
  return !!(p && p.role === 'admin' && !p.disabled);
}

// 초단기예보 시험 호출: 20분 전 발표분의 다음 정시 한 시각만 받아 요약(저장 안 함)
async function probeVsrt(body, deps, key) {
  const v = String(body.probe).toUpperCase();
  if (!VSRT_VARS.includes(v)) return json(400, { ok: false, error: 'bad_probe' });
  const tm = Math.floor(Date.now() / 600000) * 600000 - 1200000, tmfc = new Date(tm).toISOString(), tmef = new Date(Math.floor(tm / 3600000) * 3600000 + 3600000).toISOString();
  const r = await deps.fetchText(`${VSRT_URL}?tmfc=${kstMinute(tmfc)}&tmef=${kstHour(tmef)}&vars=${v}&authKey=${encodeURIComponent(key)}`);
  const stats = r.status === 200 ? gridStats(r.text) : null;
  const head = stats && stats.ok ? undefined : String(r.text || '').slice(0, 160).split(key).join('***');
  return json(200, { ok: r.status === 200 && !!(stats && stats.ok), probe: v, status: r.status, tmfc: kstMinute(tmfc), tmef: kstHour(tmef), stats, head });
}

// 초단기 한 장(한 종류·한 시각): 실패면 다시 시도. notReady = 기상청에 아직 그 발표분이 없음
async function fetchVsrt(deps, key, tmfc, v, tmef, cells, t0) {
  const url = `${VSRT_URL}?tmfc=${kstMinute(tmfc)}&tmef=${kstHour(tmef)}&vars=${v}&authKey=${encodeURIComponent(key)}`;
  let vals = null, status = 0;
  for (let i = 0; i < TRIES && !vals; i++) {
    if (deps.now() - t0 > BUDGET_MS) { status = 'budget'; break; }
    if (i) await deps.sleep(RETRY_MS);
    const r = await deps.fetchText(url); status = r.status;
    if (r.status === 200 && String(r.text).includes('dfs_file_read')) return { notReady: true };
    vals = r.status === 200 ? pickCells(r.text, cells) : null;
    if (r.status === 200 && !vals) { status = 'format'; break; }
  }
  return { vals, status };
}

// 초단기예보 받기: 새 발표분부터 시도, 아직 안 나왔으면 한 칸 앞 발표분
async function collectVsrt(deps, key) {
  const { data: plan, error } = await deps.store.vsrtPlan();
  if (error || !plan) return json(500, { ok: false, error: 'db' });
  const t0 = deps.now(); let used = null, put = 0, lastErr = null, done = false;
  for (const tmfc of plan.candidates) {
    const { data: run, error: e1 } = await deps.store.vsrtBegin(tmfc);
    if (e1 || !run) return json(500, { ok: false, error: 'db' });
    if (!run.cells || !run.cells.length) return json(200, { ok: false, error: 'no_cells' });
    let notReady = false, stop = false;
    const todo = run.missing.slice();
    for (let first = true; todo.length && !stop; first = false) {
      if (deps.now() - t0 > BUDGET_MS) { lastErr = '시간이 모자라 다음 예약 때 이어서'; break; }
      const batch = todo.splice(0, first ? 1 : VSRT_PAR);
      const got = await Promise.all(batch.map(([v, tmef]) => fetchVsrt(deps, key, tmfc, v, tmef, run.cells, t0)));
      for (let k = 0; k < batch.length && !stop; k++) {      // 저장은 목록 차례대로 하나씩(서버가 완료를 세는 기준이 흐트러지지 않게)
        const [v, tmef] = batch[k], g = got[k];
        if (g.notReady) { notReady = true; stop = true; break; }
        if (!g.vals) { lastErr = g.status === 'budget' ? '시간이 모자라 다음 예약 때 이어서' : g.status === 'format' ? '기상청 격자 형식이 다름(키·주소 확인)' : `기상청 응답 ${g.status || '연결 실패'} (초단기 ${v} ${kstHour(tmef)})`; stop = true; break; }
        const { data: res, error: e2 } = await deps.store.vsrtPut(tmfc, v, tmef, g.vals);
        if (e2) { lastErr = 'DB 저장 실패'; stop = true; break; }
        if (res && res.incomplete) { notReady = true; put = 0; stop = true; break; }   // 81: 미완성 발표분(서버가 받은 값을 지움) → 한 칸 앞
        put++; done = !!(res && res.done);
        if (done) stop = true;
      }
    }
    if (notReady && !put) continue;                     // 이 발표분은 아직 안 나옴 → 한 칸 앞
    used = tmfc; break;
  }
  if (lastErr && !done) await deps.store.vsrtFail(lastErr);
  return json(200, { ok: !lastErr || done, done, tmfc: used && kstMinute(used), hours: put, waiting: !used, error: done ? undefined : lastErr || undefined });
}

// 2단계 조사 전용: 지정한 단기 발표/발효 시각 한 건을 조회. DB 계획·저장·실패 기록을 부르지 않음.
async function probeAt(body, deps, key) {
  const v = String(body.probe || '').toUpperCase(), q = body.probeAt;
  const stamp = (s) => {
    if (typeof s !== 'string' || !/^20\d{8}$/.test(s)) return null;
    const ms = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10)) - 9 * 3600e3;
    return Number.isFinite(ms) && kstHour(new Date(ms).toISOString()) === s ? ms : null;
  };
  if (!q || typeof q !== 'object' || body.vsrt || !PROBE_VARS.includes(v)) return json(400, { ok: false, error: 'bad_probe_time' });
  const fc = stamp(q.tmfc), ef = stamp(q.tmef);
  if (fc === null || ef === null || ![2, 5, 8, 11, 14, 17, 20, 23].includes(+q.tmfc.slice(8)) || ef <= fc || ef - fc > 120 * 3600e3) return json(400, { ok: false, error: 'bad_probe_time' });
  if (!key) return json(200, { ok: false, error: 'no_key' });
  const started = deps.now();
  const r = await deps.fetchText(`${GRID_URL}?tmfc=${q.tmfc}&tmef=${q.tmef}&vars=${v}&authKey=${encodeURIComponent(key)}`);
  const stats = r.status === 200 ? gridStats(r.text) : null;
  return json(200, { ok: r.status === 200 && !!(stats && stats.ok), probe: v, tmfc: q.tmfc, tmef: q.tmef, status: r.status,
    response_bytes: new TextEncoder().encode(String(r.text || '')).byteLength, elapsed_ms: deps.now() - started,
    all_zero: allZero(stats), stats });
}

// 실제 기상청 요청만 한국 날짜별로 계측. 조사 호출과 DB 계획 조회는 제외.
async function withUsage(deps, vsrt, work, key) {
  const days = new Map(), seen = new Set();
  const measured = { ...deps, async fetchText(url) {
    const day = new Date(deps.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const u = days.get(day) || { calls: 0, bytes: 0, retries: 0 };
    u.calls++; if (seen.has(url)) u.retries++; seen.add(url); days.set(day, u);
    const r = await deps.fetchText(url); u.bytes += new TextEncoder().encode(String(r.text || '')).byteLength; return r;
  } };
  let response, saved = true;
  try { response = await work(measured); }
  catch (e) {                                          // 81: 원래 오류를 수집 실패에 남김(키는 가림)
    const note = ('수집 중 오류: ' + String((e && e.message) || e)).split(key).join('***').split(encodeURIComponent(key)).join('***').slice(0, 300);
    try { await deps.store[vsrt ? 'vsrtFail' : 'fail'](note); } catch { /* 기록 실패는 응답에만 */ }
    response = json(500, { ok: false, error: 'exception', note });
  }
  finally {
    for (const [day, u] of days) {
      try { if (!deps.store.usage || await deps.store.usage(day, vsrt, u.calls, u.bytes, u.retries) !== true) saved = false; }
      catch { saved = false; } // 계측 실패가 이미 저장한 예보를 실패로 바꾸지 않음
    }
  }
  const usage = [...days.values()].reduce((a, u) => ({ calls: a.calls + u.calls, bytes: a.bytes + u.bytes, retries: a.retries + u.retries }), { calls: 0, bytes: 0, retries: 0 });
  return json(response.status, { ...await response.json(), usage, usage_saved: saved });
}

export async function handle(req, deps) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method' });
  if (!(await allowed(req, deps))) return json(401, { ok: false, error: 'unauthorized' });
  const key = String(deps.env('KMA_AUTH_KEY') || '').trim();
  let body = {}; try { body = (await req.json()) || {}; } catch (e) { body = {}; }
  if (Object.prototype.hasOwnProperty.call(body, 'probeAt')) return probeAt(body, deps, key);
  if (!key) { await deps.store.fail('KMA_AUTH_KEY 비밀값이 없음'); return json(200, { ok: false, error: 'no_key' }); }
  if (body.vsrt) return body.probe ? probeVsrt(body, deps, key) : withUsage(deps, true, (d) => collectVsrt(d, key), key);
  if (body.probe) {                                   // 시험 호출: 한 시각만 받아 요약만(저장 안 함)
    const v = String(body.probe).toUpperCase();
    if (!PROBE_VARS.includes(v)) return json(400, { ok: false, error: 'bad_probe' });
    const { data: pl } = await deps.store.plan();
    if (!pl || !pl.tmfc) return json(500, { ok: false, error: 'db' });
    const ef = new Date(Date.parse(pl.tmfc) + 6 * 3600e3).toISOString();
    const r = await deps.fetchText(`${GRID_URL}?tmfc=${kstHour(pl.tmfc)}&tmef=${kstHour(ef)}&vars=${v}&authKey=${encodeURIComponent(key)}`);
    const stats = r.status === 200 ? gridStats(r.text) : null;
    const head = stats && stats.ok ? undefined : String(r.text || '').slice(0, 160).split(key).join('***');      // 격자가 아니면 기상청 안내문 앞부분(키는 가림)
    return json(200, { ok: r.status === 200 && !!(stats && stats.ok), probe: v, status: r.status, tmfc: kstHour(pl.tmfc), tmef: kstHour(ef), stats, head });
  }

  return withUsage(deps, false, (d) => collectShort(d, key), key);
}

async function collectShort(deps, key) {
  const { data: plan, error } = await deps.store.plan();
  if (error || !plan) return json(500, { ok: false, error: 'db' });
  if (plan.done) return json(200, { ok: true, done: true, tmfc: plan.tmfc });
  if (!plan.cells || !plan.cells.length) return json(200, { ok: false, error: 'no_cells' });

  const t0 = deps.now(), tmfc = kstHour(plan.tmfc), skipped = new Set();
  let put = 0, resolved = 0, lastErr = null, done = false;
  for (const [v, tmef] of plan.missing) {
    if (skipped.has(Date.parse(tmef))) continue;
    if (deps.now() - t0 > BUDGET_MS) { lastErr = lastErr || '시간이 모자라 다음 예약 때 이어서'; break; }
    const url = `${GRID_URL}?tmfc=${tmfc}&tmef=${kstHour(tmef)}&vars=${v}&authKey=${encodeURIComponent(key)}`;
    let vals = null, status = 0, empty = false;
    for (let i = 0; i < TRIES && !vals; i++) {
      if (deps.now() - t0 > BUDGET_MS) { status = 'budget'; break; }
      if (i) await deps.sleep(RETRY_MS);
      const r = await deps.fetchText(url); status = r.status;
      vals = r.status === 200 ? pickCells(r.text, plan.cells) : null;
      if (vals && plan.extended && v === 'TMP') empty = allZero(gridStats(r.text));
      if (r.status === 200 && !vals) { status = 'format'; break; }        // 형식이 다르면(키 오류 안내문 등) 다시 해도 같음
    }
    if (!vals) { lastErr = status === 'budget' ? '시간이 모자라 다음 예약 때 이어서' : status === 'format' ? '기상청 격자 형식이 다름(키·주소 확인)' : `기상청 응답 ${status || '연결 실패'} (${v} ${kstHour(tmef)})`; break; }
    const { data: res, error: e2 } = empty ? await deps.store.skip(plan.tmfc, tmef) : await deps.store.put(plan.tmfc, v, tmef, vals);
    if (empty && !e2) skipped.add(Date.parse(tmef));
    if (e2) { lastErr = 'DB 저장 실패'; break; }
    resolved += empty ? plan.missing.filter(([, h]) => Date.parse(h) === Date.parse(tmef)).length : 1;
    put++; done = !!(res && res.done);
    if (done) break;
    await deps.sleep(GAP_MS);
  }
  if (lastErr && !done) await deps.store.fail(lastErr);
  return json(200, { ok: !lastErr || done, done, tmfc, hours: put, missing: plan.missing.length - resolved, error: done ? undefined : lastErr || undefined });
}
