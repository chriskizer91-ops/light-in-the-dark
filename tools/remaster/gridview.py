# Draw a view of a sheet with a metric grid in model coordinates, to read part boundaries off it.
import sys, numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, '.')
import sheet
def draw(V, kind, path, step=0.05, scale=2, rng=None):
    v = V[kind]; rgb = v.rgb.astype(np.uint8).copy(); m = v.mask
    rgb[~m] = (rgb[~m] * 0.35 + 120).astype(np.uint8)
    ys, xs = np.nonzero(m); y0, y1, x0, x1 = max(0, ys.min() - 20), ys.max() + 20, max(0, xs.min() - 20), xs.max() + 20
    im = Image.fromarray(rgb[y0:y1, x0:x1]).resize((int((x1 - x0) * scale), int((y1 - y0) * scale))); d = ImageDraw.Draw(im)
    ppm = v.ppm
    def P(c, r): return ((c - x0) * scale, (r - y0) * scale)
    if kind in ('side', 'sideFlip'):
        for k in range(-40, 40):
            z = k * step; c, _ = v.px(0, 0, z)
            if x0 <= c <= x1: d.line([P(c, y0), P(c, y1)], fill=(0, 0, 255) if k % 2 == 0 else (150, 150, 255)); d.text(P(c + 1, y0 + 2), '%.2f' % z, fill=(0, 0, 200))
    if kind in ('front', 'back', 'top') and v.kind != 'topL':
        for k in range(-40, 40):
            x = k * step; c, _ = v.px(x, 0, 0)
            if x0 <= c <= x1: d.line([P(c, y0), P(c, y1)], fill=(0, 0, 255) if k % 2 == 0 else (150, 150, 255)); d.text(P(c + 1, y0 + 2), '%.2f' % x, fill=(0, 0, 200))
    for k in range(-40, 80):
        if v.kind == 'topL':
            z = k * step; c, _ = v.px(0, 0, z)
            if x0 <= c <= x1: d.line([P(c, y0), P(c, y1)], fill=(0, 0, 255)); d.text(P(c + 1, y0 + 2), 'z%.2f' % z, fill=(0, 0, 200))
            _, r = v.px(k * step, 0, 0); lab = 'x%.2f' % (k * step)
        elif kind == 'top':
            z = k * step; _, r = v.px(0, 0, z); lab = 'z%.2f' % z
        else:
            y = k * step; _, r = v.px(0, y, 0); lab = '%.2f' % y
        if y0 <= r <= y1: d.line([P(x0, r), P(x1, r)], fill=(255, 0, 0) if k % 2 == 0 else (255, 150, 150)); d.text(P(x0 + 2, r + 1), lab, fill=(200, 0, 0))
    im.save(path)
if __name__ == '__main__':
    import importlib; name = sys.argv[1]; C = importlib.import_module('creatures.' + name); V = C.views()
    for k in V: draw(V, k, '/home/claude/remaster/%s_%s_grid.png' % (name, k), scale=float(sys.argv[2]) if len(sys.argv) > 2 else 1.4)
