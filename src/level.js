import { rnd, rr, ri, clamp, srand } from './engine.js';

// =====================================================================
//  LEVEL — the Deep Woods floor, generated exactly the way the 2D Crown
//  builds a floor (rooms + winding corridors on a tile grid), then read
//  in 3D: rooms become clearings, corridors become trails, and wall
//  tiles become forest. 1 tile = 2 m.
// =====================================================================
export const TILE = 2;
export let LV = null; // the current level

const ROOM_TYPES = {
  hall: { enemyMult: 1, lootMult: 1, brazierChance: 0.5 },
  crypt: { enemyMult: 1.5, lootMult: 0.8, brazierChance: 0.3 },
  shrine: { enemyMult: 0.3, lootMult: 2, brazierChance: 0.8 },
  cistern: { enemyMult: 0.5, lootMult: 1.5, brazierChance: 0.4 },
  gallery: { enemyMult: 1, lootMult: 1, brazierChance: 0.6 },
  vault: { enemyMult: 1.2, lootMult: 1.8, brazierChance: 0.2 },
  antechamber: { enemyMult: 0, lootMult: 0.5, brazierChance: 1 },
};

// ---------- tile helpers ----------
export const idx = (x, y) => y * LV.w + x;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < LV.w && y < LV.h;
export const tileAt = (x, y) => (inBounds(x, y) ? LV.tiles[idx(x, y)] : 0);
export const isWalkable = (tx, ty) => inBounds(tx, ty) && LV.tiles[idx(tx, ty)] === 1;
export const toTile = (v) => Math.floor(v / TILE);
export const tileCenter = (t) => (t + 0.5) * TILE;
function setTile(x, y, v) { if (inBounds(x, y)) LV.tiles[idx(x, y)] = v; }
function isOpenArea(tx, ty) { if (!isWalkable(tx, ty)) return false; let c = 0; for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (isWalkable(tx + x, ty + y)) c++; return c >= 6; }

