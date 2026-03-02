function hashString(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawOrganicBlob(ctx, cx, cy, radius, seedKey, color, amplitude) {
  const points = 32;
  const rand = mulberry32(hashString(seedKey));

  ctx.fillStyle = color;
  ctx.beginPath();

  for (let i = 0; i <= points; i += 1) {
    const t = (i / points) * Math.PI * 2;
    const jitter = (rand() * 2 - 1) * amplitude;
    const rr = Math.max(0.1, radius + jitter);
    const x = cx + Math.cos(t) * rr;
    const y = cy + Math.sin(t) * rr;

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.closePath();
  ctx.fill();
}

export function drawSoilMound(ctx, entrance) {
  const cx = entrance.x + 0.5;
  const cy = entrance.y + 0.5;
  const holeRadius = 1.5;
  const moundRadius = 3 + Math.sqrt(Math.max(0, entrance.soilOnSurface)) * 0.35;

  drawOrganicBlob(
    ctx,
    cx,
    cy,
    moundRadius,
    `${entrance.id}-outer`,
    'rgba(144, 103, 62, 0.75)',
    Math.max(0.3, moundRadius * 0.12),
  );

  drawOrganicBlob(
    ctx,
    cx,
    cy,
    Math.max(holeRadius + 0.6, moundRadius * 0.55),
    `${entrance.id}-inner`,
    'rgba(126, 86, 46, 0.45)',
    Math.max(0.2, moundRadius * 0.08),
  );

  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(cx, cy, holeRadius, 0, Math.PI * 2);
  ctx.fill();
}
