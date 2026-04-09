# 🐜 SimAntWebApp

A browser-playable ant colony simulation inspired by **SimAnt**, with dual-view exploration (surface + nest), emergent worker behavior, pheromone systems, and colony management controls.

> ⚡ **No build step required** — just serve static files and play.

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
- Auto-dig tunnels with optional forced chamber carving.
- Pheromone channels for food/home/danger with runtime overlay toggles.

### 🎛️ Interactive tools
- Paint: food, wall, water, danger, erase.
- Brush radius, sim speed, and ant cap sliders.
- Colony worker/soldier target sliders.
- Quick actions: spawn food at cursor, add food to store, starve selected ant (debug/cheat controls).

### 🧱 Robust UI architecture
- Input routing layer for view-aware camera/tool interactions.
- Runtime error gate for cleaner fatal error reporting.
- Dedicated colony status dialog with triangle-based allocation controls.

---

## 🚀 Quick Start

### 1) Run locally (no build)

From the repository root:

**macOS / Linux**
```bash
python3 -m http.server 8000
```

**Windows (PowerShell / CMD)**
```powershell
py -3 -m http.server 8000
```

If `py` is unavailable:
```powershell
python -m http.server 8000
```

Open: [http://localhost:8000](http://localhost:8000)

### Python compatibility
Compatible with **CPython 3.8+** when using the built-in static file server.

---

## 🎮 Controls

### Core
- `Space` — Pause / Resume
- `N` — Step one tick
- `R` — Reset using current seed
- `Tab` — Toggle SURFACE / NEST view
- `H` — Open/close help panel

### Tools & overlays
- `1..5` — Select paint tool (food, wall, water, danger, erase)
- `T` — Toggle to-food pheromone overlay
- `L` — Toggle to-home pheromone overlay
- `D` — Toggle danger overlay
- `V` — Toggle scent overlay

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

---

## 💾 Save / Load
Use **SAVE** and **LOAD** to persist simulation state in `localStorage`.

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

---

Made with ❤️, tunnels, and tiny emergent chaos.
