import { THREE, glowTex, psx, GeoBuilder, T, M, col, srand, rr, mr, clamp, lerp, smooth, damp, wrapAngle, lerpAngle, rotYOfHeading, settings, TAU } from './engine.js';
import { LV, TILE, toTile, inBounds, idx, isWalkable, lineOfSight, findPath, moveWithCollisions } from './level.js';
import { lantern, beamAt, glint, lanternLevel, MODES, NEAR_R } from './lantern.js';
import { W, litTest, worldLevel } from './world3d.js';
import { G, P, H, BAL } from './state.js';
import { sfx } from './audio.js';

// =====================================================================
//  CREATURES — the Deep Woods' hunters, with the 2D Crown's AI ported to
//  metres (chase with A* on the tile grid, flee into the dark, wind-up and
//  lunge, exposure) and Eyeshine's eyes: glints that shine back at your
//  lantern from past the edge of what is drawn.
// =====================================================================
export const DEFS = {
  wolf: { name: 'Starving Wolf', hp: 28, speed: 4.1, r: 0.42, sense: 15, damage: 8, range: 2.0, windup: 0.3, recover: 0.38, lunge: 0.17, lungeSpeed: 10, eye: 0xffa53c },
  leech: { name: 'Shade Leech', hp: 30, speed: 3.3, r: 0.45, sense: 15, damage: 10, range: 2.3, windup: 0.32, recover: 0.42, lunge: 0.16, lungeSpeed: 9.5, eye: 0xc89cff },
  moth: { name: 'Ember Moth', hp: 12, speed: 4.4, r: 0.35, sense: 20, damage: 6, range: 1.1, windup: 0, recover: 0.12, lunge: 0, lungeSpeed: 0, eye: 0 },
  bandit: { name: 'Forest Bandit', hp: 45, speed: 3.5, r: 0.45, sense: 16, damage: 12, range: 2.1, windup: 0.4, recover: 0.42, lunge: 0.1, lungeSpeed: 6, eye: 0 },
};
export const CR = { list: [], dangerNear: 99 };
const SEEN = { wolf: 'Wolves. Starving and desperate.', bandit: 'Armed. Careful.', moth: 'The small ones drink light.', leech: 'It hates the bright edge.' };

