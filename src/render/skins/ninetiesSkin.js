import { TERRAIN, getDisplayTrailValue } from '../../sim/world.js';
import { classicSkin } from './classicSkin.js';
import { bayer, hash2, noiseField, tileTableCache } from './skinAssets.js';

// "90s Retro": 16-colour VGA palette, ordered (Bayer) dithering on terrain,
// chunky 4-direction pixel sprites at close zoom. Purple stays reserved for
// dueling ants (FIGHT_COLOR arrives through options.color).
const VGA = Object.freeze({
  black: '#000000', blue: '#0000aa', green: '#00aa00', red: '#aa0000', brown: '#aa5500',
  lgray: '#aaaaaa', dgray: '#555555', lblue: '#5555ff', lgreen: '#55ff55', lred: '#ff5555',
  yellow: '#ffff55', white: '#ffffff',
});
const RGB = Object.freeze({
  blue: [0, 0, 170], lblue: [85, 85, 255], green: [0, 170, 0], lgreen: [85, 255, 85],
  red: [170, 0, 0], lred: [255, 85, 85], darkRed: [85, 0, 0], lgray: [170, 170, 170],
  dgray: [85, 85, 85], white: [255, 255, 255], shadow: [28, 28, 8],
});
const SOIL = [[46, 46, 16], [74, 74, 28], [104, 98, 42], [133, 122, 56], [160, 143, 72]];
const MOSS = [[36, 64, 26], [60, 96, 32], [78, 122, 42], [92, 138, 48]];
const NEST_SOIL = [[107, 74, 46], [90, 58, 32], [74, 46, 24], [58, 34, 16]];
const TUNNEL = [168, 128, 72], CHAMBER = [200, 156, 92], TUNNEL_EDGE = [216, 176, 112];
const clampIndex = (v, len) => (v < 0 ? 0 : v >= len ? len - 1 : v | 0);

// Quantise a 0..1 overlay strength into 4 dithered steps before blending.
function ditherBlend(c, strength, d, target) {
  const q = Math.min(4, Math.max(0, Math.floor(strength * 4 + d + 0.5))) / 4;
  if (q === 0) return;
  c[0] = Math.floor(c[0] * (1 - q) + target[0] * q);
  c[1] = Math.floor(c[1] * (1 - q) + target[1] * q);
  c[2] = Math.floor(c[2] * (1 - q) + target[2] * q);
}

// Static ground: moss/soil noise, Bayer dither, tufts and pebbles.
const groundTable = tileTableCache((x, y, W, H, out) => {
  const tuft = hash2(x, y, 7), pebble = hash2(x, y, 9);
  let c;
  if (tuft < 0.012) c = RGB.green;
  else if (tuft < 0.017) c = RGB.lgreen;
  else if (pebble < 0.003) c = RGB.lgray;
  else if (pebble < 0.004) c = RGB.white;
  else {
    const i = y * W + x;
    const pal = noiseField(W, H, 'nineties-moss', 50, 3)[i] > 0.47 ? MOSS : SOIL;
    const t = noiseField(W, H, 'nineties-soil', 34, 3)[i] + bayer(x, y) * 0.22 + (hash2(x, y) - 0.5) * 0.34;
    c = pal[clampIndex(Math.floor((t - 0.15) * pal.length * 1.4), pal.length)];
  }
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
});

