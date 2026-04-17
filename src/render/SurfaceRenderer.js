import { TERRAIN } from '../sim/world.js';
import { drawSoilMound } from './soilMound.js';

export function normalizeSurfaceTerrain(terrain) {
  return terrain === TERRAIN.SOIL || terrain === TERRAIN.TUNNEL ? TERRAIN.GROUND : terrain;
}

export function getSurfaceMinZoom(canvasHeight, nestY) {
  // Pad below the nest equally to the surface above so the entrance
  // sits in the vertical center when fully zoomed out.
  const padding = nestY;
  const surfaceHeight = Math.max(1, nestY + 1 + padding);
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
  }

  setWorld(world) {
    this.world = world;
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
    return {
      x: clamp(Math.floor(this.cameraX - viewW * 0.5 + sx / this.zoom), 0, this.world.width - 1),
      y: clamp(Math.floor(this.cameraY - viewH * 0.5 + sy / this.zoom), 0, this.world.nestY),
    };
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
    this.#drawAnts(ctx, colony, options.selectedAntId, options.showDebugStats);
    if (options.showDebugStats && options.cursor) this.#drawCursorDebug(ctx, options.cursor);
    if (options.showEntranceInfo) this.#drawEntranceDebug(ctx, nestEntrances);

    ctx.restore();
  }

  #drawTerrain(ctx, overlays) {
    const { world } = this;
    const W = world.width;
    const H = world.height;

    this._off.width = W;
    this._off.height = H;

    const image = this._offCtx.createImageData(W, H);
    const data = image.data;

    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const idx = y * W + x;
        const o = idx * 4;
        const noise = ((x * 7 + y * 13) % 11) - 5;

        // Rows below the nest entrance are underground soil shown only as
        // visual context — render them as earthy brown so they are clearly
        // distinct from the interactive surface above.
        if (y > world.nestY) {
          const depthFrac = (y - world.nestY) / (H - world.nestY);
          data[o]     = Math.max(0, Math.floor(78 - 14 * depthFrac) + (noise >> 1));
          data[o + 1] = Math.max(0, Math.floor(60 - 10 * depthFrac) + (noise >> 1));
          data[o + 2] = Math.max(0, Math.floor(40 -  8 * depthFrac) + (noise >> 2));
          data[o + 3] = 255;
          continue;
        }

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
      ctx.fillRect(pellet.x, pellet.y, 1, 1);
    }
  }

  #drawEntranceMounds(ctx, nestEntrances) {
    for (const entrance of nestEntrances) drawSoilMound(ctx, entrance);
  }

  #drawAnts(ctx, colony, selectedAntId, showDebugStats) {
    const { world } = this;
    const halfViewW = this.canvas.clientWidth / this.zoom * 0.5;
    const halfViewH = this.canvas.clientHeight / this.zoom * 0.5;
    const minX = this.cameraX - halfViewW - 1;
    const maxX = this.cameraX + halfViewW + 1;
    const minY = this.cameraY - halfViewH - 1;
    const maxY = this.cameraY + halfViewH + 1;

    ctx.font = '2.8px monospace';
    for (const ant of colony.ants) {
      if (ant.x < minX || ant.x > maxX || ant.y < minY || ant.y > maxY) continue;
      ctx.fillStyle = ant.baseColor;
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

    const minY = viewH * 0.5;
    // Pad below the nest equally to the surface above so the entrance
    // sits in the vertical center when fully zoomed out.
    const nestPadding = this.world.nestY;
    const maxY = this.world.nestY + nestPadding - viewH * 0.5;
    this.cameraY = minY > maxY ? (this.world.nestY + nestPadding) * 0.5 : clamp(this.cameraY, minY, maxY);
  }
}
