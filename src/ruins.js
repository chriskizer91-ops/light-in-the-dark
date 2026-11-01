import { THREE, camera, renderer, canvasTex, matVC, psx, GeoBuilder, T, M, col, rnd, rr, clamp, lerp, nz3, settings, TAU } from './engine.js';
import { LV, TILE, idx, inBounds, tileAt, isWalkable, toTile } from './level.js';

// =====================================================================
//  THE EASTERN RUINS — stone halls built from the tile grid.
//  Walls are real here, which brings back Eyeshine's motel trick: before
//  anything is tested against the beam it has to pass a visibility test,
//  ~160 rays cast across the view through the tile grid. A room behind a
//  wall is never drawn, however bright it is.
//  Walls come in two levels of detail: a textured face (always), and in
//  front of it, close up and in the beam, the individual carved blocks.
// =====================================================================
export const COURSE = 0.5;                 // one course of stone (m); a block is 1 m x 0.5 m
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // face direction: from the wall tile to the floor tile
const CELL = 8;
export function hsh(a, b, c, d = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177) ^ Math.imul(d | 0, 1103515245);
  h = Math.imul(h ^ (h >>> 15), 2246822519); h = Math.imul(h ^ (h >>> 13), 3266489917); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------- textures (painted on canvases, aligned with the real blocks) ----------
function wallTexture() {
  const t = canvasTex(512, (g, S) => {
    const bw = 256, bh = 128, R = (a, b) => a + (b - a) * Math.random();
    g.fillStyle = '#1b1815'; g.fillRect(0, 0, S, S);
    for (let row = 0; row < 4; row++) {
      const y = S - (row + 1) * bh, off = row % 2 ? 128 : 0;
      for (let k = -1; k < 2; k++) {
        const x = k * bw + off, tone = R(58, 84), cr = Math.round(tone), cg = Math.round(tone * 0.94), cb = Math.round(tone * 0.86);
        for (const wx of [x, x + S]) {
          if (wx > S || wx + bw < 0) continue;
          g.fillStyle = `rgb(${cr},${cg},${cb})`; g.fillRect(wx + 5, y + 5, bw - 10, bh - 10);
          g.fillStyle = 'rgba(255,240,220,.08)'; g.fillRect(wx + 5, y + 5, bw - 10, 3);
          g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(wx + 5, y + bh - 9, bw - 10, 4);
        }
      }
    }
    // pitting and grain over everything (mortar included), then chips and cracks
    for (let i = 0; i < 26000; i++) { const v = Math.random() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},${R(0.03, 0.09)})`; g.fillRect(Math.random() * S, Math.random() * S, R(1, 3), R(1, 2)); }
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(20,16,12,${R(0.3, 0.6)})`; g.beginPath(); const x = Math.random() * S, y = Math.random() * S; g.moveTo(x, y); for (let k = 0; k < 4; k++) g.lineTo(x + R(-9, 9), y + R(-6, 6)); g.fill(); }
    g.strokeStyle = 'rgba(14,11,9,.55)'; g.lineWidth = 1.2;
    for (let i = 0; i < 18; i++) { let x = Math.random() * S, y = Math.random() * S; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += R(-10, 10); y += R(2, 12); g.lineTo(x, y); } g.stroke(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return t;
}
function floorTexture() {
  const t = canvasTex(512, (g, S) => {
    const R = (a, b) => a + (b - a) * Math.random(), u = S / 4;
    g.fillStyle = '#16130f'; g.fillRect(0, 0, S, S);
    // irregular flagstones: a 4x4 grid of 1 m slabs, some merged into long slabs
    const used = new Set();
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      if (used.has(i + ',' + j)) continue;
      let w = 1, h = 1; if (i < 3 && !used.has(i + 1 + ',' + j) && Math.random() < 0.35) w = 2; else if (j < 3 && Math.random() < 0.3) h = 2;
      for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) used.add(i + a + ',' + (j + b));
      const tone = R(42, 64), x = i * u, y = j * u;
      g.fillStyle = `rgb(${Math.round(tone)},${Math.round(tone * 0.95)},${Math.round(tone * 0.88)})`;
      g.beginPath(); const jt = () => R(-4, 4);
      g.moveTo(x + 4 + jt(), y + 4 + jt()); g.lineTo(x + w * u - 4 + jt(), y + 4 + jt()); g.lineTo(x + w * u - 4 + jt(), y + h * u - 4 + jt()); g.lineTo(x + 4 + jt(), y + h * u - 4 + jt()); g.closePath(); g.fill();
    }
    for (let i = 0; i < 30000; i++) { const v = Math.random() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},${R(0.03, 0.08)})`; g.fillRect(Math.random() * S, Math.random() * S, R(1, 3), R(1, 3)); }
    for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(30,24,16,${R(0.12, 0.3)})`; g.beginPath(); g.arc(Math.random() * S, Math.random() * S, R(10, 46), 0, TAU); g.fill(); }
    g.strokeStyle = 'rgba(10,8,6,.6)'; g.lineWidth = 1.4;
    for (let i = 0; i < 14; i++) { let x = Math.random() * S, y = Math.random() * S; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += R(-14, 14); y += R(-14, 14); g.lineTo(x, y); } g.stroke(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return t;
}

// ---------- a geometry builder with uvs + colours (for walls, floors, arches) ----------
// sign of (b-a) x (c-a) . n: negative means the triangle would face away from its normal
const wind = (a, b, c, n) => { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; return (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2]; };
class QB {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; }
  // a quad a-b-c-d (counter-clockwise seen from the front), normal given, per-vertex uv + colour
  quad(a, b, c, d, n, ua, ub, uc, ud, ca, cb, cc, cd) {
    if (wind(a, b, c, n) < 0) { [b, d] = [d, b]; [ub, ud] = [ud, ub]; [cb, cd] = [cd, cb]; }
    const P = [a, b, c, a, c, d], U = [ua, ub, uc, ua, uc, ud], C = [ca, cb, cc, ca, cc, cd];
    for (let i = 0; i < 6; i++) { this.p.push(P[i][0], P[i][1], P[i][2]); this.n.push(n[0], n[1], n[2]); this.u.push(U[i][0], U[i][1]); this.c.push(C[i][0], C[i][1], C[i][2]); }
  }
  tri(a, b, c, n, ua, ub, uc, ca, cb, cc) {
    if (wind(a, b, c, n) < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; [cb, cc] = [cc, cb]; }
    for (const [P, U, C] of [[a, ua, ca], [b, ub, cb], [c, uc, cc]]) { this.p.push(P[0], P[1], P[2]); this.n.push(n[0], n[1], n[2]); this.u.push(U[0], U[1]); this.c.push(C[0], C[1], C[2]); }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere(); return g;
  }
}
// smooth vertex-coloured builder for carved pieces (pillars, statues)
export class SB {
  constructor() { this.p = []; this.n = []; this.c = []; }
  add(geo, color, o = {}) {
    let g = geo.clone();
    if (o.flat) { if (g.index) g = g.toNonIndexed(); if (o.matrix) g.applyMatrix4(o.matrix); g.computeVertexNormals(); }
    else { if (!o.keepNormals) g.computeVertexNormals(); if (o.matrix) g.applyMatrix4(o.matrix); if (g.index) g = g.toNonIndexed(); }
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i);
      this.p.push(x, y, z); this.n.push(nx, ny, nz);
      const c = typeof color === 'function' ? color(x, y, z, nx, ny, nz) : color;
      if (c.isColor) this.c.push(c.r, c.g, c.b); else this.c.push(c[0], c[1], c[2]);
    }
    g.dispose(); return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
  }
}

