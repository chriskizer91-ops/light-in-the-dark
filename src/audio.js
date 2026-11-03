import { mr, rr, clamp, lerp, settings } from './engine.js';

// =====================================================================
//  AUDIO — all synthesized. The bed (wind, insects that go quiet when a
//  hunter is close, positional rustles, heartbeat) is Eyeshine's; the
//  combat sounds stand in for the Crown's.
// =====================================================================
export const AU = { ctx: null, floor: 3 };
export function setAmbience(floor) { AU.floor = floor; }

export function initAudio() {
  if (AU.ctx) { if (AU.ctx.state !== 'running') AU.ctx.resume().catch(() => {}); return; }
  try { AU.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AU.ctx = null; return; }
  const ctx = AU.ctx;
  AU.master = ctx.createGain(); AU.master.gain.value = settings.sound ? 0.9 : 0; AU.master.connect(ctx.destination);
  const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  AU.noise = buf;
  // wind in the canopy, far overhead
  const w = ctx.createBufferSource(); w.buffer = buf; w.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 0.3;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06; const lfoG = ctx.createGain(); lfoG.gain.value = 160;
  lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
  AU.wind = ctx.createGain(); AU.wind.gain.value = 0.04; w.connect(lp); lp.connect(AU.wind); AU.wind.connect(AU.master); w.start();
  // insects: they go quiet when something is close
  AU.bugs = ctx.createGain(); AU.bugs.gain.value = 0; AU.bugs.connect(AU.master);
  if (ctx.createConstantSource) { makeCricket(AU.bugs, 4300, 31, 2.1, 0, -0.5); makeCricket(AU.bugs, 4750, 27, 1.6, 0.4, 0.6); }
  // a low drone under everything, in the key of the Deep Woods
  AU.drone = ctx.createGain(); AU.drone.gain.value = 0; AU.drone.connect(AU.master);
  for (const [f, v] of [[41.2, 1], [61.7, 0.5], [82.4, 0.25]]) { const o = ctx.createOscillator(); o.frequency.value = f; const g = ctx.createGain(); g.gain.value = v * 0.05; o.connect(g); g.connect(AU.drone); o.start(); }
  AU.nextHeart = 0; AU.nextAmb = ctx.currentTime + mr(8, 16); AU.nextCrackle = 0;
}
function makeCricket(dest, freq, rate, chirp, delay, panV) {
  const ctx = AU.ctx, car = ctx.createOscillator(); car.frequency.value = freq;
  const am = ctx.createGain(); am.gain.value = 0;
  const l1 = ctx.createOscillator(); l1.frequency.value = rate; const l1g = ctx.createGain(); l1g.gain.value = 0.5;
  const o1 = ctx.createConstantSource(); o1.offset.value = 0.5; l1.connect(l1g); l1g.connect(am.gain); o1.connect(am.gain);
  const gate = ctx.createGain(); gate.gain.value = 0;
  const l2 = ctx.createOscillator(); l2.type = 'square'; l2.frequency.value = chirp; const l2g = ctx.createGain(); l2g.gain.value = 0.5;
  const o2 = ctx.createConstantSource(); o2.offset.value = 0.5; l2.connect(l2g); l2g.connect(gate.gain); o2.connect(gate.gain);
  const vol = ctx.createGain(); vol.gain.value = 0.026;
  car.connect(am); am.connect(gate); gate.connect(vol);
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = panV; vol.connect(p); p.connect(dest); } else vol.connect(dest);
  const t = ctx.currentTime + delay; [car, l1, l2, o1, o2].forEach((n) => n.start(t));
}
function env(g, t, a, peak, dcy) {
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
}
function noiseShot({ type = 'bandpass', freq = 1000, f1 = 0, q = 1, a = 0.005, peak = 0.3, dcy = 0.2, at = 0, dest = null }) {
  const ctx = AU.ctx; if (!ctx) return;
  const t = ctx.currentTime + at, s = ctx.createBufferSource(); s.buffer = AU.noise;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + a + dcy); f.Q.value = q;
  const g = ctx.createGain(); env(g, t, a, peak, dcy);
  s.connect(f); f.connect(g); g.connect(dest || AU.master); s.start(t, Math.random() * 1.5); s.stop(t + a + dcy + 0.05);
}
function tone({ type = 'sine', f0 = 440, f1 = 0, a = 0.01, peak = 0.2, dcy = 0.3, at = 0, dest = null, lp = 0 }) {
  const ctx = AU.ctx; if (!ctx) return;
  const t = ctx.currentTime + at, o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + a + dcy);
  const g = ctx.createGain(); env(g, t, a, peak, dcy);
  let n = o; if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); n = f; }
  n.connect(g); g.connect(dest || AU.master); o.start(t); o.stop(t + a + dcy + 0.05);
}
function panner(x, y, z) {
  const ctx = AU.ctx, p = ctx.createPanner();
  p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 3; p.rolloffFactor = 1.1; p.maxDistance = 120;
  if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
  p.connect(AU.master); return p;
}
const at3 = (e, y = 0.8) => (AU.ctx ? panner(e.x, y, e.z) : null);

