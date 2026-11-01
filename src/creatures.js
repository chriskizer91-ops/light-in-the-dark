import { THREE, glowTex, psx, rr, mr, clamp, lerp, smooth, damp, wrapAngle, lerpAngle, rotYOfHeading, settings, TAU } from './engine.js';
import { LV, TILE, toTile, isWalkable, lineOfSight, findPath, moveWithCollisions } from './level.js';
import { lantern, beamAt, glint, lanternLevel, MODES, NEAR_R } from './lantern.js';
import { W, litTest, worldLevel, DETAIL } from './world3d.js';
import { getRig, makeSkeleton, LEECH_N } from './rigs.js';
import { burst, ember, puff, dust } from './fx.js';
import { G, P, H, BAL } from './state.js';
import { sfx } from './audio.js';

// =====================================================================
//  CREATURES — the Deep Woods' hunters. The 2D Crown's AI ported to metres
//  (chase with A* on the tile grid, flee into the dark, wind-up then lunge,
//  exposure), on detailed skinned rigs (rigs.js) with procedural animation:
//  gaits, head tracking, snarls and raised hackles, a leech that rears
//  before it strikes, wingbeats, a bandit who walks, guards, swings, blocks
//  and sits by the fire, hit recoil and a death that plays out. Eyes shine
//  back at the lantern from past the edge of what is drawn (Eyeshine).
// =====================================================================
export const DEFS = {
  wolf: { name: 'Starving Wolf', hp: 28, speed: 4.1, r: 0.42, sense: 15, damage: 8, range: 2.0, windup: 0.3, recover: 0.38, lunge: 0.17, lungeSpeed: 10, eye: 0xffa53c, sy: 0.6, sr: 1.0 },
  leech: { name: 'Shade Leech', hp: 30, speed: 3.3, r: 0.45, sense: 15, damage: 10, range: 2.3, windup: 0.32, recover: 0.42, lunge: 0.16, lungeSpeed: 9.5, eye: 0xc89cff, sy: 0.3, sr: 1.1 },
  moth: { name: 'Ember Moth', hp: 12, speed: 4.4, r: 0.35, sense: 20, damage: 6, range: 1.1, windup: 0, recover: 0.12, lunge: 0, lungeSpeed: 0, eye: 0, sy: 0, sr: 0.75 },
  bandit: { name: 'Forest Bandit', hp: 45, speed: 3.5, r: 0.45, sense: 16, damage: 12, range: 2.1, windup: 0.4, recover: 0.42, lunge: 0.1, lungeSpeed: 6, eye: 0, sy: 0.9, sr: 1.05 },
};
export const CR = { list: [], dead: [], dangerNear: 99 };
const SEEN = { wolf: 'Wolves. Starving and desperate.', bandit: 'Armed. Careful.', moth: 'The small ones drink light.', leech: 'It hates the bright edge.' };

// shared materials: glossy bits (eyes, teeth, claws, noses), steel, and self-lit glow (leech pustules, moth embers)
const GLOSS = psx(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: 0xffffff, dithering: true }));
const STEEL = psx(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: 0xfff0d8, dithering: true }));
const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const TONE = { wolf: 0.75, leech: 0.7, moth: 1, bandit: 0.9 };
const spriteMat = (color, add) => new THREE.SpriteMaterial({ map: glowTex, color, depthWrite: false, fog: false, transparent: true, toneMapped: false, opacity: 0, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });

