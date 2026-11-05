"""Create a portable deliverable, after native Tiled and gameplay validation."""
from pathlib import Path
import hashlib,json,zipfile
ROOT=Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
native=json.loads((ROOT/'tiled-validation.json').read_text(encoding='utf-8'))
gameplay=json.loads((ROOT/'gameplay-validation.json').read_text(encoding='utf-8'))
browser=json.loads((ROOT/'browser-validation.json').read_text(encoding='utf-8'))
assert len(native['maps'])==len(gameplay['maps'])==4 and browser['mapTabs']==4
assert browser['pageErrors']==0
integrity={str(p.relative_to(ROOT)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.rglob('*')) if p.is_file() and '__pycache__' not in p.parts and p.name!='pack-integrity.json'}
(ROOT/'pack-integrity.json').write_text(json.dumps(dict(date='2026-11-02',files=integrity),ensure_ascii=False,indent=2),encoding='utf-8')
base=ROOT.parents[3]
revision=1
while (base/f'绷住俱乐部-Tiled四主题地图-v{revision}.zip').exists():revision+=1
destination=base/f'绷住俱乐部-Tiled四主题地图-v{revision}.zip'
with zipfile.ZipFile(destination,'x',zipfile.ZIP_DEFLATED) as archive:
    for p in sorted(ROOT.rglob('*')):
        if p.is_file() and '__pycache__' not in p.parts:archive.write(p,Path(ROOT.name)/p.relative_to(ROOT))
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert all((ROOT.name+'/maps/'+entry['id']+'.tmj') in archive.namelist() for entry in manifest['maps'])
print(json.dumps(dict(zip=str(destination),bytes=destination.stat().st_size,sha256=hashlib.sha256(destination.read_bytes()).hexdigest(),maps=4,platforms=sum(m['platforms'] for m in manifest['maps']),safeSpawnMarkers=sum(m['spawnPoints'] for m in manifest['maps']),dropCandidates=sum(m['dropPoints'] for m in manifest['maps'])),ensure_ascii=False),flush=True)
