# SimulAnt Codebase Onboarding Analysis

## 1) Executive Overview

### What the project does
[Confirmed] SimulAnt is a browser-based ant-colony simulation game that runs entirely as static web assets. The simulation models ants, queen survival/reproduction, food collection, pheromone trails, hazards, and underground digging/chamber growth with deterministic seeded randomness. Main orchestration is in `src/main.js` and `src/sim/SimulationCore.js`.

### Who uses it / where it runs
[Confirmed] It runs in a modern browser as a client-only app (no backend service), loaded from `index.html` with `<script type="module" src="src/main.js">`. It can be served locally with `python3 -m http.server 8000` according to `README.md`.

### Key features
- [Confirmed] Surface and nest views with independent cameras (`src/ui/ViewManager.js`, `src/render/SurfaceRenderer.js`, `src/render/NestRenderer.js`).
- [Confirmed] Simulation tick loop with pause/step/speed control (`src/main.js`).
- [Confirmed] Painting tools for food/wall/water/hazard/erase/nest relocation (`src/sim/SimulationCore.js#applyTool`, UI wiring in `src/ui/controls.js`).
- [Confirmed] Deterministic RNG and save/load via `localStorage` (`src/sim/rng.js`, `src/main.js` save/load functions).
- [Confirmed] Auto-dig system with tunnel/chamber generation and soil mound accumulation (`src/sim/DigSystem.js`, `src/sim/SimulationCore.js#onExcavate`, `src/render/soilMound.js`).
- [Confirmed] Runtime error gating for fatal vs non-fatal browser errors (`src/ui/runtimeErrorGate.js`).

### Tech stack and major libraries
- [Confirmed] Vanilla JavaScript ES modules, no framework (`index.html`, `src/**/*.js`).
- [Confirmed] HTML5 Canvas 2D rendering (`src/render/*.js`).
- [Confirmed] Node built-in test runner (`node:test`) with `assert/strict` for tests (`test/*.mjs`).
- [Confirmed] Browser APIs: `requestAnimationFrame`, `localStorage`, Pointer/Wheel events, Dialog element (`src/main.js`, `src/input/InputRouter.js`, `src/ui/controls.js`).

### High-level architecture diagram
```
index.html
  └─ src/main.js
      ├─ UI: createControls(), updateHud(), ViewManager, InputRouter
      ├─ Render: SurfaceRenderer, NestRenderer
      └─ SimulationCore
          ├─ TickScheduler
          │   ├─ MacroEngine.update()
          │   └─ MicroPatchEngine.update()
          │       ├─ Colony.update() -> Ant.update()
          │       ├─ DigSystem.update()
          │       └─ World.updatePheromones()
          └─ Serialization (world/colony/dig/macro/state)
```

### How to run it summary
- [Confirmed] Serve static files: `python3 -m http.server 8000` from repo root.
- [Confirmed] Open `http://localhost:8000`.
- [Confirmed] Entrypoint: `index.html` loads `src/main.js`.
- [Confirmed] Tests: `node --test`.

### Top 10 risks / footguns
1. [Confirmed] `loadState()` does raw `JSON.parse` without try/catch; malformed saved data can crash (`src/main.js`).
2. [Confirmed] `colony.fromSerialized` assumes `data.ants` exists and is iterable; malformed save can throw (`src/sim/colony.js`).
3. [Confirmed] `world.fromSerialized` directly `.set()` typed arrays from provided arrays; mismatched lengths/types can throw (`src/sim/world.js`).
4. [Confirmed] `InputRouter` captures pointer on down but does not handle `pointercancel` cleanup explicitly (`src/input/InputRouter.js`).
5. [Confirmed] `styles.css` is duplicated and declared non-authoritative vs inline styles, creating potential drift (`styles.css`, `index.html`).
6. [Confirmed] Renderers redraw full world image data each frame; can become CPU-heavy with larger maps (`src/render/SurfaceRenderer.js`, `src/render/NestRenderer.js`).
7. [Confirmed] Some tests use config keys not used by current sanitizer fields (legacy naming), reducing test realism (`test/view-manager.test.mjs`).
8. [Confirmed] Fatal error handler only logs and stops loop; no user-facing recovery/reset path (`src/main.js`).
9. [Inference] Large ant caps combined with debug text rendering may degrade FPS significantly due to per-ant draw text.
10. [Confirmed] Save version key `simant-save-v2` is fixed; no migration path for future schema changes (`src/main.js`).

