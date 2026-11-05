import assert from 'node:assert/strict';
import test from 'node:test';
import { ARENAS, DEFAULT_SETTINGS, FIXED_DT, PLAYER_HEIGHT, PLAYER_WIDTH, WORLD_HEIGHT, WORLD_WIDTH } from '../shared/config.js';
import { createGame, predictLocalPlayer, snapshotGame, stepGame } from '../shared/game.js';
import type { GameState } from '../shared/game.js';
import { EMPTY_INPUT } from '../shared/types.js';
import type { CharacterId, Difficulty, GameMode, InputState, RosterPlayer } from '../shared/types.js';

const roster = (count = 4, bots = false): RosterPlayer[] => Array.from({ length: count }, (_, index) => ({
  id: `p${index}`, name: `玩家${index}`, character: (['uncle', 'slipper', 'chicken', 'raccoon'] as CharacterId[])[index % 4],
  team: index < 2 ? 0 : 1, bot: bots, difficulty: 'medium', ready: true,
}));
function game(mode: GameMode = 'ffa', count = mode === '1v1' ? 2 : 4, options = {}) {
  const state = createGame({ ...DEFAULT_SETTINGS, mode, map: 'village', ...options }, roster(count), 12345);
  state.phase = 'playing'; state.countdown = 0;
  return state;
}
function input(value: Partial<InputState> = {}): InputState { return { ...EMPTY_INPUT, ...value }; }
function advance(state: GameState, seconds: number, inputs: Record<string, InputState> = {}): void { stepGame(state, inputs, seconds); }
function positions(state: GameState, source = 0, target = 1): void {
  state.players.forEach((player, index) => { player.x = 1000 + index * 45; player.y = ARENAS.village.groundY; player.vx = 0; player.vy = 0; player.grounded = true; });
  state.players[source].x = 500; state.players[source].facing = 1;
  state.players[target].x = 548; state.players[target].facing = -1;
}
function punch(state: GameState, source = 0, target = 1, block = false): void {
  positions(state, source, target);
  advance(state, .1, { [`p${source}`]: input({ attack: true }), [`p${target}`]: input({ down: block }) });
}

test('a seeded match and its snapshots are serializable, deterministic and detached', () => {
  const first = game(); const second = game();
  advance(first, 15.1); advance(second, 15.1);
  assert.deepEqual(snapshotGame(first), snapshotGame(second));
  assert.doesNotThrow(() => JSON.stringify(first));
  const snapshot = snapshotGame(first);
  snapshot.players[0].hp = 1; snapshot.settings.map = 'sky';
  assert.equal(first.players[0].hp, 100); assert.equal(first.settings.map, 'village');
});

test('countdown gates movement and match time', () => {
  const state = createGame({ ...DEFAULT_SETTINGS, mode: '1v1' }, roster(2));
  const x = state.players[0].x;
  advance(state, 2, { p0: input({ move: 1 }) });
  assert.equal(state.phase, 'countdown'); assert.equal(state.timeLeft, 60); assert.equal(state.players[0].x, x);
  advance(state, 1.1, { p0: input({ move: 1 }) });
  assert.equal(state.phase, 'playing'); assert.ok(state.players[0].x > x);
});

test('air drops have exactly one item per participant, including bots and eliminated players, at every interval', () => {
  const state = game('ffa', 4, { dropInterval: 5 });
  state.players[1].bot = true; state.players[1].difficulty = 'easy';
  state.memory.p1.botThink = 100; // Isolate the drop clock from combat hit-stop.
  state.players[2].dead = true; state.players[2].respawnIn = 20;
  advance(state, 4.99); assert.equal(state.events.filter(event => event.type === 'drop').length, 0);
  advance(state, .03);
  assert.equal(state.events.filter(event => event.type === 'drop').length, 1);
  assert.equal(state.events.find(event => event.type === 'drop')?.count, 4);
  assert.equal(state.items.length, 4);
  advance(state, 5.01);
  assert.equal(state.events.filter(event => event.type === 'drop').length, 2);
  assert.ok(state.events.filter(event => event.type === 'drop').every(event => event.count === 4));
  const duel = game('1v1', 2, { dropInterval: 3 }); advance(duel, 3.05);
  assert.equal(duel.items.length, 2); assert.equal(duel.events.find(event => event.type === 'drop')?.count, 2);
  const disabled = game('ffa', 4, { itemsEnabled: false }); advance(disabled, 20); assert.equal(disabled.items.length, 0);
});

