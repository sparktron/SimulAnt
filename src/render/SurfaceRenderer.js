import { TERRAIN } from '../sim/world.js';
import { drawSoilMound } from './soilMound.js';

export function normalizeSurfaceTerrain(terrain) {
  return terrain === TERRAIN.SOIL || terrain === TERRAIN.TUNNEL ? TERRAIN.GROUND : terrain;
}

export function getSurfaceMinZoom(canvasHeight, nestY) {
  const surfaceHeight = Math.max(1, nestY + 1);
  return canvasHeight / surfaceHeight;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Surface Renderer -- Top-down 2D view of the ground surface.
 */
export class SurfaceRenderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;

    this.cameraX = world.nestX;
    this.cameraY = world.nestY * 0.42;
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
      x: clamp(
        Math.floor(this.cameraX - viewW * 0.5 + sx / this.zoom),
        0,
        this.world.width - 1,
      ),
      y: clamp(
        Math.floor(this.cameraY - viewH * 0.5 + sy / this.zoom),
        0,
        this.world.nestY,
      ),
    };
  }

  draw(colony, overlays, nestEntrances, debug = false) {
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
    this.#drawEntranceMounds(ctx, nestEntrances);
    this.#drawAnts(ctx, colony);
    if (debug) this.#drawEntranceDebug(ctx, nestEntrances);

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
        const terrain = world.terrain[idx];
        const o = idx * 4;

        const noise = ((x * 7 + y * 13) % 11) - 5;
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

        const food = world.food[idx];
        if (food > 0.1) {
          const t = Math.min(1, food / 8);
          r = Math.floor(r * (1 - t) + 46 * t);
          g = Math.floor(g * (1 - t) + 205 * t);
          b = Math.floor(b * (1 - t) + 46 * t);
        }

        if (overlays.showFood && food > 0.01) {
          g = Math.min(255, g + Math.floor(food * 22));
        }
        if (overlays.showToFood) {
          r = Math.min(255, r + Math.floor(world.toFood[idx] * 60));
        }
        if (overlays.showToHome) {
          b = Math.min(255, b + Math.floor(world.toHome[idx] * 60));
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

  #drawEntranceMounds(ctx, nestEntrances) {
    for (const entrance of nestEntrances) {
      drawSoilMound(ctx, entrance);
    }
  }

  #drawAnts(ctx, colony) {
    const { world } = this;
    for (const ant of colony.ants) {
      if (ant.y > world.nestY + 1) continue;
      ctx.fillStyle =
        ant.role === 'soldier'
          ? '#d93828'
          : ant.carrying > 0
            ? '#e8c840'
            : '#1a1208';
      ctx.fillRect(ant.x, ant.y, 1, 1);
    }
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
    if (minX > maxX) {
      this.cameraX = this.world.width * 0.5;
    } else {
      this.cameraX = clamp(this.cameraX, minX, maxX);
    }

    const minY = viewH * 0.5;
    const maxY = this.world.nestY - viewH * 0.5;
    if (minY > maxY) {
      this.cameraY = this.world.nestY * 0.5;
    } else {
      this.cameraY = clamp(this.cameraY, minY, maxY);
    }
  }
}
