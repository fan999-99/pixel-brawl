import Phaser from 'phaser';
import { ARENAS, CHARACTERS, ITEM_NAMES, MODE_NAMES, WORLD_HEIGHT, WORLD_WIDTH } from '../shared/config.js';
import type { CharacterId, GameEvent, GameSnapshot, ItemKind, MapId, PlayerSnapshot, RosterPlayer } from '../shared/types.js';

export interface GameRenderer {
  render(snapshot: GameSnapshot, localId: string): void;
  preview(map: MapId, roster: RosterPlayer[]): void;
  destroy(): void;
  setMuted(muted: boolean): void;
  shake?(amount: number): void;
}

type Pose = 'idle' | 'idle0' | 'idle1' | 'idle2' | 'run0' | 'run1' | 'jump' | 'duck' | 'attack1' | 'attack2' | 'heavy' | 'hit';
interface PlayerView { sprite: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; flashUntil: number }
interface FloatLabel { text: Phaser.GameObjects.Text; x: number; y: number; born: number; life: number }
const FONT = '"Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';
const POSES: Pose[] = ['idle', 'idle0', 'idle1', 'idle2', 'run0', 'run1', 'jump', 'duck', 'attack1', 'attack2', 'heavy', 'hit'];
const TEAM_COLORS = [0x5ab9ff, 0xff738f, 0xffd05a, 0xb2a0ff];
const hex = (value: string) => Number.parseInt(value.replace('#', ''), 16);

class GameSounds {
  private context?: AudioContext;
  private muted = false;
  private disposed = false;
  private last = new Map<string, number>();
  private unlock = () => {
    if (this.disposed) return;
    if (!this.context) {
      const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtor) this.context = new AudioCtor();
    }
    if (this.context?.state === 'suspended') void this.context.resume().catch(() => {});
  };
  constructor() {
    document.addEventListener('pointerdown', this.unlock, { passive: true });
    document.addEventListener('keydown', this.unlock, { passive: true });
  }
  setMuted(value: boolean) { this.muted = value; }
  play(type: GameEvent['type'], heavy = false, guarded = false) {
    const context = this.context;
    if (!context || context.state !== 'running' || this.muted || this.disposed) return;
    const now = performance.now();
    const soundKey = `${type}-${heavy ? 'heavy' : 'normal'}`;
    if (now - (this.last.get(soundKey) ?? -1000) < (type === 'hit' ? 35 : 100)) return;
    this.last.set(soundKey, now);
    const tones: Record<string, [number, number, number]> = {
      hit: [190, 70, .07], ko: [400, 65, .23], pickup: [650, 1200, .10],
      drop: [540, 320, .08], skill: [300, 720, .11], round: [560, 840, .19], win: [660, 1320, .35],
    };
    const [start, end, duration] = type === 'hit' && heavy ? [140, 40, .12] : tones[type] || tones.hit;
    // Both layers begin on this audio-clock sample in the same render as the hit flash.
    const at = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type === 'pickup' || type === 'win' ? 'triangle' : 'square';
    oscillator.frequency.setValueAtTime(guarded ? start * 1.6 : start, at);
    oscillator.frequency.exponentialRampToValueAtTime(end, at + duration);
    gain.gain.setValueAtTime(type === 'hit' ? heavy ? .033 : .024 : .035, at);
    gain.gain.exponentialRampToValueAtTime(.001, at + duration);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(at); oscillator.stop(at + duration + .02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    if (type === 'hit') {
      const bass = context.createOscillator();
      const bassGain = context.createGain();
      bass.type = 'sine';
      bass.frequency.setValueAtTime(heavy ? 100 : 145, at);
      bass.frequency.exponentialRampToValueAtTime(heavy ? 36 : 62, at + duration);
      bassGain.gain.setValueAtTime(guarded ? .026 : heavy ? .09 : .048, at);
      bassGain.gain.exponentialRampToValueAtTime(.001, at + duration);
      bass.connect(bassGain); bassGain.connect(context.destination);
      bass.start(at); bass.stop(at + duration + .02);
      bass.onended = () => { bass.disconnect(); bassGain.disconnect(); };
    }
  }
  destroy() {
    this.disposed = true;
    document.removeEventListener('pointerdown', this.unlock);
    document.removeEventListener('keydown', this.unlock);
    if (this.context) void this.context.close().catch(() => {});
  }
}

