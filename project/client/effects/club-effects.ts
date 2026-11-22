import type Phaser from 'phaser';

interface ManualEmitter {
  scene?: Phaser.Scene;
  preUpdate: (time: number, delta: number) => void;
  destroy: () => void;
  setDepth: (depth: number) => ManualEmitter;
  killAll?: () => void;
}

type ParticleConfig = Phaser.Types.GameObjects.Particles.ParticleEmitterConfig;

/**
 * Client-only ambient layer from the map pack. Stepped by hand so pause and
 * hit-stop freeze it. It never writes physics, damage, or network state.
 */
export class ClubEffects {
  private readonly scene: Phaser.Scene;
  private readonly width: number;
  private readonly height: number;
  private readonly parent?: Phaser.GameObjects.Container;
  private ambientEnabled: boolean;
  private theme = '';
  private time = 0;
  private readonly ambient: ManualEmitter[] = [];

  constructor(scene: Phaser.Scene, options: { width: number; height: number; parent?: Phaser.GameObjects.Container; ambient?: boolean }) {
    this.scene = scene;
    this.width = options.width;
    this.height = options.height;
    this.parent = options.parent;
    this.ambientEnabled = options.ambient !== false;
    this.makeTextures();
  }

  private makeTextures() {
    const patterns: Record<string, string[]> = {
      'club-square': ['11', '11'],
      'club-cross': ['00100', '00100', '11111', '00100', '00100'],
      'club-leaf': ['000110', '001110', '011110', '111100', '011000', '010000'],
      'club-bubble': ['00111100', '01000010', '10001001', '10010001', '10000001', '10000001', '01000010', '00111100'],
    };
    for (const [key, data] of Object.entries(patterns)) {
      if (this.scene.textures.exists(key)) continue;
      const canvas = document.createElement('canvas');
      canvas.width = data[0].length * 2;
      canvas.height = data.length * 2;
      const context = canvas.getContext('2d');
      if (!context) continue;
      context.fillStyle = '#ffffff';
      data.forEach((row, y) => [...row].forEach((pixel, x) => {
        if (pixel === '1') context.fillRect(x * 2, y * 2, 2, 2);
      }));
      this.scene.textures.addCanvas(key, canvas);
    }
  }

  private adopt(config: ParticleConfig, texture: string): ManualEmitter {
    const emitter = this.scene.add.particles(0, 0, texture, config) as unknown as ManualEmitter;
    this.scene.sys.updateList.remove(emitter as unknown as Phaser.GameObjects.GameObject);
    emitter.setDepth(4);
    this.parent?.add(emitter as unknown as Phaser.GameObjects.GameObject);
    return emitter;
  }

  setTheme(theme: string) {
    if (theme === this.theme && (this.ambient.length > 0 || !this.ambientEnabled)) return;
    this.theme = theme;
    for (const emitter of this.ambient) if (emitter.scene) emitter.destroy();
    this.ambient.length = 0;
    if (!this.ambientEnabled || !theme) return;
    const width = this.width;
    const height = this.height;
    const add = (texture: string, config: ParticleConfig) => {
      this.ambient.push(this.adopt({
        emitting: true, maxParticles: 64, maxAliveParticles: 48,
        scale: { start: .6, end: .3 }, alpha: { start: .65, end: 0 },
        blendMode: 'NORMAL', ...config,
      }, texture));
    };
    if (theme === 'underground') {
      add('club-square', { x: { min: 50, max: width - 50 }, y: { min: height * .5, max: height * .92 },
        lifespan: 4500, frequency: 240, speedX: { min: -12, max: 12 }, speedY: { min: -32, max: -12 }, tint: [0x50ffe2, 0xa8ffff] });
      add('club-cross', { x: { min: width * .2, max: width * .8 }, y: { min: height * .36, max: height * .75 },
        lifespan: 2300, frequency: 700, speedY: -15, scale: { start: .35, end: 0 }, tint: 0xffc36a });
    } else if (theme === 'undersea') {
      for (const side of [0, 1]) add('club-bubble', { x: { min: side ? width * .82 : 25, max: side ? width - 25 : width * .18 }, y: height + 20,
        lifespan: 11000, frequency: 360, speedY: { min: -105, max: -75 }, speedX: { min: -8, max: 8 },
        scale: { start: .4, end: .9 }, alpha: { start: .55, end: .15 }, tint: [0xb9efff, 0xffffff] });
    } else if (theme === 'forest') {
      add('club-leaf', { x: { min: 0, max: width }, y: -20, lifespan: 11500, frequency: 420,
        speedX: { min: -25, max: 15 }, speedY: { min: 45, max: 75 }, rotate: { min: -70, max: 70 },
        scale: { start: .65, end: .45 }, tint: [0xb3d865, 0xedc15d, 0x7abb5a] });
      add('club-cross', { x: { min: 70, max: width - 70 }, y: { min: height * .45, max: height * .85 },
        lifespan: 3000, frequency: 500, speedX: { min: -10, max: 10 }, speedY: -12, scale: { start: .4, end: 0 }, tint: 0xf1ff9e });
    } else {
      add('club-square', { x: { min: 50, max: width - 50 }, y: { min: height * .25, max: height * .9 },
        lifespan: 4000, frequency: 260, speedX: { min: 9, max: 24 }, speedY: { min: -12, max: 4 }, tint: [0xfff1c7, 0xffffff], alpha: { start: .45, end: 0 } });
      add('club-leaf', { x: { min: 0, max: width }, y: -15, lifespan: 12000, frequency: 1200,
        speedX: 25, speedY: 65, rotate: { min: -45, max: 45 }, scale: { start: .5, end: .35 }, tint: [0x94c566, 0xe5bb76] });
    }
  }

  step(delta: number) {
    if (!Number.isFinite(delta) || delta <= 0) return;
    const step = Math.min(delta, 50);
    this.time += step;
    for (const emitter of this.ambient) if (emitter.scene) emitter.preUpdate(this.time, step);
  }

  clear() {
    for (const emitter of this.ambient) emitter.killAll?.();
  }

  destroy() {
    this.clear();
    for (const emitter of this.ambient) if (emitter.scene) emitter.destroy();
    this.ambient.length = 0;
    this.theme = '';
  }
}
