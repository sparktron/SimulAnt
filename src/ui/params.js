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
    description: 'How much ants remember previous direction. Higher = smoother paths, Lower = more erratic wandering.',
    group: 'Movement',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: false,
  },
  walkSigma: {
    label: 'Movement Noise (σ)',
    description: 'Random noise added to turning. Higher = twitchier, more chaotic movement. Lower = smoother arcs.',
    group: 'Movement',
    min: 0,
    max: 0.2,
    step: 0.01,
    advanced: false,
  },
  walkMaxTurnRate: {
    label: 'Max Turn Rate',
    description: 'Maximum turning angle per tick. Higher = sharper turns, can navigate tight spaces. Lower = wider turns.',
    group: 'Movement',
    min: 0.1,
    max: 1,
    step: 0.05,
    advanced: false,
  },
  meanderAmplitude: {
    label: 'Meander Amplitude',
    description: 'Strength of wandering bias. Higher = ants wander more in one direction. Lower = random walk.',
    group: 'Movement',
    min: 0,
    max: 0.2,
    step: 0.01,
    advanced: false,
  },
  pTurnSignFlip: {
    label: 'Meander Persistence',
    description: 'Probability meander direction persists. Higher = ants keep circling same way. Lower = random meander.',
    group: 'Movement',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: false,
  },
  headingBias: {
    label: 'Heading Bias',
    description: 'Tendency to maintain heading when following pheromone. Higher = straighter trails, Lower = more curves.',
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
    description: 'How strongly ants respond to pheromone presence. Higher = more sensitive, harder to ignore trails.',
    group: 'Decision-Making',
    min: 0,
    max: 5,
    step: 0.1,
    advanced: false,
  },
  followBeta: {
    label: 'Follow Strength (β)',
    description: 'How much pheromone influences turning direction. Higher = ants stick tightly to trails, less exploration.',
    group: 'Decision-Making',
    min: 0,
    max: 20,
    step: 0.5,
    advanced: false,
  },
  foodVisionRadius: {
    label: 'Food Vision Radius',
    description: 'How far ants can see food. Higher = detect food from farther away, faster foraging. Lower = local search.',
    group: 'Decision-Making',
    min: 1,
    max: 100,
    step: 1,
    advanced: false,
  },
  surfaceFoodSearchMaxMissTicks: {
    label: 'Food Search Timeout (ticks)',
    description: 'How long foragers search before giving up. Higher = longer foraging, may find more distant food.',
    group: 'Decision-Making',
    min: 50,
    max: 1000,
    step: 50,
    advanced: false,
  },
  surfaceReturnToNestHungerThreshold: {
    label: 'Return to Nest Threshold',
    description: 'Hunger level that triggers return to nest. Higher = ants return more hungry, risk starvation. Lower = frequent returns.',
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
    description: 'How far ahead ants check for walls. Higher = detect walls earlier, avoid collisions better. Lower = bumpy navigation.',
    group: 'Obstacle Avoidance',
    min: 1,
    max: 5,
    step: 0.5,
    advanced: false,
  },
  obstacleTurnGain: {
    label: 'Obstacle Turn Gain',
    description: 'How hard ants turn to avoid walls. Higher = sharp avoidance, smoother tunnels. Lower = may bump into walls.',
    group: 'Obstacle Avoidance',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: false,
  },
  dangerTurnLookahead: {
    label: 'Danger Lookahead (tiles)',
    description: 'How far ants sense danger pheromone ahead. Higher = avoid hazards sooner, safer. Lower = risky behavior.',
    group: 'Obstacle Avoidance',
    min: 1,
    max: 5,
    step: 0.5,
    advanced: false,
  },
  dangerTurnGain: {
    label: 'Danger Turn Gain',
    description: 'How aggressively ants avoid danger pheromone. Higher = strong avoidance, few casualties. Lower = risk-takers.',
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
    description: 'Base health loss per tick. Higher = ants die faster, colony under pressure. Lower = forgiving, ants survive longer.',
    group: 'Health',
    min: 0,
    max: 20,
    step: 0.5,
    advanced: false,
  },
  healthRegenRate: {
    label: 'Health Regen Rate',
    description: 'Health recovered per tick when idle. Higher = healing fast, ants recover. Lower = healing is slow.',
    group: 'Health',
    min: 0,
    max: 5,
    step: 0.1,
    advanced: false,
  },
  healthWorkMoveDrainRate: {
    label: 'Movement Drain Rate',
    description: 'Extra health lost while moving. Higher = moving exhausts ants, limits travel distance. Lower = cheap movement.',
    group: 'Health',
    min: 0,
    max: 0.3,
    step: 0.01,
    advanced: false,
  },
  healthWorkCarryDrainRate: {
    label: 'Carry Drain Rate',
    description: 'Extra health lost when carrying food. Higher = carrying is exhausting, limits foraging trips. Lower = cheap transport.',
    group: 'Health',
    min: 0,
    max: 0.1,
    step: 0.005,
    advanced: false,
  },
  workerEatNutrition: {
    label: 'Worker Eat Nutrition',
    description: 'Nutrition restored when worker eats food. Higher = one meal sustains longer, fewer hungry ants. Lower = frequent feeding needed.',
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
    description: 'How often ants deposit home pheromone while returning. Higher = sparse trail, Lower = dense home scent highway.',
    group: 'Nest Behavior',
    min: 1,
    max: 20,
    step: 1,
    advanced: false,
  },
  homeDepositMinDistance: {
    label: 'Home Deposit Min Distance',
    description: 'Minimum distance from nest before dropping home pheromone. Higher = less pheromone near nest, Lower = dense inner trails.',
    group: 'Nest Behavior',
    min: 5,
    max: 100,
    step: 5,
    advanced: false,
  },
  momentumBias: {
    label: 'Movement Momentum',
    description: 'How much ants prefer continuing forward vs turning. Higher = straight paths, Lower = more turns, explores more.',
    group: 'Nest Behavior',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: false,
  },
  reversePenalty: {
    label: 'Reverse Penalty',
    description: 'Penalty for turning 180°. Higher = ants rarely back-up, forward-biased, Lower = flexible turning.',
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
    description: 'How fast food trails decay. Higher = trails fade quickly, forces re-foraging. Lower = stale trails persist, can confuse ants.',
    group: 'Pheromone',
    min: 0,
    max: 0.1,
    step: 0.005,
    advanced: true,
  },
  evapHome: {
    label: 'Home Pheromone Evaporation',
    description: 'How fast home scent fades. Higher = home smell disappears quickly, ants lose way. Lower = persistent wayfinding.',
    group: 'Pheromone',
    min: 0,
    max: 0.1,
    step: 0.005,
    advanced: true,
  },
  evapDanger: {
    label: 'Danger Pheromone Evaporation',
    description: 'How fast danger warnings fade. Higher = hazards quickly forgotten. Lower = ants remember dangers long-term.',
    group: 'Pheromone',
    min: 0,
    max: 0.2,
    step: 0.01,
    advanced: true,
  },
  diffFood: {
    label: 'Food Pheromone Diffusion',
    description: 'How far food trails spread. Higher = broader trails, easier to follow but less precise. Lower = narrow trails.',
    group: 'Pheromone',
    min: 0,
    max: 0.1,
    step: 0.005,
    advanced: true,
  },
  diffHome: {
    label: 'Home Pheromone Diffusion',
    description: 'How far home scent spreads. Higher = wide guidance zones, easier navigation. Lower = narrow home corridors.',
    group: 'Pheromone',
    min: 0,
    max: 0.3,
    step: 0.01,
    advanced: true,
  },
  diffDanger: {
    label: 'Danger Pheromone Diffusion',
    description: 'How far danger warnings spread. Higher = large danger zones, safer. Lower = hazard danger zones.',
    group: 'Pheromone',
    min: 0,
    max: 0.3,
    step: 0.01,
    advanced: true,
  },
  depositFood: {
    label: 'Food Deposit Rate',
    description: 'Strength of food trail laid by foragers. Higher = strong trails, easy to follow. Lower = weak signals.',
    group: 'Pheromone',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: true,
  },
  depositHome: {
    label: 'Home Deposit Rate',
    description: 'Strength of home scent laid by returning ants. Higher = strong homing signals. Lower = weak guidance.',
    group: 'Pheromone',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: true,
  },
  dangerDeposit: {
    label: 'Danger Deposit Rate',
    description: 'Strength of danger pheromone deposited near hazards. Higher = strong warnings. Lower = weak hazard signals.',
    group: 'Pheromone',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: true,
  },
  pheromoneMaxClamp: {
    label: 'Max Pheromone Concentration',
    description: 'Maximum intensity of pheromone trails. Prevents trails from becoming too overwhelming or overriding other signals.',
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
    description: 'How often queen lays eggs. Higher = slower population growth, smaller colony. Lower = rapid breeding.',
    group: 'Queen',
    min: 5,
    max: 100,
    step: 5,
    advanced: true,
  },
  queenEggFoodCost: {
    label: 'Queen Egg Food Cost',
    description: 'Food nutrition consumed per egg laid. Higher = expensive reproduction, constrains growth. Lower = cheap breeding.',
    group: 'Queen',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: true,
  },
  queenEggHealthCost: {
    label: 'Queen Egg Health Cost',
    description: 'Queen health spent per egg laid. Higher = queen tires faster when laying; pairs with health-scaled lay rate to self-limit.',
    group: 'Queen',
    min: 0,
    max: 2,
    step: 0.01,
    advanced: true,
  },
  queenLayingMinHealth: {
    label: 'Queen Min Health to Lay',
    description: 'Queen stops laying eggs below this health fraction (0–1). Gives her a chance to recover before resuming.',
    group: 'Queen',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: true,
  },
  queenHungerDrain: {
    label: 'Queen Hunger Drain',
    description: 'Queen hunger penalty per tick. Higher = queen starves fast, needs constant feeding. Lower = patient queen.',
    group: 'Queen',
    min: 0,
    max: 1,
    step: 0.05,
    advanced: true,
  },
  queenEatNutrition: {
    label: 'Queen Eat Nutrition',
    description: 'Nutrition queen gains per feeding. Higher = one meal sustains long. Lower = queen needs frequent meals.',
    group: 'Queen',
    min: 1,
    max: 20,
    step: 1,
    advanced: true,
  },
  queenHealthDrainRate: {
    label: 'Queen Health Drain',
    description: 'Queen health loss per tick. Higher = queen dies quickly if unfed. Lower = robust queen.',
    group: 'Queen',
    min: 1,
    max: 20,
    step: 0.5,
    advanced: true,
  },
  queenHealthRecoveryPerNutrition: {
    label: 'Queen Health Recovery',
    description: 'Health restored per nutrition fed to queen. Higher = feeding heals well. Lower = minimal healing effect.',
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
    description: 'Maximum number of ants alive. Higher = larger colony possible. Lower = constrained population growth.',
    group: 'Population',
    min: 100,
    max: 5000,
    step: 100,
    advanced: true,
  },
  soldierSpawnChance: {
    label: 'Soldier Spawn Chance',
    description: 'Chance newly laid eggs become soldiers vs workers. Higher = more soldiers, more defense. Lower = mostly workers.',
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
    tickSeconds: 1 / 30,
    antCap: 2000,
    evapFood: 0.15,
    evapHome: 0.015,
    evapDanger: 0.08,
    diffFood: 0.02,
    diffHome: 0.18,
    diffDanger: 0.12,
    diffIntervalTicks: 2,
    depositFood: 0.5,
    depositHome: 0.15,
    dangerDeposit: 0.3,
    hazardDeathChance: 0.02,
    foodPickupRate: 0.7,
    digChance: 0.04,
    digEnergyCost: 8,
    digHomeBoost: 0.9,
    queenEggTicks: 20,
    queenEggFoodCost: 0.02,
    queenEggHealthCost: 0.05,
    queenLayingMinHealth: 0.2,
    trophallaxisRate: 2.0,
    trophallaxisDonorMinHungerFraction: 0.6,
    trophallaxisRecipientMaxHungerFraction: 0.4,
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
    larvaeCrowdingThreshold: 8,
    workerEatNutrition: 25,
    starvationRecoveryHealth: 5,
    healthDrainRate: 5,
    healthRegenRate: 1,
    healthWorkIdleDrainRate: 0.03,
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
    foodDepositMinDistance: 8,
    maxFoodTrailScale: 2.5,
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
    foodTieBiasScale: 0.1,
    debugSteeringContributions: false,
    debugSteeringLogIntervalTicks: 30,
    pheromoneMaxClamp: 150,
    enablePheromones: true,
    walkRho: 0.75,
    walkSigma: 0.05,
    walkMaxTurnRate: 0.45,
    meanderAmplitude: 0.05,
    pTurnSignFlip: 0.85,
    headingBias: 0.40,
    obstacleLookahead: 2,
    obstacleTurnGain: 0.30,
    dangerTurnLookahead: 2,
    dangerTurnGain: 0.40,
  };
}
