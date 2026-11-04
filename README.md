# The Hollow Crown: Lantern of the Deep — 3D first-person (Floors I–VI, the whole story)

The Hollow Crown's rules (oil, the three lantern stances, slash / dash / flare / pulse, braziers, hidden caches, exposure) rebuilt as a first-person 3D game on the Eyeshine engine. The core idea comes from Eyeshine: **if the player can only see what the lantern touches, only draw that**, and spend the saved triangles on detail inside the beam.

The Warden carries a **bullseye lantern**: one lens in front and a shutter. DIM, STEADY and BRIGHT are how far the shutter is open, so the lantern throws a single beam where you look and everything else stays dark. On the title screen (or in Tricks) you can switch to **the original lantern** instead: a ring of light all around you, with the 2D Crown's own radii (Dim about 8 m, Steady 11 m, Bright 15 m) and its falloff. There are three **difficulties** (Gentle, Standard, Harsh); the choice and the lantern are remembered.

Six floors, played in order (the title screen's BEGIN AT FLOOR … with its › starts partway down):

- **Floor I, Ash Hollow.** The village the run starts in, laid out as the 2D Crown's: the square with its well and fire, the houses, Farmer Ged's field, the eastern gate. Talk to Elder Maren (the Warden's Ring, rest), Sev (a shop: sword, chainmail, tonic, oil), Farmer Ged (pull his cart free for coins) and Lyn at the gate, who will come with you if you ask and follows you floor to floor. No enemies, no oil burned.
- **Floor II, the Gray Forest.** The curse has drained the colour: everything is grey except where your light or a fire falls. Wolves and moths, and a lost girl hiding by a fallen log, who gives you her mother's charm.
- **Floor III, the Deep Woods.** A generated forest of clearings and trails. Wolves, shade leeches, ember moths, and a bandit camp whose red-hooded leader steps up when you walk into the firelight: fight them, or (if you helped Farmer Ged) talk them into going to the village (+15 coins).
- **Floor IV, the Eastern Ruins (outer).** The 2D Crown's hand-built layout in stone: an antechamber with the Gray Merchant, a central hub, then a fork. West: Sera, Maren's daughter, chained as an anchor for the crown; light her braziers so she can speak, then strike the three chain anchors to free her (+8 max health, pulse costs less). East: the Ruin Guardian; kill it and three carved signs wake on the wall; hold the bright beam on them in the order of the murals (Crown, Light, Shadow) for the Crown Shard (+5 attack, brighter cuts, 5% less damage taken). Whichever wing you finish, the other collapses. Wax sentinels sleep until bright light or you wake them, and only crack under a pulse; gloom hounds circle in the dark when you go Bright, then come in from the side. Health and oil carry down from the woods (+28 health, +50 oil).
- **Floor V, the Inner Ruins.** Thirteen halls and passages under the same stone. The Resonance Choir (a floating broken bell with four singing masks) never strikes but makes everything near it notice you from further off. In a great hall near the end waits Aldric's captain, the wraith: with Sera freed he talks, and lets you choose to let him stand aside or grant him rest; either way you learn the truth about the king. With her still bound, he just rises (kill him for the Wraith's Edge).
- **Floor VI, the Hollow Throne.** A round throne room ringed with pillars, three alcoves with braziers and supplies, and the Hollow King. He asks what you will do: fight him (the door seals; what the crown has made of him rises, three times worse each third of the way, calling the dark in and bringing the alcoves down; burn it in the bright beam once four braziers burn, or pulse it as it gathers itself), take the crown, or, if the wraith told you the truth, ask him to take it off himself. Four endings, in the 2D Crown's words.

Worn trails run through the forest floors (marker posts along the main one, cairns where a side path leaves it), so you can see where the path goes.

Three.js r170, no other runtime dependencies. Models, most textures and all audio are generated in code. The creatures and people that have reference sheets (the wolf, the forest bandit and his leader, the Resonance Choir, the wraith, the Hollow King and his crowned form, the wax sentinel, Ruin Guardian, gloom hound, the villagers) are fitted to those sheets and textured by projecting the sheets' orthographic views onto them, and the Floor IV murals and carved signs are cut straight from theirs: `tools/` has the scripts (`seg.py`, `atlas.py`, `villagers.py`, `bandit.py`, `choir.py`, `murals.py`, `profile.py`, `vprofile.py`), and their output is in `src/assets/` (the sheets themselves are not in the repo). The build is one self-contained HTML file.

## Build

```bash
npm install
node build.mjs          # -> dist/hollow-crown-3d.html (one file: open it in any browser)
                        #    dist/web/ (index.html + assets/: the remastered creatures and the forest pack as their own files)
```

## The remaster (Nov 2026)

**Creatures, rebuilt in Blender from their sheets** (`tools/remaster/`, done so far: the wolf). For each one:

1. `carve.py` + `creatures/<name>.py` carve a body that matches every view of the reference sheet: each part (body, legs, tail, ears) is lofted through its own silhouette in two views with round (superellipse) sections smoothed along the part, the parts are joined with a fillet, and the whole is held inside every view's outline. A far leg drawn beside the near one is dropped (each leg is held to its own depth). `sheet.py` calibrates the views in metres and cleans their outlines with GrabCut.
2. `bl_process.py` (Blender as a Python module, `pip install bpy`) remeshes it, decimates the top LOD, unwraps it, bakes its surface position, normal and ambient occlusion, and binds it to the creature's existing bones with Blender's automatic (heat) weights, so the procedural animation in `creatures.js` drives it unchanged.
3. `paint.py` paints the UV layout from the sheet: every texel takes the views that can actually see it (a depth test per view, so the inside of a leg is not painted with the outside), blended by how squarely it faces each, then the ambient occlusion.
4. `export.py` + `pack.mjs` quantize the mesh, make the lower LODs as meshopt simplifications of the top one (they share its vertices, skin and UVs), meshopt-encode and deflate it: `src/assets/remaster/<name>.bin` and `<name>.webp`.

`python3 tools/remaster/run.py wolf` runs all four. `src/remaster.js` decodes them at startup; a creature without one keeps its procedural body.

**The woods: the Field & Forest pack** (Christopher's, from his Forest Builder). `tools/forest.py` repacks its temperate trees, bushes and grass (spruce, ponderosa pine, aspen, bur oak, cottonwood, dead snag, weeping willow, oleander, sagebrush, meadow and dry grass) into `src/assets/forest/forest.bin`; `src/forest.js` decodes it. Floors I–III draw each tree's far model wherever the lantern touches it and its near model when it is lit and close (`ffLod` in `world3d.js`): ponderosa at the clearings' edges with spruce behind, aspen, snags, an oak or cottonwood for each elder, a willow by each pond, oleander and sage as the thickets, and the pack's grass tufts in the ground cover. The desert plants and the modern props are left out.

## Files

| File | What's in it |
|---|---|
| `src/lantern.js` | **The lantern.** The SpotLight and its lens cookie, the three shutter stances, the vent glow, the held lantern and blade you see in your hands, and the questions the game asks about light: `lanternLevel` (how lit is a point), `inBeam` (is a sphere inside the beam, used for culling), `glint` (how hard an eye shines back) |
| `src/level.js` | The floor generators, ported from the 2D Crown: Floor III's rooms and winding corridors on a tile grid (1 tile = 2 m), and Floor IV's hand-built ruins layout with its two wings, the tiles each wing loses when it collapses, colonnades, statues, murals and plaques. Also tile collision, line of sight and A* pathfinding |
| `src/world3d.js` | Builds each floor (the forest from the tiles, or the ruins via `ruins.js`), braziers, pickups and the stair down, and runs **the trick**: `updateCulling` (wall visibility first in the ruins, then grid-based beam culling, LOD swaps, shadow-proxy pool), `updateCover` (instanced ground cover in the beam), the brazier light pool |
| `src/ruins.js` | **The Eastern Ruins.** Stone walls from the tile grid (one textured face per wall-floor boundary, merged per 8 m cell), flagstone floors, and in front of the walls, only close up and in the beam, individual carved blocks (instanced, 4 variants, aligned with the painted texture behind them). Fluted pillars and broken stumps, hooded court statues whose heads turn while you are not looking, vaulted arches over the doorways, murals, carved plaques, ruin ground cover, and `computeSeen`: ~160 rays through the tile grid each frame, so a room behind a wall is never drawn, however bright it is |
| `src/village.js` | Ash Hollow's pieces: timber-framed houses with sagging thatch and lit windows, wattle fences, the well, Sev's stall, Ged's cart and field, the palisade and gate; the trail and cobble textures |
| `src/npc.js` | The people: their bodies (from `rigs.js`), idle animation, the talk prompt, the conversation panel and the 2D Crown's dialogue, Sev's shop and coins, and Lyn as a companion who follows you |
| `src/assets/` | Projection atlases and silhouette profiles cut from the reference sheets, the murals and plaques (built by `tools/`) |
| `src/story.js` | Floor IV's fork: Sera (a rim-lit ghost, her chains and anchors), the Gray Merchant, the Guardian's plaque puzzle, and the collapse (which refuses to happen if it would seal you in) |
| `src/creatures.js` | Wolves, shade leeches, ember moths, bandits, wax sentinels, the Ruin Guardian and gloom hounds: the Crown's AI in metres, exposure and damage, procedural animation (gaits, head tracking, snarls, hackles, rearing, wingbeats, sword work, the sentinel's slam, hit recoil, deaths), eyeshine |
| `src/rigs.js` | **Creature models.** Detailed skinned rigs built in code: smooth lofted bodies and limbs on a skeleton with two-bone blends, so each creature is one mesh (3 draw calls: body, gloss, accent). Four quality tiers follow the DETAIL setting |
| `src/fx.js` | Pooled particles: hit sparks, breath in the cold air, moth embers, death bursts (one draw call each) |
| `src/trees.js` | Tree, thicket, rock and ground-cover builders (low-poly and hi-poly) |
| `src/engine.js` | Renderer, camera, merged-geometry builder, PS1 snapping |
| `src/audio.js` | Synthesized sound: wind, insects that hush near danger, positional creature sounds, combat |
| `src/input.js` | Keyboard + mouse, touch (stick + six buttons), gamepad |
| `src/main.js` | Rules, combat, HUD, map, tricks panel, game flow, main loop |
| `src/template.html` | Page shell: HUD, touch controls, menus, CSS |

## Creature detail budget

Triangles per creature, by DETAIL tier (LOW / HIGH / ULTRA / MAX):

| Creature | LOW | HIGH | ULTRA | MAX |
|---|---|---|---|---|
| Wolf (remastered) | 3.2k | 8.0k | 18.0k | 32.0k |
| Shade leech | 1.3k | 3.7k | 6.8k | 11.1k |
| Ember moth | 1.2k | 3.1k | 5.0k | 8.6k |
| Bandit | 3.1k | 7.2k | 11.8k | 19.5k |
| Wax sentinel | 3.5k | 8.8k | 15.7k | 26.7k |
| Ruin Guardian | 3.7k | 9.5k | 16.3k | 28.2k |
| Gloom hound | 3.1k | 6.3k | 11.8k | 19.1k |

The environment budget is unchanged. A creature's body is drawn only when light touches it (its eyes can still shine back from the dark).

## What the ruins' culling saves

Triangles and draw calls on screen in the Eastern Ruins, BRIGHT beam, four fixed views (hub, west wing, Guardian Hall, exit room), with "only draw what light touches" on (beam + walls) and off:

| DETAIL | On: triangles | Off: triangles | On: draw calls | Off: draw calls |
|---|---|---|---|---|
| LOW | 1k–7k | 30k–34k | 23–57 | 79–148 |
| HIGH | 16k–37k | 142k–145k | 28–66 | 88–157 |
| ULTRA | 25k–89k | 373k–397k | 28–66 | 88–157 |
| MAX | 68k–209k | 744k–801k | 31–65 | 88–157 |

## Controls

- **Desktop:** WASD move, mouse look (click to capture), or ← → to turn and Page Up / Page Down to look up and down (for laptops that switch the touchpad off while a key is held), click or Space slash (also strikes Sera's chain anchors), Shift dash, right-click or F flare, E pulse, Q (or 1 2 3) lantern shutter, R use (light a brazier, descend), T rendering tricks, Esc pause.
- **Touch:** left thumb walks, right thumb looks, plus LIGHT, PULSE, USE, FLARE, DASH and SLASH.
- **Gamepad:** sticks move and look, A/RT slash, B dash, X pulse, Y use, LB shutter, RB/LT flare.

## Debug hook

`window.__crown3d` exposes the state (`G`, `P`, `LV`, `W`, `CR`, `ST`, `lantern`, `settings`, `stats`) and actions (`startGame(floor)`, `setMode`, `setDetail`, `addCreature`, `descend`, `measure`, `step`). Set `window.__freezeAI = true` to stop the AI but keep animation running. Set `window.__hold = true` before load to drive the loop yourself with `step(seconds)`.