export const sfx = {
  step() { noiseShot({ freq: 720 * mr(0.85, 1.15), q: 0.9, a: 0.004, peak: 0.1, dcy: 0.1 }); if (Math.random() < 0.5) noiseShot({ type: 'highpass', freq: 3200, a: 0.002, peak: 0.03, dcy: 0.05, at: 0.03 }); },
  shutter(m) { noiseShot({ type: 'highpass', freq: 2400, a: 0.001, peak: 0.2, dcy: 0.03 }); noiseShot({ type: 'highpass', freq: 1800, a: 0.001, peak: 0.14, dcy: 0.03, at: 0.06 }); tone({ f0: 300 + m * 120, f1: 220 + m * 90, a: 0.01, peak: 0.05, dcy: 0.2 }); },
  slash() { noiseShot({ type: 'bandpass', freq: 900, f1: 3200, q: 1.2, a: 0.02, peak: 0.28, dcy: 0.16 }); },
  hit(exposed) { noiseShot({ type: 'lowpass', freq: 900, a: 0.002, peak: 0.55, dcy: 0.12 }); tone({ type: 'triangle', f0: exposed ? 220 : 160, f1: 70, a: 0.003, peak: 0.3, dcy: 0.16 }); if (exposed) tone({ f0: 880, f1: 1320, a: 0.005, peak: 0.08, dcy: 0.25, at: 0.02 }); },
  block() { tone({ type: 'square', f0: 1400, f1: 900, a: 0.002, peak: 0.08, dcy: 0.12, lp: 3000 }); noiseShot({ type: 'highpass', freq: 3000, a: 0.001, peak: 0.25, dcy: 0.05 }); },
  kill(e) { const p = at3(e); noiseShot({ type: 'lowpass', freq: 600, a: 0.01, peak: 0.5, dcy: 0.5, dest: p }); tone({ type: 'sawtooth', f0: 180, f1: 60, a: 0.01, peak: 0.12, dcy: 0.5, lp: 900, dest: p }); },
  hurt() { noiseShot({ type: 'lowpass', freq: 500, a: 0.003, peak: 0.6, dcy: 0.18 }); tone({ type: 'sawtooth', f0: 110, f1: 70, a: 0.005, peak: 0.18, dcy: 0.25, lp: 600 }); },
  dash() { noiseShot({ type: 'bandpass', freq: 500, f1: 1500, q: 0.8, a: 0.01, peak: 0.25, dcy: 0.2 }); },
  flare() { noiseShot({ type: 'lowpass', freq: 3000, f1: 300, a: 0.005, peak: 0.7, dcy: 0.9 }); tone({ f0: 90, f1: 40, a: 0.005, peak: 0.5, dcy: 0.6 }); noiseShot({ type: 'highpass', freq: 5000, a: 0.02, peak: 0.12, dcy: 1.0, at: 0.05 }); },
  pulse() { tone({ f0: 520, f1: 130, a: 0.004, peak: 0.25, dcy: 0.45 }); tone({ f0: 780, f1: 195, a: 0.004, peak: 0.1, dcy: 0.4 }); },
  expose(e) { const p = at3(e); tone({ f0: 1200, f1: 1800, a: 0.004, peak: 0.12, dcy: 0.2, dest: p }); noiseShot({ type: 'highpass', freq: 4000, a: 0.001, peak: 0.2, dcy: 0.06, dest: p }); },
  ignite(b) { const p = at3(b, 1.2); noiseShot({ type: 'lowpass', freq: 700, f1: 2500, a: 0.05, peak: 0.6, dcy: 0.7, dest: p }); },
  pickup() { tone({ f0: 660, a: 0.005, peak: 0.12, dcy: 0.12 }); tone({ f0: 990, a: 0.005, peak: 0.12, dcy: 0.2, at: 0.1 }); },
  secret() { [660, 880, 1175, 1320].forEach((f, i) => tone({ f0: f, a: 0.005, peak: 0.09, dcy: 0.35, at: i * 0.08 })); },
  drink() { noiseShot({ type: 'bandpass', freq: 400, f1: 200, q: 3, a: 0.05, peak: 0.3, dcy: 0.3 }); },
  descend() { tone({ type: 'sawtooth', f0: 220, f1: 55, a: 0.3, peak: 0.12, dcy: 2.2, lp: 700 }); noiseShot({ type: 'lowpass', freq: 400, a: 0.4, peak: 0.3, dcy: 2.0 }); },
  death() { tone({ type: 'sawtooth', f0: 140, f1: 35, a: 0.05, peak: 0.25, dcy: 2.4, lp: 500 }); noiseShot({ type: 'lowpass', freq: 300, a: 0.2, peak: 0.4, dcy: 2.2 }); },
  heart(v) { tone({ f0: 72, f1: 40, a: 0.006, peak: 0.55 * v, dcy: 0.15 }); tone({ f0: 64, f1: 38, a: 0.006, peak: 0.35 * v, dcy: 0.15, at: 0.17 }); },
  // creature voices (positional)
  rustle(e) { const p = at3(e, 0.5); if (!p) return; noiseShot({ freq: mr(1200, 2200), q: 0.7, a: 0.03, peak: 0.5, dcy: mr(0.2, 0.45), dest: p }); if (Math.random() < 0.35) noiseShot({ type: 'highpass', freq: 2600, a: 0.001, peak: 0.9, dcy: 0.035, at: 0.1, dest: p }); },
  growl(e) { const p = at3(e); if (!p) return; tone({ type: 'sawtooth', f0: rr(70, 90), f1: rr(55, 70), a: 0.15, peak: 0.4, dcy: 0.9, dest: p, lp: 420 }); noiseShot({ type: 'lowpass', freq: 300, a: 0.1, peak: 0.25, dcy: 0.8, dest: p }); },
  howl(e) { const p = at3(e, 1.2); if (!p) return; tone({ type: 'triangle', f0: 380, f1: 620, a: 0.6, peak: 0.16, dcy: 1.6, dest: p, lp: 1800 }); tone({ type: 'triangle', f0: 384, f1: 560, a: 0.6, peak: 0.08, dcy: 1.9, at: 0.15, dest: p, lp: 1800 }); },
  hiss(e) { const p = at3(e, 0.4); if (!p) return; noiseShot({ type: 'highpass', freq: 2500, a: 0.08, peak: 0.45, dcy: 0.6, dest: p }); },
  flutter(e, v = 1) { const p = at3(e, 1.6); if (!p) return; for (let i = 0; i < 5; i++) noiseShot({ freq: rr(350, 650), q: 1.2, a: 0.004, peak: 0.4 * v, dcy: 0.035, at: i * 0.04, dest: p }); },
  shout(e) { const p = at3(e, 1.6); if (!p) return; tone({ type: 'sawtooth', f0: 170, f1: 120, a: 0.04, peak: 0.25, dcy: 0.4, dest: p, lp: 1100 }); noiseShot({ freq: 700, q: 2, a: 0.03, peak: 0.2, dcy: 0.35, dest: p }); },
  windup(e) { if (e.type === 'wolf') this.growl(e); else if (e.type === 'leech') this.hiss(e); else if (e.type === 'bandit') this.shout(e); else if (e.type === 'hound') this.whine(e); else if (e.type === 'sentinel' || e.type === 'guardian') this.grind(e, 0.7); },
  // the ruins
  grind(e, v = 1) { const p = at3(e, 1.6); if (!p) return; noiseShot({ type: 'bandpass', freq: 260, f1: 140, q: 2.5, a: 0.08, peak: 0.6 * v, dcy: 0.7, dest: p }); tone({ type: 'sawtooth', f0: 55, f1: 42, a: 0.1, peak: 0.12 * v, dcy: 0.6, lp: 300, dest: p }); },
  slam(e) { const p = at3(e, 0.3); noiseShot({ type: 'lowpass', freq: 380, f1: 90, a: 0.004, peak: 0.9, dcy: 0.6, dest: p }); tone({ type: 'square', f0: 62, f1: 34, a: 0.004, peak: 0.28, dcy: 0.45, lp: 260, dest: p }); noiseShot({ type: 'highpass', freq: 2400, a: 0.002, peak: 0.25, dcy: 0.18, at: 0.03, dest: p }); },
  thud(e) { const p = at3(e, 0.1); if (!p) return; noiseShot({ type: 'lowpass', freq: 240, a: 0.006, peak: 0.6, dcy: 0.22, dest: p }); tone({ f0: 70, f1: 48, a: 0.004, peak: 0.12, dcy: 0.18, dest: p }); },
  claws(e) { const p = at3(e, 0.1); if (!p) return; for (let i = 0; i < 3; i++) noiseShot({ type: 'highpass', freq: 3800, a: 0.001, peak: 0.45, dcy: 0.02, at: i * mr(0.05, 0.09), dest: p }); },
  whine(e) { const p = at3(e, 0.9); if (!p) return; tone({ type: 'triangle', f0: 520, f1: 940, a: 0.05, peak: 0.12, dcy: 0.42, dest: p, lp: 2400 }); noiseShot({ type: 'bandpass', freq: 900, q: 4, a: 0.05, peak: 0.12, dcy: 0.35, dest: p }); },
  rumble() { noiseShot({ type: 'lowpass', freq: 160, a: 0.3, peak: 0.9, dcy: 3.2 }); tone({ type: 'sawtooth', f0: 38, f1: 28, a: 0.4, peak: 0.25, dcy: 3, lp: 140 }); for (let i = 0; i < 9; i++) noiseShot({ type: 'lowpass', freq: rr(300, 700), a: 0.004, peak: rr(0.2, 0.5), dcy: rr(0.1, 0.3), at: rr(0.2, 2.6) }); },
  chain(x, z) { const p = AU.ctx ? panner(x, 1, z) : null; if (!p) return; tone({ type: 'square', f0: 1850, f1: 1700, a: 0.001, peak: 0.05, dcy: 0.14, lp: 5000, dest: p }); tone({ type: 'square', f0: 2650, a: 0.001, peak: 0.035, dcy: 0.1, lp: 6000, dest: p }); noiseShot({ type: 'highpass', freq: 4200, a: 0.001, peak: 0.3, dcy: 0.05, dest: p }); },
  chainBreak(x, z) { this.chain(x, z); const p = AU.ctx ? panner(x, 1, z) : null; if (!p) return; noiseShot({ type: 'bandpass', freq: 2800, f1: 900, q: 1.5, a: 0.002, peak: 0.6, dcy: 0.5, dest: p }); tone({ f0: 300, f1: 900, a: 0.01, peak: 0.12, dcy: 0.8, dest: p }); },
  glyph(i) { tone({ f0: [523, 659, 784][i] || 880, a: 0.01, peak: 0.12, dcy: 0.9 }); tone({ f0: ([523, 659, 784][i] || 880) * 2, a: 0.01, peak: 0.04, dcy: 0.7 }); },
  wrong() { tone({ type: 'sawtooth', f0: 155, f1: 120, a: 0.01, peak: 0.18, dcy: 0.6, lp: 900 }); tone({ type: 'sawtooth', f0: 164, f1: 126, a: 0.01, peak: 0.18, dcy: 0.6, lp: 900 }); noiseShot({ type: 'lowpass', freq: 500, a: 0.005, peak: 0.5, dcy: 0.3 }); },
  relic() { [392, 494, 587, 784, 988].forEach((f, i) => tone({ f0: f, a: 0.02, peak: 0.08, dcy: 1.6, at: i * 0.12 })); tone({ type: 'sawtooth', f0: 98, a: 0.4, peak: 0.05, dcy: 2.5, lp: 600 }); },
  spirit(v = 1) { [440, 554, 659].forEach((f, i) => tone({ f0: f, f1: f * 1.002, a: 0.6, peak: 0.05 * v, dcy: 2.6, at: i * 0.15 })); },
  drip(x, z) { const p = AU.ctx ? panner(x, 3, z) : null; if (!p) return; tone({ f0: rr(1100, 1500), f1: rr(500, 700), a: 0.002, peak: 0.12, dcy: 0.08, dest: p }); },
  merchant() { tone({ type: 'triangle', f0: 196, f1: 185, a: 0.05, peak: 0.06, dcy: 0.7 }); },
  crackle(b, v) { const p = at3(b, 1); if (!p) return; tone({ f0: 320 + Math.random() * 420, a: 0.003, peak: 0.08 * v, dcy: 0.03, dest: p }); },
  ambient(x, z) { if (!AU.ctx) return; const a = Math.random() * 6.283, p = panner(x + Math.sin(a) * 40, 6, z + Math.cos(a) * 40); tone({ f0: 400, f1: 360, a: 0.05, peak: 0.1, dcy: 0.35, dest: p }); tone({ f0: 390, f1: 350, a: 0.05, peak: 0.1, dcy: 0.5, at: 0.5, dest: p }); },
};