// ---------- carving (ported from the Crown) ----------
function carveRect(x, y, w, h) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setTile(xx, yy, 1); }
function carveCircle(cx, cy, r) { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (Math.hypot(x - cx, y - cy) <= r + 0.3) setTile(x, y, 1); }
function carveEllipse(cx, cy, rx, ry) { for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) { const dx = (x - cx) / rx, dy = (y - cy) / ry; if (dx * dx + dy * dy <= 1.05) setTile(x, y, 1); } }
function carveLShape(x, y, w, h, corner) {
  const hw = Math.ceil(w / 2), hh = Math.ceil(h / 2);
  if (corner === 0) { carveRect(x, y, w, hh); carveRect(x, y, hw, h); }
  else if (corner === 1) { carveRect(x, y, w, hh); carveRect(x + hw, y, hw, h); }
  else if (corner === 2) { carveRect(x, y + hh, w, hh); carveRect(x, y, hw, h); }
  else { carveRect(x, y + hh, w, hh); carveRect(x + hw, y, hw, h); }
}
function carveWindingCorridor(x1, y1, x2, y2) {
  let cx = x1, cy = y1; const dx = x2 > x1 ? 1 : -1, dy = y2 > y1 ? 1 : -1;
  let phase = rnd() < 0.5 ? 'h' : 'v';
  for (let guard = 0; guard < 4000 && (cx !== x2 || cy !== y2); guard++) {
    setTile(cx, cy, 1);
    // trails in the woods are a little wider than the Crown's corridors, so a first-person
    // camera has room to turn: always 2 wide, sometimes 3
    setTile(cx + 1, cy, 1); setTile(cx, cy + 1, 1);
    if (rnd() < 0.35) { setTile(cx - 1, cy, 1); setTile(cx, cy - 1, 1); }
    if (phase === 'h' && cx !== x2) { cx += dx; if (rnd() < 0.15 && cy !== y2) { setTile(cx, cy, 1); cy += dy; if (rnd() < 0.3) phase = 'v'; } }
    else if (phase === 'v' && cy !== y2) { cy += dy; if (rnd() < 0.15 && cx !== x2) { setTile(cx, cy, 1); cx += dx; if (rnd() < 0.3) phase = 'h'; } }
    else if (cx !== x2) { cx += dx; phase = 'h'; }
    else if (cy !== y2) { cy += dy; phase = 'v'; }
    else break;
  }
  setTile(x2, y2, 1);
}
function roomWalkableCenter(r) {
  const cx = Math.floor(r.x + r.w / 2), cy = Math.floor(r.y + r.h / 2);
  if (isWalkable(cx, cy)) return { x: cx, y: cy };
  for (let rad = 1; rad <= Math.max(r.w, r.h); rad++) for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
    if (Math.abs(dx) !== rad && Math.abs(dy) !== rad) continue;
    const tx = cx + dx, ty = cy + dy;
    if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h && isWalkable(tx, ty)) return { x: tx, y: ty };
  }
  return { x: cx, y: cy };
}
function overlapsRoom(x, y, w, h, rooms, pad) { for (const r of rooms) if (x < r.x + r.w + pad && x + w + pad > r.x && y < r.y + r.h + pad && y + h + pad > r.y) return true; return false; }
function randomFloorTileInRoom(r) {
  for (let i = 0; i < 24; i++) { const tx = ri(r.x + 1, r.x + r.w - 2), ty = ri(r.y + 1, r.y + r.h - 2); if (isWalkable(tx, ty)) return { x: tx, y: ty }; }
  return roomWalkableCenter(r);
}
function generateRoomShape(room) {
  const s = room.shape;
  if (s === 'circle') carveCircle(Math.floor(room.x + room.w / 2), Math.floor(room.y + room.h / 2), Math.floor(Math.min(room.w, room.h) / 2));
  else if (s === 'ellipse') carveEllipse(Math.floor(room.x + room.w / 2), Math.floor(room.y + room.h / 2), Math.floor(room.w / 2), Math.floor(room.h / 2));
  else if (s === 'L') carveLShape(room.x, room.y, room.w, room.h, ri(0, 3));
  else if (s === 'cross') { const mw = Math.floor(room.w * 0.4), mh = Math.floor(room.h * 0.4); carveRect(room.x + mw, room.y, room.w - mw * 2, room.h); carveRect(room.x, room.y + mh, room.w, room.h - mh * 2); }
  else carveRect(room.x, room.y, room.w, room.h);
}
function assignRoomType(index, total) {
  if (index === 0 || index === total - 1) return 'antechamber';
  const roll = rnd();
  if (roll < 0.12) return 'shrine'; if (roll < 0.22) return 'cistern'; if (roll < 0.38) return 'crypt';
  if (roll < 0.5) return 'gallery'; if (roll < 0.58) return 'vault'; return 'hall';
}
// clearings in a forest read better round, so the woods bias toward circles and ellipses
function pickRoomShape(type) {
  if (type === 'shrine') return rnd() < 0.6 ? 'circle' : 'ellipse';
  if (type === 'cistern') return 'ellipse';
  if (type === 'gallery') return 'rect';
  if (type === 'crypt') return rnd() < 0.4 ? 'cross' : 'ellipse';
  if (type === 'vault') return rnd() < 0.5 ? 'L' : 'ellipse';
  if (type === 'antechamber') return rnd() < 0.5 ? 'circle' : 'ellipse';
  return ['ellipse', 'ellipse', 'L', 'circle', 'rect'][ri(0, 4)];
}
function roomDimensions(type) {
  if (type === 'gallery') return { w: ri(14, 20), h: ri(7, 9) };
  if (type === 'shrine') return { w: ri(9, 13), h: ri(9, 13) };
  if (type === 'cistern') return { w: ri(10, 14), h: ri(8, 12) };
  if (type === 'crypt') return { w: ri(10, 16), h: ri(10, 16) };
  if (type === 'vault') return { w: ri(9, 14), h: ri(9, 14) };
  if (type === 'antechamber') return { w: ri(8, 11), h: ri(8, 11) };
  return { w: ri(8, 14), h: ri(8, 13) };
}

// the Deep Woods table (2D Crown floor III: bandits, wolves, moths), plus the shade leeches that
// the Crown sends when you favour bright light — they make the lantern matter
function pickEnemyType() { const r = rnd(); return r < 0.4 ? 'wolf' : r < 0.62 ? 'moth' : r < 0.8 ? 'leech' : 'bandit'; }

const at = (tx, ty) => ({ x: (tx + 0.5) * TILE, z: (ty + 0.5) * TILE, tx, ty });
function placeBrazier(tx, ty, lit) { LV.braziers.push({ ...at(tx, ty), lit, radius: lit ? 8 : 0, flicker: rr(0, 6.28), camp: false }); }
function placePickup(type, tx, ty) { LV.pickups.push({ type, ...at(tx, ty), collected: false, bob: rr(0, 6.28) }); }
function placeSecret(type, tx, ty) { LV.secrets.push({ type, ...at(tx, ty), revealed: false, found: false }); }
function addStructure(tx, ty) {
  if (LV.structures.some((s) => Math.abs(s.tx - tx) < 3 && Math.abs(s.ty - ty) < 3)) return;
  LV.structures.push({ ...at(tx, ty), r: 0.9 });
}

