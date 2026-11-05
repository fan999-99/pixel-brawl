"""Original grid-authored pixel art and editable Tiled arenas for 绷住俱乐部.
Run with Python + Pillow. No network or third-party artwork is required.
"""
from __future__ import annotations
import json, math, random, shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
W, H, T = 128, 64, 16
PHYSICS = dict(playerWidth=32, playerHeight=50, moveSpeed=265, gravity=1720, jumpSpeed=770)
THEMES = {
 'underground': dict(name='蘑菇矿坑', subtitle='地底 · 矿灯与蘑菇', bg='#121a2d', far='#26334d', soil='#3a3049', mid='#665069', top='#9a7a99', edge='#bce5cd', accent='#70dbc0', wood='#a87955', objects=['mushroom','beam','lantern','cart','crystal']),
 'village': dict(name='歪歪村', subtitle='村落 · 屋檐与集市', bg='#bed5cf', far='#9abdb2', soil='#645666', mid='#958080', top='#c8b19a', edge='#f1dbac', accent='#e3a35d', wood='#98664d', objects=['house','well','awning','crate','lantern']),
 'undersea': dict(name='泡泡避难所', subtitle='海底 · 穹顶观测站', bg='#103c55', far='#175b6b', soil='#204a60', mid='#39717b', top='#5d9396', edge='#e7c583', accent='#83d8cd', wood='#9f8260', objects=['ship','coral','pipe','shell','lamp']),
 'forest': dict(name='歪树森林', subtitle='森林 · 树屋与木桥', bg='#b3cfa3', far='#709b7e', soil='#4a564c', mid='#777753', top='#91ac65', edge='#d6e8a7', accent='#edbd72', wood='#80654c', objects=['tree','treehouse','fern','mushroom','log']),
}

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

def props(**kw):
    return [dict(name=k, type='bool' if isinstance(v,bool) else 'int' if isinstance(v,int) else 'float' if isinstance(v,float) else 'string', value=v) for k,v in kw.items()]

def tint(c, delta):
    c=c.lstrip('#'); return '#'+''.join(f'{max(0,min(255,int(c[i:i+2],16)+delta)):02x}' for i in (0,2,4))

