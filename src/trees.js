import { THREE, GeoBuilder, T, M, I, col, rr, rnd, lerp, clamp, barkArr, rockArr, nz3 } from './engine.js';

// =====================================================================
//  THE DEEP WOODS — trees, thickets, rocks and ground cover.
//  Each kind has a cheap low-poly version (drawn whenever the beam touches
//  it) and a hi-poly version (drawn only when it is lit AND close).
//  Pines, birches, dead trees and boulders come from Eyeshine; the elder
//  trees (the great old trunks that stand inside clearings) and the
//  thickets are new for the Crown.
// =====================================================================

// ---------- low-poly ----------
export function pineGeo(v) {
  const b = new GeoBuilder(), H = 7.2 + v * 0.9, base = 2.5 + (v % 2) * 0.6;
  b.add(T.trunk, M(0, H * 0.43, 0, 0, 0, 0, 0.22, H * 0.86, 0.22), col(0x5e4a3a), 0.14);
  for (let i = 0; i < 2; i++) b.limb(T.cyl4, 0, rr(1.4, base), 0, rr(0.5, 1.0), 0.03, rr(1.2, 1.7), rr(0, 6.28), col(0x4e3e30), 0.1);
  const layers = 3 + (v % 2);
  for (let i = 0; i < layers; i++) {
    const f = i / layers, r = lerp(1.75, 0.6, f), h = lerp(2.1, 1.5, f), y = base + f * (H - base - 1.1) + h / 2;
    b.add(T.cone, M(0, y, 0, 0, rr(0, 6.28), 0, r, h, r), col(0x2e4a34), 0.22);
  }
  return b.build();
}
export function birchGeo(v) {
  const b = new GeoBuilder(), H = 7 + v;
  b.add(T.trunk, M(0, H / 2, 0, 0, 0, 0, 0.14, H, 0.14), col(0xd6d0c2), 0.32);
  for (let i = 0; i < 3; i++) b.limb(T.cyl4, 0, H * rr(0.5, 0.75), 0, rr(1, 1.8), 0.04, rr(0.6, 1.0), rr(0, 6.28), col(0x8a847a), 0.1);
  for (let i = 0; i < 5; i++) {
    const a = rr(0, 6.28), r = rr(0.2, 0.9);
    b.add(T.ico, M(Math.cos(a) * r, H * rr(0.72, 0.98), Math.sin(a) * r, 0, rr(0, 6), 0, rr(0.6, 1.0), rr(0.5, 0.8), rr(0.6, 1.0)), col(0x4a5a2a), 0.22);
  }
  return b.build();
}
export function deadGeo(v) {
  const b = new GeoBuilder(), H = 4.5 + v * 1.4, c = col(0x5a4e44);
  b.add(T.trunk, M(0, H / 2, 0, 0, 0, 0, 0.22, H, 0.22), c, 0.12);
  for (let i = 0; i < 4 + v; i++) {
    const [x, y, z] = b.limb(T.cyl4, 0, H * rr(0.45, 0.9), 0, rr(1.2, 2.4), 0.065, rr(0.5, 1.1), rr(0, 6.28), c, 0.1);
    b.limb(T.cyl4, x, y, z, rr(0.5, 1.0), 0.035, rr(0.3, 0.9), rr(0, 6.28), c, 0.1);
  }
  return b.build();
}
export function boulderGeo(c) {
  const b = new GeoBuilder();
  b.add(T.dode, M(0, 0.35, 0, rr(0, 3), rr(0, 6), 0, 1, 0.72, 0.9), col(c), 0.16);
  b.add(T.dode, M(rr(0.5, 0.8), 0.2, rr(-0.4, 0.4), rr(0, 3), rr(0, 6), 0, 0.5, 0.4, 0.5), col(c), 0.16);
  return b.build();
}
// Elder: a great, gnarled trunk that stands in the middle of a clearing. It blocks the lantern
// (the 2D Crown's pillars) and you can circle it in a fight.
export function elderGeo(v) {
  const b = new GeoBuilder(), c = col(0x4e4034), H = 9 + v;
  b.add(T.trunk, M(0, 2.4, 0, 0, 0, 0, 0.8, 4.8, 0.8), c, 0.14);
  b.add(T.trunk, M(0, 6, 0, 0, 0, 0, 0.55, 3.2, 0.55), c, 0.14);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.283 + rr(-0.3, 0.3); b.limb(T.trunk, Math.cos(a) * 0.5, 0.35, Math.sin(a) * 0.5, rr(1.0, 1.6), 0.32, Math.PI / 2 + 0.3, Math.atan2(Math.cos(a), Math.sin(a)), c, 0.12); }
  for (let i = 0; i < 4; i++) { const p = b.limb(T.cyl6, 0, rr(4.5, 7), 0, rr(2.5, 3.5), 0.16, rr(0.7, 1.2), rr(0, 6.28), c, 0.1); b.limb(T.cyl4, p[0], p[1], p[2], rr(1, 2), 0.07, rr(0.4, 1.1), rr(0, 6.28), c, 0.1); }
  b.add(T.ico, M(0, H, 0, 0, rr(0, 6), 0, 3.2, 1.2, 3.2), col(0x25382a), 0.25);
  return b.build();
}
// Thicket: brambles, saplings and fallen limbs that close the gaps between trunks at the edge of
// the woods, so the walls of a clearing read as impassable.
export function thicketGeo(v) {
  const b = new GeoBuilder(), bush = [col(0x223a26), col(0x2a4430), col(0x1d3020)], twig = col(0x4a3c30);
  for (let i = 0; i < 4 + v; i++) { const s = rr(0.5, 0.95); b.add(T.ico, M(rr(-0.8, 0.8), s * 0.45, rr(-0.8, 0.8), 0, rr(0, 6), 0, s, s * rr(0.7, 1.0), s), bush[i % 3], 0.22); }
  for (let i = 0; i < 6; i++) b.limb(T.cyl4, rr(-0.7, 0.7), 0, rr(-0.7, 0.7), rr(0.8, 1.7), 0.02, rr(0.1, 0.7), rr(0, 6.28), twig, 0.1);
  if (v % 2) b.add(T.cyl6, M(rr(-0.4, 0.4), 0.18, rr(-0.4, 0.4), Math.PI / 2, rr(0, 6.28), 0.08, 0.17, rr(1.6, 2.4), 0.17), col(0x3e3228), 0.12);
  return b.build();
}

