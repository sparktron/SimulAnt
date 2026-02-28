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

  draw(colony, options, viewMode) {
    const ctx = this.ctx;
    const { world } = this;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;

    ctx.clearRect(0, 0, cw, ch);
    ctx.save();

    ctx.translate(cw * 0.5, ch * 0.5);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cameraX, -this.cameraY);

    this.#drawTerrain(ctx, world, options, viewMode);
    this.#drawNest(ctx, world, colony.queen, viewMode);
    this.#drawAnts(ctx, colony, viewMode);

    ctx.restore();
  }

  #drawTerrain(ctx, world, options, viewMode) {
    const image = this.terrainCtx.createImageData(world.width, world.height);
    const data = image.data;

    for (let i = 0; i < world.size; i += 1) {
      const offset = i * 4;

      let r;
      let g;
      let b;

      if (viewMode === 'underground') {
        if (world.tunnel[i] === 1) {
          r = 113;
          g = 83;
          b = 56;
        } else {
          r = 50;
          g = 35;
          b = 23;
        }
      } else {
        const terrain = world.terrain[i];
        r = 24;
        g = 31;
        b = 24;

        if (terrain === TERRAIN.WALL) {
          r = 92;
          g = 104;
          b = 122;
        } else if (terrain === TERRAIN.WATER) {
          r = 34;
          g = 96;
          b = 175;
        } else if (terrain === TERRAIN.HAZARD) {
          r = 138;
          g = 43;
          b = 59;
        }
      }

      if (options.showFood && viewMode === 'surface') {
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

  #drawNest(ctx, world, queen, viewMode) {
    const radius = viewMode === 'underground' ? world.nestRadius * 2 : world.nestRadius * 1.6;
    const gradient = ctx.createRadialGradient(
      world.nestX + 0.5,
      world.nestY + 0.5,
      1,
      world.nestX + 0.5,
      world.nestY + 0.5,
      radius,
    );
    gradient.addColorStop(0, 'rgba(255, 232, 140, 0.96)');
    gradient.addColorStop(0.6, 'rgba(255, 188, 92, 0.7)');
    gradient.addColorStop(1, 'rgba(255, 150, 64, 0.08)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(world.nestX + 0.5, world.nestY + 0.5, radius, 0, Math.PI * 2);
    ctx.fill();

    if (viewMode === 'underground' && queen?.alive) {
      ctx.fillStyle = '#ffe3c4';
      ctx.beginPath();
      ctx.arc(queen.x + 0.5, queen.y + 0.5, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  #drawAnts(ctx, colony, viewMode) {
    ctx.shadowBlur = 6;
    for (let i = 0; i < colony.ants.length; i += 1) {
      const ant = colony.ants[i];
      if (viewMode === 'underground' && !ant.underground) continue;
      if (viewMode === 'surface' && ant.underground) continue;

      if (ant.role === 'soldier') {
        ctx.fillStyle = '#ff7f7f';
      } else if (ant.role === 'male') {
        ctx.fillStyle = '#a7b6ff';
      } else if (ant.role === 'breeder') {
        ctx.fillStyle = '#ff9cff';
      } else if (ant.carrying > 0) {
        ctx.fillStyle = '#ffd978';
      } else {
        ctx.fillStyle = '#dbf2ff';
      }
      ctx.shadowColor = 'rgba(180, 220, 255, 0.45)';
      ctx.fillRect(ant.x, ant.y, 1, 1);
    }
    ctx.shadowBlur = 0;
  }
}
