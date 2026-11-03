import { buildNPCs, updateNPCs, talkTarget, talkName, openTalk, talkKey, talkAdvance, NPCS } from './npc.js';
import { THREE, $, IS_TOUCH, renderer, scene, camera, hemi, canvas, settings, snapOn, snapU, statsProbe, clamp, lerp, smooth, damp, mr, rr, wrapAngle, headingOfYaw, TAU } from './engine.js';
import { generateLevel, LV, TILE, idx, inBounds, toTile, lineOfSight, moveWithCollisions } from './level.js';
import { createLantern, updateLantern, lantern, MODES, setMode, swingBlade, beamAt, glint, inBeam, showViewModels, NEAR_R } from './lantern.js';
import { buildWorld, W, ensureDetail, DETAIL, updateWorldLights, updateCulling, updateCover, updateFireflies, FX, litTest, spawnPickup, seenPoint, ruinsTick } from './world3d.js';
import { buildStory, updateStory, slashStory, storyCreatureDown, ST } from './story.js';
import { spawnCreatures, updateCreatures, CR, damageEnemy, exposeEnemy, interruptEnemy, addCreature, refreshCreatureDetail, creatureTris } from './creatures.js';
import { updateFX, burst } from './fx.js';
import { rigTris } from './rigs.js';
import { G, P, H, BAL, S, resetStory, DF, DIFFS, setDifficulty } from './state.js';
import { initAudio, updateAudio, sfx, setSound, AU, setAmbience } from './audio.js';
import { readMove, A, tryLock } from './input.js';

// =====================================================================
//  THE HOLLOW CROWN: LANTERN OF THE DEEP — first-person, floors III and IV
//  The Crown's rules (oil, three lantern stances, slash/dash/flare/pulse,
//  braziers, caches, exposure) on Eyeshine's engine (draw only what the
//  light touches, detail in the beam, eyeshine).
// =====================================================================
if (IS_TOUCH) document.body.classList.add('touch');
createLantern();

// ---------- voice (the lantern speaks) + hints ----------
const VO = { q: [], cur: null, typed: 0, hold: 0, cool: {} };
// who: the lantern (default), 'sera' or 'merchant'
const WHO = { sera: 'SERA', merchant: 'THE GRAY MERCHANT', lyn: 'LYN' };
H.say = (text, force = false, who = '') => {
  const now = G.t; if (!force && (VO.cool[text] || -99) > now) return;
  VO.cool[text] = now + 10;
  if (VO.cur && VO.cur.text === text) return;
  if (VO.q.length < (force ? 6 : 3)) VO.q.push({ text, who });
};
let hintTimer = 0;
H.hint = (text, dur = 3.5) => { const el = $('hint'); el.textContent = text; el.classList.add('on'); hintTimer = dur; };
function voiceTick(dt) {
  if (!VO.cur && VO.q.length) {
    VO.cur = VO.q.shift(); VO.typed = 0; VO.hold = 2.2 + VO.cur.text.length / 22; const v = $('voice');
    v.classList.add('on'); v.classList.toggle('sera', VO.cur.who === 'sera'); v.classList.toggle('merchant', VO.cur.who === 'merchant'); v.classList.toggle('lyn', VO.cur.who === 'lyn'); $('voiceWho').textContent = WHO[VO.cur.who] || '';
  }
  if (VO.cur) {
    VO.typed = Math.min(VO.cur.text.length, VO.typed + dt * 34);
    $('voiceText').textContent = VO.cur.text.slice(0, Math.floor(VO.typed));
    if (VO.typed >= VO.cur.text.length) { VO.hold -= dt; if (VO.hold <= 0) { VO.cur = null; $('voice').classList.remove('on'); } }
  }
  if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) $('hint').classList.remove('on'); }
}

// ---------- damage to the Warden ----------
H.damagePlayer = (amount, source, fx, fz) => {
  if (P.invuln > 0 || G.state !== 'playing') return;
  const real = amount * BAL.dmgTaken * DF.dmg * (1 - P.dr);
  P.hp = Math.max(0, P.hp - real); P.invuln = 0.55; P.hurt = 0.4; G.shake = Math.max(G.shake, 0.45); sfx.hurt();
  if (fx !== undefined) { const a = Math.atan2(P.z - fz, P.x - fx); P.pushX = Math.cos(a) * 5; P.pushZ = Math.sin(a) * 5; }
  if (P.hp <= 0) die();
  else if (P.hp <= 30) H.say('Closer. Do not stop.');
};
H.addPickup = (type, x, z) => spawnPickup(type, x, z);
H.creatureDown = (e) => { storyCreatureDown(e); if (e.guardian) spawnPickup('health', e.x, e.z); };

