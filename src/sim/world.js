/*
    World state: terrain grid, pheromone fields, food pellets, nest location.

    Key responsibilities:
    - Terrain: GROUND/WALL/WATER/SOIL/TUNNEL/CHAMBER enum — determines passability
    - Pheromone fields: toFood, toHome, danger with diffusion/evaporation per tick
    - Spatial queries: isPassable, isBelowSurface, isUndergroundTile
    - Rendering prep: serialize/deserialize for save/load

    Important distinction:
    - isBelowSurface(x, y): y > nestY (spatial layer; used for view filtering)
    - isUndergroundTile(x, y): terrain == TUNNEL/CHAMBER (structural; used for behavior routing)
    These differ at the entrance mouth where ants are spatially below but structurally
    above, preventing incorrect state transitions.
*/

export const TERRAIN = {
  GROUND: 0,
  WALL: 1,
  WATER: 2,
  HAZARD: 3,
  SOIL: 4,
  TUNNEL: 5,
  CHAMBER: 6,
};

export class World {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.size = width * height;

    this.terrain = new Uint8Array(this.size);
    this.food = new Float32Array(this.size);
    this.nestFood = new Float32Array(this.size);

    this.toFood = new Float32Array(this.size);
    this.toHome = new Float32Array(this.size);
    this.danger = new Float32Array(this.size);

    // Recruitment channel (config.dualPheromone): a SECOND food-scent field,
    // short-lived and high-diffusion, separate from the long-lived toFood "route"
    // channel. A fresh pickup deposits a burst here; it spreads fast to nearby
    // searchers then evaporates, so discovery can be recruited aggressively
    // WITHOUT polluting the stable corridor field. Off by default (single mode);
    // when off this field stays empty and inert. Transient — not serialized.
    this.recruit = new Float32Array(this.size);

    // Exploration / dispersion channel (config.explorationField): a REPULSIVE
    // long-ish-lived field marking ground the colony has recently swept (searcher
    // coverage) and clusters that recently depleted (dead-source repulsion).
    // Searchers steer AWAY from it, spreading onto fresh ground and not re-checking
    // eaten-out spots. Off by default; empty + inert when off. Transient — not
    // serialized. See docs/exploration-field-design.md.
    this.explored = new Float32Array(this.size);

    // Harvest field (config.depletionReactive): a decaying "recent foraging
    // success" map. A successful pickup paints a disk here; the field then
    // accelerates toFood evaporation everywhere it is ABSENT, so a corridor to an
    // exhausted source (no longer re-painted) collapses fast while a live source's
    // corridor stays protected. Transient + sparse like the pheromone fields.
    this.harvest = new Float32Array(this.size);
    this._activeHarvest = [];

    // Double-buffer for pheromone updates: read from src, write to next, then swap
    this._toFoodNext = new Float32Array(this.size);
    this._toHomeNext = new Float32Array(this.size);
    this._dangerNext = new Float32Array(this.size);
    this._recruitNext = new Float32Array(this.size);
    this._exploredNext = new Float32Array(this.size);

    // Per-tick passability mask shared by all three pheromone fields. The
    // diffusion inner loop queries passability of each cell and its 4 neighbors;
    // computing it once into a flat array (instead of ~5 isPassable() calls per
    // cell per field, each recomputing index() and re-checking bounds) is the
    // single biggest win for the pheromone hotspot.
    this._passabilityMask = new Uint8Array(this.size);
    // Dirty flag for the passability mask. Terrain only changes on dig/tool
    // actions, so the mask can be cached across the (common) ticks where terrain
    // is static. Any terrain write must flip this — route writes through
    // setTerrain()/markTerrainDirty() so the flag stays in sync.
    this._passabilityDirty = true;

