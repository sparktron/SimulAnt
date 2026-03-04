import { VIEW } from '../ui/ViewManager.js';

export class InputRouter {
  /**
   * Routes pointer/wheel input to the active view's handlers.
   *
   * Inputs are raw canvas events; outputs are delegated handler callbacks that
   * mutate camera position, paint tools, and selection state.
   */
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
      if (!point) return;

      const activeHandlers = this.#activeHandlers();
      activeHandlers.onPointerWorld?.(point.x, point.y);

      const selected = activeHandlers.selectAnt?.(point.x, point.y);
      if (selected) {
        this.painting = false;
        return;
      }

      this.painting = true;
      activeHandlers.paint?.(point.x, point.y);
    });

    this.canvas.addEventListener('pointermove', (event) => {
      const dx = event.clientX - this.lastX;
      const dy = event.clientY - this.lastY;
      this.lastX = event.clientX;
      this.lastY = event.clientY;

      const point = this.#pointFromClient(event.clientX, event.clientY);
      const activeHandlers = this.#activeHandlers();
      if (!point) return;
      activeHandlers.onPointerWorld?.(point.x, point.y);

      if (this.panning) {
        activeHandlers.pan?.(dx, dy);
        return;
      }

      if (this.painting) {
        activeHandlers.paint?.(point.x, point.y);
      }
    });

    const endPointerInteraction = () => {
      this.painting = false;
      this.panning = false;
    };

    this.canvas.addEventListener('pointerup', endPointerInteraction);
    this.canvas.addEventListener('pointercancel', endPointerInteraction);
    this.canvas.addEventListener('lostpointercapture', endPointerInteraction);

    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const zoomDelta = event.deltaY < 0 ? 1.1 : 0.9;
      this.#activeHandlers().zoom?.(zoomDelta);
    });
  }

  #pointFromClient(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const handlers = this.#activeHandlers();
    if (!handlers?.screenToWorld) return null;

    const point = handlers.screenToWorld(clientX - rect.left, clientY - rect.top);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return point;
  }

  #activeHandlers() {
    return this.viewManager.getCurrent() === VIEW.SURFACE ? this.handlers.surface : this.handlers.nest;
  }
}