test('air drops warn two seconds ahead with authoritative kinds and exact landing platforms', () => {
  const state = game('ffa', 4);
  advance(state, 12.98); assert.equal(state.dropWarnings.length, 0); assert.equal(state.items.length, 0);
  advance(state, .04); assert.equal(state.dropWarnings.length, 4); assert.equal(state.items.length, 0);
  assert.ok(state.dropWarnings.every(warning => warning.inSeconds <= 2 && warning.inSeconds > 1.9));
  const planned = structuredClone(state.dropWarnings);
  const snapshot = snapshotGame(state);
  assert.deepEqual(snapshot.dropWarnings, planned);
  snapshot.dropWarnings[0].x = -999; assert.notEqual(state.dropWarnings[0].x, -999);
  for (const warning of planned) assert.ok(ARENAS.village.platforms.some(platform => platform.y === warning.y && warning.x >= platform.x && warning.x <= platform.x + platform.width));
  advance(state, 1.99); assert.equal(state.dropWarnings.length, 0); assert.equal(state.items.length, 4);
  assert.deepEqual(state.items.map(item => ({ id: item.id, x: item.x, kind: item.kind })), planned.map(warning => ({ id: warning.id, x: warning.x, kind: warning.kind })));
  advance(state, 1.5);
  state.items.forEach(item => { assert.equal(item.landed, true); assert.equal(item.y + 9, planned.find(warning => warning.id === item.id)!.y); });
});

test('air drop timing starts after countdown and supports configured intervals', () => {
  const state = createGame({ ...DEFAULT_SETTINGS, dropInterval: 5 }, roster(2));
  advance(state, 3); assert.equal(state.dropWarnings.length, 0);
  advance(state, 2.9); assert.equal(state.dropWarnings.length, 0);
  advance(state, .15); assert.equal(state.dropWarnings.length, 2);
  advance(state, 2.01); assert.equal(state.events.filter(event => event.type === 'drop').length, 1);
});

test('ending a round cancels its warning and no unusable drop is generated at the time limit', () => {
  const duel = game('1v1'); advance(duel, 13.1); assert.equal(duel.dropWarnings.length, 2);
  duel.players[1].dead = true; stepGame(duel, {});
  assert.equal(duel.phase, 'roundEnd'); assert.equal(duel.dropWarnings.length, 0); assert.equal(duel.items.length, 0);
  const full = game(); advance(full, 90.02);
  assert.equal(full.phase, 'matchEnd'); assert.equal(full.dropWarnings.length, 0);
  assert.equal(full.events.filter(event => event.type === 'drop').length, 5);
});

test('basic attacks deal 8 damage and ground crouch reduces frontal damage', () => {
  const plain = game(); punch(plain); assert.equal(plain.players[1].hp, 92);
  const guarded = game(); punch(guarded, 0, 1, true); assert.equal(guarded.players[1].hp, 96);
  assert.equal(guarded.players[1].stun, 0);
});

test('three quick basic attacks are an 8 / 8 / 12 chain', () => {
  const state = game();
  punch(state); advance(state, .22); punch(state); advance(state, .22); punch(state);
  assert.equal(state.players[0].attackPhase, 3); assert.equal(state.players[1].hp, 72);
});

test('2v2 friendly fire is disabled by default and explicitly configurable', () => {
  const safe = game('2v2'); punch(safe); assert.equal(safe.players[1].hp, 100);
  const enabled = game('2v2', 4, { friendlyFire: true }); punch(enabled); assert.equal(enabled.players[1].hp, 92);
  const opponents = game('2v2'); punch(opponents, 0, 2); assert.equal(opponents.players[2].hp, 92);
});

test('holding jump does not repeatedly jump; two distinct presses allow exactly a double jump', () => {
  const state = game();
  advance(state, FIXED_DT, { p0: input({ jump: true }) }); assert.equal(state.players[0].jumpsLeft, 1);
  advance(state, .16, { p0: input({ jump: true }) }); assert.equal(state.players[0].jumpsLeft, 1);
  advance(state, FIXED_DT); advance(state, FIXED_DT, { p0: input({ jump: true }) }); assert.equal(state.players[0].jumpsLeft, 0);
  advance(state, FIXED_DT); const vy = state.players[0].vy;
  advance(state, FIXED_DT, { p0: input({ jump: true }) }); assert.equal(state.players[0].jumpsLeft, 0); assert.ok(state.players[0].vy > vy);
});

