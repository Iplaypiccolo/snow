/* 기준정보 이전 함수(supabase/functions/import-reference/core.mjs) 자동 테스트 — 실제 data/*.json 으로 변환·검사를 시험하고, 가짜 DB 로 동작을 확인
   실행: node tests/test_import_reference.mjs   (저장소 맨 위 폴더에서) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto as crypto } from 'node:crypto';
import { build, handle, ImportError } from '../supabase/functions/import-reference/core.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', n + '.json'), 'utf8'));
const files = () => ({ sections: read('sections'), stations: read('stations'), hierarchy: read('hierarchy'), grid_assign: read('grid_assign'), jurisdiction_changes: read('jurisdiction_changes'), grid_changes: read('grid_changes') });
const clone = (x) => JSON.parse(JSON.stringify(x));
const results = [];
async function test(name, fn) { try { await fn(); results.push([name, true]); } catch (e) { results.push([name, false, String(e.message).split('\n')[0]]); } }
const rejects = (f, code) => { try { build(f); } catch (e) { assert.ok(e instanceof ImportError, String(e)); assert.equal(e.code, code, e.message); return; } assert.fail('거절되어야 함: ' + code); };

// 2026-11-02: 새 고속도로 '(대략)' 14구간(S1012~S1025)을 더해 1,011 → 1,025
await test('실제 자료 변환: 구간 1,025 · 관측소 263 · 지사-관측소 387 · 격자 1,070, 합계가 원본과 같다', () => {
  const { payload: p, summary: s } = build(files()), src = files();
  assert.equal(p.sections.length, 1025); assert.equal(p.stations.length, 263); assert.equal(p.branch_stations.length, 387); assert.equal(p.grid_assign.length, 1070);
  assert.deepEqual(s, { sections: 1025, sections_unassigned: 339, section_points: 15347, section_km: 5734.713, stations: 263, branch_stations: 387, grid_assign: 1070, grid_cells: 934 });   // 기관이 한 곳 이상 편입된 격자 934칸
  assert.equal(s.sections_unassigned, src.sections.sections.filter((x) => x.owner == null).length);
  assert.equal(s.section_points, src.sections.sections.reduce((a, x) => a + x.coords.length, 0));
});

await test('구간이 하나도 변하지 않는다: 각 칸이 원본과 같고(이름 바뀐 열 제외) 미지정(null)과 좌표가 그대로', () => {
  const { payload: p } = build(files()), src = read('sections').sections;
  p.sections.forEach((r, i) => {
    const o = src[i];
    assert.deepEqual([r.id, r.route, r.from_name, r.to_name, r.km, r.owner_id, r.chain, r.ord], [o.id, o.route, o['from'], o.to, o.km, o.owner, o.chain, o.order]);
    assert.deepEqual(r.coords, o.coords);
  });
  assert.equal(p.sections.filter((r) => r.owner_id === null).length, 339);
});

await test('관측소·지사별 관측소: 모든 관측소가 있고 좌표·거리·노선이 원본과 같다', () => {
  const { payload: p } = build(files()), h = read('hierarchy'), ids = new Map(read('sections').branches.map((b) => [b.hq + '|' + b.name, b.id]));
  const st = new Map(p.stations.map((s) => [s.id, s])); let n = 0;
  for (const hq of h.hq) for (const b of hq.branches) for (const x of b.stations) {
    const row = p.branch_stations.find((r) => r.branch_id === ids.get(hq.name + '|' + b.name) && r.station_id === x.id);
    assert.ok(row && row.dist_km === x.dist_km && row.road === x.road, `${b.name} ${x.id}`); assert.ok(st.get(x.id).lat === x.lat && st.get(x.id).lon === x.lon); n++;
  }
  assert.equal(n, 387); assert.ok(p.stations.every((s, i, a) => i === 0 || a[i - 1].id < s.id), '관측소 번호 순서');
});

await test('격자 편입: 칸마다 기관 목록이 원본과 같고, 한 칸을 여러 기관이 가진 칸도 그대로', () => {
  const { payload: p } = build(files()), g = read('grid_assign'), by = new Map();
  p.grid_assign.forEach((r) => by.set(r.nx + ',' + r.ny, (by.get(r.nx + ',' + r.ny) || []).concat(r.branch_id).sort()));
  g.cells.filter((c) => c[2].length).forEach((c) => assert.deepEqual(by.get(c[0] + ',' + c[1]), [...c[2]].sort(), c.join()));
  assert.ok([...by.values()].some((v) => v.length > 1), '공유 격자가 있어야 함'); assert.equal(by.size, g.cells.filter((c) => c[2].length).length);
});

await test('잘못된 자료는 거절: 겹치는 구간 번호 · 없는 지사 번호 · 한국 밖 좌표 · 좌표 부족 · 음수 길이', () => {
  let f = files(); f.sections.sections[1].id = f.sections.sections[0].id; rejects(f, 'sections');
  f = files(); f.sections.sections[0].owner = 'B999'; rejects(f, 'sections');
  f = files(); f.sections.sections[0].coords[0] = [10, 10]; rejects(f, 'sections');
  f = files(); f.sections.sections[0].coords = [[127, 37]]; rejects(f, 'sections');
  f = files(); f.sections.sections[0].km = -1; rejects(f, 'sections');
  f = files(); f.sections.sections[0].id = 'X1'; rejects(f, 'sections');
});

await test('잘못된 자료는 거절: 관측소 좌표 불일치 · 겹치는 관측소 · 알 수 없는 지사 · 격자 범위 밖 · 없는 지사의 격자', () => {
  let f = files(); f.hierarchy.hq[0].branches[0].stations[0].lat += 0.5; rejects(f, 'stations');
  f = files(); f.stations.stations.push({ ...f.stations.stations[0] }); rejects(f, 'stations');
  f = files(); f.hierarchy.hq[0].branches[0].name = '없는지사'; rejects(f, 'hierarchy');
  f = files(); f.grid_assign.cells[0][0] = 500; rejects(f, 'grid_assign');
  f = files(); f.grid_assign.cells[0][2] = ['B999']; rejects(f, 'grid_assign');
  f = files(); f.hierarchy.hq[0].branches[0].stations.push({ ...f.hierarchy.hq[0].branches[0].stations[0] }); rejects(f, 'hierarchy');
});

await test('저장된 변경 이력이 있으면 중단한다(이력을 조용히 버리지 않기 위해)', () => {
  let f = files(); f.jurisdiction_changes.events = [{ t: 'move', sections: ['S0001'], to: 'B002' }]; rejects(f, 'events_not_empty');
  f = files(); f.grid_changes.events = [{ t: 'add', cells: [[1, 1]], to: 'B001' }]; rejects(f, 'events_not_empty');
});

/* ---------- 가짜 서버 ---------- */
const hex = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');
function world(over = {}) {
  const w = { now: new Date('2026-10-03T10:00:00Z'), boot: null, jwt: new Map(), profiles: new Map(), fetched: [], imported: null, importError: null, countsOverride: null, missing: null, ...over };
  w.deps = {
    now: () => w.now, sha256hex: hex,
    async fetchText(url) { w.fetched.push(url); const name = url.split('/data/')[1].replace('.json', ''); if (w.missing === name) return null; return fs.readFileSync(path.join(ROOT, 'data', name + '.json'), 'utf8'); },
    auth: { async getUser(jwt) { const id = w.jwt.get(jwt); return { id: id || null }; } },
    store: {
      async getProfileById(id) { return w.profiles.get(id) || null; },
      async consumeBootstrap(h, now) { const b = w.boot; if (!b || b.hash !== h || Date.parse(b.expires_at) < now.getTime()) return false; w.boot = null; return true; },
      async importReference(payload) { if (w.importError) return { error: { message: w.importError } }; w.imported = payload; return { counts: w.countsOverride || { sections: payload.sections.length, stations: payload.stations.length, branch_stations: payload.branch_stations.length, grid_assign: payload.grid_assign.length } }; },
    },
  };
  return w;
}
const admin = (w) => { w.profiles.set('a1', { id: 'a1', username: 'admin-01', role: 'admin', disabled: false, must_change: false }); w.jwt.set('jwt-a', 'a1'); };
const call = (w, body, { jwt, boot, method = 'POST', raw } = {}) => {
  const h = new Headers(); if (jwt) h.set('authorization', 'Bearer ' + jwt); if (boot) h.set('x-bootstrap-token', boot);
  return handle(new Request('https://f.test/import-reference', { method, headers: h, body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined }), w.deps);
};
const J = async (r) => ({ status: r.status, body: await r.json() });

