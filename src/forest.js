// =====================================================================
//  FIELD & FOREST — Christopher's tree, bush and grass pack (from his Forest
//  Builder), repacked by tools/forest.py. Each model has a near (detailed)
//  and a far version: the woods draw the far one wherever the light touches
//  a tree and swap in the near one when it is lit and close (world3d.js).
//  Geometry groups: 0 bark (one-sided), 1 leaves (two-sided, lit the same
//  from both faces, as the pack draws them).
// =====================================================================
import { THREE, psx } from './engine.js';
import { unzlibSync } from 'three/examples/jsm/libs/fflate.module.js';
export const FF = {};
const lin = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
function oct(a, b, out, o) {
  let x = a / 127, y = b / 127, z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) { const ox = (1 - Math.abs(y)) * Math.sign(x || 1), oy = (1 - Math.abs(x)) * Math.sign(y || 1); x = ox; y = oy; }
  const l = Math.hypot(x, y, z) || 1; out[o] = x / l; out[o + 1] = y / l; out[o + 2] = z / l;
}
export function decodeForest(bytes) {
  const all = unzlibSync(bytes), dv = new DataView(all.buffer, all.byteOffset, all.byteLength), jl = dv.getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(all.subarray(4, 4 + jl))), base = 4 + jl;
  for (const name in meta) {
    const m = meta[name], n = m.verts, [lo, hi] = m.box, v0 = base + m.v[0];
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = v0 + i * 12;
      for (let k = 0; k < 3; k++) pos[i * 3 + k] = lo[k] + (dv.getUint16(o + k * 2, true) / 65535) * (hi[k] - lo[k]);
      oct(dv.getInt8(o + 6), dv.getInt8(o + 7), nrm, i * 3);
      for (let k = 0; k < 3; k++) col[i * 3 + k] = lin[all[o + 8 + k]];
    }
    const I = new Uint16Array(all.slice(base + m.i[0], base + m.i[0] + m.i[1]).buffer);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(I, 1));
    for (const gr of m.groups) g.addGroup(gr.start, gr.count, gr.kind === 'leaf' ? 1 : 0);
    g.computeBoundingBox(); g.computeBoundingSphere(); g.userData.keep = true; g.userData.shared = true; g.userData.tris = m.tris;
    FF[name.replace(/^(tree|bush|grass)_/, '')] = g;
  }
}
// the leaves: two-sided, and lit as the face that points the leaf's way from both sides (no flipped normal)
export const matLeaf = psx(new THREE.MeshLambertMaterial({ vertexColors: true, dithering: true, side: THREE.DoubleSide }));
{
  const prev = matLeaf.onBeforeCompile, key = matLeaf.customProgramCacheKey;
  matLeaf.onBeforeCompile = (sh, r) => { prev(sh, r); sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0')); };
  matLeaf.customProgramCacheKey = () => key() + '-leaf';
}
// a model's triangles, flattened (for merging into ground cover), placed by a matrix
export function ffTris(name, m) {
  const g = FF[name], P = g.attributes.position, C = g.attributes.color, I = g.index.array, pos = [], col = [], e = m.elements;
  for (let t = 0; t < I.length; t++) {
    const i = I[t], x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    pos.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
    col.push(C.getX(i), C.getY(i), C.getZ(i));
  }
  return { pos, col };
}
