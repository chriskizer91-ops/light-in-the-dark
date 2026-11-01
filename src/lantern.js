import { THREE, scene, camera, canvasTex, glowTex, GeoBuilder, T, M, col, clamp, lerp, smooth, damp, mr, settings } from './engine.js';

// =====================================================================
//  THE LANTERN — a bullseye lantern ("dark lantern"): one glass lens in
//  front and a shutter that closes it down. It throws a single beam where
//  the Warden looks, and the rest of the world stays dark. That is what
//  lets the renderer skip everything outside the beam.
//
//  The three Crown stances are how far the shutter is open:
//    DIM    a slit: short, narrow, cheap on oil, hard for things to notice
//    STEADY the working beam
//    BRIGHT wide open: far, wide, hungry for oil, and it hurts shade-things
//
//  This module owns the light itself, the held lantern and blade you see in
//  your hands, and the questions the rest of the game asks about the light:
//  how lit is this point (lightOf), is this sphere inside the beam (inBeam),
//  and how hard does an eye at this spot shine back (glint).
// =====================================================================

export const MODES = [
  { key: 'dim', name: 'DIM', mood: 'Hushed', angle: 0.2, penumbra: 0.6, distance: 14, intensity: 95, drain: 0.15, stealth: 0.84, vent: 0.5, level: 0.52 },
  { key: 'steady', name: 'STEADY', mood: 'Listening', angle: 0.34, penumbra: 0.5, distance: 22, intensity: 230, drain: 0.32, stealth: 1.0, vent: 0.85, level: 0.78 },
  { key: 'bright', name: 'BRIGHT', mood: 'Hungry', angle: 0.54, penumbra: 0.42, distance: 31, intensity: 440, drain: 0.8, stealth: 1.22, vent: 1.25, level: 1.04 },
];
export const NEAR_R = 3.0; // spill: the lantern's vents leak a little light all around you

export const lantern = {
  mode: 1, angle: MODES[1].angle, distance: MODES[1].distance, intensity: MODES[1].intensity, penumbra: MODES[1].penumbra,
  k: 1,            // 0..~1.1: how much light is actually coming out (flicker, oil, guttering)
  pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), fwd: new THREE.Vector3(0, 0, -1),
  flickT: 0, nextFlicker: 20, shutter: 0, swing: 0, swingDir: 1, light: null, vent: null,
};

