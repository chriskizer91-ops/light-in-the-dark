# The shade leech (CR08). Model space: x to its left, y up, z forward; the mouth's rim at z = 0.96, the tail behind.
# The sheet's rulers disagree: the horizontal one (579 px/m) fits the profile, the front and the back; the top view
# is drawn at its own, squashed scale (fitted to the profile's length and the front view's width).
import numpy as np
import sheet
import carve as cv
from creatures.common import mesh, line_of, at
LODS = [24000, 14000, 6000, 2400]
NO_DEFORM = ['root']
PPM = 579.2
def views():
    V = sheet.load('CR08_leech_turnaround', ['topL', 'side', 'front', 'back'], 0.6, {'xmin': 40}, nose_z=0.96, ppm=PPM, over={'side': {'c0': 136}})
    return V
def views_():
    V = sheet.load('CR08_leech_turnaround', ['topL', 'side', 'front', 'back'], 0.6, {'xmin': 40}, nose_z=0.96, ppm=PPM, over={'side': {'c0': 136}})
    T = V['top']; T.c0 = 95; T.ppmz = (847 - 95) / 2.384; T.ppmx = 246 / 0.437   # the top view's own scales (see above)
    return V
views = views_
def skip(name, X, Y, Z): return (Z > 0.86) if name == 'side' else np.zeros_like(X, bool)   # the profile shows the open mouth: only the front view paints it
def glow(rgb):
    # the violet pustules glow on their own: a mask of the bright violet in the painted texture
    c = rgb / 255.0; r, g, b = c[..., 0], c[..., 1], c[..., 2]
    v = np.clip((b - g - 0.12) / 0.25, 0, 1) * np.clip((b - 0.3) / 0.35, 0, 1) * np.clip((b - r + 0.05) / 0.2, 0, 1)
    return v
def carve():
    V = views(); S, F, B, T = V['side'], V['front'], V['back'], V['top']
    rr, cc = np.mgrid[0:S.mask.shape[0], 0:S.mask.shape[1]]
    Ys = (S.g - rr) / S.ppm; Zs = S.zf - (cc - S.c0) / S.ppm
    # the body only: the tentacles that curl out around the mouth stay procedural (rigs.js), so does the frill
    m_body = S.mask & (Zs < 0.95) & ~((Zs > 0.82) & ((Ys < 0.09) | (Ys > 0.47)))
    cv.BLEND[0] = 0.0
    G = cv.Grid([-0.28, -0.006, -1.46], [0.28, 0.62, 0.98], 0.004)
    cv.body_z(G, lambda z: cv.side_runs_col(S, m_body, z), lambda z: cv.top_runs_row(T, T.mask, z),
              p=lambda z: float(np.interp(z, [-1.4, 0, 0.9], [2.2, 2.4, 2.6])), zbox=(-1.45, 0.96), sigma_m=0.02, median_m=0.06)
    cv.smooth(G, 1.0)
    cv.hold_inside(G, {k: v for k, v in V.items() if k != 'top'})
    v, f = mesh(G)
    return v, f, {}
N = 10
def bones(L):
    out = [{'name': 'root', 'parent': None, 'pos': [0, 0, 0]}]
    for i in range(N): out.append({'name': 's%d' % i, 'parent': 'root', 'pos': [0, round(0.28 - i * 0.01, 4), round(0.75 - i * 0.235, 4)]})
    out[-1]['tail'] = [0, 0.16, -1.42]
    out.append({'name': 'mouth', 'parent': 's0', 'pos': [0, 0.29, 0.93], 'tail': [0, 0.29, 0.97]})
    import math
    for k in range(6):
        a = k / 6 * 2 * math.pi + 0.3; x, y = math.cos(a) * 0.12, 0.29 + math.sin(a) * 0.1
        out.append({'name': 't%da' % k, 'parent': 's0', 'pos': [round(x, 4), round(y, 4), 0.93]})
        out.append({'name': 't%db' % k, 'parent': 't%da' % k, 'pos': [round(x * 1.5, 4), round(y + math.sin(a) * 0.03, 4), 1.07]})
    return out
NO_DEFORM = ['root', 'mouth'] + ['t%d%s' % (k, s) for k in range(6) for s in 'ab']