// ---------- run flow ----------
let runSeed = (Date.now() % 100000) | 0;
const FLOORS = {
  1: { title: 'ASH HOLLOW', lines: [['a', 2, 'Voices. Real ones. I had forgotten what they sound like.'], ['b', 10, 'They all look at the brand. Not at me.']], exit: 'The gate. Past it, everything is gray.', leave: 'LEAVE THROUGH THE GATE' },
  2: { title: 'THE GRAY FOREST', lines: [['a', 2, 'No colour left in anything. Only what I touch.'], ['b', 9, 'Small footprints. Someone ran this way.']], exit: 'Roots, going down. The woods are deeper below.' },
  3: { title: 'THE DEEP WOODS', lines: [['a', 2, 'The trees have stopped growing. They remember how.'], ['b', 8, 'I am awake now. Do not let me go out.']], exit: 'Down. The roots go down.' },
  4: { title: 'THE EASTERN RUINS', lines: [['a', 2, 'The stone here was carved by hands that are still here.'], ['b', 9, 'Walls again. What is behind them stays dark to me until we go through.']], exit: 'Stairs. Down again, into the inner ruins.' },
};
// carry: the Warden's state from the floor above (health, oil, relics), or null for a fresh start
function buildRun(seed, floor = 3, carry = null) {
  generateLevel(seed, floor); buildWorld(); spawnCreatures(); buildStory(); setAmbience(floor);
  G.floor = floor;
  Object.assign(P, { x: LV.spawn.x, z: LV.spawn.z, hp: 100, maxHp: 100, fuel: 100, invuln: 0, dashT: 0, dashCd: 0, attackCd: 0, flareCd: 0, pulseCd: 0, hurt: 0, bob: 0, moving: 0, pushX: 0, pushZ: 0, walkX: 0, walkZ: 0, pitch: -0.05, atkBonus: 0, brightBonus: 0, dr: 0, pulseCostMult: 1, speedK: 0 });
  if (carry) Object.assign(P, carry);
  G.talk = null; $('dlg').classList.add('hidden'); document.body.classList.remove('talking');
  // start facing the last fire
  const b = LV.braziers.find((q) => q.lit && Math.hypot(q.x - P.x, q.z - P.z) < 12);
  P.yaw = b ? Math.atan2(-(b.x - P.x), -(b.z - P.z)) : 0;
  buildNPCs();
  Object.assign(G, { t: 0, paused: false, danger: 0, shake: 0, hitstop: 0, flash: 0, tips: {}, endT: 0, won: false, eyesSeen: false });
  if (!carry) Object.assign(G, { kills: 0, oilFound: 0, secrets: 0, braziersLit: 0, runT: 0 });
  else Object.assign(G.tips, { c: 1, d: 1 }); // the controls were explained on the floor above
  $('regionName').textContent = LV.name; $('regionNum').textContent = LV.numeral; $('cardNum').textContent = LV.numeral; $('cardTitle').textContent = LV.name;
  mapImg = null;
  setMode(1); lantern.shutter = 0;
  FX.flareK = FX.pulseK = 0; flare.on = false; pulseFx.on = false;
  revealAround(P.x, P.z, 3);
  for (const br of LV.braziers) if (br.lit && Math.hypot(br.x - P.x, br.z - P.z) < 14) revealAround(br.x, br.z, 4);
  VO.q = []; VO.cur = null; VO.cool = {}; $('voice').classList.remove('on');
}
function startGame(floor = 1) {
  initAudio(); resetStory();
  if (G.state !== 'menu' || floor !== 3) { runSeed = (runSeed * 7919 + 13) % 100000; buildRun(runSeed, floor); }
  else { spawnCreatures(); }
  G.state = 'playing'; G.t = 0;
  $('menu').classList.add('hidden'); $('end').classList.add('hidden'); $('hud').classList.remove('hidden'); $('tricksBtn').classList.remove('hidden');
  if (IS_TOUCH) $('touchUI').classList.remove('hidden');
  showViewModels(true);
  $('card').classList.add('on'); setTimeout(() => $('card').classList.remove('on'), 3200);
  tryLock();
}
function toMenu() {
  buildRun(runSeed); G.state = 'menu';
  $('menu').classList.remove('hidden'); $('end').classList.add('hidden'); $('hud').classList.add('hidden'); $('tricksBtn').classList.add('hidden'); $('touchUI').classList.add('hidden');
  showViewModels(true);
  // one wolf waits out in the dark for the title screen
  const w = CR.list.find((e) => e.type === 'wolf') || CR.list[0];
  if (w) for (let i = 0; i < 200; i++) {
    const a = mr(0, TAU), d = mr(9, 15), x = P.x + Math.cos(a) * d, z = P.z + Math.sin(a) * d, tx = toTile(x), ty = toTile(z);
    if (inBounds(tx, ty) && LV.tiles[idx(tx, ty)] === 1 && lineOfSight(P.x, P.z, x, z)) { w.x = x; w.z = z; w.facing = Math.atan2(P.z - z, P.x - x); w.state = 'wander'; w.lastKnown = { x, z }; break; }
  }
}
function die() {
  G.state = 'dead'; G.endT = 0; sfx.death(); H.say('Dark. It is so dark.', true);
  if (document.pointerLockElement) document.exitPointerLock();
}
function descend() {
  G.state = 'descending'; G.endT = 0; G.won = LV.floor === 4; sfx.descend();
  if (G.won && document.pointerLockElement) document.exitPointerLock();
}
// down the roots into the ruins: health and oil carry over (+28 health, +50 oil, as in the Crown)
function nextFloor() {
  const carry = { hp: Math.min(P.maxHp, P.hp + 28 * DF.carry), maxHp: P.maxHp, fuel: Math.min(P.maxFuel, P.fuel + 50 * DF.carry), atkBonus: P.atkBonus, brightBonus: P.brightBonus, dr: P.dr, pulseCostMult: P.pulseCostMult, speedK: P.speedK };
  G.runT += G.t;
  runSeed = (runSeed * 7919 + 13) % 100000; buildRun(runSeed, LV.floor + 1, carry);
  G.state = 'playing';
  $('card').classList.add('on'); setTimeout(() => $('card').classList.remove('on'), 3200);
  $('fade').classList.remove('on');
}
function showEnd() {
  const won = G.won, total = G.runT + G.t, m = Math.floor(total / 60), s = String(Math.floor(total % 60)).padStart(2, '0'), f = LV.floor;
  $('endTitle').textContent = won ? 'DOWN INTO THE DARK' : 'THE LANTERN GOES OUT';
  const story = ST.on ? (ST.freed ? ' Sera is free.' : ST.solved ? ' The Crown Shard hums in your pack.' : ST.guardianDown ? ' The guardian is dust.' : '') : '';
  $('endSub').textContent = won ? 'Floor V, the Inner Ruins, waits below.' + story : f === 4 ? 'The Eastern Ruins keep what they take.' : f === 2 ? 'The Gray Forest keeps what it takes.' : 'The Deep Woods keep what they take.';
  $('endStats').innerHTML = `${DF.name} \u00b7 ${won ? 'Descended' : 'Lasted'} in ${m}:${s}<br>Slain ${G.kills} · Oil found ${G.oilFound} · Caches ${G.secrets} · Braziers lit ${G.braziersLit}`;
  $('againBtn').textContent = won ? 'AGAIN, FROM THE VILLAGE' : f === 4 ? 'AGAIN, FROM THE RUINS' : 'AGAIN, FROM THE VILLAGE';
  G.endFloor = !won && f === 4 ? 4 : 1;
  $('end').classList.remove('hidden'); $('hud').classList.add('hidden'); $('touchUI').classList.add('hidden'); $('tricksBtn').classList.add('hidden'); toggleTricks(false);
  G.state = 'ended'; showViewModels(false);
}
$('startBtn').addEventListener('click', () => { G.state = 'ended'; startGame(1); });
// begin partway down (to try a floor without walking the ones above): › picks which
const PICK = [2, 3, 4], ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
let pickFloor = 3;
const pickLabel = () => { $('startBtn4').textContent = 'BEGIN AT FLOOR ' + ROMAN[pickFloor] + ' · ' + FLOORS[pickFloor].title; };
$('startBtn4').addEventListener('click', () => { G.state = 'ended'; startGame(pickFloor); });
$('pickBtn').addEventListener('click', (e) => { e.stopPropagation(); pickFloor = PICK[(PICK.indexOf(pickFloor) + 1) % PICK.length]; pickLabel(); });
pickLabel();
$('againBtn').addEventListener('click', () => { G.state = 'ended'; startGame(G.endFloor || 1); });
$('menuBtn').addEventListener('click', () => toMenu());
$('pauseOv').addEventListener('click', () => { A.resume(); tryLock(); });

