/**
 * App —— 场景流与系统接线（标题 → 游玩 → 夜幕结算；巢穴霞光演出；回放/调试）。
 *
 * 职责：
 * - 拥有 Sim / Renderer / AudioSynth / BGM / InputSource / GameLoop，把它们粘成游戏
 * - 消费 Sim 事件 → 粒子演出（Renderer.feedEvents）+ 音效 + 慢放/hit-stop 触发 + 场景跳转
 * - 标题页 attract 模式（脚本输入跑图）；结算保存最佳成绩
 * - 教学即反馈：首局前 10 秒在鸟旁挂「按住/松开」浮标，各触发一次后永久消失
 * - 回放：F2 导出 JSON、F3 重放本局（同种子逐帧复现）
 */

import { Sim, SimEvent } from './sim/game';
import { Renderer, Scene } from './render/renderer';
import { AudioSynth } from './audio/synth';
import { BGM } from './audio/bgm';
import { InputSource } from './core/input';
import { GameLoop } from './core/loop';
import { STEP, HITSTOP_TIME, BLOWOUT, COMBO } from './core/constants';
import { dailySeed } from './core/rng';
import { clamp, lerp } from './core/mathutil';
import { DebugOverlay } from './tools/debug';
import { serializeReplay } from './sim/replay';

interface UrlConfig {
  seed: number | null;
  daily: boolean;
  mute: boolean;
  debug: boolean;
  /** 自动演示：脚本输入驱动真实玩法（QA/回放验证用） */
  demo: boolean;
  /** 主题预览：强制按第 N 关的画风渲染（验收用） */
  theme: number | null;
}

function readUrl(): UrlConfig {
  const p = new URLSearchParams(location.search);
  return {
    seed: p.has('seed') ? Number.parseInt(p.get('seed')!, 10) || null : null,
    daily: p.has('daily'),
    mute: p.has('mute'),
    debug: p.has('debug'),
    demo: p.has('demo'),
    theme: p.has('theme') ? Math.max(1, Number.parseInt(p.get('theme')!, 10) || 1) : null,
  };
}

const BEST_KEY = 'ember_best_v1';
const ALT_KEY = 'ember_alt_v1';

export class App {
  readonly sim: Sim;
  private renderer: Renderer;
  private audio = new AudioSynth();
  private bgm: BGM;
  private input = new InputSource();
  private loop: GameLoop;
  private debug = new DebugOverlay();

  scene: Scene = 'title';
  /** 标题 attract 用独立模拟 */
  private attract: Sim;
  /** 巢穴霞光演出计时 */
  private nestCineT = 0;
  /** 结算数据 */
  private overData = { score: 0, coins: 0, maxCombo: 0, dist: 0, newBest: false, maxAlt: 0 };
  private best = 0;
  private bestAlt = 0;
  private runSeed: number;
  private urlCfg: UrlConfig;
  /** 回放模式 */
  private replaying = false;
  /** 教学：首局状态浮标 */
  private tut = { hold: false, release: false, t: 0 };
  private appTime = 0;
  private paused = false;
  /** attract 输入相位 */
  private attractT = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.urlCfg = readUrl();
    this.runSeed = this.urlCfg.seed ?? (this.urlCfg.daily ? dailySeed() : ((Math.random() * 0xffffffff) >>> 0));
    this.sim = new Sim(this.runSeed);
    this.attract = new Sim(((Math.random() * 0xffffffff) >>> 0));
    const ctx = canvas.getContext('2d', { alpha: false })!;
    this.renderer = new Renderer(ctx);
    this.bgm = new BGM(this.audio);
    this.best = Number(localStorage.getItem(BEST_KEY) ?? 0) || 0;
    this.bestAlt = Number(localStorage.getItem(ALT_KEY) ?? 0) || 0;
    if (this.urlCfg.mute) this.audio.setMuted(true);

    this.input.attach(canvas);
    this.loop = new GameLoop({
      step: () => this.step(),
      render: (alpha, realDt) => this.frame(alpha, realDt),
    });

