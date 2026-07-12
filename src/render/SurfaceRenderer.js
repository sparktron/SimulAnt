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

import { TERRAIN } from '../sim/world.js';
import { drawSoilMound } from './soilMound.js';
import { Ant } from '../sim/ant.js';

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

    this.cameraX = world.nestX;
    this.cameraY = world.nestY;
    this.zoom = 3;

    this._off = document.createElement('canvas');
    this._offCtx = this._off.getContext('2d');

    // Cache key of the last terrain bitmap rendered into _off. The render
    // loop runs at display rate but terrain/pheromones change only on sim
    // ticks (or tool edits), so most frames can reuse the previous bitmap.
    this._terrainCacheKey = '';
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

    ctx.fillStyle = '#4a7a2e';
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(cw * 0.5, ch * 0.5);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cameraX, -this.cameraY);

    this.#drawTerrain(ctx, overlays);
    this.#drawFoodPellets(ctx, foodPellets);
    this.#drawEntranceMounds(ctx, nestEntrances);
    this.#drawAnts(ctx, colony, nestEntrances, options.selectedAntId, options.showDebugStats, overlays);
    if (options.showDebugStats && options.cursor) this.#drawCursorDebug(ctx, options.cursor);
    if (options.showEntranceInfo) this.#drawEntranceDebug(ctx, nestEntrances);

    ctx.restore();
  }

  #drawTerrain(ctx, overlays) {
    const { world } = this;
    const W = world.width;
    const H = world.nestY + 1;

    // Rebuild the offscreen bitmap only when something it depicts changed:
    // terrain always feeds it; the pheromone fields only matter while a
    // field overlay is visible. Otherwise reuse the cached bitmap — at 60fps
    // over a ~12 ticks/sec sim this skips most rebuilds even with scent on.
    const fieldsVisible = overlays.showToFood || overlays.showToHome || overlays.showScent || overlays.showDanger;
    const cacheKey = `${world.terrainVersion ?? -1}|${fieldsVisible ? world.fieldsVersion ?? -1 : 'off'}`
      + `|${!!overlays.showToFood}|${!!overlays.showToHome}|${!!overlays.showScent}|${!!overlays.showDanger}`;
    if (cacheKey === this._terrainCacheKey && this._off.width === W && this._off.height === H) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this._off, 0, 0);
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
        const noise = ((x * 7 + y * 13) % 11) - 5;

        const terrain = world.terrain[idx];
        let r = 96 + noise;
        let g = 138 + noise;
        let b = 52 + (noise >> 1);

        const surfaceTerrain = normalizeSurfaceTerrain(terrain);

        if (surfaceTerrain === TERRAIN.WALL) {
          r = 142;
          g = 142;
          b = 150;
        } else if (surfaceTerrain === TERRAIN.WATER) {
          r = 48;
          g = 100;
          b = 172;
        } else if (surfaceTerrain === TERRAIN.HAZARD) {
          r = 174;
          g = 52;
          b = 46;
        }

        if (overlays.showToFood || overlays.showScent) {
          const scentFood = Math.min(1, Math.sqrt(world.toFood[idx] / 6));
          r = Math.floor(r * (1 - scentFood) + 40 * scentFood);
          g = Math.floor(g * (1 - scentFood) + 220 * scentFood);
          b = Math.floor(b * (1 - scentFood) + 70 * scentFood);
        }
        if (overlays.showToHome || overlays.showScent) {
          const scentHome = Math.min(1, Math.sqrt(world.toHome[idx] / 6));
          r = Math.floor(r * (1 - scentHome) + 55 * scentHome);
          g = Math.floor(g * (1 - scentHome) + 110 * scentHome);
          b = Math.floor(b * (1 - scentHome) + 245 * scentHome);
        }
        if (overlays.showDanger) {
          r = Math.min(255, r + Math.floor(world.danger[idx] * 100));
          g = Math.max(0, g - Math.floor(world.danger[idx] * 40));
        }

        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = 255;
      }
    }

    this._offCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._off, 0, 0);
  }

  #drawFoodPellets(ctx, foodPellets) {
    ctx.fillStyle = '#35d84b';
    for (const pellet of foodPellets) {
      // Surface owns rows y <= nestY (complementary to NestRenderer which
      // draws y > nestY); keeps pellets from being double-rendered.
      if (pellet.y > this.world.nestY) continue;
      ctx.fillRect(pellet.x, pellet.y, 1, 1);
    }
  }

  #drawEntranceMounds(ctx, nestEntrances) {
    for (const entrance of nestEntrances) drawSoilMound(ctx, entrance);
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
      if (overlays.showAntJobs && (ant.state !== ant._cachedJobState || ant.workFocus !== ant._cachedJobWorkFocus)) {
        ant.jobColor = Ant.getJobColor(ant.state, ant.workFocus, ant.role);
        ant._cachedJobState = ant.state;
        ant._cachedJobWorkFocus = ant.workFocus;
      }
      ctx.fillStyle = overlays.showAntJobs ? ant.jobColor : ant.baseColor;
      ctx.fillRect(ant.x, ant.y, 1, 1);

      const carryingType = ant.carryingType || (ant.carrying?.type === 'food' ? 'food' : 'none');
      if (carryingType === 'food' || carryingType === 'dirt') {
        ctx.fillStyle = carryingType === 'food' ? '#35d84b' : '#7a4b22';
        ctx.fillRect(ant.x + 0.7, ant.y, 0.6, 0.6);
      }

      if (selectedAntId === ant.id) {
        ctx.strokeStyle = '#ffea00';
        ctx.lineWidth = 0.25;
        ctx.strokeRect(ant.x - 0.4, ant.y - 0.4, 1.8, 1.8);
      }

      if (showDebugStats) {
        ctx.fillStyle = '#ffffff';
        const c = ant.carryingType && ant.carryingType !== 'none' ? ` ${ant.carryingType[0].toUpperCase()}` : '';
        ctx.fillText(`H:${Math.round(ant.hunger)} HP:${Math.round(ant.health)}${c}`, ant.x + 1.2, ant.y - 0.2);
      }
    }

    if (showDebugStats) {
      ctx.fillStyle = '#e8f6ff';
      ctx.font = '3px monospace';
      ctx.fillText(`FoodStore:${Math.round(colony.foodStored)}`, world.nestX + 3, Math.max(4, world.nestY - 4));
    }
  }


  #drawCursorDebug(ctx, cursor) {
    const idx = this.world.index(cursor.x, cursor.y);
    const scentFood = this.world.toFood[idx] || 0;
    const scentHome = this.world.toHome[idx] || 0;
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
