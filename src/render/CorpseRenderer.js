export function drawCorpses(ctx, colony, world, underground) {
  for (const corpse of colony.corpses ?? []) {
    if ((corpse.y > world.nestY) !== underground) continue;
    ctx.fillStyle = corpse.buried ? '#594535' : '#574755';
    ctx.fillRect(corpse.x + 0.18, corpse.y + 0.33, 0.65, 0.36);
  }
  for (const ant of colony.ants) {
    if (ant.carrying?.type !== 'corpse' || (ant.y > world.nestY) !== underground) continue;
    ctx.fillStyle = '#a19098';
    ctx.fillRect(ant.x + 0.75, ant.y + 0.35, 0.48, 0.36);
  }
}
