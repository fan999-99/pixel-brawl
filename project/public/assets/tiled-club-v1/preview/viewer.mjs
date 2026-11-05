import {parseArena, chooseSpawnPoints, chooseDropPoints} from '../source/tiled_adapter.mjs';
const canvas=document.querySelector('#game'), ctx=canvas.getContext('2d');
const manifest=await fetch('../manifest.json').then(r=>r.json());
const physics=await fetch('../physics.json').then(r=>r.json());
const keys=new Set(), cache=new Map(), colors=['#ffd17a','#ef91b2','#8ed5ba','#c4a6f1'];
let state=null, sequence=0, markers=false, overview=false, noticeUntil=0, previous=performance.now(), accumulator=0;
const camera={x:0,y:0}, modeSelect=document.querySelector('#mode');
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function notice(text,seconds=2){document.querySelector('#notice').textContent=text;noticeUntil=performance.now()+seconds*1000;}
function image(url){if(!cache.has(url)){cache.set(url,new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('素材读取失败：'+url));im.src=url;}));}return cache.get(url);}
async function bitmapLayers(map,url){
  const tiles=new Map();
  for(const ref of map.tilesets){
    const tsUrl=new URL(ref.source,url),ts=await fetch(tsUrl).then(r=>r.json());
    if(ts.image){const im=await image(new URL(ts.image,tsUrl).href);for(let i=0;i<ts.tilecount;i++)tiles.set(ref.firstgid+i,{im,sx:i%ts.columns*ts.tilewidth,sy:Math.floor(i/ts.columns)*ts.tileheight,w:ts.tilewidth,h:ts.tileheight});}
    else for(const t of ts.tiles){const im=await image(new URL(t.image,tsUrl).href);tiles.set(ref.firstgid+t.id,{im,sx:0,sy:0,w:im.width,h:im.height});}
  }
  const output=[];
  for(const layer of map.layers){
    if(!layer.visible)continue;
    if(layer.type==='imagelayer'){output.push({image:await image(new URL(layer.image,url).href),px:layer.parallaxx??1,py:layer.parallaxy??1});continue;}
    if(layer.type!=='tilelayer'&&layer.name!=='Scenery')continue;
    const sheet=document.createElement('canvas');sheet.width=map.width*map.tilewidth;sheet.height=map.height*map.tileheight;const g=sheet.getContext('2d');g.imageSmoothingEnabled=false;
    g.globalAlpha=layer.opacity??1;
    const paint=(gid,x,y,w,h)=>{const raw=gid>>>0,t=tiles.get(raw&0x0fffffff);if(!t)throw new Error('未找到图块 '+gid);w??=t.w;h??=t.h;g.save();g.translate(x+w/2,y+h/2);if(raw&0x80000000)g.scale(-1,1);if(raw&0x40000000)g.scale(1,-1);if(raw&0x20000000)g.transform(0,1,1,0,0,0);g.drawImage(t.im,t.sx,t.sy,t.w,t.h,-w/2,-h/2,w,h);g.restore();};
    if(layer.type==='tilelayer')layer.data.forEach((gid,i)=>{if(gid)paint(gid,i%map.width*map.tilewidth,Math.floor(i/map.width)*map.tileheight);});
    else for(const o of [...layer.objects].sort((a,b)=>a.y-b.y||a.id-b.id))if(o.gid)paint(o.gid,o.x,o.y-o.height,o.width,o.height);
    output.push({image:sheet,px:1,py:1});
  }
  return output;
}
function resetPlayer(index=0){
  const p=state.players[index], spawn=state.spawns[index];
  Object.assign(p,{x:spawn.x,y:spawn.y,vx:0,vy:0,grounded:true,jumps:2,drop:0,dash:0,dashCd:0,held:false,face:index%2?-1:1});
  if(index===0){camera.x=clamp(p.x-480,state.bounds.x,state.bounds.x+state.bounds.width-960);camera.y=clamp(p.y-350,0,state.arena.height-540);}
}
async function loadMap(id,mode=modeSelect.value){
  const rev=++sequence, entry=manifest.maps.find(m=>m.id===id);notice('正在读取 '+entry.name,30);
  const url=new URL('../'+entry.map,import.meta.url), map=await fetch(url).then(r=>{if(!r.ok)throw new Error('地图加载失败');return r.json();});
  const arena=parseArena(map), layers=await bitmapLayers(map,url);if(rev!==sequence)return;
  const count=mode==='1v1'?2:4, spawns=chooseSpawnPoints(arena,mode,count);
  const bounds=arena.modeBounds.find(b=>b.props.mode===mode);
  state={entry,arena,layers,mode,spawns,bounds,players:spawns.map((_,i)=>({color:colors[i]})),clock:0,nextWave:15,warnings:[],items:[],rng:1103,previousKeys:new Set(),picked:0};
  state.players.forEach((_,i)=>resetPlayer(i));keys.clear();
  document.querySelector('#title').textContent=entry.name;document.querySelector('#subtitle').textContent=entry.subtitle+' · 2048 × 1024';
  document.querySelector('#fullimage').href='../'+entry.preview;
  document.documentElement.style.setProperty('--map-accent',entry.accent);
  for(const button of document.querySelectorAll('#maps button'))button.setAttribute('aria-pressed',String(button.dataset.map===id));
  document.querySelector('#details').textContent='每15秒空投 '+count+' 件 · 海底保持普通跳跃 · 路线试玩不含战斗与联机';
  notice('你是黄色角色。移动时镜头会跟随你。',3);
}
for(const entry of manifest.maps){const button=document.createElement('button');button.textContent=entry.subtitle.split(' · ')[0];button.title=entry.name;button.setAttribute('aria-label',entry.name);button.dataset.map=entry.id;button.setAttribute('aria-pressed','false');button.onclick=()=>loadMap(entry.id).catch(fail);document.querySelector('#maps').append(button);}
function toggle(name){if(name==='overview')overview=!overview;else markers=!markers;document.querySelector('#'+name).setAttribute('aria-pressed',String(name==='overview'?overview:markers));}
document.querySelector('#overview').onclick=()=>toggle('overview');document.querySelector('#markers').onclick=()=>toggle('markers');
document.querySelector('#respawn').onclick=()=>{resetPlayer();notice('已回到出生点');};
modeSelect.onchange=()=>loadMap(state.entry.id).catch(fail);
addEventListener('keydown',event=>{if(['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName))return;if(['Space','KeyA','KeyD','KeyS','KeyK','KeyF','ArrowLeft','ArrowRight'].includes(event.code)){event.preventDefault();keys.add(event.code);}});
addEventListener('keyup',event=>keys.delete(event.code));addEventListener('blur',()=>keys.clear());
for(const button of document.querySelectorAll('[data-key]')){
  button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);keys.add(button.dataset.key);};
  button.onpointerup=button.onpointercancel=e=>{e.preventDefault();keys.delete(button.dataset.key);};
}
function random(){state.rng=(Math.imul(state.rng,1664525)+1013904223)>>>0;return state.rng/4294967296;}
function prepareWave(){state.warnings=chooseDropPoints(state.arena,state.mode,state.players.length,random).map(point=>({x:point.x,y:point.y,fromY:point.props.spawnY}));notice('补给将在1.5秒后落下',1.5);}
function tick(dt){
  if(!state)return;
  state.clock+=dt;const p=state.players[0],oldY=p.y,oldX=p.x;
  const just=key=>keys.has(key)&&!state.previousKeys.has(key);
  p.drop=Math.max(0,p.drop-dt);p.dash=Math.max(0,p.dash-dt);p.dashCd=Math.max(0,p.dashCd-dt);
  const move=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
  if(move)p.face=move;
  if(just('Space')){
    if(keys.has('KeyS')&&p.grounded&&p.support?.oneWay){p.drop=.26;p.y+=3;p.vy=80;p.grounded=false;}
    else if(p.jumps>0){p.vy=-physics.jumpSpeed*(p.grounded?1:.94);p.jumps--;p.grounded=false;}
  }
  if(just('KeyK')&&p.dashCd===0){p.dash=.14;p.dashCd=3;}
  const goal=move*physics.moveSpeed,accel=move?2400:2100;
  p.vx=p.dash>0?p.face*850:p.vx+clamp(goal-p.vx,-accel*dt,accel*dt);
  p.vy=Math.min(1000,p.vy+physics.gravity*dt);p.x+=p.vx*dt;p.y+=p.vy*dt;p.grounded=false;
  // Full solid rectangles block sides and ceilings; one-way platforms only block descending feet.
  for(const s of state.arena.platforms.filter(s=>!s.oneWay)){
    if(p.y>s.y+2&&p.y-physics.playerHeight<s.y+s.height-2){
      if(oldX+16<=s.x&&p.x+16>s.x)p.x=s.x-16;
      if(oldX-16>=s.x+s.width&&p.x-16<s.x+s.width)p.x=s.x+s.width+16;
    }
    if(p.vy<0&&p.x+16>s.x&&p.x-16<s.x+s.width&&oldY-50>=s.y+s.height&&p.y-50<s.y+s.height){p.y=s.y+s.height+50;p.vy=0;}
  }
  if(p.vy>=0)for(const s of [...state.arena.platforms].sort((a,b)=>a.y-b.y)){
    if(s.oneWay&&p.drop>0)continue;
    if(p.x+16>s.x&&p.x-16<s.x+s.width&&oldY<=s.y+.5&&p.y>=s.y){p.y=s.y;p.vy=0;p.grounded=true;p.jumps=2;p.support=s;break;}
  }
  if(state.mode==='1v1')p.x=clamp(p.x,state.bounds.x+16,state.bounds.x+state.bounds.width-16);
  if(p.y>=1008||p.x<-16||p.x>state.arena.width+16){resetPlayer();notice('掉出地图，已在安全点重生');}
  if(state.clock>=state.nextWave-1.5&&!state.warnings.length)prepareWave();
  if(state.clock>=state.nextWave){state.items.push(...state.warnings.map(w=>({...w,y:w.fromY,vy:0,landed:false,ttl:45})));state.warnings=[];state.nextWave+=15;}
  for(const item of state.items){item.ttl-=dt;if(!item.landed){const before=item.y;item.vy+=physics.gravity*.45*dt;item.y+=item.vy*dt;for(const s of [...state.arena.platforms].sort((a,b)=>a.y-b.y))if(item.x>=s.x&&item.x<=s.x+s.width&&before<=s.y-9&&item.y>=s.y-9){item.y=s.y-9;item.vy=0;item.landed=true;break;}}}
  if(just('KeyF')){const item=state.items.find(item=>Math.hypot(item.x-p.x,item.y-(p.y-15))<65);if(item){state.items.splice(state.items.indexOf(item),1);state.picked++;p.held=true;notice('拾取成功 · 道具落点可达');}}
  state.items=state.items.filter(i=>i.ttl>0&&i.y<1100);
  camera.x=clamp(p.x-480,state.bounds.x,state.bounds.x+state.bounds.width-960);
  camera.y=clamp(p.y-350,0,state.arena.height-540);
  state.previousKeys=new Set(keys);
}
function label(text,x,y,color='#f7e7b6'){ctx.font='14px ClubPixel,monospace';ctx.fillStyle='#18333de0';const width=ctx.measureText(text).width;ctx.fillRect(x-width/2-5,y-15,width+10,21);ctx.fillStyle=color;ctx.textAlign='center';ctx.fillText(text,x,y);}
function character(p,index){
  const x=Math.round(p.x),y=Math.round(p.y),walk=index===0&&Math.abs(p.vx)>15?Math.sin(state.clock*18)*3:0;
  ctx.save();ctx.translate(x,y);ctx.fillStyle='#162f3a';ctx.fillRect(-15,-44,30,36);ctx.fillRect(-12,-12,9,12);ctx.fillRect(3,-12,9,12);
  ctx.fillStyle=p.color;ctx.fillRect(-12,-26,24,16);ctx.fillRect(-17,-24,5,13);ctx.fillRect(12,-24,5,13);
  ctx.fillStyle='#f2d2a0';ctx.fillRect(-10,-43,20,17);ctx.fillStyle=p.color;ctx.fillRect(-13,-47,26,7);ctx.fillRect(-9,-50,18,4);
  ctx.fillStyle='#1b3841';ctx.fillRect(p.face>0?1:-7,-37,3,3);ctx.fillRect(p.face>0?7:-1,-37,3,3);
  ctx.fillStyle='#5d6072';ctx.fillRect(-11,-10+walk,9,8);ctx.fillRect(3,-10-walk,9,8);ctx.fillStyle='#e7d6a6';ctx.fillRect(-13,-3+walk,12,3);ctx.fillRect(3,-3-walk,12,3);
  if(p.held){ctx.fillStyle='#f2c669';ctx.fillRect(18,-24,10,10);ctx.strokeStyle='#8f684b';ctx.strokeRect(18,-24,10,10);}
  ctx.restore();label(index===0?'你':`P${index+1}`,x,y-61,p.color);
}
function render(){
  ctx.imageSmoothingEnabled=false;ctx.fillStyle='#15313b';ctx.fillRect(0,0,960,540);if(!state)return;
  const scale=overview?960/state.arena.width:1,top=overview?(540-state.arena.height*scale)/2:0;
  ctx.save();ctx.translate(0,top);ctx.scale(scale,scale);ctx.translate(overview?0:-Math.round(camera.x),overview?0:-Math.round(camera.y));
  for(const layer of state.layers){ctx.drawImage(layer.image,overview?0:Math.round(camera.x*(1-layer.px)),overview?0:Math.round(camera.y*(1-layer.py)));}
  if(state.mode==='1v1'){
    ctx.fillStyle='#18313a99';ctx.fillRect(0,0,512,1024);ctx.fillRect(1536,0,512,1024);ctx.fillStyle='#b9e7d3';ctx.fillRect(510,250,4,700);ctx.fillRect(1534,250,4,700);
  }
  for(const warning of state.warnings){ctx.fillStyle='#ffde8b';ctx.fillRect(warning.x-14,warning.y-4,28,4);ctx.fillRect(warning.x-2,warning.y-60,4,40);label('空投',warning.x,warning.y-72);}
  for(const item of state.items){const x=Math.round(item.x),y=Math.round(item.y);ctx.fillStyle='#8a634f';ctx.fillRect(x-10,y-10,20,20);ctx.fillStyle='#f8d983';ctx.fillRect(x-8,y-8,16,4);ctx.fillRect(x-2,y-4,4,14);if(!item.landed){ctx.strokeStyle='#c2ded1';ctx.beginPath();ctx.moveTo(x-14,y-26);ctx.lineTo(x-5,y-10);ctx.moveTo(x+14,y-26);ctx.lineTo(x+5,y-10);ctx.stroke();ctx.fillStyle='#cf8d85';ctx.fillRect(x-17,y-30,34,6);}}
  state.players.forEach(character);
  if(markers){
    ctx.lineWidth=2;for(const s of state.arena.platforms){ctx.strokeStyle=s.oneWay?'#8cf0d2':'#ffd58a';ctx.strokeRect(s.x,s.y,s.width,s.height);}
    for(const s of state.spawns){ctx.fillStyle='#91ccff';ctx.fillRect(s.x-4,s.y-5,8,8);label('出生',s.x,s.y-15,'#91ccff');}
    for(const d of state.arena.drops){ctx.strokeStyle='#f2d174';ctx.strokeRect(d.x-5,d.y-11,10,10);}
    ctx.fillStyle='#f3767844';ctx.fillRect(0,1008,2048,16);
  }
  if(overview){ctx.strokeStyle='#fff3c4';ctx.lineWidth=3;ctx.strokeRect(camera.x,camera.y,960,540);}
  ctx.restore();
  if(!overview)for(let i=1;i<state.players.length;i++){
    const p=state.players[i],x=p.x-camera.x,y=p.y-camera.y-35;
    if(x>20&&x<940&&y>20&&y<520)continue;
    const sx=clamp(x,26,934),sy=clamp(y,38,505);ctx.fillStyle=p.color;ctx.beginPath();ctx.moveTo(sx+(x<0?-12:x>960?12:0),sy+(y<0?-12:y>540?12:0));ctx.lineTo(sx-7,sy+7);ctx.lineTo(sx+7,sy+7);ctx.fill();label(`P${i+1}`,sx,sy-12,p.color);
  }
  label(`补给 ${Math.max(0,Math.ceil(state.nextWave-state.clock))}s · ${state.players.length}件`,840,30);
  if(markers)label(`位置 ${Math.round(state.players[0].x)},${Math.round(state.players[0].y)}　镜头 ${Math.round(camera.x)},${Math.round(camera.y)}`,240,30);
  document.querySelector('#notice').style.opacity=performance.now()<noticeUntil?'1':'0';
}
function frame(now){accumulator+=Math.min(.1,(now-previous)/1000);previous=now;while(accumulator>=1/60){tick(1/60);accumulator-=1/60;}render();requestAnimationFrame(frame);}
function fail(error){console.error(error);notice(error.message,100);document.querySelector('#subtitle').textContent='请通过配套启动器使用本机网页地址打开。';}
// Read-only diagnostic state for the map workshop and integration checks.
globalThis.clubMapPreview={getState:()=>state?{map:state.entry.id,mode:state.mode,player:{...state.players[0]},camera:{...camera},clock:state.clock,nextWave:state.nextWave,warnings:state.warnings.length,items:state.items.length,picked:state.picked,world:{width:state.arena.width,height:state.arena.height}}:null};
loadMap('underground').catch(fail);requestAnimationFrame(frame);
