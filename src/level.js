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
// Floor IV (the 2D Crown's dl4 table): wax sentinels, leeches, moths, gloom hounds
function pickEnemyType() {
  const r = rnd();
  if (LV.floor === 2) return r < 0.7 ? 'wolf' : 'moth'; // the Gray Forest (2D floor II): wolves, and the moths that drink light
  if (LV.floor === 4) return r < 0.25 ? 'sentinel' : r < 0.55 ? 'leech' : r < 0.8 ? 'moth' : 'hound';
  return r < 0.4 ? 'wolf' : r < 0.62 ? 'moth' : r < 0.8 ? 'leech' : 'bandit';
}

const at = (tx, ty) => ({ x: (tx + 0.5) * TILE, z: (ty + 0.5) * TILE, tx, ty });
function placeBrazier(tx, ty, lit) { LV.braziers.push({ ...at(tx, ty), lit, radius: lit ? 8 : 0, flicker: rr(0, 6.28), camp: false }); }
function placePickup(type, tx, ty) { LV.pickups.push({ type, ...at(tx, ty), collected: false, bob: rr(0, 6.28) }); }
function placeSecret(type, tx, ty) { LV.secrets.push({ type, ...at(tx, ty), revealed: false, found: false }); }
function addStructure(tx, ty, kind = 'elder', extra = {}) {
  if (LV.structures.some((s) => Math.abs(s.tx - tx) < 3 && Math.abs(s.ty - ty) < 3)) return null;
  const s = { ...at(tx, ty), r: 0.9, kind, ...extra }; LV.structures.push(s); return s;
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
    const n = rnd() < def.enemyMult * (LV.floor === 2 ? 0.45 : 0.6) ? ri(1, LV.floor === 2 ? 2 : 3) : 0;
    for (let i = 0; i < n; i++) {
      const p = randomFloorTileInRoom(room); if (!isOpenArea(p.x, p.y)) continue;
      const w = at(p.x, p.y); if (Math.hypot(w.x - LV.spawn.x, w.z - LV.spawn.z) < TILE * 9) continue;
      const t = pickEnemyType(); LV.spawns.push({ type: t, x: w.x, z: w.z, face: Math.atan2(c.y - p.y, c.x - p.x) });
      if (t === 'wolf' && rnd() < (LV.floor === 2 ? 0.35 : 0.5)) LV.spawns.push({ type: 'wolf', x: w.x + rr(-1.5, 1.5), z: w.z + rr(-1.5, 1.5) }); // wolves run in pairs
    }
  }
  if (LV.floor >= 2 && LV.floor <= 3 && (type === 'hall' || type === 'vault') && room.w >= 10 && room.h >= 10 && rnd() < 0.6) {
    for (let i = 0; i < ri(1, 3); i++) { const p = randomFloorTileInRoom(room); if (isOpenArea(p.x, p.y)) addStructure(p.x, p.y); }
  }
}

