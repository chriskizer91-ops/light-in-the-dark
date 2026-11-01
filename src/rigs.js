import { THREE, rnd, rr, ri, srand, clamp, lerp, nz3, TAU } from './engine.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
    this.slots = [0, 1, 2].map(() => ({ p: [], n: [], c: [], si: [], sw: [] }));
  }
  // bind: a bone name, or (x,y,z) => [bone, w, bone2, w2]. color: THREE.Color, [r,g,b], or (x,y,z,nx,ny,nz) => colour
  add(geo, bind, color, o = {}) {
    let g = geo.clone();
    if (o.flat) { if (g.index) g = g.toNonIndexed(); if (o.matrix) g.applyMatrix4(o.matrix); g.computeVertexNormals(); }
    else { g.computeVertexNormals(); if (o.matrix) g.applyMatrix4(o.matrix); if (g.index) g = g.toNonIndexed(); }
    const P = g.attributes.position, N = g.attributes.normal, S = this.slots[o.slot || 0];
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i);
      S.p.push(x, y, z); S.n.push(nx, ny, nz);
      let c = typeof color === 'function' ? color(x, y, z, nx, ny, nz) : color;
      if (c.isColor) S.c.push(c.r, c.g, c.b); else S.c.push(c[0], c[1], c[2]);
      const b = typeof bind === 'function' ? bind(x, y, z) : [bind, 1];
      S.si.push(this.bi[b[0]], b.length > 2 ? this.bi[b[2]] : 0, 0, 0); S.sw.push(b[1], b.length > 2 ? b[3] : 0, 0, 0);
    }
    g.dispose();
  }
  build() {
    const A = { p: [], n: [], c: [], si: [], sw: [] }, g = new THREE.BufferGeometry(); let start = 0;
    this.slots.forEach((s, k) => {
      const cnt = s.p.length / 3; if (!cnt) return;
      for (const key in A) A[key] = A[key].concat(s[key]);
      g.addGroup(start, cnt, k); start += cnt;
    });
    g.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(A.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(A.c, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(A.si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(A.sw, 4));
    g.computeBoundingSphere(); g.userData.keep = true; g.userData.tris = start / 3;
    return g;
  }
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
//  WOLF — a starving grey wolf. Raised hackles, a jaw that opens, a tail.
// =====================================================================
function wolf(q) {
  srand(1001 + q);
  const def = bones([
    ['root', null, 0, 0, 0], ['pelvis', 'root', 0, 0.7, -0.42], ['spine', 'pelvis', 0, 0.74, -0.05], ['chest', 'spine', 0, 0.77, 0.3],
    ['hackles', 'spine', 0, 0.9, 0.05], ['neck', 'chest', 0, 0.88, 0.48], ['head', 'neck', 0, 1.0, 0.66], ['jaw', 'head', 0, 0.955, 0.74],
    ['earL', 'head', 0.065, 1.1, 0.66], ['earR', 'head', -0.065, 1.1, 0.66],
    ['FLu', 'chest', 0.11, 0.7, 0.34], ['FLl', 'FLu', 0.12, 0.4, 0.36], ['FLf', 'FLl', 0.12, 0.08, 0.37],
    ['FRu', 'chest', -0.11, 0.7, 0.34], ['FRl', 'FRu', -0.12, 0.4, 0.36], ['FRf', 'FRl', -0.12, 0.08, 0.37],
    ['HLu', 'pelvis', 0.12, 0.7, -0.44], ['HLl', 'HLu', 0.13, 0.46, -0.36], ['HLf', 'HLl', 0.13, 0.2, -0.5],
    ['HRu', 'pelvis', -0.12, 0.7, -0.44], ['HRl', 'HRu', -0.13, 0.46, -0.36], ['HRf', 'HRl', -0.13, 0.2, -0.5],
    ['tail1', 'pelvis', 0, 0.76, -0.6], ['tail2', 'tail1', 0, 0.68, -0.8], ['tail3', 'tail2', 0, 0.57, -0.96],
  ]);
  const B = new RigBuilder(def), radial = Q(q, [8, 14, 20, 28]), rings = Q(q, [8, 16, 24, 34]), tuftSides = q >= 2 ? 5 : 4;
  const back = C(0x1e1a17), side = C(0x3c352f), belly = C(0x5c544a), muzzleC = C(0x645a4e), dark = C(0x141210), inner = C(0x4a3430);
  const fur = (k = 1) => (x, y, z) => { const t = clamp((y - 0.5) / 0.45, 0, 1), c = t < 0.5 ? mixc(belly, side, t * 2) : mixc(side, back, (t - 0.5) * 2), n = 0.82 + 0.36 * noise(x * 13, y * 13, z * 13); return shade(c, n * k); };
  const shag = (amp, f = 1) => (a, t) => 1 + amp * nz3(Math.cos(a) * 3 * f, t * 14 * f, Math.sin(a) * 3 * f);
  // torso: deep chest, tucked waist, bony hips
  const torso = [{ p: [0, 0.7, -0.66], r: [0.09, 0.11] }, { p: [0, 0.72, -0.47], r: [0.15, 0.18] }, { p: [0, 0.71, -0.2], r: [0.13, 0.155] },
    { p: [0, 0.74, 0.08], r: [0.155, 0.21] }, { p: [0, 0.77, 0.3], r: [0.165, 0.245] }, { p: [0, 0.81, 0.45], r: [0.13, 0.18] }];
  const bodyBind = (x, y, z) => along1([[-0.42, 'pelvis'], [-0.05, 'spine'], [0.3, 'chest']])(z);
  B.add(loft(torso, { radial, rings, shape: (a, t) => shag(0.05)(a, t) * (Math.sin(a) < 0 ? 1 - 0.16 * -Math.sin(a) * Math.exp(-(((t - 0.42) / 0.16) ** 2)) : 1) }), bodyBind, fur());
  // neck + ruff
  const neckC = [{ p: [0, 0.8, 0.36], r: [0.135, 0.17] }, { p: [0, 0.9, 0.52], r: [0.115, 0.135] }, { p: [0, 0.99, 0.64], r: [0.09, 0.1] }];
  const neckBind = (x, y, z) => along1([[0.38, 'chest'], [0.5, 'neck'], [0.64, 'head']])(z);
  B.add(loft(neckC, { radial, rings: Math.max(4, rings >> 1), shape: shag(0.07) }), neckBind, fur(0.95));
  const tuft = (s, dir, len, r, bind, colr, slot = 0) => B.add(cone(tuftSides, r, len), bind, colr, { flat: true, matrix: along(s, dir), slot });
  const furTufts = (ctrl, n, bind, k, tMin, tMax, back0 = -1, lenK = 1) => {
    for (let i = 0; i < n; i++) {
      const t = rr(tMin, tMax), a = rr(-0.4, Math.PI + 0.4), s = loftSurface(ctrl, t, a, [0, 1, 0], 0.92);
      // fur lies down along the body: a flattened blade, mostly pointing back, coloured like the coat under it
      const dir = s.n.clone().multiplyScalar(0.28).add(new V3(0, -0.1, back0)).normalize(), fc = fur(0.8 + 0.35 * rnd())(s.p.x, s.p.y, s.p.z);
      B.add(cone(tuftSides, rr(0.02, 0.03), rr(0.07, 0.12) * lenK), bind, fc, { flat: true, matrix: along(s.p, dir, 1, 1, 0.35, Math.atan2(s.n.x, s.n.z)) });
    }
  };
  furTufts(neckC, Q(q, [8, 22, 40, 64]), neckBind, 1, 0.05, 0.9, -1, 1.25);
  furTufts(torso, Q(q, [0, 26, 60, 120]), bodyBind, 1, 0.08, 0.92);
  // hackles along the spine: raised by scaling their bone when the wolf means it
  for (let i = 0, n = Q(q, [4, 12, 18, 28]); i < n; i++) {
    const t = lerp(0.3, 0.88, i / (n - 1)) + rr(-0.02, 0.02), s = loftSurface(torso, t, Math.PI / 2 + rr(-0.35, 0.35), [0, 1, 0], 0.95);
    tuft(s.p, new V3(rr(-0.15, 0.15), 1, -0.75).normalize(), rr(0.07, 0.12), 0.02, 'hackles', shade(back, 0.75 + 0.2 * rnd()));
  }
  // head: skull, muzzle, nose, brows, eyes, teeth, ears, cheek ruff
  const d = Q(q, [1, 2, 3, 3]);
  const headCol = (x, y, z) => { if (z > 0.74 && y < 1.035) return shade(muzzleC, 0.85 + 0.25 * noise(x * 20, y * 20, z * 20)); if (y > 1.06 && z > 0.72) return shade(dark, 1.4); return fur(1)(x, y + 0.08, z); };
  B.add(blob(d, (x, y, z) => [x * (1 + 0.12 * (z < 0 ? 1 : 0)), y * (y > 0 ? 0.82 : 1), z]), 'head', headCol, { matrix: M(0, 1.03, 0.7, 0, 0, 0, 0.115, 0.105, 0.14) });
  B.add(loft([{ p: [0, 1.0, 0.74], r: [0.07, 0.065] }, { p: [0, 0.99, 0.85], r: [0.05, 0.047] }, { p: [0, 0.977, 0.93], r: [0.034, 0.034] }], { radial, rings: Math.max(4, rings >> 1) }), 'head', headCol);
  for (const sx of [-1, 1]) B.add(blob(1), 'head', shade(back, 0.9), { matrix: M(sx * 0.05, 1.075, 0.775, 0, 0, sx * 0.3, 0.035, 0.016, 0.04) }); // brows
  B.add(blob(Q(q, [1, 1, 2, 2])), 'head', C(0x0c0a0a), { slot: 1, matrix: M(0, 0.988, 0.952, 0, 0, 0, 0.026, 0.021, 0.02) });   // nose
  const eyeC = (x, y, z, nx, ny, nz) => (nz > 0.6 ? [0.32, 0.18, 0.04] : [0.03, 0.02, 0.02]);
  for (const sx of [-1, 1]) B.add(blob(Q(q, [1, 1, 2, 2])), 'head', eyeC, { slot: 1, matrix: M(sx * 0.052, 1.045, 0.79, 0, sx * 0.35, 0, 0.018, 0.016, 0.016) });
  const ivory = C(0xd8ceb8);
  for (const sx of [-1, 1]) {
    tuft(new V3(sx * 0.024, 0.975, 0.925), new V3(0, -1, 0.15), 0.04, 0.007, 'head', ivory, 1);  // upper canines
    for (let i = 0; i < Q(q, [1, 3, 5, 7]); i++) tuft(new V3(sx * (0.03 + i * 0.004), 0.972, 0.9 - i * 0.022), new V3(0, -1, 0), 0.016, 0.005, 'head', ivory, 1);
    tuft(new V3(sx * 0.02, 0.95, 0.905), new V3(0, 1, 0.1), 0.032, 0.006, 'jaw', ivory, 1);      // lower canines
  }
  B.add(loft([{ p: [0, 0.955, 0.74], r: [0.05, 0.022] }, { p: [0, 0.949, 0.86], r: [0.038, 0.018] }, { p: [0, 0.946, 0.925], r: [0.025, 0.013] }], { radial, rings: 6 }), 'jaw', shade(muzzleC, 0.85));
  B.add(blob(1), 'jaw', C(0x6a3a3a), { matrix: M(0, 0.957, 0.83, 0, 0, 0, 0.026, 0.008, 0.07) }); // tongue
  for (const [sx, bone] of [[1, 'earL'], [-1, 'earR']]) {
    const ear = cone(Q(q, [3, 4, 6, 8]), 0.042, 0.115);
    B.add(ear, bone, (x, y, z, nx, ny, nz) => (nz > 0.2 ? shade(inner, 0.8) : shade(back, 0.9)), { flat: q < 2, matrix: M(sx * 0.065, 1.08, 0.66, -0.15, 0, -sx * 0.28, 1, 1, 0.5) });
  }
  for (let i = 0; i < Q(q, [2, 8, 14, 22]); i++) { const sx = i % 2 ? 1 : -1, y = rr(0.97, 1.06), z = rr(0.6, 0.72); tuft(new V3(sx * 0.1, y, z), new V3(sx * 0.6, -0.2, -0.8).normalize(), rr(0.05, 0.09), 0.018, 'head', shade(side, 0.9 + 0.2 * rnd())); }
  // legs
  const legCol = (x, y, z) => shade(mixc(belly, side, 0.45 + clamp((y - 0.1) / 0.6, 0, 1) * 0.55), 0.8 + 0.3 * noise(x * 15, y * 15, z * 15));
  const lr = Math.max(6, radial - 4), lrings = Math.max(4, rings >> 1);
  const paw = (x, z, bone) => {
    B.add(blob(Q(q, [1, 1, 2, 2])), bone, shade(belly, 0.75), { matrix: M(x, 0.035, z + 0.025, 0, 0, 0, 0.044, 0.03, 0.058) });
    for (let i = 0; i < 4; i++) {
      const ox = (i - 1.5) * 0.019;
      if (q > 0) B.add(blob(1), bone, shade(belly, 0.7), { matrix: M(x + ox, 0.024, z + 0.07, 0, 0, 0, 0.012, 0.014, 0.016) });
      tuft(new V3(x + ox, 0.018, z + 0.084), new V3(0, -0.4, 1).normalize(), 0.018, 0.0045, bone, C(0x1a1612), 1);
    }
  };
  for (const sx of [1, -1]) {
    const F = sx > 0 ? 'FL' : 'FR', Hh = sx > 0 ? 'HL' : 'HR';
    B.add(loft([{ p: [sx * 0.11, 0.73, 0.33], r: [0.07, 0.085] }, { p: [sx * 0.115, 0.55, 0.35], r: [0.055, 0.06] }, { p: [sx * 0.12, 0.4, 0.36], r: [0.04, 0.045] }], { radial: lr, rings: lrings, ref: [0, 0, 1], shape: shag(0.05) }), F + 'u', legCol);
    B.add(loft([{ p: [sx * 0.12, 0.41, 0.36], r: [0.038, 0.04] }, { p: [sx * 0.12, 0.22, 0.365], r: [0.03, 0.032] }, { p: [sx * 0.12, 0.07, 0.37], r: [0.026, 0.028] }], { radial: lr, rings: lrings, ref: [0, 0, 1] }), F + 'l', legCol);
    paw(sx * 0.12, 0.37, F + 'f');
    B.add(loft([{ p: [sx * 0.12, 0.76, -0.42], r: [0.085, 0.13] }, { p: [sx * 0.125, 0.6, -0.38], r: [0.07, 0.09] }, { p: [sx * 0.13, 0.46, -0.36], r: [0.045, 0.05] }], { radial: lr, rings: lrings, ref: [0, 0, 1], shape: shag(0.05) }), Hh + 'u', legCol);
    B.add(loft([{ p: [sx * 0.13, 0.47, -0.36], r: [0.04, 0.045] }, { p: [sx * 0.13, 0.33, -0.43], r: [0.032, 0.035] }, { p: [sx * 0.13, 0.2, -0.5], r: [0.028, 0.03] }], { radial: lr, rings: lrings, ref: [0, 0, 1] }), Hh + 'l', legCol);
    B.add(loft([{ p: [sx * 0.13, 0.21, -0.5], r: [0.027, 0.029] }, { p: [sx * 0.13, 0.06, -0.46], r: [0.024, 0.026] }], { radial: lr, rings: 4, ref: [0, 0, 1] }), Hh + 'f', legCol);
    paw(sx * 0.13, -0.47, Hh + 'f');
  }
  // tail: bushy, darker at the tip
  const tailC = [{ p: [0, 0.76, -0.58], r: [0.045, 0.05] }, { p: [0, 0.71, -0.74], r: [0.075, 0.08] }, { p: [0, 0.62, -0.9], r: [0.075, 0.075] }, { p: [0, 0.52, -1.04], r: [0.05, 0.05] }, { p: [0, 0.45, -1.12], r: [0.012, 0.012] }];
  const tailBind = (x, y, z) => along1([[-0.98, 'tail3'], [-0.86, 'tail2'], [-0.7, 'tail1']])(z);
  B.add(loft(tailC, { radial: Math.max(6, radial - 2), rings, shape: shag(0.14, 1.4) }), tailBind, (x, y, z) => shade(z < -1.0 ? dark : mixc(side, back, 0.5), 0.85 + 0.3 * noise(x * 12, y * 12, z * 12)));
  furTufts(tailC, Q(q, [0, 8, 16, 26]), tailBind, 1, 0.15, 0.85, -1, 1.1);
  return { def, geo: B.build(), eyes: { bone: 'head', pos: [0, 1.045, 0.8], spread: 0.052, n: 2 }, height: 1.1, roughness: 0.95, side: THREE.FrontSide, accent: null };
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
    S.p.push(P.getX(i), P.getY(i), P.getZ(i)); S.n.push(N.getX(i), N.getY(i), N.getZ(i)); S.c.push(...colorAt(i));
    S.si.push(this.bi[bind], 0, 0, 0); S.sw.push(1, 0, 0, 0);
  }
  g.dispose();
};

// =====================================================================
//  FOREST BANDIT — hooded, bearded, a fur mantle, a cloak with a ragged
//  hem, a short sword and a buckler. Jointed for walking, striking,
//  blocking and sitting by the fire.
// =====================================================================
function bandit(q) {
  srand(4004 + q);
  const def = bones([['root', null, 0, 0, 0], ['hips', 'root', 0, 0.95, 0], ['spine', 'hips', 0, 1.12, 0], ['chest', 'spine', 0, 1.34, 0], ['neck', 'chest', 0, 1.52, 0], ['head', 'neck', 0, 1.62, 0.02],
    ['shL', 'chest', 0.19, 1.45, 0], ['elL', 'shL', 0.22, 1.17, 0], ['hdL', 'elL', 0.23, 0.93, 0.02], ['shR', 'chest', -0.19, 1.45, 0], ['elR', 'shR', -0.22, 1.17, 0], ['hdR', 'elR', -0.23, 0.93, 0.02],
    ['thL', 'hips', 0.1, 0.93, 0], ['knL', 'thL', 0.105, 0.51, 0.02], ['ftL', 'knL', 0.105, 0.09, 0], ['thR', 'hips', -0.1, 0.93, 0], ['knR', 'thR', -0.105, 0.51, 0.02], ['ftR', 'knR', -0.105, 0.09, 0],
    ['cloakA', 'chest', 0, 1.44, -0.14], ['cloakB', 'cloakA', 0, 1.0, -0.2]]);
  const B = new RigBuilder(def), radial = Q(q, [8, 14, 20, 26]), rings = Q(q, [6, 12, 18, 24]), d = Q(q, [1, 2, 2, 3]);
  const cloak = C(0x1e1b17), jerkin = C(0x2a2016), linen = C(0x3a3428), trousers = C(0x221e18), boots = C(0x16110c), belt = C(0x16100a), skin = C(0x7a5a48), beard = C(0x4a3e34), fur = C(0x3a3026), steel = C(0xa8b0b8), wood = C(0x3a2a1c);
  const vary = (c, k = 0.2, f = 20) => (x, y, z) => shade(c, 1 - k / 2 + k * noise(x * f, y * f, z * f));
  const tuft = (p, dir, len, r, bind, colr, slot = 0) => B.add(cone(4, r, len), bind, colr, { flat: true, matrix: along(p, dir), slot });
  // legs and boots
  for (const sx of [1, -1]) {
    const T_ = sx > 0 ? 'L' : 'R';
    B.add(loft([{ p: [sx * 0.1, 0.96, 0], r: [0.088, 0.092] }, { p: [sx * 0.105, 0.72, 0.01], r: [0.07, 0.075] }, { p: [sx * 0.105, 0.52, 0.02], r: [0.055, 0.06] }], { radial, rings, ref: [0, 0, 1] }), 'th' + T_, vary(trousers));
    B.add(loft([{ p: [sx * 0.105, 0.53, 0.02], r: [0.055, 0.06] }, { p: [sx * 0.105, 0.36, 0.0], r: [0.05, 0.055] }, { p: [sx * 0.105, 0.11, 0.0], r: [0.044, 0.046] }], { radial, rings, ref: [0, 0, 1] }), 'kn' + T_, (x, y, z) => (y < 0.42 ? vary(boots, 0.15)(x, y, z) : vary(trousers)(x, y, z)));
    B.add(new THREE.TorusGeometry(0.058, 0.014, 5, radial), 'kn' + T_, vary(boots, 0.1), { matrix: M(sx * 0.105, 0.42, 0.0, Math.PI / 2, 0, 0) });
    B.add(blob(d), 'ft' + T_, vary(boots, 0.15), { matrix: M(sx * 0.105, 0.05, 0.05, 0, 0, 0, 0.055, 0.045, 0.12) });
  }
  // hips, belt, pouches, a sheathed knife
  B.add(blob(d), 'hips', vary(trousers), { matrix: M(0, 0.95, 0, 0, 0, 0, 0.18, 0.12, 0.13) });
  B.add(new THREE.TorusGeometry(0.17, 0.022, 5, radial * 2), 'hips', belt, { matrix: M(0, 1.0, 0.005, Math.PI / 2, 0, 0, 1, 0.78, 1) });
  B.add(new THREE.BoxGeometry(0.05, 0.04, 0.012), 'hips', steel, { slot: 2, matrix: M(0, 1.0, 0.142) });
  for (const [x, z] of [[0.15, 0.06], [-0.14, 0.08], [0.17, -0.06]]) B.add(new THREE.BoxGeometry(0.07, 0.085, 0.045), 'hips', vary(C(0x4a3624), 0.25), { matrix: M(x, 0.95, z, 0, Math.atan2(x, z), 0) });
  B.add(new THREE.BoxGeometry(0.03, 0.2, 0.02), 'hips', belt, { matrix: M(-0.16, 0.9, -0.06, 0, 0, 0.2) });
  // torso: a laced leather jerkin over linen
  const tor = [{ p: [0, 0.96, 0], r: [0.165, 0.12] }, { p: [0, 1.12, 0.005], r: [0.155, 0.115] }, { p: [0, 1.32, 0.01], r: [0.2, 0.135] }, { p: [0, 1.46, 0], r: [0.18, 0.12] }, { p: [0, 1.53, 0], r: [0.075, 0.068] }];
  B.add(loft(tor, { radial: radial + 4, rings: rings + 2, ref: [0, 0, 1] }), (x, y, z) => along1([[1.0, 'hips'], [1.12, 'spine'], [1.34, 'chest']])(y),
    (x, y, z) => { if (y > 1.47) return vary(linen)(x, y, z); if (z > 0.08 && Math.abs(x) < 0.012) return shade(belt, 0.8); if (z > 0.08 && Math.abs(x) < 0.04 && Math.abs(((y * 30) % 1) - 0.5) < 0.12) return shade(linen, 1.1); return vary(jerkin, 0.3, 14)(x, y, z); });
  // fur mantle over the shoulders
  for (let i = 0, n = Q(q, [10, 26, 48, 80]); i < n; i++) {
    const a = rr(-0.3, Math.PI + 0.3), x = Math.cos(a) * rr(0.13, 0.22), z = Math.sin(a) * -0.13 + rr(-0.02, 0.06) * (Math.sin(a) < 0.3 ? 1 : 0);
    tuft(new V3(x, rr(1.44, 1.52), Math.abs(z) < 0.02 ? -0.1 : z), new V3(x * 3, -1.2, z < 0 ? -0.6 : 0.3).normalize(), rr(0.06, 0.1), 0.028, 'chest', vary(fur, 0.4, 30));
  }
  // arms
  for (const sx of [1, -1]) {
    const S = sx > 0 ? 'L' : 'R';
    B.add(loft([{ p: [sx * 0.19, 1.47, 0], r: [0.06, 0.06] }, { p: [sx * 0.21, 1.3, 0], r: [0.052, 0.052] }, { p: [sx * 0.22, 1.17, 0], r: [0.046, 0.046] }], { radial, rings, ref: [0, 0, 1] }), 'sh' + S, vary(linen));
    B.add(blob(d), 'sh' + S, vary(jerkin, 0.3), { matrix: M(sx * 0.2, 1.46, 0, 0, 0, sx * 0.4, 0.085, 0.06, 0.09) });
    B.add(loft([{ p: [sx * 0.22, 1.18, 0], r: [0.046, 0.046] }, { p: [sx * 0.225, 1.05, 0.01], r: [0.043, 0.043] }, { p: [sx * 0.23, 0.95, 0.02], r: [0.036, 0.036] }], { radial, rings, ref: [0, 0, 1] }), 'el' + S, (x, y, z) => (y < 1.1 ? vary(belt, 0.2)(x, y, z) : vary(linen)(x, y, z)));
    B.add(blob(d), 'hd' + S, vary(belt, 0.15), { matrix: M(sx * 0.232, 0.89, 0.035, 0, 0, 0, 0.038, 0.05, 0.034) });
    B.add(blob(1), 'hd' + S, vary(belt, 0.15), { matrix: M(sx * 0.21, 0.9, 0.06, 0, 0, 0, 0.014, 0.025, 0.014) });
  }
  // buckler on the left forearm
  B.add(new THREE.CylinderGeometry(0.17, 0.17, 0.025, Q(q, [10, 18, 26, 34])), 'elL', vary(wood, 0.35, 30), { matrix: M(0.29, 1.06, 0.02, 0, 0, Math.PI / 2) });
  B.add(new THREE.TorusGeometry(0.17, 0.012, 5, Q(q, [10, 18, 26, 34])), 'elL', steel, { slot: 2, matrix: M(0.302, 1.06, 0.02, 0, Math.PI / 2, 0) });
  B.add(blob(d), 'elL', steel, { slot: 2, matrix: M(0.305, 1.06, 0.02, 0, 0, 0, 0.022, 0.05, 0.05) });
  // the sword in the right hand, blade forward
  const sl = 0.68, hx = -0.232, hy = 0.89, hz = 0.035;
  B.add(new THREE.BoxGeometry(0.012, 0.042, sl, 1, 1, Q(q, [2, 6, 10, 14])), 'hdR', (x, y, z) => (Math.abs(y - hy) < 0.007 ? shade(steel, 0.6) : shade(steel, 1.0)), { slot: 2, matrix: M(hx, hy, hz + 0.09 + sl / 2) });
  B.add(cone(4, 0.03, 0.08), 'hdR', steel, { slot: 2, matrix: along(new V3(hx, hy, hz + 0.09 + sl), new V3(0, 0, 1), 0.35, 1, 1) });
  B.add(new THREE.BoxGeometry(0.03, 0.16, 0.024), 'hdR', vary(C(0x5a4a30), 0.2), { slot: 2, matrix: M(hx, hy, hz + 0.075) });
  B.add(new THREE.CylinderGeometry(0.016, 0.016, 0.12, 6), 'hdR', belt, { matrix: M(hx, hy, hz, Math.PI / 2, 0, 0) });
  B.add(blob(1), 'hdR', steel, { slot: 2, matrix: M(hx, hy, hz - 0.07, 0, 0, 0, 0.022, 0.022, 0.022) });
  // head: a face half in shadow, a beard, eyes with no shine in them
  B.add(blob(d), 'head', vary(skin, 0.15), { matrix: M(0, 1.66, 0.04, 0, 0, 0, 0.098, 0.12, 0.108) });
  B.add(blob(1), 'head', vary(skin, 0.1), { matrix: M(0, 1.66, 0.145, -0.2, 0, 0, 0.018, 0.03, 0.022) });
  for (const sx of [-1, 1]) B.add(blob(1), 'head', C(0x0a0806), { slot: 1, matrix: M(sx * 0.037, 1.685, 0.123, 0, 0, 0, 0.014, 0.009, 0.008) });
  for (let i = 0, n = Q(q, [6, 16, 28, 44]); i < n; i++) { const a = rr(-1.2, 1.2), p = new V3(Math.sin(a) * 0.085, rr(1.56, 1.63), 0.05 + Math.cos(a) * 0.085); tuft(p, new V3(Math.sin(a) * 0.3, -1, 0.35).normalize(), rr(0.05, 0.09), 0.018, 'head', vary(beard, 0.3, 40)); }
  // hood: a shell with the face pushed out of its opening, peaked at the back
  B.add(blob(d, (x, y, z) => { const open = z > 0.25 && y < 0.55 && Math.abs(x) < 0.75; return [x, y, open ? 0.25 + (z - 0.25) * 0.15 : z]; }), 'head', vary(cloak, 0.25), { matrix: M(0, 1.68, -0.005, 0, 0, 0, 0.14, 0.165, 0.15) });
  B.add(cone(Q(q, [4, 6, 8, 10]), 0.06, 0.16), 'head', vary(cloak), { matrix: along(new V3(0, 1.79, -0.1), new V3(0, 0.4, -1).normalize(), 1, 1, 0.6) });
  // cloak: an open half-cylinder from the shoulders, ragged at the hem
  {
    const su = Q(q, [8, 16, 24, 32]), sv = Q(q, [6, 12, 18, 24]), pos = [], idx = [];
    for (let i = 0; i <= su; i++) for (let j = 0; j <= sv; j++) {
      const u = i / su, v = j / sv, a = lerp(-1.9, 1.9, u), y = lerp(1.48, 0.42, v), r = lerp(0.2, 0.34, v), rag = v > 0.85 ? (noise(u * 30, 1, 2) - 0.5) * 0.18 * (v - 0.85) / 0.15 : 0;
      pos.push(Math.sin(a) * r, y + rag, -Math.cos(a) * r * 0.85 - 0.02 + 0.03 * Math.sin(u * 40) * v);
    }
    for (let i = 0; i < su; i++) for (let j = 0; j < sv; j++) { const a = i * (sv + 1) + j, b = a + 1, c = a + sv + 1, dd = c + 1; idx.push(a, b, c, b, dd, c); }
    const g = new THREE.BufferGeometry(); g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    B.add(g, (x, y, z) => along1([[1.0, 'cloakB'], [1.44, 'cloakA']])(y), vary(cloak, 0.3, 16));
  }
  return { def, geo: B.build(), eyes: null, height: 1.8, roughness: 0.85, side: THREE.DoubleSide, accent: 'steel', bladeBone: 'hdR', bladePos: [hx, hy, hz + 0.45] };
}

// =====================================================================
//  WAX SENTINEL — a hulking figure of old candle wax, faceless, one ember
//  socket for an eye, candles burning on its head and shoulders once it
//  wakes, and molten fissures that blaze when a pulse cracks it open.
//  The Ruin Guardian is the same thing, older and grey: a stone crown,
//  a broken shield grown into its arm, a rotted tabard.
// =====================================================================
function sentinel(q, guardian = false) {
  srand((guardian ? 6006 : 5005) + q);
  const def = bones([
    ['root', null, 0, 0, 0], ['hips', 'root', 0, 1.0, 0], ['spine', 'hips', 0, 1.24, 0.01], ['chest', 'spine', 0, 1.5, 0.04], ['neck', 'chest', 0, 1.76, 0.1], ['head', 'neck', 0, 1.9, 0.15],
    ['shL', 'chest', 0.34, 1.68, 0.03], ['elL', 'shL', 0.44, 1.22, 0.06], ['hdL', 'elL', 0.48, 0.82, 0.1],
    ['shR', 'chest', -0.34, 1.68, 0.03], ['elR', 'shR', -0.44, 1.22, 0.06], ['hdR', 'elR', -0.48, 0.82, 0.1],
    ['thL', 'hips', 0.16, 0.98, 0], ['knL', 'thL', 0.18, 0.54, 0.04], ['ftL', 'knL', 0.18, 0.1, 0],
    ['thR', 'hips', -0.16, 0.98, 0], ['knR', 'thR', -0.18, 0.54, 0.04], ['ftR', 'knR', -0.18, 0.1, 0],
  ]);
  const B = new RigBuilder(def), radial = Q(q, [8, 14, 22, 30]), rings = Q(q, [6, 12, 20, 28]), d = Q(q, [1, 2, 2, 3]);
  const wax = guardian ? C(0xa8a294) : C(0xd6caa8), grime = guardian ? C(0x4e4a42) : C(0x86765a), drip = guardian ? C(0xc4beac) : C(0xeee2c0), ember = C(0xff7a2a), stone = C(0x76716a), soot = C(0x241e1a);
  // wax gathers grime low down and in the hollows; it is paler where it has run
  const waxCol = (k = 1) => (x, y, z, nx, ny) => { const n = noise(x * 9, y * 9, z * 9), g = clamp(0.35 - ny * 0.35 + (y < 0.7 ? (0.7 - y) * 0.9 : 0) + (n - 0.5) * 0.5, 0, 1); return shade(mixc(wax, grime, g * 0.75), (0.82 + 0.3 * n) * k); };
  const lump = (amp, f = 1, seed = 0) => (a, t) => 1 + amp * nz3(Math.cos(a) * 2.5 * f + seed, t * 9 * f, Math.sin(a) * 2.5 * f - seed);
  // legs: thick, slumped columns that pool at the feet
  for (const sx of [1, -1]) {
    const S = sx > 0 ? 'L' : 'R';
    B.add(loft([{ p: [sx * 0.16, 1.02, 0], r: [0.16, 0.17] }, { p: [sx * 0.17, 0.76, 0.02], r: [0.14, 0.15] }, { p: [sx * 0.18, 0.55, 0.04], r: [0.12, 0.13] }], { radial, rings, ref: [0, 0, 1], shape: lump(0.07, 1, sx) }), 'th' + S, waxCol());
    B.add(loft([{ p: [sx * 0.18, 0.56, 0.04], r: [0.12, 0.13] }, { p: [sx * 0.18, 0.32, 0.02], r: [0.11, 0.12] }, { p: [sx * 0.18, 0.1, 0], r: [0.13, 0.14] }], { radial, rings, ref: [0, 0, 1], shape: lump(0.08, 1.3, sx * 2) }), 'kn' + S, waxCol(0.95));
    B.add(blob(d), 'ft' + S, waxCol(0.9), { matrix: M(sx * 0.18, 0.06, 0.06, 0, 0, 0, 0.13, 0.075, 0.18) });
    B.add(blob(d, (x, y, z) => [x * (1 + 0.15 * nz3(z * 4, x * 4, sx)), Math.min(y, 0.3), z]), 'ft' + S, shade(drip, 0.85), { matrix: M(sx * 0.18, 0.02, 0.05, 0, 0, 0, 0.19, 0.035, 0.23) });
  }
  B.add(blob(d), 'hips', waxCol(), { matrix: M(0, 1.0, 0, 0, 0, 0, 0.28, 0.17, 0.21) });
  // torso: a slumped barrel, hunched forward
  const torso = [{ p: [0, 1.0, 0], r: [0.26, 0.2] }, { p: [0, 1.22, 0.01], r: [0.24, 0.19] }, { p: [0, 1.48, 0.06], r: [0.36, 0.26] }, { p: [0, 1.66, 0.08], r: [0.39, 0.23] }, { p: [0, 1.8, 0.12], r: [0.15, 0.14] }];
  const tBind = (x, y, z) => along1([[1.04, 'hips'], [1.24, 'spine'], [1.5, 'chest'], [1.77, 'neck']])(y);
  B.add(loft(torso, { radial: radial + 4, rings: rings + 4, ref: [0, 0, 1], shape: lump(0.07, 1.2, 3) }), tBind, waxCol());
  // shoulders, arms hanging long, fists fused into mallets of wax
  for (const sx of [1, -1]) {
    const S = sx > 0 ? 'L' : 'R';
    B.add(blob(d), 'sh' + S, waxCol(), { matrix: M(sx * 0.33, 1.7, 0.04, 0, 0, sx * 0.3, 0.19, 0.16, 0.18) });
    B.add(loft([{ p: [sx * 0.34, 1.7, 0.03], r: [0.13, 0.13] }, { p: [sx * 0.4, 1.45, 0.04], r: [0.12, 0.12] }, { p: [sx * 0.44, 1.22, 0.06], r: [0.11, 0.11] }], { radial, rings, ref: [0, 0, 1], shape: lump(0.07, 1, sx + 5) }), 'sh' + S, waxCol());
    B.add(loft([{ p: [sx * 0.44, 1.23, 0.06], r: [0.11, 0.11] }, { p: [sx * 0.46, 1.02, 0.08], r: [0.12, 0.12] }, { p: [sx * 0.48, 0.86, 0.1], r: [0.14, 0.14] }], { radial, rings, ref: [0, 0, 1], shape: lump(0.08, 1.3, sx + 7) }), 'el' + S, waxCol(0.95));
    B.add(blob(d, (x, y, z) => [x * (1 + 0.12 * nz3(y * 5, z * 5, sx)), y, z]), 'hd' + S, waxCol(0.9), { matrix: M(sx * 0.485, 0.74, 0.11, 0, 0, 0, 0.17, 0.18, 0.17) });
    for (let i = 0; i < Q(q, [2, 4, 4, 4]); i++) B.add(blob(1), 'hd' + S, shade(drip, 0.8), { matrix: M(sx * 0.485 + (i - 1.5) * 0.06, 0.66, 0.24, 0, 0, 0, 0.045, 0.05, 0.05) });
  }
  // head: faceless, one sunken socket where the ember sits
  B.add(blob(d, (x, y, z) => [x, y, z > 0.55 ? 0.55 + (z - 0.55) * 0.35 : z]), 'head', waxCol(1.05), { matrix: M(0, 1.98, 0.16, 0.12, 0, 0, 0.15, 0.18, 0.16) });
  B.add(blob(Q(q, [1, 2, 2, 3])), 'head', C(0x0a0605), { slot: 1, matrix: M(0, 1.99, 0.255, 0, 0, 0, 0.05, 0.045, 0.03) });
  // candles: on the head (a crown of them) and the shoulders; the flames are sprites, lit when it wakes
  const candles = [];
  const candle = (bone, x, y, z, h, r) => {
    B.add(new THREE.CylinderGeometry(r, r * 1.08, h, Q(q, [5, 7, 9, 12])), bone, (px, py, pz) => shade(drip, 0.9 + 0.2 * noise(px * 60, py * 60, pz * 60)), { matrix: M(x, y + h / 2, z) });
    B.add(new THREE.CylinderGeometry(0.004, 0.004, 0.025, 4), bone, soot, { matrix: M(x, y + h + 0.012, z) });
    for (let i = 0; i < Q(q, [1, 2, 3, 4]); i++) { const a = rr(0, TAU); B.add(cone(4, r * 0.4, rr(0.04, h * 0.8)), bone, shade(drip, 1.05), { flat: true, matrix: along(new V3(x + Math.cos(a) * r, y + h - 0.005, z + Math.sin(a) * r), new V3(0, -1, 0)) }); }
    candles.push({ bone, pos: [x, y + h + 0.035, z], s: r * 3.2 });
  };
  if (guardian) {
    // the stone crown, with candles in its points
    B.add(new THREE.TorusGeometry(0.15, 0.03, Q(q, [4, 6, 8, 10]), Q(q, [10, 16, 24, 32])), 'head', (x, y, z) => shade(stone, 0.8 + 0.3 * noise(x * 30, y * 30, z * 30)), { matrix: M(0, 2.12, 0.15, Math.PI / 2 - 0.12, 0, 0, 1, 1, 0.8) });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.26, x = Math.sin(a) * 0.15, z = 0.15 + Math.cos(a) * 0.15; B.add(cone(4, 0.035, 0.12), 'head', shade(stone, 0.9), { flat: true, matrix: M(x, 2.12, z) }); if (i % 2 === 0) candle('head', x, 2.2, z, rr(0.06, 0.12), 0.022); }
  } else {
    candle('head', -0.07, 2.12, 0.13, 0.12, 0.028); candle('head', 0.02, 2.15, 0.17, 0.18, 0.03); candle('head', 0.09, 2.11, 0.11, 0.09, 0.026);
  }
  for (const sx of [1, -1]) { const S = sx > 0 ? 'L' : 'R'; candle('sh' + S, sx * 0.37, 1.84, 0.0, rr(0.1, 0.2), 0.033); candle('sh' + S, sx * 0.28, 1.83, -0.08, rr(0.07, 0.13), 0.03); }
  // runs of wax down the body
  for (let i = 0, n = Q(q, [8, 24, 40, 64]); i < n; i++) {
    const t = rr(0.25, 0.95), a = rr(0, TAU), sp = loftSurface(torso, t, a, [0, 0, 1], 0.97);
    const dl = rr(0.05, 0.13), dr = rr(0.018, 0.032), dd = sp.n.clone().multiplyScalar(0.2).add(new V3(0, -1, 0)).normalize();
    B.add(blob(1), tBind, shade(drip, 0.92 + 0.15 * rnd()), { matrix: along(sp.p.clone().addScaledVector(dd, dl * 0.6), dd, dr, dl, dr) });
  }
  // fissures: molten seams across chest, back and arms (self-lit; they blaze when it is exposed)
  for (let f = 0, nf = Q(q, [4, 8, 12, 16]); f < nf; f++) {
    let t = rr(0.25, 0.85), a = rr(0, TAU), prev = loftSurface(torso, t, a, [0, 0, 1], 1.0).p;
    for (let k = 0, steps = ri(3, 7); k < steps; k++) {
      t = clamp(t + rr(-0.08, 0.08), 0.15, 0.95); a += rr(-0.35, 0.35);
      const cur = loftSurface(torso, t, a, [0, 0, 1], 1.0).p, dir = cur.clone().sub(prev), L = dir.length(); if (L < 0.01) continue;
      const wd = rr(0.012, 0.02);
      B.add(new THREE.CylinderGeometry(1, 1, 1, 4), tBind, shade(ember, rr(0.7, 1.1)), { slot: 2, flat: true, matrix: along(prev.clone().add(cur).multiplyScalar(0.5), dir, wd, L * 1.08, wd) });
      prev = cur;
    }
  }
  if (guardian) {
    for (const sx of [1, -1]) B.add(new THREE.BoxGeometry(0.3, 0.07, 0.32, 2, 1, 2), 'sh' + (sx > 0 ? 'L' : 'R'), (x, y, z) => shade(stone, 0.8 + 0.3 * noise(x * 20, y * 20, z * 20)), { matrix: M(sx * 0.36, 1.82, 0.03, 0, 0, sx * -0.35) });
    B.add(new THREE.CylinderGeometry(0.32, 0.3, 0.06, Q(q, [8, 14, 20, 28]), 1, false, 0, TAU * 0.82), 'elL', (x, y, z) => shade(stone, 0.75 + 0.35 * noise(x * 18, y * 18, z * 18)), { matrix: M(0.6, 1.02, 0.1, 0, 0, Math.PI / 2 + 0.1) });
    const su = Q(q, [3, 6, 9, 12]), sv = Q(q, [4, 8, 12, 16]), pos = [], index = [];
    for (let i = 0; i <= su; i++) for (let j = 0; j <= sv; j++) { const u = i / su, v = j / sv, rag = v > 0.8 ? (noise(u * 20, 3, 1) - 0.5) * 0.25 : 0; pos.push(lerp(-0.2, 0.2, u), lerp(1.62, 0.6, v) + rag, 0.28 + 0.04 * Math.sin(u * 9) + v * 0.06); }
    for (let i = 0; i < su; i++) for (let j = 0; j < sv; j++) { const a0 = i * (sv + 1) + j, b0 = a0 + 1, c0 = a0 + sv + 1, d0 = c0 + 1; index.push(a0, c0, b0, b0, c0, d0); }
    const g = new THREE.BufferGeometry(); g.setIndex(index); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    B.add(g, (x, y, z) => along1([[1.0, 'hips'], [1.5, 'chest']])(y), (x, y, z) => shade(C(0x3e2620), 0.7 + 0.4 * noise(x * 25, y * 25, z)));
  }
  return { def, geo: B.build(), eyes: { bone: 'head', pos: [0, 1.99, 0.29], spread: 0, n: 1 }, height: 2.15, roughness: 0.5, side: guardian ? THREE.DoubleSide : THREE.FrontSide, accent: 'glow', candles };
}

