// 일별 예보 준비용 읽기 전용 점검. 기존 수집 토큰만 허용하며 DB에는 쓰지 않는다.
// 임의 URL/인증키/과거기간은 받지 않는다. zones 모드의구역코드/페이지는검증후허용한다.
import { gridStats, pickCells } from '../collect-forecast/core.mjs';

const BASE = 'https://apihub.kma.go.kr/api/typ01/';
const KINDS = ['regions', 'land', 'temperature', 'SKY', 'TMN', 'TMX', 'zones', 'shortland', 'shortland2', 'vilage', 'ultra', 'vilage_batch'];
// 2026-11-19 사용자 '시험해봐': 칸 하나씩 받는 단기·초단기 조회서비스가 신적설·강수를 소수로 주는지 보는 읽기 점검(저장 없음)
const POINT_VARS = new Set(['SNO', 'PCP', 'RN1', 'PTY', 'TMP', 'T1H']);
// 2026-11-19 사용자 '적용해': 한 칸을 한 번에 다 받을 수 있는지(rows·totalCount), 최신 발표가 언제 나오는지(lag), 여러 칸 동시 호출 시간·오류(vilage_batch)
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const SAMPLE_CELLS = [[60,127],[89,130],[56,67],[80,83],[65,72]];
const SAMPLE_REGIONS = new Set(['11B10101','11D20201','21F20802','11H20503','11F20405','11F20603']);
const reply = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

// 생산 직후의 미제공 자료를 피한다. 중기 06/18시, 단기 02/05/08/11/14/17/20/23시.
export function issue(now, mid = true) {
  const d = new Date(now - 90 * 60000 + 9 * 3600e3);
  const hours = mid ? [6, 18] : [2, 5, 8, 11, 14, 17, 20, 23];
  let h = hours.filter(h => h <= d.getUTCHours()).at(-1);
  if (h === undefined) { d.setUTCDate(d.getUTCDate() - 1); h = hours.at(-1); }
  d.setUTCHours(h, 0, 0, 0);
  return d.toISOString().replace(/[-T:]/g, '').slice(0, 10);
}

export function requestFor(kind, now, query = {}) {
  if (!KINDS.includes(kind)) return null;
  if (kind === 'shortland' || kind === 'shortland2') return {
    path: 'url/' + (kind === 'shortland' ? 'fct_afs_dl.php' : 'fct_afs_dl2.php'),
    params: { reg: '', disp: '1', help: '1' }, // 두 발표시각 생략은 공식 명세의 최신 자료 조회.
  };
  if (kind === 'vilage' || kind === 'ultra') {
    const { nx, ny } = query, rows = query.rows ?? 1000, lag = query.lag ?? 90;
    if (!isInt(nx, 1, 149) || !isInt(ny, 1, 253) || !isInt(rows, 10, 2000) || !isInt(lag, 10, 180)) return null;
    let base_date, base_time;
    if (kind === 'vilage') { const t = issue(now + (90 - lag) * 60000, false); base_date = t.slice(0, 8); base_time = t.slice(8, 10) + '00'; }
    else {   // 초단기예보는 매시 30분 발표, 약 45분 뒤 제공
      const d = new Date(Math.floor((now - 45 * 60000) / 3600e3) * 3600e3 + 9 * 3600e3);
      const iso = d.toISOString().replace(/[-T:]/g, ''); base_date = iso.slice(0, 8); base_time = iso.slice(8, 10) + '30';
    }
    return { url: 'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/' + (kind === 'vilage' ? 'getVilageFcst' : 'getUltraSrtFcst'),
      params: { pageNo: '1', numOfRows: String(rows), dataType: 'JSON', base_date, base_time, nx: String(nx), ny: String(ny) } };
  }
  if (kind === 'vilage_batch') {
    const { cells } = query, rows = query.rows ?? 1500, lag = query.lag ?? 90, par = query.par ?? 5;
    if (!Array.isArray(cells) || cells.length < 1 || cells.length > 40 || !isInt(par, 1, 8)) return null;
    const specs = cells.map(c => Array.isArray(c) && c.length === 2 ? requestFor('vilage', now, { nx: c[0], ny: c[1], rows, lag }) : null);
    if (specs.some(x => !x)) return null;
    return { batch: specs, par, params: { cells: cells.length, rows: String(rows), par: String(par), base_time: specs[0].params.base_date + specs[0].params.base_time } };
  }
  if (kind === 'zones') {
    const page = query.page ?? 1, regId = query.regId ?? '';
    if (!Number.isInteger(page) || page < 1 || page > 20 || typeof regId !== 'string' || (regId !== '' && !/^[0-9A-Z]{8}$/.test(regId))) return null;
    return { url: 'https://apihub.kma.go.kr/api/typ02/openApi/FcstZoneInfoService/getFcstZoneCd',
      params: { pageNo: String(page), numOfRows: '1000', dataType: 'JSON', regId } };
  }
  if (kind === 'regions') return { path: 'url/fct_medm_reg.php', params: { tmfc: '0' } };
  if (kind === 'land' || kind === 'temperature') return {
    path: 'url/' + (kind === 'land' ? 'fct_afs_wl.php' : 'fct_afs_wc.php'),
    params: { reg: '', tmfc1: issue(now), tmfc2: issue(now), disp: '1', help: '1' },
  };
  const tmfc = issue(now, false), date = tmfc.slice(0, 8);
  const next = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8) + 1));
  const day = next.toISOString().slice(0, 10).replace(/-/g, '');
  return { path: 'cgi-bin/url/nph-dfs_shrt_grd', params: {
    tmfc, tmef: day + (kind === 'TMN' ? '06' : kind === 'TMX' ? '15' : '12'), vars: kind,
  } };
}