// =====================================================================
//  Wall heights and faces
// =====================================================================
function wallHeights() {
  const w = LV.w, h = LV.h, H = new Float32Array(w * h);
  const edge = (x, y) => tileAt(x, y) === 0 && inBounds(x, y) && DIRS.some(([dx, dy]) => isWalkable(x + dx, y + dy));
  const edges = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (edge(x, y)) { H[idx(x, y)] = COURSE * Math.round(rr(7.4, 11.2)); edges.push([x, y]); }
  // collapsed stretches: the wall has come down to a little above head height (never low enough to see over)
  for (let k = 0; k < 18 && edges.length; k++) {
    const [cx, cy] = edges[(rnd() * edges.length) | 0], r = rr(1, 2.4), low = COURSE * Math.round(rr(5, 6.4));
    for (const [x, y] of edges) if (Math.hypot(x - cx, y - cy) <= r) H[idx(x, y)] = Math.min(H[idx(x, y)], low + COURSE * Math.round(Math.hypot(x - cx, y - cy)));
  }
  return H;
}
// each face: the boundary between a wall tile and the floor tile next to it
function buildFaces(H) {
  const faces = [];
  for (let ty = 0; ty < LV.h; ty++) for (let tx = 0; tx < LV.w; tx++) {
    const hh = H[idx(tx, ty)]; if (!hh) continue;
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d]; if (!isWalkable(tx + dx, ty + dy)) continue;
      const xFace = d < 2, plane = xFace ? (tx + (d === 0 ? 1 : 0)) * TILE : (ty + (d === 2 ? 1 : 0)) * TILE, u0 = xFace ? ty * TILE : tx * TILE;
      // does the same wall line carry on either side (so blocks may run across)? is there an inside corner?
      const ax = xFace ? 0 : 1, ay = xFace ? 1 : 0;
      const sameL = tileAt(tx - ax, ty - ay) === 0 && isWalkable(tx - ax + dx, ty - ay + dy), sameR = tileAt(tx + ax, ty + ay) === 0 && isWalkable(tx + ax + dx, ty + ay + dy);
      const cornL = !isWalkable(tx + dx - ax, ty + dy - ay), cornR = !isWalkable(tx + dx + ax, ty + dy + ay);
      faces.push({ tx, ty, d, nx: dx, nz: dy, plane, u0, xFace, H: hh, contL: sameL, contR: sameR, cornL, cornR, deco: false, rubble: false, i: faces.length, ti: idx(tx, ty) });
    }
  }
  return faces;
}
// world position of (u along the face, y) on a face's plane, pushed out by `out`
function facePoint(f, u, y, out = 0) { return f.xFace ? [f.plane + f.nx * out, y, u] : [u, y, f.plane + f.nz * out]; }
const topJag = (u, plane, d) => (hsh(Math.round(u * 2), Math.round(plane), d, 7) - 0.5) * 0.36;

function wallCellGeo(faces, H) {
  const b = new QB(), tint = (f) => 0.82 + 0.3 * hsh(f.tx, f.ty, f.d, 3);
  for (const f of faces) {
    const n = [f.nx, 0, f.nz], k = tint(f), moss = hsh(f.tx, f.ty, 11) < 0.25;
    // the quad's winding has to face out of the wall: for +x and -z faces u runs one way, for -x and +z the other
    const flip = f.d === 0 || f.d === 3;
    for (let c = 0; c < 4; c++) {
      let ua = f.u0 + c * 0.5, ub = ua + 0.5; if (flip) { const t = ua; ua = ub; ub = t; }
      const ha = f.H + topJag(ua, f.plane, f.d), hb = f.H + topJag(ub, f.plane, f.d);
      const ao = (u) => ((f.cornL && Math.abs(u - f.u0) < 0.01) || (f.cornR && Math.abs(u - f.u0 - TILE) < 0.01) ? 0.62 : 1);
      const base = (u) => { const a = ao(u) * k; return moss ? [0.34 * a, 0.42 * a, 0.3 * a] : [0.45 * a, 0.42 * a, 0.4 * a]; };
      const mid = (u) => { const a = ao(u) * k; return [a, a * 0.98, a * 0.95]; };
      const top = (u) => { const a = ao(u) * k * 1.06; return [a, a, a * 0.96]; };
      // two rows: a damp dark base, then up to the jagged top
      const p0a = facePoint(f, ua, 0), p0b = facePoint(f, ub, 0), p1a = facePoint(f, ua, 0.6), p1b = facePoint(f, ub, 0.6), p2a = facePoint(f, ua, ha), p2b = facePoint(f, ub, hb);
      const U = (u, y) => [u / TILE, y / TILE];
      b.quad(p0a, p0b, p1b, p1a, n, U(ua, 0), U(ub, 0), U(ub, 0.6), U(ua, 0.6), base(ua), base(ub), mid(ub), mid(ua));
      b.quad(p1a, p1b, p2b, p2a, n, U(ua, 0.6), U(ub, 0.6), U(ub, hb), U(ua, ha), mid(ua), mid(ub), top(ub), top(ua));
    }
  }
  return b;
}
// steps where a tall stretch of wall meets a lower one
function stepFaces(b, tiles, H) {
  for (const ti of tiles) {
    const tx = ti % LV.w, ty = (ti / LV.w) | 0, hA = H[ti];
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d], nb = inBounds(tx + dx, ty + dy) ? H[idx(tx + dx, ty + dy)] : 0; if (!nb || nb >= hA - 0.01) continue;
      const xF = d < 2, plane = xF ? (tx + (d === 0 ? 1 : 0)) * TILE : (ty + (d === 2 ? 1 : 0)) * TILE, u0 = xF ? ty * TILE : tx * TILE, u1 = u0 + TILE;
      const P = (u, y) => (xF ? [plane, y, u] : [u, y, plane]), n = [dx, 0, dy], cc = [0.8, 0.78, 0.74];
      const [ua, ub] = d === 0 || d === 3 ? [u1, u0] : [u0, u1];
      b.quad(P(ua, nb), P(ub, nb), P(ub, hA), P(ua, hA), n, [ua / 2, nb / 2], [ub / 2, nb / 2], [ub / 2, hA / 2], [ua / 2, hA / 2], cc, cc, cc, cc);
    }
  }
}
// floor: one quad per walkable tile, darker where walls crowd a corner
function floorCellGeo(cx0, cz0) {
  const b = new QB(), t0x = cx0 / TILE, t0y = cz0 / TILE, n = [0, 1, 0];
  const ao = (vx, vy) => { let k = 0; for (const [ox, oy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) if (!isWalkable(vx + ox, vy + oy)) k++; return 1 - 0.2 * k; };
  for (let ty = t0y; ty < t0y + CELL / TILE; ty++) for (let tx = t0x; tx < t0x + CELL / TILE; tx++) {
    if (!isWalkable(tx, ty) || LV.holeTiles.includes(idx(tx, ty))) continue;
    const x0 = tx * TILE, z0 = ty * TILE, x1 = x0 + TILE, z1 = z0 + TILE, tk = 0.9 + 0.2 * hsh(tx, ty, 5);
    const C = (vx, vy) => { const a = ao(vx, vy) * tk; return [a, a, a]; };
    b.quad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], n, [x0 / 4, -z1 / 4], [x1 / 4, -z1 / 4], [x1 / 4, -z0 / 4], [x0 / 4, -z0 / 4], C(tx, ty + 1), C(tx + 1, ty + 1), C(tx + 1, ty), C(tx, ty));
  }
  return b;
}

