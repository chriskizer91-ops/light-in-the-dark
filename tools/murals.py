# Murals and carved plaques for the ruins, cut straight from the reference sheet (CR49).
# murals.webp: the three painted panels side by side. plaques.webp: the three carved signs (unlit);
# plaques_glow.webp: a mask of each sign's grooves, so the carving itself lights up when answered.
import os, numpy as np
from PIL import Image
from scipy import ndimage as ndi
REF = '/home/claude/refs/all/CR49_plaques_murals.png'
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets')
im = Image.open(REF).convert('RGB')
MURALS = [(94, 14, 514, 537), (560, 13, 978, 537), (1026, 14, 1443, 536)]   # crown, light, shadow
PLAQUES = [(23, 605, 265, 873), (534, 605, 767, 873), (1031, 606, 1267, 874)]  # the dark (unlit) versions
mw, mh = 340, 424
mur = Image.new('RGB', (1024, 512), (60, 56, 50))
for i, b in enumerate(MURALS): mur.paste(im.crop(b).resize((mw, mh), Image.LANCZOS), (i * (mw + 2), 0))
mur.save(os.path.join(OUT, 'murals.webp'), quality=84, method=6)
pw, ph = 256, 284
pl = Image.new('RGB', (pw * 3, ph), (50, 48, 45)); gl = Image.new('L', (pw * 3, ph), 0)
for i, b in enumerate(PLAQUES):
    c = im.crop(b).resize((pw, ph), Image.LANCZOS); pl.paste(c, (i * pw, 0))
    L = np.asarray(c.convert('L')).astype(np.float32) / 255
    hp = ndi.gaussian_filter(L, 7) - L                       # grooves are darker than the stone around them
    g = np.clip((hp - 0.035) / 0.07, 0, 1)
    g = ndi.grey_opening(g, size=(3, 3))                     # drop hairline cracks, keep the carved strokes
    yy, xx = np.mgrid[0:ph, 0:pw]; u, v = xx / pw, yy / ph
    inner = (u > 0.07) & (u < 0.93) & (v > 0.06) & (v < 0.9) & ~((np.minimum(u, 1 - u) < 0.2) & (np.minimum(v, 1 - v) < 0.2))  # not the frame or its corner knots
    lab, n = ndi.label((g > 0.25) & inner); sizes = ndi.sum(np.ones_like(g), lab, range(1, n + 1))
    g = g * inner * np.isin(lab, 1 + np.nonzero(sizes >= 25)[0]); g = np.maximum(g, ndi.gaussian_filter(g, 4) * 0.8)   # a soft halo around the lit strokes
    gl.paste(Image.fromarray((np.clip(g, 0, 1) * 255).astype(np.uint8), 'L'), (i * pw, 0))
pl.save(os.path.join(OUT, 'plaques.webp'), quality=84, method=6); gl.save(os.path.join(OUT, 'plaques_glow.webp'), quality=85, method=6)
for n in ('murals.webp', 'plaques.webp', 'plaques_glow.webp'): print(n, os.path.getsize(os.path.join(OUT, n)) // 1024, 'KB')
prev = Image.new('RGB', (pw * 3, ph * 2)); prev.paste(pl, (0, 0)); prev.paste(gl.convert('RGB'), (0, ph)); prev.save('/home/claude/atlas/plaques_prev.png')