await test('인증: 로그인 안 함 · 엉뚱한 토큰 · 관리자가 아닌 계정 · 임시 비밀번호 관리자는 거절하고 아무것도 읽지 않는다', async () => {
  const w = world(); admin(w);
  w.profiles.set('b1', { id: 'b1', username: 'b', role: 'branch', disabled: false, must_change: false }); w.jwt.set('jwt-b', 'b1');
  w.profiles.set('m1', { id: 'm1', username: 'm', role: 'admin', disabled: false, must_change: true }); w.jwt.set('jwt-m', 'm1');
  w.profiles.set('d1', { id: 'd1', username: 'd', role: 'admin', disabled: true, must_change: false }); w.jwt.set('jwt-d', 'd1');
  assert.equal((await call(w, { action: 'plan' })).status, 401); assert.equal((await call(w, { action: 'plan' }, { jwt: 'x' })).status, 401);
  for (const j of ['jwt-b', 'jwt-m', 'jwt-d']) assert.equal((await call(w, { action: 'load' }, { jwt: j })).status, 403, j);
  assert.equal((await call(w, { action: 'plan' }, { boot: 'nope' })).status, 403);
  assert.equal(w.fetched.length, 0); assert.equal(w.imported, null);
});

await test('plan: 관리자는 요약만 받고 DB 에는 아무것도 넣지 않는다', async () => {
  const w = world(); admin(w); const r = await J(await call(w, { action: 'plan' }, { jwt: 'jwt-a' }));
  assert.equal(r.status, 200); assert.equal(r.body.summary.sections, 1025); assert.equal(r.body.summary.section_km, 5734.713); assert.equal(w.imported, null);
  assert.equal(w.fetched.length, 6); assert.ok(w.fetched.every((u) => u.startsWith('https://raw.githubusercontent.com/Iplaypiccolo/snow/main/data/')));
});

