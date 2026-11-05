# Remaster one creature end to end:  python3 run.py <name> [steps]
#   carve  the body from its sheet (creatures/<name>.py: carve(), returns the hull and the limbs' centre lines)
#   blend  Blender: remesh, the top LOD, UVs, bake position/normal/AO, skin to the bones (bl_process.py)
#   paint  the texture from the sheet with a depth test (paint.py)
#   pack   quantize, simplify the lower LODs, meshopt-encode, deflate -> src/assets/remaster/<name>.bin + .webp
import sys, os, json, importlib, subprocess, time, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
WORK = '/home/claude/remaster'; BPY = '/home/claude/bvenv/bin/python'; ASSETS = os.path.join(HERE, '..', '..', 'src', 'assets', 'remaster')
name = sys.argv[1]; steps = sys.argv[2].split(',') if len(sys.argv) > 2 else ['carve', 'blend', 'paint', 'pack']
C = importlib.import_module('creatures.' + name); out = os.path.join(WORK, name + '_out'); os.makedirs(out, exist_ok=True)
t0 = time.time(); log = lambda *a: print('[%s %5.1fs]' % (name, time.time() - t0), *a, flush=True)
if 'carve' in steps:
    verts, faces, lines = C.carve()
    np.savez(os.path.join(out, 'hull.npz'), v=verts.astype(np.float32), f=faces.astype(np.int32)); json.dump(lines, open(os.path.join(out, 'lines.json'), 'w'))
    log('carved', len(verts), 'verts')
if 'blend' in steps:
    lines = json.load(open(os.path.join(out, 'lines.json')))
    cfg = {'hull': os.path.join(out, 'hull.npz'), 'out': out, 'voxel': getattr(C, 'VOXEL', 0.0035), 'lods': [C.LODS[0]], 'bones': C.bones(lines),
           'no_deform': getattr(C, 'NO_DEFORM', ['root']), 'bake_size': 2048, 'ao_samples': 32, 'smooth': getattr(C, 'SMOOTH', 0)}
    json.dump(cfg, open(os.path.join(out, 'cfg.json'), 'w'), indent=1)
    r = subprocess.run([BPY, os.path.join(HERE, 'bl_process.py'), os.path.join(out, 'cfg.json')], capture_output=True, text=True)
    for l in r.stdout.splitlines():
        if l.startswith('['): log('blender', l)
    if r.returncode: print(r.stdout[-3000:], r.stderr[-3000:]); sys.exit(1)
if 'paint' in steps:
    import paint
    V = C.views(); B = np.load(os.path.join(out, 'bake.npz')); L = np.load(os.path.join(out, 'lod0.npz'))
    T = L['loops'][:, 0].astype(int).reshape(-1, 3)
    paint.paint(V, B, (L['P'], T), os.path.join(out, 'albedo.png'), size=getattr(C, 'TEX', 1024), skip=getattr(C, 'skip', None), ao_k=getattr(C, 'AO', 0.42))
    log('painted')
if 'pack' in steps:
    import export
    pk = os.path.join(out, 'pack'); export.export(out, pk, name, lods=1)
    subprocess.run(['node', os.path.join(HERE, 'pack.mjs'), pk, name, os.path.join(ASSETS, name + '.bin')] + [str(t) for t in C.LODS[1:]], check=True)
    from PIL import Image
    alb = Image.open(os.path.join(out, 'albedo.png')); alb.save(os.path.join(ASSETS, name + '.webp'), quality=86, method=6)
    if hasattr(C, 'glow'):   # what glows on its own: a mask the game lights (emissive)
        g = np.clip(C.glow(np.asarray(alb.convert('RGB')).astype(np.float32)), 0, 1)
        from scipy import ndimage as ndi
        g = np.clip(ndi.gaussian_filter(ndi.grey_dilation(g, size=(3, 3)), 1.0) * 1.3, 0, 1)
        Image.fromarray((g * 255).astype(np.uint8)).save(os.path.join(ASSETS, name + '_glow.webp'), quality=80)
        log('glow mask', '%.1f%%' % (100 * (g > 0.3).mean()))
    log('packed', os.path.getsize(os.path.join(ASSETS, name + '.bin')) // 1024, 'KB +', os.path.getsize(os.path.join(ASSETS, name + '.webp')) // 1024, 'KB texture')