## 2) Codebase Map

### Directory tree
```
.
├── index.html
├── styles.css
├── README.md
├── docs/
│   ├── core-simulation-architecture.md
│   └── post-refactor-improvement-plan.md
├── src/
│   ├── main.js
│   ├── input/
│   │   └── InputRouter.js
│   ├── render/
│   │   ├── SurfaceRenderer.js
│   │   ├── NestRenderer.js
│   │   └── soilMound.js
│   ├── sim/
│   │   ├── SimulationCore.js
│   │   ├── colony.js
│   │   ├── ant.js
│   │   ├── world.js
│   │   ├── DigSystem.js
│   │   ├── Food.js
│   │   ├── rng.js
│   │   └── core/
│   │       ├── TickScheduler.js
│   │       ├── MacroEngine.js
│   │       ├── MicroPatchEngine.js
│   │       └── SimulationTypes.js
│   └── ui/
│       ├── controls.js
│       ├── hud.js
│       ├── ViewManager.js
│       └── runtimeErrorGate.js
└── test/
    ├── core-simulation-architecture.test.mjs
    ├── view-manager.test.mjs
    └── runtime-error-gate.test.mjs
```

### Top-level folder purposes
- `src/`: runtime application code. Most feature changes happen here.
- `test/`: deterministic and behavior regression tests.
- `docs/`: architecture and planning docs; update when contracts change.
- Root (`index.html`, `styles.css`, `README.md`): app shell, styling, usage docs.

## 3) Control Flow: “What happens when…”

### App start / entrypoint path
1. `index.html` loads module `src/main.js`.
2. `main.js` builds initial `state`, creates `SimulationCore`, `ViewManager`, and both renderers.
3. `InputRouter` binds canvas pointer/wheel events to active view handlers.
4. `createControls` binds UI + keyboard handlers to mutation actions.
5. `requestAnimationFrame(loop)` starts frame loop.
6. `loop()` updates sim ticks (if unpaused), draws active renderer, updates HUD, schedules next frame.

Call chain: `index.html -> main.js -> loop() -> simCore.update() -> TickScheduler.runTick() -> MacroEngine.update() -> MicroPatchEngine.update()`.

### Core user action: “paint tool on canvas”
1. `pointerdown` on canvas in `InputRouter` maps client coords to world coords via active renderer.
2. If ant-selection fails, sets `painting=true` and calls handler `paint(x,y)`.
3. In `main.js`, paint handler calls `applyToolIfInBounds`.
4. `SimulationCore.applyTool(tool,x,y,radius)` mutates world arrays / pellets / nest location.
5. Next frame draw uses changed world data in renderer.

Call chain: `InputRouter.#bindEvents(pointerdown/move) -> activeHandlers.paint -> main.applyToolIfInBounds -> SimulationCore.applyTool`.

### Data persistence flow
1. Save button/keyboard calls `saveState()` in `main.js`.
2. `simCore.serialize(stateSubset)` returns world/colony/dig/macro/state snapshot.
3. JSON string stored at `localStorage['simant-save-v2']`.
4. Load path parses JSON, calls `simCore.loadFromSerialized(data)`.
5. Rebind renderers to new `world` via `syncRenderWorld()` and applies UI-state fields.

Call chain: `controls -> actions.save/load -> main.saveState/loadState -> SimulationCore.serialize/loadFromSerialized -> World/Colony/DigSystem/MacroEngine serialize/load`.

## 4) Data Model & State

- `World` (`src/sim/world.js`): typed arrays for `terrain`, `food`, `toFood`, `toHome`, `danger`; owns map size and nest coordinates.
- `Colony` (`src/sim/colony.js`): ant list, food store, queen state, birth/death counters, excavation count.
- `Ant` (`src/sim/ant.js`): per-agent state (`x,y,dir,hunger,health,carrying,role,state`).
- `DigSystem` (`src/sim/DigSystem.js`): active digging fronts and auto-dig flag.
- `SimulationCore` (`src/sim/SimulationCore.js`): top-level owner of world + colony + engines + tick count + entrance/pellet state.
- UI runtime state (`src/main.js` `state` object): pause/speed/tool/overlays/config/camera save metadata.

