# The wolf (CR01). Model space: x to its left, y up, z forward, nose at z = 0.8; 1.08 m to the ear tips.
import numpy as np
import sheet
import carve as cv
from creatures.common import mesh, line_of, at, mirror_pairs
LODS = [32000, 18000, 8000, 3200]          # MAX, ULTRA, HIGH, LOW
NO_DEFORM = ['root', 'hackles']
def views():
    return sheet.load('CR01_wolf_turnaround', ['side', 'front', 'back', 'top'], 1.08, {'xmin': 30}, nose_z=0.8)
# the top view lays the tail out straight behind (another pose): it paints nothing behind the rump
def skip(name, X, Y, Z): return (Z < -0.4) if name == 'top' else np.zeros_like(X, bool)
def carve():
    V = views(); S, F, B, T = V['side'], V['front'], V['back'], V['top']
    # where the body stops and the legs, tail and ears begin (read off the side view with a metric grid)
    belly = lambda z: np.interp(z, [-0.47, -0.42, -0.35, -0.25, -0.18, -0.1, 0.0, 0.2, 0.45, 0.55, 0.7, 0.83], [0.6, 0.6, 0.45, 0.45, 0.5, 0.53, 0.5, 0.46, 0.47, 0.55, 0.70, 0.70])
    zdiv = lambda y: np.interp(y, [0.15, 0.3, 0.45, 0.6, 0.8], [-0.46, -0.44, -0.425, -0.41, -0.41])   # tail behind, hind legs in front
    rr, cc = np.mgrid[0:S.mask.shape[0], 0:S.mask.shape[1]]
    Ys = (S.g - rr) / S.ppm; Zs = S.zf - (cc - S.c0) / S.ppm
    head_top = np.where((Zs > 0.55) & (Zs < 0.70), 1.035, np.where((Zs > 0.5) & (Zs < 0.78), 0.99, 9))   # the ear bases are part of the head
    m_body = S.mask & (Ys >= belly(Zs)) & (Zs >= -0.47) & (Ys <= head_top)
    m_fleg = S.mask & (Ys < belly(Zs) + 0.03) & (Zs > 0.15) & (Zs < 0.48)
    m_hleg = S.mask & (Ys < belly(Zs) + 0.03) & (Zs > -0.5) & (Zs < -0.1) & (Zs > zdiv(Ys))
    m_tail = S.mask & (Zs <= zdiv(Ys)) & (Ys <= 0.76)
    m_ears = S.mask & (Ys > 0.95) & (Zs > 0.55) & (Zs < 0.68)   # the near ear (the far one is drawn ahead of it)
    cv.BLEND[0] = 0.02
    G = cv.Grid([-0.2, -0.006, -0.62], [0.2, 1.1, 0.83], 0.003)
    span = lambda rs: [(min(r[0] for r in rs), max(r[1] for r in rs))] if rs else []
    lines = {}
    # body: z slices (side column x top-view row), smoothed along z
    cv.body_z(G, lambda z: cv.side_runs_col(S, m_body, z), lambda z: cv.top_runs_row(T, T.mask, z),
                 p=lambda z: float(np.interp(z, [-0.45, -0.15, 0.1, 0.45, 0.83], [2.8, 2.8, 2.1, 2.3, 2.2])), zbox=(-0.47, 0.83), sigma_m=0.015, median_m=0.05)
    # legs: y slices (front or back view row x side row), the side held to the leg's own depth
    def legs(view, mside, sx, ytop, ext_to, name):
        A = lambda y: [r for r in cv.view_runs_row(view, view.mask, y) if sx * (r[0] + r[1]) / 2 > 0.03 and r[1] - r[0] < 0.15]
        Bz = lambda y: span(cv.view_runs_row(S, mside, y))
        lines[name] = line_of(G, cv.limb_y(G, A, Bz, ytop=ytop, ext_to=ext_to, depth_k=1.3, foot=(0.05, 0.065), grow=0.15))
    for sx in (1, -1):
        legs(F, m_fleg, sx, 0.47, 0.52, 'FL' if sx > 0 else 'FR')
        legs(B, m_hleg, sx, 0.47, 0.5, 'HL' if sx > 0 else 'HR')
    # tail: hangs straight down, seen between the hind legs from behind (lost against the haunches higher up)
    tA = lambda y: [r for r in cv.view_runs_row(B, B.mask, y) if abs((r[0] + r[1]) / 2) < 0.04 and r[1] - r[0] < 0.15]
    def tB(y):   # the rearmost solid run (not the heel beside it, not a stray hair)
        rs = [r for r in cv.view_runs_row(S, m_tail, y) if r[1] - r[0] > 0.03]
        return [min(rs, key=lambda r: r[0])] if rs else []
    lines['tail'] = line_of(G, cv.limb_y(G, tA, tB, y0=0.17, ytop=0.76, depth_k=9, min_w=0.01, tip_down=0.07))
    # ears: thin cups on the crown, seen apart from the front
    eA = lambda y: [r for r in cv.view_runs_row(F, F.mask, y) if abs((r[0] + r[1]) / 2) > 0.03]
    eB = lambda y: span(cv.view_runs_row(S, m_ears, y))
    for sx in (1, -1):
        lines['earL' if sx > 0 else 'earR'] = line_of(G, cv.limb_y(G, lambda y, sx=sx: [r for r in eA(y) if sx * (r[0] + r[1]) / 2 > 0], eB, p=1.8, y0=0.9, ytop=1.1, depth_k=1.1, ext_down=0.9, min_w=0.006, sigma_m=0.006, min_half=0.012, tip_up=0.03))
    cv.smooth(G, 1.0)
    cv.hold_inside(G, {k: v for k, v in V.items() if k != 'top'})   # the top view is drawn a little narrow: it only shapes the body
    v, f = mesh(G)
    return v, f, lines