// 칸 조회 응답 요약: 전체 줄 수, 이번에 받은 줄 수, 마지막 예보 시각, 종류별 줄 수(저장 안 함)
export function pointSummary(response, rows) {
  const cats = {};
  let last = '';
  for (const a of rows) { const c = String(a.category).slice(0, 4); cats[c] = (cats[c] || 0) + 1; const t = String(a.fcstDate || '') + String(a.fcstTime || ''); if (t > last) last = t; }
  return { totalCount: Number(response?.body?.totalCount), got: rows.length, last: last.slice(0, 12), cats };
}

// 여러 칸 동시 호출 시험: 칸마다 상태·시간·줄 수만(값은 돌려주지 않음)
async function pointBatch(spec, key, deps) {
  const out = new Array(spec.batch.length); let next = 0; const t0 = deps.now();
  const formKey = new URLSearchParams({ authKey: key }).toString().slice('authKey='.length);
  async function one(i) {
    const s = spec.batch[i], url = new URL(s.url);
    for (const [k, v] of Object.entries(s.params)) url.searchParams.set(k, v);
    url.searchParams.set('authKey', key);
    const a = deps.now();
    try {
      const r = await deps.fetchText(url.href), ms = deps.now() - a;
      let res = { nx: +s.params.nx, ny: +s.params.ny, status: r.status, ms, bytes: r.bytes };
      try {
        const response = JSON.parse(String(r.text || '')).response, code = String(response?.header?.resultCode);
        const raw = response?.body?.items?.item || [], rows = Array.isArray(raw) ? raw : [raw];
        res.code = code; if (['00', '0'].includes(code)) Object.assign(res, pointSummary(response, rows)); delete res.cats;
      } catch { res.code = 'not_json'; res.head = String(r.text || '').split(key).join('[redacted]').split(encodeURIComponent(key)).join('[redacted]').split(formKey).join('[redacted]').slice(0, 120); }
      out[i] = res;
    } catch { out[i] = { nx: +s.params.nx, ny: +s.params.ny, error: 'upstream_unavailable', ms: deps.now() - a }; }
  }
  async function worker() { while (next < spec.batch.length) { const i = next++; await one(i); } }
  await Promise.all(Array.from({ length: spec.par }, worker));
  const ok = out.filter(x => x && ['00', '0'].includes(x.code)).length;
  return { ok: ok === out.length, kind: 'vilage_batch', params: spec.params, total_ms: deps.now() - t0, ok_cells: ok, results: out };
}