test('S defends on a one-way platform, S plus jump drops through it, and the main ground stays solid', () => {
  const state = game(); const player = state.players[0];
  player.x = 180; player.y = ARENAS.village.platforms[1].y; player.grounded = true;
  advance(state, .12, { p0: input({ down: true }) });
  assert.equal(player.y, ARENAS.village.platforms[1].y); assert.equal(player.blocking, true);
  advance(state, .12, { p0: input({ down: true, jump: true }) }); assert.ok(player.y > ARENAS.village.platforms[1].y); assert.ok(player.vy > 0);
  advance(state, .7, { p0: input({ down: true }) }); assert.equal(player.y, ARENAS.village.groundY); assert.equal(player.blocking, true);
});

test('S plus jump on the main ground jumps normally and holding the combo never retriggers it', () => {
  const state = game(); const player = state.players[0];
  stepGame(state, { p0: input({ down: true, jump: true }) });
  assert.equal(player.grounded, false); assert.ok(player.vy < 0); assert.equal(player.jumpsLeft, 1);
  advance(state, .1, { p0: input({ down: true, jump: true }) }); assert.equal(player.jumpsLeft, 1);
});

test('platform drop-through prediction agrees with the server after the combo is released', () => {
  const state = game(); const player = state.players[0];
  player.x = 180; player.y = ARENAS.village.platforms[1].y; player.grounded = true;
  let predicted = structuredClone(player);
  for (let frame = 0; frame < 60; frame++) {
    const next = input({ down: frame < 8, jump: frame === 5 });
    predicted = predictLocalPlayer(predicted, next, FIXED_DT, state.settings);
    stepGame(state, { p0: next });
    assert.ok(Math.abs(predicted.y - player.y) < .0001, `drop frame ${frame}`);
    assert.equal(predicted.blocking, player.blocking);
  }
  assert.equal(player.y, ARENAS.village.groundY);
});

test('platform S defense mitigates frontal attacks without causing a fall', () => {
  const state = game();
  const platform = ARENAS.village.platforms[1];
  const source = state.players[0]; const target = state.players[1];
  source.x = 180; target.x = 228; source.y = target.y = platform.y;
  source.facing = 1; target.facing = -1;
  advance(state, .1, { p0: input({ attack: true }), p1: input({ down: true }) });
  assert.equal(target.hp, 96); assert.equal(target.stun, 0); assert.equal(target.y, platform.y);
});

test('a bot uses the new down-plus-jump combo to descend toward a grounded opponent', () => {
  const state = game('ffa', 2, { itemsEnabled: false });
  state.players[0].x = 180;
  const bot = state.players[1]; bot.bot = true; bot.difficulty = 'hard';
  bot.x = 180; bot.y = ARENAS.village.platforms[1].y; bot.grounded = true;
  advance(state, .25);
  assert.ok(bot.y > ARENAS.village.platforms[1].y + 15); assert.ok(bot.vy > 0);
});

test('local prediction uses the same jump and movement collision as authoritative simulation and acknowledges inputs', () => {
  const state = game(); let predicted = structuredClone(state.players[0]);
  for (let index = 0; index < 30; index++) {
    const next = input({ move: 1, jump: index < 5, seq: index + 1 });
    predicted = predictLocalPlayer(predicted, next, FIXED_DT, state.settings);
    stepGame(state, { p0: next });
  }
  assert.ok(Math.abs(predicted.x - state.players[0].x) < .001);
  assert.ok(Math.abs(predicted.y - state.players[0].y) < .001);
  assert.equal(state.players[0].lastInputSeq, 30); assert.equal(snapshotGame(state).players[0].lastInputSeq, 30);
});

test('dash has a three-second cooldown and approximately .2 seconds of invulnerability', () => {
  const state = game(); const start = state.players[0].x;
  stepGame(state, { p0: input({ dash: true, move: 1 }) });
  assert.ok(state.players[0].invuln > .18); assert.ok(state.players[0].cd.dash > 2.9);
  advance(state, .21); assert.equal(state.players[0].invuln, 0); assert.ok(state.players[0].x - start > 140);
  assert.ok(state.players[0].cd.dash > 2.7);
});

test('FFA kills score two, deaths lose one, respawn takes two seconds and never resets skill cooldown', () => {
  const state = game(); state.players[1].hp = 8; state.players[1].cd.skill1 = 7;
  punch(state);
  assert.equal(state.players[1].dead, true); assert.equal(state.players[0].score, 2); assert.equal(state.players[1].score, -1);
  advance(state, 1.8); assert.equal(state.players[1].dead, true);
  advance(state, .3); assert.equal(state.players[1].dead, false); assert.equal(state.players[1].hp, 100);
  assert.ok(state.players[1].cd.skill1 > 4.7 && state.players[1].cd.skill1 < 5);
  assert.ok(state.players[1].invuln > .8);
  stepGame(state, { p1: input({ attack: true }) }); assert.equal(state.players[1].invuln, 0);
});

