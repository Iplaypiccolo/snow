/* 예상 적설 받기 함수(supabase/functions/collect-forecast/core.mjs) 자동 테스트 — 격자 글에서 지사 격자 고르기, 가짜 DB 로 받기 흐름·다시 받기·시간 제한
   실행: node tests/test_collect_forecast.mjs   (저장소 맨 위 폴더에서) */
import assert from 'node:assert/strict';
import { pickCells, kstHour, kstMinute, handle, NX, NY, GRID_URL, VSRT_URL, gridStats } from '../supabase/functions/collect-forecast/core.mjs';

const results = [];
async function test(name, fn) { try { await fn(); results.push([name, true]); } catch (e) { results.push([name, false, String(e.message).split('\n')[0]]); } }

// 격자 글: 값 = ny*1000 + nx 로 만들면 고른 값이 맞는지 바로 보임(-99 = 바다)
const grid = (f) => { const rows = []; for (let ny = 1; ny <= NY; ny++) { const r = []; for (let nx = 1; nx <= NX; nx++) r.push(f(nx, ny).toFixed(2).padStart(8)); rows.push(r.join(',') + ','); } return rows.join('\n') + '\n'; };
const G = grid((nx, ny) => ny * 1000 + nx);

await test('한국 시각 시(YYYYMMDDHH)', () => {
  assert.equal(kstHour('2026-10-04T23:00:00Z'), '2026100508'); assert.equal(kstHour('2026-10-05T08:00:00+09:00'), '2026100508');
});
await test('격자 고르기: 첫 줄 = 남쪽(ny=1), 줄마다 149칸', () => {
  assert.deepEqual(pickCells(G, [[1, 1], [149, 1], [60, 127], [149, 253]]), [1001, 1149, 127060, 253149]);
});
await test('격자 고르기: 개수가 다르거나 글이 아니면 null', () => {
  assert.equal(pickCells('{"error":"key"}', [[1, 1]]), null); assert.equal(pickCells(null, [[1, 1]]), null); assert.equal(pickCells(G.replace(/,\s*$/, ''), [[1, 1]]) === null, false);
});

function world(o = {}) {
  const hours = Array.from({ length: 24 }, (_, i) => new Date(Date.UTC(2026, 9, 5, 2 + i)).toISOString());
  const w = { key: 'K'.repeat(22), token: 'tok', fetched: [], puts: [], fails: [], clock: 0, slept: 0,
    plan: { done: false, tmfc: '2026-10-04T23:00:00+00:00', start_at: hours[0], cells: [[60, 127], [92, 131]], missing: hours.flatMap((h) => [['SNO', h], ['PCP', h]]) },
    resp: () => ({ status: 200, text: G }), ...o };
  w.deps = {
    now: () => w.clock, sleep: async (ms) => { w.slept += ms; w.clock += ms; }, env: (k) => (k === 'KMA_AUTH_KEY' ? w.key : ''),
    async fetchText(u) { w.fetched.push(u); w.clock += 300; return w.resp(u, w.fetched.length); },
    auth: { async getUser() { return { id: null }; } },
    store: {
      async tokenOk(t) { return t === w.token; }, async getProfileById() { return null; },
      async plan() { return { data: w.plan, error: null }; },
      async put(tmfc, v, tmef, vals) { w.puts.push([tmfc, tmef, vals, v]); return { data: { ok: true, done: w.puts.length === 48 }, error: null }; },
      async fail(n) { w.fails.push(n); },
    },
  };
  return w;
}
const call = async (w, h = { token: 'tok' }, body = '{}') => { const r = await handle(new Request('https://x/f', { method: 'POST', headers: h.token ? { 'x-collector-token': h.token } : {}, body }), w.deps); return { status: r.status, j: await r.json() }; };

