# SimulAnt PR Merge Strategy

## PRs to Consolidate

Only **PR #34** ("Align brood and worker allocations with colony status triangles") has value not already in master. PRs #2, #18, and #23 are fully superseded.

## Conflict Analysis

### Auto-merged files (no conflicts):
- `src/main.js` — PR #34 additions (HUD count functions, extended updateHud call) merge cleanly
- `src/sim/colony.js` — PR #34 changes to `selectHatchRole`, `chooseWorkFocus`, new methods merge cleanly
- `src/sim/ant.js` — PR #34 changes to `#needsForage`, `NEST_DUTY` state merge cleanly
- `src/ui/hud.js` — PR #34 new HUD fields merge cleanly
- `index.html` — PR #34 new HUD elements merge cleanly
- `test/hud-health-bars.test.mjs` — PR #34 test additions merge cleanly

### Conflicted files:

#### `test/core-simulation-architecture.test.mjs` — 3 conflicts

1. **Line ~298** — `carryingType` assertion after food deposit
   - **Master**: `assert.notEqual(ant.carryingType, 'food')` (permissive)
   - **PR #34**: `assert.ok(ant.carryingType === 'none' || ant.carryingType === 'dirt')` (specific)
   - **Resolution**: Keep PR #34's version — more descriptive, same intent

2. **Lines ~737** — Worker-only hatch test config
   - **Master**: adds `config.broodGestationSeconds = 0.05`
   - **PR #34**: adds `sim.colony.setCasteAllocation({ workers: 100, soldiers: 0, breeders: 0 })`
   - **Resolution**: Keep both — they are additive (gestation config + allocation config)

3. **Lines ~759** — Soldier hatch test config
   - **Master**: adds `config.broodGestationSeconds = 0.05`
   - **PR #34**: adds `sim.colony.setCasteAllocation({ workers: 0, soldiers: 100, breeders: 0 })`
   - **Resolution**: Keep both — same as above

## Compatibility Assessment

PR #34 is orthogonal to the other PRs and builds directly on master's existing allocation infrastructure. The changes extend `Colony.selectHatchRole()` and `Colony.chooseWorkFocus()` which are already present in master with simpler implementations. No semantic conflicts exist.
