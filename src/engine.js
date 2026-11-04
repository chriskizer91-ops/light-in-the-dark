import * as THREE from 'three';
export { THREE };

// =====================================================================
//  ENGINE — renderer, scene, camera, materials and the merged-geometry
//  builder. Adapted from Eyeshine: everything is low-poly, flat-shaded,
//  vertex-coloured and merged, so one object = one draw call.
// =====================================================================

export const $ = (id) => document.getElementById(id);
export const IS_TOUCH = window.matchMedia ? matchMedia('(pointer: coarse)').matches : 'ontouchstart' in window;

// ---------- small math + seeded random ----------
let seed = 1;
export const srand = (s) => { seed = s >>> 0; };
export function rnd() {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const rr = (a, b) => a + (b - a) * rnd();
export const ri = (a, b) => Math.floor(rr(a, b + 1));
export const mr = (a, b) => a + (b - a) * Math.random();
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (k, dt) => 1 - Math.exp(-k * dt);
export const TAU = Math.PI * 2;
export const wrapAngle = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
export const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * clamp(t, 0, 1);
export const dist2 = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);

// Game logic uses a "heading": direction (cos h, sin h) on the x/z ground plane (the 2D Crown's
// angle convention, with its y axis becoming z). A mesh modelled facing +Z turns to heading h with
// rotation.y = PI/2 - h. The camera's yaw maps to heading with headingOfYaw.
export const headingOfYaw = (yaw) => Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
export const rotYOfHeading = (h) => Math.PI / 2 - h;

// ---------- settings ----------
export const settings = { culling: true, fog: true, psx: false, shadows: true, xray: false, debugLight: false, stats: true, sound: true, detail: 'high', proxies: true, ring: false };

// =====================================================================
//  Renderer / scene / camera
// =====================================================================
export const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
$('stage').appendChild(renderer.domElement);
export const canvas = renderer.domElement;

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.Fog(0x000000, 8, 40);

export const camera = new THREE.PerspectiveCamera(72, 1, 0.04, 140);
camera.rotation.order = 'YXZ';
scene.add(camera); // the held lantern and blade are children of the camera

// The Deep Woods have no sky: the canopy closed long ago. Almost no ambient light at all.
export const hemi = new THREE.HemisphereLight(0x6a7890, 0x0a0806, 0.035);
scene.add(hemi);

// Stats: split shadow-pass from on-screen triangles. A do-nothing probe drawn first in the main
// pass records the counters right after the shadow pass (same trick as Eyeshine).
renderer.info.autoReset = false;
export const statsProbe = { shadowTris: 0, shadowCalls: 0 };
const probe = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)),
  new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }));
probe.frustumCulled = false; probe.renderOrder = -1e9;
probe.onBeforeRender = (r) => { statsProbe.shadowTris = r.info.render.triangles; statsProbe.shadowCalls = r.info.render.calls; };
scene.add(probe);