const OUT = [0, 0, 0]; // reused: renderers copy the channels out immediately
function surfaceTerrainPixel(terrain, x, y, idx, world, overlays) {
  const W = world.width, T = world.terrain, d = bayer(x, y);
  let c;
  if (terrain === TERRAIN.WALL) {
    let l = 0.5 + d * 0.5;
    if (T[idx - W] !== TERRAIN.WALL) l += 0.32;
    if (x > 0 && T[idx - 1] !== TERRAIN.WALL) l += 0.14;
    if (T[idx + W] !== TERRAIN.WALL) l -= 0.3;
    c = l > 0.78 ? RGB.white : l > 0.45 ? RGB.lgray : RGB.dgray;
  } else if (terrain === TERRAIN.WATER) {
    const shore = T[idx - W] !== TERRAIN.WATER || T[idx + W] !== TERRAIN.WATER
      || (x > 0 && T[idx - 1] !== TERRAIN.WATER) || (x < W - 1 && T[idx + 1] !== TERRAIN.WATER);
    c = shore ? RGB.dgray : hash2(x, y, 3) < 0.05 ? RGB.lblue : RGB.blue;
  } else if (terrain === TERRAIN.HAZARD) {
    c = hash2(x, y, 5) < 0.08 ? RGB.lred : d > -0.1 ? RGB.red : RGB.darkRed;
  } else if ((T[idx - W] === TERRAIN.WALL || (x > 0 && T[idx - W - 1] === TERRAIN.WALL)) && d > -0.3) {
    c = RGB.shadow; // drop shadow cast by the rock above
  }
  if (c) { OUT[0] = c[0]; OUT[1] = c[1]; OUT[2] = c[2]; }
  else { const g = groundTable(W, world.height), o = idx * 3; OUT[0] = g[o]; OUT[1] = g[o + 1]; OUT[2] = g[o + 2]; }
  if (overlays.showToFood || overlays.showScent) ditherBlend(OUT, Math.min(1, Math.sqrt(getDisplayTrailValue(world, 'food', idx) / 6)), d, RGB.lgreen);
  if (overlays.showToHome || overlays.showScent) ditherBlend(OUT, Math.min(1, Math.sqrt(getDisplayTrailValue(world, 'home', idx) / 6)), d, RGB.lblue);
  if (overlays.showDanger) ditherBlend(OUT, Math.min(1, world.danger[idx]), d, RGB.lred);
  return OUT;
}

function nestTerrainPixel(terrain, x, y, idx, world, edge) {
  const d = bayer(x, y);
  const carved = terrain === TERRAIN.TUNNEL || terrain === TERRAIN.CHAMBER;
  if (y < world.nestY - 1 && !carved) return (y / world.nestY + d * 0.6) > 0.55 ? RGB.lblue : RGB.blue;
  if (y <= world.nestY && !carved) return d > 0.2 ? RGB.lgreen : RGB.green;
  if (carved) return edge ? TUNNEL_EDGE : terrain === TERRAIN.CHAMBER ? CHAMBER : TUNNEL;
  if (terrain === TERRAIN.WATER) return RGB.blue;
  if (terrain === TERRAIN.HAZARD) return d > -0.1 ? RGB.red : RGB.darkRed;
  if (hash2(x, y, 11) < 0.012) return RGB.dgray;
  const depth = (y - world.nestY) / Math.max(1, world.height - world.nestY);
  return NEST_SOIL[clampIndex(Math.floor(depth * 3 + d * 0.9 + (hash2(x, y) - 0.5) * 0.4 + 0.5), NEST_SOIL.length)];
}

