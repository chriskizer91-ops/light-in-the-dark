# Blender (bpy): turn a carved hull into game meshes.
#   remesh -> LODs by decimation (the top LOD is unwrapped; the lower ones inherit its UVs)
#   bake the top LOD's surface position, normal and ambient occlusion into its UV layout
#   bind every LOD to the creature's bones with Blender's automatic (heat) weights
# usage: python bl_process.py config.json
import bpy, bmesh, sys, json, numpy as np, math, os, time
cfg = json.load(open(sys.argv[1])); out = cfg['out']; os.makedirs(out, exist_ok=True); t0 = time.time()
def log(*a): print('[%5.1fs]' % (time.time() - t0), *a, flush=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
d = np.load(cfg['hull']); V, F = d['v'].astype(float), d['f'].astype(int)
me = bpy.data.meshes.new('hull'); me.from_pydata(V.tolist(), [], F.tolist()); me.update()
ob = bpy.data.objects.new('hull', me); sc.collection.objects.link(ob)
def activate(o):
    for x in sc.objects: x.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o
def apply_mod(o, kind, **kw):
    activate(o); m = o.modifiers.new('m', kind)
    for k, v in kw.items(): setattr(m, k, v)
    bpy.ops.object.modifier_apply(modifier=m.name)
def dup(o, name):
    c = o.copy(); c.data = o.data.copy(); c.name = name; sc.collection.objects.link(c); return c
def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)
# 1. a clean, even surface
apply_mod(ob, 'REMESH', mode='VOXEL', voxel_size=cfg.get('voxel', 0.0035), adaptivity=0.0)
if cfg.get('smooth', 0): apply_mod(ob, 'SMOOTH', factor=0.5, iterations=cfg['smooth'])
log('remeshed', len(ob.data.vertices), 'verts', tris(ob), 'tris')
hi = ob; hi.name = 'hi'
# 2. LODs: the top one is decimated from the hull and unwrapped; the rest come from it with its UVs
targets = cfg['lods']   # e.g. [24000, 10000, 4000] top first
lods = []
top = dup(hi, 'lod0'); apply_mod(top, 'DECIMATE', decimate_type='COLLAPSE', ratio=min(1, targets[0] / tris(top)), use_collapse_triangulate=True)
activate(top); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(cfg.get('uv_angle', 60)), island_margin=cfg.get('uv_margin', 0.004), area_weight=0.0, scale_to_bounds=False)
try: bpy.ops.uv.pack_islands(rotate=True, margin=cfg.get('uv_margin', 0.004))
except Exception as e: log('pack failed', e)
bpy.ops.object.mode_set(mode='OBJECT'); lods.append(top); log('lod0', tris(top))
for i, t in enumerate(targets[1:], 1):
    l = dup(top, 'lod%d' % i); apply_mod(l, 'DECIMATE', decimate_type='COLLAPSE', ratio=min(1, t / tris(l)), use_collapse_triangulate=True); lods.append(l); log('lod%d' % i, tris(l))
# 3. bake the top LOD: object-space position and normal, and ambient occlusion
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 1
R = cfg.get('bake_size', 2048)
def bake_map(o, name, kind, socket=None, samples=1, float_=True):
    img = bpy.data.images.new(name, R, R, float_buffer=float_, alpha=False)
    mat = bpy.data.materials.new(name); mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
    outn = nt.nodes.new('ShaderNodeOutputMaterial'); tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    if socket:
        g = nt.nodes.new('ShaderNodeNewGeometry'); em = nt.nodes.new('ShaderNodeEmission'); nt.links.new(g.outputs[socket], em.inputs[0]); nt.links.new(em.outputs[0], outn.inputs[0])
    else:
        bs = nt.nodes.new('ShaderNodeBsdfDiffuse'); nt.links.new(bs.outputs[0], outn.inputs[0])
    nt.nodes.active = tex
    o.data.materials.clear(); o.data.materials.append(mat)
    activate(o); sc.cycles.samples = samples
    sc.render.bake.margin = 6; sc.render.bake.use_clear = True
    bpy.ops.object.bake(type=kind, use_clear=True, margin=6)
    a = np.array(img.pixels[:], dtype=np.float32).reshape(R, R, 4)[::-1, :, :3]   # row 0 = v 1 (top)
    return a
