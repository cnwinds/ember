/**
 * GameLoop —— 固定时间步 + 渲染插值。
 *
 * - 物理恒定 1/120s 步长；慢放/加速只改变「真实时间→模拟时间」的换算（timeScale），
 *   绝不改步长本身 —— 手感优先于观感（自适应降级也绝不降步长）。
 * - hit-stop（完美着陆 2 帧冻结）直接冻结累加器，主角位置静止但渲染照常。
 * - 内置滚动平均 FPS 监测，驱动自适应降级（粒子密度 / 视差层数）。
 */

export interface LoopHooks {
  /** 渲染一帧。alpha∈[0,1) 为两物理步间的插值系数；realDt 为真实秒（不受 timeScale 影响） */
  render: (alpha: number, realDt: number) => void;
  /** 推进一个固定物理步（dt = 1/120） */
  step: () => void;
}

export interface QualityState {
  /** 粒子密度系数 1.0 / 0.7 */
  particleDensity: number;
  /** 视差层数 4 / 3 */
  parallaxLayers: number;
}

export class GameLoop {
  private hooks: LoopHooks;
  private acc = 0;
  private lastT = 0;
  private running = false;
  private paused = false;

  /** 时间缩放目标值（慢放演出由外部设置） */
  timeScale = 1;
  private timeScaleCur = 1;
  private timeScaleVel = 0;
  /** hit-stop 冻结剩余时间（真实秒） */
  freezeT = 0;
  /** 真实时间下的慢放剩余时间（>0 时 timeScale 生效） */
  slowmoT = 0;
  private slowmoScale = 1;

  /** FPS 滚动平均 */
  fps = 60;
  quality: QualityState = { particleDensity: 1, parallaxLayers: 4 };
  private lowFpsHold = 0;

  constructor(hooks: LoopHooks) {
    this.hooks = hooks;
  }

  start(): void {
    this.running = true;
    this.lastT = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      requestAnimationFrame(tick);
      let realDt = (now - this.lastT) / 1000;
      this.lastT = now;
      if (realDt > 0.1) realDt = 0.1; // 掉帧/切页保护：物理不追帧，防止螺旋死亡
      this.frame(realDt);
    };
    requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.lastT = performance.now();
  }

  /** 触发慢放：scale 持续 realSeconds（真实时间） */
  slowmo(scale: number, realSeconds: number): void {
    this.slowmoScale = scale;
    this.slowmoT = Math.max(this.slowmoT, realSeconds);
  }

  /** 触发 hit-stop：冻结 freezeSeconds（真实时间），期间不推进物理 */
  hitStop(freezeSeconds: number): void {
    this.freezeT = Math.max(this.freezeT, freezeSeconds);
  }

  private frame(realDt: number): void {
    // FPS 指数滑动平均
    if (realDt > 0) {
      const inst = 1 / realDt;
      this.fps += (inst - this.fps) * 0.05;
    }
    this.updateQuality(realDt);

    if (this.paused) {
      this.hooks.render(0, 0);
      return;
    }

    // 慢放计时（真实时间消耗）
    if (this.slowmoT > 0) {
      this.slowmoT -= realDt;
      this.timeScale = this.slowmoScale;
    } else {
      this.timeScale = 1;
    }
    // 时间缩放平滑过渡（慢放进出不突兀）
    const target = this.timeScale;
    const k = target > this.timeScaleCur ? 24 : 6; // 进入快、退出缓
    this.timeScaleVel += (target - this.timeScaleCur) * k * realDt;
    this.timeScaleVel *= Math.exp(-9 * realDt);
    this.timeScaleCur += this.timeScaleVel * realDt;

    // hit-stop：冻结物理但渲染照常（HUD 数字不动、主角位置冻结 → 演出优先于信息）
    if (this.freezeT > 0) {
      this.freezeT -= realDt;
      this.hooks.render(1, realDt);
      return;
    }

    this.acc += realDt * this.timeScaleCur;
    const STEP = 1 / 120;
    // 防卡顿雪崩：单帧最多补 8 步
    let n = 0;
    while (this.acc >= STEP && n < 8) {
      this.hooks.step();
      this.acc -= STEP;
      n++;
    }
    if (n === 8) this.acc = Math.min(this.acc, STEP); // 丢弃积压

    const alpha = this.acc / STEP;
    this.hooks.render(alpha, realDt);
  }

  /** 自适应降级：持续 <55fps → 粒子 ×0.7、视差 4→3（带迟滞，帧率恢复不自动升回，避免反复横跳） */
  private updateQuality(realDt: number): void {
    if (this.fps < 55) {
      this.lowFpsHold += realDt;
      if (this.lowFpsHold > 1.5) {
        this.quality.particleDensity = 0.7;
        this.quality.parallaxLayers = 3;
      }
    } else {
      this.lowFpsHold = Math.max(0, this.lowFpsHold - realDt * 0.5);
    }
  }
}
