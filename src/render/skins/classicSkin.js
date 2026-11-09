import { TERRAIN } from '../../sim/world.js';
import { drawSoilMound } from '../soilMound.js';

// Terrain formulas moved from the original renderers without changing their output.
function surfaceTerrainPixel(terrain, x, y, idx, world, overlays) {
        const noise = ((x * 7 + y * 13) % 11) - 5;

        let r = 96 + noise;
        let g = 138 + noise;
        let b = 52 + (noise >> 1);

        const surfaceTerrain = (terrain === TERRAIN.SOIL || terrain === TERRAIN.TUNNEL ? TERRAIN.GROUND : terrain);

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

        if (overlays.showToFood || overlays.showScent) {
          const scentFood = Math.min(1, Math.sqrt(world.toFood[idx] / 6));
          r = Math.floor(r * (1 - scentFood) + 40 * scentFood);
          g = Math.floor(g * (1 - scentFood) + 220 * scentFood);
          b = Math.floor(b * (1 - scentFood) + 70 * scentFood);
        }
        if (overlays.showToHome || overlays.showScent) {
          const scentHome = Math.min(1, Math.sqrt(world.toHome[idx] / 6));
          r = Math.floor(r * (1 - scentHome) + 55 * scentHome);
          g = Math.floor(g * (1 - scentHome) + 110 * scentHome);
          b = Math.floor(b * (1 - scentHome) + 245 * scentHome);
        }
        if (overlays.showDanger) {
          r = Math.min(255, r + Math.floor(world.danger[idx] * 100));
          g = Math.max(0, g - Math.floor(world.danger[idx] * 40));
        }

return [r, g, b];
}
function nestTerrainPixel(terrain, x, y, idx, world, edge) {
const H = world.height;
        let r, g, b;

        // Terrain takes precedence over the y-based sky/horizon banding so
        // that tunnels or chambers carved into the surface band (e.g. the
        // entrance shaft above nestY) render as tunnel, not sky. Otherwise
        // real nest terrain would be hidden by the decorative sky wash.
        const isCarvedAboveHorizon = y < world.nestY
          && (terrain === TERRAIN.TUNNEL || terrain === TERRAIN.CHAMBER);

        if (y < world.nestY - 1 && !isCarvedAboveHorizon) {
          // Sky -- subtle top-to-bottom gradient
          const t = y / world.nestY;
          r = Math.floor(38 + 32 * t);
          g = Math.floor(58 + 42 * t);
          b = Math.floor(108 + 44 * t);
        } else if (y <= world.nestY && !isCarvedAboveHorizon) {
          // Ground-surface strip (green)
          r = 66;
          g = 118;
          b = 40;
        } else if (terrain === TERRAIN.TUNNEL || terrain === TERRAIN.CHAMBER) {
          const isChamber = terrain === TERRAIN.CHAMBER;
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

return [r, g, b];
}
function drawAnt(ctx, ant, colony, options) {
  ctx.fillStyle = options.color;
  ctx.fillRect(ant.x, ant.y, 1, 1);
  drawCarrying(ctx, ant);
  if (options.selected) {
    ctx.strokeStyle = '#ffea00';
    ctx.lineWidth = 0.25;
    ctx.strokeRect(ant.x - 0.4, ant.y - 0.4, 1.8, 1.8);
  }
}
export function drawCarrying(ctx, ant) {
  const carryingType = ant.carryingType || (ant.carrying?.type === 'food' ? 'food' : 'none');
  if (carryingType === 'food' || carryingType === 'dirt') {
    ctx.fillStyle = carryingType === 'food' ? '#35d84b' : '#7a4b22';
    ctx.fillRect(ant.x + 0.7, ant.y, 0.6, 0.6);
  }
}
function drawQueen(ctx, x, y, colony) {
  ctx.fillStyle = colony.id === 'red' ? '#b71c1c' : '#7b3fc9';
  ctx.beginPath(); ctx.arc(x + 0.5, y + 0.5, 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = colony.id === 'red' ? '#ffb3a7' : '#d1aa38';
  ctx.beginPath(); ctx.arc(x + 0.5, y + 0.5, 0.85, 0, Math.PI * 2); ctx.fill();
}
export const classicSkin = Object.freeze({
  name: 'classic', surfaceBackground: '#4a7a2e', nestBackground: '#2a1e14',
  horizon: '#5a9a44', food: '#35d84b', surfaceTerrainPixel, nestTerrainPixel,
  drawAnt, drawQueen, drawEntrance: drawSoilMound,
  surfaceAlpha: () => 255,
  // Behavior flags read by the renderers instead of checking skin names.
  usesHeading: false,       // drawAnt ignores options.heading, so skip tracking it
  fieldsInTerrain: true,    // pheromone fields are baked into surfaceTerrainPixel
  // Optional composeTerrain(bitmap, world, owner) -> canvas: bake detail into the
  // terrain once per rebuild; renderers then blit that instead of the raw bitmap.
  minimapAntColor: '#ffec80', minimapViewport: '#ffffff',
  postProcess() {}, drawFields() {},
});