// =====================================================================
//  Build: walls + floors as per-cell cullables, then the carved pieces
// =====================================================================
export function buildRuins(ctx) {
  const { group, addCullable, W } = ctx;
  const R = (W.ruins = { H: null, faces: [], cells: [], wallMat: null, floorMat: null, blocks: null, statues: [], arches: [], murals: [], plaques: [], seen: new Uint32Array(LV.w * LV.h), stamp: 1, faceList: [] });
  const wTex = wallTexture(), fTex = floorTexture();
  R.wallMat = psx(new THREE.MeshLambertMaterial({ map: wTex, vertexColors: true, dithering: true }));
  R.floorMat = psx(new THREE.MeshLambertMaterial({ map: fTex, vertexColors: true, dithering: true }));
  W.disposables.push(wTex, fTex, R.wallMat, R.floorMat);
  R.H = wallHeights();
  // murals and plaques sit on wall faces: those faces carry no loose blocks
  R.faces = buildFaces(R.H);
  const faceAt = (tx, ty, d) => R.faces.find((f) => f.tx === tx && f.ty === ty && f.d === d);
  for (const m of (LV.story && LV.story.murals) || []) { const f = faceAt(m.tx, m.ty, m.dir); if (f) f.deco = true; }
  for (const m of (LV.story && LV.story.plaques) || []) { const f = faceAt(m.tx, m.ty, m.dir); if (f) f.deco = true; }
  buildWallCells(ctx);
  // floors
  const gw = Math.ceil((LV.w * TILE) / CELL), gh = Math.ceil((LV.h * TILE) / CELL);
  for (let cz = 0; cz < gh; cz++) for (let cx = 0; cx < gw; cx++) {
    const b = floorCellGeo(cx * CELL, cz * CELL); if (!b.p.length) continue;
    const tiles = []; for (let ty = cz * 4; ty < cz * 4 + 4; ty++) for (let tx = cx * 4; tx < cx * 4 + 4; tx++) if (isWalkable(tx, ty)) tiles.push(idx(tx, ty));
    const mesh = new THREE.Mesh(b.build(), R.floorMat); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); group.add(mesh);
    addCullable({ mesh, cx: cx * CELL + 4, cy: 0, cz: cz * CELL + 4, r: 5.7, ground: true, tiles: Int32Array.from(tiles) });
  }
  return R;
}
// (re)build the per-cell wall meshes from the faces (also after a collapse)
export function buildWallCells(ctx) {
  const { group, addCullable, W } = ctx, R = W.ruins;
  for (const c of R.cells) { group.remove(c.mesh); c.mesh.geometry.dispose(); c.dead = true; }
  R.cells = [];
  const byCell = new Map();
  for (const f of R.faces) { const k = Math.floor((f.tx * TILE) / CELL) + ',' + Math.floor((f.ty * TILE) / CELL); if (!byCell.has(k)) byCell.set(k, []); byCell.get(k).push(f); }
  for (const [k, faces] of byCell) {
    const [cx, cz] = k.split(',').map(Number), b = wallCellGeo(faces, R.H);
    const tiles = [...new Set(faces.map((f) => f.ti))];
    stepFaces(b, tiles, R.H);
    const mesh = new THREE.Mesh(b.build(), R.wallMat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); group.add(mesh);
    let hMax = 0; for (const f of faces) hMax = Math.max(hMax, f.H);
    const o = addCullable({ mesh, cx: cx * CELL + 4, cy: hMax / 2, cz: cz * CELL + 4, r: Math.hypot(5.7, hMax / 2), tiles: Int32Array.from(tiles), wall: true, faces });
    R.cells.push(o);
  }
}
// a wing came down: the corridor tiles are wall now. Recompute faces, rebuild every wall cell.
export function rebuildWalls(ctx, newTiles) {
  const R = ctx.W.ruins;
  for (const t of newTiles) { const i = idx(t.x, t.y); R.H[i] = COURSE * Math.round(rr(6, 8)); }
  // walls that used to face into the corridor may have no face now; others gain one
  for (let y = 0; y < LV.h; y++) for (let x = 0; x < LV.w; x++) {
    const i = idx(x, y); if (LV.tiles[i] !== 0) { R.H[i] = 0; continue; }
    const edge = DIRS.some(([dx, dy]) => isWalkable(x + dx, y + dy));
    if (!edge) R.H[i] = 0; else if (!R.H[i]) R.H[i] = COURSE * Math.round(rr(7.4, 10));
  }
  const deco = new Set(R.faces.filter((f) => f.deco).map((f) => f.tx + ',' + f.ty + ',' + f.d));
  const fresh = new Set(newTiles.map((t) => idx(t.x, t.y)));
  R.faces = buildFaces(R.H);
  for (const f of R.faces) { if (deco.has(f.tx + ',' + f.ty + ',' + f.d)) f.deco = true; if (fresh.has(f.ti)) f.rubble = true; }
  // drop the old wall cullables from the grid, then build new ones
  for (const c of R.cells) { const cell = ctx.W.grid[ctx.cellOf(c)]; const j = cell.indexOf(c); if (j >= 0) cell.splice(j, 1); const k = ctx.W.cullables.indexOf(c); if (k >= 0) ctx.W.cullables.splice(k, 1); }
  buildWallCells(ctx);
}

// =====================================================================
//  Visibility through the tile grid (the motel trick, in a grid)
// =====================================================================
const _dir = new THREE.Vector3();
export function computeSeen(R) {
  if (!R || !LV || !LV.solid) return;
  R.stamp = (R.stamp + 1) >>> 0 || 1;
  const S = R.seen, st = R.stamp, w = LV.w, h = LV.h, cx = camera.position.x / TILE, cz = camera.position.z / TILE;
  camera.getWorldDirection(_dir);
  const head = Math.atan2(_dir.z, _dir.x), hf = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect) + 0.5, N = 160, maxT = 52 / TILE;
  const ctx0 = Math.floor(cx), ctz0 = Math.floor(cz);
  for (let y = ctz0 - 2; y <= ctz0 + 2; y++) for (let x = ctx0 - 2; x <= ctx0 + 2; x++) if (x >= 0 && y >= 0 && x < w && y < h) S[y * w + x] = st;
  for (let r = 0; r < N; r++) {
    const a = head - hf / 2 + (hf * r) / (N - 1), dx = Math.cos(a), dz = Math.sin(a);
    let tx = ctx0, tz = ctz0;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1, ddx = Math.abs(1 / (dx || 1e-9)), ddz = Math.abs(1 / (dz || 1e-9));
    let mx = (dx > 0 ? tx + 1 - cx : cx - tx) * ddx, mz = (dz > 0 ? tz + 1 - cz : cz - tz) * ddz;
    for (let g = 0; g < 80; g++) {
      if (tx < 0 || tz < 0 || tx >= w || tz >= h) break;
      const i = tz * w + tx; S[i] = st;
      if (LV.tiles[i] === 0 && g > 0) break;
      if (mx < mz) { if (mx > maxT) break; mx += ddx; tx += sx; } else { if (mz > maxT) break; mz += ddz; tz += sz; }
    }
  }
}
export function anySeen(R, tiles) { const S = R.seen, st = R.stamp; for (let i = 0; i < tiles.length; i++) if (S[tiles[i]] === st) return true; return false; }
export function seenAt(R, x, z, r = 0) {
  const S = R.seen, st = R.stamp, x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE), z0 = Math.floor((z - r) / TILE), z1 = Math.floor((z + r) / TILE);
  for (let ty = z0; ty <= z1; ty++) for (let tx = x0; tx <= x1; tx++) if (tx >= 0 && ty >= 0 && tx < LV.w && ty < LV.h && S[ty * LV.w + tx] === st) return true;
  return false;
}
export function footprint(x, z, r) {
  const out = [], x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE), z0 = Math.floor((z - r) / TILE), z1 = Math.floor((z + r) / TILE);
  for (let ty = z0; ty <= z1; ty++) for (let tx = x0; tx <= x1; tx++) if (inBounds(tx, ty)) out.push(idx(tx, ty));
  return Int32Array.from(out);
}

