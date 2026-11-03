import { THREE, canvasTex, GeoBuilder, T, M, col, rr, rnd, lerp, TAU } from './engine.js';

// =====================================================================
//  ASH HOLLOW — the village's pieces (CR25): grey timber-framed houses
//  with sagging thatch and a few warm windows, wattle fences along the
//  lanes, the well with its little roof, Sev's stall under an awning,
//  Ged's cart sunk to the axles, the palisade and the eastern gate.
//  All flat-shaded vertex-colour geometry like the rest of the world;
//  lit windows go into one separate always-drawn mesh, so the village
//  glows faintly in the dark wherever you look.
// =====================================================================
const PLASTER = 0x7e786c, TIMBER = 0x2c241e, THATCH = 0x4a4234, STONE = 0x5a564e, DOOR = 0x3a2c22;
// a triangle list (both faces) from points
function tri2(b, pts, c) { const a = []; for (const p of pts) a.push(...p); b.add(new Float32Array([...a, ...[pts[0], pts[2], pts[1]].flat()]), M(0, 0, 0), c, 0.05); }

// a house: walls W x D (local x, z), front (door) facing +z. win: windows on the front that glow (into `glow`)
export function houseGeo(W, D, seed, glow, place) {
  const b = new GeoBuilder(), Hw = 2.5 + rr(-0.2, 0.3), rise = D * rr(0.5, 0.62), ov = 0.45, plaster = col(PLASTER), timber = col(TIMBER), thatch = col(THATCH), stone = col(STONE);
  b.add(T.box, M(0, 0.25, 0, 0, 0, 0, W + 0.12, 0.5, D + 0.12), stone, 0.1);                       // plinth
  b.add(T.box, M(0, 0.5 + (Hw - 0.5) / 2, 0, 0, 0, 0, W, Hw - 0.5, D), plaster, 0.08);           // plastered walls
  // the timber frame: posts, plates, a rail, braces, on all four sides
  const beam = (x, y, z, sx, sy, sz, rz = 0, ry = 0) => b.add(T.box, M(x, y, z, 0, ry, rz, sx, sy, sz), timber, 0.12);
  for (const [axis, half, len] of [['z', D / 2, W], ['z', -D / 2, W], ['x', W / 2, D], ['x', -W / 2, D]]) {
    const n = Math.max(2, Math.round(len / 1.6)), along = (t) => -len / 2 + (len * t) / n;
    for (let i = 0; i <= n; i++) { const u = along(i); axis === 'z' ? beam(u, Hw / 2 + 0.25, half, 0.16, Hw - 0.5, 0.06) : beam(half, Hw / 2 + 0.25, u, 0.06, Hw - 0.5, 0.16); }
    axis === 'z' ? (beam(0, Hw - 0.05, half, len + 0.1, 0.18, 0.08), beam(0, 1.35, half, len, 0.12, 0.07)) : (beam(half, Hw - 0.05, 0, 0.08, 0.18, len + 0.1), beam(half, 1.35, 0, 0.07, 0.12, len));
    for (let i = 0; i < n; i += 2) { const u = along(i + 0.5), ang = (i % 4 ? 1 : -1) * 0.75; axis === 'z' ? beam(u, 0.95, half, 0.1, 1.15, 0.06, ang) : beam(half, 0.95, u, 0.06, 1.15, 0.1, 0, 0) || 0; }
  }
  // the roof: two thatch slabs, each in three sagging lengths, and plastered gables
  const run = D / 2 + ov, L = Math.hypot(run, rise), ang = Math.atan2(rise, run);
  for (const sd of [1, -1]) for (let k = 0; k < 3; k++) {
    const xw = (W + 2 * ov) / 3, x = -W / 2 - ov + xw * (k + 0.5), sag = k === 1 ? 0.14 + rr(0, 0.08) : rr(0, 0.05);
    b.add(T.box, M(x, Hw + rise / 2 - sag - 0.05, (sd * run) / 2, sd * ang, 0, 0, xw + 0.04, 0.34, L), thatch, 0.16);
  }
  b.add(T.box, M(0, Hw + rise - 0.02, 0, 0, 0, 0, W + 2 * ov, 0.22, 0.42), col(0x3a3428), 0.15);      // ridge
  for (const gx of [W / 2, -W / 2]) tri2(b, [[gx, Hw, -D / 2], [gx, Hw, D / 2], [gx, Hw + rise - 0.1, 0]], plaster);
  // door, windows, a chimney on some
  b.add(T.box, M(0, 1.05, D / 2 + 0.03, 0, 0, 0, 1.0, 1.9, 0.08), col(DOOR), 0.1);
  beam(0, 2.05, D / 2 + 0.05, 1.3, 0.14, 0.1); beam(-0.58, 1.05, D / 2 + 0.05, 0.12, 2.0, 0.1); beam(0.58, 1.05, D / 2 + 0.05, 0.12, 2.0, 0.1);
  const wins = [-W / 2 + W * 0.22, W / 2 - W * 0.22], lit = rnd() < 0.45;
  wins.forEach((wx, i) => {
    beam(wx, 1.55, D / 2 + 0.05, 0.85, 0.1, 0.08); beam(wx, 0.95, D / 2 + 0.05, 0.85, 0.1, 0.08); beam(wx, 1.25, D / 2 + 0.06, 0.06, 0.62, 0.08);
    const on = lit && (i === 0 || rnd() < 0.5);
    if (on && glow) glow.push({ x: wx, y: 1.25, z: D / 2 + 0.04, w: 0.7, h: 0.5 });
    else b.add(T.box, M(wx, 1.25, D / 2 + 0.02, 0, 0, 0, 0.7, 0.5, 0.04), col(0x14120f), 0.05);
  });
  if (rnd() < 0.6) { const cx = (rnd() < 0.5 ? 1 : -1) * (W / 2 - 0.6); b.add(T.box, M(cx, Hw + rise * 0.7, -0.3, 0, 0, 0, 0.6, rise * 1.1, 0.6), stone, 0.12); }
  // a lean-to woodpile or a barrel by the door on some
  if (rnd() < 0.5) for (let i = 0; i < 5; i++) b.add(T.cyl6, M(W / 2 - 0.8, 0.12 + (i % 2) * 0.2, D / 2 + 0.35 + (i >> 1) * 0.0, Math.PI / 2, 0, 0, 0.1, 1.0, 0.1), col(0x4a3a2a), 0.15);
  else b.add(T.cyl10, M(-W / 2 + 0.7, 0.45, D / 2 + 0.45, 0, 0, 0, 0.32, 0.9, 0.32), col(0x3e3024), 0.1);
  return b.build();
}