// ---------- actions ----------
const slashRange = 2.6;
A.slash = () => {
  if (P.attackCd > 0 || P.dashT > 0) return;
  P.attackCd = 0.3; P.swingSide = -P.swingSide; swingBlade(P.swingSide); sfx.slash();
  const h = headingOfYaw(P.yaw), arc = IS_TOUCH ? 0.85 : 0.62, bm = lantern.mode === 2 ? 1.08 + P.brightBonus : 1, base = (12 + P.atkBonus) * bm;
  slashStory(h, slashRange, arc);
  let hits = 0, exposedHits = 0;
  for (const e of [...CR.list]) {
    const d = Math.hypot(e.x - P.x, e.z - P.z); if (d > slashRange + e.r) continue;
    const a = wrapAngle(Math.atan2(e.z - P.z, e.x - P.x) - h); if (Math.abs(a) > arc) continue;
    if (!lineOfSight(P.x, P.z, e.x, e.z)) continue;
    const was = e.exposed > 0, extra = e.type === 'leech' && lantern.mode === 2 ? 2.5 : 0;
    if (damageEnemy(e, base + extra, was ? 2.6 : 1.6, h, 'slash')) { hits++; if (was) { exposedHits++; e.exposed = Math.max(0, e.exposed - 0.22); } }
  }
  if (exposedHits) H.say('Again.');
};
A.dash = () => {
  if (P.dashCd > 0) return;
  const [mx, mz] = readMove(0), s = Math.sin(P.yaw), c = Math.cos(P.yaw);
  let dx = -s * mz + c * mx, dz = -c * mz - s * mx; const L = Math.hypot(dx, dz);
  if (L < 0.1) { dx = -s; dz = -c; } else { dx /= L; dz /= L; }
  P.dashX = dx; P.dashZ = dz; P.dashT = 0.18; P.dashCd = 1.6; P.invuln = Math.max(P.invuln, 0.24); sfx.dash();
};
const flare = { on: false, life: 0, max: 0.56, R: 16, hit: new Set() };
A.flare = () => {
  if (P.flareCd > 0 || P.fuel < BAL.flareCost) { if (P.fuel < BAL.flareCost) H.hint('Not enough oil to flare.', 1.6); return; }
  P.fuel -= BAL.flareCost; P.flareCd = 5.6; sfx.flare(); G.shake = Math.max(G.shake, 0.5); G.flash = 0.5;
  Object.assign(flare, { on: true, life: flare.max }); flare.hit.clear(); FX.flareX = P.x; FX.flareZ = P.z;
  burst(lantern.pos.x, lantern.pos.y, lantern.pos.z, 36, [1, 0.82, 0.45], 7, 0.55, -2, 0.3);
  H.say('Break them open.');
};
const pulseFx = { on: false, life: 0, max: 0.34, R: 12, hit: new Set() };
const pulseCost = () => BAL.pulseCost * P.pulseCostMult;
A.pulse = () => {
  if (P.pulseCd > 0 || P.fuel < pulseCost()) return;
  P.fuel -= pulseCost(); P.pulseCd = 2.15; sfx.pulse();
  Object.assign(pulseFx, { on: true, life: pulseFx.max }); pulseFx.hit.clear(); FX.pulseX = P.x; FX.pulseZ = P.z;
  for (let i = 0; i < 28; i++) { const a = (i / 28) * TAU; burst(P.x + Math.cos(a) * 0.6, 0.25, P.z + Math.sin(a) * 0.6, 1, [0.45, 0.65, 1], 0.1, 0.4, 0, 0); }
};
A.mode = () => A.setMode((lantern.mode + 1) % 3);
A.setMode = (m) => {
  if (m === lantern.mode) return;
  if (LV.floor === 1) { H.hint('Not here. The village keeps the shutter half open.', 1.8); return; }
  if (m === 2 && P.fuel < 18) { H.hint('Too little oil to open the shutter wide.', 1.8); return; }
  setMode(m); sfx.shutter(m);
  H.hint('Lantern: ' + MODES[m].name, 1.2);
  if (m === 2 && !G.tips.bright) { G.tips.bright = 1; H.say('Wider. I see them. They see me.'); }
  if (m === 0 && !G.tips.dim) { G.tips.dim = 1; H.say('Hushed. Small steps.'); }
};
A.use = () => {
  const who = talkTarget(); if (who) { openTalk(who); return; }
  if (Math.hypot(LV.exit.x - P.x, LV.exit.z - P.z) < 2.6) { descend(); return; }
  const b = nearestBrazier(2.6, false); if (b) lightBrazier(b);
};
A.pause = () => { G.paused = true; $('pauseOv').classList.remove('hidden'); };
A.resume = () => { if (!tricksOpen) G.paused = false; $('pauseOv').classList.add('hidden'); };
A.tricks = () => toggleTricks();
A.talkKey = talkKey; A.talkAdvance = talkAdvance;

function nearestBrazier(r, lit) { let best = null, bd = r; for (const b of LV.braziers) { if (b.lit !== lit) continue; const d = Math.hypot(b.x - P.x, b.z - P.z); if (d < bd) { bd = d; best = b; } } return best; }
function lightBrazier(b) {
  if (b.lit) return; b.lit = true; b.radius = 8; G.braziersLit++;
  P.fuel = Math.min(P.maxFuel, P.fuel + BAL.brazierLight); sfx.ignite(b); revealAround(b.x, b.z, 4);
  H.hint(LV.floor === 4 ? 'A brazier catches. The stone remembers warmth.' : 'A brazier catches. The clearing exhales.', 2.6);
}

// ---------- what the light shows you: the map fills in as you light it ----------
function markTile(tx, ty) { if (inBounds(tx, ty)) LV.discovered[idx(tx, ty)] = 1; }
function revealAround(x, z, rT) { const cx = toTile(x), cy = toTile(z); for (let y = -rT; y <= rT; y++) for (let xx = -rT; xx <= rT; xx++) if (xx * xx + y * y <= rT * rT) markTile(cx + xx, cy + y); }
function discover() {
  const h = Math.atan2(lantern.dir.z, lantern.dir.x), n = lantern.ring ? 28 : 13, A0 = lantern.ring ? Math.PI * (1 - 1 / 28) : lantern.angle * 1.1, R = Math.min(lantern.distance, 30) * Math.min(1, lantern.k + 0.2);
  for (let i = 0; i < n; i++) {
    const a = h - A0 + (2 * A0 * i) / (n - 1), c = Math.cos(a), s = Math.sin(a);
    for (let d = 0.5; d < R; d += 0.8) { const tx = toTile(P.x + c * d), ty = toTile(P.z + s * d); markTile(tx, ty); if (!inBounds(tx, ty) || LV.tiles[idx(tx, ty)] === 0) break; }
  }
  revealAround(P.x, P.z, 1);
  if (!LV.exit.found && LV.discovered[idx(toTile(LV.exit.x), toTile(LV.exit.z))]) LV.exit.found = true;
}