// =====================================================================
//  Carved blocks, in front of the wall faces, only close up and in the light
// =====================================================================
function blockGeo(q, seed) {
  // a box (front at z=0, back at z=-0.3) with rounded edges, built on a non-uniform grid so the bevel gets the vertices
  const hx = 0.5, hy = 0.25, back = -0.3, r = 0.045;
  const axis = (h, interior) => { const a = [-h, -h + r * 0.35, -h + r]; for (let i = 1; i <= interior; i++) a.push(-h + r + ((2 * h - 2 * r) * i) / (interior + 1)); a.push(h - r, h - r * 0.35, h); return q < 2 ? a.filter((_, i) => i !== 1 && i !== a.length - 2) : a; };
  const xs = axis(hx, q >= 3 ? 2 : 0), ys = axis(hy, q >= 3 ? 1 : 0), zs = q < 2 ? [back, -r, 0] : [back, -r, -r * 0.35, 0];
  const pos = [], index = [];
  const grid = (U, V, f) => { const base = pos.length / 3; for (const v of V) for (const u of U) pos.push(...f(u, v)); for (let j = 0; j < V.length - 1; j++) for (let i = 0; i < U.length - 1; i++) { const a = base + j * U.length + i, b = a + 1, c = a + U.length, d = c + 1; index.push(a, b, d, a, d, c); } };
  grid(xs, ys, (x, y) => [x, y, 0]);                                   // front
  grid(xs, zs.slice().reverse(), (x, z) => [x, hy, z]);                // top
  grid(xs, zs, (x, z) => [x, -hy, z]);                                 // bottom
  grid(zs, ys, (z, y) => [hx, y, z]);                                  // right
  grid(zs.slice().reverse(), ys, (z, y) => [-hx, y, z]);               // left
  let g = new THREE.BufferGeometry(); g.setIndex(index); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // round the edges, then chisel the face
  const p = g.attributes.position, cl = new THREE.Vector3(), v = new THREE.Vector3(), cIn = new THREE.Vector3(hx - r, hy - r, 0);
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    cl.set(clamp(v.x, -cIn.x, cIn.x), clamp(v.y, -cIn.y, cIn.y), Math.min(v.z, -r));
    const d = v.clone().sub(cl); if (d.lengthSq() > 1e-10) v.copy(cl).addScaledVector(d.normalize(), r);
    if (v.z > -r * 1.5 && q >= 2) { v.z += 0.012 * nz3(v.x * 7 + seed, v.y * 9, seed) + 0.006 * nz3(v.x * 23, v.y * 21 - seed, seed * 2); }
    // a chipped corner on some variants
    if (seed % 2 === 1 && v.x > 0.3 && v.y > 0.12 && v.z > -0.1) { const k = clamp(((v.x - 0.3) / 0.2 + (v.y - 0.12) / 0.13) * 0.5, 0, 1); v.z -= 0.05 * k; }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // colour: bevels a touch darker (dirt in the joints), the face slightly mottled
  const cArr = [];
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), edgeK = Math.min(hx - Math.abs(x), hy - Math.abs(y)) < r * 0.9 || z < -r ? 0.72 : 1, m = 0.9 + 0.2 * (0.5 + 0.5 * nz3(x * 11 + seed, y * 13, seed)); cArr.push(edgeK * m, edgeK * m, edgeK * m); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cArr, 3));
  g = g.toNonIndexed(); g.computeBoundingSphere();
  return g;
}
const BLOCK_CAP = 2600, BLOCK_VARIANTS = 4;
export function ensureBlocks(W, q, group) {
  const R = W.ruins; if (!R) return;
  if (R.blocks) { for (const m of R.blocks.meshes) { group.remove(m); m.geometry.dispose(); m.dispose(); } R.blocks = null; }
  if (q === 0) return;
  const mat = R.blockMat || (R.blockMat = psx(new THREE.MeshLambertMaterial({ vertexColors: true, dithering: true })));
  if (!W.disposables.includes(mat)) W.disposables.push(mat);
  const meshes = [];
  for (let v = 0; v < BLOCK_VARIANTS; v++) {
    const m = new THREE.InstancedMesh(blockGeo(q, v + 1), mat, BLOCK_CAP);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BLOCK_CAP * 3), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.count = 0; m.visible = false;
    group.add(m); meshes.push(m);
  }
  R.blocks = { meshes, drawn: 0, tris: meshes[0].geometry.attributes.position.count / 3 };
}
const _M = new THREE.Matrix4();
// called after culling, with the wall faces whose cell is drawn
export function updateBlocks(W, radius, litTest) {
  const R = W.ruins; if (!R || !R.blocks) return;
  const B = R.blocks, counts = new Array(BLOCK_VARIANTS).fill(0), cam = camera.position, r2 = radius * radius;
  if (radius > 0) for (const c of R.cells) {
    if (!c.mesh.visible) continue;
    for (const f of c.faces) {
      if (f.deco) continue;
      const fcx = f.xFace ? f.plane : f.u0 + 1, fcz = f.xFace ? f.u0 + 1 : f.plane, dx = fcx - cam.x, dz = fcz - cam.z;
      if (dx * dx + dz * dz > r2) continue;
      if ((f.xFace ? cam.x - f.plane : cam.z - f.plane) * (f.xFace ? f.nx : f.nz) <= 0) continue; // facing away
      if (settings.culling && (R.seen[f.ti] !== R.stamp || !litTest(fcx, f.H / 2, fcz, Math.max(1.4, f.H / 2)))) continue;
      emitFace(B, f, counts);
    }
  }
  B.drawn = 0;
  B.meshes.forEach((m, v) => {
    m.count = counts[v]; m.visible = counts[v] > 0; B.drawn += counts[v];
    if (counts[v]) { m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, counts[v] * 16); m.instanceMatrix.needsUpdate = true; m.instanceColor.clearUpdateRanges(); m.instanceColor.addUpdateRange(0, counts[v] * 3); m.instanceColor.needsUpdate = true; }
  });
}
function emitFace(B, f, counts) {
  const courses = Math.floor(f.H / COURSE), U0 = f.u0, U1 = f.u0 + TILE, n = f.xFace ? [f.nx, 0, 0] : [0, 0, f.nz];
  // block axes: X along the wall, Y up, Z out of the wall (X = up x Z keeps it right-handed)
  const Xv = f.xFace ? [0, 0, -f.nx] : [f.nz, 0, 0];
  for (let c = 0; c < courses; c++) {
    const off = c % 2 ? 0.5 : 0, y = c * COURSE + COURSE / 2, top = c === courses - 1;
    for (let k = Math.floor(U0 - off) - 1; k + off < U1 + 1; k++) {
      let b0 = k + off, b1 = b0 + 1; const ctr = b0 + 0.5;
      if (ctr < U0 && f.contL) continue; if (ctr >= U1 && f.contR) continue;
      if (b1 <= U0 || b0 >= U1) continue;
      if (!f.contL) b0 = Math.max(b0, U0); if (!f.contR) b1 = Math.min(b1, U1);
      const wdt = b1 - b0; if (wdt < 0.15) continue;
      const h1 = hsh(Math.round(ctr * 2), c, Math.round(f.plane * 2), f.d), h2 = hsh(Math.round(ctr * 2), c, Math.round(f.plane * 2), 9 + f.d);
      if (top && h1 < 0.3) continue;                    // the top course is broken
      const v = (h2 * 997) % BLOCK_VARIANTS | 0, m = B.meshes[v]; if (counts[v] >= BLOCK_CAP) continue;
      const rub = f.rubble, out = rub ? 0.05 + h1 * 0.3 : 0.012 + h1 * 0.055;
      const rz = rub ? (h2 - 0.5) * 0.7 : (top ? (h2 - 0.5) * 0.12 : (h2 - 0.5) * 0.03), cs = Math.cos(rz), sn = Math.sin(rz);
      const sx = wdt - 0.035, sy = 0.47 + (h1 - 0.5) * 0.02;
      // rotate X and Y about Z by rz
      const ax = [Xv[0] * cs, sn, Xv[2] * cs], ay = [-Xv[0] * sn, cs, -Xv[2] * sn];
      const u = (b0 + b1) / 2, [px, py, pz] = facePoint(f, u, y + (top ? -0.02 : 0), out);
      const e = _M.elements;
      e[0] = ax[0] * sx; e[1] = ax[1] * sx; e[2] = ax[2] * sx; e[3] = 0;
      e[4] = ay[0] * sy; e[5] = ay[1] * sy; e[6] = ay[2] * sy; e[7] = 0;
      e[8] = n[0]; e[9] = 0; e[10] = n[2]; e[11] = 0;
      e[12] = px; e[13] = py; e[14] = pz; e[15] = 1;
      m.setMatrixAt(counts[v], _M);
      const tone = 0.13 + 0.07 * h2 + (c < 2 ? -0.02 : 0), green = c < 2 && h1 > 0.82;
      m.instanceColor.setXYZ(counts[v], green ? tone * 0.8 : tone, green ? tone * 0.95 : tone * 0.95, green ? tone * 0.72 : tone * 0.87);
      counts[v]++;
    }
  }
}

