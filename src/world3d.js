import { PANELS } from './assets/index.js';
import { houseGeo, wellGeo, stallGeo, cartGeo, fencePiece, palisade, gateGeo, fieldGeo, logGeo, postGeo, mudTexture, cobbleTexture, trailTexture } from './village.js';
import { ash, THREE, scene, camera, renderer, canvasTex, glowTex, flameTex, matVC, matFoliage, psx, GeoBuilder, T, M, col, srand, rnd, rr, mr, clamp, lerp, settings, rotYOfHeading, TAU } from './engine.js';
import { FF, matLeaf } from './forest.js';
import { pineGeo, birchGeo, deadGeo, boulderGeo, elderGeo, thicketGeo, pineHi, birchHi, deadHi, boulderHi, elderHi, coverVariants, COVER_CELL } from './trees.js';
import { LV, TILE, idx, inBounds, lineOfSight, isWalkable } from './level.js';
import { lantern, inBeam, beamAt, NEAR_R } from './lantern.js';
import { buildRuins, computeSeen, anySeen, seenAt, footprint, ensureBlocks, updateBlocks, pillarGeo, pillarHi, drumGeo, drumHi, statueGeo, statueHi, statueHeadGeo, STATUE_NECK,
  findArches, archGeo, stoneBrazierGeo, stairGeo, ruinCoverVariants, RUIN_COVER_CELL, updateStatues, rebuildWalls } from './ruins.js';

// =====================================================================
//  WORLD 3D — turns the tile level into a forest, and decides every frame
//  what gets drawn. The rule is Eyeshine's: if the lantern doesn't touch
//  it, it isn't drawn. Things a lit brazier or a flare lights count too.
// =====================================================================

export const DETAIL = {
  low: { q: 0, lod: 0, cover: 0, blocks: 0, label: 'LOW' },
  high: { q: 1, lod: 24, ffLod: 13, cover: 18, blocks: 14, label: 'HIGH' },
  ultra: { q: 2, lod: 30, ffLod: 20, cover: 24, blocks: 20, label: 'ULTRA' },
  max: { q: 3, lod: 40, ffLod: 32, cover: 32, blocks: 28, label: 'MAX' },
};
const CELL = 8;           // culling grid cell (m)
const BRAZIER_R = 9;      // how far a lit brazier's light reaches (m)
export let W = null;      // the built world

const geoCache = {};
function shared(key, make) { if (!geoCache[key]) { const g = make(); g.userData.keep = true; geoCache[key] = g; } return geoCache[key]; }

function groundTexture(gray) {
  const t = canvasTex(256, (g, s) => {
    g.fillStyle = gray ? '#2a2927' : '#2f2a21'; g.fillRect(0, 0, s, s);
    const pal = gray ? ['#33322f', '#232220', '#3b3936', '#2c2d2a', '#1b1a19', '#45423d'] : ['#3a3226', '#262119', '#443a2b', '#2b3020', '#1d1912', '#4d4230'];
    for (let i = 0; i < 70; i++) { g.fillStyle = pal[i % pal.length] + '66'; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 8 + Math.random() * 30, 0, 6.283); g.fill(); }
    for (let i = 0; i < 4200; i++) { g.fillStyle = pal[(Math.random() * pal.length) | 0]; g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1 + Math.random() * 2); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4);
  t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return t;
}

const PTEX = {};
function panelTex(k, srgb = true) { if (!PTEX[k]) { const t = new THREE.TextureLoader().load(PANELS[k]); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; PTEX[k] = t; } return PTEX[k]; }
export function disposeWorld() {
  if (!W) return;
  W.group.traverse((o) => { if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose(); });
  W.disposables.forEach((d) => d.dispose());
  for (const k in W.hi) if (!W.hi[k].userData.shared) W.hi[k].dispose();
  if (W.cover) W.cover.meshes.forEach((m) => m.dispose());
  for (const l of W.lights) scene.remove(l);
  scene.remove(W.group);
  W = null;
}

export function buildWorld() {
  disposeWorld();
  srand(LV.seed * 7 + 3);
  const group = new THREE.Group(); scene.add(group);
  const gw = Math.ceil((LV.w * TILE) / CELL), gh = Math.ceil((LV.h * TILE) / CELL);
  W = {
    group, cullables: [], grid: Array.from({ length: gw * gh }, () => []), gw, gh, shown: [], disposables: [], lights: [],
    hi: {}, hiMake: {}, hiQ: -1, cover: null, proxies: [], braziers: [], pickups: [], secrets: [], exit: null, fireflies: null,
    pool: [], flare: null, pulse: null, spirit: null, drawn: 0, total: 0, coverDrawn: 0, detailBuildMs: 0, ruins: null, ctx: null,
  };
  const cellOf = (o) => clamp(Math.floor(o.cz / CELL), 0, gh - 1) * gw + clamp(Math.floor(o.cx / CELL), 0, gw - 1);
  const addCullable = (o) => {
    if (LV.solid && !o.tiles) o.tiles = footprint(o.cx, o.cz, Math.min(o.fr || o.r, 3));
    W.cullables.push(o); W.grid[cellOf(o)].push(o); o.mesh.visible = false; return o;
  };
  const ctx = (W.ctx = { group, addCullable, W, cellOf });
  // the curse drains the colour: the Gray Forest's world is tinted cold and grey (vertex-colour materials are shared)
  ash.uGray.value = LV.floor === 2 ? 0.88 : LV.floor === 1 ? 0.62 : 0; // Ash Hollow and the Gray Forest: colour only where light falls
  if (LV.floor >= 4) buildRuinsWorld(ctx); else buildWoods(ctx);
  if (LV.floor <= 3) buildTrails(ctx);
  if (LV.floor === 1) buildVillage(ctx);
  buildCommon(ctx);
  W.total = W.cullables.length;
  ensureDetail();
  return W;
}

// a lo-poly mesh that swaps to its hi-poly twin when it is lit and close (trees, pillars, statues)
function placeLod(ctx, geo, x, z, s, key, opt = {}) {
  const { group, addCullable } = ctx;
  const mesh = new THREE.Mesh(geo, geo.groups.length ? [matVC, matLeaf] : matVC);   // pack models: bark, then two-sided leaves
  mesh.position.set(x, opt.y || 0, z); mesh.rotation.y = opt.yaw !== undefined ? opt.yaw : rr(0, 6.28); mesh.scale.set(s, s * (opt.sy || 1), s);
  mesh.castShadow = opt.cast !== false; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); group.add(mesh);
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = opt.hi ? geo.boundingBox.clone().union(opt.hi.boundingBox) : geo.boundingBox, y0 = opt.y || 0, H = bb.max.y * s * (opt.sy || 1), Rh = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z) * s;
  const n = clamp(Math.ceil(H / (2.2 * Rh)), 1, 4), seg = H / n, sr = Math.sqrt(Rh * Rh + (seg / 2) ** 2), ys = [];
  for (let i = 0; i < n; i++) ys.push(y0 + seg * (i + 0.5));
  return addCullable({ mesh, cx: x, cy: y0 + H / 2, cz: z, r: Math.sqrt(Rh * Rh + (H / 2) ** 2), fr: Rh, ys, sr, tree: opt.tree !== false, lo: geo, hiKey: key, ff: !!opt.hi });
}

