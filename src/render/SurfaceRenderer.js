import { drawCorpses } from './CorpseRenderer.js';
/*
    Top-down rendering of the surface (y <= nestY).

    Responsibilities:
    - Render terrain (ground/walls/water as colored 1×1 tiles)
    - Render pheromone overlays (food/home/danger as heatmaps)
    - Render food pellets (white dots, diminish if carried)
    - Render ants (sized by role, colored by job state)
    - Render entrance mounds (3D-like appearance)
    - Transform between screen coordinates and world coordinates

    Camera system:
    - cameraX/Y is the world tile at screen center
    - zoom scales the view (3x means 3 world tiles per screen pixel)
    - Surface bounds restrict camera to show only y <= nestY

    Determinism: All rendering is stateless; same world produces same image.
    Uses off-screen canvas for terrain (ImageData) to avoid per-pixel fills.
*/

import { TERRAIN, getDisplayTrailValue } from '../sim/world.js';
import { Ant } from '../sim/ant.js';
import { getSkin } from './skins/index.js';

// Surface view treats underground tiles (SOIL, TUNNEL) as GROUND for visual simplicity.
// This prevents the bottom rows from looking cluttered with brown soil.
export function normalizeSurfaceTerrain(terrain) {
  return terrain === TERRAIN.SOIL || terrain === TERRAIN.TUNNEL ? TERRAIN.GROUND : terrain;
}

