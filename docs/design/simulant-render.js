// Mock sim + two renderer skins (90s Retro, Realistic) for the theme mockups.
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash2(x, y, s = 0) { let h = Math.imul(x + 1 + s * 31, 374761393) ^ Math.imul(y + 1, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function valueNoise(seed, size = 64) {
  const r = mulberry32(seed), g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const at = (x, y) => g[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
function fbm(n, x, y, oct = 4) { let v = 0, a = 0.5, f = 1, t = 0; for (let i = 0; i < oct; i++) { v += a * n(x * f, y * f); t += a; a *= 0.5; f *= 2; } return v / t; }
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const JOB_COLORS = { fight: '#ff3030', forage: '#ffd700', return: '#00d4ff', patrol: '#9a5aff', wander: '#9a5aff' };

/* ---------------- Sim ---------------- */
export function createSim({ W, H, unit, seed = 7, nBlack = 60, nRed = 44, nests, foods }) {
  const rnd = mulberry32(seed);
  const colonies = {
    black: { id: 'black', x: nests.black[0], y: nests.black[1], food: 412, deaths: 0, target: nBlack, nest: 41 },
    red: { id: 'red', x: nests.red[0], y: nests.red[1], food: 356, deaths: 0, target: nRed, nest: 33 },
  };
  const piles = foods.map(([x, y, amt]) => ({ x, y, amount: amt, max: amt }));
  const ants = []; let nextId = 1, tick = 1840;
  const v0 = 0.22 * unit;
  function addAnt(col, near = false) {
    const c = colonies[col], role = rnd() < 0.18 ? 'soldier' : 'worker';
    const r = near ? 2 * unit : (6 + rnd() * 30) * unit, a0 = rnd() * Math.PI * 2;
    ants.push({ id: nextId++, colony: col, role, state: role === 'soldier' ? 'patrol' : rnd() < 0.78 ? 'forage' : 'wander',
      x: clamp(c.x + Math.cos(a0) * r, 2, W - 2), y: clamp(c.y + Math.sin(a0) * r, 2, H - 2), a: rnd() * Math.PI * 2,
      carry: rnd() < 0.3, target: null, ox: 0, oy: 0, wp: null, phase: rnd() * 6.28, hp: 55 + rnd() * 45, spd: 0.8 + rnd() * 0.4, fightT: 0, foe: null });
  }
  for (let i = 0; i < nBlack; i++) addAnt('black');
  for (let i = 0; i < nRed; i++) addAnt('red');
  for (const a of ants) if (a.carry) a.state = 'return';
  function pickFood(ant) {
    let best = null, bd = Infinity;
    for (const p of piles) { if (p.amount <= 0) continue; const d = Math.hypot(p.x - ant.x, p.y - ant.y) * (0.6 + rnd() * 0.8); if (d < bd) { bd = d; best = p; } }
    if (best) { const a = rnd() * 6.28, r = rnd() * 4 * unit; ant.ox = Math.cos(a) * r; ant.oy = Math.sin(a) * r; }
    return best;
  }
  const sim = {
    W, H, unit, ants, colonies, piles, selected: null,
    get tick() { return tick; },
    step() {
      tick++;
      for (const ant of ants) {
        const c = colonies[ant.colony]; let tx = ant.x, ty = ant.y;
        if (ant.state === 'fight') {
          ant.fightT--; ant.a += (rnd() - 0.5) * 1.4; ant.phase += 0.5;
          if (ant.foe) ant.foe.hp -= ant.role === 'soldier' ? 0.5 : 0.25;
          if (ant.fightT <= 0 || !ant.foe || ant.foe.hp <= 0) { ant.state = ant.carry ? 'return' : 'forage'; ant.foe = null; }
          continue;
        }
        if (ant.state === 'forage') {
          if (!ant.target || ant.target.amount <= 0) ant.target = pickFood(ant);
          if (!ant.target) ant.state = 'wander'; else { tx = ant.target.x + ant.ox; ty = ant.target.y + ant.oy; }
        } else if (ant.state === 'return') { tx = c.x; ty = c.y; }
        if (ant.state === 'wander' || ant.state === 'patrol') {
          const R = (ant.state === 'patrol' ? 70 : 45) * unit;
          if (!ant.wp || Math.hypot(ant.wp[0] - ant.x, ant.wp[1] - ant.y) < 3 * unit) ant.wp = [clamp(c.x + (rnd() - 0.5) * R * 2, 4, W - 4), clamp(c.y + (rnd() - 0.5) * R * 1.4, 4, H - 4)];
          tx = ant.wp[0]; ty = ant.wp[1];
          if (ant.state === 'wander' && rnd() < 0.004) ant.state = 'forage';
        }
        const da = angDiff(Math.atan2(ty - ant.y, tx - ant.x), ant.a);
        ant.a += clamp(da, -0.14, 0.14) + (rnd() - 0.5) * 0.32;
        const v = v0 * ant.spd * (ant.carry ? 0.85 : 1);
        ant.x += Math.cos(ant.a) * v; ant.y += Math.sin(ant.a) * v;
        if (ant.x < 2 || ant.x > W - 2) { ant.a = Math.PI - ant.a; ant.x = clamp(ant.x, 2, W - 2); }
        if (ant.y < 2 || ant.y > H - 2) { ant.a = -ant.a; ant.y = clamp(ant.y, 2, H - 2); }
        ant.phase += v / unit * 1.6;
        if (ant.state === 'forage' && ant.target && Math.hypot(tx - ant.x, ty - ant.y) < 2.2 * unit) { ant.target.amount = Math.max(0, ant.target.amount - 1); ant.carry = true; ant.state = 'return'; }
        else if (ant.state === 'return' && Math.hypot(c.x - ant.x, c.y - ant.y) < 2.5 * unit) { ant.carry = false; c.food += 1; ant.state = rnd() < 0.88 ? 'forage' : 'wander'; ant.a += Math.PI; }
      }
      if (tick % 4 === 0) {
        for (let i = 0; i < ants.length; i++) {
          const a = ants[i]; if (a.colony !== 'black' || a.state === 'fight') continue;
          for (let j = 0; j < ants.length; j++) {
            const b = ants[j]; if (b.colony !== 'red' || b.state === 'fight') continue;
            if (Math.abs(a.x - b.x) < 1.6 * unit && Math.abs(a.y - b.y) < 1.6 * unit && rnd() < 0.25) {
              a.state = b.state = 'fight'; a.fightT = b.fightT = 60 + rnd() * 80; a.foe = b; b.foe = a; break;
            }
          }
        }
      }
      for (let i = ants.length - 1; i >= 0; i--) if (ants[i].hp <= 0) { colonies[ants[i].colony].deaths++; if (sim.selected === ants[i].id) sim.selected = null; ants.splice(i, 1); }
      if (tick % 70 === 0) for (const k of ['black', 'red']) if (ants.filter(a => a.colony === k).length < colonies[k].target) addAnt(k, true);
      if (tick % 900 === 0) for (const p of piles) if (p.amount < p.max * 0.2) p.amount = p.max;
    },
    addFood(x, y, amt = 40) { piles.push({ x, y, amount: amt, max: amt, fresh: true }); if (piles.length > 9) piles.splice(0, 1); },
    selectNear(x, y, r) {
      let best = null, bd = r;
      for (const a of ants) { const d = Math.hypot(a.x - x, a.y - y); if (d < bd) { bd = d; best = a; } }
      sim.selected = best ? best.id : null; return best;
    },
    stats() {
      const blk = ants.filter(a => a.colony === 'black'), red = ants.filter(a => a.colony === 'red');
      const avg = l => l.length ? l.reduce((s, a) => s + a.hp, 0) / l.length : 0;
      const sel = ants.find(a => a.id === sim.selected);
      const workers = blk.filter(a => a.role === 'worker').length, soldiers = blk.length - workers;
      const foragers = blk.filter(a => a.state === 'forage' || a.state === 'return').length;
      const nurses = Math.round(colonies.black.nest * 0.55), diggers = Math.round(colonies.black.nest * 0.2);
      const hp = blk.map(a => a.hp);
      return {
        tick, blackAnts: blk.length + colonies.black.nest, antLoc: `S:${blk.length} N:${colonies.black.nest}`, redAnts: red.length + colonies.red.nest,
        food: Math.round(colonies.black.food), workers: workers + colonies.black.nest, soldiers, nurses, foragers, diggers,
        jobs: `${foragers} / ${diggers} / ${nurses}`, queenHP: (92.4 - (tick % 400) * 0.002).toFixed(1),
        pherMax: 'F:4.82 H:6.10', pherAvg: 'F:0.37 H:0.52', follow: `F:${Math.round(foragers * 0.7)} H:${blk.filter(a => a.state === 'return').length}`,
        health: `MIN:${hp.length ? Math.min(...hp).toFixed(1) : 0} AVG:${avg(blk).toFixed(1)} MAX:${hp.length ? Math.max(...hp).toFixed(1) : 0}`,
        deaths: colonies.black.deaths, byCause: `S:0 A:0 H:0 C:${colonies.black.deaths} O:0`,
        selHP: sel ? sel.hp : 0, blkHP: avg(blk), redHP: avg(red), hasSel: !!sel,
        selLabel: sel ? `${sel.colony === 'red' ? 'Red' : 'Black'} ${sel.role} #${String(sel.id).padStart(4, '0')} · ${sel.state.toUpperCase()}` : 'No ant selected',
      };
    },
  };
  return sim;
}

/* ---------------- 90s Retro skin ---------------- */
const VGA = { black: '#000000', blue: '#0000aa', green: '#00aa00', red: '#aa0000', brown: '#aa5500', lgray: '#aaaaaa', dgray: '#555555', lblue: '#5555ff', lgreen: '#55ff55', lred: '#ff5555', yellow: '#ffff55', white: '#ffffff' };
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
function hexRGB(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function antPixels(frame) {
  const px = [];
  const body = [[-4, 0], [-3, -1], [-3, 0], [-3, 1], [-2, -1], [-2, 0], [-2, 1], [-1, 0], [0, 0], [1, 0], [2, -1], [2, 0], [2, 1], [3, 0]];
  for (const p of body) px.push([...p, 'b']);
  px.push([-3, -1, 'h'], [2, -1, 'h']);
  for (const p of [[4, -1], [5, -2], [4, 1], [5, 2]]) px.push([...p, 'l']);
  for (const p of [[0, -1], [1, -1], [0, 1], [1, 1]]) px.push([...p, 'l']);
  const top = frame ? [-2, 0, 2] : [-1, 1, 3], bot = frame ? [-1, 1, 3] : [-2, 0, 2];
  for (const x of top) px.push([x, -2, 'l']);
  for (const x of bot) px.push([x, 2, 'l']);
  return px;
}
const ANT_PX = [antPixels(0), antPixels(1)];
function rot4(dx, dy, d) { return d === 0 ? [dx, dy] : d === 1 ? [-dy, dx] : d === 2 ? [-dx, -dy] : [dy, -dx]; }

export function createNineties(canvas, mini, sim, nests) {
  const W = sim.W, H = sim.H;
  const vw = Math.round(canvas.clientWidth / 3), vh = Math.round(canvas.clientHeight / 3);
  canvas.width = vw; canvas.height = vh;
  const camX = Math.round(clamp((nests.black[0] + nests.red[0]) / 2 - vw / 2, 0, W - vw)), camY = Math.round(clamp((H - vh) / 2, 0, H - vh));
  const off = document.createElement('canvas'); off.width = W; off.height = H;
  const oc = off.getContext('2d'); const img = oc.createImageData(W, H); const d = img.data;
  const n1 = valueNoise(11), n2 = valueNoise(29);
  const soil = ['#2e2e10', '#4a4a1c', '#68622a', '#857a38', '#a08f48'].map(hexRGB);
  const moss = ['#24401a', '#3c6020', '#4e7a2a', '#5c8a30'].map(hexRGB);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = fbm(n1, x / 34, y / 34, 3), g = fbm(n2, x / 50, y / 50, 3);
    const t = n + (BAYER[y & 3][x & 3] / 16 - 0.5) * 0.22 + (hash2(x, y) - 0.5) * 0.34;
    const pal = g > 0.6 ? moss : soil;
    const c = pal[clamp(Math.floor((t - 0.15) * pal.length * 1.4), 0, pal.length - 1)];
    const o = (y * W + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  const put = (x, y, hex) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const c = hexRGB(hex), o = (y * W + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; };
  const r = mulberry32(5);
  // pond
  const px = Math.round(W * 0.56), py = Math.round(H * 0.74);
  for (let y = -14; y <= 14; y++) for (let x = -26; x <= 26; x++) {
    const e = (x * x) / 676 + (y * y) / 196 + (hash2(x, y, 3) - 0.5) * 0.16;
    if (e < 1) put(px + x, py + y, e > 0.82 ? VGA.dgray : ((x + y) % 7 === 0 && (x * 3 + y) % 5 === 0) ? VGA.lblue : VGA.blue);
  }
  // boulders
  for (let i = 0; i < 7; i++) {
    const bx = Math.floor(r() * W), by = Math.floor(r() * H), rx = 5 + Math.floor(r() * 7), ry = 4 + Math.floor(r() * 5);
    if (Math.hypot(bx - nests.black[0], by - nests.black[1]) < 30 || Math.hypot(bx - nests.red[0], by - nests.red[1]) < 30) continue;
    for (let y = -ry - 1; y <= ry + 1; y++) for (let x = -rx - 1; x <= rx + 1; x++) {
      const e = (x * x) / (rx * rx) + (y * y) / (ry * ry);
      if (e < 1) { const l = (-x / rx - y / ry) * 0.5 + 0.5 + (BAYER[(y + 8) & 3][(x + 8) & 3] / 16 - 0.5) * 0.5; put(bx + x, by + y, l > 0.78 ? VGA.white : l > 0.45 ? VGA.lgray : VGA.dgray); }
      else if (e < 1.5 && x > 0 && y > 0) put(bx + x, by + y, '#1c1c08');
    }
  }
  // pebbles
  for (let i = 0; i < 170; i++) { const x = Math.floor(r() * W), y = Math.floor(r() * H); put(x, y, VGA.lgray); put(x + 1, y, VGA.lgray); put(x, y + 1, VGA.dgray); put(x + 1, y + 1, VGA.dgray); put(x, y, VGA.white); }
  // grass tufts
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(r() * W), y = Math.floor(r() * H);
    if (Math.hypot(x - nests.black[0], y - nests.black[1]) < 22 || Math.hypot(x - nests.red[0], y - nests.red[1]) < 22) continue;
    for (const [dx, dy, c] of [[0, 0, VGA.green], [-1, -1, VGA.green], [1, -1, VGA.green], [-2, -2, VGA.lgreen], [0, -2, VGA.green], [2, -2, VGA.lgreen], [0, -3, VGA.lgreen]]) put(x + dx, y + dy, c);
  }
  // nest mounds
  for (const [k, [nx, ny]] of Object.entries(nests)) {
    const c1 = k === 'red' ? '#aa3300' : VGA.brown, c2 = k === 'red' ? '#6a1a00' : '#6a3500';
    for (let y = -9; y <= 9; y++) for (let x = -13; x <= 13; x++) {
      const e = (x * x) / 169 + (y * y) / 81; if (e > 1) continue;
      put(nx + x, ny + y, (e < 0.55 ? (BAYER[(y + 12) & 3][(x + 12) & 3] > 5) : (BAYER[(y + 12) & 3][(x + 12) & 3] > 11)) ? c1 : c2);
    }
    for (let y = -1; y <= 1; y++) for (let x = -2; x <= 2; x++) put(nx + x, ny + y, VGA.black);
  }
  oc.putImageData(img, 0, 0);

  // minimap: surface band on top, underground below
  const M = mini.width = mini.height = 200; const mc = mini.getContext('2d'); mc.imageSmoothingEnabled = false;
  const mh = Math.round(M * H / W);
  const under = document.createElement('canvas'); under.width = M; under.height = M; const uc = under.getContext('2d');
  uc.drawImage(off, 0, 0, M, mh);
  uc.fillStyle = '#6b4a2e'; uc.fillRect(0, mh, M, M - mh);
  for (let y = mh; y < M; y += 2) for (let x = (y % 4); x < M; x += 4) { uc.fillStyle = '#5a3a20'; uc.fillRect(x, y, 1, 1); }
  for (const [k, [nx]] of Object.entries(nests)) {
    let x = nx / W * M, y = mh; uc.fillStyle = k === 'red' ? '#d0a060' : '#a88048';
    for (let i = 0; i < 26; i++) { uc.fillRect(Math.round(x), Math.round(y), 2, 2); x += (hash2(i, 1, k.length) - 0.5) * 6; y += 2.4; if (i % 8 === 7) uc.fillRect(Math.round(x) - 4, Math.round(y), 9, 4); }
  }
  uc.fillStyle = 'rgba(0,0,0,.45)'; uc.fillRect(0, mh, M, 1);

  const ctx = canvas.getContext('2d');
  function drawAnt(ant, jobs, selected) {
    const dir = ((Math.round(ant.a / (Math.PI / 2)) % 4) + 4) % 4;
    const frame = Math.floor(ant.phase) & 1, red = ant.colony === 'red';
    let b = red ? VGA.red : VGA.black, h = red ? VGA.lred : VGA.dgray, l = red ? '#550000' : VGA.black;
    if (jobs) { b = JOB_COLORS[ant.state] || b; h = VGA.white; }
    if (selected) { b = VGA.yellow; h = VGA.white; l = '#806000'; }
    const cx = Math.round(ant.x) - camX, cy = Math.round(ant.y) - camY;
    if (cx < -6 || cy < -6 || cx > vw + 6 || cy > vh + 6) return;
    const big = ant.role === 'soldier';
    for (const [dx, dy, t] of ANT_PX[frame]) {
      const [rx, ry] = rot4(dx, dy, dir);
      ctx.fillStyle = t === 'b' ? b : t === 'h' ? h : l; ctx.fillRect(cx + rx, cy + ry, 1, 1);
    }
    if (big) { const [rx, ry] = rot4(3, -1, dir), [sx, sy] = rot4(3, 1, dir); ctx.fillStyle = b; ctx.fillRect(cx + rx, cy + ry, 1, 1); ctx.fillRect(cx + sx, cy + sy, 1, 1); }
    if (ant.carry) { const [rx, ry] = rot4(5, 0, dir); ctx.fillStyle = VGA.lgreen; ctx.fillRect(cx + rx, cy + ry, 1, 1); }
    if (selected) { ctx.strokeStyle = VGA.yellow; ctx.lineWidth = 1; ctx.strokeRect(cx - 7.5, cy - 7.5, 15, 15); }
  }
  function drawFood(p) {
    const n = Math.ceil(p.amount / p.max * 9); if (!n) return;
    const spots = [[0, 0], [5, -2], [-5, 2], [3, 5], [-3, -5], [8, 3], [-8, -2], [1, -9], [-1, 9]];
    for (let i = 0; i < n; i++) {
      const x = Math.round(p.x) - camX + spots[i][0], y = Math.round(p.y) - camY + spots[i][1];
      ctx.fillStyle = '#002200'; ctx.fillRect(x - 1, y - 2, 4, 6); ctx.fillRect(x - 2, y - 1, 6, 4);
      ctx.fillStyle = VGA.green; ctx.fillRect(x - 1, y - 1, 4, 4);
      ctx.fillStyle = VGA.lgreen; ctx.fillRect(x - 1, y - 1, 2, 2);
      ctx.fillStyle = VGA.white; ctx.fillRect(x - 1, y - 1, 1, 1);
    }
  }
  return {
    camX, camY, vw, vh,
    toWorld(fx, fy) { return [camX + fx * vw, camY + fy * vh]; },
    pickRadius: 6,
    render(o) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, camX, camY, vw, vh, 0, 0, vw, vh);
      for (const p of sim.piles) drawFood(p);
      let selAnt = null;
      for (const a of sim.ants) { if (a.id === sim.selected) { selAnt = a; continue; } drawAnt(a, o.jobs, false); }
      if (selAnt) drawAnt(selAnt, o.jobs, true);
      mc.drawImage(under, 0, 0);
      for (const a of sim.ants) { mc.fillStyle = a.colony === 'red' ? '#ff3b30' : '#ffec80'; mc.fillRect(Math.floor(a.x / W * M), Math.floor(a.y / W * M), 1, 1); }
      mc.strokeStyle = '#ff0000'; mc.lineWidth = 1; mc.strokeRect(Math.round(camX / W * M) + 0.5, Math.round(camY / W * M) + 0.5, Math.round(vw / W * M), Math.round(vh / W * M));
    },
  };
}

/* ---------------- Realistic skin ---------------- */
function irregular(ctx, x, y, rx, ry, rnd, pts = 9, j = 0.22) {
  ctx.beginPath();
  for (let i = 0; i <= pts; i++) {
    const a = i / pts * Math.PI * 2, k = 1 + (rnd() - 0.5) * j * 2;
    const px = x + Math.cos(a) * rx * k, py = y + Math.sin(a) * ry * k;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
export function createRealistic(canvas, mini, sim, nests, foodSpots) {
  const W = sim.W, H = sim.H, k = Math.min(2, window.devicePixelRatio || 1);
  const vw = canvas.clientWidth, vh = canvas.clientHeight;
  canvas.width = Math.round(vw * k); canvas.height = Math.round(vh * k);
  const camX = Math.round((W - vw) / 2), camY = Math.round((H - vh) / 2);
  const mk = () => { const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k); const x = c.getContext('2d'); x.setTransform(k, 0, 0, k, 0, 0); return [c, x]; };
  const [bg, b] = mk(), [fg, f] = mk(), [sh, s] = mk();
  const rnd = mulberry32(42), n1 = valueNoise(3), n2 = valueNoise(77), n3 = valueNoise(123);

  // 1 soil base at world res, scaled up smooth
  const base = document.createElement('canvas'); base.width = W / 2; base.height = H / 2;
  const bc = base.getContext('2d'), im = bc.createImageData(base.width, base.height), dd = im.data;
  for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++) {
    const n = fbm(n1, x / 70, y / 70, 5), m = fbm(n3, x / 30, y / 30, 3);
    const t = clamp(n * 1.3 - 0.15, 0, 1), wet = clamp((m - 0.55) * 3, 0, 1) * 0.35;
    const o = (y * base.width + x) * 4;
    dd[o] = (52 + t * 70) * (1 - wet); dd[o + 1] = (40 + t * 55) * (1 - wet); dd[o + 2] = (28 + t * 38) * (1 - wet * 0.8); dd[o + 3] = 255;
  }
  bc.putImageData(im, 0, 0);
  b.imageSmoothingEnabled = true; b.drawImage(base, 0, 0, W, H);
  // grain tile
  const gt = document.createElement('canvas'); gt.width = gt.height = 256; const gc = gt.getContext('2d'), gi = gc.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) { const v = rnd() * 255; gi.data[i * 4] = gi.data[i * 4 + 1] = gi.data[i * 4 + 2] = v; gi.data[i * 4 + 3] = 255; }
  gc.putImageData(gi, 0, 0);
  b.save(); b.globalCompositeOperation = 'overlay'; b.globalAlpha = 0.22; b.fillStyle = b.createPattern(gt, 'repeat'); b.fillRect(0, 0, W, H); b.restore();
  // specks
  for (let i = 0; i < 14000; i++) {
    const x = rnd() * W, y = rnd() * H, light = rnd() < 0.55;
    b.fillStyle = light ? `rgba(${170 + rnd() * 50},${145 + rnd() * 40},${105 + rnd() * 30},${0.25 + rnd() * 0.45})` : `rgba(15,10,6,${0.3 + rnd() * 0.4})`;
    b.beginPath(); b.ellipse(x, y, 0.35 + rnd() * 1.1, 0.3 + rnd() * 0.8, rnd() * 3, 0, Math.PI * 2); b.fill();
  }
  // puddle (WATER terrain)
  const pdx = W * 0.57, pdy = H * 0.76;
  b.save(); b.fillStyle = 'rgba(20,14,8,.55)'; b.filter = 'blur(6px)'; irregular(b, pdx, pdy, 92, 46, mulberry32(9), 14, 0.12); b.fill(); b.restore();
  { const g = b.createRadialGradient(pdx - 20, pdy - 12, 4, pdx, pdy, 90); g.addColorStop(0, '#5f7472'); g.addColorStop(0.5, '#2c3a38'); g.addColorStop(1, '#141b19');
    b.fillStyle = g; irregular(b, pdx, pdy, 80, 38, mulberry32(9), 14, 0.12); b.fill();
    b.save(); b.globalAlpha = 0.5; b.strokeStyle = 'rgba(220,235,230,.35)'; b.lineWidth = 0.8;
    for (let i = 0; i < 3; i++) { b.beginPath(); b.ellipse(pdx - 30 + i * 22, pdy - 10 + i * 8, 10 + i * 4, 3 + i, 0, Math.PI * 1.1, Math.PI * 1.9); b.stroke(); }
    b.restore();
    const sp = b.createRadialGradient(pdx - 34, pdy - 16, 0, pdx - 34, pdy - 16, 26); sp.addColorStop(0, 'rgba(255,250,235,.38)'); sp.addColorStop(1, 'rgba(255,250,235,0)'); b.fillStyle = sp; b.fillRect(pdx - 70, pdy - 50, 80, 70); }

  // 2 pebbles + rocks
  const rocks = [];
  for (let i = 0; i < 300; i++) rocks.push({ x: rnd() * W, y: rnd() * H, r: rnd() < 0.06 ? 9 + rnd() * 16 : 1.2 + Math.pow(rnd(), 2) * 6 });
  rocks.sort((a, c) => a.y - c.y);
  for (const p of rocks) {
    if (Math.hypot(p.x - pdx, (p.y - pdy) * 2) < 170) continue;
    const rr = mulberry32(Math.floor(p.x * 13 + p.y));
    b.save(); b.filter = `blur(${Math.max(1, p.r * 0.25)}px)`; b.fillStyle = 'rgba(8,5,2,.55)'; irregular(b, p.x + p.r * 0.35, p.y + p.r * 0.45, p.r * 1.05, p.r * 0.8, rr); b.fill(); b.restore();
    const hue = 25 + rr() * 20, sat = 6 + rr() * 14, lig = 38 + rr() * 30;
    const g = b.createRadialGradient(p.x - p.r * 0.4, p.y - p.r * 0.45, p.r * 0.1, p.x, p.y, p.r * 1.2);
    g.addColorStop(0, `hsl(${hue},${sat}%,${Math.min(88, lig + 26)}%)`); g.addColorStop(0.55, `hsl(${hue},${sat}%,${lig}%)`); g.addColorStop(1, `hsl(${hue},${sat}%,${lig * 0.45}%)`);
    b.fillStyle = g; irregular(b, p.x, p.y, p.r, p.r * 0.78, mulberry32(Math.floor(p.x * 13 + p.y))); b.fill();
  }
  // 3 twigs
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W, y = rnd() * H, a = rnd() * Math.PI, L = 30 + rnd() * 90, w = 1.2 + rnd() * 2.4;
    const x2 = x + Math.cos(a) * L, y2 = y + Math.sin(a) * L, cx = (x + x2) / 2 + (rnd() - 0.5) * 20, cy = (y + y2) / 2 + (rnd() - 0.5) * 20;
    b.save(); b.lineCap = 'round'; b.filter = 'blur(1.5px)'; b.strokeStyle = 'rgba(0,0,0,.5)'; b.lineWidth = w + 1;
    b.beginPath(); b.moveTo(x + 2, y + 3); b.quadraticCurveTo(cx + 2, cy + 3, x2 + 2, y2 + 3); b.stroke(); b.restore();
    b.lineCap = 'round'; b.strokeStyle = '#3f2c1b'; b.lineWidth = w; b.beginPath(); b.moveTo(x, y); b.quadraticCurveTo(cx, cy, x2, y2); b.stroke();
    b.strokeStyle = 'rgba(170,135,95,.55)'; b.lineWidth = w * 0.35; b.beginPath(); b.moveTo(x - w * 0.2, y - w * 0.25); b.quadraticCurveTo(cx - w * 0.2, cy - w * 0.25, x2 - w * 0.2, y2 - w * 0.25); b.stroke();
  }
  // 4 dry leaves
  for (let i = 0; i < 46; i++) {
    const x = rnd() * W, y = rnd() * H, a = rnd() * Math.PI * 2, L = 14 + rnd() * 26, Wd = L * (0.28 + rnd() * 0.15);
    const hue = 22 + rnd() * 22, lig = 22 + rnd() * 26;
    b.save(); b.translate(x, y); b.rotate(a);
    b.save(); b.filter = 'blur(2px)'; b.fillStyle = 'rgba(0,0,0,.45)'; b.beginPath(); b.moveTo(-L / 2 + 3, 3); b.quadraticCurveTo(3, -Wd + 3, L / 2 + 3, 3); b.quadraticCurveTo(3, Wd + 3, -L / 2 + 3, 3); b.fill(); b.restore();
    const g = b.createLinearGradient(0, -Wd, 0, Wd); g.addColorStop(0, `hsl(${hue},48%,${lig + 14}%)`); g.addColorStop(1, `hsl(${hue - 6},42%,${lig}%)`);
    b.fillStyle = g; b.beginPath(); b.moveTo(-L / 2, 0); b.quadraticCurveTo(0, -Wd, L / 2, 0); b.quadraticCurveTo(0, Wd, -L / 2, 0); b.fill();
    b.strokeStyle = `hsla(${hue},40%,${lig - 10}%,.8)`; b.lineWidth = 0.6; b.beginPath(); b.moveTo(-L / 2 - 3, 0); b.lineTo(L / 2, 0); b.stroke();
    b.lineWidth = 0.35; for (let v = -2; v <= 2; v++) { if (!v) continue; b.beginPath(); b.moveTo(v * L * 0.12, 0); b.lineTo(v * L * 0.12 + L * 0.1, Math.sign(v) * Wd * 0.6); b.stroke(); b.beginPath(); b.moveTo(v * L * 0.12, 0); b.lineTo(v * L * 0.12 + L * 0.1, -Math.sign(v) * Wd * 0.6); b.stroke(); }
    b.restore();
  }
  // 5 nest mounds
  for (const [kname, [nx, ny]] of Object.entries(nests)) {
    const red = kname === 'red';
    const sg = b.createRadialGradient(nx + 6, ny + 8, 10, nx + 6, ny + 8, 70); sg.addColorStop(0, 'rgba(0,0,0,.45)'); sg.addColorStop(1, 'rgba(0,0,0,0)'); b.fillStyle = sg; b.fillRect(nx - 80, ny - 80, 170, 170);
    const rr = mulberry32(red ? 91 : 17);
    for (let i = 0; i < 2600; i++) {
      const rad = Math.abs((rr() + rr() + rr() - 1.5) * 34), a = rr() * Math.PI * 2;
      const x = nx + Math.cos(a) * rad * 1.15, y = ny + Math.sin(a) * rad * 0.9, gr = 0.7 + rr() * 1.6;
      const l = 0.75 + (1 - rad / 52) * 0.35 + (rr() - 0.5) * 0.3;
      const c = red ? [150, 98, 66] : [140, 110, 76];
      b.fillStyle = `rgb(${c[0] * l * 0.55},${c[1] * l * 0.55},${c[2] * l * 0.55})`; b.beginPath(); b.arc(x + gr * 0.3, y + gr * 0.35, gr, 0, 6.29); b.fill();
      b.fillStyle = `rgb(${c[0] * l},${c[1] * l},${c[2] * l})`; b.beginPath(); b.arc(x, y, gr * 0.85, 0, 6.29); b.fill();
      b.fillStyle = `rgba(255,240,215,${0.18 + rr() * 0.2})`; b.beginPath(); b.arc(x - gr * 0.3, y - gr * 0.3, gr * 0.35, 0, 6.29); b.fill();
    }
    const hg = b.createRadialGradient(nx, ny, 0, nx, ny, 14); hg.addColorStop(0, 'rgba(4,2,1,1)'); hg.addColorStop(0.45, 'rgba(10,6,3,.95)'); hg.addColorStop(1, 'rgba(20,12,6,0)');
    b.fillStyle = hg; b.beginPath(); b.ellipse(nx, ny, 15, 12, 0, 0, 6.29); b.fill();
  }

  // 6 grass — density field with worn trails + nest clearings
  const trails = [];
  for (const [kname, [nx, ny]] of Object.entries(nests)) for (const [fx, fy] of foodSpots) trails.push([nx, ny, fx, fy]);
  const clumps = [], cover = [];
  for (let i = 0; i < 8500; i++) {
    const x = rnd() * W, y = rnd() * H;
    let dens = fbm(n2, x / 240, y / 240, 4);
    let dmin = Infinity; for (const t of trails) dmin = Math.min(dmin, distSeg(x, y, ...t));
    for (const [nx, ny] of Object.values(nests)) dmin = Math.min(dmin, Math.hypot(x - nx, y - ny) - 70);
    dmin = Math.min(dmin, Math.hypot(x - pdx, (y - pdy) * 1.8) - 95);
    dens *= clamp(dmin / 70, 0, 1);
    if (rnd() < clamp((dens - 0.28) * 2.4, 0, 1)) clumps.push({ x, y, dens, fgr: rnd() < 0.12 && dmin > 40 });
    if (dens > 0.12) cover.push([x, y, dens]);
  }
  clumps.sort((a, c) => a.y - c.y);
  const blades = [];
  for (const c of clumps) {
    const n = 5 + Math.floor(rnd() * 8), dry = rnd() < 0.12;
    const hue = dry ? 44 + rnd() * 8 : 72 + rnd() * 28, sat = dry ? 38 : 32 + rnd() * 26;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 2.6, L = (12 + rnd() * 34) * (0.55 + c.dens * 0.8), w = 0.9 + rnd() * 1.5;
      blades.push({ x: c.x + (rnd() - 0.5) * 6, y: c.y + (rnd() - 0.5) * 4, a, L, w, bend: (rnd() - 0.5) * 0.9, hue: hue + (rnd() - 0.5) * 10, sat, dry, fg: c.fgr });
    }
  }
  const bladePath = (ctx, bl, ox = 0, oy = 0) => {
    const { x, y, a, L, w, bend } = bl, tx = x + Math.cos(a + bend) * L + ox, ty = y + Math.sin(a + bend) * L + oy;
    const cx = x + Math.cos(a) * L * 0.55 + ox, cy = y + Math.sin(a) * L * 0.55 + oy, nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
    ctx.beginPath(); ctx.moveTo(x + nx + ox, y + ny + oy); ctx.quadraticCurveTo(cx + nx * 0.6, cy + ny * 0.6, tx, ty); ctx.quadraticCurveTo(cx - nx * 0.6, cy - ny * 0.6, x - nx + ox, y - ny + oy); ctx.closePath();
    return [tx, ty];
  };
  b.lineCap = 'round';
  for (const [cx, cy, dn] of cover) {
    const m = Math.floor(10 + dn * 26);
    for (let i = 0; i < m; i++) {
      const x = cx + (rnd() - 0.5) * 44, y = cy + (rnd() - 0.5) * 44, a = -Math.PI / 2 + (rnd() - 0.5) * 3, L = 2.5 + rnd() * 7 * dn;
      b.strokeStyle = `hsla(${70 + rnd() * 30},${30 + rnd() * 25}%,${12 + rnd() * 20}%,${0.55 + rnd() * 0.4})`; b.lineWidth = 0.6 + rnd() * 0.8;
      b.beginPath(); b.moveTo(x, y); b.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); b.stroke();
    }
  }
  s.fillStyle = '#000'; for (const bl of blades) { bladePath(s, bl); s.fill(); }
  b.save(); b.setTransform(1, 0, 0, 1, 0, 0); b.filter = `blur(${3 * k}px)`; b.globalAlpha = 0.5; b.drawImage(sh, 6 * k, 8 * k); b.restore();
  b.setTransform(k, 0, 0, k, 0, 0);
  const fgShadow = [];
  for (const bl of blades) {
    const ctx = bl.fg ? f : b;
    const [tx, ty] = bladePath(ctx, bl);
    const g = ctx.createLinearGradient(bl.x, bl.y, tx, ty);
    g.addColorStop(0, `hsl(${bl.hue},${bl.sat}%,${bl.dry ? 24 : 11}%)`); g.addColorStop(0.45, `hsl(${bl.hue},${bl.sat}%,${bl.dry ? 42 : 26}%)`); g.addColorStop(1, `hsl(${bl.hue + 6},${bl.sat - 4}%,${bl.dry ? 66 : 44}%)`);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = `hsla(${bl.hue + 10},${bl.sat}%,${bl.dry ? 78 : 60}%,.35)`; ctx.lineWidth = 0.35;
    ctx.beginPath(); ctx.moveTo(bl.x, bl.y); ctx.quadraticCurveTo(bl.x + Math.cos(bl.a) * bl.L * 0.55, bl.y + Math.sin(bl.a) * bl.L * 0.55, tx, ty); ctx.stroke();
    if (bl.fg) fgShadow.push(bl);
  }
  // 7 lighting: warm key light + canopy dapple
  b.save(); b.setTransform(1, 0, 0, 1, 0, 0);
  const lg = b.createLinearGradient(0, 0, W * k, H * k); lg.addColorStop(0, 'rgba(255,214,150,.5)'); lg.addColorStop(0.6, 'rgba(255,214,150,0)'); lg.addColorStop(1, 'rgba(40,60,90,.35)');
  b.globalCompositeOperation = 'soft-light'; b.fillStyle = lg; b.fillRect(0, 0, W * k, H * k);
  b.globalCompositeOperation = 'multiply';
  const dr = mulberry32(8);
  for (let i = 0; i < 26; i++) {
    const x = dr() * W * k, y = dr() * H * k, r = (60 + dr() * 160) * k;
    const g = b.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(60,50,40,.42)'); g.addColorStop(1, 'rgba(60,50,40,0)');
    b.fillStyle = g; b.fillRect(x - r, y - r, r * 2, r * 2);
  }
  b.restore();
  // vignette (view space)
  const vig = document.createElement('canvas'); vig.width = canvas.width; vig.height = canvas.height; const vc = vig.getContext('2d');
  const vg = vc.createRadialGradient(vig.width / 2, vig.height * 0.48, vig.height * 0.3, vig.width / 2, vig.height / 2, vig.width * 0.66);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(6,4,2,.62)'); vc.fillStyle = vg; vc.fillRect(0, 0, vig.width, vig.height);

  // seed sprite
  const seed = document.createElement('canvas'); seed.width = 14 * k; seed.height = 10 * k; const sc = seed.getContext('2d'); sc.scale(k, k);
  { const g = sc.createRadialGradient(5.2, 3.6, 0.4, 7, 5, 6); g.addColorStop(0, '#fbe7b5'); g.addColorStop(0.45, '#d5a45a'); g.addColorStop(1, '#6e4a1c');
    sc.fillStyle = g; sc.beginPath(); sc.ellipse(7, 5, 5.4, 3.4, 0, 0, 6.29); sc.fill(); sc.strokeStyle = 'rgba(80,50,20,.6)'; sc.lineWidth = 0.4; sc.beginPath(); sc.moveTo(2.4, 5); sc.quadraticCurveTo(7, 4.2, 11.6, 5); sc.stroke(); }
  const seedLayout = new WeakMap();
  const seedsFor = p => {
    if (!seedLayout.has(p)) { const r = mulberry32(Math.floor(p.x * 7 + p.y)); const l = []; for (let i = 0; i < 28; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * 20; l.push([p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.8, r() * 6.28]); } l.sort((a, c) => a[1] - c[1]); seedLayout.set(p, l); }
    return seedLayout.get(p);
  };
  const ctx = canvas.getContext('2d');
  const PAL = {
    black: { hi: '#776c60', base: '#1d1914', rim: '#060504', leg: '#15110d' },
    red: { hi: '#f09a5a', base: '#8f3315', rim: '#3a1105', leg: '#5c200c' },
  };
  const grads = {};
  for (const [kname, p] of Object.entries(PAL)) {
    const mkG = (cx, cy, r0, r1, hx, hy) => { const g = ctx.createRadialGradient(hx, hy, r0, cx, cy, r1); g.addColorStop(0, p.hi); g.addColorStop(0.45, p.base); g.addColorStop(1, p.rim); return g; };
    grads[kname] = { gaster: mkG(-5.2, 0, 0.1, 4, -6, -1.4), thorax: mkG(0.4, 0, 0.1, 2.4, 0, -0.8), head: mkG(3.6, 0, 0.1, 2.2, 3.2, -0.9) };
  }
  const LEGS = [[2, 0.95, 0.42], [0.4, 1.62, 1.85], [-1.0, 2.25, 2.55]];
  function drawAntR(ant, jobs) {
    const x = ant.x - camX, y = ant.y - camY; if (x < -30 || y < -30 || x > vw + 30 || y > vh + 30) return;
    const p = PAL[ant.colony], g = grads[ant.colony], sz = ant.role === 'soldier' ? 1.58 : 1.3, headK = ant.role === 'soldier' ? 1.35 : 1;
    // shadow
    ctx.save(); ctx.translate(x + 2.6, y + 3.4); ctx.rotate(ant.a); ctx.scale(sz, sz); ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath(); ctx.ellipse(-5.2, 0, 3.8, 3, 0, 0, 6.29); ctx.ellipse(0.4, 0, 2.2, 1.3, 0, 0, 6.29); ctx.ellipse(3.6, 0, 2 * headK, 1.8 * headK, 0, 0, 6.29); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(x, y); ctx.rotate(ant.a); ctx.scale(sz, sz);
    if (jobs) { ctx.fillStyle = JOB_COLORS[ant.state] || '#fff'; ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.ellipse(-1, 0, 11, 7, 0, 0, 6.29); ctx.fill(); ctx.globalAlpha = 1; }
    // legs (tripod gait)
    ctx.strokeStyle = p.leg; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < 3; i++) for (const side of [-1, 1]) {
      const [bx, fa, ta] = LEGS[i], ph = ant.phase + ((i % 2 === 0) === (side === 1) ? 0 : Math.PI), sw = Math.sin(ph) * 0.28;
      const a1 = side * fa - sw * (side), a2 = side * ta - sw * side * 1.1;
      const kx = bx + Math.cos(a1) * 4.2, ky = Math.sin(a1) * 4.2, ex = kx + Math.cos(a2) * 5.2, ey = ky + Math.sin(a2) * 5.2;
      ctx.lineWidth = 0.75; ctx.beginPath(); ctx.moveTo(bx, side * 0.5); ctx.lineTo(kx, ky); ctx.stroke();
      ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(ex, ey); ctx.stroke();
    }
    // antennae
    const wig = Math.sin(ant.phase * 0.7) * 0.5;
    ctx.lineWidth = 0.45;
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(4.8 * headK, side * 0.7); ctx.lineTo(6.6 * headK, side * (2.6 + wig * side)); ctx.lineTo(9.4 * headK, side * (1.6 + wig)); ctx.stroke(); }
    // body
    ctx.fillStyle = g.gaster; ctx.beginPath(); ctx.ellipse(-5.2, 0, 3.7, 2.9, 0, 0, 6.29); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 0.3; for (const sx of [-6.4, -4.6, -3]) { ctx.beginPath(); ctx.arc(sx, 0, 2.6, -1.1, 1.1); ctx.stroke(); }
    ctx.fillStyle = p.base; ctx.beginPath(); ctx.ellipse(-1.7, 0, 0.9, 0.75, 0, 0, 6.29); ctx.fill();
    ctx.fillStyle = g.thorax; ctx.beginPath(); ctx.ellipse(0.4, 0, 2.1, 1.25, 0, 0, 6.29); ctx.fill();
    ctx.save(); ctx.translate(3.6, 0); ctx.scale(headK, headK); ctx.translate(-3.6, 0);
    ctx.fillStyle = g.head; ctx.beginPath(); ctx.ellipse(3.6, 0, 1.9, 1.7, 0, 0, 6.29); ctx.fill();
    ctx.strokeStyle = p.leg; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(5.2, -0.8); ctx.quadraticCurveTo(6.3, -0.4, 6.1, 0.2); ctx.moveTo(5.2, 0.8); ctx.quadraticCurveTo(6.3, 0.4, 6.1, -0.2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(3.2, -1.2, 0.28, 0, 6.29); ctx.arc(3.2, 1.2, 0.28, 0, 6.29); ctx.fill();
    ctx.restore();
    if (ant.carry) ctx.drawImage(seed, 6.2 * headK - 1, -2.6, 7, 5);
    ctx.restore();
    if (ant.id === sim.selected) {
      ctx.save(); ctx.strokeStyle = 'rgba(255,205,110,.95)'; ctx.lineWidth = 1.4; ctx.shadowColor = 'rgba(255,190,80,.9)'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.ellipse(x, y + 1, 17, 13, 0, 0, 6.29); ctx.stroke();
      ctx.lineWidth = 0.8; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.ellipse(x, y + 1, 23, 18, 0, 0, 6.29); ctx.stroke(); ctx.restore();
    }
  }
  // minimap
  const M = mini.width = mini.height = 256; const mc = mini.getContext('2d');
  const mh = Math.round(M * H / W);
  const under = document.createElement('canvas'); under.width = M; under.height = M; const uc = under.getContext('2d');
  uc.drawImage(bg, 0, 0, M, mh);
  const ug = uc.createLinearGradient(0, mh, 0, M); ug.addColorStop(0, '#3a2a1c'); ug.addColorStop(1, '#1a120b'); uc.fillStyle = ug; uc.fillRect(0, mh, M, M - mh);
  uc.strokeStyle = 'rgba(205,170,120,.55)'; uc.lineWidth = 1.4; uc.lineCap = 'round';
  for (const [kname, [nx]] of Object.entries(nests)) {
    let x = nx / W * M, y = mh; uc.beginPath(); uc.moveTo(x, y);
    for (let i = 0; i < 14; i++) { x += (hash2(i, 2, kname.length) - 0.5) * 10; y += 7.5; uc.lineTo(x, y); }
    uc.stroke(); uc.fillStyle = 'rgba(205,170,120,.45)';
    for (let i = 1; i < 4; i++) { uc.beginPath(); uc.ellipse(nx / W * M + (hash2(i, 5, kname.length) - 0.5) * 16, mh + i * 26, 7, 3.5, 0, 0, 6.29); uc.fill(); }
  }
  return {
    camX, camY, vw, vh, pickRadius: 22,
    toWorld(fx, fy) { return [camX + fx * vw, camY + fy * vh]; },
    render(o) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(bg, camX * k, camY * k, vw * k, vh * k, 0, 0, canvas.width, canvas.height);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      for (const pile of sim.piles) {
        const l = seedsFor(pile), n = Math.ceil(pile.amount / pile.max * l.length);
        for (let i = 0; i < n; i++) {
          const [sx, sy, a] = l[i]; const x = sx - camX, y = sy - camY;
          ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(1.4, 1.8, 5.4, 3.4, 0, 0, 6.29); ctx.fill(); ctx.drawImage(seed, -7, -5, 14, 10); ctx.restore();
        }
      }
      const sorted = sim.ants;
      for (const a of sorted) drawAntR(a, o.jobs);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(fg, camX * k, camY * k, vw * k, vh * k, 0, 0, canvas.width, canvas.height);
      ctx.drawImage(vig, 0, 0);
      mc.drawImage(under, 0, 0);
      for (const a of sim.ants) { mc.fillStyle = a.colony === 'red' ? '#ff7a52' : '#f1e9d2'; mc.fillRect(a.x / W * M - 0.75, a.y / W * M - 0.75, 1.5, 1.5); }
      mc.strokeStyle = 'rgba(255,255,255,.85)'; mc.lineWidth = 1; mc.strokeRect(camX / W * M + 0.5, camY / W * M + 0.5, vw / W * M, vh / W * M);
    },
  };
}
