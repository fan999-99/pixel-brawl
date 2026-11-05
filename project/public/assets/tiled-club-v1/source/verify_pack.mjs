import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArena,chooseSpawnPoints,chooseDropPoints} from './tiled_adapter.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=async filename=>JSON.parse(await fs.readFile(filename,'utf8'));
const manifest=await read(path.join(root,'manifest.json'));
const results=[];
for(const entry of manifest.maps){
 const mapPath=path.join(root,entry.map),map=await read(mapPath),arena=parseArena(map),gids=new Set();
 for(const source of map.tilesets){
  const tsPath=path.resolve(path.dirname(mapPath),source.source),ts=await read(tsPath);
  if(ts.image)await fs.access(path.resolve(path.dirname(tsPath),ts.image));
  for(const tile of ts.tiles||[])if(tile.image)await fs.access(path.resolve(path.dirname(tsPath),tile.image));
  if(ts.columns)for(let i=0;i<ts.tilecount;i++)gids.add(source.firstgid+i);
  else for(const tile of ts.tiles)gids.add(source.firstgid+tile.id);
 }
 const ids=new Set();
 for(const layer of map.layers){
  if(layer.type==='tilelayer'){assert.equal(layer.data.length,128*64);for(const gid of layer.data)assert.ok(!gid||gids.has(gid));}
  if(layer.image)await fs.access(path.resolve(path.dirname(mapPath),layer.image));
  for(const o of layer.objects||[]){assert.ok(!ids.has(o.id));ids.add(o.id);if(o.gid)assert.ok(gids.has(o.gid));}
 }
 assert.equal(arena.width,2048);assert.equal(arena.height,1024);
 for(const [mode,count] of [['1v1',2],['2v2',4],['ffa',4]]){
  const spawns=chooseSpawnPoints(arena,mode,count);assert.equal(spawns.length,count);
  for(const p of spawns)assert.ok(arena.platforms.some(s=>s.y===p.y&&p.x>=s.x+24&&p.x<=s.x+s.width-24));
  for(let trial=0;trial<100;trial++){
   const drops=chooseDropPoints(arena,mode,count);assert.equal(drops.length,count);assert.equal(new Set(drops.map(d=>d.id)).size,count);
   for(const d of drops){const first=arena.platforms.filter(s=>d.x>=s.x&&d.x<=s.x+s.width).sort((a,b)=>a.y-b.y)[0];assert.equal(d.y,first.y);assert.ok(d.props.spawnY<d.y);}
  }
 }
 // Independent fixed-step jump simulation. It detects intervening platforms,
 // rather than accepting geometric reach estimates from the generator.
 function jump(source,target,start,goal,drop=false){
  let x=start,y=source.y+(drop?3:0),vy=drop?80:-770;
  for(let frame=0;frame<140;frame++){
   const old=y;x+=Math.max(-265/60,Math.min(265/60,goal-x));vy+=1720/60;y+=vy/60;
   if(vy>=0){const landing=arena.platforms.filter(s=>!(drop&&frame<16&&s.oneWay)&&x+16>s.x&&x-16<s.x+s.width&&old<=s.y+.5&&y>=s.y).sort((a,b)=>a.y-b.y)[0];if(landing)return landing.id===target.id;}
   if(y>1100)return false;
  }return false;
 }
 const links=[];
 for(const s of arena.platforms)for(const t of arena.platforms){
  if(s===t||Math.abs(s.y-t.y)>230)continue;
  const starts=[s.x+24,s.x+s.width/2,s.x+s.width-24],goals=[];
  for(let x=t.x+24;x<=t.x+t.width-24;x+=32)goals.push(x);
  if(starts.some(start=>goals.some(goal=>jump(s,t,start,goal)||(s.oneWay&&t.y>s.y&&jump(s,t,start,goal,true)))))links.push([s.id,t.id]);
 }
 let reached=new Set([arena.platforms[0].id]);
 for(let i=0;i<arena.platforms.length;i++)for(const [from,to] of links)if(reached.has(from))reached.add(to);
 assert.deepEqual(arena.platforms.filter(s=>!reached.has(s.id)).map(s=>s.id),[],`${entry.id}: an unreachable platform remains`);
 results.push({map:entry.id,relativeAssetsValid:true,uniqueObjectIds:true,modeSpawnChecks:true,dropWavesChecked:300,physicsReachable:reached.size,platforms:arena.platforms.length});
 console.log(`${entry.id}: assets, spawns, 300 airdrop waves and fixed-step jump reachability PASS`);
}
await fs.writeFile(path.join(root,'gameplay-validation.json'),JSON.stringify({physics:{moveSpeed:265,gravity:1720,jumpSpeed:770},maps:results},null,2));