// ---------- models (built once, shared; every model faces +Z) ----------
const models = {};
function buildModels() {
  srand(4242);
  { // wolf
    const b = new GeoBuilder(), c = col(0x6e6458), d = col(0x3e3830);
    b.add(T.box, M(0, 0.72, -0.05, 0, 0, 0, 0.34, 0.34, 0.95), c, 0.12);
    b.add(T.ico, M(0, 0.78, 0.32, 0, 0, 0, 0.24, 0.27, 0.3), d, 0.15);
    b.add(T.ico, M(0, 0.64, -0.42, 0, 0, 0, 0.19, 0.21, 0.26), c, 0.12);
    const n = b.limb(T.cyl6, 0, 0.82, 0.38, 0.32, 0.1, 0.8, 0, c, 0.1);
    b.add(T.box, M(n[0], n[1] + 0.02, n[2] + 0.1, 0.15, 0, 0, 0.2, 0.2, 0.3), c, 0.1);
    b.add(T.box, M(n[0], n[1] - 0.04, n[2] + 0.3, 0.2, 0, 0, 0.11, 0.1, 0.22), d, 0.1);
    for (const s of [-1, 1]) b.add(T.cone4, M(n[0] + s * 0.07, n[1] + 0.15, n[2] + 0.02, 0, 0, s * 0.25, 0.045, 0.12, 0.04), d, 0.1);
    b.limb(T.cyl4, 0, 0.78, -0.5, 0.5, 0.05, 2.3, Math.PI, d, 0.1);
    const lg = new GeoBuilder(); lg.add(T.cyl4, M(0, -0.32, 0, 0, 0, 0, 0.05, 0.64, 0.05), c, 0.1); lg.add(T.box, M(0, -0.64, 0.04, 0, 0, 0, 0.07, 0.04, 0.1), d, 0.1);
    models.wolf = { body: b.build(), leg: lg.build(), legs: [[-0.12, 0.66, 0.3], [0.12, 0.66, 0.3], [-0.12, 0.64, -0.38], [0.12, 0.64, -0.38]], eyeX: 0.065, eyeY: n[1] + 0.06, eyeZ: n[2] + 0.25, sy: 0.6, sr: 0.9 };
  }
  { // shade leech: a long, low, wet shadow with one pale eye
    const b = new GeoBuilder(), c = col(0x2a2238), r = col(0x3c3050), t = col(0x1e1828);
    b.add(T.sphere, M(0, 0.3, 0, 0, 0, 0, 0.42, 0.3, 0.95), c, 0.15);
    for (let i = 0; i < 6; i++) b.add(T.ico, M(0, 0.52, -0.6 + i * 0.22, 0, 0, 0, 0.12, 0.08, 0.12), r, 0.2);
    for (let i = 0; i < 6; i++) { const a = -0.9 + i * 0.36; b.limb(T.cyl4, Math.sin(a) * 0.25, 0.25, 0.8, rr(0.4, 0.6), 0.025, 1.3, a, t, 0.1); }
    b.add(T.cyl10, M(0, 0.28, 0.93, Math.PI / 2, 0, 0, 0.15, 0.05, 0.12), col(0x120c18), 0.1);
    models.leech = { body: b.build(), eyeX: 0, eyeY: 0.55, eyeZ: 0.62, sy: 0.35, sr: 0.9 };
  }
  { // ember moth: dusty wings, a body that smoulders
    const b = new GeoBuilder(), c = col(0x5a4630);
    b.add(T.ico, M(0, 0, 0, 0, 0, 0, 0.09, 0.09, 0.28), c, 0.12); b.add(T.ico, M(0, 0.02, 0.25, 0, 0, 0, 0.07, 0.07, 0.07), c, 0.12);
    for (const s of [-1, 1]) b.limb(T.cyl4, s * 0.03, 0.05, 0.3, 0.2, 0.006, 0.9, s * 0.4, c, 0.1);
    const wg = new GeoBuilder(), w1 = col(0x9a7a4a), w2 = col(0x6e5434), spot = col(0xd8b070);
    wg.tri(0, 0, 0.15, 0.62, 0, 0.12, 0.55, 0, -0.28, w1, 0.12); wg.tri(0, 0, 0.15, 0.55, 0, -0.28, 0.08, 0, -0.32, w2, 0.12);
    wg.tri(0.25, 0.005, 0.02, 0.4, 0.005, 0.06, 0.38, 0.005, -0.1, spot, 0.05);
    models.moth = { body: b.build(), wing: wg.build(), sy: 0, sr: 0.6 };
  }
  { // forest bandit: a hooded man with a short blade
    const b = new GeoBuilder(), cloak = col(0x3a3328), jerkin = col(0x4a3a28), dark = col(0x1a1612), boots = col(0x2a241e);
    for (const s of [-1, 1]) b.limb(T.cyl4, s * 0.1, 0.92, 0, 0.92, 0.07, Math.PI, 0, boots, 0.1);
    b.add(T.box, M(0, 1.2, 0, 0, 0, 0, 0.42, 0.58, 0.24), jerkin, 0.12);
    b.add(T.cone, M(0, 1.05, -0.08, 0, 0, 0, 0.36, 1.3, 0.26), cloak, 0.14);
    b.add(T.ico, M(0, 1.62, 0, 0, 0, 0, 0.13, 0.15, 0.13), col(0x6a5444), 0.1);
    b.add(T.cone, M(0, 1.72, -0.03, -0.2, 0, 0, 0.18, 0.36, 0.18), cloak, 0.12);
    b.add(T.box, M(0, 1.6, 0.11, 0, 0, 0, 0.14, 0.07, 0.04), dark, 0.05);
    b.limb(T.cyl4, -0.26, 1.42, 0, 0.6, 0.055, Math.PI - 0.15, -Math.PI / 2, cloak, 0.1);
    const ab = new GeoBuilder(); ab.limb(T.cyl4, 0, 0, 0, 0.55, 0.055, Math.PI - 0.3, 0, cloak, 0.1);
    ab.add(T.box, M(0, -0.5, 0.36, 1.25, 0, 0, 0.035, 0.62, 0.007), col(0xb8bcc0), 0.08); ab.add(T.box, M(0, -0.52, 0.12, 0, 0, 0, 0.12, 0.02, 0.03), col(0x5a4a30), 0.1);
    models.bandit = { body: b.build(), arm: ab.build(), sy: 0.9, sr: 1.0 };
  }
  for (const k in models) for (const g of Object.values(models[k])) if (g && g.isBufferGeometry) g.userData.keep = true;
}

