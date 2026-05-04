/**
 * Parameter definitions for the ant simulation.
 * Each parameter includes metadata for UI rendering (min, max, step, label, group).
 * `advanced: true` means it only shows when "Advanced" mode is toggled.
 */

export const parameterDefinitions = {
  // =====================
  // MOVEMENT (Core)
  // =====================
  walkRho: {
    label: 'Movement Correlation (ρ)',
    group: 'Movement',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: false,
  },
  walkSigma: {
    label: 'Movement Noise (σ)',
    group: 'Movement',
    min: 0,
    max: 0.2,
    step: 0.01,
    advanced: false,
  },
  walkMaxTurnRate: {
    label: 'Max Turn Rate',
    group: 'Movement',
    min: 0.1,
    max: 1,
    step: 0.05,
    advanced: false,
  },
  meanderAmplitude: {
    label: 'Meander Amplitude',
    group: 'Movement',
    min: 0,
    max: 0.2,
    step: 0.01,
    advanced: false,
  },
  pTurnSignFlip: {
    label: 'Meander Persistence',
    group: 'Movement',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: false,
  },
  headingBias: {
    label: 'Heading Bias',
    group: 'Movement',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: false,
  },

  // =====================
  // DECISION-MAKING (Core)
  // =====================
  followAlpha: {
    label: 'Follow Sensitivity (α)',
    group: 'Decision-Making',
    min: 0,
    max: 5,
    step: 0.1,
    advanced: false,
  },
  followBeta: {
    label: 'Follow Strength (β)',
    group: 'Decision-Making',
    min: 0,
    max: 20,
    step: 0.5,
    advanced: false,
  },
  foodVisionRadius: {
    label: 'Food Vision Radius',
    group: 'Decision-Making',
    min: 1,
    max: 100,
    step: 1,
    advanced: false,
  },
  surfaceFoodSearchMaxMissTicks: {
    label: 'Food Search Timeout (ticks)',
    group: 'Decision-Making',
    min: 50,
    max: 1000,
    step: 50,
    advanced: false,
  },
  surfaceReturnToNestHungerThreshold: {
    label: 'Return to Nest Threshold',
    group: 'Decision-Making',
    min: 0.1,
    max: 1,
    step: 0.05,
    advanced: false,
  },

  // =====================
  // OBSTACLE & DANGER (Core)
  // =====================
  obstacleLookahead: {
    label: 'Obstacle Lookahead (tiles)',
    group: 'Obstacle Avoidance',
    min: 1,
    max: 5,
    step: 0.5,
    advanced: false,
  },
  obstacleTurnGain: {
    label: 'Obstacle Turn Gain',
    group: 'Obstacle Avoidance',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: false,
  },
  dangerTurnLookahead: {
    label: 'Danger Lookahead (tiles)',
    group: 'Obstacle Avoidance',
    min: 1,
    max: 5,
    step: 0.5,
    advanced: false,
  },
  dangerTurnGain: {
    label: 'Danger Turn Gain',
    group: 'Obstacle Avoidance',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: false,
  },

  // =====================
  // HEALTH & NUTRITION (Core)
  // =====================
  healthDrainRate: {
    label: 'Health Drain Rate',
    group: 'Health',
    min: 0,
    max: 20,
    step: 0.5,
    advanced: false,
  },
  healthRegenRate: {
    label: 'Health Regen Rate',
    group: 'Health',
    min: 0,
    max: 5,
    step: 0.1,
    advanced: false,
  },
  healthWorkMoveDrainRate: {
    label: 'Movement Drain Rate',
    group: 'Health',
    min: 0,
    max: 0.3,
    step: 0.01,
    advanced: false,
  },
  healthWorkCarryDrainRate: {
    label: 'Carry Drain Rate',
    group: 'Health',
    min: 0,
    max: 0.1,
    step: 0.005,
    advanced: false,
  },
  workerEatNutrition: {
    label: 'Worker Eat Nutrition',
    group: 'Health',
    min: 5,
    max: 100,
    step: 5,
    advanced: false,
  },

  // =====================
  // NEST BEHAVIOR (Core)
  // =====================
  homeDepositIntervalTicks: {
    label: 'Home Deposit Interval (ticks)',
    group: 'Nest Behavior',
    min: 1,
    max: 20,
    step: 1,
    advanced: false,
  },
  homeDepositMinDistance: {
    label: 'Home Deposit Min Distance',
    group: 'Nest Behavior',
    min: 5,
    max: 100,
    step: 5,
    advanced: false,
  },
  momentumBias: {
    label: 'Movement Momentum',
    group: 'Nest Behavior',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: false,
  },
  reversePenalty: {
    label: 'Reverse Penalty',
    group: 'Nest Behavior',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: false,
  },

  // =====================
  // PHEROMONE (Advanced)
  // =====================
  evapFood: {
    label: 'Food Pheromone Evaporation',
    group: 'Pheromone',
    min: 0,
    max: 0.1,
    step: 0.005,
    advanced: true,
  },
  evapHome: {
    label: 'Home Pheromone Evaporation',
    group: 'Pheromone',
    min: 0,
    max: 0.1,
    step: 0.005,
    advanced: true,
  },
  evapDanger: {
    label: 'Danger Pheromone Evaporation',
    group: 'Pheromone',
    min: 0,
    max: 0.2,
    step: 0.01,
    advanced: true,
  },
  diffFood: {
    label: 'Food Pheromone Diffusion',
    group: 'Pheromone',
    min: 0,
    max: 0.1,
    step: 0.005,
    advanced: true,
  },
  diffHome: {
    label: 'Home Pheromone Diffusion',
    group: 'Pheromone',
    min: 0,
    max: 0.3,
    step: 0.01,
    advanced: true,
  },
  diffDanger: {
    label: 'Danger Pheromone Diffusion',
    group: 'Pheromone',
    min: 0,
    max: 0.3,
    step: 0.01,
    advanced: true,
  },
  depositFood: {
    label: 'Food Deposit Rate',
    group: 'Pheromone',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: true,
  },
  depositHome: {
    label: 'Home Deposit Rate',
    group: 'Pheromone',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: true,
  },
  dangerDeposit: {
    label: 'Danger Deposit Rate',
    group: 'Pheromone',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: true,
  },
  pheromoneMaxClamp: {
    label: 'Max Pheromone Concentration',
    group: 'Pheromone',
    min: 50,
    max: 500,
    step: 10,
    advanced: true,
  },

  // =====================
  // QUEEN BEHAVIOR (Advanced)
  // =====================
  queenEggTicks: {
    label: 'Queen Egg Laying Interval (ticks)',
    group: 'Queen',
    min: 5,
    max: 100,
    step: 5,
    advanced: true,
  },
  queenEggFoodCost: {
    label: 'Queen Egg Food Cost',
    group: 'Queen',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: true,
  },
  queenHungerDrain: {
    label: 'Queen Hunger Drain',
    group: 'Queen',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: true,
  },
  queenEatNutrition: {
    label: 'Queen Eat Nutrition',
    group: 'Queen',
    min: 1,
    max: 20,
    step: 1,
    advanced: true,
  },
  queenHealthDrainRate: {
    label: 'Queen Health Drain',
    group: 'Queen',
    min: 1,
    max: 20,
    step: 0.5,
    advanced: true,
  },
  queenHealthRecoveryPerNutrition: {
    label: 'Queen Health Recovery',
    group: 'Queen',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: true,
  },

  // =====================
  // POPULATION (Advanced)
  // =====================
  antCap: {
    label: 'Ant Population Cap',
    group: 'Population',
    min: 100,
    max: 5000,
    step: 100,
    advanced: true,
  },
  soldierSpawnChance: {
    label: 'Soldier Spawn Chance',
    group: 'Population',
    min: 0,
    max: 0.2,
    step: 0.01,
    advanced: true,
  },
};

