import { TERRAIN } from '../sim/world.js';

/*
    Overview minimap for the right-hand panel.

    Renders a downscaled, top-down snapshot of the whole world (surface band
    above world.nestY, soil/tunnels below) plus ant positions, with a viewport
    rectangle showing what the active main view is currently looking at.

    Coordinate model:
    - The backing canvas is sized 1:1 with the world grid (world.width x
      world.height), so world tiles map directly to canvas pixels. CSS scales
      the element down to panel size; `image-rendering: pixelated` keeps it crisp.
    - Both SurfaceRenderer and NestRenderer share the same camera transform
      (screen = center + (world - camera) * zoom), so the visible span in world
      tiles is mainCanvas.client{Width,Height} / zoom, centered on the camera.
*/

const TERRAIN_COLOR = {
  [TERRAIN.GROUND]: [74, 122, 46],
  [TERRAIN.WALL]: [70, 70, 70],
  [TERRAIN.WATER]: [42, 108, 192],
  [TERRAIN.HAZARD]: [176, 48, 48],
  [TERRAIN.SOIL]: [107, 74, 46],
  [TERRAIN.TUNNEL]: [168, 128, 72],
  [TERRAIN.CHAMBER]: [208, 160, 96],
};

const DEFAULT_COLOR = TERRAIN_COLOR[TERRAIN.GROUND];

export class MiniMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this._off = document.createElement('canvas');
    this._offCtx = this._off.getContext('2d');
  }

  /**
   * Draws one minimap frame.
   *
   * @param {object} world - simulation world (terrain typed array + dimensions)
   * @param {object} colony - colony whose `.ants` are plotted as dots
   * @param {{cameraX:number, cameraY:number, zoom:number}} cam - active renderer
   * @param {HTMLCanvasElement} mainCanvas - the main sim canvas (for client size)
   */
  draw(world, colony, cam, mainCanvas) {
    if (!world) return;
    const W = world.width;
    const H = world.height;

    if (this.canvas.width !== W) this.canvas.width = W;
    if (this.canvas.height !== H) this.canvas.height = H;
    if (this._off.width !== W || this._off.height !== H) {
      this._off.width = W;
      this._off.height = H;
    }

    // Paint terrain into the offscreen bitmap, one pixel per world tile.
    const image = this._offCtx.createImageData(W, H);
    const data = image.data;
    const { terrain } = world;
    for (let i = 0; i < terrain.length; i += 1) {
      const c = TERRAIN_COLOR[terrain[i]] || DEFAULT_COLOR;
      const o = i * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 255;
    }
    this._offCtx.putImageData(image, 0, 0);

    const { ctx } = this;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._off, 0, 0);

    // Ground-level horizon so surface vs. underground reads at a glance.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, world.nestY + 0.5);
    ctx.lineTo(W, world.nestY + 0.5);
    ctx.stroke();

    // Ant dots.
    const ants = colony && colony.ants ? colony.ants : [];
    ctx.fillStyle = '#ffec80';
    for (let k = 0; k < ants.length; k += 1) {
      const a = ants[k];
      if (a.x >= 0 && a.x < W && a.y >= 0 && a.y < H) {
        ctx.fillRect(a.x, a.y, 1, 1);
      }
    }

    // Viewport rectangle for whatever the main view is currently framing.
    if (cam && mainCanvas && cam.zoom > 0) {
      const viewW = mainCanvas.clientWidth / cam.zoom;
      const viewH = mainCanvas.clientHeight / cam.zoom;
      const left = cam.cameraX - viewW / 2;
      const top = cam.cameraY - viewH / 2;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(left + 0.5, top + 0.5, viewW, viewH);
    }
  }
}
