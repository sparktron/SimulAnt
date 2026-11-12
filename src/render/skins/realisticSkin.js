import { TERRAIN, getDisplayTrailValue } from '../../sim/world.js';
import { SeededRng } from '../../sim/rng.js';
import { classicSkin } from './classicSkin.js';
import { hash2, noiseField, postProcess, tileTableCache } from './skinAssets.js';

// "Realistic": natural soil/grass from seeded value noise, shaded segmented
// ants with a fixed top-left key light, seed food, granular mounds, vignette.
// Every sprite is prebaked into an atlas once; the per-frame path only blits.
// Purple stays reserved for dueling ants: FIGHT ants get an options.color halo.

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/* ---------------- terrain ---------------- */
const SOIL = [96, 74, 50], GRASS_DARK = [50, 70, 30], GRASS_LIGHT = [104, 126, 58], GRASS_DRY = [134, 122, 72];
const ROCK = [122, 112, 100], WATER_SHORE = [72, 76, 62], WATER_MID = [44, 62, 62], WATER_DEEP = [24, 38, 40];
const STRATA = [[0, [70, 50, 33]], [0.16, [100, 73, 47]], [0.45, [120, 88, 58]], [0.78, [108, 88, 70]], [1, [86, 76, 68]]];

// Static per-tile layers (noise only), built once per world size.
const fineTable = tileTableCache((x, y, W, H, out) => { out[0] = noiseField(W, H, 'realistic-fine', 3, 2)[y * W + x] * 255; });
const groundTable = tileTableCache((x, y, W, H, out) => {
  const i = y * W + x, fine = noiseField(W, H, 'realistic-fine', 3, 2)[i];
  if (hash2(x, y, 8) < 0.004) { out[0] = 124; out[1] = 114; out[2] = 98; return; } // pebble
  const dens = noiseField(W, H, 'realistic-grass', 40, 5)[i], dry = noiseField(W, H, 'realistic-dry', 18, 3)[i];
  const grass = mix(mix(GRASS_DARK, GRASS_LIGHT, fine), GRASS_DRY, clamp01((dry - 0.52) * 3) * 0.65);
  const c = mix(SOIL, grass, clamp01((dens - 0.3) * 3)), j = (hash2(x, y, 21) - 0.5) * 10;
  out[0] = c[0] + j; out[1] = c[1] + j; out[2] = c[2] + j * 0.6;
});
const soilTable = tileTableCache((x, y, W, H, out) => {
  const nestY = Math.floor(H / 2); // re-based per world in nestTerrainPixel via depth offset below
  const i = y * W + x, h = hash2(x, y, 13), fine = noiseField(W, H, 'realistic-fine', 3, 2)[i];
  if (h < 0.004) { const s = 112 + h * 5000; out[0] = s; out[1] = s * 0.94; out[2] = s * 0.86; return; } // stones
  const strata = noiseField(W, H, 'realistic-strata', 24, 3)[i];
  const depth = clamp01((y - nestY) / Math.max(1, H - nestY) + (strata - 0.5) * 0.14);
  let k = 1;
  while (k < STRATA.length - 1 && depth > STRATA[k][0]) k += 1;
  const [d0, c0] = STRATA[k - 1], [d1, c1] = STRATA[k];
  const c = mix(c0, c1, clamp01((depth - d0) / (d1 - d0))), v = (fine - 0.5) * 18 + (h - 0.5) * 8;
  out[0] = c[0] + v; out[1] = c[1] + v; out[2] = c[2] + v * 0.8;
});

const OUT = [0, 0, 0]; // reused: renderers copy the channels out immediately
function set(r, g, b) { OUT[0] = r; OUT[1] = g; OUT[2] = b; return OUT; }
function blend(r, g, b, t) {
  OUT[0] += (r - OUT[0]) * t; OUT[1] += (g - OUT[1]) * t; OUT[2] += (b - OUT[2]) * t;
}
const WATER_OFFSETS = [1, 2]; // neighbour rings sampled for depth

