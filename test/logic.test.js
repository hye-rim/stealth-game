'use strict';
// 스텔스 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const gen = (seed, stage, level = 'normal') => L.generateLevel(seed, stage, level);
const runPath = (lv, level, stage, seed) => {
  const r = L.solve(lv, null, true);
  const st = L.newGame(L.rng(1), { level, stage, seed, levelData: lv });
  let maxAlert = 0;
  for (const di of r.moves) { const [dx, dy] = L.DIRS[di]; L.setInput(st, dx, dy); for (let k = 0; k < 25 && st.status === 'play'; k++) { L.step(st, 0.01); maxAlert = Math.max(maxAlert, st.alert); } if (st.status !== 'play') break; }
  return { st, maxAlert, r };
};
// 아무 장애물 없는 작은 방 (규칙 시험용): 가운데에 벽 하나
function emptyLevel() {
  const tiles = Array.from({ length: L.ROWS }, (_, y) => Array.from({ length: L.COLS }, (_, x) => (x === 0 || y === 0 || x === L.COLS - 1 || y === L.ROWS - 1 ? '#' : '.')).join(''));
  return { tiles, start: { x: 1, y: L.ROWS - 2 }, exit: { x: L.COLS - 2, y: 1 }, keys: [{ x: 5, y: 8 }], guards: [], cams: [], fov: Math.PI / 2, range: 5, detect: 0.8, stage: 1, par: 20 };
}
const room = (lv) => L.newGame(L.rng(1), { level: 'normal', levelData: lv, seed: 1 });

test('stage parameters grow with the stage and stay within limits', () => {
  let prev = null;
  for (let s = 1; s <= 30; s++) {
    const p = L.stageParams('normal', s);
    assert.ok(p.guards >= 1 && p.guards <= 5 && p.cams <= 3 && p.keys >= 1 && p.keys <= 3 && p.range <= 6.01);
    if (prev) { assert.ok(p.guards >= prev.guards && p.cams >= prev.cams && p.keys >= prev.keys && p.fov >= prev.fov && p.range >= prev.range && p.detect <= prev.detect + 1e-9); }
    prev = p;
  }
  assert.ok(L.stageParams('easy', 10).detect > L.stageParams('normal', 10).detect, 'easy gives more time before being caught');
  assert.strictEqual(L.stageParams('normal', 1).cams, 0);
});

test('generated level: sizes, border walls, start/exit/keys on reachable open cells', () => {
  for (const [stage, level] of [[1, 'easy'], [4, 'normal'], [9, 'normal'], [14, 'normal']]) {
    const lv = gen(77 + stage, stage, level);
    assert.strictEqual(lv.tiles.length, L.ROWS); assert.ok(lv.tiles.every((r) => r.length === L.COLS));
    for (let x = 0; x < L.COLS; x++) { assert.strictEqual(lv.tiles[0][x], '#'); assert.strictEqual(lv.tiles[L.ROWS - 1][x], '#'); }
    for (const c of [lv.start, lv.exit, ...lv.keys]) assert.notStrictEqual(lv.tiles[c.y][c.x], '#');
    assert.ok(lv.keys.length >= 1);
    // 열쇠와 출구까지 걸어서 갈 수 있음
    assert.ok(L.trivialTime(lv) > 0);
    assert.ok(lv.par > lv.solveTime);
  }
});

test('the same seed gives the same level', () => {
  const a = gen(9, 5), b = gen(9, 5);
  assert.deepStrictEqual(a.tiles, b.tiles); assert.deepStrictEqual(a.guards, b.guards); assert.deepStrictEqual(a.keys, b.keys);
});

