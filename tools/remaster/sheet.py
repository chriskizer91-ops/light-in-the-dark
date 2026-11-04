# Read a reference sheet into calibrated silhouette views (metres), for carving a body that matches them.
# Each view knows how to turn a model point (x, y, z) into a pixel of the sheet, and holds its mask and colours.
import sys, os, numpy as np
from scipy import ndimage as ndi
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from seg import segment
REF = '/home/claude/refs/all/'

class View:
    # kind: front | back | side | sideFlip | top.  ppm: pixels per metre.  The pixel of a model point:
    #   front: col = ax + x*ppm, row = g - y*ppm      back: col = ax - x*ppm, row = g - y*ppm
    #   side (left profile, nose to the left): col = z0 + (zf - z)*ppm   sideFlip: col = z0 + (z - zb)*ppm
    #   top (nose down the page): col = ax + x*ppm, row = r0 + (z - zt)*ppm
    def __init__(self, kind, rgb, mask, ppm, **k):
        self.kind, self.rgb, self.mask, self.ppm = kind, rgb, mask, ppm
        self.__dict__.update(k)
        self.sdf = (ndi.distance_transform_edt(mask) - ndi.distance_transform_edt(~mask)) / ppm  # metres, + inside
        # the outline the body is held inside: the drawing's, with the stray hairs and fur spikes opened off
        # (a blurred distance: hairs a few pixels wide fall below zero, ears and paws stay)
        self.hard = ndi.gaussian_filter(self.sdf, max(1.5, 0.008 * ppm))
    def px(self, x, y, z):
        p = self.ppm
        if self.kind == 'front': return self.ax + x * p, self.g - y * p
        if self.kind == 'back': return self.ax - x * p, self.g - y * p
        if self.kind == 'side': return self.c0 + (self.zf - z) * p, self.g - y * p
        if self.kind == 'sideFlip': return self.c0 + (z - self.zb) * p, self.g - y * p
        if self.kind == 'top': return self.ax + x * p, self.r0 + (z - self.zt) * p
    # the 2D coordinates of the view's plane for a model point: (h, v) such that the view sees (h, v)
    def plane(self, x, y, z):
        return {'front': (x, y), 'back': (x, y), 'side': (z, y), 'sideFlip': (z, y), 'top': (x, z)}[self.kind]
    def sample(self, arr, x, y, z, order=1):
        c, r = self.px(x, y, z)
        return ndi.map_coordinates(arr, [np.asarray(r, float), np.asarray(c, float)], order=order, mode='constant', cval=0)
    def inside(self, x, y, z):
        return self.sample(self.sdf, x, y, z) > 0

def mirror_axis(mask):
    # the column about which the mask is most nearly symmetric
    cols = np.nonzero(mask.any(0))[0]; best, bc = -1, 0
    for c2 in range(2 * cols[0] + 10, 2 * cols[-1] - 10):  # c2 = 2*axis
        lo, hi = max(cols[0], c2 - cols[-1]), min(cols[-1], c2 - cols[0])
        a = mask[:, lo:hi + 1]; b = mask[:, c2 - hi:c2 - lo + 1][:, ::-1]
        s = (a & b).sum() / max(1, (a | b).sum())
        if s > best: best, bc = s, c2
    return bc / 2.0

def refine(img, m, iters=6):
    # GrabCut from the threshold mask: it finds the grey gaps between legs that the threshold took for fur
    import cv2
    ys, xs = np.nonzero(m); y0, y1, x0, x1 = max(0, ys.min() - 30), ys.max() + 31, max(0, xs.min() - 30), xs.max() + 31
    mm = m[y0:y1, x0:x1]; g = np.full(mm.shape, cv2.GC_BGD, np.uint8)
    g[ndi.binary_dilation(mm, iterations=6)] = cv2.GC_PR_BGD; g[mm] = cv2.GC_PR_FGD
    bgd = np.zeros((1, 65)); fgd = np.zeros((1, 65))
    cv2.grabCut(np.ascontiguousarray(img[y0:y1, x0:x1, ::-1]), g, None, bgd, fgd, iters, cv2.GC_INIT_WITH_MASK)
    out = np.zeros_like(m); out[y0:y1, x0:x1] = (g == cv2.GC_FGD) | (g == cv2.GC_PR_FGD)
    lab, n = ndi.label(out)
    if n > 1: out = lab == (np.bincount(lab.ravel())[1:].argmax() + 1)
    return ndi.binary_fill_holes(out) if False else out
def load(sheet, order, height, seg_opts={}, top_len=None, nose_z=None, grabcut=True):
    """order: the view kinds left to right as drawn. height: metres from the ground to the top of the side view.
    nose_z: the model z of the frontmost point (side views). Returns {kind: View}."""
    im, lab, comps = segment(REF + sheet + '.png', **seg_opts)
    comps = sorted(sorted(comps, key=lambda c: -c['area'])[:len(order)], key=lambda c: c['x0'])
    V = {}
    side = next(c for k, c in zip(order, comps) if k.startswith('side'))
    sm = lab == side['id']
    if grabcut: sm = refine(im.astype(np.uint8), sm)
    ys = np.nonzero(sm.any(1))[0]; g = ys[-1]; ppm = (g - ys[0]) / height
    for kind, c in zip(order, comps):
        m = lab == c['id']
        if grabcut: m = refine(im.astype(np.uint8), m)
        if kind in ('front', 'back'):
            V[kind] = View(kind, im, m, ppm, ax=mirror_axis(m), g=c['y1'] - 1)
        elif kind == 'side':
            V[kind] = View(kind, im, m, ppm, c0=c['x0'], zf=nose_z, g=c['y1'] - 1)
        elif kind == 'sideFlip':
            V[kind] = View(kind, im, m, ppm, c0=c['x0'], zb=nose_z - (c['x1'] - c['x0']) / ppm, g=c['y1'] - 1)
        elif kind == 'top':
            V[kind] = View(kind, im, m, ppm, ax=mirror_axis(m), r0=c['y1'] - 1, zt=nose_z)
    return V
