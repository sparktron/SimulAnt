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
    this.territories = Array.isArray(data?.territories) ? data.territories.slice() : [];
    if (this.territories.length === 0) this.reset();
  }
}