test('guards and cameras move on a common period and stay on open cells', () => {
  const lv = gen(31, 10, 'normal');
  assert.ok(lv.guards.length >= 3 && lv.cams.length >= 1, 'later stages have more guards and cameras');
  for (const g of lv.guards) {
    assert.ok(L.PERIOD % g.period === 0, 'period divides the common period');
    for (let t = 0; t < g.period; t += 0.37) {
      const s = L.guardState(g, t), s2 = L.guardState(g, t + g.period);
      assert.ok(Math.abs(s.x - s2.x) < 1e-9 && Math.abs(s.y - s2.y) < 1e-9 && Math.abs(Math.cos(s.a) - Math.cos(s2.a)) < 1e-9, 'periodic');
      assert.ok(!L.isWall(lv, Math.floor(s.x), Math.floor(s.y)), 'on an open cell');
    }
    const a = L.guardState(g, 0), b = L.guardState(g, g.segTime);
    assert.ok(Math.abs(a.x - (g.a[0] + 0.5)) < 1e-9 && Math.abs(b.x - (g.b[0] + 0.5)) < 1e-9, 'walks between the two ends');
  }
  for (const c of lv.cams) {
    assert.ok(L.PERIOD % c.period === 0);
    const s0 = L.camState(c, 0), s1 = L.camState(c, c.period);
    assert.ok(Math.abs(s0.a - s1.a) < 1e-9);
    assert.strictEqual(lv.tiles[c.y][c.x], '#', 'cameras sit on walls');
  }
});

test('vision: only inside the cone and range, and walls block it', () => {
  const lv = emptyLevel(), s = { x: 5.5, y: 8.5, a: 0 };
  assert.strictEqual(L.sees(lv, s, 8.5, 8.5), true);                // 정면
  assert.strictEqual(L.sees(lv, s, 8.5, 12.5), false);              // 시야각 밖
  assert.strictEqual(L.sees(lv, s, 2.5, 8.5), false);               // 뒤
  assert.strictEqual(L.sees(lv, s, 5.5 + lv.range + 0.5, 8.5), false); // 거리 밖
  lv.tiles[8] = lv.tiles[8].slice(0, 7) + '#' + lv.tiles[8].slice(8);
  assert.strictEqual(L.sees(lv, s, 8.5, 8.5), false, 'a wall in between');
});

test('movement: constant speed, walls stop you, you slide along them, you cannot leave the room', () => {
  const st = room(emptyLevel());
  L.setInput(st, 1, 0); for (let i = 0; i < 25; i++) L.step(st, 0.01);
  assert.ok(Math.abs(st.p.x - (1.5 + L.SPEED * 0.25)) < 1e-6);
  L.setInput(st, 1, 1); const x0 = st.p.x; for (let i = 0; i < 25; i++) L.step(st, 0.01);
  assert.ok(Math.hypot(st.p.x - x0, 0) <= L.SPEED * 0.25 + 1e-6, 'diagonal is not faster');
  L.setInput(st, -1, 0); for (let i = 0; i < 300; i++) L.step(st, 0.01);
  assert.ok(st.p.x >= 1 + L.PR - 1e-6, 'stopped by the left wall');
  L.setInput(st, 0, 1); for (let i = 0; i < 300; i++) L.step(st, 0.01);
  assert.ok(st.p.y <= L.ROWS - 1 - L.PR + 1e-6);
  // 벽에 비스듬히 밀면 미끄러짐
  const sl = room(emptyLevel()); sl.p.x = 1 + L.PR; sl.p.y = 10;
  L.setInput(sl, -1, -1); for (let i = 0; i < 50; i++) L.step(sl, 0.01);
  assert.ok(sl.p.y < 9.5, 'slid up along the wall');
});

test('keys unlock the exit; the exit only works with every key', () => {
  const lv = emptyLevel(); lv.keys = [{ x: 3, y: 14 }, { x: 8, y: 14 }];
  const st = room(lv); const ev = [];
  L.setInput(st, 1, 0); for (let i = 0; i < 80 && st.status === 'play'; i++) { L.step(st, 0.01); ev.push(...st.events.splice(0)); }
  assert.strictEqual(st.keys[0], true); assert.strictEqual(st.keys[1], false);
  st.p.x = lv.exit.x + 0.5; st.p.y = lv.exit.y + 0.5; L.step(st, 0.01);
  assert.strictEqual(st.status, 'play', 'the exit stays shut with a key missing');
  st.p.x = 8.5; st.p.y = 14.5; L.step(st, 0.01); ev.push(...st.events.splice(0));
  assert.ok(ev.some((e) => e.type === 'unlock'));
  st.p.x = lv.exit.x + 0.5; st.p.y = lv.exit.y + 0.5; L.step(st, 0.01);
  assert.strictEqual(st.status, 'cleared');
});

