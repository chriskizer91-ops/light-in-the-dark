# Build projection-texture atlases from the reference sheets (see seg.py).
# For each asset: cut the listed views out of its sheet, bleed their colours past the silhouette edge,
# pack them into one image, and write where each view's silhouette sits (normalised UV rect).
import sys, json, os, numpy as np
from PIL import Image
from scipy import ndimage as ndi
sys.path.insert(0, os.path.dirname(__file__))
from seg import segment
REF = '/home/claude/refs/all/'
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets')
def bleed(rgb, mask):
    # seed from a little inside the edge (the edge itself is blended with the grey background), then fill
    # outward with normalised Gaussian blurs of growing size: smooth, no streaks
    seed = ndi.binary_erosion(mask, iterations=3)
    if seed.sum() < 50: seed = mask
    out = rgb.copy(); filled = seed.copy(); cm = rgb * seed[..., None]; w = seed.astype(np.float32)
    for sg in (1.5, 3, 6, 12, 24, 48):
        ws = ndi.gaussian_filter(w, sg); cs = np.stack([ndi.gaussian_filter(cm[..., i], sg) for i in range(3)], -1)
        take = (~filled) & (ws > 1e-3); out[take] = cs[take] / ws[take][:, None]; filled |= take
    out[~filled] = rgb[seed].mean(axis=0)
    return out
def glow_mask(rgb):
    # the molten seams painted into the wax: hot orange. A mask of them, grown a little so it survives mipmapping
    c = rgb / 255.0; lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    ss = lambda a, b, x: np.clip((x - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((x - a) / (b - a), 0, 1))
    m = ss(0.42, 0.75, lin[..., 0] - lin[..., 2]) * ss(0.55, 0.85, lin[..., 0])
    m = ndi.grey_dilation(m, size=(3, 3)); m = ndi.gaussian_filter(m, 1.0)
    return np.clip(m * 1.4, 0, 1)
def build(name, sheet, order, keep, size=1024, margin=18, opts={}):
    opts = dict(opts); glow = opts.pop('glow', False); flip = opts.pop('flip', False)
    im, lab, comps = segment(REF + sheet + '.png', **opts)
    if len(comps) < len(order): raise SystemExit(f'{name}: found {len(comps)} components, expected {len(order)}: {comps}')
    if len(comps) > len(order): comps = sorted(sorted(comps, key=lambda c: -c['area'])[:len(order)], key=lambda c: c['x0'])
    crops = []
    for view, c in zip(order, comps):
        if view not in keep: continue
        x0, y0, x1, y1 = max(0, c['x0'] - margin), max(0, c['y0'] - margin), min(im.shape[1], c['x1'] + margin), min(im.shape[0], c['y1'] + margin)
        m = (lab[y0:y1, x0:x1] == c['id']); rgb = bleed(im[y0:y1, x0:x1].copy(), m)
        crops.append({'view': view, 'img': rgb, 'mask': m, 'bbox': [c['x0'] - x0, c['y0'] - y0, c['x1'] - x0, c['y1'] - y0]})
    # shelf-pack at a common scale that fits size x size
    def pack(s):
        x = y = rowh = 0; pos = []
        for cr in crops:
            w, h = int(cr['img'].shape[1] * s) + 2, int(cr['img'].shape[0] * s) + 2
            if x + w > size: x, y, rowh = 0, y + rowh, 0
            pos.append((x, y)); x += w; rowh = max(rowh, h)
        return pos, y + rowh
    s = 1.0
    while True:
        pos, h = pack(s)
        if h <= size: break
        s *= 0.96
    atlas = Image.new('RGB', (size, size), (90, 80, 70)); views = {}
    for cr, (px, py) in zip(crops, pos):
        h, w = cr['img'].shape[:2]; im2 = Image.fromarray(np.clip(cr['img'], 0, 255).astype(np.uint8)).resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
        atlas.paste(im2, (px, py))
        b = cr['bbox']; views[cr['view']] = [(px + b[0] * s) / size, (py + b[1] * s) / size, (px + b[2] * s) / size, (py + b[3] * s) / size]
    q = opts.get('q', 80) if isinstance(opts, dict) else 80
    atlas.save(os.path.join(OUT, name + '.webp'), quality=82, method=6)
    meta = {'views': views, 'scale': s}
    if flip: meta['sideFlip'] = True
    if glow:
        g = glow_mask(np.asarray(atlas).astype(np.float32))
        Image.fromarray((g * 255).astype(np.uint8), 'L').resize((size // 2, size // 2), Image.LANCZOS).save(os.path.join(OUT, name + '_glow.webp'), quality=80, method=6)
        meta['glow'] = True; print(name, 'glow mask', os.path.getsize(os.path.join(OUT, name + '_glow.webp')) // 1024, 'KB')
    json.dump(meta, open(os.path.join(OUT, name + '.json'), 'w'), indent=1)
    print(name, 'scale %.2f' % s, {k: [round(v, 3) for v in r] for k, r in views.items()}, os.path.getsize(os.path.join(OUT, name + '.webp')) // 1024, 'KB')
ASSETS = {
  'sentinel': ('CR26_sentinel_turnaround', ['front', 'side', 'back', 'tq'], ['front', 'side', 'back'], {'glow': True}),
  'guardian': ('CR30_guardian_turnaround', ['front', 'side', 'back', 'tq'], ['front', 'side', 'back'], {'xmin': 175, 'glow': True}),
  'hound': ('CR32_hound_turnaround', ['side', 'front', 'back', 'top'], ['side', 'front', 'back', 'top'], {'flip': True}),
  'wolf': ('CR01_wolf_turnaround', ['side', 'front', 'back', 'top'], ['side', 'front', 'back', 'top']),
  'leech': ('CR08_leech_turnaround', ['side'], ['side']),
  'bandit': ('CR12_bandit_turnaround', ['front', 'side', 'back', 'tq'], ['front', 'side', 'back']),
}
if __name__ == '__main__':
    names = sys.argv[1:] or list(ASSETS)
    for n in names:
        sheet, order, keep = ASSETS[n][:3]; opts = ASSETS[n][3] if len(ASSETS[n]) > 3 else {}
        build(n, sheet, order, keep, opts=opts)