def atlas(key, p):
    im=Image.new('RGBA',(128,32))
    for ident in range(16):
        tile=Image.new('RGBA',(16,16)); d=ImageDraw.Draw(tile); rng=random.Random(ident+310)
        if ident<9:
            d.rectangle((0,0,15,15),fill=p['soil'])
            for _ in range(10):
                x,y=rng.randrange(1,14),rng.randrange(2,15)
                d.rectangle((x,y,x+rng.randrange(1,4),y+1),fill=rng.choice([p['mid'],tint(p['soil'],-9)]))
            if ident<3:
                d.rectangle((0,0,15,2),fill=p['edge']);d.line((0,3,15,3),fill=p['top'])
                d.line((1,5,14,5),fill=p['mid'])
                if key=='forest':
                    for x in range(0,16,3):d.rectangle((x,2,x+1,5+(x%3)),fill=p['top'])
                if key=='undersea':
                    d.rectangle((0,3,15,6),fill='#b18e61');d.point((3,4),fill='#f4dd9e');d.point((12,4),fill='#f4dd9e')
            if ident%3==0:d.line((0,0,0,15),fill=p['top'])
            if ident%3==2:d.line((15,0,15,15),fill=tint(p['soil'],-16))
            if ident>=6:d.rectangle((0,13,15,15),fill=tint(p['soil'],-15))
        elif ident<12:
            d.rectangle((0,0,15,3),fill=p['edge']);d.rectangle((0,4,15,9),fill=p['wood'])
            for x in (0,7,15):d.line((x,4,x,9),fill=tint(p['wood'],-25))
            d.rectangle((1,10,3,12),fill=tint(p['wood'],-20));d.rectangle((12,10,14,12),fill=tint(p['wood'],-20))
        elif ident==12:
            d.line((7,0,7,15),fill=p['wood'],width=3);d.line((9,0,9,15),fill=p['top'])
        elif ident==13:
            d.line((7,0,7,15),fill=p['accent'])
            for y in (2,9):d.polygon([(7,y),(2,y-2),(3,y+3)],fill=p['top'])
        elif ident==14:
            d.rectangle((0,0,15,5),fill='#372e36')
            for x in range(-4,20,8):d.polygon([(x,0),(x+3,0),(x+8,5),(x+5,5)],fill='#efbb72')
        else:
            d.rectangle((2,2,13,13),fill=p['accent']);d.rectangle((4,4,11,11),outline=p['edge']);d.line((5,8,10,8),fill=p['soil'])
        im.alpha_composite(tile,((ident%8)*16,(ident//8)*16))
    im.save(ROOT/'tilesets'/f'{key}-terrain.png')
    data=dict(type='tileset',version='1.10',tiledversion='1.12.2',name=key+'-terrain',tilewidth=16,tileheight=16,columns=8,tilecount=16,image=f'{key}-terrain.png',imagewidth=128,imageheight=32,margin=0,spacing=0,
      tiles=[dict(id=i,type='Solid' if i<9 else 'OneWay' if i<12 else 'Decoration',properties=props(solid=i<9,oneWay=9<=i<12)) for i in range(16)])
    write(ROOT/'tilesets'/f'{key}-terrain.tsj', data)
    return im

def sprite(kind,p):
    sizes={'tree':(112,172),'house':(112,84),'ship':(144,78),'awning':(88,60),'treehouse':(96,68),'beam':(26,126),'pipe':(44,104),'cart':(58,38),'well':(52,44),'mushroom':(58,60),'crystal':(44,68),'coral':(58,66),'shell':(44,36),'fern':(48,34),'lantern':(20,32),'lamp':(24,38),'crate':(24,24),'log':(62,34)}
    w,h=sizes[kind]; im=Image.new('RGBA',(w,h)); d=ImageDraw.Draw(im)
    wood=p['wood']; dark=tint(wood,-30); light=tint(wood,28); ink='#263d43'
    if kind=='tree':
        d.polygon([(18,h-1),(42,130),(43,42),(63,35),(70,123),(98,h-1)],fill=wood)
        for x,y in [(50,50),(57,80),(48,107),(63,132)]:d.line((x,y,x-4,y+22),fill=dark,width=2)
        for box in [(0,23,60,63),(17,0,79,52),(50,14,111,62),(2,38,108,75)]:
            d.ellipse(box,fill='#386653');d.arc(box,180,320,fill='#658d5c',width=4)
        d.rectangle((49,99,52,102),fill=ink);d.rectangle((60,99,63,102),fill=ink);d.line((53,108,59,108),fill=dark)
        d.polygon([(47,113),(18,87),(6,85),(36,119)],fill=wood)
    elif kind in ('house','treehouse'):
        left,right=8,w-9; roof=20 if kind=='house' else 16
        d.rectangle((left,roof,right,h-5),fill='#bda783' if kind=='house' else '#98774e')
        d.polygon([(0,roof+5),(w//2,0),(w-1,roof+5)],fill='#8f5352');d.line((0,roof+5,w-1,roof+5),fill='#d29877',width=3)
        for y in range(roof+8,h-5,7):d.line((left,y,right,y),fill='#9e886b')
        for x in [18,w-36]:
            d.rectangle((x,roof+14,x+17,roof+32),fill='#3e5f62');d.rectangle((x+2,roof+16,x+15,roof+30),fill='#dfc987');d.line((x+9,roof+16,x+9,roof+30),fill=wood);d.line((x+2,roof+23,x+15,roof+23),fill=wood)
        d.rectangle((w//2-8,h-30,w//2+9,h-5),fill='#665043');d.point((w//2+4,h-17),fill='#e9c387')
        d.rectangle((w-29,0,w-21,12),fill='#7b6260')
        if kind=='treehouse':d.line((15,h-5,7,h-1),fill=wood,width=5);d.line((w-15,h-5,w-7,h-1),fill=wood,width=5)
    elif kind=='mushroom':
        d.rectangle((25,26,33,h-3),fill='#b8b59b');d.rectangle((31,29,35,h-3),fill='#7b8c88')
        d.pieslice((1,1,56,43),180,360,fill=p['accent']);d.rectangle((2,20,55,25),fill=p['accent']);d.line((3,26,53,26),fill=p['edge'],width=2)
        for x,y in [(12,15),(25,6),(40,13)]:d.rectangle((x,y,x+4,y+3),fill=p['edge'])
        d.rectangle((24,17,25,19),fill=ink);d.rectangle((34,17,35,19),fill=ink)
        d.rectangle((18,h-2,40,h-1),fill=dark)
    elif kind=='beam':
        d.rectangle((9,0,17,h-1),fill=wood);d.line((10,2,10,h-2),fill=light,width=2)
        for y in (12,54,101):d.rectangle((7,y,19,y+5),fill='#686774');d.point((10,y+2),fill='#c5c9bb')
        d.polygon([(0,5),(4,0),(24,29),(20,33)],fill=wood)
    elif kind in ('lantern','lamp'):
        d.line((w//2,0,w//2,9),fill=wood,width=2);d.rectangle((3,10,w-4,h-5),fill='#40505d');d.rectangle((5,13,w-6,h-9),fill='#f0d495');d.line((w//2,13,w//2,h-9),fill='#9a7d62');d.rectangle((1,h-5,w-2,h-2),fill='#344753')
    elif kind=='crystal':
        for x,y,r in [(3,26,14),(17,1,17),(30,31,12)]:
            d.polygon([(x,h-3),(x,y+7),(x+r//2,y),(x+r,y+7),(x+r,h-3)],fill='#65a6b2');d.line((x+r//2,y+3,x+r//2,h-8),fill='#b5e6d6',width=2)
    elif kind=='cart':
        d.polygon([(3,4),(54,4),(47,27),(11,27)],fill='#6d6375');d.line((5,6,51,6),fill='#a6a1a2',width=3)
        for x in (11,40):d.ellipse((x,25,x+10,35),fill='#2c3544');d.point((x+5,30),fill='#9c9ba0')
        for x in (12,25,38):d.polygon([(x,5),(x+7,0),(x+14,5)],fill='#70b3b4')
    elif kind=='well':
        d.rectangle((9,21,43,41),fill='#9a9984');d.ellipse((7,18,45,29),fill='#c1b59a');d.ellipse((12,20,40,25),fill='#3f5e65');d.line((6,3,6,33),fill=wood,width=3);d.line((46,3,46,33),fill=wood,width=3);d.polygon([(0,8),(26,0),(51,8)],fill='#956358')
    elif kind=='awning':
        d.line((8,10,8,h-1),fill=wood,width=4);d.line((w-9,10,w-9,h-1),fill=wood,width=4)
        for x in range(0,w,11):d.rectangle((x,8,min(w-1,x+10),24),fill='#b96f61' if x//11%2 else '#d8bd8e')
        d.rectangle((3,h-17,w-4,h-12),fill=wood)
        for x in (15,38,60):d.ellipse((x,h-28,x+12,h-17),fill='#b7af71')
    elif kind=='ship':
        d.polygon([(0,31),(143,31),(120,70),(41,77),(15,57)],fill='#635f61');d.line((5,35,138,35),fill='#b29a79',width=3)
        for y in (45,55,65):d.line((20,y,130-y//4,y),fill='#8b7a69',width=2)
        for x in (37,73,107):d.ellipse((x,40,x+13,53),fill='#204952');d.ellipse((x+2,42,x+11,51),outline='#baaa7c')
        d.line((84,0,81,32),fill=wood,width=4);d.polygon([(84,3),(113,22),(84,22)],fill='#a8af9b')
    elif kind=='coral':
        for points in [[(29,65),(29,16),(19,5)],[(29,41),(11,28),(7,9)],[(30,34),(47,20),(48,1)],[(28,54),(50,44),(56,28)]]:
            d.line(points,fill='#b87e87',width=7);d.line(points,fill='#dfa396',width=3)
        d.ellipse((16,56,44,65),fill='#668b80')
    elif kind=='pipe':
        d.rectangle((12,0,30,h-2),fill='#4d8490');d.line((16,2,16,h-2),fill='#8db8ae',width=3)
        for y in (8,47,88):d.rectangle((7,y,35,y+7),fill='#a19071');d.line((8,y,34,y),fill='#dcc187')
    elif kind=='shell':
        d.pieslice((1,1,42,43),180,360,fill='#c0ab94');d.rectangle((6,20,37,27),fill='#a89086')
        for x in (7,17,27,37):d.line((22,25,x,7),fill='#e4ceb0',width=2)
    elif kind=='fern':
        for x in (6,16,27,40):
            d.line((24,33,x,5),fill='#376b51',width=2)
            for a in range(3):d.ellipse((x-5,4+a*7,x+6,10+a*7),fill='#6f9d66')
    elif kind=='crate':
        d.rectangle((1,1,22,22),fill=wood,outline=light,width=2);d.line((3,3,20,20),fill=light,width=3);d.line((20,3,3,20),fill=dark,width=2)
    elif kind=='log':
        d.rounded_rectangle((1,5,60,31),radius=9,fill=wood);d.ellipse((1,5,24,31),fill=light);d.ellipse((6,10,19,26),outline=dark,width=2);d.line((28,14,53,11),fill=dark,width=2)
    return im.resize((w*2,h*2),Image.Resampling.NEAREST)

def background(key,p):
    im=Image.new('RGB',(512,256),p['bg']);d=ImageDraw.Draw(im);rng=random.Random(800+list(THEMES).index(key))
    if key=='underground':
        for band,color in [(0,'#20283e'),(1,'#293247')]:
            top=[(0,0)]+[(x,rng.randrange(20,78)+band*15) for x in range(0,530,20)]+[(512,0)]
            d.polygon(top,fill=color)
        for x in range(0,512,38):
            d.polygon([(x,256),(x+9,105),(x+24,76),(x+33,140),(x+46,256)],fill='#243046')
        for x in (25,111,223,340,463):
            d.rectangle((x,113,x+3,220),fill='#3b3c49');d.line((x-9,113,x+40,113),fill='#4d4551',width=3)
        for _ in range(80):
            x,y=rng.randrange(512),rng.randrange(40,240);d.rectangle((x,y,x+1,y+1),fill=rng.choice(['#3d575d','#3a3d55']))
        d.ellipse((188,83,328,219),fill='#1a2438')
    elif key=='village':
        for x,y in [(20,27),(160,40),(330,21),(450,49)]:
            d.rectangle((x,y,x+35,y+6),fill='#e5e3c7');d.rectangle((x+8,y-5,x+25,y+9),fill='#e5e3c7')
        d.polygon([(0,125),(80,82),(160,123),(270,67),(390,117),(470,78),(512,95),(512,256),(0,256)],fill='#94b7a3')
        for x in range(-20,540,48):
            y=rng.randrange(116,149);d.rectangle((x,y,x+40,208),fill='#a8b6a2');d.polygon([(x-5,y),(x+20,y-24),(x+45,y)],fill='#929b90')
            for wx in (x+8,x+28):d.rectangle((wx,y+10,wx+5,y+17),fill='#7f9b94')
        d.rectangle((241,63,266,199),fill='#aeb8a0');d.polygon([(234,64),(253,38),(273,64)],fill='#8c9990');d.ellipse((247,77,260,90),fill='#dfd8b2');d.line((253,79,253,85,257,85),fill='#6f8e86',width=1)
    elif key=='undersea':
        for x in (30,140,275,430):d.polygon([(x,0),(x+24,0),(x+118,185),(x+72,185)],fill='#16495e')
        for _ in range(65):
            x,y=rng.randrange(512),rng.randrange(200);d.ellipse((x,y,x+2,y+2),outline='#2a6472')
        for x,y in [(48,78),(150,42),(390,82),(310,31)]:
            d.ellipse((x,y,x+10,y+3),fill='#326e78');d.polygon([(x+10,y+1),(x+15,y-2),(x+15,y+5)],fill='#326e78')
        # Decorative dome and ribs; these never participate in collision.
        d.arc((18,22,494,354),180,360,fill='#507c80',width=3)
        for x in (93,175,337,419):d.line((x,68,x,222),fill='#2b6371',width=2)
        d.line((27,171,485,171),fill='#2b6371',width=2)
        d.polygon([(0,222),(70,209),(158,228),(270,203),(390,221),(512,208),(512,256),(0,256)],fill='#205566')
    else:
        for layer,color in [(0,'#8db397'),(1,'#69947b')]:
            for x in range(-20,540,54):
                shift=rng.randrange(15);d.rectangle((x+shift+18,40,x+shift+27,240),fill=color)
                d.ellipse((x+shift-9,-25+layer*20,x+shift+59,100+layer*20),fill=color)
        for x,y in [(60,60),(192,30),(345,73)]:d.polygon([(x,y),(x+16,y),(x+70,y+140),(x+45,y+140)],fill='#9fc49c')
        d.polygon([(0,212),(70,184),(180,208),(275,178),(410,205),(512,184),(512,256),(0,256)],fill='#6f9478')
    # Low-detail depth below the playspace; keeps platform silhouettes legible.
    d.rectangle((0,231,511,255),fill=tint(p['bg'],-12))
    im.resize((2048,1024),Image.Resampling.NEAREST).save(ROOT/'backgrounds'/f'{key}-far.png')

LAYOUTS={
 'underground':[(8,43,14),(30,43,14),(52,43,24),(84,43,14),(106,43,14),(16,36,20),(46,36,16),(66,36,16),(92,36,20),(36,29,18),(74,29,18),(56,22,16)],
 'village':[(8,43,20),(34,43,18),(58,43,12),(76,43,18),(100,43,20),(20,36,20),(48,36,12),(68,36,12),(88,36,20),(40,29,16),(72,29,16),(57,22,14)],
 'undersea':[(6,43,18),(30,43,18),(54,43,20),(80,43,18),(104,43,18),(16,36,18),(42,36,18),(68,36,18),(94,36,18),(32,29,20),(76,29,20),(56,22,16)],
 'forest':[(8,43,16),(30,43,18),(54,43,20),(80,43,18),(104,43,16),(18,36,18),(44,36,16),(68,36,16),(92,36,18),(36,29,18),(74,29,18),(56,22,16)],
}

class Arena:
    def __init__(self,key,p):
        self.key,self.p,self.objects,self.layers,self.nextid,self.surfaces=key,p,{},[],1,[]
        self.data=dict(type='map',version='1.10',tiledversion='1.12.2',orientation='orthogonal',renderorder='right-down',infinite=False,width=W,height=H,tilewidth=T,tileheight=T,nextlayerid=1,nextobjectid=1,
          backgroundcolor=p['bg'],tilesets=[dict(firstgid=1,source=f'../tilesets/{key}-terrain.tsj'),dict(firstgid=101,source=f'../tilesets/{key}-decor.tsj')],
          properties=props(mapId=key,displayName=p['name'],subtitle=p['subtitle'],cameraFollow=True,dropInterval=15,dropCountRule='initial_participant_count_including_bots',dropAuthority='server',dropWarningSeconds=1.5,artLicense='CC0-1.0',schemaVersion=1)+[dict(name='physicsContract',type='file',value='../physics.json')])
    def layer(self,name,kind,**kw):
        obj=dict(id=len(self.layers)+1,name=name,type=kind,visible=True,opacity=1,x=0,y=0)
        obj.update(kw)
        self.layers.append(obj)
        return obj
    def group(self,name,color):
        obj=self.layer(name,'objectgroup',objects=[],draworder='topdown',color=color,visible=False)
        self.objects[name]=obj['objects'];return obj
    def obj(self,group,name,cls,x,y,width=0,height=0,**kw):
        obj=dict(id=self.nextid,name=name,type=cls,x=x,y=y,width=width,height=height,rotation=0,visible=True,**kw)
        self.nextid+=1;self.objects[group].append(obj);return obj
    def tiles(self,name):
        return self.layer(name,'tilelayer',width=W,height=H,data=[0]*(W*H))['data']
    def surface(self,x,y,w,oneway=True,h=1):
        surface=dict(id=f'platform-{len(self.surfaces)+1:02d}',x=x*16,y=y*16,width=w*16,height=8 if oneway else h*16,oneWay=oneway)
        self.surfaces.append(surface)
        self.obj('OneWayPlatforms' if oneway else 'Collision',surface['id'],'OneWay' if oneway else 'Solid',surface['x'],surface['y'],surface['width'],surface['height'],properties=props(oneWay=oneway,friction=1.0))
        if oneway:
            for cx in range(x,x+w):self.platformtiles[y*W+cx]=10 if cx==x else 12 if cx==x+w-1 else 11
        else:
            for cy in range(y,y+h):
                for cx in range(x,x+w):
                    col=0 if cx==x else 2 if cx==x+w-1 else 1
                    row=0 if cy==y else 2 if cy==y+h-1 else 1
                    self.solidtiles[cy*W+cx]=row*3+col+1

def make_map(key,p):
    terrain=atlas(key,p);background(key,p)
    decorations={kind:sprite(kind,p) for kind in p['objects']}
    tiles=[]
    for i,(kind,im) in enumerate(decorations.items()):
        path=ROOT/'tilesets'/f'{key}-{kind}.png';im.save(path)
        tiles.append(dict(id=i,type='Scenery',image=path.name,imagewidth=im.width,imageheight=im.height,properties=props(decoration=True,collides=False)))
    write(ROOT/'tilesets'/f'{key}-decor.tsj',dict(type='tileset',version='1.10',tiledversion='1.12.2',name=key+'-decor',tilewidth=max(im.width for im in decorations.values()),tileheight=max(im.height for im in decorations.values()),columns=0,tilecount=len(tiles),grid=dict(orientation='orthogonal',width=16,height=16),objectalignment='bottomleft',tiles=tiles))
    a=Arena(key,p)
    a.layer('Background_Far','imagelayer',image=f'../backgrounds/{key}-far.png',imagewidth=2048,imageheight=1024,parallaxx=.35,parallaxy=.65)
    a.layer('Scenery','objectgroup',objects=[],draworder='topdown',opacity=.75)
    a.objects['Scenery']=a.layers[-1]['objects']
    a.solidtiles=a.tiles('Terrain_Solid');a.platformtiles=a.tiles('Platforms_OneWay');details=a.tiles('Foreground_Detail')
    for name,color in [('Collision','#ef907d'),('OneWayPlatforms','#b8e5b4'),('SpawnPoints','#91c9fc'),('DropPoints','#f6d46e'),('CameraBounds','#a99bdf'),('DeathZones','#f06d88'),('ModeBounds','#e1c89a'),('AiNavigation','#70dac7')]:a.group(name,color)
    for x,w in [(4,36),(43,42),(88,36)]:a.surface(x,50,w,False,6)
    for x,w in [(4,36),(43,42),(88,36)]:
        for col in (x,x+1,x+w-2,x+w-1):details[51*W+col]=15
    for x,y,w in LAYOUTS[key]:a.surface(x,y,w)

    placements={
      'underground': [('beam',72,800),('beam',392,688),('beam',960,688),('beam',1512,688),('beam',1896,800),('mushroom',112,800),('mushroom',600,688),('mushroom',1720,800),('crystal',768,800),('crystal',1232,800),('cart',448,800),('cart',1568,800),('lantern',100,570),('lantern',1800,566)],
      'village': [('house',112,800),('house',824,800),('house',1648,800),('awning',544,800),('awning',1344,800),('well',1080,800),('crate',64,800),('crate',1936,800),('crate',656,688),('crate',1328,688),('lantern',380,800),('lantern',1600,800)],
      'undersea': [('ship',112,800),('ship',1512,800),('pipe',24,800),('pipe',936,800),('pipe',1936,800),('coral',544,800),('coral',1360,800),('coral',64,688),('coral',1840,688),('shell',776,800),('shell',1184,800),('lamp',432,688),('lamp',1584,688)],
      'forest': [('tree',128,800),('tree',1648,800),('treehouse',464,688),('treehouse',1392,688),('fern',64,800),('fern',848,800),('fern',1176,800),('fern',1872,800),('mushroom',704,800),('mushroom',1232,800),('log',288,800),('log',1648,800)],
    }
    for kind,x,y in placements[key]:
        im=decorations[kind];ident=p['objects'].index(kind)
        a.obj('Scenery',f'{kind}-{a.nextid}','Scenery',x,y,im.width,im.height,gid=101+ident,properties=props(collides=False))
    # Every ground spawn is on a broad, safe surface. Position is the player's feet.
    for mode,positions in [('1v1',[784,1264]),('2v2',[288,448,1600,1760]),('ffa',[256,816,1232,1792])]:
        for i,x in enumerate(positions):
            a.obj('SpawnPoints',f'{mode}-{i+1}','Spawn',x,800,point=True,properties=props(mode=mode,slot=i,team=i if mode=='1v1' else i//2 if mode=='2v2' else i,feetAnchor=True,safeRadius=48))
    for i,x in enumerate([128,256,384,512,640,768,896,1024,1152,1280,1408,1536,1664,1792,1920]):
        surfaces=[s for s in a.surfaces if s['x']<=x<=s['x']+s['width']]
        if not surfaces:continue
        target=min(surfaces,key=lambda s:s['y'])
        if not target['x']+24<=x<=target['x']+target['width']-24:continue
        a.obj('DropPoints',f'drop-{i+1:02d}','Drop',x,target['y'],point=True,properties=props(landingSurface=target['id'],spawnY=max(32,target['y']-192),quadrant=min(3,x//512),warningSeconds=1.5))
    for mode,x,width in [('all',0,2048),('1v1',512,1024)]:
        a.obj('CameraBounds',f'camera-{mode}','CameraBounds',x,0,width,1024,properties=props(mode=mode,follow='localPlayer',deadZoneX=80,deadZoneY=50))
    for mode,x,width in [('1v1',512,1024),('2v2',0,2048),('ffa',0,2048)]:
        a.obj('ModeBounds',mode,'ModeBounds',x,0,width,1024,properties=props(mode=mode,visibleBoundary=True))
    a.obj('DeathZones','bottom','InstantDeath',-256,1008,2560,256,properties=props(cause='fall',instant=True))
    a.obj('DeathZones','left','InstantDeath',-256,-256,256,1264,properties=props(cause='outOfBounds',instant=True))
    a.obj('DeathZones','right','InstantDeath',2048,-256,256,1264,properties=props(cause='outOfBounds',instant=True))
    nodes=[];edges=[]
    for s in a.surfaces:
        n=a.obj('AiNavigation',s['id'],'NavNode',s['x']+s['width']/2,s['y'],point=True,properties=props(surface=s['id']));nodes.append(n)
    for i,s in enumerate(a.surfaces):
        for j,t in enumerate(a.surfaces):
            if i==j:continue
            dy=t['y']-s['y'];disc=770**2+2*1720*dy
            if disc<0 or dy>230:continue
            time=(770+math.sqrt(disc))/1720
            start=max(s['x']+24,min(s['x']+s['width']-24,t['x']+t['width']/2))
            end=max(t['x']+24,min(t['x']+t['width']-24,start))
            gap=abs(end-start)
            if gap>265*time*.8:continue
            # A drop to a lower platform requires its footprint to extend beyond
            # the upper surface; jumping upward through a one-way is allowed.
            if dy>0 and not t['oneWay']:action='drop'
            else:action='jump' if dy<0 or gap>0 else 'drop'
            edge=dict(fromSurface=s['id'],toSurface=t['id'],takeoffX=start,landingX=end,deltaY=dy,action=action)
            edges.append(edge)
            a.obj('AiNavigation',f'edge-{i+1}-{j+1}','NavLink',start,s['y'],polyline=[dict(x=0,y=0),dict(x=end-start,y=dy)],properties=props(**edge))
    a.data.update(layers=a.layers,nextobjectid=a.nextid,nextlayerid=len(a.layers)+1)
    write(ROOT/'maps'/f'{key}.tmj',a.data)
    runtime=dict(id=key,name=p['name'],subtitle=p['subtitle'],width=2048,height=1024,tileSize=16,physics=PHYSICS,source=f'maps/{key}.tmj',surfaces=a.surfaces,
      spawnPoints=a.objects['SpawnPoints'],dropPoints=a.objects['DropPoints'],modes=a.objects['ModeBounds'],cameraBounds=a.objects['CameraBounds'],deathZones=a.objects['DeathZones'],navigation=edges)
    write(ROOT/'runtime'/f'{key}.arena.json',runtime)
    # Walkability is validated against the single-jump contract, not double jump.
    reachable={a.surfaces[0]['id']}
    while True:
        expanded=reachable|{e['toSurface'] for e in edges if e['fromSurface'] in reachable}
        if expanded==reachable:break
        reachable=expanded
    assert len(reachable)==len(a.surfaces),(key,'unreachable platforms',set(s['id'] for s in a.surfaces)-reachable)
    for n in a.objects['SpawnPoints']:
        assert any(s['x']+24<=n['x']<=s['x']+s['width']-24 and s['y']==n['y'] for s in a.surfaces)
    assert len(a.objects['DropPoints'])>=8
    return dict(id=key,name=p['name'],subtitle=p['subtitle'],accent=p['accent'],map=f'maps/{key}.tmj',runtime=f'runtime/{key}.arena.json',preview=f'previews/{key}.png',platforms=len(a.surfaces),reachablePlatforms=len(reachable),spawnPoints=len(a.objects['SpawnPoints']),dropPoints=len(a.objects['DropPoints']),navigationLinks=len(edges))

def main():
    for directory in ['maps','tilesets','backgrounds','previews','runtime','preview']: (ROOT/directory).mkdir(exist_ok=True)
    manifest=[make_map(key,p) for key,p in THEMES.items()]
    write(ROOT/'manifest.json',dict(title='绷住俱乐部 · 四主题地图',version=1,mapSize=dict(width=2048,height=1024,tileWidth=16,tileHeight=16),maps=manifest))
    write(ROOT/'physics.json',PHYSICS)
    write(ROOT/'club-maps.tiled-project',dict(automappingRulesFile='',commands=[],extensionsPath='extensions',folders=['maps','tilesets','backgrounds'],objectTypesFile='',propertyTypes=[]))
    write(ROOT/'verification.json',dict(generated=True,allPlatformsConnectedByConservativeNavigationGraph=True,safeSpawnPoints=True,dropPointsReachable=True,maps=manifest))
    print(json.dumps(manifest,ensure_ascii=False))

if __name__=='__main__':main()