test('detection meter fills while seen, drains when hidden, and being caught costs a life (normal) or nothing (easy)', () => {
  const lv = emptyLevel(); lv.cams = [{ x: 0, y: 8, base: 0, amp: 0, period: 6, phase: 0 }];     // 왼쪽 벽에서 오른쪽을 바라보는 고정 카메라
  const st = room(lv); st.p.x = 4.5; st.p.y = 8.5;
  for (let i = 0; i < 30; i++) L.step(st, 0.01);
  assert.ok(st.alert > 0.25 && st.alert < 0.5, 'filling: ' + st.alert);
  assert.ok(st.events.some((e) => e.type === 'spotted'));
  st.p.y = 12.5; for (let i = 0; i < 40; i++) L.step(st, 0.01);
  assert.ok(st.alert < 0.2, 'draining: ' + st.alert);
  st.p.y = 8.5; for (let i = 0; i < 100 && st.status === 'play'; i++) L.step(st, 0.01);
  assert.strictEqual(st.status, 'caught'); assert.strictEqual(st.lives, 2); assert.strictEqual(st.caughtHere, 1);
  L.retry(st); assert.strictEqual(st.status, 'play'); assert.strictEqual(st.alert, 0); assert.ok(st.keys.every((k) => !k));
  const e = L.newGame(L.rng(1), { level: 'easy', levelData: lv, seed: 1 }); e.p.x = 4.5; e.p.y = 8.5;
  for (let i = 0; i < 200 && e.status === 'play'; i++) L.step(e, 0.01);
  assert.strictEqual(e.status, 'caught'); assert.strictEqual(e.infinite, true); assert.ok(!e.over);
});

test('losing the last life ends the game in normal', () => {
  const lv = emptyLevel(); lv.cams = [{ x: 0, y: 8, base: 0, amp: 0, period: 6, phase: 0 }];
  const st = L.newGame(L.rng(1), { level: 'normal', levelData: lv, seed: 1, lives: 1 }); st.p.x = 4.5; st.p.y = 8.5;
  for (let i = 0; i < 200 && st.status === 'play'; i++) L.step(st, 0.01);
  assert.strictEqual(st.lives, 0); assert.strictEqual(st.over, true);
  assert.ok(st.events.some((e) => e.type === 'over'));
});

test('stars: 3 for a clean fast run, 2 for a clean slow one, 1 after being caught; next stage keeps lives and stars', () => {
  const run = (setup) => { const st = room(emptyLevel()); st.keys = [true]; setup(st); st.p.x = 9.5; st.p.y = 1.5; L.step(st, 0.01); return st; };
  assert.strictEqual(run((st) => { st.t = 5; }).lastStars, 3);
  assert.strictEqual(run((st) => { st.t = 99; }).lastStars, 2);
  assert.strictEqual(run((st) => { st.t = 5; st.caughtHere = 1; }).lastStars, 1);
  const st = run((st) => { st.t = 5; st.lives = 2; });
  const n = L.nextStage(st);
  assert.strictEqual(n.stage, 2); assert.strictEqual(n.lives, 2); assert.strictEqual(n.stars, 3);
});

test('every generated level can be cleared by following the solver path in the real game, without being caught', () => {
  let count = 0;
  for (const level of ['easy', 'normal']) for (const stage of [1, 3, 6, 9, 13]) for (let k = 1; k <= 3; k++) {
    const seed = 1000 + stage * 17 + k;
    const lv = gen(seed, stage, level);
    const { st, maxAlert } = runPath(lv, level, stage, seed);
    assert.strictEqual(st.status, 'cleared', `${level} stage ${stage} seed ${seed} status ${st.status}`);
    assert.ok(maxAlert < 0.8, 'keeps a safety margin: ' + maxAlert);
    count++;
  }
  assert.strictEqual(count, 30);
});

test('later stages are not trivial: guards force waiting or detours at least sometimes', () => {
  let forced = 0;
  for (let k = 1; k <= 8; k++) { const lv = gen(500 + k, 7, 'normal'); if (lv.solveTime - lv.trivial >= 2) forced++; }
  assert.ok(forced >= 6, 'levels with forced waiting: ' + forced);
});
