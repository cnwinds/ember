/**
 * BirdRender —— 主角绘制：翅膀太小飞不起来的火山鸟。
 *
 * - 圆胖身体 + 奶油肚皮 + 超小翅膀（自嘲式设定）
 * - 尾部「火焰羽冠」三片：颜色 = flameRamp(heat)（与粒子/HUD 同源），
 *   长度 = 基础 × (1 + 热度/100)，随速度波动 —— 活仪表盘的主体读数
 * - 三态翅膀：boost 收拢 / cool 展翅扇动 / cruise 半张
 * - 手绘绘本画风：无描边，身体柔和渐变（左上受光→右下沉影），保留 6fps「沸腾」抖动
 * - 状态表情：红热→皱眉；翻滚→螺旋眼；黄昏→剪影对比度提升
 */

import { clamp, lerp } from '../core/mathutil';
import { valueNoise } from '../core/rng';
import { flameColor, withA, shadeRGB } from './palette';
import type { BirdSnapshot } from '../sim/game';

export interface BirdDrawState {
  heat01: number;
  speed: number;
  fever: boolean;
  turbo: boolean;
  grounded: boolean;
  immune: boolean;
  daySilhouette: number; // 0..1 黄昏剪影
}

export class BirdRenderer {
  private boilT = 0;
  private boilTick = 0;
  private blinkT = 0;

  update(dt: number): void {
    this.boilT += dt;
    if (this.boilT > 1 / 6) {
      this.boilT = 0;
      this.boilTick++;
    }
    this.blinkT += dt;
  }

