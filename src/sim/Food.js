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

export const DEFAULT_PELLET_NUTRITION = 25;

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