/** Build original, code-native pixel sprites. Every source pixel is a 2×2 square. */
function makeCharacterTexture(scene: Phaser.Scene, character: CharacterId, pose: Pose) {
  const textureKey = `fighter-${character}-${pose}`;
  const canvas = document.createElement('canvas'); canvas.width = 56; canvas.height = 60;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  const grid = Array.from({ length: 30 }, () => Array<string>(28).fill(''));
  const rect = (x: number, y: number, width: number, height: number, color: string) => {
    for (let row = Math.max(0, y); row < Math.min(30, y + height); row++) {
      for (let col = Math.max(0, x + 4); col < Math.min(28, x + width + 4); col++) grid[row][col] = color;
    }
  };
  const ink = '#202439';
  const body = CHARACTERS[character].color;
  const accent = CHARACTERS[character].accent;
  const crouch = pose === 'duck' ? 7 : 0;
  const resting = /^idle\d$/.test(pose);
  const restFrame = resting ? Number(pose.slice(-1)) : -1;
  const striking = pose === 'attack1' || pose === 'attack2' || pose === 'heavy';
  const bob = pose === 'run1' || (resting && character === 'chicken' && restFrame === 1) ? -1 : 0;
  const headY = 4 + crouch + bob - (resting && character === 'raccoon' && restFrame === 1 ? 2 : 0);
  const bodyY = 13 + Math.round(crouch / 2) + bob;
  const skin = character === 'chicken' ? '#fff6d4' : character === 'raccoon' ? '#a4a7b5' : '#f1b693';
  const outlined = (x: number, y: number, w: number, h: number, color: string) => { rect(x - 1, y - 1, w + 2, h + 2, ink); rect(x, y, w, h, color); };

  if (character === 'raccoon') {
    outlined(1, bodyY + 5, 4, 7, '#a8a2b4'); rect(1, bodyY + 6, 4, 2, '#555267'); rect(1, bodyY + 10, 4, 2, '#555267');
  }
  // Boots and legs alternate in the two running frames.
  const leftX = pose === 'run0' || (resting && character === 'chicken' && restFrame !== 1) ? 4 : pose === 'run1' ? 8 : 6;
  const rightX = pose === 'run0' ? 12 : pose === 'run1' || (resting && character === 'chicken' && restFrame === 1) ? 10 : 11;
  if (pose === 'jump') {
    outlined(5, 23, 4, 3, accent); outlined(12, 23, 4, 3, accent);
    rect(3, 26, 6, 2, '#fcf0d5'); rect(12, 26, 6, 2, '#fcf0d5');
  } else if (pose === 'duck') {
    outlined(4, 26, 12, 2, accent); rect(3, 29, 6, 1, '#fff1d2'); rect(12, 29, 6, 1, '#fff1d2');
  } else if (resting && character === 'slipper' && restFrame === 1) {
    outlined(6, 22, 3, 6, accent); rect(5, 28, 5, 2, '#fff3d6');
    outlined(11, 22, 6, 3, accent); outlined(16, 21, 4, 5, '#f5789b'); rect(16, 22, 4, 1, '#fff1d7');
  } else {
    outlined(leftX, 22 + bob, 3, 6 - bob, accent); outlined(rightX, 22 + bob, 3, 6 - bob, accent);
    rect(leftX - 1, 28, 5, 2, character === 'chicken' ? '#e89c3c' : '#fff3d6');
    rect(rightX, 28, 5, 2, character === 'chicken' ? '#e89c3c' : '#fff3d6');
  }
  outlined(6, bodyY, 8, 9 - Math.round(crouch / 2), character === 'raccoon' ? '#b88b5e' : body);
  rect(7, bodyY + 1, 2, 6, '#fff4cb'); rect(11, bodyY + 1, 2, 5, accent);
  if (character === 'raccoon') { rect(6, bodyY + 4, 8, 1, '#715c4b'); rect(9, bodyY + 1, 2, 8, '#dfc18c'); }
  const armY = bodyY + (pose === 'hit' ? 1 : 3);
  outlined(3, armY, 3, 6, skin);
  if (pose === 'heavy') { outlined(13, armY - 5, 6, 4, skin); outlined(1, armY - 3, 4, 4, skin); }
  else if (pose === 'attack2') outlined(14, armY + 2, 6, 3, skin);
  else if (pose === 'attack1') outlined(14, armY - 1, 5, 3, skin);
  else if (pose === 'hit') outlined(15, armY - 3, 3, 4, skin);
  else if (resting && character === 'chicken') { outlined(14, armY - (restFrame === 1 ? 4 : 0), 5, 3, skin); outlined(1, armY - (restFrame === 1 ? 0 : 4), 4, 3, skin); }
  else if (resting && character === 'raccoon') outlined(13, armY - (restFrame === 1 ? 1 : 0), 4, 3, skin);
  else outlined(14, armY, 3, 6, skin);

  outlined(5, headY, 10, 8, skin);
  rect(5, headY + 7, 2, 2, '#d58f75');
  // Each fighter has an unmistakable silhouette and face.
  if (character === 'uncle') {
    rect(5, headY - 1, 3, 2, '#6c4a3e'); rect(13, headY - 1, 2, 3, '#6c4a3e');
    rect(7, headY + 5, 7, 2, '#634a41'); rect(10, headY + 5, 2, 1, skin);
    const panX = striking ? pose === 'heavy' ? 19 : 17 : resting ? 15 + restFrame : 15;
    const panY = bodyY + (pose === 'heavy' ? -6 : resting && restFrame === 1 ? -2 : 1);
    outlined(panX, panY + 5, 2, 4, '#755b41'); outlined(panX - 2, panY, 5, 5, '#bdcbd0'); rect(panX - 1, panY + 1, 2, 2, '#ecf2d9');
    if (resting) { outlined(13 + restFrame, panY + 3, 3, 3, skin); rect(15 + restFrame, panY + 2, 3, 2, '#fff7db'); }
  } else if (character === 'slipper') {
    rect(5, headY - 2, 10, 3, '#4e3769'); rect(4, headY, 2, 7, '#4e3769'); rect(6, headY + 1, 9, 2, '#fc7299');
    const shoeX = striking ? 18 : resting ? 14 + restFrame : 15;
    const shoeY = bodyY + (pose === 'heavy' ? -4 : resting ? 4 - restFrame : 6);
    outlined(shoeX, shoeY, 3, 5, '#f5789b'); rect(shoeX, shoeY + 1, 3, 1, '#fff1d7');
  } else if (character === 'chicken') {
    rect(8, headY - 3, 3, 3, '#df4c64'); rect(11, headY - 2, 3, 2, '#f16a77');
    outlined(15, headY + 4, 4, 2, '#ffc548'); rect(14, headY + 7, 2, 2, '#e75860');
    rect(6, headY + 2, 9, 2, '#352d4c'); rect(7, headY + 2, 2, 1, '#b2f7f0'); rect(12, headY + 2, 2, 1, '#b2f7f0');
  } else {
    outlined(4, headY - 3, 3, 4, '#9b9bab'); outlined(13, headY - 3, 3, 4, '#9b9bab');
    rect(6, headY + 2, 9, 3, '#403f50'); rect(9, headY + 6, 5, 2, '#f2e9d5'); rect(13, headY + 5, 2, 2, ink);
    if (resting) { rect(6, bodyY, 8, 2, '#e2bd82'); rect(5, bodyY - 1, 4, 2, skin); rect(12, bodyY - (restFrame === 1 ? 2 : 1), 4, 2, skin); }
  }
  if (character !== 'chicken') { rect(8, headY + 3, 2, 2, '#fff5db'); rect(12, headY + 3, 2, 2, '#fff5db'); rect(9, headY + 3, 1, 2, ink); rect(13, headY + 3, 1, 2, ink); }
  if (pose === 'hit') { rect(8, headY + 3, 2, 1, ink); rect(12, headY + 4, 2, 1, ink); }
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) if (grid[y][x]) { context.fillStyle = grid[y][x]; context.fillRect(x * 2, y * 2, 2, 2); }
  scene.textures.addCanvas(textureKey, canvas);
  const flashCanvas = document.createElement('canvas'); flashCanvas.width = canvas.width; flashCanvas.height = canvas.height;
  const flash = flashCanvas.getContext('2d')!;
  flash.drawImage(canvas, 0, 0); flash.globalCompositeOperation = 'source-in';
  flash.fillStyle = '#ffffff'; flash.fillRect(0, 0, flashCanvas.width, flashCanvas.height);
  scene.textures.addCanvas(`${textureKey}-flash`, flashCanvas);
}

