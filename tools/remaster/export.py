# Baked LODs (npz from bl_process.py) -> interleaved, quantized vertex buffers for pack.mjs.
# Per vertex, 20 bytes: position u16x3 (in the creature's box), normal oct i8x2, uv u16x2, bones u8x4, weights u8x4.
import sys, os, json, numpy as np
def oct_enc(n):
    n = n / np.maximum(1e-9, np.abs(n).sum(1, keepdims=True)); x, y, z = n[:, 0], n[:, 1], n[:, 2]
    ox = np.where(z >= 0, x, (1 - np.abs(y)) * np.sign(x + 1e-12)); oy = np.where(z >= 0, y, (1 - np.abs(x)) * np.sign(y + 1e-12))
    return np.clip(np.round(np.stack([ox, oy], 1) * 127), -127, 127).astype(np.int8)
def export(src, dst, name, lods=3):
    meta = json.load(open(os.path.join(src, 'meta.json')))
    L = [np.load(os.path.join(src, 'lod%d.npz' % i)) for i in range(lods)]
    lo = np.min([l['P'].min(0) for l in L], 0) - 1e-4; hi = np.max([l['P'].max(0) for l in L], 0) + 1e-4
    out = {'name': name, 'box': [lo.tolist(), hi.tolist()], 'bones': meta['bones'], 'lods': []}
    os.makedirs(dst, exist_ok=True)
    for i, l in enumerate(L):
        P, N, W, loops = l['P'], l['N'], l['W'], l['loops']
        vi = loops[:, 0].astype(np.int64); uv = np.clip(np.round(loops[:, 1:3] * 65535), 0, 65535).astype(np.int64)
        key = vi * (1 << 34) + uv[:, 0] * (1 << 17) + uv[:, 1]
        uk, first, inv = np.unique(key, return_index=True, return_inverse=True)
        v = vi[first]; nv = len(uk)
        assert nv < 65536, 'too many vertices for 16-bit indices'
        q = (np.round((P[v] - lo) / (hi - lo) * 4095).astype(np.uint16) << 4)   # 12 bits in the box (0.4 mm on a wolf): compresses far better
        o = oct_enc(N[v])
        u = ((np.round(uv[first] / 65535 * 4095).astype(np.int64) << 4) | 8).astype(np.uint16)   # 12 bits: a texel of a 4K map
        ww = W[v]; top = np.argsort(-ww, 1)[:, :4]; tw = np.take_along_axis(ww, top, 1)
        tw = tw / np.maximum(1e-9, tw.sum(1, keepdims=True)); b = (np.round(tw * 51) * 5).astype(np.int32)   # weights in steps of 1/51
        b[:, 0] += 255 - b.sum(1)   # the weights sum to exactly 255
        top[tw == 0] = 0
        buf = np.zeros(nv, dtype=[('p', '<u2', 3), ('n', 'i1', 2), ('uv', '<u2', 2), ('j', 'u1', 4), ('w', 'u1', 4)])
        buf['p'] = q; buf['n'] = o; buf['uv'] = u; buf['j'] = top.astype(np.uint8); buf['w'] = b.astype(np.uint8)
        idx = inv.astype(np.uint16)
        buf.tofile(os.path.join(dst, '%s_lod%d.vtx' % (name, i))); idx.tofile(os.path.join(dst, '%s_lod%d.idx' % (name, i)))
        out['lods'].append({'verts': int(nv), 'tris': int(len(idx) // 3)})
        print(name, 'lod%d' % i, nv, 'verts', len(idx) // 3, 'tris')
    json.dump(out, open(os.path.join(dst, name + '.json'), 'w'))
if __name__ == '__main__':
    export(sys.argv[1], sys.argv[2], sys.argv[3])
