# The village people (CR19-CR24): cut each sheet's front / side / back views into a projection atlas
# (atlas.py) and fit a body to the silhouettes: per height, the runs of the front view (widths) and of the
# side view (depths), in metres. rigs.js lofts a body through them (a visual hull with round sections).
import sys, os, json, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from seg import segment
import atlas
REF = '/home/claude/refs/all/'
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets')
# name: (sheet, view order, canonical height to the top of the head/hat in metres, segment options)
PEOPLE = {
  'maren': ('CR19_maren_sheet', ['front', 'side', 'back'], 1.6, {'xmax': 800}),
  'sev': ('CR20_sev_sheet', ['front', 'side', 'back'], 1.8, {'xmax': 1050}),
  'lyn': ('CR21_lyn_turnaround', ['front', 'side', 'back', 'tq'], 1.72, {'xmax': 1170}),
  'ged': ('CR23_ged_sheet', ['front', 'side', 'back'], 1.86, {'xmax': 900}),
  'girl': ('CR24_girl_sheet', ['front', 'side', 'back'], 1.25, {'xmax': 860, 'vopen': 5}),
}
def runs(row, minw):
    xs = np.nonzero(row)[0]
    if not len(xs): return []
    out = []
    for r in np.split(xs, np.nonzero(np.diff(xs) > 1)[0] + 1):
        if len(r) >= minw: out.append((int(r[0]), int(r[-1])))
    return out
def fit(name):
    sheet, order, H, opts = PEOPLE[name]
    im, lab, comps = segment(REF + sheet + '.png', min_area=1500, **opts)
    comps = sorted(sorted(comps, key=lambda c: -c['area'])[:len(order)], key=lambda c: c['x0'])
    V = {v: c for v, c in zip(order, comps)}
    fm, sm = lab == V['front']['id'], lab == V['side']['id']
    fy1 = V['front']['y1'] - 1
    thin = 9
    # front axis: between the outer feet; head top: first row with a run over the axis
    feet = [r for r in runs(fm[fy1 - 6], thin)]
    ax = (feet[0][0] + feet[-1][1]) / 2
    top = next(y for y in range(V['front']['y0'], fy1) if any(a <= ax <= b for a, b in runs(fm[y], 3)))
    ppm = (fy1 - top) / H
    thinpx = max(6, int(0.045 * ppm))
    # side: which way does it face? the toes stick out further than the heels
    sy1 = V['side']['y1'] - 1
    f0 = runs(sm[sy1 - int(0.025 * ppm)], thin); f1 = runs(sm[sy1 - int(0.13 * ppm)], thin)
    fc = (f0[0][0] + f0[-1][1]) / 2; ac = (f1[0][0] + f1[-1][1]) / 2
    flip = fc > ac   # toes to the right: the profile faces right
    sz = lambda x: ((x - ac) if flip else (ac - x)) / ppm
    rows = []
    y = 0.02
    while y <= H + 0.001:
        fr = runs(fm[int(round(fy1 - y * ppm))], 2); sr = runs(sm[int(round(sy1 - y * ppm))], 2)
        F = [[round((a - ax) / ppm, 3), round((b - ax) / ppm, 3)] for a, b in fr if b - a >= thinpx]
        T = [round(((a + b) / 2 - ax) / ppm, 3) for a, b in fr if b - a < thinpx]
        S = sorted([sorted([round(sz(a), 3), round(sz(b), 3)]) for a, b in sr if b - a >= thinpx], key=lambda r: r[0])
        rows.append({'y': round(y, 3), 'f': F, 's': S, 't': T})
        y += 0.04
    json.dump({'H': H, 'flip': bool(flip), 'rows': rows}, open(os.path.join(OUT, 'fig_' + name + '.json'), 'w'), separators=(',', ':'))
    a_opts = dict(opts); a_opts['min_area'] = 1500
    if flip: a_opts['flip'] = True
    atlas.build(name, sheet, order, ['front', 'side', 'back'], opts=a_opts)
    print(name, 'ppm %.0f' % ppm, 'flip', flip, 'rows', len(rows))
if __name__ == '__main__':
    for n in (sys.argv[1:] or PEOPLE): fit(n)
