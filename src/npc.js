import { THREE, psx, clamp, lerp, damp, lerpAngle, rotYOfHeading, settings } from './engine.js';
import { LV, TILE, toTile, isWalkable, lineOfSight, moveWithCollisions } from './level.js';
import { W, litTest } from './world3d.js';
import { NEAR_R } from './lantern.js';
import { getRig, makeSkeleton, rigMaterial } from './rigs.js';
import { G, P, H, S } from './state.js';
import { sfx } from './audio.js';

// =====================================================================
//  PEOPLE — the 2D Crown's villagers, with their own words. Elder Maren
//  tells you what you are for and gives you her daughter's ring; Sev
//  sells (prices are firm); Farmer Ged needs his cart pulled out of the
//  hungry ground; Lyn guards the gate and will come with you if you ask;
//  and in the Gray Forest a girl is hiding. Walk up to someone, face them
//  and press USE to talk. Lyn, once she joins, follows you floor to floor.
// =====================================================================
const NAME = { maren: 'ELDER MAREN', sev: 'SEV', lyn: 'LYN', ged: 'FARMER GED', girl: 'THE GIRL' };
const TONE = { maren: 0.62, sev: 0.6, lyn: 0.6, ged: 0.6, girl: 0.62 };
const close = { text: 'Leave.', close: true };
const D = {
  maren_initial: {
    who: 'maren', lines: [
      'You carry the brand. I have not seen one in thirty years. The last Warden walked into the ruins and did not return.',
      'The Hollow King was not always hollow. He was Aldric — a good ruler, once. He sought to end death itself. The crown he forged did end death. It also ended everything else that made life worth holding.',
      'The curse spreads from his throne room. Each season it reaches further. Soon there will be nothing left to protect.'],
    choices: [{ text: '“What must I do?”', next: 'maren_quest' }, { text: 'Nod and leave.', close: true }],
  },
  maren_quest: {
    who: 'maren', lines: [
      'Reach the throne. The forest path leads to the ruins. Inside, you must find the throne room. What you do when you face him — that is yours to decide.',
      'But know this: the crown feeds on certainty. On the conviction that one answer is enough. Aldric was certain he could defeat death. The crown made that certainty permanent — and everything else fell away.',
      'Take this ring. My daughter carried it before she went to the ruins.'],
    done: () => {
      S.talkedToElder = true;
      if (!S.ring) { S.ring = true; P.maxHp += 4; P.hp = Math.min(P.maxHp, P.hp + 4); P.dr += 0.02; sfx.relic(); H.hint('Warden’s Ring — warm to the touch. +4 vitality, a little less hurt.', 3.4); }
    },
    choices: [{ text: 'Return to the village.', close: true }],
  },
  maren_rest: {
    who: 'maren', lines: ['You are still here. Good. The brand holds, then. Come — sit by the fire a moment.', 'The herbs are bitter but they work. And there is oil for the lantern — we keep stores for the patrols that no longer come.'],
    choices: [{ text: 'Rest and recover.', fn: () => { const a = P.maxHp - P.hp, b = P.maxFuel - P.fuel; P.hp = P.maxHp; P.fuel = P.maxFuel; H.hint(a + b > 1 ? 'Strength returns.' : 'You are already well rested.', 2.2); } }, { text: 'Not yet.', close: true }],
  },
  sev_shop: {
    who: 'sev', lines: ['Looking to buy? I have what you need to survive out there. Prices are firm — the roads are too dangerous to restock cheaply.'],
    shop: true,
    choices: [
      { text: 'Iron Sword — 25 coins', req: () => S.coins >= 25 && !S.sword, why: () => (S.sword ? 'bought' : '25 coins'), fn: () => { S.coins -= 25; S.sword = true; P.atkBonus += 3; sfx.relic(); H.hint('Iron Sword. It bites deeper.', 2.6); } },
      { text: 'Chainmail — 30 coins', req: () => S.coins >= 30 && !S.mail, why: () => (S.mail ? 'bought' : '30 coins'), fn: () => { S.coins -= 30; S.mail = true; P.dr += 0.06; sfx.relic(); H.hint('Chainmail. Heavy, and worth it.', 2.6); } },
      { text: 'Healing Tonic — 8 coins', req: () => S.coins >= 8 && P.hp < P.maxHp, why: () => (P.hp >= P.maxHp ? 'unhurt' : '8 coins'), fn: () => { S.coins -= 8; P.hp = Math.min(P.maxHp, P.hp + 40); sfx.pickup && sfx.pickup(); } },
      { text: 'Lamp Oil — 8 coins', req: () => S.coins >= 8 && P.fuel < P.maxFuel, why: () => (P.fuel >= P.maxFuel ? 'full' : '8 coins'), fn: () => { S.coins -= 8; P.fuel = Math.min(P.maxFuel, P.fuel + 35); sfx.pickup && sfx.pickup(); } },
      close],
  },
  lyn_initial: {
    who: 'lyn', lines: [
      'Don’t stare at the brand. Everyone stares at the brand. Yes, I know what you are. No, I don’t think you’re special. The last Warden died in the first corridor of the ruins.',
      'I’m Lyn. I was a scout before the curse took the eastern roads. Now I guard a gate nobody leaves through.'],
    choices: [{ text: '“Come with me.”', next: 'lyn_recruit' }, { text: '“What should I expect out there?”', next: 'lyn_info' }, close],
  },
  lyn_info: {
    who: 'lyn', lines: ['Wolves first — starving and mad from the curse. Then bandits who prey on anyone foolish enough to travel. Past them, the ruins.', 'There’s a child who went missing last week. Her mother won’t stop asking me to look. I can’t leave the gate.'],
    choices: [{ text: '“I’ll come back for you.”', close: true }, { text: '“Come with me.”', next: 'lyn_recruit' }],
  },
  lyn_recruit: {
    who: 'lyn', lines: ['...Fine. I’ve been rotting here long enough. If you’re going to die in the ruins, at least I can make sure you get there first.'],
    done: () => { if (S.lynJoined) return; S.lynJoined = true; P.atkBonus += 2; P.speedK += 0.06; H.hint('Lyn fights beside you.', 2.6); const n = NPCS.list.find((q) => q.id === 'lyn'); if (n) makeCompanion(n); },
    choices: [{ text: 'Head out.', close: true }],
  },
  lyn_gate: { who: 'lyn', lines: ['Gate’s open. Has been for years. Nobody wants it to be.'], choices: [{ text: '“Come with me.”', next: 'lyn_recruit' }, close] },
  ged_quest: {
    who: 'ged', lines: ['Warden — my cart is stuck in the mud. The curse makes the ground hungry, pulls things down. I cannot free it alone.'],
    choices: [{ text: 'Help him pull the cart free.', next: 'ged_helped' }, { text: 'You don’t have time.', close: true }],
  },
  ged_helped: {
    who: 'ged', lines: ['Thank you, Warden. Take these coins. And this — my boy found it in the field. Something from the old kingdom.'],
    done: () => { if (S.helpedFarmer) return; S.helpedFarmer = true; S.coins += 10; sfx.relic(); H.hint('+10 coins from Farmer Ged.', 2.4); const c = LV.structures.find((s) => s.kind === 'cart'); if (c) c.freed = true; },
    choices: [{ text: 'Return to the village.', close: true }],
  },
  ged_thanks: { who: 'ged', lines: ['She’s out of the mud. For now. The ground remembers.'], choices: [close] },
  girl_found: {
    who: 'girl', lines: ['The gray things were coming. I hid. Mama said if I held still they couldn’t see me.', 'Here. Mama said this keeps you safe. You need it more than me now.'],
    done: () => { if (S.savedChild) return; S.savedChild = true; P.speedK += 0.06; P.dr += 0.03; sfx.relic(); H.hint('Child’s Charm — given in gratitude. Quicker feet, a little less hurt.', 3.4); const n = NPCS.list.find((q) => q.id === 'girl'); if (n) n.leaving = 1; },
    choices: [{ text: 'Take her hand and continue.', close: true }],
  },
};
const opening = (id) => ({ maren: S.talkedToElder ? 'maren_rest' : 'maren_initial', sev: 'sev_shop', lyn: S.talkedToLyn ? 'lyn_gate' : 'lyn_initial', ged: S.helpedFarmer ? 'ged_thanks' : 'ged_quest', girl: 'girl_found' })[id];