// =====================================================================
//  Carved pieces: pillars, drums, statues
// =====================================================================
const STONE = 0x5a554d;
const stoneCol = (base = STONE, moss = true) => { const c = col(base); return (x, y, z) => { let k = 0.84 + 0.3 * (0.5 + 0.5 * nz3(x * 5.1, y * 3.3, z * 5.7)); if (nz3(x * 2.1 + 3, y * 7.7, z * 2.3) > 0.62) k *= 0.6; const m = moss && y < 0.5 && nz3(x * 4, y * 2, z * 4) > 0.1 ? 1 : 0; return m ? [c.r * k * 0.62, c.g * k * 0.78, c.b * k * 0.55] : [c.r * k, c.g * k, c.b * k]; }; };
function shaftGeo(R0, H, radial, rings, flutes, jag, seed) {
  const pos = [], index = [], top = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * TAU, u = ((a * flutes) / TAU) % 1, fl = flutes ? 1 - 0.055 * Math.pow(Math.sin(Math.PI * u), 0.8) : 1;
      const ent = 1 - 0.1 * Math.pow(t, 1.4), chip = 1 + 0.03 * nz3(Math.cos(a) * 3 + seed, t * 8, Math.sin(a) * 3);
      const r = R0 * ent * fl * chip, y = t * H + (i === rings && jag ? jag * (nz3(Math.cos(a) * 2.2 + seed, seed, Math.sin(a) * 2.2) - 0.3) : 0);
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < radial; j++) { const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = a + radial, d = b + radial; index.push(a, c, b, b, c, d); }
  if (jag) { // the broken top: a rough cap
    const ci = pos.length / 3; pos.push(0, H + jag * 0.15, 0);
    for (let j = 0; j < radial; j++) index.push(ci, rings * radial + ((j + 1) % radial), rings * radial + j);
  }
  const g = new THREE.BufferGeometry(); g.setIndex(index); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return g;
}
function lathe(profile, seg) { return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg); }
const BASE_P = [[0.001, 0.22], [0.6, 0.22], [0.62, 0.27], [0.6, 0.33], [0.53, 0.36], [0.5, 0.42], [0.53, 0.46], [0.55, 0.5], [0.5, 0.54], [0.47, 0.56]];
const CAP_P = [[0.42, 0], [0.45, 0.04], [0.43, 0.08], [0.45, 0.1], [0.5, 0.16], [0.58, 0.24], [0.62, 0.3], [0.001, 0.3]];
// lo: a few primitives. hi: fluted, tapered, moulded, chipped.
export function pillarGeo(v, stumpH = 0) {
  const b = new GeoBuilder(), c = col(STONE), H = stumpH || (v ? 5.0 : 5.5), top = stumpH ? H - 0.5 : H - 0.6;
  b.add(T.box, M(0, 0.1, 0, 0, 0, 0, 1.26, 0.2, 1.26), c, 0.08);
  b.add(T.cyl10, M(0, 0.38, 0, 0, 0, 0, 0.5, 0.32, 0.5), c, 0.08);
  b.add(T.cyl10, M(0, 0.54 + (top - 0.54) / 2, 0, 0, 0, 0, 0.4, top - 0.54, 0.4), c, 0.1);
  if (!stumpH) { b.add(T.cyl10, M(0, H - 0.42, 0, 0, 0, 0, 0.5, 0.26, 0.5), c, 0.08); b.add(T.box, M(0, H - 0.11, 0, 0, 0, 0, 1.3, 0.2, 1.3), c, 0.08); }
  return b.build();
}
export function pillarHi(v, q, stumpH = 0) {
  const s = new SB(), H = stumpH || (v ? 5.0 : 5.5), radial = [24, 32, 48, 64][q], rings = [4, 6, 10, 16][q], ls = [12, 16, 24, 32][q], sc = stoneCol();
  const shaftH = H - 0.56 - (stumpH ? 0 : 0.6);
  s.add(shaftGeo(0.47, shaftH, radial, rings, 16, stumpH ? 0.35 : 0, v * 7 + (stumpH * 10 | 0)), sc, { matrix: M(0, 0.56, 0) });
  s.add(new THREE.BoxGeometry(1.3, 0.22, 1.3, 2, 1, 2), sc, { matrix: M(0, 0.11, 0) });
  s.add(lathe(BASE_P, ls), sc);
  if (!stumpH) {
    s.add(lathe(CAP_P, ls), sc, { matrix: M(0, H - 0.6, 0) });
    s.add(new THREE.BoxGeometry(1.36, 0.22, 1.36, 2, 1, 2), sc, { matrix: M(0, H - 0.19, 0, 0, 0.02, 0) });
  }
  return s.build();
}
export function drumGeo() { const b = new GeoBuilder(); b.add(T.cyl10, M(0, 0.4, 0, 0, 0, Math.PI / 2, 0.36, 0.7, 0.36), col(STONE), 0.1); return b.build(); }
export function drumHi(q) {
  const s = new SB(), radial = [24, 32, 48, 64][q];
  s.add(shaftGeo(0.44, 0.9, radial, 2, 16, 0.12, 3), stoneCol(STONE, false), { matrix: M(-0.45, 0.42, 0, 0, 0, -Math.PI / 2) });
  return s.build();
}
// a hooded court figure on a plinth, hands on a sword. The head is separate: it turns when nobody is looking.
export const STATUE_NECK = 2.78;
export function statueGeo() {
  const b = new GeoBuilder(), c = col(0x625d55);
  b.add(T.box, M(0, 0.33, 0, 0, 0, 0, 1.26, 0.66, 1.26), c, 0.06);
  b.add(T.cone, M(0, 1.6, 0, 0, 0, 0, 0.36, 1.8, 0.3), c, 0.08);
  b.add(T.box, M(0, 2.38, 0, 0, 0, 0, 0.5, 0.6, 0.26), c, 0.08);
  return b.build();
}
export function statueHi(q) {
  const s = new SB(), radial = [12, 20, 28, 40][q], rings = [8, 14, 22, 30][q], sc = stoneCol(0x625d55);
  s.add(new THREE.BoxGeometry(1.3, 0.6, 1.3, 2, 1, 2), sc, { matrix: M(0, 0.3, 0) });
  s.add(new THREE.BoxGeometry(1.42, 0.12, 1.42, 2, 1, 2), sc, { matrix: M(0, 0.64, 0) });
  // the robe: folds deepest at the hem
  const robe = loftTube([[0, 0.7, 0, 0.5, 0.44], [0, 1.2, 0.01, 0.42, 0.34], [0, 1.75, 0.02, 0.28, 0.2], [0, 2.2, 0.02, 0.32, 0.21], [0, 2.6, 0, 0.34, 0.19], [0, 2.75, 0, 0.12, 0.1]], radial, rings, (a, t) => 1 + 0.07 * Math.sin(a * 9 + t * 2) * (1 - t) + 0.02 * Math.sin(a * 23));
  s.add(robe, sc);
  // sleeves meeting at the sword's pommel
  for (const sx of [-1, 1]) s.add(loftTube([[sx * 0.33, 2.55, 0, 0.11, 0.11], [sx * 0.36, 2.2, 0.08, 0.12, 0.12], [sx * 0.2, 1.95, 0.3, 0.13, 0.14], [sx * 0.07, 1.92, 0.36, 0.08, 0.08]], Math.max(8, radial >> 1), Math.max(5, rings >> 1)), sc);
  for (const sx of [-1, 1]) s.add(new THREE.SphereGeometry(0.07, 10, 8), sc, { matrix: M(sx * 0.05, 1.9, 0.38, 0, 0, 0, 1, 1.2, 1) });
  const steel = stoneCol(0x6e6c66, false);
  s.add(new THREE.BoxGeometry(0.07, 1.15, 0.025, 1, 6, 1), steel, { matrix: M(0, 1.2, 0.39) });
  s.add(new THREE.BoxGeometry(0.44, 0.06, 0.06), steel, { matrix: M(0, 1.79, 0.39) });
  s.add(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), steel, { matrix: M(0, 1.9, 0.39) });
  s.add(new THREE.SphereGeometry(0.05, 10, 8), steel, { matrix: M(0, 2.02, 0.39) });
  return s.build();
}
export function statueHeadGeo(hi, q = 1) {
  if (!hi) { const b = new GeoBuilder(), c = col(0x625d55); b.add(T.ico, M(0, 0.18, 0.02, 0, 0, 0, 0.15, 0.19, 0.15), c, 0.08); return b.build(); }
  const s = new SB(), sc = stoneCol(0x625d55, false), d = [1, 2, 3, 4][q];
  // a hood with the face sunk deep inside it, a circlet of the court
  const hood = new THREE.IcosahedronGeometry(1, d); { const p = hood.attributes.position; for (let i = 0; i < p.count; i++) { let x = p.getX(i), y = p.getY(i), z = p.getZ(i); if (z > 0.35 && y < 0.5 && Math.abs(x) < 0.7) z = 0.35 + (z - 0.35) * 0.1; if (y > 0.6) z -= (y - 0.6) * 0.5; p.setXYZ(i, x, y, z); } }
  s.add(hood, sc, { matrix: M(0, 0.2, 0, 0, 0, 0, 0.21, 0.25, 0.22) });
  s.add(new THREE.SphereGeometry(1, 12 + q * 4, 10 + q * 3), (x, y, z) => [0.16, 0.15, 0.14], { matrix: M(0, 0.14, 0.03, 0, 0, 0, 0.13, 0.16, 0.13) });
  s.add(new THREE.TorusGeometry(0.19, 0.022, 6, 16 + q * 8), sc, { matrix: M(0, 0.3, 0.01, Math.PI / 2 - 0.15, 0, 0) });
  for (let i = 0; i < 5; i++) { const a = -0.9 + i * 0.45; s.add(new THREE.ConeGeometry(0.025, 0.08, 5), sc, { matrix: M(Math.sin(a) * 0.19, 0.36, 0.01 + Math.cos(a) * 0.19 * 0.97) }); }
  return s.build();
}
// a tube through [x,y,z,rx,rz] stations (vertical-ish), with an optional radius shape(a,t)
function loftTube(st, radial, rings, shape) {
  const curve = new THREE.CatmullRomCurve3(st.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const pos = [], index = [], tmp = new THREE.Vector3(), T_ = new THREE.Vector3(), S_ = new THREE.Vector3(), U_ = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1), f = t * (st.length - 1), k = Math.min(st.length - 2, Math.floor(f)), fr = f - k, rx = lerp(st[k][3], st[k + 1][3], fr), rz = lerp(st[k][4], st[k + 1][4], fr);
    curve.getPoint(t, tmp); curve.getTangent(t, T_); S_.crossVectors(T_, up).normalize(); if (S_.lengthSq() < 0.1) S_.set(1, 0, 0); U_.crossVectors(S_, T_).normalize();
    for (let j = 0; j < radial; j++) { const a = (j / radial) * TAU, m = shape ? shape(a, t) : 1; pos.push(tmp.x + (S_.x * Math.cos(a) * rx + U_.x * Math.sin(a) * rz) * m, tmp.y + (S_.y * Math.cos(a) * rx + U_.y * Math.sin(a) * rz) * m, tmp.z + (S_.z * Math.cos(a) * rx + U_.z * Math.sin(a) * rz) * m); }
  }
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < radial; j++) { const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = a + radial, d = b + radial; index.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setIndex(index); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return g;
}