function populateRoom(room, isStart, isEnd) {
  const type = room.roomType, def = ROOM_TYPES[type] || ROOM_TYPES.hall, c = roomWalkableCenter(room);
  if (type === 'shrine') {
    LV.decorations.push({ kind: 'stones', ...at(c.x, c.y), r: Math.min(room.w, room.h) * 0.32 * TILE });
    if (isWalkable(c.x - 2, c.y)) placeBrazier(c.x - 2, c.y, rnd() < 0.3);
    if (isWalkable(c.x + 2, c.y)) placeBrazier(c.x + 2, c.y, rnd() < 0.3);
  } else if (type === 'cistern') {
    LV.decorations.push({ kind: 'pond', ...at(c.x, c.y), rx: Math.min(3, Math.floor(room.w / 4)) * TILE, rz: Math.min(2, Math.floor(room.h / 4)) * TILE });
  } else if (type === 'gallery') {
    for (let i = -Math.floor(room.w / 4); i <= Math.floor(room.w / 4); i += 3) {
      const px = c.x + i;
      if (isOpenArea(px, c.y - 2)) addStructure(px, c.y - 2);
      if (isOpenArea(px, c.y + 2)) addStructure(px, c.y + 2);
    }
  } else if (type === 'crypt') {
    for (let i = 0; i < ri(1, 3); i++) { const p = randomFloorTileInRoom(room); if (isOpenArea(p.x, p.y)) LV.decorations.push({ kind: 'cairn', ...at(p.x, p.y), yaw: rr(0, 6.28) }); }
  }
  if (!isStart && rnd() < def.brazierChance) { const p = randomFloorTileInRoom(room); if (isOpenArea(p.x, p.y)) placeBrazier(p.x, p.y, rnd() < 0.16); }
  if (!isStart) {
    const rolls = rnd() < def.lootMult * 0.5 ? 2 : 1;
    for (let i = 0; i < rolls; i++) if (rnd() < 0.55 * def.lootMult) { const p = randomFloorTileInRoom(room); placePickup(rnd() < 0.7 ? 'fuel' : 'health', p.x, p.y); }
  }
  if (!isStart && !isEnd && rnd() < 0.45 * def.lootMult) { const p = randomFloorTileInRoom(room); placeSecret('fuel', p.x, p.y); }
  if (!isStart && !isEnd) {
    const n = rnd() < def.enemyMult * 0.6 ? ri(1, 3) : 0;
    for (let i = 0; i < n; i++) {
      const p = randomFloorTileInRoom(room); if (!isOpenArea(p.x, p.y)) continue;
      const w = at(p.x, p.y); if (Math.hypot(w.x - LV.spawn.x, w.z - LV.spawn.z) < TILE * 9) continue;
      const t = pickEnemyType(); LV.spawns.push({ type: t, x: w.x, z: w.z });
      if (t === 'wolf' && rnd() < 0.5) LV.spawns.push({ type: 'wolf', x: w.x + rr(-1.5, 1.5), z: w.z + rr(-1.5, 1.5) }); // wolves run in pairs
    }
  }
  if ((type === 'hall' || type === 'vault') && room.w >= 10 && room.h >= 10 && rnd() < 0.6) {
    for (let i = 0; i < ri(1, 3); i++) { const p = randomFloorTileInRoom(room); if (isOpenArea(p.x, p.y)) addStructure(p.x, p.y); }
  }
}