export async function handle(req, deps) {
  if (req.method !== 'POST') return reply(405, { ok: false, error: 'post_required' });
  const token = req.headers.get('x-collector-token');
  try {
    if (!token || !(await deps.tokenOk(token))) return reply(401, { ok: false, error: 'unauthorized' });
  } catch { return reply(503, { ok: false, error: 'auth_unavailable' }); }
  let body;
  try {
    const text = await req.text();
    if (text.length > 1000) return reply(400, { ok: false, error: 'bad_request' });
    body = JSON.parse(text);
  } catch { return reply(400, { ok: false, error: 'bad_json' }); }
  const kind = body?.kind, spec = requestFor(kind, deps.now(), body || {});
  const allowed = kind === 'zones' ? ['kind', 'page', 'regId'] : (kind === 'vilage' || kind === 'ultra') ? ['kind', 'nx', 'ny', 'rows', 'lag']
    : kind === 'vilage_batch' ? ['kind', 'cells', 'rows', 'lag', 'par'] : ['kind'];
  if (!spec || Object.keys(body).some(k => !allowed.includes(k))) return reply(400, { ok: false, error: 'bad_request' });
  const key = String(deps.env('KMA_AUTH_KEY') || '').trim();
  if (!key) return reply(503, { ok: false, error: 'missing_kma_key' });
  if (kind === 'vilage_batch') return reply(200, await pointBatch(spec, key, deps));
  const url = new URL(spec.url || BASE + spec.path);
  for (const [k, v] of Object.entries(spec.params)) url.searchParams.set(k, v);
  url.searchParams.set('authKey', key);
  let r; const t0 = deps.now();
  try { r = await deps.fetchText(url.href); }
  catch { return reply(502, { ok: false, kind, error: 'upstream_unavailable' }); }
  const elapsed = deps.now() - t0;
  // 기상청 오류가 요청 주소를 반사해도 키를 반환하지 않는다. 원본 오류/주소는 로그에도 쓰지 않는다.
  const formKey = new URLSearchParams({ authKey: key }).toString().slice('authKey='.length);
  const text = String(r.text || '').split(key).join('[redacted]').split(encodeURIComponent(key)).join('[redacted]').split(formKey).join('[redacted]');
  const out = { ok: r.status === 200, kind, status: r.status, params: spec.params, bytes: r.bytes };
  if (kind === 'zones') {
    try {
      const response = JSON.parse(text).response, result = response?.header?.resultCode;
      const data = response?.body;
      if (!['00', '0'].includes(String(result)) || !data) throw new Error('zone_api_error');
      const raw = data.items?.item || [], rows = Array.isArray(raw) ? raw : [raw];
      if (rows.length > 1000) throw new Error('too_many_zones');
      const coord = (n, limit) => { const v = Number(n); return Number.isFinite(v) && v !== 0 && Math.abs(v) <= limit ? v : null; };
      out.items = rows.map(a => {
        const id = String(a.regId || '').trim();
        if (!/^[0-9A-Z]{8}$/.test(id)) throw new Error('bad_zone_id');
        return { regId: id, regName: String(a.regName || '').slice(0, 120), regSp: String(a.regSp ?? '').slice(0, 10),
          regUp: String(a.regUp || '').slice(0, 8), lat: coord(a.lat, 90), lon: coord(a.lon, 180),
          tmSt: String(a.tmSt || '').slice(0, 24), tmEd: String(a.tmEd || '').slice(0, 24) };
      });
      out.totalCount = Number(data.totalCount); out.rows = out.items.length;
      if (!Number.isInteger(out.totalCount) || out.totalCount < out.rows) throw new Error('bad_zone_count');
      out.ok = out.ok && out.rows > 0;
    } catch {
      out.ok = false; delete out.items;
      out.error = 'zone_api_error'; out.text = text.slice(0, 400);
    }
  } else if (kind === 'vilage' || kind === 'ultra') {
    try {
      const response = JSON.parse(text).response, result = response?.header?.resultCode;
      if (!['00', '0'].includes(String(result))) throw new Error('point_api_error');
      const raw = response?.body?.items?.item || [], rows = Array.isArray(raw) ? raw : [raw];
      Object.assign(out, pointSummary(response, rows), { elapsed_ms: elapsed });
      out.items = rows.filter(a => POINT_VARS.has(String(a.category))).slice(0, 600).map(a => ({
        c: String(a.category).slice(0, 4), d: String(a.fcstDate || '').slice(0, 8), t: String(a.fcstTime || '').slice(0, 4), v: String(a.fcstValue ?? '').slice(0, 30) }));
      out.distinct = {};
      for (const a of out.items) (out.distinct[a.c] ??= new Set()).add(a.v);
      for (const c of Object.keys(out.distinct)) out.distinct[c] = [...out.distinct[c]].slice(0, 40);
      out.ok = out.ok && out.items.length > 0;
    } catch {
      out.ok = false; delete out.items; delete out.distinct;
      out.error = 'point_api_error'; out.text = text.slice(0, 400);
    }
  } else if (['SKY', 'TMN', 'TMX'].includes(kind)) {
    out.stats = gridStats(text);
    out.ok = out.ok && out.stats?.ok === true;
    if (out.ok) {
      const vals = pickCells(text, SAMPLE_CELLS);
      out.samples = SAMPLE_CELLS.map(([nx,ny],i) => ({ nx, ny, value: vals[i] > -90 ? vals[i] : null }));
    }
    if (!out.ok) out.text = text.slice(0, 800);
  } else {
    out.text = text.slice(0, 80000);
    out.truncated = text.length > 80000;
    out.rows = text.split(/\r?\n/).filter(s => s.trim() && !s.trim().startsWith('#')).length;
    out.ok = out.ok && out.rows > 0 && !/<html|<error|API\s*key|인증키|ERROR_MESSAGE/i.test(text);
    if (kind === 'shortland' || kind === 'shortland2') {
      // 원본이 보호 한도를 넘어도 분석 표본은 원본 전체에서 고른다. 저장용 자료로 쓰지 않는다.
      out.sampleRows = text.split(/\r?\n/).filter(s => SAMPLE_REGIONS.has(s.trim().split(/[,\s]+/,1)[0])).slice(0,60);
      out.tail = text.slice(-300);
    }
  }
  return reply(200, out);
}
