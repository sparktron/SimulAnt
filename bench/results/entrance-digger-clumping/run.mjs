import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const [root, seed, arm, out] = process.argv.slice(2);
const load = p => import(pathToFileURL(root+'/'+p).href);
const {SimulationCore} = await load('src/sim/SimulationCore.js');
const {sanitizeTickConfig} = await load('src/sim/core/SimulationTypes.js');
const {getDefaultConfig} = await load('src/ui/params.js');
const cfg = sanitizeTickConfig({...getDefaultConfig(), exitScentField:arm==='scent'});
const sim = new SimulationCore(seed), w=sim.world;
const stats = {};
const inc = (o,k) => o[k]=(o[k]??0)+1;
for(let t=1;t<=7500;t++){
  sim.update(cfg);
  if(t%5) continue;
  for(const c of [sim.colony,sim.rivalColony]){
    const s=stats[c.id]??={history:new Map(),entrance:{all:0,stalled:0,states:{},statesEmpty:{},examples:[]},dig:{all:0,stalled:0,states:{},statesEmpty:{},examples:[]},hurtOut:{all:0,empty:0},maxLive:0};
    const ants=c.ants.filter(a=>a.alive&&a.role!=='queen');
    s.maxLive=Math.max(s.maxLive,ants.length);
    const dig=new Map(), occ=new Map();
    for(const a of ants){
      const k=w.index(a.x,a.y); occ.set(k,(occ.get(k)??0)+1);
      if(a.y>w.nestY&&a.workFocus==='dig') dig.set(k,(dig.get(k)??0)+1);
    }
    const crowd=(grid,a)=>{let n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(w.inBounds(a.x+dx,a.y+dy))n+=grid.get(w.index(a.x+dx,a.y+dy))??0;return n;};
    for(const a of ants){
      const old=s.history.get(a.id);
      const h=old&&Math.max(Math.abs(a.x-old.x),Math.abs(a.y-old.y))<=1 ? old : {x:a.x,y:a.y,t};
      s.history.set(a.id,h);
      if(t<1000) continue;
      const near=c.nestEntrances.some(e=>Math.max(Math.abs(a.x-e.x),Math.abs(a.y-e.y))<=5);
      const isDig=a.y>w.nestY&&a.workFocus==='dig';
      if(near&&a.workFocus==='forage'&&a.health<a.healthMax*0.5&&a.hunger<=a.hungerMax*0.5){s.hurtOut.all++;if(c.foodStored<=0)s.hurtOut.empty++;}
      for(const [zone,eligible,grid] of [['entrance',near,occ],['dig',isDig,dig]]){
        if(!eligible) continue;
        const z=s[zone]; z.all++;
        if(t-h.t<60) continue;
        const count=crowd(grid,a);
        if(count<3)continue;
        z.stalled++;
        const state=a.state+(a.y>w.nestY?' under':' surface');
        inc(z.states,state);if(c.foodStored<=0)inc(z.statesEmpty,state);
        const front=isDig?c.getActiveDigFrontPosition(a.x,a.y):null;
        if(z.examples.length<8 || t-h.t>z.examples.at(-1).age){
          if(!z.examples.some(e=>e.id===a.id&&e.start===h.t))z.examples.push({id:a.id,start:h.t,t,age:t-h.t,state,focus:a.workFocus,x:a.x,y:a.y,count,food:c.foodStored,front});
          else {const e=z.examples.find(e=>e.id===a.id&&e.start===h.t);Object.assign(e,{t,age:t-h.t,state,focus:a.workFocus,x:a.x,y:a.y,count,food:c.foodStored,front});}
          z.examples.sort((a,b)=>b.age-a.age);z.examples.length=Math.min(z.examples.length,8);
        }
      }
    }
  }
}
for(const s of Object.values(stats))delete s.history;
writeFileSync(out,JSON.stringify({seed,arm,config:cfg,stats})+'\n');
