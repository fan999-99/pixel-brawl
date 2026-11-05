import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, type Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { connectRoom, type OnlineConnection } from '../client/network.js';
import { DEFAULT_SETTINGS } from '../shared/config.js';
import type { GameState } from '../shared/game.js';
import { EMPTY_INPUT, type GameSnapshot, type LobbySnapshot, type MatchSettings } from '../shared/types.js';
import { startGameServer, validateInput, validateSettings } from '../server/index.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => unknown, message: string, timeout = 4000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error(message);
    await delay(10);
  }
}
interface Tracked {
  room: Room;
  lobby?: LobbySnapshot;
  states: Map<number, GameSnapshot>;
  errors: string[];
}
function track(room: Room): Tracked {
  const tracked: Tracked = { room, states: new Map(), errors: [] };
  room.onMessage<LobbySnapshot>('lobby', lobby => { tracked.lobby = lobby; });
  room.onMessage<GameSnapshot>('state', state => { tracked.states.set(state.tick, state); });
  room.onMessage<{ message: string }>('error', error => { tracked.errors.push(error.message); });
  room.onError((_code, message) => tracked.errors.push(message ?? 'connection error'));
  room.send('requestLobby');
  return tracked;
}

test('validates network inputs and room settings', () => {
  assert.equal(validateInput({ ...EMPTY_INPUT, move: 2 }).move, 1);
  assert.throws(() => validateInput({ ...EMPTY_INPUT, hp: 999 }), /只允许/);
  assert.throws(() => validateInput({ ...EMPTY_INPUT, id: 'other' }), /只允许/);
  assert.throws(() => validateInput({ ...EMPTY_INPUT, jump: 'yes' }), /按键/);
  assert.throws(() => validateInput({ ...EMPTY_INPUT, move: NaN }), /移动/);
  assert.throws(() => validateInput({ ...EMPTY_INPUT, seq: -1 }), /序号/);
  assert.throws(() => validateSettings({ mode: 'invalid' }), /模式/);
  assert.throws(() => validateSettings({ roundsToWin: 0 }), /局数/);
  assert.throws(() => validateSettings({ dropInterval: 0 }), /间隔/);
  assert.throws(() => validateSettings({ hp: 999 }), /未知/);
  assert.equal(validateSettings({ mode: '2v2' }).mode, '2v2');
});

