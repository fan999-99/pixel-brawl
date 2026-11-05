import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomInt } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room, Server, ServerError, type Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { CHARACTERS, DEFAULT_SETTINGS } from '../shared/config.js';
import { createGame, snapshotGame, stepGame, type GameState } from '../shared/game.js';
import { EMPTY_INPUT, type CharacterId, type Difficulty, type InputState, type LobbySnapshot, type MatchSettings, type RosterPlayer } from '../shared/types.js';

const ROOM_CODES = new Set<string>();
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INPUT_KEYS = new Set(['move', 'down', 'jump', 'attack', 'dash', 'skill1', 'skill2', 'pickup', 'seq']);
const BOOLEAN_INPUTS = ['down', 'jump', 'attack', 'dash', 'skill1', 'skill2', 'pickup'] as const;
const SETTINGS_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));
const DIFFICULTIES = new Set<Difficulty>(['easy', 'medium', 'hard']);
type Dict = Record<string, unknown>;

function object(value: unknown): Dict {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('消息格式不正确。');
  return value as Dict;
}
function character(value: unknown): CharacterId {
  if (typeof value !== 'string' || !Object.hasOwn(CHARACTERS, value)) throw new Error('请选择有效角色。');
  return value as CharacterId;
}
function nickname(value: unknown): string {
  if (typeof value !== 'string') throw new Error('请输入昵称。');
  const name = value.normalize('NFKC').trim();
  if (!name || Array.from(name).length > 16 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>]/u.test(name)) {
    throw new Error('昵称应为1至16个字，请勿使用控制符或尖括号。');
  }
  return name;
}
export function validateSettings(value: unknown, base: MatchSettings = DEFAULT_SETTINGS): MatchSettings {
  const patch = object(value);
  if (Object.keys(patch).some(key => !SETTINGS_KEYS.has(key))) throw new Error('包含未知的房间设置。');
  const settings = { ...base, ...patch } as MatchSettings;
  if (!['1v1', '2v2', 'ffa'].includes(settings.mode)) throw new Error('对战模式不正确。');
  if (!['sky', 'village', 'mountain'].includes(settings.map)) throw new Error('地图不正确。');
  if (!Number.isInteger(settings.roundsToWin) || settings.roundsToWin < 1 || settings.roundsToWin > 5) throw new Error('获胜局数应为1至5。');
  if (!Number.isFinite(settings.dropInterval) || settings.dropInterval < 5 || settings.dropInterval > 60) throw new Error('道具间隔应为5至60秒。');
  if (typeof settings.friendlyFire !== 'boolean' || typeof settings.itemsEnabled !== 'boolean') throw new Error('道具和友伤设置不正确。');
  return settings;
}
export function validateInput(value: unknown): InputState {
  const packet = object(value);
  if (Object.keys(packet).some(key => !INPUT_KEYS.has(key))) throw new Error('输入消息只允许移动和按键。');
  if (typeof packet.move !== 'number' || !Number.isFinite(packet.move)) throw new Error('移动输入不正确。');
  const input: InputState = { ...EMPTY_INPUT, move: Math.max(-1, Math.min(1, packet.move)) };
  for (const key of BOOLEAN_INPUTS) {
    if (packet[key] !== undefined && typeof packet[key] !== 'boolean') throw new Error('按键输入不正确。');
    input[key] = packet[key] === true;
  }
  if (packet.seq !== undefined) {
    if (!Number.isSafeInteger(packet.seq) || (packet.seq as number) < 0) throw new Error('输入序号不正确。');
    input.seq = packet.seq as number;
  }
  return input;
}
function allocateRoomCode(): string {
  let code: string;
  do { code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(''); } while (ROOM_CODES.has(code));
  ROOM_CODES.add(code);
  return code;
}

export class BrawlRoom extends Room {
  maxClients = 4;
  autoDispose = true;
  patchRate = null;
  maxMessagesPerSecond = 180;
  private hostId = '';
  private settings: MatchSettings = { ...DEFAULT_SETTINGS };
  private roster: RosterPlayer[] = [];
  private game?: GameState;
  private inputPackets: Record<string, { input: InputState; at: number }> = Object.create(null);
  private buckets = new Map<string, { tokens: number; at: number }>();
  private botNumber = 0;
  private broadcastTick = 0;

