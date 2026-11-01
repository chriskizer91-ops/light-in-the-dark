// =====================================================================
//  Shared state. main.js fills in the hooks (H) so the other modules can
//  talk to the HUD and the player without importing main.js.
// =====================================================================
export const BAL = {
  oil: 38,            // oil flask
  cache: 45,          // hidden oil cache
  brazierLight: 15,   // oil you get back for lighting a brazier
  brazierRefill: 6,   // oil/s while standing by a lit brazier
  tonic: 30,          // health
  darkDrain: 4,       // vitality/s with no oil
  mothSip: 1, leechBite: 6,
  dmgTaken: 0.72,
  flareCost: 11, pulseCost: 5,
};

export const G = {
  state: 'menu', t: 0, paused: false, danger: 0, shake: 0, hitstop: 0, flash: 0, flashCol: '#ffffff',
  kills: 0, oilFound: 0, secrets: 0, braziersLit: 0, tips: {}, endT: 0, won: false, renderH: 720, eyesSeen: false, floor: 3, runT: 0,
};

export const P = {
  x: 0, z: 0, r: 0.42, yaw: 0, pitch: 0, hp: 100, maxHp: 100, fuel: 100, maxFuel: 100,
  invuln: 0, dashT: 0, dashCd: 0, attackCd: 0, flareCd: 0, pulseCd: 0, hurt: 0, bob: 0, moving: 0, lastStep: 0,
  dashX: 0, dashZ: 0, pushX: 0, pushZ: 0, swingSide: 1,
  atkBonus: 0, brightBonus: 0, dr: 0, pulseCostMult: 1, // the Crown Shard and Sera change these
};

export const H = {
  say: () => {},          // the lantern speaks (typed line, bottom of the screen)
  hint: () => {},         // a plain hint
  damagePlayer: () => {}, // (amount, source, fromX, fromZ)
  lightAt: () => 0,       // (x, z, y) -> 0..~1.2, everything that lights a point, with line of sight
  addPickup: () => {},    // (type, x, z)
  creatureDown: null,     // (creature) a sentinel or the guardian fell
};
