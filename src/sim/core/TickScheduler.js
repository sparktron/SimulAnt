/**
 * Tick scheduler contract:
 * 1) Macro update (strategic context)
 * 2) Micro update (sense -> decide/act -> resolve/apply)
 *
 * Stable order and monotonic tick progression are mandatory for determinism.
 */
export class TickScheduler {
  constructor({ macroEngine, microEngine }) {
    this.macroEngine = macroEngine;
    this.microEngine = microEngine;
  }

  runTick(context) {
    const { tick, config, foodPellets, nestEntrances } = context;
    if (!Number.isInteger(tick) || tick <= 0) {
      throw new Error(`TickScheduler expected positive integer tick, received: ${tick}`);
    }

    this.macroEngine.update({ tick, config });
    this.microEngine.setExternalState({ foodPellets, nestEntrances });
    this.microEngine.update({ tick, config });
  }
}
