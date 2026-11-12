import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSkin } from '../src/render/skins/index.js';
import { createHash } from 'node:crypto';
import { SurfaceRenderer } from '../src/render/SurfaceRenderer.js';
import { NestRenderer } from '../src/render/NestRenderer.js';
import { TERRAIN } from '../src/sim/world.js';
function context() { return new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}), putImageData(image){this.image=image;}, createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}})}, {get:(o,k)=>k in o?o[k]:()=>{}}); }
globalThis.document={createElement:()=>({getContext:()=>context()})};
const w={width:24,height:24,nestY:8,nestX:12,terrainVersion:1,fieldsVersion:1};
const types=Object.values(TERRAIN); const n=w.width*w.height;
w.terrain=Uint8Array.from({length:n},(_,i)=>types[(i*7+Math.floor(i/24))%types.length]);
w.toFood=Float32Array.from({length:n},(_,i)=>(i%17)/3); w.toHome=Float32Array.from({length:n},(_,i)=>(i%13)/4);w.danger=Float32Array.from({length:n},(_,i)=>(i%7)/10);
w.index=(x,y)=>y*w.width+x; w.inBounds=(x,y)=>x>=0&&y>=0&&x<w.width&&y<w.height;
const colony={ants:[],queen:{alive:false},larvae:[],nestFoodPellets:[]};
const canvas={clientWidth:96,clientHeight:64,getContext:()=>context()};
test('Classic terrain hashes match the pre-theme renderer in both views and scent modes', () => {
const results={};
for(const [name,Renderer] of [['surface',SurfaceRenderer],['nest',NestRenderer]]) {
 for(const [mode,overlays] of [['plain',{}],['scent',{showScent:true,showDanger:true}]]){
 const r=new Renderer(canvas,w);r.draw(colony,overlays,[],[]);
 results[name+'-'+mode]=createHash('sha256').update(r._offCtx.image.data).digest('hex');
 }
}
assert.deepEqual(results, {
  'surface-plain':'4ad8d736f0d39c822a6c3c8720e81d208abbe78a493d065974f524e02e6adb9c',
  'surface-scent':'bf8fbf69b99eedd5615dcfd2cf46805e2701f450eaabec5c58e76fa23ff2cf37',
  'nest-plain':'5cf25f38e7e5e2c4afe03728b43113b5304dc7964efb84eb0d9db62cf0a7e280',
  'nest-scent':'5cf25f38e7e5e2c4afe03728b43113b5304dc7964efb84eb0d9db62cf0a7e280',
});
});
test('theme switches invalidate terrain without replacing world or camera state', () => {
  for (const Renderer of [SurfaceRenderer,NestRenderer]) {
    const r=new Renderer(canvas,w);
    r.draw(colony,{},[],[]);
    const camera=[r.cameraX,r.cameraY,r.zoom];
    for(const theme of ['retro','modern','nineties','realistic','classic']) {
      r._terrainCacheKey='old';r.setSkin(theme);
      assert.equal(r._terrainCacheKey,'');assert.equal(r.world,w);
      assert.deepEqual([r.cameraX,r.cameraY,r.zoom],camera);
      r.draw(colony,{showScent:true},[],[]);
    }
  }
});
test('renderer skins do not write heading, sprite, or job caches onto ants', () => {
  const ant=Object.freeze({x:3,y:4,id:9,role:'worker',state:'FORAGE_SEARCH'});
  for(const name of ['classic','retro','modern','nineties','realistic']) {
    const renderer=new SurfaceRenderer(canvas,w);renderer.setSkin(name);
    const before=JSON.stringify(ant);
    renderer.heading(ant);
    getSkin(name).drawAnt(context(),ant,{id:'black'}, {color:'#ffd700',showAntJobs:true,selected:true,heading:0.5,zoom:5});
    assert.equal(JSON.stringify(ant),before);
  }
});
test('every pre-existing DOM ID and tool radio is preserved', () => {
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const required=["viewToggleBtn", "colonyStatusBtn", "startPauseBtn", "stepBtn", "healthYellow", "healthFocusLabel", "healthBlack", "healthRed", "seedInput", "brushLabel", "brushSlider", "speedLabel", "speedSlider", "antCapLabel", "antCapSlider", "resetBtn", "saveBtn", "loadBtn", "clearBtn", "scentBtn", "jobsBtn", "pheromoneBtn", "helpBtn", "downloadLogBtn", "modeIndicator", "jobLegend", "simCanvas", "statsTabBtn", "paramsTabBtn", "statsView", "minimapCanvas", "hudTick", "hudAnts", "hudAntLocation", "hudRedAnts", "hudFood", "hudBootstrapFood", "hudWorkers", "hudSoldiers", "hudNurses", "hudForagers", "hudDiggers", "hudJobs", "hudQueenHealth", "hudFps", "hudDig", "hudPherMax", "hudPherAvg", "hudFollow", "hudHealthStats", "hudDeaths", "hudDeathsByCause", "paramsView", "parameterEditorContainer", "helpPanel", "helpTitle", "closeHelpBtn", "statusPanel", "statusTitle", "closeStatusBtn", "workTriangleContainer", "casteTriangleContainer", "persistenceStatus", "versionLabel"];
  const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length,'IDs must be unique');
  for(const id of required) assert.ok(ids.includes(id),`Missing ${id}`);
  assert.equal([...html.matchAll(/name="tool"/g)].length,7);
});