Validation/error strategy:
- [Confirmed] Tick config sanitized by `sanitizeTickConfig` before simulation phases.
- [Confirmed] View validation throws on invalid enum values.
- [Confirmed] Runtime fatal error gate filters non-fatal window error events.
- [Confirmed] Persistence load paths largely trust data shape (limited defensive checks in Macro/Dig loads; weaker in World/Colony).

## 5) Dependency & Integration Map

- External services/APIs: [Confirmed] none (client-only).
- Auth/authz: [Confirmed] none.
- Config/secrets:
  - [Confirmed] Runtime tuning comes from in-memory `state.config` + UI sliders.
  - [Confirmed] Save data in browser `localStorage`; no secret management.
- Logging/metrics:
  - [Confirmed] Console logging only for fatal runtime errors (`console.error` in `reportFatalError`).
  - [Unknown] No formal telemetry pipeline observed.

## 6) Deep Dive by Subsystem

### A) Simulation orchestration
- Purpose: deterministic per-tick orchestration boundary.
- Key files: `SimulationCore.js`, `TickScheduler.js`, `MacroEngine.js`, `MicroPatchEngine.js`.
- Inputs/outputs: config + tick + external state in; mutates world/colony/dig in place.
- Edge failures: invalid tick throws in scheduler; malformed serialized inputs may fail on load.
- Testing: architecture + determinism tests in `test/core-simulation-architecture.test.mjs`.

### B) Ant/colony behavior
- Purpose: local ant decision-making, carrying/deposit, hunger/health, queen reproduction.
- Key files: `ant.js`, `colony.js`, `Food.js`.
- Edge failures: starvation/death loops, pellet ownership race resolved by first-claim order.
- Testing: deterministic snapshot + persistence tests across simulation tests.

### C) Terrain/pheromone field
- Purpose: world passability model and pheromone evaporation/diffusion.
- Key files: `world.js`, `SimulationTypes.js`.
- Edge failures: diffusion cadence invalid values mitigated by sanitizer.
- Testing: sanitizer and patch-state tests in core architecture test file.

### D) Digging subsystem
- Purpose: generate tunnels/chambers and excavation accounting.
- Key files: `DigSystem.js`, `SimulationCore.js` excavation hooks.
- Edge failures: corrupted progress values sanitized on load; branch spawn capped by `maxFronts`.
- Testing: auto-dig/chamber/corrupt-front tests in `view-manager.test.mjs`.

### E) Rendering + view system
- Purpose: draw simulation in two modes with camera controls.
- Key files: `SurfaceRenderer.js`, `NestRenderer.js`, `ViewManager.js`, `soilMound.js`.
- Edge failures: performance under heavy overlays/debug text.
- Testing: view manager and surface helper tests.

### F) UI/input/runtime safety
- Purpose: controls wiring, HUD updates, pointer routing, fatal runtime filtering.
- Key files: `controls.js`, `hud.js`, `InputRouter.js`, `runtimeErrorGate.js`, `main.js`.
- Edge failures: missing required DOM elements throw immediately via `byId`/`mustById`.
- Testing: runtime gate tests + behavior tests of view state contracts.

## 7) File-by-File Brief (FULL)

Due to size, this section is concise per file but complete.

## index.html
- Role in system: Static app shell and DOM contract for JS modules.
- Used by: Browser loader.
- Exposes: Element IDs consumed by `main.js`/UI modules.
- Key logic: Inline CSS + UI layout + help dialog + module script include.
- I/O: Loads JS module; no network calls in file.
- State touched: DOM state only.
- Error handling: None in markup.
- Performance notes: Canvas full-screen + inline style.
- Security notes: No untrusted interpolation.
- Watch out: changing IDs breaks `byId`; inline/external CSS divergence; dialog/browser compatibility.
- Safe checklist: keep IDs stable; verify controls exist; test both views.
- Related: `src/main.js`, `src/ui/controls.js`, `src/ui/hud.js`.