function surfaceTerrainPixel(terrain, x, y, idx, world, overlays) {
  const W = world.width, T = world.terrain;
  if (terrain === TERRAIN.WALL) {
    let l = (fineTable(W, world.height)[idx * 3] / 255 - 0.5) * 24 + (hash2(x, y, 21) - 0.5) * 10;
    if (T[idx - W] !== TERRAIN.WALL) l += 30;
    if (x > 0 && T[idx - 1] !== TERRAIN.WALL) l += 12;
    if (T[idx + W] !== TERRAIN.WALL) l -= 34;
    if (x < W - 1 && T[idx + 1] !== TERRAIN.WALL) l -= 10;
    set(ROCK[0] + l, ROCK[1] + l, ROCK[2] + l * 0.9);
  } else if (terrain === TERRAIN.WATER) {
    let wet = 0;
    for (let k = 0; k < WATER_OFFSETS.length; k += 1) {
      const r = WATER_OFFSETS[k];
      if (T[idx - r * W] === TERRAIN.WATER) wet += 1;
      if (T[idx + r * W] === TERRAIN.WATER) wet += 1;
      if (x >= r && T[idx - r] === TERRAIN.WATER) wet += 1;
      if (x < W - r && T[idx + r] === TERRAIN.WATER) wet += 1;
    }
    const depth = wet / 8;
    if (depth < 0.6) { set(WATER_SHORE[0], WATER_SHORE[1], WATER_SHORE[2]); blend(WATER_MID[0], WATER_MID[1], WATER_MID[2], depth / 0.6); }
    else { set(WATER_MID[0], WATER_MID[1], WATER_MID[2]); blend(WATER_DEEP[0], WATER_DEEP[1], WATER_DEEP[2], (depth - 0.6) / 0.4); }
    if (depth === 1 && hash2(x, y, 4) < 0.025) set(112, 132, 128);
  } else if (terrain === TERRAIN.HAZARD) {
    const h = hash2(x, y, 6);
    if (h < 0.3) set(62, 30, 22); else if (h < 0.75) set(96, 42, 28); else set(132, 60, 36);
  } else {
    const g = groundTable(W, world.height), o = idx * 3;
    set(g[o], g[o + 1], g[o + 2]);
    if (T[idx - W] === TERRAIN.WALL || (x > 0 && T[idx - W - 1] === TERRAIN.WALL)) { OUT[0] *= 0.62; OUT[1] *= 0.62; OUT[2] *= 0.66; }
  }
  if (overlays.showToFood || overlays.showScent) blend(120, 225, 95, Math.min(1, Math.sqrt(getDisplayTrailValue(world, 'food', idx) / 6)) * 0.85);
  if (overlays.showToHome || overlays.showScent) blend(95, 150, 245, Math.min(1, Math.sqrt(getDisplayTrailValue(world, 'home', idx) / 6)) * 0.85);
  if (overlays.showDanger) blend(235, 70, 50, Math.min(1, world.danger[idx]) * 0.8);
  return OUT;
}

function nestTerrainPixel(terrain, x, y, idx, world, edge) {
  const W = world.width, H = world.height;
  const carved = terrain === TERRAIN.TUNNEL || terrain === TERRAIN.CHAMBER;
  const fine = fineTable(W, H)[idx * 3] / 255;
  if (y < world.nestY - 1 && !carved) { const t = y / world.nestY; return set(58 + 92 * t, 72 + 68 * t, 88 + 30 * t); }
  if (y <= world.nestY && !carved) return set(62 + 30 * fine, 82 + 30 * fine, 36 + 14 * fine);
  if (carved) {
    if (edge) return set(52 + fine * 12, 38 + fine * 9, 26 + fine * 6); // shadowed rim
    const v = (fine - 0.5) * 16;
    return terrain === TERRAIN.CHAMBER ? set(192 + v, 162 + v, 122 + v * 0.8) : set(176 + v, 146 + v, 108 + v * 0.8);
  }
  if (terrain === TERRAIN.WATER) return set(36, 58, 60);
  if (terrain === TERRAIN.HAZARD) return set(96, 40, 28);
  // Strata are laid out against H/2; shift rows so they start at this world's horizon.
  const sy = Math.min(H - 1, Math.max(0, y - world.nestY + Math.floor(H / 2)));
  const s = soilTable(W, H), o = (sy * W + x) * 3;
  return set(s[o], s[o + 1], s[o + 2]);
}