export function wellGeo() {
  const b = new GeoBuilder(), stone = col(0x625e56), wood = col(0x3a2e24), dark = col(0x07090a);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; b.add(T.box, M(Math.cos(a) * 0.82, 0.4, Math.sin(a) * 0.82, 0, -a, 0, 0.32, 0.8, 0.46), stone, 0.12); }
  for (let i = 0; i < 12; i++) { const a = ((i + 0.5) / 12) * TAU; b.add(T.box, M(Math.cos(a) * 0.82, 0.86, Math.sin(a) * 0.82, 0, -a, 0, 0.3, 0.12, 0.5), col(0x6e6a60), 0.1); }
  b.add(T.cyl10, M(0, 0.55, 0, 0, 0, 0, 0.66, 0.02, 0.66), dark, 0.02);
  for (const s of [1, -1]) b.add(T.box, M(s * 0.95, 1.25, 0, 0, 0, 0, 0.14, 2.5, 0.14), wood, 0.1);
  b.add(T.cyl6, M(0, 1.85, 0, 0, 0, Math.PI / 2, 0.07, 1.9, 0.07), wood, 0.1);                       // windlass
  for (const sd of [1, -1]) b.add(T.box, M(0, 2.62, sd * 0.42, sd * 0.62, 0, 0, 2.3, 0.08, 1.0), col(0x3c3428), 0.12);
  b.add(T.cyl6, M(0, 1.4, 0, 0, 0, 0, 0.015, 0.9, 0.015), col(0x8a7a5a), 0.05);                     // rope
  b.add(T.cyl10, M(0, 0.98, 0, 0, 0, 0, 0.13, 0.2, 0.13), wood, 0.1);                               // bucket
  return b.build();
}
// Sev's stall: a counter under a faded awning, crates and flasks
export function stallGeo() {
  const b = new GeoBuilder(), wood = col(0x3e3026), cloth = [col(0x6a5636), col(0x4a3e30)];
  b.add(T.box, M(0, 0.5, 0.25, 0, 0, 0, 2.3, 1.0, 0.75), wood, 0.1);
  b.add(T.box, M(0, 1.02, 0.28, 0, 0, 0, 2.45, 0.06, 0.85), col(0x4a3a2c), 0.08);
  for (const [x, z, h] of [[-1.15, 0.65, 2.2], [1.15, 0.65, 2.2], [-1.15, -0.3, 2.5], [1.15, -0.3, 2.5]]) b.add(T.box, M(x, h / 2, z, 0, 0, 0, 0.1, h, 0.1), wood, 0.1);
  for (let i = 0; i < 6; i++) b.add(T.box, M(-1.25 + (i + 0.5) * (2.5 / 6), 2.32, 0.25, -0.32, 0, 0, 2.5 / 6, 0.04, 1.35), cloth[i % 2], 0.1);
  for (const [x, z] of [[-0.7, 0.3], [0.1, 0.32], [0.65, 0.25]]) b.add(T.cyl6, M(x, 1.15, z, 0, 0, 0, 0.07, 0.22, 0.07), col(0x8a6a2a), 0.12); // oil flasks
  for (let i = 0; i < 5; i++) b.add(T.cyl6, M(-0.9 + i * 0.45, 1.85, 0.62, 0, 0, 0, 0.05, 0.16, 0.05), col(0x5a4a3a), 0.15);       // hanging pots
  b.add(T.box, M(-1.6, 0.3, 0.4, 0, 0.3, 0, 0.6, 0.6, 0.6), col(0x4a3a2a), 0.1); b.add(T.box, M(-1.55, 0.78, 0.35, 0, 0.6, 0, 0.45, 0.36, 0.45), col(0x4e3e2c), 0.1);
  b.add(T.box, M(0, 2.0, 0.95, 0, 0, 0, 0.8, 0.45, 0.05), col(0x4a3a2a), 0.1);                    // sign board
  return b.build();
}
// Ged's cart, sunk to its axles in grey mud, tipped forward
export function cartGeo() {
  const b = new GeoBuilder(), wood = col(0x4a3a2a), mud = col(0x2e2a24);
  b.add(T.disc, M(0, 0.02, 0, 0, 0, 0, 1.8, 0.12, 1.3), mud, 0.2);
  b.add(T.box, M(0, 0.55, 0, 0.12, 0.25, -0.08, 1.4, 0.35, 2.3), wood, 0.1);
  for (const sx of [1, -1]) {
    b.add(T.box, M(sx * 0.75, 0.75, 0, 0.12, 0.25, 0, 0.06, 0.3, 2.2), wood, 0.12);
    b.add(T.torus, M(sx * 0.8, 0.28, 0.2, 0, Math.PI / 2, 0, 0.55, 0.55, 0.9), col(0x3a2e24), 0.1);  // half-buried wheels
    b.limb(T.box, sx * 0.4, 0.45, 1.2, 1.6, 0.06, 1.35, 0.25 + sx * 0.08, wood, 0.1);                 // shafts, resting in the mud
  }
  for (let i = 0; i < 3; i++) b.add(T.ico, M(rr(-0.4, 0.4), 0.85, rr(-0.6, 0.6), 0, rr(0, 3), 0, 0.3, 0.22, 0.3), col(0x6a5a40), 0.15); // sacks
  return b.build();
}
// a stretch of wattle fence along one tile edge (from a to b, local around the midpoint)
export function fencePiece(b, ax, az, bx, bz) {
  const post = col(0x3a3026), weave = col(0x4a3e2e), len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 0.95)), yaw = Math.atan2(bx - ax, bz - az);
  if (rnd() < 0.08) return; // a gap where it has fallen
  for (let i = 0; i <= n; i++) { const t = i / n, x = lerp(ax, bx, t), z = lerp(az, bz, t), h = rr(0.95, 1.2); b.add(T.cyl6, M(x, h / 2, z, rr(-0.06, 0.06), 0, rr(-0.06, 0.06), 0.05, h, 0.05), post, 0.12); }
  const mx = (ax + bx) / 2, mz = (az + bz) / 2, lean = rr(-0.07, 0.07);
  for (const y of [0.32, 0.55, 0.78]) b.add(T.box, M(mx, y + rr(-0.03, 0.03), mz, lean, yaw, 0, 0.05, 0.12, len), weave, 0.18);
}
// the palisade: sharpened stakes along x = gx between z0 and z1
export function palisade(b, gx, z0, z1) {
  const wood = col(0x34291f);
  for (let z = z0; z <= z1; z += 0.34) { const h = rr(2.8, 3.4); b.add(T.cyl6, M(gx + rr(-0.05, 0.05), h / 2, z, 0, rr(0, 1), rr(-0.03, 0.03), 0.17, h, 0.17), wood, 0.12); b.add(T.cone, M(gx, h + 0.2, z, 0, 0, 0, 0.17, 0.4, 0.17), wood, 0.12); }
}
// the eastern gate: two posts, a lintel with a hood, the leaves swung open outward
export function gateGeo(width) {
  const b = new GeoBuilder(), wood = col(0x3a2e22), iron = col(0x2a2a2c);
  for (const sz of [1, -1]) {
    b.add(T.box, M(0, 2.1, (sz * width) / 2, 0, 0, 0, 0.45, 4.2, 0.45), wood, 0.1);
    const leaf = width / 2 - 0.25, open = 1.15;
    for (let i = 0; i < 6; i++) b.add(T.box, M(Math.sin(open) * (leaf / 2), 1.6, sz * (width / 2 - 0.2 - Math.cos(open) * (leaf / 2)) + (i - 2.5) * 0.0, 0, sz * -open, 0, 0.1, 3.0 - (i % 2) * 0.2, leaf), wood, 0.12);
    b.add(T.box, M(Math.sin(open) * (leaf / 2), 2.4, sz * (width / 2 - 0.2 - Math.cos(open) * (leaf / 2)), 0, sz * -open, 0, 0.14, 0.12, leaf), iron, 0.08);
  }
  b.add(T.box, M(0, 4.05, 0, 0, 0, 0, 0.5, 0.4, width + 1.0), wood, 0.1);
  for (const sd of [1, -1]) b.add(T.box, M(sd * 0.35, 4.45, 0, 0, 0, sd * 0.7, 0.9, 0.08, width + 1.2), col(0x3c3428), 0.12);
  b.add(T.box, M(-0.3, 3.4, 0, 0, 0, 0, 0.05, 0.5, 0.8), col(0x5a4a34), 0.1);                      // a weathered sign
  return b.build();
}
// Ged's field: furrows, dead stalks and standing water
export function fieldGeo(w, d) {
  const b = new GeoBuilder(), mud = col(0x2c2822), stalk = col(0x5a5040);
  for (let z = -d / 2 + 0.6; z < d / 2 - 0.4; z += 1.1) b.add(T.box, M(rr(-0.2, 0.2), 0.08, z, 0, rr(-0.02, 0.02), 0, w - 1.0, 0.18, 0.5), mud, 0.15);
  for (let i = 0; i < w * d * 1.2; i++) { const x = rr(-w / 2 + 0.5, w / 2 - 0.5), z = Math.round(rr(-d / 2 + 0.6, d / 2 - 0.4) / 1.1) * 1.1; b.add(T.blade, M(x, 0.12, z, rr(-0.5, 0.5), rr(0, 6.28), 0, 0.05, rr(0.3, 0.8), 0.4), stalk, 0.2); }
  return b.build();
}
// a fallen log (where the girl hid in the Gray Forest)
export function logGeo() {
  const b = new GeoBuilder(), bark = col(0x3e342a);
  b.add(T.cyl6, M(0, 0.32, 0, Math.PI / 2, 0, 0.05, 0.34, 3.2, 0.3), bark, 0.15);
  for (let i = 0; i < 3; i++) b.limb(T.cyl4, rr(-1.2, 1.2), 0.4, 0.2, rr(0.4, 0.8), 0.05, rr(0.6, 1.2), rr(0, 6), bark, 0.1);
  return b.build();
}
// a trail marker: a leaning post with a strip of pale cloth that catches the beam
export function postGeo() {
  const b = new GeoBuilder();
  b.add(T.cyl6, M(0, 0.6, 0, 0.08, 0, 0.05, 0.07, 1.2, 0.07), col(0x3e3226), 0.12);
  b.add(T.box, M(0.02, 1.08, 0.08, 0.1, 0, 0.08, 0.09, 0.08, 0.04), col(0xc8c0a8), 0.08);
  b.add(T.box, M(0.03, 0.88, 0.1, 0.2, 0, 0.12, 0.07, 0.34, 0.02), col(0xb8b098), 0.12);
  for (let i = 0; i < 4; i++) b.add(T.dode, M(rr(-0.2, 0.2), 0.08, rr(-0.2, 0.2), rr(0, 3), rr(0, 6), 0, 0.14, 0.1, 0.14), col(0x5e5c54), 0.15);
  return b.build();
}

