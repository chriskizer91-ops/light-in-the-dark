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

import carve as cv
def humanoid(G, V, side, crotch, top, torso_half, shoulder, arm_bottom, arm_z, leg_max=0.3, arm_max=0.4, p_torso=2.3, base=None,
             leg_depth=1.4, arm_depth=1.15, arm_win=0.16, torso_bottom=None, skip_arms=(), arm_track=None, lines=None, torso_win=None, torso_tip=0.06):
    """A standing figure in horizontal slices: the torso and head from the front view's middle run and the profile;
    each leg from its own run in the front view, held to its depth in profile; each arm from the runs outside
    torso_half, held to a window about arm_z(y) in profile (the arm hangs over the body there), carried up into the
    shoulder where the front view loses it against the body. base: (y_top, width) of a spread foot or plinth."""
    F, S = V['front'], V[side]; B = V.get('back')
    lines = {} if lines is None else lines
    span = lambda rs: [(min(r[0] for r in rs), max(r[1] for r in rs))] if rs else []
    tb = crotch - 0.08 if torso_bottom is None else torso_bottom
    # torso, neck and head
    def Bt(y):   # the profile's span, held to a window about the body's line (torso_win(y) -> (z0, z1)) when given
        rs = span(cv.view_runs_row(S, S.mask, y))
        if not rs or not torso_win: return rs
        z0, z1 = torso_win(y); a, b = max(rs[0][0], z0), min(rs[0][1], z1)
        return [(a, b)] if b > a else []
    lines['torso'] = line_of(G, cv.limb_y(G, lambda y: [r for r in cv.view_runs_row(F, F.mask, y) if abs((r[0] + r[1]) / 2) < torso_half],
                                          Bt, p=p_torso, y0=tb, ytop=top, depth_k=99, min_w=0.02, sigma_m=0.012, median_m=0.04, cap=0.0, tip_down=torso_tip))
    for sx, nm in ((1, 'L'), (-1, 'R')):
        A = lambda y, sx=sx: [r for r in cv.view_runs_row(F, F.mask, y) if sx * (r[0] + r[1]) / 2 > 0.03 and r[1] - r[0] < leg_max]
        lines['leg' + nm] = line_of(G, cv.limb_y(G, A, lambda y: span(cv.view_runs_row(S, S.mask, y)), y0=-0.01, ytop=crotch, ext_to=crotch + 0.1, depth_k=leg_depth, min_w=0.03, grow=0.1, cap=0.06))
        if nm in skip_arms: continue
        Aa = lambda y, sx=sx: [r for r in cv.view_runs_row(F, F.mask, y) if sx * (r[0] + r[1]) / 2 > torso_half and r[1] - r[0] < arm_max]
        def Ba(y):
            rs = span(cv.view_runs_row(S, S.mask, y))
            if not rs: return []
            zc = arm_z(y); a, b = max(rs[0][0], zc - arm_win), min(rs[0][1], zc + arm_win)
            return [(a, b)] if b > a else []
        lines['arm' + nm] = line_of(G, cv.limb_y(G, Aa, Ba, y0=arm_bottom, ytop=shoulder, ext_to=shoulder + 0.06, depth_k=arm_depth, min_w=0.04, grow=0.15, cap=0.08))
    if base:   # the spread of wax (or a robe's hem) at the feet: the front view's full run, the profile's span
        yb, wmax = base
        cv.limb_y(G, lambda y: [r for r in cv.view_runs_row(F, F.mask, y) if r[0] < 0 < r[1] or abs((r[0] + r[1]) / 2) < wmax], lambda y: span(cv.view_runs_row(S, S.mask, y)), p=2.2, y0=-0.01, ytop=yb, depth_k=99, min_w=0.05, cap=0.05, ext_to=yb)
    return lines
