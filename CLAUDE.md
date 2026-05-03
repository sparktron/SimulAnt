# CLAUDE.md — SimulAnt

See [AGENTS.md](AGENTS.md) for project-wide agent instructions (commands, patterns, testing rules, boundaries). This file extends those for Claude Code specifically.

## Claude Code Behavior

**Commit immediately after every code change.** This is a hard project rule. Don't batch changes — commit each logical edit as soon as it's complete.

**Bump the version on every code change.** Edit `VERSION` (repo root) using [Semantic Versioning](https://semver.org/) — `MAJOR.MINOR.PATCH`:
- **PATCH** — backward-compatible bug fix (e.g. `0.1.0 → 0.1.1`)
- **MINOR** — backward-compatible new feature or behavior (e.g. `0.1.0 → 0.2.0`)
- **MAJOR** — incompatible change to a public API or saved-state format (e.g. `0.1.0 → 1.0.0`)

Include the new version in the commit message (e.g. `fix(ant): clamp prevTurn — v0.1.1`). Pure docs or test-only changes do not require a version bump.

**Dev server is pre-configured.** `.claude/launch.json` points to `node server.js` on port 8000. Use the built-in preview tools rather than manually managing the server process.

**Verify UI changes in the browser preview** before reporting them complete. The simulation is canvas-rendered — type checking alone cannot confirm visual correctness. Use `preview_screenshot` or `preview_snapshot` as proof.

**Read docs before touching core systems.** `docs/core-simulation-architecture.md` documents the deterministic tick contract in detail. Read it before editing `TickScheduler`, `MacroEngine`, or `MicroPatchEngine`.

## Key Entry Points

| Purpose | File |
|---|---|
| Simulation config (60+ params) | `src/main.js` lines 38–108 |
| Ant state machine | `src/sim/ant.js` |
| Tick orchestration | `src/sim/core/TickScheduler.js` |
| World terrain + pheromones | `src/sim/world.js` |
| Surface rendering | `src/render/SurfaceRenderer.js` |
| Nest rendering | `src/render/NestRenderer.js` |
