/**
 * Renderer —— 渲染编排器。
 *
 * 帧序（屏幕系 → 视差层 → 世界系 → 前景 → 屏幕特效 → HUD）：
 *   天空/太阳/云 → 远山 → 中景 → [相机变换] 地形/金币/巢穴/焦痕 → 粒子 → 鸟
 *   → [还原] 前景条 → 速度线/vignette/Fever光/慢放黑边/白闪 → HUD（不抖动）
 *
 * 完美着陆判定可视化：空中时向前弹道模拟，若 0.5s 内落点角度差 <15°，
 * 在落点显示淡金色脉动光圈 —— 把玄学判定变成可学习技能。
 */

import { Camera } from './camera';
import { Parallax } from './parallax';
import { TerrainRenderer } from './terrainRender';
import { BirdRenderer } from './birdRender';
import { ParticlePool } from './particles';
import { HUD, HudState } from './hud';
import { ScreenFX } from './screenfx';
import { skyAt, themeForLevel, applyTheme, SkyPalette } from './palette';
import { lerp, clamp } from '../core/mathutil';
import { judgeLanding, Sim, SimEvent, BirdSnapshot } from '../sim/game';
import { G, PRESS_G_MULT, PREDICT_RING_LEAD, BIRD_R, BLOWOUT } from '../core/constants';
import type { QualityState } from '../core/loop';

export type Scene = 'title' | 'play' | 'over';

export class Renderer {
  readonly cam = new Camera();
  readonly parallax = new Parallax();
  readonly terrainR = new TerrainRenderer();
  readonly birdR = new BirdRenderer();
  readonly particles = new ParticlePool();
  readonly hud = new HUD();
  readonly fx = new ScreenFX();

  /** 涡轮全开视觉计时 */
  turboT = 0;
  /** 场景（HUD 显隐） */
  scene: Scene = 'title';
  /** 首局教学提示（首次按住/首次松开后淡出） */
  tutorial = 0;
  /** 爆燃砸地慢放中（App 每帧同步，驱动电影黑边） */
  impactSlowmo = false;

  private w = 0;
  private h = 0;
  private dpr = 1;
  private time = 0;
  private predictTick = 0;
  /** 关卡主题调色板缓存：dayP|level|渐变档 */
  private themeCache = new Map<string, SkyPalette>();
  /** 新一天黎明过渡计时（<0 = 不在过渡）。归巢演出把 dayProgress 推到 1（日落），
   *  新一天计时器重置会瞬间跳回 0（清晨）—— 用约 4s 的回落过渡抹掉这次跳变 */
  private dawnBlendT = -1;
  private lastLvl = -1;

  constructor(public readonly ctx: CanvasRenderingContext2D) {}

  get canvasW(): number {
    return this.w;
  }
  get canvasH(): number {
    return this.h;
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = Math.min(dpr, 2);
    this.cam.resize(w, h);
    this.parallax.resize(w, h);
    this.fx.resize(w, h);
    this.hud.resize(w, h, this.dpr);
  }

