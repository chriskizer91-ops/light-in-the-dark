# Blender (bpy): a procedural rig's textured body (exported by rigExport) -> one UV layout, baked.
# Its triangles are welded, unwrapped, and every per-corner projection UV (uvF, uvS, uvT, the weights uvW) is
# baked into the layout along with the surface position, normal and ambient occlusion; its own skin is kept.
# usage: python bl_rebake.py <dir with export.json> [bake size]
import bpy, bmesh, sys, json, os, math, time, numpy as np
d = sys.argv[1]; R = int(sys.argv[2]) if len(sys.argv) > 2 else 2048; t0 = time.time()
VOX = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0; TARGET = int(sys.argv[4]) if len(sys.argv) > 4 else 0   # optional: a watertight remesh (closes the cracks between lofted pieces)
def log(*a): print('[%5.1fs]' % (time.time() - t0), *a, flush=True)
E = json.load(open(os.path.join(d, 'export.json')))
P = np.array(E['pos'], np.float32).reshape(-1, 3); N = np.array(E['nrm'], np.float32).reshape(-1, 3); n = len(P)
SI = np.array(E['si']).reshape(-1, 4); SW = np.array(E['sw'], np.float32).reshape(-1, 4); bones = [b['name'] for b in E['def']]
bpy.ops.wm.read_factory_settings(use_empty=True); sc = bpy.context.scene
me = bpy.data.meshes.new('body'); me.from_pydata(P.tolist(), [], [(i, i + 1, i + 2) for i in range(0, n, 3)]); me.update()
ob = bpy.data.objects.new('body', me); sc.collection.objects.link(ob)
for name, k in (('uvF', 2), ('uvS', 2), ('uvT', 2), ('uvW', 3)):
    if name not in E: continue
    A = np.array(E[name], np.float32).reshape(-1, k)
    at = me.attributes.new(name, 'FLOAT_VECTOR', 'CORNER'); full = np.zeros((n, 3), np.float32); full[:, :k] = A
    at.data.foreach_set('vector', full.ravel())   # corner i is vertex i (a triangle soup)
me.normals_split_custom_set([tuple(v) for v in N])
for b in bones: ob.vertex_groups.new(name=b)
for i in range(n):
    for j in range(4):
        if SW[i, j] > 1e-4: ob.vertex_groups[int(SI[i, j])].add([i], float(SW[i, j]), 'ADD')