function buildWoods(ctx) {
  const { group, addCullable } = ctx;

  // ---- ground: 16 m chunks, so even the floor is only drawn where light lands ----
  const village = LV.floor === 1, gTex = village ? mudTexture() : groundTexture(LV.floor === 2), gMat = psx(new THREE.MeshLambertMaterial({ map: gTex, dithering: true }));
  if (village) { gTex.wrapS = gTex.wrapT = THREE.RepeatWrapping; gTex.repeat.set(4, 4); }
  W.disposables.push(gTex, gMat);
  const CH = 16, chunkGeo = new THREE.PlaneGeometry(CH, CH, 2, 2); chunkGeo.rotateX(-Math.PI / 2); chunkGeo.userData.keep = false; W.disposables.push(chunkGeo);
  for (let z = 0; z < LV.h * TILE; z += CH) for (let x = 0; x < LV.w * TILE; x += CH) {
    const m = new THREE.Mesh(chunkGeo, gMat); m.position.set(x + CH / 2, 0, z + CH / 2); m.receiveShadow = true;
    m.matrixAutoUpdate = false; m.updateMatrix(); group.add(m);
    addCullable({ mesh: m, cx: x + CH / 2, cy: 0, cz: z + CH / 2, r: CH * 0.72, ground: true });
  }

  // ---- the forest: trees on wall tiles, densest at the edge of every clearing ----
  const pines = [0, 1, 2, 3].map((v) => shared('pine' + v, () => pineGeo(v))), birches = [0, 1].map((v) => shared('birch' + v, () => birchGeo(v)));
  const deads = [0, 1].map((v) => shared('dead' + v, () => deadGeo(v))), rocks = [0, 1, 2].map((v) => shared('rock' + v, () => boulderGeo(0x6e6c62)));
  const thickets = [0, 1, 2, 3].map((v) => shared('thicket' + v, () => thicketGeo(v))), elders = [0, 1].map((v) => shared('elder' + v, () => elderGeo(v)));
  const place = (geo, x, z, s, key, opt = {}) => placeLod(ctx, geo, x, z, s, key, opt);
  // the Field & Forest pack (forest.js): its far model wherever the light touches, its near one when lit and close
  const pack = !!FF.spruce, ffKeys = new Set();
  const ffTree = (name, x, z, s, sy = 1, opt = {}) => { ffKeys.add(name); return placeLod(ctx, FF[name + '_far'], x, z, s, 'ff_' + name, { sy, hi: FF[name], ...opt }); };
  const DEN = village ? [0, 0, 0, 0.5, 0.55, 0.5, 0.4] : [0, 0.95, 0.9, 0.8, 0.65, 0.5, 0.32];
  const built = village ? villageLots() : null;
  for (let ty = 0; ty < LV.h; ty++) for (let tx = 0; tx < LV.w; tx++) {
    const d = LV.depth[idx(tx, ty)]; if (d === 0 || d > 6) continue;
    if (built && built[idx(tx, ty)]) continue;
    const cx = (tx + 0.5) * TILE, cz = (ty + 0.5) * TILE;
    if (rnd() < DEN[d]) {
      const p = rnd(), x = cx + rr(-0.6, 0.6), z = cz + rr(-0.6, 0.6), s = rr(0.8, 1.3);
      if (pack) { // Field & Forest: ponderosa (high crowns) at the clearing's edge, spruce behind them, aspen, snags
        const sy = rr(0.9, 1.12);
        if (p < 0.58) { if (d === 1 && rnd() < 0.7) ffTree('ponderosa', x, z, rr(0.44, 0.56), sy); else ffTree('spruce', x, z, rr(0.48, 0.62), sy); }
        else if (p < 0.76) ffTree('aspen', x, z, rr(0.55, 0.7), sy);
        else ffTree('snag', x, z, rr(0.75, 1.1), sy);
      }
      else if (p < 0.58) { const v = (rnd() * 4) | 0; place(pines[v], x, z, s, 'pine' + v); }
      else if (p < 0.76) { const v = (rnd() * 2) | 0; place(birches[v], x, z, s * 0.95, 'birch' + v); }
      else { const v = (rnd() * 2) | 0; place(deads[v], x, z, s, 'dead' + v); }
    }
    if (!village && ((d === 1 && rnd() < 0.75) || (d === 2 && rnd() < 0.4))) {
      if (pack) { const ol = rnd() < 0.6; ffTree(ol ? 'oleander' : 'sage', cx + rr(-0.5, 0.5), cz + rr(-0.5, 0.5), ol ? rr(0.7, 1.0) : rr(0.9, 1.3), rr(0.85, 1.1), { cast: false, tree: false }); }
      else { const v = (rnd() * 4) | 0; place(thickets[v], cx + rr(-0.5, 0.5), cz + rr(-0.5, 0.5), rr(0.9, 1.4), null, { cast: false }); }
    }
    if (d === 1 && rnd() < 0.07) { const v = (rnd() * 3) | 0; place(rocks[v], cx + rr(-0.4, 0.4), cz + rr(-0.4, 0.4), rr(0.6, 1.3), 'rock' + v); }
  }
  // elders: the great trunks standing inside clearings (the Crown's pillars)
  if (!village) for (const s of LV.structures) {
    if (pack) { const c = rnd() < 0.5; ffTree(c ? 'cottonwood' : 'oak', s.x, s.z, c ? rr(0.62, 0.72) : rr(0.62, 0.72), rr(0.95, 1.1)); }
    else { const v = (rnd() * 2) | 0; place(elders[v], s.x, s.z, rr(0.95, 1.15), 'elder' + v); }
  }
  // a few stones and stumps out in the open (no collision: knee-high at most)
  if (!village) for (const r of LV.rooms) for (let i = 0; i < 2; i++) {
    const tx = Math.floor(rr(r.x + 1, r.x + r.w - 1)), ty = Math.floor(rr(r.y + 1, r.y + r.h - 1));
    if (!inBounds(tx, ty) || LV.tiles[idx(tx, ty)] !== 1) continue;
    const v = (rnd() * 3) | 0; place(rocks[v], (tx + 0.5) * TILE + rr(-0.5, 0.5), (ty + 0.5) * TILE + rr(-0.5, 0.5), rr(0.25, 0.45), 'rock' + v);
  }
  W.hiMake = {
    pine0: (q) => pineHi(0, q), pine1: (q) => pineHi(1, q), pine2: (q) => pineHi(2, q), pine3: (q) => pineHi(3, q),
    birch0: (q) => birchHi(0, q), birch1: (q) => birchHi(1, q), dead0: (q) => deadHi(0, q), dead1: (q) => deadHi(1, q),
    rock0: (q) => boulderHi(0x6e6c62, q), rock1: (q) => boulderHi(0x6e6c62, q), rock2: (q) => boulderHi(0x6e6c62, q),
    elder0: (q) => elderHi(0, q), elder1: (q) => elderHi(1, q),
  };

  // ---- decorations ----
  for (const d of LV.decorations) {
    const b = new GeoBuilder();
    if (d.kind === 'stones') {
      const n = 7, stone = col(0x6a6a62), moss = col(0x3e5a2c);
      for (let i = 0; i < n; i++) { const a = (i / n) * 6.283, h = rr(1.4, 2.4); b.add(T.box, M(Math.cos(a) * d.r, h / 2 - 0.1, Math.sin(a) * d.r, rr(-0.08, 0.08), -a, rr(-0.08, 0.08), rr(0.5, 0.75), h, rr(0.3, 0.45)), stone, 0.14); b.add(T.ico, M(Math.cos(a) * d.r, h - 0.1, Math.sin(a) * d.r, 0, 0, 0, 0.3, 0.08, 0.25), moss, 0.2); }
      b.add(T.box, M(0, 0.35, 0, 0, rr(0, 3), 0, 1.6, 0.7, 0.9), stone, 0.12);
    } else if (d.kind === 'post' || d.kind === 'log') {
      const g = d.kind === 'post' ? shared('post', postGeo) : shared('log', logGeo), mesh = new THREE.Mesh(g, matVC);
      mesh.position.set(d.x, 0, d.z); mesh.rotation.y = d.yaw || 0; mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); group.add(mesh);
      addCullable({ mesh, cx: d.x, cy: 0.6, cz: d.z, r: d.kind === 'post' ? 0.8 : 1.8 });
      continue;
    } else if (d.kind === 'cairn') {
      const stone = col(0x5e5c54), n = d.small ? 5 : 9;
      for (let i = 0; i < n; i++) { const s = lerp(d.small ? 0.36 : 0.55, 0.14, i / n); b.add(T.dode, M(rr(-0.15, 0.15), 0.15 + i * 0.16, rr(-0.15, 0.15), rr(0, 3), rr(0, 6), 0, s, s * 0.6, s), stone, 0.15); }
      if (!d.small) b.limb(T.box, 0.6, 0, 0.2, 1.3, 0.05, 0.25, d.yaw, col(0x4a3a2a), 0.1);
    } else if (d.kind === 'pond') {
      if (pack) { const a = rr(0, 6.28); ffTree('willow', d.x + Math.cos(a) * (d.rx + 1.2), d.z + Math.sin(a) * (d.rz + 1.2), rr(0.42, 0.5), 1); }
      const reed = col(0x4a5a30);
      for (let i = 0; i < 40; i++) { const a = rr(0, 6.28), k = rr(0.9, 1.05); b.add(T.blade, M(Math.cos(a) * d.rx * k, 0, Math.sin(a) * d.rz * k, rr(0, 0.3), rr(0, 6.28), 0, 0.04, rr(0.5, 1.1), 0.5), reed, 0.15); }
      const pm = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshPhongMaterial({ color: 0x0b1416, specular: 0x8899aa, shininess: 90, dithering: true }));
      pm.rotation.x = -Math.PI / 2; pm.scale.set(d.rx, d.rz, 1); pm.position.set(d.x, 0.03, d.z); pm.receiveShadow = true; pm.matrixAutoUpdate = false; pm.updateMatrix(); group.add(pm);
      W.disposables.push(pm.material);
      addCullable({ mesh: pm, cx: d.x, cy: 0, cz: d.z, r: Math.max(d.rx, d.rz) });
    } else if (d.kind === 'camp') {
      const log = col(0x4a3a2a), cloth = col(0x5a4a38), rope = col(0x8a7a5a);
      for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.283 + 0.4; b.add(T.cyl6, M(Math.cos(a) * 2.2, 0.2, Math.sin(a) * 2.2, Math.PI / 2, -a + Math.PI / 2, 0, 0.2, 1.6, 0.2), log, 0.12); }
      b.add(T.cone4, M(4.2, 1.0, 1.5, 0, 0.6, 0, 1.6, 2.0, 1.4), cloth, 0.15);                     // lean-to tent
      b.add(T.box, M(-3.6, 0.3, -1.8, 0, 0.4, 0, 0.8, 0.6, 0.6), col(0x5a4632), 0.1);              // crate
      b.add(T.box, M(-3.0, 0.25, -2.6, 0, 1.0, 0, 0.6, 0.5, 0.5), col(0x5a4632), 0.1);
      b.add(T.box, M(2.4, 0.06, -3.2, 0, 0.9, 0, 0.8, 0.1, 1.9), col(0x3a3a48), 0.1);               // bedroll
      b.limb(T.cyl4, 4.9, 0, 0.6, 2.4, 0.04, 0.35, -0.6, rope, 0.1);
    }
    if (!b.pos.length) continue;
    const mesh = new THREE.Mesh(b.build(), matVC); mesh.position.set(d.x, 0, d.z); mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix(); group.add(mesh);
    const bs = mesh.geometry.boundingSphere; addCullable({ mesh, cx: d.x + bs.center.x, cy: bs.center.y, cz: d.z + bs.center.z, r: bs.radius });
  }
  for (const k of ffKeys) W.hiMake['ff_' + k] = () => FF[k];   // the pack's near models: shared, never disposed
}

