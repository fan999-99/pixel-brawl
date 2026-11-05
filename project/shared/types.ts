export type GameMode = '1v1' | '2v2' | 'ffa';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type CharacterId = 'uncle' | 'slipper' | 'chicken' | 'raccoon';
export type MapId = 'sky' | 'village' | 'mountain';
export type ItemKind = 'banana' | 'shield' | 'shoes' | 'popcorn' | 'watergun';

export interface InputState {
  move: number;
  down: boolean;
  jump: boolean;
  attack: boolean;
  dash: boolean;
  skill1: boolean;
  skill2: boolean;
  pickup: boolean;
  seq?: number;
}
export interface MatchSettings {
  mode: GameMode;
  map: MapId;
  roundsToWin: number;
  dropInterval: number;
  friendlyFire: boolean;
  itemsEnabled: boolean;
}
export interface RosterPlayer {
  id: string;
  name: string;
  character: CharacterId;
  team: number;
  bot: boolean;
  difficulty: Difficulty;
  ready: boolean;
}
export interface Platform { id: string; x: number; y: number; width: number; oneWay: boolean }
export interface ArenaDefinition {
  id: MapId; name: string; subtitle: string; background: string;
  left: number; right: number; groundY: number; platforms: Platform[];
}
export interface CharacterDefinition {
  id: CharacterId; name: string; title: string; color: string; accent: string;
  description: string; skill1: string; skill2: string;
}
export interface PlayerSnapshot {
  id: string; name: string; character: CharacterId; team: number;
  bot: boolean; difficulty: Difficulty;
  x: number; y: number; vx: number; vy: number; facing: number;
  hp: number; maxHp: number; shield: number;
  grounded: boolean; dead: boolean; respawnIn: number;
  invuln: number; controlProtection: number; stun: number; blocking: boolean;
  attackPhase: number; attackTime: number; action: string; actionTime: number;
  idleTime: number;
  damageFlash: number; kills: number; deaths: number; assists: number; damage: number; score: number;
  heldItem: ItemKind | null; ammo: number;
  cd: { dash: number; skill1: number; skill2: number };
  statuses: { speed: number; slow?: number };
  lastInputSeq?: number;
  jumpsLeft?: number; jumpLatch?: boolean; downLatch?: boolean; dashLatch?: boolean; dropThrough?: number;
}
export interface DropWarningSnapshot {
  id: string; kind: ItemKind; x: number; y: number; inSeconds: number;
}
export interface ItemSnapshot {
  id: string; kind: ItemKind; x: number; y: number; vy: number;
  landed: boolean; ttl: number;
  ammo?: number;
}
export interface ProjectileSnapshot {
  id: string; kind: string; ownerId: string; team: number;
  x: number; y: number; vx: number; vy: number;
  radius: number; ttl: number; damage: number; timer?: number;
}
export interface EffectSnapshot {
  id: string; kind: string; x: number; y: number; radius: number;
  ttl: number; duration: number; color?: string; ownerId?: string;
}
export interface GameEvent {
  id: number; type: 'hit' | 'ko' | 'pickup' | 'drop' | 'round' | 'skill' | 'win';
  text: string; actorId?: string; targetId?: string; x?: number; y?: number; count?: number;
  damage?: number; heavy?: boolean; guarded?: boolean; direction?: number; hitStop?: number;
}
export interface GameSnapshot {
  phase: 'countdown' | 'playing' | 'roundEnd' | 'matchEnd';
  tick: number; timeLeft: number; round: number; roundWins: number[];
  hitStop: number;
  settings: MatchSettings; players: PlayerSnapshot[];
  items: ItemSnapshot[]; projectiles: ProjectileSnapshot[]; effects: EffectSnapshot[];
  dropWarnings: DropWarningSnapshot[];
  events: GameEvent[]; dropIn: number; safeZone: { left: number; right: number };
  winner: string | null; result: string; countdown: number;
}
export interface LobbySnapshot {
  roomId: string; hostId: string; settings: MatchSettings; players: RosterPlayer[];
  started: boolean; canStart: boolean;
}
export const EMPTY_INPUT: InputState = { move: 0, down: false, jump: false, attack: false, dash: false, skill1: false, skill2: false, pickup: false };
