# Rebake a procedural rig that is already fitted to its sheet (the bandit, the villagers, the sentinel...):
# its MAX-detail body is exported from the game, welded and unwrapped in Blender, and painted from its own
# projection atlas with a depth test per view and ambient occlusion; the lower LODs are meshopt
# simplifications. The game then samples one texture instead of blending three projections.
# usage: python3 rebake.py <type> [lower LOD triangle counts...]
import sys, os, subprocess, json, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
WORK = '/home/claude/remaster'; BPY = '/home/claude/bvenv/bin/python'; REPO = os.path.join(HERE, '..', '..'); ASSETS = os.path.join(REPO, 'src', 'assets')
t = sys.argv[1]; d = os.path.join(WORK, t + '_rb'); args = sys.argv[2:]
VOX = args.pop(0) if args and args[0].startswith('vox=') else None; lower = args
subprocess.run(['node', '/home/claude/test7/export.js', t, '3'], check=True, env={**os.environ, 'NODE_PATH': subprocess.check_output(['npm', 'root', '-g'], text=True).strip()})
r = subprocess.run([BPY, os.path.join(HERE, 'bl_rebake.py'), d, '2048'] + (VOX[4:].split(':') if VOX else []), capture_output=True, text=True)
print('\n'.join(l for l in r.stdout.splitlines() if l.startswith('[')))
if r.returncode: print(r.stderr[-2000:]); sys.exit(1)
import paint_rebake
glow = os.path.join(ASSETS, t + '_glow.webp')
paint_rebake.paint(d, os.path.join(ASSETS, t + '.webp'), os.path.join(d, 'albedo.png'), glow if os.path.exists(glow) else None, os.path.join(d, 'glow.png'))
import export
tris = json.load(open(os.path.join(d, 'meta.json')))['lods'][0]
if not lower: lower = [str(int(tris * k)) for k in (0.55, 0.3, 0.15)]
export.export(d, os.path.join(d, 'pack'), t, lods=1)
subprocess.run(['node', os.path.join(HERE, 'pack.mjs'), os.path.join(d, 'pack'), t, os.path.join(ASSETS, 'remaster', t + '.bin')] + lower, check=True)
from PIL import Image
Image.open(os.path.join(d, 'albedo.png')).save(os.path.join(ASSETS, 'remaster', t + '.webp'), quality=86, method=6)
if os.path.exists(glow): Image.open(os.path.join(d, 'glow.png')).convert('L').save(os.path.join(ASSETS, 'remaster', t + '_glow.webp'), quality=80)
print(t, 'rebaked:', tris, 'tris at MAX; lower', lower)