export function getSurfaceMinZoom(canvasHeight, nestY) {
  // Surface view should fill the canvas with the true surface band (rows 0..nestY).
  // At minZoom, the entire surface is visible; ants can forage across the full canvas.
  const surfaceHeight = Math.max(1, nestY + 1);
  return canvasHeight / surfaceHeight;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class SurfaceRenderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.skin = getSkin('classic');
    this._headings = new WeakMap();

    this.cameraX = world.width * 0.5;
    this.cameraY = world.nestY;
    this.zoom = 3;

    this._off = document.createElement('canvas');
    this._offCtx = this._off.getContext('2d');

    // Cache key of the last terrain bitmap rendered into _off. The render
    // loop runs at display rate but terrain/pheromones change only on sim
    // ticks (or tool edits), so most frames can reuse the previous bitmap.
    this._terrainCacheKey = '';
    // What actually gets blitted: _off itself, or a skin's composed version of it.
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
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  screenToWorld(sx, sy) {
    this.#enforceSurfaceViewBounds();
    const viewW = this.canvas.clientWidth / this.zoom;
    const viewH = this.canvas.clientHeight / this.zoom;
    const x = clamp(Math.floor(this.cameraX - viewW * 0.5 + sx / this.zoom), 0, this.world.width - 1);
    const y = Math.floor(this.cameraY - viewH * 0.5 + sy / this.zoom);
    // The underground padding rows (y > nestY) are shown as brown soil for
    // context only — they are not interactive. Return null so the input
    // router ignores these clicks instead of snapping to nestY.
    if (y < 0 || y > this.world.nestY) return null;
    return { x, y };
  }

  draw(colony, overlays, nestEntrances, foodPellets, options = {}) {
    this.#enforceSurfaceViewBounds();
    const { ctx } = this;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;

    ctx.fillStyle = this.skin.surfaceBackground;
    ctx.fillRect(0, 0, cw, ch);
    this.skin.preProcess?.(ctx, cw, ch, this);

    ctx.save();
    ctx.translate(cw * 0.5, ch * 0.5);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cameraX, -this.cameraY);

    this.#drawTerrain(ctx, overlays);
    this.skin.drawFields(ctx, this.world, overlays, this);
    this.#drawFoodPellets(ctx, foodPellets);
    this.#drawAntLions(ctx);
    const allEntrances = options.rivalNestEntrances
      ? [...nestEntrances, ...options.rivalNestEntrances]
      : nestEntrances;
    this.#drawEntranceMounds(ctx, allEntrances, options.rivalNestEntrances);
    drawCorpses(ctx, colony, this.world, false);
    this.#drawAnts(ctx, colony, allEntrances, options.selectedAntId, options.showDebugStats, overlays);
    if (options.rivalColony) {
      drawCorpses(ctx, options.rivalColony, this.world, false);
      this.#drawAnts(
        ctx,
        options.rivalColony,
        allEntrances,
        options.selectedAntId,
        options.showDebugStats,
        overlays,
      );
    }
    if (options.showDebugStats && options.cursor) this.#drawCursorDebug(ctx, options.cursor);
    if (options.showEntranceInfo) this.#drawEntranceDebug(ctx, nestEntrances);

    ctx.restore();
    this.skin.postProcess(ctx, cw, ch, this);
  }

  #drawTerrain(ctx, overlays) {
    const { world } = this;
    const W = world.width;
    const H = world.nestY + 1;

    // Rebuild the offscreen bitmap only when something it depicts changed:
    // terrain always feeds it; the pheromone fields only matter while a
    // field overlay is visible. Otherwise reuse the cached bitmap — at 60fps
    // over a ~12 ticks/sec sim this skips most rebuilds even with scent on.
    const fieldsVisible = this.skin.fieldsInTerrain && (overlays.showToFood || overlays.showToHome || overlays.showScent || overlays.showDanger);
    const cacheKey = `${world.terrainVersion ?? -1}|${fieldsVisible ? world.fieldsVersion ?? -1 : 'off'}`
      + `|${!!overlays.showToFood}|${!!overlays.showToHome}|${!!overlays.showScent}|${!!overlays.showDanger}`;
    if (cacheKey === this._terrainCacheKey && this._off.width === W && this._off.height === H) {
      this.#blitTerrain(ctx, W, H);
      return;
    }
    this._terrainCacheKey = cacheKey;

    this._off.width = W;
    this._off.height = H;

    const image = this._offCtx.createImageData(W, H);
    const data = image.data;

    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const idx = y * W + x;
        const o = idx * 4;
        const terrain = world.terrain[idx];
        const [r, g, b] = this.skin.surfaceTerrainPixel(terrain, x, y, idx, world, overlays);

        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = this.skin.surfaceAlpha(terrain);
      }
    }

    this._offCtx.putImageData(image, 0, 0);
    // A skin may bake detail (smooth upscale, grain) once per rebuild instead
    // of paying for it on every frame.
    this._terrainImage = this.skin.composeTerrain?.(this._off, world, this) || this._off;
    this.#blitTerrain(ctx, W, H);
  }

  #blitTerrain(ctx, W, H) {
    ctx.imageSmoothingEnabled = false;
    if (this._terrainImage && this._terrainImage !== this._off) ctx.drawImage(this._terrainImage, 0, 0, W, H);
    else ctx.drawImage(this._off, 0, 0);
  }

  #drawFoodPellets(ctx, foodPellets) {
    ctx.fillStyle = this.skin.food;
    for (const pellet of foodPellets) {
      // Surface owns rows y <= nestY (complementary to NestRenderer which
      // draws y > nestY); keeps pellets from being double-rendered.
      if (pellet.y > this.world.nestY) continue;
      if (this.skin.drawFood) this.skin.drawFood(ctx, pellet.x, pellet.y);
      else ctx.fillRect(pellet.x, pellet.y, 1, 1);
    }
  }

  #drawAntLions(ctx) {
    for (const lion of this.world.antLions || []) {
      // Sand funnel, dark body, and paired mandibles distinguish predators
      // from ants at both overview and close zoom.
      ctx.fillStyle = '#caa66b';
      ctx.beginPath();
      ctx.arc(lion.x + 0.5, lion.y + 0.5, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#806039';
      ctx.beginPath();
      ctx.arc(lion.x + 0.5, lion.y + 0.5, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#38291d';
      ctx.fillRect(lion.x - 0.2, lion.y - 0.2, 1.4, 1.4);
      ctx.strokeStyle = '#f4dfb0';
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      ctx.moveTo(lion.x - 0.5, lion.y - 1.3);
      ctx.lineTo(lion.x, lion.y);
      ctx.moveTo(lion.x + 1.5, lion.y - 1.3);
      ctx.lineTo(lion.x + 1, lion.y);
      ctx.stroke();
      ctx.fillStyle = '#492e26';
      ctx.fillRect(lion.x - 1.5, lion.y + 3.2, 4, 0.5);
      ctx.fillStyle = '#8ed15d';
      ctx.fillRect(lion.x - 1.5, lion.y + 3.2, 4 * lion.health / 100, 0.5);
    }
  }

  #drawEntranceMounds(ctx, nestEntrances, rivals = []) {
    for (const entrance of nestEntrances) this.skin.drawEntrance(ctx, entrance, rivals.includes(entrance) ? 'red' : 'black');
  }

  #drawAnts(ctx, colony, nestEntrances, selectedAntId, showDebugStats, overlays = {}) {
    const { world } = this;
    const halfViewW = this.canvas.clientWidth / this.zoom * 0.5;
    const halfViewH = this.canvas.clientHeight / this.zoom * 0.5;
    const minX = this.cameraX - halfViewW - 1;
    const maxX = this.cameraX + halfViewW + 1;
    const minY = this.cameraY - halfViewH - 1;
    const maxY = this.cameraY + halfViewH + 1;

    ctx.font = '2.8px monospace';
    const terrain = world.terrain;
    const worldW = world.width;
    const nestY = world.nestY;
    for (const ant of colony.ants) {
      if (ant.y > nestY) continue;
      if (ant.x < minX || ant.x > maxX || ant.y < minY || ant.y > maxY) continue;
      const antTerrain = terrain ? terrain[ant.y * worldW + ant.x] : undefined;
      if (antTerrain === TERRAIN.TUNNEL || antTerrain === TERRAIN.CHAMBER) continue;
      // Skip ants below their nearest entrance mouth (they belong to the nest
      // view). Inline nearest-entrance scan — entrances are few (≤ ~3), so a
      // per-ant loop beats the per-frame id-keyed Map this used to build.
      let nearestEntrance = null;
      let nearestD2 = Infinity;
      for (const entrance of nestEntrances) {
        const dx = ant.x - entrance.x;
        const dy = ant.y - entrance.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < nearestD2) {
          nearestD2 = d2;
          nearestEntrance = entrance;
        }
      }
      if (nearestEntrance && ant.y > nearestEntrance.y) continue;
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
        ctx.fillText(`H:${Math.round(ant.hunger)} HP:${Math.round(ant.health)}${c}`, ant.x + 1.2, ant.y - 0.2);
      }
    }

    if (showDebugStats) {
      ctx.fillStyle = '#e8f6ff';
      ctx.font = '3px monospace';
      const homeX = Number.isFinite(colony.homeX) ? colony.homeX : world.nestX;
      ctx.fillText(`FoodStore:${Math.round(colony.foodStored)}`, homeX + 3, Math.max(4, world.nestY - 4));
    }
  }


  #drawCursorDebug(ctx, cursor) {
    const idx = this.world.index(cursor.x, cursor.y);
    const scentFood = getDisplayTrailValue(this.world, 'food', idx) || 0;
    const scentHome = getDisplayTrailValue(this.world, 'home', idx) || 0;
    ctx.fillStyle = '#b0fff0';
    ctx.font = '3px monospace';
    ctx.fillText(`Food:${scentFood.toFixed(2)} Home:${scentHome.toFixed(2)}`, cursor.x + 2, cursor.y + 2);
  }

  #drawEntranceDebug(ctx, nestEntrances) {
    ctx.strokeStyle = '#00d1ff';
    ctx.lineWidth = 0.6;
    ctx.fillStyle = '#ffffff';
    ctx.font = '3px monospace';

    for (const entrance of nestEntrances) {
      ctx.strokeRect(entrance.x - 2, entrance.y - 2, 4, 4);
      ctx.fillText(`soil:${entrance.soilOnSurface.toFixed(1)}`, entrance.x + 2.5, entrance.y - 2);
    }
  }

  #enforceSurfaceViewBounds() {
    const minZoom = getSurfaceMinZoom(this.canvas.clientHeight, this.world.nestY);
    this.zoom = Math.max(this.zoom, minZoom);

    const viewW = this.canvas.clientWidth / this.zoom;
    const viewH = this.canvas.clientHeight / this.zoom;

    const minX = viewW * 0.5;
    const maxX = this.world.width - viewW * 0.5;
    this.cameraX = minX > maxX ? this.world.width * 0.5 : clamp(this.cameraX, minX, maxX);

    // Clamp camera to the surface band so the full canvas shows usable surface.
    // At minZoom, the entire surface (rows 0..nestY) fills the canvas.
    const minY = viewH * 0.5;
    const maxY = this.world.nestY + 1 - viewH * 0.5;
    this.cameraY = minY > maxY ? (this.world.nestY + 1) * 0.5 : clamp(this.cameraY, minY, maxY);
  }
}