// ---------------------------------------------------------------------
//  The ruins: walls + floors (ruins.js), then pillars, statues, arches, murals, plaques
// ---------------------------------------------------------------------
function buildRuinsWorld(ctx) {
  const { group, addCullable, W } = ctx;
  const R = buildRuins(ctx);
  const STUMP_H = [1.0, 1.5, 2.1];
  const pillars = [0, 1].map((v) => shared('pillar' + v, () => pillarGeo(v))), stumps = STUMP_H.map((h, i) => shared('stump' + i, () => pillarGeo(0, h)));
  const drum = shared('drum', drumGeo), statue = shared('statue', statueGeo), head = shared('statueHead', () => statueHeadGeo(false));
  const sq = () => (((rnd() * 4) | 0) * Math.PI) / 2 + rr(-0.06, 0.06); // square plinths sit square to the walls
  for (const st of LV.structures) {
    if (st.kind === 'pillar') placeLod(ctx, pillars[st.v || 0], st.x, st.z, 1, 'pillar' + (st.v || 0), { yaw: sq() });
    else if (st.kind === 'stump') { let k = 0; for (let i = 1; i < 3; i++) if (Math.abs(STUMP_H[i] - st.h) < Math.abs(STUMP_H[k] - st.h)) k = i; placeLod(ctx, stumps[k], st.x, st.z, 1, 'stump' + k, { yaw: sq() }); }
    else if (st.kind === 'drum') placeLod(ctx, drum, st.x, st.z, 1, 'drum', { yaw: st.yaw, tree: false });
    else if (st.kind === 'throne') { // the Hollow Throne: a stepped dais, a high-backed seat of dark stone trimmed in tarnished gold
      const b = new GeoBuilder(), stone = col(0x4a4640), dark = col(0x2e2b28), gold = col(0x8a6a2a);
      b.add(T.box, M(0, 0.18, 0, 0, 0, 0, 7.2, 0.36, 5.2), stone, 0.08); b.add(T.box, M(0, 0.52, 0.5, 0, 0, 0, 5.2, 0.32, 3.4), stone, 0.08);
      b.add(T.box, M(0, 1.0, 0.9, 0, 0, 0, 1.6, 0.62, 1.2), dark, 0.06);                               // the seat
      b.add(T.box, M(0, 2.6, 1.42, 0, 0, 0, 1.7, 3.6, 0.32), dark, 0.06);                              // the back, rising high
      for (let i = 0; i < 5; i++) b.add(T.box, M(-0.68 + i * 0.34, 4.55 + (i % 2) * 0.25, 1.42, 0, 0, 0, 0.14, 0.6 + (i % 2) * 0.4, 0.2), gold, 0.1); // its crown of spikes
      for (const sx of [-1, 1]) { b.add(T.box, M(sx * 0.88, 1.35, 0.8, 0, 0, 0, 0.22, 0.2, 1.3), dark, 0.06); b.add(T.box, M(sx * 0.88, 1.0, 0.25, 0, 0, 0, 0.2, 0.6, 0.2), gold, 0.1); }
      b.add(T.box, M(0, 2.6, 1.25, 0, 0, 0, 1.2, 0.06, 0.04), gold, 0.1); b.add(T.box, M(0, 3.9, 1.25, 0, 0, 0, 1.2, 0.06, 0.04), gold, 0.1);
      const mesh = new THREE.Mesh(b.build(), matVC); mesh.position.set(st.x, 0, st.z); mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); group.add(mesh);
      addCullable({ mesh, cx: st.x, cy: 2, cz: st.z, r: 4.6 });
    }
    else if (st.kind === 'statue') {
      const yaw = rotYOfHeading(st.face);
      placeLod(ctx, statue, st.x, st.z, 1, 'statue', { yaw });
      const h = placeLod(ctx, head, st.x, st.z, 1, 'statueHead', { yaw, y: STATUE_NECK, tree: false });
      h.fr = 0.4; R.statues.push({ x: st.x, z: st.z, yaw, head: h, look: 0, unseen: 0, turned: false, noticed: false });
    }
  }
  W.hiMake = {
    pillar0: (q) => pillarHi(0, q), pillar1: (q) => pillarHi(1, q), drum: (q) => drumHi(q), statue: (q) => statueHi(q), statueHead: (q) => statueHeadGeo(true, q),
    stump0: (q) => pillarHi(0, q, STUMP_H[0]), stump1: (q) => pillarHi(0, q, STUMP_H[1]), stump2: (q) => pillarHi(0, q, STUMP_H[2]),
  };
  // arches over the doorways (a doorway that later fills with rubble keeps its arch)
  for (const a of findArches()) {
    const H = a.jam.map(([x, y]) => R.H[idx(x, y)] || 4), geo = archGeo(a, H), mesh = new THREE.Mesh(geo, R.wallMat);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); group.add(mesh);
    const mid = (a.u0 + a.u1) / 2, off = -a.rs * 1, cx = a.xFace ? a.plane + off : mid, cz = a.xFace ? mid : a.plane + off;
    addCullable({ mesh, cx, cy: geo.userData.top / 2, cz, r: Math.hypot((a.u1 - a.u0) / 2 + 0.5, geo.userData.top / 2, 1.2), tiles: Int32Array.from(a.tiles) });
  }
  // murals and plaques: panels on their wall faces
  const facePanel = (m, w, h, y0, mat, out, uv) => {
    const f = R.faces.find((q) => q.tx === m.tx && q.ty === m.ty && q.d === m.dir); if (!f) return null;
    const geo = new THREE.PlaneGeometry(w, h), u = f.u0 + 1;
    if (uv) { const a = geo.attributes.uv; for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1])); }
    const pm = new THREE.Mesh(geo, mat);
    const x = f.xFace ? f.plane + f.nx * out : u, z = f.xFace ? u : f.plane + f.nz * out;
    pm.position.set(x, y0 + h / 2, z); pm.rotation.y = Math.atan2(f.nx, f.nz); pm.receiveShadow = true; pm.matrixAutoUpdate = false; pm.updateMatrix(); group.add(pm);
    // the slab's edge (its carved frame is in the picture itself)
    const b = new GeoBuilder(), fc = col(0x5a544a), e = 0.05;
    for (const [fx, fy, sx, sy] of [[0, h / 2 + e / 2, w + e * 2, e], [0, -h / 2 - e / 2, w + e * 2, e], [w / 2 + e / 2, 0, e, h], [-w / 2 - e / 2, 0, e, h]]) b.add(T.box, M(fx, fy, -0.04, 0, 0, 0, sx, sy, 0.1), fc, 0.06);
    const frame = new THREE.Mesh(b.build(), matVC); frame.position.copy(pm.position); frame.rotation.copy(pm.rotation); frame.castShadow = true; frame.receiveShadow = true; frame.matrixAutoUpdate = false; frame.updateMatrix(); group.add(frame);
    W.disposables.push(pm.geometry);
    const tiles = Int32Array.from([f.ti, idx(f.tx + f.nx, f.ty + f.nz)]);
    addCullable({ mesh: frame, cx: x, cy: y0 + h / 2, cz: z, r: Math.hypot(w, h) / 2 + 0.3, tiles });
    return { panel: addCullable({ mesh: pm, cx: x, cy: y0 + h / 2, cz: z, r: Math.hypot(w, h) / 2, tiles }), x, y: y0 + h / 2, z, f };
  };
  // the painted murals and the carved signs are cut straight from their reference sheet (CR49)
  const muralMat = psx(new THREE.MeshStandardMaterial({ color: 0x8c8c8c, map: panelTex('murals'), bumpMap: panelTex('murals'), bumpScale: 2.5, roughness: 0.92, metalness: 0, dithering: true })); W.disposables.push(muralMat);
  for (const m of LV.story.murals) {
    const i = Math.max(0, PANELS.order.indexOf(m.sym)), u0 = (i * 342) / 1024;
    const o = facePanel(m, 1.5, 1.9, 0.9, muralMat, 0.06, [u0, 1 - 424 / 512, u0 + 340 / 1024, 1]); if (o) R.murals.push({ ...o, sym: m.sym });
  }
  for (const m of LV.story.plaques) {
    const i = Math.max(0, PANELS.order.indexOf(m.sym)), mat = psx(new THREE.MeshStandardMaterial({ map: panelTex('plaques'), bumpMap: panelTex('plaques'), bumpScale: 3, emissiveMap: panelTex('plaquesGlow', false), emissive: 0x000000, roughness: 0.88, metalness: 0, dithering: true }));
    W.disposables.push(mat);
    const o = facePanel(m, 1.0, 1.11, 1.1, mat, 0.06, [i / 3, 0, (i + 1) / 3, 1]); if (o) R.plaques.push({ ...o, sym: m.sym, mat, hold: 0, lit: false });
  }
  // the binding circle under Sera: runes cut into the floor that glow while she is held
  if (LV.story.sera) {
    const t = canvasTex(256, (g, S) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, S, S); g.strokeStyle = '#fff'; g.lineWidth = 3; const c = S / 2;
      for (const r of [118, 100, 60]) { g.beginPath(); g.arc(c, c, r, 0, TAU); g.stroke(); }
      g.lineWidth = 2; for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; g.save(); g.translate(c + Math.cos(a) * 109, c + Math.sin(a) * 109); g.rotate(a); g.beginPath(); g.moveTo(-4, -5); g.lineTo(0, 5); g.lineTo(4, -5); if (i % 3 === 0) { g.moveTo(-4, 0); g.lineTo(4, 0); } g.stroke(); g.restore(); }
      for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU - Math.PI / 2; g.beginPath(); g.moveTo(c + Math.cos(a) * 60, c + Math.sin(a) * 60); g.lineTo(c + Math.cos(a) * 118, c + Math.sin(a) * 118); g.stroke(); }
    }, false);
    const mat = new THREE.MeshLambertMaterial({ color: 0x000000, emissive: 0x8a70d0, emissiveMap: t, emissiveIntensity: 0.9, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4), mat); m.rotation.x = -Math.PI / 2; m.position.set(LV.story.sera.x, 0.02, LV.story.sera.z); m.matrixAutoUpdate = false; m.updateMatrix(); group.add(m);
    W.disposables.push(t, mat, m.geometry); R.circle = { mesh: m, mat };
    addCullable({ mesh: m, cx: m.position.x, cy: 0, cz: m.position.z, r: 4.6, fr: 3.2 });
  }
}