export function generateLevel(seedVal, floor = 3) {
  srand(seedVal);
  if (floor === 1) generateVillage(seedVal);
  else if (floor === 4) generateRuins(seedVal);
  else generateWoods(seedVal, floor);
  if (!LV.npcs) LV.npcs = [];
  if (!LV.trails) LV.trails = [];
  return LV;
}
// Floors II and III: the Gray Forest and the Deep Woods, both the 2D Crown's standard floor read as forest
function generateWoods(seedVal, floor) {
  const w = 78, h = 78, gray = floor === 2;
  LV = {
    w, h, seed: seedVal, floor, solid: false, name: gray ? 'THE GRAY FOREST' : 'THE DEEP WOODS', numeral: gray ? 'II' : 'III', story: null, holeTiles: [], npcs: [],
    tiles: new Uint8Array(w * h), depth: new Uint8Array(w * h), discovered: new Uint8Array(w * h), visible: new Uint8Array(w * h),
    rooms: [], braziers: [], pickups: [], secrets: [], structures: [], decorations: [], spawns: [], spawn: null, exit: null, camp: null,
  };
  const target = gray ? 12 : 14, rooms = [];
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
  const big = gray ? [] : rooms.filter((r, i) => i > 1 && i < rooms.length - 1 && r.w >= 10 && r.h >= 10);
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
    // their leader stands by the fire between two of them, and does the talking when you walk up (the 2D Crown's bandit_encounter)
    for (const k of [0.5, 1.5, 2.5, 0.25, 0.75]) { const a = (k / n) * 6.283, x = c.x + Math.cos(a) * 2.2, z = c.z + Math.sin(a) * 2.2; if (isWalkable(toTile(x), toTile(z))) { LV.npcs.push({ id: 'leader', x, z, face: a }); LV.campHold = true; break; } }
  }
  // the last fire: a lit brazier in the first clearing, so you start inside a little light
  { const p = roomWalkableCenter(rooms[0]); for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1]]) if (isOpenArea(p.x + dx, p.y + dy)) { placeBrazier(p.x + dx, p.y + dy, true); break; } }
  // guarantee a cache somewhere in the middle of the floor
  { const mid = rooms.filter((_, i) => i > 1 && i < rooms.length - 1); if (mid.length) { const r = mid[ri(0, mid.length - 1)], p = randomFloorTileInRoom(r); placeSecret('fuel', p.x, p.y); } }
  // the Gray Forest: a girl hiding in a clearing off the main path (the 2D Crown's second-to-last room)
  if (gray && rooms.length > 3) {
    const r = rooms[rooms.length - 2], c = roomWalkableCenter(r), g = at(c.x, c.y);
    LV.npcs.push({ id: 'girl', x: g.x, z: g.z, face: 0 });
    LV.spawns = LV.spawns.filter((q) => Math.hypot(q.x - g.x, q.z - g.z) > 9);
    LV.decorations.push({ kind: 'log', x: g.x - 1.1, z: g.z - 0.9, yaw: rr(0, 6.28) });
  }
  computeDepth();
  computeTrails(rooms.map((r) => roomWalkableCenter(r)), true);
  return LV;
}
// =====================================================================
//  TRAILS — the worn path through an outdoor floor. A cheapest-path search
//  over the walkable tiles that prefers the middle of a trail (cost rises
//  near the trees): the main trail runs from where you start to the way
//  out, and a fainter branch leaves it for every clearing. World3d lays
//  packed earth along them; the main one gets marker posts and cairns.
// =====================================================================
function trailCosts() {
  const { w, h } = LV, wd = new Int16Array(w * h).fill(-1), q = [];
  for (let i = 0; i < w * h; i++) if (LV.tiles[i] !== 1) { wd[i] = 0; q.push(i); }
  for (let qi = 0; qi < q.length; qi++) { const c = q[qi], cx = c % w, cy = (c / w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy; if (!inBounds(nx, ny)) continue; const n = idx(nx, ny); if (wd[n] < 0) { wd[n] = wd[c] + 1; q.push(n); } } }
  return wd;
}
function dijkstra(sources, wd) {
  const { w, h } = LV, dist = new Float64Array(w * h).fill(1e9), from = new Int32Array(w * h).fill(-1), heap = [];
  const push = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  for (const i of sources) { dist[i] = 0; push(0, i); }
  while (heap.length) {
    const [d, c] = pop(); if (d > dist[c]) continue; const cx = c % w, cy = (c / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy; if (!isWalkable(nx, ny)) continue; const n = idx(nx, ny), nd = d + 1 + 2.5 / (1 + wd[n]);
      if (nd < dist[n]) { dist[n] = nd; from[n] = c; push(nd, n); }
    }
  }
  return { dist, from };
}
const tileToWorld = (i) => [((i % LV.w) + 0.5) * TILE, (((i / LV.w) | 0) + 0.5) * TILE];
function traceTo(from, i) { const out = []; for (let k = i; k >= 0; k = from[k]) out.push(k); return out; }
// stops: tile points the trail should reach ({x, y}); the first is the start, the last the way out
function computeTrails(stops, markers) {
  const wd = trailCosts(), s0 = idx(toTile(LV.spawn.x), toTile(LV.spawn.z)), e0 = idx(toTile(LV.exit.x), toTile(LV.exit.z));
  const a = dijkstra([s0], wd); if (a.dist[e0] >= 1e9) return;
  const main = traceTo(a.from, e0).reverse(), onMain = new Set(main);
  LV.trails = [{ main: true, pts: main.map(tileToWorld) }];
  const b = dijkstra(main, wd), done = new Set();
  for (const st of stops) {
    const t = idx(st.x, st.y); if (!isWalkable(st.x, st.y) || onMain.has(t) || done.has(t) || b.dist[t] >= 1e9) continue;
    const path = traceTo(b.from, t).reverse(); if (path.length < 3) continue; // starts on the main trail
    done.add(t); LV.trails.push({ main: false, pts: path.map(tileToWorld) });
  }
  if (!markers) return;
  // marker posts along the main trail (on its right-hand side, every ~20 m) and a cairn where a branch leaves it
  let acc = 0;
  for (let i = 3; i < main.length - 3; i++) {
    acc += TILE; if (acc < 20) continue;
    const [x0, z0] = tileToWorld(main[i - 1]), [x1, z1] = tileToWorld(main[i + 1]), dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1;
    const [x, z] = tileToWorld(main[i]), px = x - (dz / L) * 1.5, pz = z + (dx / L) * 1.5;
    if (!isWalkable(toTile(px), toTile(pz))) continue;
    LV.decorations.push({ kind: 'post', x: px, z: pz, yaw: Math.atan2(dx, dz) }); acc = 0;
  }
  for (const tr of LV.trails) if (!tr.main) {
    const [x, z] = tr.pts[1], [x2, z2] = tr.pts[0], ox = x + (x - x2) * 0.2 + 1.3, oz = z + (z - z2) * 0.2;
    if (isWalkable(toTile(ox), toTile(oz)) && !LV.decorations.some((d) => Math.hypot(d.x - ox, d.z - oz) < 4)) LV.decorations.push({ kind: 'cairn', x: ox, z: oz, yaw: rr(0, 6.28), small: true });
  }
}