// ---------- per-frame game rules ----------
let discT = 0;
function updatePlayer(dt) {
  const [mx, mz] = readMove(dt);
  P.pitch = clamp(P.pitch, -1.3, 1.25);
  const sp = 3.7 * (lantern.mode === 0 ? 1.06 : 1) * (1 + P.speedK), s = Math.sin(P.yaw), c = Math.cos(P.yaw);
  // walking eases in and out (about a fifth of a second to full speed or to a stop) instead of snapping
  const tx = (-s * mz + c * mx) * sp, tz = (-c * mz - s * mx) * sp, ka = 1 - Math.exp(-(Math.hypot(tx, tz) > Math.hypot(P.walkX, P.walkZ) ? 14 : 16) * dt);
  P.walkX += (tx - P.walkX) * ka; P.walkZ += (tz - P.walkZ) * ka;
  if (P.dashT > 0) { P.walkX = P.dashX * 11; P.walkZ = P.dashZ * 11; } // and a dash carries a little momentum out of it
  let vx = P.walkX, vz = P.walkZ;
  vx += P.pushX; vz += P.pushZ; const pk = Math.exp(-9 * dt); P.pushX *= pk; P.pushZ *= pk;
  moveWithCollisions(P, vx, vz, dt);
  const speed = Math.hypot(vx, vz);
  P.moving = lerp(P.moving, speed > 0.2 ? 1 : 0, damp(8, dt));
  if (speed > 0.2) { P.bob += dt * Math.min(speed, 5) * 2.1; if (P.bob - P.lastStep > Math.PI) { P.lastStep += Math.PI; sfx.step(); } } else P.lastStep = P.bob;
  for (const k of ['invuln', 'dashT', 'dashCd', 'attackCd', 'flareCd', 'pulseCd', 'hurt']) P[k] = Math.max(0, P[k] - dt);
}
function updateRules(dt) {
  const M0 = MODES[lantern.mode];
  // oil
  if (LV.floor !== 1) P.fuel = Math.max(0, P.fuel - M0.drain * DF.drain * dt); // the village burns no oil
  if (P.fuel <= 0) {
    P.hp = Math.max(0, P.hp - BAL.darkDrain * DF.dark * dt); if (P.hp <= 0) { die(); return; }
    H.say('I cannot hold much longer.');
  }
  if (P.fuel < 18 && lantern.mode === 2) { setMode(1); H.hint('The lantern narrows to save oil.', 1.8); }
  if (P.fuel < 14 && lantern.mode === 1) setMode(0);
  // braziers: Bright lights one you walk up to; standing by a lit one feeds the lantern
  for (const b of LV.braziers) {
    const d = Math.hypot(b.x - P.x, b.z - P.z);
    if (!b.lit && d < 3.2 && lantern.mode === 2) lightBrazier(b);
    if (b.lit && d < 4.6 && P.fuel < P.maxFuel) {
      P.fuel = Math.min(P.maxFuel, P.fuel + BAL.brazierRefill * dt);
      if (!G.tips.refill) { G.tips.refill = 1; H.hint('The brazier feeds the lantern.', 2.6); }
    }
    if (b.lit && d < 10 && AU.ctx && Math.random() < dt * 3) sfx.crackle(b, 1 - d / 10);
  }
  // flare + pulse rings
  const ring = (fx, kind, dt2) => {
    if (!fx.on) return 0;
    fx.life -= dt2; if (fx.life <= 0) { fx.on = false; return 0; }
    const t = 1 - fx.life / fx.max, r = lerp(0.6, fx.R, 1 - Math.pow(1 - t, 3));
    for (const e of [...CR.list]) {
      if (fx.hit.has(e)) continue; const d = Math.hypot(e.x - fx.x0, e.z - fx.z0); if (d > r + e.r) continue;
      fx.hit.add(e); if (!lineOfSight(fx.x0, fx.z0, e.x, e.z)) continue;
      const dir = Math.atan2(e.z - fx.z0, e.x - fx.x0);
      const stone = e.type === 'sentinel' || e.type === 'guardian';
      if (kind === 'flare') {
        const base = e.type === 'moth' ? 999 : e.type === 'leech' ? 18 : e.type === 'hound' || stone ? 9 : 8;
        damageEnemy(e, base, e.type === 'moth' ? 4.5 : stone ? 0.6 : 3, dir, 'flare');
        if (e.alive) { if (e.type === 'leech') exposeEnemy(e, 1.3); if (e.type === 'wolf') exposeEnemy(e, 1.0); if (e.type === 'hound') exposeEnemy(e, 1.1); if (stone) interruptEnemy(e, 0.2); }
      } else {
        damageEnemy(e, e.type === 'moth' ? 8 : 5, stone ? 0.3 : 1.1, dir, 'pulse');
        if (e.alive) {
          if (e.type === 'leech') exposeEnemy(e, 1.08);
          else if (stone) exposeEnemy(e, 2.35); // the pulse cracks the wax open
          else if (e.type === 'wolf' || e.type === 'hound') { if (e.windup > 0 || e.lungeTime > 0 || lantern.mode === 2) exposeEnemy(e, 1.18); else interruptEnemy(e, 0.16); }
          else if (e.type === 'moth') interruptEnemy(e, 0.12);
          else if (e.type === 'bandit' && e.windup > 0) interruptEnemy(e, 0.2);
        }
      }
    }
    if (kind === 'pulse') {
      for (const b of LV.braziers) if (!b.lit && Math.hypot(b.x - fx.x0, b.z - fx.z0) < r) lightBrazier(b);
      for (const s of LV.secrets) if (!s.revealed && Math.hypot(s.x - fx.x0, s.z - fx.z0) < r) revealSecret(s);
    }
    return r;
  };
  if (flare.on && flare.life === flare.max) { flare.x0 = P.x; flare.z0 = P.z; }
  if (pulseFx.on && pulseFx.life === pulseFx.max) { pulseFx.x0 = P.x; pulseFx.z0 = P.z; }
  FX.flareR = ring(flare, 'flare', dt); FX.flareK = flare.on ? Math.pow(flare.life / flare.max, 0.7) : 0;
  FX.pulseR = ring(pulseFx, 'pulse', dt); FX.pulseK = pulseFx.on ? pulseFx.life / pulseFx.max : 0;
  // pickups
  for (const p of LV.pickups) {
    if (p.collected || Math.hypot(p.x - P.x, p.z - P.z) > 1.25) continue;
    p.collected = true; sfx.pickup();
    if (p.type === 'fuel') { P.fuel = Math.min(P.maxFuel, P.fuel + BAL.oil * DF.loot); G.oilFound++; H.hint('Oil recovered.', 1.8); }
    else { P.hp = Math.min(P.maxHp, P.hp + BAL.tonic * DF.loot); H.hint('A bitter tonic steadies you.', 1.8); }
  }
  // hidden caches: Bright light close up finds them (or a pulse)
  for (const s of LV.secrets) {
    if (!s.revealed && lantern.mode === 2 && lantern.k > 0.3) {
      const d = Math.hypot(s.x - P.x, s.z - P.z);
      if (d < 7 && inBeam(s.x, 0.2, s.z, 0.3, 0, 0) && lineOfSight(P.x, P.z, s.x, s.z)) revealSecret(s);
    }
    if (s.revealed && !s.found && Math.hypot(s.x - P.x, s.z - P.z) < 1.35) {
      s.found = true; G.secrets++; sfx.secret(); P.fuel = Math.min(P.maxFuel, P.fuel + BAL.cache * DF.loot); H.say('A hidden cache. The lantern hums.');
    }
  }
  // the way down
  const de = Math.hypot(LV.exit.x - P.x, LV.exit.z - P.z), FL = FLOORS[LV.floor];
  if (de < 9 && !G.tips.exit && lineOfSight(P.x, P.z, LV.exit.x, LV.exit.z - 2.2)) { G.tips.exit = 1; H.say(FL.exit); }
  // discovery for the map
  discT -= dt; if (discT <= 0) { discT = 0.1; discover(); }
  // the floor's opening lines
  const T = G.t;
  for (const [k, at, line] of FL.lines) if (T > at && !G.tips[k]) { G.tips[k] = 1; H.say(line, true); }
  if (LV.floor === 4 && T > 16 && !G.tips.ruinsTip) { G.tips.ruinsTip = 1; G.tips.c = 1; H.hint(IS_TOUCH ? 'PULSE cracks sentinels open. FLARE breaks a lunge. LIGHT opens the shutter.' : 'E: pulse cracks sentinels open. F: flare breaks a lunge. Q: the shutter.', 6); }
  if (T > 14 && !G.tips.c) { G.tips.c = 1; H.hint(IS_TOUCH ? 'LIGHT opens and closes my shutter. Wider burns more oil.' : 'Q opens and closes my shutter (or 1, 2, 3). Wider burns more oil.', 5); }
  if (T > 30 && !G.tips.d) { G.tips.d = 1; H.hint(IS_TOUCH ? 'FLARE breaks them open. PULSE lights braziers and finds hidden caches.' : 'Right-click or F: flare breaks them open. E: pulse lights braziers and finds hidden caches.', 6); }
  if (P.fuel < 30 && !G.tips.oil) { G.tips.oil = 1; H.hint('Oil runs low. Amber glints are flasks. Lit braziers refill you.', 4.5); }
}
function revealSecret(s) { s.revealed = true; sfx.secret(); H.hint('A hidden cache glints in the light.', 2.4); }