## styles.css
- Role: Legacy duplicate stylesheet (non-authoritative).
- Used by: [Inference] currently unused by page (no `<link>` found).
- Exposes: CSS classes mirroring inline style.
- Watch out: drift from `index.html` style.
- Related: `index.html`.

## src/main.js
- Role: Runtime composition root + frame loop.
- Used by: `index.html` script entry.
- Exposes: none (module side effects).
- Key logic: builds state/core/renderers/router/controls; loop update+draw+HUD; save/load; fatal gate handling.
- I/O: DOM, `localStorage`, console.
- State: owns app `state`, `hasFatalError`, timing accumulators.
- Errors: try/catch around loop body; window error listeners.
- Performance: while-loop can run multiple sim ticks/frame.
- Security: local-only data persistence.
- Pitfalls: save schema coupling; unguarded JSON.parse; tight loop cost.
- Related: all `src/ui/*`, `src/sim/*`, `src/render/*`.

## src/input/InputRouter.js
- Role: Translate pointer/wheel events into active-view actions.
- Used by: `src/main.js`.
- Exposes: `InputRouter` class.
- I/O: DOM event handling.
- Pitfalls: no explicit pointercancel path; assumes handlers exist.

## src/ui/controls.js
- Role: Binds UI buttons/sliders/keys to state/action callbacks.
- Used by: `main.js`.
- Exposes: `createControls`.
- I/O: DOM events, mutates passed state.
- Pitfalls: hardcoded keybindings; missing elements throw.

## src/ui/hud.js
- Role: HUD text/bar updates.
- Used by: `main.js`.
- Exposes: `updateHud`.
- I/O: DOM text/style writes.
- Pitfalls: silent no-op if elements missing.

## src/ui/ViewManager.js
- Role: two-state view finite-state machine.
- Used by: `main.js`, `InputRouter`, tests.
- Exposes: `VIEW`, `ViewManager`.
- Errors: throws on invalid views.

## src/ui/runtimeErrorGate.js
- Role: classify browser errors/rejections.
- Used by: `main.js`, tests.
- Exposes: `shouldReportFatalWindowError`, `normalizeUnhandledRejectionReason`.

## src/render/SurfaceRenderer.js
- Role: top-down surface renderer + overlays + entrance mounds.
- Used by: `main.js`, tests (helper exports).
- Exposes: `SurfaceRenderer`, `normalizeSurfaceTerrain`, `getSurfaceMinZoom`.
- I/O: canvas drawing.
- Pitfalls: full image data regeneration each draw; zoom bound assumptions.

## src/render/NestRenderer.js
- Role: side-view underground renderer.
- Used by: `main.js`.
- Exposes: `NestRenderer`.
- Pitfalls: full image regeneration; no camera bound clamping.

## src/render/soilMound.js
- Role: deterministic organic mound drawing helper.
- Used by: `SurfaceRenderer`.
- Exposes: `drawSoilMound`.

## src/sim/SimulationCore.js
- Role: simulation facade and ownership root.
- Used by: `main.js`, tests.
- Exposes: `SimulationCore` API (update/reset/serialize/load/applyTool...).
- State: tick, world, colony, dig/macro/micro engines, pellets, entrances.
- Pitfalls: tool 'erase' filters pellet array per painted cell (cost); load path trusts many fields.

## src/sim/world.js
- Role: terrain/pheromone data model.
- Used by: simulation and render layers.
- Exposes: `TERRAIN`, `World`.
- Pitfalls: heavy per-cell loops; deserialization trust.

## src/sim/colony.js
- Role: manages ants, queen lifecycle, food store.
- Used by: `SimulationCore`, `MicroPatchEngine`, tests.
- Exposes: `Colony`.
- Pitfalls: `fromSerialized` assumes valid `data` shape.

## src/sim/ant.js
- Role: per-ant behavior state machine.
- Used by: `Colony`.
- Exposes: `Ant`.
- Pitfalls: behavior highly parameter-sensitive; state strings are ad hoc constants.