// textures drawn on canvases (no external files)
export function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export const glowTex = canvasTex(64, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,.95)');
  gr.addColorStop(0.42, 'rgba(255,255,255,.28)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
}, false);
glowTex.generateMipmaps = false; glowTex.minFilter = THREE.LinearFilter; // keep tiny far-away eyes bright
export const flameTex = canvasTex(64, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s * 0.62, 0, s / 2, s * 0.62, s * 0.5);
  gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.25, 'rgba(255,200,110,.9)');
  gr.addColorStop(0.6, 'rgba(240,110,30,.35)'); gr.addColorStop(1, 'rgba(120,30,0,0)');
  g.fillStyle = gr; g.beginPath(); g.ellipse(s / 2, s * 0.6, s * 0.3, s * 0.42, 0, 0, TAU); g.fill();
}, false);
export const ringTex = canvasTex(128, (g, s) => {
  const c = s / 2, gr = g.createRadialGradient(c, c, c * 0.6, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
}, false);

// ---------- PS1 vertex snapping (patched into the standard material) ----------
export const snapU = { value: new THREE.Vector2(240, 135) };
export const snapOn = { value: 0 };
// The curse drains the colour (the 2D Crown's grey world): on the outer floors everything outside the lantern's
// cone and the fires' pools is pushed toward grey; where your light falls, colour comes back. uGray = how much.
export const ash = { uGray: { value: 0 }, uLampPos: { value: new THREE.Vector3() }, uLampDir: { value: new THREE.Vector3(0, 0, -1) }, uLampCos: { value: new THREE.Vector2(0.8, 0.95) }, uLampDist: { value: 22 },
  uFire: { value: [new THREE.Vector4(0, -99, 0, 0), new THREE.Vector4(0, -99, 0, 0), new THREE.Vector4(0, -99, 0, 0)] } };
export function psx(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSnap = snapU; sh.uniforms.uSnapOn = snapOn; Object.assign(sh.uniforms, ash);
    sh.vertexShader = 'uniform vec2 uSnap;\nuniform float uSnapOn;\nvarying vec3 vAshW;\n' + sh.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      { vec4 aw = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        aw = instanceMatrix * aw;
      #endif
        vAshW = (modelMatrix * aw).xyz; }
      if (uSnapOn > 0.5) { vec4 sp = gl_Position; sp.xy = floor(sp.xy / sp.w * uSnap + 0.5) / uSnap * sp.w; gl_Position = sp; }`);
    sh.fragmentShader = 'uniform float uGray;\nuniform vec3 uLampPos;\nuniform vec3 uLampDir;\nuniform vec2 uLampCos;\nuniform float uLampDist;\nuniform vec4 uFire[3];\nvarying vec3 vAshW;\n' + sh.fragmentShader.replace(
      '#include <dithering_fragment>',
      `if (uGray > 0.0) {
        vec3 tl = vAshW - uLampPos; float dl = length(tl);
        float lit = smoothstep(uLampCos.x, uLampCos.y, dot(tl / max(dl, 0.001), uLampDir)) * (1.0 - smoothstep(uLampDist * 0.6, uLampDist, dl));
        lit = max(lit, 1.0 - smoothstep(1.2, 3.2, dl));
        for (int i = 0; i < 3; i++) lit = max(lit, 1.0 - smoothstep(uFire[i].w * 0.45, uFire[i].w, length(vAshW - uFire[i].xyz)));
        float g = dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(g) * vec3(0.97, 0.98, 1.02), uGray * (1.0 - lit));
      }
      #include <dithering_fragment>`);
  };
  mat.customProgramCacheKey = () => 'psx2';
  return mat;
}
export const matVC = psx(new THREE.MeshLambertMaterial({ vertexColors: true, dithering: true }));
export const matFoliage = psx(new THREE.MeshLambertMaterial({ vertexColors: true, dithering: true, side: THREE.DoubleSide }));

// =====================================================================
//  Geometry builder
// =====================================================================
export const T = {};
export function tpl(name, make) { const g0 = make(), g = g0.index ? g0.toNonIndexed() : g0; T[name] = g.attributes.position.array.slice(); g.dispose(); }
tpl('trunk', () => new THREE.CylinderGeometry(0.6, 1, 1, 5));
tpl('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 6));
tpl('cyl4', () => new THREE.CylinderGeometry(1, 1, 1, 4));
tpl('cyl6', () => new THREE.CylinderGeometry(1, 1, 1, 6));
tpl('cyl10', () => new THREE.CylinderGeometry(1, 1, 1, 10));
tpl('cone', () => new THREE.ConeGeometry(1, 1, 7));
tpl('cone4', () => new THREE.ConeGeometry(1, 1, 4));
tpl('ico', () => new THREE.IcosahedronGeometry(1, 0));
tpl('ico1', () => new THREE.IcosahedronGeometry(1, 1));
tpl('dode', () => new THREE.DodecahedronGeometry(1, 0));
tpl('box', () => new THREE.BoxGeometry(1, 1, 1));
tpl('disc', () => new THREE.CylinderGeometry(1, 0.8, 1, 9));
tpl('torus', () => new THREE.TorusGeometry(1, 0.18, 4, 12));
tpl('hemi', () => new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2));
tpl('sphere', () => new THREE.SphereGeometry(1, 8, 6));
T.leaf = new Float32Array([0, 0, 0.5, 0.3, 0.07, 0, 0, 0, -0.5, 0, 0, 0.5, 0, 0, -0.5, -0.3, 0.07, 0]);
T.blade = (() => { // tapered, curved grass blade: 7 triangles
  const rows = [[0, 0, 0.5], [0.35, 0.05, 0.42], [0.65, 0.15, 0.3], [0.88, 0.3, 0.16]], tip = [0, 1, 0.45], a = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const [y0, z0, w0] = rows[i], [y1, z1, w1] = rows[i + 1];
    a.push(-w0, y0, z0, w0, y0, z0, w1, y1, z1, -w0, y0, z0, w1, y1, z1, -w1, y1, z1);
  }
  const [y3, z3, w3] = rows[3]; a.push(-w3, y3, z3, w3, y3, z3, ...tip);
  return new Float32Array(a);
})();

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function M(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s);
}
export const I = () => M(0, 0, 0);
export const col = (hex) => new THREE.Color(hex);