// =====================================================================
//  FLOOR I — ASH HOLLOW. The 2D Crown's village, tile for tile: a central
//  square with the well and its fire, three houses off it, Farmer Ged's
//  field to the south, and the eastern gate where Lyn keeps watch. No
//  enemies; the lantern stays Steady and burns no oil here.
// =====================================================================
function generateVillage(seedVal) {
  const w = 48, h = 48;
  LV = {
    w, h, seed: seedVal, floor: 1, solid: false, name: 'ASH HOLLOW', numeral: 'I', story: null, holeTiles: [], npcs: [],
    tiles: new Uint8Array(w * h), depth: new Uint8Array(w * h), discovered: new Uint8Array(w * h), visible: new Uint8Array(w * h),
    rooms: [], braziers: [], pickups: [], secrets: [], structures: [], decorations: [], spawns: [], spawn: null, exit: null, camp: null, village: null,
  };
  carveRect(17, 17, 14, 14);                                              // the square
  carveRect(10, 10, 6, 6); carveWindingCorridor(13, 16, 20, 20);         // NW house (the elder's)
  carveRect(32, 10, 6, 6); carveWindingCorridor(35, 16, 28, 20);         // NE house
  carveRect(10, 32, 6, 6); carveWindingCorridor(13, 32, 20, 28);         // SW house
  carveRect(30, 34, 10, 8); carveWindingCorridor(33, 34, 28, 30);        // Ged's field
  carveRect(34, 22, 10, 4); carveRect(30, 22, 5, 4);                      // the road to the eastern gate
  const R = (x, y, rw, rh) => ({ x, y, w: rw, h: rh, roomType: 'hall', shape: 'rect' });
  const square = R(17, 17, 14, 14), nw = R(10, 10, 6, 6), ne = R(32, 10, 6, 6), sw = R(10, 32, 6, 6), field = R(30, 34, 10, 8);
  LV.rooms = [square, nw, ne, sw, field];
  // the houses in the three yards (their back half is the house itself)
  const houses = [];
  const house = (x0, y0, tw, td, door) => { for (let y = y0; y < y0 + td; y++) for (let x = x0; x < x0 + tw; x++) setTile(x, y, 0); houses.push({ x: (x0 + tw / 2) * TILE, z: (y0 + td / 2) * TILE, w: tw * TILE, d: td * TILE, door, main: true }); };
  house(10, 10, 4, 3, 2); house(33, 10, 4, 3, 2); house(10, 35, 4, 3, 3);
  // more houses facing the square and the gate road, wherever there is a clean 4x3 lot of open ground
  const lot = (x0, y0, tw, td, door) => {
    for (let y = y0 - 1; y <= y0 + td; y++) for (let x = x0 - 1; x <= x0 + tw; x++) {
      if (!inBounds(x, y)) return false;
      const inLot = x >= x0 && x < x0 + tw && y >= y0 && y < y0 + td, front = (door === 2 && y === y0 + td) || (door === 3 && y === y0 - 1) || (door === 0 && x === x0 + tw) || (door === 1 && x === x0 - 1);
      if ((inLot || !front) && tileAt(x, y) === 1) return false;
    }
    return !houses.some((o) => Math.abs(o.x - (x0 + tw / 2) * TILE) < (o.w + tw * TILE) / 2 + TILE && Math.abs(o.z - (y0 + td / 2) * TILE) < (o.d + td * TILE) / 2 + TILE);
  };
  const tryRow = (fixed, from, to, horiz, door) => { for (let k = from; k <= to; k++) { const [x0, y0, tw, td] = horiz ? [k, fixed, 4, 3] : [fixed, k, 3, 4]; if (lot(x0, y0, tw, td, door)) { houses.push({ x: (x0 + tw / 2) * TILE, z: (y0 + td / 2) * TILE, w: tw * TILE, d: td * TILE, door }); k += tw; } } };
  tryRow(14, 17, 27, true, 2); tryRow(31, 17, 27, true, 3); tryRow(14, 17, 27, false, 0); tryRow(31, 26, 29, false, 1);
  tryRow(19, 34, 40, true, 2); tryRow(26, 35, 40, true, 3);
  // the well and its fire, Sev's stall, Ged's cart sunk in the field
  LV.structures.push({ ...at(24, 23), r: 1.05, kind: 'vwell' });
  placeBrazier(24, 26, true);
  const stall = { x: 26.5 * TILE, z: 17.35 * TILE, r: 0.9, kind: 'stall' }; LV.structures.push(stall);
  const cart = { ...at(36, 38), r: 1.15, kind: 'cart' }; LV.structures.push(cart);
  LV.spawn = at(24, 28);
  LV.exit = { ...at(43, 24), found: true, gate: true };
  LV.npcs.push({ id: 'maren', ...at(22, 20), face: Math.atan2(24 - 20, 24 - 22) });
  LV.npcs.push({ id: 'sev', ...at(26, 19), face: Math.PI / 2 });
  LV.npcs.push({ id: 'lyn', ...at(38, 23), face: Math.PI });
  LV.npcs.push({ id: 'ged', ...at(34, 38), face: 0 });
  placePickup('health', 20, 24); placePickup('fuel', 28, 24);
  LV.village = { houses, square, field, stall, cart, gate: { x: 44 * TILE, z0: 22 * TILE, z1: 26 * TILE } };
  computeDepth();
  computeTrails([roomWalkableCenter(nw), roomWalkableCenter(ne), roomWalkableCenter(sw), roomWalkableCenter(field), { x: 22, y: 21 }, { x: 26, y: 20 }], false);
  return LV;
}