// 초단기예보: 후보 3개, 격자 2칸, 18개 받기
function vworld(o = {}) {
  const cand = ['2026-11-03T00:20:00+00:00', '2026-11-03T00:10:00+00:00', '2026-11-03T00:00:00+00:00'];
  const hrs = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(2026, 10, 3, 1 + i)).toISOString());
  const w = world(); w.begun = []; w.vputs = []; w.vfails = []; w.vplan = { candidates: cand }; w.vdone = 18;
  Object.assign(w.deps.store, {
    async vsrtPlan() { return { data: w.vplan, error: null }; },
    async vsrtBegin(t) { w.begun.push(t); return { data: { tmfc: t, cells: [[60, 127], [92, 131]], missing: hrs.flatMap((h) => ['T1H', 'RN1', 'POP'].map((v) => [v, h])) }, error: null }; },
    async vsrtPut(t, v, h, vals) { w.vputs.push([t, v, h, vals]); return { data: { ok: true, done: w.vputs.length === w.vdone }, error: null }; },
    async vsrtFail(n) { w.vfails.push(n); },
  });
  Object.assign(w, o);
  return w;
}
const NOT_READY = { status: 200, text: '# dfs_file_read error (-1) \n' };
await test('초단기: 분까지 적은 발표 시각, 발표 다음 정시부터 6시각 × 3종류 = 18번, 지사 격자만', async () => {
  assert.equal(kstMinute('2026-11-03T00:20:00+00:00'), '202611030920');
  const w = vworld(); const r = await call(w, { token: 'tok' }, '{"vsrt":true}');
  assert.equal(w.fetched.length, 18); assert.equal(w.vputs.length, 18); assert.equal(r.j.done, true); assert.equal(r.j.tmfc, '202611030920');
  assert.ok(w.fetched[0].startsWith(VSRT_URL + '?tmfc=202611030920&tmef=2026110310&vars=T1H&authKey=')); assert.ok(w.fetched[17].includes('&tmef=2026110315&vars=POP&'));
  assert.deepEqual(w.vputs[0][3], [127060, 131092]); assert.equal(w.puts.length, 0); assert.ok(!JSON.stringify(r.j).includes(w.key));
});
await test('초단기(89): 첫 1개는 혼자, 그다음은 3개씩 동시에 받고 저장은 목록 차례대로', async () => {
  const w = vworld(); let live = 0, peak = 0; const starts = [];
  w.deps.fetchText = async (u) => { w.fetched.push(u); live++; peak = Math.max(peak, live); starts.push(live); await new Promise((r) => setTimeout(r, 3)); live--; return { status: 200, text: G }; };
  const r = await call(w, { token: 'tok' }, '{"vsrt":true}');
  assert.equal(r.j.done, true); assert.equal(w.fetched.length, 18); assert.equal(peak, 3); assert.equal(starts[0], 1); assert.deepEqual(starts.slice(1, 4), [1, 2, 3]);
  const want = w.fetched.map((u) => u.match(/tmef=(\d+)&vars=(\w+)/).slice(1).reverse().join(' '));
  assert.deepEqual(w.vputs.map((x) => x[1] + ' ' + kstHour(x[2])), want);
});
await test('초단기(89): 같이 받은 것 중 하나가 끝내 실패하면 그 앞까지만 저장하고 실패 기록', async () => {
  const w = vworld(); w.resp = (u) => (u.includes('tmef=2026110310&vars=POP') ? { status: 504, text: '' } : { status: 200, text: G });
  const r = await call(w, { token: 'tok' }, '{"vsrt":true}');
  assert.equal(w.vputs.length, 2); assert.ok(w.vfails[0].includes('504')); assert.equal(r.j.ok, false); assert.equal(r.j.hours, 2);
});
await test('초단기: 아직 안 나온 발표분은 실패가 아니라 한 칸 앞 발표분을 받음', async () => {
  const w = vworld(); w.resp = (u) => (u.includes('tmfc=202611030920') ? NOT_READY : { status: 200, text: G });
  const r = await call(w, { token: 'tok' }, '{"vsrt":true}');
  assert.deepEqual(w.begun, ['2026-11-03T00:20:00+00:00', '2026-11-03T00:10:00+00:00']); assert.equal(w.fetched.length, 19); assert.equal(r.j.tmfc, '202611030910');
  assert.equal(w.vfails.length, 0); assert.equal(r.j.ok, true);
});
await test('초단기(81): 서버가 미완성 발표분이라 하면 그 발표분을 버리고 한 칸 앞, 실패 기록 없음', async () => {
  const w = vworld(); w.deps.store.vsrtPut = async (t, v, h, vals) => { w.vputs.push([t, v, h, vals]); return { data: t.includes('00:20') ? { ok: true, incomplete: true } : { ok: true, done: w.vputs.filter((x) => !x[0].includes('00:20')).length === 18 }, error: null }; };
  const r = await call(w, { token: 'tok' }, '{"vsrt":true}');
  assert.deepEqual(w.begun, ['2026-11-03T00:20:00+00:00', '2026-11-03T00:10:00+00:00']); assert.equal(w.fetched.length, 19); assert.equal(r.j.tmfc, '202611030910');
  assert.equal(r.j.done, true); assert.equal(r.j.hours, 18); assert.equal(w.vfails.length, 0); assert.equal(r.j.ok, true);
});
await test('초단기(81): 후보가 모두 미완성이면 조용히 끝(다음 예약 때 다시)', async () => {
  const w = vworld(); w.deps.store.vsrtPut = async (t, v, h, vals) => { w.vputs.push([t, v, h, vals]); return { data: { ok: true, incomplete: true }, error: null }; };
  const r = await call(w, { token: 'tok' }, '{"vsrt":true}');
  assert.equal(w.fetched.length, 3); assert.equal(w.vfails.length, 0); assert.equal(r.j.waiting, true); assert.equal(r.j.ok, true);
});
await test('초단기: 후보가 모두 안 나왔으면 조용히 끝(다음 예약 때)', async () => {
  const w = vworld(); w.resp = () => NOT_READY; const r = await call(w, { token: 'tok' }, '{"vsrt":true}');
  assert.equal(w.fetched.length, 3); assert.equal(w.vputs.length, 0); assert.equal(w.vfails.length, 0); assert.equal(r.j.ok, true); assert.equal(r.j.waiting, true);
});
await test('초단기: 받을 발표분이 없으면 기상청을 부르지 않음', async () => {
  const w = vworld(); w.vplan = { candidates: [] }; const r = await call(w, { token: 'tok' }, '{"vsrt":true}');
  assert.equal(w.fetched.length, 0); assert.equal(r.j.ok, true);
});
await test('초단기: 504 는 다시 시도, 끝내 안 되면 초단기 실패로만 기록', async () => {
  const w = vworld(); w.resp = () => ({ status: 504, text: '' }); const r = await call(w, { token: 'tok' }, '{"vsrt":true}');
  assert.equal(w.fetched.length, 4); assert.ok(w.vfails[0].includes('504')); assert.equal(w.fails.length, 0); assert.equal(r.j.ok, false);
});
await test('초단기: 권한 없으면 401, 인증키 오류 안내문은 형식 오류(키 노출 없음)', async () => {
  const w = vworld(); assert.equal((await call(w, {}, '{"vsrt":true}')).status, 401); assert.equal(w.fetched.length, 0);
  w.resp = () => ({ status: 200, text: '인증키 오류' }); await call(w, { token: 'tok' }, '{"vsrt":true}');
  assert.equal(w.fetched.length, 1); assert.ok(w.vfails[0].includes('형식')); assert.ok(!w.vfails[0].includes(w.key));
});
await test('초단기 시험 호출: 저장 없이 요약만, 다른 종류는 거절', async () => {
  const w = vworld(); const r = await call(w, { token: 'tok' }, '{"vsrt":true,"probe":"T1H"}');
  assert.equal(r.j.probe, 'T1H'); assert.equal(w.fetched.length, 1); assert.ok(w.fetched[0].startsWith(VSRT_URL)); assert.equal(w.vputs.length, 0); assert.equal(w.begun.length, 0);
  assert.equal((await call(w, { token: 'tok' }, '{"vsrt":true,"probe":"SNO"}')).status, 400);
  assert.equal((await call(w, { token: 'tok' }, '{"vsrt":true,"probe":"REH"}')).j.probe, 'REH');      // 89: 습도도 받아 볼 수 있음
});