  draw(ctx: CanvasRenderingContext2D, snap: BirdSnapshot, st: BirdDrawState, time: number): void {
    const { x, y, angle, wing, phase, flapPhase } = snap;
    const charred = phase === 'tumble'; // 爆燃焦黑宕机态
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // ---- 尾焰羽冠（爆燃期间熄灭，由复燃粒子接棒） ----
    if (!charred) this.drawTailFlame(ctx, st, time);
    else if (Math.sin(time * 21) > 0.6) {
      // 焦黑态偶发火星
      ctx.fillStyle = 'rgba(255,150,60,0.8)';
      ctx.beginPath();
      ctx.arc(-22, 0, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- 翅膀（画在身体后侧） ----
    this.drawWing(ctx, wing, flapPhase, st, time, false);

    // ---- 身体 ----
    const sil = st.daySilhouette;
    const bodyCol = charred
      ? 'rgb(32,26,30)'
      : sil > 0
        ? `rgb(${Math.round(lerp(76, 46, sil))},${Math.round(lerp(67, 38, sil))},${Math.round(lerp(64, 52, sil))})`
        : 'rgb(76,67,64)';
    const bellyCol = charred ? 'rgb(58,50,54)' : sil > 0 ? `rgb(${Math.round(lerp(242, 150, sil))},${Math.round(lerp(227, 118, sil))},${Math.round(lerp(201, 110, sil))})` : 'rgb(242,227,201)';
    // 绘本柔渐变身体（左上受光 → 右下沉影，替代赛璐璐硬边双色调）
    const bodyGrad = ctx.createLinearGradient(-20, -18, 14, 20);
    bodyGrad.addColorStop(0, shadeRGB(bodyCol, 1.3));
    bodyGrad.addColorStop(0.52, bodyCol);
    bodyGrad.addColorStop(1, shadeRGB(bodyCol, 0.72));
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    this.wobblyEllipse(ctx, 0, 0, 24, 19, this.boilTick);
    ctx.fill();

    // 肚皮
    ctx.fillStyle = bellyCol;
    ctx.beginPath();
    this.wobblyEllipse(ctx, 2, 8, 15, 9, this.boilTick + 3);
    ctx.fill();

    // 焦黑态：头顶冒烟
    if (charred) {
      ctx.fillStyle = 'rgba(120,116,128,0.5)';
      for (let i = 0; i < 3; i++) {
        const p = (time * 0.9 + i * 0.33) % 1;
        ctx.globalAlpha = 0.5 * (1 - p);
        ctx.beginPath();
        ctx.arc(4 + Math.sin(time * 3 + i * 2) * 4, -22 - p * 26, 3 + p * 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 翅膀（前侧，略大一点盖住身体）
    this.drawWing(ctx, wing, flapPhase, st, time, true);

    // 喙（扁平色，无描边）
    ctx.fillStyle = charred ? '#8a6a4a' : '#ffa94d';
    ctx.beginPath();
    ctx.moveTo(21, -3);
    ctx.lineTo(35, 1);
    ctx.lineTo(21, 5);
    ctx.closePath();
    ctx.fill();

    // 眼睛（含眨眼/红热皱眉/宕机螺旋眼）
    this.drawEye(ctx, st, phase);

    // 头顶小火苗装饰（热度高时冒；焦黑态熄灭）
    if (!charred && (st.heat01 > 0.35 || st.fever)) {
      const h = 3 + st.heat01 * 7;
      ctx.fillStyle = flameColor(Math.min(1, st.heat01 + 0.15));
      ctx.beginPath();
      ctx.moveTo(6, -19);
      ctx.quadraticCurveTo(6 + Math.sin(time * 17) * 3, -19 - h * 1.6, 10, -19 - h * 0.4);
      ctx.quadraticCurveTo(12, -19, 10, -17);
      ctx.closePath();
      ctx.fill();
    }

    // 免热状态：白色小十字环绕（「失而复得」的可读性）
    if (st.immune) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const a = time * 3 + (i * Math.PI) / 2;
        const px = Math.cos(a) * 32;
        const py = Math.sin(a) * 26;
        ctx.globalAlpha = 0.4 + Math.sin(time * 8 + i) * 0.3;
        ctx.beginPath();
        ctx.moveTo(px - 3, py);
        ctx.lineTo(px + 3, py);
        ctx.moveTo(px, py - 3);
        ctx.lineTo(px, py + 3);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  /* ---- 尾焰羽冠：三片火舌，热度三参数连续驱动 ---- */
  private drawTailFlame(ctx: CanvasRenderingContext2D, st: BirdDrawState, time: number): void {
    const heat = st.heat01;
    // 低热度也有可读的最小尾焰（余光读数的下限），热度与速度共同拉长
    const lenBase = 16 + heat * 30; // 长度 = 基础 × (1+热度)
    const len = lenBase * (1 + st.speed / 2600) * (st.turbo ? 2.0 : st.fever ? 1.5 : 1);
    // Fever/涡轮：白色长尾焰
    const colorMain = flameColor(st.fever || st.turbo ? 1 : heat);
    const colorCore = flameColor(Math.min(1, (st.fever || st.turbo ? 1 : heat) + 0.28));

    for (let i = -1; i <= 1; i++) {
      const wob = Math.sin(time * 19 + i * 2.1) * 4 + Math.sin(time * 7 + i) * 2;
      const l = len * (i === 0 ? 1 : 0.62);
      const w = 6.5 - Math.abs(i) * 2.2;
      const bx = -20 - Math.abs(i) * 3;
      const by = i * 5;
      ctx.fillStyle = colorMain;
      ctx.beginPath();
      ctx.moveTo(bx, by - w);
      ctx.quadraticCurveTo(bx - l * 0.5, by - w * 0.4 + wob * 0.4, bx - l, by + wob * 0.6);
      ctx.quadraticCurveTo(bx - l * 0.5, by + w * 0.4 + wob * 0.4, bx, by + w);
      ctx.closePath();
      ctx.fill();
    }
    // 内芯
    ctx.fillStyle = colorCore;
    ctx.beginPath();
    ctx.moveTo(-19, -2.5);
    ctx.quadraticCurveTo(-19 - len * 0.35, Math.sin(time * 21) * 2, -19 - len * 0.55, Math.sin(time * 15) * 3);
    ctx.quadraticCurveTo(-19 - len * 0.3, 3, -19, 2.5);
    ctx.closePath();
    ctx.fill();
  }

  /* ---- 翅膀：boost 收拢 0.05 / cruise 半张 0.3 / cool 展翅 1 ---- */
  private drawWing(ctx: CanvasRenderingContext2D, wing: number, flapPhase: number, st: BirdDrawState, time: number, front: boolean): void {
    const flap = wing > 0.6 ? Math.sin(flapPhase * 6) * 0.5 + 0.5 : Math.sin(time * 3) * 0.08;
    const spread = wing;
    const side = front ? 1 : -1;
    ctx.save();
    ctx.translate(-4, -6 * side);
    // 翅根角：收拢贴背 → 展开上扬
    ctx.rotate((-0.5 - spread * 1.5 - flap * spread * 0.9) * side);
    const wl = 10 + spread * 16; // 翅膀真的很小（最大 26px vs 身体 48px）
    const wh = 5 + spread * 5;
    ctx.fillStyle = st.daySilhouette > 0.5 ? 'rgb(40,33,38)' : 'rgb(58,50,48)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-wl * 0.4, -wh * 1.6, -wl, -wh * 0.2);
    ctx.quadraticCurveTo(-wl * 0.5, wh * 0.9, 0, wh * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* ---- 眼睛 ---- */
  private drawEye(ctx: CanvasRenderingContext2D, st: BirdDrawState, phase: string): void {
    const ex = 11;
    const ey = -6;
    // 眨眼（每 ~3.4s）
    const blink = this.blinkT % 3.4 < 0.12 ? 0.15 : 1;
    ctx.fillStyle = '#fff8ec';
    ctx.strokeStyle = 'rgb(40,34,32)';
    ctx.lineWidth = 1.5; // 细描边：仅保证小尺寸下的可读性
    ctx.beginPath();
    this.wobblyEllipse(ctx, ex, ey, 6, 6 * blink, this.boilTick + 7);
    ctx.fill();
    ctx.stroke();
    if (blink > 0.5) {
      ctx.fillStyle = '#2a2226';
      if (phase === 'tumble') {
        // 眩晕螺旋眼
        ctx.strokeStyle = '#2a2226';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let a = 0; a < Math.PI * 4; a += 0.25) {
          const r = a * 0.45;
          const px = ex + Math.cos(a) * r;
          const py = ey + Math.sin(a) * r * blink;
          if (a === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      } else {
        const look = clamp(st.speed / 1400, 0, 1);
        ctx.beginPath();
        ctx.arc(ex + 1.5 + look, ey + 0.5, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 红热皱眉
    if (st.heat01 >= 0.8 && phase !== 'tumble') {
      ctx.strokeStyle = 'rgb(40,34,32)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(ex - 6, ey - 8);
      ctx.lineTo(ex + 5, ey - 5.5);
      ctx.stroke();
    }
  }

  /* ---- 手绘椭圆（顶点抖动，随 boilTick 以 6fps 翻页；幅度贴近 1.5px 上限） ---- */
  private wobblyEllipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, seed: number): void {
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const j = valueNoise(i % n + seed * 31.7, 999) * 1.5;
      const px = cx + Math.cos(a) * (rx + j);
      const py = cy + Math.sin(a) * (ry + j);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  /** 蒸汽底光：散热态身体周围白雾（画在鸟后面的粒子已覆盖，此处补一层贴身雾） */
  drawGlideAura(ctx: CanvasRenderingContext2D, snap: BirdSnapshot, wing: number, time: number): void {
    if (wing < 0.75) return;
    ctx.fillStyle = withA('255,255,255', 0.10 + Math.sin(time * 6) * 0.03);
    ctx.beginPath();
    this.wobblyEllipse(ctx, snap.x, snap.y, 34, 26, this.boilTick + 21);
    ctx.fill();
  }
}
