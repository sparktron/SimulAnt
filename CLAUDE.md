@AGENTS.md

# Claude Code specifics

Everything project-wide — commands, patterns, testing rules, boundaries,
versioning, commit cadence — lives in AGENTS.md. This file covers only Claude
Code tooling behavior.

**Dev server is pre-configured.** `.claude/launch.json` points to
`node server.js` on port 8000. Use the built-in preview tools rather than
manually managing the server process.

**Verify UI changes in the browser preview** before reporting them complete.
The simulation is canvas-rendered — type checking alone cannot confirm visual
correctness. Use `preview_screenshot` or `preview_snapshot` as proof.

**Announce the expected version after every change.** Tell the user what
version string they should see in the running browser (e.g. "→ should show
v0.10.17"). This helps them spot stale tabs or servers.
