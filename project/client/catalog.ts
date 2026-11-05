import { ARENAS, CHARACTERS, ITEM_NAMES } from '../shared/config.js';
import type { CharacterId, ItemKind, MapId } from '../shared/types.js';
import { esc, icon, portrait } from './ui.js';

export type CatalogKind = 'characters' | 'maps' | 'items' | 'author';
export type CatalogContent = { title: string; subtitle: string; html: string };

const CHARACTER_DETAILS: Record<CharacterId, { skills: [string, string]; weakness: string }> = {
  uncle: {
    skills: ['冷却 8 秒。前方锅拍造成 18 点伤害，出手前有举锅动作。', '冷却 10 秒。举锅 1 秒，正面最多吸收 20 点伤害；期间移动变慢，无法攻击。'],
    weakness: '距离短，举锅只保护正面。绕到背后，或等收招后反击。',
  },
  slipper: {
    skills: ['冷却 7 秒。直线飞出的拖鞋造成 10 点伤害。', '冷却 9 秒。向前滑铲，命中造成 12 点伤害，落空后有收招。'],
    weakness: '突进方向固定。预判滑铲路线，跳开后追击。',
  },
  chicken: {
    skills: ['冷却 8 秒。前方音浪造成 12 点伤害，并把对手推开。', '冷却 8 秒。快速跃向移动方向，不附带伤害或无敌。'],
    weakness: '爆发较低，起跳轨迹清楚。追着落点打，别让它一直保持距离。',
  },
  raccoon: {
    skills: ['冷却 10 秒。放置可见的弹簧包裹，命中造成 14 点伤害并减速 20%，持续 1 秒。每人最多留一个。', '冷却 7 秒。直线纸团造成 10 点伤害，可以被普通攻击打掉。'],
    weakness: '近身脱离能力弱。先拆包裹，再靠近；普通攻击可拆除陷阱。',
  },
};

const MAP_DETAILS: Record<MapId, { layout: string; approach: string }> = {
  sky: { layout: '一块主地面，左右对称平台，加中央高台。', approach: '左右路线较对称，适合熟悉二段跳、上下换位和空投争抢。' },
  village: { layout: '宽主地面，左侧低台、中央台与右侧高台。', approach: '平台高度不完全对称。借低台起跳，也留意另一侧的投射物。' },
  mountain: { layout: '较窄主地面，左右中层平台，加中央高台。', approach: '靠近对手更快。争取侧台后，从两条路线进攻中央高位。' },
};

const ITEM_DETAILS: Record<ItemKind, { use: string; effect: string; response: string }> = {
  banana: { use: 'F 拾取，J 投出，一次性使用。', effect: '触碰后滑倒约 0.3 秒，随后消失。', response: '地面可见，可以绕开或跳过。' },
  shield: { use: 'F 拾取后立即生效。', effect: '吸收最多 15 点伤害，最长持续 4 秒；同类护盾不叠加。', response: '可等待失效，或用小伤害消耗。' },
  shoes: { use: 'F 拾取后立即生效。', effect: '移动速度提高 20%，持续 3 秒，不提供无敌。', response: '留意对手加速后的接近距离。' },
  popcorn: { use: 'F 拾取，J 投出，一次性使用。', effect: '落地后预警 0.8 秒，爆炸造成 12 点范围伤害与击退。', response: '观察爆炸范围，及时跳开或闪避。' },
  watergun: { use: 'F 拾取，J 开火。', effect: '6 发弹药，每发命中造成 5 点伤害；用完后恢复空手攻击。', response: '利用平台与闪避接近持枪对手。' },
};

const ITEM_PATTERNS: Record<ItemKind, string[]> = {
  banana: ['................', '........OO......', '........OYOO....', '........OYYO....', '..OO....OYYO....', '..OYO...OYYO....', '...OYO.OYYO.....', '...OYYOYYYO.....', '....OYYYYO......', '..OOOYYYYOOO....', '.OYYYYYYYYYYO...', '..OOOOYYOOOO....', '......OO........'],
  shield: ['................', '.......OOOO.....', '......OYYYYO....', '......OYKYRYO...', '......OYYYYO....', '...OOOOYYYYO....', '..OYYYYYYYYO....', '.OYYYYYYYYYYO...', '.OYYYYYYYYYYO...', '..OYYYYYYYYO....', '...OOOOOOOO.....', '................', '................'],
  shoes: ['................', '...OOOO.........', '...OCCO.........', '...OCCO..OOOO...', '...OCCO..OCCO...', '...OCCOO.OCCO...', '...OCCCCOOCCO...', '...OCCCCCOCCOO..', '..OWWWWWWOOCCCO.', '..OOOOOOOOWWWWO.', '.........OOOOOO.', '................', '................'],
  popcorn: ['.......R........', '......ROR.......', '....OOWWWOO.....', '...OWWWWWWWO....', '...OWWWWWWWO....', '....ORRRRRO.....', '....ORWRWRO.....', '....ORWRWRO.....', '.....RWRWR......', '.....ORRRO......', '......OOO.......', '................', '................'],
  watergun: ['................', '.....OOO........', '...OOCCCOOOO....', '..OCCCCCCCCCO...', '..OCCCCCCCCCCOO.', '..OCCCCCCCCCCCYO', '...OOCCCOOOOOOO.', '.....OCCO.......', '.....OCCO.......', '.....OCCO.......', '......OO........', '................', '................'],
};

