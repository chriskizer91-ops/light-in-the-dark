# a baked LOD (npz) as an OBJ with UVs, for checking renders
import sys, numpy as np
L = np.load(sys.argv[1]); P = L['P']; lo = L['loops']
with open(sys.argv[2], 'w') as o:
    o.write(''.join('v %.5f %.5f %.5f\n' % tuple(p) for p in P))
    o.write(''.join('vt %.6f %.6f\n' % (u, v) for _, u, v in lo))
    for t in range(len(lo) // 3):
        a, b, c = [int(lo[t * 3 + k, 0]) + 1 for k in range(3)]
        o.write('f %d/%d %d/%d %d/%d\n' % (a, t * 3 + 1, b, t * 3 + 2, c, t * 3 + 3))
