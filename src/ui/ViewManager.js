export const VIEW = Object.freeze({
  SURFACE: 'SURFACE',
  NEST: 'NEST',
});

/**
 * View state architecture:
 * - Exactly two states exist: SURFACE and NEST.
 * - Simulation data is shared (world + colony), so toggling never resets entities/resources.
 * - View-specific state is isolated per mode (camera transform and input mapping).
 *
 * Coordinate mapping:
 * - SURFACE renderer/input use top-down (x, y) world coordinates on the full map.
 * - NEST renderer/input use side-view framing of underground depth, where y is interpreted as depth.
 */
export class ViewManager {
  constructor(initialView = VIEW.SURFACE) {
    if (!Object.values(VIEW).includes(initialView)) {
      throw new Error(`Invalid initial view: ${initialView}`);
    }
    this.current = initialView;
    this.listeners = new Set();
  }

  getCurrent() {
    return this.current;
  }

  toggle() {
    this.setView(this.current === VIEW.SURFACE ? VIEW.NEST : VIEW.SURFACE);
  }

  setView(nextView) {
    if (!Object.values(VIEW).includes(nextView)) {
      throw new Error(`Invalid view: ${nextView}`);
    }
    if (nextView === this.current) return;
    this.current = nextView;
    this.listeners.forEach((listener) => listener(this.current));
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