export function generateLevel(seedVal) {
  srand(seedVal);
  const w = 78, h = 78;
  LV = {
    w, h, seed: seedVal, name: 'THE DEEP WOODS', numeral: 'III',
    tiles: new Uint8Array(w * h), depth: new Uint8Array(w * h), discovered: new Uint8Array(w * h), visible: new Uint8Array(w * h),
    rooms: [], braziers: [], pickups: [], secrets: [], structures: [], decorations: [], spawns: [], spawn: null, exit: null, camp: null,
  };
  const target = 14, rooms = [];
  for (let att = 0; rooms.length < target && att < target * 14; att++) {
    const type = assignRoomType(rooms.length, target), dims = roomDimensions(type);
    const rx = ri(3, w - dims.w - 4), ry = ri(3, h - dims.h - 4);
    if (overlapsRoom(rx, ry, dims.w, dims.h, rooms, 3)) continue;
    const room = { x: rx, y: ry, w: dims.w, h: dims.h, shape: pickRoomShape(type), roomType: type };
    generateRoomShape(room);
    if (rooms.length) { const a = roomWalkableCenter(rooms[rooms.length - 1]), b = roomWalkableCenter(room); carveWindingCorridor(a.x, a.y, b.x, b.y); }
    rooms.push(room);
  }
  for (let i = 0; i < 3; i++) { // loops
    const a = rooms[ri(0, rooms.length - 1)], b = rooms[ri(0, rooms.length - 1)]; if (a === b) continue;
    const ac = roomWalkableCenter(a), bc = roomWalkableCenter(b); carveWindingCorridor(ac.x, ac.y, bc.x, bc.y);
  }
  // keep a 2-tile ring of forest around the edge
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) setTile(x, y, 0);
  LV.rooms = rooms;
  const sp = roomWalkableCenter(rooms[0]), ep = roomWalkableCenter(rooms[rooms.length - 1]);
  LV.spawn = at(sp.x, sp.y); LV.exit = { ...at(ep.x, ep.y), found: false };
  // connectivity check (BFS from spawn to exit), carve a repair trail if they are cut off
  {
    const seen = new Uint8Array(w * h), q = [idx(sp.x, sp.y)]; seen[q[0]] = 1; let found = false;
    for (let qi = 0; qi < q.length; qi++) {
      const ci = q[qi]; if (ci === idx(ep.x, ep.y)) { found = true; break; }
      const cx = ci % w, cy = (ci / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy; if (!inBounds(nx, ny)) continue; const ni = idx(nx, ny); if (!seen[ni] && LV.tiles[ni] === 1) { seen[ni] = 1; q.push(ni); } }
    }
    if (!found) carveWindingCorridor(sp.x, sp.y, ep.x, ep.y);
  }
  // the bandit camp: one big clearing off the main path, with a campfire
  const big = rooms.filter((r, i) => i > 1 && i < rooms.length - 1 && r.w >= 10 && r.h >= 10);
  const campRoom = big.length ? big[ri(0, big.length - 1)] : null;
  for (let i = 0; i < rooms.length; i++) populateRoom(rooms[i], i === 0, i === rooms.length - 1);
  if (campRoom) {
    const cc = roomWalkableCenter(campRoom), c = at(cc.x, cc.y);
    const inCamp = (s) => { const tx = toTile(s.x), ty = toTile(s.z); return tx >= campRoom.x && tx < campRoom.x + campRoom.w && ty >= campRoom.y && ty < campRoom.y + campRoom.h; };
    LV.spawns = LV.spawns.filter((s) => !inCamp(s));
    LV.braziers = LV.braziers.filter((b) => !inCamp(b));
    placeBrazier(cc.x, cc.y, true); LV.braziers[LV.braziers.length - 1].camp = true;
    LV.camp = c;
    const n = ri(2, 3);
    for (let i = 0; i < n; i++) { const a = (i / n) * 6.283 + rr(-0.3, 0.3); LV.spawns.push({ type: 'bandit', x: c.x + Math.cos(a) * 2.6, z: c.z + Math.sin(a) * 2.6, camp: true }); }
    LV.decorations.push({ kind: 'camp', x: c.x, z: c.z });
  }
  // the last fire: a lit brazier in the first clearing, so you start inside a little light
  { const p = roomWalkableCenter(rooms[0]); for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1]]) if (isOpenArea(p.x + dx, p.y + dy)) { placeBrazier(p.x + dx, p.y + dy, true); break; } }
  // guarantee a cache somewhere in the middle of the floor
  { const mid = rooms.filter((_, i) => i > 1 && i < rooms.length - 1); if (mid.length) { const r = mid[ri(0, mid.length - 1)], p = randomFloorTileInRoom(r); placeSecret('fuel', p.x, p.y); } }
  // wall depth: how many tiles each wall tile is from the nearest clearing or trail (for tree placement)
  {
    const D = LV.depth; D.fill(255); const q = [];
    for (let i = 0; i < w * h; i++) if (LV.tiles[i] === 1) { D[i] = 0; q.push(i); }
    for (let qi = 0; qi < q.length; qi++) {
      const ci = q[qi], cx = ci % w, cy = (ci / w) | 0, d = D[ci];
      if (d >= 7) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = cx + dx, ny = cy + dy; if (!inBounds(nx, ny)) continue; const ni = idx(nx, ny); if (D[ni] > d + 1) { D[ni] = d + 1; q.push(ni); } }
    }
  }
  return LV;
}

