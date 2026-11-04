# The ember moth's wings, cut from their flat sheet (CR06) into an RGBA atlas: the left forewing and hindwing
# (mirrored for the right), each with its outline as alpha, a mask of the glowing eyespot, and a white corner for
# the procedural body (rigs.js moth: vertex colour x this texture). Metric: the sheet's 10 cm bar = 112 px.
import sys, os, json, numpy as np
from PIL import Image
from scipy import ndimage as ndi
sys.path.insert(0, os.path.dirname(__file__))
from sheet import refine
SRC = '/home/claude/refs/all/CR06_moth_wings_flat.png'; OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets')
im = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float32); H, W, _ = im.shape
lum = im.mean(2); sat = im.max(2) - im.min(2)
m = ~((lum > 228) & (sat < 22)); m = ndi.binary_opening(m, iterations=2); m = ndi.binary_closing(m, iterations=2); m = ndi.binary_fill_holes(m)
lab, n = ndi.label(m); m = lab == (np.bincount(lab.ravel())[1:].argmax() + 1)
m = refine(im.astype(np.uint8), m)
PPM, AXIS, ZROW = 1120.0, 768.0, 430.0
yy, xx = np.mgrid[0:H, 0:W]
def below(poly):   # True where a pixel is below the polyline (larger row)
    px, py = zip(*poly); return yy > np.interp(xx, px, py)
lead = [(0, 60), (300, 160), (500, 255), (700, 365), (780, 380)]            # the forewing's leading edge: the antenna is above it
split = [(0, 600), (150, 570), (240, 548), (400, 515), (600, 478), (780, 452)]   # forewing above, hindwing below
wing = m & (xx < 688) & below(lead)
fore = wing & ~below(split); hind = wing & below(split)
def piece(mask):
    ys, xs = np.nonzero(mask); x0, x1, y0, y1 = xs.min() - 4, xs.max() + 5, ys.min() - 4, ys.max() + 5
    rgb = im[y0:y1, x0:x1]; a = mask[y0:y1, x0:x1].astype(np.float32)
    # colour bled past the outline (so the cut edge never samples the white paper), alpha a touch soft
    seed = ndi.binary_erosion(a > 0.5, iterations=2); out = rgb.copy(); w = seed.astype(np.float32); cm = rgb * seed[..., None]; filled = seed.copy()
    for sg in (1.5, 3, 6, 12, 24):
        ws = ndi.gaussian_filter(w, sg); cs = np.stack([ndi.gaussian_filter(cm[..., k], sg) for k in range(3)], -1); t = ~filled & (ws > 1e-3); out[t] = cs[t] / ws[t][:, None]; filled |= t
    alpha = ndi.gaussian_filter(a, 0.8)
    return out, alpha, (int(x0), int(y0), int(x1), int(y1))
F = piece(fore); Hh = piece(hind)
AW, AH = 2048, 1024; atlas = np.zeros((AH, AW, 4), np.float32); glow = np.zeros((AH, AW), np.float32)
meta = {'ppm': PPM, 'axis': AXIS, 'zrow': ZROW, 'size': [AW, AH], 'pieces': {}}
x = 8
for name, (rgb, alpha, box) in (('fore', F), ('hind', Hh)):
    h, w = alpha.shape; s = min(1.0, (AH - 16) / h); 
    rgb_s = np.asarray(Image.fromarray(rgb.astype(np.uint8)).resize((int(w * 1.4), int(h * 1.4)), Image.LANCZOS)).astype(np.float32)
    a_s = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).resize((int(w * 1.4), int(h * 1.4)), Image.LANCZOS)).astype(np.float32) / 255
    hh, ww = a_s.shape; atlas[8:8 + hh, x:x + ww, :3] = rgb_s; atlas[8:8 + hh, x:x + ww, 3] = a_s * 255
    c = rgb_s / 255; g = np.clip((c[..., 0] - c[..., 2] - 0.35) / 0.3, 0, 1) * np.clip((c[..., 0] - 0.7) / 0.2, 0, 1)   # the hot orange of the eyespot
    glow[8:8 + hh, x:x + ww] = g
    meta['pieces'][name] = {'box': box, 'uv': [x / AW, 8 / AH, (x + ww) / AW, (8 + hh) / AH]}
    x += ww + 16
atlas[AH - 24:AH - 4, AW - 24:AW - 4] = [255, 255, 255, 255]   # the white corner the body samples
meta['white'] = [(AW - 14) / AW, (AH - 14) / AH]
glow = np.clip(ndi.gaussian_filter(ndi.grey_dilation(glow, size=(5, 5)), 2.0) * 1.4, 0, 1)
Image.fromarray(atlas.astype(np.uint8), 'RGBA').save(os.path.join(OUT, 'moth_wings.webp'), quality=88)
Image.fromarray((glow * 255).astype(np.uint8)).save(os.path.join(OUT, 'moth_glow.webp'), quality=85)
json.dump(meta, open(os.path.join(OUT, 'moth_wings.json'), 'w'))
print(json.dumps(meta), os.path.getsize(os.path.join(OUT, 'moth_wings.webp')) // 1024, 'KB')
Image.fromarray(atlas.astype(np.uint8), 'RGBA').resize((1024, 512)).save('/home/claude/remaster/moth_atlas_preview.png')