function makeEye(color) {
  return new THREE.SpriteMaterial({ map: glowTex, color, depthWrite: false, fog: false, transparent: true, toneMapped: false, opacity: 0 });
}
function spawn(s) {
  const def = DEFS[s.type], m = models[s.type], grp = new THREE.Group();
  const mat = psx(new THREE.MeshLambertMaterial({ vertexColors: true, dithering: true, emissive: 0x000000 }));
  const body = new THREE.Mesh(m.body, mat); body.castShadow = true; body.receiveShadow = true; grp.add(body);
  const e = {
    type: s.type, def, x: s.x, z: s.z, r: def.r, hp: def.hp, maxHp: def.hp, speed: def.speed, state: s.camp ? 'camp' : 'wander', stateTime: rr(1, 3),
    path: null, pathTimer: rr(0.2, 0.8), lastKnown: { x: s.x, z: s.z }, facing: rr(0, TAU), exposed: 0, exposeFlash: 0,
    windup: 0, windupMax: 0, recover: 0, recoverAfter: 0, attackKind: '', attackAngle: 0, lungeTime: 0, lungeAfter: 0, lungeSpeed: 0, lungeSpeedAfter: 0,
    hitOnce: false, attackCd: rr(0.4, 1), hurtFlash: 0, invuln: 0, lightStress: 0, blocking: false, camp: !!s.camp, drainTick: 0, wanderAngle: rr(0, TAU),
    fy: 1.6, phase: rr(0, 10), grp, body, mat, legs: [], wings: [], arm: null, eyes: [], eyeMat: null, glow: null, blade: null, bladeMat: null,
    retro: 0, blinkT: mr(2, 6), blinking: 0, losT: 0, los: false, dist: 99, nextSound: mr(1, 4), alive: true, bodyVis: false, sy: m.sy, sr: m.sr, light: 0,
  };
  if (s.camp && LV.camp) e.facing = Math.atan2(LV.camp.z - s.z, LV.camp.x - s.x);
  if (s.type === 'wolf') for (const [x, y, z] of m.legs) { const l = new THREE.Mesh(m.leg, mat); l.position.set(x, y, z); l.castShadow = true; grp.add(l); e.legs.push(l); }
  if (s.type === 'moth') {
    for (const sd of [1, -1]) { const w = new THREE.Mesh(m.wing, mat); w.scale.x = sd; w.castShadow = true; grp.add(w); e.wings.push(w); }
    const gm = new THREE.SpriteMaterial({ map: glowTex, color: 0xff9a40, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, toneMapped: false, opacity: 0.6 });
    e.glow = new THREE.Sprite(gm); e.glow.scale.set(0.7, 0.7, 1); grp.add(e.glow);
  }
  if (s.type === 'bandit') {
    const arm = new THREE.Group(); arm.position.set(0.26, 1.42, 0); const am = new THREE.Mesh(m.arm, mat); am.castShadow = true; arm.add(am); grp.add(arm); e.arm = arm;
    e.bladeMat = makeEye(0xe8f0ff); e.blade = new THREE.Sprite(e.bladeMat); e.blade.position.set(0, -0.62, 0.55); arm.add(e.blade);
  }
  if (def.eye) {
    e.eyeMat = makeEye(def.eye); e.eyeBase = new THREE.Color(def.eye); e.eyeX = m.eyeX; e.eyeY = m.eyeY; e.eyeZ = m.eyeZ;
    const n = s.type === 'leech' ? 1 : 2;
    for (let i = 0; i < n; i++) { const sp = new THREE.Sprite(e.eyeMat); sp.position.set(0, m.eyeY, m.eyeZ); grp.add(sp); e.eyes.push(sp); }
  }
  W.group.add(grp);
  return e;
}
export function spawnCreatures() {
  if (!models.wolf) buildModels();
  for (const e of CR.list) disposeCreature(e);
  CR.list = LV.spawns.map(spawn);
}
export function addCreature(type, x, z) { if (!models.wolf) buildModels(); const e = spawn({ type, x, z }); CR.list.push(e); return e; }
function disposeCreature(e) { e.mat.dispose(); if (e.eyeMat) e.eyeMat.dispose(); if (e.bladeMat) e.bladeMat.dispose(); if (e.glow) e.glow.material.dispose(); if (e.grp.parent) e.grp.parent.remove(e.grp); }