// ---------- items: glints, bobbing, the exit's glow ----------
let pxPerM = 0.005;
function updateItems(dt, t) {
  pxPerM = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.min(G.renderH, 400);
  const glintOf = (o, x, y, z, k) => {
    const r = beamAt(x, y, z); let b = 0;
    if (lantern.k > 0.02 && r.ang < lantern.angle * 1.45) { o.losT -= dt; if (o.losT <= 0) { o.losT = 0.2; o.los = lineOfSight(P.x, P.z, x, z); } if (o.los) b = glint(r.d, r.ang) * k; }
    o.mat.opacity = b; o.glint.visible = b > 0.01; const sz = Math.max(0.07, r.d * pxPerM * 3); o.glint.scale.set(sz, sz, 1);
  };
  for (const o of W.pickups) {
    if (o.src.collected) { if (o.grp.parent) o.grp.parent.remove(o.grp); continue; }
    o.mesh.rotation.y = t * 0.6 + o.src.bob; o.mesh.position.y = 0.05 + Math.sin(t * 2 + o.src.bob) * 0.03;
    o.mesh.visible = !settings.culling || (litTest(o.src.x, 0.2, o.src.z, 0.3) && seenPoint(o.src.x, o.src.z));
    glintOf(o, o.src.x, 0.2, o.src.z, 0.9);
  }
  for (const o of W.secrets) {
    o.grp.visible = o.src.revealed && !o.src.found; if (!o.grp.visible) continue;
    o.mesh.visible = !settings.culling || (litTest(o.src.x, 0.2, o.src.z, 0.4) && seenPoint(o.src.x, o.src.z));
    o.losT = o.losT || 0; glintOf(o, o.src.x, 0.35, o.src.z, 1);
  }
  const ex = W.exit, de = Math.hypot(LV.exit.x - P.x, LV.exit.z - P.z);
  ex.glow.visible = de < 40 && (de < 6 || lineOfSight(P.x, P.z, LV.exit.x, LV.exit.z - (LV.floor === 4 ? 2.2 : 0)));
  ex.glow.material.opacity = 0.16 + 0.08 * Math.sin(t * 2.5);
  ex.hole.visible = ex.mesh.visible;
}

// ---------- camera ----------
function updateCamera(dt) {
  let y = 1.62, pitch = P.pitch;
  if (G.state === 'dead') { const k = smooth(0, 1.6, G.endT); y = lerp(1.62, 0.45, k); pitch = lerp(P.pitch, -0.5, k); }
  if (G.state === 'descending' && LV.floor === 1) { P.x = lerp(P.x, LV.exit.x + 4, 0.012); P.z = lerp(P.z, LV.exit.z, 0.02); pitch = lerp(P.pitch, 0, 0.05); } // out through the gate
  else if (G.state === 'descending') { const k = smooth(0, 2.2, G.endT); y = lerp(1.62, -2.5, k); pitch = lerp(P.pitch, -0.9, Math.min(1, k * 2)); if (LV.floor === 4) { P.x = lerp(P.x, LV.exit.x, 0.02); P.z = lerp(P.z, LV.exit.z, 0.02); } }
  const bobY = Math.sin(P.bob * 2) * 0.035 * P.moving, bobX = Math.cos(P.bob) * 0.025 * P.moving, sh = G.shake;
  camera.position.set(P.x + Math.cos(P.yaw) * bobX, y + bobY, P.z - Math.sin(P.yaw) * bobX);
  camera.rotation.set(pitch + (Math.random() - 0.5) * sh * 0.06, P.yaw + (Math.random() - 0.5) * sh * 0.06, 0);
  camera.updateMatrixWorld();
  G.shake = Math.max(0, G.shake - dt * 2.2);
}
function updateEnvironment() {
  if (settings.debugLight) { hemi.intensity = 3; hemi.color.set(0xd8dce8); hemi.groundColor.set(0x403830); scene.fog.near = 500; scene.fog.far = 1000; scene.background.set(0x0b1220); return; }
  const sky = settings.ring && LV && LV.floor === 1; // the original lights Ash Hollow under an iron sky: you see down the street
  hemi.intensity = sky ? 0.55 : 0.035; hemi.color.set(sky ? 0x8a96a8 : 0x6a7890); hemi.groundColor.set(sky ? 0x2a2622 : 0x0a0806); scene.background.set(sky ? 0x0c0e12 : 0x000000);
  if (settings.fog) { scene.fog.near = sky ? 18 : 7; scene.fog.far = sky ? 60 : Math.max(lantern.distance + 9, FX.flareK > 0 ? FX.flareR + 8 : 0, 26); } else { scene.fog.near = 500; scene.fog.far = 1000; }
}