export class GeoBuilder {
  constructor() { this.pos = []; this.col = []; }
  add(arr, m, c, j = 0.1) {
    const e = m.elements;
    for (let i = 0; i < arr.length; i += 9) {
      const f = 1 + (rnd() * 2 - 1) * j;
      for (let k = 0; k < 9; k += 3) {
        const x = arr[i + k], y = arr[i + k + 1], z = arr[i + k + 2];
        this.pos.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
        this.col.push(c.r * f, c.g * f, c.b * f);
      }
    }
  }
  // same as add(), but some triangles take an alternate colour (birch bark marks etc.)
  addAlt(arr, m, c, j, alt, p) {
    const e = m.elements;
    for (let i = 0; i < arr.length; i += 9) {
      const cc = rnd() < p ? alt : c, f = 1 + (rnd() * 2 - 1) * j;
      for (let k = 0; k < 9; k += 3) {
        const x = arr[i + k], y = arr[i + k + 1], z = arr[i + k + 2];
        this.pos.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
        this.col.push(cc.r * f, cc.g * f, cc.b * f);
      }
    }
  }
  // triangles already placed (flat arrays of positions and colours), e.g. a pack model's (forest.js ffTris)
  addRaw(r, j = 0.08) { const f = 1 + (rnd() * 2 - 1) * j; for (let i = 0; i < r.pos.length; i++) { this.pos.push(r.pos[i]); this.col.push(r.col[i] * f); } }
  tri(ax, ay, az, bx, by, bz, cx, cy, cz, c, j = 0.1) {
    const f = 1 + (rnd() * 2 - 1) * j;
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let k = 0; k < 3; k++) this.col.push(c.r * f, c.g * f, c.b * f);
  }
  // a cylinder-ish limb from a base point, tilted from vertical by `tilt`, heading `yaw`
  limb(arr, x, y, z, len, r, tilt, yaw, c, j = 0.1) {
    const st = Math.sin(tilt), ct = Math.cos(tilt);
    const dx = st * Math.sin(yaw), dy = ct, dz = st * Math.cos(yaw);
    this.add(arr, M(x + dx * len / 2, y + dy * len / 2, z + dz * len / 2, tilt, yaw, 0, r, len, r), c, j);
    return [x + dx * len, y + dy * len, z + dz * len];
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }
}

// bark: a ridged, root-flared cylinder (vertices displaced by a periodic function, so no seam cracks)
export function barkArr(rBot, rTop, h, radial, rings, amp) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, radial, rings, true); g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
    const k = (1 + amp * (0.6 * Math.sin(a * 7 + y * 0.8) + 0.4 * Math.sin(a * 13 - y * 2.1 + 1.3))) * (1 + 0.45 * Math.exp(-y * 3.5));
    p.setXYZ(i, x * k, y, z * k);
  }
  const ng = g.toNonIndexed(), arr = ng.attributes.position.array.slice(); g.dispose(); ng.dispose(); return arr;
}
export const nz3 = (x, y, z) => Math.sin(x * 1.7 + y * 2.3) * Math.sin(z * 1.9 - x * 0.7) * 0.5 + Math.sin(x * 3.1 - z * 2.7 + y * 1.3) * 0.3 + Math.sin(y * 4.3 + z * 3.7 + x) * 0.2;
export function rockArr(detail, amp, s0) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + amp * nz3(x * 2.2 + s0, y * 2.2, z * 2.2 - s0) + amp * 0.4 * nz3(x * 6 - s0, y * 6 + s0, z * 6);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  const arr = (g.index ? g.toNonIndexed() : g).attributes.position.array.slice(); g.dispose(); return arr;
}