  onCreate(options: unknown) {
    const opts = object(options);
    nickname(opts.name);
    character(opts.character);
    this.settings = validateSettings(opts.settings ?? {});
    this.roomId = allocateRoomCode();
    this.seatReservationTimeout = 15;
    this.onMessage('requestLobby', client => {
      client.send('lobby', this.lobby());
      if (this.game) client.send('state', snapshotGame(this.game));
    });
    this.command('profile', (client, payload) => {
      this.requireLobby();
      const data = object(payload);
      if (Object.keys(data).some(key => !['name', 'character'].includes(key))) throw new Error('只能修改自己的昵称和角色。');
      const player = this.player(client);
      const nextName = nickname(data.name ?? player.name);
      const nextCharacter = character(data.character ?? player.character);
      this.requireDistinctTeamCharacter(player, nextCharacter);
      player.name = nextName;
      player.character = nextCharacter;
      player.ready = false;
    });
    this.command('ready', (client, payload) => {
      this.requireLobby();
      const data = object(payload);
      if (typeof data.ready !== 'boolean' || Object.keys(data).some(key => key !== 'ready')) throw new Error('准备状态不正确。');
      this.player(client).ready = data.ready;
    });
    const updateSettings = (client: Client, payload: unknown) => {
      this.requireHost(client);
      this.requireLobby();
      this.settings = validateSettings(payload, this.settings);
      this.resetReady();
      this.assignTeams();
    };
    this.command('settings', updateSettings);
    this.command('setSettings', updateSettings);
    this.command('addBot', (client, payload) => {
      this.requireHost(client);
      this.requireLobby();
      if (this.roster.length >= 4) throw new Error('房间最多4个位置，请先移除人机。');
      const data = object(payload ?? {});
      const botCharacter = character(data.character ?? 'uncle');
      const botDifficulty = this.difficulty(data.difficulty ?? 'medium');
      this.roster.push({ id: `bot-${++this.botNumber}`, name: `难绷人机${this.botNumber}`, character: botCharacter, team: 0, bot: true, difficulty: botDifficulty, ready: true });
      this.assignTeams();
      this.resetReady();
    });
    this.command('removeBot', (client, payload) => {
      this.requireHost(client);
      this.requireLobby();
      const data = object(payload);
      const index = this.roster.findIndex(player => player.id === data.id && player.bot);
      if (index < 0) throw new Error('未找到该人机。');
      this.roster.splice(index, 1);
      this.assignTeams();
      this.resetReady();
    });
    this.command('updateBot', (client, payload) => {
      this.requireHost(client);
      this.requireLobby();
      const data = object(payload);
      if (Object.keys(data).some(key => !['id', 'character', 'difficulty'].includes(key))) throw new Error('人机设置不正确。');
      const bot = this.roster.find(player => player.id === data.id && player.bot);
      if (!bot) throw new Error('未找到该人机。');
      const nextCharacter = character(data.character ?? bot.character);
      const nextDifficulty = this.difficulty(data.difficulty ?? bot.difficulty);
      this.requireDistinctTeamCharacter(bot, nextCharacter);
      bot.character = nextCharacter;
      bot.difficulty = nextDifficulty;
      this.resetReady();
    });
    this.command('randomCharacters', client => {
      this.requireHost(client); this.requireLobby();
      const ids = Object.keys(CHARACTERS) as CharacterId[];
      const editable = this.roster.filter(player => player.bot || player.id === client.sessionId);
      const used = new Map<number, Set<CharacterId>>();
      for (const player of this.roster.filter(player => !editable.includes(player))) {
        const team = used.get(player.team) ?? new Set<CharacterId>(); team.add(player.character); used.set(player.team, team);
      }
      for (const player of editable) {
        const team = used.get(player.team) ?? new Set<CharacterId>();
        const candidates = this.settings.mode === '2v2' ? ids.filter(id => !team.has(id)) : ids;
        player.character = candidates[randomInt(candidates.length)];
        team.add(player.character); used.set(player.team, team);
      }
      this.resetReady();
    });
    this.command('randomDifficulties', client => {
      this.requireHost(client); this.requireLobby();
      const levels: Difficulty[] = ['easy', 'medium', 'hard'];
      for (const player of this.roster) if (player.bot) player.difficulty = levels[randomInt(levels.length)];
      this.resetReady();
    });
    this.command('start', client => { this.requireHost(client); this.requireLobby(); this.startMatch(); });
    this.command('rematch', client => {
      this.requireHost(client);
      if (!this.game || this.game.phase !== 'matchEnd') throw new Error('比赛结束后才能再来一场。');
      this.startMatch();
    });
    this.command('backToLobby', client => {
      this.requireHost(client);
      this.game = undefined;
      this.inputPackets = Object.create(null);
      this.resetReady();
      void this.unlock();
    });
    this.onMessage('input', (client, payload: unknown) => {
      if (!this.game || this.game.phase === 'matchEnd') return;
      const now = performance.now();
      const bucket = this.buckets.get(client.sessionId) ?? { tokens: 15, at: now };
      bucket.tokens = Math.min(15, bucket.tokens + (now - bucket.at) * 0.09);
      bucket.at = now;
      this.buckets.set(client.sessionId, bucket);
      if (bucket.tokens < 1) return;
      bucket.tokens--;
      try {
        const input = validateInput(payload);
        const previous = this.inputPackets[client.sessionId]?.input.seq;
        if (input.seq !== undefined && previous !== undefined && input.seq <= previous) return;
        this.inputPackets[client.sessionId] = { input, at: now };
      } catch (error) { this.fail(client, error); }
    });
    this.onMessage('*', (client, type) => this.fail(client, new Error(`不支持的房间操作：${String(type).slice(0, 24)}`)));
    this.setFixedTimestep(() => {
      if (!this.game) return;
      const now = performance.now();
      const inputs: Record<string, InputState> = Object.create(null);
      for (const [id, packet] of Object.entries(this.inputPackets)) {
        inputs[id] = now - packet.at <= 250 ? packet.input : { ...EMPTY_INPUT, seq: packet.input.seq };
      }
      const lastEventId = this.game.eventId;
      stepGame(this.game, inputs, 1 / 60);
      // Deliver contact immediately so a three-frame hit stop is visible to every
      // client, while retaining the normal 20 Hz stream between contacts.
      const hit = this.game.events.some(event => event.id > lastEventId && event.type === 'hit');
      if (++this.broadcastTick % 3 === 0 || hit) this.broadcast('state', snapshotGame(this.game));
    }, 60);
    // Colyseus creates a fallback clock ticker when patchRate=null is applied
    // before the simulation exists. Reapply it now to remove that second ticker:
    // otherwise it consumes the same clock delta and can stall fixed-step play.
    this.patchRate = null;
  }
  onAuth(_client: Client, options: unknown) {
    try {
      if (this.game) throw new Error('比赛已开始，请等待房主返回房间。');
      if (this.roster.length >= 4) throw new Error('房间已满。');
      const opts = object(options);
      nickname(opts.name);
      character(opts.character);
      return true;
    } catch (error) { throw new ServerError(400, error instanceof Error ? error.message : '无法进入房间。'); }
  }
  onJoin(client: Client, options: unknown) {
    if (this.roster.length >= 4 || this.game) throw new ServerError(400, '房间已满或比赛已开始。');
    const opts = object(options);
    this.roster.push({ id: client.sessionId, name: nickname(opts.name), character: character(opts.character), team: 0, bot: false, difficulty: 'medium', ready: false });
    if (!this.hostId) this.hostId = client.sessionId;
    this.assignTeams();
    this.resetReady();
    this.broadcast('lobby', this.lobby());
  }
  onLeave(client: Client) {
    delete this.inputPackets[client.sessionId];
    this.buckets.delete(client.sessionId);
    const player = this.roster.find(item => item.id === client.sessionId);
    if (this.game && player) {
      player.bot = true;
      player.ready = true;
      player.name = `${Array.from(player.name).slice(0, 12).join('')}·托管`;
      const actor = this.game.players.find(item => item.id === client.sessionId);
      if (actor) { actor.bot = true; actor.difficulty = player.difficulty; actor.name = player.name; }
      const savedPlayer = this.game.roster.find(item => item.id === client.sessionId);
      if (savedPlayer) { savedPlayer.bot = true; savedPlayer.difficulty = player.difficulty; savedPlayer.name = player.name; }
    } else {
      this.roster = this.roster.filter(item => item.id !== client.sessionId);
      this.assignTeams();
      this.resetReady();
    }
    if (this.hostId === client.sessionId) this.hostId = this.roster.find(item => !item.bot)?.id ?? '';
    this.broadcast('lobby', this.lobby());
    if (this.game) this.broadcast('state', snapshotGame(this.game));
  }
  onDispose() { ROOM_CODES.delete(this.roomId); }
  private difficulty(value: unknown): Difficulty {
    if (!DIFFICULTIES.has(value as Difficulty)) throw new Error('人机难度不正确。');
    return value as Difficulty;
  }
  private command(type: string, callback: (client: Client, payload: unknown) => void) {
    this.onMessage(type, (client, payload: unknown) => {
      try { callback(client, payload); this.broadcast('lobby', this.lobby()); } catch (error) {
        this.fail(client, error);
        client.send('lobby', this.lobby());
      }
    });
  }
  private fail(client: Client, error: unknown) { client.send('error', { message: error instanceof Error ? error.message : '房间操作失败。' }); }
  private player(client: Client): RosterPlayer {
    const player = this.roster.find(item => item.id === client.sessionId && !item.bot);
    if (!player) throw new Error('玩家身份已失效。');
    return player;
  }
  private requireHost(client: Client) { if (client.sessionId !== this.hostId) throw new Error('只有房主可以进行此操作。'); }
  private requireLobby() { if (this.game) throw new Error('比赛进行中，房间设置已锁定。'); }
  private resetReady() { for (const player of this.roster) player.ready = player.bot; }
  private assignTeams() {
    this.roster.forEach((player, index) => { player.team = this.settings.mode === 'ffa' ? index : index % 2; });
    if (this.settings.mode !== '2v2') return;
    const used = new Map<number, Set<CharacterId>>();
    for (const player of this.roster) {
      const teamCharacters = used.get(player.team) ?? new Set<CharacterId>();
      if (teamCharacters.has(player.character)) player.character = (Object.keys(CHARACTERS) as CharacterId[]).find(id => !teamCharacters.has(id))!;
      teamCharacters.add(player.character);
      used.set(player.team, teamCharacters);
    }
  }
  private requireDistinctTeamCharacter(player: RosterPlayer, selected: CharacterId) {
    if (this.settings.mode === '2v2' && this.roster.some(other => other.id !== player.id && other.team === player.team && other.character === selected)) {
      throw new Error('同队需要选择不同角色，请换一个角色。');
    }
  }
  private canStart() {
    const count = this.roster.length;
    return (this.settings.mode === '1v1' ? count === 2 : this.settings.mode === '2v2' ? count === 4 : count >= 2 && count <= 4) && this.roster.every(player => player.ready);
  }
  private lobby(): LobbySnapshot {
    return { roomId: this.roomId, hostId: this.hostId, settings: { ...this.settings }, players: this.roster.map(player => ({ ...player })), started: Boolean(this.game), canStart: !this.game && this.canStart() };
  }
  private startMatch() {
    for (const player of this.roster) this.requireDistinctTeamCharacter(player, player.character);
    if (!this.canStart()) throw new Error(this.settings.mode === '1v1' ? '1v1需要正好2人，且所有玩家准备。' : this.settings.mode === '2v2' ? '2v2需要正好4人，且所有玩家准备。' : '混战需要2至4人，且所有玩家准备。');
    this.assignTeams();
    this.inputPackets = Object.create(null);
    this.broadcastTick = 0;
    this.game = createGame({ ...this.settings }, this.roster.map(player => ({ ...player })), randomInt(1, 0x7fffffff));
    void this.lock();
    this.broadcast('state', snapshotGame(this.game));
  }
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
async function serveStatic(req: IncomingMessage, res: ServerResponse, distRoot: string) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Method not allowed'); return; }
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname); } catch { res.writeHead(400); res.end('Bad URL'); return; }
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.') && part !== '')) { res.writeHead(403); res.end('Forbidden'); return; }
  const root = resolve(distRoot);
  const candidate = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  const localPath = relative(root, candidate);
  if (localPath.startsWith('..') || isAbsolute(localPath)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(candidate)]);
    const realLocal = relative(realRoot, realFile);
    if (realLocal.startsWith('..') || isAbsolute(realLocal)) { res.writeHead(403); res.end('Forbidden'); return; }
    const file = await stat(realFile);
    if (!file.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(realFile).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': file.size, 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=3600' : 'no-cache' });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(realFile);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('尚未构建游戏页面，请先运行 npm run build；开发模式请打开5173端口。'); }
}

