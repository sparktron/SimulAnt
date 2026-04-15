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
    this.#enforceNestViewBounds();
    const viewW = this.canvas.clientWidth / this.zoom;
    const viewH = this.canvas.clientHeight / this.zoom;
    return {
      x: Math.floor(this.cameraX - viewW * 0.5 + sx / this.zoom),
      y: Math.floor(this.cameraY - viewH * 0.5 + sy / this.zoom),
    };
  }

  draw(colony, options = {}) {
    this.#enforceNestViewBounds();
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
    this.#drawNestFood(ctx, colony);
    this.#drawEggs(ctx, colony);
    this.#drawAnts(ctx, colony, options.selectedAntId, options.showDebugStats, options.showQueenMarker);

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
        } else if (terrain === TERRAIN.TUNNEL || terrain === TERRAIN.CHAMBER) {
          const isChamber = terrain === TERRAIN.CHAMBER;
          const edge = this.#isTunnelEdge(x, y);
          if (edge) {
            // Tunnel edge: slightly darker than tunnel interior
            r = 200;
            g = 190;
            b = 170;
          } else if (isChamber) {
            // Chamber: light color for visibility
            r = 240;
            g = 235;
            b = 220;
          } else {
            // Tunnel interior: light, distinct from dirt
            r = 235;
            g = 225;
            b = 205;
          }
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


  #drawNestFood(ctx, colony) {
    const pellets = colony.nestFoodPellets || [];
    for (let i = 0; i < pellets.length; i += 1) {
      const pellet = pellets[i];
      if (pellet.amount <= 0.01) continue;
      const r = Math.max(0.2, Math.min(0.45, 0.18 + Math.sqrt(pellet.amount) * 0.08));
      ctx.fillStyle = '#35d84b';
      ctx.beginPath();
      ctx.arc(pellet.x + 0.5, pellet.y + 0.5, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  #drawEggs(ctx, colony) {
    // Draw larvae in various growth stages in the nest chamber.
    const larvae = colony.larvae || [];
    if (!colony.queen.alive || larvae.length === 0) return;

    const broodX = Math.max(0, Math.min(this.world.width - 1, this.world.nestX + 4));
    const broodY = Math.max(this.world.nestY + 2, Math.min(this.world.height - 1, this.world.nestY + 8));

    // Nurses keep larvae in a compact, even brood patch rather than tracing queen movement.
    const cols = Math.max(1, Math.ceil(Math.sqrt(larvae.length)));
    const rowSpacing = 0.72;
    const colSpacing = 0.78;
    const rows = Math.ceil(larvae.length / cols);
    const patchHalfWidth = ((cols - 1) * colSpacing) * 0.5;
    const patchHalfHeight = ((rows - 1) * rowSpacing) * 0.5;

    for (let i = 0; i < larvae.length; i += 1) {
      const larva = larvae[i];
      const row = Math.floor(i / cols);
      const col = i % cols;
      const stagger = (row % 2) * (colSpacing * 0.5);
      const larvaX = broodX - patchHalfWidth + (col * colSpacing) + stagger;
      const larvaY = broodY - patchHalfHeight + (row * rowSpacing);

      // Size grows from ~0.35 (stage 1, like food pellet) to ~0.7 (stage 4, like ~4 pellets)
      // Stage 1: 0.35, Stage 2: 0.45, Stage 3: 0.6, Stage 4: 0.7
      const stage = larva.stage || 1;
      const baseRadius = 0.35 + (stage - 1) * 0.118;  // linear growth across 4 stages

      // Draw larva with color indicating stage (lighter to darker)
      const hue = 200 - (stage - 1) * 20;  // blues and teals
      ctx.fillStyle = `hsl(${hue}, 80%, ${85 - (stage - 1) * 8}%)`;
      ctx.beginPath();
      ctx.arc(larvaX + 0.5, larvaY + 0.5, baseRadius, 0, Math.PI * 2);
      ctx.fill();

      // Draw outline for better visibility
      ctx.strokeStyle = `hsl(${hue}, 60%, 60%)`;
      ctx.lineWidth = 0.15;
      ctx.stroke();
    }
  }

  #isTunnelEdge(x, y) {
    const { world } = this;
    const neighbors = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (let i = 0; i < neighbors.length; i += 1) {
      const nx = x + neighbors[i][0];
      const ny = y + neighbors[i][1];
      if (!world.inBounds(nx, ny)) return true;
      const nTerrain = world.terrain[world.index(nx, ny)];
      if (nTerrain !== TERRAIN.TUNNEL && nTerrain !== TERRAIN.CHAMBER) {
        return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------
   * Entities: underground ants + optional queen marker.
   * ----------------------------------------------------------------*/
  #drawAnts(ctx, colony, selectedAntId, showDebugStats, showQueenMarker = false) {
    const { world } = this;
    const halfViewW = this.canvas.clientWidth / this.zoom * 0.5;
    const halfViewH = this.canvas.clientHeight / this.zoom * 0.5;
    const minX = this.cameraX - halfViewW - 1;
    const maxX = this.cameraX + halfViewW + 1;
    const minY = this.cameraY - halfViewH - 1;
    const maxY = this.cameraY + halfViewH + 1;

    for (const ant of colony.ants) {
      if (ant.y < world.nestY) continue;
      if (ant.x < minX || ant.x > maxX || ant.y < minY || ant.y > maxY) continue;
      const drawY = ant.y;
      ctx.fillStyle = ant.baseColor;
      ctx.fillRect(ant.x, drawY, 1, 1);

      const carryingType = ant.carryingType || (ant.carrying?.type === 'food' ? 'food' : 'none');
      if (carryingType === 'food' || carryingType === 'dirt') {
        ctx.fillStyle = carryingType === 'food' ? '#35d84b' : '#7a4b22';
        ctx.fillRect(ant.x + 0.7, drawY, 0.6, 0.6);
      }

      if (selectedAntId === ant.id) {
        ctx.strokeStyle = '#ffea00';
        ctx.lineWidth = 0.25;
        ctx.strokeRect(ant.x - 0.4, drawY - 0.4, 1.8, 1.8);
      }

      if (showDebugStats) {
        ctx.fillStyle = '#ffffff';
        const c = ant.carryingType && ant.carryingType !== 'none' ? ` ${ant.carryingType[0].toUpperCase()}` : '';
        ctx.font = '2.8px monospace';
        ctx.fillText(`H:${Math.round(ant.hunger)} HP:${Math.round(ant.health)}${c}`, ant.x + 1.2, drawY - 0.2);
      }
    }

    if (colony.queen.alive && showQueenMarker) {
      const queenX = Number.isFinite(colony.queen.x) ? colony.queen.x : world.nestX;
      const queenY = Number.isFinite(colony.queen.y) ? colony.queen.y : world.nestY + 6;

      // Intentional marker for the queen's chamber location.
      // Keep this visually distinct from debug overlays and entrance visuals.
      ctx.fillStyle = '#7b3fc9';
      ctx.beginPath();
      ctx.arc(queenX + 0.5, queenY + 0.5, 1.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#d1aa38';
      ctx.beginPath();
      ctx.arc(queenX + 0.5, queenY + 0.5, 0.85, 0, Math.PI * 2);
      ctx.fill();
    }

    if (showDebugStats) {
      ctx.fillStyle = '#e8f6ff';
      ctx.font = '3px monospace';
      ctx.fillText(`FoodStore:${Math.round(colony.foodStored)}`, world.nestX + 4, world.nestY + 8);
      ctx.fillText(`Queen H:${Math.round(colony.queen.hunger)} HP:${Math.round(colony.queen.health)}`, world.nestX + 4, world.nestY + 11);
      ctx.fillText(`NestPellets:${colony.nestFoodPellets?.length || 0}`, world.nestX + 4, world.nestY + 14);
    }
  }

  #enforceNestViewBounds() {
    const { world } = this;
    const nestDepth = world.height - world.nestY;
    const minZoom = Math.max(1, this.canvas.clientHeight / nestDepth);
    this.zoom = Math.max(this.zoom, minZoom);

    const viewW = this.canvas.clientWidth / this.zoom;
    const viewH = this.canvas.clientHeight / this.zoom;

    const minX = viewW * 0.5;
    const maxX = world.width - viewW * 0.5;
    this.cameraX = minX > maxX ? world.width * 0.5 : Math.max(minX, Math.min(maxX, this.cameraX));

    const minY = world.nestY + viewH * 0.5;
    const maxY = world.height - viewH * 0.5;
    this.cameraY = minY > maxY ? (world.nestY + world.height) * 0.5 : Math.max(minY, Math.min(maxY, this.cameraY));
  }
}
