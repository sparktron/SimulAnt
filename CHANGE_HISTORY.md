# Change History

## 2026-04-22 — Agent maintenance waves

### Wave 1: Stability + deterministic baseline
- Restored ant parse/runtime behavior by adding missing helper in `Ant`.
- Removed `Math.random()` from simulation path and used seeded RNG.
- Standardized HUD numeric formatting.
- Added/updated deterministic and safety tests.

### Wave 2: Option A hardening
- Implemented `diffIntervalTicks` cadence for diffusion while preserving per-tick evaporation.
- Added core simulation module smoke-import test.
- Sanitized loaded runtime config state before applying to simulation.
- Unified legacy caste sliders with canonical colony-status allocation flow.
- Added deterministic replay hash regression coverage.

### Wave 3: Option B (incremental structural refactor)
- Extracted surface food balancing policy from `SimulationCore` into `FoodEconomySystem`.
- Added nest spatial-state helper module to reduce direct behavior coupling in `Ant`.
- Introduced canonical colony food-ledger getters (`getNestPelletNutritionTotal`, `getTotalStoredFood`) and switched runtime HUD path to use canonical total.

## 2026-11-08 — 90s Retro and Realistic themes (v0.62.2 → v0.64.1)
- Replaced skin-name checks in the renderers and minimap with skin properties; golden render digests lock Classic/Retro/Modern output.
- Added the `nineties` theme (VGA palette, Bayer dither, pixel sprites, bevelled desktop-OS chrome, system fonts only).
- Added the `realistic` theme (seeded-noise terrain, shaded segmented ants, full-viewport canvas with glass chrome, Barlow).
- Added the optional `skin.composeTerrain()` renderer hook and the `tileTableCache()` and `noiseField()` skin helpers (own `SeededRng`, never the sim stream).
- Fixed canvas re-measure after a theme switch: it now waits until the previously retained stylesheet is removed.
- Design references live in `docs/design/` (mockup HTML and the canvas drawing code).

## Notes
- This file is intended as high-level historical context for future agents and maintainers.