// ---------- light at a creature (lantern needs line of sight; braziers and flares don't care) ----------
function lightAtE(e) {
  const y = e.type === 'moth' ? e.fy : 0.6;
  return Math.max(e.los ? lanternLevel(e.x, y, e.z) : 0, worldLevel(e.x, e.z));
}
function lightAtP(x, z) { return Math.max(lanternLevel(x, 0.5, z), worldLevel(x, z)); }
function enemySeesPlayer(e) {
  const st = MODES[lantern.mode].stealth * (lantern.k < 0.2 ? 0.6 : 1);
  return e.dist <= e.def.sense * st && e.los;
}
function pickDarkNeighbor(e) {
  const tx = toTile(e.x), ty = toTile(e.z); let best = null, bs = -1e9;
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    if (!x && !y) continue; const nx = tx + x, ny = ty + y; if (!isWalkable(nx, ny)) continue;
    const px = (nx + 0.5) * TILE, pz = (ny + 0.5) * TILE, s = Math.hypot(px - P.x, pz - P.z) - lightAtP(px, pz) * 11 + mr(-0.5, 0.5);
    if (s > bs) { bs = s; best = { x: px, z: pz }; }
  }
  return best;
}
function chooseWanderTarget(e) {
  const tx = toTile(e.x), ty = toTile(e.z);
  for (let i = 0; i < 10; i++) { const nx = tx + Math.round(mr(-6, 6)), ny = ty + Math.round(mr(-6, 6)); if (isWalkable(nx, ny)) { e.lastKnown = { x: (nx + 0.5) * TILE, z: (ny + 0.5) * TILE }; return; } }
  e.lastKnown = { x: e.x, z: e.z };
}
const nudge = (e, a, d) => moveWithCollisions(e, Math.cos(a) * d / 0.08, Math.sin(a) * d / 0.08, 0.08);
const angleTo = (ax, az, bx, bz) => Math.atan2(bz - az, bx - ax);