// ---------------------------------------------------------------------
//  Trails: a ribbon of worn earth along each trail (level.js finds them),
//  smoothed, a little ragged at the edges, in ~20 m pieces so the beam
//  culls them like everything else. The main trail is wider and paler.
// ---------------------------------------------------------------------
function buildTrails(ctx) {
  const { group, addCullable } = ctx, village = LV.floor === 1;
  const tex = trailTexture(village); tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 4;
  const mat = psx(new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, dithering: true }));
  W.disposables.push(tex, mat);
  const MW = LV.w * TILE, mask = (W.trailMask = new Uint8Array(MW * LV.h * TILE));
  for (const tr of LV.trails) {
    let pts = tr.pts.map(([x, z]) => [x, z]);
    for (let it = 0; it < 3; it++) { const o = [pts[0]]; for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; o.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]); } o.push(pts[pts.length - 1]); pts = o; }
    // resample every 0.7 m along the curve
    const sm = [pts[0]]; let carry = 0;
    for (let i = 1; i < pts.length; i++) { const [ax, az] = sm[sm.length - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az); carry += L; if (carry >= 0.7 || i === pts.length - 1) { sm.push([bx, bz]); carry = 0; } }
    const hw0 = tr.main ? (village ? 1.25 : 1.0) : village ? 0.95 : 0.72;
    for (let c0 = 0; c0 < sm.length - 1; c0 += 28) {
      const c1 = Math.min(sm.length - 1, c0 + 28), pos = [], uv = [], index = []; let v = 0, cx = 0, cz = 0;
      for (let i = c0; i <= c1; i++) {
        const [x, z] = sm[i], [px, pz] = sm[Math.max(0, i - 1)], [nx, nz] = sm[Math.min(sm.length - 1, i + 1)], dx = nx - px, dz = nz - pz, L = Math.hypot(dx, dz) || 1;
        const hw = hw0 * (1 + 0.16 * Math.sin(i * 0.37 + tr.pts.length) + 0.08 * Math.sin(i * 1.3)), ox = (-dz / L) * hw, oz = (dx / L) * hw;
        if (i > c0) v += Math.hypot(x - sm[i - 1][0], z - sm[i - 1][1]) / 2.6;
        pos.push(x + ox, 0.016, z + oz, x - ox, 0.016, z - oz); uv.push(0, v, 1, v); cx += x; cz += z;
        for (let mz = Math.floor(z - hw); mz <= z + hw; mz++) for (let mx = Math.floor(x - hw); mx <= x + hw; mx++) if (mx >= 0 && mz >= 0 && mx < MW && Math.hypot(mx + 0.5 - x, mz + 0.5 - z) < hw * 0.85) mask[mz * MW + mx] = 1;
      }
      const n = c1 - c0 + 1; for (let k = 0; k < n - 1; k++) { const a = k * 2; index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const g = new THREE.BufferGeometry(); g.setIndex(index); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.renderOrder = 1; mesh.matrixAutoUpdate = false; group.add(mesh);
      const bs = g.boundingSphere; addCullable({ mesh, cx: bs.center.x, cy: 0, cz: bs.center.z, r: bs.radius, ground: true });
    }
  }
}
const inRectW = (r, x, z) => x >= r.x * TILE && x < (r.x + r.w) * TILE && z >= r.y * TILE && z < (r.y + r.h) * TILE;
export function onTrail(x, z) { if (!W || !W.trailMask) return false; const MW = LV.w * TILE, mx = Math.floor(x), mz = Math.floor(z); return mx >= 0 && mz >= 0 && mx < MW && !!W.trailMask[mz * MW + mx]; }

