# A view's silhouette as vertical runs per column, in metres: for long side views (quadrupeds).
# usage: vprofile.py SHEET GROUND_Y PX_PER_M VIEW_INDEX [step] [axis_x]   (h = (x - axis) / ppm)
import sys, os, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from seg import segment
sheet, ground, ppm, vi = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4])
step = float(sys.argv[5]) if len(sys.argv) > 5 else 0.05
im, lab, comps = segment('/home/claude/refs/all/' + sheet + '.png', xmin=int(os.environ.get('XMIN', 60)))
c = comps[vi]; m = lab == c['id']
ax = float(sys.argv[6]) if len(sys.argv) > 6 else c['x0']
print(f"view {vi}: x {c['x0']}-{c['x1']} ({(c['x1'] - c['x0']) / ppm:.2f} m) y {c['y0']}-{c['y1']} height {(ground - c['y0']) / ppm:.2f} m")
h = 0.0
while h < (c['x1'] - ax) / ppm:
    col = m[:, int(round(ax + h * ppm))]; ys = np.nonzero(col)[0]
    if len(ys):
        runs = np.split(ys, np.nonzero(np.diff(ys) > 1)[0] + 1)
        print(f"{h:5.2f}: " + "  ".join(f"[{(ground - r[-1]) / ppm:.2f},{(ground - r[0]) / ppm:.2f}]" for r in runs if len(r) > 2))
    h += step
