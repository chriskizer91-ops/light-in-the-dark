// Pack a remastered creature into one .bin: a single meshopt-encoded vertex buffer and one index buffer per
// LOD (the lower LODs are meshopt simplifications of the top one, so they share its vertices, skin and UVs),
// the whole deflated.   file = deflate([u32 json length][json][buffers...])
//   json = { name, box, bones, verts, lods: [{tris, i:[off,len]}], v:[off,len] }
// usage: node pack.mjs <dir with name.json and name_lod0.vtx/.idx> <name> <out.bin> <tris1> <tris2> ...
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { readFileSync, writeFileSync } from 'fs';
import { deflateSync } from 'zlib';
const [dir, name, outPath, ...lower] = process.argv.slice(2);
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const meta = JSON.parse(readFileSync(`${dir}/${name}.json`, 'utf8'));
const vtx = new Uint8Array(readFileSync(`${dir}/${name}_lod0.vtx`)), idx16 = new Uint16Array(new Uint8Array(readFileSync(`${dir}/${name}_lod0.idx`)).buffer);
const nv0 = meta.lods[0].verts, idx = new Uint32Array(idx16);
// reorder for the vertex cache (and compression)
const [remap, nv] = MeshoptEncoder.reorderMesh(idx, true, true);
const V = new Uint8Array(nv * 20);
for (let v = 0; v < nv0; v++) if (remap[v] !== 0xffffffff) V.set(vtx.subarray(v * 20, v * 20 + 20), remap[v] * 20);
const dv = new DataView(V.buffer), pos = new Float32Array(nv * 3), [lo, hi] = meta.box;
for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) pos[v * 3 + k] = lo[k] + (dv.getUint16(v * 20 + k * 2, true) / 65535) * (hi[k] - lo[k]);
const lods = [idx];
for (const t of lower.map(Number)) {
  const [s, err] = MeshoptSimplifier.simplify(idx, pos, 3, Math.floor(t) * 3, 0.05, []);
  const o = MeshoptEncoder.reorderMesh ? s : s; lods.push(s);
  console.log(name, 'simplified to', s.length / 3, 'tris (asked', t, ') error', err.toFixed(4));
}
const parts = []; let off = 0;
const ev = MeshoptEncoder.encodeVertexBuffer(V, nv, 20); meta.v = [off, ev.length]; off += ev.length; parts.push(ev);
meta.verts = nv; meta.lods = lods.map((L) => {
  const i16 = new Uint16Array(L), ei = MeshoptEncoder.encodeIndexBuffer(new Uint8Array(i16.buffer), i16.length, 2);
  const r = { tris: L.length / 3, i: [off, ei.length] }; off += ei.length; parts.push(ei); return r;
});
const js = new TextEncoder().encode(JSON.stringify(meta)), head = new Uint8Array(4); new DataView(head.buffer).setUint32(0, js.length, true);
const all = new Uint8Array(4 + js.length + off); all.set(head, 0); all.set(js, 4); let o = 4 + js.length; for (const p of parts) { all.set(p, o); o += p.length; }
const z = deflateSync(all, { level: 9 });
writeFileSync(outPath, z); console.log('wrote', outPath, nv, 'verts', meta.lods.map((l) => l.tris).join('/'), 'tris', (all.length / 1024).toFixed(0) + ' KB ->', (z.length / 1024).toFixed(0) + ' KB deflated');