// ---------------------------------------------------------------------
//  Ash Hollow: houses on their lots, fences along every lane, the well,
//  Sev's stall, Ged's cart and field, the palisade and the eastern gate
// ---------------------------------------------------------------------
// tiles a house stands on (plus a margin), so no tree or fence grows through it
function villageLots() {
  const out = new Uint8Array(LV.w * LV.h);
  for (const h of LV.village.houses) for (let ty = Math.floor((h.z - h.d / 2) / TILE) - 1; ty <= Math.floor((h.z + h.d / 2) / TILE); ty++) for (let tx = Math.floor((h.x - h.w / 2) / TILE) - 1; tx <= Math.floor((h.x + h.w / 2) / TILE); tx++) if (inBounds(tx, ty)) out[idx(tx, ty)] = 1;
  const g = LV.village.gate; for (let ty = Math.floor(g.z0 / TILE) - 7; ty < Math.floor(g.z1 / TILE) + 7; ty++) for (let tx = Math.floor(g.x / TILE) - 1; tx <= Math.floor(g.x / TILE) + 2; tx++) if (inBounds(tx, ty)) out[idx(tx, ty)] = 1;
  return out;
}
function buildVillage(ctx) {
  const { group, addCullable } = ctx, V = LV.village;
  const add = (geo, x, z, yaw, r, cy = 1.5, cast = true) => { const m = new THREE.Mesh(geo, matVC); m.position.set(x, 0, z); m.rotation.y = yaw; m.castShadow = cast; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); group.add(m); addCullable({ mesh: m, cx: x, cy, cz: z, r }); return m; };
  // the square: cobbles
  { const t = cobbleTexture(); t.wrapS = t.wrapT = THREE.RepeatWrapping; const q = V.square, w = q.w * TILE, d = q.h * TILE; t.repeat.set(w / 3, d / 3);
    const mat = psx(new THREE.MeshLambertMaterial({ map: t, dithering: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })); W.disposables.push(t, mat);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const g = new THREE.PlaneGeometry(w / 2, d / 2); g.rotateX(-Math.PI / 2); const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, (uv.getX(k) + i) / 2, (uv.getY(k) + 1 - j) / 2);
      const m = new THREE.Mesh(g, mat), x = q.x * TILE + (w / 2) * (i + 0.5), z = q.y * TILE + (d / 2) * (j + 0.5); m.position.set(x, 0.01, z); m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); group.add(m); addCullable({ mesh: m, cx: x, cy: 0, cz: z, r: Math.hypot(w, d) / 4, ground: true }); } }
  // houses, and their lit windows (one always-drawn mesh: a warm window shows in the dark from anywhere)
  const wins = [];
  for (const h of V.houses) {
    const side = h.door >= 2, Wd = (side ? h.w : h.d) - 0.9, Dd = (side ? h.d : h.w) - 0.9, yaw = [Math.PI / 2, -Math.PI / 2, 0, Math.PI][h.door], glow = [];
    add(houseGeo(Wd, Dd, h.x * 7 + h.z, glow), h.x, h.z, yaw, Math.hypot(Wd, Dd) / 2 + 1.5, 2.5);
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (const g of glow) wins.push({ x: h.x + g.x * c + g.z * sn, y: g.y, z: h.z - g.x * sn + g.z * c, yaw, w: g.w, h: g.h });
  }
  if (wins.length) {
    const pos = [], index = [];
    for (const w of wins) { const c = Math.cos(w.yaw), sn = Math.sin(w.yaw), b = pos.length / 3; for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const lx = (u * w.w) / 2; pos.push(w.x + lx * c, w.y + (v * w.h) / 2, w.z - lx * sn); } index.push(b, b + 1, b + 2, b, b + 2, b + 3, b, b + 2, b + 1, b, b + 3, b + 2); }
    const g = new THREE.BufferGeometry(); g.setIndex(index); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xc08040, fog: false })); group.add(m); W.disposables.push(m.material);
  }
  // the well, the stall, the cart
  for (const st of LV.structures) {
    if (st.kind === 'vwell') add(shared('vwell', wellGeo), st.x, st.z, 0.3, 2.2);
    else if (st.kind === 'stall') add(shared('stall', stallGeo), st.x, st.z, Math.PI, 2.4);
    else if (st.kind === 'cart') add(shared('cart', cartGeo), st.x, st.z, 0.9, 2.4, 0.6);
  }
  // Ged's field
  { const f = V.field, w = f.w * TILE, d = f.h * TILE; add(fieldGeo(w, d), (f.x + f.w / 2) * TILE, (f.y + f.h / 2) * TILE, 0, Math.hypot(w, d) / 2, 0.3, false); }
  // fences along every lane: each edge between open ground and a tile no house stands on
  const lots = villageLots(), chunks = {};
  for (let ty = 0; ty < LV.h; ty++) for (let tx = 0; tx < LV.w; tx++) {
    if (!isWalkable(tx, ty)) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = tx + dx, ny = ty + dy; if (isWalkable(nx, ny) || (inBounds(nx, ny) && lots[idx(nx, ny)])) continue;
      const ex = (tx + 0.5 + dx * 0.5) * TILE + dx * 0.3, ez = (ty + 0.5 + dy * 0.5) * TILE + dy * 0.3, hx = dy ? TILE / 2 : 0, hz = dx ? TILE / 2 : 0;
      const key = Math.floor(ex / 16) + ',' + Math.floor(ez / 16), b = chunks[key] || (chunks[key] = new GeoBuilder());
      fencePiece(b, ex - hx - (tx === 0 ? 0 : 0), ez - hz, ex + hx, ez + hz);
    }
  }
  for (const k in chunks) { const [cx, cz] = k.split(',').map((v) => (+v + 0.5) * 16), m = new THREE.Mesh(chunks[k].build(), matVC); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); addCullable({ mesh: m, cx, cy: 0.6, cz, r: 12 }); }
  // the palisade and the eastern gate (the way out; Lyn keeps it)
  { const g = V.gate, b = new GeoBuilder(); palisade(b, g.x + 0.2, g.z0 - 12, g.z0 - 0.4); palisade(b, g.x + 0.2, g.z1 + 0.4, g.z1 + 12);
    const m = new THREE.Mesh(b.build(), matVC); m.castShadow = true; m.receiveShadow = true; group.add(m); addCullable({ mesh: m, cx: g.x, cy: 1.6, cz: (g.z0 + g.z1) / 2, r: 15 });
    add(gateGeo(g.z1 - g.z0), g.x + 0.2, (g.z0 + g.z1) / 2, 0, 6, 2); }
}

