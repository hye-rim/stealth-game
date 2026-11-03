'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 스텔스: 화면·입력·소리. 규칙은 logic.js (LOGIC_STEALTH).
const L = LOGIC_STEALTH;
const $ = (id) => document.getElementById(id);
const W = 360, H = 640, T = 32;                    // 논리 크기, 한 칸의 크기
const OX = (W - L.COLS * T) / 2, OY = 76;          // 방을 그리는 왼쪽 위
const canvas = $('game'), ctx = canvas.getContext('2d');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('stealthMuted') === '1';
function tone(freq, dur, type = 'triangle', vol = 0.05, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
  } catch (_) {}
}
const sfx = {
  key: () => { tone(988, 0.08, 'triangle', 0.06); setTimeout(() => tone(1319, 0.14, 'triangle', 0.06), 70); },
  unlock: () => tone(660, 0.25, 'square', 0.04, 440),
  spotted: () => tone(300, 0.15, 'square', 0.05, 200),
  caught: () => { tone(220, 0.35, 'sawtooth', 0.07, -150); },
  cleared: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.15, 'triangle', 0.06), i * 100)),
  over: () => { tone(330, 0.2, 'sawtooth', 0.05, -120); setTimeout(() => tone(196, 0.35, 'sawtooth', 0.05, -80), 180); },
  best: () => [784, 988, 1175].forEach((f, i) => setTimeout(() => tone(f, 0.14, 'triangle', 0.05), i * 90)),
};

// ---------- 상태 ----------
let G = null;
let state = 'title';                    // title · play · paused · cleared · over
let level = 'easy', tut = false, clock = 0, floats = [], shake = 0, flash = 0, newBest = false, moveSig = false, alarm = 0;
let best = Number(store.get('stealthBest')) || 0;
const held = { left: false, right: false, up: false, down: false };
let stick = null;

/* @test-hooks:start */
window.__sl = { get G() { return G; }, get state() { return state; }, L, step: (dt) => update(dt), held, setStick: (dx, dy) => { stick = dx || dy ? { id: -1, ox: 180, oy: 500, x: 180 + dx, y: 500 + dy } : null; }, next: () => nextStage(), retry: () => retryStage() };
/* @test-hooks:end */

