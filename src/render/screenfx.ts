/**
 * ScreenFX —— 屏幕级演出效果（屏幕坐标系，HUD 之前）。
 *
 * - 红热 vignette：透明度 80→0 / 100→0.35 线性
 * - 完美着陆白闪（1 帧白 → 快速衰减）
 * - Fever 四角泛白光（脉动）
 * - 加速态速度线（松手/滑翔时消失 —— 三态的推背感对比）
 * - 慢放暗角（时间被拉长时的电影感提示）
 */

import { clamp } from '../core/mathutil';

export class ScreenFX {
  private w = 0;
  private h = 0;
  /** 白闪强度 0..1 */
  flash = 0;
  /** Fever 进入时短暂全屏泛白 */
  feverFlash = 0;
  /** 速度线随机相位 */
  private lineSeeds: number[] = [];
  /** vignette 渐变缓存 */
  private vignette: CanvasGradient | null = null;
  private cornerGlow: CanvasGradient | null = null;
  /** 慢放暗角 */
  private cine = 0;

  constructor() {
    for (let i = 0; i < 14; i++) this.lineSeeds.push(Math.random());
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.vignette = null;
    this.cornerGlow = null;
  }

  triggerFlash(strength = 1): void {
    this.flash = Math.max(this.flash, strength);
  }
  triggerFeverFlash(): void {
    this.feverFlash = 1;
  }
  setCinematic(on: boolean): void {
    this.cine = clamp(this.cine + (on ? 0.06 : -0.06), 0, 1);
  }

  update(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 12);
    this.feverFlash = Math.max(0, this.feverFlash - dt * 3.5);
  }

  /** 红热 vignette（透明度 = redness × 0.35，80→0 / 100→0.35 线性） */
  drawVignette(ctx: CanvasRenderingContext2D, redness: number): void {
    if (redness <= 0.01) return;
    const alpha = redness * 0.35;
    if (!this.vignette) {
      // 内圈净空 → 角部全红：边缘暗角而非整体罩红
      const g = ctx.createRadialGradient(
        this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.4,
        this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.58
      );
      g.addColorStop(0, 'rgba(255,40,40,0)');
      g.addColorStop(1, 'rgba(255,30,30,1)');
      this.vignette = g;
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalAlpha = 1;
  }

  /** 速度线：加速态 + 高速才出现（推背感），散热态消失（风阻安静下来） */
  drawSpeedLines(ctx: CanvasRenderingContext2D, boost: boolean, speed: number, time: number): void {
    if (!boost || speed < 650) return;
    const strength = clamp((speed - 650) / 700, 0, 1) * 0.2;
    ctx.strokeStyle = `rgba(255,255,255,${strength.toFixed(3)})`;
    ctx.lineWidth = 2;
    const n = this.lineSeeds.length;
    for (let i = 0; i < n; i++) {
      const s = this.lineSeeds[i];
      const y = ((s * 1.3 + Math.sin(time * 0.7 + i) * 0.04) % 1) * this.h;
      const len = 60 + s * 120 + speed * 0.06;
      const x = this.w - ((time * (900 + s * 700) + s * this.w * 2) % (this.w + 300)) - 100;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y);
      ctx.stroke();
    }
  }

  /** Fever 四角泛白光 */
  drawFeverCorners(ctx: CanvasRenderingContext2D, fever: boolean, time: number): void {
    if (!fever && this.feverFlash <= 0.01) return;
    const pulse = 0.12 + Math.sin(time * 5) * 0.05;
    if (!this.cornerGlow) {
      const g = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.42, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,250,235,1)');
      this.cornerGlow = g;
    }
    ctx.globalAlpha = fever ? pulse : 0;
    ctx.fillStyle = this.cornerGlow;
    ctx.fillRect(0, 0, this.w, this.h);
    if (this.feverFlash > 0.01) {
      ctx.globalAlpha = this.feverFlash * 0.5;
      ctx.fillStyle = '#fff8e8';
      ctx.fillRect(0, 0, this.w, this.h);
    }
    ctx.globalAlpha = 1;
  }

  /** 慢放暗角（爆燃砸地 200ms / 涡轮全开 1s） */
  drawCinematicBars(ctx: CanvasRenderingContext2D): void {
    if (this.cine <= 0.01) return;
    const barH = this.h * 0.07 * this.cine;
    ctx.fillStyle = `rgba(20,10,16,${(0.8 * this.cine).toFixed(3)})`;
    ctx.fillRect(0, 0, this.w, barH);
    ctx.fillRect(0, this.h - barH, this.w, barH);
  }

  /** 完美着陆白闪（hit-stop 期间叠加） */
  drawFlash(ctx: CanvasRenderingContext2D): void {
    if (this.flash <= 0.01) return;
    ctx.globalAlpha = clamp(this.flash, 0, 1) * 0.85;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalAlpha = 1;
  }
}