// ---------- visuals ----------
function boneWorldDef(rig, name) { return rig.def.find((d) => d.name === name).pos; }
function anchorOn(e, rig, boneName, p) {
  const a = new THREE.Object3D(), bp = boneWorldDef(rig, boneName); a.position.set(p[0] - bp[0], p[1] - bp[1], p[2] - bp[2]); e.b[boneName].add(a); return a;
}
function buildVisual(e) {
  if (e.grp) disposeVisual(e);
  const q = DETAIL[settings.detail].q, rig = getRig(e.type, q), grp = new THREE.Group();
  const { bones, by, skeleton } = makeSkeleton(rig.def);
  grp.add(bones[0]); // bones live under the group, not the mesh: hiding the body keeps the eyes
  const body = psx(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rig.roughness, metalness: 0, side: rig.side, dithering: true, emissive: 0x000000 }));
  body.color.setScalar(TONE[e.type]); // creatures sit in the same dark world as the trees: keep their albedo low so a close beam doesn't wash them out
  const mesh = new THREE.SkinnedMesh(rig.geo, [body, GLOSS, rig.accent === 'steel' ? STEEL : GLOW]);
  mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; grp.add(mesh);
  grp.updateMatrixWorld(true); mesh.bind(skeleton);
  Object.assign(e, { grp, mesh, mat: body, b: by, tris: rig.geo.userData.tris, eyes: [], eyeMat: null, glow: null, blade: null, bladeMat: null, mouth: null });
  if (rig.eyes && DEFS[e.type].eye) {
    e.eyeMat = spriteMat(DEFS[e.type].eye, false); e.eyeBase = new THREE.Color(DEFS[e.type].eye); e.eyeX = rig.eyes.spread;
    e.eyeAnchor = anchorOn(e, rig, rig.eyes.bone, rig.eyes.pos);
    for (let i = 0; i < rig.eyes.n; i++) { const sp = new THREE.Sprite(e.eyeMat); e.eyeAnchor.add(sp); e.eyes.push(sp); }
  }
  if (e.type === 'wolf') e.mouth = anchorOn(e, rig, 'jaw', [0, 0.96, 0.95]);
  if (e.type === 'bandit') e.mouth = anchorOn(e, rig, 'head', [0, 1.62, 0.13]);
  if (e.type === 'moth') {
    e.glow = new THREE.Sprite(spriteMat(0xff9a40, true)); e.glow.scale.set(0.8, 0.8, 1); anchorOn(e, rig, rig.glowBone, [0, -0.06, -0.22]).add(e.glow);
    e.emberAt = anchorOn(e, rig, 'abd2', [0, -0.08, -0.4]);
  }
  if (rig.bladeBone) { e.bladeMat = spriteMat(0xe8f0ff, true); e.blade = new THREE.Sprite(e.bladeMat); anchorOn(e, rig, rig.bladeBone, rig.bladePos).add(e.blade); }
  W.group.add(grp);
}
function disposeVisual(e) { e.mat.dispose(); if (e.eyeMat) e.eyeMat.dispose(); if (e.bladeMat) e.bladeMat.dispose(); if (e.glow) e.glow.material.dispose(); if (e.grp.parent) e.grp.parent.remove(e.grp); e.grp = null; }
// the DETAIL setting changed: rebuild every creature's body at the new quality
export function refreshCreatureDetail() { for (const e of CR.list) buildVisual(e); }

function spawn(s) {
  const def = DEFS[s.type];
  const e = {
    type: s.type, def, x: s.x, z: s.z, r: def.r, hp: def.hp, maxHp: def.hp, speed: def.speed, state: s.camp ? 'camp' : 'wander', stateTime: rr(1, 3),
    path: null, pathTimer: rr(0.2, 0.8), lastKnown: { x: s.x, z: s.z }, facing: rr(0, TAU), exposed: 0, exposeFlash: 0,
    windup: 0, windupMax: 0, recover: 0, recoverAfter: 0, attackKind: '', attackAngle: 0, lungeTime: 0, lungeAfter: 0, lungeSpeed: 0, lungeSpeedAfter: 0,
    hitOnce: false, attackCd: rr(0.4, 1), hurtFlash: 0, invuln: 0, lightStress: 0, blocking: false, camp: !!s.camp, drainTick: 0, wanderAngle: rr(0, TAU),
    fy: 1.6, gait: rr(0, 10), vel: 0, px: s.x, pz: s.z, recoil: 0, strikeT: 0, look: 0, breathT: mr(0.5, 2), emberT: 0,
    retro: 0, blinkT: mr(2, 6), blinking: 0, losT: 0, los: false, dist: 99, nextSound: mr(1, 4), alive: true, bodyVis: false, light: 0, dying: -1,
    sy: def.sy, sr: def.sr, grp: null,
  };
  if (s.camp && LV.camp) e.facing = Math.atan2(LV.camp.z - s.z, LV.camp.x - s.x);
  buildVisual(e);
  return e;
}
export function spawnCreatures() {
  for (const e of CR.list) disposeVisual(e); for (const e of CR.dead) if (e.grp) disposeVisual(e);
  CR.dead = []; CR.list = LV.spawns.map(spawn);
}
export function addCreature(type, x, z) { const e = spawn({ type, x, z }); CR.list.push(e); return e; }

// ---------- light at a creature (lantern needs line of sight; braziers and flares don't care) ----------
function lightAtE(e) { const y = e.type === 'moth' ? e.fy : 0.6; return Math.max(e.los ? lanternLevel(e.x, y, e.z) : 0, worldLevel(e.x, e.z)); }
function lightAtP(x, z) { return Math.max(lanternLevel(x, 0.5, z), worldLevel(x, z)); }
function enemySeesPlayer(e) { const st = MODES[lantern.mode].stealth * (lantern.k < 0.2 ? 0.6 : 1); return e.dist <= e.def.sense * st && e.los; }
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
const chestY = (e) => (e.type === 'moth' ? e.fy : e.type === 'bandit' ? 1.3 : e.type === 'wolf' ? 0.75 : 0.35);
const HIT_COL = { wolf: [1, 0.85, 0.6], leech: [0.75, 0.55, 1], moth: [1, 0.6, 0.25], bandit: [1, 0.85, 0.6] };