export function updateAudio(dt, x, z, fwd, live, dangerNear, danger) {
  if (!AU.ctx) return;
  const ctx = AU.ctx, L = ctx.listener, now = ctx.currentTime;
  if (L.positionX) {
    L.positionX.value = x; L.positionY.value = 1.62; L.positionZ.value = z;
    L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
  } else { L.setPosition(x, 1.62, z); L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
  const ruins = AU.floor === 4;
  // the woods: wind in the canopy, crickets that hush; the ruins: a low draught, water dripping somewhere, no insects
  AU.wind.gain.setTargetAtTime(live ? (ruins ? 0.022 : 0.042) : 0.028, now, 0.5);
  AU.bugs.gain.setTargetAtTime(ruins ? 0 : live ? 0.45 * clamp((dangerNear - 6) / 12, 0, 1) : 0.18, now, 0.4);
  if (ruins && live && now > (AU.nextDrip || 0)) { const a = Math.random() * 6.283, d = mr(6, 22); sfx.drip(x + Math.cos(a) * d, z + Math.sin(a) * d); AU.nextDrip = now + mr(0.8, 4.5); }
  AU.drone.gain.setTargetAtTime(live ? 0.2 + danger * 0.65 : 0.13, now, 0.8); // quieter bed; danger still swells it
  if (live && danger > 0.05 && now > AU.nextHeart) { sfx.heart(danger); AU.nextHeart = now + lerp(1.05, 0.42, danger); }
  if (live && now > AU.nextAmb) { if (ruins) sfx.grind({ x: x + mr(-40, 40), z: z + mr(-40, 40) }, 0.35); else sfx.ambient(x, z); AU.nextAmb = now + mr(16, 34); }
}
export function setSound(on) { if (AU.master) AU.master.gain.setTargetAtTime(on ? 0.9 : 0, AU.ctx.currentTime, 0.05); }
document.addEventListener('visibilitychange', () => { if (!AU.ctx) return; if (document.hidden) AU.ctx.suspend().catch(() => {}); else AU.ctx.resume().catch(() => {}); });