test('real room networking, host permissions, authoritative snapshots, and safe static hosting', async t => {
  const staticRoot = await mkdtemp(join(tmpdir(), 'pixel-brawl-network-'));
  await writeFile(join(staticRoot, 'index.html'), '<!doctype html><title>network-test</title>');
  const runtime = await startGameServer({ port: 0, host: '127.0.0.1', distRoot: staticRoot, quiet: true });
  const endpoint = `http://127.0.0.1:${runtime.port}`;
  const client = new Client(endpoint);
  const connected: Tracked[] = [];
  const create = async (settings: MatchSettings = { ...DEFAULT_SETTINGS, mode: '1v1' }) => {
    const tracked = track(await client.create('brawl', { name: '房主', character: 'uncle', settings }));
    connected.push(tracked);
    await until(() => tracked.lobby, 'creator did not receive lobby');
    return tracked;
  };
  const enter = async (code: string, name = '访客') => {
    const tracked = track(await client.joinById(code, { name, character: 'chicken' }));
    connected.push(tracked);
    await until(() => tracked.lobby, 'guest did not receive lobby');
    return tracked;
  };
  try {
    await t.test('health and static paths', async () => {
      const health = await fetch(`${endpoint}/health`);
      assert.equal(health.status, 200);
      assert.equal((await health.json()).simulationHz, 60);
      assert.match(await (await fetch(`${endpoint}/`)).text(), /network-test/);
      assert.equal((await fetch(`${endpoint}/package.json`)).status, 404);
      assert.equal((await fetch(`${endpoint}/%2e%2e%5cpackage.json`)).status, 403);
    });
    await t.test('two clients, four-seat cap, ready/start, authority, and host migration', async () => {
      const host = await create();
      const code = host.room.roomId;
      assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
      const guest = await enter(code);
      const third = await enter(code, '第三位');
      const fourth = await enter(code, '第四位');
      await until(() => host.lobby?.players.length === 4, 'four roster seats not filled');
      await assert.rejects(() => client.joinById(code, { name: '第五位', character: 'raccoon' }));
      await Promise.all([third.room.leave(), fourth.room.leave()]);
      await until(() => host.lobby?.players.length === 2, 'departed players not removed');
      assert.equal(host.lobby?.hostId, host.room.sessionId);
      assert.deepEqual(host.lobby?.players.map(player => player.team), [0, 1]);
      guest.room.send('randomCharacters');
      await until(() => guest.errors.some(error => error.includes('房主')), 'non-host randomization was not rejected');
      const guestCharacter = host.lobby!.players.find(player => player.id === guest.room.sessionId)!.character;
      host.room.send('ready', { ready: true });
      await until(() => host.lobby?.players.find(player => player.id === host.room.sessionId)?.ready, 'host readiness not saved');
      host.room.send('randomCharacters');
      await until(() => host.lobby?.players.find(player => player.id === host.room.sessionId)?.ready === false, 'randomization did not invalidate readiness');
      assert.equal(host.lobby!.players.find(player => player.id === guest.room.sessionId)!.character, guestCharacter, 'host randomization changed a guest selection');
      guest.room.send('settings', { map: 'village' });
      await until(() => guest.errors.some(error => error.includes('房主')), 'non-host setting mutation was not rejected');
      assert.equal(host.lobby?.settings.map, 'sky');
      guest.room.send('profile', { id: host.room.sessionId, name: '冒充', character: 'raccoon' });
      await until(() => guest.errors.some(error => error.includes('自己')), 'spoofed profile was not rejected');
      host.room.send('start');
      await until(() => host.errors.length > 0, 'unready game started');
      assert.equal(host.lobby?.started, false);
      host.room.send('ready', { ready: true });
      guest.room.send('ready', { ready: true });
      await until(() => host.lobby?.canStart, 'ready gate never opened');
      host.room.send('start');
      await until(() => host.states.size >= 3 && guest.states.size >= 3, 'did not receive authoritative snapshots').catch(error => {
        throw new Error(`${error.message}; hostStates=${host.states.size}; guestStates=${guest.states.size}; hostErrors=${JSON.stringify(host.errors)}; guestErrors=${JSON.stringify(guest.errors)}; lobby=${JSON.stringify(host.lobby)}`);
      });
      assert.equal(host.lobby?.started, true);
      const commonTicks = [...host.states.keys()].filter(tick => guest.states.has(tick));
      assert.ok(commonTicks.length >= 2);
      for (const tick of commonTicks) assert.deepEqual(host.states.get(tick), guest.states.get(tick));
      guest.room.send('input', { ...EMPTY_INPUT, move: 1, x: 999999, hp: 999 });
      await until(() => guest.errors.some(error => error.includes('只允许')), 'client position/HP packet was not rejected');
      const previousErrors = host.errors.length;
      host.room.send('settings', { map: 'mountain' });
      await until(() => host.errors.length > previousErrors, 'mid-match settings were not locked');
      assert.equal(host.lobby?.settings.map, 'sky');
      await host.room.leave();
      await until(() => guest.lobby?.hostId === guest.room.sessionId, 'host was not transferred');
      assert.ok(guest.lobby?.players.find(player => player.id === host.room.sessionId)?.bot, 'departed combatant not replaced by bot');
      guest.room.send('backToLobby');
      await until(() => guest.lobby?.started === false, 'new host could not return to lobby');
      assert.equal(guest.lobby?.players.length, 2);
      assert.equal(guest.lobby?.players.find(player => player.id === guest.room.sessionId)?.ready, false);
      await guest.room.leave();
      await delay(100);
      await assert.rejects(() => client.joinById(code, { name: '空房访客', character: 'uncle' }));
    });
    await t.test('heavy contact, shared hit stop, disarm and recovery are authoritative for both clients', async () => {
      const host = await create({ ...DEFAULT_SETTINGS, mode: '1v1', roundsToWin: 1 });
      const guest = await enter(host.room.roomId, '受击选手');
      host.room.send('ready', { ready: true });
      guest.room.send('ready', { ready: true });
      await until(() => host.lobby?.canStart, 'combat test players did not become ready');
      host.room.send('start');
      await until(() => host.states.size > 0, 'combat test did not start');
      const serverRoom = matchMaker.getLocalRoomById(host.room.roomId);
      const simulation = (serverRoom as unknown as { game: GameState }).game;
      simulation.phase = 'playing'; simulation.countdown = 0;
      const attacker = simulation.players.find(player => player.id === host.room.sessionId)!;
      const target = simulation.players.find(player => player.id === guest.room.sessionId)!;
      attacker.x = 600; attacker.y = 431; attacker.facing = 1; attacker.attackPhase = 2;
      simulation.memory[attacker.id].comboUntil = simulation.elapsed + 1;
      target.x = 642; target.y = 431; target.facing = -1; target.heldItem = 'watergun'; target.ammo = 3;
      host.room.send('input', { ...EMPTY_INPUT, attack: true, seq: 1 });
      const contact = (tracked: Tracked) => [...tracked.states.values()].find(state => state.events.some(event => event.type === 'hit' && event.heavy && event.targetId === target.id));
      await until(() => contact(host) && contact(guest), 'both clients did not receive the heavy contact');
      host.room.send('input', { ...EMPTY_INPUT, seq: 2 });
      const first = contact(host)!;
      assert.equal(first.hitStop, .1, 'contact must broadcast before the first frozen tick is consumed');
      assert.deepEqual(first, contact(guest));
      const impact = first.events.find(event => event.type === 'hit' && event.heavy)!;
      assert.equal(impact.damage, 12);
      assert.equal(first.players.find(player => player.id === target.id)!.heldItem, null);
      assert.equal(first.items.find(item => item.kind === 'watergun')!.ammo, 3);
      await until(() => [...host.states.values()].some(state => state.tick > first.tick && state.hitStop > 0), 'no subsequent frozen state was broadcast');
      const frozen = [...host.states.values()].find(state => state.tick > first.tick && state.hitStop > 0)!;
      assert.equal(frozen.timeLeft, first.timeLeft);
      assert.equal(frozen.players.find(player => player.id === target.id)!.x, first.players.find(player => player.id === target.id)!.x);
      await until(() => [...guest.states.values()].some(state => {
        const player = state.players.find(entry => entry.id === target.id)!;
        return state.tick > frozen.tick && player.stun === 0 && player.invuln > .4;
      }), 'the recovered player did not receive half-second invulnerability');
      // Invulnerability protects from attacks, but cannot rescue a fighter outside the arena.
      target.x = -100; target.invuln = .5;
      await until(() => [...guest.states.values()].some(state => state.players.find(player => player.id === target.id)!.dead), 'out-of-map fighter survived while invulnerable');
      assert.deepEqual(host.errors, []); assert.deepEqual(guest.errors, []);
      await Promise.all([host.room.leave(), guest.room.leave()]);
    });
    await t.test('2v2 seats, bot role editing, exact player count and all four characters', async () => {
      const host = await create({ ...DEFAULT_SETTINGS, mode: '2v2' });
      host.room.send('addBot', { character: 'slipper', difficulty: 'easy' });
      host.room.send('addBot', { character: 'chicken', difficulty: 'medium' });
      host.room.send('addBot', { character: 'raccoon', difficulty: 'hard' });
      await until(() => host.lobby?.players.length === 4, 'bots not added');
      assert.deepEqual(host.lobby?.players.map(player => player.team), [0, 1, 0, 1]);
      assert.deepEqual(host.lobby?.players.map(player => player.character), ['uncle', 'slipper', 'chicken', 'raccoon']);
      const botId = host.lobby!.players[1].id;
      host.room.send('updateBot', { id: botId, character: 'raccoon', difficulty: 'hard' });
      await until(() => host.errors.some(error => error.includes('同队')), 'same-team duplicate character was not rejected');
      assert.equal(host.lobby?.players[1].character, 'slipper');
      assert.equal(host.lobby?.players[1].difficulty, 'easy');
      for (let i = 0; i < 8; i++) host.room.send('randomCharacters');
      await delay(100);
      assert.notEqual(host.lobby!.players[0].character, host.lobby!.players[2].character, 'blue team received duplicate random characters');
      assert.notEqual(host.lobby!.players[1].character, host.lobby!.players[3].character, 'red team received duplicate random characters');
      host.room.send('ready', { ready: true });
      await until(() => host.lobby?.canStart, 'ready state missing before difficulty randomization');
      host.room.send('randomDifficulties');
      await until(() => !host.lobby?.canStart, 'random difficulty did not invalidate readiness');
      assert.ok(host.lobby!.players.filter(player => player.bot).every(player => ['easy', 'medium', 'hard'].includes(player.difficulty)));
      host.room.send('updateBot', { id: botId, difficulty: 'hard' });
      await until(() => host.lobby?.players[1].difficulty === 'hard', 'bot difficulty not editable');
      host.room.send('addBot', { character: 'uncle', difficulty: 'medium' });
      await until(() => host.errors.some(error => error.includes('最多4')), 'bot exceeded roster cap');
      host.room.send('ready', { ready: true });
      await until(() => host.lobby?.canStart, '2v2 exact four roster rejected');
      host.room.send('start');
      await until(() => host.states.size > 0, '2v2 did not start');
      assert.deepEqual([...host.states.values()][0].players.map(player => player.team), [0, 1, 0, 1]);
      await host.room.leave();
    });
    await t.test('free-for-all keeps independent teams', async () => {
      const host = await create({ ...DEFAULT_SETTINGS, mode: 'ffa' });
      host.room.send('addBot', { character: 'slipper', difficulty: 'easy' });
      host.room.send('addBot', { character: 'chicken', difficulty: 'medium' });
      await until(() => host.lobby?.players.length === 3, 'FFA bots not added');
      assert.deepEqual(host.lobby?.players.map(player => player.team), [0, 1, 2]);
      host.room.send('ready', { ready: true });
      await until(() => host.lobby?.canStart, '3-player FFA rejected');
      host.room.send('start');
      await until(() => host.states.size > 0, 'FFA did not start');
      await host.room.leave();
    });
    await t.test('browser adapter preserves prediction sequences, rematches, and reports abnormal disconnect immediately', async () => {
      const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
      Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL(endpoint) });
      let adapter: OnlineConnection | undefined;
      let adapterLobby: LobbySnapshot | undefined;
      let adapterState: GameSnapshot | undefined;
      const adapterErrors: string[] = [];
      let leaves = 0;
      try {
        const host = await create({ ...DEFAULT_SETTINGS, mode: '1v1', roundsToWin: 1 });
        const connectedAt = Date.now();
        adapter = await connectRoom('join', { code: host.room.roomId, name: '预测客户端', character: 'slipper' }, {
          onLobby(value) { adapterLobby = value; },
          onState(value) { adapterState = value; },
          onError(message) { adapterErrors.push(message); },
          onLeave() { leaves++; },
        });
        assert.equal(adapter.id, host.room.roomId);
        assert.notEqual(adapter.sessionId, host.room.sessionId);
        await until(() => adapterLobby?.players.length === 2, 'adapter lobby callback did not run');
        host.room.send('ready', { ready: true });
        adapter.send('ready', { ready: true });
        await until(() => host.lobby?.canStart, 'adapter readiness was not received');
        host.room.send('start');
        await until(() => adapterState?.phase === 'playing', 'adapter never entered playing', 5000);
        // These intentionally share one JS frame. Neither may be dropped or renumbered.
        adapter.input({ ...EMPTY_INPUT, move: 1, seq: 73 });
        adapter.input({ ...EMPTY_INPUT, move: 1, seq: 74 });
        await until(() => adapterState?.players.find(player => player.id === adapter!.sessionId)?.lastInputSeq === 74, 'adapter changed/dropped caller input sequences');
        const serverRoom = matchMaker.getLocalRoomById(host.room.roomId);
        const simulation = (serverRoom as unknown as { game: GameState }).game;
        // Accelerate the round clock only; the actual authority still computes and broadcasts the result.
        simulation.players.find(player => player.id === host.room.sessionId)!.hp = 80;
        simulation.players.find(player => player.id === adapter!.sessionId)!.hp = 50;
        simulation.timeLeft = .02;
        await until(() => adapterState?.phase === 'matchEnd', 'adapter did not receive matchEnd');
        assert.equal(adapterState!.winner, 'team:0');
        host.room.send('rematch');
        await until(() => adapterState?.phase === 'countdown' && adapterState.tick < 20, 'adapter did not receive fresh match countdown');
        assert.equal(adapterState!.round, 1);
        assert.ok(adapterState!.players.every(player => player.hp === 100));
        assert.equal(adapterLobby?.started, true);
        assert.deepEqual(adapterErrors, []);
        // Past the SDK's default 5s minimum uptime, accidental automatic retries
        // would otherwise delay onLeave for many seconds because the server uses bot takeover.
        await delay(Math.max(0, 5200 - (Date.now() - connectedAt)));
        const serverClient = serverRoom.clients.find(client => client.sessionId === adapter!.sessionId)!;
        serverClient.leave(1001, 'network test interrupted transport');
        await until(() => leaves === 1, 'adapter abnormal-disconnect callback was delayed by retries', 700);
        await until(() => host.lobby?.players.find(player => player.id === adapter!.sessionId)?.bot, 'disconnected adapter was not taken over by a bot');
        await Promise.all([adapter.leave(), adapter.leave()]);
        assert.equal(leaves, 1);
        await host.room.leave();
      } finally {
        await adapter?.leave();
        if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation);
        else Reflect.deleteProperty(globalThis, 'location');
      }
    });
  } finally {
    await Promise.allSettled(connected.filter(({ room }) => room.connection?.isOpen).map(({ room }) => room.leave()));
    await runtime.stop();
    await unlink(join(staticRoot, 'index.html'));
    await rmdir(staticRoot);
  }
});