test('assists require 25 recent damage, award one point, and exclude the killer', () => {
  const state = game();
  for (let index = 0; index < 3; index++) { punch(state, 0, 1); advance(state, .32); }
  assert.equal(state.players[1].hp, 72);
  state.players[1].hp = 8; punch(state, 2, 1);
  assert.equal(state.players[0].assists, 1); assert.equal(state.players[0].score, 1);
  assert.equal(state.players[2].kills, 1); assert.equal(state.players[2].assists, 0);
  const expired = game();
  for (let index = 0; index < 3; index++) { punch(expired, 0, 1); advance(expired, .32); }
  advance(expired, 6.2); expired.players[1].hp = 8; punch(expired, 2, 1);
  assert.equal(expired.players[0].assists, 0);
});

test('1v1 timeout compares HP only, ties do not award a round, and winning two rounds ends the match', () => {
  const tie = game('1v1'); tie.timeLeft = .01; tie.players.forEach(player => { player.x = 640; });
  tie.players[0].damage = 50; stepGame(tie, {});
  assert.equal(tie.phase, 'roundEnd'); assert.deepEqual(tie.roundWins, [0, 0]); assert.equal(tie.winner, null);
  const win = game('1v1'); win.timeLeft = .01; win.players.forEach(player => { player.x = 640; }); win.players[1].hp = 90;
  stepGame(win, {}); assert.deepEqual(win.roundWins, [1, 0]);
  advance(win, 6.1); assert.equal(win.round, 2); assert.equal(win.players[1].hp, 100);
  win.players[1].hp = 8; punch(win); assert.equal(win.phase, 'matchEnd'); assert.equal(win.winner, 'team:0');
});

test('2v2 timeout prioritizes survivors, then surviving team HP; simultaneous elimination is a tie', () => {
  const survivors = game('2v2'); survivors.players[0].hp = 1; survivors.players[1].hp = 1;
  survivors.players[2].hp = 100; survivors.players[3].dead = true;
  survivors.players.forEach(player => { player.x = 640; }); survivors.timeLeft = .01; stepGame(survivors, {});
  assert.equal(survivors.winner, 'team:0');
  const health = game('2v2'); health.players[0].hp = 30; health.players[1].hp = 30;
  health.players[2].hp = 90; health.players[3].hp = 5; health.players.forEach(player => { player.x = 640; }); health.timeLeft = .01; stepGame(health, {});
  assert.equal(health.winner, 'team:1');
  const tie = game('2v2'); tie.players.forEach(player => { player.dead = true; }); stepGame(tie, {});
  assert.equal(tie.winner, null); assert.deepEqual(tie.roundWins, [0, 0]);
});

test('FFA tiebreak uses score, kills, then effective damage, and can award a genuine shared win', () => {
  const state = game(); state.players.forEach(player => { player.x = 640; player.score = 3; player.kills = 2; player.damage = 50; });
  state.players[2].damage = 51; state.timeLeft = .01; stepGame(state, {});
  assert.equal(state.winner, 'p2'); assert.equal(state.phase, 'matchEnd');
  const shared = game(); shared.players.forEach(player => { player.x = 640; }); shared.timeLeft = .01; stepGame(shared, {});
  assert.equal(shared.winner, null); assert.match(shared.result, /并列/);
});

test('the safe zone shrinks only in the final fifteen seconds and damages outside players', () => {
  const state = game('1v1'); const left = state.safeZone.left;
  state.timeLeft = 16; advance(state, .5); assert.equal(state.safeZone.left, left);
  state.timeLeft = 10; state.players[0].x = ARENAS.village.left + 20; const health = state.players[0].hp; advance(state, 1);
  assert.ok(state.safeZone.left > left); assert.ok(state.players[0].hp < health);
});

test('uncle guard lasts one second, grants no more than twenty skill shield, prevents attacks, and has a ten-second cooldown', () => {
  const state = game(); positions(state);
  stepGame(state, { p0: input({ skill2: true }) });
  assert.equal(state.players[0].shield, 20); assert.equal(state.players[0].action, 'guard'); assert.equal(state.players[0].cd.skill2, 10);
  advance(state, .4, { p0: input({ attack: true }) }); assert.equal(state.players[0].attackPhase, 0);
  advance(state, .7); assert.equal(state.players[0].shield, 0); assert.ok(state.players[0].cd.skill2 > 8.8);
});

