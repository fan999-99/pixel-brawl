"""Read, convert, rasterize and round-trip every map with the official Tiled binary."""
import json, os, subprocess
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
BIN=Path.home()/'.codex/tools/tiled-1.12.2/PFiles/Tiled'
env=dict(os.environ,QT_QPA_PLATFORM='windows')
for path in ['exports/tmx','exports/validated']:(ROOT/path).mkdir(parents=True,exist_ok=True)
report=[]
def command(exe,*args):
    r=subprocess.run([str(BIN/exe),*[str(a) for a in args]],env=env,timeout=35,creationflags=subprocess.CREATE_NO_WINDOW)
    assert r.returncode==0,(exe,r.returncode,args)
for entry in json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))['maps']:
    key=entry['id'];source=ROOT/entry['map'];tmx=ROOT/'exports/tmx'/f'{key}.tmx';rt=ROOT/'exports/validated'/f'{key}.json'
    command('tiled.exe','--export-map',source,tmx)
    command('tiled.exe','--export-map',tmx,rt)
    original=json.loads(source.read_text(encoding='utf-8'));native=json.loads(rt.read_text(encoding='utf-8'))
    assert (native['width'],native['height'],native['tilewidth'],native['tileheight'])==(128,64,16,16)
    a={l['name']:l for l in original['layers']};b={l['name']:l for l in native['layers']}
    assert a.keys()==b.keys()
    for name in a:
        if a[name]['type']=='tilelayer':assert a[name]['data']==b[name]['data'],(key,name)
        if a[name]['type']=='objectgroup':
            assert len(a[name]['objects'])==len(b[name]['objects'])
            for old,new in zip(a[name]['objects'],b[name]['objects']):
                assert all(old[k]==new[k] for k in ('id','name','x','y','width','height')),(key,name)
    # Use Tiled's own renderer for the delivered overview, rather than a mockup.
    command('tmxrasterizer.exe',source,ROOT/entry['preview'])
    size=Image.open(ROOT/entry['preview']).size
    assert size==(2048,1024),(key,size)
    report.append(dict(map=key,tiledRead=True,tmxExport=True,jsonRoundTrip=True,geometryPreserved=True,nativeRasterSize=list(size)))
    print(f'{key}: Tiled read / TMX / JSON round-trip / native PNG PASS',flush=True)
write=ROOT/'tiled-validation.json';write.write_text(json.dumps(dict(tiledVersion='1.12.2',maps=report),indent=2),encoding='utf-8')
