import { ARENAS, CHARACTERS, DEFAULT_SETTINGS, FIXED_DT, ITEM_NAMES, PLAYER_HEIGHT, PLAYER_WIDTH, WORLD_HEIGHT, WORLD_WIDTH } from './config.js';
import { EMPTY_INPUT } from './types.js';
import type { GameEvent, GameSnapshot, InputState, ItemKind, MatchSettings, PlayerSnapshot, ProjectileSnapshot, RosterPlayer } from './types.js';

/** Feet coordinates: x is the centre, y is the bottom of a 32 x 50 collider. */
const SPEED = 265;
const GRAVITY = 1720;
const JUMP_SPEED = 770;
const ITEM_KINDS: ItemKind[] = ['banana', 'shield', 'shoes', 'popcorn', 'watergun'];
const ROUND_SECONDS = { '1v1': 60, '2v2': 75, ffa: 90 } as const;
type SlowStatuses = PlayerSnapshot['statuses'] & { slow?: number };
interface DamageRecord { damage: number; lastAt: number; hits: { damage: number; at: number }[] }
interface PlayerMemory {
  previous: InputState;
  attackCooldown: number;
  comboUntil: number;
  guard: number;
  guardShield: number;
  itemShield: number;
  itemShieldTime: number;
  slide: number;
  slideHits: string[];
  controlTotal: number;
  controlWindow: number;
  botThink: number;
  botInput: InputState;
  botSkillChoice: number;
  botPlatform: string;
  botGoal: string | null;
  bufferedInput: InputState;
}
interface PendingAction {
  id: string;
  ownerId: string;
  kind: 'melee' | 'pan' | 'slipper' | 'slide' | 'wave' | 'spring' | 'trap' | 'paper';
  delay: number;
  facing: number;
  move: number;
  damage: number;
  radius: number;
  combo?: number;
}
export interface GameState extends GameSnapshot {
  elapsed: number;
  roundElapsed: number;
  rng: number;
  entityId: number;
  eventId: number;
  phaseTimer: number;
  roster: RosterPlayer[];
  memory: Record<string, PlayerMemory>;
  damageLedger: Record<string, Record<string, DamageRecord>>;
  pending: PendingAction[];
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const approach = (value: number, target: number, change: number) => value < target ? Math.min(target, value + change) : Math.max(target, value - change);
const timer = (value: number, dt: number) => Math.max(0, value - dt);
function random(state: GameState): number {
  let x = state.rng | 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  state.rng = x >>> 0;
  return state.rng / 4294967296;
}
function nextId(state: GameState, prefix: string): string { return `${prefix}-${++state.entityId}`; }
function event(state: GameState, value: Omit<GameEvent, 'id'>): void {
  state.events.push({ ...value, id: ++state.eventId });
  if (state.events.length > 36) state.events.splice(0, state.events.length - 36);
}
function effect(state: GameState, kind: string, x: number, y: number, radius: number, duration: number, ownerId?: string, color?: string): void {
  state.effects.push({ id: nextId(state, 'fx'), kind, x, y, radius, ttl: duration, duration, ownerId, color });
}
function memory(): PlayerMemory {
  return { previous: { ...EMPTY_INPUT }, attackCooldown: 0, comboUntil: 0, guard: 0, guardShield: 0, itemShield: 0, itemShieldTime: 0, slide: 0, slideHits: [], controlTotal: 0, controlWindow: 0, botThink: 0, botInput: { ...EMPTY_INPUT }, botSkillChoice: 0, botPlatform: 'ground', botGoal: null, bufferedInput: { ...EMPTY_INPUT } };
}
function spawnX(state: GameState, index: number): number {
  const arena = ARENAS[state.settings.map];
  return arena.left + (arena.right - arena.left) * (index + 1) / (state.players.length + 1);
}
function makePlayer(roster: RosterPlayer): PlayerSnapshot {
  return {
    id: roster.id, name: roster.name, character: roster.character, team: roster.team,
    bot: roster.bot, difficulty: roster.difficulty, x: 0, y: 0, vx: 0, vy: 0, facing: 1,
    hp: 100, maxHp: 100, shield: 0, grounded: true, dead: false, respawnIn: 0,
    invuln: 0, controlProtection: 0, stun: 0, blocking: false,
    attackPhase: 0, attackTime: 0, action: 'idle', actionTime: 0, damageFlash: 0, idleTime: 0,
    kills: 0, deaths: 0, assists: 0, damage: 0, score: 0, heldItem: null, ammo: 0,
    cd: { dash: 0, skill1: 0, skill2: 0 }, statuses: { speed: 0 },
    jumpsLeft: 2, jumpLatch: false, downLatch: false, dropThrough: 0,
  };
}

export function createGame(settings: MatchSettings, roster: RosterPlayer[], seed = 0x1a2b3c4d): GameState {
  const normalized = { ...DEFAULT_SETTINGS, ...settings };
  normalized.roundsToWin = Math.max(1, Math.round(normalized.roundsToWin || 2));
  normalized.dropInterval = clamp(normalized.dropInterval || 15, 1, 120);
  const participants = roster.slice(0, normalized.mode === '1v1' ? 2 : 4).map((entry, index) => ({ ...entry, team: normalized.mode === '1v1' ? index : normalized.mode === 'ffa' ? index : entry.team }));
  const state: GameState = {
    phase: 'countdown', tick: 0, timeLeft: ROUND_SECONDS[normalized.mode], round: 1, roundWins: [0, 0], hitStop: 0,
    settings: normalized, players: participants.map(makePlayer), items: [], projectiles: [], effects: [], events: [], dropWarnings: [],
    dropIn: normalized.dropInterval, safeZone: { left: ARENAS[normalized.map].left, right: ARENAS[normalized.map].right },
    winner: null, result: '', countdown: 3, elapsed: 0, roundElapsed: 0,
    rng: (seed >>> 0) || 1, entityId: 0, eventId: 0, phaseTimer: 3,
    roster: participants, memory: {}, damageLedger: {}, pending: [],
  };
  state.players.forEach((player, index) => {
    player.x = spawnX(state, index); player.y = ARENAS[normalized.map].groundY;
    player.facing = player.x < 640 ? 1 : -1;
    state.memory[player.id] = memory(); state.damageLedger[player.id] = {};
  });
  return state;
}

function enemy(state: GameState, source: PlayerSnapshot, target: PlayerSnapshot): boolean {
  return source.id !== target.id && (state.settings.mode === 'ffa' || state.settings.friendlyFire || source.team !== target.team);
}
function supportAt(player: PlayerSnapshot, settings: MatchSettings) {
  return ARENAS[settings.map].platforms.find(platform => Math.abs(player.y - platform.y) < 1.5 && player.x + PLAYER_WIDTH / 2 > platform.x && player.x - PLAYER_WIDTH / 2 < platform.x + platform.width);
}
/** Shared collision and acceleration code used by the server and local prediction. */
function movePlayer(player: PlayerSnapshot, input: InputState, dt: number, settings: MatchSettings, dropThrough = 0, guard = false, slide = false): void {
  if (player.dead) return;
  const arena = ARENAS[settings.map];
  const previousY = player.y;
  const blocked = player.stun > 0;
  const groundedSupport = player.grounded ? supportAt(player, settings) : undefined;
  const jumpPressed = input.jump && !player.jumpLatch;
  const dropping = !blocked && !guard && !slide && input.down && input.jump && (!player.jumpLatch || !player.downLatch) && !!groundedSupport?.oneWay;
  player.dropThrough = timer(player.dropThrough ?? dropThrough, dt);
  if (dropping) { player.y += 3; player.grounded = false; player.vy = Math.max(80, player.vy); player.dropThrough = .26; }
  const move = blocked ? 0 : clamp(input.move || 0, -1, 1);
  if (Math.abs(move) > .15 && player.action !== 'dash' && !slide && !guard) player.facing = move > 0 ? 1 : -1;
  player.blocking = !blocked && !guard && !jumpPressed && !dropping && input.down && player.grounded && !!groundedSupport && player.attackTime <= 0 && player.actionTime <= 0;
  if (!blocked && jumpPressed && !dropping && !player.blocking && !guard && !slide) {
    if (player.grounded) player.jumpsLeft = 2;
    if ((player.jumpsLeft ?? 2) > 0) {
      player.vy = -JUMP_SPEED * (player.grounded ? 1 : .94);
      player.jumpsLeft = (player.jumpsLeft ?? 2) - 1;
      player.grounded = false;
    }
  }
  player.jumpLatch = input.jump;
  player.downLatch = input.down;
  const slow = ((player.statuses as SlowStatuses).slow ?? 0) > 0 ? .8 : 1;
  const speed = SPEED * (player.statuses.speed > 0 ? 1.2 : 1) * slow * (player.blocking ? .22 : guard ? .35 : 1);
  if (player.action === 'dash' && player.actionTime > 0 && !blocked) player.vx = player.facing * 850;
  else if (slide && !blocked) player.vx = player.facing * 650;
  else if (blocked) player.vx *= Math.max(0, 1 - 3.5 * dt);
  else player.vx = approach(player.vx, move * speed, (Math.abs(move) > .05 ? 2400 : 2100) * dt);
  player.vy = Math.min(1000, player.vy + GRAVITY * dt);
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  player.grounded = false;
  if (player.vy >= 0) {
    for (const platform of [...arena.platforms].sort((a, b) => a.y - b.y)) {
      if (platform.oneWay && ((player.dropThrough ?? 0) > 0 || dropping)) continue;
      if (player.x + PLAYER_WIDTH / 2 <= platform.x || player.x - PLAYER_WIDTH / 2 >= platform.x + platform.width) continue;
      if (previousY <= platform.y + .5 && player.y >= platform.y) {
        player.y = platform.y; player.vy = 0; player.grounded = true; player.jumpsLeft = 2; break;
      }
    }
  }
  if (player.grounded && player.actionTime <= 0 && player.attackTime <= 0 && !guard) player.action = player.blocking ? 'block' : Math.abs(player.vx) > 15 ? 'run' : 'idle';
  else if (!player.grounded && player.actionTime <= 0 && player.attackTime <= 0) player.action = player.vy < 0 ? 'jump' : 'fall';
  const noInput = Math.abs(input.move) < .05 && !input.down && !input.jump && !input.attack && !input.dash && !input.skill1 && !input.skill2 && !input.pickup;
  player.idleTime = player.grounded && noInput && !blocked && !guard && !slide && player.damageFlash <= 0 && player.action === 'idle' && Math.abs(player.vx) < 1 ? player.idleTime + dt : 0;
}

/** Movement-only prediction; damage, items and match outcomes remain authoritative. */
export function predictLocalPlayer(player: PlayerSnapshot, input: InputState, dt: number, settings: MatchSettings, hitStop = 0): PlayerSnapshot {
  const predicted = { ...player, cd: { ...player.cd }, statuses: { ...player.statuses } } as PlayerSnapshot & { dashLatch?: boolean };
  if (predicted.dead || hitStop > 0) return predicted;
  const step = Math.min(.1, Math.max(0, dt));
  predicted.actionTime = timer(predicted.actionTime, step);
  predicted.attackTime = timer(predicted.attackTime, step);
  const wasStunned = predicted.stun > 0;
  predicted.stun = timer(predicted.stun, step);
  predicted.cd.dash = timer(predicted.cd.dash, step);
  predicted.invuln = timer(predicted.invuln, step);
  if (wasStunned && predicted.stun === 0) { predicted.invuln = Math.max(predicted.invuln, .5); predicted.controlProtection = 2; }
  predicted.statuses.speed = timer(predicted.statuses.speed, step);
  predicted.statuses.slow = timer(predicted.statuses.slow ?? 0, step);
  if (Math.abs(input.move) > .15 && predicted.action !== 'dash' && predicted.action !== 'guard' && predicted.action !== 'slide') predicted.facing = input.move > 0 ? 1 : -1;
  if (input.dash && !predicted.dashLatch && predicted.cd.dash <= 0 && predicted.stun <= 0 && predicted.action !== 'guard' && predicted.action !== 'slide') {
    predicted.cd.dash = 3; predicted.action = 'dash'; predicted.actionTime = .2;
    predicted.invuln = Math.max(predicted.invuln, .2);
    if (Math.abs(input.move) > .1) predicted.facing = input.move > 0 ? 1 : -1;
  }
  movePlayer(predicted, input, step, settings, predicted.dropThrough ?? 0, predicted.action === 'guard' && predicted.actionTime > 0, predicted.action === 'slide' && predicted.actionTime > .24);
  predicted.dashLatch = input.dash;
  return predicted;
}

function useControl(state: GameState, target: PlayerSnapshot, seconds: number): boolean {
  if (seconds <= 0 || target.controlProtection > 0 || target.stun > 0) return false;
  const mem = state.memory[target.id];
  if (state.elapsed - mem.controlWindow > 8) { mem.controlWindow = state.elapsed; mem.controlTotal = 0; }
  target.stun = Math.min(.4, seconds);
  target.action = 'stunned'; target.actionTime = target.stun; target.attackTime = 0; target.idleTime = 0;
  state.pending = state.pending.filter(action => action.ownerId !== target.id);
  return true;
}
function knockOut(state: GameState, target: PlayerSnapshot, source?: PlayerSnapshot): void {
  if (target.dead) return;
  const ledger = state.damageLedger[target.id];
  if (!source) {
    const last = Object.entries(ledger).filter(([, entry]) => state.elapsed - entry.lastAt <= 6).sort((a, b) => b[1].lastAt - a[1].lastAt)[0];
    source = last ? state.players.find(player => player.id === last[0]) : undefined;
  }
  target.hp = 0; target.dead = true; target.deaths++; target.score--;
  target.blocking = false; target.stun = 0; target.heldItem = null; target.ammo = 0; target.shield = 0; target.idleTime = 0;
  target.vx = 0; target.vy = 0; target.action = 'ko'; target.actionTime = 0;
  target.respawnIn = state.settings.mode === 'ffa' ? 2 : 0;
  if (source && source.id !== target.id) { source.kills++; source.score += 2; }
  for (const [id, record] of Object.entries(ledger)) {
    const recentDamage = record.hits.filter(entry => state.elapsed - entry.at <= 6).reduce((sum, entry) => sum + entry.damage, 0);
    if (id === source?.id || id === target.id || recentDamage < 25 || state.elapsed - record.lastAt > 6) continue;
    const assistant = state.players.find(player => player.id === id);
    if (assistant) { assistant.assists++; assistant.score++; }
  }
  state.memory[target.id].guard = 0; state.memory[target.id].guardShield = 0;
  state.memory[target.id].itemShield = 0; state.memory[target.id].itemShieldTime = 0;
  state.damageLedger[target.id] = {};
  effect(state, 'ko', target.x, target.y - 25, 65, .7, target.id, '#ffdd87');
  event(state, { type: 'ko', actorId: source?.id, targetId: target.id, x: target.x, y: target.y - 25, text: source ? `${source.name} 让 ${target.name} 绷不住了` : `${target.name} 绷不住了` });
}
function hit(state: GameState, source: PlayerSnapshot, target: PlayerSnapshot, damage: number, knockback: number, control: number, sourceX = source.x, heavy = false): boolean {
  if (target.dead || target.invuln > 0 || !enemy(state, source, target)) return false;
  const mem = state.memory[target.id];
  const front = (sourceX - target.x) * target.facing >= -4;
  const guarded = front && (target.blocking || mem.guard > 0);
  let amount = front && target.blocking ? Math.ceil(damage * .4) : damage;
  const availableShield = Math.max(mem.itemShield, front ? mem.guardShield : 0);
  const absorbed = Math.min(availableShield, amount);
  amount -= absorbed;
  mem.itemShield = Math.max(0, mem.itemShield - absorbed);
  if (front) mem.guardShield = Math.max(0, mem.guardShield - absorbed);
  target.shield = Math.max(mem.itemShield, mem.guardShield);
  const actual = Math.min(target.hp, amount);
  target.hp = Math.max(0, target.hp - amount); target.damageFlash = 2 * FIXED_DT; target.idleTime = 0;
  source.damage = Math.round((source.damage + actual) * 1000) / 1000;
  if (actual > 0) {
    const ledger = state.damageLedger[target.id];
    const old = ledger[source.id];
    const hits = [...(old?.hits ?? []).filter(entry => state.elapsed - entry.at <= 6), { damage: actual, at: state.elapsed }];
    ledger[source.id] = { damage: hits.reduce((sum, entry) => sum + entry.damage, 0), lastAt: state.elapsed, hits };
  }
  const direction = Math.sign(target.x - sourceX) || source.facing;
  target.vx = direction * knockback * (guarded ? .4 : 1);
  if (!guarded && knockback > 0) target.vy = Math.min(target.vy, -Math.min(220, knockback * .4));
  const stunned = !guarded && useControl(state, target, control);
  if (heavy && stunned && target.hp > 0 && target.heldItem === 'watergun') {
    state.items.push({ id: nextId(state, 'disarmed'), kind: 'watergun', x: target.x, y: target.y - 28, vy: -140, landed: false, ttl: 20, ammo: target.ammo });
    target.heldItem = null; target.ammo = 0;
    effect(state, 'disarm', target.x, target.y - 28, 30, .35, target.id, '#ffdd72');
  }
  const hitStop = heavy ? 6 * FIXED_DT : 3 * FIXED_DT;
  state.hitStop = Math.max(state.hitStop, hitStop);
  effect(state, guarded ? 'block' : 'hit', target.x, target.y - 28, guarded ? 27 : 35, .2, source.id, guarded ? '#80e5ff' : '#ffdd72');
  event(state, { type: 'hit', actorId: source.id, targetId: target.id, x: target.x, y: target.y - 28, damage: actual, heavy, guarded, direction, hitStop, text: guarded ? `挡住！${actual}` : `${actual}` });
  if (target.hp <= 0) knockOut(state, target, source);
  return true;
}
function inRange(source: PlayerSnapshot, target: PlayerSnapshot, radius: number, front = false): boolean {
  const dx = target.x - source.x;
  return Math.abs(dx) <= radius + PLAYER_WIDTH / 2 && Math.abs((target.y - PLAYER_HEIGHT / 2) - (source.y - PLAYER_HEIGHT / 2)) <= 62 && (!front || dx * source.facing >= -12);
}
function queue(state: GameState, owner: PlayerSnapshot, kind: PendingAction['kind'], delay: number, damage: number, radius: number, input: InputState): void {
  state.pending.push({ id: nextId(state, 'action'), ownerId: owner.id, kind, delay, facing: owner.facing, move: input.move, damage, radius, combo: owner.attackPhase });
}
function projectile(state: GameState, owner: PlayerSnapshot, kind: string, damage: number, vx: number, vy: number, radius: number, ttl: number, x = owner.x + owner.facing * 28, y = owner.y - 28, fuse?: number): void {
  state.projectiles.push({ id: nextId(state, 'shot'), kind, ownerId: owner.id, team: owner.team, x, y, vx, vy, radius, ttl, damage, timer: fuse });
}
function cancelSpawnProtection(player: PlayerSnapshot): void { player.invuln = player.action === 'dash' ? player.invuln : 0; }
function doAttack(state: GameState, player: PlayerSnapshot, input: InputState): void {
  const mem = state.memory[player.id];
  if (mem.attackCooldown > 0 || mem.guard > 0 || player.stun > 0 || player.action === 'dash' || mem.slide > 0) return;
  cancelSpawnProtection(player);
  player.blocking = false;
  if (player.heldItem) {
    player.action = 'throw'; player.actionTime = .24; mem.attackCooldown = .32;
    if (player.heldItem === 'banana') {
      projectile(state, player, 'banana', 0, player.facing * 390, -250, 12, 5);
    } else if (player.heldItem === 'popcorn') {
      projectile(state, player, 'popcorn', 12, player.facing * 330, -390, 15, 8);
    } else if (player.heldItem === 'watergun') {
      projectile(state, player, 'water', 5, player.facing * 800, 0, 8, .8);
      mem.attackCooldown = .22;
    }
    player.ammo--;
    if (player.ammo <= 0) { player.heldItem = null; player.ammo = 0; }
    return;
  }
  player.attackPhase = state.elapsed < mem.comboUntil ? player.attackPhase % 3 + 1 : 1;
  const damage = player.attackPhase === 3 ? 12 : 8;
  player.attackTime = player.attackPhase === 3 ? .3 : .23;
  player.action = `attack${player.attackPhase}`; player.actionTime = player.attackTime;
  mem.attackCooldown = player.attackPhase === 3 ? .4 : .27; mem.comboUntil = state.elapsed + .85;
  queue(state, player, 'melee', .065, damage, player.attackPhase === 3 ? 67 : 56, input);
  effect(state, 'swipe', player.x + player.facing * 35, player.y - 27, player.attackPhase === 3 ? 48 : 35, .18, player.id, CHARACTERS[player.character].color);
}
function doSkill(state: GameState, player: PlayerSnapshot, slot: 1 | 2, input: InputState): void {
  const mem = state.memory[player.id];
  const key = slot === 1 ? 'skill1' : 'skill2';
  if (player.cd[key] > 0 || player.stun > 0 || mem.guard > 0 || mem.slide > 0 || player.action === 'dash' || mem.attackCooldown > .1) return;
  cancelSpawnProtection(player); player.blocking = false;
  const spec: Record<string, [number, PendingAction['kind'], number, number, number]> = {
    uncle1: [8, 'pan', .24, 18, 84], uncle2: [10, 'pan', 0, 0, 0],
    slipper1: [7, 'slipper', .2, 10, 12], slipper2: [9, 'slide', .22, 12, 65],
    chicken1: [8, 'wave', .27, 12, 145], chicken2: [8, 'spring', .15, 0, 0],
    raccoon1: [10, 'trap', .25, 14, 72], raccoon2: [7, 'paper', .18, 10, 12],
  };
  const [cooldown, kind, windup, damage, radius] = spec[`${player.character}${slot}`];
  player.cd[key] = cooldown; player.action = `skill${slot}`; player.actionTime = windup + .26;
  mem.attackCooldown = windup + .18;
  if (player.character === 'uncle' && slot === 2) {
    mem.guardShield = 20; mem.guard = 1;
    player.shield = Math.max(mem.itemShield, mem.guardShield);
    player.action = 'guard'; player.actionTime = 1;
    effect(state, 'guard', player.x, player.y - 25, 45, 1, player.id, '#7bd7ff');
  } else {
    queue(state, player, kind, windup, damage, radius, input);
    effect(state, 'telegraph', player.x + (kind === 'spring' ? 0 : player.facing * 45), player.y - 18, radius || 40, Math.max(.15, windup), player.id, CHARACTERS[player.character].color);
  }
  event(state, { type: 'skill', actorId: player.id, x: player.x, y: player.y - 35, text: slot === 1 ? CHARACTERS[player.character].skill1 : CHARACTERS[player.character].skill2 });
}
function resolveActions(state: GameState, dt: number): void {
  const ready: PendingAction[] = [];
  state.pending = state.pending.filter(action => { action.delay -= dt; if (action.delay <= 0) { ready.push(action); return false; } return true; });
  for (const action of ready) {
    const source = state.players.find(player => player.id === action.ownerId);
    if (!source || source.dead || source.stun > 0) continue;
    const facing = action.facing;
    if (action.kind === 'slipper') projectile(state, source, 'slipper', action.damage, facing * 690, 0, 13, 1.15);
    else if (action.kind === 'paper') projectile(state, source, 'paper', action.damage, facing * 560, 0, 12, 1.4);
    else if (action.kind === 'trap') {
      state.projectiles = state.projectiles.filter(shot => shot.kind !== 'trap' || shot.ownerId !== source.id);
      projectile(state, source, 'trap', action.damage, facing * 110, -150, 16, 8, source.x + facing * 60, source.y - 20, .55);
    } else if (action.kind === 'spring') {
      source.vy = -950; source.vx = clamp(action.move || facing * .45, -1, 1) * 370;
      source.grounded = false; source.jumpsLeft = 1;
      effect(state, 'spring', source.x, source.y, 45, .45, source.id, '#8ff6ba');
    } else if (action.kind === 'slide') {
      state.memory[source.id].slide = .28; state.memory[source.id].slideHits = [];
      source.facing = facing; source.action = 'slide'; source.actionTime = .52;
    } else {
      const snapshotFacing = source.facing; source.facing = facing;
      for (const target of state.players) {
        const heavy = action.kind === 'melee' && action.combo === 3;
        const control = action.kind === 'pan' ? .3 : heavy ? .35 : action.kind === 'melee' ? 0 : .1;
        if (inRange(source, target, action.radius, true)) hit(state, source, target, action.damage, action.kind === 'wave' ? 470 : action.kind === 'pan' ? 330 : heavy ? 310 : 190, control, source.x, heavy);
      }
      // Basic attacks can destroy visible paper projectiles and spring packages.
      if (action.kind === 'melee') {
        state.projectiles = state.projectiles.filter(shot => {
          if (!['paper', 'trap'].includes(shot.kind) || shot.ownerId === source.id) return true;
          const close = Math.abs(shot.x - source.x) <= action.radius + shot.radius && Math.abs(shot.y - (source.y - 25)) < 65 && (shot.x - source.x) * facing >= -12;
          if (close) effect(state, 'poof', shot.x, shot.y, 27, .25, source.id);
          return !close;
        });
      }
      effect(state, action.kind === 'wave' ? 'wave' : 'swipe', source.x + facing * 55, source.y - 27, action.radius, .25, source.id, CHARACTERS[source.character].color);
      source.facing = snapshotFacing;
    }
  }
}

function pickup(state: GameState, player: PlayerSnapshot): void {
  const nearest = state.items.filter(item => item.landed && Math.abs(item.x - player.x) < 55 && Math.abs(item.y - player.y) < 60).sort((a, b) => Math.abs(a.x - player.x) - Math.abs(b.x - player.x))[0];
  if (!nearest) return;
  if (!['shield', 'shoes'].includes(nearest.kind) && player.heldItem) return;
  state.items = state.items.filter(item => item.id !== nearest.id);
  if (nearest.kind === 'shield') {
    const mem = state.memory[player.id]; mem.itemShield = 15; mem.itemShieldTime = 4;
    player.shield = Math.max(mem.itemShield, mem.guardShield);
  }
  else if (nearest.kind === 'shoes') player.statuses.speed = 3;
  else { player.heldItem = nearest.kind; player.ammo = nearest.kind === 'watergun' ? nearest.ammo ?? 6 : 1; }
  event(state, { type: 'pickup', actorId: player.id, x: player.x, y: player.y - 30, text: `${player.name} 拾取${ITEM_NAMES[nearest.kind]}` });
  effect(state, 'pickup', player.x, player.y - 25, 35, .35, player.id, '#fff59d');
}
function planDrop(state: GameState): void {
  const arena = ARENAS[state.settings.map];
  const count = state.players.length;
  for (let index = 0; index < count; index++) {
    const kind = ITEM_KINDS[Math.floor(random(state) * ITEM_KINDS.length)];
    const section = (index + .25 + random(state) * .5) / count;
    const x = arena.left + 35 + section * (arena.right - arena.left - 70);
    const platform = [...arena.platforms].sort((a, b) => a.y - b.y).find(surface => x >= surface.x && x <= surface.x + surface.width)!;
    state.dropWarnings.push({ id: nextId(state, 'drop'), kind, x, y: platform.y, inSeconds: Math.max(0, state.dropIn) });
  }
}
function dropItems(state: GameState): void {
  if (!state.dropWarnings.length) planDrop(state);
  state.dropWarnings.forEach((warning, index) => {
    state.items.push({ id: warning.id, kind: warning.kind, x: warning.x, y: -30 - index * 16, vy: 40, landed: false, ttl: Math.max(16, state.settings.dropInterval + 5) });
  });
  event(state, { type: 'drop', text: `欢乐空投！${state.dropWarnings.length} 件道具从天而降`, count: state.dropWarnings.length });
  state.dropWarnings = [];
}
function updateItems(state: GameState, dt: number): void {
  const arena = ARENAS[state.settings.map];
  state.items = state.items.filter(item => {
    item.ttl -= dt;
    if (!item.landed) {
      const previousY = item.y; item.vy += GRAVITY * .45 * dt; item.y += item.vy * dt;
      for (const platform of [...arena.platforms].sort((a, b) => a.y - b.y)) {
        if (item.x < platform.x || item.x > platform.x + platform.width) continue;
        if (previousY <= platform.y - 9 && item.y >= platform.y - 9) { item.y = platform.y - 9; item.vy = 0; item.landed = true; break; }
      }
    }
    return item.ttl > 0;
  });
}
function updateProjectiles(state: GameState, dt: number): void {
  const arena = ARENAS[state.settings.map];
  state.projectiles = state.projectiles.filter(shot => {
    shot.ttl -= dt;
    if (shot.timer !== undefined) shot.timer -= dt;
    const source = state.players.find(player => player.id === shot.ownerId);
    if (!source || shot.ttl <= 0) return false;
    const previousY = shot.y;
    if (['banana', 'popcorn', 'trap'].includes(shot.kind)) shot.vy = Math.min(900, shot.vy + GRAVITY * .7 * dt);
    shot.x += shot.vx * dt; shot.y += shot.vy * dt;
    if (['banana', 'popcorn', 'trap'].includes(shot.kind)) {
      for (const platform of [...arena.platforms].sort((a, b) => a.y - b.y)) {
        if (shot.x < platform.x || shot.x > platform.x + platform.width) continue;
        if (shot.vy >= 0 && previousY <= platform.y - shot.radius && shot.y >= platform.y - shot.radius) {
          shot.y = platform.y - shot.radius; shot.vy = 0; shot.vx = 0;
          if (shot.kind === 'popcorn' && shot.timer === undefined) {
            shot.timer = .8;
            effect(state, 'bomb-warning', shot.x, shot.y, 105, .8, shot.id, '#ff7171');
          }
          break;
        }
      }
    }
    if (shot.kind === 'popcorn') {
      if (shot.timer !== undefined && shot.timer <= 0) {
        for (const target of state.players) if (Math.hypot(target.x - shot.x, target.y - 25 - shot.y) <= 105) hit(state, source, target, shot.damage, 310, .25, shot.x);
        effect(state, 'explosion', shot.x, shot.y, 105, .45, source.id, '#ffbb5c'); return false;
      }
      return true;
    }
    if (shot.kind === 'trap' && (shot.timer ?? 1) > 0) return true;
    for (const target of state.players) {
      if (target.dead || !enemy(state, source, target)) continue;
      if (Math.abs(target.x - shot.x) > PLAYER_WIDTH / 2 + shot.radius || shot.y < target.y - PLAYER_HEIGHT - shot.radius || shot.y > target.y + shot.radius) continue;
      const landed = hit(state, source, target, shot.damage, shot.kind === 'banana' ? 0 : shot.kind === 'trap' ? 80 : 160, shot.kind === 'banana' ? .3 : shot.kind === 'trap' ? 0 : .12, shot.x - Math.sign(shot.vx || source.facing) * 20);
      if (landed) {
        if (shot.kind === 'trap') { (target.statuses as SlowStatuses).slow = 1; effect(state, 'trap-trigger', shot.x, shot.y, 65, .4, source.id, '#c1a5ff'); }
        return false;
      }
    }
    return shot.x > arena.left - 120 && shot.x < arena.right + 120 && shot.y < 850;
  });
}

function botInput(state: GameState, player: PlayerSnapshot, dt: number): InputState {
  const mem = state.memory[player.id]; mem.botThink -= dt;
  if (mem.botThink > 0) return { ...mem.botInput };
  const profile = player.difficulty === 'easy' ? { interval: .38, attack: .48, skill: .12, dash: .1, guard: .1 } : player.difficulty === 'hard' ? { interval: .075, attack: .95, skill: .72, dash: .55, guard: .68 } : { interval: .18, attack: .76, skill: .38, dash: .3, guard: .35 };
  mem.botThink = profile.interval + random(state) * profile.interval * .3;
  const enemies = state.players.filter(target => !target.dead && target.id !== player.id && (state.settings.mode === 'ffa' || target.team !== player.team));
  const target = enemies.sort((a, b) => Math.abs(a.x - player.x) + Math.abs(a.y - player.y) * .4 - Math.abs(b.x - player.x) - Math.abs(b.y - player.y) * .4)[0];
  const input: InputState = { ...EMPTY_INPUT };
  if (!target) { mem.botInput = input; return input; }
  const dx = target.x - player.x; const dy = target.y - player.y;
  input.move = Math.abs(dx) > 45 ? Math.sign(dx) : 0;
  const arena = ARENAS[state.settings.map];
  const currentPlatform = player.grounded ? supportAt(player, state.settings) : undefined;
  if (currentPlatform) mem.botPlatform = currentPlatform.id;
  const targetPlatform = supportAt(target, state.settings) ?? arena.platforms.filter(platform => platform.x <= target.x && platform.x + platform.width >= target.x && platform.y >= target.y - 2).sort((a, b) => a.y - b.y)[0];
  // Follow a short platform route rather than jumping forever directly below a high target.
  if (player.difficulty !== 'easy' && currentPlatform) {
    mem.botGoal = null;
    if (targetPlatform && targetPlatform.y < currentPlatform.y - 35) {
      const candidates = arena.platforms.filter(platform => platform.oneWay && platform.y < currentPlatform.y - 35 && platform.y >= targetPlatform.y - 2 && currentPlatform.y - platform.y <= 180);
      candidates.sort((a, b) => {
        const cost = (platform: typeof a) => Math.abs(clamp(player.x, platform.x + 35, platform.x + platform.width - 35) - player.x) + Math.abs(target.x - (platform.x + platform.width / 2)) * .32;
        return cost(a) - cost(b);
      });
      mem.botGoal = candidates[0]?.id ?? targetPlatform.id;
    }
  }
  const goal = mem.botGoal ? arena.platforms.find(platform => platform.id === mem.botGoal) : undefined;
  const goalX = goal ? clamp(player.x, goal.x + 38, goal.x + goal.width - 38) : target.x;
  if (goal && targetPlatform && targetPlatform.y < (arena.platforms.find(platform => platform.id === mem.botPlatform)?.y ?? arena.groundY) - 30) {
    const goalDistance = goalX - player.x;
    input.move = Math.abs(goalDistance) > 9 ? Math.sign(goalDistance) : 0;
    if (player.grounded) input.jump = !mem.botInput.jump && Math.abs(goalDistance) <= 155;
    else input.jump = !mem.botInput.jump && (player.jumpsLeft ?? 0) > 0 && player.vy > -110 && (player.y > goal.y + 4 || Math.abs(goalDistance) > 70);
  }
  if (player.x < state.safeZone.left + 35) input.move = 1;
  if (player.x > state.safeZone.right - 35) input.move = -1;
  const nearbyItem = state.items.find(item => item.landed && Math.abs(item.x - player.x) < 160 && Math.abs(item.y - player.y) < 100);
  if (nearbyItem && !player.heldItem && Math.abs(dx) > 150) input.move = Math.sign(nearbyItem.x - player.x);
  input.pickup = !!nearbyItem && Math.abs(nearbyItem.x - player.x) < 55;
  const threatened = Math.abs(dx) < 110 && target.attackTime > 0;
  const wantsDrop = dy > 70 && player.grounded && !!supportAt(player, state.settings)?.oneWay;
  input.down = (threatened && random(state) < profile.guard) || wantsDrop;
  if (!goal) input.jump = !mem.botInput.jump && ((dy < -55 && Math.abs(dx) < 260 && (player.grounded || player.vy > -110)) || (player.grounded && random(state) < (player.difficulty === 'easy' ? .04 : .14) && Math.abs(dx) < 210));
  if (wantsDrop) input.jump = !mem.botInput.jump;
  input.attack = Math.abs(dx) < (player.heldItem ? 370 : 77) && Math.abs(dy) < 60 && random(state) < profile.attack;
  input.dash = !goal && !mem.botInput.dash && player.cd.dash <= 0 && ((Math.abs(dx) > 220 && Math.abs(dx) < 460) || threatened) && random(state) < profile.dash;
  const skillRange = player.character === 'raccoon' || player.character === 'slipper' ? 390 : 155;
  if (Math.abs(dx) < skillRange && Math.abs(dy) < 85 && random(state) < profile.skill) {
    mem.botSkillChoice = (mem.botSkillChoice + 1) % 2;
    input.skill1 = mem.botSkillChoice === 0 && player.cd.skill1 <= 0 && !mem.botInput.skill1;
    input.skill2 = mem.botSkillChoice === 1 && player.cd.skill2 <= 0 && !mem.botInput.skill2;
  }
  mem.botInput = { ...input }; return input;
}

function resetRound(state: GameState): void {
  state.round++; state.timeLeft = ROUND_SECONDS[state.settings.mode]; state.roundElapsed = 0;
  state.items = []; state.projectiles = []; state.effects = []; state.pending = []; state.dropWarnings = []; state.hitStop = 0;
  state.dropIn = state.settings.dropInterval; state.phase = 'countdown'; state.countdown = 3; state.phaseTimer = 3;
  state.safeZone = { left: ARENAS[state.settings.map].left, right: ARENAS[state.settings.map].right };
  state.result = ''; state.winner = null;
  state.players = state.players.map((old, index) => {
    const fresh = makePlayer({ ...state.roster[index], bot: old.bot, difficulty: old.difficulty });
    Object.assign(fresh, { kills: old.kills, deaths: old.deaths, assists: old.assists, damage: old.damage, score: old.score });
    fresh.x = spawnX(state, index); fresh.y = ARENAS[state.settings.map].groundY; fresh.facing = fresh.x < 640 ? 1 : -1;
    state.memory[fresh.id] = memory(); state.damageLedger[fresh.id] = {};
    return fresh;
  });
}
function finishRound(state: GameState, team: number | null): void {
  if (state.phase !== 'playing') return;
  if (team !== null) state.roundWins[team] = (state.roundWins[team] ?? 0) + 1;
  const winnerPlayers = team === null ? [] : state.players.filter(player => player.team === team);
  const name = state.settings.mode === '1v1' ? winnerPlayers[0]?.name ?? `玩家 ${team! + 1}` : team === 0 ? '蓝队' : '红队';
  state.winner = team === null ? null : `team:${team}`;
  state.result = team === null ? '本轮平局 · 双方不加轮胜' : `${name} 拿下第 ${state.round} 轮！`;
  state.phase = team !== null && state.roundWins[team] >= state.settings.roundsToWin ? 'matchEnd' : 'roundEnd';
  state.phaseTimer = 3; state.countdown = 3;
  if (state.phase === 'matchEnd') state.result = `${name} 获胜！${state.roundWins.join(' : ')}`;
  event(state, { type: state.phase === 'matchEnd' ? 'win' : 'round', text: state.result });
}
function evaluateRound(state: GameState): void {
  if (state.settings.mode === 'ffa') {
    if (state.timeLeft > 0) return;
    const sorted = [...state.players].sort((a, b) => b.score - a.score || b.kills - a.kills || b.damage - a.damage);
    const first = sorted[0];
    const winners = first ? sorted.filter(player => player.score === first.score && player.kills === first.kills && player.damage === first.damage) : [];
    state.winner = winners.length === 1 ? winners[0].id : null;
    state.phase = 'matchEnd'; state.result = winners.length === 1 ? `${winners[0].name} 获胜！${winners[0].score} 分` : `${winners.map(player => player.name).join('、')} 并列获胜！`;
    event(state, { type: 'win', text: state.result }); return;
  }
  const teams = [0, 1].map(team => state.players.filter(player => player.team === team && !player.dead));
  if (!teams[0].length || !teams[1].length) { finishRound(state, !teams[0].length && !teams[1].length ? null : teams[0].length ? 0 : 1); return; }
  if (state.timeLeft > 0) return;
  if (state.settings.mode === '2v2' && teams[0].length !== teams[1].length) { finishRound(state, teams[0].length > teams[1].length ? 0 : 1); return; }
  const hp = teams.map(team => team.reduce((sum, player) => sum + player.hp, 0));
  finishRound(state, Math.abs(hp[0] - hp[1]) < .0001 ? null : hp[0] > hp[1] ? 0 : 1);
}
function respawn(state: GameState, player: PlayerSnapshot): void {
  const arena = ARENAS[state.settings.map];
  const candidates = [.18, .36, .64, .82].map(ratio => arena.left + ratio * (arena.right - arena.left));
  const alive = state.players.filter(other => other.id !== player.id && !other.dead);
  candidates.sort((a, b) => Math.min(...alive.map(other => Math.abs(b - other.x)), 2000) - Math.min(...alive.map(other => Math.abs(a - other.x)), 2000));
  player.x = clamp(candidates[0], state.safeZone.left + 20, state.safeZone.right - 20); player.y = arena.groundY;
  player.hp = player.maxHp; player.dead = false; player.respawnIn = 0; player.invuln = 1;
  player.vx = 0; player.vy = 0; player.grounded = true; player.jumpsLeft = 2; player.jumpLatch = false; player.dropThrough = 0;
  player.controlProtection = 0; player.stun = 0; player.blocking = false; player.shield = 0;
  player.attackTime = 0; player.attackPhase = 0; player.actionTime = 0; player.action = 'idle'; player.idleTime = 0;
  player.statuses = { speed: 0 };
  const mem = state.memory[player.id]; mem.attackCooldown = 0; mem.slide = 0; mem.controlTotal = 0; mem.controlWindow = state.elapsed;
  mem.guard = 0; mem.guardShield = 0; mem.itemShield = 0; mem.itemShieldTime = 0;
  effect(state, 'respawn', player.x, player.y - 25, 50, .7, player.id, '#baf5ff');
}
function tickPlayer(state: GameState, player: PlayerSnapshot, input: InputState, dt: number): void {
  const mem = state.memory[player.id];
  player.cd.dash = timer(player.cd.dash, dt); player.cd.skill1 = timer(player.cd.skill1, dt); player.cd.skill2 = timer(player.cd.skill2, dt);
  player.invuln = timer(player.invuln, dt); player.controlProtection = timer(player.controlProtection, dt);
  player.damageFlash = timer(player.damageFlash, dt); player.attackTime = timer(player.attackTime, dt); player.actionTime = timer(player.actionTime, dt);
  player.statuses.speed = timer(player.statuses.speed, dt);
  const statuses = player.statuses as SlowStatuses; statuses.slow = timer(statuses.slow ?? 0, dt);
  mem.attackCooldown = timer(mem.attackCooldown, dt);
  if (mem.guard > 0) {
    mem.guard = timer(mem.guard, dt);
    if (mem.guard === 0) mem.guardShield = 0;
  }
  mem.itemShieldTime = timer(mem.itemShieldTime, dt);
  if (mem.itemShieldTime === 0) mem.itemShield = 0;
  player.shield = Math.max(mem.itemShield, mem.guardShield);
  if (player.stun > 0) {
    mem.controlTotal += Math.min(dt, player.stun); player.stun = timer(player.stun, dt);
    const escaped = mem.controlTotal > .8;
    if (escaped) { player.stun = 0; player.invuln = Math.max(.4, player.invuln); mem.controlTotal = 0; effect(state, 'escape', player.x, player.y - 25, 55, .4, player.id, '#9decff'); }
    if (player.stun === 0) {
      player.controlProtection = 2;
      // Escape already has its own .4 s protection; a normal get-up has .5 s.
      if (!escaped) player.invuln = Math.max(player.invuln, .5);
    }
  }
  if (input.seq !== undefined) player.lastInputSeq = input.seq;
  if (player.dead) {
    if (state.settings.mode === 'ffa') { player.respawnIn = timer(player.respawnIn, dt); if (player.respawnIn === 0) respawn(state, player); }
    (player as PlayerSnapshot & { dashLatch?: boolean }).dashLatch = input.dash;
    mem.previous = { ...input }; return;
  }
  if (player.stun <= 0) {
    if (Math.abs(input.move) > .15 && mem.guard <= 0 && mem.slide <= 0 && player.action !== 'dash') player.facing = input.move > 0 ? 1 : -1;
    if (input.pickup && !mem.previous.pickup) pickup(state, player);
    if (input.dash && !mem.previous.dash && player.cd.dash <= 0 && mem.guard <= 0 && mem.slide <= 0) {
      player.cd.dash = 3; player.action = 'dash'; player.actionTime = .2; player.invuln = Math.max(player.invuln, .2);
      if (Math.abs(input.move) > .1) player.facing = input.move > 0 ? 1 : -1;
      effect(state, 'dash', player.x, player.y - 25, 35, .24, player.id, '#dcf4ff');
    }
    if (input.skill1 && !mem.previous.skill1) doSkill(state, player, 1, input);
    else if (input.skill2 && !mem.previous.skill2) doSkill(state, player, 2, input);
    else if (input.attack) doAttack(state, player, input);
  }
  movePlayer(player, input, dt, state.settings, player.dropThrough ?? 0, mem.guard > 0, mem.slide > 0);
  if (player.x < -PLAYER_WIDTH / 2 || player.x > WORLD_WIDTH + PLAYER_WIDTH / 2 || player.y > WORLD_HEIGHT + PLAYER_HEIGHT) {
    knockOut(state, player); mem.previous = { ...input }; return;
  }
  if (mem.slide > 0) {
    mem.slide = timer(mem.slide, dt);
    for (const target of state.players) {
      if (mem.slideHits.includes(target.id) || !inRange(player, target, 56, true)) continue;
      if (hit(state, player, target, 12, 330, .2)) mem.slideHits.push(target.id);
    }
    if (mem.slide === 0) { player.vx *= .25; player.action = 'recovery'; player.actionTime = .24; mem.attackCooldown = Math.max(mem.attackCooldown, .24); }
  }
  mem.previous = { ...input };
  (player as PlayerSnapshot & { dashLatch?: boolean }).dashLatch = input.dash;
}
function stepTick(state: GameState, inputById: Record<string, InputState>, dt: number): void {
  if (state.phase === 'matchEnd') return;
  state.tick++;
  if (state.hitStop > 0) {
    state.hitStop = state.hitStop <= dt + .000001 ? 0 : state.hitStop - dt;
    // Acknowledge inputs even while the world is stopped. Preserve taps for the
    // first live tick so a one-frame jump, dash, skill or pickup is never lost.
    for (const player of state.players) {
      if (player.bot) continue;
      const raw = inputById[player.id] ?? EMPTY_INPUT;
      const buffered = state.memory[player.id].bufferedInput;
      for (const key of ['jump', 'attack', 'dash', 'skill1', 'skill2', 'pickup'] as const) buffered[key] ||= raw[key];
      buffered.down = raw.down || (buffered.jump && buffered.down);
      buffered.move = clamp(Number(raw.move) || 0, -1, 1);
      if (raw.seq !== undefined) { buffered.seq = raw.seq; player.lastInputSeq = raw.seq; }
    }
    return;
  }
  state.elapsed += dt;
  state.effects = state.effects.filter(item => (item.ttl -= dt) > 0);
  if (state.phase === 'countdown' || state.phase === 'roundEnd') {
    state.phaseTimer = timer(state.phaseTimer, dt); state.countdown = state.phaseTimer;
    if (state.phaseTimer === 0) {
      if (state.phase === 'roundEnd') resetRound(state);
      else { state.phase = 'playing'; state.countdown = 0; event(state, { type: 'round', text: `第 ${state.round} 轮 · 开打！` }); }
    }
    return;
  }
  state.roundElapsed += dt; state.timeLeft = timer(state.timeLeft, dt);
  if (state.timeLeft < .000001) state.timeLeft = 0;
  const arena = ARENAS[state.settings.map];
  const shrink = state.settings.mode !== 'ffa' && state.timeLeft < 15 ? (15 - state.timeLeft) / 15 : 0;
  const inset = (arena.right - arena.left) * .29 * shrink;
  state.safeZone.left = arena.left + inset; state.safeZone.right = arena.right - inset;
  for (const player of state.players) {
    const raw = player.bot ? botInput(state, player, dt) : inputById[player.id] ?? EMPTY_INPUT;
    const input = { ...EMPTY_INPUT, ...raw, move: clamp(Number(raw.move) || 0, -1, 1) };
    const mem = state.memory[player.id];
    if (!player.bot) {
      for (const key of ['jump', 'attack', 'dash', 'skill1', 'skill2', 'pickup'] as const) input[key] ||= mem.bufferedInput[key];
      if (mem.bufferedInput.jump && mem.bufferedInput.down) input.down = true;
    }
    mem.bufferedInput = { ...EMPTY_INPUT };
    tickPlayer(state, player, input, dt);
  }
  resolveActions(state, dt); updateProjectiles(state, dt); updateItems(state, dt);
  for (const player of state.players) {
    if (state.settings.mode !== 'ffa' && !player.dead && player.invuln <= 0 && (player.x < state.safeZone.left || player.x > state.safeZone.right)) {
      player.hp = Math.max(0, player.hp - 11 * dt); player.damageFlash = .08;
      if (player.hp <= 0) knockOut(state, player);
    }
  }
  evaluateRound(state);
  if (state.phase !== 'playing') { state.dropWarnings = []; state.hitStop = 0; return; }
  if (state.settings.itemsEnabled) {
    state.dropIn -= dt;
    if (state.dropIn <= 2.000001 && state.timeLeft > state.dropIn + .000001 && !state.dropWarnings.length) planDrop(state);
    state.dropWarnings.forEach(warning => { warning.inSeconds = Math.max(0, state.dropIn); });
    while (state.dropIn <= .000001) { dropItems(state); state.dropIn += state.settings.dropInterval; }
  }
}

/** Advances in <= 1/60 s increments, keeping collisions stable during a slow server tick. */
export function stepGame(state: GameState, inputById: Record<string, InputState>, dt = FIXED_DT): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  let remaining = dt;
  while (remaining > .0000001) { const step = Math.min(FIXED_DT, remaining); stepTick(state, inputById, step); remaining -= step; }
}

export function snapshotGame(state: GameState): GameSnapshot {
  return structuredClone({
    phase: state.phase, tick: state.tick, timeLeft: state.timeLeft, round: state.round, roundWins: state.roundWins, hitStop: state.hitStop,
    settings: state.settings, players: state.players, items: state.items, projectiles: state.projectiles,
    effects: state.effects, events: state.events, dropIn: state.dropIn, dropWarnings: state.dropWarnings, safeZone: state.safeZone,
    winner: state.winner, result: state.result, countdown: state.countdown,
  });
}
