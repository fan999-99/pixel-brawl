import { Client } from '@colyseus/sdk';
import type { CharacterId, GameSnapshot, InputState, LobbySnapshot, MatchSettings } from '../shared/types.js';

export interface ConnectOptions { name: string; character: CharacterId; code?: string; settings?: MatchSettings }
export interface NetworkCallbacks {
  onLobby(lobby: LobbySnapshot): void;
  onState(state: GameSnapshot): void;
  onError(message: string): void;
  onLeave(): void;
}
export interface OnlineConnection {
  id: string;
  sessionId: string;
  send(type: string, payload?: unknown): void;
  input(input: InputState): void;
  leave(): Promise<void>;
}

export function gameServerEndpoint(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env;
  const override = env?.VITE_GAME_SERVER;
  const location = globalThis.location;
  const url = new URL(typeof override === 'string' && override.trim() ? override.trim() : location ? location.href : 'http://localhost:2567');
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  if (!override && (env?.DEV === true || url.port === '5173')) url.port = '2567';
  url.pathname = url.pathname === '/' || !override ? '/' : url.pathname;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}
function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '无法连接房间服务器。';
  if (/not found|invalid room|does not exist/i.test(message)) return '没有找到这个房间，请检查6位房间码。';
  if (/maxclients|full|locked/i.test(message)) return '房间已满或比赛已经开始。';
  if (/fetch|network|websocket|econnrefused|failed to connect/i.test(message)) return '连接失败，请确认房间服务已启动，并与房主使用同一服务器。';
  return message;
}
export async function connectRoom(mode: 'create' | 'join', options: ConnectOptions, callbacks: NetworkCallbacks): Promise<OnlineConnection> {
  try {
    const client = new Client(gameServerEndpoint());
    const profile = { name: options.name, character: options.character };
    const code = options.code?.trim().toUpperCase();
    if (mode === 'join' && (!code || !/^[A-HJ-NP-Z2-9]{6}$/.test(code))) throw new Error('请输入6位房间码（不含I、O、0、1）。');
    const room = mode === 'create' ? await client.create('brawl', { ...profile, settings: options.settings }) : await client.joinById(code!, profile);
    // This prototype replaces disconnected players immediately with bots; the server
    // does not reserve reconnection sessions, so SDK retries would only freeze the UI.
    room.reconnection.enabled = false;
    let closed = false;
    let seq = 0;
    let leavePromise: Promise<void> | undefined;
    room.onMessage<LobbySnapshot>('lobby', lobby => callbacks.onLobby(lobby));
    room.onMessage<GameSnapshot>('state', state => callbacks.onState(state));
    room.onMessage<{ message?: string } | string>('error', error => callbacks.onError(typeof error === 'string' ? error : error.message ?? '房间操作失败。'));
    room.onError((_code, message) => callbacks.onError(friendlyError(message ?? '房间连接出现错误。')));
    room.onLeave(() => { if (!closed) { closed = true; callbacks.onLeave(); } });
    room.send('requestLobby');
    return {
      id: room.roomId,
      sessionId: room.sessionId,
      send(type, payload) { if (!closed) room.send(type, payload); },
      input(input) {
        if (closed) return;
        // Prediction and acknowledgements must use the caller's exact sequence.
        // Fixed-step catch-up can legitimately send several packets in one frame;
        // rate validation is authoritative on the server rather than dropping them here.
        const nextSeq = Number.isSafeInteger(input.seq) && input.seq! >= 0 ? input.seq! : seq + 1;
        seq = Math.max(seq, nextSeq);
        room.send('input', { move: input.move, down: input.down, jump: input.jump, attack: input.attack, dash: input.dash, skill1: input.skill1, skill2: input.skill2, pickup: input.pickup, seq: nextSeq });
      },
      async leave() {
        if (closed) return;
        if (!leavePromise) leavePromise = (async () => {
          if (room.connection.isOpen) await room.leave(true);
          if (!closed) { closed = true; callbacks.onLeave(); }
        })();
        await leavePromise;
      },
    };
  } catch (error) {
    const message = friendlyError(error);
    callbacks.onError(message);
    throw new Error(message);
  }
}
