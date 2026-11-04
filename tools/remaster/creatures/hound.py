# The gloom hound (CR32). Model space: x to its left, y up, z forward, nose at z = 0.8. The sheet's profile faces right.
import numpy as np
import sheet
import carve as cv
from creatures.common import mesh, line_of, at, mirror_pairs
LODS = [32000, 18000, 8000, 3200]
NO_DEFORM = ['root', 'hackles']
def views():
    return sheet.load('CR32_hound_turnaround', ['sideFlip', 'front', 'back', 'top'], 1.25, {'xmin': 80}, nose_z=0.8, ppm=528.7)
def skip(name, X, Y, Z): return (Z < -0.42) if name == 'top' else np.zeros_like(X, bool)   # the top view lays the tail out straight
def carve():
    V = views(); S, F, B, T = V['sideFlip'], V['front'], V['back'], V['top']
    # where the body stops (read off the profile with a metric grid)
    belly = lambda z: np.interp(z, [-0.47, -0.42, -0.4, -0.3, -0.2, -0.15, -0.1, 0.05, 0.2, 0.4, 0.45, 0.55, 0.62, 0.83], [0.8, 0.78, 0.64, 0.62, 0.7, 0.8, 0.8, 0.73, 0.66, 0.68, 0.75, 0.95, 1.03, 1.03])
    zdiv = lambda y: np.interp(y, [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], [-0.56, -0.46, -0.39, -0.35, -0.33, -0.33, -0.33])   # the tail behind, the hind legs in front
    rr, cc = np.mgrid[0:S.mask.shape[0], 0:S.mask.shape[1]]
    Ys = (S.g - rr) / S.ppm; Zs = S.zb + (cc - S.c0) / S.ppm
    head_top = np.where((Zs > 0.44) & (Zs < 0.58), 1.205, 9)          # the ears stand above it
    m_body = S.mask & (Ys >= belly(Zs)) & (Zs >= -0.46) & (Ys <= head_top) & ~((Zs < -0.38) & (Ys < 0.84))
    m_fleg = S.mask & (Ys < belly(Zs) + 0.03) & (Zs > 0.25) & (Zs < 0.6)
    m_hleg = S.mask & (Ys < belly(Zs) + 0.03) & (Zs > -0.6) & (Zs < -0.1) & (Zs > zdiv(Ys))
    m_tail = S.mask & (Zs <= zdiv(Ys)) & (Ys <= 0.88) & (Ys >= 0.28)
    m_ears = S.mask & (Ys > 1.17) & (Zs > 0.44) & (Zs < 0.57)
    cv.BLEND[0] = 0.018
    G = cv.Grid([-0.2, -0.006, -0.72], [0.2, 1.3, 0.83], 0.003)
    span = lambda rs: [(min(r[0] for r in rs), max(r[1] for r in rs))] if rs else []
    lines = {}
    cv.body_z(G, lambda z: cv.side_runs_col(S, m_body, z), lambda z: cv.top_runs_row(T, T.mask, z),
              p=lambda z: float(np.interp(z, [-0.45, -0.3, -0.15, 0.1, 0.4, 0.83], [3.0, 3.2, 2.6, 2.0, 2.2, 2.2])), zbox=(-0.46, 0.83), sigma_m=0.012, median_m=0.04,
              widen=[(-0.46, -0.1, B, 0.62, 0.9), (0.1, 0.45, F, 0.66, 0.95)])
    def legs(view, mside, sx, ytop, ext_to, name, track):
        A = lambda y: [r for r in cv.view_runs_row(view, view.mask, y) if sx * (r[0] + r[1]) / 2 > 0.03 and r[1] - r[0] < 0.13]
        Bz = (lambda y: cv.view_runs_row(S, mside, y)) if track else (lambda y: span(cv.view_runs_row(S, mside, y)))
        lines[name] = line_of(G, cv.limb_y(G, A, Bz, ytop=ytop, ext_to=ext_to, depth_k=1.35, foot=(0.045, 0.07), grow=0.0, track=track, cap=0.05))
    for sx in (1, -1):
        legs(F, m_fleg, sx, 0.64, 0.69, 'FL' if sx > 0 else 'FR', False)
        legs(B, m_hleg, sx, 0.61, 0.72, 'HL' if sx > 0 else 'HR', True)   # the near and far hind legs are drawn a stride apart
    # the whip of a tail, down and back to its tip, seen hanging between the hind legs from behind
    tA = lambda y: [r for r in cv.view_runs_row(B, B.mask, y) if abs((r[0] + r[1]) / 2) < 0.04 and r[1] - r[0] < 0.1]
    def tB(y):
        rs = [r for r in cv.view_runs_row(S, m_tail, y) if r[1] - r[0] > 0.012]
        return [min(rs, key=lambda r: r[0])] if rs else []
    lines['tail'] = line_of(G, cv.limb_y(G, tA, tB, y0=0.3, ytop=0.88, depth_k=1.6, min_w=0.008, tip_down=0.03, min_half=0.012))
    eA = lambda y: [r for r in cv.view_runs_row(F, F.mask, y) if abs((r[0] + r[1]) / 2) > 0.025]
    eB = lambda y: span(cv.view_runs_row(S, m_ears, y))
    for sx in (1, -1):
        lines['earL' if sx > 0 else 'earR'] = line_of(G, cv.limb_y(G, lambda y, sx=sx: [r for r in eA(y) if sx * (r[0] + r[1]) / 2 > 0], eB, p=1.8, y0=1.12, ytop=1.3, depth_k=1.0, ext_down=1.12, min_w=0.006, sigma_m=0.005, min_half=0.01, tip_up=0.02))
    cv.smooth(G, 1.0)
    cv.hold_inside(G, {k: v for k, v in V.items() if k != 'top'})
    v, f = mesh(G)
    return v, f, lines
