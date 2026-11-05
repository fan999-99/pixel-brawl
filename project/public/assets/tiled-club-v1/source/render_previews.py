"""Rasterize this project's grid-authored Tiled data for quick visual inspection."""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]
def render(path):
    m=json.loads(path.read_text(encoding='utf-8')); out=Image.new('RGBA',(m['width']*16,m['height']*16),m['backgroundcolor'])
    sets=[]
    for entry in m['tilesets']:
        tsPath=(path.parent/entry['source']).resolve();ts=json.loads(tsPath.read_text(encoding='utf-8'));bitmaps={}
        if 'image' in ts:
            atlas=Image.open(tsPath.parent/ts['image']).convert('RGBA')
            for i in range(ts['tilecount']):
                x=(i%ts['columns'])*16;y=(i//ts['columns'])*16;bitmaps[i]=atlas.crop((x,y,x+16,y+16))
        else:
            for tile in ts['tiles']:bitmaps[tile['id']]=Image.open(tsPath.parent/tile['image']).convert('RGBA')
        sets.append((entry['firstgid'],bitmaps))
    def tile(gid):
        first,images=next((f,im) for f,im in reversed(sets) if gid>=f)
        return images[gid-first]
    for layer in m['layers']:
        if not layer.get('visible',True):continue
        if layer['type']=='imagelayer':out.alpha_composite(Image.open(path.parent/layer['image']).convert('RGBA'))
        if layer['type']=='tilelayer':
            for i,gid in enumerate(layer['data']):
                if gid:out.alpha_composite(tile(gid),((i%m['width'])*16,(i//m['width'])*16))
        if layer['type']=='objectgroup':
            for obj in layer['objects']:
                if 'gid' in obj:out.alpha_composite(tile(obj['gid']),(int(obj['x']),int(obj['y']-obj['height'])))
    return out.convert('RGB')

if __name__=='__main__':
    manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
    font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',25)
    sheet=Image.new('RGB',(1440,850),'#1b2d38');d=ImageDraw.Draw(sheet)
    for i,entry in enumerate(manifest['maps']):
        if '--contact-only' in sys.argv:image=Image.open(ROOT/entry['preview'])
        else:
            image=render(ROOT/entry['map']);image.save(ROOT/entry['preview'])
        small=image.resize((688,344),Image.Resampling.NEAREST);x=24+(i%2)*712;y=20+(i//2)*415
        d.text((x,y),entry['name'],fill=entry['accent'],font=font)
        sheet.paste(small,(x,y+42));d.rectangle((x,y+42,x+687,y+385),outline=entry['accent'],width=2)
    sheet.save(ROOT/'previews/contact-sheet.png')
    print('Rendered four map overviews and contact-sheet.png')
