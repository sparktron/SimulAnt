# Known Issues

## Active

1. **Ant behavior class remains large**
   - `src/sim/ant.js` still contains dense role/state logic and should be split further.

2. **Food accounting still has multiple physical representations**
   - Canonical getters exist, but storage remains distributed across `foodStored`, virtual reserve, and pellet records.

3. **Save/load schema migration is minimal**
   - Load path now sanitizes config, but versioned schema migration/repair is still limited.

4. **UI control duplication remains partially legacy-driven**
   - Legacy sliders are wired into canonical state, but old UI affordances still exist and can confuse future maintainers.

5. **Performance risk at high entity counts**
   - World-scale pheromone updates and some per-tick scans remain hotspot candidates.

## Suggested next actions
- Continue Option B decomposition by extracting ant role handlers and shared state-machine utilities.
- Introduce explicit save schema versions with migration tests.
- Add profiling harness for large-ant scenarios and set performance budgets.
