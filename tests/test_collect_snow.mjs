/* 일 신적설 자동 수집 함수(supabase/functions/collect-snow/core.mjs) 자동 테스트 — 기상청 글 읽기, 가짜 DB 로 24시각 받기·남은 시각만·다시 받기·시간 제한·권한
   실행: node tests/test_collect_snow.mjs   (저장소 맨 위 폴더에서) */
import assert from 'node:assert/strict';
import { parseSnow, parseStations, handle, SNOW_URL } from '../supabase/functions/collect-snow/core.mjs';

const results = [];
async function test(name, fn) { try { await fn(); results.push([name, true]); } catch (e) { results.push([name, false, String(e.message).split('\n')[0]]); } }

// 기상청 kma_snow1.php 모양: 시각, 관측소, 이름, 경도, 위도, 종류, 신적설(cm),=
const page = (tm, rows) => '#START7777\n# YYMMDDHHMI    STN               STN           LON           LAT       STN      SD\n#        KST     ID                KO         (deg)         (deg)        SP    (cm)\n' +
  rows.map(([s, v]) => `${tm}, ${String(s).padStart(5)},             속초, 128.56473000,  38.25085000, 000-----, ${String(v).padStart(6)},=`).join('\n') + '\n#7777END\n';

await test('기상청 글 읽기: 관측소별 값, 다른 시각 줄·형식 다른 글은 버림', () => {
  const t = page('202601152300', [[90, 1.5], [100, 0], [9619, -99.9]]) + '202601152200,    95, x, 1, 2, 000-----, 7.0,=\n';
  assert.deepEqual(parseSnow(t, '202601152300'), { 90: 1.5, 100: 0, 9619: -99.9 });
  assert.equal(parseSnow('{"result":{"status":401}}', '202601152300'), null);
  assert.equal(parseSnow(page('202601152300', []), '202601152300'), null);
  assert.equal(parseSnow(null, 'x'), null);
});

await test('관측소 위치 읽기(2026-11-10): 번호·이름·경도·위도, 값이 결측이어도 위치는 씀, 같은 관측소는 한 번', () => {
  const t = page('202601151200', [[90, 1.5], [100, -99.9]]) + '202601151100,    90, x, 128.5, 38.2, 000-----, 1.0,=\n';
  assert.deepEqual(parseStations(t), [[90, '속초', 128.56473, 38.25085], [100, '속초', 128.56473, 38.25085]]);
  assert.equal(parseStations('{"result":{"status":401}}'), null);
  assert.equal(parseStations(page('202601151200', [])), null);
});

function world(o = {}) {
  const w = { key: 'K'.repeat(22), token: 'tok', fetched: [], puts: [], fin: [], clock: 0, admin: false,
    plan: { date: '20260115', in_season: true, done: [] },
    resp: (u) => { const tm = /tm=(\d{12})/.exec(u)[1]; const h = +tm.slice(8, 10); return { status: 200, text: page(tm, [[90, h / 10], [100, h === 5 ? 9 : 1]]) }; }, ...o };
  w.deps = {
    now: () => w.clock, sleep: async (ms) => { w.clock += ms; }, env: (k) => (k === 'KMA_AUTH_KEY' ? w.key : ''),
    async fetchText(u) { w.fetched.push(u); w.clock += 600; return w.resp(u, w.fetched.length); },
    auth: { async getUser(j) { return { id: j === 'admin-jwt' ? 'u1' : null }; } },
    store: {
      async tokenOk(t) { return t === w.token; }, async getProfileById(id) { return id === 'u1' ? { id, role: 'admin', disabled: false } : null; },
      async plan(d) { w.planArg = d; return { data: w.plan, error: null }; },
      async put(d, h, vals, dry) { w.puts.push([d, h, vals, dry]); return { data: { new: 0, higher: 1, same: 1, lower: 0, written: dry ? 0 : 1 }, error: null }; },
      async finish(d, hours, written, note) { w.fin.push([d, hours, written, note]); },
    },
  };
  return w;
}
const call = (w, body = {}, h = { 'x-collector-token': 'tok' }) => handle(new Request('http://x/', { method: 'POST', headers: h, body: JSON.stringify(body) }), w.deps).then(async (r) => [r.status, await r.json()]);

await test('관측소 위치만(2026-11-10): 기상청 1번, 저장·계획 조회 없음, 키 안 보임, 날짜 없으면 400, 권한 없으면 401', async () => {
  const w = world({ plan: { date: '20260115', in_season: false, done: [] } }); const [st, b] = await call(w, { stations: true, date: '20260115' });
  assert.equal(st, 200); assert.equal(b.ok, true); assert.equal(b.tm, '202601151200'); assert.equal(b.count, 2); assert.deepEqual(b.stations[0], [90, '속초', 128.56473, 38.25085]);
  assert.equal(w.fetched.length, 1); assert.equal(w.puts.length, 0); assert.equal(w.fin.length, 0); assert.equal(w.planArg, undefined); assert.ok(!JSON.stringify(b).includes(w.key));
  assert.equal((await call(w, { stations: true }))[0], 400); assert.equal((await call(w, { stations: true, date: '20260115' }, {}))[0], 401);
});