export const NPCS = { list: [], lyn: null };
const _d = new THREE.Vector3();

// ---------- bodies ----------
function makeVisual(n) {
  const q = settings.detail === 'low' ? 0 : settings.detail === 'high' ? 1 : settings.detail === 'max' ? 3 : 2, rig = getRig(n.id, q), grp = new THREE.Group();
  const { bones, by, skeleton } = makeSkeleton(rig.def); grp.add(bones[0]);
  const body = rigMaterial(rig, psx); body.color.setScalar(TONE[n.id]);
  const prop = psx(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 50, specular: 0x887766, dithering: true }));
  const mesh = new THREE.SkinnedMesh(rig.geo, [body, prop, prop]); mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; grp.add(mesh);
  grp.updateMatrixWorld(true); mesh.bind(skeleton); W.group.add(grp);
  W.disposables.push(body, prop, { dispose: () => skeleton.dispose() });
  Object.assign(n, { grp, mesh, mat: body, b: by, t: Math.random() * 10, look: 0 });
}
export function buildNPCs() {
  NPCS.list = []; NPCS.lyn = null;
  for (const s of LV.npcs) {
    if (s.id === 'lyn' && S.lynJoined) continue; // she is already with you
    const n = { ...s, facing: s.face || 0, r: 0.35, leaving: 0 }; makeVisual(n); NPCS.list.push(n);
  }
  if (S.lynJoined) { // Lyn comes down with you: she arrives a step behind
    const n = { id: 'lyn', x: P.x, z: P.z, facing: 0, r: 0.35, leaving: 0 }; makeVisual(n); NPCS.list.push(n); makeCompanion(n, true);
    const bark = { 2: 'Wolves. Stay close.', 3: 'Bandit country. Their fires mean people, not help.', 4: 'Ruins. Don’t trust anything that stands still.' }[LV.floor];
    if (bark) setTimeout(() => H.say(bark, true, 'lyn'), 4500);
  }
}
function makeCompanion(n, place) {
  NPCS.lyn = n; n.companion = true; n.stuck = 0; n.lost = 0; n.gait = 0; S.talkedToLyn = true;
  if (place) placeBehind(n);
}
function placeBehind(n) {
  const bx = Math.sin(P.yaw), bz = Math.cos(P.yaw);
  for (const [d, s] of [[2, 0], [2.5, 1], [2.5, -1], [1.5, 0], [3.5, 0], [1, 1], [1, -1]]) {
    const x = P.x + bx * d + bz * s, z = P.z + bz * d - bx * s;
    if (isWalkable(toTile(x), toTile(z)) && lineOfSight(P.x, P.z, x, z)) { n.x = x; n.z = z; return; }
  }
  n.x = P.x; n.z = P.z;
}