/* ---- pixel ant atlas: 4 directions x 2 walk frames, 12px frames ---- */
const FRAME = 12, HALF = 6;
function antPixels(frame, big) {
  const px = [];
  const body = [[-4, 0], [-3, -1], [-3, 0], [-3, 1], [-2, -1], [-2, 0], [-2, 1], [-1, 0], [0, 0], [1, 0], [2, -1], [2, 0], [2, 1], [3, 0]];
  for (const p of body) px.push([p[0], p[1], 'b']);
  px.push([-3, -1, 'h'], [2, -1, 'h']);
  for (const p of [[4, -1], [5, -2], [4, 1], [5, 2], [0, -1], [1, -1], [0, 1], [1, 1]]) px.push([p[0], p[1], 'l']);
  const top = frame ? [-2, 0, 2] : [-1, 1, 3], bottom = frame ? [-1, 1, 3] : [-2, 0, 2];
  for (const x of top) px.push([x, -2, 'l']);
  for (const x of bottom) px.push([x, 2, 'l']);
  if (big) px.push([3, -1, 'b'], [3, 1, 'b']); // soldier mandibles
  return px;
}
const rot4 = (dx, dy, dir) => (dir === 0 ? [dx, dy] : dir === 1 ? [-dy, dx] : dir === 2 ? [-dx, -dy] : [dy, -dx]);
// Variant = which highlight/leg pair goes with the body colour.
const VARIANTS = [
  [VGA.dgray, VGA.black],   // 0 black colony
  [VGA.lred, '#550000'],    // 1 red colony
  [VGA.white, VGA.black],   // 2 job / duel colours
  [VGA.white, '#806000'],   // 3 selected
];
const atlases = new Map();
function antAtlas(body, variant, big) {
  let byBody = atlases.get(body);
  if (!byBody) { byBody = []; atlases.set(body, byBody); }
  const slot = variant * 2 + (big ? 1 : 0);
  if (byBody[slot]) return byBody[slot];
  const canvas = document.createElement('canvas');
  canvas.width = FRAME * 8; canvas.height = FRAME;
  const c = canvas.getContext('2d');
  const [highlight, leg] = VARIANTS[variant];
  for (let dir = 0; dir < 4; dir += 1) {
    for (let frame = 0; frame < 2; frame += 1) {
      const ox = (dir * 2 + frame) * FRAME + HALF;
      for (const [dx, dy, t] of antPixels(frame, big)) {
        const [rx, ry] = rot4(dx, dy, dir);
        c.fillStyle = t === 'b' ? body : t === 'h' ? highlight : leg;
        c.fillRect(ox + rx, HALF + ry, 1, 1);
      }
    }
  }
  byBody[slot] = canvas;
  return canvas;
}
const SPRITE = 3.2; // world tiles covered by one 12px frame
const CARRY = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function drawAnt(ctx, ant, colony, options) {
  if (options.zoom < 4) { classicSkin.drawAnt(ctx, ant, colony, options); return; }
  const red = colony.id === 'red';
  let body = red ? VGA.red : VGA.black, variant = red ? 1 : 0;
  if (options.showAntJobs || ant.state === 'FIGHT') { body = options.color; variant = 2; }
  if (options.selected) { body = VGA.yellow; variant = 3; }
  const dir = ((Math.round(options.heading / (Math.PI / 2)) % 4) + 4) % 4;
  const frame = (ant.x + ant.y) & 1;
  const atlas = antAtlas(body, variant, ant.role === 'soldier');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas, (dir * 2 + frame) * FRAME, 0, FRAME, FRAME,
    ant.x + 0.5 - SPRITE / 2, ant.y + 0.5 - SPRITE / 2, SPRITE, SPRITE);
  const type = ant.carryingType || (ant.carrying?.type === 'food' ? 'food' : 'none');
  if (type === 'food' || type === 'dirt') {
    const reach = SPRITE * 5 / FRAME;
    ctx.fillStyle = type === 'food' ? VGA.lgreen : VGA.brown;
    ctx.fillRect(ant.x + 0.25 + CARRY[dir][0] * reach, ant.y + 0.25 + CARRY[dir][1] * reach, 0.5, 0.5);
  }
  if (options.selected) {
    ctx.strokeStyle = VGA.yellow; ctx.lineWidth = 0.25;
    ctx.strokeRect(ant.x - 1.6, ant.y - 1.6, 4.2, 4.2);
  }
}

/* ---- queen: one 16px frame per colony ---- */
const queens = new Map();
function queenSprite(red) {
  const key = red ? 'red' : 'black';
  if (queens.has(key)) return queens.get(key);
  const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
  const c = canvas.getContext('2d');
  const body = red ? VGA.red : VGA.black, hi = red ? VGA.lred : VGA.dgray;
  const put = (x, y, color) => { c.fillStyle = color; c.fillRect(x + 8, y + 8, 1, 1); };
  for (let y = -3; y <= 3; y += 1) for (let x = -3; x <= 3; x += 1) {
    if (Math.abs(y) <= 1 && x >= -2 && x <= 2 && ((x + y) & 1)) put(x - 2, y - 3, VGA.white); // wings
    else if (Math.abs(y) <= 1 && x >= -2 && x <= 2) put(x - 2, y - 3, VGA.lgray);
  }
  for (let y = -3; y <= 3; y += 1) for (let x = -7; x <= -1; x += 1) if ((x + 4) ** 2 / 12 + y * y / 7 <= 1) put(x, y, body);
  for (let y = -1; y <= 1; y += 1) for (let x = 0; x <= 2; x += 1) put(x, y, body);
  for (let y = -1; y <= 1; y += 1) for (let x = 3; x <= 5; x += 1) put(x, y, body);
  put(-5, -1, hi); put(-4, -2, hi); put(4, -1, hi);
  for (const [x, y] of [[-6, 4], [-3, 4], [0, 2], [0, -2], [2, 2], [2, -2], [6, -2], [6, 2]]) put(x, y, VGA.black);
  for (const x of [3, 4, 5]) put(x, -2, VGA.yellow); // crown
  queens.set(key, canvas);
  return canvas;
}
function drawQueen(ctx, x, y, colony) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(queenSprite(colony.id === 'red'), x + 0.5 - 2.6, y + 0.5 - 2.6, 5.2, 5.2);
}

