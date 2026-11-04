# Carve a body out of a reference sheet: every part is lofted through its own silhouette in two views
# (a superellipse in each slice, so it is round, not boxy), the parts are joined, and the whole is held
# inside every view's silhouette, so each drawing lands exactly on the model when it is projected back.
import numpy as np
from scipy import ndimage as ndi

def runs1(a):
    i = np.nonzero(np.diff(np.concatenate([[0], a.astype(np.int8), [0]])))[0]
    return list(zip(i[::2], i[1::2] - 1))

def hline_open(mask, length_px):
    # keep what is at least length_px wide along rows: the torso, neck and head, not the legs, ears or a hanging tail
    k = np.ones((1, max(3, int(length_px))), bool)
    return ndi.binary_opening(mask, structure=k)

class Grid:
    def __init__(self, lo, hi, res):
        self.lo, self.hi, self.res = np.array(lo, float), np.array(hi, float), res
        self.n = np.ceil((self.hi - self.lo) / res).astype(int) + 1
        self.ax = [self.lo[i] + np.arange(self.n[i]) * res for i in range(3)]
        self.f = np.full(self.n, -0.05, np.float32)   # x, y, z

def interp_chain(chain, y):
    # chain: [(y, x, z), ...] along a limb, top to bottom; the limb's centre (x, z) at height y
    ys = np.array([c[0] for c in chain]); xs = np.array([c[1] for c in chain]); zs = np.array([c[2] for c in chain])
    o = np.argsort(ys)
    return np.interp(y, ys[o], xs[o]), np.interp(y, ys[o], zs[o])

def view_runs_row(view, mask, y, axis='x'):
    # the runs of a view's mask on the row at height y, in model units along the view's horizontal axis
    r = int(round(view.g - y * view.ppm))
    if r < 0 or r >= mask.shape[0]: return []
    out = []
    for a, b in runs1(mask[r]):
        lo, hi = a - 0.5, b + 0.5
        if view.kind == 'front': out.append(((lo - view.ax) / view.ppm, (hi - view.ax) / view.ppm))
        elif view.kind == 'back': out.append((-(hi - view.ax) / view.ppm, -(lo - view.ax) / view.ppm))
        elif view.kind == 'side': out.append((view.zf - (hi - view.c0) / view.ppm, view.zf - (lo - view.c0) / view.ppm))
        elif view.kind == 'sideFlip': out.append((view.zb + (lo - view.c0) / view.ppm, view.zb + (hi - view.c0) / view.ppm))
    return out

def side_runs_col(view, mask, z):
    # runs of the side view's column at depth z: intervals of height y
    c = int(round(view.c0 + (view.zf - z) * view.ppm)) if view.kind == 'side' else int(round(view.c0 + (z - view.zb) * view.ppm))
    if c < 0 or c >= mask.shape[1]: return []
    return [((view.g - (b + 0.5)) / view.ppm, (view.g - (a - 0.5)) / view.ppm) for a, b in runs1(mask[:, c])]

def top_runs_row(view, mask, z):
    r = int(round(view.r0 + (z - view.zt) * view.ppm))
    if r < 0 or r >= mask.shape[0]: return []
    return [((a - 0.5 - view.ax) / view.ppm, (b + 0.5 - view.ax) / view.ppm) for a, b in runs1(mask[r])]

BLEND = [0.012]   # parts are joined with a fillet this wide (metres)
def smax(a, b):
    r = BLEND[0]
    if r <= 0: return np.maximum(a, b)
    h = np.clip(r - np.abs(a - b), 0, None) / r
    return np.maximum(a, b) + h * h * r * 0.25
def sup(u, v, p, scale=1.0):
    # inside a superellipse, as an approximate signed distance in metres (scale = its smaller half-axis)
    return scale * (1.0 - (np.abs(u) ** p + np.abs(v) ** p) ** (1.0 / p))

def part_yslices(G, A_runs, B_runs, p=2.0, ybox=(0, 9), keep=lambda xr, zr, y: True, clip=None, extend=None):
    """A_runs(y) -> x intervals, B_runs(y) -> z intervals. A superellipse per pair in each horizontal slice.
    clip(y, xr) -> (zc, half): hold the z interval to a limb's centre (drops the far leg).
    extend: (y_from, y_to, centre(y) -> (xc, zc)) carries the last section on into the body."""
    X, Z = np.meshgrid(G.ax[0], G.ax[2], indexing='ij'); last = None
    for j, y in enumerate(G.ax[1]):
        if not (ybox[0] <= y <= ybox[1]): continue
        best = None
        for xr in A_runs(y):
            for zr in B_runs(y):
                if not keep(xr, zr, y): continue
                z0, z1 = zr
                if clip:
                    zc, half = clip(y, xr)
                    z0, z1 = max(z0, zc - half), min(z1, zc + half)
                    if z1 - z0 < G.res: continue
                cx, a, cz, b = (xr[0] + xr[1]) / 2, (xr[1] - xr[0]) / 2, (z0 + z1) / 2, (z1 - z0) / 2
                v = sup((X - cx) / a, (Z - cz) / b, p, min(a, b))
                best = v if best is None else np.maximum(best, v); last = (cx, a, cz, b, y)
        if best is not None: G.f[:, j, :] = smax(G.f[:, j, :], best)
    if extend and last:
        y0, y1, centre = extend; cx, a, cz, b, ylast = last
        for j, y in enumerate(G.ax[1]):
            if not (min(y0, y1) <= y <= max(y0, y1)): continue
            xc, zc = centre(y)
            v = sup((X - xc) / a, (Z - zc) / b, p, min(a, b)); G.f[:, j, :] = smax(G.f[:, j, :], v)

