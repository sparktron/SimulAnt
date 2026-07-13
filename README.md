# 🐜 SimAntWebApp

A browser-playable ant colony simulation inspired by **SimAnt**, with dual-view exploration (surface + nest), emergent worker behavior, pheromone systems, and colony management controls.

> ⚡ **No build step required** — just serve static files and play.

Current landed version: **v0.56.9**. The simulation includes deterministic
save/load with explicit migrations, biological crowding controls, nest-space
carrying capacity, cached surface terrain rendering, and an explicit
replay-guarded `Ant.update` sense → choose → apply pipeline. Food-respawn drops
now use a 12-seed, long-run-tested 30–60-tile logistics band.
The 300-ant nest-capacity baseline is also validated against tighter and looser
capacity settings in a 20-seed long-run sweep. GUI controls now resynchronize
after loading, expose explicit overlay state, render every parameter group, and
support keyboard navigation for allocation controls.

---

## 📚 Table of Contents
- [✨ Features](#-features)
- [🚀 Quick Start](#-quick-start)
- [🎮 Controls](#-controls)
- [🧠 Colony Status Panel](#-colony-status-panel)
- [💾 Save / Load](#-save--load)
- [🌍 Static Deployment](#-static-deployment)
- [🛠 Performance Tips](#-performance-tips)
- [📖 Project Docs](#-project-docs)

---

## ✨ Features

### 🖥️ Two-view simulation
- Toggle between **SURFACE** and **NEST** views (`Tab` or button).
- Independent pan + zoom controls for each view.
- Live HUD with ants, food, FPS, dig status, pheromone stats, and health metrics.

### 🧪 Simulation + colony behavior
- Deterministic runs via seed-based reset.
- Queen-led reproduction and worker/soldier caste dynamics.
- Nurse workers tend the brood chamber: they feed the queen when her hunger or health drops, spread overcrowded larvae (reducing crowding slows gestation by up to 40%), and patrol distributed sub-areas of the chamber rather than piling on one tile.
- Auto-dig tunnels with optional forced chamber carving.
- Pheromone channels for food/home/danger with runtime overlay toggles.

### 🎛️ Interactive tools
- Paint: food, wall, water, danger, erase.
- Brush radius, sim speed, and ant cap sliders.
- Colony work and caste allocation triangles.
- Quick actions: spawn food at cursor, add food to store, starve selected ant (debug/cheat controls).

### 🧱 Robust UI architecture
- Input routing layer for view-aware camera/tool interactions.
- Runtime error gate for cleaner fatal error reporting.
- Dedicated colony status dialog with triangle-based allocation controls.

---

## 🚀 Quick Start

### 1) Run locally (no build)

From the repository root, start the bundled Node dev server:

```bash
node server.js
```

It listens on port `8000` by default. To use a different port:

```bash
PORT=8090 node server.js
```

Open: [http://localhost:8000](http://localhost:8000) (or whichever `PORT` you set).
Stop with `Ctrl+C` in the terminal.

The server sends `Cache-Control: no-cache, no-store, must-revalidate` on every
response, so edits to JS/CSS show up on a normal page reload without needing
a hard refresh.

By default only `404`s are logged. Set `VERBOSE=1` to log every request,
or `QUIET=1` to silence everything except the startup banner.

### Node compatibility
Compatible with **Node.js 18+** (no `package.json`, no install step —
`server.js` only uses Node's built-in `http`, `fs`, and `path` modules).

---

## 🎮 Controls

### Core
- `Space` — Pause / Resume
- `N` — Step one tick
- `R` — Reset using current seed
- `Q` — Toggle SURFACE / NEST view
- `H` — Open/close help panel

### Tools & overlays
- `1..7` — Select paint tool (food, wall, water, danger, erase, dig, fill)
- `T` — Toggle to-food pheromone overlay
- `L` — Toggle to-home pheromone overlay
- `D` — Toggle danger overlay
- `V` — Toggle scent overlay
- `J` — Toggle ant job colors and legend
- `P` — Enable / disable pheromone simulation
- `Y` — Download the rolling stats log (`Shift+Y` for CSV)

### Digging + debug actions
- `F` — Spawn food cluster near cursor (surface)
- `G` — Toggle auto-dig
- `C` — Force chamber at active dig front
- `O` — Add +50 nutrition to food store
- `K` — Starve selected ant
- `F3` — Toggle debug stats
- `F4` — Toggle queen marker

### Mouse
- Left drag — Paint with selected tool
- Right drag or `Shift` + drag — Pan active view
- Mouse wheel — Zoom active view

---

## 🧠 Colony Status Panel
Use the **COLONY STATUS** button to open weighted triangle controls for:
- **Work allocation** (forage / dig / nurse)
- **Caste allocation** (workers / soldiers / breeders)

These settings feed directly into simulation behavior and spawn strategy.
The triangles can be clicked or dragged; when focused, arrow keys move the
allocation marker.

---

## 💾 Save / Load
Use **SAVE** and **LOAD** to persist simulation state in `localStorage`.
Malformed saves are rejected without replacing the active simulation; older
supported saves migrate forward automatically.
Loading also refreshes sliders, tool selection, parameter inputs, and overlay
button states so the controls match the restored simulation.

---

## 🌍 Static Deployment
Deploy directly to static hosting providers (no backend required):
- [GitHub Pages](https://pages.github.com/)
- [Netlify](https://www.netlify.com/)
- [Cloudflare Pages](https://pages.cloudflare.com/)
- Any standard static file host

Upload:
- `index.html`
- `styles.css`
- `src/`
- `assets/` (optional)

---

## 🛠 Performance Tips
- Lower **Ant cap** if frame rate drops.
- Increase pheromone update interval to reduce simulation cost.
- Tune diffusion/evaporation carefully for balance + performance.
- Keep world size at default (`256x256`) for smooth play on typical laptops.

### Recent Optimizations (Phase 2–3)
- **Spatial hash grid** for ant counting: O(n) → O(1) per position lookup
- **Set-based nest food tile tracking**: O(pellets) → O(1) occupancy checks
- **Bounded queen safe-tile search**: Full 256×256 world scan → 30-tile radius around nest
- **Entrance pheromone throttling**: Every tick → every 5 ticks (reduced overhead)
- **Deterministic food respawn**: Hardcoded locations → randomized angles/distances (better testing)

---

## 📖 Project Docs
- [Core simulation architecture](docs/core-simulation-architecture.md)
- [Post-refactor improvement plan](docs/post-refactor-improvement-plan.md)
- [Onboarding analysis](docs/onboarding-analysis.md)
- [Implementation report (2026-04-22)](docs/2026-04-22-fix-implementation-report.md)
- [Open items / TODO plan](docs/open-items-todo.md)
- [Systematic code-review status](docs/code-review-plan-2026-05-30.md)
- [Known issues](docs/KNOWN_ISSUES.md)
- [Environmental foraging experiments](docs/environmental-foraging-tests.md)
- [Change history](CHANGE_HISTORY.md)

---

Made with ❤️, tunnels, and tiny emergent chaos.
