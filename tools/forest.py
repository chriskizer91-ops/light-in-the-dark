# The Field & Forest pack (Christopher's, from the Forest Builder): its temperate trees, bushes and grass,
# repacked for the game. One file: deflate([u32 json length][json][buffers]) with, per model, a vertex
# buffer (12 bytes: position u16x3 in the model's box, normal oct i8x2, colour sRGB u8x3, pad) and a u16
# index buffer whose triangles are grouped by material: 'solid' (bark, single-sided) then 'leaf' (two-sided).
# usage: python3 tools/forest.py <models dir> <out.bin>
import sys, os, json, struct, zlib, numpy as np
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
KEEP = ['trees/tree_spruce', 'trees/tree_ponderosa', 'trees/tree_aspen', 'trees/tree_oak', 'trees/tree_snag', 'trees/tree_willow', 'trees/tree_cottonwood',
        'bushes/bush_oleander', 'bushes/bush_sage', 'grass/grass_meadow', 'grass/grass_dry', 'grass/grass_reeds']
def load(p):
    d = open(p, 'rb').read(); l = struct.unpack('<I', d[12:16])[0]; j = json.loads(d[20:20 + l]); bo = 20 + l; bl = struct.unpack('<I', d[bo:bo + 4])[0]; B = d[bo + 8:bo + 8 + bl]
    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = np.dtype(CT[a['componentType']])
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride', 0) or n * dt.itemsize
        raw = np.frombuffer(B, np.uint8, count=st * (a['count'] - 1) + n * dt.itemsize, offset=off)
        arr = np.lib.stride_tricks.as_strided(raw, (a['count'], n * dt.itemsize), (st, 1)).copy().view(dt).reshape(a['count'], n)
        if a.get('normalized'): arr = arr.astype(np.float32) / np.iinfo(dt).max
        return arr.astype(np.float32) if dt.kind == 'f' else arr
    return j, acc
def oct_enc(n):
    n = n / np.maximum(1e-9, np.abs(n).sum(1, keepdims=True)); x, y, z = n[:, 0], n[:, 1], n[:, 2]
    ox = np.where(z >= 0, x, (1 - np.abs(y)) * np.sign(x + 1e-12)); oy = np.where(z >= 0, y, (1 - np.abs(x)) * np.sign(y + 1e-12))
    return np.clip(np.round(np.stack([ox, oy], 1) * 127), -127, 127).astype(np.int8)
def to_srgb(c): c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
def pack(path):
    j, acc = load(path); prims = []
    for me in j['meshes']:
        for pr in me['primitives']:
            m = j['materials'][pr.get('material', 0)]; kind = 'leaf' if m.get('doubleSided') else 'solid'
            P = acc(pr['attributes']['POSITION']); N = acc(pr['attributes']['NORMAL']); C = acc(pr['attributes']['COLOR_0'])[:, :3]
            I = acc(pr['indices']).ravel().astype(np.int64)
            prims.append((kind, P, N, C, I))
    prims.sort(key=lambda p: p[0] != 'solid')
    P = np.concatenate([p[1] for p in prims]); lo, hi = P.min(0) - 1e-4, P.max(0) + 1e-4
    vb, ib, groups, base, start = [], [], [], 0, 0
    for kind, Pp, Np, Cp, Ip in prims:
        buf = np.zeros(len(Pp), dtype=[('p', '<u2', 3), ('n', 'i1', 2), ('c', 'u1', 3), ('x', 'u1', 1)])
        buf['p'] = np.round((Pp - lo) / (hi - lo) * 65535); buf['n'] = oct_enc(Np); buf['c'] = np.round(to_srgb(Cp) * 255)
        vb.append(buf); ib.append(Ip + base); base += len(Pp)
        if groups and groups[-1]['kind'] == kind: groups[-1]['count'] += len(Ip)
        else: groups.append({'kind': kind, 'start': start, 'count': len(Ip)})
        start += len(Ip)
    assert base < 65536
    return np.concatenate(vb).tobytes(), np.concatenate(ib).astype(np.uint16).tobytes(), {'box': [lo.round(5).tolist(), hi.round(5).tolist()], 'verts': base, 'tris': start // 3, 'groups': groups}
if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]; meta = {}; blobs = []; off = 0
    for k in KEEP:
        for lod in ('', '_far'):
            v, i, m = pack(os.path.join(src, k + lod + '.glb')); name = k.split('/')[1] + lod
            m['v'] = [off, len(v)]; off += len(v); m['i'] = [off, len(i)]; off += len(i); blobs += [v, i]; meta[name] = m
            print('%-24s %6d verts %6d tris %s' % (name, m['verts'], m['tris'], ' '.join('%s:%d' % (g['kind'], g['count'] // 3) for g in m['groups'])))
    js = json.dumps(meta, separators=(',', ':')).encode()
    raw = struct.pack('<I', len(js)) + js + b''.join(blobs); z = zlib.compress(raw, 9)
    open(out, 'wb').write(z); print('wrote', out, len(raw) // 1024, 'KB ->', len(z) // 1024, 'KB deflated')
