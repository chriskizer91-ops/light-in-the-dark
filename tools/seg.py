# Cut views out of a reference sheet. The background is a light grey with a soft gradient and a faint grid:
# fit a smooth surface to the grey, mark everything that departs from it, clean up, label components.
import sys, numpy as np
from PIL import Image
from scipy import ndimage as ndi
def bg_fit(lum, sat):
    H, W = lum.shape; mode = np.bincount(lum.astype(int).ravel(), minlength=256)[60:].argmax() + 60
    cand = (sat < 6) & (np.abs(lum - mode) < 30)
    ys, xs = np.nonzero(cand); k = np.random.default_rng(1).choice(len(xs), min(60000, len(xs)), replace=False)
    x = xs[k] / W; y = ys[k] / H; A = np.stack([np.ones_like(x), x, y, x * x, y * y, x * y, x**3, y**3], 1)
    c, *_ = np.linalg.lstsq(A, lum[ys[k], xs[k]], rcond=None)
    X, Y = np.meshgrid(np.arange(W) / W, np.arange(H) / H)
    return c[0] + c[1] * X + c[2] * Y + c[3] * X * X + c[4] * Y * Y + c[5] * X * Y + c[6] * X**3 + c[7] * Y**3
def segment(path, ymax_frac=0.95, xmin=60, thr=16, sthr=11, min_area=3000, dark_bg=False, xmax=None, cuts=(), vopen=0):
    im = np.asarray(Image.open(path).convert('RGB')).astype(np.float32); H, W, _ = im.shape
    lum = im.mean(axis=2); sat = im.max(axis=2) - im.min(axis=2)
    bg = bg_fit(lum, sat)
    m = (np.abs(lum - bg) > thr) | (sat > sthr)
    m[:, :xmin] = False; m[int(H * ymax_frac):, :] = False
    if xmax: m[:, xmax:] = False
    m = ndi.binary_opening(m, structure=np.ones((3, 3)))     # kill grid lines and text strokes
    m = ndi.binary_closing(m, structure=np.ones((3, 3)), iterations=2)
    holes = ndi.binary_fill_holes(m) & ~m; hl, hn = ndi.label(holes)
    if hn: sizes = ndi.sum(holes, hl, range(1, hn + 1)); m |= np.isin(hl, 1 + np.nonzero(sizes < 600)[0])
    if vopen: m = ndi.binary_opening(m, structure=np.ones((vopen, 1)))  # drop thin horizontal lines (grid, ground)
    for cx in cuts: m[:, cx - 2:cx + 2] = False   # split views a stray line joins
    lab, n = ndi.label(m); comps = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        area = int((lab[sl] == i).sum())
        if area >= min_area: comps.append({'id': i, 'x0': sl[1].start, 'x1': sl[1].stop, 'y0': sl[0].start, 'y1': sl[0].stop, 'area': area})
    comps.sort(key=lambda c: c['x0'])
    return im, lab, comps
if __name__ == '__main__':
    im, lab, comps = segment(sys.argv[1])
    for c in comps: print(c)
    keep = np.isin(lab, [c['id'] for c in comps])
    out = im.copy(); out[~keep] = out[~keep] * 0.15
    Image.fromarray(out.astype(np.uint8)).resize((768, 512)).save('/home/claude/atlas/mask_preview.png')
