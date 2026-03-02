import { barycentricWeights, clampPointToTriangle, normalizeWeights, weightsToPercent } from './triangleMath.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class TriangleControl {
  constructor({ container, title, labels, initialWeights, onChange }) {
    this.container = container;
    this.labels = labels;
    this.onChange = onChange;
    this.dragging = false;

    this.vertices = {
      a: { x: 90, y: 16 },
      b: { x: 16, y: 144 },
      c: { x: 164, y: 144 },
    };

    this.root = document.createElement('section');
    this.root.className = 'triangle-control';

    const heading = document.createElement('h3');
    heading.textContent = title;
    this.root.appendChild(heading);

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', '0 0 180 160');
    this.svg.setAttribute('class', 'triangle-svg');

    const polygon = document.createElementNS(SVG_NS, 'polygon');
    polygon.setAttribute(
      'points',
      `${this.vertices.a.x},${this.vertices.a.y} ${this.vertices.b.x},${this.vertices.b.y} ${this.vertices.c.x},${this.vertices.c.y}`,
    );
    polygon.setAttribute('class', 'triangle-shape');
    this.svg.appendChild(polygon);

    this.marker = document.createElementNS(SVG_NS, 'circle');
    this.marker.setAttribute('r', '6');
    this.marker.setAttribute('class', 'triangle-marker');
    this.svg.appendChild(this.marker);

    this.svg.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.svg.setPointerCapture(event.pointerId);
      this.#setPointFromPointer(event);
    });
    this.svg.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      this.#setPointFromPointer(event);
    });
    this.svg.addEventListener('pointerup', () => {
      this.dragging = false;
    });

    this.root.appendChild(this.svg);

    this.labelNodes = {
      a: this.#cornerLabel('a', labels[0]),
      b: this.#cornerLabel('b', labels[1]),
      c: this.#cornerLabel('c', labels[2]),
    };

    this.container.appendChild(this.root);
    this.setWeights(initialWeights);
  }

  #cornerLabel(key, label) {
    const node = document.createElement('p');
    node.className = `triangle-corner triangle-corner-${key}`;
    node.textContent = `${label}: 0%`;
    this.root.appendChild(node);
    return node;
  }

  #setPointFromPointer(event) {
    const rect = this.svg.getBoundingClientRect();
    const scaleX = 180 / rect.width;
    const scaleY = 160 / rect.height;
    const point = {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
    this.setPoint(point);
  }

  setPoint(point) {
    const clamped = clampPointToTriangle(point, this.vertices.a, this.vertices.b, this.vertices.c);
    const weights = normalizeWeights(barycentricWeights(clamped, this.vertices.a, this.vertices.b, this.vertices.c));
    this.currentWeights = weights;
    this.marker.setAttribute('cx', clamped.x.toFixed(2));
    this.marker.setAttribute('cy', clamped.y.toFixed(2));

    const percentages = weightsToPercent(weights);
    this.labelNodes.a.textContent = `${this.labels[0]}: ${percentages.a}%`;
    this.labelNodes.b.textContent = `${this.labels[1]}: ${percentages.b}%`;
    this.labelNodes.c.textContent = `${this.labels[2]}: ${percentages.c}%`;

    if (this.onChange) {
      this.onChange({
        weights,
        percentages,
      });
    }
  }

  setWeights(weights) {
    const normalized = normalizeWeights(weights);
    const point = {
      x: this.vertices.a.x * normalized.wA + this.vertices.b.x * normalized.wB + this.vertices.c.x * normalized.wC,
      y: this.vertices.a.y * normalized.wA + this.vertices.b.y * normalized.wB + this.vertices.c.y * normalized.wC,
    };
    this.setPoint(point);
  }
}
