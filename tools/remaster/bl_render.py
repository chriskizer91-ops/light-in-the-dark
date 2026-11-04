# Blender: render a mesh (obj or glb) from the side, front, back, top and three-quarter, to compare with its sheet.
# usage: python bl_render.py mesh out.png [texture.png]
import bpy, sys, math, os
from mathutils import Vector
args = sys.argv[1:]
path, out = args[0], args[1]; tex = args[2] if len(args) > 2 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
if path.endswith('.obj'): bpy.ops.wm.obj_import(filepath=path, forward_axis='NEGATIVE_Y', up_axis='Z')
else: bpy.ops.import_scene.gltf(filepath=path)
ob = [o for o in sc.objects if o.type == 'MESH'][0]
# the game's frame: x left, y up, z forward  ->  Blender: x, -z?  keep it simple: import as y-up
ob.rotation_euler = (math.radians(90), 0, 0) if path.endswith('.obj') else ob.rotation_euler
bpy.context.view_layer.update()
sc.render.engine = 'BLENDER_WORKBENCH'
sh = sc.display.shading; sh.light = 'STUDIO'; sh.show_backface_culling = False
if tex:
    sh.color_type = 'TEXTURE'
    mat = bpy.data.materials.new('m'); mat.use_nodes = True
    im = bpy.data.images.load(tex); n = mat.node_tree.nodes.new('ShaderNodeTexImage'); n.image = im
    mat.node_tree.links.new(n.outputs[0], mat.node_tree.nodes['Principled BSDF'].inputs[0]); ob.data.materials.clear(); ob.data.materials.append(mat)
else:
    sh.color_type = 'SINGLE'; sh.single_color = (0.62, 0.6, 0.56)
sh.show_cavity = True
bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
lo = Vector((min(p.x for p in bb), min(p.y for p in bb), min(p.z for p in bb))); hi = Vector((max(p.x for p in bb), max(p.y for p in bb), max(p.z for p in bb)))
c = (lo + hi) / 2; size = max(hi - lo)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
sc.render.resolution_x = sc.render.resolution_y = 700
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.75, 0.75, 0.75)
shots = []
# Blender after the rotation: game x -> x, game y -> z (up), game z -> -y.  Views like the sheet:
views = {'side': ((1, 0, 0), (0, 0, 1)),   # camera on game +x (the wolf's left): left profile
         'front': ((0, -1, 0), (0, 0, 1)),  # camera in front (game +z = blender -y)
         'back': ((0, 1, 0), (0, 0, 1)), 'top': ((0, 0, 1), (0, 1, 0)), 'tq': ((0.75, -0.75, 0.45), (0, 0, 1))}
import mathutils
for name, (d, up) in views.items():
    d = Vector(d).normalized(); cam.location = c + d * size * 3
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y' if name != 'top' else 'Y').to_euler()
    if name == 'top': cam.rotation_euler = mathutils.Euler((0, 0, math.pi), 'XYZ')
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = size * 1.08
    f = out.replace('.png', '_' + name + '.png'); sc.render.filepath = f; bpy.ops.render.render(write_still=True); shots.append(f)
print('rendered', shots)