RAW = [
    ['root', None, 0, 0, 0], ['pelvis', 'root', 0, 0.7, -0.28], ['spine', 'pelvis', 0, 0.72, 0], ['chest', 'spine', 0, 0.72, 0.28],
    ['hackles', 'spine', 0, 0.88, 0.12], ['neck', 'chest', 0, 0.8, 0.44], ['head', 'neck', 0, 0.87, 0.6], ['jaw', 'head', 0, 0.775, 0.67],
    ['earL', 'head', 0.055, 0.97, 0.6], ['earR', 'head', -0.055, 0.97, 0.6],
    ['FLu', 'chest', 0.08, 0.72, 0.3], ['FLl', 'FLu', 0.08, 0.45, 0.28], ['FLf', 'FLl', 0.073, 0.11, 0.295],
    ['FRu', 'chest', -0.08, 0.72, 0.28], ['FRl', 'FRu', -0.08, 0.45, 0.23], ['FRf', 'FRl', -0.073, 0.11, 0.245],
    ['HLu', 'pelvis', 0.1, 0.74, -0.31], ['HLl', 'HLu', 0.102, 0.44, -0.24], ['HLf', 'HLl', 0.1, 0.2, -0.43],
    ['HRu', 'pelvis', -0.1, 0.74, -0.31], ['HRl', 'HRu', -0.102, 0.44, -0.21], ['HRf', 'HRl', -0.1, 0.2, -0.39],
    ['tail1', 'pelvis', 0, 0.73, -0.36], ['tail2', 'tail1', 0, 0.6, -0.45], ['tail3', 'tail2', 0, 0.4, -0.5],
]
def bones(L):
    out = []
    for n, p, x, y, z in RAW:
        line = n[:2] if n[:2] in ('FL', 'FR', 'HL', 'HR') else ('tail' if n.startswith('tail') else (n if n in ('earL', 'earR') else None))
        if line:
            q = at(L, line, y); x, z = q[1], q[2]
            if n.startswith('ear'): y = max(y, 0.99)
        out.append({'name': n, 'parent': p, 'pos': [round(x, 4), round(y, 4), round(z, 4)]})
    B = {b['name']: b for b in out}
    for s in 'LR':
        for leg in 'FH':
            q = at(L, leg + s, 0.01); B[leg + s + 'f']['tail'] = [q[1], 0.0, q[2] + 0.03]
    B['head']['tail'] = [0, 0.82, 0.78]; B['jaw']['tail'] = [0, 0.765, 0.77]
    for e in ('earL', 'earR'): q = at(L, e, 1.09); B[e]['tail'] = [q[1], 1.09, q[2]]
    q = at(L, 'tail', 0.17); B['tail3']['tail'] = [q[1], 0.17, q[2]]
    B['neck']['tail'] = B['head']['pos']
    return mirror_pairs(out, [(a + 'L' + c, a + 'R' + c) for a in 'FH' for c in 'ulf'])