await test('권한: 토큰 없으면 401(기상청에 묻지 않음)', async () => {
  const w = world(); assert.equal((await call(w, {})).status, 401); assert.equal((await call(w, { token: 'x' })).status, 401); assert.equal(w.fetched.length, 0);
});
await test('정상: 적설·강수 24시각씩 48번 받아 지사 격자만 넣고 끝(발표·예보 시각은 한국 시각, 키는 주소에만)', async () => {
  const w = world(); const r = await call(w);
  assert.equal(w.fetched.length, 48); assert.equal(w.puts.length, 48); assert.equal(r.j.done, true);
  assert.ok(w.fetched[0].startsWith(GRID_URL + '?tmfc=2026100508&tmef=2026100511&vars=SNO&authKey=')); assert.ok(w.fetched[1].includes('&tmef=2026100511&vars=PCP&')); assert.equal(w.puts[1][3], 'PCP');
  assert.deepEqual(w.puts[0][2], [127060, 131092]); assert.ok(!JSON.stringify(r.j).includes(w.key)); assert.equal(w.fails.length, 0);
});
await test('504 는 2초 뒤 다시(최대 4번), 그래도 안 되면 멈추고 실패 기록(다음 예약 때 이어서)', async () => {
  const w = world({ resp: (u, n) => (n % 2 ? { status: 504, text: '' } : { status: 200, text: G }) });
  await call(w); assert.ok(w.puts.length >= 24); assert.equal(w.fetched.length, w.puts.length * 2);
  const w2 = world({ resp: () => ({ status: 504, text: '' }) }); const r2 = await call(w2);
  assert.equal(w2.fetched.length, 4); assert.equal(w2.puts.length, 0); assert.ok(w2.fails[0].includes('504')); assert.equal(r2.j.ok, false);
});
await test('형식이 다르면(키 오류 안내문 등) 다시 하지 않고 실패 기록', async () => {
  const w = world({ resp: () => ({ status: 200, text: '인증키 오류' }) }); await call(w);
  assert.equal(w.fetched.length, 1); assert.ok(w.fails[0].includes('형식')); assert.ok(!w.fails[0].includes(w.key));
});
await test('120초가 넘으면 멈추고 나머지는 다음 예약 때', async () => {
  const w = world(); w.deps.sleep = async (ms) => { w.clock += 10000; }; const r = await call(w);
  assert.ok(w.puts.length < 24 && w.puts.length > 0); assert.ok(r.j.missing > 0); assert.ok(w.fails[0].includes('다음 예약'));
});
await test('이미 다 받은 발표분이면 아무것도 받지 않음, 키 없으면 실패 기록', async () => {
  const w = world({ plan: { done: true, tmfc: 'x' } }); const r = await call(w); assert.equal(r.j.done, true); assert.equal(w.fetched.length, 0);
  const w2 = world({ key: '' }); await call(w2); assert.equal(w2.fetched.length, 0); assert.ok(w2.fails[0].includes('KMA_AUTH_KEY'));
});
await test('강수확률(POP)도 서버가 준 목록대로 받아 넣음(종류는 서버가 정함)', async () => {
  const w = world(); w.plan.missing = [['SNO', w.plan.start_at], ['POP', w.plan.start_at]];
  w.deps.store.put = async (tmfc, v, tmef, vals) => { w.puts.push([tmfc, tmef, vals, v]); return { data: { ok: true, done: w.puts.length === 2 }, error: null }; };
  const r = await call(w); assert.equal(r.j.done, true); assert.deepEqual(w.puts.map((x) => x[3]), ['SNO', 'POP']); assert.ok(w.fetched[1].includes('vars=POP'));
});
await test('시험 호출(probe): 한 시각만 받아 요약만 돌려주고 저장하지 않음, 모르는 종류는 거절, 권한은 같음', async () => {
  const w = world(); const r = await call(w, { token: 'tok' }, '{"probe":"pop"}');
  assert.equal(r.j.ok, true); assert.equal(r.j.probe, 'POP'); assert.equal(w.fetched.length, 1); assert.ok(w.fetched[0].includes('vars=POP') && w.fetched[0].includes('tmfc=2026100508') && w.fetched[0].includes('tmef=2026100514'));
  assert.equal(w.puts.length, 0); assert.equal(w.fails.length, 0); assert.equal(r.j.stats.n, NX * NY); assert.equal(r.j.stats.min, 1001); assert.equal(r.j.stats.max, 253149);
  assert.ok(!JSON.stringify(r.j).includes(w.key), '키가 응답에 없어야 함');
  assert.equal((await call(world(), { token: 'tok' }, '{"probe":"XYZ"}')).status, 400); assert.equal((await call(world(), {}, '{"probe":"POP"}')).status, 401);
  assert.equal(gridStats('1,2,3').ok, false); assert.equal(gridStats(null), null);
});