test('chicken spring is directional mobility without damage or invulnerability', () => {
  const state = game(); positions(state, 2, 1);
  advance(state, .2, { p2: input({ skill2: true, move: 1 }) });
  assert.ok(state.players[2].vy < -700); assert.equal(state.players[2].invuln, 0);
  assert.equal(state.players[1].hp, 100); assert.ok(state.players[2].cd.skill2 > 7.7);
});

test('all bot difficulties run valid four-player compositions using the same movement and health limits', () => {
  for (const mode of ['1v1', '2v2', 'ffa'] as GameMode[]) {
    const state = game(mode);
    state.players.forEach((player, index) => { player.bot = true; player.difficulty = (['easy', 'medium', 'hard'] as Difficulty[])[index % 3]; });
    advance(state, 12);
    assert.ok(state.players.some(player => player.cd.skill1 > 0 || player.cd.skill2 > 0 || player.damage > 0));
    for (const player of state.players) { assert.equal(player.maxHp, 100); assert.ok(Number.isFinite(player.x) && Number.isFinite(player.y)); assert.ok(player.hp >= 0 && player.hp <= 100); }
  }
});

test('crowd control never stacks, finishes within .4s, and grants two seconds of control protection', () => {
  const state = game(); positions(state);
  advance(state, .08, { p0: input({ skill1: true }) });
  assert.equal(state.players[1].hp, 100); // the pan has a visible .24s wind-up
  advance(state, .2); assert.equal(state.players[1].hp, 82); assert.ok(state.players[1].stun <= .3);
  const originalStun = state.players[1].stun;
  // A second attack cannot add its duration to the first stun.
  punch(state, 2, 1); assert.ok(state.players[1].stun <= originalStun);
  advance(state, .35); assert.equal(state.players[1].stun, 0); assert.ok(state.players[1].controlProtection > 1.7);
  punch(state, 3, 1); assert.equal(state.players[1].stun, 0);
});

test('sustained control triggers escape with .4 seconds of invulnerability', () => {
  const state = game(); const player = state.players[1];
  state.memory[player.id].controlTotal = .79; state.memory[player.id].controlWindow = state.elapsed;
  player.stun = .3; advance(state, .04);
  assert.equal(player.stun, 0); assert.ok(player.invuln >= .37); assert.ok(player.controlProtection > 1.9);
  assert.ok(state.effects.some(effect => effect.kind === 'escape'));
});

test('F picks one nearby item, passive items apply instantly, and a carried item cannot be overwritten', () => {
  const state = game(); const player = state.players[0];
  const item = (id: string, kind: 'shield' | 'shoes' | 'watergun' | 'banana') => ({ id, kind, x: player.x, y: player.y - 9, vy: 0, landed: true, ttl: 20 });
  state.items = [item('shield', 'shield')]; stepGame(state, { p0: input({ pickup: true }) });
  assert.equal(player.shield, 15); assert.equal(player.heldItem, null);
  stepGame(state, {}); state.items = [item('shoes', 'shoes')]; stepGame(state, { p0: input({ pickup: true }) });
  assert.ok(player.statuses.speed > 2.9 && player.statuses.speed <= 3);
  stepGame(state, {}); state.items = [item('gun', 'watergun')]; stepGame(state, { p0: input({ pickup: true }) });
  assert.equal(player.heldItem, 'watergun'); assert.equal(player.ammo, 6);
  stepGame(state, {}); state.items = [item('banana', 'banana')]; stepGame(state, { p0: input({ pickup: true }) });
  assert.equal(player.heldItem, 'watergun'); assert.equal(state.items.length, 1);
});

test('a toy watergun fires limited ammo using J and consumes the carried slot', () => {
  const state = game(); positions(state);
  const player = state.players[0]; player.heldItem = 'watergun'; player.ammo = 2;
  advance(state, .12, { p0: input({ attack: true }) }); assert.equal(player.ammo, 1); assert.equal(state.players[1].hp, 95);
  positions(state); advance(state, .25, { p0: input({ attack: true }) });
  assert.equal(player.heldItem, null); assert.equal(player.ammo, 0);
});

test('raccoon has one visible spring package, which basic attacks can dismantle', () => {
  const state = game(); positions(state, 3, 1);
  state.players[1].x = 900;
  advance(state, .3, { p3: input({ skill1: true }) });
  assert.equal(state.projectiles.filter(shot => shot.kind === 'trap').length, 1);
  state.players[3].cd.skill1 = 0; advance(state, .1); advance(state, .3, { p3: input({ skill1: true }) });
  assert.equal(state.projectiles.filter(shot => shot.kind === 'trap').length, 1);
  const trap = state.projectiles.find(shot => shot.kind === 'trap')!;
  state.players[0].x = trap.x - 30; state.players[0].y = trap.y + 25; state.players[0].facing = 1;
  advance(state, .08, { p0: input({ attack: true }) });
  assert.equal(state.projectiles.filter(shot => shot.kind === 'trap').length, 0);
});

