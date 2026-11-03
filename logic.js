'use strict';
// 스텔스: 규칙만 (DOM 없음). 화면·입력·소리는 game.js.
// 위에서 본 방에서 경비의 시야(부채꼴)와 감시 카메라를 피해 열쇠를 모으고 출구로 간다. 시야에 오래 있으면 발각.
// 단계는 만들 때마다 '실제로 시야를 피해 클리어할 수 있는 길이 있는지' 풀이 검색으로 확인한다.
(function (root) {
  const COLS = 11, ROWS = 16;
  const SPEED = 4;                       // 내 속도(칸/초). 풀이 검색은 한 칸을 0.25초에 간다고 본다
  const Q = 0.25, PERIOD = 24;           // 풀이 검색의 시간 간격과 경비 움직임의 공통 주기(초)
  const PHASES = PERIOD / Q;
  const PR = 0.28;                       // 내 몸 반지름(칸)
  const LEVELS = {
    easy: { label: '쉬움', lives: 0, detect: 1.15, decay: 1.4 },
    normal: { label: '보통', lives: 3, detect: 0.8, decay: 1.6 },
  };
  const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

  // 단계별 어려움
  function stageParams(level, stage) {
    const n = (cond) => (cond ? 1 : 0);
    return {
      guards: Math.min(5, 1 + n(stage >= 2) + n(stage >= 4) + n(stage >= 6) + n(stage >= 8)),
      cams: stage >= 3 ? Math.min(3, 1 + n(stage >= 6) + n(stage >= 9)) : 0,
      keys: 1 + n(stage >= 5) + n(stage >= 9),
      blocks: Math.min(14, 6 + stage),
      fov: (60 + Math.min(30, stage * 3)) * Math.PI / 180,
      range: 3.8 + Math.min(2.2, stage * 0.25),
      detect: level === 'easy' ? LEVELS.easy.detect : Math.max(0.45, LEVELS.normal.detect - 0.03 * stage),
    };
  }

  const isWall = (lv, cx, cy) => cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS || lv.tiles[cy][cx] === '#';

  // ---------- 경비·카메라 움직임 (시간만의 함수) ----------
  function guardState(g, t) {
    const per = g.period, tau = ((t % per) + per) % per, seg = g.segTime, pause = g.pause;
    const ax = g.a[0] + 0.5, ay = g.a[1] + 0.5, bx = g.b[0] + 0.5, by = g.b[1] + 0.5, dir = Math.atan2(by - ay, bx - ax);
    if (tau < seg) { const f = tau / seg; return { x: ax + (bx - ax) * f, y: ay + (by - ay) * f, a: dir }; }
    if (tau < seg + pause) return { x: bx, y: by, a: dir + Math.PI * ((tau - seg) / pause) };
    if (tau < 2 * seg + pause) { const f = (tau - seg - pause) / seg; return { x: bx + (ax - bx) * f, y: by + (ay - by) * f, a: dir + Math.PI }; }
    return { x: ax, y: ay, a: dir + Math.PI + Math.PI * ((tau - 2 * seg - pause) / pause) };
  }
  function camState(c, t) { return { x: c.x + 0.5, y: c.y + 0.5, a: c.base + c.amp * Math.sin((2 * Math.PI * t) / c.period + c.phase) }; }
  const sources = (lv, t) => { const out = []; for (const g of lv.guards) out.push(guardState(g, t)); for (const c of lv.cams) out.push(camState(c, t)); return out; };

  // 시야: 부채꼴 안이고 사이에 벽이 없으면 보임
  function sees(lv, s, px, py) {
    const dx = px - s.x, dy = py - s.y, d = Math.hypot(dx, dy);
    if (d > lv.range) return false;
    if (d > 0.55 && Math.abs(angDiff(Math.atan2(dy, dx), s.a)) > lv.fov / 2) return false;
    for (let r = 0.55; r < d - 0.05; r += 0.2) if (isWall(lv, Math.floor(s.x + (dx / d) * r), Math.floor(s.y + (dy / d) * r))) return false;
    return true;
  }
  const seenAt = (lv, t, px, py) => { for (const s of sources(lv, t)) if (sees(lv, s, px, py)) return true; return false; };

  // ---------- 풀이 검색: 시간을 함께 보며 칸 단위로 움직여 열쇠를 모두 줍고 출구로 갈 수 있는가 ----------
  const PAD_FOV = 0.3, PAD_RANGE = 0.4;                // 풀이 검색은 시야를 조금 크게 잡아서(여유), 실제로 따라가도 걸리지 않게 함
  function visibility(lv0) {
    const lv = Object.assign({}, lv0, { fov: lv0.fov + PAD_FOV, range: lv0.range + PAD_RANGE });
    // 네 번에 한 걸음(0.0625초) 간격으로, 각 칸이 보이는지
    const n = COLS * ROWS, steps = PHASES * 4, vis = new Uint8Array(steps * n);
    for (let k = 0; k < steps; k++) {
      const t = (k * Q) / 4, src = sources(lv, t);
      for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
        if (lv.tiles[cy][cx] === '#') continue;
        for (const s of src) if (sees(lv, s, cx + 0.5, cy + 0.5)) { vis[k * n + cy * COLS + cx] = 1; break; }
      }
    }
    return vis;
  }
  function solve(lv, vis, wantPath) {
    const n = COLS * ROWS, K = lv.keys.length, M = 1 << K;
    vis = vis || visibility(lv);
    const keyAt = new Int8Array(n).fill(-1); lv.keys.forEach((k, i) => { keyAt[k.y * COLS + k.x] = i; });
    const exitCell = lv.exit.y * COLS + lv.exit.x, startCell = lv.start.y * COLS + lv.start.x;
    const seen = new Uint8Array(PHASES * n * M);
    const parent = wantPath ? new Int32Array(PHASES * n * M).fill(-1) : null, pmove = wantPath ? new Int8Array(PHASES * n * M) : null;
    const idx = (p, c, m) => (p * n + c) * M + m;
    if (vis[startCell]) return null;
    let cur = [[startCell, 0]], t = 0;
    seen[idx(0, startCell, 0)] = 1;
    const dirs = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let step = 0; step < PHASES * 6; step++) {
      const p = step % PHASES, np = (step + 1) % PHASES, next = [];
      for (const [c, m] of cur) {
        const cx = c % COLS, cy = (c / COLS) | 0;
        for (let di = 0; di < dirs.length; di++) {
          const [dx, dy] = dirs[di];
          const nx = cx + dx, ny = cy + dy;
          if (isWall(lv, nx, ny)) continue;
          const nc = ny * COLS + nx;
          let hit = vis[(4 * np) * n + nc] === 1;                                   // 걸음 사이 세 번 · 도착 순간 모두, 출발·도착 칸 어느 쪽도 안 보여야 함
          for (let j = 1; j <= 3 && !hit; j++) hit = vis[(4 * p + j) * n + c] === 1 || vis[(4 * p + j) * n + nc] === 1;
          if (hit) continue;
          let nm = m; if (keyAt[nc] >= 0) nm |= 1 << keyAt[nc];
          if (nc === exitCell && nm === M - 1) {
            if (!wantPath) return (step + 1) * Q;
            const moves = [di]; let id = idx(p, c, m);
            while (parent[id] >= 0) { moves.push(pmove[id]); id = parent[id]; }
            return { time: (step + 1) * Q, moves: moves.reverse() };
          }
          const id = idx(np, nc, nm);
          if (seen[id]) continue;
          seen[id] = 1; next.push([nc, nm]);
          if (wantPath) { parent[id] = idx(p, c, m); pmove[id] = di; }
        }
      }
      if (!next.length) return null;
      cur = next; t = step;
    }
    void t;
    return null;
  }
  // 경비가 없다고 했을 때 가장 짧은 시간(어렵지 않은 단계를 거르는 데 씀)
  function trivialTime(lv) {
    const n = COLS * ROWS, K = lv.keys.length, M = 1 << K;
    const keyAt = new Int8Array(n).fill(-1); lv.keys.forEach((k, i) => { keyAt[k.y * COLS + k.x] = i; });
    const seen = new Uint8Array(n * M); const s = lv.start.y * COLS + lv.start.x; seen[s * M] = 1;
    let cur = [[s, 0]];
    for (let step = 0; step < 400; step++) {
      const next = [];
      for (const [c, m] of cur) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = (c % COLS) + dx, ny = ((c / COLS) | 0) + dy; if (isWall(lv, nx, ny)) continue;
        const nc = ny * COLS + nx; let nm = m; if (keyAt[nc] >= 0) nm |= 1 << keyAt[nc];
        if (nc === lv.exit.y * COLS + lv.exit.x && nm === M - 1) return (step + 1) * Q;
        if (seen[nc * M + nm]) continue; seen[nc * M + nm] = 1; next.push([nc, nm]);
      }
      cur = next;
    }
    return null;
  }

  // ---------- 단계 만들기 ----------
  function reach(lv, from) {
    const dist = new Int16Array(COLS * ROWS).fill(-1); const q = [from]; dist[from] = 0;
    for (let i = 0; i < q.length; i++) { const c = q[i]; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = (c % COLS) + dx, ny = ((c / COLS) | 0) + dy; if (isWall(lv, nx, ny)) continue; const nc = ny * COLS + nx; if (dist[nc] < 0) { dist[nc] = dist[c] + 1; q.push(nc); } } }
    return dist;
  }
  function attempt(rand, level, stage, pstage) {
    const sp = stageParams(level, pstage === undefined ? stage : pstage);
    const tiles = Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? '#' : '.')));
    const lv = { tiles: null, start: { x: 1, y: ROWS - 2 }, exit: { x: COLS - 2, y: 1 }, keys: [], guards: [], cams: [], fov: sp.fov, range: sp.range, detect: sp.detect, stage, level };
    for (let b = 0; b < sp.blocks; b++) {
      const w = 1 + Math.floor(rand() * 3), h = 1 + Math.floor(rand() * 3), x0 = 1 + Math.floor(rand() * (COLS - 2 - w)), y0 = 1 + Math.floor(rand() * (ROWS - 2 - h));
      let bad = false;
      for (let y = y0 - 1; y <= y0 + h; y++) for (let x = x0 - 1; x <= x0 + w; x++) if ((x <= 2 && y >= ROWS - 4) || (x >= COLS - 3 && y <= 2)) bad = true;      // 시작·출구 둘레는 비움
      if (bad) continue;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) tiles[y][x] = '#';
    }
    lv.tiles = tiles.map((r) => r.join(''));
    const start = lv.start.y * COLS + lv.start.x, dist = reach(lv, start);
    if (dist[lv.exit.y * COLS + lv.exit.x] < 0) return null;
    // 닿을 수 있는 칸들 (벽에 갇힌 빈 칸이 있으면 쓰지 않음)
    const open = []; for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) if (dist[y * COLS + x] >= 0) open.push([x, y]);
    if (open.length < 80) return null;
    // 열쇠: 시작에서 멀고 서로 떨어진 칸
    const far = open.filter(([x, y]) => dist[y * COLS + x] >= 8 && !(x === lv.exit.x && y === lv.exit.y));
    if (far.length < sp.keys) return null;
    for (let k = 0; k < sp.keys; k++) {
      for (let tries = 0; tries < 30; tries++) { const [x, y] = far[Math.floor(rand() * far.length)]; if (lv.keys.every((q) => Math.abs(q.x - x) + Math.abs(q.y - y) >= 5)) { lv.keys.push({ x, y }); break; } }
    }
    if (lv.keys.length < sp.keys) return null;
    // 경비: 곧은 길 위를 왕복
    const periods = stage <= 2 ? [12, 24] : [8, 12, 24];                // 모두 공통 주기(24초)를 나누는 값이어야 풀이 검색이 맞음
    for (let g = 0; g < sp.guards; g++) {
      let made = false;
      for (let tries = 0; tries < 60 && !made; tries++) {
        const [x, y] = open[Math.floor(rand() * open.length)], horiz = rand() < 0.5, d = rand() < 0.5 ? 1 : -1;
        if (Math.abs(x - lv.start.x) + Math.abs(y - lv.start.y) < 6) continue;
        let len = 0; while (len < 8 && !isWall(lv, x + (horiz ? d * (len + 1) : 0), y + (horiz ? 0 : d * (len + 1)))) len++;
        if (len < 4) continue;
        len = 4 + Math.floor(rand() * (len - 3));
        const a = [x, y], b = [x + (horiz ? d * len : 0), y + (horiz ? 0 : d * len)];
        if (Math.abs(b[0] - lv.start.x) + Math.abs(b[1] - lv.start.y) < 5) continue;
        const period = periods[Math.floor(rand() * periods.length)], pause = 1, segTime = period / 2 - pause;
        lv.guards.push({ a, b, period, pause, segTime }); made = true;
      }
    }
    // 카메라: 벽에 붙어 부채꼴로 휘젓기
    for (let c = 0; c < sp.cams; c++) {
      for (let tries = 0; tries < 80; tries++) {
        const x = 1 + Math.floor(rand() * (COLS - 2)), y = 1 + Math.floor(rand() * (ROWS - 2));
        if (lv.tiles[y][x] !== '#') continue;
        const opens = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => !isWall(lv, x + dx, y + dy) && dist[(y + dy) * COLS + x + dx] >= 0);
        if (!opens.length || Math.abs(x - lv.start.x) + Math.abs(y - lv.start.y) < 6) continue;
        const [dx, dy] = opens[Math.floor(rand() * opens.length)];
        lv.cams.push({ x, y, base: Math.atan2(dy, dx), amp: (50 + rand() * 30) * Math.PI / 180, period: [6, 8, 12][Math.floor(rand() * 3)], phase: rand() * Math.PI * 2 });
        break;
      }
    }
    return lv;
  }

  // 풀 수 있는 단계를 만들어 돌려준다 (풀이 시간 solveTime 과 기준 시간 par 포함)
  function generateLevel(seed, stage, level) {
    const rand = rng(seed * 2654435761 + stage * 97 + 13);
    let best = null;
    for (const easeBy of [0, 1, 2, 4, 6]) {                              // 못 만들면 한두 단계 쉬운 설정으로
      for (let tries = 0; tries < 40; tries++) {
        const lv = attempt(rand, level, stage, Math.max(1, stage - easeBy));
        if (!lv) continue;
        const vis = visibility(lv), t = solve(lv, vis);
        if (t === null) continue;
        const triv = trivialTime(lv);
        lv.solveTime = t; lv.trivial = triv;
        if (!best || t < best.solveTime) best = lv;
        if (t > 45) continue;                                             // 너무 오래 기다려야 하는 단계는 거름
        if (stage === 1 || t - triv >= 2) { best = lv; break; }
      }
      if (best) break;
    }
    if (!best) throw new Error('no solvable level for stage ' + stage);
    best.par = Math.round(best.solveTime * 1.6 + 6);
    best.seed = seed;
    return best;
  }

  // ---------- 게임 ----------
  function newGame(rand, opts = {}) {
    rand = rand || Math.random;
    const level = LEVELS[opts.level] ? opts.level : 'normal';
    const stage = opts.stage || 1;
    const seed = opts.seed !== undefined ? opts.seed : Math.floor(rand() * 1e6);
    const lv = opts.levelData || generateLevel(seed, stage, level);
    const lives = opts.lives !== undefined ? opts.lives : LEVELS[level].lives;
    const st = { rand, level, seed, stage, lv, params: LEVELS[level], lives, infinite: LEVELS[level].lives === 0, stars: opts.stars || 0, caughtTotal: opts.caughtTotal || 0, tutorial: !!opts.tutorial,
      p: { x: lv.start.x + 0.5, y: lv.start.y + 0.5 }, inp: { x: 0, y: 0 }, t: 0, alert: 0, keys: lv.keys.map(() => false), status: 'play', caughtHere: 0, moved: 0, events: [], over: false, seenFlag: false, spotted: false };
    return st;
  }
  function setInput(st, x, y) { const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } st.inp.x = x; st.inp.y = y; }
  const blocked = (lv, x, y) => isWall(lv, Math.floor(x - PR), Math.floor(y - PR)) || isWall(lv, Math.floor(x + PR), Math.floor(y - PR)) || isWall(lv, Math.floor(x - PR), Math.floor(y + PR)) || isWall(lv, Math.floor(x + PR), Math.floor(y + PR));
  const allKeys = (st) => st.keys.every(Boolean);

  function step(st, dt) {
    if (st.status !== 'play') return;
    const lv = st.lv, p = st.p;
    st.t += dt;
    // 움직이기 (가로 세로 따로 나눠 벽에 미끄러짐)
    const vx = st.inp.x * SPEED * dt, vy = st.inp.y * SPEED * dt, ox = p.x, oy = p.y;
    if (!blocked(lv, p.x + vx, p.y)) p.x += vx;
    if (!blocked(lv, p.x, p.y + vy)) p.y += vy;
    st.moved += Math.hypot(p.x - ox, p.y - oy);
    // 열쇠 · 출구
    lv.keys.forEach((k, i) => {
      if (!st.keys[i] && Math.hypot(p.x - (k.x + 0.5), p.y - (k.y + 0.5)) < 0.55) { st.keys[i] = true; st.events.push({ type: 'key', i, left: st.keys.filter((v) => !v).length }); if (allKeys(st)) st.events.push({ type: 'unlock' }); }
    });
    if (allKeys(st) && Math.hypot(p.x - (lv.exit.x + 0.5), p.y - (lv.exit.y + 0.5)) < 0.6) { clear(st); return; }
    // 발각
    let seen = false;
    for (const s of sources(lv, st.t)) { if (sees(lv, s, p.x, p.y)) { seen = true; break; } }
    st.seenFlag = seen;
    if (seen) st.alert = Math.min(1, st.alert + dt / lv.detect); else st.alert = Math.max(0, st.alert - dt / st.params.decay);
    if (seen && !st.spotted && st.alert > 0.3) { st.spotted = true; st.events.push({ type: 'spotted' }); }
    if (st.alert >= 1) caught(st);
  }
  function caught(st) {
    st.status = 'caught'; st.caughtHere++; st.caughtTotal++;
    if (!st.infinite && !st.tutorial) st.lives--;
    st.events.push({ type: 'caught', lives: st.lives });
    if (!st.infinite && !st.tutorial && st.lives <= 0) { st.over = true; st.events.push({ type: 'over' }); }
  }
  // 같은 단계를 처음부터 다시
  function retry(st) {
    const lv = st.lv;
    st.p.x = lv.start.x + 0.5; st.p.y = lv.start.y + 0.5; st.t = 0; st.alert = 0; st.keys = lv.keys.map(() => false); st.status = 'play'; st.inp.x = st.inp.y = 0; st.seenFlag = false; st.spotted = false;
  }
  function clear(st) {
    st.status = 'cleared';
    const stars = st.caughtHere === 0 ? (st.t <= st.lv.par ? 3 : 2) : 1;
    st.stars += stars; st.lastStars = stars;
    st.events.push({ type: 'cleared', stage: st.stage, stars, t: st.t });
  }
  // 다음 단계 (목숨·별·발각 횟수는 이어 감)
  function nextStage(st) {
    return newGame(st.rand, { level: st.level, stage: st.stage + 1, seed: st.seed + 7919, lives: st.lives, stars: st.stars, caughtTotal: st.caughtTotal });
  }

  const api = { COLS, ROWS, SPEED, Q, PERIOD, PR, LEVELS, rng, stageParams, isWall, guardState, camState, sources, sees, seenAt, visibility, solve, trivialTime, DIRS: [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]], generateLevel, newGame, setInput, step, retry, nextStage, allKeys };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LOGIC_STEALTH = api;
})(typeof window !== 'undefined' ? window : globalThis);
