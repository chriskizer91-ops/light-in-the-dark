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
  kills: 0, oilFound: 0, secrets: 0, braziersLit: 0, tips: {}, endT: 0, won: false, renderH: 720, eyesSeen: false, floor: 3, runT: 0, talk: null,
};

export const P = {
  x: 0, z: 0, r: 0.42, yaw: 0, pitch: 0, hp: 100, maxHp: 100, fuel: 100, maxFuel: 100,
  invuln: 0, dashT: 0, dashCd: 0, attackCd: 0, flareCd: 0, pulseCd: 0, hurt: 0, bob: 0, moving: 0, lastStep: 0,
  dashX: 0, dashZ: 0, pushX: 0, pushZ: 0, walkX: 0, walkZ: 0, swingSide: 1,
  atkBonus: 0, brightBonus: 0, dr: 0, pulseCostMult: 1, speedK: 0, // relics, Sera, Sev's wares, Lyn and the girl change these
};

export const H = {
  say: () => {},          // the lantern speaks (typed line, bottom of the screen)
  hint: () => {},         // a plain hint
  damagePlayer: () => {}, // (amount, source, fromX, fromZ)
  lightAt: () => 0,       // (x, z, y) -> 0..~1.2, everything that lights a point, with line of sight
  addPickup: () => {},    // (type, x, z)
  creatureDown: null,     // (creature) a sentinel or the guardian fell
};

// the story so far (the 2D Crown's `story`): coins, and what you have done for whom. Carried floor to floor.
const STORY0 = { coins: 15, talkedToElder: false, ring: false, talkedToLyn: false, lynJoined: false, helpedFarmer: false, savedChild: false, sword: false, mail: false };
export const S = { ...STORY0 };
export function resetStory() { Object.assign(S, STORY0); }

// three difficulties (chosen on the title screen, remembered). The 2D Crown had one; STANDARD is it.
// dmg: damage you take · hp: enemy health · drain: oil burned per second · dark: vitality lost with no oil
// sense: how far they notice you · windup: how long they telegraph a strike · count: how many there are
// loot: oil and tonics found · carry: health and oil restored between floors
export const DIFFS = {
  gentle: { name: 'GENTLE', blurb: 'Fewer hunters, slower to strike; oil lasts', dmg: 0.55, hp: 0.8, drain: 0.7, dark: 0.6, sense: 0.85, windup: 1.25, count: 0.7, loot: 1.3, carry: 1.3 },
  standard: { name: 'STANDARD', blurb: 'The Crown as it was made', dmg: 1, hp: 1, drain: 1, dark: 1, sense: 1, windup: 1, count: 1, loot: 1, carry: 1 },
  harsh: { name: 'HARSH', blurb: 'More of them, quicker, hungrier for oil', dmg: 1.35, hp: 1.25, drain: 1.25, dark: 1.3, sense: 1.15, windup: 0.85, count: 1.3, loot: 0.8, carry: 0.7 },
};
export const DF = { key: 'standard', ...DIFFS.standard };
export function setDifficulty(k) { if (!DIFFS[k]) k = 'standard'; Object.assign(DF, DIFFS[k], { key: k }); }