// ---------- combat (ported) ----------
export function interruptEnemy(e, stagger = 0.18) { e.windup = 0; e.lungeTime = 0; e.lungeSpeed = 0; e.hitOnce = false; e.attackKind = ''; e.recover = Math.max(e.recover, stagger); }
export function exposeEnemy(e, duration = 1.15) {
  if (!e.alive) return; const gained = e.exposed <= 0;
  e.exposed = Math.max(e.exposed, duration); e.exposeFlash = Math.max(e.exposeFlash, 0.24);
  interruptEnemy(e, Math.min(duration * 0.42, 0.38));
  if (e.type === 'leech') { e.state = 'flee'; e.stateTime = Math.max(e.stateTime, 0.7); e.lightStress = 0; }
  if (gained) { sfx.expose(e); if (e.bodyVis) H.say(e.type === 'leech' ? 'It hates the bright edge.' : 'Now. Strike.'); }
}
function beginWindup(e, kind, angle) {
  const d = e.def; e.attackKind = kind; e.attackAngle = angle; e.windup = d.windup; e.windupMax = d.windup;
  e.recoverAfter = d.recover; e.lungeAfter = d.lunge; e.lungeSpeedAfter = d.lungeSpeed; e.hitOnce = false; e.attackCd = d.windup + d.recover + 0.18;
  sfx.windup(e);
}
function executeAttack(e) {
  const dir = e.attackAngle; e.windup = 0; e.facing = dir;
  if (e.attackKind === 'cut') { // the bandit's swing: no lunge, it lands or it doesn't
    const dx = P.x - e.x, dz = P.z - e.z, d = Math.hypot(dx, dz);
    if (d < e.def.range + 0.4 && Math.abs(wrapAngle(Math.atan2(dz, dx) - dir)) < 0.9 && P.invuln <= 0) H.damagePlayer(e.def.damage, 'physical', e.x, e.z);
    e.lungeTime = e.lungeAfter; e.lungeSpeed = e.lungeSpeedAfter; e.hitOnce = true; return;
  }
  e.lungeTime = e.lungeAfter; e.lungeSpeed = e.lungeSpeedAfter;
}
function handleAction(e, dt) {
  e.exposed = Math.max(0, e.exposed - dt); e.exposeFlash = Math.max(0, e.exposeFlash - dt);
  if (e.windup > 0) { e.windup -= dt; e.facing = lerpAngle(e.facing, angleTo(e.x, e.z, P.x, P.z), clamp(dt * 8, 0, 1)); e.attackAngle = e.facing; if (e.windup <= 0) executeAttack(e); return true; }
  if (e.lungeTime > 0) {
    e.lungeTime -= dt; moveWithCollisions(e, Math.cos(e.attackAngle) * e.lungeSpeed, Math.sin(e.attackAngle) * e.lungeSpeed, dt);
    if (!e.hitOnce && Math.hypot(P.x - e.x, P.z - e.z) < e.r + P.r + 0.3 && P.invuln <= 0) {
      e.hitOnce = true;
      if (e.attackKind === 'leechBite') { H.damagePlayer(e.def.damage, 'darkness', e.x, e.z); P.fuel = Math.max(0, P.fuel - BAL.leechBite); sfx.drink(); H.say('It found the wick.'); e.state = 'flee'; e.stateTime = 0.8; }
      else H.damagePlayer(e.def.damage, 'physical', e.x, e.z);
    }
    if (e.lungeTime <= 0) { e.lungeSpeed = 0; e.attackKind = ''; e.recover = Math.max(e.recover, e.recoverAfter || 0.34); }
    return true;
  }
  if (e.recover > 0) { e.recover = Math.max(0, e.recover - dt); return true; }
  return false;
}
// returns true if the hit landed
export function damageEnemy(e, amount, knock, dir, cause) {
  if (!e.alive || (e.invuln > 0 && cause !== 'light')) return false;
  let real = amount;
  if (e.type === 'bandit' && e.blocking && cause === 'slash') { real *= 0.5; e.blocking = false; sfx.block(); }
  if (cause === 'slash') { if (e.exposed > 0) real *= 1.72; else if (e.type === 'leech' && lantern.mode === 2) real *= 1.15; }
  else if (cause === 'pulse') real *= e.type === 'moth' ? 1 : 0.72;
  else if (cause === 'flare') { if (e.type === 'leech') real *= 1.06; }
  else if (cause === 'light') real *= e.type === 'leech' ? 1.2 : 0.28;
  e.hp -= real; e.invuln = cause === 'light' ? 0.03 : 0.07; e.hurtFlash = 0.2; e.exposeFlash = Math.max(e.exposeFlash, 0.12);
  if (cause !== 'light') { sfx.hit(e.exposed > 0); G.shake = Math.max(G.shake, e.exposed > 0 ? 0.5 : 0.28); G.hitstop = Math.max(G.hitstop, e.exposed > 0 ? 0.05 : 0.025); }
  if (knock > 0) nudge(e, dir, knock);
  if (e.windup > 0) {
    if (cause === 'flare') { if (e.type === 'leech' || e.type === 'wolf') exposeEnemy(e, 1.15); else interruptEnemy(e, 0.22); }
    else if (cause === 'pulse') { if (e.type === 'wolf') exposeEnemy(e, 1.2); else interruptEnemy(e, 0.18); }
  }
  if (e.state === 'camp') { e.state = 'chase'; e.stateTime = 2; }
  if (e.hp <= 0) {
    e.alive = false; G.kills++; sfx.kill(e);
    if (Math.random() < 0.18) H.addPickup('fuel', e.x, e.z);
    disposeCreature(e); CR.list = CR.list.filter((o) => o !== e);
  }
  return true;
}

