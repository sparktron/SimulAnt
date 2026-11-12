import { TERRAIN, getDisplayTrailValue } from '../../sim/world.js';
import { classicSkin, drawCarrying } from './classicSkin.js';
import { drawSprite, postProcess } from './skinAssets.js';
const grass = [[74,104,48],[90,122,58],[107,138,74],[122,153,88],[138,172,98]];
const browns = ['#6a3a1a','#784320','#855025','#92592b','#9c6230','#a86a35'];
export const retroSkin = Object.freeze({
  ...classicSkin, name: 'retro', surfaceBackground: '#4a6830', nestBackground: '#3a2410',
  food: '#c02828', horizon: '#d8c997', usesHeading: true,
  surfaceTerrainPixel(terrain, x, y, idx, world, overlays) {
    let hash = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    let c = grass[(hash >>> 0) % 5];
    if (terrain === TERRAIN.WALL) c = world.terrain[idx - world.width] !== TERRAIN.WALL ? [177,179,167] : [112,114,108];
    else if (terrain === TERRAIN.WATER) c = (x * 11 + y * 7) % 19 === 0 ? [113,184,210] : [43,104,148];
    else if (terrain === TERRAIN.HAZARD) c = (x + y) % 2 ? [146,44,34] : [116,34,28];
    let [r,g,b] = c;
    if (overlays.showToFood || overlays.showScent) { const f = Math.min(1,Math.sqrt(getDisplayTrailValue(world, 'food', idx)/6)); r = Math.floor(r*(1-f)+40*f);g=Math.floor(g*(1-f)+220*f);b=Math.floor(b*(1-f)+70*f); }
    if (overlays.showToHome || overlays.showScent) { const f = Math.min(1,Math.sqrt(getDisplayTrailValue(world, 'home', idx)/6)); r = Math.floor(r*(1-f)+55*f);g=Math.floor(g*(1-f)+110*f);b=Math.floor(b*(1-f)+245*f); }
    if (overlays.showDanger) {r=Math.min(255,r+Math.floor(world.danger[idx]*100));g=Math.max(0,g-Math.floor(world.danger[idx]*40));}
    return [r,g,b];
  },
  nestTerrainPixel(terrain, x, y, idx, world, edge) {
    if (terrain === TERRAIN.TUNNEL || terrain === TERRAIN.CHAMBER) return edge ? [233,223,197] : [164,128,80];
    if (y < world.nestY) return [86,111,102];
    if (y === world.nestY) return [107,138,74];
    const n=(x*5+y*9)%7;
    if (terrain === TERRAIN.WATER) return [43,104,148];
    if (terrain === TERRAIN.HAZARD) return [146,44,34];
    return [88+n,59+n,33+n];
  },
  drawFood(ctx,x,y) {ctx.fillStyle='#c02828';ctx.fillRect(x,y,1,1);ctx.fillStyle='#e84040';ctx.fillRect(x,y,0.4,0.3);},
  drawEntrance(ctx, entrance) {
    const radius = Math.min(14, 3 + Math.sqrt(Math.max(0, entrance.soilOnSurface || 0)) * 0.22);
    for (let i=0;i<6;i++) {
      const r=radius*(1-i/8);ctx.fillStyle=browns[i];
      ctx.fillRect(Math.floor(entrance.x-r),Math.floor(entrance.y-r*0.5),Math.ceil(r*2),Math.ceil(r));
    }
    ctx.fillStyle='#201309';ctx.fillRect(entrance.x-1.5,entrance.y-0.6,3,1.6);
    ctx.fillStyle='#c28c4b';ctx.fillRect(entrance.x-radius*0.6,entrance.y-radius*0.3,2,0.5);
  },
  drawAnt(ctx,ant,colony,options) {
    if (options.zoom < 4) {classicSkin.drawAnt(ctx,ant,colony,options);return;}
    const color = options.showAntJobs || ant.state === 'FIGHT' ? options.color : colony.id === 'red' ? (ant.role === 'soldier' ? '#6e140c' : '#a33323') : ant.role === 'soldier' ? '#4a0e0a' : '#2a1808';
    drawSprite(ctx,'retro',color,ant.x,ant.y,options.heading,2.4);
    drawCarrying(ctx,ant);
    if (options.selected) {ctx.strokeStyle='#ffe287';ctx.lineWidth=0.25;ctx.strokeRect(ant.x-0.5,ant.y-0.5,2,2);}
  },
  drawQueen(ctx,x,y,colony) {
    ctx.fillStyle=colony.id === 'red' ? '#9c3522' : '#44240f';
    ctx.fillRect(x-1.6,y-0.6,2,2.2);ctx.fillRect(x+0.4,y,1,1);ctx.fillRect(x+1.4,y-0.3,1.2,1.6);
    ctx.fillStyle='#e6ba5d';ctx.fillRect(x-1,y,0.6,0.6);
  },
  postProcess(ctx,w,h,owner) {postProcess(ctx,w,h,owner,true);},
  minimapPalette: {
    [TERRAIN.GROUND]:[90,122,58],[TERRAIN.WALL]:[112,114,108],[TERRAIN.WATER]:[43,104,148],
    [TERRAIN.HAZARD]:[146,44,34],[TERRAIN.SOIL]:[88,59,33],[TERRAIN.TUNNEL]:[164,128,80],[TERRAIN.CHAMBER]:[233,223,197],
  },
});