/**
 * Get all parameters, optionally filtered by advanced flag
 */
export function getParameters(advancedMode = false) {
  return Object.entries(parameterDefinitions)
    .filter(([, def]) => advancedMode || !def.advanced)
    .map(([key, def]) => ({ key, ...def }));
}

/**
 * Get parameters grouped by category
 */
export function getParametersByGroup(advancedMode = false) {
  const params = getParameters(advancedMode);
  const grouped = {};

  params.forEach(param => {
    if (!grouped[param.group]) {
      grouped[param.group] = [];
    }
    grouped[param.group].push(param);
  });

  return grouped;
}

/**
 * Get default values for all parameters from config
 */
export function getDefaultConfig() {
  return {
    tickSeconds: 0.016,
    antCap: 2000,
    evapFood: 0.02,
    evapHome: 0.015,
    evapDanger: 0.08,
    diffFood: 0.02,
    diffHome: 0.18,
    diffDanger: 0.12,
    diffIntervalTicks: 2,
    depositFood: 0.35,
    depositHome: 0.15,
    dangerDeposit: 0.3,
    hazardDeathChance: 0.02,
    foodPickupRate: 0.7,
    digChance: 0.04,
    digEnergyCost: 8,
    digHomeBoost: 0.9,
    queenEggTicks: 20,
    queenEggFoodCost: 0.15,
    queenHungerDrain: 0.25,
    queenEatNutrition: 5,
    queenHealthDrainRate: 7,
    queenHealthRecoveryPerNutrition: 0.25,
    queenFoodRequestHealthThreshold: 0.5,
    queenFoodRequestClearThreshold: 0.8,
    queenFoodRequestHungerThreshold: 0.2,
    queenCourierPickupNutrition: 6,
    broodFoodDrainRate: 0.005,
    broodGestationSeconds: 8,
    broodStarvationTicks: 600,
    workerEatNutrition: 25,
    starvationRecoveryHealth: 5,
    healthDrainRate: 5,
    healthRegenRate: 1,
    healthWorkIdleDrainRate: 0.1,
    healthWorkMoveDrainRate: 0.08,
    healthWorkCarryDrainRate: 0.01,
    healthWorkFightDrainRate: 0.6,
    healthEatRecoveryRate: 0.45,
    workerEmergencyEatNutrition: 35,
    carryingHungerDrainRate: 0.5,
    fightingHungerDrainRate: 3,
    soldierSpawnChance: 0.05,
    foodVisionRadius: 10,
    surfaceFoodSearchMaxMissTicks: 400,
    surfaceReturnToNestHungerThreshold: 0.6,
    followAlpha: 1.5,
    followBeta: 8.0,
    wanderNoise: 0.02,
    randomTurnChance: 0.02,
    momentumBias: 0.3,
    reversePenalty: 0.9,
    homeDepositIntervalTicks: 3,
    homeDepositMinDistance: 20,
    innerScatterRadius: 6,
    nearEntranceScatterRadius: 8,
    foodTrailDistanceScale: 1.0,
    maxFoodTrailScale: 3.0,
    trailLockThreshold: 1.0,
    foodTrailDecayPerStep: 0.92,
    homeScentBaseWeight: 1.0,
    homeScentSearchStateScale: 0.3,
    homeScentReturnStateScale: 1.0,
    homeScentFalloffStartDist: 10,
    homeScentFalloffEndDist: 100,
    homeScentMinFalloff: 0.1,
    homeScentMaxContributionPerStep: 999,
    homeTieBiasScale: 0.05,
    homeTieBiasScaleCarrying: 2.5,
    returnCarryNoiseScale: 0.05,
    returnTrailBoostScale: 0.15,
    returnTrailBoostMax: 3.0,
    foodTieBiasScale: 0.18,
    debugSteeringContributions: false,
    debugSteeringLogIntervalTicks: 30,
    pheromoneMaxClamp: 150,
    walkRho: 0.75,
    walkSigma: 0.05,
    walkMaxTurnRate: 0.45,
    meanderAmplitude: 0.05,
    pTurnSignFlip: 0.85,
    headingBias: 0.20,
    obstacleLookahead: 2,
    obstacleTurnGain: 0.30,
    dangerTurnLookahead: 2,
    dangerTurnGain: 0.40,
  };
}
