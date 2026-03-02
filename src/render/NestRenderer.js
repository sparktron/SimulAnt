import { TERRAIN } from '../sim/world.js';

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

    this.cameraX = world.nestX;
    this.cameraY = world.nestY + 28;
    this.zoom = 3;

    this._off = document.createElement('canvas');
    this._off.width = world.width;
    this._off.height = world.height;
    this._offCtx = this._off.getContext('2d');
  }

  setWorld(world) {
    this.world = world;
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
    const viewW = this.canvas.clientWidth / this.zoom;
    const viewH = this.canvas.clientHeight / this.zoom;
    return {
      x: Math.floor(this.cameraX - viewW * 0.5 + sx / this.zoom),
      y: Math.floor(this.cameraY - viewH * 0.5 + sy / this.zoom),
    };
  }

  draw(colony) {
    const { ctx } = this;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;

    ctx.fillStyle = '#2a1e14';
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(cw * 0.5, ch * 0.5);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cameraX, -this.cameraY);

    this.#drawTerrain(ctx);
    this.#drawAnts(ctx, colony);

    ctx.restore();
  }

  /* ------------------------------------------------------------------
   * Terrain: sky gradient, green horizon, soil with tunnels.
   * ----------------------------------------------------------------*/
  #drawTerrain(ctx) {
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
        const terrain = world.terrain[idx];

        let r, g, b;

        if (y < world.nestY - 1) {
          // Sky -- subtle top-to-bottom gradient
          const t = y / world.nestY;
          r = Math.floor(38 + 32 * t);
          g = Math.floor(58 + 42 * t);
          b = Math.floor(108 + 44 * t);
        } else if (y <= world.nestY) {
          // Ground-surface strip (green)
          r = 66;
          g = 118;
          b = 40;
        } else if (terrain === TERRAIN.TUNNEL) {
          r = 186;
          g = 166;
          b = 130;
        } else if (terrain === TERRAIN.CHAMBER) {
          r = 170;
          g = 152;
          b = 122;
        } else if (terrain === TERRAIN.WATER) {
          r = 36;
          g = 82;
          b = 146;
        } else if (terrain === TERRAIN.HAZARD) {
          r = 128;
          g = 42;
          b = 38;
        } else {
          // Compact soil -- depth gradient + noise
          const depthFrac = (y - world.nestY) / (H - world.nestY);
          const noise = ((x * 5 + y * 9) % 7) - 3;
          r = Math.floor(76 - 16 * depthFrac) + noise;
          g = Math.floor(56 - 12 * depthFrac) + noise;
          b = Math.floor(38 - 10 * depthFrac);
        }

        if (y > world.nestY && (terrain === TERRAIN.TUNNEL || terrain === TERRAIN.CHAMBER)) {
          const left = x > 0 ? world.terrain[idx - 1] : terrain;
          const right = x < W - 1 ? world.terrain[idx + 1] : terrain;
          const up = y > 0 ? world.terrain[idx - W] : terrain;
          const down = y < H - 1 ? world.terrain[idx + W] : terrain;
          if (left === TERRAIN.SOIL || right === TERRAIN.SOIL || up === TERRAIN.SOIL || down === TERRAIN.SOIL) {
            r -= 10; g -= 8; b -= 6;
          }
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

    // Horizon line
    ctx.strokeStyle = '#5a9a44';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, world.nestY + 0.5);
    ctx.lineTo(W, world.nestY + 0.5);
    ctx.stroke();
  }

  /* ------------------------------------------------------------------
   * Entities: underground ants (y >= nestY - 1) + queen marker.
   * ----------------------------------------------------------------*/
  #drawAnts(ctx, colony) {
    const { world } = this;

    for (const ant of colony.ants) {
      if (ant.y < world.nestY - 1) continue;
      ctx.fillStyle =
        ant.role === 'soldier'
          ? '#ef775f'
          : ant.carrying > 0
            ? '#f7d55d'
            : '#c8b8a0';
      ctx.fillRect(ant.x, ant.y, 1, 1);
    }

    if (colony.queen.alive) {
      ctx.fillStyle = '#f74f4f';
      ctx.beginPath();
      ctx.arc(world.nestX + 0.5, world.nestY + 2.5, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d43030';
      ctx.beginPath();
      ctx.arc(world.nestX + 0.5, world.nestY + 2.5, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
