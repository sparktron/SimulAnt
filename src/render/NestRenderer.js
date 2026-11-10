import { TERRAIN } from '../sim/world.js';
import { Ant } from '../sim/ant.js';
import { getSkin } from './skins/index.js';

/**
 * Nest Renderer -- Side-view 2D cross-section of the underground nest.
 *
 * VIEW ARCHITECTURE
 * -----------------
 * Draws the full world height with emphasis on underground: a sky band
 * above the nest line provides orientation, a green ground-surface strip
 * marks the horizon, and below is soil with carved-out tunnel passages.
 *
 * DATA OWNERSHIP
 *   View-specific : cameraX, cameraY, zoom (restored on toggle)
 *   Shared (read)  : world terrain, colony ants, queen state
 *
 * COORDINATE SYSTEM
 *   (x, depth) where x is horizontal position and depth (y) increases
 *   downward into the earth.  world.nestY is the ground-level horizon.
 */
export class NestRenderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.skin = getSkin('classic');
    this._headings = new WeakMap();

    this.cameraX = world.width * 0.5;
    this.cameraY = world.nestY + 28;
    this.zoom = 3;

    this._off = document.createElement('canvas');
    this._off.width = world.width;
    this._off.height = world.height;
    this._offCtx = this._off.getContext('2d');
    this._terrainImage = null;
  }

  setSkin(name) {
    this.skin = getSkin(name);
    this._terrainCacheKey = '';
  }

  heading(ant) {
    const previous = this._headings.get(ant);
    let angle = previous?.angle ?? 0;
    if (previous && (ant.x !== previous.x || ant.y !== previous.y)) {
      angle = Math.atan2(ant.y - previous.y, ant.x - previous.x);
    }
    this._headings.set(ant, { x: ant.x, y: ant.y, angle });
    return angle;
  }

  setWorld(world) {
    this.world = world;
    this._terrainCacheKey = '';
    this._off.width = world.width;
    this._off.height = world.height;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  screenToWorld(sx, sy) {
    this.#enforceNestViewBounds();
    const viewW = this.canvas.clientWidth / this.zoom;
    const viewH = this.canvas.clientHeight / this.zoom;
    const x = Math.floor(this.cameraX - viewW * 0.5 + sx / this.zoom);
    const y = Math.floor(this.cameraY - viewH * 0.5 + sy / this.zoom);
    // The nest view's sky band (y < nestY) is decorative context — clicks
    // there must not mutate surface-band terrain via tool paint. Surface
    // clicks belong to the surface view's screenToWorld.
    if (y < this.world.nestY || y >= this.world.height) return null;
    if (x < 0 || x >= this.world.width) return null;
    return { x, y };
  }

  draw(colony, overlays = {}, options = {}) {
    this.#enforceNestViewBounds();
    const { ctx } = this;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;

    ctx.fillStyle = this.skin.nestBackground;
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(cw * 0.5, ch * 0.5);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cameraX, -this.cameraY);

    this.#drawTerrain(ctx);
    this.#drawNestFood(ctx, colony);
    this.#drawEggs(ctx, colony);
    this.#drawAnts(ctx, colony, options.selectedAntId, options.showDebugStats, overlays);
    if (options.rivalColony) {
      this.#drawNestFood(ctx, options.rivalColony);
      this.#drawEggs(ctx, options.rivalColony);
      this.#drawAnts(
        ctx,
        options.rivalColony,
        options.selectedAntId,
        options.showDebugStats,
        overlays,
      );
    }

    ctx.restore();
    this.skin.postProcess(ctx, cw, ch, this);
  }

  /* ------------------------------------------------------------------
   * Terrain: sky gradient, green horizon, soil with tunnels.
   * ----------------------------------------------------------------*/
  #drawTerrain(ctx) {
    const { world } = this;
    const W = world.width;
    const H = world.height;

    const key = `${world.terrainVersion ?? -1}|${this.skin.name}`;
    if (world.terrainVersion !== undefined && this._terrainCacheKey === key) {
      this.#blitTerrain(ctx, W, H);
      this.#drawHorizon(ctx, W, world.nestY);
      return;
    }
    this._terrainCacheKey = key;
    this._off.width = W;
    this._off.height = H;

    const image = this._offCtx.createImageData(W, H);
    const data = image.data;

    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const idx = y * W + x;
        const o = idx * 4;
        const terrain = world.terrain[idx];

        const carved = terrain === TERRAIN.TUNNEL || terrain === TERRAIN.CHAMBER;
        const [r, g, b] = this.skin.nestTerrainPixel(terrain, x, y, idx, world, carved && this.#isTunnelEdge(x, y));

        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = 255;
      }
    }

    this._offCtx.putImageData(image, 0, 0);
    this._terrainImage = this.skin.composeTerrain?.(this._off, world, this) || this._off;
    this.#blitTerrain(ctx, W, H);

    this.#drawHorizon(ctx, W, world.nestY);
  }

  #blitTerrain(ctx, W, H) {
    ctx.imageSmoothingEnabled = false;
    if (this._terrainImage && this._terrainImage !== this._off) ctx.drawImage(this._terrainImage, 0, 0, W, H);
    else ctx.drawImage(this._off, 0, 0);
  }

  #drawHorizon(ctx, W, nestY) {
    // Horizon line
    ctx.strokeStyle = this.skin.horizon;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, nestY + 0.5);
    ctx.lineTo(W, nestY + 0.5);
    ctx.stroke();
  }


  #drawNestFood(ctx, colony) {
    const pellets = colony.nestFoodPellets || [];
    for (let i = 0; i < pellets.length; i += 1) {
      const pellet = pellets[i];
      if (pellet.amount <= 0.01) continue;
      if (pellet.y <= this.world.nestY) continue;
      const r = Math.max(0.2, Math.min(0.45, 0.18 + Math.sqrt(pellet.amount) * 0.08));
      ctx.fillStyle = this.skin.food;
      if (this.skin.drawFood) { this.skin.drawFood(ctx, pellet.x, pellet.y); continue; }
      ctx.beginPath();
      ctx.arc(pellet.x + 0.5, pellet.y + 0.5, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  #drawEggs(ctx, colony) {
    // Draw larvae in various growth stages in the nest chamber.
    const larvae = colony.larvae || [];
    if (!colony.queen.alive || larvae.length === 0) return;

    const homeX = Number.isFinite(colony.homeX) ? colony.homeX : this.world.nestX;
    const homeY = Number.isFinite(colony.homeY) ? colony.homeY : this.world.nestY;
    const broodX = Math.max(0, Math.min(this.world.width - 1, homeX + 4));
    const broodY = Math.max(this.world.nestY + 2, Math.min(this.world.height - 1, homeY + 8));

    // Nurses keep larvae in a compact, even brood patch rather than tracing queen movement.
    const cols = Math.max(1, Math.ceil(Math.sqrt(larvae.length)));
    const rowSpacing = 0.72;
    const colSpacing = 0.78;
    const rows = Math.ceil(larvae.length / cols);
    const patchHalfWidth = ((cols - 1) * colSpacing) * 0.5;
    const patchHalfHeight = ((rows - 1) * rowSpacing) * 0.5;

    for (let i = 0; i < larvae.length; i += 1) {
      const larva = larvae[i];
      const row = Math.floor(i / cols);
      const col = i % cols;
      const stagger = (row % 2) * (colSpacing * 0.5);
      const larvaX = broodX - patchHalfWidth + (col * colSpacing) + stagger;
      const larvaY = broodY - patchHalfHeight + (row * rowSpacing);

      // Size grows from ~0.35 (stage 1, like food pellet) to ~0.7 (stage 4, like ~4 pellets)
      // Stage 1: 0.35, Stage 2: 0.45, Stage 3: 0.6, Stage 4: 0.7
      const stage = larva.stage || 1;
      const baseRadius = 0.35 + (stage - 1) * 0.118;  // linear growth across 4 stages

      if (this.skin.drawLarva) { this.skin.drawLarva(ctx, larvaX, larvaY, baseRadius); continue; }
      // Draw larva with color indicating stage (lighter to darker)
      const hue = 200 - (stage - 1) * 20;  // blues and teals
      ctx.fillStyle = `hsl(${hue}, 80%, ${85 - (stage - 1) * 8}%)`;
      ctx.beginPath();
      ctx.arc(larvaX + 0.5, larvaY + 0.5, baseRadius, 0, Math.PI * 2);
      ctx.fill();

      // Draw outline for better visibility
      ctx.strokeStyle = `hsl(${hue}, 60%, 60%)`;
      ctx.lineWidth = 0.15;
      ctx.stroke();
    }
  }

  #isTunnelEdge(x, y) {
    const { world } = this;
    const neighbors = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (let i = 0; i < neighbors.length; i += 1) {
      const nx = x + neighbors[i][0];
      const ny = y + neighbors[i][1];
      if (!world.inBounds(nx, ny)) return true;
      const nTerrain = world.terrain[world.index(nx, ny)];
      if (nTerrain !== TERRAIN.TUNNEL && nTerrain !== TERRAIN.CHAMBER) {
        return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------
   * Entities: underground ants + queen marker (always shown while alive).
   * ----------------------------------------------------------------*/
  #drawAnts(ctx, colony, selectedAntId, showDebugStats, overlays = {}) {
    const { world } = this;
    const halfViewW = this.canvas.clientWidth / this.zoom * 0.5;
    const halfViewH = this.canvas.clientHeight / this.zoom * 0.5;
    const minX = this.cameraX - halfViewW - 1;
    const maxX = this.cameraX + halfViewW + 1;
    const minY = this.cameraY - halfViewH - 1;
    const maxY = this.cameraY + halfViewH + 1;

    for (const ant of colony.ants) {
      const antTerrain = world.terrain?.[world.index(ant.x, ant.y)];
      const antInCarvedNest = antTerrain === TERRAIN.TUNNEL || antTerrain === TERRAIN.CHAMBER;
      // Nest view owns:
      // - rows strictly below the horizon, and
      // - carved nest tiles (tunnel/chamber), including shaft cells above
      //   the horizon line.
      if (ant.y <= world.nestY && !antInCarvedNest) continue;
      if (ant.x < minX || ant.x > maxX || ant.y < minY || ant.y > maxY) continue;
      const drawY = ant.y;
      const color = overlays.showAntJobs
        ? Ant.getJobColor(ant.state, ant.workFocus, ant.role)
        : Ant.getNormalColor(ant.state, ant.baseColor);
      this.skin.drawAnt(ctx, ant, colony, {
        color, showAntJobs: overlays.showAntJobs,
        selected: selectedAntId === ant.id,
        heading: this.skin.usesHeading ? this.heading(ant) : 0, zoom: this.zoom,
      });

      if (showDebugStats) {
        ctx.fillStyle = '#ffffff';
        const c = ant.carryingType && ant.carryingType !== 'none' ? ` ${ant.carryingType[0].toUpperCase()}` : '';
        ctx.font = '2.8px monospace';
        ctx.fillText(`H:${Math.round(ant.hunger)} HP:${Math.round(ant.health)}${c}`, ant.x + 1.2, drawY - 0.2);
      }
    }

    // Always draw the queen when alive - distinctive purple with gold center
    if (colony.queen.alive) {
      const queenX = Number.isFinite(colony.queen.x) ? colony.queen.x : (colony.homeX ?? world.nestX);
      const queenY = Number.isFinite(colony.queen.y) ? colony.queen.y : world.nestY + 6;

      this.skin.drawQueen(ctx, queenX, queenY, colony);
    }

    if (showDebugStats) {
      const homeX = Number.isFinite(colony.homeX) ? colony.homeX : world.nestX;
      ctx.fillStyle = '#e8f6ff';
      ctx.font = '3px monospace';
      ctx.fillText(`FoodStore:${Math.round(colony.foodStored)}`, homeX + 4, world.nestY + 8);
      ctx.fillText(`Queen H:${Math.round(colony.queen.hunger)} HP:${Math.round(colony.queen.health)}`, homeX + 4, world.nestY + 11);
      ctx.fillText(`NestPellets:${colony.nestFoodPellets?.length || 0}`, homeX + 4, world.nestY + 14);
    }
  }

  #enforceNestViewBounds() {
    const { world } = this;
    const nestDepth = world.height - world.nestY;
    const minZoom = Math.max(1, this.canvas.clientHeight / nestDepth);
    this.zoom = Math.max(this.zoom, minZoom);

    const viewW = this.canvas.clientWidth / this.zoom;
    const viewH = this.canvas.clientHeight / this.zoom;

    const minX = viewW * 0.5;
    const maxX = world.width - viewW * 0.5;
    this.cameraX = minX > maxX ? world.width * 0.5 : Math.max(minX, Math.min(maxX, this.cameraX));

    const minY = world.nestY + viewH * 0.5;
    const maxY = world.height - viewH * 0.5;
    this.cameraY = minY > maxY ? (world.nestY + world.height) * 0.5 : Math.max(minY, Math.min(maxY, this.cameraY));
  }
}