// =====================================================================
//  FLOOR IV — THE EASTERN RUINS (OUTER). The 2D Crown's hand-built layout:
//  an antechamber, a central hub, then a fork. West: the binding chamber
//  where Sera is chained. East: the Guardian Hall. Both wings run down to
//  the exit room. Finish one wing and the other one collapses.
// =====================================================================
const rect = (x, y, w, h) => ({ x, y, w, h });
export const inRect = (r, tx, ty) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;
// a pillar, statue or fallen drum in the ruins (closer spacing than the woods' elders)
function addRuin(tx, ty, kind, extra = {}) {
  if (!isWalkable(tx, ty) || LV.structures.some((s) => Math.abs(s.tx - tx) < 2 && Math.abs(s.ty - ty) < 2)) return null;
  const s = { ...at(tx, ty), r: 0.62, kind, ...extra }; LV.structures.push(s); return s;
}
// wall faces along one side of a rect room: [{tx, ty, dir}] where dir points from the wall tile to the floor
// (0 +x, 1 -x, 2 +z, 3 -z); only faces with wall on both neighbours, so nothing sits in a doorway
function sideFaces(r, side) {
  const out = [];
  const push = (wx, wy, fx, fy, dir, ax, ay) => { if (tileAt(wx, wy) === 0 && isWalkable(fx, fy) && tileAt(wx - ax, wy - ay) === 0 && tileAt(wx + ax, wy + ay) === 0) out.push({ tx: wx, ty: wy, dir }); };
  if (side === 'n') for (let x = r.x + 1; x < r.x + r.w - 1; x++) push(x, r.y - 1, x, r.y, 2, 1, 0);
  if (side === 's') for (let x = r.x + r.w - 2; x > r.x; x--) push(x, r.y + r.h, x, r.y + r.h - 1, 3, 1, 0);
  if (side === 'e') for (let y = r.y + 1; y < r.y + r.h - 1; y++) push(r.x + r.w, y, r.x + r.w - 1, y, 1, 0, 1);
  if (side === 'w') for (let y = r.y + r.h - 2; y > r.y; y--) push(r.x - 1, y, r.x, y, 0, 0, 1);
  return out; // ordered left to right for someone facing that wall
}
// n faces spread along the first side that has room for them
function spreadFaces(r, sides, n, gap) {
  // first choice: not directly behind a pillar or a statue (you could never see them), well spaced
  for (const [g, avoid] of [[gap, true], [2, true], [2, false]]) for (const side of sides) {
    const f = sideFaces(r, side).filter((fc) => !avoid || !LV.structures.some((s) => (fc.dir >= 2 ? s.tx === fc.tx && Math.abs(s.ty - fc.ty) <= 5 : s.ty === fc.ty && Math.abs(s.tx - fc.tx) <= 5)));
    if (f.length < n) continue;
    const pick = [], step = Math.max(g, Math.floor(f.length / n)), start = Math.max(0, Math.floor((f.length - step * (n - 1)) / 2));
    for (let i = 0; i < n; i++) { const k = start + i * step; if (f[k]) pick.push(f[k]); }
    if (pick.length === n) return pick;
  }
  return null;
}
function generateRuins(seedVal) {
  const w = 96, h = 96;
  LV = {
    w, h, seed: seedVal, floor: 4, solid: true, name: 'THE EASTERN RUINS', numeral: 'IV',
    tiles: new Uint8Array(w * h), depth: new Uint8Array(w * h), discovered: new Uint8Array(w * h), visible: new Uint8Array(w * h),
    rooms: [], braziers: [], pickups: [], secrets: [], structures: [], decorations: [], spawns: [], spawn: null, exit: null, camp: null, story: {},
  };
  // the layout, exactly as the 2D Crown carves it
  carveRect(44, 4, 8, 8);                                              // entrance antechamber
  carveRect(40, 16, 16, 10); carveWindingCorridor(48, 12, 48, 16);     // central hub
  carveRect(38, 26, 4, 8); carveRect(18, 30, 16, 12); carveWindingCorridor(40, 26, 26, 32);   // west: the spirit wing
  carveRect(10, 46, 14, 12); carveWindingCorridor(18, 42, 16, 46);     // Sera's chamber
  carveRect(54, 26, 4, 8); carveRect(62, 30, 16, 12); carveWindingCorridor(56, 26, 70, 32);   // east: the guardian wing
  carveRect(66, 46, 14, 12); carveWindingCorridor(72, 42, 72, 46);     // the Guardian Hall
  carveRect(38, 70, 20, 10); carveWindingCorridor(16, 58, 44, 70); carveWindingCorridor(72, 58, 52, 70); // both wings run down to the exit
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) setTile(x, y, 0);
  const R = (x, y, rw, rh, roomType) => ({ x, y, w: rw, h: rh, roomType, shape: 'rect' });
  const rooms = [R(44, 4, 8, 8, 'antechamber'), R(40, 16, 16, 10, 'hall'), R(18, 30, 16, 12, 'hall'), R(10, 46, 14, 12, 'shrine'), R(62, 30, 16, 12, 'hall'), R(66, 46, 14, 12, 'vault'), R(38, 70, 20, 10, 'hall')];
  LV.rooms = rooms;
  LV.spawn = at(48, 8); LV.exit = { x: 49 * TILE, z: 76 * TILE, tx: 49, ty: 76, found: false };
  LV.holeTiles = [idx(48, 75), idx(49, 75), idx(48, 76), idx(49, 76)];
  LV.structures.push({ x: LV.exit.x, z: LV.exit.z, tx: 49, ty: 76, r: 1.75, kind: 'well' });
  const [ante, hub, west1, sera, east1, hall, exitR] = rooms;
  // the tiles each wing loses when the other is finished: the passage under the hub and the mouth of its lower corridor
  const collect = (boxes, keep) => {
    const out = [], seen = new Set();
    for (const b of boxes) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      if (!isWalkable(x, y) || keep.some((r) => inRect(r, x, y)) || seen.has(idx(x, y))) continue; seen.add(idx(x, y)); out.push({ x, y });
    }
    return out;
  };
  LV.story.branches = {
    spirit: collect([rect(33, 24, 11, 12), rect(8, 57, 20, 5)], [hub, west1, sera]),
    guardian: collect([rect(52, 24, 11, 12), rect(62, 57, 21, 5)], [hub, east1, hall]),
  };
  LV.story.rooms = { ante, hub, west1, sera, east1, hall, exitR };
  // ---- statues first (they get their spots), then colonnades ----
  const statue = (tx, ty, face) => addRuin(tx, ty, 'statue', { r: 0.75, face });
  statue(41, 20, 0); statue(54, 20, Math.PI); statue(39, 75, 0); statue(56, 75, Math.PI); statue(19, 36, 0); statue(76, 36, Math.PI);
  const colonnade = (room, ys, xs) => {
    for (const y of ys) for (const x of xs) {
      // never on a tile next to a doorway
      let door = false; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!inRect(room, x + dx, y + dy) && isWalkable(x + dx, y + dy)) door = true;
      if (door) continue;
      const broken = rnd() < 0.3, s = addRuin(x, y, broken ? 'stump' : 'pillar', { h: broken ? rr(0.9, 2.1) : 0, v: ri(0, 1) });
      if (s && broken && rnd() < 0.75) { // its fallen drums lie beside it
        for (let k = 0, n = ri(1, 2); k < n; k++) {
          const a = rr(0, TAU_), d = rr(1.3, 1.9), x2 = s.x + Math.cos(a) * d, z2 = s.z + Math.sin(a) * d, tx2 = toTile(x2), ty2 = toTile(z2);
          if (!inRect(room, tx2, ty2) || !isOpenArea(tx2, ty2) || LV.structures.some((o) => Math.hypot(o.x - x2, o.z - z2) < 1.2)) continue;
          LV.structures.push({ x: x2, z: z2, tx: tx2, ty: ty2, r: 0.45, kind: 'drum', low: true, yaw: rr(0, TAU_) });
        }
      }
    }
  };
  colonnade(hub, [18, 23], [43, 46, 50, 53]);
  colonnade(exitR, [72, 77], [40, 43, 46, 52, 55]);
  colonnade(west1, [32, 39], [20, 23, 26, 29, 32]);
  colonnade(east1, [32, 39], [64, 67, 70, 73, 76]);
  colonnade(hall, [48, 52, 56], [68]);
  colonnade(ante, [5], [45, 50]);
  // ---- the people of this floor ----
  const sc = { x: Math.floor(sera.x + sera.w / 2), y: Math.floor(sera.y + sera.h / 2) }, gc = { x: Math.floor(hall.x + hall.w / 2), y: Math.floor(hall.y + hall.h / 2) };
  LV.story.sera = at(sc.x, sc.y);
  LV.story.merchant = { ...at(46, 8), face: 0 };
  LV.structures.push({ ...at(46, 8), r: 0.45, kind: 'merchant' });
  LV.spawns.push({ type: 'guardian', ...at(gc.x, gc.y), face: -Math.PI / 2, guardian: true });
  placeBrazier(sc.x - 2, sc.y, false); placeBrazier(sc.x + 2, sc.y, false);
  placeBrazier(gc.x, gc.y - 2, false); placeBrazier(gc.x, gc.y + 2, false);
  LV.story.seraBraziers = [LV.braziers.length - 4, LV.braziers.length - 3];
  placeBrazier(50, 8, true);                      // the last fire before the ruins: you start in a little light
  placePickup('fuel', 46, 10); placePickup('health', 47, 10); // the Gray Merchant's "credit"
  // murals in the guardian wing (Crown, Light, Shadow, left to right), the three carved symbols in the Hall
  const mur = spreadFaces(east1, ['n', 's', 'e', 'w'], 3, 3);
  LV.story.murals = mur ? mur.map((f, i) => ({ ...f, sym: ['crown', 'light', 'shadow'][i] })) : [];
  const pl = spreadFaces(hall, ['e', 's', 'n', 'w'], 3, 3);
  const perms = [['light', 'shadow', 'crown'], ['shadow', 'crown', 'light'], ['light', 'crown', 'shadow'], ['shadow', 'light', 'crown'], ['crown', 'shadow', 'light']], order = perms[ri(0, perms.length - 1)];
  LV.story.plaques = pl ? pl.map((f, i) => ({ ...f, sym: order[i] })) : [];
  LV.decorations.push({ kind: 'binding', ...at(sc.x, sc.y) });
  // ---- the rest is populated like any floor ----
  for (const i of [1, 2, 4, 6]) {
    const room = rooms[i]; populateRoom(room, false, i === 6);
    // the ruins are bigger and emptier than the woods: every hall holds at least two things
    const inside = () => LV.spawns.filter((sp) => inRect(room, toTile(sp.x), toTile(sp.z))).length;
    for (let tries = 0; inside() < 2 && tries < 30; tries++) {
      const p = randomFloorTileInRoom(room); if (!isOpenArea(p.x, p.y) || LV.structures.some((o) => o.tx === p.x && o.ty === p.y)) continue;
      const c = roomWalkableCenter(room); LV.spawns.push({ type: pickEnemyType(), ...at(p.x, p.y), face: Math.atan2(c.y - p.y, c.x - p.x) });
    }
  }
  { const p = randomFloorTileInRoom(west1); placeSecret('fuel', p.x, p.y); } // the relic cache in the spirit wing
  // nothing may sit in or right beside the stairwell
  const clear = (o) => Math.hypot(o.x - LV.exit.x, o.z - LV.exit.z) > 3.2;
  LV.pickups = LV.pickups.filter(clear); LV.secrets = LV.secrets.filter(clear); LV.spawns = LV.spawns.filter(clear); LV.braziers = LV.braziers.filter(clear);
  computeDepth();
  return LV;
}
const TAU_ = Math.PI * 2;

// wall depth: how many tiles each wall tile is from the nearest clearing or trail (for tree placement)
export function computeDepth() {
  const w = LV.w, h = LV.h, D = LV.depth; D.fill(255); const q = [];
  for (let i = 0; i < w * h; i++) if (LV.tiles[i] === 1) { D[i] = 0; q.push(i); }
  for (let qi = 0; qi < q.length; qi++) {
    const ci = q[qi], cx = ci % w, cy = (ci / w) | 0, d = D[ci];
    if (d >= 7) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = cx + dx, ny = cy + dy; if (!inBounds(nx, ny)) continue; const ni = idx(nx, ny); if (D[ni] > d + 1) { D[ni] = d + 1; q.push(ni); } }
  }
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
    for (const s of LV.structures) { if (s.low) continue; const dx = x - s.x, dz = z - s.z, rr2 = Math.min(0.64, s.r * s.r * 0.8); if (dx * dx + dz * dz < rr2) return false; }
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
