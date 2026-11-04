# Paint a rebaked layout from the rig's own projection atlas, as the game's shader would sample it (the
# interpolated uvF / uvS / uvT, blended by uvW), but with a depth test per view: a spot a view cannot see
# (the side of the chest behind the arm, the thigh behind the shield) takes the views that can.
# usage: python3 paint_rebake.py <dir> <atlas.webp> <out.png> [glow atlas] [glow out]
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage as ndi
sys.path.insert(0, os.path.dirname(__file__)); sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from atlas import bleed
def zbuf(P, T, d, res=0.0025):
    """orthographic depth along direction d over a model-space grid: largest p.d per cell"""
    d = np.array(d, float); a = np.array([0, 1, 0]) if abs(d[1]) < 0.9 else np.array([1, 0, 0])
    u = np.cross(a, d); u /= np.linalg.norm(u); v = np.cross(d, u)
    U, Vv, S = P @ u, P @ v, P @ d; lo = np.array([U.min(), Vv.min()]) - res * 2
    W_, H_ = int((U.max() - lo[0]) / res) + 4, int((Vv.max() - lo[1]) / res) + 4; zb = np.full((H_, W_), -1e9, np.float32)
    c, r = (U - lo[0]) / res, (Vv - lo[1]) / res
    for t in T:
        cs, rs, ss = c[t], r[t], S[t]
        x0, x1, y0, y1 = int(cs.min()), int(np.ceil(cs.max())), int(rs.min()), int(np.ceil(rs.max()))
        X, Y = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        (ax, bx, cx), (ay, by, cy) = cs, rs; den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12: continue
        l1 = ((by - cy) * (X - cx) + (cx - bx) * (Y - cy)) / den; l2 = ((cy - ay) * (X - cx) + (ax - cx) * (Y - cy)) / den; l3 = 1 - l1 - l2
        ins = (l1 >= -0.05) & (l2 >= -0.05) & (l3 >= -0.05)
        if not ins.any(): continue
        sub = zb[y0:y1 + 1, x0:x1 + 1]; np.maximum(sub, np.where(ins, l1 * ss[0] + l2 * ss[1] + l3 * ss[2], -1e9), out=sub)
    zb = ndi.grey_dilation(zb, size=(3, 3))
    def test(X3, tol=0.012):
        cc = np.clip(((X3 @ u) - lo[0]) / res, 0, W_ - 1).astype(int); rr = np.clip(((X3 @ v) - lo[1]) / res, 0, H_ - 1).astype(int)
        return (X3 @ d) >= zb[rr, cc] - tol
    return test
def sample(img, uv):
    H, W = img.shape[:2]; c = uv[..., 0] * W - 0.5; r = (1 - uv[..., 1]) * H - 0.5
    return np.stack([ndi.map_coordinates(img[..., k], [r, c], order=1, mode='nearest') for k in range(img.shape[2])], -1)
def paint(d, atlas_path, out_png, glow_path=None, glow_out=None, size=1024, ao_k=0.4):
    B = np.load(os.path.join(d, 'bake.npz')); L = np.load(os.path.join(d, 'lod0.npz'))
    pos, nrm, cov, ao = B['pos'], B['nrm'], B['cov'], B['ao']; R = pos.shape[0]
    n = nrm / np.maximum(1e-6, np.linalg.norm(nrm, axis=2, keepdims=True))
    T = L['loops'][:, 0].astype(int).reshape(-1, 3); Pm = L['P'].astype(np.float64)
    tests = {k: zbuf(Pm, T, dv) for k, dv in {'+z': (0, 0, 1), '-z': (0, 0, -1), '+x': (1, 0, 0), '-x': (-1, 0, 0), '+y': (0, 1, 0)}.items()}
    X3 = pos.reshape(-1, 3).astype(np.float64); nn = n.reshape(-1, 3)
    visF = np.where(nn[:, 2] >= 0, tests['+z'](X3), tests['-z'](X3)); visS = np.where(nn[:, 0] >= 0, tests['+x'](X3), tests['-x'](X3)); visT = tests['+y'](X3)
    vis = np.stack([visF, visS, visT], 1).reshape(R, R, 3).astype(np.float32)
    W = np.clip(B['uvW'], 0, None); W0 = W / np.maximum(1e-6, W.sum(2, keepdims=True)); Wv = W0 * vis
    ok = Wv.sum(2) > 0.25   # enough of what it is painted with can see it; else as the game did
    Wf = np.where(ok[..., None], Wv / np.maximum(1e-6, Wv.sum(2, keepdims=True)), W0)
    print('  texels repainted by the depth test: %.1f%%  (no view sees: %.1f%%)' % (100 * ((np.abs(Wf - W0).sum(2) > 0.05) & cov).sum() / cov.sum(), 100 * (~ok & cov).sum() / cov.sum()))
    def blend(img):
        return sample(img, B['uvF'][..., :2]) * Wf[..., :1] + sample(img, B['uvS'][..., :2]) * Wf[..., 1:2] + sample(img, B['uvT'][..., :2]) * Wf[..., 2:3]
    A = np.asarray(Image.open(atlas_path).convert('RGB')).astype(np.float32)
    col = blend(A) * (1 - ao_k + ao_k * np.clip(ao, 0, 1))[..., None]
    col = bleed(np.clip(col, 0, 255), cov)
    Image.fromarray(col.astype(np.uint8)).resize((size, size), Image.LANCZOS).save(out_png)
    if glow_path:
        Gm = np.asarray(Image.open(glow_path).convert('L')).astype(np.float32)[..., None]
        g = blend(Gm)[..., 0]; g = bleed(np.repeat(g[..., None], 3, 2), cov)[..., 0]
        Image.fromarray(np.clip(g, 0, 255).astype(np.uint8)).resize((size, size), Image.LANCZOS).save(glow_out)
if __name__ == '__main__':
    a = sys.argv[1:]; paint(a[0], a[1], a[2], a[3] if len(a) > 3 else None, a[4] if len(a) > 4 else None)
