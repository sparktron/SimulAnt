/*
    Food pellet: discrete nutrition unit on the surface or in the nest.

    Contract:
    - takenByAntId is null until an ant marks it for pickup
    - Once claimed, the pellet persists until the claiming ant deposits it
    - Pickup is first-come-first-served (ant that marks it owns it)
    - Pellet is removed when ant reaches food drop point in the nest

    Important: Multiple ants can occupy the same tile and see the same pellets.
    The takenByAntId field prevents double-pickup (race condition).
    This avoids needing distributed consensus on ownership.
*/

// Was 25 — equal to workerEatNutrition. With the half-cap field-eating
// rule (v0.26.0), a low-health forager delivers only 12.5 per trip,
// which is below one worker meal. Bumping to 40 raises per-trip delivery
// to 20 and gives the colony a positive margin per forager round trip.
export const DEFAULT_PELLET_NUTRITION = 40;

export class FoodPellet {
  constructor(id, x, y, nutrition = DEFAULT_PELLET_NUTRITION) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.nutrition = nutrition;
    // takenByAntId: null when unclaimed, string ant-id when an ant is carrying it
    this.takenByAntId = null;
  }
}
