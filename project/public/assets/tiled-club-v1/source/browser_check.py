"""Exercise the browser map workshop through its UI and keyboard events."""
import json, pathlib, subprocess, time
ROOT=pathlib.Path(__file__).resolve().parents[1]
CLI=pathlib.Path.home()/'.codex/tools/node-v24.22.1-win-x64/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
SESSION='club-maps-20261102'
def cli(*args):
    r=subprocess.run([str(CLI),'--session',SESSION,*args],capture_output=True,text=True,encoding='utf-8',timeout=55)
    if r.returncode:raise RuntimeError((args,r.stdout,r.stderr))
    return r.stdout.strip()
def js(expression):return json.loads(cli('eval',expression))
def waitmap(name):
    for _ in range(50):
        result=js('globalThis.clubMapPreview?.getState() ?? null')
        if result and result['map']==name:return result
        time.sleep(.1)
    raise RuntimeError('Map load timeout '+name)
cli('open','http://127.0.0.1:8127/preview/index.html');waitmap('underground');cli('errors','--clear')
input_test=js("""(async()=>{
 const key=(kind,code)=>dispatchEvent(new KeyboardEvent(kind,{code,bubbles:true}));
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const before=clubMapPreview.getState();
 key('keydown','KeyD');await wait(900);key('keydown','Space');await wait(100);key('keyup','Space');await wait(300);key('keyup','KeyD');
 const after=clubMapPreview.getState();
 if(after.player.x<before.player.x+240||after.camera.x<=0||after.player.y>=before.player.y-60)throw Error('Movement/jump/camera did not respond');
 return {moveDistance:after.player.x-before.player.x,jumpRise:before.player.y-after.player.y,cameraX:after.camera.x};
})()""")
print('movement / jump / local camera PASS',input_test,flush=True)
cli('click','#respawn')
drop_test=js("""(async()=>{
 const key=(kind,code)=>dispatchEvent(new KeyboardEvent(kind,{code,bubbles:true}));const wait=ms=>new Promise(r=>setTimeout(r,ms));
 key('keydown','Space');await wait(100);key('keyup','Space');await wait(800);
 const top=clubMapPreview.getState();if(!top.player.support?.oneWay)throw Error('Did not reach one-way platform');
 key('keydown','KeyS');key('keydown','Space');await wait(80);key('keyup','Space');key('keyup','KeyS');await wait(450);
 const bottom=clubMapPreview.getState();if(bottom.player.y<=top.player.y+80)throw Error('Drop-through failed');
 key('keydown','KeyK');await wait(180);key('keyup','KeyK');const dash=clubMapPreview.getState();
 if(dash.player.x-bottom.player.x<80||dash.player.dashCd<2)throw Error('Dash failed');
 return {topY:top.player.y,bottomY:bottom.player.y,dashDistance:dash.player.x-bottom.player.x};
})()""")
print('one-way drop / dash PASS',drop_test,flush=True)
fall_test=js("""(async()=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms));dispatchEvent(new KeyboardEvent('keydown',{code:'KeyA'}));
 let detected=false;for(let i=0;i<70;i++){await wait(100);if(document.querySelector('#notice').textContent.includes('掉出地图')){detected=true;break;}}
 dispatchEvent(new KeyboardEvent('keyup',{code:'KeyA'}));if(!detected)throw Error('Fall respawn missing');return {fallRespawn:true};
})()""")
print('out-of-map respawn PASS',flush=True)
for name,ident in [('歪歪村','village'),('泡泡避难所','undersea'),('歪树森林','forest'),('蘑菇矿坑','underground')]:
    cli('click',f'#maps button[data-map="{ident}"]');waitmap(ident)
    assert not cli('errors'),cli('errors')
print('all four map tabs PASS',flush=True)
waves=[]
for mode,count in [('1v1',2),('2v2',4)]:
    cli('select','#mode',mode)
    for _ in range(30):
        s=js('clubMapPreview.getState()')
        if s['mode']==mode:break
        time.sleep(.1)
    wave=js("""(async()=>{for(let i=0;i<190;i++){const s=clubMapPreview.getState();if(s.clock>=15.2)return {mode:s.mode,items:s.items,warnings:s.warnings};await new Promise(r=>setTimeout(r,100));}throw Error('Airdrop timer did not run');})()""")
    assert wave['items']==count,wave;waves.append(wave)
    print(f'{mode}: first timed wave = {count} items PASS',flush=True)
cli('select','#mode','ffa');waitmap('underground');cli('set','viewport','1280','850');cli('screenshot',str(ROOT/'previews/workshop-desktop.png'))
cli('set','viewport','390','844');cli('screenshot',str(ROOT/'previews/workshop-mobile.png'))
assert js('document.documentElement.scrollWidth<=innerWidth')
errors=cli('errors');assert not errors,errors
cli('set','viewport','1280','850')
(ROOT/'browser-validation.json').write_text(json.dumps(dict(input=input_test,oneWayAndDash=drop_test,fall=fall_test,mapTabs=4,airdropWaves=waves,mobileHorizontalOverflow=False,pageErrors=0),ensure_ascii=False,indent=2),encoding='utf-8')
print('mobile layout / console PASS',flush=True)
