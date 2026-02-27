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
    this.#drawGrid(ctx, world);
    this.#drawNest(ctx, world);
    this.#drawAnts(ctx, colony);

    ctx.restore();
    this.#drawVignette(ctx, cw, ch);
  }

  #drawTerrain(ctx, world, options) {
    const image = this.terrainCtx.createImageData(world.width, world.height);
    const data = image.data;

    for (let i = 0; i < world.size; i += 1) {
      const offset = i * 4;
      const terrain = world.terrain[i];

      let r = 24;
      let g = 31;
      let b = 24;

      if (terrain === TERRAIN.WALL) {
        r = 92; g = 104; b = 122;
      } else if (terrain === TERRAIN.WATER) {
        r = 34; g = 96; b = 175;
      } else if (terrain === TERRAIN.HAZARD) {
        r = 138; g = 43; b = 59;
      }

      if (options.showFood) {
        r = Math.min(255, r + world.food[i] * 4);
        g = Math.min(255, g + world.food[i] * 18);
      }
      if (options.showToFood) {
        r = Math.min(255, r + world.toFood[i] * 110);
      }
      if (options.showToHome) {
        b = Math.min(255, b + world.toHome[i] * 100);
      }
      if (options.showDanger) {
        r = Math.min(255, r + world.danger[i] * 130);
        b = Math.max(0, b - world.danger[i] * 36);
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

  #drawGrid(ctx, world) {
    if (this.zoom < 2.7) return;
    ctx.strokeStyle = 'rgba(160, 200, 255, 0.07)';
    ctx.lineWidth = 1 / this.zoom;

    const step = 8;
    for (let x = 0; x <= world.width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, world.height);
      ctx.stroke();
    }
    for (let y = 0; y <= world.height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(world.width, y);
      ctx.stroke();
    }
  }

  #drawNest(ctx, world) {
    const gradient = ctx.createRadialGradient(
      world.nestX + 0.5,
      world.nestY + 0.5,
      1,
      world.nestX + 0.5,
      world.nestY + 0.5,
      world.nestRadius * 1.6,
    );
    gradient.addColorStop(0, 'rgba(255, 232, 140, 0.96)');
    gradient.addColorStop(0.6, 'rgba(255, 188, 92, 0.7)');
    gradient.addColorStop(1, 'rgba(255, 150, 64, 0.06)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(world.nestX + 0.5, world.nestY + 0.5, world.nestRadius * 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 244, 176, 0.88)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(world.nestX + 0.5, world.nestY + 0.5, world.nestRadius * 0.95, 0, Math.PI * 2);
    ctx.stroke();
  }

  #drawAnts(ctx, colony) {
    ctx.shadowBlur = 6;
    for (let i = 0; i < colony.ants.length; i += 1) {
      const ant = colony.ants[i];
      if (ant.carrying > 0) {
        ctx.fillStyle = '#ffd978';
        ctx.shadowColor = 'rgba(255, 209, 114, 0.64)';
      } else {
        ctx.fillStyle = '#dbf2ff';
        ctx.shadowColor = 'rgba(128, 208, 255, 0.44)';
      }
      ctx.fillRect(ant.x, ant.y, 1, 1);
    }
    ctx.shadowBlur = 0;
  }

  #drawVignette(ctx, width, height) {
    const g = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      Math.min(width, height) * 0.2,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.7,
    );
    g.addColorStop(0, 'rgba(0, 0, 0, 0)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.38)');

    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }
}
