import { TERRAIN } from '../sim/world.js';

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;

    this.cameraX = world.width * 0.5;
    this.cameraY = world.height * 0.5;
    this.zoom = 3;

    this.terrainCanvas = document.createElement('canvas');
    this.terrainCanvas.width = world.width;
    this.terrainCanvas.height = world.height;
    this.terrainCtx = this.terrainCanvas.getContext('2d');
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
      x: Math.floor(this.cameraX - viewW / 2 + sx / this.zoom),
      y: Math.floor(this.cameraY - viewH / 2 + sy / this.zoom),
    };
  }

  draw(colony, options) {
    const ctx = this.ctx;
    const { world } = this;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;

    ctx.clearRect(0, 0, cw, ch);
    ctx.save();

    ctx.translate(cw * 0.5, ch * 0.5);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cameraX, -this.cameraY);

    this.#drawTerrain(ctx, world, options);
    this.#drawNest(ctx, world);
    this.#drawAnts(ctx, colony);

    ctx.restore();
  }

  #drawTerrain(ctx, world, options) {
    const image = this.terrainCtx.createImageData(world.width, world.height);
    const data = image.data;

    for (let i = 0; i < world.size; i += 1) {
      const offset = i * 4;
      const terrain = world.terrain[i];

      let r = 38;
      let g = 42;
      let b = 30;

      if (terrain === TERRAIN.WALL) {
        r = 75; g = 75; b = 83;
      } else if (terrain === TERRAIN.WATER) {
        r = 31; g = 70; b = 123;
      } else if (terrain === TERRAIN.HAZARD) {
        r = 90; g = 30; b = 30;
      }

      if (options.showFood) {
        g = Math.min(255, g + world.food[i] * 20);
      }
      if (options.showToFood) {
        r = Math.min(255, r + world.toFood[i] * 80);
      }
      if (options.showToHome) {
        b = Math.min(255, b + world.toHome[i] * 80);
      }
      if (options.showDanger) {
        r = Math.min(255, r + world.danger[i] * 140);
      }

      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }

    this.terrainCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrainCanvas, 0, 0);
  }

  #drawNest(ctx, world) {
    ctx.fillStyle = 'rgba(255, 225, 110, 0.9)';
    ctx.beginPath();
    ctx.arc(world.nestX + 0.5, world.nestY + 0.5, world.nestRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  #drawAnts(ctx, colony) {
    for (let i = 0; i < colony.ants.length; i += 1) {
      const ant = colony.ants[i];
      ctx.fillStyle = ant.carrying > 0 ? '#ffd166' : '#f0f0f0';
      ctx.fillRect(ant.x, ant.y, 1, 1);
    }
  }
}
