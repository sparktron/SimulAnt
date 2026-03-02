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

        if (overlays.showToFood) r = Math.min(255, r + Math.floor(world.toFood[idx] * 60));
        if (overlays.showToHome) b = Math.min(255, b + Math.floor(world.toHome[idx] * 60));
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
    ctx.fillStyle = '#f8f05a';
    for (const pellet of foodPellets) {
      ctx.fillRect(pellet.x, pellet.y, 1, 1);
    }
  }

  #drawEntranceMounds(ctx, nestEntrances) {
    for (const entrance of nestEntrances) drawSoilMound(ctx, entrance);
  }

  #drawAnts(ctx, colony, selectedAntId, showDebugStats) {
    const { world } = this;
    ctx.font = '2.8px monospace';
    for (const ant of colony.ants) {
      if (ant.y > world.nestY + 1) continue;
      ctx.fillStyle = ant.role === 'soldier' ? '#d93828' : '#1a1208';
      ctx.fillRect(ant.x, ant.y, 1, 1);

      if (ant.carrying?.type === 'food') {
        ctx.fillStyle = '#ffe84f';
        ctx.fillRect(ant.x + 0.7, ant.y, 0.6, 0.6);
      }

      if (selectedAntId === ant.id) {
        ctx.strokeStyle = '#ffea00';
        ctx.lineWidth = 0.25;
        ctx.strokeRect(ant.x - 0.4, ant.y - 0.4, 1.8, 1.8);
      }

      if (showDebugStats) {
        ctx.fillStyle = '#ffffff';
        const c = ant.carrying?.type === 'food' ? ' C' : '';
        ctx.fillText(`H:${Math.round(ant.hunger)} HP:${Math.round(ant.health)}${c}`, ant.x + 1.2, ant.y - 0.2);
      }
    }

    if (showDebugStats) {
      ctx.fillStyle = '#e8f6ff';
      ctx.font = '3px monospace';
      ctx.fillText(`FoodStore:${Math.round(colony.foodStored)}`, world.nestX + 3, Math.max(4, world.nestY - 4));
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
    this.cameraX = minX > maxX ? this.world.width * 0.5 : clamp(this.cameraX, minX, maxX);

    const minY = viewH * 0.5;
    const maxY = this.world.nestY - viewH * 0.5;
    this.cameraY = minY > maxY ? this.world.nestY * 0.5 : clamp(this.cameraY, minY, maxY);
  }
}
