/** Project-specific object-layer contract; the same data can be used by a host/server. */
export const properties = object => Object.fromEntries((object.properties || []).map(p => [p.name, p.value]));
export const allLayers = map => map.layers.flatMap(layer => layer.type === 'group' ? [layer, ...allLayers(layer)] : [layer]);
export function parseArena(map) {
  if (map.orientation !== 'orthogonal' || map.infinite) throw new Error('Expected a finite orthogonal Tiled map');
  const layers = allLayers(map);
  const objects = name => (layers.find(layer => layer.name === name)?.objects || []).map(object => ({...object, props: properties(object)}));
  const platforms = ['Collision', 'OneWayPlatforms'].flatMap(layerName => objects(layerName).map(object => ({
    id: object.name, x: object.x, y: object.y, width: object.width, height: object.height,
    oneWay: layerName === 'OneWayPlatforms',
  })));
  if (!platforms.length) throw new Error('The map has no collision surfaces');
  return {
    ...properties(map), width: map.width * map.tilewidth, height: map.height * map.tileheight,
    tileWidth: map.tilewidth, tileHeight: map.tileheight, platforms,
    spawns: objects('SpawnPoints'), drops: objects('DropPoints'), cameraBounds: objects('CameraBounds'),
    modeBounds: objects('ModeBounds'), deathZones: objects('DeathZones'), navigation: objects('AiNavigation'), layers,
  };
}

export function chooseSpawnPoints(arena, mode, count = 4) {
  const points = arena.spawns.filter(point => point.props.mode === mode).sort((a,b) => a.props.slot-b.props.slot);
  if (points.length < count) throw new Error(`Insufficient ${mode} spawn points`);
  return points.slice(0, count);
}

/** The host supplies its deterministic RNG; call only once per wave and broadcast the result. */
export function chooseDropPoints(arena, mode, count, random = Math.random) {
  const bounds = arena.modeBounds.find(b => b.props.mode === mode);
  const candidates = arena.drops.filter(point => !bounds || point.x >= bounds.x+24 && point.x <= bounds.x+bounds.width-24);
  if (candidates.length < count) throw new Error('Not enough safe drop positions');
  // Stratify the space before choosing a point; this prevents all four drops landing on one side.
  const ordered = [...candidates].sort((a,b) => a.x-b.x);
  return Array.from({length:count}, (_, i) => {
    const part = ordered.slice(Math.floor(i*ordered.length/count), Math.floor((i+1)*ordered.length/count));
    return part[Math.min(part.length-1, Math.floor(random()*part.length))];
  });
}