test('a visible spring package deals fourteen damage and applies one nonstacking .8 speed multiplier', () => {
  const state = game(); positions(state, 3, 1); state.players[1].x = 900;
  advance(state, .9, { p3: input({ skill1: true }) });
  const trap = state.projectiles.find(shot => shot.kind === 'trap')!; assert.ok(trap);
  state.players[1].x = trap.x; state.players[1].y = trap.y + 16;
  stepGame(state, {}); assert.equal(state.players[1].hp, 86); assert.ok((state.players[1].statuses as { slow?: number }).slow! > .9);
});

test('holding K starts one dash only and movement prediction agrees through the final dash frame', () => {
  const state = game(); let predicted = structuredClone(state.players[0]);
  for (let frame = 0; frame < 210; frame++) {
    const next = input({ move: frame < 45 ? 1 : -1, dash: true });
    predicted = predictLocalPlayer(predicted, next, FIXED_DT, state.settings);
    stepGame(state, { p0: next });
    assert.ok(Math.abs(predicted.x - state.players[0].x) < .001, `dash frame ${frame}`);
  }
  assert.equal(state.effects.filter(effect => effect.kind === 'dash').length, 0);
  assert.equal(state.players[0].cd.dash, 0);
  assert.equal(predicted.cd.dash, 0);
});

test('a hard bot climbs intermediate platforms to pursue a player on the sky arena top platform', () => {
  const state = createGame({ ...DEFAULT_SETTINGS, map: 'sky', mode: 'ffa', itemsEnabled: false }, roster(2), 5522);
  state.phase = 'playing'; state.players[0].x = 640; state.players[0].y = 153; state.players[0].grounded = true;
  state.players[1].bot = true; state.players[1].difficulty = 'hard'; state.players[1].x = 930;
  let reached = false;
  for (let frame = 0; frame < 720; frame++) {
    stepGame(state, {});
    const bot = state.players[1];
    if (bot.x > 520 && bot.x < 760 && bot.y < 175) { reached = true; break; }
  }
  assert.equal(reached, true, `bot ended at ${state.players[1].x.toFixed(1)},${state.players[1].y.toFixed(1)}`);
});

test('FFA never shrinks its arena or applies safe-zone damage in the final seconds', () => {
  const state = game('ffa'); state.timeLeft = 1; state.players[0].x = ARENAS.village.left + 16;
  advance(state, .9);
  assert.deepEqual(state.safeZone, { left: ARENAS.village.left, right: ARENAS.village.right });
  assert.equal(state.players[0].hp, 100);
});

test('item shields give fifteen points for four seconds and overlap guard shields without stacking', () => {
  const state = game(); const player = state.players[0];
  state.items = [{ id: 'shield', kind: 'shield', x: player.x, y: player.y - 9, vy: 0, landed: true, ttl: 20 }];
  stepGame(state, { p0: input({ pickup: true }) }); assert.equal(player.shield, 15);
  stepGame(state, { p0: input({ skill2: true }) }); assert.equal(player.shield, 20);
  punch(state, 2, 0); assert.equal(player.shield, 12); assert.equal(player.hp, 100);
  advance(state, 1); assert.equal(player.shield, 7);
  advance(state, 3); assert.equal(player.shield, 0);
  const shoes = game(); shoes.items = [{ id: 'shoes', kind: 'shoes', x: shoes.players[0].x, y: shoes.players[0].y - 9, vy: 0, landed: true, ttl: 20 }];
  stepGame(shoes, { p0: input({ pickup: true }) });
  advance(shoes, .3, { p0: input({ move: 1 }) }); assert.equal(shoes.players[0].vx, 265 * 1.2);
  advance(shoes, 3); assert.equal(shoes.players[0].statuses.speed, 0);
});

test('banana slip control lasts .3 seconds', () => {
  const state = game(); const target = state.players[1];
  state.projectiles.push({ id: 'banana-test', kind: 'banana', ownerId: 'p0', team: 0, x: target.x, y: target.y - 25, vx: 0, vy: 0, radius: 12, ttl: 3, damage: 0 });
  stepGame(state, {}); assert.equal(target.stun, .3);
  advance(state, .36); assert.equal(target.stun, 0); assert.ok(target.controlProtection > 1.9); assert.ok(target.invuln > .48);
});