## src/sim/DigSystem.js
- Role: excavation front progression + chamber creation.
- Used by: `SimulationCore`, `MicroPatchEngine`.
- Exposes: `DigSystem`.
- Pitfalls: stochastic logic plus safety bounds; must preserve determinism.

## src/sim/Food.js
- Role: food pellet value object.
- Exposes: `DEFAULT_PELLET_NUTRITION`, `FoodPellet`.

## src/sim/rng.js
- Role: deterministic seeded RNG.
- Exposes: `SeededRng`.
- Pitfalls: changing algorithm breaks replay determinism.

## src/sim/core/TickScheduler.js
- Role: fixed phase-order tick orchestrator.
- Exposes: `TickScheduler`.
- Errors: throws for non-positive/non-integer tick.

## src/sim/core/MacroEngine.js
- Role: macro-layer placeholder with territory metadata.
- Exposes: `MacroEngine`.

## src/sim/core/MicroPatchEngine.js
- Role: micro update boundary (colony -> dig -> pheromones).
- Exposes: `MicroPatchEngine`.

## src/sim/core/SimulationTypes.js
- Role: config sanitization + patch-state snapshots.
- Exposes: `PATCH_TERRAIN_KIND`, `sanitizeTickConfig`, `getPatchCellState`.

## test/core-simulation-architecture.test.mjs
- Role: determinism/sanitization/macro-micro contract tests.

## test/view-manager.test.mjs
- Role: view FSM + persistence + dig behavior tests.

## test/runtime-error-gate.test.mjs
- Role: runtime error gate behavior tests.

## docs/core-simulation-architecture.md
- Role: design contract for deterministic macro/micro split.

## docs/post-refactor-improvement-plan.md
- Role: [Unknown] planning details not analyzed deeply in this pass.

## 8) Modification Guides

### Add a new feature in the main workflow
1. Extend UI state/config in `src/main.js`.
2. Wire controls in `src/ui/controls.js` and add DOM nodes in `index.html`.
3. Implement sim behavior in `SimulationCore` or deeper (`colony`/`ant`/`world`).
4. Add deterministic tests in `test/core-simulation-architecture.test.mjs`.

### Add a new config option
1. Add default to `state.config` (`src/main.js`).
2. Sanitize in `sanitizeTickConfig` (`src/sim/core/SimulationTypes.js`).
3. Consume in behavior code.
4. Add tests for clamping/behavior.

### Add a new UI component
1. Add element + ID in `index.html`.
2. Access via `byId` in `src/ui/controls.js` or update in `src/ui/hud.js`.
3. Keep keyboard/interaction mapping consistent.
4. Verify no missing-element throws.

### Add a new data field/schema change
1. Add field in owning model (`World`, `Colony`, `SimulationCore` state).
2. Update `serialize` + `from/loadFromSerialized` paths.
3. Add backward-compatible defaults when absent.
4. Add save/load regression test in `test/*.mjs`.

## 9) Quick Start for New Contributors

- 10-minute read order:
  1) `README.md`
  2) `index.html`
  3) `src/main.js`
  4) `src/sim/SimulationCore.js`
  5) `src/sim/core/*`
  6) `src/sim/colony.js` + `src/sim/ant.js`
  7) `src/render/*`
  8) `test/*.mjs`
- Local dev workflow:
  - Serve static files (`python3 -m http.server 8000`), iterate JS, refresh browser.
  - Run `node --test` before commits.
- Debug tips:
  - Breakpoints: `main.js:loop`, `SimulationCore.update`, `Ant.update`, `DigSystem.update`.
  - Toggle debug overlay with `F3` to inspect ant vitals.
- Common errors/fixes:
  - Missing DOM ID -> thrown by `byId`/`mustById`; verify `index.html` IDs.
  - Bad saved state -> clear localStorage key `simant-save-v2`.
  - Low FPS -> reduce ant cap / disable debug overlays.

## Refactor ideas (only after explanation)
1. Add guarded schema validation for load paths (`main.js`, `World.fromSerialized`, `Colony.fromSerialized`) to prevent crashes on malformed saves.
2. Extract shared config fixture used by tests to avoid stale/legacy key drift.
