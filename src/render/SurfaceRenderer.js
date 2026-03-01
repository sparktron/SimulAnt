import { TERRAIN } from '../sim/world.js';

/**
 * Surface Renderer -- Top-down 2D view of the ground surface.
 *
 * VIEW ARCHITECTURE
 * -----------------
 * This renderer draws only the above-ground portion of the world as a
 * top-down yard: grass, rocks, food, water, hazards, and surface ants.
 * Underground terrain (y > nestY) is drawn as opaque dirt; tunnels are
 * not visible from the surface -- you must switch to the Nest view.
 *
 * DATA OWNERSHIP
 *   View-specific : cameraX, cameraY, zoom (restored on toggle)
 *   Shared (read)  : world terrain/pheromones/food, colony ants
 *
 * COORDINATE SYSTEM
 *   (x, y) on a 2D plane, y increasing downward.
 *   Surface region: y = 0 .. world.nestY.
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
    const viewW = this.canvas.clientWidth / this.zoom;
    const viewH = this.canvas.clientHeight / this.zoom;
    return {
      x: Math.floor(this.cameraX - viewW * 0.5 + sx / this.zoom),
      y: Math.floor(this.cameraY - viewH * 0.5 + sy / this.zoom),
    };
  }

  draw(colony, overlays) {
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
    this.#drawEntities(ctx, colony);

    ctx.restore();
  }

  /* ------------------------------------------------------------------
   * Terrain: pixel-per-cell ImageData for the full world, but surface
   * cells get a grass palette and underground cells are opaque dirt.
   * ----------------------------------------------------------------*/
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

        let r, g, b;

        if (y > world.nestY) {
          // Underground: opaque earth (no tunnel detail from surface)
          r = 92;
          g = 72;
          b = 50;
        } else {
          // Surface grass/dirt with subtle positional noise
          const noise = ((x * 7 + y * 13) % 11) - 5;
          r = 96 + noise;
          g = 138 + noise;
          b = 52 + (noise >> 1);

          if (terrain === TERRAIN.WALL) {
            r = 142;
            g = 142;
            b = 150;
          } else if (terrain === TERRAIN.WATER) {
            r = 48;
            g = 100;
            b = 172;
          } else if (terrain === TERRAIN.HAZARD) {
            r = 174;
            g = 52;
            b = 46;
          } else if (terrain === TERRAIN.SOIL) {
            r = 112 + noise;
            g = 92 + noise;
            b = 60;
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

  /* ------------------------------------------------------------------
   * Entities: nest entrance mound + surface ants (y <= nestY + 1).
   * ----------------------------------------------------------------*/
  #drawEntities(ctx, colony) {
    const { world } = this;

    // Nest entrance mound
    ctx.fillStyle = '#b89858';
    ctx.beginPath();
    ctx.arc(world.nestX + 0.5, world.nestY + 0.5, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6b5230';
    ctx.beginPath();
    ctx.arc(world.nestX + 0.5, world.nestY + 0.5, 1.6, 0, Math.PI * 2);
    ctx.fill();

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
}