// =====================================================================
//  Collision, line of sight, pathfinding (ported from the Crown, in metres)
// =====================================================================
export function collidesCircle(x, z, r) {
  const mnX = Math.floor((x - r) / TILE), mxX = Math.floor((x + r) / TILE), mnY = Math.floor((z - r) / TILE), mxY = Math.floor((z + r) / TILE);
  for (let ty = mnY; ty <= mxY; ty++) for (let tx = mnX; tx <= mxX; tx++) {
    if (!inBounds(tx, ty) || LV.tiles[idx(tx, ty)] === 0) {
      const rx = tx * TILE, ry = ty * TILE, nx = clamp(x, rx, rx + TILE), ny = clamp(z, ry, ry + TILE), dx = x - nx, dy = z - ny;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  for (const s of LV.structures) { const dx = x - s.x, dz = z - s.z, m = r + s.r; if (dx * dx + dz * dz < m * m) return true; }
  return false;
}
// move with sliding: try each axis, then creep in small steps up to the wall
export function moveWithCollisions(ent, vx, vz, dt) {
  const nx = ent.x + vx * dt;
  if (!collidesCircle(nx, ent.z, ent.r)) ent.x = nx;
  else { const s = Math.sign(vx) * 0.05; for (let i = 0; i < Math.abs(vx * dt); i += 0.05) { if (!collidesCircle(ent.x + s, ent.z, ent.r)) ent.x += s; else break; } }
  const nz = ent.z + vz * dt;
  if (!collidesCircle(ent.x, nz, ent.r)) ent.z = nz;
  else { const s = Math.sign(vz) * 0.05; for (let i = 0; i < Math.abs(vz * dt); i += 0.05) { if (!collidesCircle(ent.x, ent.z + s, ent.r)) ent.z += s; else break; } }
}
export function lineOfSight(x1, z1, x2, z2) {
  const d = Math.hypot(x2 - x1, z2 - z1), steps = Math.ceil(d / 0.6);
  for (let i = 1; i < steps; i++) {
    const t = i / steps, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
    if (tileAt(Math.floor(x / TILE), Math.floor(z / TILE)) === 0) return false;
    for (const s of LV.structures) { const dx = x - s.x, dz = z - s.z; if (dx * dx + dz * dz < 0.64) return false; }
  }
  return true;
}
export function findPath(sx, sy, tx, ty, maxN = 420) {
  if (!inBounds(sx, sy) || !isWalkable(tx, ty)) return null;
  const start = idx(sx, sy), goal = idx(tx, ty); if (start === goal) return [];
  const sz = LV.w * LV.h, gS = new Float32Array(sz).fill(1e9), fS = new Float32Array(sz).fill(1e9), par = new Int32Array(sz).fill(-1), inO = new Uint8Array(sz);
  gS[start] = 0; fS[start] = Math.abs(tx - sx) + Math.abs(ty - sy); const open = [start]; inO[start] = 1;
  const blocked = new Set(LV.structures.map((s) => idx(s.tx, s.ty)));
  for (let nodes = 0; open.length && nodes < maxN; nodes++) {
    let bi = 0, bn = open[0], bf = fS[bn];
    for (let i = 1; i < open.length; i++) if (fS[open[i]] < bf) { bf = fS[open[i]]; bn = open[i]; bi = i; }
    open.splice(bi, 1); inO[bn] = 0; if (bn === goal) break;
    const cx = bn % LV.w, cy = (bn / LV.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy; if (!isWalkable(nx, ny)) continue;
      const ni = idx(nx, ny); if (blocked.has(ni)) continue;
      const tent = gS[bn] + 1;
      if (tent < gS[ni]) { par[ni] = bn; gS[ni] = tent; fS[ni] = tent + Math.abs(tx - nx) + Math.abs(ty - ny); if (!inO[ni]) { open.push(ni); inO[ni] = 1; } }
    }
  }
  if (par[goal] === -1) return null;
  const path = []; let cur = goal;
  for (let g = 0; cur !== start && cur !== -1 && g < 256; g++) { path.push({ x: tileCenter(cur % LV.w), z: tileCenter((cur / LV.w) | 0) }); cur = par[cur]; }
  return path.reverse();
}
