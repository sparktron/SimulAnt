export const DEFAULT_PELLET_NUTRITION = 25;
export const FOOD_SPOIL_RATE = 0.002;
export const FOOD_MIN_NUTRITION = 1;

export class FoodPellet {
  constructor(id, x, y, nutrition = DEFAULT_PELLET_NUTRITION) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.nutrition = nutrition;
    this.takenByAntId = null;
    this.age = 0;
  }

  /** Returns true if the pellet should be removed (fully spoiled). */
  spoil() {
    this.age += 1;
    this.nutrition = Math.max(0, this.nutrition - FOOD_SPOIL_RATE);
    return this.nutrition <= 0;
  }
}

