function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function barycentricWeights(point, a, b, c) {
  const v0 = sub(b, a);
  const v1 = sub(c, a);
  const v2 = sub(point, a);

  const d00 = dot(v0, v0);
  const d01 = dot(v0, v1);
  const d11 = dot(v1, v1);
  const d20 = dot(v2, v0);
  const d21 = dot(v2, v1);

  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-9) {
    return { wA: 1, wB: 0, wC: 0 };
  }

  const wB = (d11 * d20 - d01 * d21) / denom;
  const wC = (d00 * d21 - d01 * d20) / denom;
  const wA = 1 - wB - wC;
  return { wA, wB, wC };
}

function closestPointOnSegment(point, start, end) {
  const segment = sub(end, start);
  const segmentLengthSquared = dot(segment, segment);
  if (segmentLengthSquared === 0) return start;
  const projection = dot(sub(point, start), segment) / segmentLengthSquared;
  const t = clamp01(projection);
  return {
    x: start.x + segment.x * t,
    y: start.y + segment.y * t,
  };
}

export function clampPointToTriangle(point, a, b, c) {
  const weights = barycentricWeights(point, a, b, c);
  const inside = weights.wA >= 0 && weights.wB >= 0 && weights.wC >= 0;
  if (inside) return point;

  const candidates = [
    closestPointOnSegment(point, a, b),
    closestPointOnSegment(point, b, c),
    closestPointOnSegment(point, c, a),
  ];

  let best = candidates[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const dx = point.x - candidate.x;
    const dy = point.y - candidate.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

export function normalizeWeights(weights) {
  const safe = {
    wA: Math.max(0, weights.wA),
    wB: Math.max(0, weights.wB),
    wC: Math.max(0, weights.wC),
  };
  const total = safe.wA + safe.wB + safe.wC;
  if (total <= 1e-9) return { wA: 1, wB: 0, wC: 0 };
  return {
    wA: safe.wA / total,
    wB: safe.wB / total,
    wC: safe.wC / total,
  };
}

export function weightsToPercent(weights) {
  const normalized = normalizeWeights(weights);
  const raw = [normalized.wA * 100, normalized.wB * 100, normalized.wC * 100];
  const floored = raw.map((value) => Math.floor(value));
  let remainder = 100 - (floored[0] + floored[1] + floored[2]);

  const decimals = raw
    .map((value, index) => ({ index, decimal: value - Math.floor(value) }))
    .sort((left, right) => right.decimal - left.decimal);

  for (let i = 0; i < remainder; i += 1) {
    floored[decimals[i % 3].index] += 1;
  }

  return { a: floored[0], b: floored[1], c: floored[2] };
}
