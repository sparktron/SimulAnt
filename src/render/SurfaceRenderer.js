import { TERRAIN } from '../sim/world.js';

export class SurfaceRenderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.cameraX = world.width * 0.5;
    this.cameraY = world.height * 0.38;
    this.zoom = 3;

    this.terrainCanvas = document.createElement('canvas');
    this.terrainCanvas.width = world.width;
    this.terrainCanvas.height = world.height;
    this.terrainCtx = this.terrainCanvas.getContext('2d');
  }

  setWorld(world) {
    this.world = world;
    this.terrainCanvas.width = world.width;
    this.terrainCanvas.height = world.height;
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
    const { ctx, world } = this;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;

    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(cw * 0.5, ch * 0.5);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cameraX, -this.cameraY);

    this.#drawSurfaceTerrain(ctx, overlays);
    this.#drawSurfaceEntities(ctx, colony);

    ctx.restore();
  }

  #drawSurfaceTerrain(ctx, overlays) {
    const { world } = this;
    const image = this.terrainCtx.createImageData(world.width, world.height);
    const data = image.data;

    for (let i = 0; i < world.size; i += 1) {
      const terrain = world.terrain[i];
      const y = Math.floor(i / world.width);
      const o = i * 4;
      let r = 110;
      let g = 90;
      let b = 58;

      if (terrain === TERRAIN.WALL) {
        r = 125; g = 125; b = 132;
      } else if (terrain === TERRAIN.WATER) {
        r = 40; g = 88; b = 150;
      } else if (terrain === TERRAIN.HAZARD) {
        r = 138; g = 38; b = 38;
      } else if (terrain === TERRAIN.SOIL || y > world.nestY) {
        r = 96; g = 76; b = 52;
      }

      if (overlays.showFood) g = Math.min(255, g + world.food[i] * 20);
      if (overlays.showToFood) r = Math.min(255, r + world.toFood[i] * 70);
      if (overlays.showToHome) b = Math.min(255, b + world.toHome[i] * 70);
      if (overlays.showDanger) r = Math.min(255, r + world.danger[i] * 120);

      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }

    this.terrainCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrainCanvas, 0, 0);
  }

  #drawSurfaceEntities(ctx, colony) {
    const { world } = this;
    for (const ant of colony.ants) {
      if (ant.y > world.nestY + 1) continue;
      ctx.fillStyle = ant.role === 'soldier' ? '#e75443' : ant.carrying > 0 ? '#ffd166' : '#1a1208';
      ctx.fillRect(ant.x, ant.y, 1, 1);
    }

    ctx.fillStyle = '#f5e28c';
    ctx.beginPath();
    ctx.arc(world.nestX + 0.5, world.nestY + 0.5, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}
