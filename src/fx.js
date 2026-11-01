import { THREE, scene, glowTex } from './engine.js';

// =====================================================================
//  PARTICLES — two pooled point clouds (one draw call each): small
//  sparks/embers and soft puffs (breath in the cold, dust). Additive, so
//  they fade by darkening, and the black fog swallows them at the beam's edge.
// =====================================================================
function pool(n, size) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size, map: glowTex, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; scene.add(pts);
  const p = []; for (let i = 0; i < n; i++) p.push({ life: 0, max: 1, x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, r: 0, g: 0, b: 0, grav: 0, drag: 0 });
  return { pos, col, g, p, next: 0, n };
}
const sparks = pool(420, 0.055), puffs = pool(160, 0.32);

function emit(P, x, y, z, vx, vy, vz, rgb, life, grav, drag) {
  const o = P.p[P.next]; P.next = (P.next + 1) % P.n;
  Object.assign(o, { x, y, z, vx, vy, vz, r: rgb[0], g: rgb[1], b: rgb[2], life, max: life, grav, drag });
}
// a burst of sparks from a point
export function burst(x, y, z, n, rgb, speed = 2, life = 0.6, grav = -4, up = 0.6) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, e = Math.random() * 2 - 1, s = speed * (0.4 + Math.random() * 0.8), h = Math.sqrt(1 - e * e);
    emit(sparks, x, y, z, Math.cos(a) * h * s, e * s * 0.6 + up * speed * 0.5, Math.sin(a) * h * s, rgb, life * (0.6 + Math.random() * 0.8), grav, 1.5);
  }
}
// one ember drifting down
export function ember(x, y, z, rgb) { emit(sparks, x, y, z, (Math.random() - 0.5) * 0.3, -0.2 - Math.random() * 0.3, (Math.random() - 0.5) * 0.3, rgb, 0.9 + Math.random() * 0.6, -0.3, 0.5); }
// a soft puff (breath, dust), drifting with a small velocity
export function puff(x, y, z, vx, vy, vz, rgb, life = 1.2) { emit(puffs, x, y, z, vx, vy, vz, rgb, life, 0.15, 1.2); }
export function dust(x, y, z, n, rgb) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, s = 0.4 + Math.random() * 0.8; puff(x, y, z, Math.cos(a) * s, 0.1 + Math.random() * 0.3, Math.sin(a) * s, rgb, 1 + Math.random() * 0.6); } }

function step(P, dt) {
  for (let i = 0; i < P.n; i++) {
    const o = P.p[i];
    if (o.life <= 0) { P.pos[i * 3 + 1] = -99; P.col[i * 3] = P.col[i * 3 + 1] = P.col[i * 3 + 2] = 0; continue; }
    o.life -= dt; const k = Math.exp(-o.drag * dt);
    o.vx *= k; o.vz *= k; o.vy = o.vy * k + o.grav * dt;
    o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt; if (o.y < 0.02) { o.y = 0.02; o.vy *= -0.3; }
    const f = Math.max(0, o.life / o.max), a = P === puffs ? Math.sin(Math.PI * f) : f * f;
    P.pos[i * 3] = o.x; P.pos[i * 3 + 1] = o.y; P.pos[i * 3 + 2] = o.z;
    P.col[i * 3] = o.r * a; P.col[i * 3 + 1] = o.g * a; P.col[i * 3 + 2] = o.b * a;
  }
  P.g.attributes.position.needsUpdate = true; P.g.attributes.color.needsUpdate = true;
}
export function updateFX(dt) { step(sparks, dt); step(puffs, dt); }
