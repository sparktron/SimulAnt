import { TERRAIN } from '../sim/world.js';

export class NestRenderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;

    this.cameraX = world.width * 0.5;
    this.cameraY = world.nestY + 35;
    this.zoom = 3;

    this.nestCanvas = document.createElement('canvas');
    this.nestCanvas.width = world.width;
    this.nestCanvas.height = world.height;
    this.nestCtx = this.nestCanvas.getContext('2d');
  }

  setWorld(world) {
    this.world = world;
    this.nestCanvas.width = world.width;
    this.nestCanvas.height = world.height;
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

    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(cw * 0.5, ch * 0.5);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cameraX, -this.cameraY);

    this.#drawNestSection(ctx);
    this.#drawNestAnts(ctx, colony);

    ctx.restore();
  }

  #drawNestSection(ctx) {
    const { world } = this;
    const image = this.nestCtx.createImageData(world.width, world.height);
    const data = image.data;

    for (let y = 0; y < world.height; y += 1) {
      for (let x = 0; x < world.width; x += 1) {
        const idx = world.index(x, y);
        const o = idx * 4;
        const terrain = world.terrain[idx];

        let r = 70;
        let g = 52;
        let b = 34;

        if (y < world.nestY) {
          r = 45; g = 64; b = 90;
        } else if (terrain === TERRAIN.TUNNEL) {
          r = 194; g = 173; b = 132;
        } else if (terrain === TERRAIN.WATER) {
          r = 33; g = 80; b = 143;
        } else if (terrain === TERRAIN.HAZARD) {
          r = 116; g = 38; b = 34;
        }

        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = 255;
      }
    }

    this.nestCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.nestCanvas, 0, 0);

    ctx.strokeStyle = '#9dc9ff';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, world.nestY + 0.5);
    ctx.lineTo(world.width, world.nestY + 0.5);
    ctx.stroke();
  }

  #drawNestAnts(ctx, colony) {
    const { world } = this;
    for (const ant of colony.ants) {
      if (ant.y < world.nestY - 1) continue;
      ctx.fillStyle = ant.role === 'soldier' ? '#ef775f' : ant.carrying > 0 ? '#f7d55d' : '#20160e';
      ctx.fillRect(ant.x, ant.y, 1, 1);
    }

    ctx.fillStyle = '#f74f4f';
    ctx.beginPath();
    ctx.arc(world.nestX + 0.5, world.nestY + 2, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}
