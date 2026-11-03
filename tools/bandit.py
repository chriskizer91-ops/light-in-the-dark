# The forest bandit (CR12): clean the sheet, then cut its projection atlas (atlas.py).
#  - The side view is a right profile with the sword crossing the thigh and the far side's shield peeking
#    out in front. Both are modelled separately, so they are painted out of the side view (inpainted) and the
#    view keeps only the body, cloak and clothes.
#  - The shield's face comes from CR13 (pose 4, BLOCK), where it faces the camera: unwarped to a square decal.
#  - The model is built in the sheet's own metres; the views' metric extents are written to bandit.json ('ext')
#    so the projection maps exactly those, whatever the sword and shield add to the model's own extents.
import sys, os, json, numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi
sys.path.insert(0, os.path.dirname(__file__))
import atlas
from seg import segment
REF = '/home/claude/refs/all/'
PPM, GROUND = 414.25, 856.0                  # the sheet's ruler: 0.25 m ticks from y 856 up to 27.5
AX = {'front': 252, 'side': 628, 'back': 964}  # each view's axis (between the feet), px
Z0 = 0.06                                   # model z = side-view metres + Z0 (puts the legs at z = 0)
def px(view, h, y): return (AX[view] + h * PPM, GROUND - y * PPM)
def clean():
    im = cv2.imread(REF + 'CR12_bandit_turnaround.png'); m = np.zeros(im.shape[:2], np.uint8)
    seg = lambda a, b, hw: cv2.line(m, tuple(int(v) for v in px('side', *a)), tuple(int(v) for v in px('side', *b)), 255, max(1, int(hw * 2 * PPM)))
    seg((0.015, 0.875), (0.318, 0.37), 0.026)     # the blade (its centre line measured off the sheet)
    seg((-0.045, 0.935), (0.115, 0.835), 0.026)    # the crossguard
    shield = [(0.122, 1.175), (0.18, 1.135), (0.22, 1.04), (0.235, 0.95), (0.225, 0.86), (0.198, 0.775), (0.152, 0.71), (0.115, 0.715), (0.115, 1.175)]
    cv2.fillPoly(m, [np.array([px('side', h, y) for h, y in shield], np.int32)], 255)
    m = cv2.dilate(m, np.ones((7, 7), np.uint8))
    out = cv2.inpaint(im, m, 5, cv2.INPAINT_TELEA)
    # what lay in front of the body's own front edge was background: put the grey back there
    edge = [(0.3, -0.03), (0.42, 0.01), (0.47, 0.05), (0.52, 0.08), (0.57, 0.09), (0.8, 0.1), (0.9, 0.12), (1.0, 0.13), (1.1, 0.135), (1.17, 0.12), (1.25, 0.11)]
    ys, xs = np.nonzero(m); h = (xs - AX['side']) / PPM; y = (GROUND - ys) / PPM
    front = np.interp(y, [e[0] for e in edge], [e[1] for e in edge])
    bg = np.median(im[int(GROUND - 1.6 * PPM):int(GROUND - 1.2 * PPM), int(AX['side'] + 0.3 * PPM):int(AX['side'] + 0.4 * PPM)].reshape(-1, 3), axis=0)
    out_bg = h > front + 0.004; out[ys[out_bg], xs[out_bg]] = bg
    # the cloak's moth holes show the grey backdrop through them: in the dark that reads as a lit patch, so darken them
    cv2.imwrite(REF + 'CR12_bandit_clean.png', out)
    _, lab, comps = segment(REF + 'CR12_bandit_clean.png')
    comps = sorted(sorted(comps, key=lambda c: -c['area'])[:4], key=lambda c: c['x0'])
    for view, c in zip(['front', 'side', 'back'], comps[:3]):
        inside = lab == c['id']; near = np.abs(out.astype(int) - bg.astype(int)).sum(2) < 40
        if view == 'front': # not the sword's steel (his right) or the shield's rim (his left)
            xx = (np.arange(out.shape[1]) - AX['front']) / PPM; inside &= ((xx > -0.33) & (xx < 0.31))[None, :]
        out[inside & near] = (30, 33, 36)
    cv2.imwrite(REF + 'CR12_bandit_clean.png', out)
    return out