/* ---------------- sprites ---------------- */
const PALETTE = Object.freeze({
  black: { hi: '#776c60', base: '#1d1914', rim: '#060504', leg: '#15110d' },
  red: { hi: '#f09a5a', base: '#8f3315', rim: '#3a1105', leg: '#5c200c' },
});
const LEGS = [[2, 0.95, 0.42], [0.4, 1.62, 1.85], [-1.0, 2.25, 2.55]];
const FRAME = 64, UNIT = FRAME / 32, STEPS = 32;
const SHADOW_DX = 1.6, SHADOW_DY = 2.1; // world-space key light from top-left (units)

function radial(c, p, cx, cy, r1, hx, hy) {
  const g = c.createRadialGradient(hx, hy, 0.1, cx, cy, r1);
  g.addColorStop(0, p.hi); g.addColorStop(0.45, p.base); g.addColorStop(1, p.rim);
  return g;
}

// Paints one ant facing +x in "unit" space centred on the origin.
function paintAnt(c, p, phase, headK, gasterK) {
  c.strokeStyle = p.leg; c.lineCap = 'round'; c.lineJoin = 'round';
  for (let i = 0; i < 3; i += 1) {
    for (const side of [-1, 1]) {
      const [bx, fa, ta] = LEGS[i];
      const ph = phase + ((i % 2 === 0) === (side === 1) ? 0 : Math.PI), sw = Math.sin(ph) * 0.28;
      const a1 = side * fa - sw * side, a2 = side * ta - sw * side * 1.1;
      const kx = bx + Math.cos(a1) * 4.2, ky = Math.sin(a1) * 4.2;
      c.lineWidth = 0.75; c.beginPath(); c.moveTo(bx, side * 0.5); c.lineTo(kx, ky); c.stroke();
      c.lineWidth = 0.5; c.beginPath(); c.moveTo(kx, ky); c.lineTo(kx + Math.cos(a2) * 5.2, ky + Math.sin(a2) * 5.2); c.stroke();
    }
  }
  const wig = Math.sin(phase * 0.7) * 0.5;
  c.lineWidth = 0.45;
  for (const side of [-1, 1]) {
    c.beginPath(); c.moveTo(4.8 * headK, side * 0.7);
    c.lineTo(6.6 * headK, side * (2.6 + wig * side)); c.lineTo(9.4 * headK, side * (1.6 + wig)); c.stroke();
  }
  const gx = -5.2 - (gasterK - 1) * 3;
  c.fillStyle = radial(c, p, gx, 0, 4 * gasterK, gx - 0.8, -1.4); c.beginPath(); c.ellipse(gx, 0, 3.7 * gasterK, 2.9 * gasterK, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(255,255,255,.08)'; c.lineWidth = 0.3;
  for (const sx of [-1.2, 0.6, 2.2]) { c.beginPath(); c.arc(gx + sx * gasterK, 0, 2.6 * gasterK, -1.1, 1.1); c.stroke(); }
  c.fillStyle = p.base; c.beginPath(); c.ellipse(-1.7, 0, 0.9, 0.75, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = radial(c, p, 0.4, 0, 2.4, 0, -0.8); c.beginPath(); c.ellipse(0.4, 0, 2.1, 1.25, 0, 0, Math.PI * 2); c.fill();
  c.save(); c.translate(3.6, 0); c.scale(headK, headK); c.translate(-3.6, 0);
  c.fillStyle = radial(c, p, 3.6, 0, 2.2, 3.2, -0.9); c.beginPath(); c.ellipse(3.6, 0, 1.9, 1.7, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = p.leg; c.lineWidth = 0.5; c.beginPath();
  c.moveTo(5.2, -0.8); c.quadraticCurveTo(6.3, -0.4, 6.1, 0.2); c.moveTo(5.2, 0.8); c.quadraticCurveTo(6.3, 0.4, 6.1, -0.2); c.stroke();
  c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.arc(3.2, -1.2, 0.28, 0, Math.PI * 2); c.arc(3.2, 1.2, 0.28, 0, Math.PI * 2); c.fill();
  c.restore();
}

function paintShadow(c, headK, gasterK) {
  const gx = -5.2 - (gasterK - 1) * 3;
  c.fillStyle = 'rgba(0,0,0,.32)'; c.beginPath();
  c.ellipse(gx, 0, 3.8 * gasterK, 3 * gasterK, 0, 0, Math.PI * 2);
  c.ellipse(0.4, 0, 2.2, 1.3, 0, 0, Math.PI * 2);
  c.ellipse(3.6 * headK, 0, 2 * headK, 1.8 * headK, 0, 0, Math.PI * 2); c.fill();
}

// Atlas: STEPS rotations across, 2 gait frames down. Shadow offset is applied
// before rotation so the light direction stays fixed in world space.
const antAtlases = new Map();
function antAtlas(colonyId, soldier) {
  const key = (colonyId === 'red' ? 2 : 0) + (soldier ? 1 : 0);
  if (antAtlases.has(key)) return antAtlases.get(key);
  const canvas = document.createElement('canvas'); canvas.width = FRAME * STEPS; canvas.height = FRAME * 2;
  const c = canvas.getContext('2d');
  const p = PALETTE[colonyId === 'red' ? 'red' : 'black'], size = soldier ? 1.18 : 1, headK = soldier ? 1.35 : 1;
  for (let frame = 0; frame < 2; frame += 1) {
    for (let r = 0; r < STEPS; r += 1) {
      const a = r / STEPS * Math.PI * 2, cx = r * FRAME + FRAME / 2, cy = frame * FRAME + FRAME / 2;
      c.save(); c.translate(cx + SHADOW_DX * UNIT, cy + SHADOW_DY * UNIT); c.rotate(a); c.scale(UNIT * size, UNIT * size); paintShadow(c, headK, 1); c.restore();
      c.save(); c.translate(cx, cy); c.rotate(a); c.scale(UNIT * size, UNIT * size); paintAnt(c, p, frame * Math.PI, headK, 1); c.restore();
    }
  }
  antAtlases.set(key, canvas);
  return canvas;
}

const queenAtlases = new Map();
function queenSprite(colonyId) {
  if (queenAtlases.has(colonyId)) return queenAtlases.get(colonyId);
  const canvas = document.createElement('canvas'); canvas.width = FRAME * 2; canvas.height = FRAME * 2;
  const c = canvas.getContext('2d'), p = PALETTE[colonyId === 'red' ? 'red' : 'black'];
  const s = UNIT * 2, a = -Math.PI / 2; // facing up, like a queen resting in her chamber
  c.save(); c.translate(FRAME + SHADOW_DX * s, FRAME + SHADOW_DY * s); c.rotate(a); c.scale(s, s); paintShadow(c, 1.15, 1.45); c.restore();
  c.save(); c.translate(FRAME, FRAME); c.rotate(a); c.scale(s, s);
  paintAnt(c, p, 0.6, 1.15, 1.45);
  c.fillStyle = 'rgba(235,225,200,.28)'; c.strokeStyle = 'rgba(255,248,230,.35)'; c.lineWidth = 0.25; // folded wings
  for (const side of [-1, 1]) { c.beginPath(); c.ellipse(-4.6, side * 1.4, 5.2, 1.5, side * 0.12, 0, Math.PI * 2); c.fill(); c.stroke(); }
  c.restore();
  queenAtlases.set(colonyId, canvas);
  return canvas;
}

let seedAtlas, larvaSprite;
const SEED_FRAME = 32, SEED_STEPS = 8;
function paintSeed(c) {
  const g = c.createRadialGradient(-1.8, -1.4, 0.4, 0, 0, 6);
  g.addColorStop(0, '#fbe7b5'); g.addColorStop(0.45, '#d5a45a'); g.addColorStop(1, '#6e4a1c');
  c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, 5.4, 3.4, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(80,50,20,.6)'; c.lineWidth = 0.4; c.beginPath(); c.moveTo(-4.6, 0); c.quadraticCurveTo(0, -0.8, 4.6, 0); c.stroke();
}
function seeds() {
  if (seedAtlas) return seedAtlas;
  seedAtlas = document.createElement('canvas'); seedAtlas.width = SEED_FRAME * SEED_STEPS; seedAtlas.height = SEED_FRAME;
  const c = seedAtlas.getContext('2d'), k = SEED_FRAME / 16;
  for (let i = 0; i < SEED_STEPS; i += 1) {
    const cx = i * SEED_FRAME + SEED_FRAME / 2, a = i / SEED_STEPS * Math.PI;
    c.save(); c.translate(cx + 1.4 * k, SEED_FRAME / 2 + 1.8 * k); c.rotate(a); c.scale(k, k);
    c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(0, 0, 5.4, 3.4, 0, 0, Math.PI * 2); c.fill(); c.restore();
    c.save(); c.translate(cx, SEED_FRAME / 2); c.rotate(a); c.scale(k, k); paintSeed(c); c.restore();
  }
  return seedAtlas;
}
function larva() {
  if (larvaSprite) return larvaSprite;
  larvaSprite = document.createElement('canvas'); larvaSprite.width = 32; larvaSprite.height = 32;
  const c = larvaSprite.getContext('2d');
  c.translate(16, 16); c.rotate(Math.PI / 4);
  c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(2, 2, 6.5, 11, 0, 0, Math.PI * 2); c.fill();
  const g = c.createRadialGradient(-2, -4, 1, 0, 0, 12);
  g.addColorStop(0, '#fffaf0'); g.addColorStop(0.6, '#eadcc0'); g.addColorStop(1, '#a8957a');
  c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, 6, 10.5, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(120,100,70,.45)'; c.lineWidth = 0.7;
  for (let y = -6; y <= 6; y += 3) { c.beginPath(); c.moveTo(-5, y); c.quadraticCurveTo(0, y + 1.4, 5, y); c.stroke(); }
  return larvaSprite;
}

const mounds = new Map();
function moundSprite(colonyId) {
  if (mounds.has(colonyId)) return mounds.get(colonyId);
  const S = 192, canvas = document.createElement('canvas'); canvas.width = S; canvas.height = S;
  const c = canvas.getContext('2d'), mid = S / 2, red = colonyId === 'red';
  const shade = c.createRadialGradient(mid + 6, mid + 8, 10, mid + 6, mid + 8, 90);
  shade.addColorStop(0, 'rgba(0,0,0,.45)'); shade.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = shade; c.fillRect(0, 0, S, S);
  const rng = new SeededRng(`realistic-mound-${colonyId}`), base = red ? [150, 98, 66] : [140, 110, 76];
  for (let i = 0; i < 2600; i += 1) {
    const rad = Math.abs((rng.next() + rng.next() + rng.next() - 1.5) * 40), a = rng.next() * Math.PI * 2;
    const x = mid + Math.cos(a) * rad * 1.15, y = mid + Math.sin(a) * rad * 0.9, gr = 0.9 + rng.next() * 1.9;
    const l = 0.75 + (1 - rad / 60) * 0.35 + (rng.next() - 0.5) * 0.3;
    c.fillStyle = `rgb(${base[0] * l * 0.55},${base[1] * l * 0.55},${base[2] * l * 0.55})`; c.beginPath(); c.arc(x + gr * 0.3, y + gr * 0.35, gr, 0, Math.PI * 2); c.fill();
    c.fillStyle = `rgb(${base[0] * l},${base[1] * l},${base[2] * l})`; c.beginPath(); c.arc(x, y, gr * 0.85, 0, Math.PI * 2); c.fill();
    c.fillStyle = `rgba(255,240,215,${0.18 + rng.next() * 0.2})`; c.beginPath(); c.arc(x - gr * 0.3, y - gr * 0.3, gr * 0.35, 0, Math.PI * 2); c.fill();
  }
  const hole = c.createRadialGradient(mid, mid, 0, mid, mid, 17);
  hole.addColorStop(0, 'rgba(4,2,1,1)'); hole.addColorStop(0.45, 'rgba(10,6,3,.95)'); hole.addColorStop(1, 'rgba(20,12,6,0)');
  c.fillStyle = hole; c.beginPath(); c.ellipse(mid, mid, 18, 14, 0, 0, Math.PI * 2); c.fill();
  mounds.set(colonyId, canvas);
  return canvas;
}

/* ---------------- per-frame drawing ---------------- */
const ANT_SIZE = 5.5;           // world tiles covered by one ant frame
const SELECT_DASH = [0.5, 0.6];
const NO_DASH = [];

function drawAnt(ctx, ant, colony, options) {
  const cx = ant.x + 0.5, cy = ant.y + 0.5, h = options.heading;
  const tinted = options.showAntJobs || ant.state === 'FIGHT';
  if (options.zoom < 2.5) {
    ctx.fillStyle = tinted ? options.color : colony.id === 'red' ? '#8f3315' : '#1d1914';
    ctx.fillRect(ant.x, ant.y, 1, 1);
    return;
  }
  if (tinted) {
    ctx.globalAlpha = 0.5; ctx.fillStyle = options.color;
    ctx.beginPath(); ctx.ellipse(cx, cy, 1.9, 1.25, h, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  const rot = ((Math.round(h / (Math.PI * 2) * STEPS) % STEPS) + STEPS) % STEPS;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(antAtlas(colony.id, ant.role === 'soldier'), rot * FRAME, ((ant.x + ant.y) & 1) * FRAME, FRAME, FRAME,
    cx - ANT_SIZE / 2, cy - ANT_SIZE / 2, ANT_SIZE, ANT_SIZE);
  const type = ant.carryingType || ant.carrying?.type;
  if (type === 'food') {
    ctx.drawImage(seeds(), 0, 0, SEED_FRAME, SEED_FRAME, cx + Math.cos(h) * 1.55 - 0.55, cy + Math.sin(h) * 1.55 - 0.55, 1.1, 1.1);
  } else if (type === 'dirt') {
    ctx.fillStyle = '#5a4128'; ctx.beginPath(); ctx.arc(cx + Math.cos(h) * 1.45, cy + Math.sin(h) * 1.45, 0.38, 0, Math.PI * 2); ctx.fill();
  }
  if (options.selected) {
    ctx.strokeStyle = 'rgba(255,205,110,.95)'; ctx.lineWidth = 0.22;
    ctx.beginPath(); ctx.ellipse(cx, cy, 2.4, 1.9, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 0.12; ctx.setLineDash(SELECT_DASH);
    ctx.beginPath(); ctx.ellipse(cx, cy, 3.2, 2.6, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash(NO_DASH);
  }
}

function drawQueen(ctx, x, y, colony) {
  const cx = x + 0.5, cy = y + 0.5;
  ctx.strokeStyle = 'rgba(246,215,154,.55)'; ctx.lineWidth = 0.2;
  ctx.beginPath(); ctx.ellipse(cx, cy, 2.8, 3.6, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(queenSprite(colony.id === 'red' ? 'red' : 'black'), cx - 5, cy - 5, 10, 10);
}

function drawFood(ctx, x, y) {
  const frame = (hash2(x, y, 17) * SEED_STEPS) | 0;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(seeds(), frame * SEED_FRAME, 0, SEED_FRAME, SEED_FRAME, x - 0.3, y - 0.3, 1.6, 1.6);
}

function drawLarva(ctx, x, y, r) {
  const s = r * 3;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(larva(), x + 0.5 - s / 2, y + 0.5 - s / 2, s, s);
}

function drawEntrance(ctx, entrance, colonyId) {
  const radius = Math.min(14, 3 + Math.sqrt(Math.max(0, entrance.soilOnSurface || 0)) * 0.22);
  const size = radius * 3.4;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(moundSprite(colonyId === 'red' ? 'red' : 'black'), entrance.x + 0.5 - size / 2, entrance.y + 0.5 - size / 2, size, size);
}

// Terrain is upscaled smoothly into a 4x canvas and overlaid with a tiled
// grain texture (specks + short blades) once per terrain rebuild.
const COMPOSE_SCALE = 4;
let grainTile;
function grain() {
  if (grainTile) return grainTile;
  grainTile = document.createElement('canvas'); grainTile.width = 128; grainTile.height = 128;
  const c = grainTile.getContext('2d'), rng = new SeededRng('realistic-grain');
  for (let i = 0; i < 1400; i += 1) {
    const x = rng.next() * 128, y = rng.next() * 128, light = rng.next() < 0.5;
    const color = light ? `rgba(230,215,170,${0.1 + rng.next() * 0.18})` : `rgba(12,9,5,${0.16 + rng.next() * 0.28})`;
    if (rng.next() < 0.35) {
      const a = -Math.PI / 2 + (rng.next() - 0.5) * 2, l = 1.5 + rng.next() * 3;
      c.strokeStyle = color; c.lineWidth = 0.6; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
    } else { c.fillStyle = color; c.fillRect(x, y, 1, 1); }
  }
  return grainTile;
}
const composites = new WeakMap();
function composeTerrain(bitmap, world, owner) {
  const w = bitmap.width * COMPOSE_SCALE, h = bitmap.height * COMPOSE_SCALE;
  let entry = composites.get(owner);
  if (!entry || entry.canvas.width !== w || entry.canvas.height !== h) {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    entry = { canvas, ctx, pattern: ctx.createPattern?.(grain(), 'repeat') || null };
    composites.set(owner, entry);
  }
  const { canvas, ctx, pattern } = entry;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (pattern) { ctx.fillStyle = pattern; ctx.fillRect(0, 0, w, h); }
  return canvas;
}

export const realisticSkin = Object.freeze({
  ...classicSkin, name: 'realistic',
  surfaceBackground: '#14110c', nestBackground: '#14110c', horizon: 'rgba(125,154,82,.7)', food: '#d5a45a',
  usesHeading: true, minimapAntColor: '#f1e9d2', minimapViewport: 'rgba(255,255,255,.85)',
  surfaceTerrainPixel, nestTerrainPixel, composeTerrain, drawAnt, drawQueen, drawFood, drawLarva, drawEntrance,
  postProcess(ctx, w, h, owner) { postProcess(ctx, w, h, owner); },
  minimapPalette: {
    [TERRAIN.GROUND]: [78, 92, 48], [TERRAIN.WALL]: [120, 110, 98], [TERRAIN.WATER]: [36, 58, 60],
    [TERRAIN.HAZARD]: [110, 44, 30], [TERRAIN.SOIL]: [92, 68, 44], [TERRAIN.TUNNEL]: [152, 124, 90], [TERRAIN.CHAMBER]: [176, 146, 108],
  },
});