function buildCommon(ctx) {
  const { group, addCullable } = ctx;
  const ruins = LV.floor >= 4;

  // ---- braziers: iron baskets on tripods (the camp's is a ring of stones; the ruins carve theirs) ----
  const brGeo = shared('brazier', () => { const b = new GeoBuilder(), iron = col(0x2e2a26), ash = col(0x3a3430);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.283; b.limb(T.cyl4, Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45, 1.05, 0.03, -0.42, a + Math.PI / 2, iron, 0.1); }
    b.add(T.cone, M(0, 1.0, 0, Math.PI, 0, 0, 0.42, 0.32, 0.42), iron, 0.1); b.add(T.cyl10, M(0, 1.15, 0, 0, 0, 0, 0.44, 0.04, 0.44), iron, 0.1); b.add(T.ico, M(0, 1.12, 0, 0, 0, 0, 0.32, 0.1, 0.32), ash, 0.2); return b.build(); });
  const campGeo = shared('campfire', () => { const b = new GeoBuilder(), stone = col(0x5a5852), log = col(0x3a2c20);
    for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.283; b.add(T.dode, M(Math.cos(a) * 0.7, 0.1, Math.sin(a) * 0.7, rr(0, 3), rr(0, 6), 0, 0.2, 0.14, 0.2), stone, 0.15); }
    for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.283; b.add(T.cyl6, M(Math.cos(a) * 0.2, 0.2, Math.sin(a) * 0.2, 0.9, -a, 0, 0.07, 0.8, 0.07), log, 0.1); } return b.build(); });
  const stoneGeo = ruins ? shared('stoneBrazier', stoneBrazierGeo) : null;
  for (const br of LV.braziers) {
    const mesh = new THREE.Mesh(br.camp ? campGeo : ruins ? stoneGeo : brGeo, matVC); mesh.position.set(br.x, 0, br.z); mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix(); group.add(mesh);
    const fy = br.camp ? 0.45 : ruins ? 1.12 : 1.3;
    const fm = new THREE.SpriteMaterial({ map: flameTex, color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, toneMapped: false });
    const f1 = new THREE.Sprite(fm), f2 = new THREE.Sprite(fm); f1.position.set(br.x, fy, br.z); f2.position.set(br.x + 0.1, fy + 0.2, br.z - 0.05);
    const gm = new THREE.SpriteMaterial({ map: glowTex, color: 0xff8a30, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, toneMapped: false, opacity: 0.35 });
    const halo = new THREE.Sprite(gm); halo.position.set(br.x, fy, br.z); halo.scale.set(3.2, 3.2, 1);
    group.add(f1, f2, halo); W.disposables.push(fm, gm);
    const o = addCullable({ mesh, cx: br.x, cy: 0.7, cz: br.z, r: 1.2 });
    W.braziers.push({ src: br, mesh, f1, f2, halo, fy, cull: o, light: null, inView: false });
  }
  // the light pool: 3 lights, allocated now so the shader's light count never changes (Eyeshine's motel trick)
  for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xff9a48, 0, BRAZIER_R + 2, 1.6); scene.add(l); W.lights.push(l); W.pool.push(l); }
  W.flare = new THREE.PointLight(0xffe2b0, 0, 20, 1.2); W.pulse = new THREE.PointLight(0x8ab8ff, 0, 14, 1.4); scene.add(W.flare, W.pulse); W.lights.push(W.flare, W.pulse);
  // one more light that belongs to the story (Sera's glow); always allocated, so the light count is the same on every floor
  W.spirit = new THREE.PointLight(0xa8c0ff, 0, 9, 1.5); scene.add(W.spirit); W.lights.push(W.spirit);

  // ---- pickups (oil flasks, tonics), hidden caches, the way down ----
  const flaskGeo = shared('flask', () => { const b = new GeoBuilder(); b.add(T.cyl6, M(0, 0.12, 0, 0, 0, 0, 0.07, 0.2, 0.07), col(0xb07a20), 0.08); b.add(T.cyl6, M(0, 0.26, 0, 0, 0, 0, 0.025, 0.09, 0.025), col(0x9a8a6a), 0.08); b.add(T.cyl6, M(0, 0.31, 0, 0, 0, 0, 0.03, 0.03, 0.03), col(0x5a4026), 0.08); return b.build(); });
  const tonicGeo = shared('tonic', () => { const b = new GeoBuilder(); b.add(T.sphere, M(0, 0.1, 0, 0, 0, 0, 0.08, 0.09, 0.08), col(0x3c8a5a), 0.08); b.add(T.cyl6, M(0, 0.22, 0, 0, 0, 0, 0.022, 0.08, 0.022), col(0x8aa890), 0.08); b.add(T.cyl6, M(0, 0.27, 0, 0, 0, 0, 0.028, 0.025, 0.028), col(0x5a4026), 0.08); return b.build(); });
  const cacheGeo = shared('cache', () => { const b = new GeoBuilder(); b.add(T.ico, M(0, 0.12, 0, 0, 0, 0, 0.32, 0.18, 0.24), col(0x5a5040), 0.15); b.add(T.cyl6, M(0.1, 0.25, 0, 0.3, 0, 0, 0.06, 0.18, 0.06), col(0xb07a20), 0.08); b.add(T.torus, M(0, 0.16, 0, Math.PI / 2, 0, 0, 0.26, 0.26, 0.3), col(0x8a7a5a), 0.1); return b.build(); });
  W.flaskGeo = flaskGeo; W.tonicGeo = tonicGeo;
  for (const p of LV.pickups) makePickup(p);
  for (const s of LV.secrets) {
    const grp = new THREE.Group(), mesh = new THREE.Mesh(cacheGeo, matVC); mesh.castShadow = true; grp.add(mesh);
    const gm = glintMat(0xb0c8e0), glint = new THREE.Sprite(gm); glint.position.set(0.1, 0.36, 0); grp.add(glint);
    grp.position.set(s.x, 0, s.z); grp.rotation.y = rr(0, 6); grp.visible = false; group.add(grp); W.disposables.push(gm);
    W.secrets.push({ src: s, grp, mesh, glint, mat: gm, retro: 0 });
  }
  if (LV.floor === 1) {
    const e = LV.exit, mesh = new THREE.Mesh(new THREE.BufferGeometry(), matVC), hole = new THREE.Object3D();
    const gm = new THREE.SpriteMaterial({ map: glowTex, color: 0x8090a8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, toneMapped: false, opacity: 0.16 });
    const glow = new THREE.Sprite(gm); glow.position.set(e.x + 1.6, 1.8, e.z); glow.scale.set(5, 5, 1); group.add(glow, hole); W.disposables.push(gm);
    W.exit = { mesh, hole, glow, cull: null };
  } else if (ruins) {
    const e = LV.exit, mesh = new THREE.Mesh(stairGeo(), matVC); mesh.position.set(e.x, 0, e.z); mesh.receiveShadow = true; mesh.castShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); group.add(mesh);
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.8), new THREE.MeshBasicMaterial({ color: 0x000000 })); hole.rotation.x = -Math.PI / 2; hole.position.set(e.x, -2.75, e.z); group.add(hole); W.disposables.push(hole.material, hole.geometry);
    const gm = new THREE.SpriteMaterial({ map: glowTex, color: 0xb0a080, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, toneMapped: false, opacity: 0.16 });
    const glow = new THREE.Sprite(gm); glow.position.set(e.x, -1.6, e.z + 0.6); glow.scale.set(3.6, 3.6, 1); group.add(glow); W.disposables.push(gm);
    W.exit = { mesh, hole, glow, cull: addCullable({ mesh, cx: e.x, cy: -0.6, cz: e.z, r: 3.4, fr: 2.4 }) };
  } else {
    const e = LV.exit, b = new GeoBuilder(), stone = col(0x5a5852), root = col(0x3e3026);
    for (let i = 0; i < 16; i++) { const a = (i / 16) * 6.283; b.add(T.box, M(Math.cos(a) * 1.7, 0.25, Math.sin(a) * 1.7, 0, -a, 0, 0.7, 0.5, 0.45), stone, 0.14); }
    for (let i = 0; i < 9; i++) { const a = i * 0.7, y = -0.15 - i * 0.28; b.add(T.box, M(Math.cos(a) * 0.75, y, Math.sin(a) * 0.75, 0, -a, 0, 0.9, 0.12, 0.5), stone, 0.12); }
    for (let i = 0; i < 6; i++) b.limb(T.cyl6, rr(-1.6, 1.6), 0.1, rr(-1.6, 1.6), rr(1.2, 2.2), 0.09, Math.PI / 2 + rr(0.1, 0.5), rr(0, 6.28), root, 0.12);
    const mesh = new THREE.Mesh(b.build(), matVC); mesh.position.set(e.x, 0, e.z); mesh.receiveShadow = true; mesh.castShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); group.add(mesh);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(1.45, 24), new THREE.MeshBasicMaterial({ color: 0x000000 })); hole.rotation.x = -Math.PI / 2; hole.position.set(e.x, 0.02, e.z); group.add(hole); W.disposables.push(hole.material);
    const gm = new THREE.SpriteMaterial({ map: glowTex, color: 0xd8a040, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, toneMapped: false, opacity: 0.22 });
    const glow = new THREE.Sprite(gm); glow.position.set(e.x, -0.4, e.z); glow.scale.set(3.4, 3.4, 1); group.add(glow); W.disposables.push(gm);
    W.exit = { mesh, hole, glow, cull: addCullable({ mesh, cx: e.x, cy: 0, cz: e.z, r: 2.4 }) };
  }

  // ---- fireflies: a few pale green motes drifting near you (they glow on their own) ----
  // ---- in the ruins: dust hanging in the air, seen only where the beam passes through it ----
  {
    const n = ruins ? 140 : 46, B = ruins ? 7 : 16, pos = new Float32Array(n * 3), cc = new Float32Array(n * 3), seed = [];
    for (let i = 0; i < n; i++) { seed.push({ x: mr(-B, B), y: mr(0.3, ruins ? 3.2 : 2.6), z: mr(-B, B), p: mr(0, 6.28), s: mr(0.4, 1.1) }); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    const mat = new THREE.PointsMaterial({ size: ruins ? 0.03 : 0.07, map: glowTex, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; group.add(pts); W.disposables.push(mat);
    W.fireflies = { pts, seed, pos, cc, g, dust: ruins, B };
  }
}

const glintMat = (c) => new THREE.SpriteMaterial({ map: glowTex, color: c, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, toneMapped: false, opacity: 0 });
function makePickup(p) {
  const grp = new THREE.Group(), mesh = new THREE.Mesh(p.type === 'fuel' ? W.flaskGeo : W.tonicGeo, matVC); mesh.castShadow = true; grp.add(mesh);
  const gm = glintMat(p.type === 'fuel' ? 0xffd890 : 0xb8ffd0), glint = new THREE.Sprite(gm); glint.position.set(0.03, 0.16, 0); grp.add(glint);
  grp.position.set(p.x, 0, p.z); W.group.add(grp); W.disposables.push(gm);
  const o = { src: p, grp, mesh, glint, mat: gm, retro: 0, losT: 0, los: false }; W.pickups.push(o); return o;
}
// a creature dropped something: a new flask on the ground
export function spawnPickup(type, x, z) { const p = { type, x, z, collected: false, bob: rr(0, 6.28) }; LV.pickups.push(p); makePickup(p); }

// (re)build the hi-poly variants + ground cover for the chosen detail level
export function ensureDetail() {
  if (!W) return;
  const q = DETAIL[settings.detail].q;
  if (W.hiQ === q) return;
  for (const o of W.cullables) if (o.lo) { o.mesh.geometry = o.lo; o.mesh.castShadow = true; }
  for (const k in W.hi) if (!W.hi[k].userData.shared) W.hi[k].dispose();
  W.hi = {};
  if (W.cover) { for (const m of W.cover.meshes) { W.group.remove(m); m.geometry.dispose(); m.dispose(); } W.cover = null; }
  for (const p of W.proxies) { W.group.remove(p); } W.proxies = [];
  W.hiQ = q;
  ensureBlocks(W, q, W.group);
  if (q === 0) return;
  const t0 = performance.now();
  srand(LV.seed + q * 101);
  for (const k in W.hiMake) W.hi[k] = W.hiMake[k](q);
  W.cover = buildCover(q);
  // shadow proxies: a pool of low-poly twins that only exist in the shadow pass (layer 1)
  for (let i = 0; i < 160; i++) { const p = new THREE.Mesh(undefined, matVC); p.layers.set(1); p.castShadow = true; p.visible = false; p.matrixAutoUpdate = false; W.group.add(p); W.proxies.push(p); }
  W.detailBuildMs = performance.now() - t0;
}

function buildCover(q) {
  const ruins = LV.floor >= 4, vars = ruins ? ruinCoverVariants(q) : coverVariants(q), S = ruins ? RUIN_COVER_CELL : COVER_CELL, N = Math.ceil((LV.w * TILE) / S), Nz = Math.ceil((LV.h * TILE) / S);
  const cx = new Float32Array(N * Nz), cz = new Float32Array(N * Nz), rot = new Float32Array(N * Nz), scl = new Float32Array(N * Nz), vr = new Int8Array(N * Nz).fill(-1);
  const wsum = vars.reduce((a, v) => a + v.w, 0);
  for (let j = 0; j < Nz; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = (i + 0.5) * S + rr(-0.3, 0.3) * S, z = (j + 0.5) * S + rr(-0.3, 0.3) * S;
    const tx = Math.floor(x / TILE), ty = Math.floor(z / TILE); if (!inBounds(tx, ty) || LV.depth[idx(tx, ty)] > 1) continue;
    if (Math.hypot(x - LV.exit.x, z - LV.exit.z) < (ruins ? 3.3 : 2.2)) continue;
    if (!ruins && onTrail(x, z) && rnd() < 0.92) continue;
    if (LV.village && (inRectW(LV.village.square, x, z) || LV.structures.some((st) => Math.hypot(st.x - x, st.z - z) < st.r + 0.5))) continue;
    let v = 0;
    if (ruins) {
      // stone collects against the walls; the open floor is mostly bare
      if (!isWalkable(tx, ty)) continue;
      let near = false; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isWalkable(tx + dx, ty + dy)) near = true;
      if (rnd() > (near ? 0.85 : 0.4)) continue;
      if (LV.structures.some((st) => Math.hypot(st.x - x, st.z - z) < st.r + 0.45)) continue;
      if (LV.story && LV.story.sera && Math.hypot(LV.story.sera.x - x, LV.story.sera.z - z) < 3.4) continue;
      const ws = vars.map((vv) => vv.w + (near ? vv.near : 0)), tot = ws.reduce((a, b) => a + b, 0); let r = rnd() * tot; while (v < vars.length - 1 && r > ws[v]) { r -= ws[v]; v++; }
    } else { let r = rnd() * wsum; while (v < vars.length - 1 && r > vars[v].w) { r -= vars[v].w; v++; } }
    cx[k] = x; cz[k] = z; rot[k] = rr(0, 6.283); scl[k] = rr(0.85, 1.2); vr[k] = v;
  }
  const meshes = vars.map((v) => {
    const m = new THREE.InstancedMesh(v.g, matFoliage, 1400);
    m.frustumCulled = false; m.receiveShadow = true; m.castShadow = false; m.count = 0; m.visible = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); W.group.add(m); return m;
  });
  return { N, Nz, S, cx, cz, rot, scl, vr, meshes };
}

