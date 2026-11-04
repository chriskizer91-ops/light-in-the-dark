# Paint a baked UV layout from the reference sheet: every texel takes the colour of the views that can
# actually see it (a depth test against each view, so the inside of a leg is not painted with the outside),
# blended by how squarely it faces each one. Then ambient occlusion, and colour bled past the UV islands.
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage as ndi
sys.path.insert(0, os.path.dirname(__file__)); sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from atlas import bleed
DIRS = {'front': (0, 0, 1), 'back': (0, 0, -1), 'side': (1, 0, 0), 'sideR': (-1, 0, 0), 'sideFlip': (-1, 0, 0), 'sideFlipR': (1, 0, 0), 'top': (0, 1, 0)}

def zbuffer(view, d, P, T):
    """Largest p.d per pixel of the view over the triangles (P vertices, T index triples)."""
    H, W = view.mask.shape; zb = np.full((H, W), -1e9, np.float32)
    c, r = view.px(P[:, 0], P[:, 1], P[:, 2]); s = P @ np.array(d, float)
    for t in T:
        cs, rs, ss = c[t], r[t], s[t]
        x0, x1 = int(np.floor(cs.min())), int(np.ceil(cs.max())); y0, y1 = int(np.floor(rs.min())), int(np.ceil(rs.max()))
        x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, W - 1), min(y1, H - 1)
        if x1 < x0 or y1 < y0: continue
        X, Y = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        (ax, bx, cx), (ay, by, cy) = cs, rs
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-9: continue
        l1 = ((by - cy) * (X - cx) + (cx - bx) * (Y - cy)) / den; l2 = ((cy - ay) * (X - cx) + (ax - cx) * (Y - cy)) / den; l3 = 1 - l1 - l2
        ins = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
        if not ins.any(): continue
        z = l1 * ss[0] + l2 * ss[1] + l3 * ss[2]
        sub = zb[y0:y1 + 1, x0:x1 + 1]; np.maximum(sub, np.where(ins, z, -1e9), out=sub)
    return ndi.grey_dilation(zb, size=(3, 3))   # close pinholes

def paint(views, bake, mesh, out_png, size=1024, power=3.0, tol=0.012, skip=None, ao_k=0.42, use=None):
    """views: {name: View}; bake: npz of pos/nrm/ao/cov; mesh: (P, T) for the depth test.
    skip(name, X, Y, Z) -> bool mask of texels a view must not paint (a view drawn in another pose)."""
    pos, nrm, ao, cov = bake['pos'], bake['nrm'], bake['ao'], bake['cov']
    R = pos.shape[0]; X, Y, Z = pos[..., 0], pos[..., 1], pos[..., 2]
    n = nrm / np.maximum(1e-6, np.linalg.norm(nrm, axis=2, keepdims=True))
    acc = np.zeros((R, R, 3), np.float32); wsum = np.zeros((R, R), np.float32)
    acc0 = np.zeros((R, R, 3), np.float32); wsum0 = np.zeros((R, R), np.float32)   # without the depth test (fallback)
    P, T = mesh
    jobs = []
    for name, v in views.items():
        if use and name not in use: continue
        if v.kind in ('side', 'sideFlip'): jobs += [(name, v, DIRS[v.kind]), (name, v, DIRS[v.kind + 'R'])]
        else: jobs.append((name, v, DIRS[v.kind]))
    for name, v, d in jobs:
        rgb = bleed(v.rgb.astype(np.float32), v.mask)
        zb = zbuffer(v, d, P, T)
        c, r = v.px(X, Y, Z); s = X * d[0] + Y * d[1] + Z * d[2]
        ci, ri = np.clip(np.round(c).astype(int), 0, zb.shape[1] - 1), np.clip(np.round(r).astype(int), 0, zb.shape[0] - 1)
        vis = s >= zb[ri, ci] - tol
        facing = np.clip(n[..., 0] * d[0] + n[..., 1] * d[1] + n[..., 2] * d[2], 0, 1)
        w = facing ** power
        if skip is not None: w = np.where(skip(name, X, Y, Z), 0, w)
        col = np.stack([ndi.map_coordinates(rgb[..., k], [r, c], order=1, mode='nearest') for k in range(3)], -1)
        acc += col * (w * vis)[..., None]; wsum += w * vis
        acc0 += col * w[..., None]; wsum0 += w
        print('  view', name, d, 'visible texels %.0f%%' % (100 * (vis & cov & (w > 0.01)).sum() / max(1, (cov & (w > 0.01)).sum())))
    out = np.where((wsum > 0.04)[..., None], acc / np.maximum(wsum, 1e-6)[..., None], acc0 / np.maximum(wsum0, 1e-6)[..., None])
    hidden = cov & (wsum <= 0.04); print('  texels no view can see: %.1f%%' % (100 * hidden.sum() / cov.sum()))
    out *= (1 - ao_k + ao_k * np.clip(ao, 0, 1))[..., None]
    out = bleed(np.clip(out, 0, 255), cov)
    im = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)
    im.save(out_png); return im
