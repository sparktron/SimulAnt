# SimulAnt Open PR Analysis

## PR #2: "Add SimAnt WebApp: simulation engine, renderer, UI, and assets"
- **Author**: sparktron | **Created**: 2026-02-27 | **Updated**: 2026-02-28
- **Summary**: Initial scaffold — simulation engine, renderer, world, colony, controls, HUD, CSS, and README.
- **Scope**: `index.html`, `src/main.js`, `src/sim/ant.js`, `src/sim/colony.js`, `src/sim/world.js`, `src/sim/rng.js`, `src/render/renderer.js`, `src/ui/controls.js`, `src/ui/hud.js`, `styles.css`, `README.md`
- **Status**: No CI, no reviews.
- **Value**: **SKIP — Superseded**. Master already contains the full simulation engine, renderer, UI, and all scaffold code. This PR is the initial commit that has long since been merged.

---

## PR #18: "Implement working health/energy system and bind it to the on-screen health bars"
- **Author**: sparktron | **Created**: 2026-03-02 | **Updated**: 2026-03-03
- **Summary**: Adds `carryingHungerDrainRate` / `fightingHungerDrainRate` config, aggregate health stats in HUD, and health bar binding improvements.
- **Scope**: `index.html`, `src/main.js`, `src/sim/ant.js`, `src/sim/core/SimulationTypes.js`, `src/ui/hud.js`, `test/hud-health-bars.test.mjs`, `test/core-simulation-architecture.test.mjs`
- **Status**: No CI, no reviews.
- **Value**: **SKIP — Already merged**. All features (`carryingHungerDrainRate`, `fightingHungerDrainRate`, `getAntHealthStats`, `hudHealthStats` element, health bar binding) are present in master.

---

## PR #23: "Add Colony Status panel with triangle controls for colony allocation and hatching priorities"
- **Author**: sparktron | **Created**: 2026-03-04 | **Updated**: 2026-03-04
- **Summary**: Adds `ColonyStatusPanel` dialog with interactive `TriangleControl` widgets for work allocation and caste hatching priority.
- **Scope**: `index.html`, `src/main.js`, `src/sim/ant.js`, `src/sim/colony.js`, `src/ui/ColonyStatusPanel.js`, `src/ui/TriangleControl.js`, `src/ui/controls.js`, `test/colony-status-panel-dialog.test.mjs`, `test/triangle-control.test.mjs`
- **Status**: No CI, no reviews.
- **Value**: **SKIP — Already merged**. `ColonyStatusPanel.js`, `TriangleControl.js`, status dialog HTML, and button wiring are all in master (with slightly evolved API — master uses `statusPanel` ID and separate containers).

---

## PR #34: "Align brood and worker allocations with colony status triangles"
- **Author**: sparktron | **Created**: 2026-03-04 | **Updated**: 2026-03-06
- **Summary**: Makes the triangle allocation controls actually drive simulation behavior. Adds deficit-based hatch role selection, worker `workFocus` assignment and rebalancing, extended HUD with breeder/nurse/forager/digger counts, queen health display, improved serialization (preserves `workFocus`/`alive`), and legacy `nestFoodPellets` migration.
- **Scope**: `index.html`, `src/main.js`, `src/sim/ant.js`, `src/sim/colony.js`, `src/ui/hud.js`, `test/core-simulation-architecture.test.mjs`, `test/hud-health-bars.test.mjs`
- **Status**: Codex review completed with minor suggestions. No CI failures noted.
- **Value**: **INCLUDE — High value**. This is the critical "close the loop" PR that connects the allocation UI (already in master) to actual simulation behavior. Without it, the triangle controls are cosmetic only.

### PR #34 Feature Breakdown:
1. **Deficit-based role selection** (`selectHatchRole` / `chooseWorkFocus` / `#chooseWeightedDeficit`): Replaces random-chance hatching with allocation-aware deficit targeting
2. **Worker `workFocus` property**: Workers track their assigned job (forage/dig/nurse)
3. **`rebalanceWorkerFocuses()`**: Redistributes worker focuses each tick to match allocation targets
4. **Extended HUD**: Breeders, nurses, foragers, diggers, jobs F/D/N, queen health
5. **`NEST_DUTY` state**: Non-foraging workers return to nest instead of wandering
6. **Improved serialization**: Preserves `workFocus` and `alive` on save/load
7. **Legacy migration**: `nestFoodPellets.nutrition` → `amount`
8. **Tests**: 7 new/updated tests covering all above features