    // Active-cell tracking for the pheromone update. The fields are very sparse
    // (~3–9% non-zero; danger usually 0%), so we process only non-zero cells and
    // their 4-neighbors instead of scanning all 65k cells × 3 channels. Each
    // channel keeps the non-zero indices in its LIVE buffer and (separately) in
    // its SCRATCH buffer. Deposits append to the live list (see depositTo*),
    // which is exactly the next update's source set. Invariant: each buffer is 0
    // at every cell NOT in its list — maintained by clearing the scratch's stale
    // non-zeros before writing (see #updatePheromonesField).
    this._activeFood = [];
    this._activeFoodScratch = [];
    this._activeHome = [];
    this._activeHomeScratch = [];
    this._activeDanger = [];
    this._activeDangerScratch = [];
    this._activeRecruit = [];
    this._activeRecruitScratch = [];
    this._activeExplored = [];
    this._activeExploredScratch = [];
    // Reusable scratch for deduping the candidate set each tick (avoids a Set).
    this._candMark = new Uint8Array(this.size);
    this._candList = new Int32Array(this.size);

    // Render-cache versions: renderers compare these to skip rebuilding their
    // terrain/overlay bitmaps on frames where nothing they depict changed
    // (the render loop runs at display rate; sim ticks are usually slower).
    // terrainVersion bumps on any terrain write; fieldsVersion bumps whenever
    // the pheromone fields evolve or are bulk-cleared.
    this.terrainVersion = 0;
    this.fieldsVersion = 0;

    this.nestX = Math.floor(width * 0.5);
    this.nestY = Math.floor(height * 0.5);
    // Entrance sits at the surface boundary row (bottom of surface view).
    // This keeps nest entry/exit anchored at the visible horizon.
    this.entranceY = this.nestY;
    this.nestRadius = 8;
    this.nestInfluence = new Float32Array(this.size);