// ---------- HIGH DETAIL (only ever drawn inside the beam) ----------
function roots(b, n, r0, c) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + rr(-0.3, 0.3);
    b.limb(T.trunk, Math.cos(a) * r0 * 0.6, 0.3, Math.sin(a) * r0 * 0.6, rr(0.6, 1.1), r0 * 0.4, Math.PI / 2 + rr(0.22, 0.38), Math.atan2(Math.cos(a), Math.sin(a)), c, 0.12);
  }
}
function branchy(b, x, y, z, len, r, tilt, yaw, depth, c, tip) {
  const p = b.limb(r > 0.045 ? T.cyl6 : T.cyl4, x, y, z, len, r, tilt, yaw, c, 0.1);
  if (depth <= 0) { if (tip) tip(p, yaw); return; }
  const n = 2 + (rnd() < 0.4 ? 1 : 0);
  for (let k = 0; k < n; k++) branchy(b, p[0], p[1], p[2], len * rr(0.55, 0.75), r * 0.62, clamp(tilt + rr(-0.5, 0.6), 0.2, 1.9), yaw + rr(-1.0, 1.0), depth - 1, c, tip);
}
export function pineHi(v, q) {
  const b = new GeoBuilder(), H = 7.2 + v * 0.9, base = 2.5 + (v % 2) * 0.6;
  const bark = col(0x5e4a3a), n1 = col(0x2e4a34), n2 = col(0x26422e), dead = col(0x4e3e30);
  b.add(barkArr(0.24, 0.1, H * 0.9, 6 + q * 3, 6 + q * 4, 0.12), I(), bark, 0.12);
  roots(b, 4 + q, 0.26, bark);
  for (let i = 0; i < 3 + 2 * q; i++) b.limb(T.cyl4, 0, rr(1.0, base), 0, rr(0.4, 0.9), 0.02, rr(1.3, 1.9), rr(0, 6.28), dead, 0.1);
  const whorls = 6 + q * 3;
  for (let w = 0; w < whorls; w++) {
    const f = w / (whorls - 1), y = base + f * (H - base - 0.7), reach = lerp(2.0, 0.5, f);
    const nb = Math.max(3, Math.round((5 + 2 * q) * lerp(1, 0.55, f)));
    for (let k = 0; k < nb; k++) {
      const yaw = (k / nb) * 6.283 + w * 0.7 + rr(-0.25, 0.25);
      const p1 = b.limb(T.cyl4, 0, y, 0, reach * 0.55, 0.035, Math.PI / 2 - 0.12, yaw, bark, 0.1);
      const p2 = b.limb(T.cyl4, p1[0], p1[1], p1[2], reach * 0.5, 0.022, Math.PI / 2 + 0.35, yaw + rr(-0.2, 0.2), bark, 0.1);
      const pads = 2 + q;
      for (let i = 0; i < pads; i++) {
        const t = 0.3 + 0.7 * ((i + 1) / pads), s = rr(0.32, 0.5) * lerp(1, 0.65, f) * (1.1 - t * 0.3);
        b.add(T.ico, M(p2[0] * t, lerp(y, p2[1], t) + 0.06, p2[2] * t, 0, yaw + rr(-0.3, 0.3), 0, s, s * 0.42, s * 1.35), rnd() < 0.5 ? n1 : n2, 0.22);
      }
    }
  }
  for (let i = 0; i < 3; i++) { const f = i / 3; b.add(T.cone, M(0, base + 0.9 + f * (H - base - 1.6), 0, 0, rr(0, 6), 0, lerp(0.9, 0.35, f), 1.7, lerp(0.9, 0.35, f)), n2, 0.2); }
  b.add(T.cone, M(0, H - 0.35, 0, 0, 0, 0, 0.3, 1.3, 0.3), n1, 0.2);
  return b.build();
}
export function birchHi(v, q) {
  const b = new GeoBuilder(), H = 7 + v, white = col(0xd6d0c2), dark = col(0x2a2622), twig = col(0x8a847a), lv = [col(0x4a5a2a), col(0x5b6c2e), col(0x3e4e24)];
  b.addAlt(barkArr(0.16, 0.08, H, 7 + q * 3, 10 + q * 5, 0.05), I(), white, 0.16, dark, 0.14);
  roots(b, 3, 0.16, white);
  const cl = q >= 2 ? T.ico1 : T.ico;
  for (let i = 0; i < 4 + q; i++) {
    const yaw = rr(0, 6.28), p1 = b.limb(T.cyl4, 0, H * rr(0.45, 0.8), 0, rr(1.0, 1.8), 0.05, rr(0.5, 0.9), yaw, twig, 0.1);
    for (let k = 0; k < 2 + q; k++) {
      const p2 = b.limb(T.cyl4, p1[0], p1[1], p1[2], rr(0.5, 1.0), 0.025, rr(0.3, 1.1), yaw + rr(-0.8, 0.8), twig, 0.1), s = rr(0.35, 0.6);
      b.add(cl, M(p2[0], p2[1], p2[2], rr(0, 3), rr(0, 6), 0, s, s * 0.75, s), lv[(rnd() * 3) | 0], 0.25);
      b.add(cl, M(lerp(p1[0], p2[0], 0.5), lerp(p1[1], p2[1], 0.5) + 0.1, lerp(p1[2], p2[2], 0.5), rr(0, 3), rr(0, 6), 0, s * 0.7, s * 0.55, s * 0.7), lv[(rnd() * 3) | 0], 0.25);
    }
  }
  for (let i = 0; i < 3; i++) { const s = rr(0.4, 0.6); b.add(cl, M(rr(-0.4, 0.4), H - rr(0, 0.6), rr(-0.4, 0.4), 0, rr(0, 6), 0, s, s * 0.8, s), lv[i % 3], 0.25); }
  return b.build();
}
export function deadHi(v, q) {
  const b = new GeoBuilder(), H = 4.5 + v * 1.4, c = col(0x5a4e44);
  b.add(barkArr(0.24, 0.12, H, 6 + q * 2, 6 + q * 3, 0.14), I(), c, 0.12);
  roots(b, 4, 0.24, c);
  for (let i = 0; i < 4 + v; i++) branchy(b, 0, H * rr(0.45, 0.9), 0, rr(1.2, 2.2), 0.07, rr(0.5, 1.1), rr(0, 6.28), Math.min(1 + q, 4), c);
  return b.build();
}
export function boulderHi(cHex, q) {
  const b = new GeoBuilder(), c = col(cHex), moss = col(0x3e5a2c), d = Math.min(1 + q, 3);
  b.add(rockArr(d, 0.16, 1.3), M(0, 0.35, 0, 0, rr(0, 6), 0, 1, 0.72, 0.9), c, 0.12);
  b.add(rockArr(Math.max(1, d - 1), 0.2, 4.1), M(rr(0.5, 0.8), 0.2, rr(-0.4, 0.4), 0, rr(0, 6), 0, 0.5, 0.4, 0.5), c, 0.12);
  for (let i = 0; i < 3 * q; i++) { const a = rr(0, 6.28), r = rr(1.0, 1.6), s = rr(0.06, 0.16); b.add(T.ico, M(Math.cos(a) * r, s * 0.3, Math.sin(a) * r, rr(0, 3), rr(0, 6), 0, s, s * 0.6, s), c, 0.15); }
  for (let i = 0; i < 2 + q; i++) { const a = rr(0, 6.28), s = rr(0.25, 0.45); b.add(T.ico, M(Math.cos(a) * 0.3, 0.72, Math.sin(a) * 0.3, 0, rr(0, 6), 0, s, 0.12, s), moss, 0.25); }
  return b.build();
}
export function elderHi(v, q) {
  const b = new GeoBuilder(), c = col(0x4e4034), H = 9 + v, moss = col(0x34502c), lv = [col(0x25382a), col(0x2c4230), col(0x1f3024)];
  b.add(barkArr(0.85, 0.42, 7.4, 9 + q * 4, 8 + q * 4, 0.16), I(), c, 0.12);
  for (let i = 0; i < 6 + q; i++) { const a = (i / (6 + q)) * 6.283 + rr(-0.25, 0.25); b.limb(T.trunk, Math.cos(a) * 0.55, 0.4, Math.sin(a) * 0.55, rr(1.1, 1.9), 0.34, Math.PI / 2 + rr(0.25, 0.42), Math.atan2(Math.cos(a), Math.sin(a)), c, 0.12); }
  for (let i = 0; i < 10 + q * 6; i++) { const a = rr(0, 6.28), y = rr(0.3, 2.6), s = rr(0.12, 0.3); b.add(T.ico, M(Math.cos(a) * 0.82, y, Math.sin(a) * 0.82, 0, a, 0, s * 0.5, s, s), moss, 0.25); }
  for (let i = 0; i < 4 + q; i++) branchy(b, 0, rr(4.5, 7), 0, rr(2.2, 3.2), 0.16, rr(0.7, 1.25), rr(0, 6.28), Math.min(1 + q, 3), c,
    (p) => { const s = rr(0.6, 1.1); b.add(q >= 2 ? T.ico1 : T.ico, M(p[0], p[1], p[2], 0, rr(0, 6), 0, s, s * 0.6, s), lv[(rnd() * 3) | 0], 0.25); });
  return b.build();
}