// =====================================================================
//  Lights that aren't the lantern: brazier pool, flare, pulse
// =====================================================================
export const FX = { flareR: 0, flareX: 0, flareZ: 0, flareK: 0, pulseR: 0, pulseX: 0, pulseZ: 0, pulseK: 0 };
const _proj = new THREE.Vector3(), _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();
export function updateWorldLights(dt, t) {
  _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frustum.setFromProjectionMatrix(_pm);
  const cam = camera.position, cand = [];
  for (const b of W.braziers) {
    const lit = b.src.lit; b.f1.visible = b.f2.visible = b.halo.visible = lit; b.light = null; b.inView = false;
    if (!lit) continue;
    const d = Math.hypot(b.src.x - cam.x, b.src.z - cam.z); b.dist = d;
    _sph.center.set(b.src.x, 1, b.src.z); _sph.radius = BRAZIER_R;
    b.inView = d < 60 && _frustum.intersectsSphere(_sph);
    // the flame is drawn through the dark from anywhere you can see it from
    const see = d < 70 && lineOfSight(cam.x, cam.z, b.src.x, b.src.z);
    b.f1.visible = b.f2.visible = b.halo.visible = see || d < 6;
    const fl = 1 + 0.12 * Math.sin(t * 7 + b.src.flicker) + 0.08 * Math.sin(t * 13.1 + b.src.flicker * 2);
    const s0 = b.src.camp ? 1.1 : 0.85;
    b.f1.scale.set(s0 * 0.7 * fl, s0 * 1.1 * fl, 1); b.f2.scale.set(s0 * 0.45, s0 * 0.75 * (2 - fl), 1);
    b.halo.material.opacity = (0.28 + 0.06 * Math.sin(t * 9 + b.src.flicker)) * (b.src.camp ? 1.3 : 1);
    b.fl = fl;
    if (d < 45) cand.push(b);
  }
  cand.sort((a, b) => (b.inView - a.inView) || a.dist - b.dist);
  W.pool.forEach((l, i) => {
    const b = cand[i], f = ash.uFire.value[i];
    if (!b) { l.intensity = 0; f.set(0, -99, 0, 0); return; }
    b.light = l; l.position.set(b.src.x, b.fy + 0.3, b.src.z); l.intensity = (b.src.camp ? 20 : 15) * b.fl; l.distance = BRAZIER_R + 2;
    f.set(b.src.x, 0.8, b.src.z, (BRAZIER_R + 1) * Math.min(1, b.fl + 0.2)); // colour comes back around a fire too
  });
  W.flare.intensity = FX.flareK > 0 ? 90 * FX.flareK : 0; W.flare.distance = Math.max(4, FX.flareR * 1.35); W.flare.position.set(FX.flareX, 2.2, FX.flareZ);
  W.pulse.intensity = FX.pulseK > 0 ? 30 * FX.pulseK : 0; W.pulse.distance = Math.max(3, FX.pulseR * 1.3); W.pulse.position.set(FX.pulseX, 1.2, FX.pulseZ);
}
// how lit a ground point is by braziers + flare/pulse (the lantern is lantern.js's job)
export function worldLevel(x, z) {
  let lv = 0;
  for (const b of W.braziers) { if (!b.src.lit) continue; const d = Math.hypot(x - b.src.x, z - b.src.z); if (d < BRAZIER_R) lv = Math.max(lv, 0.46 * (1 - d / BRAZIER_R)); }
  if (FX.flareK > 0) { const d = Math.hypot(x - FX.flareX, z - FX.flareZ); if (d < FX.flareR) lv = Math.max(lv, 1.12 * (1 - d / Math.max(1, FX.flareR)) * FX.flareK + 0.3); }
  return lv;
}