def shield_decal(N=256):
    im = np.asarray(Image.open(REF + 'CR13_bandit_poses.png').convert('RGB')).astype(np.float32)
    cx, cy, a, b = 304, 661, 69, 74                # the shield's outline in pose 4
    yy, xx = np.mgrid[0:N, 0:N]; u = (xx + 0.5 - N / 2) / (N / 2); v = (yy + 0.5 - N / 2) / (N / 2)
    return np.stack([ndi.map_coordinates(im[..., k], [cy + v * b, cx + u * a], order=1) for k in range(3)], -1)
def bandit():
    clean()
    atlas.build('bandit', 'CR12_bandit_clean', ['front', 'side', 'back', 'tq'], ['front', 'side', 'back'], opts={'flip': True}, extras=[('shield', shield_decal())])
    # metric extents of the three silhouettes, in projectUV's view coordinates [h0, h1, d0, d1] (d = -y)
    _, lab, comps = segment(REF + 'CR12_bandit_clean.png')
    comps = sorted(sorted(comps, key=lambda c: -c['area'])[:4], key=lambda c: c['x0'])
    ext = {}
    for view, c in zip(['front', 'side', 'back'], comps):
        h0, h1 = (c['x0'] - AX[view]) / PPM, (c['x1'] - AX[view]) / PPM
        if view == 'side': h0, h1 = h0 + Z0, h1 + Z0
        ext[view] = [round(h0, 4), round(h1, 4), round(-(GROUND - c['y0']) / PPM, 4), round(-(GROUND - c['y1']) / PPM, 4)]
    p = os.path.join(atlas.OUT, 'bandit.json'); j = json.load(open(p)); j['ext'] = ext; json.dump(j, open(p, 'w'), indent=1)
    print('ext', ext)

# ---------------------------------------------------------------------------------------------------
# The bandit leader (CR15): the same body as the bandit, scaled up (he stands 2.0 m to the point of his
# hood, the bandit 1.86), wearing his own sheet. The side view is a left profile with his sheathed sword
# crossing it; that is painted out (he fights with it drawn, a modelled blade). Extents go into the
# bandit's frame (÷ LS), so the same body takes this sheet.
LPPM, LGROUND, LS = 441.0, 911.0, 2.0 / 1.86
LAX = {'front': 238.6, 'side': 552.0, 'back': 843.6}
LZ = 0.01  # the legs' centre in the side view (h)
def leader():
    im = cv2.imread(REF + 'CR15_bandit_leader_sheet.png'); m = np.zeros(im.shape[:2], np.uint8)
    P = lambda h, y: (int(LAX['side'] + h * LPPM), int(LGROUND - y * LPPM))
    cv2.line(m, P(-0.215, 1.245), P(0.248, 0.255), 255, int(0.06 * LPPM))   # scabbard and blade
    cv2.line(m, P(-0.2, 1.12), P(-0.1, 1.05), 255, int(0.04 * LPPM))       # the hilt's guard
    m = cv2.dilate(m, np.ones((5, 5), np.uint8))
    out = cv2.inpaint(im, m, 5, cv2.INPAINT_TELEA)
    cv2.imwrite(REF + 'CR15_leader_clean.png', out)
    atlas.build('leader', 'CR15_leader_clean', ['front', 'side', 'back'], ['front', 'side', 'back'], opts={'xmax': 1010})
    _, lab, comps = segment(REF + 'CR15_leader_clean.png', xmax=1010)
    comps = sorted(sorted(comps, key=lambda c: -c['area'])[:3], key=lambda c: c['x0'])
    ext = {}
    for view, c in zip(['front', 'side', 'back'], comps):
        h0, h1 = (c['x0'] - LAX[view]) / LPPM, (c['x1'] - LAX[view]) / LPPM
        if view == 'side': h0, h1 = h0 - LZ, h1 - LZ   # projectUV's side coordinate is -z: legs at z = 0
        ext[view] = [round(v / LS, 4) for v in (h0, h1, -(LGROUND - c['y0']) / LPPM, -(LGROUND - c['y1']) / LPPM)]
    p = os.path.join(atlas.OUT, 'leader.json'); j = json.load(open(p)); j['ext'] = ext; json.dump(j, open(p, 'w'), indent=1)
    print('leader ext', ext)

if __name__ == '__main__':
    for n in (sys.argv[1:] or ['bandit', 'leader']): globals()[n]()
