// Projection-texture atlases cut from the reference sheets (tools/atlas.py). Each holds a creature's
// orthographic views (plus, for the wax, a mask of its molten seams); `views` says where each view's
// silhouette sits in the atlas (u0, v0, u1, v1, top-left origin). Only rigs refit to their sheet are listed:
// a texture projected onto a body of the wrong proportions paints the face on the chest.
import sentinel from './sentinel.webp'; import sentinelJ from './sentinel.json'; import sentinelG from './sentinel_glow.webp';
import guardian from './guardian.webp'; import guardianJ from './guardian.json'; import guardianG from './guardian_glow.webp';
import hound from './hound.webp'; import houndJ from './hound.json';
import wolf from './wolf.webp'; import wolfJ from './wolf.json';
import bandit from './bandit.webp'; import banditJ from './bandit.json';
// the village people (tools/villagers.py): atlases, and fig_* = their silhouettes measured per height
import maren from './maren.webp'; import marenJ from './maren.json'; import marenF from './fig_maren.json';
import sev from './sev.webp'; import sevJ from './sev.json'; import sevF from './fig_sev.json';
import lyn from './lyn.webp'; import lynJ from './lyn.json'; import lynF from './fig_lyn.json';
import ged from './ged.webp'; import gedJ from './ged.json'; import gedF from './fig_ged.json';
import girl from './girl.webp'; import girlJ from './girl.json'; import girlF from './fig_girl.json';
export const ATLAS = {
  sentinel: { url: sentinel, glowUrl: sentinelG, ...sentinelJ }, guardian: { url: guardian, glowUrl: guardianG, ...guardianJ }, hound: { url: hound, ...houndJ }, wolf: { url: wolf, ...wolfJ }, bandit: { url: bandit, ...banditJ },
  maren: { url: maren, ...marenJ }, sev: { url: sev, ...sevJ }, lyn: { url: lyn, ...lynJ }, ged: { url: ged, ...gedJ }, girl: { url: girl, ...girlJ },
};
export const FIG = { maren: marenF, sev: sevF, lyn: lynF, ged: gedF, girl: girlF };
// the three murals and the three carved signs of Floor IV, cut from CR49 (tools/murals.py)
import murals from './murals.webp'; import plaques from './plaques.webp'; import plaquesGlow from './plaques_glow.webp';
export const PANELS = { murals, plaques, plaquesGlow, order: ['crown', 'light', 'shadow'] };
