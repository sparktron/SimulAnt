import { TERRAIN, getDisplayTrailValue } from '../../sim/world.js';
import { classicSkin } from './classicSkin.js';
import { drawSprite, polygon, postProcess } from './skinAssets.js';
const fields = new WeakMap(), backgrounds = new WeakMap(), entrances = new WeakMap();
let foodSprite;
function glowPod(ctx,x,y) {
  if (!foodSprite) {
    foodSprite=document.createElement('canvas');foodSprite.width=48;foodSprite.height=48;
    const c=foodSprite.getContext('2d'),g=c.createRadialGradient(24,24,1,24,24,23);
    g.addColorStop(0,'rgba(167,229,94,0.22)');g.addColorStop(1,'rgba(167,229,94,0)');
    c.fillStyle=g;c.fillRect(0,0,48,48);c.fillStyle='#b3e878';polygon(c,24,24,6,4);c.fill();
  }
  ctx.drawImage(foodSprite,x-0.8,y-0.8,2.6,2.6);
}
export const modernSkin = Object.freeze({
  ...classicSkin,name:'modern',surfaceBackground:'#0f1a1f',nestBackground:'#0c0f12',
  horizon:'#82b96c',food:'#b3e878',
  usesHeading:true,fieldsInTerrain:false,minimapAntColor:'#9ccd7f',minimapViewport:'#acbcc9',
  surfaceAlpha(terrain) {return terrain === TERRAIN.GROUND || terrain === TERRAIN.SOIL || terrain === TERRAIN.TUNNEL ? 95 : 255;},
  preProcess(ctx,w,h,owner) {
    let cached=backgrounds.get(owner);
    if (!cached || cached.width!==Math.ceil(w) || cached.height!==Math.ceil(h)) {
      const c=document.createElement('canvas');c.width=Math.ceil(w);c.height=Math.ceil(h);const b=c.getContext('2d');
      const g=b.createRadialGradient(w*.5,h*.4,0,w*.5,h*.4,Math.max(w,h)*.7);
      g.addColorStop(0,'#0f1a1f');g.addColorStop(1,'#05080a');b.fillStyle=g;b.fillRect(0,0,w,h);
      b.strokeStyle='rgba(120,200,160,0.055)';b.lineWidth=0.6;
      for(let y=0;y<h+24;y+=31) for(let x=0;x<w+24;x+=36) {polygon(b,x+(Math.round(y/31)%2)*18,y,20);b.stroke();}
      cached=c;backgrounds.set(owner,c);
    }
    ctx.drawImage(cached,0,0,w,h);
  },
  surfaceTerrainPixel(terrain,x,y,idx,world) {
    if (terrain===TERRAIN.WALL) return world.terrain[idx-world.width]!==TERRAIN.WALL ? [85,96,109] : [47,55,65];
    if (terrain===TERRAIN.WATER) return (x+y)%5===0 ? [42,105,134] : [25,76,107];
    if (terrain===TERRAIN.HAZARD) return (x+y)%4===0 ? [143,57,62] : [74,30,39];
    return [13,24,28];
  },
  nestTerrainPixel(terrain,x,y,idx,world,edge) {
    if (terrain===TERRAIN.TUNNEL || terrain===TERRAIN.CHAMBER) return edge ? [65,91,79] : [35,44,51];
    if (y<world.nestY) return [12,24,29];
    if (y===world.nestY) return [90,137,91];
    if (terrain===TERRAIN.WATER) return [25,76,107];
    if (terrain===TERRAIN.HAZARD) return [99,34,44];
    const band=Math.floor(y/12)%3;return [12+band,15+band,18+band];
  },
  drawFields(ctx,world,overlays,owner) {
    const food=!!(overlays.showToFood||overlays.showScent), home=!!(overlays.showToHome||overlays.showScent),danger=!!overlays.showDanger;
    if (!food&&!home&&!danger) return;
    const key=`${world.fieldsVersion}|${food}|${home}|${danger}`;
    let cached=fields.get(owner);
    if (!cached || cached.key!==key || cached.world!==world) {
      const c=cached?.canvas || document.createElement('canvas');c.width=world.width;c.height=world.nestY+1;
      const b=c.getContext('2d'),image=b.createImageData(c.width,c.height),d=image.data;
      for(let i=0;i<c.width*c.height;i++) {
        const f=food?Math.min(1,Math.sqrt(getDisplayTrailValue(world, 'food', i)/6)):0,h=home?Math.min(1,Math.sqrt(getDisplayTrailValue(world, 'home', i)/6)):0,v=danger?Math.min(1,world.danger[i]):0;
        d[i*4]=50*f+55*h+230*v;d[i*4+1]=215*f+100*h+40*v;d[i*4+2]=90*f+245*h+70*v;d[i*4+3]=Math.min(210,(f+h+v)*160);
      }
      b.putImageData(image,0,0);cached={key,world,canvas:c};fields.set(owner,cached);
    }
    ctx.save();ctx.globalCompositeOperation='lighter';ctx.imageSmoothingEnabled=true;ctx.drawImage(cached.canvas,0,0);ctx.restore();
  },
  drawFood:glowPod,
  drawEntrance(ctx,entrance,colonyId) {
    const radius=Math.min(14,4+Math.sqrt(Math.max(0,entrance.soilOnSurface||0))*.22);
    const key=`${Math.round(radius*4)}|${colonyId}`;let cached=entrances.get(entrance);
    if (!cached || cached.key!==key) {
      const c=document.createElement('canvas');c.width=160;c.height=160;const b=c.getContext('2d');
      const color=colonyId==='red'?'#d46868':'#c58b55';
      const g=b.createRadialGradient(80,80,3,80,80,70);g.addColorStop(0,colonyId==='red'?'rgba(189,71,78,.4)':'rgba(197,139,85,.35)');g.addColorStop(1,'transparent');b.fillStyle=g;b.fillRect(0,0,160,160);
      b.strokeStyle=color;b.lineWidth=0.5;b.globalAlpha=.18;
      for(let ring=0;ring<5;ring++) {b.beginPath();for(let i=0;i<=80;i++){const a=i/80*Math.PI*2,r=38+ring*7+Math.sin(a*5+ring)*2;const x=80+Math.cos(a)*r,y=80+Math.sin(a)*r*.7;if(i===0)b.moveTo(x,y);else b.lineTo(x,y);}b.stroke();}
      b.globalAlpha=1;b.fillStyle='#30251e';polygon(b,80,80,29);b.fill();b.strokeStyle=color;b.lineWidth=1.5;b.stroke();
      for(const r of [21,13]) {b.globalAlpha=.6;polygon(b,80,80,r);b.stroke();}
      b.globalAlpha=1;b.fillStyle='#090e11';polygon(b,80,80,8);b.fill();
      cached={key,canvas:c};entrances.set(entrance,cached);
    }
    const size=radius*5;ctx.drawImage(cached.canvas,entrance.x-size/2,entrance.y-size/2,size,size);
  },
  drawAnt(ctx,ant,colony,options) {
    const color=options.showAntJobs||ant.state==='FIGHT'?options.color:colony.id==='red'?(ant.role==='soldier'?'#9e2430':'#df7378'):ant.role==='soldier'?'#a0403a':'#c7d7df';
    drawSprite(ctx,'modern',color,ant.x,ant.y,options.heading);
    const type=ant.carryingType || ant.carrying?.type;
    if(type==='food'||type==='dirt') {ctx.fillStyle=type==='food'?'#b3e878':'#b48b62';ctx.beginPath();ctx.arc(ant.x+.5+Math.cos(options.heading)*.7,ant.y+.5+Math.sin(options.heading)*.7,.23,0,Math.PI*2);ctx.fill();}
    if(options.selected) {ctx.save();ctx.strokeStyle='#9ccd7f';ctx.lineWidth=.18;ctx.setLineDash([.4,.3]);ctx.beginPath();ctx.arc(ant.x+.5,ant.y+.5,1.4,0,Math.PI*2);ctx.stroke();ctx.restore();}
  },
  drawLarva(ctx,x,y,r) {ctx.fillStyle='#8cd8d7';ctx.beginPath();ctx.ellipse(x+.5,y+.5,r*.6,r,Math.PI/4,0,Math.PI*2);ctx.fill();},
  drawQueen(ctx,x,y,colony) {
    const color=colony.id==='red'?'#df7378':'#9ccd7f';ctx.fillStyle='#1b302c';ctx.strokeStyle=color;ctx.lineWidth=.25;
    polygon(ctx,x+.5,y+.5,2.2);ctx.fill();ctx.stroke();
    ctx.fillStyle=color;polygon(ctx,x+.5,y+.5,.75+Math.sin(performance.now()/700)*.1);ctx.fill();
  },
  postProcess(ctx,w,h,owner) {postProcess(ctx,w,h,owner);},
  minimapPalette:{[TERRAIN.GROUND]:[18,35,39],[TERRAIN.WALL]:[65,73,84],[TERRAIN.WATER]:[25,76,107],[TERRAIN.HAZARD]:[99,34,44],[TERRAIN.SOIL]:[12,15,18],[TERRAIN.TUNNEL]:[45,64,59],[TERRAIN.CHAMBER]:[69,91,74]},
});