await test('예약 호출: 어제 00~23시 24번 받아 시각마다 넣고, 끝에 요약본 다시 만들기', async () => {
  const w = world(); const [st, b] = await call(w);
  assert.equal(st, 200); assert.equal(b.ok, true); assert.equal(b.hours, 24);
  assert.equal(w.fetched.length, 24); assert.ok(w.fetched.every((u) => u.startsWith(SNOW_URL + '?sd=day&tm=20260115') && u.includes('authKey=')));
  assert.deepEqual(w.puts.map((p) => p[1]), [...Array(24).keys()]);
  assert.deepEqual(w.puts[5][2], { 90: 0.5, 100: 9 }); assert.equal(w.puts[5][0], '2026-01-15');
  assert.equal(w.fin.length, 1); assert.equal(w.fin[0][1], 24); assert.equal(w.fin[0][2], 24);
  assert.ok(!JSON.stringify(b).includes(w.key) && !w.fin[0][3].includes(w.key), '키는 결과·기록에 남기지 않음');
});
await test('이미 받은 시각은 건너뜀, 다 받았으면 아무것도 안 부름', async () => {
  const w = world({ plan: { date: '20260115', in_season: true, done: [...Array(20).keys()] } });
  const [, b] = await call(w); assert.equal(w.fetched.length, 4); assert.equal(b.hours, 24);
  const w2 = world({ plan: { date: '20260115', in_season: true, done: [...Array(24).keys()] } });
  const [, b2] = await call(w2); assert.equal(b2.done, true); assert.equal(w2.fetched.length, 0); assert.equal(w2.fin.length, 0);
});
await test('시즌이 아니면 기상청을 부르지 않음', async () => {
  const w = world({ plan: { date: '20261004', in_season: false, done: [] } });
  const [, b] = await call(w); assert.equal(b.skipped, 'out_of_season'); assert.equal(w.fetched.length, 0);
});
await test('504·늦은 응답은 1초 뒤 한 번 더, 끝내 못 받은 시각은 빼고 기록 → 다음 예약 때 그 시각만', async () => {
  const w = world({ resp: (u, n) => { const tm = /tm=(\d{12})/.exec(u)[1]; if (tm.endsWith('0300')) return { status: 504, text: '' }; if (tm.endsWith('0400') && w.fetched.filter((x) => x.includes('0400&')).length < 2) return { status: 504, text: '' }; return { status: 200, text: page(tm, [[90, 1]]) }; } });
  const [, b] = await call(w);
  assert.equal(b.ok, false); assert.equal(b.hours, 23); assert.match(b.error, /0300 HTTP 504/);
  assert.equal(w.fetched.filter((u) => u.includes('0300&')).length, 2); assert.equal(w.fetched.filter((u) => u.includes('0400&')).length, 2);
  assert.ok(!w.puts.some((p) => p[1] === 3)); assert.match(w.fin[0][3], /23\/24/);
});
await test('키·활용신청 오류(401·403)는 다시 하지 않음', async () => {
  const w = world({ resp: () => ({ status: 403, text: '{"result":{"status":403}}' }) });
  const [, b] = await call(w); assert.equal(w.fetched.length, 24); assert.equal(b.hours, 0); assert.equal(w.puts.length, 0);
});
await test('시간 제한: 다음 요청(최대 15초)이 115초 안에 못 끝날 것 같으면 멈추고 받은 만큼만', async () => {
  const w = world(); w.deps.fetchText = async (u) => { w.fetched.push(u); w.clock += 15000; return { status: 504, text: '' }; };
  const [, b] = await call(w); assert.ok(w.clock <= 115000 + 1000, String(w.clock)); assert.equal(b.hours, 0); assert.equal(b.error, 'budget');
  const w2 = world(); w2.deps.fetchText = async (u) => { w2.fetched.push(u); w2.clock += 9000; return w2.resp(u); };
  const [, b2] = await call(w2); assert.ok(b2.hours > 5 && b2.hours < 24); assert.equal(w2.fin[0][1], b2.hours); assert.ok(w2.clock <= 116000);
});
await test('권한: 서버 안 토큰·관리자만. 날짜 지정·비교(dry)는 넣지 않음', async () => {
  const w = world(); const [st] = await call(w, {}, { 'x-collector-token': 'bad' }); assert.equal(st, 401);
  const [st2] = await call(w, {}, {}); assert.equal(st2, 401);
  const [st4] = await call(w, {}, { authorization: 'Bearer user-jwt' }); assert.equal(st4, 401);
  const w2 = world(); await call(w2, { date: 'x; drop' }); assert.equal(w2.planArg, null, '날짜 모양이 아니면 어제');
  const w3 = world({ plan: { date: '20250101', in_season: true, done: [0, 1] } });
  const [, b3] = await call(w3, { date: '20250101', dry: true }, { authorization: 'Bearer admin-jwt' });
  assert.equal(w3.planArg, '2025-01-01'); assert.equal(b3.dry, true); assert.equal(w3.fetched.length, 24, '비교는 24시각 모두');
  assert.equal(w3.puts.length, 1, '비교는 그날 최댓값으로 한 번'); assert.equal(w3.puts[0][3], true); assert.deepEqual(w3.puts[0][2], { 90: 2.3, 100: 9 });
  assert.equal(w3.fin.length, 0, '비교는 기록·요약본 안 바꿈'); assert.equal(b3.hours, 24); assert.equal(b3.stations, 2);
});
await test('키가 없으면 부르지 않음', async () => {
  const w = world({ key: '' }); const [, b] = await call(w); assert.equal(b.error, 'no_key'); assert.equal(w.fetched.length, 0);
});

const ok = results.filter((r) => r[1]).length;
results.forEach((r) => console.log((r[1] ? 'PASS ' : 'FAIL ') + r[0] + (r[1] ? '' : '  → ' + r[2])));
console.log('\n' + ok + '/' + results.length + ' 통과'); process.exit(ok === results.length ? 0 : 1);