// The cookie: what a bullseye lens throws — a hot centre, the lens's stepped rings, a soft edge.
const cookieTex = canvasTex(256, (g, s) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
  const c = s / 2, gr = g.createRadialGradient(c, c, 0, c, c, c);
  [[0, '#fff6e6'], [0.1, '#fff1dc'], [0.2, '#f2e2c6'], [0.27, '#b8a88c'], [0.31, '#e4d4b8'], [0.42, '#cdbda2'], [0.47, '#9a8c74'],
   [0.53, '#c4b498'], [0.68, '#8e8270'], [0.86, '#3e3a32'], [1, '#000000']].forEach(([o, cc]) => gr.addColorStop(o, cc));
  g.fillStyle = gr; g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 40; i++) { // soot and smudges on the glass
    const a = Math.random() * 6.283, r = Math.random() * c * 0.8;
    g.fillStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.08})`;
    g.beginPath(); g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 2 + Math.random() * 9, 0, 6.283); g.fill();
  }
});

// held-item materials ignore fog (they are always half a metre away)
const matView = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false });
const lensMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false, toneMapped: false });
const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb860, fog: false, toneMapped: false, transparent: true, opacity: 0.85 });
const view = { lantern: null, lens: null, flame: null, blade: null, bladePivot: null, trail: null, trailMat: null, root: null };

export function createLantern() {
  const light = new THREE.SpotLight(0xffe2b8, MODES[1].intensity, MODES[1].distance, MODES[1].angle, MODES[1].penumbra, 0.92);
  light.map = cookieTex;
  light.castShadow = true;
  light.shadow.mapSize.set(matchMedia('(pointer: coarse)').matches ? 512 : 1024, matchMedia('(pointer: coarse)').matches ? 512 : 1024);
  light.shadow.camera.near = 0.3;
  light.shadow.bias = -0.0008;
  light.shadow.normalBias = 0.035;
  scene.add(light, light.target);
  // Shadow proxies live on layer 1. three tests shadow casters against the *main* camera's
  // layers, so switch layer 1 on only once the shadow pass starts (the main loop turns it off).
  const _um = light.shadow.updateMatrices.bind(light.shadow);
  light.shadow.updateMatrices = (l, vp) => { camera.layers.enable(1); _um(l, vp); };
  lantern.light = light;

  // the vents: a dim warm glow all around, so your hands and feet are never in total darkness
  const vent = new THREE.PointLight(0xffa850, 0.9, 5.5, 2);
  scene.add(vent); lantern.vent = vent;

  buildViewModels();
  return lantern;
}

function buildViewModels() {
  const root = new THREE.Group(); camera.add(root); view.root = root;
  const brass = col(0x6a5028), dark = col(0x2e2416), soot = col(0x221a12), cloth = col(0x2a3450), leather = col(0x4a3422);
  // ---- the bullseye lantern, held low on the left ----
  const lb = new GeoBuilder();
  lb.add(T.cyl10, M(0, 0, 0, 0, 0, 0, 0.07, 0.17, 0.07), brass, 0.12);                 // body
  lb.add(T.cone, M(0, 0.12, 0, 0, 0, 0, 0.075, 0.08, 0.075), dark, 0.1);               // hood
  lb.add(T.cyl6, M(0, 0.18, 0, 0, 0, 0, 0.022, 0.06, 0.022), soot, 0.1);              // chimney
  lb.add(T.cyl6, M(0, 0.215, 0, 0, 0, 0, 0.035, 0.012, 0.035), dark, 0.1);            // chimney cap
  lb.add(T.cyl10, M(0, -0.09, 0, 0, 0, 0, 0.078, 0.02, 0.078), dark, 0.1);            // base
  lb.add(T.cyl10, M(0, 0.0, -0.07, Math.PI / 2, 0, 0, 0.062, 0.03, 0.062), brass, 0.08); // lens bezel
  lb.add(T.torus, M(0, 0.2, 0.0, 0, Math.PI / 2, 0, 0.07, 0.07, 0.035), dark, 0.1); // bail
  const lanternMesh = new THREE.Mesh(lb.build(), matView);
  // glowing vent slits around the hood: the flame showing through
  const sb = new GeoBuilder(); for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; sb.add(T.box, M(Math.cos(a) * 0.071, 0.05, Math.sin(a) * 0.071, 0, -a, 0, 0.006, 0.05, 0.016), col(0xffffff), 0); }
  const slits = new THREE.Mesh(sb.build(), flameMat);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.05, 18), lensMat); lens.position.set(0, 0, -0.087); lens.rotation.y = Math.PI;
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), flameMat); flame.scale.set(1, 1.8, 1); flame.position.set(0, 0.0, 0);
  const lanternG = new THREE.Group(); lanternG.add(lanternMesh, lens, flame, slits);
  // arm + glove up to the bail
  const ab = new GeoBuilder();
  ab.limb(T.cyl6, -0.2, -0.3, 0.3, 0.62, 0.045, 0.75, Math.PI * 0.82, cloth, 0.12);
  ab.add(T.ico, M(0, 0.27, 0.01, 0, 0, 0, 0.05, 0.045, 0.055), leather, 0.15);
  lanternG.add(new THREE.Mesh(ab.build(), matView));
  // a warm glow leaking from the vents, so the lantern reads as lit from behind
  const ventMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffa040, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, toneMapped: false, opacity: 0.5 });
  const ventGlow = new THREE.Sprite(ventMat); ventGlow.position.set(0, 0.04, 0); ventGlow.scale.set(0.3, 0.22, 1); lanternG.add(ventGlow); view.ventGlow = ventGlow;
  lanternG.scale.setScalar(0.62); lanternG.rotation.y = -0.6;
  lanternG.position.set(-0.33, -0.36, -0.6);
  root.add(lanternG);
  view.lantern = lanternG; view.lens = lens; view.flame = flame;

  // ---- the blade, held on the right ----
  const hb = new GeoBuilder(), stb = new GeoBuilder(), guard = col(0x6a5a3a), grip = col(0x3a2a1c);
  stb.add(T.box, M(0, 0.42, 0, 0, 0, 0, 0.034, 0.7, 0.008), col(0xffffff), 0.04);
  stb.add(T.cone4, M(0, 0.8, 0, 0, Math.PI / 4, 0, 0.025, 0.08, 0.006), col(0xffffff), 0.04);
  hb.add(T.box, M(0, 0.06, 0, 0, 0, 0, 0.16, 0.022, 0.03), guard, 0.1);
  hb.add(T.cyl6, M(0, -0.05, 0, 0, 0, 0, 0.018, 0.13, 0.018), grip, 0.1);
  hb.add(T.ico, M(0, -0.13, 0, 0, 0, 0, 0.026, 0.026, 0.026), guard, 0.1);
  hb.add(T.ico, M(0.0, -0.04, 0.0, 0, 0, 0, 0.045, 0.06, 0.05), leather, 0.15); // glove
  hb.limb(T.cyl6, 0.04, -0.08, 0.03, 0.42, 0.045, 2.3, -0.5, cloth, 0.12);     // sleeve
  // steel gets its own shiny material, so the lantern's warm light reads as a highlight, not as wood
  const steelMat = new THREE.MeshPhongMaterial({ color: 0xa8b0b8, emissive: 0x23262b, specular: 0xfff0d8, shininess: 60, fog: false, vertexColors: true });
  const blade = new THREE.Group(); blade.add(new THREE.Mesh(hb.build(), matView), new THREE.Mesh(stb.build(), steelMat));
  blade.scale.setScalar(0.62);
  const pivot = new THREE.Group(); pivot.add(blade);
  pivot.position.set(0.36, -0.46, -0.58);
  blade.rotation.set(-0.95, -0.3, 0.62);
  root.add(pivot);
  view.blade = blade; view.bladePivot = pivot;
  // slash trail: a thin arc that flashes during the swing
  view.trailMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0, fog: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
  const trail = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.55, 20, 1, Math.PI * 0.25, Math.PI * 0.5), view.trailMat);
  trail.rotation.x = -Math.PI / 2 + 0.3; trail.position.set(0.0, -0.2, -0.3);
  root.add(trail); view.trail = trail;
}

export function setMode(i) { lantern.mode = clamp(i, 0, 2); lantern.shutter = 1; }
export function swingBlade(dir = 1) { lantern.swing = 1; lantern.swingDir = dir; }

const _v = new THREE.Vector3(), _lensLocal = new THREE.Vector3(-0.3, -0.36, -0.66), _ventLocal = new THREE.Vector3(0.02, -0.1, -0.26);
// ctx: { on, fuel, maxFuel, dt, moving, bob, menu, hurt }
export function updateLantern(dt, ctx) {
  const B = MODES[lantern.mode], k = damp(9, dt);
  lantern.angle = lerp(lantern.angle, B.angle, k); lantern.distance = lerp(lantern.distance, B.distance, k);
  lantern.intensity = lerp(lantern.intensity, B.intensity, k); lantern.penumbra = lerp(lantern.penumbra, B.penumbra, k);
  // a flame, not a bulb: it breathes, and it gutters when the oil is low
  lantern.nextFlicker -= dt;
  if (lantern.nextFlicker < 0) { lantern.flickT = mr(0.1, 0.3); lantern.nextFlicker = mr(18, 40); }
  const low = ctx.fuel < 12;
  if (low && Math.random() < dt * 4) lantern.flickT = Math.max(lantern.flickT, mr(0.04, 0.16));
  lantern.flickT -= dt;
  const t = performance.now() / 1000;
  let flick = 1 + 0.035 * Math.sin(t * 17.3) + 0.025 * Math.sin(t * 31.7 + 1.3);
  if (lantern.flickT > 0) flick *= Math.random() < 0.5 ? 0.25 : 0.7;
  const oil = ctx.fuel <= 0 ? 0.1 : low ? lerp(0.45, 1, ctx.fuel / 12) : 1; // no oil: just an ember
  lantern.k = (ctx.on ? 1 : 0) * flick * oil;
  lantern.shutter = Math.max(0, lantern.shutter - dt * 5);
  const L = lantern.light;
  L.intensity = lantern.intensity * lantern.k * (1 - lantern.shutter * 0.7);
  L.angle = lantern.angle; L.distance = lantern.distance; L.penumbra = lantern.penumbra;
  L.castShadow = settings.shadows;
  lantern.vent.intensity = 0.55 * B.vent * lantern.k * (ctx.menu ? 0.6 : 1);

  // the held lantern sways with your steps and swings a little behind your view
  const bobY = Math.sin(ctx.bob * 2) * 0.012 * ctx.moving, bobX = Math.cos(ctx.bob) * 0.01 * ctx.moving;
  view.lantern.position.set(-0.33 + bobX, -0.36 + bobY - lantern.shutter * 0.02, -0.6);
  view.ventGlow.material.opacity = 0.18 + 0.4 * Math.min(1, lantern.k) * (0.6 + lantern.mode * 0.2);
  view.lantern.rotation.set(Math.sin(t * 1.3) * 0.02, -0.6 + Math.sin(t * 0.9) * 0.03, Math.sin(ctx.bob) * 0.04 * ctx.moving);
  view.lens.material.color.setRGB(1, 0.85, 0.62).multiplyScalar(0.25 + 0.95 * lantern.k * (0.55 + lantern.mode * 0.25));
  view.flame.scale.set(1, 1.6 + Math.sin(t * 23) * 0.25, 1).multiplyScalar(0.6 + 0.5 * lantern.k);
  view.flame.material.opacity = 0.35 + 0.5 * Math.min(1, lantern.k);
  // the blade swing: a fast cut from right to left
  if (lantern.swing > 0) lantern.swing = Math.max(0, lantern.swing - dt / 0.2);
  const s = lantern.swing, ph = 1 - s; // 0 -> 1 over the swing
  const cut = s > 0 ? Math.sin(ph * Math.PI) : 0;
  view.bladePivot.position.set(0.36 - cut * 0.4 * lantern.swingDir + bobX * 1.2, -0.46 + cut * 0.16 + bobY, -0.58 - cut * 0.1);
  view.bladePivot.rotation.set(-cut * 0.9, cut * 0.4 * lantern.swingDir, -cut * 1.3 * lantern.swingDir + Math.sin(ctx.bob) * 0.03 * ctx.moving);
  view.trailMat.opacity = s > 0 ? Math.sin(ph * Math.PI) * 0.55 : 0;
  view.trail.rotation.z = (ph - 0.5) * 1.2 * lantern.swingDir;

  // the light comes out of the lens, and points where you look — a beat late
  _v.copy(_lensLocal); camera.localToWorld(_v); lantern.pos.copy(_v);
  camera.getWorldDirection(lantern.fwd);
  lantern.dir.lerp(lantern.fwd, damp(ctx.menu ? 4 : 13, dt)).normalize();
  L.position.copy(lantern.pos);
  L.target.position.copy(lantern.pos).addScaledVector(lantern.dir, 10); L.target.updateMatrixWorld();
  _v.copy(_ventLocal); camera.localToWorld(_v); lantern.vent.position.copy(_v); // just behind the lantern, so it lights the side you see
}

// ---------- questions the game asks about the light ----------
const _br = { d: 0, ang: 0 };
export function beamAt(x, y, z) {
  const p = camera.position, dx = x - p.x, dy = y - p.y, dz = z - p.z, d = Math.hypot(dx, dy, dz) || 0.001, D = lantern.dir;
  _br.d = d; _br.ang = Math.acos(clamp((dx * D.x + dy * D.y + dz * D.z) / d, -1, 1));
  return _br;
}
// how hard an eye (or a bottle, or a blade) at this spot shines back, 0..1 — line of sight is the caller's job
export function glint(d, ang) {
  return smooth(lantern.angle * 1.45, lantern.angle * 0.5, ang) * clamp(1.45 - d / (lantern.distance * 1.8), 0, 1) * Math.min(1, lantern.k);
}
// how lit a point is by the lantern alone (beam + vent spill), on the Crown's 0..~1 scale
export function lanternLevel(x, y, z) {
  const B = MODES[lantern.mode], r = beamAt(x, y, z), kk = Math.min(1, lantern.k);
  let lv = 0;
  if (r.ang < lantern.angle * 1.3 && r.d < lantern.distance) lv = B.level * smooth(lantern.angle * 1.3, lantern.angle * 0.55, r.ang) * Math.pow(1 - r.d / lantern.distance, 0.6);
  if (r.d < NEAR_R) lv = Math.max(lv, 0.3 * B.vent * (1 - r.d / NEAR_R));
  return lv * kk;
}
// culling: is a bounding sphere inside the beam's cone (plus a margin), or in the spill?
export function inBeam(cx, cy, cz, r, margin = 0.06, extra = 6) {
  const p = camera.position, dx = cx - p.x, dy = cy - p.y, dz = cz - p.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < NEAR_R + r) return true;
  if (lantern.k < 0.02 || d - r > lantern.distance + extra) return false;
  const allow = lantern.angle + margin + Math.asin(Math.min(1, r / d));
  if (allow >= Math.PI) return true;
  const D = lantern.dir;
  return (dx * D.x + dy * D.y + dz * D.z) / d > Math.cos(allow);
}
export function showViewModels(on) { if (view.root) view.root.visible = on; }