log('built', n // 3, 'tris')
# weld (the procedural pieces are triangle soups), keeping the per-corner data and the custom normals
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=1e-5)
if VOX > 0:
    # remesh into one closed surface, then carry the projection UVs, normals and skin over from the original
    bpy.ops.object.mode_set(mode='OBJECT')
    src = ob.copy(); src.data = me.copy(); sc.collection.objects.link(src); src.hide_render = True
    m = ob.modifiers.new('r', 'REMESH'); m.mode = 'VOXEL'; m.voxel_size = VOX; m.adaptivity = 0.0
    bpy.ops.object.modifier_apply(modifier=m.name)
    if TARGET:
        m = ob.modifiers.new('d', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = min(1.0, TARGET / max(1, len(ob.data.polygons))); m.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=m.name)
    me = ob.data
    for name in ('uvF', 'uvS', 'uvT', 'uvW'):
        if name in E and name not in me.attributes: me.attributes.new(name, 'FLOAT_VECTOR', 'CORNER')
    dt = ob.modifiers.new('t', 'DATA_TRANSFER'); dt.object = src
    dt.use_vert_data = True; dt.data_types_verts = {'VGROUP_WEIGHTS'}; dt.vert_mapping = 'POLYINTERP_NEAREST'
    dt.use_loop_data = True; dt.data_types_loops = {'COLOR_CORNER'} if False else set(); dt.loop_mapping = 'POLYINTERP_NEAREST'
    bpy.ops.object.datalayout_transfer(modifier=dt.name); bpy.ops.object.modifier_apply(modifier=dt.name)
    # the corner vectors (Blender's transfer does not take generic attributes): nearest point on the original, barycentric
    from mathutils.bvhtree import BVHTree
    from mathutils import Vector
    bvh = BVHTree.FromObject(src, bpy.context.evaluated_depsgraph_get()); sm = src.data
    sv = {nm: np.array([a.vector[:] for a in sm.attributes[nm].data]) for nm in ('uvF', 'uvS', 'uvT', 'uvW') if nm in sm.attributes}
    tris = [tuple(p.loop_indices) for p in sm.polygons]; tv = [tuple(p.vertices) for p in sm.polygons]
    vals = {nm: np.zeros((len(me.loops), 3), np.float32) for nm in sv}
    for p in me.polygons:
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            hit = bvh.find_nearest(co)
            if hit[0] is None: continue
            fi = hit[2]; a, b, c = [sm.vertices[i].co for i in tv[fi]]
            from mathutils.geometry import barycentric_transform
            # barycentric weights of the hit point in the source triangle
            v0, v1, v2 = b - a, c - a, hit[0] - a; d00, d01, d11, d20, d21 = v0.dot(v0), v0.dot(v1), v1.dot(v1), v2.dot(v0), v2.dot(v1)
            den = d00 * d11 - d01 * d01 or 1e-12; wv = (d11 * d20 - d01 * d21) / den; ww = (d00 * d21 - d01 * d20) / den; wu = 1 - wv - ww
            L = tris[fi]
            for nm in sv: vals[nm][li] = sv[nm][L[0]] * wu + sv[nm][L[1]] * wv + sv[nm][L[2]] * ww
    for nm in vals: me.attributes[nm].data.foreach_set('vector', vals[nm].ravel())
    bpy.data.objects.remove(src)
    for pl in me.polygons: pl.use_smooth = True
    log('remeshed watertight:', len(me.vertices), 'verts', len(me.polygons), 'tris')
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, scale_to_bounds=False)
try: bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
except Exception as e: log('pack failed', e)
bpy.ops.object.mode_set(mode='OBJECT'); log('welded and unwrapped:', len(me.vertices), 'verts')
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
def bake(name, socket=None, attr=None, samples=1, kind='EMIT'):
    img = bpy.data.images.new(name, R, R, float_buffer=True, alpha=False)
    mat = bpy.data.materials.new(name); mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    if kind == 'EMIT':
        em = nt.nodes.new('ShaderNodeEmission')
        if attr: a = nt.nodes.new('ShaderNodeAttribute'); a.attribute_name = attr; nt.links.new(a.outputs['Vector'], em.inputs[0])
        else: g = nt.nodes.new('ShaderNodeNewGeometry'); nt.links.new(g.outputs[socket], em.inputs[0])
        nt.links.new(em.outputs[0], out.inputs[0])
    else:
        bs = nt.nodes.new('ShaderNodeBsdfDiffuse'); nt.links.new(bs.outputs[0], out.inputs[0])
    nt.nodes.active = tex; me.materials.clear(); me.materials.append(mat)
    sc.cycles.samples = samples; bpy.ops.object.bake(type=kind, use_clear=True, margin=4)
    return np.array(img.pixels[:], np.float32).reshape(R, R, 4)[::-1, :, :3]
maps = {'pos': bake('pos', 'Position'), 'nrm': bake('nrm', 'Normal')}
for a in ('uvF', 'uvS', 'uvT', 'uvW'):
    if a in E: maps[a] = bake(a, attr=a)
log('baked attributes')
maps['ao'] = bake('ao', samples=24, kind='AO')[:, :, 0]; log('baked AO')
maps['cov'] = np.abs(maps['nrm']).sum(2) > 0.5
np.savez_compressed(os.path.join(d, 'bake.npz'), **maps)
# export like bl_process: per-vertex position, normal (mean of its corners), bone weights, and the loops' UVs
V = np.array([v.co[:] for v in me.vertices], np.float32); nv = len(V)
me.calc_normals_split() if hasattr(me, 'calc_normals_split') else None
Nv = np.zeros((nv, 3), np.float32); cn = np.array([c.vector[:] for c in me.corner_normals], np.float32) if hasattr(me, 'corner_normals') else None
uvl = me.uv_layers.active.data; loops = []
for p in me.polygons:
    for k in p.loop_indices:
        vi = me.loops[k].vertex_index; loops.append((vi, uvl[k].uv[0], uvl[k].uv[1]))
        Nv[vi] += cn[k] if cn is not None else me.loops[k].normal
Nv /= np.maximum(1e-6, np.linalg.norm(Nv, axis=1, keepdims=True))
W = np.zeros((nv, len(bones)), np.float32)
for v in me.vertices:
    for g in v.groups: W[v.index, g.group] = g.weight
np.savez_compressed(os.path.join(d, 'lod0.npz'), P=V, N=Nv, W=W, loops=np.array(loops, np.float64))
json.dump({'bones': E['def'], 'lods': [len(me.polygons)]}, open(os.path.join(d, 'meta.json'), 'w'))
log('exported', nv, 'verts', len(me.polygons), 'tris; unbound', int((W.sum(1) < 1e-6).sum()))