// ---------- 흐름 ----------
function showOverlay(html) {
  const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden');
  o.querySelectorAll('button[data-level]').forEach((b) => { b.onclick = () => start(b.dataset.level); });
  o.querySelectorAll('button[data-resume]').forEach((b) => { b.onclick = resume; });
  o.querySelectorAll('button[data-next]').forEach((b) => { b.onclick = nextStage; });
  o.querySelectorAll('button[data-quit]').forEach((b) => { b.onclick = () => { hideOverlay(); showTitle(); }; });
}
function hideOverlay() { $('overlay').classList.add('hidden'); }
let daily = false;                                                   // 이번 판이 오늘의 판인가 (로비의 daily.js)
const lvButtons = () => `<div class="lv"><button data-level="easy">쉬움<small>발각돼도 계속 · 느슨한 시야</small></button><button data-level="normal">보통<small>목숨 3 · 기록</small></button>${window.arcadeDaily ? arcadeDaily.buttonHtml() : ''}</div>`;
function showTitle() {
  state = 'title';
  showOverlay(`<h1>스텔스</h1><p>경비의 <b>시야(노란 부채꼴)</b>를 피해<br><b>열쇠 🔑</b>를 모두 줍고 <b>출구 🚪</b>로 가세요!</p>
    <p class="help">시야에 오래 있으면 머리 위 게이지가 차올라 <b>발각</b>돼요.<br>경비의 움직임은 매번 같아요. 타이밍을 노려요!</p>
    ${best ? `<div class="big">최고 ${best}단계</div>` : ''}${lvButtons()}<p class="note"><span class="pc">방향키 · WASD · 마우스로 끌기</span><span class="touch">화면에 손을 대고 끌어서 움직이기</span></p>`);
}
function start(lv) {
  tut = /[?&]tutorial=1/.test(location.search);
  if (tut) lv = 'easy';
  level = lv === 'normal' ? 'normal' : 'easy';
  daily = !tut && lv === 'normal' && !!(window.arcadeDaily && arcadeDaily.take());
  try {
    G = tut ? L.newGame(Math.random, { level, stage: 1, seed: 20, tutorial: true }) : L.newGame(Math.random, daily ? { level, stage: 1, seed: arcadeDaily.seed() } : { level, stage: 1 });
  } catch (e) { G = L.newGame(Math.random, { level, stage: 1, seed: 1 }); }
  resetFx(); newBest = false;
  state = 'play'; hideOverlay();
}
function resetFx() { floats = []; shake = 0; flash = 0; moveSig = false; alarm = 0; stick = null; Object.keys(held).forEach((k) => { held[k] = false; }); }
function nextStage() {
  if (state !== 'cleared') return;
  try { G = L.nextStage(G); } catch (e) { G = L.newGame(Math.random, { level, stage: G.stage + 1, seed: G.seed + 1, lives: G.lives, stars: G.stars, caughtTotal: G.caughtTotal }); }
  resetFx(); state = 'play'; hideOverlay();
}
function retryStage() { L.retry(G); resetFx(); state = 'play'; hideOverlay(); }
function onCaught() {
  state = 'caught'; sfx.caught(); shake = 0.4; flash = 0.5; stick = null;
  if (G.over) { gameOver(); return; }
  setTimeout(() => { if (state === 'caught') retryStage(); }, 1100);
}
function gameOver() {
  state = 'over'; sfx.over();
  const reached = G.stage - 1;
  if (!tut && window.arcadeRun) arcadeRun({ level, bad: reached <= 1 });         // 연패 구제(로비): 1단계도 못 넘기면 나쁜 판               // 끝난 단계 전까지 클리어한 수 (기록은 클리어할 때마다 이미 저장해 둠)
  if (newBest) setTimeout(sfx.best, 500);
  setTimeout(() => {
    if (state !== 'over') return;
    showOverlay(`<h2>발각됐어요!</h2><div class="big">${reached}단계 클리어</div><p>⭐ ${G.stars}개 · 발각 ${G.caughtTotal}번${newBest ? ' · 🎉 새 최고 기록!' : level === 'normal' ? ` · 최고 ${best}단계` : ''}</p>${daily ? arcadeDaily.result('스텔스', reached, '단계') : ''}${lvButtons()}`);
  }, 900);
}
function onCleared(ev) {
  state = 'cleared'; sfx.cleared(); stick = null;
  if (level === 'normal' && !tut && G.stage > best) { best = G.stage; newBest = true; store.set('stealthBest', String(best)); }
  setTimeout(() => {
    if (state !== 'cleared') return;
    const stars = '⭐'.repeat(ev.stars) + '☆'.repeat(3 - ev.stars);
    showOverlay(`<h2>${G.stage}단계 성공!</h2><div class="big">${stars}</div><p>${ev.t.toFixed(1)}초 · 기준 ${G.lv.par}초${G.caughtHere ? ` · 발각 ${G.caughtHere}번` : ' · 한 번도 안 들켰어요!'}${newBest ? '<br>🎉 새 최고 기록!' : ''}</p><button data-next="1">다음 단계 ▶</button>`);
  }, 700);
}
function pause() { if (state !== 'play') return; state = 'paused'; stick = null; showOverlay(`<h2>일시정지</h2><button data-resume="1">계속하기</button><button data-quit="1" style="background:rgba(255,255,255,.14);color:#fff;box-shadow:none;font-size:14px;padding:9px 22px">그만하고 처음으로</button>`); }
function resume() { if (state !== 'paused') return; state = 'play'; hideOverlay(); }
function toggleMute() { muted = !muted; store.set('stealthMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }

// ---------- 입력 ----------
const STICK_MAX = 46;
function toGame(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; }
canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); if (state !== 'play' || stick) return; const p = toGame(e); stick = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y }; try { canvas.setPointerCapture(e.pointerId); } catch (_) {} });
canvas.addEventListener('pointermove', (e) => { if (stick && stick.id === e.pointerId) { const p = toGame(e); stick.x = p.x; stick.y = p.y; } });
const up = (e) => { if (stick && stick.id === e.pointerId) stick = null; };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
addEventListener('keydown', (e) => {
  const c = e.code;
  if (c === 'KeyP') { if (!e.repeat) state === 'paused' ? resume() : pause(); return; }
  if (c === 'KeyM') { if (!e.repeat) toggleMute(); return; }
  let used = true;
  if (c === 'ArrowLeft' || c === 'KeyA') held.left = true; else if (c === 'ArrowRight' || c === 'KeyD') held.right = true;
  else if (c === 'ArrowUp' || c === 'KeyW') held.up = true; else if (c === 'ArrowDown' || c === 'KeyS') held.down = true; else used = false;
  if (used && state === 'play') e.preventDefault();
});
addEventListener('keyup', (e) => {
  const c = e.code;
  if (c === 'ArrowLeft' || c === 'KeyA') held.left = false; else if (c === 'ArrowRight' || c === 'KeyD') held.right = false;
  else if (c === 'ArrowUp' || c === 'KeyW') held.up = false; else if (c === 'ArrowDown' || c === 'KeyS') held.down = false;
});
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
addEventListener('blur', () => { Object.keys(held).forEach((k) => { held[k] = false; }); pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
function fit() { const s = Math.min(innerWidth / W, innerHeight / H); canvas.style.width = `${Math.floor(W * s)}px`; canvas.style.height = `${Math.floor(H * s)}px`; $('wrap').style.width = canvas.style.width; $('wrap').style.height = canvas.style.height; }
addEventListener('resize', fit); fit();
$('muteBtn').textContent = muted ? '🔇' : '🔊';

function readInput() {
  let ix = 0, iy = 0;
  if (stick) { const dx = stick.x - stick.ox, dy = stick.y - stick.oy, len = Math.hypot(dx, dy); if (len > 5) { const k = Math.min(1, len / STICK_MAX); ix = dx / len * k; iy = dy / len * k; } }
  if (held.left) ix -= 1; if (held.right) ix += 1; if (held.up) iy -= 1; if (held.down) iy += 1;
  // 조이스틱은 살짝만 밀어도 풀 속도(정밀한 타이밍을 위해 속도는 일정)
  const l = Math.hypot(ix, iy); if (l > 0.35) { ix /= l; iy /= l; } else { ix = 0; iy = 0; }
  return [ix, iy];
}

// ---------- 갱신 ----------
function update(dt) {
  clock += dt;
  if (!G) return;
  if (state === 'play') {
    const [ix, iy] = readInput(); L.setInput(G, ix, iy);
    L.step(G, dt);
    for (const ev of G.events) onEvent(ev);
    G.events.length = 0;
    if (!moveSig && G.moved >= 2) { moveSig = true; tutorialSignal('move'); }
    alarm = G.seenFlag ? Math.min(1, alarm + dt * 6) : Math.max(0, alarm - dt * 3);
  }
  for (const f of floats) f.t += dt; floats = floats.filter((f) => f.t < 1.2);
  shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt);
}
function onEvent(ev) {
  if (ev.type === 'key') { sfx.key(); tutorialSignal('key'); floats.push({ x: G.p.x, y: G.p.y - 0.8, t: 0, text: ev.left ? `🔑 남은 열쇠 ${ev.left}` : '🔑 모두 모았어요!', color: '#ffe36a' }); }
  else if (ev.type === 'unlock') { sfx.unlock(); floats.push({ x: G.lv.exit.x + 0.5, y: G.lv.exit.y + 1.4, t: 0, text: '출구가 열렸어요!', color: '#9dff9d' }); }
  else if (ev.type === 'spotted') { sfx.spotted(); tutorialSignal('spotted'); }
  else if (ev.type === 'caught') onCaught();
  else if (ev.type === 'cleared') { tutorialSignal('exit'); onCleared(ev); }
}

// ---------- 그리기 ----------
const sx = (x) => OX + x * T, sy = (y) => OY + y * T;
function drawCone(s, color, alpha) {
  const lv = G.lv, steps = 28, a0 = s.a - lv.fov / 2;
  ctx.beginPath(); ctx.moveTo(sx(s.x), sy(s.y));
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (lv.fov * i) / steps; let r = 0.55;
    const ca = Math.cos(a), sa = Math.sin(a);
    while (r < lv.range) { if (L.isWall(lv, Math.floor(s.x + ca * (r + 0.1)), Math.floor(s.y + sa * (r + 0.1)))) break; r += 0.1; }
    ctx.lineTo(sx(s.x + ca * Math.min(r, lv.range)), sy(s.y + sa * Math.min(r, lv.range)));
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(sx(s.x), sy(s.y), 4, sx(s.x), sy(s.y), lv.range * T);
  g.addColorStop(0, `rgba(${color},${alpha})`); g.addColorStop(1, `rgba(${color},${alpha * 0.25})`);
  ctx.fillStyle = g; ctx.fill();
}
function draw() {
  if (!G) { ctx.fillStyle = '#0a1020'; ctx.fillRect(0, 0, W, H); return; }
  const lv = G.lv;
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * 8 * shake * 2, (Math.random() - 0.5) * 8 * shake * 2);
  ctx.fillStyle = '#0a1020'; ctx.fillRect(0, 0, W, H);
  // 바닥과 벽
  for (let y = 0; y < L.ROWS; y++) for (let x = 0; x < L.COLS; x++) {
    if (lv.tiles[y][x] === '#') { ctx.fillStyle = '#39465e'; ctx.fillRect(sx(x), sy(y), T, T); ctx.fillStyle = '#4b5b78'; ctx.fillRect(sx(x), sy(y), T, 5); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(sx(x), sy(y) + T - 4, T, 4); }
    else { ctx.fillStyle = (x + y) % 2 ? '#1c2640' : '#1f2a46'; ctx.fillRect(sx(x), sy(y), T, T); }
  }
  // 출구 · 열쇠
  const open = L.allKeys(G), ex = lv.exit;
  ctx.fillStyle = open ? '#2fbf6a' : '#4a4f5e'; ctx.fillRect(sx(ex.x) + 3, sy(ex.y) + 3, T - 6, T - 6);
  ctx.font = '22px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(open ? '🚪' : '🔒', sx(ex.x) + T / 2, sy(ex.y) + 23);
  lv.keys.forEach((k, i) => { if (G.keys[i]) return; ctx.fillStyle = `rgba(255,220,80,${0.25 + 0.15 * Math.sin(clock * 5)})`; ctx.beginPath(); ctx.arc(sx(k.x + 0.5), sy(k.y + 0.5), 15, 0, 7); ctx.fill(); ctx.font = '22px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('🔑', sx(k.x + 0.5), sy(k.y + 0.5) + 8); });
  // 시야 (경비 · 카메라)
  const guards = lv.guards.map((g) => L.guardState(g, G.t)), cams = lv.cams.map((c) => L.camState(c, G.t));
  const seenColor = G.seenFlag ? '255,90,70' : '255,214,80';
  for (const s of guards) drawCone(s, seenColor, 0.38);
  for (const s of cams) drawCone(s, G.seenFlag ? '255,90,70' : '255,120,160', 0.3);
  // 경비 · 카메라
  for (const s of guards) {
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.arc(sx(s.x) + 2, sy(s.y) + 3, 11, 0, 7); ctx.fill();
    ctx.fillStyle = '#d83a3a'; ctx.beginPath(); ctx.arc(sx(s.x), sy(s.y), 11, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx(s.x) + Math.cos(s.a) * 6, sy(s.y) + Math.sin(s.a) * 6, 4, 0, 7); ctx.fill();
  }
  for (const s of cams) { ctx.save(); ctx.translate(sx(s.x), sy(s.y)); ctx.rotate(s.a); ctx.fillStyle = '#e8e8f0'; ctx.fillRect(-9, -7, 18, 14); ctx.fillStyle = '#d83a6a'; ctx.beginPath(); ctx.arc(8, 0, 5, 0, 7); ctx.fill(); ctx.restore(); }
  // 나
  const p = G.p;
  if (state !== 'cleared') {
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(sx(p.x) + 1, sy(p.y) + 3, 9, 0, 7); ctx.fill();
    ctx.fillStyle = state === 'caught' ? '#ff6a6a' : '#6ad0ff'; ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 9, 0, 7); ctx.fill();
    ctx.fillStyle = '#10243a'; ctx.fillRect(sx(p.x) - 9, sy(p.y) - 4, 18, 5);                   // 복면
    ctx.fillStyle = '#fff'; ctx.fillRect(sx(p.x) - 5, sy(p.y) - 3, 3, 3); ctx.fillRect(sx(p.x) + 2, sy(p.y) - 3, 3, 3);
    // 발각 게이지
    if (G.alert > 0.02) { const w = 34, x = sx(p.x) - w / 2, y = sy(p.y) - 22; ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - 1, y - 1, w + 2, 7); ctx.fillStyle = G.alert > 0.66 ? '#ff4a4a' : G.alert > 0.33 ? '#ffb02e' : '#ffe36a'; ctx.fillRect(x, y, w * G.alert, 5); if (G.seenFlag) { ctx.fillStyle = '#ff4a4a'; ctx.font = '900 14px sans-serif'; ctx.fillText('!', sx(p.x), y - 4); } }
  }
  ctx.font = '900 13px sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
  for (const f of floats) { const k = f.t / 1.2; ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color; ctx.strokeText(f.text, sx(f.x), sy(f.y) - k * 24); ctx.fillText(f.text, sx(f.x), sy(f.y) - k * 24); ctx.globalAlpha = 1; }
  ctx.restore();
  // 발각 직전엔 화면 가장자리가 붉게
  if (alarm > 0) { const r = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.7); r.addColorStop(0, 'rgba(255,40,40,0)'); r.addColorStop(1, `rgba(255,40,40,${0.35 * alarm * (0.5 + G.alert)})`); ctx.fillStyle = r; ctx.fillRect(0, 0, W, H); }
  if (flash > 0) { ctx.fillStyle = `rgba(255,60,60,${flash * 0.6})`; ctx.fillRect(0, 0, W, H); }
  // 조이스틱
  if (stick && state === 'play') { const dx = stick.x - stick.ox, dy = stick.y - stick.oy, len = Math.hypot(dx, dy) || 1, k = Math.min(1, len / STICK_MAX) * STICK_MAX; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(stick.ox, stick.oy, STICK_MAX, 0, 7); ctx.stroke(); ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.beginPath(); ctx.arc(stick.ox + dx / len * k, stick.oy + dy / len * k, 15, 0, 7); ctx.fill(); }
  drawHud();
}
function drawHud() {
  ctx.fillStyle = 'rgba(0,0,0,.42)'; ctx.fillRect(0, 0, W, 40);
  ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = '900 17px sans-serif'; ctx.fillText(tut ? '연습' : `${G.stage}단계`, 10, 26);
  const got = G.keys.filter(Boolean).length; ctx.font = '800 14px sans-serif'; ctx.fillStyle = '#ffe36a'; ctx.fillText(`🔑 ${got}/${G.keys.length}`, 94, 26);
  ctx.fillStyle = '#cfe3f5'; ctx.font = '700 12px sans-serif'; ctx.fillText(`${G.t.toFixed(0)}초`, 160, 26);
  if (!G.infinite && !tut) { ctx.fillStyle = '#ff6a7a'; ctx.font = '15px sans-serif'; ctx.fillText('♥'.repeat(Math.max(0, G.lives)) + '♡'.repeat(Math.max(0, G.params.lives - Math.max(0, G.lives))), 10, 56); }
  if (!tut) { ctx.textAlign = 'right'; ctx.fillStyle = '#ffe9a8'; ctx.font = '700 11px sans-serif'; ctx.fillText(`⭐ ${G.stars}`, 218, 26); }
  if (state === 'play' && G.t < 4 && !tut) { ctx.textAlign = 'center'; ctx.fillStyle = `rgba(255,255,255,${0.6 + 0.4 * Math.sin(clock * 5)})`; ctx.font = '800 13px sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText('화면을 끌어서 움직이세요', W / 2, H - 16); ctx.fillText('화면을 끌어서 움직이세요', W / 2, H - 16); }
  if (state === 'caught') { ctx.textAlign = 'center'; ctx.fillStyle = '#ff6a6a'; ctx.font = '900 34px sans-serif'; ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.strokeText('발각!', W / 2, H / 2); ctx.fillText('발각!', W / 2, H / 2); }
}

let last = performance.now();
function frame(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; update(dt); draw(); requestAnimationFrame(frame); }
showTitle();
requestAnimationFrame(frame);
