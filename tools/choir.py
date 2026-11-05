# The Resonance Choir (CR39): a broken bronze bell that floats, and four porcelain masks that sing around it.
# Its pieces wear pictures of their own (decals), cut from the sheet's close-ups: the face, and the bell.
import sys, os, json, numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import atlas
from seg import segment
REF = '/home/claude/refs/all/'
def crop(lab, im, box):
    x0, y0, x1, y1 = box; ids = np.unique(lab[y0:y1, x0:x1]); ids = ids[ids > 0]
    m = np.isin(lab[y0:y1, x0:x1], ids); ys, xs = np.nonzero(m)
    bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    rgb = atlas.bleed(im[y0:y1, x0:x1].copy(), m)[by0:by1, bx0:bx1]
    return rgb
im, lab, comps = segment(REF + 'CR39_choir_sheet.png', min_area=1500)
face = crop(lab, im, (60, 515, 362, 950)); bell = crop(lab, im, (690, 515, 1062, 955))
S = 512; out = Image.new('RGB', (S, S), (90, 80, 70)); views = {}; x = 0
for nm, img in [('face', face), ('bell', bell)]:
    h, w = img.shape[:2]; k = min(250 / w, 500 / h); w2, h2 = int(w * k), int(h * k)
    out.paste(Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).resize((w2, h2), Image.LANCZOS), (x, 0))
    views[nm] = [x / S, 0, (x + w2) / S, h2 / S]; x += w2 + 4
out.save(os.path.join(atlas.OUT, 'choir.webp'), quality=84, method=6)
json.dump({'views': views, 'scale': 1}, open(os.path.join(atlas.OUT, 'choir.json'), 'w'), indent=1)
print(views)