    this.initializeTerrain();
    this.recomputeNestInfluence();
  }

  index(x, y) {
    return y * this.width + x;
  }

  inBounds(x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  // Canonical terrain write. Use this instead of poking `terrain[idx]` directly
  // so the cached passability mask is invalidated whenever terrain changes.
  setTerrain(idx, value) {
    this.terrain[idx] = value;
    this._passabilityDirty = true;
    this.terrainVersion += 1;
  }

  // Signal that terrain changed via a bulk/direct write (e.g. a fill loop or
  // typed-array .set()) so the next mask query rebuilds.
  markTerrainDirty() {
    this._passabilityDirty = true;
    this.terrainVersion += 1;
  }

  // Signal that a pheromone field changed outside updatePheromones(). This
  // keeps render caches correct after tool edits that clear individual cells.
  markFieldsDirty() {
    this.fieldsVersion += 1;
  }

  // Canonical pheromone deposits. Callers MUST use these instead of writing
  // toFood/toHome/danger directly so the deposited cell is registered in the
  // active-cell list — otherwise it would never diffuse or evaporate. Math is
  // identical to the old in-place writes: Math.min(clampMax, current + amount),
  // with clampMax defaulting to Infinity for the unclamped dig boosts.
  depositToFood(idx, amount, clampMax = Infinity) {
    this.toFood[idx] = Math.min(clampMax, this.toFood[idx] + amount);
    this._activeFood.push(idx);
    this.markFieldsDirty();
  }

  depositToHome(idx, amount, clampMax = Infinity) {
    this.toHome[idx] = Math.min(clampMax, this.toHome[idx] + amount);
    this._activeHome.push(idx);
    this.markFieldsDirty();
  }

  depositDanger(idx, amount, clampMax = Infinity) {
    this.danger[idx] = Math.min(clampMax, this.danger[idx] + amount);
    this._activeDanger.push(idx);
    this.markFieldsDirty();
  }

  // Recruitment-channel deposit (config.dualPheromone). Same contract as the
  // other deposits: registers the cell in the active list so it diffuses/evaporates.
  depositRecruit(idx, amount, clampMax = Infinity) {
    this.recruit[idx] = Math.min(clampMax, this.recruit[idx] + amount);
    this._activeRecruit.push(idx);
  }

  // Exploration/dispersion-channel deposit (config.explorationField). Same contract
  // as the other deposits: registers the cell in the active list so it
  // diffuses/evaporates. Used for searcher coverage (per-step) and dead-source
  // repulsion (a disk via paintCircle); searchers read it as a repulsion.
  depositExplored(idx, amount, clampMax = Infinity) {
    this.explored[idx] = Math.min(clampMax, this.explored[idx] + amount);
    this._activeExplored.push(idx);
  }

  // Paint a disk of harvest "success" centered on a pickup. Only newly-activated
  // cells (0 -> non-zero) are pushed to the active list, so it stays dup-free;
  // re-painting a live source just tops up existing cells. See updatePheromones'
  // depletion-reactive decay.
  paintHarvest(cx, cy, radius, amount, clampMax) {
    this.paintCircle(cx, cy, radius, (idx) => {
      if (this.harvest[idx] === 0) this._activeHarvest.push(idx);
      this.harvest[idx] = Math.min(clampMax, this.harvest[idx] + amount);
    });
  }

  // Rebuild the live active lists by scanning the fields. Used after a bulk load
  // (fromSerialized) where the fields are set directly. Scratch buffers are
  // zero there, so their lists stay empty.
  #rebuildActiveLists() {
    this._activeFood = [];
    this._activeHome = [];
    this._activeDanger = [];
    this._activeRecruit = [];
    this._activeExplored = [];
    for (let i = 0; i < this.size; i += 1) {
      if (this.toFood[i] !== 0) this._activeFood.push(i);
      if (this.toHome[i] !== 0) this._activeHome.push(i);
      if (this.danger[i] !== 0) this._activeDanger.push(i);
      if (this.recruit[i] !== 0) this._activeRecruit.push(i);
      if (this.explored[i] !== 0) this._activeExplored.push(i);
    }
  }

  isPassable(x, y) {
    if (!this.inBounds(x, y)) return false;
    const terrain = this.terrain[this.index(x, y)];
    // Food pellets are not obstacles—ants can walk freely over them
    return (
      terrain !== TERRAIN.WALL &&
      terrain !== TERRAIN.WATER &&
      terrain !== TERRAIN.SOIL
    );
  }

  // Terrain-based classification: true for any TUNNEL/CHAMBER tile regardless
  // of y-coordinate. Use this for "is the ant/cell inside the carved nest
  // structure" checks (e.g. chamber navigation, nest-food storage).
  isUndergroundTile(x, y) {
    if (!this.inBounds(x, y)) return false;
    const terrain = this.terrain[this.index(x, y)];
    return terrain === TERRAIN.TUNNEL || terrain === TERRAIN.CHAMBER;
  }

  // Spatial classification: true when the tile is strictly below the
  // surface/underground horizon. Use this for view ownership / layer-based
  // logic (renderer filters, patch underground flag, HUD counts).
  isBelowSurface(x, y) {
    return y > this.nestY;
  }

  // Back-compat alias. Existing callers expect terrain-based semantics.
  isUnderground(x, y) {
    return this.isUndergroundTile(x, y);
  }

  initializeTerrain() {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const idx = this.index(x, y);
        this.terrain[idx] = y > this.nestY ? TERRAIN.SOIL : TERRAIN.GROUND;
      }
    }

    this.markTerrainDirty();
    this.#carveStarterNest();
  }

  setNest(x, y) {
    this.nestX = Math.max(0, Math.min(this.width - 1, x));
    this.nestY = Math.max(0, Math.min(this.height - 1, y));
    this.entranceY = this.nestY;
    this.recomputeNestInfluence();
    this.#carveStarterNest();
  }

  recomputeNestInfluence() {
    const maxDist = Math.hypot(this.width, this.height);
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const idx = this.index(x, y);
        const d = Math.hypot(x - this.nestX, y - this.nestY);
        this.nestInfluence[idx] = Math.max(0, 1 - d / maxDist);
      }
    }
  }

  paintCircle(cx, cy, radius, fn) {
    const r2 = radius * radius;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(this.width - 1, Math.floor(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(this.height - 1, Math.floor(cy + radius));

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          fn(this.index(x, y), x, y);
        }
      }
    }
  }

  #carveStarterNest() {
    // Larger starter chamber so brood/queen/nurses have room to spread out.
    // Carve strictly below the surface/underground boundary (y > nestY) so
    // row nestY remains surface; otherwise chamber ants at y = nestY would
    // leak into the surface view's bottom edge.
    this.paintCircle(this.nestX, this.nestY + 4, 6, (idx, _x, y) => {
      if (y > this.nestY) this.terrain[idx] = TERRAIN.CHAMBER;
    });

    // Widen the entrance shaft to 3 tiles so multiple ants can flow in parallel.
    // The shaft now starts at entranceY (in the surface yard) and extends down
    // through the yard ground into the soil chamber, giving the entrance a
    // visible mound surrounded by usable surface in all directions.
    const shaftTop = Math.max(0, Math.min(this.nestY, this.entranceY));
    const shaftBottom = this.nestY + 14;
    for (let y = shaftTop; y <= shaftBottom; y += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const tx = this.nestX + dx;
        if (!this.inBounds(tx, y)) continue;
        this.terrain[this.index(tx, y)] = TERRAIN.TUNNEL;
      }
      // Extra flaring near the surface mouth for smoother entry/exit
      if (y <= shaftTop + 2) {
        for (const dx of [-2, 2]) {
          const tx = this.nestX + dx;
          if (this.inBounds(tx, y)) this.terrain[this.index(tx, y)] = TERRAIN.TUNNEL;
        }
      }
    }

    this.markTerrainDirty();
  }

  /*
      Updates all three pheromone fields: toFood, toHome, danger.

      Each field is updated by:
      1. Evaporation: scale all values by (1 - lambda*dt) to decay over time
      2. Diffusion (conditional): spread values to neighbors every N ticks
      3. Clamping: cap all values at pheromoneMaxClamp to prevent overflow

      Diffusion timing: diffIntervalTicks allows sparse diffusion (e.g., every 2 ticks)
      to reduce CPU cost. Evaporation runs every tick regardless.

      Uses discrete diffusion equation:
      P_i^{t+1} = (1 - λ - 4D) * P_i^t + D * Σ(neighbors)
      where λ = evaporation rate, D = diffusion coefficient.

      Note: Stability requires 4D < 1 (i.e., D < 0.25); values >= 0.25 warn in console.
  */
  updatePheromones(config, tick) {
    if (config.enablePheromones === false) {
      this.toFood.fill(0);
      this.toHome.fill(0);
      this.danger.fill(0);
      this.recruit.fill(0);
      this.explored.fill(0);
      this._toFoodNext.fill(0);
      this._toHomeNext.fill(0);
      this._dangerNext.fill(0);
      this._recruitNext.fill(0);
      this._exploredNext.fill(0);
      this._activeFood.length = 0; this._activeFoodScratch.length = 0;
      this._activeHome.length = 0; this._activeHomeScratch.length = 0;
      this._activeDanger.length = 0; this._activeDangerScratch.length = 0;
      this._activeRecruit.length = 0; this._activeRecruitScratch.length = 0;
      this._activeExplored.length = 0; this._activeExploredScratch.length = 0;
      this.harvest.fill(0); this._activeHarvest.length = 0;
      this.fieldsVersion += 1;
      return;
    }
    const dt = config.tickSeconds || 1 / 30;
    const cadence = Math.max(1, Math.floor(config.diffIntervalTicks || 1));
    const shouldDiffuse = Number.isInteger(tick) ? tick % cadence === 0 : true;
    const foodDiff = shouldDiffuse ? config.diffFood : 0;
    const homeDiff = shouldDiffuse ? config.diffHome : 0;
    const dangerDiff = shouldDiffuse ? config.diffDanger : 0;
    // Recruitment channel diffuses faster (config.diffRecruit) to spread fresh
    // finds quickly; falls back to the food diffusion rate if unconfigured.
    const recruitDiff = shouldDiffuse ? (config.diffRecruit ?? config.diffFood) : 0;
    // Exploration channel: a positional marker, so little/no diffusion by default.
    const exploredDiff = shouldDiffuse ? (config.diffExplored ?? 0) : 0;
    // Recompute the passability mask once and reuse it across all three fields.
    const mask = this.#computePassabilityMask();
    // Use discrete diffusion equation: P_i^{t+1} = (1 - λ - 4D) * P_i^t + D * (neighbors sum)
    // where λ is evaporation per tick and D is diffusion coefficient. Each call
    // processes only that channel's active cells and returns the new non-zero
    // index list for the freshly written (scratch) buffer.
    const nf = this.#updatePheromonesField(this.toFood, this._toFoodNext, this._activeFood, this._activeFoodScratch, config.evapFood, foodDiff, config.pheromoneMaxClamp, dt, mask);
    const nh = this.#updatePheromonesField(this.toHome, this._toHomeNext, this._activeHome, this._activeHomeScratch, config.evapHome, homeDiff, config.pheromoneMaxClamp, dt, mask);
    const nd = this.#updatePheromonesField(this.danger, this._dangerNext, this._activeDanger, this._activeDangerScratch, config.evapDanger, dangerDiff, config.pheromoneMaxClamp, dt, mask);
    // Recruitment channel: same diffusion kernel, faster evaporation (config.evapRecruit).
    // In single mode (dualPheromone off) nothing deposits here, so its active list
    // is empty and this is a no-op — single-mode results stay byte-identical.
    const nr = this.#updatePheromonesField(this.recruit, this._recruitNext, this._activeRecruit, this._activeRecruitScratch, config.evapRecruit ?? config.evapFood, recruitDiff, config.pheromoneMaxClamp, dt, mask);
    // Exploration channel: slow evaporation (config.evapExplored) so a swept/dead
    // spot stays repulsive for a while. Empty + no-op until explorationField wires
    // deposits (increment 3), so single-mode results stay byte-identical.
    const ne = this.#updatePheromonesField(this.explored, this._exploredNext, this._activeExplored, this._activeExploredScratch, config.evapExplored ?? 0.1, exploredDiff, config.pheromoneMaxClamp, dt, mask);

    // Double-buffer: each field updater fully defined its *Next scratch buffer
    // (writing every candidate, with all non-candidates left at 0), so swap the
    // freshly computed buffer into the live slot instead of copying it back.
    // Every reader accesses world.toFood/toHome/danger per-call, so swapping the
    // reference is transparent — nothing caches the array across ticks.
    const tf = this.toFood; this.toFood = this._toFoodNext; this._toFoodNext = tf;
    const th = this.toHome; this.toHome = this._toHomeNext; this._toHomeNext = th;
    const td = this.danger; this.danger = this._dangerNext; this._dangerNext = td;
    const tr = this.recruit; this.recruit = this._recruitNext; this._recruitNext = tr;
    const te = this.explored; this.explored = this._exploredNext; this._exploredNext = te;

    // Swap active lists in lockstep with the buffers: the new live list is the
    // freshly computed non-zeros; the new scratch list is the old live list
    // (those cells still sit non-zero in the buffer that just became scratch,
    // and will be cleared on its next write).
    this._activeFoodScratch = this._activeFood; this._activeFood = nf;
    this._activeHomeScratch = this._activeHome; this._activeHome = nh;
    this._activeDangerScratch = this._activeDanger; this._activeDanger = nd;
    this._activeRecruitScratch = this._activeRecruit; this._activeRecruit = nr;
    this._activeExploredScratch = this._activeExplored; this._activeExplored = ne;

    // Depletion-reactive decay: collapse food trails that no longer lead to a
    // live source. Runs after the swap so it acts on the fresh toFood buffer and
    // its active list. ON by default since v0.47.0 (gated so it can be A/B'd off).
    if (config.depletionReactive) this.#applyDepletionDecay(config, dt);

    this.fieldsVersion += 1;
  }

  // Evolve the harvest field (decay) and apply EXTRA toFood evaporation wherever
  // harvest is absent. A live source is re-painted every pickup, so its corridor
  // stays protected (protection ~1, no extra decay) and is reinforced by carrier
  // deposits; once a source is exhausted its harvest zone fades over tens of ticks
  // and that corridor — no longer reinforced — collapses several times faster than
  // baseline evaporation, retracting from the dead tip inward. See
  // docs/pheromone-strategy.md (future direction #2).
  #applyDepletionDecay(config, dt) {
    // 1. Decay the harvest field over its (dup-free) active list.
    const harvestLambda = Math.max(0, config.evapHarvest ?? 0.5) * dt;
    const harvestKeep = Math.max(0, 1 - harvestLambda);
    const harvest = this.harvest;
    const survivors = [];
    for (let k = 0; k < this._activeHarvest.length; k += 1) {
      const idx = this._activeHarvest[k];
      const v = harvest[idx] * harvestKeep;
      if (v < 1e-4) { harvest[idx] = 0; } else { harvest[idx] = v; survivors.push(idx); }
    }
    this._activeHarvest = survivors;

    // 2. Apply extra toFood evaporation scaled by ABSENCE of nearby harvest.
    // Fallbacks match the shipped getDefaultConfig()/sanitizeTickConfig values
    // (Phase 0 rule: no silent physics drift). Do NOT restore the old 1.0 boost —
    // that is the documented "trap" dose that loses the A/B; the win is the gentle
    // 0.3. See docs/pheromone-strategy.md.
    const protectRef = Math.max(1e-6, config.harvestProtectRef ?? 0.2);
    const boost = Math.max(0, config.depletionDecayBoost ?? 0.3) * dt;
    if (boost === 0) return;
    const toFood = this.toFood;
    for (let k = 0; k < this._activeFood.length; k += 1) {
      const idx = this._activeFood[k];
      const protection = Math.min(1, harvest[idx] / protectRef);
      const extra = boost * (1 - protection);
      // extra < 1, so the cell stays strictly positive — it remains a valid
      // active-list entry and is snapped to 0 by the normal field update once it
      // crosses the evaporation threshold, exactly like baseline decay.
      if (extra > 0) toFood[idx] *= (1 - extra);
    }
  }

  // Flat 1/0 passability per cell, matching isPassable() exactly. Cached and
  // only rebuilt when terrain changes (dig/tool actions flip _passabilityDirty
  // via setTerrain/markTerrainDirty). On the common static-terrain tick this is
  // a single boolean check instead of an O(size) scan feeding three diffusion
  // passes.
  #computePassabilityMask() {
    const mask = this._passabilityMask;
    if (!this._passabilityDirty) return mask;
    const terrain = this.terrain;
    for (let i = 0; i < this.size; i += 1) {
      const t = terrain[i];
      mask[i] = (t !== TERRAIN.WALL && t !== TERRAIN.WATER && t !== TERRAIN.SOIL) ? 1 : 0;
    }
    this._passabilityDirty = false;
    return mask;
  }

  /*
      Active-cell pheromone update. Byte-identical to a full-grid sweep because:
      - Every cell whose full-sweep output could be non-zero is a candidate: it
        is either non-zero in src (in srcActive) or a 4-neighbor of one (only a
        >=threshold neighbor can diffuse a zero cell to non-zero).
      - All non-candidate cells must end at 0. The scratch buffer holds non-zeros
        only at its previous (dstStale) cells by invariant, so clearing those
        first leaves the whole buffer at 0 before candidates are written.
      Returns the list of non-zero indices written (the next live active list).
  */
  #updatePheromonesField(srcField, dstField, srcActive, dstStale, evaporationLambda, diffusionRate, clampMax, dt, mask) {
    const w = this.width;
    const h = this.height;

    const lambda = Math.max(0, evaporationLambda) * dt;
    const D = Math.max(0, diffusionRate) / 4;

    if (4 * D >= 1) {
      console.warn(
        `[SimAnt] Pheromone diffusion rate is unstable: 4D = ${(4 * D).toFixed(3)} (must be < 1). `
        + 'The pheromone field will oscillate instead of spreading smoothly. '
        + 'Set diffFood, diffHome, or diffDanger below 0.25 in the parameter editor.',
      );
    }

    const threshold = 1e-4;

    // 1. Clear the cells the scratch buffer still holds non-zero from when it was
    //    last live, so every non-candidate cell reads 0.
    for (let k = 0; k < dstStale.length; k += 1) dstField[dstStale[k]] = 0;

    // 2. Build the candidate set = srcActive ∪ 4-neighbors, deduped via _candMark.
    const mark = this._candMark;
    const cand = this._candList;
    let n = 0;
    for (let k = 0; k < srcActive.length; k += 1) {
      const idx = srcActive[k];
      const x = idx % w;
      const y = (idx - x) / w;
      if (!mark[idx]) { mark[idx] = 1; cand[n] = idx; n += 1; }
      if (x > 0 && !mark[idx - 1]) { mark[idx - 1] = 1; cand[n] = idx - 1; n += 1; }
      if (x < w - 1 && !mark[idx + 1]) { mark[idx + 1] = 1; cand[n] = idx + 1; n += 1; }
      if (y > 0 && !mark[idx - w]) { mark[idx - w] = 1; cand[n] = idx - w; n += 1; }
      if (y < h - 1 && !mark[idx + w]) { mark[idx + w] = 1; cand[n] = idx + w; n += 1; }
    }

    // 3. Process candidates (per-cell math identical to the full sweep), reset
    //    the markers, and collect the new non-zero indices.
    const newActive = [];
    for (let k = 0; k < n; k += 1) {
      const idx = cand[k];
      mark[idx] = 0;

      if (!mask[idx]) {
        dstField[idx] = 0;
        continue;
      }

      const x = idx % w;
      const y = (idx - x) / w;
      const center = srcField[idx];
      let value;
      if (center < threshold) {
        if (D === 0) {
          dstField[idx] = 0;
          continue;
        }
        let neighborSum = 0;
        let hasNonZeroNeighbor = false;

        if (x > 0 && mask[idx - 1] && srcField[idx - 1] >= threshold) {
          neighborSum += srcField[idx - 1];
          hasNonZeroNeighbor = true;
        }
        if (x < w - 1 && mask[idx + 1] && srcField[idx + 1] >= threshold) {
          neighborSum += srcField[idx + 1];
          hasNonZeroNeighbor = true;
        }
        if (y > 0 && mask[idx - w] && srcField[idx - w] >= threshold) {
          neighborSum += srcField[idx - w];
          hasNonZeroNeighbor = true;
        }
        if (y < h - 1 && mask[idx + w] && srcField[idx + w] >= threshold) {
          neighborSum += srcField[idx + w];
          hasNonZeroNeighbor = true;
        }

        if (!hasNonZeroNeighbor) {
          dstField[idx] = 0;
          continue;
        }

        const newValue = D * neighborSum;
        const clampedValue = Math.max(0, Math.min(clampMax, newValue));
        value = clampedValue < 1e-5 ? 0 : clampedValue;
      } else {
        let neighborSum = 0;
        let passableNeighbors = 0;

        if (x > 0 && mask[idx - 1]) { neighborSum += srcField[idx - 1]; passableNeighbors += 1; }
        if (x < w - 1 && mask[idx + 1]) { neighborSum += srcField[idx + 1]; passableNeighbors += 1; }
        if (y > 0 && mask[idx - w]) { neighborSum += srcField[idx - w]; passableNeighbors += 1; }
        if (y < h - 1 && mask[idx + w]) { neighborSum += srcField[idx + w]; passableNeighbors += 1; }

        // No-flux boundary (review bug #8): a cell can only diffuse OUT into its
        // passable neighbors, so it loses D per passable neighbor — not a flat 4D.
        // The old flat 4D leaked D*value into every wall/edge side, silently
        // steepening the home-scent gradient in tunnels (~9%/tick at diffHome 0.18).
        // Subtracting D*passableNeighbors conserves mass (outflow == neighbor inflow).
        const localDecay = Math.max(0, 1 - lambda - D * passableNeighbors);
        const newValue = localDecay * center + D * neighborSum;
        const clampedValue = Math.max(0, Math.min(clampMax, newValue));
        value = clampedValue < 1e-5 ? 0 : clampedValue;
      }

      dstField[idx] = value;
      if (value !== 0) newActive.push(idx);
    }

    return newActive;
  }

  getPheromoneStats() {
    let maxFood = 0;
    let maxHome = 0;
    let sumFood = 0;
    let sumHome = 0;
    let passable = 0;

    for (let i = 0; i < this.size; i += 1) {
      if (this.terrain[i] === TERRAIN.WALL || this.terrain[i] === TERRAIN.WATER || this.terrain[i] === TERRAIN.SOIL) continue;
      passable += 1;
      const food = this.toFood[i];
      const home = this.toHome[i];
      if (food > maxFood) maxFood = food;
      if (home > maxHome) maxHome = home;
      sumFood += food;
      sumHome += home;
    }

    const denom = Math.max(1, passable);
    return {
      maxFood,
      maxHome,
      avgFood: sumFood / denom,
      avgHome: sumHome / denom,
    };
  }

  serialize() {
    // Float32 fields are serialized at 9 significant digits — the exact
    // round-trip precision for float32 (Float32Array.set re-rounds the parsed
    // float64 back to the identical 32-bit value), so loads stay bit-identical
    // while the JSON is ~40% smaller than the default float64 repr on non-zero
    // cells. Saves land in localStorage (~5MB quota), so payload size is a
    // real constraint on large, pheromone-saturated worlds.
    const compactFloats = (field) => Array.from(field, (v) => (v === 0 ? 0 : Number(v.toPrecision(9))));
    return {
      width: this.width,
      height: this.height,
      nestX: this.nestX,
      nestY: this.nestY,
      entranceY: this.entranceY,
      nestRadius: this.nestRadius,
      terrain: Array.from(this.terrain),
      food: compactFloats(this.food),
      nestFood: compactFloats(this.nestFood),
      toFood: compactFloats(this.toFood),
      toHome: compactFloats(this.toHome),
      danger: compactFloats(this.danger),
    };
  }

  static fromSerialized(data) {
    const world = new World(data.width, data.height);
    world.nestX = data.nestX;
    world.nestY = data.nestY;
    world.entranceY = Number.isFinite(data.entranceY) ? data.entranceY : world.nestY;
    world.nestRadius = data.nestRadius;
    world.terrain.set(data.terrain);
    world.markTerrainDirty();
    world.food.set(data.food);
    if (Array.isArray(data.nestFood)) world.nestFood.set(data.nestFood);
    world.toFood.set(data.toFood);
    world.toHome.set(data.toHome);
    world.danger.set(data.danger);
    world.#rebuildActiveLists();
    world.recomputeNestInfluence();
    return world;
  }
}
