import { THREE, rnd, rr, ri, srand, clamp, lerp, nz3, TAU } from './engine.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ATLAS, FIG } from './assets/index.js';

// =====================================================================
//  CREATURE RIGS — detailed, skinned, procedural.
//  Every creature is one SkinnedMesh: smooth lofted bodies and limbs bound
//  to a skeleton (two-bone blends where the body bends), so a 15k-triangle
//  wolf is still one draw call (plus one for its eyes/teeth/steel/glow).
//  q = quality tier, tied to the DETAIL setting: 0 LOW, 1 HIGH, 2 ULTRA, 3 MAX.
//  Material slots: 0 body (per creature, so it can flash), 1 gloss (eyes,
//  teeth, claws, nose), 2 the creature's accent (steel, or self-lit glow).
// =====================================================================
const V3 = THREE.Vector3, C = (h) => new THREE.Color(h);
const mixc = (a, b, t) => a.clone().lerp(b, clamp(t, 0, 1));
const shade = (c, k) => [c.r * k, c.g * k, c.b * k];
const noise = (x, y, z) => 0.5 + 0.5 * nz3(x, y, z);

// ---------- primitives (indexed, so normals come out smooth) ----------
// loft: a tube through control points {p:[x,y,z], r:[rx,ry]}; ry runs along U (ref-ish), rx along S
const _T = new V3(), _S = new V3(), _U = new V3(), _P = new V3(), _ref = new V3(), _alt = new V3();
function frameAt(curve, t, ref) {
  curve.getTangent(t, _T); _ref.set(...ref);
  if (Math.abs(_T.dot(_ref)) > 0.97) _ref.set(ref[2] ? 0 : 0, ref[2] ? 1 : 0, ref[2] ? 0 : 1);
  _S.crossVectors(_ref, _T).normalize(); _U.crossVectors(_T, _S).normalize();
}
function makeCurve(ctrl) {
  const pts = ctrl.map((c) => new V3(...c.p));
  return pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5) : new THREE.LineCurve3(pts[0], pts[1]);
}
function radiiAt(ctrl, t) {
  const n = ctrl.length - 1, seg = Math.min(n - 1, Math.floor(t * n)), f = t * n - seg, k = f * f * (3 - 2 * f);
  return [lerp(ctrl[seg].r[0], ctrl[seg + 1].r[0], k), lerp(ctrl[seg].r[1], ctrl[seg + 1].r[1], k)];
}
export function loft(ctrl, o = {}) {
  const radial = o.radial || 12, rings = Math.max(2, o.rings || 12), ref = o.ref || [0, 1, 0], curve = makeCurve(ctrl), pos = [], idx = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1), [rx, ry] = radiiAt(ctrl, t); curve.getPoint(t, _P); const cx = _P.x, cy = _P.y, cz = _P.z; frameAt(curve, t, ref);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * TAU, m = o.shape ? o.shape(a, t) : 1;
      pos.push(cx + (_S.x * Math.cos(a) * rx + _U.x * Math.sin(a) * ry) * m, cy + (_S.y * Math.cos(a) * rx + _U.y * Math.sin(a) * ry) * m, cz + (_S.z * Math.cos(a) * rx + _U.z * Math.sin(a) * ry) * m);
    }
  }
  const R = radial;
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < R; j++) { const a = i * R + j, b = i * R + ((j + 1) % R), c = (i + 1) * R + j, d = (i + 1) * R + ((j + 1) % R); idx.push(a, b, c, b, d, c); }
  if (o.caps !== false) {
    curve.getPoint(0, _P); const s = pos.length / 3; pos.push(_P.x, _P.y, _P.z);
    curve.getPoint(1, _P); const e = pos.length / 3; pos.push(_P.x, _P.y, _P.z);
    for (let j = 0; j < R; j++) { idx.push(s, (j + 1) % R, j); idx.push(e, (rings - 1) * R + j, (rings - 1) * R + ((j + 1) % R)); }
  }
  const g = new THREE.BufferGeometry(); g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
// a point on a loft's surface and its outward direction (for planting fur, spines, pustules)
export function loftSurface(ctrl, t, a, ref = [0, 1, 0], lift = 1) {
  const curve = makeCurve(ctrl), [rx, ry] = radiiAt(ctrl, t); curve.getPoint(t, _P); frameAt(curve, t, ref);
  const p = new V3().copy(_P).addScaledVector(_S, Math.cos(a) * rx * lift).addScaledVector(_U, Math.sin(a) * ry * lift);
  const n = new V3().copy(_S).multiplyScalar(Math.cos(a) / rx).addScaledVector(_U, Math.sin(a) / ry).normalize();
  return { p, n, t: new V3().copy(_T) };
}
// a smooth blob: an icosphere with merged vertices, optionally deformed
export function blob(detail, deform) {
  let g = new THREE.IcosahedronGeometry(1, detail); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
  if (deform) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const r = deform(p.getX(i), p.getY(i), p.getZ(i)); p.setXYZ(i, r[0], r[1], r[2]); } }
  return g;
}
const _q = new THREE.Quaternion(), _up = new V3(0, 1, 0), _s3 = new V3(), _m4 = new THREE.Matrix4();
// a matrix that places something pointing along dir (local +Y) at p
export function along(p, dir, sx = 1, sy = 1, sz = 1, spin = 0) {
  _q.setFromUnitVectors(_up, dir.clone().normalize());
  if (spin) _q.multiply(new THREE.Quaternion().setFromAxisAngle(_up, spin));
  return _m4.compose(p, _q, _s3.set(sx, sy, sz)).clone();
}
const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new V3(sx, sy, sz));
const cone = (sides, r = 1, h = 1) => { const g = new THREE.ConeGeometry(r, h, sides, 1); g.translate(0, h / 2, 0); return g; };

