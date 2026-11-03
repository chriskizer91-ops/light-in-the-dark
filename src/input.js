import { $, canvas, IS_TOUCH, clamp } from './engine.js';
import { P, G } from './state.js';
import { initAudio } from './audio.js';

// =====================================================================
//  INPUT — keyboard + mouse (pointer lock), touch (left thumb walks, right
//  thumb looks, the Crown's buttons), and gamepads.
// =====================================================================
export const keys = {};
const stick = { id: null, ox: 0, oy: 0, vx: 0, vy: 0 };
const look = { id: null, x: 0, y: 0 };
export const A = { slash() {}, dash() {}, flare() {}, pulse() {}, mode() {}, setMode() {}, use() {}, tricks() {}, pause() {}, resume() {}, talkKey: null, talkAdvance: null }; // filled by main
const playing = () => G.state === 'playing';

addEventListener('keydown', (e) => {
  if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
  keys[e.code] = true;
  if (G.talk && A.talkKey) { if (e.code !== 'Escape' && e.code !== 'KeyT') e.preventDefault(); A.talkKey(e.code); return; } // a conversation is open
  if (e.code === 'KeyT' && (playing() || G.state === 'menu')) A.tricks();
  if (!playing() || G.paused) return;
  if (e.code === 'Space') { e.preventDefault(); A.slash(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') A.dash();
  if (e.code === 'KeyF') A.flare();
  if (e.code === 'KeyE') A.pulse();
  if (e.code === 'KeyQ') A.mode();
  if (e.code === 'Digit1') A.setMode(0); if (e.code === 'Digit2') A.setMode(1); if (e.code === 'Digit3') A.setMode(2);
  if (e.code === 'KeyR') A.use();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

export function tryLock() {
  if (IS_TOUCH || document.pointerLockElement === canvas) return;
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* drag-to-look still works */ }
}
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && playing() && !IS_TOUCH && !G.paused && !G.talk) A.pause(); });
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || !playing() || G.paused) return;
  P.yaw -= e.movementX * 0.0022; P.pitch -= e.movementY * 0.0022;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  initAudio();
  if (!playing()) return;
  if (G.talk && A.talkAdvance && e.pointerType === 'mouse' && document.pointerLockElement === canvas) { A.talkAdvance(); return; }
  if (e.pointerType === 'mouse') {
    if (document.pointerLockElement !== canvas) { tryLock(); if (G.paused) A.resume(); look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY; return; }
    if (e.button === 0) A.slash(); else if (e.button === 2) A.flare();
    return;
  }
  if (e.clientX < innerWidth * 0.45 && stick.id === null) {
    stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.vx = stick.vy = 0;
    const jb = $('joyBase'); jb.style.left = e.clientX + 'px'; jb.style.top = e.clientY + 'px'; jb.classList.add('on');
    $('joyKnob').style.transform = 'translate(0,0)';
  } else if (look.id === null) { look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY; }
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
  e.preventDefault();
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === stick.id) {
    let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy; const L = Math.hypot(dx, dy), R = 50;
    if (L > R) { dx = (dx / L) * R; dy = (dy / L) * R; }
    stick.vx = dx / R; stick.vy = dy / R; $('joyKnob').style.transform = `translate(${dx}px,${dy}px)`;
  } else if (e.pointerId === look.id) {
    if (document.pointerLockElement === canvas || !playing() || G.paused) return;
    const s = e.pointerType === 'mouse' ? 0.0035 : 0.0062;
    P.yaw -= (e.clientX - look.x) * s; P.pitch -= (e.clientY - look.y) * s; look.x = e.clientX; look.y = e.clientY;
  }
});
const endPointer = (e) => {
  if (e.pointerId === stick.id) { stick.id = null; stick.vx = stick.vy = 0; $('joyBase').classList.remove('on'); }
  if (e.pointerId === look.id) look.id = null;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

function bindBtn(id, fn) {
  const el = $(id);
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); initAudio(); if (playing() && !G.paused) fn(); el.classList.add('on'); });
  const off = () => el.classList.remove('on');
  el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
  el.addEventListener('click', (e) => e.preventDefault());
}
bindBtn('bSlash', () => A.slash()); bindBtn('bDash', () => A.dash()); bindBtn('bFlare', () => A.flare());
bindBtn('bPulse', () => A.pulse()); bindBtn('bLight', () => A.mode()); bindBtn('bUse', () => A.use());

// ---------- gamepads ----------
const padPrev = {};
function pad() { try { for (const p of navigator.getGamepads ? navigator.getGamepads() : []) if (p && p.connected !== false) return p; } catch (e) { /* none */ } return null; }

// returns the move vector (x right, y forward) and applies look from sticks
export function readMove(dt) {
  let mx = 0, mz = 0;
  if (keys.KeyW || keys.ArrowUp) mz += 1; if (keys.KeyS || keys.ArrowDown) mz -= 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1; if (keys.KeyD || keys.ArrowRight) mx += 1;
  mx += stick.vx; mz -= stick.vy;
  const gp = pad();
  if (gp && playing() && !G.paused) {
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    mx += dz(gp.axes[0] || 0); mz -= dz(gp.axes[1] || 0);
    P.yaw -= dz(gp.axes[2] || 0) * dt * 2.6; P.pitch -= dz(gp.axes[3] || 0) * dt * 2.0;
    const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed), edge = (i, fn) => { const v = b(i); if (v && !padPrev[i]) fn(); padPrev[i] = v; };
    edge(7, () => A.slash()); edge(0, () => A.slash()); edge(1, () => A.dash()); edge(2, () => A.pulse()); edge(3, () => A.use());
    edge(4, () => A.mode()); edge(5, () => A.flare()); edge(6, () => A.flare()); edge(9, () => A.tricks());
  }
  const L = Math.hypot(mx, mz); if (L > 1) { mx /= L; mz /= L; }
  return [mx, mz];
}
export { stick };