def part_zslices(G, Y_runs, X_runs, p=2.4, zbox=(-9, 9), keep=lambda yr, xr, z: True):
    """Y_runs(z) -> y intervals (a side view's column), X_runs(z) -> x intervals (the top view's row)."""
    Xg, Yg = np.meshgrid(G.ax[0], G.ax[1], indexing='ij')
    for k, z in enumerate(G.ax[2]):
        if not (zbox[0] <= z <= zbox[1]): continue
        best = None
        for yr in Y_runs(z):
            for xr in X_runs(z):
                if not keep(yr, xr, z): continue
                cx, a, cy, b = (xr[0] + xr[1]) / 2, (xr[1] - xr[0]) / 2, (yr[0] + yr[1]) / 2, (yr[1] - yr[0]) / 2
                if a < G.res or b < G.res: continue
                v = sup((Xg - cx) / a, (Yg - cy) / b, p, min(a, b))
                best = v if best is None else np.maximum(best, v)
        if best is not None: G.f[:, :, k] = smax(G.f[:, :, k], best)

def hold_inside(G, views, scale=1.0, top_zmin=-9):
    # never past any view's silhouette: the field is cut by each view's signed distance
    X, Y, Z = np.meshgrid(*G.ax, indexing='ij')
    for name, V in views.items():
        if name == 'top':
            d = V.sample(V.hard, X, Y, Z).astype(np.float32)
            d[Z < top_zmin] = 1e3
        elif name in ('front', 'back'):
            continue
        else:
            d = V.sample(V.hard, X, Y, Z).astype(np.float32)
        G.f = np.minimum(G.f, d / scale)
    fb = [V for n, V in views.items() if n in ('front', 'back')]
    if fb:  # front and back are drawn separately: take either one's outline
        d = np.max([V.sample(V.hard, X, Y, Z) for V in fb], axis=0).astype(np.float32)
        G.f = np.minimum(G.f, d / scale)

def limb(G, A_runs, B_runs, p=2.0, y0=-0.01, ytop=0.5, ext_to=None, depth_k=1.3, foot=(0.06, 0.06), grow=0.5, min_w=0.015):
    """A vertical limb (a leg, a hanging tail, an ear) lofted bottom to top through horizontal slices.
    A_runs(y): the limb's x interval(s) in a front/back view (empty where it is lost against the body);
    B_runs(y): its z span in profile, held to depth_k x its half-width about the span's centre
    (the far leg drawn beside it is dropped); below foot[0] the depth is foot[1] (a paw is long).
    Where the front view loses it, the last good section carries on; past ytop it grows by `grow` to ext_to."""
    X, Z = np.meshgrid(G.ax[0], G.ax[2], indexing='ij'); sec = None; zlast = None
    for j, y in enumerate(G.ax[1]):
        if y < y0 or y > (ext_to or ytop): continue
        if y <= ytop:
            xr = [r for r in A_runs(y) if r[1] - r[0] > min_w]
            if xr: r = max(xr, key=lambda r: r[1] - r[0]); sec = ((r[0] + r[1]) / 2, (r[1] - r[0]) / 2)
            zr = B_runs(y)
            if zr: zlast = zr[0]
        if sec is None or zlast is None: continue
        cx, a = sec; z0, z1 = zlast; zc = (z0 + z1) / 2
        half = foot[1] if y < foot[0] else min((z1 - z0) / 2, depth_k * a)
        s = 1.0
        if y > ytop: s = 1 + grow * (y - ytop) / max(1e-3, (ext_to - ytop))
        v = sup((X - cx) / (a * s), (Z - zc) / (half * s), p, min(a, half) * s)
        G.f[:, j, :] = smax(G.f[:, j, :], v)

def smooth(G, sigma=1.2):
    G.f = ndi.gaussian_filter(G.f, sigma).astype(np.float32)

from scipy.ndimage import gaussian_filter1d
def smooth_params(P, sigma, median=0):
    """P: (n, k) per-slice parameters with NaN where a slice has none. Smooth each column along the slices
    over the valid stretches (a hairy outline makes every slice jump; the body should not be terraced)."""
    P = np.array(P, float); ok = ~np.isnan(P[:, 0]); out = P.copy()
    if sigma <= 0 or ok.sum() < 3: return out
    idx = np.nonzero(ok)[0]
    for c in range(P.shape[1]):
        filled = np.interp(np.arange(len(P)), idx, P[idx, c])
        if median > 1: filled = ndi.median_filter(filled, size=int(median) | 1, mode='nearest')  # drop the jumps a hairy outline makes
        out[:, c] = gaussian_filter1d(filled, sigma, mode='nearest')
    out[~ok] = np.nan
    return out