export interface GameServerOptions { port?: number; host?: string; distRoot?: string; quiet?: boolean }
export async function startGameServer(options: GameServerOptions = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 2567);
  const host = options.host ?? '0.0.0.0';
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('服务器端口不正确。');
  const httpServer = createServer();
  const server = new Server({
    greet: false,
    gracefullyShutdown: false,
    transport: new WebSocketTransport({ server: httpServer, maxPayload: 4096, perMessageDeflate: false, pingInterval: 3000, pingMaxRetries: 3 }),
    express(app) {
      app.get('/health', (_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, service: 'pixel-brawl', simulationHz: 60, snapshotHz: 20 }));
      });
      app.use((req: IncomingMessage, res: ServerResponse) => { void serveStatic(req, res, options.distRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '../dist')); });
    },
  });
  server.define('brawl', BrawlRoom);
  await server.listen(port, host);
  const address = httpServer.address();
  const actualPort = address && typeof address === 'object' ? address.port : port;
  const addresses = Object.values(networkInterfaces()).flat().filter(item => item && !item.internal && item.family === 'IPv4').map(item => `http://${item!.address}:${actualPort}`);
  if (!options.quiet) {
    console.log(`绷住俱乐部房间服务：http://localhost:${actualPort}`);
    for (const address of addresses) console.log(`可用网络地址（请选择与手机同网段的地址）：${address}`);
  }
  let stopped = false;
  return { server, httpServer, port: actualPort, addresses, async stop() { if (!stopped) { stopped = true; await server.gracefullyShutdown(false); } } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = await startGameServer();
  const stop = () => { void runtime.stop().then(() => process.exit(0)); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