// ---------- talking ----------
export function talkTarget() {
  if (G.talk) return null; let best = null, bd = 2.6;
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
  for (const n of NPCS.list) {
    if (n.leaving || n.companion) continue;
    const dx = n.x - P.x, dz = n.z - P.z, d = Math.hypot(dx, dz); if (d > bd) continue;
    if ((dx * fx + dz * fz) / (d || 1) < 0.3 && d > 1.2) continue;
    best = n; bd = d;
  }
  return best;
}
export const talkName = (n) => NAME[n.id];
export function openTalk(n) {
  const id = opening(n.id); if (!id) return;
  G.talk = { id, n, line: 0, typed: 0, sel: 0 }; G.paused = true; document.body.classList.add('talking'); sfx.blip && sfx.blip();
  render(true);
}
function render(fresh) {
  const t = G.talk, d = D[t.id], el = document.getElementById('dlg');
  el.classList.remove('hidden'); document.getElementById('dlgWho').textContent = NAME[d.who];
  const lastLine = t.line >= d.lines.length - 1, typedAll = t.typed >= d.lines[t.line].length;
  const ch = document.getElementById('dlgCh'); ch.innerHTML = '';
  if (lastLine && typedAll) d.choices.forEach((c, i) => {
    const ok = !c.req || c.req(), b = document.createElement('button');
    b.className = 'dch' + (i === t.sel ? ' on' : '') + (ok ? '' : ' no'); b.innerHTML = `<i>${i + 1}</i>${c.text}${c.req ? `<em>${ok ? '' : c.why()}</em>` : ''}`;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); choose(i); });
    ch.appendChild(b);
  });
  document.getElementById('dlgMore').style.visibility = !lastLine && typedAll ? 'visible' : 'hidden';
  document.getElementById('dlgCoins').textContent = d.shop ? `◈ ${S.coins} coins` : '';
  if (fresh) document.getElementById('dlgTxt').textContent = '';
}
function finishTalk() { G.talk = null; G.paused = false; document.body.classList.remove('talking'); document.getElementById('dlg').classList.add('hidden'); }
function choose(i) {
  const t = G.talk; if (!t) return; const d = D[t.id], c = d.choices[i];
  if (!c || t.line < d.lines.length - 1 || t.typed < d.lines[t.line].length) return;
  if (c.req && !c.req()) { sfx.wrong && sfx.wrong(); return; }
  if (c.fn) { c.fn(); if (d.shop) { t.sel = i; render(); return; } finishTalk(); return; }
  if (c.next) { if (d.done) d.done(); G.talk = { id: c.next, n: t.n, line: 0, typed: 0, sel: 0 }; render(true); return; }
  if (d.done) d.done(); finishTalk();
}
// one press: finish the typing, or the next line, or pick the highlighted choice
export function talkAdvance() {
  const t = G.talk; if (!t) return; const d = D[t.id], L = d.lines[t.line];
  if (t.typed < L.length) { t.typed = L.length; render(); return; }
  if (t.line < d.lines.length - 1) { t.line++; t.typed = 0; render(true); return; }
  choose(t.sel);
}
export function talkKey(code) {
  const t = G.talk; if (!t) return; const d = D[t.id];
  const m = /^Digit([1-9])$/.exec(code); if (m) { const i = +m[1] - 1; t.sel = i; choose(i); return; }
  if (code === 'ArrowUp' || code === 'KeyW') { t.sel = (t.sel + d.choices.length - 1) % d.choices.length; render(); return; }
  if (code === 'ArrowDown' || code === 'KeyS') { t.sel = (t.sel + 1) % d.choices.length; render(); return; }
  if (code === 'Escape' || code === 'Backspace') { if (d.done && t.line === d.lines.length - 1 && t.typed >= d.lines[t.line].length) d.done(); finishTalk(); return; }
  if (code === 'Space' || code === 'Enter' || code === 'KeyR' || code === 'KeyE') talkAdvance();
}