await test('load: 시작 토큰으로 한 번만 가능하고, 넣은 개수가 요약과 같다', async () => {
  const w = world(); const tok = 'boot-xyz'; w.boot = { hash: await hex(tok), expires_at: '2026-10-03T10:15:00Z' };
  const r = await J(await call(w, { action: 'load', ref: 'abc1234' }, { boot: tok }));
  assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.deepEqual(r.body.counts, { sections: 1025, stations: 263, branch_stations: 387, grid_assign: 1070 }); assert.equal(w.imported.sections.length, 1025);
  assert.ok(w.fetched[0].includes('/abc1234/data/'), 'ref 로 지정한 커밋에서 읽음'); assert.equal(w.boot, null);
  assert.equal((await call(w, { action: 'load' }, { boot: tok })).status, 403);               // 재사용 불가
  w.boot = { hash: await hex(tok), expires_at: '2026-10-03T09:59:00Z' }; assert.equal((await call(w, { action: 'load' }, { boot: tok })).status, 403);   // 만료
});

await test('실패 처리: 파일을 못 읽음 · 검사 실패 · DB 오류 · 개수 불일치는 모두 알려 주고 잘못된 자료를 넣지 않는다', async () => {
  let w = world(); admin(w); w.missing = 'sections'; let r = await J(await call(w, { action: 'load' }, { jwt: 'jwt-a' })); assert.equal(r.status, 502); assert.equal(w.imported, null);
  w = world(); admin(w); w.importError = 'foreign key violation'; r = await J(await call(w, { action: 'load' }, { jwt: 'jwt-a' })); assert.equal(r.status, 500); assert.equal(r.body.error, 'import_failed');
  w = world(); admin(w); w.countsOverride = { sections: 1, stations: 1, branch_stations: 1, grid_assign: 1 }; r = await J(await call(w, { action: 'load' }, { jwt: 'jwt-a' })); assert.equal(r.status, 500); assert.equal(r.body.ok, false);
  w = world(); admin(w); const fs0 = fs.readFileSync; const orig = w.deps.fetchText;
  w.deps.fetchText = async (u) => { const t = await orig(u); if (u.endsWith('jurisdiction_changes.json')) return JSON.stringify({ version: 1, events: [{ t: 'move' }] }); return t; };
  r = await J(await call(w, { action: 'load' }, { jwt: 'jwt-a' })); assert.equal(r.status, 422); assert.equal(r.body.error, 'events_not_empty'); assert.equal(w.imported, null);
});

await test('요청 검사: 알 수 없는 작업 · 이상한 ref(다른 주소로 새는 것 방지) · 깨진 요청 · GET', async () => {
  const w = world(); admin(w);
  assert.equal((await call(w, { action: 'drop' }, { jwt: 'jwt-a' })).status, 400);
  for (const ref of ['../x', 'main/../../evil', 'a b', 'https://evil.test', '', 'ZZZ', 'abc12']) assert.equal((await call(w, { action: 'plan', ref }, { jwt: 'jwt-a' })).status, 400, ref);
  assert.equal((await call(w, null, { jwt: 'jwt-a', raw: '{oops' })).status, 400); assert.equal((await call(w, null, { method: 'GET' })).status, 405); assert.equal((await call(w, null, { method: 'OPTIONS' })).status, 204);
  assert.equal(w.fetched.length, 0);
});

const ok = results.filter((r) => r[1]).length;
results.forEach((r) => console.log((r[1] ? 'PASS ' : 'FAIL ') + r[0] + (r[1] ? '' : '  → ' + r[2])));
console.log('\n' + ok + '/' + results.length + ' 통과'); process.exit(ok === results.length ? 0 : 1);