// ---------- HUD ----------
const last = {};
const setIf = (k, v, fn) => { if (last[k] !== v) { last[k] = v; fn(v); } };
function updateHUD(dt) {
  setIf('hp', Math.ceil(P.hp) + '/' + P.maxHp, () => { const v = Math.ceil(P.hp); $('hpNum').textContent = v; $('hpBar').firstChild.style.transform = `scaleX(${v / P.maxHp})`; });
  setIf('oil', Math.ceil(P.fuel), (v) => { $('oilNum').textContent = v; $('oilBar').firstChild.style.transform = `scaleX(${v / 100})`; $('oilRow').classList.toggle('low', v < 20); });
  setIf('mode', lantern.mode, (m) => { $('stanceName').textContent = MODES[m].name; document.querySelectorAll('#stance .fl').forEach((f, i) => f.classList.toggle('on', i <= m)); });
  const cd = (id, v, max, ok) => { const el = $(id); el.style.setProperty('--cd', (v / max).toFixed(3)); el.classList.toggle('off', !ok); };
  cd('cdS', P.attackCd, 0.3, true); cd('cdD', P.dashCd, 1.6, true); cd('cdF', P.flareCd, 5.6, P.fuel >= BAL.flareCost); cd('cdP', P.pulseCd, 2.15, P.fuel >= pulseCost());
  if (IS_TOUCH) { $('bDash').style.setProperty('--cd', (P.dashCd / 1.6).toFixed(3)); $('bFlare').style.setProperty('--cd', (P.flareCd / 5.6).toFixed(3)); $('bPulse').style.setProperty('--cd', (P.pulseCd / 2.15).toFixed(3)); }
  const mood = P.fuel < 15 ? 'AFRAID' : P.hp < 30 ? 'WORRIED' : MODES[lantern.mode].mood.toUpperCase();
  setIf('mood', mood, (v) => { $('mood').textContent = v; });
  setIf('coins', S.coins + (S.lynJoined ? '+L' : ''), () => { $('coins').textContent = '\u25c8 ' + S.coins + ' COINS' + (S.lynJoined ? '  \u00b7  LYN WITH YOU' : ''); });
  $('danger').style.opacity = (G.danger * (0.55 + 0.45 * Math.sin(performance.now() * 0.009))).toFixed(3);
  $('hurtfx').style.opacity = (P.hurt / 0.4).toFixed(3);
  G.flash = Math.max(0, G.flash - dt * 2.2); $('flashfx').style.opacity = (G.flash * 0.7).toFixed(3);
  // prompt
  let pr = '';
  if (G.state === 'playing') {
    const key = IS_TOUCH ? 'USE' : 'R';
    const who = talkTarget();
    if (who) pr = key + ' · TALK TO ' + talkName(who);
    else if (Math.hypot(LV.exit.x - P.x, LV.exit.z - P.z) < 2.6) pr = key + ' · ' + (FLOORS[LV.floor].leave || 'DESCEND');
    else if (ST.on && ST.sera.breakable && !ST.freed && ST.anchors.some((a) => !a.broken && Math.hypot(a.x - P.x, a.z - P.z) < 2.8)) pr = (IS_TOUCH ? 'SLASH' : 'CLICK') + ' · STRIKE THE ANCHOR';
    else if (nearestBrazier(2.6, false)) pr = key + ' · LIGHT THE BRAZIER';
  }
  setIf('prompt', pr, (v) => { $('prompt').textContent = v; $('prompt').classList.toggle('on', !!v); });
  voiceTick(dt);
  drawMap();
}
const mapC = $('map'), mg = mapC.getContext('2d');
let mapImg = null, mapT = 0;
function drawMap() {
  const S = mapC.width, sc = S / Math.max(LV.w, LV.h);
  mapT -= 1 / 60;
  if (!mapImg || mapImg.width !== S || mapT <= 0) {
    mapT = 0.25; mapImg = mg.createImageData(S, S); const d = mapImg.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const tx = Math.floor(x / sc), ty = Math.floor(y / sc), o = (y * S + x) * 4; d[o + 3] = 255;
      if (!inBounds(tx, ty) || !LV.discovered[idx(tx, ty)]) { d[o] = 8; d[o + 1] = 7; d[o + 2] = 6; continue; }
      if (LV.tiles[idx(tx, ty)]) { d[o] = 176; d[o + 1] = 160; d[o + 2] = 128; } else if (LV.solid) { d[o] = 58; d[o + 1] = 54; d[o + 2] = 50; } else { d[o] = 40; d[o + 1] = 46; d[o + 2] = 34; }
    }
  }
  mg.putImageData(mapImg, 0, 0);
  for (const b of LV.braziers) if (b.lit && LV.discovered[idx(toTile(b.x), toTile(b.z))]) { mg.fillStyle = '#ff9a40'; mg.fillRect(b.x / TILE * sc - 1.5, b.z / TILE * sc - 1.5, 3, 3); }
  if (LV.exit.found) { mg.strokeStyle = '#e8c878'; mg.lineWidth = 1.5; mg.beginPath(); mg.arc(LV.exit.x / TILE * sc, LV.exit.z / TILE * sc, 3.5, 0, TAU); mg.stroke(); }
  const px = P.x / TILE * sc, pz = P.z / TILE * sc, h = Math.atan2(lantern.dir.z, lantern.dir.x);
  mg.fillStyle = 'rgba(255,226,170,.22)'; mg.beginPath(); mg.moveTo(px, pz); mg.arc(px, pz, lantern.distance / TILE * sc, lantern.ring ? 0 : h - lantern.angle, lantern.ring ? Math.PI * 2 : h + lantern.angle); mg.closePath(); mg.fill();
  mg.fillStyle = '#fff'; mg.beginPath(); mg.arc(px, pz, 2, 0, TAU); mg.fill();
}

