/**
 * Macro simulation boundary.
 *
 * Current game logic is effectively micro-driven; this engine tracks deterministic
 * territory metadata so macro progression can evolve without coupling to micro tick internals.
 */
export class MacroEngine {
  constructor(world) {
    this.world = world;
    this.territories = [];
  }

  reset() {
    this.territories = [
      {
        id: 'territory-home',
        centerX: this.world.nestX,
        centerY: this.world.nestY,
        owner: 'player-colony',
      },
    ];
  }

  syncHomeTerritory(x, y) {
    if (!this.world.inBounds(x, y)) return;
    const home = this.territories.find((territory) => territory.id === 'territory-home');
    if (home) {
      home.centerX = x;
      home.centerY = y;
      return;
    }

    this.territories.unshift({
      id: 'territory-home',
      centerX: x,
      centerY: y,
      owner: 'player-colony',
    });
  }

  update(_context) {
    // Intentionally deterministic and side-effect free for now.
    // Keeps a stable macro boundary without introducing director behavior.
  }

  serialize() {
    return {
      territories: this.territories,
    };
  }

  loadFromSerialized(data) {
    if (!Array.isArray(data?.territories)) {
      this.reset();
      return;
    }

    this.territories = data.territories
      .filter((territory) => territory && territory.id)
      .map((territory) => ({
        id: String(territory.id),
        centerX: Number.isFinite(territory.centerX) ? territory.centerX : this.world.nestX,
        centerY: Number.isFinite(territory.centerY) ? territory.centerY : this.world.nestY,
        owner: territory.owner ? String(territory.owner) : 'unknown',
      }));

    if (this.territories.length === 0) {
      this.reset();
      return;
    }

    this.syncHomeTerritory(this.world.nestX, this.world.nestY);
  }
}