function itemArt(kind: ItemKind): string {
  const palette: Record<string, string> = { O: '#183047', Y: '#f4cc66', C: kind === 'shoes' ? '#83b897' : '#7db7dc', W: '#f7fbff', R: '#ed7649', K: '#183047' };
  const cells = ITEM_PATTERNS[kind].flatMap((row, y) => [...row].flatMap((value, x) => palette[value] ? [`<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[value]}"/>`] : [])).join('');
  return `<svg class="item-pixel" viewBox="0 0 16 13" shape-rendering="crispEdges" aria-hidden="true">${cells}</svg>`;
}

function readPreference(key: string): string {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

export function catalogMarkup(kind: CatalogKind): CatalogContent {
  if (kind === 'characters') return {
    title: '人物图鉴',
    subtitle: '查看角色技能与应对方式。',
    html: `<div class="catalog-grid">${Object.values(CHARACTERS).map(character => {
      const detail = CHARACTER_DETAILS[character.id];
      return `<article class="catalog-card" style="--character-color:${esc(character.color)}"><div class="catalog-portrait">${portrait(character.id)}</div><h3>${esc(character.name)}</h3><p class="catalog-role">${esc(character.title)} · 100 HP</p><p>${esc(character.description)}</p><div class="catalog-skills"><section><h4>技能 1 · ${esc(character.skill1)}</h4><p>${esc(detail.skills[0])}</p></section><section><h4>技能 2 · ${esc(character.skill2)}</h4><p>${esc(detail.skills[1])}</p></section></div><p class="catalog-tip"><b>怎么应对</b> ${esc(detail.weakness)}</p></article>`;
    }).join('')}</div>`,
  };

  if (kind === 'maps') return {
    title: '地图查看',
    subtitle: '天空、村落、山地。',
    html: `<div class="catalog-grid">${Object.values(ARENAS).map(map => {
      const detail = MAP_DETAILS[map.id];
      return `<article class="catalog-card"><img class="catalog-map" src="${esc(map.background)}" alt="${esc(map.subtitle)}"/><h3>${esc(map.name)}</h3><p class="catalog-role">${esc(map.subtitle)}</p><p>${esc(detail.layout)}</p><p class="catalog-tip">${esc(detail.approach)}</p></article>`;
    }).join('')}</div>`,
  };

  if (kind === 'items') return {
    title: '道具图鉴',
    subtitle: '查看道具效果与使用方式。',
    html: `<div class="catalog-grid">${(Object.keys(ITEM_NAMES) as ItemKind[]).map(kind => {
      const detail = ITEM_DETAILS[kind];
      return `<article class="catalog-card"><div class="catalog-portrait">${itemArt(kind)}</div><h3>${esc(ITEM_NAMES[kind])}</h3><p class="catalog-role">${esc(detail.use)}</p><p>${esc(detail.effect)}</p><p class="catalog-tip"><b>小提示</b> ${esc(detail.response)}</p></article>`;
    }).join('')}</div><p class="dialog-note">每人最多携带一件主动道具，空手时J为三段普攻。</p>`,
  };

  return {
    title: '游戏作者',
    subtitle: '填写作者或团队信息。',
    html: `<div class="author-form"><label class="field-label" for="author-name">作者名称 <span>最多 24 个字</span></label><input id="author-name" class="text-field" maxlength="24" value="${esc(readPreference('beng-author').slice(0, 24))}" placeholder="填写作者或团队名称" autocomplete="off"/><label class="field-label" for="author-description">作者介绍 <span>最多 140 个字</span></label><textarea id="author-description" class="text-field" maxlength="140" rows="4" placeholder="写一句游戏创作介绍">${esc(readPreference('beng-author-description').slice(0, 140))}</textarea><button class="secondary-button" data-action="save-author">${icon('check', 16)} 保存作者信息</button><p class="dialog-note">信息只保存在当前浏览器。</p></div>`,
  };
}
