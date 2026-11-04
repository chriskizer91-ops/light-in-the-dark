// =====================================================================
//  THE REMASTER — creatures rebuilt from their sheets in Blender (tools/remaster/):
//  a body carved to match every view of its sheet, a texture painted from the
//  views that can actually see each spot, three or four LODs that share one
//  vertex buffer, and skin weights from Blender's heat weighting. Each creature
//  is one small file: meshopt-encoded, deflated. They are decoded at startup;
//  a creature without one keeps its procedural body (rigs.js).
// =====================================================================
import { THREE } from './engine.js';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { unzlibSync } from 'three/examples/jsm/libs/fflate.module.js';
import { FILES, FOREST } from 'remaster-files';   // { name: { bin, tex } } and the forest pack: inlined bytes, or the artifact's own files
import { decodeForest } from './forest.js';

export const REM = {};
const status = { done: 0, total: Object.keys(FILES).length, ready: false, error: null };
export const remasterStatus = status;

function octDecode(a, b, out, o) {
  let x = a / 127, y = b / 127, z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) { const ox = (1 - Math.abs(y)) * Math.sign(x || 1), oy = (1 - Math.abs(x)) * Math.sign(y || 1); x = ox; y = oy; }
  const l = Math.hypot(x, y, z) || 1; out[o] = x / l; out[o + 1] = y / l; out[o + 2] = z / l;
}
function decode(bytes) {
  const all = unzlibSync(bytes), dv = new DataView(all.buffer, all.byteOffset, all.byteLength), jl = dv.getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(all.subarray(4, 4 + jl))), base = 4 + jl, n = meta.verts;
  const V = new Uint8Array(n * 20);
  MeshoptDecoder.decodeVertexBuffer(V, n, 20, all.subarray(base + meta.v[0], base + meta.v[0] + meta.v[1]));
  const vd = new DataView(V.buffer), [lo, hi] = meta.box;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Uint16Array(n * 2), si = new Uint8Array(n * 4), sw = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 20;
    for (let k = 0; k < 3; k++) pos[i * 3 + k] = lo[k] + (vd.getUint16(o + k * 2, true) / 65535) * (hi[k] - lo[k]);
    octDecode(vd.getInt8(o + 6), vd.getInt8(o + 7), nrm, i * 3);
    uv[i * 2] = vd.getUint16(o + 8, true); uv[i * 2 + 1] = vd.getUint16(o + 10, true);
    for (let k = 0; k < 4; k++) { si[i * 4 + k] = V[o + 12 + k]; sw[i * 4 + k] = V[o + 16 + k]; }
  }
  const attrs = {
    position: new THREE.BufferAttribute(pos, 3), normal: new THREE.BufferAttribute(nrm, 3), uv: new THREE.BufferAttribute(uv, 2, true),
    skinIndex: new THREE.Uint8BufferAttribute(si, 4), skinWeight: new THREE.BufferAttribute(sw, 4, true),
  };
  const lods = meta.lods.map((l) => {
    const I = new Uint16Array(l.tris * 3);
    MeshoptDecoder.decodeIndexBuffer(new Uint8Array(I.buffer), I.length, 2, all.subarray(base + l.i[0], base + l.i[0] + l.i[1]));
    const g = new THREE.BufferGeometry();
    for (const k in attrs) g.setAttribute(k, attrs[k]);
    g.setIndex(new THREE.BufferAttribute(I, 1)); g.addGroup(0, I.length, 0);
    g.computeBoundingSphere(); g.userData.keep = true; g.userData.tris = l.tris;
    return g;
  });
  return { def: meta.bones.map((b) => ({ name: b.name, parent: b.parent, pos: b.pos })), lods };
}
async function bytesOf(src) {
  if (src instanceof Uint8Array) return src;
  const r = await fetch(src); if (!r.ok) throw new Error(src + ' ' + r.status); return new Uint8Array(await r.arrayBuffer());
}
function loadTexture(url) {
  return new Promise((res, rej) => new THREE.TextureLoader().load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; res(t); }, undefined, rej));
}
// every remastered creature, decoded once at startup
export const remasterReady = (async () => {
  try {
    if (typeof window !== 'undefined' && window.__noRemaster) throw new Error('turned off (test)');   // for before/after shots
    await MeshoptDecoder.ready;
    const forest = bytesOf(FOREST).then(decodeForest).catch((e) => console.warn('forest pack: keeping the procedural trees', e));
    await Promise.all([forest, ...Object.entries(FILES).map(async ([name, f]) => {
      const [bytes, tex] = await Promise.all([bytesOf(f.bin), loadTexture(f.tex)]);
      REM[name] = { ...decode(bytes), tex }; status.done++;
    })]);
  } catch (e) { status.error = String(e); console.warn('remaster: falling back to the procedural bodies', e); }
  status.ready = true;
})();