// ---------- per frame ----------
export function updateNPCs(dt, live) {
  const T = performance.now() / 1000;
  if (G.talk) { // type the line
    const t = G.talk, L = D[t.id].lines[t.line];
    if (t.typed < L.length) { t.typed = Math.min(L.length, t.typed + dt * 52); document.getElementById('dlgTxt').textContent = L.slice(0, Math.floor(t.typed)); if (t.typed >= L.length) render(); }
  }
  for (const n of [...NPCS.list]) {
    const dx = P.x - n.x, dz = P.z - n.z, dist = Math.hypot(dx, dz);
    if (n.companion && live) follow(n, dt, dist);
    const talking = G.talk && G.talk.n === n, toP = Math.atan2(dz, dx);
    if (talking || (dist < 3.2 && !n.companion)) n.facing = lerpAngle(n.facing, toP, clamp(dt * 3, 0, 1));
    // the girl, once she has given you the charm, slips away home
    if (n.leaving) { n.leaving += dt; if (n.leaving > 2.4) { W.group.remove(n.grp); NPCS.list.splice(NPCS.list.indexOf(n), 1); continue; } }
    n.grp.position.set(n.x, 0, n.z); n.grp.rotation.y = rotYOfHeading(n.facing);
    animate(n, dt, T, dist, talking);
    n.mat.color.setScalar(TONE[n.id] * clamp(Math.pow(dist / 4.5, 0.7), 0.4, 1) * (n.leaving ? Math.max(0, 1 - n.leaving / 2.4) : 1));
    n.mesh.visible = !settings.culling || dist < NEAR_R + 0.8 || litTest(n.x, 1.0, n.z, 1.1);
  }
}
const rx = (b, v, k) => { b.rotation.x = lerp(b.rotation.x, v, k); };
function animate(n, dt, T, dist, talking) {
  const b = n.b, k = damp(6, dt); n.t += dt;
  b.chest.scale.set(1 + 0.012 * Math.sin(n.t * 1.7), 1 + 0.018 * Math.sin(n.t * 1.7), 1);
  // look at you when you are near, nod while talking
  const want = dist < 7 ? clamp(Math.atan2(Math.sin(Math.atan2(P.z - n.z, P.x - n.x) - n.facing), Math.cos(Math.atan2(P.z - n.z, P.x - n.x) - n.facing)), -0.9, 0.9) : Math.sin(n.t * 0.3) * 0.3;
  n.look = lerp(n.look, want, k); b.head.rotation.y = -n.look * 0.6; b.neck.rotation.y = -n.look * 0.4;
  rx(b.head, talking ? 0.06 * Math.sin(n.t * 5) : n.id === 'maren' ? 0.12 : 0, k);
  const s = n.companion ? clamp(n.vel / 3.4, 0, 1.4) : 0, ph = (n.gait = (n.gait || 0) + dt * (1 + s * 7));
  rx(b.thL, -Math.sin(ph) * 0.5 * s, k * 2); rx(b.thR, Math.sin(ph) * 0.5 * s, k * 2);
  rx(b.knL, Math.max(0, -Math.cos(ph)) * 0.7 * s, k * 2); rx(b.knR, Math.max(0, Math.cos(ph)) * 0.7 * s, k * 2);
  b.root.position.y = Math.abs(Math.sin(ph)) * 0.035 * s;
  b.hips.rotation.y = Math.sin(n.t * 0.6) * 0.04;
}
// Lyn: keep a step or two behind you, catch up when you run, never get left behind
function follow(n, dt, dist) {
  const bx = Math.sin(P.yaw), bz = Math.cos(P.yaw), tx = P.x + bx * 1.9 + bz * 0.7, tz = P.z + bz * 1.9 - bx * 0.7;
  const dx = tx - n.x, dz = tz - n.z, d = Math.hypot(dx, dz), px = n.x, pz = n.z;
  if (dist > 18 || n.lost > 3 || n.stuck > 1.6) { placeBehind(n); n.lost = n.stuck = 0; n.vel = 0; return; }
  n.lost = lineOfSight(n.x, n.z, P.x, P.z) ? 0 : n.lost + dt;
  if (d > 0.6 && dist > 1.6) {
    const sp = dist > 6 ? 5.4 : 3.6, vx = (dx / d) * sp, vz = (dz / d) * sp;
    moveWithCollisions(n, vx, vz, dt);
    n.facing = lerpAngle(n.facing, Math.atan2(vz, vx), clamp(dt * 8, 0, 1));
    const moved = Math.hypot(n.x - px, n.z - pz); n.stuck = moved < sp * dt * 0.25 ? n.stuck + dt : 0;
  } else { n.stuck = 0; n.facing = lerpAngle(n.facing, Math.atan2(P.z - n.z, P.x - n.x), clamp(dt * 2, 0, 1)); }
  n.vel = lerp(n.vel || 0, Math.hypot(n.x - px, n.z - pz) / Math.max(dt, 1e-4), damp(8, dt));
}
// touch / an unlocked mouse: a tap on the panel moves the conversation on (the choice buttons handle themselves)
document.getElementById('dlg').addEventListener('pointerdown', (e) => { if (e.target.closest('.dch')) return; e.preventDefault(); talkAdvance(); });
