import { THREE, glowTex, matVC, psx, GeoBuilder, T, M, col, rr, mr, clamp, lerp, smooth, damp, wrapAngle, TAU, settings } from './engine.js';
import { LV, TILE, idx, inBounds, isWalkable, toTile, lineOfSight, inRect } from './level.js';
import { W, seenPoint, collapseTiles, DETAIL } from './world3d.js';
import { lantern, beamAt, aimedAt } from './lantern.js';
import { CR } from './creatures.js';
import { burst, dust, ember } from './fx.js';
import { G, P, H, S } from './state.js';
import { sfx } from './audio.js';
import { SB } from './ruins.js';
import { loft, blob } from './rigs.js';

// =====================================================================
//  FLOOR IV's story, the 2D Crown's fork in first person.
//  West: Sera, Maren's daughter, chained as an anchor for the crown.
//  Light her braziers and she can speak; slash the three anchors and she
//  is free (+8 max health, cheaper pulse). East: the Ruin Guardian; kill
//  it and three carved signs wake on the wall. Light them, with the bright
//  beam, in the order of the murals (Crown, Light, Shadow) for the Crown
//  Shard. Whichever wing you finish, the other comes down.
// =====================================================================
export const ST = { on: false };
const ORDER = ['crown', 'light', 'shadow'];

