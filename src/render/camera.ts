/**
 * Camera —— 跟随相机：前瞻、缓动、速度变焦、红热抖动、爆燃翻滚旋转。
 * 纯视觉组件（非确定性，不参与回放对比）。
 */

import { clamp, damp, lerp } from '../core/mathutil';
import { jitterNoise } from '../core/rng';

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  /** 世界旋转（爆燃翻滚时镜头随鸟转） */
  roll = 0;
  /** 红热屏幕抖动幅度 px（80→0，100→6，高频噪声） */
  shakeAmp = 0;
  private shakeT = 0;

  resize(w: number, h: number): void {
    this.vw = w;
    this.vh = h;
  }
  vw = 0;
  vh = 0;

  private altSmooth = 0;

  update(dt: number, birdX: number, birdY: number, vx: number, speed: number, redness: number, boom: number, heightAG: number): void {
    // 平滑离地高度（只用于 zoom）：上升沿 k=12（爬升时几乎零滞后——
    // 拉远慢半拍 = 爬升最快时看不到地面，正是要避免的），下降沿 k=3
    const altK = heightAG > this.altSmooth ? 12 : 3;
    this.altSmooth = damp(this.altSmooth, heightAG, altK, dt);

    // 前瞻：速度越快看得越远；y 平稳跟随（与高度无关 —— 同屏只靠 zoom，绝不上下拽）
    const targetX = birdX + clamp(vx * 0.22, -60, 340) + this.vw * 0.06;
    const targetY = birdY - this.vh * 0.04;
    // 大跳变（凤凰复燃等瞬移）→ 滑行模式（低 k 平移），避免镜头猛甩导致山体横扫一下
    const jump = Math.abs(targetX - this.x) > 800 || Math.abs(targetY - this.y) > 600;
    this.x = damp(this.x, targetX, jump ? 1.6 : 5.5, dt);
    this.y = damp(this.y, targetY, jump ? 1.4 : 3.2, dt);

    // 镜头拉远（zoom out）：整个画面缩小、窗口容纳更多场景 ——
    // 鸟到地面的跨度 ≤ 0.30 屏高（地面带占屏底 ~20%+）；下限 0.12（可容 ~1900px 高度）
    const fitZoom = clamp((0.3 * this.vh) / Math.max(this.altSmooth, 1), 0.12, 1.06);
    const speedZoom = clamp(1.06 - speed / 6200, 0.4, 1.06);
    const targetZoom = Math.min(speedZoom, fitZoom) * (1 - 0.08 * boom);
    // 拉远较快（要同屏时及时缩）、推近慢（回落优雅）；过快会造成缩放突变的位移感
    const zk = targetZoom < this.zoom ? 4.5 : 2.5;
    this.zoom = damp(this.zoom, targetZoom, zk, dt);

    // roll 恒为 0（爆燃为原地爆炸，无全屏旋转）
    this.roll = damp(this.roll, 0, 4, dt);

    // 抖动：红热线性（80→0 / 100→6px）；爆燃冲击（boom 1 → 12px，指数衰减）
    this.shakeAmp = Math.max(redness * 6, boom * 12);
    this.shakeT += dt;
  }

  /** 当前帧抖动偏移（高频噪声） */
  shakeOffset(): [number, number] {
    if (this.shakeAmp <= 0.01) return [0, 0];
    const t = this.shakeT * 34;
    const ax = jitterNoise(t, 0, 777) * this.shakeAmp;
    const ay = jitterNoise(t, 1, 888) * this.shakeAmp;
    return [ax, ay];
  }

  /** 世界 → 屏幕（不含抖动/旋转，供粒子剔除等） */
  worldToScreenX(wx: number): number {
    return (wx - this.x) * this.zoom + this.vw * 0.44;
  }
  worldToScreenY(wy: number): number {
    return (wy - this.y) * this.zoom + this.vh * 0.52;
  }
  /** 屏幕 → 世界 */
  screenToWorldX(sx: number): number {
    return (sx - this.vw * 0.44) / this.zoom + this.x;
  }

  /** 视口世界边界 [x0, x1]（粒子剔除/地形按需绘制用） */
  viewBounds(): [number, number] {
    const half = this.vw * 0.56 / this.zoom;
    return [this.x - half, this.x + half];
  }

  /** 应用 canvas 变换（含缩放/抖动/旋转） */
  apply(ctx: CanvasRenderingContext2D): void {
    const [sx, sy] = this.shakeOffset();
    ctx.translate(this.vw * 0.44 + sx, this.vh * 0.52 + sy);
    ctx.scale(this.zoom, this.zoom);
    if (this.roll !== 0) ctx.rotate(this.roll);
    ctx.translate(-this.x, -this.y);
  }

  /** 预算当前 zoom 下的插值渲染量（调试显示用） */
  debugZoom(): number {
    return lerp(this.zoom, this.zoom, 1);
  }
}