// =====================================================================
//  THE TRICK: draw only what light touches
// =====================================================================
// Is this bounding sphere lit by anything: the beam, the spill, a lit brazier in the pool, a flare?
export function litTest(cx, cy, cz, r) {
  if (inBeam(cx, cy, cz, r)) return true;
  if (FX.flareK > 0.02 && Math.hypot(cx - FX.flareX, cz - FX.flareZ) < FX.flareR + r) return true;
  if (FX.pulseK > 0.02 && Math.hypot(cx - FX.pulseX, cz - FX.pulseZ) < FX.pulseR + r) return true;
  for (let i = 0; i < W.pool.length; i++) {
    const l = W.pool[i]; if (l.intensity <= 0) continue;
    const dx = cx - l.position.x, dz = cz - l.position.z; if (dx * dx + dz * dz < (BRAZIER_R + r) ** 2) return true;
  }
  if (W.spirit && W.spirit.intensity > 0) { const dx = cx - W.spirit.position.x, dz = cz - W.spirit.position.z; if (dx * dx + dz * dz < (8 + r) ** 2) return true; }
  return false;
}
// trunks standing between you and a fire you can see are drawn as silhouettes
function silhouette(o) {
  const cam = camera.position;
  for (const b of W.braziers) {
    if (!b.light || !b.inView) continue;
    const vx = b.src.x - cam.x, vz = b.src.z - cam.z, L2 = vx * vx + vz * vz, t = ((o.cx - cam.x) * vx + (o.cz - cam.z) * vz) / L2;
    if (t <= 0 || t >= 1) continue;
    const px = cam.x + vx * t - o.cx, pz = cam.z + vz * t - o.cz; if (px * px + pz * pz < (o.r * 0.5 + 0.6) ** 2) return true;
  }
  return false;
}
export function updateCulling() {
  const cam = camera.position, D = DETAIL[settings.detail], useHi = D.q > 0 && W.hiQ === D.q, lod2 = D.lod * D.lod, ffLod2 = (D.ffLod || D.lod) ** 2;
  const R = W.ruins, occl = !!R && settings.culling;
  if (R) computeSeen(R);
  for (const o of W.shown) o.mesh.visible = false;
  W.shown.length = 0;
  const test = (o) => {
    if (o.ys) { for (let i = 0; i < o.ys.length; i++) if (litTest(o.cx, o.ys[i], o.cz, o.sr)) return true; return false; }
    return litTest(o.cx, o.cy, o.cz, o.r);
  };
  let list;
  if (!settings.culling) list = W.cullables;
  else {
    // only look at grid cells something could light: around you out to the beam's reach,
    // around each pooled brazier light, around a flare
    const R = Math.max(lantern.distance + 8, FX.flareK > 0 ? FX.flareR + 4 : 0, NEAR_R + 4);
    const cells = new Set(), addBox = (x, z, r) => {
      const x0 = clamp(Math.floor((x - r) / CELL), 0, W.gw - 1), x1 = clamp(Math.floor((x + r) / CELL), 0, W.gw - 1);
      const z0 = clamp(Math.floor((z - r) / CELL), 0, W.gh - 1), z1 = clamp(Math.floor((z + r) / CELL), 0, W.gh - 1);
      for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) cells.add(j * W.gw + i);
    };
    addBox(cam.x, cam.z, R);
    for (const l of W.pool) if (l.intensity > 0) addBox(l.position.x, l.position.z, BRAZIER_R + 4);
    if (FX.pulseK > 0) addBox(FX.pulseX, FX.pulseZ, FX.pulseR + 4);
    list = []; for (const c of cells) for (const o of W.grid[c]) list.push(o);
  }
  let n = 0, hiN = 0;
  W.occluded = 0;
  for (const o of list) {
    if (o.dead) continue;
    if (occl && o.tiles && !anySeen(R, o.tiles)) { W.occluded++; continue; } // behind a wall: never drawn, however bright
    const v = !settings.culling || test(o) || (o.tree && silhouette(o));
    if (!v) continue;
    o.mesh.visible = true; W.shown.push(o); n++;
    if (o.lo) { // level of detail: hi-poly only when it is visible AND close
      let hi = false;
      if (useHi && o.hiKey) { const dx = o.cx - cam.x, dz = o.cz - cam.z; hi = dx * dx + dz * dz < (o.ff ? ffLod2 : lod2); }   // the pack's near trees are heavy: a shorter reach
      const g = hi ? W.hi[o.hiKey] || o.lo : o.lo;
      if (o.mesh.geometry !== g) o.mesh.geometry = g;
      const prox = hi && settings.proxies && hiN < W.proxies.length;
      o.mesh.castShadow = !prox;
      if (prox) { const p = W.proxies[hiN++]; p.geometry = o.lo; p.matrix.copy(o.mesh.matrix); p.matrixWorldNeedsUpdate = true; p.visible = true; }
    }
  }
  for (let i = hiN; i < W.proxies.length; i++) W.proxies[i].visible = false;
  for (const b of W.braziers) if (b.f1.visible && !b.mesh.visible) { b.mesh.visible = true; W.shown.push(b.cull); n++; } // a burning brazier always shows its iron
  W.drawn = n;
  if (R) updateBlocks(W, D.blocks, litTest);
}
// is a point in a tile the camera can see this frame? (always true outside the ruins, or with culling off)
export function seenPoint(x, z, r = 0) { return !W.ruins || !settings.culling || seenAt(W.ruins, x, z, r); }
export function ruinsTick(dt, px, pz, say) { if (W.ruins) updateStatues(W.ruins, dt, px, pz, say); }
export function collapseTiles(tiles) { if (W.ruins) rebuildWalls(W.ctx, tiles); }

// ground cover: instance list rebuilt every frame from the cells the beam touches
export function updateCover() {
  const cv = W.cover; if (!cv) { W.coverDrawn = 0; return; }
  const D = DETAIL[settings.detail], R = D.cover, cam = camera.position, counts = cv.meshes.map(() => 0), rc = cv.S * 0.8, cap = 1400;
  if (R > 0) {
    const i0 = Math.max(0, Math.floor((cam.x - R) / cv.S)), i1 = Math.min(cv.N - 1, Math.floor((cam.x + R) / cv.S));
    const j0 = Math.max(0, Math.floor((cam.z - R) / cv.S)), j1 = Math.min(cv.Nz - 1, Math.floor((cam.z + R) / cv.S));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * cv.N + i, v = cv.vr[k]; if (v < 0) continue;
      const x = cv.cx[k], z = cv.cz[k], dx = x - cam.x, dz = z - cam.z; if (dx * dx + dz * dz > R * R) continue;
      if (settings.culling && !litTest(x, 0.2, z, rc)) continue;
      if (W.ruins && settings.culling && !seenAt(W.ruins, x, z, 0)) continue;
      if (counts[v] >= cap) continue;
      const a = cv.meshes[v].instanceMatrix.array, o = counts[v]++ * 16, sc = cv.scl[k], c = Math.cos(cv.rot[k]) * sc, sn = Math.sin(cv.rot[k]) * sc;
      a[o] = c; a[o + 1] = 0; a[o + 2] = -sn; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = sc; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = sn; a[o + 9] = 0; a[o + 10] = c; a[o + 11] = 0; a[o + 12] = x; a[o + 13] = 0; a[o + 14] = z; a[o + 15] = 1;
    }
  }
  W.coverDrawn = 0;
  cv.meshes.forEach((m, v) => {
    m.count = counts[v]; m.visible = counts[v] > 0; W.coverDrawn += counts[v];
    if (counts[v]) { m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, counts[v] * 16); m.instanceMatrix.needsUpdate = true; }
  });
}

export function updateFireflies(dt, t, danger) {
  const F = W.fireflies, cam = camera.position;
  if (F.dust) { // dust motes: drift, and shine only inside the beam
    const B = F.B, L = 2 * B;
    for (let i = 0; i < F.seed.length; i++) {
      const s = F.seed[i];
      s.x += Math.sin(t * 0.13 * s.s + s.p) * dt * 0.06; s.z += Math.cos(t * 0.11 * s.s + s.p * 1.3) * dt * 0.06; s.y += Math.sin(t * 0.2 + s.p) * dt * 0.03 - dt * 0.01;
      if (s.y < 0.2) s.y += 3;
      const x = cam.x + ((((s.x - cam.x) % L) + L * 1.5) % L) - B, z = cam.z + ((((s.z - cam.z) % L) + L * 1.5) % L) - B; s.x = x; s.z = z;
      F.pos[i * 3] = x; F.pos[i * 3 + 1] = s.y; F.pos[i * 3 + 2] = z;
      const r = beamAt(x, s.y, z), k = lantern.k > 0.02 && r.ang < lantern.angle && r.d < lantern.distance ? Math.pow(1 - r.ang / lantern.angle, 0.6) * (1 - r.d / lantern.distance) * lantern.k * (0.6 + 0.4 * Math.sin(t * 2 + s.p * 5)) : 0;
      F.cc[i * 3] = 0.85 * k; F.cc[i * 3 + 1] = 0.78 * k; F.cc[i * 3 + 2] = 0.66 * k;
    }
    F.g.attributes.position.needsUpdate = true; F.g.attributes.color.needsUpdate = true; return;
  }
  for (let i = 0; i < F.seed.length; i++) {
    const s = F.seed[i];
    s.x += Math.sin(t * 0.3 * s.s + s.p) * dt * 0.4; s.z += Math.cos(t * 0.27 * s.s + s.p * 1.3) * dt * 0.4; s.y += Math.sin(t * 0.5 + s.p) * dt * 0.12;
    // wrap around the camera so there are always a few nearby
    let x = cam.x + ((((s.x - cam.x) % 32) + 48) % 32) - 16, z = cam.z + ((((s.z - cam.z) % 32) + 48) % 32) - 16;
    s.x = x; s.z = z;
    F.pos[i * 3] = x; F.pos[i * 3 + 1] = s.y; F.pos[i * 3 + 2] = z;
    const tx = Math.floor(x / TILE), ty = Math.floor(z / TILE), deep = inBounds(tx, ty) ? LV.depth[idx(tx, ty)] : 9;
    // they blink slowly, keep out of the deep thicket, and go dark when something hunts close by
    const k = Math.max(0, Math.sin(t * 1.3 * s.s + s.p * 3)) ** 3 * (deep > 2 ? 0 : 1) * (1 - danger);
    F.cc[i * 3] = 0.55 * k; F.cc[i * 3 + 1] = 0.85 * k; F.cc[i * 3 + 2] = 0.3 * k;
  }
  F.g.attributes.position.needsUpdate = true; F.g.attributes.color.needsUpdate = true;
}