// ---------- the builder ----------
export class RigBuilder {
  constructor(def) {
    this.def = def; this.bi = {}; def.forEach((b, i) => (this.bi[b.name] = i));
    this.slots = [0, 1, 2].map(() => ({ p: [], n: [], c: [], si: [], sw: [], pin: [], dec: [] }));
  }
  // bind: a bone name, or (x,y,z) => [bone, w, bone2, w2]. color: THREE.Color, [r,g,b], or (x,y,z,nx,ny,nz) => colour
  add(geo, bind, color, o = {}) {
    let g = geo.clone();
    if (o.flat) { if (g.index) g = g.toNonIndexed(); if (o.matrix) g.applyMatrix4(o.matrix); g.computeVertexNormals(); }
    else { g.computeVertexNormals(); if (o.matrix) g.applyMatrix4(o.matrix); if (g.index) g = g.toNonIndexed(); }
    const P = g.attributes.position, N = g.attributes.normal, S = this.slots[o.slot || 0]; if (o.pin) this.pinned = true; if (o.decal) this.decaled = true;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i);
      S.p.push(x, y, z); S.n.push(nx, ny, nz); if (o.pin) S.pin.push(o.pin.x, o.pin.y, o.pin.z); else S.pin.push(x, y, z);
      if (o.decal) { const d = o.decal(x, y, z); S.dec.push(d[0], d[1], 1); } else S.dec.push(0, 0, 0);
      let c = typeof color === 'function' ? color(x, y, z, nx, ny, nz) : color;
      if (c.isColor) S.c.push(c.r, c.g, c.b); else S.c.push(c[0], c[1], c[2]);
      const b = typeof bind === 'function' ? bind(x, y, z) : [bind, 1];
      S.si.push(this.bi[b[0]], b.length > 2 ? this.bi[b[2]] : 0, 0, 0); S.sw.push(b[1], b.length > 2 ? b[3] : 0, 0, 0);
    }
    g.dispose();
  }
  build() {
    const A = { p: [], n: [], c: [], si: [], sw: [], pin: [], dec: [] }, g = new THREE.BufferGeometry(); let start = 0;
    this.slots.forEach((s, k) => {
      const cnt = s.p.length / 3; if (!cnt) return;
      for (const key in A) A[key] = A[key].concat(s[key]);
      g.addGroup(start, cnt, k); start += cnt;
    });
    g.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(A.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(A.c, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(A.si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(A.sw, 4));
    if (this.pinned) g.setAttribute('pin', new THREE.Float32BufferAttribute(A.pin, 3)); // where fur takes its colour from (projectUV)
    if (this.decaled) g.setAttribute('decal', new THREE.Float32BufferAttribute(A.dec, 3)); // pieces with their own picture (projectUV)
    g.computeBoundingSphere(); g.userData.keep = true; g.userData.tris = start / 3;
    return g;
  }
}
// ---------- projection texturing ----------
// A rig with a reference sheet is textured by projecting the sheet's orthographic views onto it: each
// body triangle takes the view it faces most (front, side, back, top) and the model's extent in that
// view is mapped onto the view's silhouette in the atlas (tools/atlas.py). The side view is a left
// profile; the right side reuses it, except where o.mirrorSkip says the left side carries something
// the right does not (the guardian's shield), where it falls back to the front or back view.
const VIEW = { front: (x, y, z) => [x, -y], back: (x, y, z) => [-x, -y], side: (x, y, z) => [-z, -y], sideFlip: (x, y, z) => [z, -y], top: (x, y, z) => [x, z] };
export function projectUV(geo, atlas, extra = [], o = {}) {
  // a tuft of fur is 'pinned' to its root: the whole blade takes the colour of the coat it grows from,
  // and its tip, standing off the body, neither samples past the silhouette nor stretches the mapping
  const P = geo.attributes.pin || geo.attributes.position, DEC = geo.attributes.decal, N = geo.attributes.normal, n = P.count, names = Object.keys(atlas.views).filter((v) => VIEW[v]), ext = {};
  const VF = (v) => (v === 'side' && atlas.sideFlip ? VIEW.sideFlip : VIEW[v]); // some sheets draw the profile facing right
  for (const v of names) {
    const e = (ext[v] = [1e9, -1e9, 1e9, -1e9]), f = VF(v);
    const grow = (x, y, z) => { const [h, d] = f(x, y, z); e[0] = Math.min(e[0], h); e[1] = Math.max(e[1], h); e[2] = Math.min(e[2], d); e[3] = Math.max(e[3], d); };
    for (let i = 0; i < n; i++) if (!DEC || !DEC.getZ(i)) grow(P.getX(i), P.getY(i), P.getZ(i));
    for (const p of extra) grow(p[0], p[1], p[2]);
    if (o.ext && o.ext[v]) o.ext[v].forEach((val, i) => { if (val != null) e[i] = val; }); // a view drawn in another pose than the model (the wolf's tail)
  }
  const map = (view, i, out, j) => {
    const R = atlas.views[view], e = ext[view], [h, d] = VF(view)(P.getX(i), P.getY(i), P.getZ(i));
    out[j * 2] = R[0] + ((h - e[0]) / (e[1] - e[0])) * (R[2] - R[0]); out[j * 2 + 1] = 1 - (R[1] + ((d - e[2]) / (e[3] - e[2])) * (R[3] - R[1]));
  };
  // per vertex: the dominant view's uv (bump map), and the three candidates the map blends between:
  // front-or-back (by the triangle's facing), the side, the top; weights from the smooth normal
  const uv = new Float32Array(n * 2), uvF = new Float32Array(n * 2), uvS = new Float32Array(n * 2), uvT = new Float32Array(n * 2), uvW = new Float32Array(n * 3);
  const hasS = !!ext.side, hasT = !!ext.top, hasF = !!ext.front, hasB = !!ext.back, pw = o.blend ?? 4;
  const g0 = geo.groups.find((g) => g.materialIndex === 0), a = new V3(), b = new V3(), c = new V3(), nr = new V3(), cen = new V3(), w = {};
  for (let t = g0.start; t < g0.start + g0.count; t += 3) {
    a.fromBufferAttribute(geo.attributes.position, t); b.fromBufferAttribute(geo.attributes.position, t + 1); c.fromBufferAttribute(geo.attributes.position, t + 2);
    nr.subVectors(c, b).cross(_s3.subVectors(a, b)).normalize(); cen.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    if (DEC && DEC.getZ(t) > 0) { // a decal: the piece carries its own picture (a shield's face), not the views
      for (let k = 0; k < 3; k++) { const i = t + k, u = DEC.getX(i), v = 1 - DEC.getY(i); for (const A of [uv, uvF, uvS, uvT]) { A[i * 2] = u; A[i * 2 + 1] = v; } uvW[i * 3] = 1; uvW[i * 3 + 1] = uvW[i * 3 + 2] = 0; }
      continue;
    }
    if (!names.length) continue; // an atlas of decals only (the choir)
    const noSide = (atlas.sideFlip ? nr.x > 0 : nr.x < 0) && o.mirrorSkip && o.mirrorSkip(cen.x, cen.y, cen.z); // the side that reuses the profile mirrored
    w.front = nr.z; w.back = -nr.z; w.top = nr.y; w.side = noSide ? -9 : Math.abs(nr.x) * (o.sideBias || 1);
    let best = names[0];
    for (const v of names) if (w[v] > w[best]) best = v;
    const fb = hasF && (nr.z >= 0 || !hasB) ? 'front' : hasB ? 'back' : null;
    for (let k = 0; k < 3; k++) {
      const i = t + k; map(best, i, uv, i);
      if (fb) map(fb, i, uvF, i); if (hasS) map('side', i, uvS, i); if (hasT) map('top', i, uvT, i);
      let wf = fb ? Math.pow(Math.abs(N.getZ(i)), pw) : 0, ws = hasS && !noSide ? Math.pow(Math.abs(N.getX(i)) * (o.sideBias || 1), pw) : 0, wt = hasT ? Math.pow(Math.max(0, N.getY(i)), pw) : 0;
      const sum = wf + ws + wt;
      if (sum < 1e-4) { wf = best === fb ? 1 : 0; ws = best === 'side' ? 1 : 0; wt = best === 'top' ? 1 : 0; if (!(wf + ws + wt)) { wf = 1; if (!fb) map(best, i, uvF, i); } }
      else { wf /= sum; ws /= sum; wt /= sum; }
      uvW[i * 3] = wf; uvW[i * 3 + 1] = ws; uvW[i * 3 + 2] = wt;
    }
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setAttribute('uvF', new THREE.Float32BufferAttribute(uvF, 2));
  geo.setAttribute('uvS', new THREE.Float32BufferAttribute(uvS, 2)); geo.setAttribute('uvT', new THREE.Float32BufferAttribute(uvT, 2)); geo.setAttribute('uvW', new THREE.Float32BufferAttribute(uvW, 3));
}
const TEX = {};
function atlasTexture(name, url, srgb = true) {
  if (!TEX[name]) { const t = new THREE.TextureLoader().load(url); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; TEX[name] = t; }
  return TEX[name];
}
// decode every atlas up front, so nothing is drawn black for the moment its texture is still loading
if (typeof document !== 'undefined') for (const k in ATLAS) { atlasTexture(k, ATLAS[k].url); if (ATLAS[k].glowUrl) atlasTexture(k + '_glow', ATLAS[k].glowUrl, false); }
// the body material for a rig: textured from its atlas when it has one (vertex colours otherwise).
// Rigs with glowFromMap light the molten seams painted into their texture: m.userData.glow sets how hot.
export function rigMaterial(rig, post = (m) => m) {
  const m = post(new THREE.MeshStandardMaterial({ vertexColors: !rig.atlas, roughness: rig.roughness, metalness: 0, side: rig.side, dithering: true, emissive: 0x000000 }));
  if (!rig.atlas) return m;
  m.map = m.bumpMap = atlasTexture(rig.atlasName, rig.atlas.url); m.bumpScale = rig.bump ?? 1.5;
  const glow = rig.glowFromMap && rig.atlas.glowUrl ? (m.userData.glow = { value: 0 }) : null, prev = m.onBeforeCompile, key = m.customProgramCacheKey;
  const glowMap = glow ? { value: atlasTexture(rig.atlasName + '_glow', rig.atlas.glowUrl, false) } : null;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    sh.vertexShader = 'attribute vec2 uvF;\nattribute vec2 uvS;\nattribute vec2 uvT;\nattribute vec3 uvW;\nvarying vec2 vUvF;\nvarying vec2 vUvS;\nvarying vec2 vUvT;\nvarying vec3 vUvW;\n' +
      sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n vUvF = uvF; vUvS = uvS; vUvT = uvT; vUvW = uvW;');
    // blend the views by the surface's facing, so the seams between them melt
    let fs = 'varying vec2 vUvF;\nvarying vec2 vUvS;\nvarying vec2 vUvT;\nvarying vec3 vUvW;\n' + sh.fragmentShader.replace('#include <map_fragment>',
      `vec3 wsum = vUvW / max(0.0001, vUvW.x + vUvW.y + vUvW.z);
      vec4 blendMap = texture2D(map, vUvF) * wsum.x + texture2D(map, vUvS) * wsum.y + texture2D(map, vUvT) * wsum.z;
      diffuseColor *= blendMap;`);
    if (glow) { // the molten seams: a baked mask, blended the same way, lit an ember orange
      sh.uniforms.uGlow = glow; sh.uniforms.glowMap = glowMap;
      fs = 'uniform float uGlow;\nuniform sampler2D glowMap;\n' + fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float seam = texture2D(glowMap, vUvF).r * wsum.x + texture2D(glowMap, vUvS).r * wsum.y + texture2D(glowMap, vUvT).r * wsum.z;
        totalEmissiveRadiance += vec3(1.5, 0.52, 0.1) * seam * uGlow;`);
    }
    sh.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => (key ? key.call(m) : '') + (glow ? 'proj-glow' : 'proj');
  return m;
}
const bones = (list) => list.map(([name, parent, x, y, z]) => ({ name, parent, pos: [x, y, z] }));
// blend helper: weights along one axis between named stops [[value, bone], ...]
const along1 = (stops) => (v) => {
  if (v <= stops[0][0]) return [stops[0][1], 1];
  for (let i = 0; i < stops.length - 1; i++) { const [a, ba] = stops[i], [b, bb] = stops[i + 1]; if (v <= b) { const k = (v - a) / (b - a); return [ba, 1 - k, bb, k]; } }
  return [stops[stops.length - 1][1], 1];
};
const Q = (q, arr) => arr[q];

// Every rig returns { def, geo, eyes:{bone, pos(model space), pair}, glint, glow, accent:'glow'|'steel'|null, height, roughness, side }
// =====================================================================
//  WOLF (CR01) — a starving grey wolf, 1.08 m to the ear tips and 1.38 m
//  nose to tail. Measured off its sheet (z = 0.8 - distance from the nose):
//  a thick ruff, a deep chest over a tucked waist, haunches, and a bushy tail
//  hanging straight down behind them. Raised hackles, a jaw that opens.
//  Then the sheet is projected on: the coat, the eyes and the dark saddle.
// =====================================================================
function wolf(q) {
  srand(1001 + q);
  const def = bones([
    ['root', null, 0, 0, 0], ['pelvis', 'root', 0, 0.7, -0.28], ['spine', 'pelvis', 0, 0.72, 0], ['chest', 'spine', 0, 0.72, 0.28],
    ['hackles', 'spine', 0, 0.88, 0.12], ['neck', 'chest', 0, 0.8, 0.44], ['head', 'neck', 0, 0.87, 0.6], ['jaw', 'head', 0, 0.775, 0.67],
    ['earL', 'head', 0.055, 0.97, 0.6], ['earR', 'head', -0.055, 0.97, 0.6],
    // the near (left) foreleg a stride ahead of the far one, the near hind leg a little behind, as drawn
    ['FLu', 'chest', 0.08, 0.72, 0.3], ['FLl', 'FLu', 0.08, 0.45, 0.28], ['FLf', 'FLl', 0.073, 0.11, 0.295],
    ['FRu', 'chest', -0.08, 0.72, 0.28], ['FRl', 'FRu', -0.08, 0.45, 0.23], ['FRf', 'FRl', -0.073, 0.11, 0.245],
    ['HLu', 'pelvis', 0.1, 0.74, -0.31], ['HLl', 'HLu', 0.102, 0.44, -0.24], ['HLf', 'HLl', 0.1, 0.2, -0.43],
    ['HRu', 'pelvis', -0.1, 0.74, -0.31], ['HRl', 'HRu', -0.102, 0.44, -0.21], ['HRf', 'HRl', -0.1, 0.2, -0.39],
    ['tail1', 'pelvis', 0, 0.73, -0.36], ['tail2', 'tail1', 0, 0.6, -0.45], ['tail3', 'tail2', 0, 0.4, -0.5],
  ]);
  const B = new RigBuilder(def), radial = Q(q, [8, 14, 20, 26]), rings = Q(q, [8, 16, 24, 32]), tuftSides = q >= 2 ? 5 : 4;
  // fallback colours only (the coat comes from the sheet): a dark saddle over buff flanks and a pale belly
  const back = C(0x1e1a17), side = C(0x5a5046), belly = C(0x9a8c78), muzzleC = C(0x8a7e6e), dark = C(0x141210), inner = C(0x4a3430);
  const fur = (k = 1) => (x, y, z) => { const t = clamp((y - 0.5) / 0.4, 0, 1), c = t < 0.5 ? mixc(belly, side, t * 2) : mixc(side, back, (t - 0.5) * 2), n = 0.82 + 0.36 * noise(x * 13, y * 13, z * 13); return shade(c, n * k); };
  const shag = (amp, f = 1) => (a, t) => 1 + amp * nz3(Math.cos(a) * 3 * f, t * 14 * f, Math.sin(a) * 3 * f);
  // torso: a deep chest (0.47–0.93 m), the waist tucked up to 0.54, the hips, the rump
  const torso = [{ p: [0, 0.79, 0.43], r: [0.115, 0.15] }, { p: [0, 0.705, 0.33], r: [0.14, 0.225] }, { p: [0, 0.67, 0.2], r: [0.145, 0.21] }, { p: [0, 0.665, 0.08], r: [0.135, 0.195] },
    { p: [0, 0.675, -0.04], r: [0.115, 0.165] }, { p: [0, 0.68, -0.14], r: [0.108, 0.14] }, { p: [0, 0.665, -0.26], r: [0.12, 0.15] }, { p: [0, 0.665, -0.37], r: [0.1, 0.11] }, { p: [0, 0.67, -0.43], r: [0.05, 0.055] }];
  const bodyBind = (x, y, z) => along1([[-0.28, 'pelvis'], [0, 'spine'], [0.28, 'chest']])(z);
  B.add(loft(torso, { radial: radial + 4, rings: rings + 4, shape: shag(0.035) }), bodyBind, fur());
  // neck: thick with the ruff, carried low and forward
  const neckC = [{ p: [0, 0.77, 0.38], r: [0.125, 0.17] }, { p: [0, 0.79, 0.48], r: [0.12, 0.17] }, { p: [0, 0.83, 0.55], r: [0.11, 0.15] }, { p: [0, 0.87, 0.64], r: [0.065, 0.075] }];
  const neckBind = (x, y, z) => along1([[0.4, 'chest'], [0.47, 'neck'], [0.6, 'head']])(z);
  B.add(loft(neckC, { radial, rings: Math.max(5, rings >> 1), shape: shag(0.06) }), neckBind, fur(0.95));
  const tuft = (s, dir, len, r, bind, colr, slot = 0) => B.add(cone(tuftSides, r, len), bind, colr, { flat: true, matrix: along(s, dir), slot, pin: slot ? null : s });
  const furTufts = (ctrl, n, bind, tMin, tMax, aMin, aMax, drift, lenK = 1, ref = [0, 1, 0]) => {
    for (let i = 0; i < n; i++) {
      const t = rr(tMin, tMax), a = rr(aMin, aMax), s = loftSurface(ctrl, t, a, ref, 0.9);
      // fur lies down along the body: a flattened blade, pointing back (or down), coloured like the coat under it
      const dir = s.n.clone().multiplyScalar(0.2).add(drift).normalize(), fc = fur(0.8 + 0.35 * rnd())(s.p.x, s.p.y, s.p.z);
      B.add(cone(tuftSides, rr(0.014, 0.022), rr(0.04, 0.065) * lenK), bind, fc, { flat: true, matrix: along(s.p, dir, 1, 1, 0.35, Math.atan2(s.n.x, s.n.z)), pin: s.p });
    }
  };
  furTufts(neckC, Q(q, [6, 18, 34, 54]), neckBind, 0.05, 0.85, -0.3, Math.PI + 0.3, new V3(0, -0.15, -1), 1.1);
  furTufts(torso, Q(q, [0, 20, 44, 90]), bodyBind, 0.12, 0.88, -0.2, Math.PI + 0.2, new V3(0, -0.1, -1));
  // the shaggy fringe that hangs off the chest and belly
  furTufts(torso, Q(q, [2, 8, 14, 22]), bodyBind, 0.12, 0.55, -Math.PI / 2 - 0.8, -Math.PI / 2 + 0.8, new V3(0, -0.7, -1), 0.6);
  // hackles from the crown of the neck down the back: raised by scaling their bone when the wolf means it
  for (let i = 0, n = Q(q, [6, 18, 32, 48]); i < n; i++) {
    const k = i / (n - 1), onNeck = k < 0.4, s = onNeck ? loftSurface(neckC, 1 - k / 0.4 * 0.85, Math.PI / 2 + rr(-0.35, 0.35), [0, 1, 0], 0.95) : loftSurface(torso, lerp(0.02, 0.5, (k - 0.4) / 0.6), Math.PI / 2 + rr(-0.35, 0.35), [0, 1, 0], 0.95);
    tuft(s.p, new V3(rr(-0.2, 0.2), 1, -1.3).normalize(), rr(0.035, 0.065) * (1 - 0.5 * k), 0.011, 'hackles', shade(back, 0.75 + 0.2 * rnd()));
  }
  // head: skull, muzzle, nose, brows, eyes, teeth, ears, cheek ruff
  const d = Q(q, [1, 2, 3, 3]);
  const headCol = (x, y, z) => (z > 0.7 && y < 0.86 ? shade(muzzleC, 0.85 + 0.25 * noise(x * 20, y * 20, z * 20)) : fur(1)(x, y - 0.1, z));
  B.add(blob(d, (x, y, z) => [x * (1 - 0.3 * Math.max(0, z)), y * (y > 0 ? 0.86 - 0.25 * Math.max(0, z) : 1), z]), 'head', headCol, { matrix: M(0, 0.875, 0.628, 0, 0, 0, 0.085, 0.1, 0.095) });
  B.add(loft([{ p: [0, 0.85, 0.68], r: [0.062, 0.06] }, { p: [0, 0.82, 0.73], r: [0.05, 0.05] }, { p: [0, 0.8, 0.77], r: [0.036, 0.034] }, { p: [0, 0.79, 0.79], r: [0.024, 0.022] }], { radial, rings: Math.max(4, rings >> 1) }), 'head', headCol);
  B.add(blob(Q(q, [1, 1, 2, 2])), 'head', C(0x0c0a0a), { slot: 1, matrix: M(0, 0.79, 0.787, 0, 0, 0, 0.022, 0.017, 0.016) });   // nose
  const eyeC = (x, y, z, nx, ny, nz) => (nz > 0.3 ? [0.16, 0.09, 0.02] : [0.03, 0.02, 0.02]);
  for (const sx of [-1, 1]) B.add(blob(Q(q, [1, 1, 2, 2])), 'head', eyeC, { slot: 1, matrix: M(sx * 0.058, 0.889, 0.678, 0, sx * 0.6, 0, 0.01, 0.0085, 0.009) });
  const ivory = C(0xd8ceb8);
  for (const sx of [-1, 1]) {
    // the mouth is shut at rest (the canines' tips sit inside the other jaw); they show when it opens
    tuft(new V3(sx * 0.019, 0.775, 0.765), new V3(0, -1, 0.1), 0.02, 0.0055, 'head', ivory, 1);  // upper canines
    for (let i = 0; i < Q(q, [0, 2, 4, 5]); i++) tuft(new V3(sx * (0.022 + i * 0.003), 0.788, 0.745 - i * 0.02), new V3(0, -1, 0), 0.014, 0.004, 'head', ivory, 1);
    tuft(new V3(sx * 0.016, 0.752, 0.752), new V3(0, 1, 0.1), 0.016, 0.005, 'jaw', ivory, 1);      // lower canines
  }
  B.add(loft([{ p: [0, 0.775, 0.65], r: [0.048, 0.022] }, { p: [0, 0.766, 0.72], r: [0.038, 0.018] }, { p: [0, 0.762, 0.767], r: [0.026, 0.012] }], { radial, rings: 6 }), 'jaw', shade(muzzleC, 0.85));
  B.add(blob(1), 'jaw', C(0x6a3a3a), { matrix: M(0, 0.768, 0.72, 0, 0, 0, 0.022, 0.007, 0.05) }); // tongue
  for (const [sx, bone] of [[1, 'earL'], [-1, 'earR']]) {
    const ear = cone(Q(q, [3, 4, 6, 8]), 0.044, 0.105);
    B.add(ear, bone, (x, y, z, nx, ny, nz) => (nz > 0.2 ? shade(inner, 0.8) : shade(back, 0.9)), { flat: q < 2, matrix: M(sx * 0.055, 0.962, 0.6, 0.05, 0, -sx * 0.2, 1, 1, 0.72) });
  }
  // the ruff around the cheeks and throat
  for (let i = 0; i < Q(q, [0, 4, 8, 12]); i++) { const sx = i % 2 ? 1 : -1, y = rr(0.76, 0.84), z = rr(0.55, 0.6); tuft(new V3(sx * 0.07, y, z), new V3(sx * 0.5, -0.4, -0.8).normalize(), rr(0.04, 0.06), 0.02, 'head', shade(side, 0.9 + 0.2 * rnd())); }
  // legs: long and lean, buff below the elbow, big splayed paws
  const legCol = (x, y, z) => shade(mixc(belly, side, 0.3 + clamp((y - 0.1) / 0.6, 0, 1) * 0.5), 0.8 + 0.3 * noise(x * 15, y * 15, z * 15));
  const lr = Math.max(6, radial - 4), lrings = Math.max(4, rings >> 1);
  const paw = (x, z, bone) => {
    B.add(blob(Q(q, [1, 1, 2, 2])), bone, shade(belly, 0.75), { matrix: M(x, 0.03, z + 0.03, 0, 0, 0, 0.04, 0.03, 0.058) });
    for (let i = 0; i < 4; i++) {
      const ox = (i - 1.5) * 0.018;
      if (q > 0) B.add(blob(1), bone, shade(belly, 0.7), { matrix: M(x + ox * 1.2, 0.022, z + 0.075 - Math.abs(ox) * 0.6, 0, 0, 0, 0.012, 0.013, 0.016) });
      tuft(new V3(x + ox * 1.2, 0.016, z + 0.088 - Math.abs(ox) * 0.6), new V3(0, -0.4, 1).normalize(), 0.016, 0.0045, bone, C(0x1a1612), 1);
    }
  };
  for (const sx of [1, -1]) {
    const F = sx > 0 ? 'FL' : 'FR', Hh = sx > 0 ? 'HL' : 'HR', fz = sx * 0.025, hz = -sx * 0.02;
    B.add(loft([{ p: [sx * 0.07, 0.74, 0.31], r: [0.04, 0.08] }, { p: [sx * 0.085, 0.6, 0.28 + fz * 0.5], r: [0.05, 0.07] }, { p: [sx * 0.08, 0.45, 0.255 + fz], r: [0.04, 0.052] }], { radial: lr, rings: lrings, ref: [0, 0, 1], shape: shag(0.05) }), F + 'u', legCol);
    B.add(loft([{ p: [sx * 0.08, 0.46, 0.255 + fz], r: [0.035, 0.045] }, { p: [sx * 0.076, 0.27, 0.265 + fz], r: [0.03, 0.038] }, { p: [sx * 0.073, 0.11, 0.27 + fz], r: [0.026, 0.032] }], { radial: lr, rings: lrings, ref: [0, 0, 1], shape: shag(0.04) }), F + 'l', legCol);
    B.add(loft([{ p: [sx * 0.073, 0.12, 0.27 + fz], r: [0.026, 0.032] }, { p: [sx * 0.074, 0.04, 0.29 + fz], r: [0.026, 0.032] }], { radial: lr, rings: 4, ref: [0, 0, 1] }), F + 'f', legCol);
    paw(sx * 0.075, 0.295 + fz, F + 'f');
    // the hind leg: a heavy haunch, the stifle forward, a long shank back to the hock, then straight down
    B.add(loft([{ p: [sx * 0.055, 0.76, -0.31], r: [0.035, 0.08] }, { p: [sx * 0.09, 0.64, -0.3], r: [0.058, 0.125] }, { p: [sx * 0.1, 0.52, -0.27 + hz * 0.5], r: [0.048, 0.095] }, { p: [sx * 0.102, 0.44, -0.225 + hz], r: [0.038, 0.058] }], { radial: lr + 2, rings: lrings + 2, ref: [0, 0, 1], shape: shag(0.04) }), Hh + 'u', legCol);
    B.add(loft([{ p: [sx * 0.102, 0.45, -0.23 + hz], r: [0.036, 0.06] }, { p: [sx * 0.1, 0.32, -0.33 + hz], r: [0.031, 0.052] }, { p: [sx * 0.1, 0.2, -0.41 + hz], r: [0.027, 0.04] }], { radial: lr, rings: lrings, ref: [0, 0, 1], shape: shag(0.04) }), Hh + 'l', legCol);
    B.add(loft([{ p: [sx * 0.1, 0.21, -0.415 + hz], r: [0.027, 0.034] }, { p: [sx * 0.1, 0.05, -0.39 + hz], r: [0.026, 0.032] }], { radial: lr, rings: 4, ref: [0, 0, 1] }), Hh + 'f', legCol);
    paw(sx * 0.1, -0.385 + hz, Hh + 'f');
  }
  // tail: bushy, hanging straight down behind the haunches, darker toward the tip
  const tailC = [{ p: [0, 0.72, -0.35], r: [0.04, 0.04] }, { p: [0, 0.69, -0.41], r: [0.05, 0.05] }, { p: [0, 0.6, -0.45], r: [0.055, 0.06] }, { p: [0, 0.45, -0.49], r: [0.06, 0.062] },
    { p: [0, 0.3, -0.53], r: [0.055, 0.052] }, { p: [0, 0.2, -0.54], r: [0.04, 0.04] }, { p: [0, 0.15, -0.53], r: [0.01, 0.01] }];
  const tailBind = (x, y, z) => along1([[0.4, 'tail3'], [0.6, 'tail2'], [0.73, 'tail1']])(y);
  B.add(loft(tailC, { radial: Math.max(6, radial - 2), rings, ref: [0, 0, 1], shape: shag(0.12, 1.4) }), tailBind, (x, y, z) => shade(y < 0.3 ? dark : mixc(side, back, 0.5), 0.85 + 0.3 * noise(x * 12, y * 12, z * 12)));
  furTufts(tailC, Q(q, [0, 8, 14, 22]), tailBind, 0.12, 0.85, 0, TAU, new V3(0, -1, 0), 0.9, [0, 0, 1]);
  return { def, geo: B.build(), eyes: { bone: 'head', pos: [0, 0.889, 0.686], spread: 0.056, n: 2 }, height: 1.08, roughness: 0.95, side: THREE.FrontSide, accent: null,
    // the top view lies the tail out straight behind (1.51 m long): map it over the same nose-to-tail span
    uvOpts: { ext: { top: [null, null, 0.8 - 1.51, 0.8] } } };
}

// =====================================================================
//  SHADE LEECH — annulated, wet, a lamprey mouth ringed with teeth,
//  tendrils, one pale eye, and faint violet pustules that glow on their own.
// =====================================================================
const LEECH_N = 10;
function leech(q) {
  srand(2002 + q);
  const segZ = (i) => 0.75 - i * 0.2;
  const list = [['root', null, 0, 0, 0]];
  for (let i = 0; i < LEECH_N; i++) list.push(['s' + i, 'root', 0, 0.28 - i * 0.006, segZ(i)]);
  list.push(['mouth', 's0', 0, 0.29, 0.93]);
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + 0.3, x = Math.cos(a) * 0.12, y = 0.29 + Math.sin(a) * 0.1; list.push(['t' + k + 'a', 's0', x, y, 0.93], ['t' + k + 'b', 't' + k + 'a', x * 1.5, y + Math.sin(a) * 0.03, 1.07]); }
  const def = bones(list), B = new RigBuilder(def), radial = Q(q, [8, 16, 24, 32]), rings = Q(q, [12, 30, 48, 64]);
  const skin = C(0x1c1524), ridge = C(0x3a2b4c), under = C(0x4a3e58), lip = C(0x4a2a3a), ivory = C(0xd8d0c0), glow = C(0xb48cff);
  const stops = []; for (let i = LEECH_N - 1; i >= 0; i--) stops.push([segZ(i), 's' + i]);
  const segBind = (x, y, z) => along1(stops)(z);
  const body = [{ p: [0, 0.29, 0.96], r: [0.16, 0.14] }, { p: [0, 0.3, 0.55], r: [0.23, 0.19] }, { p: [0, 0.28, 0.1], r: [0.26, 0.21] },
    { p: [0, 0.26, -0.4], r: [0.22, 0.17] }, { p: [0, 0.23, -0.85], r: [0.13, 0.1] }, { p: [0, 0.2, -1.2], r: [0.03, 0.03] }];
  const annuli = 26;
  B.add(loft(body, { radial, rings, shape: (a, t) => (1 + 0.05 * Math.cos(t * annuli * TAU)) * (Math.sin(a) < 0 ? 1 - 0.28 * -Math.sin(a) : 1) * (1 + 0.025 * nz3(Math.cos(a) * 4, t * 30, Math.sin(a) * 4)) }), segBind,
    (x, y, z, nx, ny) => { const band = 0.5 + 0.5 * Math.cos(((0.96 - z) / 2.16) * annuli * TAU); if (ny < -0.3) return shade(under, 0.8 + 0.2 * band); const stripe = Math.abs(x) < 0.05 ? 1.5 : 1, sp = noise(x * 30, y * 30, z * 30) > 0.82 ? 1.8 : 1; return shade(mixc(skin, ridge, band * 0.6), stripe * sp * (0.85 + 0.2 * band)); });
  // dorsal frill
  for (let i = 0, n = Q(q, [6, 16, 28, 44]); i < n; i++) {
    const t = lerp(0.12, 0.85, i / (n - 1)), s = loftSurface(body, t, Math.PI / 2, [0, 1, 0], 0.97);
    B.add(cone(3, 0.03, rr(0.07, 0.12)), segBind, shade(ridge, 0.7), { flat: true, matrix: along(s.p, new V3(0, 1, -0.9).normalize(), 1, 1, 0.3) });
  }
  // glowing pustules down both flanks
  for (const side of [1, -1]) for (let i = 0, n = Q(q, [3, 8, 14, 22]); i < n; i++) {
    const t = lerp(0.15, 0.8, i / Math.max(1, n - 1)) + rr(-0.02, 0.02), s = loftSurface(body, t, side > 0 ? rr(-0.1, 0.35) : Math.PI - rr(-0.1, 0.35), [0, 1, 0], 0.98), r = rr(0.012, 0.024);
    B.add(blob(1), segBind, shade(glow, rr(0.6, 1.1)), { slot: 2, matrix: M(s.p.x, s.p.y, s.p.z, 0, 0, 0, r, r, r) });
  }
  // the mouth: lips, a dark throat, three rings of hooked teeth pointing in
  B.add(new THREE.TorusGeometry(0.115, 0.034, Q(q, [5, 8, 10, 12]), Q(q, [10, 18, 26, 34])), 'mouth', lip, { matrix: M(0, 0.29, 0.955, 0, 0, 0, 1, 0.88, 1) });
  B.add(new THREE.CircleGeometry(0.1, 20), 'mouth', C(0x070407), { matrix: M(0, 0.29, 0.945) });
  for (let ring = 0; ring < 3; ring++) {
    const n = Q(q, [6, 10, 14, 18]) - ring * 2, rad = 0.095 - ring * 0.028, z = 0.95 - ring * 0.012;
    for (let k = 0; k < n; k++) { const a = (k / n) * TAU + ring * 0.3, p = new V3(Math.cos(a) * rad, 0.29 + Math.sin(a) * rad * 0.88, z); tuft(p, new V3(-Math.cos(a), -Math.sin(a), 0.5).normalize(), 0.028 - ring * 0.005, 0.008, 'mouth', ivory, 1); }
  }
  function tuft(p, dir, len, r, bind, colr, slot = 0) { B.add(cone(4, r, len), bind, colr, { flat: true, matrix: along(p, dir), slot }); }
  // tendrils
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + 0.3, x = Math.cos(a) * 0.12, y = 0.29 + Math.sin(a) * 0.1;
    const ctrl = [{ p: [x, y, 0.93], r: [0.022, 0.022] }, { p: [x * 1.3, y + Math.sin(a) * 0.015, 1.03], r: [0.016, 0.016] }, { p: [x * 1.7, y + Math.sin(a) * 0.05, 1.16], r: [0.005, 0.005] }];
    B.add(loft(ctrl, { radial: Math.max(5, radial >> 2), rings: Q(q, [4, 8, 10, 14]), ref: [0, 1, 0] }), (px, py, pz) => along1([[0.98, 't' + k + 'a'], [1.08, 't' + k + 'b']])(pz), (px, py, pz) => shade(lip, 0.8 + (pz - 0.93) * 2));
  }
  // the eye: pale, wet, a slit pupil, a heavy lid
  B.add(blob(Q(q, [1, 2, 3, 3])), 's0', (x, y, z, nx, ny, nz) => (nz > 0.86 && Math.abs(nx) < 0.18 ? [0.02, 0.01, 0.03] : [0.72, 0.66, 0.84]), { slot: 1, matrix: M(0, 0.44, 0.67, -0.2, 0, 0, 0.058, 0.058, 0.058) });
  B.add(blob(Q(q, [1, 2, 2, 3]), (x, y, z) => [x, Math.max(y, -0.1), z]), 's0', shade(skin, 1.3), { matrix: M(0, 0.47, 0.655, -0.35, 0, 0, 0.07, 0.045, 0.07) });
  return { def, geo: B.build(), eyes: { bone: 's0', pos: [0, 0.44, 0.73], spread: 0, n: 1 }, height: 0.6, roughness: 0.55, side: THREE.FrontSide, accent: 'glow' };
}

// =====================================================================
//  EMBER MOTH — over a metre across. Dusty patterned wings with eyespots
//  that smoulder, a furred thorax, feathered antennae, a glowing belly.
// =====================================================================
function moth(q) {
  srand(3003 + q);
  const def = bones([['root', null, 0, 0, 0], ['thorax', 'root', 0, 0, 0], ['head', 'thorax', 0, 0.01, 0.13], ['antL', 'head', 0.03, 0.05, 0.17], ['antR', 'head', -0.03, 0.05, 0.17],
    ['abd1', 'thorax', 0, -0.01, -0.1], ['abd2', 'abd1', 0, -0.03, -0.3], ['fwL', 'thorax', 0.07, 0.03, 0.04], ['hwL', 'thorax', 0.06, 0.0, -0.05], ['fwR', 'thorax', -0.07, 0.03, 0.04], ['hwR', 'thorax', -0.06, 0.0, -0.05]]);
  const B = new RigBuilder(def), d = Q(q, [1, 2, 2, 3]), fuzz = C(0x8a7450), brown = C(0x3a2c1e), dark = C(0x1e140a), cream = C(0xb8a070), base = C(0x6a5232), ember = C(0xff8a30);
  const tuft = (p, dir, len, r, bind, colr, slot = 0) => B.add(cone(3, r, len), bind, colr, { flat: true, matrix: along(p, dir), slot });
  B.add(blob(d), 'thorax', (x, y, z) => shade(brown, 0.8 + 0.4 * noise(x * 40, y * 40, z * 40)), { matrix: M(0, 0, 0, 0, 0, 0, 0.095, 0.09, 0.12) });
  for (let i = 0, n = Q(q, [8, 30, 60, 110]); i < n; i++) { const dir = new V3(rr(-1, 1), rr(-0.3, 1), rr(-1, 1)).normalize(), p = new V3(dir.x * 0.09, dir.y * 0.085, dir.z * 0.11); tuft(p, dir, rr(0.03, 0.055), 0.012, 'thorax', shade(fuzz, 0.75 + 0.35 * rnd())); }
  B.add(blob(d), 'head', shade(brown, 1.1), { matrix: M(0, 0.01, 0.15, 0, 0, 0, 0.06, 0.055, 0.05) });
  for (const sx of [-1, 1]) B.add(blob(d), 'head', (x, y, z) => shade(C(0x2a0806), 0.7 + 0.6 * (noise(x * 160, y * 160, z * 160) > 0.5 ? 1 : 0.4)), { slot: 1, matrix: M(sx * 0.045, 0.016, 0.17, 0, 0, 0, 0.044, 0.046, 0.04) });
  for (const [sx, bone] of [[1, 'antL'], [-1, 'antR']]) {
    const ctrl = [{ p: [sx * 0.03, 0.05, 0.17], r: [0.006, 0.006] }, { p: [sx * 0.09, 0.15, 0.27], r: [0.005, 0.005] }, { p: [sx * 0.2, 0.21, 0.36], r: [0.003, 0.003] }];
    B.add(loft(ctrl, { radial: 4, rings: 6 }), bone, C(0x8a7048));
    for (let i = 0, n = Q(q, [0, 10, 18, 28]); i < n; i++) { const s = loftSurface(ctrl, 0.1 + 0.85 * (i / n), 0, [0, 1, 0], 0); for (const side of [-1, 1]) tuft(s.p, new V3(side * 0.3, -0.4, 1).normalize().applyAxisAngle(new V3(0, 1, 0), sx * 0.5), rr(0.03, 0.05) * (1 - i / n * 0.6), 0.003, bone, C(0x9a8058)); }
  }
  const abdC = [{ p: [0, -0.01, -0.06], r: [0.07, 0.07] }, { p: [0, -0.03, -0.22], r: [0.077, 0.07] }, { p: [0, -0.05, -0.4], r: [0.045, 0.04] }, { p: [0, -0.06, -0.5], r: [0.01, 0.01] }];
  B.add(loft(abdC, { radial: Q(q, [6, 12, 16, 22]), rings: Q(q, [8, 20, 30, 40]), shape: (a, t) => 1 + 0.07 * Math.cos(t * 7 * TAU) }), (x, y, z) => along1([[-0.3, 'abd2'], [-0.12, 'abd1']])(z),
    (x, y, z) => { const t = (-0.06 - z) / 0.44, band = Math.cos(t * 7 * TAU) > 0.3; return shade(band ? fuzz : brown, 0.8 + 0.3 * noise(x * 50, y * 50, z * 50)); });
  for (let i = 0, n = Q(q, [3, 5, 7, 9]); i < n; i++) { const t = 0.15 + 0.6 * (i / n), s = loftSurface(abdC, t, -Math.PI / 2, [0, 1, 0], 0.96), r = 0.03 * (1 - t * 0.6); B.add(blob(1), (x, y, z) => along1([[-0.3, 'abd2'], [-0.12, 'abd1']])(z), ember, { slot: 2, matrix: M(s.p.x, s.p.y, s.p.z, 0, 0, 0, r, r * 0.5, r * 1.2) }); }
  // six legs, thin and jointed, folded under
  for (let i = 0; i < 6; i++) {
    const sx = i % 2 ? 1 : -1, zi = 0.06 - Math.floor(i / 2) * 0.06;
    B.add(loft([{ p: [sx * 0.05, -0.06, zi], r: [0.008, 0.008] }, { p: [sx * 0.13, -0.08, zi + 0.03], r: [0.007, 0.007] }, { p: [sx * 0.16, -0.2, zi + 0.05], r: [0.004, 0.004] }], { radial: 4, rings: 5 }), 'thorax', dark);
  }
  // wings: a grid shaped to an outline, patterned in vertex colour, with a smouldering eyespot
  for (const [sx, fw, hw] of [[1, 'fwL', 'hwL'], [-1, 'fwR', 'hwR']]) {
    wingIndexed(B, q, 0.62, (u) => 0.06 + 0.07 * u, (u) => 0.12 + 0.2 * Math.sin(Math.PI * (0.15 + 0.7 * u)), [0.62, 0.52], fw, sx, false, { base, dark, cream, ember });
    wingIndexed(B, q, 0.46, (u) => -0.02 - 0.04 * u, (u) => 0.18 + 0.12 * Math.sin(Math.PI * u), [0.55, 0.5], hw, sx, true, { base, dark, cream, ember });
  }
  return { def, geo: B.build(), eyes: null, height: 0.6, roughness: 0.85, side: THREE.DoubleSide, accent: 'glow', glowBone: 'abd1' };
}
// wings are built per vertex (not per position) so the pattern survives de-indexing
function wingIndexed(B, q, span, front, chord, spot, bone, sx, hind, P) {
  const su = Q(q, [5, 12, 18, 26]), sv = Q(q, [3, 7, 11, 15]);
  const surf = (u, v) => { const ch = chord(u) * (1 - Math.pow(u, 6) * 0.6); return [sx * (0.02 + u * span), 0.03 + 0.012 * Math.sin(Math.PI * v) * u + 0.03 * u * u, front(u) - v * ch + (hind ? -0.05 : 0.04)]; };
  const colAt = (u, v) => {
    const dS = Math.hypot((u - spot[0]) * 1.4, v - spot[1]);
    let c = mixc(P.base, C(0x6e5434), noise(u * 9, v * 9, sx + (hind ? 5 : 0)) * 0.8);
    if (v < 0.1 + 0.05 * Math.sin(u * 20)) c = mixc(c, P.dark, 0.6);
    if (Math.abs(((v * 5 + u * 1.3) % 1) - 0.5) < 0.05 && dS > 0.17) c = mixc(c, P.dark, 0.45);
    if (v > 0.86) c = mixc(P.dark, P.cream, Math.sin(u * 60) > 0.6 ? 0.7 : 0.05);
    if (dS < 0.17) c = dS < 0.13 ? (dS < 0.085 ? mixc(P.dark, P.ember, 0.3) : P.dark) : P.cream;
    const dust = 0.85 + 0.3 * noise(u * 80, v * 80, sx * 7); return [c.r * dust, c.g * dust, c.b * dust];
  };
  const pos = [], col = [];
  const quad = (i, j) => {
    const p = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
    for (const [a, b] of p) { const u = a / su, v = b / sv; pos.push(...surf(u, v)); col.push(...colAt(u, v)); }
  };
  for (let i = 0; i < su; i++) for (let j = 0; j < sv; j++) quad(i, j);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // smooth normals for a gently cambered wing: build an indexed twin for the normals, then copy them over
  const gi = mergeVertices(g.clone()); gi.computeVertexNormals();
  g.computeVertexNormals();
  const nIdx = new Map(); { const P2 = gi.attributes.position, N2 = gi.attributes.normal; for (let i = 0; i < P2.count; i++) nIdx.set(P2.getX(i).toFixed(5) + ',' + P2.getY(i).toFixed(5) + ',' + P2.getZ(i).toFixed(5), [N2.getX(i), N2.getY(i), N2.getZ(i)]); }
  const N = g.attributes.normal, PP = g.attributes.position; for (let i = 0; i < PP.count; i++) { const n = nIdx.get(PP.getX(i).toFixed(5) + ',' + PP.getY(i).toFixed(5) + ',' + PP.getZ(i).toFixed(5)); if (n) N.setXYZ(i, n[0], n[1], n[2]); }
  B.addRaw(g, bone, (i) => [col[i * 3], col[i * 3 + 1], col[i * 3 + 2]]);
  const [ex, ey, ez] = surf(spot[0], spot[1]);
  B.add(new THREE.CircleGeometry(span * 0.055, 14), bone, P.ember, { slot: 2, matrix: M(ex, ey + 0.003, ez, -Math.PI / 2, 0, 0) });
  gi.dispose();
}
// add a non-indexed geometry with its own normals and a per-vertex colour function
RigBuilder.prototype.addRaw = function (g, bind, colorAt, slot = 0) {
  const P = g.attributes.position, N = g.attributes.normal, S = this.slots[slot];
  for (let i = 0; i < P.count; i++) {
    S.p.push(P.getX(i), P.getY(i), P.getZ(i)); S.pin.push(P.getX(i), P.getY(i), P.getZ(i)); S.dec.push(0, 0, 0); S.n.push(N.getX(i), N.getY(i), N.getZ(i)); S.c.push(...colorAt(i));
    S.si.push(this.bi[bind], 0, 0, 0); S.sw.push(1, 0, 0, 0);
  }
  g.dispose();
};

// =====================================================================
//  FOREST BANDIT (CR12) — hooded and bearded, a fur mantle over a laced
//  jerkin, a ragged cloak to the calves, a round shield on the left arm and a
//  sword hanging from the right hand. Built in the sheet's own metres (x and y
//  as the front view; z = the side view + 0.06, so the legs stand at z = 0),
//  then the sheet is projected on (tools/bandit.py cleans the sword and shield
//  out of the side view; the shield's face is its own decal, from CR13).
// =====================================================================
function bandit(q, leader = false) {
  srand(4004 + q + (leader ? 50 : 0));
  const AT = ATLAS[leader ? 'leader' : 'bandit']; // the leader: the same body under his own sheet (CR15), no shield, a longer cloak, a longer blade
  const def = bones([['root', null, 0, 0, 0], ['hips', 'root', 0, 0.95, 0.05], ['spine', 'hips', 0, 1.12, 0.05], ['chest', 'spine', 0, 1.32, 0.05], ['neck', 'chest', 0, 1.5, 0.045], ['head', 'neck', 0, 1.62, 0.05],
    ['shL', 'chest', 0.235, 1.42, 0.01], ['elL', 'shL', 0.31, 1.13, -0.01], ['hdL', 'elL', 0.32, 1.0, 0.2], ['shR', 'chest', -0.235, 1.42, 0.02], ['elR', 'shR', -0.32, 1.15, 0.01], ['hdR', 'elR', -0.395, 0.91, 0.05],
    ['thL', 'hips', 0.1, 0.92, 0.06], ['knL', 'thL', 0.15, 0.48, 0.02], ['ftL', 'knL', 0.175, 0.1, -0.02], ['thR', 'hips', -0.1, 0.92, 0.06], ['knR', 'thR', -0.155, 0.48, 0.02], ['ftR', 'knR', -0.18, 0.1, -0.02],
    ['cloakA', 'chest', 0, 1.44, -0.14], ['cloakB', 'cloakA', 0, 1.0, -0.2]]);
  const B = new RigBuilder(def), radial = Q(q, [8, 14, 20, 26]), rings = Q(q, [6, 12, 18, 24]), d = Q(q, [1, 2, 2, 3]);
  // fallback colours only: the body takes the sheet
  const cloak = C(0x2a2620), jerkin = C(0x3a2a1c), linen = C(0x6a6050), trousers = C(0x2a2722), boots = C(0x2a2018), skin = C(0x7a5a48), fur = C(0x4a4032), steel = C(0xa8b0b8), wood = C(0x4a3424), iron = C(0x3a3a3c), grip = C(0x2a1c12);
  const vary = (c, k = 0.2, f = 20) => (x, y, z) => shade(c, 1 - k / 2 + k * noise(x * f, y * f, z * f));
  const wob = (amp, f = 1) => (a, t) => 1 + amp * nz3(Math.cos(a) * 2 * f, t * 9 * f, Math.sin(a) * 2 * f);
  const tuft = (p, dir, len, r, bind, colr, slot = 0) => B.add(cone(4, r, len), bind, colr, { flat: true, matrix: along(p, dir), slot, pin: slot ? null : p });
  const lr = Math.max(6, radial - 4);
  // legs: the thighs carried a little forward of the boots; boots strapped at the shin, toes turned out
  for (const sx of [1, -1]) {
    const T_ = sx > 0 ? 'L' : 'R', kx = sx * (sx > 0 ? 0.15 : 0.155), ax = sx * (sx > 0 ? 0.175 : 0.18);
    B.add(loft([{ p: [sx * 0.1, 0.96, 0.07], r: [0.09, 0.095] }, { p: [sx * 0.125, 0.72, 0.075], r: [0.08, 0.088] }, { p: [sx * 0.14, 0.57, 0.067], r: [0.072, 0.085] }, { p: [kx, 0.49, 0.03], r: [0.068, 0.068] }], { radial: lr, rings, ref: [0, 0, 1], shape: wob(0.02) }), 'th' + T_, vary(trousers)); // baggy at the front of the thigh
    B.add(loft([{ p: [kx, 0.51, 0.025], r: [0.066, 0.066] }, { p: [sx * 0.168, 0.4, -0.01], r: [0.066, 0.078] }, { p: [ax, 0.2, -0.025], r: [0.06, 0.074] }, { p: [ax, 0.08, -0.02], r: [0.056, 0.068] }], { radial: lr, rings, ref: [0, 0, 1], shape: wob(0.02) }), 'kn' + T_, (x, y, z) => (y < 0.43 ? vary(boots, 0.15)(x, y, z) : vary(trousers)(x, y, z)));
    for (const y of [0.4, 0.34, 0.16]) B.add(new THREE.TorusGeometry(1, 0.11, 4, lr), 'kn' + T_, vary(grip, 0.1), { matrix: M(sx * 0.17, y, -0.022, Math.PI / 2, 0, 0, 0.066, 0.078, 0.066) }); // the straps
    const toe = -sx * 0.26; // the foot: heel at z -0.1, toe at +0.21, turned out
    B.add(blob(d, (x, y, z) => [x * (z > 0.3 ? 0.9 : 1), y < -0.2 ? -0.2 - (-0.2 - y) * 0.25 : y * (z > 0.2 ? 0.75 : 1), z]), 'ft' + T_, vary(boots, 0.15), { matrix: M(ax + sx * 0.02, 0.058, 0.055, 0, toe, 0, 0.064, 0.06, 0.155) }); // a flat sole
  }
  // jerkin and the skirt of it, laced at the front, belted, pouches on the belt
  const tor = [{ p: [0, 0.78, 0.055], r: [0.215, 0.135] }, { p: [0, 0.88, 0.06], r: [0.2, 0.125] }, { p: [0, 0.98, 0.06], r: [0.18, 0.115] }, { p: [0, 1.08, 0.06], r: [0.175, 0.11] },
    { p: [0, 1.2, 0.055], r: [0.18, 0.115] }, { p: [0, 1.32, 0.05], r: [0.195, 0.12] }, { p: [0, 1.42, 0.04], r: [0.2, 0.11] }, { p: [0, 1.5, 0.04], r: [0.1, 0.085] }];
  B.add(loft(tor, { radial: radial + 6, rings: rings + 4, ref: [0, 0, 1], caps: false, shape: (a, t) => (t < 0.15 ? 1 + 0.06 * (0.15 - t) / 0.15 * nz3(a * 4, t * 30, 2) : wob(0.015)(a, t)) }), (x, y, z) => along1([[1.0, 'hips'], [1.12, 'spine'], [1.34, 'chest']])(y), vary(jerkin, 0.3, 14));
  B.add(new THREE.TorusGeometry(1, 0.11, 5, radial * 2), 'hips', vary(grip, 0.15), { matrix: M(0, 1.06, 0.06, Math.PI / 2, 0, 0, 0.188, 0.122, 0.188) }); // belt
  for (const [x, z, w] of [[-0.13, 0.165, 0.1], [0.13, 0.165, 0.085], [0.2, 0.05, 0.07]]) B.add(new THREE.BoxGeometry(w, 0.1, 0.05), 'hips', vary(jerkin, 0.25), { matrix: M(x, 1.0, z, 0, Math.atan2(x, 0.6), 0) });
  // scarf, the face, a short beard
  B.add(loft([{ p: [0, 1.46, 0.05], r: [0.1, 0.095] }, { p: [0, 1.53, 0.06], r: [0.085, 0.085] }, { p: [0, 1.58, 0.06], r: [0.07, 0.07] }], { radial, rings: 5, ref: [0, 0, 1] }), (x, y) => along1([[1.5, 'neck'], [1.58, 'head']])(y), vary(linen, 0.2));
  B.add(blob(d, (x, y, z) => [x * (1 - 0.15 * Math.max(0, z)), y, z]), 'head', vary(skin, 0.15), { matrix: M(0, 1.665, 0.05, 0, 0, 0, 0.082, 0.115, 0.098) });
  B.add(blob(1), 'head', vary(skin, 0.1), { matrix: M(0, 1.655, 0.148, -0.25, 0, 0, 0.016, 0.03, 0.02) }); // nose
  for (let i = 0, n = leader ? 0 : Q(q, [4, 12, 22, 34]); i < n; i++) { const a = rr(-1.1, 1.1), p = new V3(Math.sin(a) * 0.07, rr(1.56, 1.62), 0.05 + Math.cos(a) * 0.085); tuft(p, new V3(Math.sin(a) * 0.3, -1, 0.3).normalize(), rr(0.035, 0.06), 0.014, 'head', vary(C(0x4a3e34), 0.3, 40)); }
  // hood: a shell around the head, its opening pushed back off the face, a peak at the back
  B.add(blob(d + 1, (x, y, z) => { const open = z > 0.3 && y < 0.5 && Math.abs(x) < 0.7, peak = Math.max(0, y - 0.2) * Math.max(0, -z - 0.1) * 0.5; return [x * (1 - 0.18 * Math.max(0, y)), y + peak, open ? 0.3 + (z - 0.3) * 0.12 : z - peak * 0.4]; }), 'head', vary(cloak, 0.25), { matrix: M(0, 1.7, 0.035, -0.1, 0, 0, 0.138, 0.158, 0.15) });
  // fur mantle: a shaggy cape over the shoulders and back, open at the chest, its edge hanging in tufts
  const shell = (prof, A1, rows, cols, top, bot, ragK, bind, col) => {
    const at = (y) => { let i = 0; while (i < prof.length - 2 && y < prof[i + 1][0]) i++; const [y0, ...a] = prof[i], [y1, ...b] = prof[i + 1], k = clamp((y - y0) / (y1 - y0), 0, 1); return a.map((v, j) => lerp(v, b[j], k)); };
    const pos = [], idx = [];
    for (let i = 0; i <= cols; i++) for (let j = 0; j <= rows; j++) {
      const u = i / cols, v = j / rows, a = lerp(-A1, A1, u), y0 = lerp(top, bot(a), v), rag = v > 0.8 ? ragK(u) * (v - 0.8) / 0.2 : 0, [rx, rz, cz] = at(y0);
      pos.push(Math.sin(a) * rx, y0 + rag, cz - Math.cos(a) * rz);
    }
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { const a = i * (rows + 1) + j, b = a + 1, c = a + rows + 1, dd = c + 1; idx.push(a, c, b, b, c, dd); } // outward (projectUV picks views by facing)
    const g = new THREE.BufferGeometry(); g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    B.add(g, bind, col); return at;
  };
  const mantP = [[1.6, 0.13, 0.12, 0.03], [1.52, 0.255, 0.18, 0.005], [1.42, 0.31, 0.195, -0.01], [1.25, 0.32, 0.2, -0.02]];
  const mAt = shell(mantP, 2.5, Q(q, [4, 6, 9, 12]), Q(q, [12, 20, 28, 36]), 1.6, (a) => lerp(1.22, 1.33, Math.pow(Math.abs(a) / 2.5, 2)), (u) => -(noise(u * 41, 3, 1) - 0.3) * 0.08, 'chest', vary(fur, 0.4, 30));
  for (let i = 0, n = leader ? 0 : Q(q, [8, 20, 34, 50]); i < n; i++) {
    const a = rr(-2.4, 2.4), y = rr(1.27, 1.4), [rx, rz, cz] = mAt(y), p = new V3(Math.sin(a) * rx * 0.97, y, cz - Math.cos(a) * rz * 0.97), out = new V3(Math.sin(a) / rx, 0, -Math.cos(a) / rz).normalize();
    tuft(p, out.multiplyScalar(0.25).add(new V3(0, -1, 0)).normalize(), rr(0.04, 0.075), 0.016, 'chest', vary(fur, 0.4, 30));
  }
  // arms: the sword arm hanging, the shield arm bent forward under its shield
  for (const sx of [1, -1]) {
    const S = sx > 0 ? 'L' : 'R', sh = def.find((b) => b.name === 'sh' + S).pos, el = def.find((b) => b.name === 'el' + S).pos, hd = def.find((b) => b.name === 'hd' + S).pos;
    B.add(loft([{ p: [sh[0] * 0.9, sh[1] + 0.02, sh[2]], r: [0.062, 0.062] }, { p: [lerp(sh[0], el[0], 0.5), lerp(sh[1], el[1], 0.5), lerp(sh[2], el[2], 0.5)], r: [0.054, 0.056] }, { p: el, r: [0.05, 0.05] }], { radial: lr, rings, ref: [0, 0, 1] }), 'sh' + S, vary(linen));
    B.add(loft([{ p: el, r: [0.05, 0.05] }, { p: [lerp(el[0], hd[0], 0.5), lerp(el[1], hd[1], 0.5), lerp(el[2], hd[2], 0.5)], r: [0.048, 0.048] }, { p: [lerp(el[0], hd[0], 0.85), lerp(el[1], hd[1], 0.85), lerp(el[2], hd[2], 0.85)], r: [0.04, 0.04] }], { radial: lr, rings, ref: sx > 0 ? [0, 1, 0] : [0, 0, 1] }), 'el' + S, vary(grip, 0.2));
    B.add(blob(d), 'hd' + S, vary(skin, 0.15), { matrix: M(hd[0], hd[1], hd[2], 0, 0, 0, 0.036, 0.05, 0.036) });
  }
  // cloak: an open shell from the shoulders, round behind and down the sides, ragged and holed at the hem
  {
    const su = Q(q, [10, 18, 26, 34]), sv = Q(q, [8, 14, 20, 26]), pos = [], idx = [], A0 = 1.75;
    const prof = [[1.47, 0.2, 0.12, -0.05], [1.4, 0.29, 0.13, -0.085], [1.2, 0.325, 0.135, -0.075], [0.9, 0.34, 0.14, -0.08], [0.6, 0.345, 0.145, -0.09], [0.3, 0.345, 0.15, -0.095]];
    const at = (y) => { let i = 0; while (i < prof.length - 2 && y < prof[i + 1][0]) i++; const [y0, ...a] = prof[i], [y1, ...b] = prof[i + 1], k = clamp((y - y0) / (y1 - y0), 0, 1); return a.map((v, j) => lerp(v, b[j], k)); };
    for (let i = 0; i <= su; i++) for (let j = 0; j <= sv; j++) {
      const u = i / su, v = j / sv, a = lerp(-A0, A0, u), hem = leader ? lerp(0.26, 0.36, Math.pow(Math.abs(a) / A0, 1.5)) : lerp(0.345, 0.48, Math.pow(Math.abs(a) / A0, 1.5)), y0 = lerp(1.47, hem, v);
      const rag = v > 0.82 ? -(noise(u * 37, 1, 2) - 0.3) * 0.12 * (v - 0.82) / 0.18 : 0, y = y0 + rag, [rx, rz, cz] = at(y0);
      pos.push(Math.sin(a) * rx, y, cz - Math.cos(a) * rz + 0.012 * Math.sin(u * 47) * v);
    }
    for (let i = 0; i < su; i++) for (let j = 0; j < sv; j++) { const a = i * (sv + 1) + j, b = a + 1, c = a + sv + 1, dd = c + 1; idx.push(a, c, b, b, c, dd); } // outward
    const g = new THREE.BufferGeometry(); g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    B.add(g, (x, y, z) => along1([[1.0, 'cloakB'], [1.44, 'cloakA']])(y), vary(cloak, 0.3, 16));
  }
  // the shield, strapped to the left forearm: its face is a picture of its own (CR13, decal)
  const SH = !leader && ATLAS.bandit && ATLAS.bandit.views.shield, sc = new V3(0.39, 0.93, 0.08), sn = new V3(0.95, 0, 0.31).normalize(), sR = 0.215;
  const e1 = new V3(0, 1, 0).cross(sn).normalize(), e2 = new V3(0, 1, 0); // e1: to the right, seen from outside
  const decal = SH ? (x, y, z) => { _P.set(x, y, z).sub(sc); const u = _P.dot(e1) / sR, v = _P.dot(e2) / sR; return [lerp(SH[0], SH[2], 0.5 + 0.5 * u * 0.97), lerp(SH[1], SH[3], 0.5 - 0.5 * v * 0.97)]; } : null;
  const onShield = (g, depth) => { const m = new THREE.Matrix4().makeBasis(e1, e2, sn); m.setPosition(sc.clone().addScaledVector(sn, depth)); return m; };
  const disc = new THREE.CylinderGeometry(sR, sR, 0.026, Q(q, [12, 20, 28, 36]), 1); disc.rotateX(Math.PI / 2);
  if (!leader) {
  B.add(disc, 'elL', vary(wood, 0.35, 30), { matrix: onShield(disc, 0), decal });
  B.add(blob(d, (x, y, z) => [x, y, z < 0 ? z * 0.2 : z]), 'elL', iron, { matrix: onShield(null, 0.013).multiply(new THREE.Matrix4().makeScale(0.055, 0.055, 0.035)), decal });   // the boss
  B.add(new THREE.TorusGeometry(sR, 0.011, 4, Q(q, [12, 20, 28, 36])), 'elL', iron, { matrix: onShield(null, 0.008), decal });                                                         // the rim
  }
  // the sword in the right hand, hanging point-down and forward as drawn: a guard lifts it at the player
  const sd = new V3(0.086, -0.83, 0.54).normalize(), guard = new V3(-0.395, 0.86, 0.1), sl = leader ? 0.66 : 0.52, mid = guard.clone().addScaledVector(sd, sl / 2);
  B.add(new THREE.BoxGeometry(0.012, sl, 0.04, 1, Q(q, [2, 6, 10, 14]), 1), 'hdR', (x, y, z, nx) => shade(steel, Math.abs(nx) > 0.7 ? 1 : 0.7), { slot: 2, matrix: along(mid, sd) });
  B.add(cone(4, 0.02, 0.05), 'hdR', steel, { slot: 2, matrix: along(guard.clone().addScaledVector(sd, sl), sd, 0.3, 1, 1) });
  B.add(new THREE.BoxGeometry(0.026, 0.022, 0.15), 'hdR', vary(C(0x6a6050), 0.2), { slot: 2, matrix: along(guard, sd) }); // crossguard, across the blade
  B.add(new THREE.CylinderGeometry(0.016, 0.016, 0.12, 6), 'hdR', grip, { slot: 2, matrix: along(guard.clone().addScaledVector(sd, -0.065), sd) });
  B.add(blob(1), 'hdR', steel, { slot: 2, matrix: M(...guard.clone().addScaledVector(sd, -0.135).toArray(), 0, 0, 0, 0.022, 0.022, 0.022) }); // pommel
  const bladePos = guard.clone().addScaledVector(sd, 0.3).toArray();
  return { def, geo: B.build(), eyes: null, height: 1.86, roughness: 0.88, side: THREE.DoubleSide, accent: 'steel', bladeBone: 'hdR', bladePos,
    uvOpts: { ext: AT && AT.ext } };
}

// =====================================================================
//  WAX SENTINEL — a hulking figure of old candle wax (CR26–CR29): an
//  inverted triangle of a body, a small faceless head sunk between great
//  shoulders, arms hanging long to fused mallet fists, legs that root into
//  puddles of wax. Curtains of drips hang from every ledge. One ember socket
//  for an eye, candles on its head and shoulders, and an X of molten
//  fissures across chest and back (painted into its texture; they blaze when
//  a pulse cracks it open). The Ruin Guardian (CR30) is the same thing,
//  older and grey: a spired stone crown, pauldrons, a round shield grown
//  into its arm, a long rotted tabard.
// =====================================================================
const lumpD = (amp, f = 4, seed = 0) => (x, y, z) => { const k = 1 + amp * nz3(x * f + seed, y * f, z * f - seed); return [x * k, y * k, z * k]; };
// shins that split into root-like ridges as they reach the floor
const roots = (seed) => (a, t) => { const k = clamp((t - 0.35) / 0.65, 0, 1); return 1 + 0.07 * nz3(Math.cos(a) * 2.5 + seed, t * 9, Math.sin(a) * 2.5 - seed) + k * k * 0.42 * Math.pow(Math.max(0, Math.cos(a * 6 + seed + 0.8 * nz3(t * 4, seed, 2))), 3); };
function sentinel(q, guardian = false) {
  srand((guardian ? 6006 : 5005) + q);
  const def = bones([
    ['root', null, 0, 0, 0], ['hips', 'root', 0, 1.02, -0.03], ['spine', 'hips', 0, 1.32, -0.01], ['chest', 'spine', 0, 1.62, 0], ['neck', 'chest', 0, 1.95, 0.02], ['head', 'neck', 0, 2.06, 0.1],
    ['shL', 'chest', 0.37, 1.84, -0.02], ['elL', 'shL', 0.46, 1.41, 0.06], ['hdL', 'elL', 0.5, 1.02, 0.16],
    ['shR', 'chest', -0.37, 1.84, -0.02], ['elR', 'shR', -0.46, 1.41, 0.06], ['hdR', 'elR', -0.5, 1.02, 0.16],
    ['thL', 'hips', 0.2, 1.0, -0.04], ['knL', 'thL', 0.235, 0.58, -0.07], ['ftL', 'knL', 0.26, 0.16, -0.08],
    ['thR', 'hips', -0.2, 1.0, -0.04], ['knR', 'thR', -0.235, 0.58, -0.07], ['ftR', 'knR', -0.26, 0.16, -0.08],
  ]);
  const B = new RigBuilder(def), radial = Q(q, [8, 14, 18, 24]), rings = Q(q, [6, 12, 16, 22]), d = Q(q, [1, 2, 2, 3]);
  const wax = guardian ? C(0xa8a294) : C(0xd6caa8), grime = guardian ? C(0x4e4a42) : C(0x86765a), drip = guardian ? C(0xc4beac) : C(0xeee2c0), stone = C(0x76716a), soot = C(0x241e1a);
  // vertex colours are only the fallback: the body is textured from the reference sheet
  const waxCol = (k = 1) => (x, y, z, nx, ny) => { const n = noise(x * 9, y * 9, z * 9), g = clamp(0.35 - ny * 0.35 + (y < 0.7 ? (0.7 - y) * 0.9 : 0) + (n - 0.5) * 0.5, 0, 1); return shade(mixc(wax, grime, g * 0.75), (0.82 + 0.3 * n) * k); };
  const lump = (amp, f = 1, seed = 0) => (a, t) => 1 + amp * nz3(Math.cos(a) * 2.5 * f + seed, t * 9 * f, Math.sin(a) * 2.5 * f - seed);
  // ---- drips: a teardrop hanging off a surface point, leaning a little away from the surface
  const DR = Q(q, [0.15, 0.4, 0.6, 0.85]), dripG = loft([{ p: [0, 0.03, 0], r: [0.6, 0.6] }, { p: [0, -0.4, 0], r: [0.42, 0.42] }, { p: [0, -0.8, 0], r: [0.8, 0.8] }, { p: [0, -1, 0], r: [0.25, 0.25] }], { radial: Q(q, [4, 5, 6, 7]), rings: Q(q, [3, 4, 4, 5]), ref: [0, 0, 1] });
  const dripAt = (p, n, len, w, bind) => B.add(dripG, bind, shade(drip, 0.85 + 0.25 * rnd()), { matrix: along(p.clone().addScaledVector(n, -w * 0.6), new V3(-n.x * 0.1, 1, -n.z * 0.1), w, len, w * 0.8) });
  const ledge = (ctrl, t, n, [l0, l1], [w0, w1], bind, a0 = 0, a1 = TAU) => { n = Math.max(1, Math.round(n * DR)); for (let i = 0; i < n; i++) { const s = loftSurface(ctrl, clamp(t + rr(-0.04, 0.04), 0, 1), lerp(a0, a1, (i + rnd()) / n), [0, 0, 1], 0.98); dripAt(s.p, s.n, rr(l0, l1), rr(w0, w1), bind); } };
  // drips round the lower rim of an ellipsoid (centre c, radii r): shoulders, head, fists
  const rim = (c, r, lat, n, [l0, l1], [w0, w1], bind, a0 = 0, a1 = TAU) => { n = Math.max(1, Math.round(n * DR)); for (let i = 0; i < n; i++) { const a = lerp(a0, a1, (i + rnd()) / n), la = lat + rr(-0.15, 0.15), cl = Math.cos(la); const nn = new V3(Math.sin(a) * cl / r[0], Math.sin(la) / r[1], Math.cos(a) * cl / r[2]).normalize(); dripAt(new V3(c[0] + Math.sin(a) * cl * r[0], c[1] + Math.sin(la) * r[1], c[2] + Math.cos(a) * cl * r[2]), nn, rr(l0, l1), rr(w0, w1), bind); } };

  // ---- legs: long slumped columns that root into puddles of wax
  for (const sx of [1, -1]) {
    const S = sx > 0 ? 'L' : 'R';
    const thighC = [{ p: [sx * 0.17, 1.17, -0.04], r: [0.11, 0.11] }, { p: [sx * 0.2, 1.02, -0.04], r: [0.165, 0.16] }, { p: [sx * 0.215, 0.82, -0.05], r: [0.15, 0.15] }, { p: [sx * 0.235, 0.6, -0.07], r: [0.14, 0.145] }, { p: [sx * 0.238, 0.52, -0.075], r: [0.1, 0.1] }];
    const thB = (x, y, z) => along1([[0.6, 'kn' + S], [0.76, 'th' + S]])(y);
    B.add(loft(thighC, { radial, rings, ref: [0, 0, 1], shape: lump(0.08, 1, sx) }), thB, waxCol());
    ledge(thighC, 0.6, 10, [0.08, 0.2], [0.018, 0.03], thB);
    const shinC = [{ p: [sx * 0.233, 0.7, -0.065], r: [0.1, 0.1] }, { p: [sx * 0.235, 0.6, -0.07], r: [0.14, 0.145] }, { p: [sx * 0.245, 0.42, -0.09], r: [0.13, 0.15] }, { p: [sx * 0.255, 0.26, -0.09], r: [0.135, 0.16] }, { p: [sx * 0.265, 0.13, -0.08], r: [0.17, 0.19] }, { p: [sx * 0.27, 0.035, -0.06], r: [0.24, 0.25] }];
    B.add(loft(shinC, { radial: radial + 4, rings: rings + 2, ref: [0, 0, 1], shape: roots(sx * 3) }), (x, y, z) => along1([[0.14, 'ft' + S], [0.34, 'kn' + S]])(y), waxCol(0.85));
    B.add(blob(d, (x, y, z) => { const a = Math.atan2(z, x), k = 1 + 0.2 * nz3(Math.cos(a) * 2 + sx, Math.sin(a) * 2, 5) + 0.1 * Math.cos(a * 7 + sx); return [x * k, Math.min(y, 0.35), z * k]; }), 'ft' + S, shade(drip, 0.85), { matrix: M(sx * 0.28, 0, -0.03, 0, 0, 0, 0.27, 0.06, 0.36) });
    for (let i = 0, n = Q(q, [3, 5, 7, 9]); i < n; i++) { // root tendrils spreading into the puddle
      const a = (i / n) * TAU + rr(-0.3, 0.3), ca = Math.cos(a), sa = Math.sin(a), L = rr(0.08, 0.16), x0 = sx * 0.27, z0 = -0.07;
      B.add(loft([{ p: [x0 + ca * 0.1, 0.3, z0 + sa * 0.1], r: [0.03, 0.03] }, { p: [x0 + ca * 0.19, 0.1, z0 + sa * 0.19], r: [0.04, 0.03] }, { p: [x0 + ca * (0.2 + L), 0.025, z0 + sa * (0.2 + L)], r: [0.025, 0.012] }], { radial: Q(q, [4, 5, 6, 7]), rings: Q(q, [3, 5, 6, 8]), ref: [0, 1, 0] }), 'ft' + S, waxCol(0.7));
    }
  }
  // ---- hips and torso: a narrow waist under a great slab of chest, the back hunched
  B.add(blob(d, lumpD(0.08, 6, 1)), 'hips', waxCol(), { matrix: M(0, 1.05, -0.04, 0, 0, 0, 0.32, 0.2, 0.22) });
  for (const sx of [1, -1]) B.add(blob(d, lumpD(0.06, 5, sx)), 'hips', waxCol(), { matrix: M(sx * 0.12, 1.07, -0.12, 0, 0, 0, 0.15, 0.16, 0.13) });
  const torso = [{ p: [0, 1.0, -0.04], r: [0.3, 0.2] }, { p: [0, 1.2, -0.03], r: [0.28, 0.2] }, { p: [0, 1.38, -0.01], r: [0.245, 0.215] }, { p: [0, 1.56, 0], r: [0.3, 0.26] }, { p: [0, 1.74, -0.02], r: [0.36, 0.28] }, { p: [0, 1.9, -0.05], r: [0.3, 0.25] }, { p: [0, 2.0, 0], r: [0.16, 0.15] }];
  const tBind = (x, y, z) => along1([[1.08, 'hips'], [1.3, 'spine'], [1.6, 'chest'], [1.95, 'neck']])(y);
  B.add(loft(torso, { radial: radial + 6, rings: rings + 6, ref: [0, 0, 1], shape: lump(0.06, 1.2, 3) }), tBind, waxCol());
  for (const sx of [1, -1]) B.add(blob(d, lumpD(0.07, 5, sx + 4)), 'chest', waxCol(), { matrix: M(sx * 0.15, 1.66, 0.16, 0, 0, 0, 0.17, 0.13, 0.11) }); // pectorals
  ledge(torso, 0.5, 18, [0.08, 0.22], [0.02, 0.034], tBind);            // under the chest
  ledge(torso, 0.74, 20, [0.1, 0.26], [0.022, 0.036], tBind, Math.PI * 0.55, Math.PI * 1.45); // down the hunched back
  ledge(torso, 0.22, 12, [0.06, 0.15], [0.016, 0.028], tBind);         // the waist
  ledge(torso, 0.02, 14, [0.08, 0.2], [0.02, 0.032], (x, y, z) => ['hips', 1]); // off the hips, over the thighs
  // ---- shoulders, and arms hanging long to fists fused into mallets of wax
  for (const sx of [1, -1]) {
    const S = sx > 0 ? 'L' : 'R';
    B.add(blob(d, lumpD(0.1, 5, sx)), 'sh' + S, waxCol(), { matrix: M(sx * 0.34, 1.84, -0.02, 0, 0, sx * 0.25, 0.19, 0.2, 0.21) });     // deltoid
    B.add(blob(d, lumpD(0.08, 4, sx + 2)), (x, y, z) => along1([[0.2, 'chest'], [0.32, 'sh' + S]])(Math.abs(x)), waxCol(), { matrix: M(sx * 0.19, 1.93, -0.07, 0, 0, -sx * 0.3, 0.2, 0.12, 0.19) }); // trapezius
    rim([sx * 0.34, 1.84, -0.02], [0.19, 0.2, 0.21], -0.35, 12, [0.1, 0.24], [0.022, 0.036], 'sh' + S);
    const uaC = [{ p: [sx * 0.37, 1.86, -0.02], r: [0.14, 0.15] }, { p: [sx * 0.42, 1.6, 0.02], r: [0.125, 0.135] }, { p: [sx * 0.46, 1.41, 0.06], r: [0.115, 0.12] }, { p: [sx * 0.465, 1.34, 0.075], r: [0.08, 0.085] }];
    const uaB = (x, y, z) => along1([[1.36, 'el' + S], [1.5, 'sh' + S]])(y);
    B.add(loft(uaC, { radial, rings, ref: [0, 0, 1], shape: lump(0.07, 1, sx + 5) }), uaB, waxCol());
    ledge(uaC, 0.65, 8, [0.06, 0.16], [0.016, 0.026], uaB);
    const faC = [{ p: [sx * 0.45, 1.5, 0.045], r: [0.085, 0.09] }, { p: [sx * 0.46, 1.41, 0.06], r: [0.115, 0.12] }, { p: [sx * 0.48, 1.22, 0.11], r: [0.105, 0.11] }, { p: [sx * 0.49, 1.06, 0.15], r: [0.09, 0.095] }, { p: [sx * 0.485, 0.95, 0.17], r: [0.1, 0.11] }];
    const faB = (x, y, z) => along1([[1.0, 'hd' + S], [1.08, 'el' + S]])(y);
    B.add(loft(faC, { radial, rings, ref: [0, 0, 1], shape: lump(0.08, 1.3, sx + 7) }), faB, waxCol(0.95));
    ledge(faC, 0.45, 8, [0.06, 0.15], [0.016, 0.026], faB);
    B.add(blob(d, (x, y, z) => { const k = 1 + 0.16 * nz3(x * 4 + sx, y * 4, z * 4); return [x * k * (y > 0.3 ? 0.92 : 1), y, z * k]; }), 'hd' + S, waxCol(0.9), { matrix: M(sx * 0.48, 0.85, 0.19, 0.15, 0, 0, 0.115, 0.19, 0.135) });
    if (q > 0) for (let i = 0; i < 4; i++) B.add(blob(1), 'hd' + S, waxCol(0.95), { matrix: M(sx * (0.48 + (i - 1.5) * 0.045), 0.76 + Math.abs(i - 1.5) * 0.02, 0.3, 0, 0, 0, 0.035, 0.04, 0.035) }); // knuckles
    rim([sx * 0.48, 0.85, 0.19], [0.115, 0.19, 0.135], -0.75, 8, [0.06, 0.18], [0.014, 0.024], 'hd' + S);
  }
  // ---- neck and head
  B.add(loft([{ p: [0, 1.9, -0.01], r: [0.15, 0.14] }, { p: [0, 2.04, 0.07], r: [0.115, 0.115] }], { radial, rings: 4, ref: [0, 0, 1] }), (x, y, z) => along1([[1.96, 'neck'], [2.06, 'head']])(y), waxCol());
  B.add(blob(d, lumpD(0.06, 6, 2)), (x, y, z) => along1([[1.98, 'neck'], [2.1, 'head']])(y), waxCol(), { matrix: M(0, 2.05, 0.02, 0, 0, 0, 0.12, 0.1, 0.12) }); // the nape, slumped into the shoulders
  const candles = [], uvExtra = [];
  const candle = (bone, x, y, z, h, r) => {
    B.add(new THREE.CylinderGeometry(r, r * 1.08, h, Q(q, [5, 7, 9, 12])), bone, (px, py, pz) => shade(drip, 0.9 + 0.2 * noise(px * 60, py * 60, pz * 60)), { matrix: M(x, y + h / 2, z) });
    B.add(blob(q ? 1 : 0), bone, shade(drip, 0.95), { matrix: M(x, y + 0.01, z, 0, 0, 0, r * 1.9, r * 0.8, r * 1.9) }); // wax pooled at its foot
    B.add(new THREE.CylinderGeometry(0.004, 0.004, 0.025, 4), bone, soot, { matrix: M(x, y + h + 0.012, z) });
    for (let i = 0; i < Q(q, [1, 2, 3, 4]); i++) { const a = rr(0, TAU); B.add(cone(4, r * 0.4, rr(0.04, h * 0.8)), bone, shade(drip, 1.05), { flat: true, matrix: along(new V3(x + Math.cos(a) * r, y + h - 0.005, z + Math.sin(a) * r), new V3(0, -1, 0)) }); }
    candles.push({ bone, pos: [x, y + h + 0.035, z], s: r * 3.2 }); uvExtra.push([x, y + h + 0.09, z]);
  };
  let eye;
  if (!guardian) {
    // a smooth faceless dome, curtained with drips below the brow; one sunken socket where the ember sits
    B.add(blob(Q(q, [2, 3, 3, 4]), (x, y, z) => [x, y, z > 0.5 ? 0.5 + (z - 0.5) * 0.6 : z]), 'head', waxCol(1.1), { matrix: M(0, 2.17, 0.14, 0, 0, 0, 0.12, 0.155, 0.14) });
    rim([0, 2.17, 0.14], [0.12, 0.155, 0.13], -0.45, 12, [0.05, 0.14], [0.012, 0.022], 'head', -1.9, 1.9);
    B.add(new THREE.TorusGeometry(0.046, 0.013, Q(q, [4, 6, 8, 8]), Q(q, [8, 12, 16, 20])), 'head', shade(drip, 0.9), { matrix: M(0, 2.1, 0.248) });
    B.add(blob(Q(q, [1, 2, 2, 3])), 'head', C(0x0a0605), { slot: 1, matrix: M(0, 2.1, 0.245, 0, 0, 0, 0.045, 0.045, 0.03) });
    eye = { bone: 'head', pos: [0, 2.1, 0.27], spread: 0, n: 1 };
    candle('head', 0, 2.26, 0.13, 0.12, 0.032); candle('head', -0.06, 2.25, 0.16, 0.08, 0.027); candle('head', 0.065, 2.24, 0.11, 0.07, 0.026);
  } else {
    // a long skull of grey wax, an empty socket and a gaping mouth, and a spired stone crown with candles in its points
    B.add(blob(Q(q, [2, 3, 3, 4]), (x, y, z) => [x * (y < 0 ? 1 - 0.25 * -y : 1), y, z > 0.55 ? 0.55 + (z - 0.55) * 0.5 : z]), 'head', waxCol(1.05), { matrix: M(0, 2.13, 0.07, 0, 0, 0, 0.125, 0.18, 0.14) });
    rim([0, 2.12, 0.07], [0.12, 0.17, 0.13], -0.5, 14, [0.06, 0.18], [0.012, 0.022], 'head', -2.2, 2.2);
    B.add(blob(Q(q, [1, 2, 2, 3])), 'head', C(0x0a0605), { slot: 1, matrix: M(0.047, 2.15, 0.155, 0, 0, 0, 0.032, 0.03, 0.03) });
    eye = { bone: 'head', pos: [0.047, 2.15, 0.19], spread: 0, n: 1 };
    const cr = (x, y, z) => shade(stone, 0.8 + 0.3 * noise(x * 30, y * 30, z * 30));
    B.add(new THREE.CylinderGeometry(0.14, 0.13, 0.05, Q(q, [8, 12, 18, 24]), 1, true), 'head', cr, { matrix: M(0, 2.27, 0.07, -0.1, 0, 0) });
    B.add(new THREE.TorusGeometry(0.14, 0.014, 4, Q(q, [8, 12, 18, 24])), 'head', cr, { matrix: M(0, 2.25, 0.072, Math.PI / 2 - 0.1, 0, 0) });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2, x = Math.sin(a) * 0.135, z = 0.07 + Math.cos(a) * 0.135, h = i % 2 ? 0.07 : 0.13;
      B.add(cone(4, 0.022, h), 'head', cr, { flat: true, matrix: M(x, 2.29 - 0.08 * Math.cos(a) * 0.12, z) });
      if (i === 0 || i === 6) candle('head', x * 0.85, 2.27, 0.07 + (z - 0.07) * 0.85, i ? 0.07 : 0.11, 0.02);
    }
  }
  if (!guardian) for (const sx of [1, -1]) { const S = sx > 0 ? 'L' : 'R'; candle('sh' + S, sx * 0.3, 1.99, -0.03, 0.17, 0.034); candle('sh' + S, sx * 0.38, 1.97, 0.03, 0.1, 0.028); }
  if (guardian) {
    const st = (x, y, z) => shade(stone, 0.75 + 0.35 * noise(x * 20, y * 20, z * 20));
    // pauldrons: two tiers of carved stone shell over each shoulder, ring brooches holding the tabard
    for (const sx of [1, -1]) {
      const S = sx > 0 ? 'L' : 'R', seg = Q(q, [8, 12, 18, 24]);
      B.add(new THREE.SphereGeometry(0.22, seg, seg >> 1, 0, TAU, 0, 1.25), 'sh' + S, st, { matrix: M(sx * 0.33, 1.79, -0.01, 0, 0, -sx * 0.5, 1, 0.9, 1.05) });
      B.add(new THREE.SphereGeometry(0.17, seg, seg >> 1, 0, TAU, 0, 1.1), 'sh' + S, st, { matrix: M(sx * 0.4, 1.66, -0.01, 0, 0, -sx * 1.0, 1, 0.85, 1.1) });
      B.add(new THREE.TorusGeometry(0.035, 0.009, 4, Q(q, [6, 8, 10, 12])), 'chest', st, { matrix: M(sx * 0.2, 1.73, 0.27, -0.25, 0, 0) });
    }
    // the shield, grown into the left forearm: a round slab of carved stone, tilted out and forward
    const shQ = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), new V3(0.9, 0, 0.42).normalize());
    B.add(new THREE.CylinderGeometry(0.33, 0.33, 0.05, Q(q, [10, 16, 24, 32]), 1), 'elL', st, { matrix: new THREE.Matrix4().compose(new V3(0.57, 1.16, 0.09), shQ, new V3(1, 1, 1)) });
    B.add(blob(Q(q, [1, 2, 2, 2])), 'elL', st, { matrix: new THREE.Matrix4().compose(new V3(0.6, 1.16, 0.1), shQ, new V3(0.07, 0.04, 0.07)) });
    // the tabard: a long rotted panel front and back from the chest to below the knee, ragged at the hem
    const su = Q(q, [3, 6, 9, 12]), sv = Q(q, [5, 10, 16, 22]);
    for (const side of [1, -1]) {
      const pos = [], index = [];
      const zf = (y) => side > 0 ? (y > 1.62 ? 0.28 : y > 1.4 ? lerp(0.23, 0.28, (y - 1.4) / 0.22) : y > 1.0 ? lerp(0.205, 0.23, (y - 1.0) / 0.4) : lerp(0.15, 0.205, (y - 0.3) / 0.7)) : (y > 1.56 ? -0.31 : y > 1.0 ? lerp(-0.265, -0.29, (y - 1.0) / 0.56) : lerp(-0.2, -0.265, (y - 0.3) / 0.7));
      for (let i = 0; i <= su; i++) for (let j = 0; j <= sv; j++) {
        const u = i / su, v = j / sv, hem = v > 0.82 ? (noise(u * 23 + side, 3, 1) - 0.5) * 0.3 * (v - 0.82) / 0.18 : 0, y = lerp(1.66, 0.3, v) + hem, w = lerp(0.18, 0.22, v);
        pos.push(lerp(-w, w, u), y, zf(y) + side * (0.015 * Math.sin(u * 11 + side) * v + 0.01));
      }
      for (let i = 0; i < su; i++) for (let j = 0; j < sv; j++) { const a0 = i * (sv + 1) + j, b0 = a0 + 1, c0 = a0 + sv + 1, d0 = c0 + 1; if (side > 0) index.push(a0, b0, c0, b0, d0, c0); else index.push(a0, c0, b0, b0, c0, d0); }
      const g = new THREE.BufferGeometry(); g.setIndex(index); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      B.add(g, (x, y, z) => along1([[1.0, 'hips'], [1.3, 'spine'], [1.6, 'chest']])(y), (x, y, z) => shade(C(0x3e2620), 0.7 + 0.4 * noise(x * 25, y * 25, z)));
    }
    B.add(new THREE.CylinderGeometry(0.05, 0.05, 0.02, Q(q, [6, 10, 14, 18])), 'spine', st, { matrix: M(0, 1.4, 0.24, Math.PI / 2, 0, 0) }); // medallion
  }
  return { def, geo: B.build(), eyes: eye, height: 2.47, roughness: guardian ? 0.85 : 0.5, side: guardian ? THREE.DoubleSide : THREE.FrontSide, accent: 'glow', candles, uvExtra, glowFromMap: true,
    uvOpts: guardian ? { mirrorSkip: (x, y, z) => y > 0.56 && y < 1.22 } : {} };
}

// =====================================================================
//  GLOOM HOUND (CR32–CR34) — a tall, starved, hairless thing like a
//  greyhound drawn out too far: pale taupe skin over every rib, a deep keel
//  of a chest and a waist you could circle with two hands, a long neck held
//  high, a narrow skull with its lips drawn back off too many teeth, legs
//  like stilts on clawed feet, a row of bone spines from the crown of its
//  head down its back to the end of a long whip of a tail. Pale eyes.
//  Same skeleton names as the wolf, so it moves with the same gait.
// =====================================================================
function hound(q) {
  srand(7007 + q);
  const def = bones([
    ['root', null, 0, 0, 0], ['pelvis', 'root', 0, 0.88, -0.26], ['spine', 'pelvis', 0, 0.92, 0], ['chest', 'spine', 0, 0.9, 0.25],
    ['hackles', 'spine', 0, 1.0, 0], ['neck', 'chest', 0, 0.98, 0.36], ['head', 'neck', 0, 1.16, 0.5], ['jaw', 'head', 0, 1.13, 0.58],
    ['earL', 'head', 0.05, 1.22, 0.49], ['earR', 'head', -0.05, 1.22, 0.49],
    ['FLu', 'chest', 0.085, 0.85, 0.3], ['FLl', 'FLu', 0.085, 0.58, 0.31], ['FLf', 'FLl', 0.085, 0.18, 0.34],
    ['FRu', 'chest', -0.085, 0.85, 0.3], ['FRl', 'FRu', -0.085, 0.58, 0.31], ['FRf', 'FRl', -0.085, 0.18, 0.34],
    ['HLu', 'pelvis', 0.09, 0.84, -0.27], ['HLl', 'HLu', 0.095, 0.56, -0.2], ['HLf', 'HLl', 0.095, 0.32, -0.42],
    ['HRu', 'pelvis', -0.09, 0.84, -0.27], ['HRl', 'HRu', -0.095, 0.56, -0.2], ['HRf', 'HRl', -0.095, 0.32, -0.42],
    ['tail1', 'pelvis', 0, 0.85, -0.34], ['tail2', 'tail1', 0, 0.6, -0.43], ['tail3', 'tail2', 0, 0.43, -0.54],
  ]);
  const B = new RigBuilder(def), radial = Q(q, [8, 14, 20, 26]), rings = Q(q, [10, 20, 30, 40]), d = Q(q, [1, 2, 2, 3]);
  // fallback colours only: the body is textured from the reference sheet
  const skinC = C(0x8a8078), backC = C(0x4a4642), bone_ = C(0xb8ae9c), ivory = C(0xd8ceb6), gum = C(0x4a2a2a);
  const skin = (k = 1) => (x, y, z, nx, ny) => shade(mixc(skinC, backC, clamp(ny * 0.8, 0, 1)), (0.85 + 0.3 * noise(x * 11, y * 11, z * 11)) * k);
  const lr = Math.max(6, radial - 6), lrings = Math.max(4, rings >> 2);
  // torso: a keel of a chest, ribs standing out of the skin, the waist tucked up under the spine
  const torso = [{ p: [0, 0.83, -0.35], r: [0.055, 0.05] }, { p: [0, 0.85, -0.27], r: [0.1, 0.085] }, { p: [0, 0.86, -0.17], r: [0.115, 0.1] }, { p: [0, 0.89, -0.06], r: [0.075, 0.085] },
    { p: [0, 0.86, 0.06], r: [0.092, 0.13] }, { p: [0, 0.82, 0.17], r: [0.108, 0.18] }, { p: [0, 0.81, 0.26], r: [0.112, 0.21] }, { p: [0, 0.88, 0.35], r: [0.09, 0.15] }, { p: [0, 0.93, 0.39], r: [0.07, 0.09] }];
  const bodyBind = (x, y, z) => along1([[-0.26, 'pelvis'], [0, 'spine'], [0.25, 'chest']])(z);
  const ribs = (a, t) => { const side = Math.abs(Math.cos(a)), low = Math.max(0, -Math.sin(a)); const rib = t > 0.5 && t < 0.93 ? 0.05 * Math.pow(Math.max(0, Math.cos(t * 78)), 3) * side * (1 - 0.6 * low) : 0; return 1 + rib + 0.025 * nz3(Math.cos(a) * 4, t * 20, Math.sin(a) * 4); };
  B.add(loft(torso, { radial: radial + 6, rings: rings + 6, shape: ribs }), bodyBind, skin());
  // neck: long and corded, held high
  const neckC = [{ p: [0, 0.9, 0.3], r: [0.085, 0.13] }, { p: [0, 1.0, 0.4], r: [0.066, 0.092] }, { p: [0, 1.1, 0.47], r: [0.055, 0.068] }, { p: [0, 1.16, 0.52], r: [0.05, 0.06] }];
  const neckBind = (x, y, z) => along1([[0.33, 'chest'], [0.42, 'neck'], [0.5, 'head']])(z);
  B.add(loft(neckC, { radial, rings: Math.max(5, rings >> 1), shape: (a, t) => 1 + 0.07 * Math.max(0, Math.cos(a * 2)) * Math.sin(t * 9) + 0.02 * nz3(a * 3, t * 9, 4) }), neckBind, skin(0.95));
  // head: a narrow skull and a long muzzle, lips drawn back off a crowded jaw
  const hd = Q(q, [1, 2, 3, 3]);
  B.add(blob(hd, (x, y, z) => [x * (z > 0 ? 1 - z * 0.3 : 1), y * (y > 0 ? 0.8 : 1), z]), 'head', skin(1.05), { matrix: M(0, 1.18, 0.55, 0, 0, 0, 0.058, 0.068, 0.1) });
  B.add(loft([{ p: [0, 1.17, 0.6], r: [0.044, 0.045] }, { p: [0, 1.15, 0.69], r: [0.034, 0.034] }, { p: [0, 1.125, 0.77], r: [0.022, 0.024] }, { p: [0, 1.115, 0.79], r: [0.012, 0.014] }], { radial, rings: Math.max(5, rings >> 2), ref: [0, 1, 0] }), 'head', skin(1.1));
  B.add(loft([{ p: [0, 1.105, 0.58], r: [0.034, 0.016] }, { p: [0, 1.1, 0.68], r: [0.026, 0.013] }, { p: [0, 1.098, 0.76], r: [0.016, 0.01] }], { radial, rings: 6, ref: [0, 1, 0] }), 'jaw', skin(1.05));
  for (const sx of [-1, 1]) B.add(blob(1), 'head', skin(1.15), { matrix: M(sx * 0.04, 1.215, 0.6, 0, 0, sx * 0.25, 0.022, 0.012, 0.035) }); // brow ridges
  B.add(blob(1), 'head', C(0x0a0a0c), { slot: 1, matrix: M(0, 1.125, 0.79, 0, 0, 0, 0.014, 0.012, 0.01) }); // nose
  for (const sx of [-1, 1]) B.add(blob(Q(q, [1, 1, 2, 2])), 'head', (x, y, z, nx, ny, nz) => (nz > 0.5 ? [0.55, 0.62, 0.66] : [0.03, 0.03, 0.04]), { slot: 1, matrix: M(sx * 0.038, 1.2, 0.61, 0, sx * 0.45, 0, 0.011, 0.009, 0.009) });
  // gums and two ragged rows of teeth, top and bottom
  for (const [bone, y, dir, z0, z1] of [['head', 1.118, -1, 0.6, 0.78], ['jaw', 1.11, 1, 0.59, 0.76]]) {
    for (const sx of [-1, 1]) {
      B.add(loft([{ p: [sx * 0.036, y, z0], r: [0.008, 0.007] }, { p: [sx * 0.028, y, (z0 + z1) / 2], r: [0.007, 0.006] }, { p: [sx * 0.014, y, z1], r: [0.005, 0.005] }], { radial: 5, rings: 5 }), bone, gum);
      for (let i = 0, n = Q(q, [3, 7, 10, 13]); i < n; i++) { const t = i / (n - 1), x = sx * lerp(0.036, 0.013, t), z = lerp(z0, z1, t); B.add(cone(4, 0.0045, rr(0.014, 0.026) * (i % 3 === 0 ? 1.6 : 1)), bone, ivory, { slot: 1, flat: true, matrix: along(new V3(x, y, z), new V3(rr(-0.15, 0.15), dir, rr(0, 0.2)).normalize()) }); }
    }
  }
  for (const [sx, bone] of [[1, 'earL'], [-1, 'earR']]) B.add(cone(Q(q, [3, 4, 5, 6]), 0.022, 0.05), bone, skin(0.9), { flat: true, matrix: along(new V3(sx * 0.046, 1.22, 0.5), new V3(sx * 0.35, 0.55, -1).normalize(), 1, 1, 0.5) });
  // the bone ridge: spines from the crown of the skull, down the neck and back (they rise when it means it)
  const spine = (p, h, bind) => B.add(cone(Q(q, [3, 4, 5, 6]), h * 0.32, h), bind, shade(bone_, 0.75 + 0.3 * rnd()), { flat: true, matrix: along(p, new V3(0, 1, -0.55).normalize()) });
  for (let i = 0, n = Q(q, [2, 3, 4, 5]); i < n; i++) spine(new V3(0, 1.235 - i * 0.004, 0.57 - i * 0.03), 0.02 + 0.006 * (n - i), 'head');
  for (let i = 0, n = Q(q, [3, 5, 7, 9]); i < n; i++) { const t = i / (n - 1), s = loftSurface(neckC, 1 - t, Math.PI / 2, [0, 1, 0], 0.97); spine(s.p, 0.018 + 0.016 * Math.sin(Math.PI * (0.3 + t * 0.7)), neckBind); }
  for (let i = 0, n = Q(q, [5, 10, 15, 20]); i < n; i++) { const t = lerp(0.95, 0.04, i / (n - 1)), s = loftSurface(torso, t, Math.PI / 2, [0, 1, 0], 0.97); spine(s.p, 0.018 + 0.032 * Math.pow(t, 1.5), 'hackles'); }
  // legs: stilts, knobbed at every joint, long-clawed feet
  const claws = (x, z, bone, n = 4) => { for (let i = 0; i < n; i++) { const ox = (i - (n - 1) / 2) * 0.016; B.add(cone(4, 0.005, 0.04), bone, C(0x14110e), { slot: 1, flat: true, matrix: along(new V3(x + ox * 1.3, 0.02, z + 0.04 - Math.abs(ox) * 0.8), new V3(ox * 6, -0.45, 1).normalize()) }); } };
  for (const sx of [1, -1]) {
    const F = sx > 0 ? 'FL' : 'FR', Hh = sx > 0 ? 'HL' : 'HR';
    B.add(blob(d), F + 'u', skin(), { matrix: M(sx * 0.075, 0.86, 0.29, 0, 0, sx * 0.15, 0.05, 0.13, 0.085) }); // shoulder blade
    B.add(loft([{ p: [sx * 0.085, 0.84, 0.3], r: [0.045, 0.062] }, { p: [sx * 0.085, 0.7, 0.3], r: [0.036, 0.048] }, { p: [sx * 0.085, 0.58, 0.31], r: [0.028, 0.033] }], { radial: lr, rings: lrings, ref: [0, 0, 1] }), F + 'u', skin());
    B.add(blob(1), F + 'l', skin(), { matrix: M(sx * 0.085, 0.575, 0.305, 0, 0, 0, 0.03, 0.034, 0.034) });
    B.add(loft([{ p: [sx * 0.085, 0.58, 0.31], r: [0.025, 0.028] }, { p: [sx * 0.085, 0.38, 0.32], r: [0.019, 0.022] }, { p: [sx * 0.085, 0.18, 0.33], r: [0.017, 0.019] }], { radial: lr, rings: lrings, ref: [0, 0, 1] }), F + 'l', skin(0.95));
    B.add(blob(1), F + 'f', skin(), { matrix: M(sx * 0.085, 0.18, 0.333, 0, 0, 0, 0.021, 0.024, 0.022) });
    B.add(loft([{ p: [sx * 0.085, 0.18, 0.333], r: [0.017, 0.019] }, { p: [sx * 0.087, 0.05, 0.36], r: [0.019, 0.02] }], { radial: lr, rings: 4, ref: [0, 0, 1] }), F + 'f', skin(0.95));
    B.add(blob(Q(q, [1, 1, 2, 2])), F + 'f', skin(0.9), { matrix: M(sx * 0.088, 0.028, 0.375, 0, 0, 0, 0.032, 0.022, 0.045) });
    claws(sx * 0.088, 0.39, F + 'f');
    // the hind leg: a hard knot of haunch, then a long shank back to the hock
    B.add(loft([{ p: [sx * 0.085, 0.88, -0.27], r: [0.055, 0.1] }, { p: [sx * 0.093, 0.73, -0.25], r: [0.058, 0.11] }, { p: [sx * 0.095, 0.6, -0.21], r: [0.04, 0.06] }, { p: [sx * 0.095, 0.55, -0.2], r: [0.028, 0.032] }], { radial: lr + 2, rings: lrings + 2, ref: [0, 0, 1] }), Hh + 'u', skin());
    B.add(blob(1), Hh + 'l', skin(), { matrix: M(sx * 0.095, 0.56, -0.2, 0, 0, 0, 0.03, 0.034, 0.034) });
    B.add(loft([{ p: [sx * 0.095, 0.56, -0.2], r: [0.027, 0.03] }, { p: [sx * 0.095, 0.44, -0.31], r: [0.021, 0.024] }, { p: [sx * 0.095, 0.32, -0.42], r: [0.018, 0.02] }], { radial: lr, rings: lrings, ref: [0, 0, 1] }), Hh + 'l', skin(0.95));
    B.add(blob(1), Hh + 'f', skin(), { matrix: M(sx * 0.095, 0.32, -0.42, 0, 0, 0, 0.022, 0.026, 0.026) });
    B.add(loft([{ p: [sx * 0.095, 0.32, -0.42], r: [0.018, 0.02] }, { p: [sx * 0.096, 0.16, -0.39], r: [0.016, 0.018] }, { p: [sx * 0.097, 0.05, -0.37], r: [0.018, 0.02] }], { radial: lr, rings: lrings, ref: [0, 0, 1] }), Hh + 'f', skin(0.95));
    B.add(blob(Q(q, [1, 1, 2, 2])), Hh + 'f', skin(0.9), { matrix: M(sx * 0.097, 0.028, -0.355, 0, 0, 0, 0.03, 0.022, 0.044) });
    claws(sx * 0.097, -0.34, Hh + 'f');
  }
  // tail: a bare whip, dropping steeply and then streaming back, spined along its top
  const tailC = [{ p: [0, 0.85, -0.33], r: [0.028, 0.03] }, { p: [0, 0.72, -0.39], r: [0.022, 0.024] }, { p: [0, 0.6, -0.43], r: [0.018, 0.019] }, { p: [0, 0.5, -0.48], r: [0.014, 0.015] }, { p: [0, 0.43, -0.53], r: [0.011, 0.011] }, { p: [0, 0.36, -0.6], r: [0.007, 0.007] }, { p: [0, 0.31, -0.68], r: [0.002, 0.002] }];
  const tailBind = (x, y, z) => along1([[-0.55, 'tail3'], [-0.43, 'tail2'], [-0.34, 'tail1']])(z);
  B.add(loft(tailC, { radial: Math.max(6, radial >> 1), rings, ref: [0, 0, -1] }), tailBind, skin(0.9));
  for (let i = 0, n = Q(q, [0, 4, 6, 8]); i < n; i++) { const t = 0.1 + (i / n) * 0.8, s = loftSurface(tailC, t, Math.PI / 2, [0, 0, -1], 0.95); B.add(cone(4, 0.006, 0.022 * (1 - t * 0.5)), tailBind, bone_, { flat: true, matrix: along(s.p, s.n.clone().add(new V3(0, 0, -0.8)).normalize()) }); }
  return { def, geo: B.build(), eyes: { bone: 'head', pos: [0, 1.2, 0.62], spread: 0.038, n: 2 }, height: 1.27, roughness: 0.62, side: THREE.FrontSide, accent: null };
}

// =====================================================================
//  RESONANCE CHOIR (CR39) — a broken bronze bell that floats at chest
//  height, and four porcelain masks that sing around it on threads of
//  violet light. It never strikes: it makes the others sharper. Its
//  pieces wear their own pictures (tools/choir.py cuts them from the sheet).
// =====================================================================
function choir(q) {
  srand(8008 + q);
  const def = bones([['root', null, 0, 0, 0], ['core', 'root', 0, 1.3, 0], ['ring', 'core', 0, 1.35, 0]]);
  const B = new RigBuilder(def), V = ATLAS.choir ? ATLAS.choir.views : null, seg = Q(q, [10, 16, 24, 32]);
  const decalOf = (R, cx, cy, rx, ry) => (R ? (x, y) => [lerp(R[0], R[2], clamp(0.5 + 0.5 * (x - cx) / rx, 0, 1)), lerp(R[1], R[3], clamp(0.5 - 0.5 * (y - cy) / ry, 0, 1))] : null);
  // the bell: a cracked dome, open and ragged beneath
  const prof = []; for (let i = 0; i <= 10; i++) { const t = i / 10, a = t * Math.PI * 0.5; prof.push(new THREE.Vector2(0.02 + 0.27 * Math.sin(a) + (t > 0.85 ? 0.03 * (t - 0.85) / 0.15 : 0), 1.52 - 0.42 * (1 - Math.cos(a)) - (t > 0.8 ? 0.12 * (t - 0.8) / 0.2 : 0))); }
  const bell = new THREE.LatheGeometry(prof, seg); { const p = bell.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < 1.2) p.setY(i, y - 0.08 * Math.max(0, nz3(p.getX(i) * 9, 2, p.getZ(i) * 9))); } }
  B.add(bell, 'core', C(0x5a4a30), { decal: decalOf(V && V.bell, 0, 1.3, 0.33, 0.27) });
  B.add(blob(1), 'core', C(0x6a5a3a), { matrix: M(0, 1.55, 0, 0, 0, 0, 0.04, 0.05, 0.04), decal: decalOf(V && V.bell, 0, 1.3, 0.33, 0.27) }); // the crown knob
  // the four singers, each in its frame, on the ring that turns about the bell
  const masks = [[-0.56, 1.42], [0.56, 1.42], [0, 2.1], [0, 0.55]];
  for (const [mx, my] of masks) {
    B.add(blob(Q(q, [1, 2, 2, 3]), (x, y, z) => [x, y, z < 0 ? z * 0.4 : z]), 'ring', C(0xd8d0c0), { matrix: M(mx, my, 0.02, 0, 0, 0, 0.12, 0.155, 0.07), decal: decalOf(V && V.face, mx, my, 0.15, 0.19) });
    B.add(new THREE.TorusGeometry(1, 0.08, 4, seg), 'ring', C(0x8a6a3a), { matrix: M(mx, my, 0.0, 0, 0, 0, 0.135, 0.17, 0.12), decal: decalOf(V && V.face, mx, my, 0.15, 0.19) });
    // the thread of light from the bell to it
    const a = new V3(mx * 0.45, lerp(1.3, my, 0.45), 0), b = new V3(mx * 0.92, lerp(1.3, my, 0.86), 0), d = b.clone().sub(a);
    B.add(new THREE.CylinderGeometry(0.008, 0.008, d.length(), 4), 'ring', [1.1, 0.6, 1.9], { slot: 2, matrix: along(a.clone().add(b).multiplyScalar(0.5), d.normalize()) });
  }
  return { def, geo: B.build(), eyes: null, height: 2.2, roughness: 0.55, side: THREE.FrontSide, accent: 'glow' };
}

// =====================================================================
//  THE VILLAGE PEOPLE (CR19–CR24) — Elder Maren, Sev, Lyn, Farmer Ged and
//  the girl. Each body is lofted straight through its sheet's silhouettes:
//  at every 4 cm of height, the front view gives the width and the side
//  view the depth (tools/villagers.py measures them), so dresses, coats,
//  packs, cloaks and hat brims come out the right shape on their own.
//  Legs split where the silhouette does; arms that hang clear of the body
//  get their own limbs. Then the sheet is projected on (projectUV).
// =====================================================================
const ROBED = new Set(['wraith', 'king', 'witness']);
function figure(q, who) {
  const F = FIG[who], H = F.H, rows = F.rows;
  srand(9100 + q * 7 + who.length);
  const mid = ([a, b]) => (a + b) / 2, half = ([a, b]) => Math.max(0.018, (b - a) / 2);
  const sideUnion = (r) => (r.s.length ? [Math.min(...r.s.map((x) => x[0])), Math.max(...r.s.map((x) => x[1]))] : [-0.08, 0.08]);
  const sideMain = (r) => (r.s.length ? r.s.reduce((m, x) => (x[1] - x[0] > m[1] - m[0] ? x : m)) : [-0.08, 0.08]);
  // classify each row: the body (a run over the axis), else two legs; arms hanging clear of the body
  const body = [], legs = { L: [], R: [] }, arms = { L: [], R: [] };
  for (const r of rows) {
    const b = r.f.find(([a, c]) => a <= 0.03 && c >= -0.03);
    if (b) {
      body.push({ y: r.y, f: b, s: sideMain(r) });
      if (r.y > H * 0.35 && r.y < H * 0.85) for (const run of r.f) if (run !== b && run[1] - run[0] < 0.22) (run[0] > b[1] ? arms.L : arms.R).push({ y: r.y, f: run, s: sideMain(r) });
    } else if (!body.length) {
      const L = r.f.filter((x) => mid(x) > 0).sort((a, c) => mid(a) - mid(c))[0], R = r.f.filter((x) => mid(x) < 0).sort((a, c) => mid(c) - mid(a))[0], su = sideUnion(r);
      if (L) legs.L.push({ y: r.y, f: L, s: su }); if (R) legs.R.push({ y: r.y, f: R, s: su });
    }
  }
  if (ROBED.has(who)) for (let i = 2; i < body.length - 2; i++) { // a halo ring or a held blade widens a row or two of the hull: take its neighbours' width
    const r = body[i], nb = [body[i - 2], body[i - 1], body[i + 1], body[i + 2]], hw = nb.reduce((a, q) => a + half(q.f), 0) / 4, hd = nb.reduce((a, q) => a + half(q.s), 0) / 4;
    if (half(r.f) > hw * 1.18) { const m = (nb[1].f[0] + nb[1].f[1] + nb[2].f[0] + nb[2].f[1]) / 4; r.f = [m - hw, m + hw]; }
    if (half(r.s) > hd * 1.25) { const m = (nb[1].s[0] + nb[1].s[1] + nb[2].s[0] + nb[2].s[1]) / 4; r.s = [m - hd, m + hd]; }
  }
  const crotch = legs.L.length ? legs.L[legs.L.length - 1].y : 0, at = (y) => body.reduce((m, r) => (Math.abs(r.y - y) < Math.abs(m.y - y) ? r : m), body[0]);
  const zc = mid(at(H * 0.6).s), sh = at(H * 0.8), shX = Math.max(0.12, half(sh.f) * 0.78), legX = legs.L.length ? Math.abs(mid(legs.L[Math.floor(legs.L.length / 2)].f)) : 0.1;
  const def = bones([
    ['root', null, 0, 0, 0], ['hips', 'root', 0, H * 0.53, zc], ['spine', 'hips', 0, H * 0.62, zc], ['chest', 'spine', 0, H * 0.74, zc], ['neck', 'chest', 0, H * 0.86, zc], ['head', 'neck', 0, H * 0.92, zc],
    ['shL', 'chest', shX, H * 0.81, zc], ['elL', 'shL', shX + 0.03, H * 0.62, zc], ['hdL', 'elL', shX + 0.04, H * 0.47, zc + 0.03],
    ['shR', 'chest', -shX, H * 0.81, zc], ['elR', 'shR', -shX - 0.03, H * 0.62, zc], ['hdR', 'elR', -shX - 0.04, H * 0.47, zc + 0.03],
    ['thL', 'hips', legX, Math.max(crotch, H * 0.45), zc], ['knL', 'thL', legX, H * 0.28, zc], ['ftL', 'knL', legX, H * 0.05, zc],
    ['thR', 'hips', -legX, Math.max(crotch, H * 0.45), zc], ['knR', 'thR', -legX, H * 0.28, zc], ['ftR', 'knR', -legX, H * 0.05, zc],
    ...(who === 'witness' ? [['halo', 'chest', 0, 2.45, zc], ['crown', 'head', 0, 3.25, zc]] : []),
  ]);
  const B = new RigBuilder(def), radial = Q(q, [8, 12, 16, 22]), ringK = Q(q, [0.5, 1, 1.5, 2]), cloth = [0.45, 0.4, 0.35];
  const ctrl = (list, zs = 1, xs = 1) => list.map((r) => ({ p: [mid(r.f), r.y, mid(r.s)], r: [half(r.f) * xs, Math.max(0.02, half(r.s) * zs)] }));
  const wob = (amp) => (a, t) => 1 + amp * nz3(Math.cos(a) * 2 + t * 3, t * 11, Math.sin(a) * 2);
  // body: from the crotch (or the hem of a dress) to the crown of the head, closed with a little dome
  const bc = ctrl(body); const top = bc[bc.length - 1]; bc.push({ p: [top.p[0], top.p[1] + 0.012, top.p[2]], r: [top.r[0] * 0.5, top.r[1] * 0.5] });
  B.add(loft(bc, { radial: radial + 6, rings: Math.max(8, Math.round(bc.length * ringK)), ref: [0, 0, 1], shape: wob(0.015) }), (x, y) => along1([[H * 0.5, 'hips'], [H * 0.62, 'spine'], [H * 0.74, 'chest'], [H * 0.85, 'neck'], [H * 0.9, 'head']])(y), cloth);
  for (const S of ['L', 'R']) {
    const lg = legs[S]; if (lg.length >= 2) {
      const c = ctrl(lg, 1, 1).map((k) => { k.r[1] = Math.min(k.r[1], k.r[0] * 1.6 + 0.04); return k; }); c.push({ p: [c[c.length - 1].p[0] * 0.8, crotch + 0.08, c[c.length - 1].p[2]], r: c[c.length - 1].r });
      B.add(loft(c, { radial, rings: Math.max(6, Math.round(c.length * ringK)), ref: [0, 0, 1] }), (x, y) => along1([[H * 0.07, 'ft' + S], [H * 0.28, 'kn' + S], [H * 0.47, 'th' + S]])(y), cloth);
    }
    const am = arms[S]; if (am.length >= 3) {
      const c = am.map((r) => ({ p: [mid(r.f), r.y, mid(r.s) * 0.5 + zc * 0.5], r: [half(r.f), half(r.f) * 1.1] }));
      const sx = S === 'L' ? 1 : -1, last = c[c.length - 1]; c.push({ p: [sx * shX, H * 0.8, zc], r: last.r });
      B.add(loft(c, { radial: Math.max(6, radial - 4), rings: Math.max(5, Math.round(c.length * ringK)), ref: [0, 0, 1] }), (x, y) => along1([[H * 0.47, 'hd' + S], [H * 0.62, 'el' + S], [H * 0.78, 'sh' + S]])(y), cloth);
    }
  }
  // what they carry: Lyn's spear, Ged's pitchfork (untextured: wood and steel)
  const wood = C(0x5a4630), steel = C(0x9a9a9e), brass = C(0x8a6a2a), seg = Q(q, [5, 6, 8, 10]);
  if (who === 'lyn') {
    const x = -0.262, z = zc + 0.06;
    B.add(new THREE.CylinderGeometry(0.016, 0.018, 1.94, seg), 'hdR', wood, { slot: 2, matrix: M(x, 0.97, z) });
    for (const y of [1.72, 1.8, 1.88]) B.add(new THREE.CylinderGeometry(0.021, 0.021, 0.03, seg), 'hdR', brass, { slot: 2, matrix: M(x, y, z) });
    B.add(blob(1, (px, py, pz) => [px * (1 - Math.abs(py) * 0.2), py, pz * 0.25]), 'hdR', steel, { slot: 2, matrix: M(x, 2.0, z, 0, 0, 0, 0.035, 0.075, 0.035) });
  } else if (who === 'ged') {
    const x = -0.286, z = zc + 0.08;
    B.add(new THREE.CylinderGeometry(0.017, 0.019, 1.6, seg), 'hdR', wood, { slot: 2, matrix: M(x, 0.85, z) });
    B.add(new THREE.BoxGeometry(0.17, 0.025, 0.025), 'hdR', steel, { slot: 2, matrix: M(x, 1.66, z) });
    for (const tx of [-0.068, -0.023, 0.023, 0.068]) B.add(cone(4, 0.008, 0.28), 'hdR', steel, { slot: 2, flat: true, matrix: M(x + tx, 1.66, z) });
  }
  else if (who === 'wraith') { // the captain's long sword, point down across his robes, as drawn
    const hand = new V3(-0.26, 1.26, zc + 0.12), tip = new V3(0.04, 0.09, zc + 0.3), dir = tip.clone().sub(hand), L = dir.length(); dir.normalize();
    B.add(new THREE.BoxGeometry(0.012, L * 0.86, 0.045, 1, Q(q, [2, 6, 10, 14]), 1), 'hdR', (x, y, z, nx) => shade(steel, Math.abs(nx) > 0.7 ? 1 : 0.7), { slot: 2, matrix: along(hand.clone().addScaledVector(dir, L * 0.5), dir) });
    B.add(new THREE.BoxGeometry(0.028, 0.024, 0.2), 'hdR', brass, { slot: 2, matrix: along(hand.clone().addScaledVector(dir, 0.07), dir) });
    B.add(new THREE.CylinderGeometry(0.016, 0.016, 0.16, seg), 'hdR', C(0x2a2228), { slot: 2, matrix: along(hand.clone().addScaledVector(dir, -0.02), dir) });
  } else if (who === 'witness') { // the crown floats above it, two rings of light turn about it, and the eye in its breast burns
    const gold = C(0xd8a840), ring = (r, y, k) => B.add(new THREE.TorusGeometry(r, 0.012, 4, Q(q, [24, 40, 56, 72])), 'halo', [1.6 * k, 1.1 * k, 0.5 * k], { slot: 2, matrix: M(0, y, zc, Math.PI / 2 + (k - 1) * 0.08, 0, 0) });
    ring(0.95, 2.45, 1); ring(0.82, 2.5, 0.8);
    B.add(new THREE.CylinderGeometry(0.17, 0.15, 0.08, Q(q, [10, 16, 22, 28]), 1, true), 'crown', gold, { slot: 2, matrix: M(0, 3.22, zc) });
    for (let i = 0, n = 7; i < n; i++) { const a = (i / n) * TAU; B.add(cone(4, 0.03, i % 2 ? 0.1 : 0.16), 'crown', gold, { slot: 2, flat: true, matrix: M(Math.cos(a) * 0.16, 3.26, zc + Math.sin(a) * 0.16) }); }
    B.add(blob(Q(q, [1, 2, 2, 3]), (x, y, z) => [x, y, z * 0.35]), 'chest', [2.2, 1.5, 0.6], { slot: 2, matrix: M(0, 2.64, zc + 0.3, 0, 0, 0, 0.11, 0.3, 0.08) });
  }
  const eyes = who === 'wraith' ? { bone: 'head', pos: [0, 2.12, zc + 0.16], spread: 0.035, n: 2 } : who === 'witness' ? { bone: 'chest', pos: [0, 2.64, zc + 0.34], spread: 0, n: 1 } : null;
  return { def, geo: B.build(), eyes, height: H, roughness: 0.88, side: ROBED.has(who) ? THREE.DoubleSide : THREE.FrontSide, accent: who === 'witness' ? 'glow' : 'steel', person: true };
}

const BUILDERS = { wolf, leech, moth, bandit: (q) => bandit(q, false), leader: (q) => bandit(q, true), sentinel: (q) => sentinel(q, false), guardian: (q) => sentinel(q, true), hound, maren: (q) => figure(q, 'maren'), sev: (q) => figure(q, 'sev'), lyn: (q) => figure(q, 'lyn'), ged: (q) => figure(q, 'ged'), girl: (q) => figure(q, 'girl'), wraith: (q) => figure(q, 'wraith'), king: (q) => figure(q, 'king'), witness: (q) => figure(q, 'witness'), choir };
const cache = {};
export const TEXTURED = new Set(['wolf', 'bandit', 'leader', 'sentinel', 'guardian', 'hound', 'maren', 'sev', 'lyn', 'ged', 'girl', 'wraith', 'king', 'witness', 'choir']); // leech: its atlas is built (tools/atlas.py), body not yet refit
export function getRig(type, q) {
  const k = type + q;
  if (!cache[k]) {
    const r = (cache[k] = BUILDERS[type](q));
    if (TEXTURED.has(type) && ATLAS[type]) { projectUV(r.geo, ATLAS[type], r.uvExtra || [], r.uvOpts || {}); r.atlas = ATLAS[type]; r.atlasName = type; }
    for (const a of ['pin', 'decal']) if (r.geo.attributes[a]) r.geo.deleteAttribute(a); // only projectUV reads them
  }
  return cache[k];
}
export function rigTris(type, q) { return getRig(type, q).geo.userData.tris; }
export function makeSkeleton(def) {
  const out = def.map((b) => { const bone = new THREE.Bone(); bone.name = b.name; return bone; }), by = {};
  def.forEach((b, i) => { by[b.name] = out[i]; });
  def.forEach((b, i) => {
    const pp = b.parent ? def.find((d) => d.name === b.parent).pos : [0, 0, 0];
    out[i].position.set(b.pos[0] - pp[0], b.pos[1] - pp[1], b.pos[2] - pp[2]);
    out[i].userData.base = out[i].position.clone();
    if (b.parent) by[b.parent].add(out[i]);
  });
  return { bones: out, by, skeleton: new THREE.Skeleton(out) };
}
export { LEECH_N };