// 지정 시각 조사: 실제 저장 경로에 접근하지 않는지 가짜 의존성으로 확인.
{
const good = { probe: 'TMP', probeAt: { tmfc: '2026110423', tmef: '2026110800' } };
const zeros = Array(NX * NY).fill('0').join(',');
const snowy = Array(NX * NY).fill('2').join(',');
function world(options = {}) {
  const state = { calls: [], mutations: 0, clock: 0 };
  state.key = options.noKey ? '' : 'fixture_key';
  state.deps = {
    now: () => state.clock,
    env: () => state.key,
    auth: { getUser: async () => ({ id: 'fixture-user' }) },
    store: new Proxy({
      getProfileById: async () => ({ role: options.role || 'admin', disabled: false }),
      tokenOk: async () => true,
    }, { get(target, prop) { return target[prop] || (async () => { state.mutations++; throw new Error('DB plan/write forbidden for probeAt'); }); } }),
    fetchText: async url => { state.calls.push(url); state.clock += 250; return options.response || { status: 200, text: zeros }; },
  };
  return state;
}
async function call(w, body, authenticated = true) {
  const response = await handle(new Request('https://fixture/probe', { method: 'POST', headers: authenticated ? { authorization: 'Bearer fixture' } : {}, body: JSON.stringify(body) }), w.deps);
  return { status: response.status, data: await response.json() };
}

await test('먼 시각 한 건만 조회하고 DB 계획·쓰기 없음', async () => {
  const w = world(), r = await call(w, good);
  assert.equal(r.status, 200); assert.equal(r.data.ok, true); assert.equal(w.calls.length, 1); assert.equal(w.mutations, 0);
  const u = new URL(w.calls[0]); assert.equal(u.searchParams.get('tmfc'), good.probeAt.tmfc); assert.equal(u.searchParams.get('tmef'), good.probeAt.tmef);
  assert.equal(r.data.response_bytes, new TextEncoder().encode(zeros).byteLength); assert.equal(r.data.elapsed_ms, 250); assert.equal(r.data.all_zero, true);
});
await test('신적설도 동일한 지정 시각으로 조회, 요약에 인증키 없음', async () => {
  const w = world({ response: { status: 200, text: snowy } }), r = await call(w, { ...good, probe: 'SNO' });
  assert.equal(r.data.stats.max, 2); assert.equal(r.data.all_zero, false); assert.equal(w.calls.length, 1); assert.equal(w.mutations, 0); assert.ok(!JSON.stringify(r.data).includes(w.key));
});
await test('지정 시각 조사(81): 바다 칸 -99 섞인 0 격자도 all_zero', async () => {
  const a = Array(NX * NY).fill('0'); a[5] = '-99'; const w = world({ response: { status: 200, text: a.join(',') } }), r = await call(w, good);
  assert.equal(r.data.all_zero, true); assert.equal(w.mutations, 0);
});
await test('비관리자와 비로그인 조회 차단', async () => {
  for (const [w, auth] of [[world({ role: 'viewer' }), true], [world(), false]]) { assert.equal((await call(w, good, auth)).status, 401); assert.equal(w.calls.length, 0); }
});
for (const [name, body] of [
  ['불가능한 날짜', { ...good, probeAt: { tmfc: '2026023023', tmef: '2026030100' } }],
  ['발표 전 시각', { ...good, probeAt: { tmfc: '2026110423', tmef: '2026110422' } }],
  ['같은 시각', { ...good, probeAt: { tmfc: '2026110423', tmef: '2026110423' } }],
  ['120시간 초과', { ...good, probeAt: { tmfc: '2026110423', tmef: '2026111000' } }],
  ['발표 시각이 아닌 03시', { ...good, probeAt: { tmfc: '2026110403', tmef: '2026110404' } }],
  ['없는 변수', { ...good, probe: 'SECRET' }],
  ['초단기와 혼용', { ...good, vsrt: true }],
  ['probe 누락', { probeAt: good.probeAt }],
  ['null 시각', { ...good, probeAt: null }],
]) {
  await test(name + '은 실제 요청 전에 거절', async () => { const w = world(); assert.equal((await call(w, body)).status, 400); assert.equal(w.calls.length, 0); assert.equal(w.mutations, 0); });
}
await test('120시간 경계 허용', async () => {
  const w = world(), r = await call(w, { ...good, probeAt: { tmfc: '2026110423', tmef: '2026110923' } });
  assert.equal(r.data.ok, true); assert.equal(w.calls.length, 1);
});
await test('키가 없으면 DB 실패 기록도 남기지 않음', async () => {
  const w = world({ noKey: true }), r = await call(w, good);
  assert.equal(r.data.error, 'no_key'); assert.equal(w.calls.length, 0); assert.equal(w.mutations, 0);
});
await test('상위 서버 오류는 재시도·저장 없이 상태만 반환', async () => {
  const w = world({ response: { status: 503, text: 'fixture_key and upstream message' } }), r = await call(w, good);
  assert.equal(r.data.ok, false); assert.equal(r.data.status, 503); assert.equal(w.calls.length, 1); assert.equal(w.mutations, 0); assert.ok(!JSON.stringify(r.data).includes(w.key));
});
await test('격자 형식 오류도 원문·키를 반환하지 않음', async () => {
  const w = world({ response: { status: 200, text: 'fixture_key' } }), r = await call(w, good);
  assert.equal(r.data.ok, false); assert.equal(w.calls.length, 1); assert.equal(w.mutations, 0); assert.ok(!JSON.stringify(r.data).includes(w.key));
});
}

