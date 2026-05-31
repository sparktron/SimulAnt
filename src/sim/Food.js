/*
    Food pellet: discrete nutrition unit on the surface or in the nest.

    Contract:
    - takenByAntId is null while the pellet sits on the surface, and is stamped
      with the carrying ant's id at the instant of pickup.
    - Pickup removes the pellet from the surface list immediately — its
      nutrition then travels with the ant as carried cargo (ant.carrying), so a
      claimed pellet is NOT kept in the list while being carried.
    - Pickup is first-come-first-served: ants update in stable array order, and
      the first ant standing on a pellet's tile claims and removes it.

    Important: Multiple ants can occupy the same tile and see the same pellet in
    the same tick. Because the claiming ant removes the pellet in the same step
    it stamps takenByAntId, a later ant in that tick can no longer find it —
    that ordering, not distributed consensus, is what prevents double-pickup.
    (takenByAntId is still serialized so any externally-set reservation survives
    a save/load round-trip.)
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
