# The Hollow Crown: Lantern of the Deep — 3D first-person (Floor III: The Deep Woods)

The Hollow Crown's rules (oil, the three lantern stances, slash / dash / flare / pulse, braziers, hidden caches, exposure) rebuilt as a first-person 3D game on the Eyeshine engine. The core idea comes from Eyeshine: **if the player can only see what the lantern touches, only draw that**, and spend the saved triangles on detail inside the beam.

The Warden carries a **bullseye lantern**: one lens in front and a shutter. DIM, STEADY and BRIGHT are how far the shutter is open, so the lantern throws a single beam where you look and everything else stays dark.

Three.js r170, no other runtime dependencies. Everything (models, textures, audio) is generated in code, and the build is one self-contained HTML file.

## Build

```bash
npm install
node build.mjs          # -> dist/hollow-crown-3d.html (open it in any browser)
```

## Files

| File | What's in it |
|---|---|
| `src/lantern.js` | **The lantern.** The SpotLight and its lens cookie, the three shutter stances, the vent glow, the held lantern and blade you see in your hands, and the questions the game asks about light: `lanternLevel` (how lit is a point), `inBeam` (is a sphere inside the beam, used for culling), `glint` (how hard an eye shines back) |
| `src/level.js` | The floor generator, ported from the 2D Crown: rooms and winding corridors on a tile grid (1 tile = 2 m), room types, the bandit camp, braziers, caches, enemies. Also tile collision, line of sight and A* pathfinding |
| `src/world3d.js` | Turns the tiles into a forest (trees on wall tiles, densest at the edge of every clearing), builds braziers, pickups and the stair down, and runs **the trick**: `updateCulling` (grid-based beam culling, LOD swaps, shadow-proxy pool), `updateCover` (instanced ground cover in the beam), the brazier light pool |
| `src/creatures.js` | Wolves, shade leeches, ember moths and bandits: models, the Crown's AI in metres, exposure and damage, and eyeshine |
| `src/trees.js` | Tree, thicket, rock and ground-cover builders (low-poly and hi-poly) |
| `src/engine.js` | Renderer, camera, merged-geometry builder, PS1 snapping |
| `src/audio.js` | Synthesized sound: wind, insects that hush near danger, positional creature sounds, combat |
| `src/input.js` | Keyboard + mouse, touch (stick + six buttons), gamepad |
| `src/main.js` | Rules, combat, HUD, map, tricks panel, game flow, main loop |
| `src/template.html` | Page shell: HUD, touch controls, menus, CSS |

## Controls

- **Desktop:** WASD move, mouse look (click to capture), click or Space slash, Shift dash, right-click or F flare, E pulse, Q (or 1 2 3) lantern shutter, R use (light a brazier, descend), T rendering tricks, Esc pause.
- **Touch:** left thumb walks, right thumb looks, plus LIGHT, PULSE, USE, FLARE, DASH and SLASH.
- **Gamepad:** sticks move and look, A/RT slash, B dash, X pulse, Y use, LB shutter, RB/LT flare.

## Debug hook

`window.__crown3d` exposes the state (`G`, `P`, `LV`, `W`, `CR`, `lantern`, `settings`, `stats`) and actions (`startGame`, `setMode`, `setDetail`, `addCreature`, `measure`, `step`). Set `window.__hold = true` before load to drive the loop yourself with `step(seconds)`.
