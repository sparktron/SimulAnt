function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function barycentricWeights(point, triangle) {
  const [a, b, c] = triangle;
  const v0 = sub(b, a);
  const v1 = sub(c, a);
  const v2 = sub(point, a);
  const d00 = dot(v0, v0);
  const d01 = dot(v0, v1);
  const d11 = dot(v1, v1);
  const d20 = dot(v2, v0);
  const d21 = dot(v2, v1);
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-12) {
    return { a: 1, b: 0, c: 0 };
  }

  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1 - v - w;

  return { a: u, b: v, c: w };
}

export function pointFromBarycentric(weights, triangle) {
  const [a, b, c] = triangle;
  return {
    x: a.x * weights.a + b.x * weights.b + c.x * weights.c,
    y: a.y * weights.a + b.y * weights.b + c.y * weights.c,
  };
}

function clampToSegment(point, start, end) {
  const ab = sub(end, start);
  const ap = sub(point, start);
  const denom = dot(ab, ab);
  const t = denom <= 0 ? 0 : Math.max(0, Math.min(1, dot(ap, ab) / denom));
  return { x: start.x + ab.x * t, y: start.y + ab.y * t };
}

export function clampPointToTriangle(point, triangle) {
  const weights = barycentricWeights(point, triangle);
  if (weights.a >= 0 && weights.b >= 0 && weights.c >= 0) return point;

  const [a, b, c] = triangle;
  const candidates = [
    clampToSegment(point, a, b),
    clampToSegment(point, b, c),
    clampToSegment(point, c, a),
  ];

  let best = candidates[0];
  let bestD2 = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const dx = candidate.x - point.x;
    const dy = candidate.y - point.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = candidate;
    }
  }
  return best;
}

export function normalizedWeightsForPoint(point, triangle) {
  const clamped = clampPointToTriangle(point, triangle);
  const raw = barycentricWeights(clamped, triangle);
  const positive = {
    a: Math.max(0, raw.a),
    b: Math.max(0, raw.b),
    c: Math.max(0, raw.c),
  };
  const sum = positive.a + positive.b + positive.c || 1;
  return {
    a: positive.a / sum,
    b: positive.b / sum,
    c: positive.c / sum,
  };
}

export class TriangleControl {
  constructor(container, options) {
    this.container = container;
    this.title = options.title;
    this.corners = options.corners;
    this.onChange = options.onChange;

    this.width = 220;
    this.height = 190;
    this.triangle = [
      { x: 28, y: 166 },
      { x: 192, y: 166 },
      { x: 110, y: 24 },
    ];

    this.weights = { ...options.initialWeights };
    this.marker = pointFromBarycentric(this.weights, this.triangle);
    this.dragging = false;

    this.#render();
    this.#draw();
    this.#emit();
  }

  #render() {
    this.root = document.createElement('section');
    this.root.className = 'triangle-control';
    this.root.innerHTML = `<h3>${this.title}</h3><div class="triangle-wrap"></div>`;

    const wrap = this.root.querySelector('.triangle-wrap');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'triangle-canvas';
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    wrap.appendChild(this.canvas);

    this.cornerEls = this.corners.map((label, idx) => {
      const el = document.createElement('div');
      el.className = `triangle-corner triangle-corner-${idx}`;
      wrap.appendChild(el);
      return { label, el };
    });

    this.canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.canvas.setPointerCapture(event.pointerId);
      this.#updateFromEvent(event);
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      this.#updateFromEvent(event);
    });
    this.canvas.addEventListener('pointerup', () => {
      this.dragging = false;
    });
    this.canvas.addEventListener('pointercancel', () => {
      this.dragging = false;
    });

    this.container.appendChild(this.root);
  }

  #updateFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    const point = {
      x: ((event.clientX - rect.left) / rect.width) * this.width,
      y: ((event.clientY - rect.top) / rect.height) * this.height,
    };

    this.weights = normalizedWeightsForPoint(point, this.triangle);
    this.marker = pointFromBarycentric(this.weights, this.triangle);
    this.#draw();
    this.#emit();
  }

  #emit() {
    const asPct = {
      [this.corners[0]]: Math.round(this.weights.a * 100),
      [this.corners[1]]: Math.round(this.weights.b * 100),
      [this.corners[2]]: Math.max(0, 100 - Math.round(this.weights.a * 100) - Math.round(this.weights.b * 100)),
    };
    if (this.onChange) this.onChange(asPct);

    this.cornerEls[0].el.textContent = `${this.corners[0]} ${asPct[this.corners[0]]}%`;
    this.cornerEls[1].el.textContent = `${this.corners[1]} ${asPct[this.corners[1]]}%`;
    this.cornerEls[2].el.textContent = `${this.corners[2]} ${asPct[this.corners[2]]}%`;
  }

  #draw() {
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.beginPath();
    ctx.moveTo(this.triangle[0].x, this.triangle[0].y);
    ctx.lineTo(this.triangle[1].x, this.triangle[1].y);
    ctx.lineTo(this.triangle[2].x, this.triangle[2].y);
    ctx.closePath();
    ctx.fillStyle = '#d6d6d6';
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(this.marker.x, this.marker.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#d41a1a';
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