/* ---- entrance mound: dithered ellipse, cached per entrance ---- */
const mounds = new WeakMap();
function drawEntrance(ctx, entrance, colonyId) {
  const radius = Math.min(14, 3 + Math.sqrt(Math.max(0, entrance.soilOnSurface || 0)) * 0.22);
  const rx = Math.round(radius * 2) / 2, ry = Math.round(radius * 1.4) / 2 + 0.5;
  const key = `${rx}|${colonyId}`;
  let cached = mounds.get(entrance);
  if (!cached || cached.key !== key) {
    const pxPerTile = 2, w = Math.ceil(rx * 2 * pxPerTile), h = Math.ceil(ry * 2 * pxPerTile);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const c = canvas.getContext('2d');
    const red = colonyId === 'red', c1 = red ? '#aa3300' : VGA.brown, c2 = red ? '#6a1a00' : '#6a3500';
    for (let py = 0; py < h; py += 1) for (let px = 0; px < w; px += 1) {
      const nx = (px + 0.5 - w / 2) / (w / 2), ny = (py + 0.5 - h / 2) / (h / 2), e = nx * nx + ny * ny;
      if (e > 1) continue;
      const t = (bayer(px, py) + 0.5) * 16;
      c.fillStyle = (e < 0.55 ? t > 5 : t > 11) ? c1 : c2;
      if (ny < -0.55 && e > 0.6 && t > 7) c.fillStyle = '#ffaa55';
      c.fillRect(px, py, 1, 1);
    }
    c.fillStyle = VGA.black; c.fillRect(Math.round(w / 2 - 3), Math.round(h / 2 - 1), 6, 3);
    cached = { key, canvas }; mounds.set(entrance, cached);
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cached.canvas, entrance.x + 0.5 - rx, entrance.y + 0.5 - ry, rx * 2, ry * 2);
}

function drawFood(ctx, x, y) {
  ctx.fillStyle = '#002200'; ctx.fillRect(x - 0.15, y - 0.15, 1.3, 1.3);
  ctx.fillStyle = VGA.green; ctx.fillRect(x, y, 1, 1);
  ctx.fillStyle = VGA.lgreen; ctx.fillRect(x, y, 0.5, 0.5);
  ctx.fillStyle = VGA.white; ctx.fillRect(x, y, 0.25, 0.25);
}

function drawLarva(ctx, x, y, r) {
  const w = r * 1.3, h = r * 2;
  ctx.fillStyle = VGA.dgray; ctx.fillRect(x + 0.5 - w / 2 - 0.1, y + 0.5 - h / 2 - 0.1, w + 0.2, h + 0.2);
  ctx.fillStyle = VGA.white; ctx.fillRect(x + 0.5 - w / 2, y + 0.5 - h / 2, w, h);
  ctx.fillStyle = VGA.lgray; ctx.fillRect(x + 0.5 - w / 2, y + 0.5, w, h * 0.12);
}

export const ninetiesSkin = Object.freeze({
  ...classicSkin, name: 'nineties',
  surfaceBackground: '#3c6020', nestBackground: '#3a2210', horizon: VGA.lgreen, food: VGA.green,
  usesHeading: true, minimapAntColor: '#ffec80', minimapViewport: '#ff0000',
  surfaceTerrainPixel, nestTerrainPixel, drawAnt, drawQueen, drawEntrance, drawFood, drawLarva,
  minimapPalette: {
    [TERRAIN.GROUND]: [60, 96, 32], [TERRAIN.WALL]: [170, 170, 170], [TERRAIN.WATER]: [0, 0, 170],
    [TERRAIN.HAZARD]: [170, 0, 0], [TERRAIN.SOIL]: [107, 74, 46], [TERRAIN.TUNNEL]: [168, 128, 72], [TERRAIN.CHAMBER]: [208, 160, 96],
  },
});