// ---------- tricks panel + stats + x-ray (Eyeshine's) ----------
let tricksOpen = false;
function toggleTricks(force) {
  tricksOpen = force !== undefined ? force : !tricksOpen;
  $('tricks').classList.toggle('hidden', !tricksOpen); $('tricksBtn').setAttribute('aria-expanded', String(tricksOpen));
  $('tricksBtn').textContent = (tricksOpen ? 'CLOSE' : 'TRICKS') + (IS_TOUCH ? '' : ' · T');
  if (G.state === 'playing') { G.paused = tricksOpen || !$('pauseOv').classList.contains('hidden'); if (tricksOpen && document.pointerLockElement) document.exitPointerLock(); }
}
$('tricksBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleTricks(); if (!tricksOpen && G.state === 'playing') { $('pauseOv').classList.add('hidden'); G.paused = false; tryLock(); } });
document.querySelectorAll('#tricks input').forEach((inp) => {
  const k = inp.dataset.k; inp.checked = !!settings[k];
  inp.addEventListener('change', () => { settings[k] = inp.checked; applySetting(k); });
});
function setDetail(d) { settings.detail = d; document.querySelectorAll('#detailSeg button').forEach((b) => b.classList.toggle('on', b.dataset.d === d)); ensureDetail(); refreshCreatureDetail(); }
document.querySelectorAll('#detailSeg button').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); setDetail(b.dataset.d); }));
try { if (localStorage.getItem('hc3d-ring') === '1') settings.ring = true; setDifficulty(localStorage.getItem('hc3d-diff') || 'standard'); } catch (e) { /* private mode: no memory */ }
function diffLabel() { $('diffBtn').innerHTML = 'DIFFICULTY: ' + DF.name + '<small>' + DF.blurb + '</small>'; }
$('diffBtn').addEventListener('click', (e) => { e.stopPropagation(); const ks = Object.keys(DIFFS); setDifficulty(ks[(ks.indexOf(DF.key) + 1) % ks.length]); try { localStorage.setItem('hc3d-diff', DF.key); } catch (er) { /* ignore */ } diffLabel(); });
diffLabel();
function ringLabel() { $('ringBtn').textContent = settings.ring ? 'LANTERN: A RING OF LIGHT (THE ORIGINAL)' : 'LANTERN: A BEAM (ONE DIRECTION)'; }
$('ringBtn').addEventListener('click', (e) => { e.stopPropagation(); settings.ring = !settings.ring; applySetting('ring'); });
function applySetting(k) {
  if (k === 'ring') { try { localStorage.setItem('hc3d-ring', settings.ring ? '1' : '0'); } catch (e) { /* ignore */ } ringLabel(); }
  const box = document.querySelector(`#tricks input[data-k=${k}]`); if (box) box.checked = !!settings[k];
  if (k === 'psx') { $('stage').classList.toggle('px', settings.psx); snapOn.value = settings.psx ? 1 : 0; resize(); }
  if (k === 'xray') $('xray').classList.toggle('hidden', !settings.xray);
  if (k === 'stats') $('stats').classList.toggle('hidden', !settings.stats);
  if (k === 'sound') setSound(settings.sound);
  if (k === 'culling' && !settings.culling && W) for (const c of W.cullables) c.mesh.visible = true;
}
let lastStats = null, statT0 = performance.now(), statFrames = 0, fps = 0;
const perf = { js: 0, render: 0 };
function updateStats() {
  statFrames++; const now = performance.now(), el = (now - statT0) / 1000; if (el < 0.5) return;
  fps = Math.round(statFrames / el); statT0 = now; statFrames = 0;
  const show = settings.stats && (G.state === 'playing' || G.state === 'menu');
  $('stats').classList.toggle('hidden', !show); if (!show) return;
  const info = renderer.info.render, k = (t) => (t >= 1e6 ? (t / 1e6).toFixed(2) + 'M' : (t / 1000).toFixed(1) + 'k');
  const viewT = info.triangles - statsProbe.shadowTris - 1, viewC = info.calls - statsProbe.shadowCalls - 1;
  const ct = creatureTris(), B = W.ruins && W.ruins.blocks, bl = B ? B.drawn : 0;
  lastStats = { fps, view: viewT, shadow: statsProbe.shadowTris, calls: viewC, shadowCalls: statsProbe.shadowCalls, objects: W.drawn, total: W.total, cover: W.coverDrawn, creatures: ct, blocks: bl, occluded: W.occluded || 0, jsMs: +perf.js.toFixed(2), renderMs: +perf.render.toFixed(2) };
  $('stats').innerHTML = `${fps} FPS · DETAIL ${DETAIL[settings.detail].label}<br><b>${k(viewT)} tris in view</b><br>${k(ct)} of them creatures<br>+${k(statsProbe.shadowTris)} shadow pass<br>${viewC} draw calls (+${statsProbe.shadowCalls})<br>${W.drawn} / ${W.total} objects · ${W.coverDrawn} cover` + (W.ruins ? `<br>${bl} carved blocks · ${W.occluded || 0} behind walls` : '');
}
const xr = $('xray'), xg = xr.getContext('2d');
function drawXray() {
  if (!settings.xray) return;
  const S = xr.width, R = 36, sc = S / 2 / R, cx = S / 2, cy = S / 2, s = Math.sin(P.yaw), c = Math.cos(P.yaw);
  const proj = (x, z) => { const dx = x - P.x, dz = z - P.z; return [cx + (dx * c - dz * s) * sc, cy - (-dx * s - dz * c) * sc]; };
  xg.clearRect(0, 0, S, S); xg.save(); xg.beginPath(); xg.arc(cx, cy, S / 2, 0, TAU); xg.clip();
  xg.fillStyle = 'rgba(0,0,0,.8)'; xg.fillRect(0, 0, S, S);
  const fx = lantern.dir.x, fz = lantern.dir.z, fl = Math.hypot(fx, fz) || 1, off = Math.atan2((fx * c - fz * s) / fl, (-fx * s - fz * c) / fl);
  if (lantern.k > 0.02) { xg.fillStyle = 'rgba(255,236,190,.16)'; xg.beginPath(); xg.moveTo(cx, cy); xg.arc(cx, cy, lantern.distance * sc, lantern.ring ? 0 : -Math.PI / 2 + off - lantern.angle, lantern.ring ? Math.PI * 2 : -Math.PI / 2 + off + lantern.angle); xg.closePath(); xg.fill(); }
  if (W.ruins) { // walls: bright where drawn this frame, dim where culled
    for (const c of W.ruins.cells) for (const f of c.faces) {
      const a = f.xFace ? [f.plane, f.u0] : [f.u0, f.plane], b = f.xFace ? [f.plane, f.u0 + TILE] : [f.u0 + TILE, f.plane];
      if (Math.hypot(a[0] - P.x, a[1] - P.z) > R + 4) continue;
      const [x0, y0] = proj(a[0], a[1]), [x1, y1] = proj(b[0], b[1]); xg.strokeStyle = c.mesh.visible ? '#efe6cf' : '#3a3632'; xg.lineWidth = 2; xg.beginPath(); xg.moveTo(x0, y0); xg.lineTo(x1, y1); xg.stroke();
    }
  }
  for (const o of W.cullables) {
    const dx = o.cx - P.x, dz = o.cz - P.z; if (dx * dx + dz * dz > (R + 8) ** 2 || o.ground || o.wall) continue;
    const [x, y] = proj(o.cx, o.cz); xg.fillStyle = o.mesh.visible ? '#efe6cf' : '#34322e'; xg.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  for (const e of CR.list) { const [x, y] = proj(e.x, e.z); xg.fillStyle = e.mesh.visible ? '#ff7a4a' : '#7a3a2a'; xg.beginPath(); xg.arc(x, y, 3.5, 0, TAU); xg.fill(); }
  xg.fillStyle = '#fff'; xg.beginPath(); xg.moveTo(cx, cy - 7); xg.lineTo(cx - 4, cy + 5); xg.lineTo(cx + 4, cy + 5); xg.closePath(); xg.fill(); xg.restore();
}

// ---------- resize ----------
function resize() {
  const w = innerWidth, h = innerHeight; let rw, rh;
  if (settings.psx) { rh = 270; rw = Math.round((w / h) * rh); }
  else { const pr = Math.min(devicePixelRatio || 1, IS_TOUCH ? 1.5 : 2); rw = Math.round(w * pr); rh = Math.round(h * pr); }
  renderer.setPixelRatio(1); renderer.setSize(rw, rh, false); G.renderH = rh;
  snapU.value.set(rw / 4, rh / 4);
  camera.aspect = w / h; camera.fov = clamp((2 * Math.atan(Math.tan(0.54) / camera.aspect) * 180) / Math.PI, 72, 96); camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
$('ctrlText').textContent = IS_TOUCH
  ? 'Left thumb walks · right thumb looks · SLASH · DASH · FLARE · PULSE · LIGHT opens the shutter · USE. Landscape works best.'
  : 'WASD move · mouse look (or ← → to turn) · click or Space: slash · Shift: dash · right-click or F: flare · E: pulse · Q or 1 2 3: lantern shutter · R: use · T: rendering tricks · Esc: pause';

// ---------- loop ----------
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (window.__hold) return; // automated tests drive the loop themselves (see __crown3d.step)
  runFrame(now, true);
}
function runFrame(now, doRender, fixedDt) {
  const rdt = fixedDt || Math.min(0.05, (now - lastT) / 1000); lastT = now;
  const t = now / 1000, tA = performance.now();
  let dt = rdt; if (G.hitstop > 0) { G.hitstop -= rdt; dt = rdt * 0.15; }
  if (G.state === 'menu') { P.yaw += rdt * 0.16; P.pitch = -0.08 + Math.sin(t * 0.35) * 0.06; }
  else if (G.state === 'playing') { if (!G.paused) { G.t += dt; updatePlayer(dt); updateRules(dt); } }
  else if (G.state === 'dead') { G.endT += rdt; if (G.endT > 2.4) showEnd(); }
  else if (G.state === 'descending') {
    G.endT += rdt;
    if (!G.won && G.endT > 1.6) $('fade').classList.add('on');
    if (G.endT > 2.6) { if (G.won) showEnd(); else nextFloor(); }
  }
  if (G.state === 'dead' || G.state === 'descending') voiceTick(rdt);
  updateCamera(rdt);
  const live = G.state === 'playing' && !G.paused;
  updateLantern(rdt, { on: G.state !== 'ended' && !(G.state === 'dead' && G.endT > 1.2), fuel: G.state === 'menu' ? 100 : P.fuel, bob: P.bob, moving: P.moving, menu: G.state === 'menu', brightBonus: P.brightBonus });
  updateWorldLights(rdt, t);
  updateCreatures(live ? dt : G.state === 'menu' ? rdt : 0, camera);
  updateStory(live ? dt : 0, live); ruinsTick(rdt, P.x, P.z, H.say);
  if (G.state !== 'menu') updateNPCs(rdt, live);
  updateItems(rdt, t);
  updateEnvironment();
  updateCulling(); updateCover(); updateFireflies(rdt, t, G.danger); updateFX(G.paused ? 0 : dt);
  updateAudio(rdt, P.x, P.z, lantern.fwd, live, CR.dangerNear, G.danger);
  const tB = performance.now();
  if (doRender) { renderer.info.reset(); renderer.render(scene, camera); }
  camera.layers.disable(1);
  perf.js = lerp(perf.js, tB - tA, 0.1); perf.render = lerp(perf.render, performance.now() - tB, 0.1);
  if (G.state === 'playing' || G.state === 'dead' || G.state === 'descending') updateHUD(rdt);
  updateStats(); drawXray();
}

// boot
resize();
applySetting('psx'); applySetting('stats'); applySetting('xray'); applySetting('ring'); setDetail(settings.detail);
toMenu();
requestAnimationFrame(frame);

// hook for automated playtesting
window.__crown3d = { G, P, ST, S, NPCS, settings, get LV() { return LV; }, get W() { return W; }, CR, lantern, get stats() { return lastStats; }, startGame, applySetting, setDetail, toggleTricks, camera, renderer, A, setMode, damageEnemy, sfx, addCreature, rigTris, descend, nextFloor,
  measure() { const info = renderer.info.render; return { view: info.triangles - statsProbe.shadowTris - 1, shadow: statsProbe.shadowTris, calls: info.calls - statsProbe.shadowCalls - 1, shadowCalls: statsProbe.shadowCalls, objects: W.drawn, total: W.total, cover: W.coverDrawn, creatures: creatureTris(), blocks: W.ruins && W.ruins.blocks ? W.ruins.blocks.drawn : 0, occluded: W.occluded || 0 }; },
  step(sec, render = true) { let n = Math.round(sec * 60), now = lastT; for (let i = 0; i < n; i++) { now += 1000 / 60; runFrame(now, false, 1 / 60); } if (render) runFrame(now + 1000 / 60, true, 1 / 60); } };
