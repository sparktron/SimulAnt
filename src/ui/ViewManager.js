export const VIEW = Object.freeze({
  SURFACE: 'SURFACE',
  BLACK_NEST: 'BLACK_NEST',
  RED_NEST: 'RED_NEST',
});

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
    this.setView(this.current === VIEW.SURFACE ? VIEW.BLACK_NEST : VIEW.SURFACE);
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