    this.setupKeys();
    if (this.urlCfg.debug) this.debug.on = true;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      this.setPaused(document.hidden);
    });
  }

  start(): void {
    this.loop.start();
  }

  private setPaused(p: boolean): void {
    this.paused = p;
    this.loop.setPaused(p);
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.renderer.resize(w, h, dpr);
  }

  /* ---------------- 功能键（与玩法输入分离） ---------------- */

  private setupKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F1') {
        e.preventDefault();
        this.debug.toggle();
      } else if (e.code === 'F2') {
        e.preventDefault();
        this.dumpReplay();
      } else if (e.code === 'F3') {
        e.preventDefault();
        this.startReplayLast();
      } else if (e.code === 'KeyM') {
        this.audio.setMuted(!this.audio.muted);
      } else if (e.code === 'KeyP') {
        this.setPaused(!this.paused);
      } else if (e.code === 'KeyR') {
        if (this.scene === 'play' || this.scene === 'over') this.restartRun();
      }
    });
  }

  private dumpReplay(): void {
    const data = serializeReplay(this.sim.seed, this.input.events);
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ember-replay-${this.sim.seed}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private startReplayLast(): void {
    if (this.input.events.length === 0) return;
    const events = [...this.input.events];
    this.sim.reset();
    this.renderer.terrainR.clearScorches();
    this.renderer.particles.clear();
    this.input.resetRecorder();
    this.input.startReplay(events);
    this.replaying = true;
    this.scene = 'play';
    this.bgm.setScene('play');
    this.tut = { hold: true, release: true, t: 0 };
  }

  /* ---------------- 场景流转 ---------------- */

  private startRun(seed: number): void {
    this.runSeed = seed;
    this.sim.reset();
    this.renderer.terrainR.clearScorches();
    this.renderer.particles.clear();
    this.input.resetRecorder();
    this.input.stopReplay();
    this.input.recording = true;
    this.replaying = false;
    this.scene = 'play';
    this.nestCineT = 0;
    this.tut = { hold: false, release: false, t: 0 };
    this.bgm.setScene('play');
    this.bgm.setFever(false);
  }

  private restartRun(): void {
    this.startRun(this.urlCfg.seed ?? (this.urlCfg.daily ? dailySeed() : ((Math.random() * 0xffffffff) >>> 0)));
  }

  private endRun(): void {
    this.scene = 'over';
    this.input.recording = false;
    this.input.stopReplay();
    this.replaying = false;
    this.overData = {
      score: this.sim.score,
      coins: this.sim.coinsTaken,
      maxCombo: this.sim.maxCombo,
      dist: this.sim.distanceM,
      newBest: this.sim.score > this.best,
      maxAlt: this.sim.maxAlt,
    };
    if (this.overData.newBest) {
      this.best = this.sim.score;
      localStorage.setItem(BEST_KEY, String(Math.floor(this.best)));
    }
    if (this.sim.maxAlt > this.bestAlt) {
      this.bestAlt = this.sim.maxAlt;
      localStorage.setItem(ALT_KEY, String(Math.floor(this.bestAlt)));
    }
    this.bgm.setScene('over');
    this.bgm.setFever(false);
    this.audio.sfxNight();
  }

  /* ---------------- 物理步 ---------------- */

  private step(): void {
    if (this.scene === 'over') return; // 结算页冻结世界
    // 演示模式下任何真实输入 → 立即接管（演示永远不该「抢走」玩家的游戏）
    if (this.urlCfg.demo && this.input.anyPress) this.demoTakeover();
    this.input.observe();
    if (this.urlCfg.demo) {
      // 自动演示：Tiny Wings 读坡策略（前方净下坡按住压坡 / 净上坡松手放飞 / 低速必按防卡死）
      if (this.scene === 'title') {
        this.stepAttract();
        return;
      }
      const t = this.sim.terrain;
      const held = t.slopeAt(this.sim.x + 60) > -0.05 || this.sim.speed < 400;
      this.sim.step(held);
      this.handleEvents(this.sim.drainEvents());
      return;
    }
    if (this.scene === 'title') {
      this.stepAttract();
      return;
    }
    this.sim.step(this.input.held);
    this.handleEvents(this.sim.drainEvents());
  }

  /** 玩家从演示中接管：解锁音频、开始录制（回放从接管点起算） */
  private demoTakeover(): void {
    this.urlCfg.demo = false;
    this.audio.unlock();
    this.bgm.start();
    this.input.resetRecorder();
    this.input.recording = true;
  }

  /** 标题 attract：脚本输入跑图，日落防走到头 */
  private stepAttract(): void {
    this.attractT += STEP;
    const held = this.attractT % 1.9 < 1.15;
    this.attract.step(held);
    this.attract.drainEvents();
    if (this.attract.x > 26000 || this.attract.sunsetTimer < 25) {
      this.attract = new Sim((Math.random() * 0xffffffff) >>> 0);
      this.attractT = 0;
    }
  }

  /* ---------------- 事件 → 演出/音频/流转 ---------------- */

  private handleEvents(events: SimEvent[]): void {
    this.renderer.feedEvents(events);
    for (const e of events) {
      switch (e.type) {
        case 'perfect':
          this.loop.hitStop(HITSTOP_TIME); // 2 帧 hit-stop：演出优先于信息
          this.audio.sfxPerfect(e.combo ?? 1);
          break;
        case 'landing':
          if (!e.perfect) this.audio.sfxLand(e.material ?? 'snow');
          break;
        case 'coin':
          this.audio.sfxCoin(e.combo ?? 1);
          break;
        case 'flap':
          this.audio.sfxFlap();
          break;
        case 'blowout':
          this.audio.sfxBlowout();
          this.loop.slowmo(BLOWOUT.SLOWMO_SCALE, BLOWOUT.SLOWMO_TIME);
          break;
        case 'blowoutEnd':
          this.audio.sfxFlap(); // 复燃小音效
          break;
        case 'feverEnter':
          this.audio.sfxFever();
          this.bgm.setFever(true);
          break;
        case 'feverEnd':
          this.bgm.setFever(false);
          break;
        case 'turbo':
          this.loop.slowmo(COMBO.TURBO_TIMESCALE, COMBO.TURBO_TIME);
          this.audio.sfxTurbo();
          break;
        case 'realm':
          this.audio.sfxRealm(e.realm ?? 0);
          break;
        case 'nest':
          this.nestCineT = 2.0; // 2s 霞光演出（太阳正好落山）
          this.audio.sfxNest();
          break;
        case 'night':
          this.endRun();
          break;
      }
    }
  }

  /* ---------------- 渲染帧 ---------------- */

  private frame(alpha: number, realDt: number): void {
    this.appTime += realDt;
    const r = this.renderer;
    const isTitle = this.scene === 'title';
    const activeSim = isTitle ? this.attract : this.sim;

    // 巢穴霞光：dayProgress 冲到 1（太阳落山）再由 sim 重置自然回到新一天
    let dayOverride: number | undefined;
    if (this.nestCineT > 0) {
      this.nestCineT = Math.max(0, this.nestCineT - realDt);
      const t = 1 - this.nestCineT / 2;
      dayOverride = clamp(lerp(activeSim.dayProgress, 1, Math.sin(t * Math.PI) * 1.35), 0, 1);
    }

    r.impactSlowmo = this.loop.slowmoT > 0;
    r.scene = this.scene;
    r.frame(alpha, isTitle ? 0.4 : realDt, activeSim, this.loop.quality, !isTitle, undefined, dayOverride, this.urlCfg.theme ?? undefined);

    // 音频连续声床
    this.audio.update(realDt, {
      speed: activeSim.speed,
      maxSpeed: 1600,
      heat: activeSim.heatSys.heat,
      boost: activeSim.state === 'boost',
      cool: activeSim.state === 'cool',
      grounded: activeSim.grounded,
      fever: activeSim.fever,
    });

    const ctx = r.ctx;

    if (isTitle) {
      r.hud.drawTitle(ctx, this.appTime, this.best, this.urlCfg.daily);
      // 任意按键开始（首次手势同时解锁音频）；demo 模式 0.8s 后自动开局
      if (this.urlCfg.demo) {
        this.demoTitleT = (this.demoTitleT ?? 0) + realDt;
        if (this.demoTitleT > 0.8) {
          this.demoTitleT = 0;
          this.startRun(this.runSeed);
        }
      } else if (this.input.anyPress) {
        this.audio.unlock();
        this.bgm.start();
        this.startRun(this.runSeed);
      }
    } else if (this.scene === 'over') {
      const d = this.overData;
      r.hud.drawGameOver(ctx, d.score, this.best, d.coins, d.maxCombo, d.dist, d.newBest, this.appTime, d.maxAlt, this.bestAlt);
      if (this.urlCfg.demo) {
        // 演示模式：结算 3s 后自动重开
        this.demoOverT = (this.demoOverT ?? 0) + realDt;
        if (this.demoOverT > 3) {
          this.demoOverT = 0;
          this.restartRun();
        }
      } else if (this.input.held) {
        this.overHoldT = (this.overHoldT ?? 0) + realDt;
        if (this.overHoldT > 0.35) {
          this.overHoldT = 0;
          this.restartRun();
        }
      } else {
        this.overHoldT = 0;
      }
    } else {
      // 游玩中：教学浮标（首局、各一次）
      this.drawTutorial(ctx, realDt);
      if (this.nestCineT > 0) {
        r.hud.drawNestBanner(ctx, activeSim.level - 1, 2 - this.nestCineT, 2);
      }
      // 演示模式水印：醒目标注，绝不伪装成玩家操作
      if (this.urlCfg.demo) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = '800 16px system-ui';
        const a = 0.55 + Math.sin(this.appTime * 3) * 0.2;
        ctx.fillStyle = `rgba(46,32,40,${a.toFixed(2)})`;
        ctx.fillText('自动演示中 · 按任意键接管', r.canvasW / 2, r.canvasH - 28);
        ctx.restore();
      }
      if (this.replaying) {
        ctx.save();
        ctx.fillStyle = 'rgba(46,32,40,0.6)';
        ctx.font = '700 13px system-ui';
        ctx.textAlign = 'right';
        ctx.fillText('回放中', r.canvasW - 16, 100);
        ctx.restore();
      }
    }

    if (this.debug.on) {
      this.debug.draw(ctx, {
        fps: this.loop.fps,
        sim: activeSim,
        particles: r.particles.aliveCount,
        flame: r.particles.flameAlive,
        quality: this.loop.quality,
        seed: activeSim.seed,
        replaying: this.replaying,
      });
    }
  }
  private overHoldT = 0;
  private demoTitleT = 0;
  private demoOverT = 0;

  /** 教学即反馈：状态浮标挂在鸟旁边，各出现一次、触发后消失 */
  private drawTutorial(ctx: CanvasRenderingContext2D, dt: number): void {
    if (this.tut.hold && this.tut.release) return;
    this.tut.t += dt;
    const r = this.renderer;
    const sx = r.cam.worldToScreenX(this.sim.curr.x) - 40;
    const sy = r.cam.worldToScreenY(this.sim.curr.y) - 64;
    ctx.save();
    ctx.font = '800 15px system-ui';
    ctx.textAlign = 'center';
    if (!this.tut.hold) {
      if (this.sim.state === 'boost') this.tut.hold = true;
      ctx.fillStyle = 'rgba(46,32,40,0.75)';
      ctx.fillText('按住 · 冲！', sx, sy + Math.sin(this.appTime * 5) * 3);
    } else if (!this.tut.release) {
      if (this.sim.state === 'cool') this.tut.release = true;
      ctx.fillStyle = 'rgba(46,32,40,0.75)';
      ctx.fillText('松开 · 散热', sx, sy + Math.sin(this.appTime * 5) * 3);
    }
    ctx.restore();
  }
}