  /** 消费模拟事件 → 粒子/演出（音频由 App 处理） */
  feedEvents(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'perfect':
          this.particles.emitSteam(e.x!, e.y! + 14, 16, 1.2);
          this.particles.addRing(e.x!, e.y! + 8, 'rgba(255,240,210,0.9)');
          this.fx.triggerFlash(0.9);
          this.hud.onPerfect(e.combo ?? 0);
          break;
        case 'landing':
          if (e.material === 'snow') this.particles.emitSnow(e.x!, e.y! + 14, e.speed! * 0.4, 6);
          this.particles.emitSteam(e.x!, e.y! + 12, e.perfect ? 0 : 5, 0.7);
          break;
        case 'coin':
          this.particles.emitSpark(e.x!, e.y!, 9);
          break;
        case 'blowout':
          // 原地爆炸：焦痕 + 冲击波环 + 岩浆四溅 + 白闪
          this.terrainR.addScorch(e.x!, e.groundY ?? this.cam.y);
          this.particles.emitMagma(e.x!, e.y!, 0, 0, 46, 2.2);
          this.particles.emitSpark(e.x!, e.y!, 26);
          this.particles.emitSteam(e.x!, e.y!, 18, 1.6);
          this.particles.addRing(e.x!, e.y!, 'rgba(255,160,80,0.95)');
          this.fx.triggerFlash(1);
          break;
        case 'feverEnter':
          this.fx.triggerFeverFlash();
          break;
        case 'turbo':
          this.turboT = 1.0;
          this.hud.onTurbo();
          this.particles.emitSpark(e.x!, e.y!, 22);
          break;
        case 'realm':
          this.hud.onRealm(e.realm ?? 0);
          this.particles.emitSpark(e.x!, e.y!, 14);
          break;
      }
    }
  }

  /** 主渲染帧。dayOverride：巢穴霞光演出时覆盖 dayProgress；
   *  themeLevel：主题关卡号（默认取 sim.level，可被 ?theme=N 预览覆盖） */
  frame(
    alpha: number,
    realDt: number,
    sim: Sim,
    quality: QualityState,
    showHud: boolean,
    hudOverride?: Partial<HudState>,
    dayOverride?: number,
    themeLevel?: number
  ): void {
    const ctx = this.ctx;
    this.time += realDt;
    const dt = Math.min(realDt, 0.05);

    // 插值快照 + 离地高度（高空变焦/构图用）
    const snap = interpSnap(sim, alpha);
    const groundY = sim.terrain.heightAt(snap.x);
    const heightAG = Math.max(0, groundY - snap.y);
    const heat01 = sim.heatSys.heat / 100;
    const speed = Math.hypot(sim.vx, sim.vy);
    const redness = sim.heatSys.redness;
    const fever = sim.fever;
    const tumbling = sim.curr.phase === 'tumble';
    this.turboT = Math.max(0, this.turboT - realDt);

    // 视觉组件更新（boom：爆燃活跃度 1→0 指数衰减，驱动聚焦与冲击抖动）
    const boom = tumbling ? Math.exp(-1.5 * sim.boomElapsed) : 0;
    this.cam.update(dt, snap.x, snap.y, sim.vx, speed, redness, boom, heightAG);
    this.birdR.update(dt);
    this.terrainR.update(dt);
    this.hud.update(dt);
    this.fx.update(dt);
    this.fx.setCinematic(this.turboT > 0.02 || this.impactSlowmo);

    // 自适应降级
    this.particles.densityScale = quality.particleDensity;
    this.parallax.layers = quality.parallaxLayers;

    // 调色板（霞光演出时覆盖 dayProgress）+ 关卡主题分级（关卡前 30% 平滑渐变进入新画风）
    const lvl = themeLevel ?? sim.level;
    // 进入新关卡（level 增加）：启动黎明回落过渡，抹掉日落→清晨的 dayProgress 跳变
    if (lvl > this.lastLvl && this.lastLvl !== -1) this.dawnBlendT = 0;
    if (lvl !== this.lastLvl) this.lastLvl = lvl;
    if (this.dawnBlendT >= 0 && dayOverride == null) {
      this.dawnBlendT += realDt;
      if (this.dawnBlendT > 4) this.dawnBlendT = -1;
    }
    let dayP = dayOverride ?? sim.dayProgress;
    if (this.dawnBlendT >= 0 && dayOverride == null) {
      const t = Math.min(1, this.dawnBlendT / 4);
      dayP = lerp(1, sim.dayProgress, t * t); // 日落红 → 清晨的平滑回落
    }
    const themeKey = `${Math.round(dayP * 100)}|${lvl}|${Math.round(clamp((sim.x - sim.terrain.nestX(lvl - 1)) / sim.terrain.levelDist(lvl), 0, 1) * 10)}`;
    let pal = this.themeCache.get(themeKey);
    if (!pal) {
      const curTheme = themeForLevel(lvl);
      // ?theme=N 预览：直接全量应用当前主题；自然游玩：关卡前 30% 从上一主题平滑过渡
      // （第 1 关没有「上一主题」，从基础昼夜色渐入 —— 不再与循环尾端的第 8 关混色）
      const k2 = themeLevel != null ? 1 : clamp((sim.x - sim.terrain.nestX(lvl - 1)) / sim.terrain.levelDist(lvl) / 0.3, 0, 1);
      pal = { ...skyAt(dayP) };
      if (lvl > 1 && themeLevel == null) applyTheme(pal, themeForLevel(lvl - 1), 1 - k2);
      applyTheme(pal, curTheme, k2);
      this.themeCache.set(themeKey, pal);
    }
    const spaceMix = clamp((heightAG - 900) / 1500, 0, 1);
    const starAlpha = clamp((heightAG - 1100) / 900, 0, 1);

    // 粒子剔除视口
    const [vx0, vx1] = this.cam.viewBounds();
    this.particles.viewX0 = vx0;
    this.particles.viewX1 = vx1;
    this.particles.viewY0 = this.cam.y - this.h;
 this.particles.viewY1 = this.cam.y + this.h;

    // ---- 粒子发射（帧驱动） ----
    this.emitGameplay(dt, sim, snap, heat01, speed, fever, tumbling);

    // ---- 起手绘制 ----
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    // 天空 + 太阳 + 云 + 高空暗化/星星（视差层全部锚定相对地形的相机高度 relY，海拔漂移不推移层位）
    const relY = this.cam.y - groundY;
    this.parallax.drawSky(ctx, this.cam, relY, pal, dayP, this.time, spaceMix, starAlpha);
    // 远山层组（4 层大气透视色阶；降级时 3 层）
    this.parallax.drawRidges(ctx, this.cam, relY, pal, this.time, quality.parallaxLayers >= 4 ? 4 : 3);

    // ---- 世界系 ----
    ctx.save();
    this.cam.apply(ctx);
    // 云层带（锚定局部地形之上；地形前绘制，山体会遮住插进山里的云）
    this.parallax.drawCloudBands(ctx, this.cam, vx0, vx1, this.time, (x) => sim.terrain.heightAt(x));
    this.terrainR.draw(ctx, sim.terrain, this.cam, pal, dayP, this.time, this.h / this.cam.zoom, sim.x, fever, lvl);
    this.terrainR.drawMilestones(ctx, sim.terrain, this.cam, pal);
    if (sim.red) this.terrainR.drawDownhillHint(ctx, sim.terrain, sim.x);
    this.terrainR.drawNest(ctx, sim.nestX, sim.terrain, pal, this.time, fever);

    this.updatePredictRing(sim, snap);
    this.particles.draw(ctx);

    this.birdR.drawGlideAura(ctx, snap, sim.wing, this.time);
    this.birdR.draw(
      ctx,
      snap,
      {
        heat01,
        speed,
        fever,
        turbo: this.turboT > 0,
        grounded: sim.grounded,
        immune: sim.heatSys.immunity > 0,
        daySilhouette: pal.silhouette,
      },
      this.time
    );
    ctx.restore();

    // ---- 前景条（最快层） ----
    this.parallax.drawForeground(ctx, this.cam, relY, pal, this.time);

    // ---- 屏幕特效 ----
    this.fx.drawSpeedLines(ctx, sim.state === 'boost', speed, this.time);
    this.fx.drawVignette(ctx, redness);
    this.fx.drawFeverCorners(ctx, fever, this.time);
    this.fx.drawCinematicBars(ctx);
    this.fx.drawFlash(ctx);

    // ---- 粒子更新（渲染帧 dt） ----
    this.particles.update(dt);

    // ---- HUD ----
    if (showHud) {
      const hs: HudState = {
        heat: sim.heatSys.heat,
        immune: sim.heatSys.immunity > 0,
        combo: sim.combo,
        maxCombo: sim.maxCombo,
        score: sim.score,
        coins: sim.coinsTaken,
        fever,
        feverT: sim.feverT,
        feverDur: 8,
        sunsetT: Math.max(0, sim.sunsetTimer),
        sunsetDur: sim.sunsetDuration,
        nestDistanceM: sim.nestDistanceM,
        level: sim.level,
        distanceM: sim.distanceM,
        agl: heightAG,
        themeLevel: lvl,
        ...hudOverride,
      };
      this.hud.draw(ctx, hs, this.time);
    }
  }

  /* ---------------- 玩法粒子发射（速度/热度/状态三参数驱动） ---------------- */

  private emitGameplay(dt: number, sim: Sim, snap: BirdSnapshot, heat01: number, speed: number, fever: boolean, tumbling: boolean): void {
    if (tumbling) {
      // 原地爆炸 5s：前期剧烈喷发 → 中期烟柱火星 → 末期复燃微光
      const t = sim.boomElapsed;
      if (t < 1.2) {
        this.particles.emitMagma(snap.x, snap.y, 0, 0, Math.ceil(dt * 90), 1.8);
        this.particles.emitSpark(snap.x, snap.y, Math.ceil(dt * 14));
      }
      // 烟柱（持续）
      this.particles.emitSteam(snap.x - 4, snap.y - 26, Math.ceil(dt * 16), 1.2);
      // 末期复燃：尾焰重新点起（蓝）
      if (t > BLOWOUT.TIME - 1.2) {
        this.particles.emitFlame(snap.x, snap.y, 0, 0, 0.15, 0, false, false, dt * 0.6);
      }
      return;
    }
    // 尾焰：跑动即有，长度/密度/颜色随热度
    const dirA = sim.angle;
    const tailX = snap.x - Math.cos(dirA) * 22;
    const tailY = snap.y - Math.sin(dirA) * 22;
    this.particles.emitFlame(tailX, tailY, sim.vx, sim.vy, heat01, speed, fever, this.turboT > 0, dt);

    // 散热态蒸汽（空中松手）
    if (sim.state === 'cool') {
      this.particles.emitSteam(snap.x - 6, snap.y + 4, Math.ceil(dt * 22), 0.8);
    }
    // 雪坡雪雾尾迹（贴地 + 雪材质 + 速度）
    if (sim.grounded && speed > 260 && sim.terrain.materialAt(sim.x) === 'snow') {
      this.particles.emitSnow(snap.x - 10, snap.y + BIRD_R * Math.cos(dirA), sim.vx, Math.ceil(dt * (speed * 0.05)));
    }
    // 红热警示火星
    if (heat01 >= 0.8 && Math.random() < dt * 18) {
      this.particles.emitSpark(snap.x, snap.y, 1);
    }
  }

  /* ---------------- 完美着陆预测圈（判定可视化） ---------------- */

  private updatePredictRing(sim: Sim, snap: BirdSnapshot): void {
    this.predictTick++;
    if (this.predictTick % 4 !== 0) {
      return;
    }
    this.terrainR.hintRing = null;
    if (sim.grounded || sim.phase !== 'run' || sim.speed < 300) return;

    // 弹道前推（Tiny Wings 纯抛物线：按住 G×压坡 / 松开 G×1，对称可预测）
    const held = sim.state === 'boost';
    let px = snap.x;
    let py = snap.y;
    let vx = sim.vx;
    let vy = sim.vy;
    const dt = 1 / 60;
    const g = held ? G * PRESS_G_MULT : G;
    for (let t = dt; t <= 0.75; t += dt) {
      vy += g * dt;
      px += vx * dt;
      py += vy * dt;
      const gy = sim.terrain.heightAt(px);
      if (py + BIRD_R >= gy) {
        const theta = sim.terrain.tangentAngle(px);
        const { perfect } = judgeLanding(vx, vy, theta, Math.hypot(vx, vy));
        if (perfect && t <= PREDICT_RING_LEAD) {
          this.terrainR.hintRing = { x: px, y: gy - 10, alpha: 1 };
        }
        return;
      }
    }
  }

  get canvasTime(): number {
    return this.time;
  }
}

function interpSnap(sim: Sim, alpha: number): BirdSnapshot {
  const p = sim.prev;
  const c = sim.curr;
  return {
    x: lerp(p.x, c.x, alpha),
    y: lerp(p.y, c.y, alpha),
    angle: lerp(p.angle, c.angle, alpha),
    wing: lerp(p.wing, c.wing, alpha),
    phase: c.phase,
    flapPhase: c.flapPhase,
  };
}

export { clamp };
