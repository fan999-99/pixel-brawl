import type { AirdropPoint, ArenaDefinition, CharacterDefinition, CharacterId, Difficulty, ItemKind, MapId, MatchSettings, Platform, SpawnPoint } from './types.js';
import forestLayout from './layouts/forest.json';
import undergroundLayout from './layouts/underground.json';
import underseaLayout from './layouts/undersea.json';
import villageLayout from './layouts/village.json';

/** Art is 1774×887. Uniform scale keeps that 2:1 frame and the current jump reach. */
export const WORLD_WIDTH = 1280;
export const WORLD_HEIGHT = 640;
const ART_HEIGHT = 887;
const MAP_SCALE = WORLD_HEIGHT / ART_HEIGHT;

export const PLAYER_WIDTH = 32;
export const PLAYER_HEIGHT = 50;
export const FIXED_DT = 1 / 60;
export const DEFAULT_SETTINGS: MatchSettings = { mode: 'ffa', map: 'underground', roundsToWin: 2, dropInterval: 15, friendlyFire: false, itemsEnabled: true };
export const DIFFICULTIES: Record<Difficulty, string> = { easy: '轻松绷住', medium: '绷住', hard: '难绷' };
export const CHARACTERS: Record<CharacterId, CharacterDefinition> = {
  uncle: { id: 'uncle', name: '锅盖大叔', title: '近身防守', color: '#ffc857', accent: '#76522d', description: '一锅拍开烦恼，举锅挡住正面伤害。', skill1: '锅拍', skill2: '举锅' },
  slipper: { id: 'slipper', name: '拖鞋侠', title: '突进骚扰', color: '#ed7ca9', accent: '#a43c6f', description: '飞拖鞋接滑铲，打空后记得躲。', skill1: '飞拖鞋', skill2: '滑铲踢' },
  chicken: { id: 'chicken', name: '蹦迪鸡', title: '空间控制', color: '#82d9b8', accent: '#217d70', description: '音浪把人推开，弹簧起跳换个位置。', skill1: '喇叭音浪', skill2: '弹簧起跳' },
  raccoon: { id: 'raccoon', name: '纸箱浣熊', title: '陷阱布置', color: '#b6a2ed', accent: '#625295', description: '可见的弹簧包裹，也有不太正经的纸团。', skill1: '弹簧包裹', skill2: '纸团投掷' },
};

interface LayoutPlatform { id: string; x: number; y: number; width: number; height: number; oneWay: boolean }
interface LayoutSpawn { id: string; x: number; y: number; platformId: string; team: number }
interface LayoutDrop { id: string; x: number; landingY: number; platformId: string }
interface LayoutFile {
  id: MapId; name: string; particleTheme: string;
  platforms: LayoutPlatform[];
  spawns: LayoutSpawn[];
  airdrops: LayoutDrop[];
  deathBounds: { left: number; right: number; bottom: number };
}

const SUBTITLES: Record<MapId, string> = {
  underground: '矿坑 · 孢子与矿灯',
  village: '村落 · 屋檐与石桥',
  undersea: '海底 · 穹顶避难所',
  forest: '森林 · 歪树与萤火',
};

const scale = (value: number) => Math.round(value * MAP_SCALE);
const scaleSpan = (x: number, width: number) => {
  const left = scale(x);
  return { x: left, width: scale(x + width) - left };
};

function arenaFromLayout(layout: LayoutFile): ArenaDefinition {
  const platforms: Platform[] = layout.platforms.map(platform => ({
    id: platform.id, ...scaleSpan(platform.x, platform.width), y: scale(platform.y), oneWay: platform.oneWay,
  }));
  const spawns: SpawnPoint[] = layout.spawns.map(spawn => ({
    id: spawn.id, x: scale(spawn.x), y: scale(spawn.y), team: spawn.team, platformId: spawn.platformId,
  }));
  const airdrops: AirdropPoint[] = layout.airdrops.map(drop => ({
    id: drop.id, x: scale(drop.x), y: scale(drop.landingY), platformId: drop.platformId,
  }));
  const main = platforms.find(platform => platform.id === 'main') ?? platforms[0];
  return {
    id: layout.id,
    name: layout.name,
    subtitle: SUBTITLES[layout.id],
    background: `/assets/maps/${layout.id}.png`,
    left: scale(layout.deathBounds.left),
    right: scale(layout.deathBounds.right),
    bottom: scale(layout.deathBounds.bottom),
    groundY: main.y,
    platforms,
    spawns,
    airdrops,
    particleTheme: layout.particleTheme,
  };
}

export const ARENAS: Record<MapId, ArenaDefinition> = {
  underground: arenaFromLayout(undergroundLayout as LayoutFile),
  village: arenaFromLayout(villageLayout as LayoutFile),
  undersea: arenaFromLayout(underseaLayout as LayoutFile),
  forest: arenaFromLayout(forestLayout as LayoutFile),
};
export const MAP_IDS = Object.keys(ARENAS) as MapId[];
export const ITEM_NAMES: Record<ItemKind, string> = { banana: '香蕉皮', shield: '橡皮鸭护盾', shoes: '弹簧鞋', popcorn: '爆米花炸弹', watergun: '玩具水枪' };
export const MODE_NAMES = { '1v1': '1v1 对决', '2v2': '2v2 组队', ffa: '欢乐混战' } as const;
