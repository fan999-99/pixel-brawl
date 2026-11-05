import type { ArenaDefinition, CharacterDefinition, CharacterId, Difficulty, ItemKind, MapId, MatchSettings } from './types.js';
export const WORLD_WIDTH = 1280;
export const WORLD_HEIGHT = 720;
export const PLAYER_WIDTH = 32;
export const PLAYER_HEIGHT = 50;
export const FIXED_DT = 1 / 60;
export const DEFAULT_SETTINGS: MatchSettings = { mode: 'ffa', map: 'sky', roundsToWin: 2, dropInterval: 15, friendlyFire: false, itemsEnabled: true };
export const DIFFICULTIES: Record<Difficulty, string> = { easy: '轻松绷住', medium: '绷住', hard: '难绷' };
export const CHARACTERS: Record<CharacterId, CharacterDefinition> = {
  uncle: { id: 'uncle', name: '锅盖大叔', title: '近身防守', color: '#ffc857', accent: '#76522d', description: '一锅拍开烦恼，举锅挡住正面伤害。', skill1: '锅拍', skill2: '举锅' },
  slipper: { id: 'slipper', name: '拖鞋侠', title: '突进骚扰', color: '#ed7ca9', accent: '#a43c6f', description: '飞拖鞋接滑铲，打空后记得躲。', skill1: '飞拖鞋', skill2: '滑铲踢' },
  chicken: { id: 'chicken', name: '蹦迪鸡', title: '空间控制', color: '#82d9b8', accent: '#217d70', description: '音浪把人推开，弹簧起跳换个位置。', skill1: '喇叭音浪', skill2: '弹簧起跳' },
  raccoon: { id: 'raccoon', name: '纸箱浣熊', title: '陷阱布置', color: '#b6a2ed', accent: '#625295', description: '可见的弹簧包裹，也有不太正经的纸团。', skill1: '弹簧包裹', skill2: '纸团投掷' },
};
export const ARENAS: Record<MapId, ArenaDefinition> = {
  sky: { id: 'sky', name: '云上开打', subtitle: '天空 · 浮岛训练场', background: '/assets/maps/sky-arena-v1.png', left: 102, right: 1175, groundY: 431, platforms: [
    { id: 'ground', x: 86, y: 431, width: 1103, oneWay: false },
    { id: 'left', x: 224, y: 269, width: 230, oneWay: true },
    { id: 'right', x: 825, y: 269, width: 229, oneWay: true },
    { id: 'top', x: 525, y: 153, width: 229, oneWay: true },
  ] },
  village: { id: 'village', name: '村口约架', subtitle: '村落 · 石桥小广场', background: '/assets/maps/village-arena-v1.png', left: 58, right: 1220, groundY: 476, platforms: [
    { id: 'ground', x: 28, y: 476, width: 1224, oneWay: false },
    { id: 'left', x: 50, y: 367, width: 298, oneWay: true },
    { id: 'center', x: 522, y: 286, width: 269, oneWay: true },
    { id: 'right', x: 984, y: 280, width: 240, oneWay: true },
  ] },
  mountain: { id: 'mountain', name: '山顶难绷', subtitle: '山地 · 峡谷观景台', background: '/assets/maps/mountain-arena-v1.png', left: 206, right: 1076, groundY: 432, platforms: [
    { id: 'ground', x: 187, y: 432, width: 910, oneWay: false },
    { id: 'left', x: 220, y: 273, width: 226, oneWay: true },
    { id: 'right', x: 838, y: 273, width: 222, oneWay: true },
    { id: 'top', x: 519, y: 171, width: 244, oneWay: true },
  ] },
};
export const ITEM_NAMES: Record<ItemKind, string> = { banana: '香蕉皮', shield: '橡皮鸭护盾', shoes: '弹簧鞋', popcorn: '爆米花炸弹', watergun: '玩具水枪' };
export const MODE_NAMES = { '1v1': '1v1 对决', '2v2': '2v2 组队', ffa: '欢乐混战' } as const;