// ---------- AI (ported from the Crown's updateEnemy) ----------
function updateEnemy(e, dt) {
  e.hurtFlash = Math.max(0, e.hurtFlash - dt); e.invuln = Math.max(0, e.invuln - dt); e.attackCd = Math.max(0, e.attackCd - dt); e.pathTimer -= dt; e.stateTime -= dt;
  const lightHere = e.light, sees = enemySeesPlayer(e), dP = e.dist, def = e.def;
  if (handleAction(e, dt)) return;
  if (e.type === 'moth') { mothAI(e, dt, lightHere, dP); return; }
  if (e.type === 'leech') { e.lightStress = clamp(e.lightStress + (lightHere > 0.62 ? dt * 1.7 : -dt * 0.8), 0, 1.4); if (e.lightStress > 0.7 && e.exposed <= 0) exposeEnemy(e, 1.05); }
  if (e.state === 'camp') { // bandits around their fire: they only get up when they see you (or you hit them)
    if (sees && dP < def.sense * 0.8) { e.state = 'chase'; e.stateTime = 1.5; sfx.shout(e); H.say('Armed. Careful.'); for (const o of CR.list) if (o.camp && o.state === 'camp') { o.state = 'chase'; o.stateTime = 1.5; o.lastKnown = { x: P.x, z: P.z }; } }
    else return;
  }
  if (sees) {
    if (e.state === 'wander' && e.type === 'wolf' && Math.random() < 0.35) sfx.howl(e);
    e.lastKnown.x = P.x; e.lastKnown.z = P.z;
    if (e.type === 'leech' && lightHere > 0.6) { e.state = 'flee'; e.stateTime = 0.9; }
    else if (e.type === 'wolf' && e.hp < e.maxHp * 0.3) { e.state = 'flee'; e.stateTime = 1.2; }
    else { e.state = 'chase'; e.stateTime = 1.1; }
    if (e.type === 'bandit' && e.windup <= 0 && !e.blocking && Math.random() < 0.03 * dt * 60) e.blocking = true;
    if (e.type === 'wolf') { let pack = 0; for (const o of CR.list) if (o !== e && o.type === 'wolf' && o.dist < 18) pack++; e.speed = def.speed * (pack >= 1 ? 1.15 : 1); }
  } else if (e.stateTime <= 0 && e.state !== 'camp') { e.state = 'wander'; chooseWanderTarget(e); e.stateTime = rr(2, 5); }

  if (e.state === 'chase') {
    const tg = e.lastKnown; let ang = angleTo(e.x, e.z, tg.x, tg.z);
    if (!lineOfSight(e.x, e.z, tg.x, tg.z) && e.pathTimer <= 0) { e.path = findPath(toTile(e.x), toTile(e.z), toTile(tg.x), toTile(tg.z)); e.pathTimer = 0.5; }
    if (e.path && e.path.length) { const nd = e.path[0]; if (Math.hypot(e.x - nd.x, e.z - nd.z) < 0.9) e.path.shift(); if (e.path[0]) ang = angleTo(e.x, e.z, e.path[0].x, e.path[0].z); }
    e.facing = lerpAngle(e.facing, ang, clamp(dt * 7, 0, 1));
    if (Math.hypot(e.x - tg.x, e.z - tg.z) > 0.6 || sees) moveWithCollisions(e, Math.cos(ang) * e.speed, Math.sin(ang) * e.speed, dt);
    if (dP < def.range && e.attackCd <= 0 && sees) {
      const dir = angleTo(e.x, e.z, P.x, P.z);
      beginWindup(e, e.type === 'leech' ? 'leechBite' : e.type === 'bandit' ? 'cut' : 'lunge', dir);
    }
  } else if (e.state === 'flee') {
    let ang = angleTo(P.x, P.z, e.x, e.z); const dk = pickDarkNeighbor(e); if (dk) ang = angleTo(e.x, e.z, dk.x, dk.z);
    e.facing = lerpAngle(e.facing, ang, clamp(dt * 5, 0, 1));
    moveWithCollisions(e, Math.cos(ang) * e.speed * 1.05, Math.sin(ang) * e.speed * 1.05, dt);
  } else if (e.state === 'wander') {
    const tg = e.lastKnown, ang = angleTo(e.x, e.z, tg.x, tg.z);
    e.facing = lerpAngle(e.facing, ang, clamp(dt * 3, 0, 1));
    if (Math.hypot(e.x - tg.x, e.z - tg.z) > 1.1) moveWithCollisions(e, Math.cos(ang) * e.speed * 0.35, Math.sin(ang) * e.speed * 0.35, dt);
    else if (e.stateTime <= 0) chooseWanderTarget(e);
  }
}
// moths go to light: your lantern if it touches them, else they circle the nearest lit brazier
function mothAI(e, dt, lh, dP) {
  let tx, tz, ty = 1.5;
  if (lh > 0.12 || dP < 4) { tx = P.x + Math.cos(e.phase) * 0.4; tz = P.z + Math.sin(e.phase) * 0.4; ty = 1.45; }
  else {
    let br = null, bd = 14; for (const b of W.braziers) if (b.src.lit) { const d = Math.hypot(b.src.x - e.x, b.src.z - e.z); if (d < bd) { bd = d; br = b; } }
    if (br) { const a = G.t * 1.3 + e.phase; tx = br.src.x + Math.cos(a) * 1.4; tz = br.src.z + Math.sin(a) * 1.4; ty = br.fy + 0.6; }
    else { e.wanderAngle += mr(-0.8, 0.8) * dt; tx = e.x + Math.cos(e.wanderAngle) * 3; tz = e.z + Math.sin(e.wanderAngle) * 3; }
  }
  const ang = angleTo(e.x, e.z, tx, tz) + Math.sin(G.t * 3 + e.phase) * 0.35, d = Math.hypot(tx - e.x, tz - e.z);
  e.facing = lerpAngle(e.facing, ang, clamp(dt * 5, 0, 1));
  const sp = e.speed * Math.min(1, d / 1.5);
  // they flutter over thickets (only the map edge stops them)
  e.x = clamp(e.x + Math.cos(ang) * sp * dt, 2 * TILE, (LV.w - 2) * TILE); e.z = clamp(e.z + Math.sin(ang) * sp * dt, 2 * TILE, (LV.h - 2) * TILE);
  e.fy = lerp(e.fy, ty + Math.sin(G.t * 2.3 + e.phase) * 0.25, damp(2, dt));
  if (dP < 1.2) { e.drainTick -= dt; if (e.drainTick <= 0) { e.drainTick = 0.5; P.fuel = Math.max(0, P.fuel - BAL.mothSip); if (Math.random() < 0.3) H.say('It drinks.'); } }
}