test('every character has an 8 / 8 / 12 combo whose third hit stuns and disarms a reusable weapon', () => {
  for (const character of ['uncle', 'slipper', 'chicken', 'raccoon'] as CharacterId[]) {
    const state = game(); const source = state.players[0]; const target = state.players[1];
    source.character = character; target.heldItem = 'watergun'; target.ammo = 3;
    punch(state); assert.equal(target.stun, 0); assert.equal(target.heldItem, 'watergun');
    advance(state, .22); punch(state); assert.equal(target.stun, 0);
    advance(state, .22); punch(state);
    assert.equal(target.hp, 72); assert.ok(target.stun > .3 && target.stun <= .35);
    assert.equal(target.heldItem, null); assert.equal(target.ammo, 0);
    const dropped = state.items.find(item => item.kind === 'watergun');
    assert.ok(dropped); assert.equal(dropped.ammo, 3);
    const hit = state.events.filter(event => event.type === 'hit').at(-1)!;
    assert.equal(hit.damage, 12); assert.equal(hit.heavy, true); assert.equal(hit.guarded, false); assert.equal(hit.hitStop, .1);
    advance(state, .8);
    source.heldItem = null; source.x = dropped.x; source.y = dropped.y + 9; source.vx = 0; source.vy = 0;
    stepGame(state, { p0: input({ pickup: true }) });
    assert.equal(source.heldItem, 'watergun'); assert.equal(source.ammo, 3);
  }
});

test('heavy hits keep one-use items and respect guard and existing control protection', () => {
  for (const kind of ['banana', 'popcorn'] as const) {
    const state = game(); const source = state.players[0]; const target = state.players[1];
    target.heldItem = kind; target.ammo = 1; source.attackPhase = 2; state.memory.p0.comboUntil = state.elapsed + 1;
    punch(state);
    assert.ok(target.stun > 0); assert.equal(target.heldItem, kind); assert.equal(target.ammo, 1);
    assert.equal(state.items.length, 0);
  }
  for (const guarded of [false, true]) {
    const state = game(); const source = state.players[0]; const target = state.players[1];
    source.attackPhase = 2; state.memory.p0.comboUntil = state.elapsed + 1;
    target.heldItem = 'watergun'; target.ammo = 2;
    if (!guarded) target.controlProtection = 2;
    punch(state, 0, 1, guarded);
    assert.equal(target.stun, 0); assert.equal(target.heldItem, 'watergun'); assert.equal(state.items.length, 0);
  }
});

test('getting up from heavy stun grants .5 s invulnerability without extending the combo lockout', () => {
  const state = game(); const target = state.players[1];
  state.players[0].attackPhase = 2; state.memory.p0.comboUntil = state.elapsed + 1;
  punch(state);
  while (target.stun > 0 || state.hitStop > 0) stepGame(state, {});
  assert.equal(target.invuln, .5); assert.equal(target.controlProtection, 2);
  const hp = target.hp; punch(state, 2, 1);
  assert.equal(target.hp, hp);
  advance(state, .41); punch(state, 2, 1);
  assert.equal(target.hp, hp - 8);
});

test('global hit-stop freezes the world for three or six ticks while acknowledging and buffering taps', () => {
  for (const heavy of [false, true]) {
    const state = game(); positions(state);
    if (heavy) { state.players[0].attackPhase = 2; state.memory.p0.comboUntil = 1; }
    while (!state.events.some(event => event.type === 'hit')) stepGame(state, { p0: input({ attack: true }) });
    const frames = heavy ? 6 : 3;
    assert.equal(state.hitStop, frames * FIXED_DT);
    const start = snapshotGame(state); const elapsed = state.elapsed;
    for (let index = 0; index < frames; index++) {
      stepGame(state, { p2: input({ move: 1, jump: index === 0, seq: index + 1 }) });
      assert.equal(state.players[2].lastInputSeq, index + 1);
      assert.equal(state.elapsed, elapsed); assert.equal(state.timeLeft, start.timeLeft); assert.equal(state.dropIn, start.dropIn);
      assert.equal(state.players[2].x, start.players[2].x); assert.equal(state.players[2].y, start.players[2].y);
      assert.deepEqual(state.effects, start.effects); assert.equal(state.players[1].stun, start.players[1].stun);
    }
    assert.equal(state.hitStop, 0);
    stepGame(state, { p2: input({ seq: frames + 1 }) });
    assert.ok(state.players[2].vy < 0); assert.equal(state.players[2].jumpsLeft, 1);
    assert.ok(state.elapsed > elapsed);
  }
});