class ArenaScene extends Phaser.Scene {
  private world!: Phaser.GameObjects.Container;
  private background!: Phaser.GameObjects.Image;
  private stage!: Phaser.GameObjects.Graphics;
  private shadows!: Phaser.GameObjects.Graphics;
  private objects!: Phaser.GameObjects.Graphics;
  private effects!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private title!: Phaser.GameObjects.Text;
  private timer!: Phaser.GameObjects.Text;
  private overlay!: Phaser.GameObjects.Text;
  private overlaySub!: Phaser.GameObjects.Text;
  private pickup!: Phaser.GameObjects.Text;
  private abilityLabels: Phaser.GameObjects.Text[] = [];
  private inventoryLabel!: Phaser.GameObjects.Text;
  private cards: { name: Phaser.GameObjects.Text; info: Phaser.GameObjects.Text; value: Phaser.GameObjects.Text }[] = [];
  private players = new Map<string, PlayerView>();
  private itemLabels = new Map<string, Phaser.GameObjects.Text>();
  private floating: FloatLabel[] = [];
  private seen = new Set<number>();
  private eventQueue: number[] = [];
  private map: MapId = 'sky';
  private tick = -1;
  private disposed = false;
  private shakeStarted = 0;
  private shakeDuration = 0;
  private shakeStrength = 0;
  private freezeUntil = 0;
  private frozenSnapshot?: GameSnapshot;
  private previousHitStop = 0;
  constructor(private ready: (scene: ArenaScene) => void, private sounds: GameSounds) { super({ key: 'pixel-arena' }); }
  preload() { for (const arena of Object.values(ARENAS)) this.load.image(`arena-${arena.id}`, arena.background); }
  create() {
    this.cameras.main.setRoundPixels(true);
    this.world = this.add.container(0, 0).setDepth(0);
    this.background = this.worldObject(this.add.image(640, 360, 'arena-sky').setDisplaySize(WORLD_WIDTH, WORLD_HEIGHT).setDepth(0));
    this.stage = this.worldObject(this.add.graphics().setDepth(1));
    this.shadows = this.worldObject(this.add.graphics().setDepth(2));
    this.objects = this.worldObject(this.add.graphics().setDepth(6));
    this.effects = this.worldObject(this.add.graphics().setDepth(9));
    this.hud = this.add.graphics().setDepth(20);
    for (const character of Object.keys(CHARACTERS) as CharacterId[]) for (const pose of POSES) makeCharacterTexture(this, character, pose);
    const text = (x: number, y: number, value: string, size: number, color = '#fff7e5') => this.add.text(x, y, value, { fontFamily: FONT, fontSize: size, color, stroke: '#17243e', strokeThickness: 3, padding: { x: 3, y: 2 } });
    this.title = text(640, 65, '', 13).setOrigin(.5, 0).setDepth(21);
    this.timer = text(640, 15, '', 36).setOrigin(.5, 0).setDepth(21);
    this.overlay = text(640, 222, '', 55).setOrigin(.5).setDepth(30).setAlign('center');
    this.overlaySub = text(640, 271, '', 18).setOrigin(.5).setDepth(30).setAlign('center');
    this.pickup = this.worldObject(text(0, 0, '', 13, '#ffe290').setOrigin(.5, 1).setDepth(11).setVisible(false));
    this.abilityLabels = [512, 640, 768].map(x => text(x, 630, '', 14).setOrigin(.5, 0).setDepth(21).setAlign('center').setVisible(false));
    this.inventoryLabel = text(640, 705, '', 13, '#fff1cb').setOrigin(.5, 1).setDepth(21).setVisible(false);
    for (let i = 0; i < 4; i++) {
      this.cards.push({ name: text(0, 0, '', 18).setDepth(21), info: text(0, 0, '', 14, '#d2e4ef').setDepth(21), value: text(0, 0, '', 28).setOrigin(1, 0).setDepth(21) });
    }
    this.ready(this);
  }
  private worldObject<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.world.add(object);
    return object;
  }
  private chooseArena(map: MapId) {
    this.map = map;
    if (this.textures.exists(`arena-${map}`)) this.background.setTexture(`arena-${map}`).setDisplaySize(WORLD_WIDTH, WORLD_HEIGHT);
  }
  private fighter(id: string, character: CharacterId): PlayerView {
    let view = this.players.get(id);
    if (!view) {
      view = {
        sprite: this.worldObject(this.add.image(0, 0, `fighter-${character}-idle`).setOrigin(.5, 1).setDepth(5)),
        label: this.worldObject(this.add.text(0, 0, '', { fontFamily: FONT, fontSize: 12, color: '#fff7e5', stroke: '#17243e', strokeThickness: 3, padding: { x: 3, y: 1 } }).setOrigin(.5, 1).setDepth(10)),
        flashUntil: 0,
      };
      this.players.set(id, view);
    }
    return view;
  }
  private removeMissing(ids: Set<string>) {
    for (const [id, view] of this.players) if (!ids.has(id)) { view.sprite.destroy(); view.label.destroy(); this.players.delete(id); }
  }
  private float(text: string, x: number, y: number, color: string, life = 750, size = 20) {
    while (this.floating.length >= 14) this.floating.shift()!.text.destroy();
    const label = this.worldObject(this.add.text(x, y, text, { fontFamily: FONT, fontSize: size, color, fontStyle: 'bold', stroke: '#20263c', strokeThickness: 4 }).setOrigin(.5).setDepth(14));
    this.floating.push({ text: label, x, y, born: performance.now(), life });
  }
  shake(amount: number, duration = 120) {
    const now = performance.now();
    const strength = Math.min(5, Math.max(1, amount * .55));
    if (now < this.shakeStarted + this.shakeDuration && strength < this.shakeStrength) return;
    this.shakeStarted = now; this.shakeDuration = duration; this.shakeStrength = strength;
  }
  private updateShake(now: number) {
    const progress = this.shakeDuration ? (now - this.shakeStarted) / this.shakeDuration : 1;
    if (progress >= 1) { this.world.setPosition(0, 0); return; }
    const strength = this.shakeStrength * (1 - progress);
    // Keep the health bars, timer and controls steady while the arena jolts by a few pixels.
    this.world.setPosition(Math.round(Math.sin(now * .19) * strength), Math.round(Math.cos(now * .23) * strength * .6));
  }
  private drawStage(snapshot?: GameSnapshot) {
    const arena = ARENAS[this.map];
    const g = this.stage.clear();
    for (const platform of arena.platforms) {
      g.lineStyle(platform.oneWay ? 2 : 3, platform.oneWay ? 0xd6fff0 : 0xffed9a, .56);
      g.lineBetween(platform.x + 4, platform.y + 1, platform.x + platform.width - 4, platform.y + 1);
      g.fillStyle(0xe9fff0, .72);
      g.fillRect(platform.x + 5, platform.y - 2, 4, 4); g.fillRect(platform.x + platform.width - 9, platform.y - 2, 4, 4);
    }
    const boundaries = snapshot?.safeZone ?? { left: arena.left, right: arena.right };
    for (const [index, x] of [boundaries.left, boundaries.right].entries()) {
      const active = Math.abs(x - (index === 0 ? arena.left : arena.right)) > 5;
      g.lineStyle(2, active ? 0xff657d : 0xffe096, active ? .8 : .38);
      for (let y = arena.groundY - 112; y < arena.groundY; y += 13) g.lineBetween(x, y, x, y + 7);
      g.fillStyle(active ? 0xff657d : 0xffe096, .9);
      g.fillTriangle(x - 5, arena.groundY - 119, x + 5, arena.groundY - 119, x, arena.groundY - 111);
    }
    if (boundaries.left > arena.left + 4) {
      g.fillStyle(0xd7335e, .10); g.fillRect(arena.left, 110, boundaries.left - arena.left, arena.groundY - 100);
      g.fillRect(boundaries.right, 110, arena.right - boundaries.right, arena.groundY - 100);
    }
  }
  private drawItem(kind: ItemKind | string, x: number, y: number, scale = 1) {
    const g = this.objects;
    const box = (color: number, dx: number, dy: number, w: number, h: number) => { g.fillStyle(color); g.fillRect(Math.round(x + dx * scale), Math.round(y + dy * scale), w * scale, h * scale); };
    g.lineStyle(2, 0x172438, .95);
    if (kind === 'banana') {
      box(0x273047, -12, -8, 24, 14); box(0xffd755, -10, -7, 6, 7); box(0xffd755, 4, -7, 6, 7); box(0xffe879, -7, -1, 14, 6); box(0xa97a3e, -12, -10, 4, 4);
    } else if (kind === 'shield') {
      g.fillStyle(0x22354b); g.fillEllipse(x, y - 1, 28 * scale, 22 * scale); g.fillStyle(0xffd95c); g.fillEllipse(x, y - 1, 23 * scale, 17 * scale); box(0xffdd67, 2, -15, 9, 12); box(0xffa247, 9, -10, 6, 4); box(0x273047, 7, -12, 2, 2);
    } else if (kind === 'shoes') {
      box(0x273047, -12, -9, 24, 14); box(0x98f3b9, -10, -7, 11, 6); box(0x947cdb, -1, -4, 11, 5); box(0xdbe3ff, -8, 2, 5, 3); box(0xdbe3ff, 4, 2, 5, 3);
    } else if (kind === 'popcorn' || kind.includes('bomb')) {
      box(0x273047, -11, -11, 22, 23); box(0xf57f88, -9, -7, 18, 17); box(0xffeed2, -5, -7, 3, 17); box(0xffeed2, 3, -7, 3, 17); box(0xfff2cc, -10, -13, 7, 7); box(0xfff8da, -2, -15, 8, 8); box(0xffd970, 5, -11, 6, 6);
    } else if (kind === 'watergun' || kind.includes('water')) {
      box(0x273047, -15, -8, 29, 10); box(0x78d9f3, -13, -6, 24, 6); box(0xffaa6d, -4, 0, 7, 10); box(0xb2eaff, -8, -11, 10, 5); box(0xf3e6b1, 11, -5, 5, 4);
    } else if (kind.includes('slipper')) {
      box(0x353047, -14, -5, 27, 10); box(0xfb83ae, -12, -3, 23, 6); box(0xffe6d6, -4, -3, 5, 6);
    } else if (kind.includes('package') || kind.includes('trap')) {
      box(0x303047, -12, -11, 24, 22); box(0xbd925e, -10, -9, 20, 18); box(0xf6d28d, -2, -9, 4, 18); box(0x78583f, -10, -1, 20, 2);
    } else {
      g.fillStyle(0x26344c); g.fillCircle(x, y, 8 * scale); g.fillStyle(0xfff4d9); g.fillCircle(x, y, 5 * scale); box(0x98b5c7, -4, -3, 4, 2);
    }
  }
  private drawObjects(snapshot: GameSnapshot, localId: string) {
    const g = this.objects.clear();
    const activeItems = new Set<string>();
    const local = snapshot.players.find(player => player.id === localId);
    let nearest: { x: number; y: number; distance: number; kind: ItemKind } | undefined;
    for (const warning of snapshot.dropWarnings ?? []) {
      activeItems.add(warning.id);
      g.fillStyle(0xf4cc66, .18); g.fillRect(warning.x - 25, warning.y - 12, 50, 12);
      g.lineStyle(3, 0xf4cc66, 1);
      g.lineBetween(warning.x - 25, warning.y - 12, warning.x - 25, warning.y);
      g.lineBetween(warning.x - 25, warning.y, warning.x + 25, warning.y);
      g.lineBetween(warning.x + 25, warning.y, warning.x + 25, warning.y - 12);
      g.fillStyle(0xf4cc66, 1); g.fillTriangle(warning.x - 7, warning.y - 40, warning.x + 7, warning.y - 40, warning.x, warning.y - 31);
      let label = this.itemLabels.get(warning.id);
      if (!label) { label = this.worldObject(this.add.text(0, 0, '', { fontFamily: FONT, fontSize: 16, color: '#f4cc66', stroke: '#183047', strokeThickness: 4 }).setOrigin(.5, 1).setDepth(10)); this.itemLabels.set(warning.id, label); }
      label.setVisible(true).setPosition(warning.x, warning.y - 43).setText(`空投 ${warning.inSeconds.toFixed(1)}秒`);
    }
    for (const item of snapshot.items) {
      activeItems.add(item.id);
      if (!item.landed) {
        g.lineStyle(1, 0xf9f3d8, .9); g.lineBetween(item.x - 16, item.y - 33, item.x - 5, item.y - 6); g.lineBetween(item.x + 16, item.y - 33, item.x + 5, item.y - 6);
        g.fillStyle(0xfdf7df, .95); g.beginPath(); g.arc(item.x, item.y - 33, 22, Math.PI, 0, false); g.closePath(); g.fillPath();
        g.fillStyle(0xf3a9bd); g.fillRect(item.x - 3, item.y - 53, 6, 20);
      }
      if (item.landed) { g.fillStyle(0x192c45, .18); g.fillEllipse(item.x, item.y + 11, 33, 8); }
      this.drawItem(item.kind, item.x, item.y);
      let label = this.itemLabels.get(item.id);
      if (!label) { label = this.worldObject(this.add.text(0, 0, '', { fontFamily: FONT, fontSize: 11, color: '#fff1ca', stroke: '#24344c', strokeThickness: 3 }).setOrigin(.5, 1).setDepth(10)); this.itemLabels.set(item.id, label); }
      label.setVisible(true).setFontSize(11).setColor('#fff1ca').setPosition(item.x, item.y - (item.landed ? 20 : 58)).setText(ITEM_NAMES[item.kind]);
      if (local && !local.dead && item.landed) {
        const distance = Math.hypot(local.x - item.x, local.y - item.y - 10);
        if (distance < 78 && (!nearest || distance < nearest.distance)) nearest = { ...item, distance };
      }
    }
    for (const [id, label] of this.itemLabels) if (!activeItems.has(id)) { label.destroy(); this.itemLabels.delete(id); }
    this.pickup.setVisible(!!nearest);
    if (nearest) {
      let key = 'F'; try { key = JSON.parse(localStorage.getItem('pixel-brawl-bindings-v1') || '{}').pickup?.replace('Key', '') || 'F'; } catch { /* Default hint is sufficient when storage is unavailable. */ }
      this.pickup.setPosition(nearest.x, nearest.y - 36).setText(`[${key}] 拾取 · ${nearest.kind === 'watergun' ? '水枪' : ITEM_NAMES[nearest.kind]}`);
    }
    for (const projectile of snapshot.projectiles) {
      const color = TEAM_COLORS[(projectile.team ?? 0) % TEAM_COLORS.length];
      if (projectile.timer !== undefined && /bomb|popcorn|package|trap/.test(projectile.kind)) {
        const radius = projectile.kind === 'popcorn' ? 105 : Math.max(24, projectile.radius);
        g.fillStyle(0xff677c, .05 + .05 * Math.sin(snapshot.tick / 4)); g.fillCircle(projectile.x, projectile.y, radius);
        g.lineStyle(2, 0xff9b86, .65); g.strokeCircle(projectile.x, projectile.y, radius);
        g.fillStyle(0xffd77c, .95); g.fillRect(projectile.x - 10, projectile.y - 26, Math.max(2, 20 * Math.min(1, projectile.timer / (projectile.kind === 'popcorn' ? .8 : 1.5))), 3);
      }
      if (Math.abs(projectile.vx) + Math.abs(projectile.vy) > 100) { g.lineStyle(3, color, .45); g.lineBetween(projectile.x, projectile.y, projectile.x - projectile.vx * .025, projectile.y - projectile.vy * .025); }
      this.drawItem(projectile.kind, projectile.x, projectile.y, .85);
    }
  }
  private drawPlayer(player: PlayerSnapshot, localId: string, snapshot: GameSnapshot) {
    const view = this.fighter(player.id, player.character);
    if (player.dead) { view.sprite.setVisible(false); view.label.setVisible(false); return; }
    const moving = Math.abs(player.vx) > 20;
    let pose: Pose = !player.grounded ? 'jump' : moving ? (Math.floor(snapshot.tick / 6) % 2 ? 'run0' : 'run1') : 'idle';
    if (pose === 'idle' && player.idleTime >= 2) pose = (['idle0', 'idle1', 'idle2', 'idle1'] as const)[Math.floor((player.idleTime - 2) / .22) % 4];
    if (player.blocking) pose = 'duck';
    if (player.attackTime > 0) pose = player.attackPhase >= 3 ? 'heavy' : player.attackPhase === 2 ? 'attack2' : 'attack1';
    else if (player.actionTime > 0 && /attack|slap|kick|punch|throw|pan/.test(player.action)) pose = 'attack1';
    if (player.stun > 0 || player.damageFlash > 0) pose = 'hit';
    const flashing = performance.now() < view.flashUntil;
    view.sprite.setVisible(true).setTexture(`fighter-${player.character}-${pose}${flashing ? '-flash' : ''}`).setPosition(Math.round(player.x), Math.round(player.y)).setFlipX(player.facing < 0);
    view.sprite.clearTint().setAlpha(player.invuln > 0 && Math.floor(snapshot.tick / 4) % 2 ? .5 : 1);
    // Wall-clock expiry keeps the white flash at 1–2 frames even during a global hit stop.
    if (flashing) view.sprite.setAlpha(1);
    const teamColor = snapshot.settings.mode === '2v2' ? TEAM_COLORS[player.team % 2] : hex(CHARACTERS[player.character].color);
    const underfoot = ARENAS[this.map].platforms.filter(platform => platform.y >= player.y - 3 && player.x >= platform.x && player.x <= platform.x + platform.width).sort((a, b) => a.y - b.y)[0];
    const shadowY = player.grounded ? player.y + 2 : underfoot ? underfoot.y + 2 : ARENAS[this.map].groundY + 2;
    this.shadows.fillStyle(0x1d2840, player.grounded ? .25 : .12); this.shadows.fillEllipse(player.x, shadowY, player.grounded ? 35 : 25, 8);
    this.effects.lineStyle(player.id === localId ? 3 : 2, player.id === localId ? 0xffe786 : teamColor, .85);
    this.effects.strokeEllipse(player.x, player.y + 1, 43, 12);
    if (snapshot.settings.mode === '2v2') { this.effects.fillStyle(teamColor); this.effects.fillRect(player.x - 3, player.y - 70, 6, 5); }
    if (player.id === localId) { this.effects.fillStyle(0xffe786); this.effects.fillTriangle(player.x - 5, player.y - 83, player.x + 5, player.y - 83, player.x, player.y - 76); }
    view.label.setVisible(true).setPosition(Math.round(player.x), Math.round(player.y - 61)).setText(`${player.id === localId ? '你 · ' : ''}${player.name}${player.bot ? ' · AI' : ''}`).setColor(player.id === localId ? '#ffe599' : '#fff7e5');
    if (player.shield > 0 || player.blocking) {
      this.effects.lineStyle(player.blocking ? 4 : 2, player.blocking ? 0xffe6a4 : 0x88e5f4, .6);
      this.effects.strokeEllipse(player.x, player.y - 28, 53, 65);
    }
    if (player.stun > 0) {
      this.effects.fillStyle(0xffdc70, 1);
      for (let i = 0; i < 3; i++) {
        const angle = i * Math.PI * 2 / 3 + snapshot.tick * .14;
        const x = Math.round(player.x + Math.cos(angle) * 17);
        const y = Math.round(player.y - 64 + Math.sin(angle) * 5);
        this.effects.fillRect(x - 3, y - 1, 6, 2); this.effects.fillRect(x - 1, y - 3, 2, 6);
      }
    }
    if (player.attackPhase > 0 && player.attackTime > 0) {
      const centerX = player.x + player.facing * 18;
      const start = player.facing > 0 ? -.9 : Math.PI - .9;
      this.effects.lineStyle(5, 0xffedbd, .75); this.effects.beginPath(); this.effects.arc(centerX, player.y - 27, 30 + player.attackPhase * 4, start, start + 1.8); this.effects.strokePath();
    }
    if (player.heldItem) this.drawItem(player.heldItem, player.x + player.facing * 19, player.y - 17, .58);
    if (moving && player.grounded && Math.floor(snapshot.tick / 4) % 2) { this.effects.fillStyle(0xfff2d8, .35); this.effects.fillRect(player.x - player.facing * 21, player.y - 4, 7, 4); }
  }
  private drawEffects(snapshot: GameSnapshot) {
    const g = this.effects;
    for (const effect of snapshot.effects) {
      const progress = Math.min(1, Math.max(0, 1 - effect.ttl / Math.max(.01, effect.duration)));
      const alpha = (1 - progress) * .75;
      const radius = Math.max(4, effect.radius * (.7 + progress * .3));
      const color = effect.color ? hex(effect.color) : /explosion|bomb/.test(effect.kind) ? 0xffba69 : 0xfff0bc;
      if (/explosion|bomb/.test(effect.kind)) { g.fillStyle(color, alpha * .25); g.fillCircle(effect.x, effect.y, radius); }
      if (/hit|impact|spark/.test(effect.kind)) {
        for (let i = 0; i < 8; i++) { const angle = i * Math.PI / 4; g.fillStyle(color, alpha); g.fillRect(effect.x + Math.cos(angle) * radius - 2, effect.y + Math.sin(angle) * radius - 2, 4, 4); }
      } else {
        g.lineStyle(/warning|telegraph/.test(effect.kind) ? 2 : 4, color, alpha); g.strokeCircle(effect.x, effect.y, radius);
      }
    }
    const now = performance.now();
    this.floating = this.floating.filter(item => {
      const progress = (now - item.born) / item.life;
      if (progress >= 1) { item.text.destroy(); return false; }
      item.text.setPosition(item.x, Math.round(item.y - progress * 40)).setAlpha(1 - Math.max(0, progress - .55) / .45);
      return true;
    });
  }
  private drawHud(snapshot: GameSnapshot, localId: string) {
    const g = this.hud.clear();
    const compact = this.game.canvas.clientWidth < 600;
    const cardWidth = compact ? 292 : 200;
    const cardHeight = compact ? 78 : 80;
    g.fillStyle(0x0c1d2b, .8); g.fillRect(538, 15, 208, 82);
    g.fillStyle(0x183047, .96); g.fillRect(534, 11, 208, 82);
    g.lineStyle(2, 0x89acc5, .95); g.strokeRect(534, 11, 208, 82);
    g.fillStyle(0xf4cc66, 1); g.fillRect(534, 11, 208, 4);
    const seconds = Math.ceil(Math.max(0, snapshot.timeLeft));
    this.timer.setPosition(638, 16).setFontSize(compact ? 44 : 36).setText(`${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`).setColor(snapshot.timeLeft < 20 ? '#ffb799' : '#f4cc66');
    this.title.setPosition(638, compact ? 65 : 61).setFontSize(compact ? 17 : 14).setText(`${MODE_NAMES[snapshot.settings.mode]} · 第 ${snapshot.round} 回合`);
    for (let i = 0; i < 4; i++) {
      const player = snapshot.players[i]; const card = this.cards[i];
      const x = compact ? i < 2 ? 16 : 856 : [16, 232, 758, 974][i];
      const y = compact ? 12 + i % 2 * 90 : 11;
      card.name.setVisible(!!player); card.info.setVisible(!!player); card.value.setVisible(!!player);
      if (!player) continue;
      const color = snapshot.settings.mode === '2v2' ? TEAM_COLORS[player.team % 2] : hex(CHARACTERS[player.character].color);
      g.fillStyle(0x0c1d2b, .65); g.fillRect(x + 4, y + 4, cardWidth, cardHeight);
      g.fillStyle(0x183047, player.dead ? .8 : .95); g.fillRect(x, y, cardWidth, cardHeight);
      g.lineStyle(player.id === localId ? 3 : 2, player.id === localId ? 0xf4cc66 : color, 1); g.strokeRect(x, y, cardWidth, cardHeight);
      g.fillStyle(color, 1); g.fillRect(x, y, 5, cardHeight);
      g.fillStyle(0x0c1d2b, 1); g.fillRect(x + 12, y + 39, cardWidth - 24, 12);
      const hp = Math.max(0, player.hp / Math.max(1, player.maxHp));
      g.fillStyle(player.dead ? 0x687b8c : hp > .5 ? 0x83b897 : hp > .25 ? 0xf4cc66 : 0xed7649); if (hp > 0) g.fillRect(x + 12, y + 39, Math.round((cardWidth - 24) * hp), 12);
      if (player.shield > 0) { g.lineStyle(2, 0x8de6ff, 1); g.strokeRect(x + 11, y + 38, cardWidth - 22, 14); }
      card.name.setPosition(x + 10, y + 5).setFontSize(compact ? 24 : 18).setText(`P${i + 1} ${player.name.slice(0, compact ? 6 : 5)}`).setColor(player.id === localId ? '#f4cc66' : '#f7fbff');
      card.value.setPosition(x + cardWidth - 9, y + 1).setFontSize(compact ? 34 : 28).setText(player.dead ? 'KO' : String(Math.ceil(player.hp))).setColor(player.dead ? '#edaa93' : '#f7fbff');
      card.info.setPosition(x + 10, y + 54).setFontSize(compact ? 18 : 14).setText(player.dead ? player.respawnIn > 0 ? `${Math.ceil(player.respawnIn)}秒后返场` : '本轮已倒下' : `${player.bot ? '人机' : player.id === localId ? '你' : '好友'}  ${snapshot.settings.mode === 'ffa' ? `${player.score}分` : `${player.kills}击败`}  /  HP`);
    }
    const local = snapshot.players.find(player => player.id === localId);
    const showAbilities = !!local && this.game.canvas.clientWidth >= 600;
    this.inventoryLabel.setVisible(showAbilities);
    for (let i = 0; i < this.abilityLabels.length; i++) this.abilityLabels[i].setVisible(showAbilities);
    if (local && showAbilities) {
      let keys: Record<string, string> = {};
      try { keys = JSON.parse(localStorage.getItem('pixel-brawl-bindings-v1') || '{}'); } catch { /* Use defaults. */ }
      const key = (action: string, fallback: string) => (keys[action] || fallback).replace(/^Key/, '').replace(/^Digit/, '');
      const specs = [
        [key('dash', 'K'), '突进', local.cd.dash],
        [key('skill1', 'I'), CHARACTERS[local.character].skill1, local.cd.skill1],
        [key('skill2', 'L'), CHARACTERS[local.character].skill2, local.cd.skill2],
      ] as const;
      for (let i = 0; i < specs.length; i++) {
        const [binding, name, cooldown] = specs[i];
        g.fillStyle(0x183047, .96); g.fillRect(452 + i * 128, 625, 120, 52);
        g.lineStyle(2, cooldown > 0 ? 0x416681 : 0xf4cc66, 1); g.strokeRect(452 + i * 128, 625, 120, 52);
        this.abilityLabels[i].setText(`${binding}  ${name}\n${cooldown > 0 ? `${Math.ceil(cooldown)} 秒` : '就绪'}`).setColor(cooldown > 0 ? '#b4c6d5' : '#f4cc66');
      }
      this.inventoryLabel.setText(local.heldItem ? `${ITEM_NAMES[local.heldItem]} ×${local.ammo} · ${key('attack', 'J')} 使用 / 开火` : `${key('pickup', 'F')} 拾取道具 · ${key('attack', 'J')} 普攻`);
    }
    if (snapshot.phase === 'countdown') {
      this.overlay.setVisible(true).setText(`${Math.max(1, Math.ceil(snapshot.countdown))}`).setColor('#ffebaf'); this.overlaySub.setVisible(true).setText('准备好，别先笑场');
    } else if (snapshot.phase === 'roundEnd' || snapshot.phase === 'matchEnd') {
      this.overlay.setVisible(true).setText(snapshot.phase === 'matchEnd' ? '本场结束' : '回合结束').setColor('#ffedb6'); this.overlaySub.setVisible(true).setText(snapshot.result || '稍作休息，马上继续');
    } else { this.overlay.setVisible(false); this.overlaySub.setVisible(false); }
  }
  renderSnapshot(snapshot: GameSnapshot, localId: string) {
    if (this.disposed) return;
    if (snapshot.settings.map !== this.map) this.chooseArena(snapshot.settings.map);
    const now = performance.now();
    if (snapshot.tick < this.tick) {
      this.seen.clear(); this.eventQueue = []; this.freezeUntil = 0; this.frozenSnapshot = undefined; this.previousHitStop = 0;
      for (const floating of this.floating) floating.text.destroy();
      this.floating = [];
      for (const view of this.players.values()) view.flashUntil = 0;
    }
    this.tick = snapshot.tick;
    let hitSound: { heavy: boolean; guarded: boolean } | undefined;
    let newHitStop = 0;
    for (const event of snapshot.events) if (!this.seen.has(event.id)) {
      this.seen.add(event.id); this.eventQueue.push(event.id);
      if (event.type === 'hit') {
        const target = snapshot.players.find(player => player.id === event.targetId);
        const heavy = !!event.heavy;
        newHitStop = Math.max(newHitStop, event.hitStop ?? (heavy ? .1 : 3 / 60));
        if (!hitSound || heavy) hitSound = { heavy, guarded: !!event.guarded };
        if (target) this.fighter(target.id, target.character).flashUntil = now + 2 * 1000 / 60;
        this.shake(heavy ? 7 : 3, heavy ? 170 : 120);
        if (event.x !== undefined && event.y !== undefined) {
          const damage = Math.max(0, event.damage ?? 0);
          if (damage > 0) this.float(`−${Math.round(damage)}`, event.x + (event.direction ?? 1) * 5, event.y - 48, heavy ? '#ffcf7a' : '#fff3b5', heavy ? 850 : 700, heavy ? 27 : 21);
          else if (event.guarded) this.float('格挡', event.x, event.y - 46, '#a5e9f2', 500, 15);
        }
      } else this.sounds.play(event.type);
      if (event.type === 'ko') { this.shake(8, 180); if (event.x !== undefined && event.y !== undefined) this.float('KO！', event.x, event.y - 60, '#ffdf8c', 1050, 25); }
      if (event.type === 'pickup' && event.x !== undefined && event.y !== undefined) this.float('捡到好东西', event.x, event.y - 55, '#b6f6d4', 700, 13);
    }
    if (hitSound) this.sounds.play('hit', hitSound.heavy, hitSound.guarded);
    while (this.eventQueue.length > 512) this.seen.delete(this.eventQueue.shift()!);
    if (snapshot.phase === 'playing') {
      // Each event starts one stop. Repeated 20 Hz snapshots never restart that stop.
      const eventlessStop = snapshot.hitStop > 0 && this.previousHitStop <= 0 && !snapshot.events.some(event => event.type === 'hit');
      if (newHitStop > 0 || eventlessStop) {
        this.frozenSnapshot = snapshot;
        this.freezeUntil = Math.max(this.freezeUntil, now + (newHitStop || snapshot.hitStop) * 1000);
      }
    } else { this.freezeUntil = 0; this.frozenSnapshot = undefined; }
    this.previousHitStop = snapshot.hitStop;
    const visual = now < this.freezeUntil && this.frozenSnapshot ? this.frozenSnapshot : snapshot;
    if (now >= this.freezeUntil) this.frozenSnapshot = undefined;
    this.drawStage(visual); this.shadows.clear(); this.effects.clear();
    this.drawObjects(visual, localId);
    this.removeMissing(new Set(visual.players.map(player => player.id)));
    for (const player of visual.players) this.drawPlayer(player, localId, visual);
    this.drawEffects(visual); this.drawHud(snapshot, localId);
    this.world.sort('depth'); this.updateShake(now);
  }
  previewArena(map: MapId, roster: RosterPlayer[]) {
    if (this.disposed) return;
    this.freezeUntil = 0; this.frozenSnapshot = undefined; this.previousHitStop = 0;
    this.shakeDuration = 0; this.world.setPosition(0, 0);
    this.chooseArena(map); this.drawStage(); this.shadows.clear(); this.objects.clear(); this.effects.clear(); this.hud.clear(); this.pickup.setVisible(false);
    for (const item of this.floating) item.text.destroy();
    this.floating = [];
    this.title.setText(ARENAS[map].subtitle).setPosition(640, 25).setVisible(true); this.timer.setText('');
    this.overlay.setVisible(false); this.overlaySub.setVisible(false);
    this.cards.forEach(card => { card.name.setVisible(false); card.info.setVisible(false); card.value.setVisible(false); });
    this.abilityLabels.forEach(label => label.setVisible(false)); this.inventoryLabel.setVisible(false);
    for (const label of this.itemLabels.values()) label.setVisible(false);
    this.removeMissing(new Set(roster.map(player => player.id)));
    for (let index = 0; index < roster.length; index++) {
      const player = roster[index]; const view = this.fighter(player.id, player.character);
      const arena = ARENAS[map]; const x = arena.left + (arena.right - arena.left) * (index + 1) / (roster.length + 1);
      view.sprite.setVisible(true).setTexture(`fighter-${player.character}-idle`).setPosition(Math.round(x), arena.groundY).setFlipX(index >= 2).setAlpha(1).clearTint();
      view.flashUntil = 0;
      view.label.setVisible(true).setText(`${player.name}${player.bot ? ' · AI' : ''}`).setPosition(x, arena.groundY - 65).setColor('#fff2cc');
      this.shadows.fillStyle(0x1c2b43, .24); this.shadows.fillEllipse(x, arena.groundY + 2, 36, 8);
    }
    this.world.sort('depth');
  }
  dispose() { this.disposed = true; }
}

