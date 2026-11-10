import { DIRS } from '../ant/constants.js';

/*
    Per-colony walking-distance field from every underground tile to the
    nearest of the colony's entrance mouths.

    Why: greedy "step to the neighbour closest to the mouth" steering has no
    memory, so an ant in a chamber whose straight line to the mouth is blocked
    by soil (a pocket beside a dug breach shaft, a chamber under the mouth that
    connects only sideways) flips between two tiles forever. Descending this
    field always makes progress along a real tunnel path.

    Domain: structural underground tiles (TUNNEL/CHAMBER) plus the mouth tiles
    themselves, 8-connected to match ant movement. Surface tiles are excluded so
    the field never routes through another colony's nest via the surface.

    The field is derived state (never serialized): it is a pure function of the
    current terrain and entrance list, rebuilt lazily whenever either changes,
    so save/load and continuous runs see identical values.
*/
export const UNREACHABLE = -1;
// Lagged-scent mode: a cut-off pocket's values climb one step per tick and
// fade to UNREACHABLE once they pass this cap, like a scent dying out.
export const SCENT_DISTANCE_CAP = 1000;

export class NestExitField {
  constructor(world) {
    this.world = world;
    this.distance = new Int32Array(world.size).fill(UNREACHABLE);
    this._queue = new Int32Array(world.size);
    this._terrainVersion = -1;
    this._entranceKey = -1;
    // Lagged-scent mode state (config.exitScentField). Unused in instant mode.
    this._scentSeeded = false;
    this._scentNext = null;
    this._scentTiles = null;
    this._scentTileCount = 0;
    this._scentTerrainVersion = -1;
  }

  get scentSeeded() {
    return this._scentSeeded;
  }

  /**
   * Lagged mode (config.exitScentField): instead of rebuilding instantly when
   * terrain changes, every tile updates once per tick from its 8 neighbours'
   * previous-tick values, so a change spreads at one tile per tick like a
   * scent wavefront. Mouths are 0; other passable underground tiles are the
   * smallest neighbour value + 1. The first call seeds the steady state (an
   * established nest already smells of its exits).
   */
  stepScent(entrances) {
    const world = this.world;
    if (!this._scentSeeded) {
      this._scentSeeded = true;
      this._scentNext = new Int32Array(world.size);
      this.#rebuild(entrances);
      return;
    }
    if (this._scentTerrainVersion !== world.terrainVersion) this.#collectScentTiles();

    const { width } = world;
    const prev = this.distance;
    const next = this._scentNext;
    next.fill(UNREACHABLE);
    for (const entrance of entrances) {
      if (!entrance || !world.inBounds(entrance.x, entrance.y)) continue;
      if (!world.isPassable(entrance.x, entrance.y)) continue;
      next[world.index(entrance.x, entrance.y)] = 0;
    }
    const tiles = this._scentTiles;
    for (let t = 0; t < this._scentTileCount; t += 1) {
      const idx = tiles[t];
      if (next[idx] === 0) continue;
      const x = idx % width;
      const y = (idx - x) / width;
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < DIRS.length; i += 1) {
        const nx = x + DIRS[i][0];
        const ny = y + DIRS[i][1];
        if (!world.inBounds(nx, ny)) continue;
        const d = prev[world.index(nx, ny)];
        if (d !== UNREACHABLE && d < best) best = d;
      }
      if (best + 1 <= SCENT_DISTANCE_CAP) next[idx] = best + 1;
    }
    this.distance = next;
    this._scentNext = prev;
  }

  #collectScentTiles() {
    const world = this.world;
    this._scentTerrainVersion = world.terrainVersion;
    if (!this._scentTiles) this._scentTiles = new Int32Array(world.size);
    let count = 0;
    for (let y = 0; y < world.height; y += 1) {
      for (let x = 0; x < world.width; x += 1) {
        if (world.isUndergroundTile(x, y) && world.isPassable(x, y)) {
          this._scentTiles[count++] = world.index(x, y);
        }
      }
    }
    this._scentTileCount = count;
  }

  /**
   * Rebuilds the field if terrain or the entrance list changed. Called once
   * per ant step that needs it, so the up-to-date check stays allocation-free.
   */
  ensureCurrent(entrances) {
    const world = this.world;
    const key = entranceKey(entrances, world.width);
    if (this._terrainVersion === world.terrainVersion && this._entranceKey === key) return;
    this._terrainVersion = world.terrainVersion;
    this._entranceKey = key;
    this.#rebuild(entrances);
  }

  distanceAt(x, y) {
    if (!this.world.inBounds(x, y)) return UNREACHABLE;
    return this.distance[this.world.index(x, y)];
  }

  #rebuild(entrances) {
    const world = this.world;
    const { width } = world;
    const distance = this.distance;
    const queue = this._queue;
    distance.fill(UNREACHABLE);

    let head = 0;
    let tail = 0;
    for (const entrance of entrances) {
      if (!entrance || !world.inBounds(entrance.x, entrance.y)) continue;
      if (!world.isPassable(entrance.x, entrance.y)) continue;
      const idx = world.index(entrance.x, entrance.y);
      if (distance[idx] !== UNREACHABLE) continue;
      distance[idx] = 0;
      queue[tail++] = idx;
    }

    while (head < tail) {
      const idx = queue[head++];
      const x = idx % width;
      const y = (idx - x) / width;
      const next = distance[idx] + 1;
      for (let i = 0; i < DIRS.length; i += 1) {
        const nx = x + DIRS[i][0];
        const ny = y + DIRS[i][1];
        if (!world.inBounds(nx, ny)) continue;
        const nIdx = world.index(nx, ny);
        if (distance[nIdx] !== UNREACHABLE) continue;
        if (!world.isUndergroundTile(nx, ny) || !world.isPassable(nx, ny)) continue;
        distance[nIdx] = next;
        queue[tail++] = nIdx;
      }
    }
  }
}

// Order-sensitive 32-bit hash of the mouth tiles. Entrances are only ever
// appended or moved, so a collision would need a coincident edit and terrain
// version, and even a stale field only misroutes: steering still checks
// passability, so it can never walk an ant into soil.
function entranceKey(entrances, width) {
  let key = entrances.length;
  for (const entrance of entrances) {
    key = (Math.imul(key, 31) + entrance.y * width + entrance.x) | 0;
  }
  return key >>> 0;
}