// a ghost: rim-lit, additive, fading out toward the hem
function ghostMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x9cb8ff) }, uK: { value: 1 }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vC;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vY = position.y; vC = color; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uK; uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vC;
      void main() { float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float rim = pow(f, 2.0);
        float fade = smoothstep(0.02, 0.6, vY); float sh = 0.82 + 0.18 * sin(vY * 13.0 - uTime * 2.6);
        float a = (0.1 + rim * 1.15) * fade * sh * uK; gl_FragColor = vec4(uColor * vC * a, 1.0); }`,
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
}
// Sera, modelled facing +z, floating a little above the binding circle, arms held out and back to the chains
function seraGeo(q) {
  const s = new SB(), r = [12, 18, 26, 34][q], rg = [10, 16, 24, 32][q], white = [1, 1, 1], dress = (x, y) => { const k = 0.55 + 0.45 * Math.min(1, y / 1.0); return [k, k, k * 1.05]; };
  // a full, drifting dress that thins to nothing at the hem
  s.add(loft([{ p: [0, 1.04, 0], r: [0.15, 0.11] }, { p: [0, 0.82, 0.0], r: [0.25, 0.2] }, { p: [0, 0.45, -0.02], r: [0.38, 0.32] }, { p: [0, 0.04, -0.06], r: [0.52, 0.46] }],
    { radial: r + 6, rings: rg, ref: [0, 0, 1], caps: false, shape: (a, t) => 1 + 0.11 * Math.sin(a * 7 + t * 5) * t + 0.04 * Math.sin(a * 17 - t * 3) * t }), dress);
  s.add(loft([{ p: [0, 1.02, 0], r: [0.15, 0.11] }, { p: [0, 1.24, 0.01], r: [0.17, 0.12] }, { p: [0, 1.38, 0], r: [0.19, 0.11] }, { p: [0, 1.48, 0], r: [0.055, 0.05] }], { radial: r, rings: rg >> 1, ref: [0, 0, 1] }), white);
  s.add(blob(Math.min(3, q + 1)), white, { matrix: M(0, 1.6, 0.01, -0.25, 0, 0, 0.088, 0.108, 0.098) }); // head bowed
  for (const sx of [-1, 1]) {
    s.add(loft([{ p: [sx * 0.17, 1.38, 0], r: [0.042, 0.042] }, { p: [sx * 0.38, 1.22, -0.04], r: [0.035, 0.035] }, { p: [sx * 0.6, 1.02, -0.1], r: [0.028, 0.028] }], { radial: Math.max(6, r >> 1), rings: 7, ref: [0, 1, 0] }), white);
    s.add(blob(1), white, { matrix: M(sx * 0.63, 1.0, -0.11, 0, 0, 0, 0.03, 0.042, 0.026) });
    s.add(new THREE.TorusGeometry(0.038, 0.012, 5, 12), [0.5, 0.45, 0.7], { matrix: M(sx * 0.6, 1.02, -0.1, 0, Math.PI / 2, 0.6 * sx) }); // the manacle
  }
  // long hair, lifted as if she were under water, falling down her back
  for (let i = 0, n = [7, 11, 16, 22][q]; i < n; i++) {
    const a = (i / (n - 1) - 0.5) * 2.4, x = Math.sin(a) * 0.085, z = -0.03 - Math.cos(a) * 0.05, sway = rr(-0.08, 0.08);
    s.add(loft([{ p: [x, 1.68, z + 0.02], r: [0.03, 0.022] }, { p: [x * 1.5, 1.5, z - 0.12], r: [0.034, 0.024] }, { p: [x * 1.9 + sway, 1.15, z - 0.24], r: [0.026, 0.02] }, { p: [x * 2.3 + sway * 2, 0.8 + rr(-0.08, 0.08), z - 0.3], r: [0.004, 0.004] }], { radial: 6, rings: [5, 8, 10, 14][q] }), [0.8, 0.85, 1]);
  }
  return s.build();
}
function chainGeo(a, b, q) {
  // a sagging chain of links from a to b; consecutive links turned 90 degrees
  const s = new SB(), link = new THREE.TorusGeometry(0.034, 0.0095, [3, 4, 6, 8][q], [6, 8, 10, 14][q]), L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(6, Math.round(L / 0.075));
  const pt = (t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t) - Math.sin(Math.PI * t) * L * 0.12, lerp(a[2], b[2], t)];
  const iron = (x, y, z) => { const k = 0.7 + 0.3 * Math.sin(x * 40 + y * 31 + z * 23); return [0.3 * k, 0.29 * k, 0.28 * k]; };
  for (let i = 0; i < n; i++) {
    const p0 = pt(i / n), p1 = pt((i + 1) / n), m = new THREE.Matrix4(), dir = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).normalize();
    const qn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), i % 2 ? Math.PI / 2 : 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
    m.compose(new THREE.Vector3((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2), qn, new THREE.Vector3(1, 1.45, 1));
    s.add(link, iron, { matrix: m });
  }
  return { geo: s.build(), pt };
}
function anchorGeo() {
  const b = new GeoBuilder(), stone = col(0x6a645a), iron = col(0x3a3836);
  b.add(T.box, M(0, 0.22, 0, 0, 0.3, 0, 0.7, 0.44, 0.7), stone, 0.08);
  b.add(T.box, M(0, 0.47, 0, 0, 0.3, 0, 0.3, 0.08, 0.3), iron, 0.05);
  b.add(T.torus, M(0, 0.56, 0, Math.PI / 2, 0, 0, 0.13, 0.13, 0.25), iron, 0.05);
  return b.build();
}
function merchantGeo(q) {
  const s = new SB(), r = [10, 16, 22, 30][q], grey = (k) => (x, y, z) => { const n = 0.85 + 0.25 * Math.sin(x * 37 + y * 23 + z * 41); return [0.13 * k * n, 0.125 * k * n, 0.14 * k * n]; };
  s.add(loft([{ p: [0, 0.02, 0], r: [0.36, 0.3] }, { p: [0, 0.8, 0], r: [0.24, 0.2] }, { p: [0, 1.35, 0.02], r: [0.26, 0.19] }, { p: [0, 1.55, 0.03], r: [0.18, 0.15] }], { radial: r, rings: [6, 10, 14, 20][q], ref: [0, 0, 1], shape: (a, t) => 1 + 0.06 * Math.sin(a * 8) * (1 - t) }), grey(1));
  s.add(blob(Math.min(3, q + 1), (x, y, z) => [x, y, z > 0.4 && y < 0.5 ? 0.4 + (z - 0.4) * 0.1 : z]), grey(0.9), { matrix: M(0, 1.66, 0.03, 0.15, 0, 0, 0.16, 0.19, 0.17) });
  s.add(new THREE.SphereGeometry(1, 10, 8), [0.02, 0.02, 0.025], { matrix: M(0, 1.62, 0.09, 0, 0, 0, 0.1, 0.12, 0.09) });
  s.add(loft([{ p: [0.22, 1.4, 0.02], r: [0.07, 0.07] }, { p: [0.3, 1.15, 0.12], r: [0.065, 0.065] }, { p: [0.32, 1.02, 0.24], r: [0.06, 0.06] }], { radial: Math.max(6, r >> 1), rings: 6 }), grey(0.95));
  s.add(new THREE.CylinderGeometry(0.025, 0.03, 1.9, 6), [0.25, 0.2, 0.15], { matrix: M(0.34, 0.95, 0.28) });
  s.add(new THREE.BoxGeometry(0.12, 0.16, 0.12), [0.2, 0.19, 0.18], { flat: true, matrix: M(0.34, 1.72, 0.4) });
  s.add(new THREE.BoxGeometry(0.6, 0.45, 0.45), [0.15, 0.11, 0.07], { flat: true, matrix: M(-0.6, 0.22, 0.25, 0, 0.3, 0) });
  for (let i = 0; i < 4; i++) s.add(new THREE.CylinderGeometry(0.03, 0.04, 0.16, 6), i % 2 ? [0.25, 0.4, 0.3] : [0.45, 0.3, 0.15], { matrix: M(-0.75 + i * 0.1, 0.52, 0.2 + (i % 2) * 0.1) });
  return s.build();
}

export function buildStory() {
  for (const k of Object.keys(ST)) delete ST[k];
  ST.on = false;
  if (!LV.story || LV.floor !== 4 || !W.ruins) return;
  const q = DETAIL[settings.detail].q, group = W.group, R = W.ruins, story = LV.story;
  Object.assign(ST, { on: true, freed: false, guardianDown: false, solved: false, puzzle: false, seq: [], collapsed: null, timers: [], plaques: R.plaques, murals: R.murals, flashT: 0 });
  // ---- Sera ----
  const sp = story.sera, face = Math.PI; // she faces north, toward the way in
  const mat = ghostMaterial(), geo = seraGeo(q), mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 5;
  const sg = new THREE.Group(); sg.position.set(sp.x, 0.32, sp.z); sg.rotation.y = face; sg.add(mesh); group.add(sg);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x6a88d8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, toneMapped: false, opacity: 0.25 }));
  halo.position.set(0, 1.3, 0); halo.scale.set(2.6, 3.2, 1); sg.add(halo);
  W.disposables.push(mat, geo, halo.material);
  const toWorld = (lx, ly, lz) => [sp.x + Math.cos(face) * lx + Math.sin(face) * lz, ly, sp.z - Math.sin(face) * lx + Math.cos(face) * lz];
  const chainMat = psx(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.75, roughness: 0.38, emissive: 0x5a3ab0, emissiveIntensity: 0.25, dithering: true })); W.disposables.push(chainMat);
  const aGeo = anchorGeo(); W.disposables.push(aGeo);
  // one anchor in front of her (chained to her waist), two behind to either side (chained to her wrists)
  ST.anchors = [[0, 2.7, [0, 1.3, 0.14]], [-2.5, -1.8, [-0.6, 1.34, -0.1]], [2.5, -1.8, [0.6, 1.34, -0.1]]].map(([lx, lz, end], i) => {
    const [ax, , az] = toWorld(lx, 0, lz), endW = toWorld(end[0], end[1], end[2]);
    const am = new THREE.Mesh(aGeo, matVC); am.position.set(ax, 0, az); am.castShadow = true; am.receiveShadow = true; am.matrixAutoUpdate = false; am.updateMatrix(); group.add(am);
    const ac = W.ctx.addCullable({ mesh: am, cx: ax, cy: 0.3, cz: az, r: 0.7 });
    const c = chainGeo([ax, 0.58, az], endW, q), cm = new THREE.Mesh(c.geo, chainMat); cm.castShadow = true; cm.matrixAutoUpdate = false; cm.updateMatrix(); group.add(cm);
    W.disposables.push(c.geo);
    const cx = (ax + endW[0]) / 2, cz = (az + endW[2]) / 2, cc = W.ctx.addCullable({ mesh: cm, cx, cy: 0.9, cz, r: 2.2, fr: 1.6 });
    const sig = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x9a7aff, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, toneMapped: false, opacity: 0.6 }));
    sig.position.set(ax, 0.6, az); sig.scale.set(0.5, 0.5, 1); group.add(sig); W.disposables.push(sig.material);
    return { x: ax, z: az, hp: 3, broken: false, mesh: am, cull: ac, chain: cm, chainCull: cc, pt: c.pt, sig, i };
  });
  ST.sera = { x: sp.x, z: sp.z, group: sg, mesh, mat, halo, met: false, spoke: false, breakable: false, freeT: -1, k: 0.4 };
  ST.chainMat = chainMat;
  // ---- the Gray Merchant ----
  const mp = story.merchant, mg = merchantGeo(q), mm = new THREE.Mesh(mg, matVC); W.disposables.push(mg);
  mm.position.set(mp.x, 0, mp.z); mm.rotation.y = Math.PI / 2; mm.castShadow = true; mm.receiveShadow = true; mm.matrixAutoUpdate = false; mm.updateMatrix(); group.add(mm);
  W.ctx.addCullable({ mesh: mm, cx: mp.x, cy: 0.9, cz: mp.z, r: 1.3, fr: 1 });
  const lg = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x9aa8c8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, toneMapped: false, opacity: 0.5 }));
  const lx = mp.x + 0.4, lz = mp.z - 0.34; lg.position.set(lx, 1.72, lz); lg.scale.set(0.7, 0.7, 1); group.add(lg); W.disposables.push(lg.material);
  ST.merchant = { x: mp.x, z: mp.z, glow: lg, spoke: 0, t: 0 };
  W.total = W.cullables.length;
}

// queue lines one after another (the voice box shows one at a time)
function later(t, fn) { ST.timers.push({ t: G.t + t, fn }); }
function sayAll(lines, who, gap = 0) { lines.forEach((l, i) => later(gap * i, () => H.say(l, true, who))); }

// ---------- collapse: the other wing comes down ----------
function reach(fromX, fromZ, blocked) {
  const w = LV.w, seen = new Uint8Array(w * LV.h), s = idx(toTile(fromX), toTile(fromZ)), q = [s]; seen[s] = 1;
  for (let i = 0; i < q.length; i++) { const c = q[i], x = c % w, y = (c / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (!inBounds(nx, ny)) continue; const ni = idx(nx, ny); if (!seen[ni] && LV.tiles[ni] === 1 && !blocked.has(ni)) { seen[ni] = 1; q.push(ni); } } }
  return seen;
}
function collapse(branch, line) {
  if (ST.collapsed) return;
  const tiles = LV.story.branches[branch], blocked = new Set(tiles.map((t) => idx(t.x, t.y)));
  // never seal the Warden in: if the way down would be cut off from here, the walls hold
  if (!reach(P.x, P.z, blocked)[idx(toTile(LV.exit.x), toTile(LV.exit.z) - 1)]) return;
  ST.collapsed = branch;
  for (const t of tiles) LV.tiles[idx(t.x, t.y)] = 0;
  collapseTiles(tiles);
  // anything standing in the passage is thrown clear
  for (const e of CR.list) { const i = idx(toTile(e.x), toTile(e.z)); if (blocked.has(i)) { e.alive = false; e.hp = 0; e.grp.visible = false; } }
  CR.list = CR.list.filter((e) => e.alive);
  for (let k = 0; k < tiles.length; k += 3) { const t = tiles[k]; dust((t.x + 0.5) * TILE, 1.5, (t.y + 0.5) * TILE, 3, [0.2, 0.18, 0.15]); }
  G.shake = Math.max(G.shake, 1.3); sfx.rumble(); H.say(line, true);
  W.total = W.cullables.length;
}

// ---------- the Warden's blade on a chain anchor ----------
export function slashStory(h, range, arc) {
  if (!ST.on || ST.freed) return false;
  let hit = false;
  for (const a of ST.anchors) {
    if (a.broken) continue;
    const d = Math.hypot(a.x - P.x, a.z - P.z); if (d > range + 0.5) continue;
    if (Math.abs(wrapAngle(Math.atan2(a.z - P.z, a.x - P.x) - h)) > arc + 0.15) continue;
    hit = true; sfx.chain(a.x, a.z); burst(a.x, 0.6, a.z, 10, [0.8, 0.75, 1], 2.2, 0.35, -6); G.shake = Math.max(G.shake, 0.2);
    if (!ST.sera.breakable) { H.say('The chain will not give. Not while she sleeps.'); continue; }
    a.hp--;
    if (a.hp <= 0) {
      a.broken = true; a.chain.visible = false; a.chainCull.mesh.visible = false; a.chainCull.dead = true; a.sig.visible = false; sfx.chainBreak(a.x, a.z);
      for (let i = 0; i <= 12; i++) { const p = a.pt(i / 12); burst(p[0], p[1], p[2], 3, [0.7, 0.6, 1], 1.2, 0.6, -3); }
      const left = ST.anchors.filter((o) => !o.broken).length;
      if (left === 2) H.say('One. She stirs.'); else if (left === 1) H.say('Two. One more.');
      else freeSera();
    }
  }
  return hit;
}
function freeSera() {
  const s = ST.sera; ST.freed = true; s.freeT = 0; S.freedSpirit = true;
  sayAll(['Thank you. The King is not evil. He is trapped in his own certainty.', 'The crown holds him as it held me. Remember that, when you face him.'], 'sera', 5.2);
  sfx.spirit(1.2);
  P.maxHp += 8; P.hp = Math.min(P.maxHp, P.hp + 8); P.pulseCostMult *= 0.85;
  later(1.2, () => H.hint("Sera's knowledge flows into you. +8 max health. Pulse costs less.", 5));
  later(10.5, () => collapse('guardian', 'The walls shift. The stone path is sealed.'));
  burst(s.x, 1.4, s.z, 40, [0.7, 0.8, 1], 1.4, 1.6, 0.6, 0.8);
}
// a creature fell: the Ruin Guardian's death wakes the carved signs
export function storyCreatureDown(e) {
  if (!ST.on || !e.guardian) return;
  ST.guardianDown = true; S.coins += 20; // what it guarded (the 2D Crown)
  later(1.6, () => collapse('spirit', 'The light dims. The binding chamber is gone.'));
  later(5.5, () => { ST.puzzle = true; for (const p of ST.plaques) burst(p.x, p.y, p.z, 14, [0.75, 0.8, 0.9], 1, 0.8, 0); H.say(ST.murals.length ? 'Carved into the wall: three signs. The same three as the pictures.' : 'Carved into the wall: three signs. Crown, Light, Shadow.', true); });
  later(12, () => { if (!ST.solved && ST.seq.length === 0) H.hint('Hold the bright beam on each sign, in the right order.', 5); });
}
function select(p) {
  const want = ORDER[ST.seq.length];
  if (p.sym === want) {
    p.lit = true; ST.seq.push(p.sym); sfx.glyph(ST.seq.length - 1); burst(p.x, p.y, p.z, 16, [1, 0.85, 0.45], 1.2, 0.6, 0);
    if (ST.seq.length === 3) solve();
    return;
  }
  // wrong: gray energy throws you back
  sfx.wrong(); ST.seq = []; ST.flashT = 0.6; for (const o of ST.plaques) { o.lit = false; o.hold = 0; }
  P.hp = Math.max(1, P.hp - 15); P.hurt = 0.4; G.shake = Math.max(G.shake, 0.6);
  const a = Math.atan2(P.z - p.z, P.x - p.x); P.pushX = Math.cos(a) * 7; P.pushZ = Math.sin(a) * 7;
  H.hint('The symbols flash. Gray energy throws you back.  −15', 3); H.say('Not that one. Remember the walls.');
}
function solve() {
  ST.solved = true; S.solvedPuzzle = true; sfx.relic();
  P.atkBonus += 5; P.brightBonus += 0.06; P.dr += 0.05;
  for (const p of ST.plaques) burst(p.x, p.y, p.z, 30, [1, 0.82, 0.4], 2, 1, -1);
  H.hint('Relic: the Crown Shard. Harder cuts, brighter light, and you are harder to hurt.', 5.5);
  later(0.8, () => H.say('It hums. It wants me to burn brighter. I will not let it.', true));
}

// ---------- per frame ----------
const _f = new THREE.Vector3();
export function updateStory(dt, live) {
  if (!ST.on) return;
  const t = G.t;
  if (live) for (let i = ST.timers.length - 1; i >= 0; i--) if (t >= ST.timers[i].t) { const f = ST.timers[i].fn; ST.timers.splice(i, 1); f(); }
  const R = W.ruins, rooms = LV.story.rooms;
  // the fork, announced once you stand in the hub
  if (live && !G.tips.fork && inRect(rooms.hub, toTile(P.x), toTile(P.z)) && toTile(P.z) > rooms.hub.y + 2) { G.tips.fork = 1; H.say('Two ways down. Chains, to the west. Something breathing stone, to the east.'); }
  // ---- Sera ----
  const s = ST.sera, d = Math.hypot(P.x - s.x, P.z - s.z), los = d < 30 && lineOfSight(P.x, P.z, s.x, s.z);
  const lit = LV.story.seraBraziers.every((i) => LV.braziers[i] && LV.braziers[i].lit);
  if (live && !s.met && d < 13 && los) { s.met = true; H.say(lit ? 'Someone is chained here.' : 'Someone is chained here. She is too faint to hear me. Light the braziers.', true); }
  if (live && lit && !s.spoke && d < 11 && los) {
    s.spoke = true; s.breakable = true; sfx.spirit(0.8);
    sayAll(["Warden... I was Sera. Maren's daughter.", 'The crown uses the living as anchors. Our life sustains his unlife.', 'Break the chains and I will be free. But my freedom weakens its hold. The walls may shift.'], 'sera', 5.4);
    later(17, () => { if (!ST.freed) H.hint('Slash the three anchors to break her chains.', 4.5); });
  }
  let k = lit ? 1 : 0.42;
  if (s.freeT >= 0) { s.freeT += dt; k = Math.max(0, 1.4 - s.freeT * 0.12); s.group.position.y = 0.32 + s.freeT * 0.18; }
  s.k = lerp(s.k, k, damp(1.5, dt));
  s.mat.uniforms.uK.value = s.k * (0.9 + 0.1 * Math.sin(t * 1.7)); s.mat.uniforms.uTime.value = t;
  if (s.freeT < 0) s.group.position.y = 0.32 + Math.sin(t * 1.1) * 0.04;
  s.group.visible = s.k > 0.01 && (!settings.culling || seenPoint(s.x, s.z, 1.5));
  s.halo.material.opacity = 0.22 * s.k;
  W.spirit.position.set(s.x, 1.5, s.z); W.spirit.intensity = s.k > 0.01 ? 7 * s.k : 0; // it lights her chains and circle
  if (R.circle) R.circle.mat.emissiveIntensity = (ST.freed ? Math.max(0, 0.9 - s.freeT * 0.2) : 0.5 + 0.4 * (s.breakable ? 1 : 0) * (0.6 + 0.4 * Math.sin(t * 2.2)));
  ST.chainMat.emissiveIntensity = 0.18 + (s.breakable ? 0.35 + 0.2 * Math.sin(t * 3) : 0.05 * Math.sin(t * 1.3));
  for (const a of ST.anchors) if (!a.broken) { a.sig.visible = !settings.culling || seenPoint(a.x, a.z, 0.5); a.sig.material.opacity = (s.breakable ? 0.75 : 0.35) * (0.8 + 0.2 * Math.sin(t * 4 + a.i)); }
  if (live && s.breakable && !ST.freed && Math.random() < dt * 0.8) { const a = ST.anchors[(Math.random() * 3) | 0]; if (!a.broken && d < 14) { const p = a.pt(Math.random()); ember(p[0], p[1], p[2], [0.6, 0.5, 1]); } }
  // ---- the Gray Merchant ----
  const m = ST.merchant, dm = Math.hypot(P.x - m.x, P.z - m.z), mlos = dm < 30 && lineOfSight(P.x, P.z, m.x, m.z);
  m.glow.visible = mlos && (!settings.culling || seenPoint(m.x, m.z, 0.6)); m.glow.material.opacity = 0.42 + 0.08 * Math.sin(t * 3.1);
  if (live && m.spoke === 0 && dm < 6 && mlos && G.t > 1.2) { m.spoke = 1; m.t = G.t; sfx.merchant(); H.say('Someone is sitting there, with a lamp of his own.'); } // walk up and USE to trade (npc.js)
  // ---- murals: the lantern notices them ----
  if (live && !G.tips.murals) for (const mu of ST.murals) if (mu.panel.mesh.visible && Math.hypot(P.x - mu.x, P.z - mu.z) < 9) { G.tips.murals = 1; H.say('Three pictures. A crown, a light, a shadow. Someone wanted them remembered in that order.'); break; }
  // ---- the carved signs ----
  ST.flashT = Math.max(0, ST.flashT - dt);
  const bright = lantern.mode === 2 && lantern.k > 0.3;
  for (const p of ST.plaques) {
    let e = 0, er = 1, eg = 1, eb = 1;
    if (ST.puzzle && !ST.solved && live) {
      const aimed = aimedAt(p.x, p.y, p.z, 14, 0.45) && lineOfSight(P.x, P.z, p.x + p.f.nx * 1.2, p.z + p.f.nz * 1.2);
      if (aimed && !p.lit) {
        if (bright) { p.hold += dt; if (p.hold > 0.75) select(p); }
        else if (!G.tips.plaqueBright) { G.tips.plaqueBright = 1; H.say('Bright light. They answer to the wide beam.'); }
      } else p.hold = Math.max(0, p.hold - dt * 1.5);
    }
    if (ST.solved) { e = 2.2 + 0.3 * Math.sin(t * 2); er = 1; eg = 0.8; eb = 0.4; }
    else if (p.lit) { e = 2.4; er = 1; eg = 0.78; eb = 0.36; }
    else if (ST.puzzle) { e = 0.4 + 0.12 * Math.sin(t * 2 + p.x) + p.hold * 2.4; er = 0.72 + p.hold * 0.4; eg = 0.78 + p.hold * 0.1; eb = 0.92 - p.hold * 0.5; }
    if (ST.flashT > 0) { e = 3 * ST.flashT; er = eg = eb = 0.85; }
    p.mat.emissive.setRGB(er * e, eg * e, eb * e);
  }
}