export function createRenderer(container: HTMLElement): Promise<GameRenderer> {
  return new Promise((resolve, reject) => {
    const sounds = new GameSounds();
    let game: Phaser.Game;
    let disposed = false;
    const timeout = window.setTimeout(() => { sounds.destroy(); game?.destroy(true); reject(new Error('场景加载超时，请刷新重试。')); }, 25000);
    const scene = new ArenaScene(ready => {
      window.clearTimeout(timeout);
      resolve({
        render: (snapshot, localId) => { if (!disposed) ready.renderSnapshot(snapshot, localId); },
        preview: (map, roster) => { if (!disposed) ready.previewArena(map, roster); },
        setMuted: muted => sounds.setMuted(muted),
        shake: amount => ready.shake(amount),
        destroy: () => { if (!disposed) { disposed = true; ready.dispose(); sounds.destroy(); game.destroy(true); } },
      });
    }, sounds);
    try {
      game = new Phaser.Game({
        type: Phaser.AUTO, parent: container, width: WORLD_WIDTH, height: WORLD_HEIGHT,
        backgroundColor: '#90c7d3', pixelArt: true, roundPixels: true,
        antialias: false, audio: { noAudio: true },
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: WORLD_WIDTH, height: WORLD_HEIGHT },
        scene: [scene], input: { keyboard: false, mouse: false, touch: false, gamepad: false },
        banner: false,
      });
    } catch (error) { window.clearTimeout(timeout); sounds.destroy(); reject(error); }
  });
}