await test('확장: 전국 TMP가0이면5종을 건너뛰고 같은 시각을 더 요청하지 않음', async () => {
  const w = world(); const h = w.plan.start_at; w.plan.extended = true;
  w.plan.missing = ['TMP','SNO','PCP','POP','PTY'].map(v => [v,h]);
  w.resp = () => ({ status: 200, text: Array(NX*NY).fill('0').join(',') });
  const skipped=[]; w.deps.store.skip=async (t,h) => { skipped.push(h); return { data:{ok:true,done:false},error:null }; };
  const r=await call(w); assert.deepEqual(skipped,[h]);assert.equal(w.fetched.length,1);assert.equal(w.puts.length,0);assert.equal(r.j.missing,0);
});
await test('확장(81): 실제 격자처럼 바다 칸이 -99 이고 나머지가 모두 0 이어도 빈 시각', async () => {
  const w = world(); const h = w.plan.start_at; w.plan.extended = true;
  w.plan.missing = ['TMP','SNO','PCP','POP','PTY'].map(v => [v,h]);
  const a = Array(NX*NY).fill('0'); for (let i = 0; i < a.length; i += 3) a[i] = '-99.00'; w.resp = () => ({ status: 200, text: a.join(',') });
  const skipped=[]; w.deps.store.skip=async (t,h) => { skipped.push(h); return { data:{ok:true,done:false},error:null }; };
  const r=await call(w); assert.deepEqual(skipped,[h]);assert.equal(w.fetched.length,1);assert.equal(w.puts.length,0);assert.equal(r.j.missing,0);
});
await test('확장(81): 모든 칸이 결측(-99)이면 빈 시각이 아님(형식 이상은 값으로 두고 서버가 판단)', async () => {
  const w=world();w.plan.extended=true;w.plan.missing=[['TMP',w.plan.start_at]];w.resp=()=>({status:200,text:Array(NX*NY).fill('-99').join(',')});
  w.deps.store.skip=async()=>{throw Error('must not skip');};await call(w);assert.equal(w.puts.length,1);
});
await test('수집 중 예상 못 한 오류(81): 원래 오류를 실패로 기록하고 오류 응답, 키는 가림', async () => {
  const w=world();w.deps.store.plan=async()=>{throw Error('boom '+w.key);};const meters=[];w.deps.store.usage=async(...a)=>{meters.push(a);return true;};
  const r=await call(w);assert.equal(r.status,500);assert.equal(r.j.ok,false);assert.equal(r.j.error,'exception');
  assert.equal(w.fails.length,1);assert.ok(w.fails[0].includes('boom'));assert.ok(!w.fails[0].includes(w.key));assert.ok(!JSON.stringify(r.j).includes(w.key));
  const v=vworld();v.deps.store.vsrtPlan=async()=>{throw Error('vboom');};const rv=await call(v,{token:'tok'},'{"vsrt":true}');
  assert.equal(rv.status,500);assert.ok(v.vfails[0].includes('vboom'));assert.equal(v.fails.length,0);
});
await test('확장: 고른 지사만0이고 전국 다른 칸에 값이 있으면 빈 시각으로 보지 않음', async () => {
  const w=world();w.plan.extended=true;w.plan.missing=[['TMP',w.plan.start_at]];
  const a=Array(NX*NY).fill('0');a[0]='5';w.resp=()=>({status:200,text:a.join(',')});
  w.deps.store.skip=async()=>{throw Error('must not skip');};await call(w);assert.equal(w.puts.length,1);assert.deepEqual(w.puts[0][2],[0,0]);
});
await test('확장: SNO0은 정상적인 강설 없음, 빈 시각 판별은 TMP만 사용', async () => {
  const w=world();w.plan.extended=true;w.plan.missing=[['SNO',w.plan.start_at]];w.resp=()=>({status:200,text:Array(NX*NY).fill('0').join(',')});
  w.deps.store.skip=async()=>{throw Error('must not skip');};await call(w);assert.equal(w.puts.length,1);
});
await test('이전 서버 계획에서는 새 skip RPC를 부르지 않음', async () => {
  const w=world();w.plan.missing=[['TMP',w.plan.start_at]];w.resp=()=>({status:200,text:Array(NX*NY).fill('0').join(',')});
  w.deps.store.skip=async()=>{throw Error('legacy plan');};await call(w);assert.equal(w.puts.length,1);
});
await test('확장: 빈 시각 기록이 실패하면 수집 중단 후 다음 예약에 남김', async () => {
  const w=world();w.plan.extended=true;w.plan.missing=[['TMP',w.plan.start_at],['SNO',w.plan.start_at]];
  w.resp=()=>({status:200,text:Array(NX*NY).fill('0').join(',')});w.deps.store.skip=async()=>({data:null,error:{message:'fixture'}});
  const r=await call(w);assert.equal(r.j.ok,false);assert.equal(w.fetched.length,1);assert.equal(w.fails[0],'DB 저장 실패');
});
await test('계측: 실제 요청·본문·재시도를 세고 비밀값을 반환하지 않음', async () => {
  const w=world();w.plan.missing=[['SNO',w.plan.start_at]];w.resp=(u,n)=>n===1?{status:504,text:''}:{status:200,text:G};
  const meters=[];w.deps.store.usage=async(...args)=>{meters.push(args);return true;};const r=await call(w);
  assert.deepEqual(r.j.usage,{calls:2,bytes:new TextEncoder().encode(G).byteLength,retries:1});assert.equal(r.j.usage_saved,true);
  assert.equal(meters.length,1);assert.equal(meters[0][1],false);assert.ok(!JSON.stringify(meters).includes(w.key));assert.ok(!JSON.stringify(r.j).includes(w.key));
});
await test('계측: 초단기는 별도 종류로 기록', async () => {
  const w=vworld();const meters=[];w.deps.store.usage=async(...args)=>{meters.push(args);return true;};const r=await call(w,{token:'tok'},'{"vsrt":true}');
  assert.equal(r.j.usage.calls,18);assert.equal(meters[0][1],true);
});
await test('계측: 실패해도 이미 저장한 예보는 정상 응답 유지', async () => {
  const w=world();w.plan.missing=[['SNO',w.plan.start_at]];w.deps.store.usage=async()=>{throw Error('meter unavailable');};const r=await call(w);
  assert.equal(r.j.ok,true);assert.equal(r.j.usage_saved,false);assert.equal(w.puts.length,1);assert.equal(w.fails.length,0);
});
await test('계측: 한국 자정 양쪽 요청은 각각의 날짜로 기록', async () => {
  const w=world();w.clock=Date.parse('2026-11-04T14:59:59.900Z');w.plan.missing=[['SNO',w.plan.start_at],['PCP',w.plan.start_at]];
  const days=[];w.deps.store.usage=async(day)=>{days.push(day);return true;};await call(w);assert.deepEqual(days,['2026-11-04','2026-11-05']);
});
await test('재시도도120초 예산이 끝나면 추가 요청하지 않음', async () => {
  const w=world();w.plan.missing=[['SNO',w.plan.start_at]];w.deps.fetchText=async(u)=>{w.fetched.push(u);w.clock+=70000;return{status:504,text:''};};
  const r=await call(w);assert.equal(w.fetched.length,2);assert.ok(r.j.error.includes('시간이 모자라'));assert.equal(w.puts.length,0);
});