// ---------- textures ----------
export function mudTexture() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#2b2924'; g.fillRect(0, 0, s, s);
    const pal = ['#33302a', '#24221e', '#3a362e', '#2a2a26', '#1c1b18'];
    for (let i = 0; i < 90; i++) { g.fillStyle = pal[i % pal.length] + '77'; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 6 + Math.random() * 26, 0, TAU); g.fill(); }
    for (let i = 0; i < 1400; i++) { const v = 30 + Math.random() * 40; g.fillStyle = `rgba(${v},${v - 3},${v - 8},.5)`; g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2); }
  });
}
export function cobbleTexture() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#1c1a17'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < s + 16; x += 16) {
      const v = 58 + Math.random() * 34; g.fillStyle = `rgb(${v},${v - 3},${v - 9})`;
      g.beginPath(); g.ellipse(x + rr(-1.5, 1.5), y + 8 + rr(-1.5, 1.5), 7 + rr(-1, 1), 6.5 + rr(-1, 1), rr(0, 3), 0, TAU); g.fill();
    }
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(20,18,15,.45)'; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 4 + Math.random() * 16, 0, TAU); g.fill(); }
  });
}
// a strip of worn ground for the trails: packed earth, paler in the middle, ruts and prints, ragged edges (alpha)
export function trailTexture(village) {
  return canvasTex(256, (g, s) => {
    const img = g.createImageData(s, s), d = img.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const u = x / s, edge = Math.min(u, 1 - u) * 2, n = Math.sin(y * 0.09 + Math.sin(y * 0.031) * 3) * 0.08 + (Math.random() - 0.5) * 0.25;
      const a = Math.max(0, Math.min(1, (edge - 0.12 + n * 0.6) * 3.2));
      const rut = village ? (Math.abs(u - 0.3) < 0.035 || Math.abs(u - 0.7) < 0.035 ? -16 : 0) : 0;
      const base = (village ? 62 : 74) + edge * (village ? 10 : 18) + rut + (Math.random() - 0.5) * 22;
      const i = (y * s + x) * 4; d[i] = base + 6; d[i + 1] = base; d[i + 2] = base - 10; d[i + 3] = a * 255;
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 70; i++) { const x = s * (0.25 + Math.random() * 0.5), y = Math.random() * s; g.fillStyle = `rgba(${village ? 30 : 46},${village ? 28 : 40},${village ? 24 : 30},.55)`; g.beginPath(); g.ellipse(x, y, 3, 5, 0, 0, TAU); g.fill(); }
    for (let i = 0; i < 120; i++) { const v = 90 + Math.random() * 50; g.fillStyle = `rgba(${v},${v - 4},${v - 12},.7)`; g.fillRect(s * (0.15 + Math.random() * 0.7), Math.random() * s, 2, 2); }
  });
}
