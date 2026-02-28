# SimulAnt

A browser-playable, static-host ant colony simulation inspired by SimulAnt.

## Run locally

No build step required.

```bash
cd /path/to/SimulAnt
python3 -m http.server 8000
```

Open <http://localhost:8000> in a modern browser.

## Deploy as static files

Upload these files/folders directly to any static host:

- `index.html`
- `styles.css`
- `src/`
- `assets/` (optional)

Works on GitHub Pages, Netlify static deploy, Cloudflare Pages, or personal web hosting.

## Controls & tools

### Main controls
- **Pause / Start** simulation
- **Step**: run one fixed simulation tick
- **Reset Seed**: restart with provided seed for deterministic runs
- **Speed slider**: 0.5x to 10x
- **Ant cap slider**: colony size limit
- **Evaporation / Diffusion sliders**: pheromone behavior tuning
- **Pheromone update every N ticks**: performance quality tradeoff

### World editing
- Paint food
- Paint wall
- Paint water
- Paint spider zone (hazard)
- Erase terrain/food/pheromones
- Move nest

### Mouse
- Left drag: paint with current tool
- Right drag (or Shift+drag): pan camera
- Wheel: zoom

### Keyboard
- `Space`: pause/resume
- `N`: single-step
- `R`: reset from seed
- `1..6`: tool select
- `F`: toggle to-food pheromone overlay
- `G`: toggle to-home pheromone overlay
- `D`: toggle danger overlay
- `O`: toggle food overlay
- `U`: toggle underground/surface view
- `H`: show/hide help

## Save / load

Use **Save** and **Load** buttons to persist simulation state into `localStorage`.

## Performance tuning tips

- Lower **Ant cap** if FPS drops.
- Increase **Pheromone update every N ticks** (e.g., 3-5) for faster simulation.
- Reduce **Diffusion** to cut pheromone processing cost.
- Keep world at default `256x256` for smooth 60 FPS on typical laptops.


## Colony lifecycle

- Queen resides in nest and lays eggs over time when food reserves are available.
- Brood advances through egg -> larva -> pupa and hatches into role-based ants.
- Workers excavate underground tunnels, creating a growing nest network.

## Verification

Run quick syntax checks before opening a PR:

```bash
node --check src/main.js
node --check src/sim/world.js
node --check src/sim/ant.js
node --check src/sim/colony.js
node --check src/sim/rng.js
node --check src/render/renderer.js
node --check src/ui/controls.js
node --check src/ui/hud.js
```

