import { VIEW } from '../ui/ViewManager.js';

export class InputRouter {
  constructor(canvas, viewManager, handlers) {
    this.canvas = canvas;
    this.viewManager = viewManager;
    this.handlers = handlers;

    this.painting = false;
    this.panning = false;
    this.lastX = 0;
    this.lastY = 0;

    this.#bindEvents();
  }

  #bindEvents() {
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    this.canvas.addEventListener('pointerdown', (event) => {
      this.canvas.setPointerCapture(event.pointerId);
      this.lastX = event.clientX;
      this.lastY = event.clientY;

      if (event.button === 2 || event.shiftKey) {
        this.panning = true;
        return;
      }

      const point = this.#pointFromClient(event.clientX, event.clientY);
      this.#activeHandlers().onPointerWorld?.(point.x, point.y);

      const selected = this.#activeHandlers().selectAnt?.(point.x, point.y);
      if (selected) {
        this.painting = false;
        return;
      }

      this.painting = true;
      this.#activeHandlers().paint(point.x, point.y);
    });

    this.canvas.addEventListener('pointermove', (event) => {
      const dx = event.clientX - this.lastX;
      const dy = event.clientY - this.lastY;
      this.lastX = event.clientX;
      this.lastY = event.clientY;

      const point = this.#pointFromClient(event.clientX, event.clientY);
      this.#activeHandlers().onPointerWorld?.(point.x, point.y);

      if (this.panning) {
        this.#activeHandlers().pan(dx, dy);
        return;
      }

      if (this.painting) {
        this.#activeHandlers().paint(point.x, point.y);
      }
    });

    this.canvas.addEventListener('pointerup', () => {
      this.painting = false;
      this.panning = false;
    });

    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const zoomDelta = event.deltaY < 0 ? 1.1 : 0.9;
      this.#activeHandlers().zoom(zoomDelta);
    });
  }

  #pointFromClient(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return this.#activeHandlers().screenToWorld(clientX - rect.left, clientY - rect.top);
  }

  #activeHandlers() {
    return this.viewManager.getCurrent() === VIEW.SURFACE ? this.handlers.surface : this.handlers.nest;
  }
}