pos = bake_map(top, 'pos', 'EMIT', 'Position'); log('baked position')
nrm = bake_map(top, 'nrm', 'EMIT', 'Normal'); log('baked normal')
# AO: hide the other LODs so they don't shade it
for l in lods[1:] + [hi]: l.hide_render = True
ao = bake_map(top, 'ao', 'AO', samples=cfg.get('ao_samples', 32)); log('baked AO')
cov = (np.abs(nrm).sum(2) > 0.5)   # texels the bake wrote
np.savez_compressed(os.path.join(out, 'bake.npz'), pos=pos, nrm=nrm, ao=ao[:, :, 0], cov=cov)
# 4. bones: an armature from the creature's bones (heads where they are, tails toward their child)
bones = cfg['bones']; byname = {b['name']: b for b in bones}
kids = {b['name']: [c for c in bones if c['parent'] == b['name']] for b in bones}
arm_d = bpy.data.armatures.new('arm'); arm = bpy.data.objects.new('arm', arm_d); sc.collection.objects.link(arm)
activate(arm); bpy.ops.object.mode_set(mode='EDIT')
from mathutils import Vector
for b in bones:
    eb = arm_d.edit_bones.new(b['name']); h = Vector(b['pos'])
    tail = b.get('tail')
    if tail: t = Vector(tail)
    else:
        ks = [k for k in kids[b['name']] if k['name'] not in cfg.get('no_deform', [])]
        if ks: t = sum((Vector(k['pos']) for k in ks), Vector()) / len(ks)
        else:
            par = byname.get(b['parent']); dirv = (h - Vector(par['pos'])) if par else Vector((0, 0.05, 0))
            if dirv.length < 1e-4: dirv = Vector((0, 0.05, 0))
            t = h + dirv.normalized() * 0.05
        if (t - h).length < 0.01: t = h + Vector((0, 0.03, 0))
    eb.head, eb.tail = h, t
for b in bones:
    if b['parent']: arm_d.edit_bones[b['name']].parent = arm_d.edit_bones[b['parent']]
bpy.ops.object.mode_set(mode='OBJECT')
for b in arm_d.bones: b.use_deform = b.name not in cfg.get('no_deform', [])
# 5. bind and export every LOD
idx = {b['name']: i for i, b in enumerate(bones)}
for li, l in enumerate(lods):
    for x in sc.objects: x.select_set(False)
    l.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    m = l.data; nv = len(m.vertices)
    W = np.zeros((nv, len(bones)), np.float32)
    gname = {g.index: g.name for g in l.vertex_groups}
    for v in m.vertices:
        for g in v.groups:
            n = gname[g.group]
            if n in idx: W[v.index, idx[n]] = g.weight
    unbound = (W.sum(1) < 1e-6).sum()
    P = np.array([v.co[:] for v in m.vertices], np.float32)
    N = np.array([v.normal[:] for v in m.vertices], np.float32)
    uvl = m.uv_layers.active.data; loops = []
    for p in m.polygons:
        assert len(p.loop_indices) == 3
        for k in p.loop_indices: loops.append((m.loops[k].vertex_index, uvl[k].uv[0], uvl[k].uv[1]))
    L = np.array(loops, np.float64)
    np.savez_compressed(os.path.join(out, 'lod%d.npz' % li), P=P, N=N, W=W, loops=L)
    log('lod%d' % li, 'verts', nv, 'tris', len(loops) // 3, 'unbound verts', unbound)
json.dump({'bones': bones, 'lods': [tris(l) for l in lods]}, open(os.path.join(out, 'meta.json'), 'w'))
log('done')