// 96: 관측 기온(초단기실황 격자 T1H)
{
const cells = [[1, 1], [2, 1], [149, 253]];
const grid = (f) => Array.from({ length: NX * NY }, (_, i) => f(i)).join(',');
function oworld(opt = {}) {
  const w = { fetched: [], puts: [], clock: Date.parse('2026-11-11T05:30:00Z'), key: 'obs_key' };
  w.deps = { now: () => w.clock, sleep: async () => {}, env: () => w.key, auth: { getUser: async () => ({ id: 'u' }) },
    store: { tokenOk: async (t) => t === 'tok', getProfileById: async () => ({ role: 'admin', disabled: false }),
      obsPlan: async () => ({ data: { cells, cells_tmfc: 'k1', missing: opt.missing || ['2026-11-11T03:00:00Z', '2026-11-11T04:00:00Z'] }, error: null }),
      obsPut: async (t, k, v) => { w.puts.push([t, k, v]); return { data: { ok: true }, error: null }; },
      usage: async () => true, fail: async () => {}, vsrtFail: async () => {} },
    fetchText: async (u) => { w.fetched.push(u); return opt.resp ? opt.resp(u) : { status: 200, text: grid((i) => (i % 7) - 3) }; } };
  return w;
}
async function ocall(w, body, tok = 'tok') { const r = await handle(new Request('https://x/f', { method: 'POST', headers: { 'x-collector-token': tok }, body: JSON.stringify(body) }), w.deps); return { status: r.status, j: await r.json() }; }
await test('96 관측 기온: 빈 정시를 초단기실황 격자(T1H)로 받아 격자 순서대로 저장, 키는 응답에 없음', async () => {
  const w = oworld(), r = await ocall(w, { obs: true });
  assert.equal(r.j.ok, true); assert.equal(r.j.hours, 2); assert.equal(w.puts.length, 2);
  assert.ok(w.fetched[0].includes('nph-dfs_odam_grd') && w.fetched[0].includes('vars=T1H') && w.fetched[0].includes('tmfc=202611111200'), w.fetched[0]);
  assert.equal(w.puts[0][0], '2026-11-11T03:00:00Z'); assert.equal(w.puts[0][1], 'k1'); assert.equal(w.puts[0][2].length, 3); assert.ok(!JSON.stringify(r.j).includes(w.key));
});
await test('96 관측 기온: 아직 안 나온 정시는 저장 없이 다음 예약 때, 형식이 다르면 오류', async () => {
  const w = oworld({ resp: () => ({ status: 200, text: '# dfs_file_read error' }) }), r = await ocall(w, { obs: true });
  assert.equal(r.j.ok, true); assert.equal(r.j.waiting, 2); assert.equal(w.puts.length, 0);
  const w2 = oworld({ resp: () => ({ status: 200, text: 'bad' }) }), r2 = await ocall(w2, { obs: true });
  assert.equal(r2.j.ok, false); assert.ok(r2.j.error.includes('형식'), r2.j.error); assert.equal(w2.puts.length, 0);
});
await test('96 관측 기온 시험 호출: 20분 전 정시 한 장, 저장 없음, 권한 없으면 거절', async () => {
  const w = oworld(), r = await ocall(w, { obs: true, probe: true });
  assert.equal(r.j.ok, true); assert.equal(w.fetched.length, 1); assert.ok(w.fetched[0].includes('tmfc=202611111400'), w.fetched[0]); assert.equal(w.puts.length, 0); assert.equal(r.j.stats.n, NX * NY);
  assert.equal((await ocall(oworld(), { obs: true }, 'nope')).status, 401);
});
}

const ok = results.filter((r) => r[1]).length;
results.forEach((r) => console.log((r[1] ? 'PASS ' : 'FAIL ') + r[0] + (r[1] ? '' : '  → ' + r[2])));
console.log('\n' + ok + '/' + results.length + ' 통과'); process.exit(ok === results.length ? 0 : 1);
