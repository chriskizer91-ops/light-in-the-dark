# The wax sentinel (CR26): a 2.2 m giant of melted wax, candles on its crown and shoulders. Model space: x to its
# left, y up, z forward; the feet at z ~ 0. Views: front, side (left profile, facing left), back, three-quarter.
import numpy as np
import sheet
import carve as cv
from creatures.common import mesh, line_of, at, mirror_pairs, humanoid
LODS = [36000, 20000, 9000, 3600]
NO_DEFORM = ['root']
def views():
    return sheet.load('CR26_sentinel_turnaround', ['front', 'side', 'back', 'tq'], 2.47, {'xmin': 40}, nose_z=0.4, ppm=323.0)
AO = 0.35
def glow(rgb):   # the molten seams: hot orange
    c = rgb / 255.0; r, g, b = c[..., 0], c[..., 1], c[..., 2]
    return np.clip((r - b - 0.35) / 0.25, 0, 1) * np.clip((r - 0.6) / 0.25, 0, 1) * np.clip((r - g - 0.15) / 0.2, 0, 1)
def skip(name, X, Y, Z): return np.zeros_like(X, bool)
ARM_Z = lambda y: float(np.interp(y, [0.7, 1.02, 1.41, 1.84, 2.0], [0.25, 0.2, 0.08, -0.02, -0.03]))
def carve():
    V = views(); cv.BLEND[0] = 0.03
    G = cv.Grid([-0.66, -0.006, -0.55], [0.66, 2.24, 0.45], 0.005)
    lines = humanoid(G, V, 'side', crotch=1.02, top=2.2, torso_half=0.32, shoulder=1.92, arm_bottom=0.62, arm_z=ARM_Z,
                     leg_max=0.36, arm_max=0.36, p_torso=2.0, base=(0.16, 0.7), leg_depth=1.25, arm_depth=1.2, arm_win=0.2,
                     torso_win=lambda y: (-0.3, 0.3) if y < 1.95 else (-0.12, 0.3), torso_tip=0.1)
    cv.smooth(G, 1.0)
    cv.hold_inside(G, V)
    v, f = mesh(G, keep_min=3000)
    return v, f, lines
RAW = [['root', None, 0, 0, 0], ['hips', 'root', 0, 1.02, -0.03], ['spine', 'hips', 0, 1.32, -0.01], ['chest', 'spine', 0, 1.62, 0], ['neck', 'chest', 0, 1.95, 0.02], ['head', 'neck', 0, 2.06, 0.1],
    ['shL', 'chest', 0.37, 1.84, -0.02], ['elL', 'shL', 0.46, 1.41, 0.06], ['hdL', 'elL', 0.5, 1.02, 0.16],
    ['shR', 'chest', -0.37, 1.84, -0.02], ['elR', 'shR', -0.46, 1.41, 0.06], ['hdR', 'elR', -0.5, 1.02, 0.16],
    ['thL', 'hips', 0.2, 1.0, -0.04], ['knL', 'thL', 0.235, 0.58, -0.07], ['ftL', 'knL', 0.26, 0.16, -0.08],
    ['thR', 'hips', -0.2, 1.0, -0.04], ['knR', 'thR', -0.235, 0.58, -0.07], ['ftR', 'knR', -0.26, 0.16, -0.08]]
def bones(L):
    out = []
    for n, p, x, y, z in RAW:
        side = 'L' if n.endswith('L') else 'R' if n.endswith('R') else None
        if side and n[:2] in ('el', 'hd'): q = at(L, 'arm' + side, y); x, z = q[1], q[2]
        if side and n[:2] in ('th', 'kn', 'ft') and y < 0.95: q = at(L, 'leg' + side, y); x, z = q[1], q[2]
        out.append({'name': n, 'parent': p, 'pos': [round(x, 4), round(y, 4), round(z, 4)]})
    B = {b['name']: b for b in out}
    for s in 'LR':
        q = at(L, 'arm' + s, 0.66); B['hd' + s]['tail'] = [q[1], 0.66, q[2]]
        q = at(L, 'leg' + s, 0.0); B['ft' + s]['tail'] = [q[1], 0.0, q[2] + 0.1]
    B['head']['tail'] = [0, 2.2, 0.12]
    return mirror_pairs(out, [(a + 'L', a + 'R') for a in ('sh', 'el', 'hd', 'th', 'kn', 'ft')])
