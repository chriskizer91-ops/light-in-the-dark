# shared helpers for the creature carve scripts
import numpy as np
from skimage import measure
import scipy.sparse as sp, scipy.sparse.csgraph as cg
def mesh(G, keep_min=2000):
    """marching cubes on the field, keeping every piece bigger than keep_min vertices"""
    f = np.pad(G.f, 1, constant_values=-0.05)
    verts, faces, _, _ = measure.marching_cubes(f, 0.0, spacing=(G.res,) * 3)
    verts = verts - G.res + G.lo; faces = faces[:, [0, 2, 1]]
    n = len(verts); A = sp.coo_matrix((np.ones(len(faces) * 3), (np.repeat(faces[:, 0], 3), faces.ravel())), shape=(n, n))
    nc, lab = cg.connected_components(A, directed=False); cnt = np.bincount(lab)
    keep = np.isin(lab, np.nonzero(cnt > keep_min)[0])
    remap = -np.ones(n, int); remap[keep] = np.arange(keep.sum()); fk = faces[keep[faces[:, 0]]]
    return verts[keep], remap[fk]
def line_of(G, P):
    ok = ~np.isnan(P[:, 0])
    return [[round(float(y), 4), round(float(c[0]), 4), round(float(c[2]), 4)] for y, c in zip(G.ax[1][ok], P[ok])]
def at(lines, line, y):
    return min(lines[line], key=lambda p: abs(p[0] - y))
def mirror_pairs(bones, pairs):
    """make left/right bones mirror images (x averaged) — the carved body is symmetric"""
    B = {b['name']: b for b in bones}
    for l, r in pairs:
        L, R = B[l], B[r]
        x = (abs(L['pos'][0]) + abs(R['pos'][0])) / 2; L['pos'][0] = round(x, 4); R['pos'][0] = round(-x, 4)
        if 'tail' in L and 'tail' in R:
            tx = (abs(L['tail'][0]) + abs(R['tail'][0])) / 2; L['tail'][0] = round(tx, 4); R['tail'][0] = round(-tx, 4)
    return bones