// =====================================================================
//  Arches over the doorways, murals, plaques, stone braziers, the stair
// =====================================================================
export function findArches() {
  const out = [];
  for (const r of LV.rooms) {
    // rs: which way the room lies from the doorway line (+1 = increasing coordinate)
    const sides = [
      { line: (i) => [r.x + i, r.y - 1], n: r.w, plane: r.y * TILE, xFace: false, rs: 1 },
      { line: (i) => [r.x + i, r.y + r.h], n: r.w, plane: (r.y + r.h) * TILE, xFace: false, rs: -1 },
      { line: (i) => [r.x - 1, r.y + i], n: r.h, plane: r.x * TILE, xFace: true, rs: 1 },
      { line: (i) => [r.x + r.w, r.y + i], n: r.h, plane: (r.x + r.w) * TILE, xFace: true, rs: -1 },
    ];
    for (const sd of sides) {
      let run = null;
      for (let i = -1; i <= sd.n; i++) {
        const [tx, ty] = sd.line(i), open = i >= 0 && i < sd.n && isWalkable(tx, ty);
        if (open) { if (!run) run = { a: i, b: i }; else run.b = i; continue; }
        if (!run) continue;
        const len = run.b - run.a + 1, [jx0, jy0] = sd.line(run.a - 1), [jx1, jy1] = sd.line(run.b + 1);
        if (len <= 3 && tileAt(jx0, jy0) === 0 && tileAt(jx1, jy1) === 0) {
          const [ax, ay] = sd.line(run.a), [bx, by] = sd.line(run.b), tiles = [];
          for (let k = run.a - 1; k <= run.b + 1; k++) { const [x, y] = sd.line(k); tiles.push(idx(x, y)); }
          out.push({ xFace: sd.xFace, plane: sd.plane, rs: sd.rs, u0: (sd.xFace ? ay : ax) * TILE, u1: ((sd.xFace ? by : bx) + 1) * TILE, jam: [[jx0, jy0], [jx1, jy1]], tiles });
        }
        run = null;
      }
    }
  }
  return out;
}
export function archGeo(a, H) {
  const b = new QB(), span = a.u1 - a.u0, rise = Math.min(span / 2, 1.5), spring = 2.5, mid = (a.u0 + a.u1) / 2;
  const R = (rise * rise + (span / 2) ** 2) / (2 * rise), cy = spring + rise - R; // the circle through both springers and the crown
  const hTop = Math.max(spring + rise + 0.6, Math.min(H[0], H[1]) - 0.1), rs = a.rs;
  const P = (u, y, o) => (a.xFace ? [a.plane + o, y, u] : [u, y, a.plane + o]);
  const nrm = (sgn) => (a.xFace ? [sgn, 0, 0] : [0, 0, sgn]);
  const curveAt = (u) => cy + Math.sqrt(Math.max(0, R * R - (u - mid) ** 2));
  const stone = [0.8, 0.76, 0.72], dk = [0.5, 0.48, 0.46], N = 14, front = rs * 0.02, back = -rs * (TILE + 0.02);
  // spandrels: the wall carried over the opening, on the room side and the far side of the passage
  for (const [o, sgn] of [[front, rs], [back, -rs]]) for (let i = 0; i < N; i++) {
    const ua = lerp(a.u0, a.u1, i / N), ub = lerp(a.u0, a.u1, (i + 1) / N), ya = curveAt(ua), yb = curveAt(ub);
    b.quad(P(ua, ya, o), P(ub, yb, o), P(ub, hTop, o), P(ua, hTop, o), nrm(sgn), [ua / 2, ya / 2], [ub / 2, yb / 2], [ub / 2, hTop / 2], [ua / 2, hTop / 2], stone, stone, stone, stone);
  }
  // the vault: underside of the passage
  for (let i = 0; i < N; i++) {
    const ua = lerp(a.u0, a.u1, i / N), ub = lerp(a.u0, a.u1, (i + 1) / N), ya = curveAt(ua), yb = curveAt(ub), um = (ua + ub) / 2, du = mid - um, dy = cy - curveAt(um), L = Math.hypot(du, dy);
    const n = a.xFace ? [0, dy / L, du / L] : [du / L, dy / L, 0];
    b.quad(P(ua, ya, front), P(ub, yb, front), P(ub, yb, back), P(ua, ya, back), n, [ua / 2, 0.1], [ub / 2, 0.1], [ub / 2, 1.1], [ua / 2, 1.1], dk, dk, dk, dk);
  }
  // voussoirs standing proud of both spandrels, a deeper keystone
  const vs = 9, ang0 = Math.atan2(spring - cy, a.u0 - mid), ang1 = Math.atan2(spring - cy, a.u1 - mid);
  for (const [o, sgn] of [[rs * 0.08, rs], [-rs * (TILE + 0.08), -rs]]) for (let i = 0; i < vs; i++) {
    const t0 = lerp(ang0, ang1, i / vs), t1 = lerp(ang0, ang1, (i + 1) / vs), g = 0.012, r1 = R + (i === vs >> 1 ? 0.62 : 0.5);
    const pt = (t, r) => P(mid + Math.cos(t) * r, cy + Math.sin(t) * r, o), kc = 0.82 + 0.2 * hsh(i, sgn + 2, a.u0 | 0), cc = [kc, kc * 0.97, kc * 0.93];
    b.quad(pt(t0 - g, R), pt(t1 + g, R), pt(t1 + g, r1), pt(t0 - g, r1), nrm(sgn), [0.3, 0.3], [0.3, 0.3], [0.3, 0.3], [0.3, 0.3], cc, cc, cc, cc);
    // their outer edge, so they read as blocks from the side
    const e0 = pt(t0 - g, r1), e1 = pt(t1 + g, r1), onFront = sgn === rs;
    const f0 = P(mid + Math.cos(t0 - g) * r1, cy + Math.sin(t0 - g) * r1, onFront ? front : back), f1 = P(mid + Math.cos(t1 + g) * r1, cy + Math.sin(t1 + g) * r1, onFront ? front : back);
    const tm = (t0 + t1) / 2, en = a.xFace ? [0, Math.sin(tm), Math.cos(tm)] : [Math.cos(tm), Math.sin(tm), 0];
    b.quad(f0, f1, e1, e0, en, [0.3, 0.3], [0.3, 0.3], [0.3, 0.3], [0.3, 0.3], dk, dk, dk, dk);
  }
  // pilasters either side of the opening, on the room side
  for (const [lo, hi] of [[a.u0 - 0.36, a.u0], [a.u1, a.u1 + 0.36]]) {
    const o = rs * 0.08, cc = [0.74, 0.71, 0.67];
    b.quad(P(lo, 0, o), P(hi, 0, o), P(hi, spring, o), P(lo, spring, o), nrm(rs), [lo / 2, 0], [hi / 2, 0], [hi / 2, spring / 2], [lo / 2, spring / 2], cc, cc, cc, cc);
    for (const [u, sg] of [[lo, -1], [hi, 1]]) { const n = a.xFace ? [0, 0, sg] : [sg, 0, 0]; b.quad(P(u, 0, rs * 0.02), P(u, 0, o), P(u, spring, o), P(u, spring, rs * 0.02), n, [0, 0], [0.04, 0], [0.04, 1.2], [0, 1.2], dk, dk, dk, dk); }
  }
  const g = b.build(); g.userData.top = hTop; return g;
}
// murals: faded paintings of the Crown, the Light and the Shadow
export function muralTexture(sym) {
  const t = canvasTex(256, (g, S) => {
    const R = (a, b) => a + (b - a) * Math.random();
    const bg = { crown: '#4a2018', light: '#18284a', shadow: '#3a3a40' }[sym];
    g.fillStyle = '#b8ab92'; g.fillRect(0, 0, S, S);
    g.fillStyle = bg; g.fillRect(14, 14, S - 28, S - 28);
    g.strokeStyle = '#c8a050'; g.lineWidth = 4; g.strokeRect(20, 20, S - 40, S - 40);
    const cx = S / 2, cy = S / 2;
    if (sym === 'crown') {
      g.fillStyle = 'rgba(255,220,140,.25)'; g.beginPath(); g.arc(cx, cy - 6, 78, 0, TAU); g.fill();
      g.fillStyle = '#d8a838'; g.beginPath(); g.moveTo(cx - 70, cy + 40); g.lineTo(cx - 70, cy - 30); g.lineTo(cx - 40, cy); g.lineTo(cx - 20, cy - 50); g.lineTo(cx, cy - 8); g.lineTo(cx + 20, cy - 50); g.lineTo(cx + 40, cy); g.lineTo(cx + 70, cy - 30); g.lineTo(cx + 70, cy + 40); g.closePath(); g.fill();
      g.fillStyle = '#8a2020'; for (const x of [-40, 0, 40]) { g.beginPath(); g.arc(cx + x, cy + 20, 8, 0, TAU); g.fill(); }
    } else if (sym === 'light') {
      g.strokeStyle = 'rgba(255,230,160,.8)'; g.lineWidth = 5;
      for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; g.beginPath(); g.moveTo(cx + Math.cos(a) * 34, cy + Math.sin(a) * 34); g.lineTo(cx + Math.cos(a) * 92, cy + Math.sin(a) * 92); g.stroke(); }
      g.fillStyle = '#f0d890'; g.fillRect(cx - 18, cy - 26, 36, 50); g.fillStyle = '#5a4020'; g.fillRect(cx - 22, cy - 34, 44, 8); g.fillRect(cx - 22, cy + 24, 44, 8);
      g.fillStyle = '#fff4c8'; g.beginPath(); g.ellipse(cx, cy, 8, 14, 0, 0, TAU); g.fill();
    } else {
      g.fillStyle = 'rgba(220,220,230,.35)'; g.beginPath(); g.arc(cx, cy, 80, 0, TAU); g.fill();
      g.fillStyle = '#0c0c10'; g.beginPath(); g.arc(cx, cy, 64, 0, TAU); g.fill();
      g.fillStyle = '#1a1a20'; g.beginPath(); g.moveTo(cx - 34, cy + 90); g.quadraticCurveTo(cx - 30, cy - 10, cx, cy - 44); g.quadraticCurveTo(cx + 30, cy - 10, cx + 34, cy + 90); g.fill();
    }
    // centuries: fading, flaking plaster, soot
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(184,171,146,${R(0.05, 0.25)})`; g.fillRect(Math.random() * S, Math.random() * S, R(1, 3), R(1, 3)); }
    for (let i = 0; i < 22; i++) { g.fillStyle = `rgba(150,140,120,${R(0.5, 0.9)})`; g.beginPath(); const x = Math.random() * S, y = Math.random() * S; g.moveTo(x, y); for (let k = 0; k < 6; k++) g.lineTo(x + R(-22, 22), y + R(-16, 16)); g.fill(); }
    const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, 'rgba(10,8,6,.35)'); gr.addColorStop(0.3, 'rgba(10,8,6,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
  });
  return t;
}
// plaques: the same three signs, cut into stone. map = the carving, emissiveMap = the lines that glow
export function plaqueTextures(sym) {
  const draw = (glow) => (g, S) => {
    g.fillStyle = glow ? '#000' : '#3a3630'; g.fillRect(0, 0, S, S);
    if (!glow) for (let i = 0; i < 6000; i++) { const v = Math.random() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},.06)`; g.fillRect(Math.random() * S, Math.random() * S, 2, 2); }
    g.strokeStyle = glow ? '#fff' : '#0c0a08'; g.lineWidth = glow ? 8 : 11; g.lineCap = 'round'; g.lineJoin = 'round';
    const cx = S / 2, cy = S / 2; g.beginPath();
    if (sym === 'crown') { g.moveTo(cx - 60, cy + 36); g.lineTo(cx - 60, cy - 30); g.lineTo(cx - 30, cy); g.lineTo(cx, cy - 50); g.lineTo(cx + 30, cy); g.lineTo(cx + 60, cy - 30); g.lineTo(cx + 60, cy + 36); g.closePath(); }
    else if (sym === 'light') { g.arc(cx, cy, 24, 0, TAU); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; g.moveTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40); g.lineTo(cx + Math.cos(a) * 72, cy + Math.sin(a) * 72); } }
    else { g.arc(cx, cy, 56, 0, TAU); g.moveTo(cx + 56, cy); g.arc(cx + 22, cy - 10, 50, 0, TAU); }
    g.stroke();
    g.strokeStyle = glow ? 'rgba(255,255,255,.5)' : '#3a352c'; g.lineWidth = 4; g.strokeRect(10, 10, S - 20, S - 20);
  };
  return { map: canvasTex(256, draw(false)), glow: canvasTex(256, draw(true)) };
}
export function stoneBrazierGeo() {
  const b = new GeoBuilder(), c = col(0x7a746a), ash = col(0x3a3430);
  b.add(T.box, M(0, 0.08, 0, 0, 0.4, 0, 0.7, 0.16, 0.7), c, 0.06);
  b.add(T.cyl6, M(0, 0.55, 0, 0, 0, 0, 0.2, 0.8, 0.2), c, 0.08);
  b.add(T.cone, M(0, 1.08, 0, Math.PI, 0, 0, 0.48, 0.3, 0.48), c, 0.06);
  b.add(T.cyl10, M(0, 1.22, 0, 0, 0, 0, 0.5, 0.06, 0.5), c, 0.06);
  b.add(T.ico, M(0, 1.2, 0, 0, 0, 0, 0.38, 0.1, 0.38), ash, 0.2);
  return b.build();
}
export function stairGeo() {
  const b = new GeoBuilder(), stone = col(0x6e675c), dark = col(0x34302a);
  // a square well with a low broken parapet on three sides; the steps start at the open north edge
  for (const [x, z, sx, sz] of [[-2.15, 0.1, 0.3, 4.6], [2.15, 0.1, 0.3, 4.6], [0.6, 2.15, 3.2, 0.3]]) b.add(T.box, M(x, 0.42, z, 0, 0, 0, sx, 0.84, sz), stone, 0.08);
  for (let i = 0; i < 3; i++) b.add(T.box, M(-1.5 + i * 0.4, 0.95, 2.15, rr(-0.2, 0.2), rr(-0.3, 0.3), rr(-0.3, 0.3), 0.4, 0.2, 0.3), stone, 0.12);
  for (const [x, z, sx, sz] of [[-1.95, 0, 0.1, 4], [1.95, 0, 0.1, 4], [0, 1.95, 4, 0.1], [0, -1.95, 4, 0.1]]) b.add(T.box, M(x, -1.4, z, 0, 0, 0, sx, 2.8, sz), dark, 0.1);
  for (let i = 0; i < 9; i++) b.add(T.box, M(0, -0.13 - i * 0.27, -1.75 + i * 0.42, 0, 0, 0, 3.8, 0.26, 0.42), i < 3 ? stone : dark, 0.1);
  b.add(T.box, M(0, -2.85, 0, 0, 0, 0, 4, 0.1, 4), col(0x0c0b0a), 0.05);
  return b.build();
}
// =====================================================================
//  Ground cover for the ruins: grit, fallen stone, weeds in the cracks, bones, shards
// =====================================================================
export const RUIN_COVER_CELL = 1.6;
export function ruinCoverVariants(q) {
  const H = RUIN_COVER_CELL / 2, P = () => [rr(-H, H), rr(-H, H)];
  const make = (fill) => { const b = new GeoBuilder(); fill(b); return b.build(); };
  const stone = [0x4e4942, 0x433f39, 0x57514a, 0x3a3733].map(col), weed = [0x3a4a2a, 0x4a5230, 0x55553a, 0x303a24].map(col), bone = col(0x8a8270);
  const grit = (b, n) => { for (let i = 0; i < n; i++) { const [x, z] = P(), s = rr(0.02, 0.06); b.add(T.ico, M(x, s * 0.3, z, rr(0, 3), rr(0, 6), 0, s, s * 0.55, s), stone[(rnd() * 4) | 0], 0.15); } };
  const chunk = (b, x, z, s) => b.add(T.box, M(x, s * 0.25, z, rr(-0.3, 0.3), rr(0, 6), rr(-0.3, 0.3), s * rr(1.2, 2), s * rr(0.6, 1), s), stone[(rnd() * 4) | 0], 0.12);
  const tuft = (b, x, z, n) => { for (let k = 0; k < n; k++) { const h = rr(0.08, 0.3), w = rr(0.02, 0.04); b.add(T.blade, M(x + rr(-0.06, 0.06), 0, z + rr(-0.06, 0.06), rr(0.05, 0.6), rr(0, 6.28), 0, w, h, h), weed[(rnd() * 4) | 0], 0.18); } };
  return [
    { w: 0.34, near: 0.2, g: make((b) => { grit(b, 30 * q); for (let i = 0; i < q; i++) { const [x, z] = P(); chunk(b, x, z, rr(0.06, 0.12)); } }) },
    { w: 0.12, near: 0.62, g: make((b) => { const [x0, z0] = P(); for (let i = 0; i < 3 + 2 * q; i++) chunk(b, x0 * 0.5 + rr(-0.4, 0.4), z0 * 0.5 + rr(-0.4, 0.4), rr(0.1, 0.24)); grit(b, 18 * q); }) },
    { w: 0.26, near: 0.1, g: make((b) => { for (let i = 0; i < 2 + q; i++) { const [x, z] = P(); tuft(b, x, z, 4 + 4 * q); } grit(b, 8 * q); }) },
    { w: 0.12, near: 0.05, g: make((b) => {
      for (let i = 0; i < 2 + q; i++) { const [x, z] = P(), a = rr(0, 6.28), L = rr(0.18, 0.4); b.add(T.cyl4, M(x, 0.02, z, Math.PI / 2, a, 0, 0.018, L, 0.018), bone, 0.12); b.add(T.ico, M(x + Math.sin(a) * L / 2, 0.025, z + Math.cos(a) * L / 2, 0, 0, 0, 0.03, 0.025, 0.03), bone, 0.1); }
      if (rnd() < 0.5) { const [x, z] = P(); b.add(T.sphere, M(x, 0.07, z, rr(-0.4, 0.2), rr(0, 6), rr(-0.3, 0.3), 0.09, 0.08, 0.11), bone, 0.08); b.add(T.sphere, M(x, 0.05, z + 0.04, 0, 0, 0, 0.03, 0.025, 0.02), col(0x1a1612), 0); }
      grit(b, 10 * q); }) },
    { w: 0.16, near: 0.03, g: make((b) => {
      const clay = [col(0x7a4a30), col(0x6a3e28)];
      for (let i = 0; i < 3 + 2 * q; i++) { const [x, z] = P(), s = rr(0.04, 0.09), a = rr(0, 6.28); b.tri(x, 0.01, z, x + Math.cos(a) * s, 0.015, z + Math.sin(a) * s, x + Math.cos(a + 1.3) * s, 0.03, z + Math.sin(a + 1.3) * s, clay[i % 2], 0.15); }
      if (rnd() < 0.4) { const [x, z] = P(); b.add(T.cyl10, M(x, 0.06, z, 0, 0, 0, 0.12, 0.12, 0.12), clay[0], 0.1); }
      grit(b, 8 * q); }) },
  ];
}

// =====================================================================
//  Statues turn their heads while you are not looking
// =====================================================================
export function updateStatues(R, dt, px, pz, say) {
  for (const s of R.statues) {
    const seen = s.head.mesh.visible;
    if (seen) {
      if (s.turned && !s.noticed && Math.hypot(px - s.x, pz - s.z) < 12) { s.noticed = true; if (!R.saidStatue) { R.saidStatue = true; say('Was it facing us before?'); } }
      s.unseen = 0;
    } else {
      s.unseen += dt;
      const d = Math.hypot(px - s.x, pz - s.z);
      if (s.unseen > 1.2 && d > 3 && d < 30) {
        const want = Math.atan2(px - s.x, pz - s.z), rel = clamp(((want - s.yaw + Math.PI * 3) % TAU) - Math.PI, -1.5, 1.5);
        if (Math.abs(rel - s.look) > 0.2) { s.look = rel; s.turned = Math.abs(rel) > 0.5; s.noticed = false; s.head.mesh.rotation.y = s.yaw + rel; s.head.mesh.updateMatrix(); }
      }
    }
  }
}
