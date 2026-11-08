// All caches belong to rendering, never to simulation objects.
const atlases = new Map();
const overlays = new WeakMap();
export function antSprite(style, color) {
  const key = `${style}|${color}`;
  if (atlases.has(key)) return atlases.get(key);
  const canvas = document.createElement('canvas');
  const size = 32, steps = style === 'modern' ? 16 : 8;
  canvas.width = size * steps; canvas.height = size;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < steps; i++) {
    ctx.save(); ctx.translate(i * size + 16, 16); ctx.rotate(i * Math.PI * 2 / steps);
    if (style === 'modern') {
      const trail = ctx.createLinearGradient(-15, 0, 2, 0);
      trail.addColorStop(0, 'transparent'); trail.addColorStop(1, color);
      ctx.fillStyle = trail; ctx.globalAlpha = 0.45;
      ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(-3, -3); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -4); ctx.lineTo(-2, 0); ctx.lineTo(-5, 4); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = color;
      for (const y of [-6, 4]) for (const x of [-5, 0, 5]) ctx.fillRect(x - 2, y, 2, 3);
      ctx.fillRect(-8, -3, 6, 6); ctx.fillRect(-1, -2, 4, 4); ctx.fillRect(4, -3, 5, 6);
      ctx.fillStyle = '#aa7142'; ctx.fillRect(6, -2, 2, 2);
    }
    ctx.restore();
  }
  const atlas = { canvas, size, steps }; atlases.set(key, atlas); return atlas;
}
export function drawSprite(ctx, style, color, x, y, angle, scale = 3) {
  const { canvas, size, steps } = antSprite(style, color);
  const frame = ((Math.round(angle / (Math.PI * 2) * steps) % steps) + steps) % steps;
  ctx.imageSmoothingEnabled = style === 'modern';
  ctx.drawImage(canvas, frame * size, 0, size, size, x + 0.5 - scale / 2, y + 0.5 - scale / 2, scale, scale);
}
export function polygon(ctx, x, y, radius, sides = 6) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = i / sides * Math.PI * 2;
    const px = x + Math.cos(a) * radius, py = y + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
export function postProcess(ctx, width, height, owner, retro = false) {
  let layer = overlays.get(owner);
  if (!layer || layer.width !== Math.ceil(width) || layer.height !== Math.ceil(height) || layer.retro !== retro) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width); canvas.height = Math.ceil(height);
    const c = canvas.getContext('2d');
    const vignette = c.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height / 2, Math.max(width, height) * 0.7);
    vignette.addColorStop(0, 'transparent'); vignette.addColorStop(1, retro ? 'rgba(15,8,0,0.28)' : 'rgba(0,0,0,0.32)');
    c.fillStyle = vignette; c.fillRect(0, 0, width, height);
    if (retro) { c.fillStyle = 'rgba(0,0,0,0.08)'; for (let y = 0; y < height; y += 2) c.fillRect(0, y, width, 1); }
    layer = { canvas, width: canvas.width, height: canvas.height, retro }; overlays.set(owner, layer);
  }
  ctx.drawImage(layer.canvas, 0, 0, width, height);
}
