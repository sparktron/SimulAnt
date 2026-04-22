export function isInNestSpatial(world, x, y) {
  if (!world || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  return world.isBelowSurface(x, y);
}