// ---------- combat (ported) ----------
export function interruptEnemy(e, stagger = 0.18) { e.windup = 0; e.lungeTime = 0; e.lungeSpeed = 0; e.hitOnce = false; e.attackKind = ''; e.recover = Math.max(e.recover, stagger); }
export function exposeEnemy(e, duration = 1.15) {
  if (!e.alive) return; const gained = e.exposed <= 0;
  e.exposed = Math.max(e.exposed, duration); e.exposeFlash = Math.max(e.exposeFlash, 0.24);
  interruptEnemy(e, Math.min(duration * 0.42, 0.38));
  if (e.type === 'leech') { e.state = 'flee'; e.stateTime = Math.max(e.stateTime, 0.7); e.lightStress = 0; }
  if (gained) { sfx.expose(e); burst(e.x, chestY(e), e.z, 10, [1, 0.8, 0.4], 1.6, 0.5, -1); if (e.bodyVis) H.say(e.type === 'leech' ? 'It hates the bright edge.' : 'Now. Strike.'); }
}
function beginWindup(e, kind, angle) {
  const d = e.def; e.attackKind = kind; e.attackAngle = angle; e.windup = d.windup; e.windupMax = d.windup;
  e.recoverAfter = d.recover; e.lungeAfter = d.lunge; e.lungeSpeedAfter = d.lungeSpeed; e.hitOnce = false; e.attackCd = d.windup + d.recover + 0.18;
  sfx.windup(e);
}
function executeAttack(e) {
  const dir = e.attackAngle; e.windup = 0; e.facing = dir; e.strikeT = 1;
  if (e.attackKind === 'cut') {
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
  if (e.type === 'bandit' && e.blocking && cause === 'slash') { real *= 0.5; e.blocking = false; sfx.block(); burst(e.x, 1.1, e.z, 14, [1, 0.95, 0.8], 2.5, 0.35, -6); }
  if (cause === 'slash') { if (e.exposed > 0) real *= 1.72; else if (e.type === 'leech' && lantern.mode === 2) real *= 1.15; }
  else if (cause === 'pulse') real *= e.type === 'moth' ? 1 : 0.72;
  else if (cause === 'flare') { if (e.type === 'leech') real *= 1.06; }
  else if (cause === 'light') real *= e.type === 'leech' ? 1.2 : 0.28;
  e.hp -= real; e.invuln = cause === 'light' ? 0.03 : 0.07; e.hurtFlash = 0.2; e.exposeFlash = Math.max(e.exposeFlash, 0.12);
  if (cause !== 'light') {
    sfx.hit(e.exposed > 0); G.shake = Math.max(G.shake, e.exposed > 0 ? 0.5 : 0.28); G.hitstop = Math.max(G.hitstop, e.exposed > 0 ? 0.05 : 0.025);
    e.recoil = 1; e.recoilDir = dir;
    const hc = HIT_COL[e.type]; burst(e.x - Math.cos(dir) * e.r * 0.5, chestY(e), e.z - Math.sin(dir) * e.r * 0.5, e.exposed > 0 ? 22 : 12, hc, e.exposed > 0 ? 3 : 2.2, 0.5, -5);
  }
  if (knock > 0) nudge(e, dir, knock);
  if (e.windup > 0) {
    if (cause === 'flare') { if (e.type === 'leech' || e.type === 'wolf') exposeEnemy(e, 1.15); else interruptEnemy(e, 0.22); }
    else if (cause === 'pulse') { if (e.type === 'wolf') exposeEnemy(e, 1.2); else interruptEnemy(e, 0.18); }
  }
  if (e.state === 'camp') { e.state = 'chase'; e.stateTime = 2; }
  if (e.hp <= 0) kill(e, dir);
  return true;
}
function kill(e, dir) {
  e.alive = false; e.dying = 0; e.dieDir = dir; e.dieSide = Math.random() < 0.5 ? 1 : -1; G.kills++; sfx.kill(e);
  e.eyes.forEach((s) => (s.visible = false)); if (e.blade) e.blade.visible = false;
  const y = chestY(e);
  if (e.type === 'moth') { burst(e.x, y, e.z, 40, [1, 0.55, 0.15], 3, 1.1, -2); }
  else if (e.type === 'leech') { burst(e.x, y, e.z, 24, [0.7, 0.45, 1], 2, 0.8, -3); dust(e.x, 0.3, e.z, 6, [0.12, 0.08, 0.16]); }
  else dust(e.x, 0.25, e.z, 7, [0.14, 0.13, 0.12]);
  if (Math.random() < 0.18) H.addPickup('fuel', e.x, e.z);
  CR.list = CR.list.filter((o) => o !== e); CR.dead.push(e);
}

// ---------- AI (ported from the Crown's updateEnemy) ----------
function updateEnemy(e, dt) {
  e.hurtFlash = Math.max(0, e.hurtFlash - dt); e.invuln = Math.max(0, e.invuln - dt); e.attackCd = Math.max(0, e.attackCd - dt); e.pathTimer -= dt; e.stateTime -= dt;
  const lightHere = e.light, sees = enemySeesPlayer(e), dP = e.dist, def = e.def;
  if (handleAction(e, dt)) return;
  if (e.type === 'moth') { mothAI(e, dt, lightHere, dP); return; }
  if (e.type === 'leech') { e.lightStress = clamp(e.lightStress + (lightHere > 0.62 ? dt * 1.7 : -dt * 0.8), 0, 1.4); if (e.lightStress > 0.7 && e.exposed <= 0) exposeEnemy(e, 1.05); }
  if (e.state === 'camp') {
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
    if (e.type === 'bandit' && e.blocking && Math.random() < dt * 0.6) e.blocking = false;
    if (e.type === 'wolf') { let pack = 0; for (const o of CR.list) if (o !== e && o.type === 'wolf' && o.dist < 18) pack++; e.speed = def.speed * (pack >= 1 ? 1.15 : 1); }
  } else if (e.stateTime <= 0 && e.state !== 'camp') { e.state = 'wander'; chooseWanderTarget(e); e.stateTime = rr(2, 5); }

  if (e.state === 'chase') {
    const tg = e.lastKnown; let ang = angleTo(e.x, e.z, tg.x, tg.z);
    if (!lineOfSight(e.x, e.z, tg.x, tg.z) && e.pathTimer <= 0) { e.path = findPath(toTile(e.x), toTile(e.z), toTile(tg.x), toTile(tg.z)); e.pathTimer = 0.5; }
    if (e.path && e.path.length) { const nd = e.path[0]; if (Math.hypot(e.x - nd.x, e.z - nd.z) < 0.9) e.path.shift(); if (e.path[0]) ang = angleTo(e.x, e.z, e.path[0].x, e.path[0].z); }
    e.facing = lerpAngle(e.facing, ang, clamp(dt * 7, 0, 1));
    if (Math.hypot(e.x - tg.x, e.z - tg.z) > 0.6 || sees) moveWithCollisions(e, Math.cos(ang) * e.speed, Math.sin(ang) * e.speed, dt);
    if (dP < def.range && e.attackCd <= 0 && sees) beginWindup(e, e.type === 'leech' ? 'leechBite' : e.type === 'bandit' ? 'cut' : 'lunge', angleTo(e.x, e.z, P.x, P.z));
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
  if (lh > 0.12 || dP < 4) { tx = P.x + Math.cos(e.gait * 0.05) * 0.4; tz = P.z + Math.sin(e.gait * 0.05) * 0.4; ty = 1.45; }
  else {
    let br = null, bd = 14; for (const b of W.braziers) if (b.src.lit) { const d = Math.hypot(b.src.x - e.x, b.src.z - e.z); if (d < bd) { bd = d; br = b; } }
    if (br) { const a = G.t * 1.3 + e.wanderAngle; tx = br.src.x + Math.cos(a) * 1.4; tz = br.src.z + Math.sin(a) * 1.4; ty = br.fy + 0.6; }
    else { e.wanderAngle += mr(-0.8, 0.8) * dt; tx = e.x + Math.cos(e.wanderAngle) * 3; tz = e.z + Math.sin(e.wanderAngle) * 3; }
  }
  const ang = angleTo(e.x, e.z, tx, tz) + Math.sin(G.t * 3 + e.wanderAngle) * 0.35, d = Math.hypot(tx - e.x, tz - e.z);
  e.facing = lerpAngle(e.facing, ang, clamp(dt * 5, 0, 1));
  const sp = e.speed * Math.min(1, d / 1.5);
  e.x = clamp(e.x + Math.cos(ang) * sp * dt, 2 * TILE, (LV.w - 2) * TILE); e.z = clamp(e.z + Math.sin(ang) * sp * dt, 2 * TILE, (LV.h - 2) * TILE);
  e.fy = lerp(e.fy, ty + Math.sin(G.t * 2.3 + e.wanderAngle) * 0.25, damp(2, dt));
  if (dP < 1.2) { e.drainTick -= dt; if (e.drainTick <= 0) { e.drainTick = 0.5; P.fuel = Math.max(0, P.fuel - BAL.mothSip); if (Math.random() < 0.3) H.say('It drinks.'); } }
}

// =====================================================================
//  ANIMATION — bones driven by what the AI is doing
// =====================================================================
const k8 = (dt) => damp(12, dt);
const rx = (b, v, k) => { b.rotation.x = lerp(b.rotation.x, v, k); };
function lookAtPlayer(e) { return clamp(-wrapAngle(angleTo(e.x, e.z, P.x, P.z) - e.facing), -0.8, 0.8); }
function animWolf(e, dt, t) {
  const b = e.b, k = k8(dt), s = clamp(e.vel / 4.2, 0, 1.6), lunging = e.lungeTime > 0, c = e.windup > 0 ? 1 - e.windup / Math.max(0.01, e.windupMax) : 0;
  const aware = e.state === 'chase' || e.windup > 0 || lunging || e.exposed > 0;
  e.gait += dt * (1 + s * 9.5);
  for (const [n, off, front] of [['FL', 0, 1], ['FR', Math.PI, 1], ['HL', Math.PI, -1], ['HR', 0, -1]]) {
    const p = e.gait + off, sw = Math.sin(p), lift = Math.max(0, Math.cos(p)), ms = Math.min(1, s);
    let up = sw * 0.55 * ms, lo = lift * 0.8 * ms * front;
    if (lunging) { up = front > 0 ? -1.0 : 0.85; lo = front > 0 ? 0.15 : -0.25; }
    else if (c > 0) { up = front > 0 ? -0.2 * c : -0.45 * c; lo = front > 0 ? 0.35 * c : 0.75 * c; }
    rx(b[n + 'u'], up, k); rx(b[n + 'l'], lo, k); rx(b[n + 'f'], -(up + lo) * 0.7, k);
  }
  const root = b.root;
  root.position.y = Math.abs(Math.sin(e.gait)) * 0.025 * Math.min(1, s) - c * 0.13;
  root.position.z = -e.recoil * 0.15;
  root.rotation.x = lerp(root.rotation.x, (lunging ? -0.12 : 0) + c * 0.06 - e.recoil * 0.12, k);
  root.rotation.z = e.exposed > 0 ? Math.sin(t * 38) * 0.025 : 0;
  b.chest.scale.set(1 + 0.025 * Math.sin(t * 2.4), 1 + 0.03 * Math.sin(t * 2.4), 1);
  const look = aware ? lookAtPlayer(e) : Math.sin(t * 0.4 + e.gait * 0.01) * 0.35;
  b.neck.rotation.y = lerp(b.neck.rotation.y, look * 0.6, k); b.head.rotation.y = lerp(b.head.rotation.y, look * 0.4, k);
  rx(b.neck, c > 0 ? 0.35 * c : aware ? 0.2 : 0.12 + Math.sin(t * 0.7) * 0.15, k);
  rx(b.head, aware ? -0.15 : 0, k);
  rx(b.jaw, lunging ? 0.55 : c > 0 ? 0.42 * c : e.state === 'chase' ? 0.07 + 0.05 * Math.sin(t * 14) : 0.02, damp(18, dt));
  const earBack = aware ? -0.55 : Math.sin(t * 0.9 + e.gait) > 0.97 ? -0.3 : 0;
  rx(b.earL, earBack, k); rx(b.earR, earBack, k);
  const hk = lerp(b.hackles.scale.y, c > 0 ? 2.3 : aware ? 1.7 : 1, damp(4, dt)); b.hackles.scale.set(1, hk, 1);
  rx(b.tail1, aware ? 0.35 : -0.25, damp(5, dt)); b.tail1.rotation.y = Math.sin(aware ? e.gait * 0.5 : t * 1.4) * (aware ? 0.12 : 0.3);
  rx(b.tail2, aware ? 0.1 : -0.15, k); b.tail2.rotation.y = Math.sin((aware ? e.gait * 0.5 : t * 1.4) - 0.8) * 0.25;
}
function animLeech(e, dt, t) {
  const b = e.b, s = clamp(e.vel / 3.3, 0, 1.5), lunging = e.lungeTime > 0, c = e.windup > 0 ? 1 - e.windup / Math.max(0.01, e.windupMax) : 0;
  e.rear = lerp(e.rear || 0, lunging ? 0.3 : c, damp(10, dt));
  e.gait += dt * (1.6 + s * 6);
  const A = 0.04 + 0.12 * Math.min(1, s), len = lunging ? 1.22 : 1 - e.rear * 0.08, xs = [], ys = [], zs = [];
  for (let i = 0; i < LEECH_N; i++) {
    const base = b['s' + i].userData.base, lift = e.rear * 0.55 * Math.max(0, 1 - i / 3.5);
    xs.push(Math.sin(e.gait - i * 0.7) * A * (0.3 + i / LEECH_N)); ys.push(base.y + lift + Math.sin(t * 2 + i) * 0.006); zs.push(base.z * len + e.rear * 0.12 - e.recoil * 0.15);
  }
  for (let i = 0; i < LEECH_N; i++) {
    const s0 = b['s' + i], a = Math.max(0, i - 1), z = Math.min(LEECH_N - 1, i + 1);
    s0.position.set(xs[i], ys[i], zs[i]);
    s0.rotation.y = Math.atan2(xs[a] - xs[z], zs[a] - zs[z]); s0.rotation.x = -Math.atan2(ys[a] - ys[z], zs[a] - zs[z]);
  }
  const m = 1 + 0.45 * c + (lunging ? 0.5 : 0) + 0.05 * Math.sin(t * 3);
  b.mouth.scale.set(m, m, 1);
  for (let i = 0; i < 6; i++) {
    b['t' + i + 'a'].rotation.set(Math.sin(t * 3 + i) * 0.35 - 0.6 * c, Math.cos(t * 2.6 + i) * 0.3, 0);
    b['t' + i + 'b'].rotation.set(Math.sin(t * 4.1 + i * 1.7) * 0.5, Math.cos(t * 3.3 + i) * 0.4, 0);
  }
  b.root.rotation.z = e.exposed > 0 ? Math.sin(t * 34) * 0.04 : 0;
}
function animMoth(e, dt, t) {
  const b = e.b; e.gait += dt * (e.dist < 3 ? 30 : 22);
  const f = Math.sin(e.gait), h = Math.sin(e.gait - 0.55);
  b.fwL.rotation.z = 0.2 + f * 0.95; b.hwL.rotation.z = 0.15 + h * 0.8; b.fwR.rotation.z = -b.fwL.rotation.z; b.hwR.rotation.z = -b.hwL.rotation.z;
  b.fwL.rotation.y = b.hwL.rotation.y = -f * 0.12; b.fwR.rotation.y = b.hwR.rotation.y = f * 0.12;
  b.thorax.rotation.x = f * 0.06 - e.recoil * 0.4; b.abd1.rotation.x = 0.12 + Math.sin(e.gait * 0.5) * 0.08; b.abd2.rotation.x = 0.08 + Math.sin(e.gait * 0.5 - 0.6) * 0.1;
  b.antL.rotation.x = b.antR.rotation.x = Math.sin(t * 5) * 0.1; b.antL.rotation.z = Math.sin(t * 7) * 0.08; b.antR.rotation.z = -b.antL.rotation.z;
}
function animBandit(e, dt, t) {
  const b = e.b, k = k8(dt), s = clamp(e.vel / 3.5, 0, 1.4), c = e.windup > 0 ? 1 - e.windup / Math.max(0.01, e.windupMax) : 0;
  e.strikeT = Math.max(0, e.strikeT - dt / 0.35);
  const sitting = e.state === 'camp';
  e.gait += dt * (1 + s * 6.5);
  const ph = e.gait, ms = Math.min(1, s);
  if (sitting) {
    b.root.position.y = lerp(b.root.position.y, -0.43, k);
    rx(b.thL, -1.5, k); rx(b.thR, -1.5, k); rx(b.knL, 1.45, k); rx(b.knR, 1.45, k); rx(b.ftL, 0, k); rx(b.ftR, 0, k);
    rx(b.chest, 0.22 + Math.sin(t * 1.3) * 0.02, k); rx(b.shL, -0.55, k); rx(b.shR, -0.55, k); rx(b.elL, -0.9, k); rx(b.elR, -0.6, k);
    b.neck.rotation.y = lerp(b.neck.rotation.y, Math.sin(t * 0.3 + e.gait) * 0.3, k); rx(b.head, 0.15, k);
  } else {
    b.root.position.y = lerp(b.root.position.y, Math.abs(Math.sin(ph)) * 0.03 * ms, k);
    rx(b.thL, -Math.sin(ph) * 0.5 * ms, k); rx(b.thR, Math.sin(ph) * 0.5 * ms, k);
    rx(b.knL, Math.max(0, -Math.cos(ph)) * 0.9 * ms + (c > 0 ? 0.25 * c : 0), k); rx(b.knR, Math.max(0, Math.cos(ph)) * 0.9 * ms + (c > 0 ? 0.25 * c : 0), k);
    rx(b.ftL, -b.knL.rotation.x * 0.3, k); rx(b.ftR, -b.knR.rotation.x * 0.3, k);
    // sword arm: a low guard, raised overhead on the wind-up, a hard diagonal cut on the strike
    const st = e.strikeT, guardX = -0.55, raised = -2.7, cutX = 0.35;
    const shX = st > 0 ? lerp(cutX, raised, Math.pow(st, 3)) : lerp(guardX, raised, c), elX = st > 0 ? -0.25 : lerp(-0.75, -1.0, c);
    rx(b.shR, shX, damp(st > 0 ? 40 : 14, dt)); rx(b.elR, elX, damp(st > 0 ? 40 : 14, dt));
    b.shR.rotation.z = lerp(b.shR.rotation.z, -0.35 * c + (st > 0 ? 0.25 : 0), k);
    // buckler arm: swings when walking, comes up to block
    rx(b.shL, e.blocking ? -1.25 : Math.sin(ph) * 0.35 * ms - 0.1, k); rx(b.elL, e.blocking ? -1.35 : -0.3, k); b.shL.rotation.z = lerp(b.shL.rotation.z, e.blocking ? 0.45 : 0, k);
    b.chest.rotation.y = lerp(b.chest.rotation.y, Math.sin(ph) * 0.08 * ms + 0.35 * c - (st > 0 ? 0.4 * st : 0), k);
    rx(b.chest, 0.05 + c * 0.1 - e.recoil * 0.35, k);
    const look = e.state === 'chase' || c > 0 ? lookAtPlayer(e) : 0;
    b.neck.rotation.y = lerp(b.neck.rotation.y, look * 0.6, k); rx(b.head, 0, k);
  }
  rx(b.cloakA, 0.06 + s * 0.28 + Math.sin(ph * 2) * 0.04 * ms, damp(6, dt)); rx(b.cloakB, s * 0.18 + Math.sin(ph * 2 + 1) * 0.05 * ms, damp(6, dt));
}
const ANIM = { wolf: animWolf, leech: animLeech, moth: animMoth, bandit: animBandit };
function animDeath(e, dt) {
  e.dying += dt; const b = e.b, k = smooth(0, 0.55, e.dying);
  if (e.type === 'wolf') {
    b.root.rotation.z = k * 1.45 * e.dieSide; b.root.position.y = -k * 0.05;
    for (const n of ['FL', 'FR', 'HL', 'HR']) { rx(b[n + 'u'], 0.2 * k, 0.2); rx(b[n + 'l'], 0.1, 0.2); }
    rx(b.jaw, 0.3, 0.2); b.hackles.scale.set(1, 1, 1); rx(b.neck, -0.2 * k, 0.2);
  } else if (e.type === 'leech') {
    for (let i = 0; i < LEECH_N; i++) { const s0 = b['s' + i]; s0.position.y = lerp(s0.position.y, 0.12, 0.08); s0.rotation.y += dt * 0.6 * (i / LEECH_N) * (1 - k); }
    b.mouth.scale.multiplyScalar(0.98);
  } else if (e.type === 'moth') {
    e.fy = Math.max(0.12, e.fy - dt * (1 + e.dying * 6)); b.root.rotation.z += dt * 6 * (e.fy > 0.15 ? 1 : 0);
    b.fwL.rotation.z = b.hwL.rotation.z = lerp(b.fwL.rotation.z, -0.3, 0.1); b.fwR.rotation.z = b.hwR.rotation.z = -b.fwL.rotation.z;
    if (e.glow) e.glow.material.opacity = Math.max(0, 0.6 - e.dying * 0.5);
  } else if (e.type === 'bandit') {
    b.root.rotation.x = -k * 1.42; b.root.position.y = 0;
    rx(b.shR, -1.6, 0.15); rx(b.shL, -1.6, 0.15); rx(b.knL, 0.3, 0.15); rx(b.knR, 0.1, 0.15); rx(b.thL, -0.2, 0.15); rx(b.head, -0.3, 0.1);
  }
  const sink = Math.max(0, e.dying - 2.2) * 0.35;
  e.grp.position.set(e.x, (e.type === 'moth' ? e.fy : 0) - sink, e.z);
  e.mesh.visible = !settings.culling || litTest(e.x, 0.4, e.z, e.sr) || e.dist < NEAR_R + 0.6;
  e.mat.emissive.setRGB(0, 0, 0);
  if (e.dying > 3.4) { disposeVisual(e); return false; }
  return true;
}

// ---------- per frame: AI, animation, eyeshine, culling, particles ----------
let pxPerM = 0.005;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
export function updateCreatures(dt, camera) {
  const active = G.state === 'playing' && !G.paused && !window.__freezeAI; // tests can freeze the AI and still watch the animation
  const T = performance.now() / 1000;
  pxPerM = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.min(G.renderH, 400);
  let danger = 0, near = 99;
  CR.dead = CR.dead.filter((e) => { e.dist = Math.hypot(P.x - e.x, P.z - e.z); return dt > 0 ? animDeath(e, dt) : true; });
  for (const e of [...CR.list]) {
    const dx = P.x - e.x, dz = P.z - e.z; e.dist = Math.hypot(dx, dz) || 0.001;
    e.losT -= dt; if (e.losT <= 0) { e.losT = 0.12 + Math.random() * 0.06; e.los = e.dist < 45 && lineOfSight(P.x, P.z, e.x, e.z); }
    e.light = lightAtE(e);
    if (active) updateEnemy(e, dt);
    if (!e.alive) continue;
    if (dt > 0) { const v = Math.hypot(e.x - e.px, e.z - e.pz) / dt; e.vel = lerp(e.vel, v, damp(8, dt)); }
    e.px = e.x; e.pz = e.z;
    if (e.type !== 'moth' && (e.state === 'chase' || e.windup > 0)) { near = Math.min(near, e.dist); if (e.light < 0.3) danger = Math.max(danger, clamp(1 - (e.dist - 2) / 14, 0, 1)); }
    e.nextSound -= dt;
    if (active && e.nextSound < 0 && e.dist < 28) {
      if (e.type === 'moth') sfx.flutter(e, 0.6); else if (e.state === 'chase' || e.state === 'wander') sfx.rustle(e);
      if (e.type === 'leech' && Math.random() < 0.3) sfx.hiss(e);
      e.nextSound = mr(0.6, 1.6) * (0.5 + e.dist / 16);
    }
    // body transform + animation
    e.recoil = Math.max(0, e.recoil - dt * 5);
    e.grp.position.set(e.x, e.type === 'moth' ? e.fy : 0, e.z); e.grp.rotation.y = rotYOfHeading(e.facing);
    if (dt > 0) ANIM[e.type](e, dt, T);
    // near-field compensation: the beam's hot spot is far brighter at arm's length than at the far trees,
    // so darken a creature's albedo as it closes in (like your eyes adjusting); it reads the same at 1 m as at 6 m
    e.mat.color.setScalar(TONE[e.type] * clamp(Math.pow(e.dist / 4.5, 0.7), 0.35, 1));
    const fl = e.hurtFlash > 0 ? 0.6 : e.exposed > 0 ? 0.22 + 0.14 * Math.sin(T * 14) : 0;
    e.mat.emissive.setRGB(fl, fl * (e.hurtFlash > 0 ? 0.95 : 0.7), fl * (e.hurtFlash > 0 ? 0.9 : 0.3));
    // the body is drawn only when something lights it
    e.bodyVis = !settings.culling || litTest(e.x, e.sy + (e.type === 'moth' ? e.fy : 0), e.z, e.sr) || e.dist < NEAR_R + 0.6 || (e.type === 'moth' && e.dist < 9 && e.los) || G.state === 'dead';
    e.mesh.visible = e.bodyVis;
    if (e.bodyVis && e.dist < lantern.distance && !G.tips['seen_' + e.type] && G.state === 'playing' && e.light > 0.15) { G.tips['seen_' + e.type] = 1; H.say(SEEN[e.type]); }
    if (e.glow) { e.glow.visible = e.los && e.dist < 45; e.glow.material.opacity = 0.45 + 0.2 * Math.sin(T * 9 + e.gait); }
    // breath in the cold air, where the light catches it; embers falling from moths
    if (e.mouth && e.bodyVis && e.light > 0.12 && e.dist < 14 && dt > 0) {
      e.breathT -= dt * (e.state === 'chase' ? 2.2 : 1);
      if (e.breathT <= 0) { e.breathT = mr(1.0, 1.6); e.mouth.getWorldPosition(_w); const h = e.facing; puff(_w.x, _w.y, _w.z, Math.cos(h) * 0.35, 0.06, Math.sin(h) * 0.35, [0.1, 0.1, 0.11], 1.3); }
    }
    if (e.emberAt && e.los && e.dist < 30 && dt > 0) { e.emberT -= dt; if (e.emberT <= 0) { e.emberT = mr(0.08, 0.25); e.emberAt.getWorldPosition(_w); ember(_w.x, _w.y, _w.z, [1, 0.45, 0.12]); } }

    // eyeshine: light goes in, comes straight back at you
    if (e.eyes.length) {
      e.eyeAnchor.getWorldPosition(_v);
      const r = beamAt(_v.x, _v.y, _v.z); let bb = 0;
      if (lantern.k > 0.02 && r.ang < lantern.angle * 1.45 && e.los) bb = glint(r.d, r.ang);
      if (e.dist < NEAR_R + 1) bb = Math.max(bb, 0.5 * Math.min(1, lantern.k));
      const facing = (Math.cos(e.facing) * dx + Math.sin(e.facing) * dz) / e.dist;
      bb *= smooth(0.2, 0.85, facing);
      if (e.windup > 0) bb = Math.min(1, bb * 1.6 + 0.15 * (e.los ? 1 : 0)); // the eyes flare as it gathers to spring
      e.blinkT -= dt; if (e.blinkT < 0) { e.blinking = 0.13; e.blinkT = mr(2, 7); } e.blinking -= dt;
      e.retro = e.blinking > 0 ? 0 : bb;
      const sz = Math.max(0.07, r.d * pxPerM * 3.2) * (e.type === 'leech' ? 1.5 : 1), spread = Math.max(e.eyeX, r.d * pxPerM * 2.3);
      e.eyeMat.opacity = e.retro; e.eyeMat.color.copy(e.eyeBase).multiplyScalar(1 + e.retro * 0.5);
      e.eyes.forEach((sp, i) => { sp.visible = e.retro > 0.01; sp.scale.set(sz, sz, 1); sp.position.x = e.eyes.length === 1 ? 0 : i === 0 ? -spread : spread; });
      if (e.retro > 0.35 && !e.bodyVis && !G.eyesSeen && G.state === 'playing') { G.eyesSeen = true; H.say('Eyes. Past my light.'); }
    }
    if (e.blade) { // steel catches the beam; men have no eyeshine
      e.blade.getWorldPosition(_v); const r = beamAt(_v.x, _v.y, _v.z);
      const g = lantern.k > 0.02 && r.ang < lantern.angle * 1.3 && e.los ? glint(r.d, r.ang) * 0.8 * (0.6 + 0.4 * Math.sin(T * 11 + e.gait)) : 0;
      e.bladeMat.opacity = g; e.blade.visible = g > 0.02; const sz = Math.max(0.05, r.d * pxPerM * 2.4); e.blade.scale.set(sz, sz, 1);
    }
  }
  G.danger = lerp(G.danger, danger, damp(4, dt || 0.016));
  CR.dangerNear = near;
}
// triangles drawn this frame by creature bodies (for the stats panel)
export function creatureTris() { let n = 0; for (const e of CR.list) if (e.mesh.visible) n += e.tris; for (const e of CR.dead) if (e.grp && e.mesh.visible) n += e.tris; return n; }
