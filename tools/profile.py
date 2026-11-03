# Print a view's silhouette as horizontal intervals per height, in metres, to fit a model's proportions to a sheet.
# usage: profile.py SHEET GROUND_Y PX_PER_M VIEW_INDEX [step] [axis_x]
import sys, os, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from seg import segment
sheet, ground, ppm, vi = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4])
step = float(sys.argv[5]) if len(sys.argv) > 5 else 0.1
import os as _o
im, lab, comps = segment('/home/claude/refs/all/' + sheet + '.png', xmin=int(_o.environ.get('XMIN', 60)))
c = comps[vi]; m = lab == c['id']
ax = float(sys.argv[6]) if len(sys.argv) > 6 else (c['x0'] + c['x1']) / 2
print(f"view {vi}: x {c['x0']}-{c['x1']} y {c['y0']}-{c['y1']}  axis {ax:.0f}px  height {(ground - c['y0']) / ppm:.2f} m")
h = (ground - c['y0']) / ppm
y = 0.02
while y < h:
    row = m[int(round(ground - y * ppm))]
    xs = np.nonzero(row)[0]
    if len(xs):
        runs = np.split(xs, np.nonzero(np.diff(xs) > 1)[0] + 1)
        print(f"{y:4.2f}: " + "  ".join(f"[{(r[0] - ax) / ppm:+.2f},{(r[-1] - ax) / ppm:+.2f}]" for r in runs if len(r) > 2))
    y += step
