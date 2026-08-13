const MOVED_ACTION = Object.freeze({ moved: true, allowFallback: false });
const FAILED_MOVEMENT_ACTION = Object.freeze({ moved: false, allowFallback: true });

export const STAY_ACTION = Object.freeze({ moved: false, allowFallback: false });

export function movementAction(moved) {
  return moved ? MOVED_ACTION : FAILED_MOVEMENT_ACTION;
}