RAW = [
    ['root', None, 0, 0, 0], ['pelvis', 'root', 0, 0.88, -0.26], ['spine', 'pelvis', 0, 0.92, 0], ['chest', 'spine', 0, 0.9, 0.25],
    ['hackles', 'spine', 0, 1.0, 0], ['neck', 'chest', 0, 0.98, 0.4], ['head', 'neck', 0, 1.16, 0.53], ['jaw', 'head', 0, 1.12, 0.6],
    ['earL', 'head', 0.05, 1.22, 0.5], ['earR', 'head', -0.05, 1.22, 0.5],
    ['FLu', 'chest', 0.085, 0.85, 0.3], ['FLl', 'FLu', 0.085, 0.58, 0.31], ['FLf', 'FLl', 0.085, 0.18, 0.34],
    ['FRu', 'chest', -0.085, 0.85, 0.3], ['FRl', 'FRu', -0.085, 0.58, 0.31], ['FRf', 'FRl', -0.085, 0.18, 0.34],
    ['HLu', 'pelvis', 0.09, 0.84, -0.27], ['HLl', 'HLu', 0.095, 0.56, -0.2], ['HLf', 'HLl', 0.095, 0.32, -0.42],
    ['HRu', 'pelvis', -0.09, 0.84, -0.27], ['HRl', 'HRu', -0.095, 0.56, -0.2], ['HRf', 'HRl', -0.095, 0.32, -0.42],
    ['tail1', 'pelvis', 0, 0.85, -0.36], ['tail2', 'tail1', 0, 0.6, -0.45], ['tail3', 'tail2', 0, 0.43, -0.54],
]
def bones(L):
    out = []
    for n, p, x, y, z in RAW:
        line = n[:2] if n[:2] in ('FL', 'FR', 'HL', 'HR') else ('tail' if n.startswith('tail') else (n if n in ('earL', 'earR') else None))
        if line:
            q = at(L, line, y); x, z = q[1], q[2]
        out.append({'name': n, 'parent': p, 'pos': [round(x, 4), round(y, 4), round(z, 4)]})
    B = {b['name']: b for b in out}
    for s in 'LR':
        for leg in 'FH':
            q = at(L, leg + s, 0.01); B[leg + s + 'f']['tail'] = [q[1], 0.0, q[2] + 0.04]
    B['head']['tail'] = [0, 1.13, 0.78]; B['jaw']['tail'] = [0, 1.08, 0.76]
    for e in ('earL', 'earR'): q = at(L, e, 1.27); B[e]['tail'] = [q[1], 1.27, q[2]]
    q = at(L, 'tail', 0.31); B['tail3']['tail'] = [q[1], 0.31, q[2]]
    B['neck']['tail'] = B['head']['pos']
    return mirror_pairs(out, [(a + 'L' + c, a + 'R' + c) for a in 'FH' for c in 'ulf'])