// ---------- per frame: AI, animation, eyeshine, culling ----------
let pxPerM = 0.005;
export function updateCreatures(dt, camera) {
  const active = G.state === 'playing' && !G.paused;
  pxPerM = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.min(G.renderH, 400);
  let danger = 0, near = 99;
  for (const e of [...CR.list]) {
    const dx = P.x - e.x, dz = P.z - e.z; e.dist = Math.hypot(dx, dz) || 0.001;
    e.losT -= dt; if (e.losT <= 0) { e.losT = 0.12 + Math.random() * 0.06; e.los = e.dist < 45 && lineOfSight(P.x, P.z, e.x, e.z); }
    e.light = lightAtE(e);
    if (active) updateEnemy(e, dt);
    if (!e.alive) continue;
    if (e.type !== 'moth' && (e.state === 'chase' || e.windup > 0)) { near = Math.min(near, e.dist); if (e.light < 0.3) danger = Math.max(danger, clamp(1 - (e.dist - 2) / 14, 0, 1)); }
    // sounds in the dark
    e.nextSound -= dt;
    if (active && e.nextSound < 0 && e.dist < 28) {
      if (e.type === 'moth') sfx.flutter(e, 0.6); else if (e.state === 'chase' || e.state === 'wander') sfx.rustle(e);
      if (e.type === 'leech' && Math.random() < 0.3) sfx.hiss(e);
      e.nextSound = mr(0.6, 1.6) * (0.5 + e.dist / 16);
    }
    // transform + animation
    const g = e.grp, speedish = e.state === 'chase' || e.lungeTime > 0 ? 1 : e.state === 'flee' ? 1 : e.state === 'wander' ? 0.35 : 0;
    e.phase += dt * (e.type === 'moth' ? 22 : 7 + speedish * 6) * (e.type === 'moth' ? 1 : speedish);
    g.position.set(e.x, e.type === 'moth' ? e.fy : 0, e.z); g.rotation.y = rotYOfHeading(e.facing);
    const crouch = e.windup > 0 ? 1 - e.windup / Math.max(0.01, e.windupMax) : 0;
    if (e.type === 'wolf') { e.legs.forEach((l, i) => { l.rotation.x = Math.sin(e.phase + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.6 * speedish; }); e.body.position.y = Math.abs(Math.sin(e.phase)) * 0.04 * speedish - crouch * 0.12; e.body.rotation.x = crouch * 0.12; }
    else if (e.type === 'leech') { const k = Math.sin(e.phase * 0.7); e.body.scale.set(1 - k * 0.07, 1, 1 + k * 0.12 + crouch * 0.2); }
    else if (e.type === 'moth') { const f = Math.sin(e.phase) * 0.9; e.wings[0].rotation.z = f; e.wings[1].rotation.z = -f; e.glow.material.opacity = 0.45 + 0.2 * Math.sin(G.t * 9 + e.phase); }
    else if (e.type === 'bandit') {
      e.body.position.y = Math.abs(Math.sin(e.phase)) * 0.03 * speedish;
      const raise = e.windup > 0 ? -2.2 * crouch : e.lungeTime > 0 || e.recover > 0.2 ? 0.7 : e.blocking ? -1.2 : e.state === 'camp' ? 0.2 : -0.3;
      e.arm.rotation.x = lerp(e.arm.rotation.x, raise, damp(e.windup > 0 ? 10 : 18, dt)); e.arm.rotation.z = e.blocking ? 0.6 : 0;
      if (e.state === 'camp') g.position.y = -0.35; // sitting by the fire
    }
    const fl = e.hurtFlash > 0 ? 0.7 : e.exposed > 0 ? 0.25 + 0.15 * Math.sin(G.t * 14) : e.type === 'moth' ? 0.12 : 0;
    e.mat.emissive.setRGB(fl, fl * (e.hurtFlash > 0 ? 1 : 0.75), fl * (e.hurtFlash > 0 ? 1 : 0.35));

    // body: drawn only when something lights it
    e.bodyVis = !settings.culling || litTest(e.x, e.sy + (e.type === 'moth' ? e.fy : 0), e.z, e.sr) || e.dist < NEAR_R + 0.6 || (e.type === 'moth' && e.dist < 9 && e.los) || G.state === 'dead';
    e.body.visible = e.bodyVis; e.legs.forEach((l) => (l.visible = e.bodyVis)); e.wings.forEach((w) => (w.visible = e.bodyVis)); if (e.arm) e.arm.children[0].visible = e.bodyVis;
    if (e.bodyVis && e.dist < lantern.distance && !G.tips['seen_' + e.type] && G.state === 'playing' && e.light > 0.15) { G.tips['seen_' + e.type] = 1; H.say(SEEN[e.type]); }
    if (e.glow) e.glow.visible = e.los && e.dist < 45; // an ember moth is a spark you can see from far off

    // eyeshine: light goes in, comes straight back at you
    if (e.eyes.length) {
      const ry = g.rotation.y, s = Math.sin(ry), c = Math.cos(ry), ex = e.x + s * e.eyeZ, ez = e.z + c * e.eyeZ, ey = g.position.y + e.eyeY;
      const r = beamAt(ex, ey, ez); let b = 0;
      if (lantern.k > 0.02 && r.ang < lantern.angle * 1.45 && e.los) b = glint(r.d, r.ang);
      if (e.dist < NEAR_R + 1) b = Math.max(b, 0.5 * Math.min(1, lantern.k));
      const facing = (Math.cos(e.facing) * dx + Math.sin(e.facing) * dz) / e.dist;
      b *= smooth(0.2, 0.85, facing);
      if (e.windup > 0) b = Math.min(1, b * 1.6 + 0.15 * (e.los ? 1 : 0)); // the eyes flare as it gathers to spring
      e.blinkT -= dt; if (e.blinkT < 0) { e.blinking = 0.13; e.blinkT = mr(2, 7); } e.blinking -= dt;
      e.retro = e.blinking > 0 ? 0 : b;
      const sz = Math.max(0.07, r.d * pxPerM * 3.2) * (e.type === 'leech' ? 1.5 : 1), spread = Math.max(e.eyeX, r.d * pxPerM * 2.3);
      e.eyeMat.opacity = e.retro; e.eyeMat.color.copy(e.eyeBase).multiplyScalar(1 + e.retro * 0.5);
      e.eyes.forEach((sp, i) => { sp.visible = e.retro > 0.01; sp.scale.set(sz, sz, 1); sp.position.x = e.eyes.length === 1 ? 0 : i === 0 ? -spread : spread; });
      if (e.retro > 0.35 && !e.bodyVis && !G.eyesSeen && G.state === 'playing') { G.eyesSeen = true; H.say('Eyes. Past my light.'); }
    }
    if (e.blade) { // steel catches the beam; men have no eyeshine
      const bp = e.blade.getWorldPosition(_v), r = beamAt(bp.x, bp.y, bp.z);
      const b = lantern.k > 0.02 && r.ang < lantern.angle * 1.3 && e.los ? glint(r.d, r.ang) * 0.8 * (0.6 + 0.4 * Math.sin(G.t * 11 + e.phase)) : 0;
      e.bladeMat.opacity = b; e.blade.visible = b > 0.02; const sz = Math.max(0.05, r.d * pxPerM * 2.4); e.blade.scale.set(sz, sz, 1);
    }
  }
  G.danger = lerp(G.danger, danger, damp(4, dt));
  CR.dangerNear = near;
}
const _v = new THREE.Vector3();
