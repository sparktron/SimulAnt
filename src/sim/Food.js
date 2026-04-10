export const DEFAULT_PELLET_NUTRITION = 25;

export class FoodPellet {
  constructor(id, x, y, nutrition = DEFAULT_PELLET_NUTRITION) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.nutrition = nutrition;
    this.takenByAntId = null;
  }
}