// ---------- ground cover patches (one cell = 1.6 m), rebuilt each frame from the cells in the beam ----------
export const COVER_CELL = 1.6;
export function coverVariants(q) {
  const H = COVER_CELL / 2, P = () => [rr(-H, H), rr(-H, H)];
  const make = (fill) => { const b = new GeoBuilder(); fill(b); return b.build(); };
  const leaves = [0x5b3e24, 0x765028, 0x4a3420, 0x6a5a34, 0x3e3024, 0x80582a].map(col), moss = [col(0x41663a), col(0x35582c), col(0x587438)];
  const litter = (b, n, pal) => { for (let i = 0; i < n; i++) { const [x, z] = P(), w = rr(0.05, 0.08), l = rr(0.08, 0.14); b.add(T.leaf, M(x, rr(0.005, 0.025), z, rr(-0.3, 0.3), rr(0, 6.28), rr(-0.2, 0.2), w * 1.5, 0.25, l), pal[(rnd() * pal.length) | 0], 0.15); } };
  const tuft = (b, x, z, n, hMin, hMax, pal) => {
    for (let k = 0; k < n; k++) { const h = rr(hMin, hMax), w = rr(0.025, 0.05); b.add(T.blade, M(x + rr(-0.08, 0.08), 0, z + rr(-0.08, 0.08), rr(0.05, 0.55), rr(0, 6.28), 0, w, h, h), pal[(rnd() * pal.length) | 0], 0.18); }
  };
  const fern = (b, cx, cz, fronds, segs) => {
    const g1 = col(0x365a2e), g2 = col(0x426a34);
    for (let f = 0; f < fronds; f++) {
      const yaw = (f / fronds) * 6.283 + rr(-0.3, 0.3), dx = Math.sin(yaw), dz = Math.cos(yaw), sx = Math.cos(yaw), sz = -Math.sin(yaw);
      const L = rr(0.5, 0.85), e0 = rr(0.6, 1.0), sl = L / segs;
      let px = cx, py = 0.04, pz = cz;
      for (let i = 0; i < segs; i++) {
        const el = e0 - (i / segs) * (e0 + 0.7), nx = px + dx * Math.cos(el) * sl, ny = py + Math.sin(el) * sl, nz = pz + dz * Math.cos(el) * sl;
        const ll = 0.16 * Math.sin(Math.PI * (i + 0.6) / segs) + 0.03, mx = (px + nx) / 2, my = (py + ny) / 2, mz = (pz + nz) / 2, c = rnd() < 0.5 ? g1 : g2;
        for (const s of [-1, 1]) {
          const tx = mx + sx * s * ll + dx * ll * 0.35, ty = my - ll * 0.25, tz = mz + sz * s * ll + dz * ll * 0.35;
          b.tri(px, py, pz, nx, ny, nz, tx, ty, tz, c, 0.12);
          b.tri(px, py, pz, tx, ty, tz, mx + sx * s * ll * 0.4, my - 0.01, mz + sz * s * ll * 0.4, c, 0.12);
        }
        px = nx; py = ny; pz = nz;
      }
    }
  };
  return [
    { w: 0.35, g: make((b) => { litter(b, 70 * q, leaves); for (let i = 0; i < 2 + q; i++) { const [x, z] = P(); b.add(T.cyl4, M(x, 0.02, z, Math.PI / 2, rr(0, 6.28), 0, 0.015, rr(0.3, 0.7), 0.015), col(0x4d3e30), 0.1); } for (let i = 0; i < 2 * q; i++) { const [x, z] = P(), s = rr(0.03, 0.08); b.add(T.ico, M(x, s * 0.3, z, rr(0, 3), rr(0, 6), 0, s, s * 0.6, s), col(0x5a5852), 0.15); } }) },
    { w: 0.25, g: make((b) => { fern(b, rr(-0.3, 0.3), rr(-0.3, 0.3), 6 + 2 * q, 5 + 3 * q); if (q > 1) fern(b, rr(-0.5, 0.5), rr(-0.5, 0.5), 5 + q, 4 + 2 * q); litter(b, 15 * q, leaves); }) },
    { w: 0.3, g: make((b) => { for (let i = 0; i < 5; i++) { const [x, z] = P(); tuft(b, x, z, 6 + 5 * q, 0.12, 0.35, moss); } litter(b, 10 * q, leaves); }) },
    { w: 0.1, g: make((b) => {
      // pale mushrooms; a few glow faintly on their own (see world3d: the cover's glow layer)
      for (let i = 0; i < 3 + 2 * q; i++) { const [x, z] = P(), h = rr(0.06, 0.14), r = rr(0.04, 0.09), cap = rnd() < 0.5 ? col(0xa8462e) : col(0xc9b48a);
        b.add(T.cyl6, M(x, h / 2, z, 0, 0, 0, 0.018, h, 0.018), col(0xe6dccb), 0.08); b.add(T.hemi, M(x, h, z, rr(-0.2, 0.2), 0, 0, r, r * 0.6, r), cap, 0.1); }
      litter(b, 30 * q, leaves); }) },
  ];
}
export { THREE };