def body_z(G, Y_runs, X_runs, p=2.3, zbox=(-9, 9), sigma_m=0.012, pick_x=0.0, median_m=0.04):
    """The trunk lofted along z: per slice the main profile run (side view column) and the main top-view run,
    smoothed along z, each slice a superellipse."""
    P = []
    for z in G.ax[2]:
        if not (zbox[0] <= z <= zbox[1]): P.append([np.nan] * 4); continue
        ys = [r for r in Y_runs(z) if r[1] - r[0] > G.res]; xs = [r for r in X_runs(z) if r[1] - r[0] > G.res]
        if not ys or not xs: P.append([np.nan] * 4); continue
        yr = max(ys, key=lambda r: r[1] - r[0])
        xr = min(xs, key=lambda r: 0 if r[0] <= pick_x <= r[1] else 1 + min(abs(r[0] - pick_x), abs(r[1] - pick_x)))
        P.append([(xr[0] + xr[1]) / 2, (xr[1] - xr[0]) / 2, (yr[0] + yr[1]) / 2, (yr[1] - yr[0]) / 2])
    P = smooth_params(P, sigma_m / G.res, median_m / G.res)
    Xg, Yg = np.meshgrid(G.ax[0], G.ax[1], indexing='ij')
    for k in range(len(G.ax[2])):
        if np.isnan(P[k, 0]): continue
        cx, a, cy, b = P[k]; pk = p(G.ax[2][k]) if callable(p) else p
        G.f[:, :, k] = smax(G.f[:, :, k], sup((Xg - cx) / a, (Yg - cy) / b, pk, min(a, b)))
    return P

def limb_y(G, A_runs, B_runs, p=2.0, y0=-0.01, ytop=0.5, ext_to=None, ext_down=None, depth_k=1.3, foot=(0.0, 0.0), grow=0.5, min_w=0.015, sigma_m=0.01, min_half=0.0, median_m=0.025, tip_down=0.0, tip_up=0.0):
    """A vertical limb lofted through horizontal slices, its sections smoothed along y.
    A_runs(y): x intervals in a front/back view; the widest one wider than min_w is the limb (where it is lost
    against the body the last good section carries on). B_runs(y): its z span in profile, held to depth_k x
    its half-width about the span's centre (the far leg drawn beside it is dropped); below foot[0] the half
    depth is foot[1]. Past ytop it carries on to ext_to growing by `grow`; below its first section, down to ext_down."""
    ys = G.ax[1]; P = []; sec = None; zl = None
    for y in ys:
        if y < y0 or y > ytop: P.append([np.nan] * 4); continue
        xr = [r for r in A_runs(y) if r[1] - r[0] > min_w]
        if xr: r = max(xr, key=lambda r: r[1] - r[0]); sec = ((r[0] + r[1]) / 2, (r[1] - r[0]) / 2)
        zr = B_runs(y)
        if zr: zl = zr[0]
        if sec is None or zl is None: P.append([np.nan] * 4); continue
        cx, a = sec; z0, z1 = zl; zc = (z0 + z1) / 2
        half = foot[1] if y < foot[0] else max(min_half, min((z1 - z0) / 2, depth_k * a))
        P.append([cx, a, zc, half])
    P = smooth_params(P, sigma_m / G.res, median_m / G.res)
    ok = np.nonzero(~np.isnan(P[:, 0]))[0]
    if not len(ok): return P
    lo, hi = ok[0], ok[-1]
    X, Z = np.meshgrid(G.ax[0], G.ax[2], indexing='ij')
    for j, y in enumerate(ys):
        if lo <= j <= hi: cx, a, zc, half = P[j]; s = 1.0
        elif ext_to and hi < j and y <= ext_to: cx, a, zc, half = P[hi]; s = 1 + grow * (y - ys[hi]) / max(1e-3, ext_to - ys[hi])
        elif ext_down is not None and j < lo and y >= ext_down: cx, a, zc, half = P[lo]; s = 1.0
        elif tip_down and j < lo and y >= ys[lo] - tip_down: cx, a, zc, half = P[lo]; s = max(0.05, 1 - (ys[lo] - y) / tip_down)   # a pointed tip
        elif tip_up and j > hi and y <= ys[hi] + tip_up: cx, a, zc, half = P[hi]; s = max(0.05, 1 - (y - ys[hi]) / tip_up)
        else: continue
        if np.isnan(cx): continue
        G.f[:, j, :] = smax(G.f[:, j, :], sup((X - cx) / (a * s), (Z - zc) / (half * s), p, min(a, half) * s))
    return P
