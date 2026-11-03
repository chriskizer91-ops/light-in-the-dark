// Model-sheet viewer: orthographic views of a rig or a ruin piece on a grey grid with a meter ruler,
// laid out like the reference sheets, so a model can be checked against its reference side by side.
import { THREE, renderer, flameTex, settings } from '../src/engine.js';
import { getRig, makeSkeleton, rigMaterial } from '../src/rigs.js';
import * as RU from '../src/ruins.js';

const W = 1536, H = 1024;
renderer.setPixelRatio(1); renderer.setSize(W, H); renderer.shadowMap.enabled = false;
renderer.toneMapping = THREE.NoToneMapping;
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 1.4); scene.add(key);
const ov = document.getElementById('ov'), g = ov.getContext('2d');
const VIEWS = { front: [0, 0, 1], side: [1, 0, 0], back: [0, 0, -1], tq: [0.7, 0, 0.7], top: [0, 1, 0.0001], right: [-1, 0, 0] };

function creature(type, q, pose, heat = 0.4) {
  const rig = getRig(type, q), { bones, by, skeleton } = makeSkeleton(rig.def), grp = new THREE.Group();
  grp.add(bones[0]);
  const body = rigMaterial(rig); if (body.userData.glow) body.userData.glow.value = heat ?? 0.4;
  const gloss = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90 }), glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  const mesh = new THREE.SkinnedMesh(rig.geo, [body, gloss, rig.accent === 'steel' ? gloss : glow]); mesh.frustumCulled = false; grp.add(mesh);
  grp.updateMatrixWorld(true); mesh.bind(skeleton);
  if (pose) for (const k in pose) if (by[k]) by[k].rotation.set(...pose[k]);
  for (const c of rig.candles || []) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false })); const bp = rig.def.find((d) => d.name === c.bone).pos; s.position.set(c.pos[0] - bp[0], c.pos[1] - bp[1], c.pos[2] - bp[2]); s.scale.set(c.s * 0.7, c.s * 1.3, 1); by[c.bone].add(s); }
  if (rig.eyes) { const bp = rig.def.find((d) => d.name === rig.eyes.bone).pos; for (let i = 0; i < rig.eyes.n; i++) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa040 })); e.position.set(rig.eyes.pos[0] - bp[0] + (rig.eyes.n > 1 ? (i ? 1 : -1) * rig.eyes.spread : 0), rig.eyes.pos[1] - bp[1], rig.eyes.pos[2] - bp[2]); by[rig.eyes.bone].add(e); } }
  return { obj: grp, tris: rig.geo.userData.tris };
}
function piece(geo) { const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); return { obj: m, tris: (geo.index ? geo.index.count : geo.attributes.position.count) / 3 }; }

// render: items = [{ obj, label }], one per view, or one obj and several views
window.sheet = function ({ type, q = 2, geo, views = ['front', 'side', 'back', 'tq'], weights, maxH = 2.5, scale = 1, pose, title = '', bg = '#c9c9c9', objs, cz = 0, glow }) {
  while (scene.children.length > 2) scene.remove(scene.children[2]);
  const made = objs || [type ? creature(type, q, pose, glow) : piece(geo)];
  const wt = weights || views.map((v) => (v === 'side' || v === 'right' ? 2 : 1)), wsum = wt.reduce((a, b) => a + b, 0), xs = []; let acc = 0; for (const w of wt) { xs.push(acc); acc += (w / wsum) * W; }
  const pxm = (H * 0.78) / maxH, ground = H * 0.86;
  renderer.setScissorTest(true); renderer.setClearColor(bg);
  renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H); renderer.clear();
  views.forEach((v, i) => {
    const colW = (wt[i] / wsum) * W, d = new THREE.Vector3(...VIEWS[v]).normalize();
    const cam = v === 'top' ? new THREE.OrthographicCamera(-colW / 2 / pxm, colW / 2 / pxm, H / 2 / pxm, -H / 2 / pxm, 0.01, 100) : new THREE.OrthographicCamera(-colW / 2 / pxm, colW / 2 / pxm, ground / pxm, -(H - ground) / pxm, 0.01, 100);
    const target = new THREE.Vector3(0, 0, v === 'side' || v === 'right' ? cz : 0); cam.position.copy(target).addScaledVector(d, 20); if (v === 'top') { cam.position.set(0, 20, cz); cam.up.set(0, 0, -1); target.set(0, 0, cz); } cam.lookAt(target);
    key.position.copy(cam.position).add(new THREE.Vector3(3, 8, 2));
    const o = made[Math.min(i, made.length - 1)].obj; o.scale.setScalar(scale); if (!o.parent) scene.add(o);
    if (made.length > 1) made.forEach((m, k) => (m.obj.visible = k === i));
    renderer.setViewport(xs[i], 0, colW, H); renderer.setScissor(xs[i], 0, colW, H); renderer.render(scene, cam);
  });
  renderer.setScissorTest(false);
  // grid, ruler, labels
  g.clearRect(0, 0, W, H); g.strokeStyle = 'rgba(0,0,0,.08)'; g.lineWidth = 1;
  for (let m = 0; m <= maxH * 4; m++) { const y = ground - (m / 4) * pxm; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.fillStyle = '#333'; g.font = '14px sans-serif';
  for (let m = 0; m <= maxH * 4; m++) { const y = ground - (m / 4) * pxm; if (m % 2 === 0) g.fillText((m / 4).toFixed(m % 4 ? 1 : 0) + (m === 0 ? ' m' : ''), 6, y + 5); }
  g.strokeStyle = '#555'; g.beginPath(); g.moveTo(0, ground); g.lineTo(W, ground); g.stroke();
  g.font = '15px sans-serif'; g.textAlign = 'center'; views.forEach((v, i) => g.fillText(v.toUpperCase(), xs[i] + ((wt[i] / wsum) * W) / 2, ground + 30));
  g.textAlign = 'left'; g.fillText(title + '   ' + made.map((m) => (m.tris / 1000).toFixed(1) + 'k tris').join(' / '), 60, 24);
  return made.map((m) => m.tris);
};
window.RU = RU; window.THREE = THREE; window.getRig = getRig;
window.creature = creature;