test('a shared heavy impact on several targets takes one six-frame stop rather than stacking duration', () => {
  const state = game(); positions(state); state.players[2].x = 560;
  state.players[0].attackPhase = 2; state.memory.p0.comboUntil = 1;
  while (!state.events.some(event => event.type === 'hit')) stepGame(state, { p0: input({ attack: true }) });
  assert.equal(state.events.filter(event => event.type === 'hit').length, 2); assert.equal(state.hitStop, .1);
});

test('an S plus Space tap during hit-stop is preserved as a platform drop rather than a jump', () => {
  const state = game(); const player = state.players[2];
  player.x = 180; player.y = ARENAS.village.platforms[1].y; player.grounded = true;
  state.hitStop = 3 * FIXED_DT;
  stepGame(state, { p2: input({ down: true, jump: true, seq: 1 }) });
  stepGame(state, { p2: input({ seq: 2 }) }); stepGame(state, { p2: input({ seq: 3 }) });
  assert.equal(state.hitStop, 0); assert.equal(player.y, ARENAS.village.platforms[1].y);
  stepGame(state, { p2: input({ seq: 4 }) });
  assert.ok(player.y > ARENAS.village.platforms[1].y); assert.ok(player.vy > 0); assert.equal(player.jumpsLeft, 2);
  advance(state, .4); assert.equal(player.blocking, false);
});

test('idle animation time starts after two seconds of grounded inactivity and resets on inputs or damage', () => {
  const state = game(); const player = state.players[0];
  advance(state, 1.99); assert.ok(player.idleTime < 2);
  advance(state, .03); assert.ok(player.idleTime >= 2);
  stepGame(state, { p0: input({ down: true }) }); assert.equal(player.idleTime, 0);
  advance(state, 2.1); assert.ok(player.idleTime > 2);
  punch(state, 1, 0); assert.equal(player.idleTime, 0);
  const clone = predictLocalPlayer(player, input({ move: 1 }), FIXED_DT, state.settings, .05);
  assert.deepEqual(clone, player); assert.notEqual(clone, player);
});

test('players can leave platforms and die beyond the map bounds even with invulnerability', () => {
  for (const map of ['sky', 'village', 'mountain'] as const) {
    const state = game('ffa', 2, { map, itemsEnabled: false });
    const player = state.players[0]; player.x = ARENAS[map].platforms[0].x + ARENAS[map].platforms[0].width - 4;
    player.invuln = 10;
    advance(state, 1.5, { p0: input({ move: 1 }) });
    assert.equal(player.dead, true); assert.equal(player.hp, 0); assert.equal(player.deaths, 1); assert.equal(player.score, -1);
  }
  const falling = game(); const target = falling.players[1];
  target.x = 5; target.y = WORLD_HEIGHT + PLAYER_HEIGHT + 1; target.invuln = 10;
  stepGame(falling, {}); assert.equal(target.dead, true);
  const horizontal = game(); horizontal.players[1].x = WORLD_WIDTH + PLAYER_WIDTH / 2 + 1;
  stepGame(horizontal, {}); assert.equal(horizontal.players[1].dead, true);
});

test('popcorn starts its .8 second, radius-105 warning only after landing and then deals twelve damage', () => {
  const state = game(); const source = state.players[0];
  source.x = 400; source.facing = 1; source.heldItem = 'popcorn'; source.ammo = 1;
  state.players.slice(1).forEach((player, index) => { player.x = 1050 + index * 40; });
  stepGame(state, { p0: input({ attack: true }) });
  let bomb = state.projectiles.find(shot => shot.kind === 'popcorn')!;
  assert.equal(bomb.damage, 12); assert.equal(bomb.radius, 15); assert.equal(bomb.timer, undefined);
  advance(state, .25); assert.equal(bomb.timer, undefined); assert.ok(!state.effects.some(effect => effect.kind === 'bomb-warning'));
  for (let frame = 0; frame < 120 && bomb.timer === undefined; frame++) stepGame(state, {});
  assert.equal(bomb.timer, .8); assert.equal(bomb.vx, 0);
  const warning = state.effects.find(effect => effect.kind === 'bomb-warning')!;
  assert.equal(warning.radius, 105); assert.equal(warning.duration, .8);
  state.players[1].x = bomb.x + 70; state.players[1].y = ARENAS.village.groundY;
  advance(state, .75); assert.equal(state.players[1].hp, 100); assert.ok(state.projectiles.some(shot => shot.id === bomb.id));
  advance(state, .07); assert.equal(state.players[1].hp, 88); assert.ok(!state.projectiles.some(shot => shot.id === bomb.id));
  assert.equal(state.effects.find(effect => effect.kind === 'explosion')?.radius, 105);
});