// =====================================================================
//  GLOOM HOUND — long-legged, hairless and starved: ribs under slate-grey
//  skin, a ridge of bone down the spine that rises when it means it, a long
//  skull with too many teeth, a whip of a tail. Pale eyes. Same skeleton as
//  the wolf, so it moves with the same gait.
// =====================================================================
function hound(q) {
  srand(7007 + q);
  const def = bones([
    ['root', null, 0, 0, 0], ['pelvis', 'root', 0, 0.86, -0.46], ['spine', 'pelvis', 0, 0.9, -0.05], ['chest', 'spine', 0, 0.93, 0.32],
    ['hackles', 'spine', 0, 1.04, 0.05], ['neck', 'chest', 0, 1.02, 0.52], ['head', 'neck', 0, 1.1, 0.74], ['jaw', 'head', 0, 1.04, 0.84],
    ['earL', 'head', 0.05, 1.17, 0.72], ['earR', 'head', -0.05, 1.17, 0.72],
    ['FLu', 'chest', 0.1, 0.88, 0.36], ['FLl', 'FLu', 0.11, 0.48, 0.38], ['FLf', 'FLl', 0.11, 0.09, 0.39],
    ['FRu', 'chest', -0.1, 0.88, 0.36], ['FRl', 'FRu', -0.11, 0.48, 0.38], ['FRf', 'FRl', -0.11, 0.09, 0.39],
    ['HLu', 'pelvis', 0.11, 0.86, -0.48], ['HLl', 'HLu', 0.12, 0.54, -0.4], ['HLf', 'HLl', 0.12, 0.22, -0.58],
    ['HRu', 'pelvis', -0.11, 0.86, -0.48], ['HRl', 'HRu', -0.12, 0.54, -0.4], ['HRf', 'HRl', -0.12, 0.22, -0.58],
    ['tail1', 'pelvis', 0, 0.9, -0.66], ['tail2', 'tail1', 0, 0.82, -0.9], ['tail3', 'tail2', 0, 0.7, -1.12],
  ]);
  const B = new RigBuilder(def), radial = Q(q, [8, 16, 24, 32]), rings = Q(q, [10, 22, 34, 48]), d = Q(q, [1, 2, 3, 3]);
  const back = C(0x1a1d21), side = C(0x2e3339), belly = C(0x454a51), scar = C(0x6a6e70), gum = C(0x3a1e22), ivory = C(0xd0c8b0), bone_ = C(0x8a8478);
  const skin = (k = 1) => (x, y, z) => { const t = clamp((y - 0.62) / 0.42, 0, 1), c = t < 0.5 ? mixc(belly, side, t * 2) : mixc(side, back, (t - 0.5) * 2), n = noise(x * 11, y * 11, z * 11), mott = noise(x * 3.3 + 7, y * 3.1, z * 3.7) > 0.72 ? 1.25 : 1, sc = Math.abs(nz3(x * 6 + z * 9, y * 14, 2)) < 0.02 ? 1.8 : 1; return shade(c, (0.8 + 0.35 * n) * mott * sc * k); };
  // torso: tucked waist, deep chest, every rib showing
  const torso = [{ p: [0, 0.86, -0.72], r: [0.08, 0.1] }, { p: [0, 0.88, -0.5], r: [0.13, 0.15] }, { p: [0, 0.87, -0.22], r: [0.095, 0.115] }, { p: [0, 0.9, 0.06], r: [0.13, 0.18] }, { p: [0, 0.93, 0.3], r: [0.14, 0.215] }, { p: [0, 0.99, 0.46], r: [0.11, 0.15] }];
  const bodyBind = (x, y, z) => along1([[-0.46, 'pelvis'], [-0.05, 'spine'], [0.32, 'chest']])(z);
  const ribs = (a, t) => { const rib = t > 0.48 && t < 0.86 ? 0.045 * Math.pow(Math.max(0, Math.cos(t * 70)), 3) * Math.abs(Math.cos(a)) : 0, hip = Math.exp(-(((t - 0.18) / 0.06) ** 2)) * 0.08 * Math.max(0, Math.sin(a)); return 1 + rib + hip + 0.02 * nz3(Math.cos(a) * 4, t * 20, Math.sin(a) * 4); };
  B.add(loft(torso, { radial: radial + 4, rings: rings + 8, shape: ribs }), bodyBind, skin());
  // the spine ridge: bony knobs and spines on the hackles bone (they stand up when it scales)
  for (let i = 0, n = Q(q, [5, 12, 18, 26]); i < n; i++) {
    const t = lerp(0.12, 0.92, i / (n - 1)), sp = loftSurface(torso, t, Math.PI / 2, [0, 1, 0], 0.98), h = 0.025 + 0.04 * Math.sin(Math.PI * t);
    B.add(cone(Q(q, [3, 4, 5, 6]), 0.016, h), 'hackles', shade(bone_, 0.75 + 0.3 * rnd()), { flat: true, matrix: along(sp.p, new V3(0, 1, -0.5).normalize()) });
    if (q > 0) B.add(blob(1), bodyBind, shade(back, 1.2), { matrix: M(sp.p.x, sp.p.y - 0.005, sp.p.z, 0, 0, 0, 0.02, 0.014, 0.025) });
  }
  // neck: long, stringy
  const neckC = [{ p: [0, 0.97, 0.4], r: [0.1, 0.13] }, { p: [0, 1.03, 0.56], r: [0.075, 0.09] }, { p: [0, 1.08, 0.7], r: [0.07, 0.08] }];
  const neckBind = (x, y, z) => along1([[0.42, 'chest'], [0.54, 'neck'], [0.7, 'head']])(z);
  B.add(loft(neckC, { radial, rings: Math.max(4, rings >> 1), shape: (a, t) => 1 + 0.06 * Math.max(0, Math.cos(a * 2)) * Math.sin(t * 9) }), neckBind, skin(0.95));
  // head: a long narrow skull, lips drawn back off a crowded jaw
  const hd = Q(q, [1, 2, 3, 3]);
  B.add(blob(hd, (x, y, z) => [x * (z > 0 ? 1 - z * 0.35 : 1), y * (y > 0 ? 0.75 : 0.9), z]), 'head', skin(1.05), { matrix: M(0, 1.11, 0.76, 0, 0, 0, 0.085, 0.085, 0.13) });
  B.add(loft([{ p: [0, 1.09, 0.82], r: [0.06, 0.055] }, { p: [0, 1.075, 0.96], r: [0.045, 0.042] }, { p: [0, 1.06, 1.06], r: [0.03, 0.03] }], { radial, rings: Math.max(5, rings >> 2) }), 'head', skin(1.1));
  for (const sx of [-1, 1]) B.add(blob(1), 'head', shade(back, 1.3), { matrix: M(sx * 0.05, 1.15, 0.82, 0, 0, sx * 0.25, 0.03, 0.015, 0.045) });   // brow ridges
  B.add(blob(1), 'head', C(0x0a0a0c), { slot: 1, matrix: M(0, 1.065, 1.085, 0, 0, 0, 0.02, 0.016, 0.014) });                               // nose
  for (const sx of [-1, 1]) B.add(blob(Q(q, [1, 1, 2, 2])), 'head', (x, y, z, nx, ny, nz) => (nz > 0.5 ? [0.5, 0.6, 0.66] : [0.03, 0.03, 0.04]), { slot: 1, matrix: M(sx * 0.045, 1.13, 0.86, 0, sx * 0.4, 0, 0.013, 0.011, 0.011) });
  // gums and two ragged rows of teeth, top and bottom
  for (const [bone, y, dir, z0] of [['head', 1.05, -1, 0.83], ['jaw', 1.035, 1, 0.84]]) {
    for (const sx of [-1, 1]) {
      B.add(loft([{ p: [sx * 0.042, y, z0], r: [0.012, 0.01] }, { p: [sx * 0.032, y, z0 + 0.12], r: [0.01, 0.009] }, { p: [sx * 0.018, y, z0 + 0.21], r: [0.008, 0.007] }], { radial: 6, rings: 6 }), bone, gum);
      for (let i = 0, n = Q(q, [3, 6, 9, 12]); i < n; i++) { const t = i / (n - 1), x = sx * lerp(0.042, 0.016, t), z = z0 + t * 0.21; B.add(cone(4, 0.006, rr(0.016, 0.03) * (i % 3 === 0 ? 1.6 : 1)), bone, ivory, { slot: 1, flat: true, matrix: along(new V3(x, y, z), new V3(rr(-0.15, 0.15), dir, rr(0, 0.25)).normalize()) }); }
    }
  }
  B.add(loft([{ p: [0, 1.035, 0.82], r: [0.045, 0.02] }, { p: [0, 1.03, 0.95], r: [0.035, 0.016] }, { p: [0, 1.03, 1.04], r: [0.022, 0.012] }], { radial, rings: 6 }), 'jaw', skin(1.1));
  for (const [sx, bone] of [[1, 'earL'], [-1, 'earR']]) B.add(cone(Q(q, [3, 4, 5, 6]), 0.025, 0.05), bone, shade(side, 0.9), { flat: true, matrix: M(sx * 0.05, 1.16, 0.72, -0.6, 0, -sx * 0.5, 1, 1, 0.5) });
  // legs: long and thin, knobbed at every joint, black claws
  const legCol = skin(0.9), lr = Math.max(6, radial - 6), lrings = Math.max(4, rings >> 2);
  const paw = (x, z, bone) => {
    B.add(blob(Q(q, [1, 1, 2, 2])), bone, shade(belly, 0.7), { matrix: M(x, 0.03, z + 0.02, 0, 0, 0, 0.035, 0.026, 0.05) });
    for (let i = 0; i < 4; i++) { const ox = (i - 1.5) * 0.016; B.add(cone(4, 0.005, 0.035), bone, C(0x0c0b0a), { slot: 1, flat: true, matrix: along(new V3(x + ox, 0.02, z + 0.06), new V3(0, -0.5, 1).normalize()) }); }
  };
  for (const sx of [1, -1]) {
    const F = sx > 0 ? 'FL' : 'FR', Hh = sx > 0 ? 'HL' : 'HR';
    B.add(loft([{ p: [sx * 0.1, 0.9, 0.35], r: [0.055, 0.07] }, { p: [sx * 0.105, 0.68, 0.37], r: [0.038, 0.042] }, { p: [sx * 0.11, 0.48, 0.38], r: [0.03, 0.032] }], { radial: lr, rings: lrings, ref: [0, 0, 1] }), F + 'u', legCol);
    B.add(blob(1), F + 'l', legCol, { matrix: M(sx * 0.11, 0.48, 0.385, 0, 0, 0, 0.034, 0.038, 0.034) });
    B.add(loft([{ p: [sx * 0.11, 0.48, 0.38], r: [0.026, 0.028] }, { p: [sx * 0.11, 0.28, 0.385], r: [0.021, 0.023] }, { p: [sx * 0.11, 0.07, 0.39], r: [0.019, 0.021] }], { radial: lr, rings: lrings, ref: [0, 0, 1] }), F + 'l', legCol);
    paw(sx * 0.11, 0.39, F + 'f');
    B.add(loft([{ p: [sx * 0.11, 0.9, -0.46], r: [0.07, 0.11] }, { p: [sx * 0.115, 0.7, -0.43], r: [0.05, 0.07] }, { p: [sx * 0.12, 0.54, -0.4], r: [0.03, 0.035] }], { radial: lr, rings: lrings, ref: [0, 0, 1] }), Hh + 'u', legCol);
    B.add(blob(1), Hh + 'l', legCol, { matrix: M(sx * 0.12, 0.54, -0.405, 0, 0, 0, 0.032, 0.036, 0.034) });
    B.add(loft([{ p: [sx * 0.12, 0.54, -0.4], r: [0.027, 0.03] }, { p: [sx * 0.12, 0.38, -0.49], r: [0.022, 0.024] }, { p: [sx * 0.12, 0.22, -0.58], r: [0.02, 0.022] }], { radial: lr, rings: lrings, ref: [0, 0, 1] }), Hh + 'l', legCol);
    B.add(blob(1), Hh + 'f', legCol, { matrix: M(sx * 0.12, 0.22, -0.58, 0, 0, 0, 0.026, 0.03, 0.03) });
    B.add(loft([{ p: [sx * 0.12, 0.22, -0.58], r: [0.019, 0.021] }, { p: [sx * 0.12, 0.05, -0.54], r: [0.018, 0.02] }], { radial: lr, rings: 4, ref: [0, 0, 1] }), Hh + 'f', legCol);
    paw(sx * 0.12, -0.55, Hh + 'f');
  }
  // tail: a bare whip with a few spines
  const tailC = [{ p: [0, 0.9, -0.66], r: [0.035, 0.04] }, { p: [0, 0.85, -0.84], r: [0.026, 0.028] }, { p: [0, 0.76, -1.02], r: [0.018, 0.018] }, { p: [0, 0.66, -1.18], r: [0.01, 0.01] }, { p: [0, 0.6, -1.28], r: [0.003, 0.003] }];
  const tailBind = (x, y, z) => along1([[-1.1, 'tail3'], [-0.9, 'tail2'], [-0.7, 'tail1']])(z);
  B.add(loft(tailC, { radial: Math.max(6, radial >> 1), rings }), tailBind, skin(0.9));
  for (let i = 0; i < Q(q, [0, 3, 5, 7]); i++) { const sp = loftSurface(tailC, 0.15 + i * 0.1, Math.PI / 2, [0, 1, 0], 0.95); B.add(cone(4, 0.008, 0.03), tailBind, bone_, { flat: true, matrix: along(sp.p, new V3(0, 1, -0.6).normalize()) }); }
  return { def, geo: B.build(), eyes: { bone: 'head', pos: [0, 1.13, 0.87], spread: 0.045, n: 2 }, height: 1.2, roughness: 0.6, side: THREE.FrontSide, accent: null };
}

const BUILDERS = { wolf, leech, moth, bandit, sentinel: (q) => sentinel(q, false), guardian: (q) => sentinel(q, true), hound };
const cache = {};
export function getRig(type, q) { const k = type + q; if (!cache[k]) cache[k] = BUILDERS[type](q); return cache[k]; }
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