const ALL_SKINS=['classic','retro','modern','nineties','realistic'];
test('every skin exposes the full renderer interface', () => {
  const fns=['surfaceTerrainPixel','nestTerrainPixel','surfaceAlpha','drawAnt','drawQueen','drawEntrance','drawFields','postProcess'];
  for(const name of ALL_SKINS) {
    const skin=getSkin(name);
    assert.equal(skin.name,name);
    assert.ok(Object.isFrozen(skin),`${name} frozen`);
    for(const fn of fns) assert.equal(typeof skin[fn],'function',`${name}.${fn}`);
    for(const key of ['surfaceBackground','nestBackground','horizon','food','minimapAntColor','minimapViewport']) assert.equal(typeof skin[key],'string',`${name}.${key}`);
    for(const key of ['usesHeading','fieldsInTerrain']) assert.equal(typeof skin[key],'boolean',`${name}.${key}`);
    for(const fn of ['drawFood','drawLarva','preProcess','composeTerrain']) assert.ok(skin[fn]===undefined||typeof skin[fn]==='function',`${name}.${fn}`);
  }
  assert.equal(getSkin('nineties').usesHeading,true);
  assert.equal(getSkin('realistic').usesHeading,true);
});
test('getSkin returns the new skins and still rejects unknown names', () => {
  assert.equal(getSkin('nineties').name,'nineties');
  assert.equal(getSkin('realistic').name,'realistic');
  for(const bad of ['unknown','Nineties','__proto__','toString']) assert.throws(()=>getSkin(bad),RangeError);
});
test('new skins return in-range RGB for every terrain type, with and without overlays', () => {
  for(const name of ['nineties','realistic']) {
    const skin=getSkin(name);
    for(const overlays of [{},{showScent:true,showDanger:true},{showToFood:true},{showToHome:true}]) {
      for(let y=0;y<w.height;y++) for(let x=0;x<w.width;x++) {
        const i=y*w.width+x;
        const s=[...skin.surfaceTerrainPixel(w.terrain[i],x,y,i,w,overlays)];
        const n=[...skin.nestTerrainPixel(w.terrain[i],x,y,i,w,x%3===0)];
        for(const v of [...s,...n]) assert.ok(Number.isFinite(v)&&v>=-1&&v<=256,`${name} ${x},${y} -> ${v}`);
      }
    }
  }
});
test('new skins are pure: same world gives the same terrain bitmap twice', () => {
  for(const name of ['nineties','realistic']) for(const Renderer of [SurfaceRenderer,NestRenderer]) {
    const hashes=[];
    for(let k=0;k<2;k++) {
      const r=new Renderer(canvas,w);r.setSkin(name);r.draw(colony,{showScent:true},[],[]);
      hashes.push(createHash('sha256').update(r._offCtx.image.data).digest('hex'));
    }
    assert.equal(hashes[0],hashes[1],`${name} ${Renderer.name}`);
  }
});
test('new skins keep purple for duels: FIGHT ants are drawn with the duel colour', () => {
  for(const name of ['nineties','realistic']) {
    const used=[];
    const ctx=new Proxy({},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>{if(k==='fillStyle')used.push(v);o[k]=v;return true;}});
    getSkin(name).drawAnt(ctx,{x:3,y:3,id:1,role:'worker',state:'FIGHT'},{id:'black'},{color:'#b44cff',showAntJobs:false,selected:false,heading:0,zoom:8});
    const atlasColours=[];
    // nineties bakes the colour into its atlas; realistic paints a halo directly.
    if(name==='realistic') assert.ok(used.includes('#b44cff'),'realistic halo uses duel colour');
    else {
      globalThis.document={createElement:()=>({getContext:()=>new Proxy({},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>{if(k==='fillStyle')atlasColours.push(v);o[k]=v;return true;}})})};
      getSkin(name).drawAnt(ctx,{x:3,y:3,id:2,role:'soldier',state:'FIGHT'},{id:'red'},{color:'#b44cff',showAntJobs:false,selected:false,heading:1,zoom:8});
      assert.ok(atlasColours.includes('#b44cff'),'nineties sprite body uses duel colour');
      globalThis.document={createElement:()=>({getContext:()=>context()})};
    }
  }
  // Neither skin uses purple for anything else (normal colony, queen, larvae).
  for(const name of ['nineties','realistic']) {
    const src=readFileSync(new URL(`../src/render/skins/${name}Skin.js`,import.meta.url),'utf8');
    assert.doesNotMatch(src,/#(b44cff|7b3fc9|9a5aff|800080|aa00aa|ff55ff)/i);
  }
});
