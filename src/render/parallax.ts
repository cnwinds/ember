/**
 * Parallax —— 背景视差：天空渐变、太阳、云、远山、中景、前景条。
 * 至少 4 层滚动（天空/远山/中景/前景），层间速度差随游戏速度放大。
 * 全部扁平色块 + 手绘抖动描边，无写实光照渐变。
 */

import { valueNoise, rand01 } from '../core/rng';
import { lerp } from '../core/mathutil';
import { SkyPalette, withA } from './palette';
import type { Camera } from './camera';

interface CloudDef {
  x: number; // 周期空间坐标
  y: number;
  s: number;
  seed: number;
}
const CLOUDS: CloudDef[] = [];
for (let i = 0; i < 10; i++) {
  CLOUDS.push({ x: i * 640 + rand01(i, 321) * 400, y: 60 + rand01(i, 322) * 180, s: 0.7 + rand01(i, 323) * 0.9, seed: i });
}

export class Parallax {
  /** 视差层数（自适应降级 4→3 时省去中景层） */
  layers = 4;
  private w = 0;
  private h = 0;

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
  }

  /** 太阳屏幕位置（dayProgress 驱动：高→贴地平线）。
   *  无限远物：水平位置固定，不随相机移动（曾按 cam.x×0.02 偏移并回绕——会周期瞬移，已移除）。 */
  sunScreenPos(dayProgress: number): [number, number] {
    const x = this.w * 0.72;
    const horizonY = this.h * 0.62;
    // 清晨高挂 → 日落贴地平线（最后阶段沉入地平线下方）
    const y = lerp(this.h * 0.16, horizonY + this.h * 0.06, Math.pow(dayProgress, 1.4));
    return [x, y];
  }

  /** 天空（赛璐璐：海报式硬边界色带，5 段扁平色）+ 太阳 + 云 + 高空暗化 + 星星。 */
  drawSky(ctx: CanvasRenderingContext2D, cam: Camera, relY: number, pal: SkyPalette, dayProgress: number, time: number, spaceMix = 0, starAlpha = 0): void {
    const { w, h } = this;
    const mix = (rgb: string, t: number, tr: number, tg: number, tb: number) => {
      const [r, g, b] = rgb.split(',').map(Number);
      return `rgb(${Math.round(r + (tr - r) * t)},${Math.round(g + (tg - g) * t)},${Math.round(b + (tb - b) * t)})`;
    };
    // 5 段色带（顶→地平线），高空向深靛混合 —— 硬边界，赛璐璐的海报感
    const c0 = mix(pal.top, spaceMix, 10, 8, 32);
    const c1 = mix(pal.top, spaceMix * 0.6, 14, 10, 38);
    const c2 = mix(pal.mid, spaceMix * 0.85, 22, 16, 52);
    const c3 = mix(pal.mid, spaceMix * 0.5, 30, 20, 60);
    const c4 = mix(pal.horizon, spaceMix * 0.7, 42, 26, 70);
    const cols = [c0, c1, c2, c3, c4];
    const fr = [0, 0.34, 0.55, 0.75, 0.93, 1.001];
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = cols[i];
      ctx.fillRect(0, Math.floor(fr[i] * h), w, Math.ceil((fr[i + 1] - fr[i]) * h) + 1);
    }

    // 外太空星星（高空才显；确定性散布 + 闪烁 + 轻视差；锚定相对高度）
    if (starAlpha > 0.02) {
      for (let i = 0; i < 70; i++) {
        const sx = (((i * 173.3 + cam.x * 0.02) % (w + 40)) + w + 40) % (w + 40) - 20;
        const sy = (((i * 97.7 - relY * 0.03) % (h + 20)) + h + 20) % (h + 20) - 10;
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(time * (0.6 + rand01(i, 50) * 1.4) + i));
        const sz = rand01(i, 51) > 0.85 ? 2.2 : 1.3;
        ctx.fillStyle = `rgba(255,255,244,${(starAlpha * tw).toFixed(3)})`;
        ctx.fillRect(sx, sy, sz, sz);
      }
    }

    // 太阳：扁平双圈（核心 + 边环），高空变冷白（无大气散射）
    const [sx, sy] = this.sunScreenPos(dayProgress);
    const sunR = 46 + dayProgress * 14;
    ctx.fillStyle = withA(pal.sunRim, 0.35 * (1 - spaceMix * 0.7));
    ctx.beginPath();
    ctx.arc(sx, sy, sunR * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = mix(pal.sun, spaceMix * 0.8, 250, 252, 255);
    this.wobblyCircle(ctx, sx, sy, sunR, 11, dayProgress * 100);
    ctx.fill();

    // 云（真实感）：每朵云有自己的风速（大云=高空=慢，小云=近空=快）、
    // 缓慢上下浮游、视差系数随云大小分层 —— 整片云不再是同一速度的贴图带
    for (const c of CLOUDS) {
      const v = 3 + rand01(c.seed, 901) * 7 + (1 - c.s) * 5;
      const factor = 0.08 + (1 - c.s) * 0.07;
      const px = ((c.x - cam.x * factor - time * v) % 6400 + 6400) % 6400 - 800;
      if (px < -300 || px > w + 300) continue;
      const py = c.y * (h / 720) - relY * 0.04 + Math.sin(time * 0.08 + c.seed * 2.1) * 5;
      this.drawCloud(ctx, px, py, c.s, pal, c.seed);
    }
  }

  /** 手绘感云朵（赛璐璐）：叠圆扁平主体 + 底部硬边界阴影带 */
  private drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: SkyPalette, seed: number): void {
    const lobes = [
      [0, 0, 34], [30 * s, 6, 24], [-30 * s, 8, 22], [12 * s, -14, 22],
    ];
    ctx.fillStyle = pal.cloud;
    ctx.beginPath();
    for (let i = 0; i < lobes.length; i++) {
      const [dx, dy, r] = lobes[i];
      const wobble = 1 + valueNoise(i + seed * 7, 4) * 0.12;
      ctx.moveTo(x + dx * s + r * s * wobble, y + dy * s);
      ctx.arc(x + dx * s, y + dy * s, r * s * wobble, 0, Math.PI * 2);
    }
    ctx.fill();
    // 赛璐璐硬边阴影：裁剪到云体后铺一条直线顶边的阴影带
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < lobes.length; i++) {
      const [dx, dy, r] = lobes[i];
      const wobble = 1 + valueNoise(i + seed * 7, 4) * 0.12;
      ctx.moveTo(x + dx * s + r * s * wobble, y + dy * s);
      ctx.arc(x + dx * s, y + dy * s, r * s * wobble, 0, Math.PI * 2);
    }
    ctx.clip();
    ctx.fillStyle = pal.cloudShade;
    ctx.fillRect(x - 90 * s, y + 9 * s, 180 * s, 40 * s);
    ctx.restore();
  }

  /** 远山层组（赛璐璐大气透视）：4 层色阶 —— 越远越融入地平线色（雾化），
   *  各层独立山形相位/振幅/视差系数，颜色硬边界无渐变，层次感由色阶划分。 */
  drawRidges(ctx: CanvasRenderingContext2D, cam: Camera, relY: number, pal: SkyPalette, time: number, count: number): void {
    const { w, h } = this;
    const mixRGB = (a: string, b: string, t: number) => {
      const pa = a.split(',').map(Number);
      const pb = b.split(',').map(Number);
      return `rgb(${Math.round(pa[0] + (pb[0] - pa[0]) * t)},${Math.round(pa[1] + (pb[1] - pa[1]) * t)},${Math.round(pa[2] + (pb[2] - pa[2]) * t)})`;
    };
    // 由远及近：视差系数、基线、振幅、频率、雾化度（远层混入地平线色的比例）
    const defs = [
      { f: 0.09, base: 0.38, amp: 30, freq: 0.0012, seed: 500, color: mixRGB(pal.ridgeFar, pal.horizon, 0.42) },
      { f: 0.14, base: 0.45, amp: 40, freq: 0.0015, seed: 400, color: mixRGB(pal.ridgeFar, pal.horizon, 0.24) },
      { f: 0.22, base: 0.52, amp: 46, freq: 0.0019, seed: 200, color: pal.ridgeFar },
      { f: 0.45, base: 0.6, amp: 74, freq: 0.0024, seed: 100, color: pal.ridgeMid },
    ];
    const active = count >= 4 ? defs : defs.slice(0, 3); // 降级时省去最近层

    for (const L of active) {
      const scroll = cam.x * L.f;
      const baseY = h * L.base;
      const yShift = -relY * (0.02 + L.f * 0.08);
      const step = 24;
      // 山体填充（扁平色）
      ctx.fillStyle = L.color;
      ctx.beginPath();
      ctx.moveTo(-40, h + 40);
      for (let px = -40; px <= w + 40; px += step) {
        const wx = px + scroll;
        const y =
          baseY + yShift +
          valueNoise(wx * L.freq, L.seed) * L.amp +
          valueNoise(wx * L.freq * 2.7, L.seed + 1) * L.amp * 0.35 +
          Math.sin(wx * 0.0004 + time * 0.02 + L.seed) * 6;
        const jx = valueNoise(px * 0.11 + L.seed, L.seed + 2) * 1.4;
        ctx.lineTo(px + jx, y);
      }
      ctx.lineTo(w + 40, h + 40);
      ctx.closePath();
      ctx.fill();
      // 近两层山加锯齿树线带（赛璐璐植被剪影）：颠簸顶边的深绿色带
      if (L.f >= 0.2) {
        const treeCol = mixRGB(L.color, '34,60,44', 0.55);
        ctx.fillStyle = treeCol;
        ctx.beginPath();
        ctx.moveTo(-40, h + 40);
        for (let px = -40; px <= w + 40; px += 14) {
          const wx = px + scroll;
          const y =
            baseY + yShift +
            valueNoise(wx * L.freq, L.seed) * L.amp +
            valueNoise(wx * L.freq * 2.7, L.seed + 1) * L.amp * 0.35 +
            Math.sin(wx * 0.0004 + time * 0.02 + L.seed) * 6 +
            6 + // 树线略低于山脊线
            valueNoise(wx * 0.02, L.seed + 9) * 14; // 树冠颠簸
          ctx.lineTo(px, y);
        }
        ctx.lineTo(w + 40, h + 40);
        ctx.closePath();
        ctx.fill();
      }
      // 赛璐璐脊线（细、半透明，远层更淡）
      ctx.strokeStyle = withA('40,30,46', 0.22 + L.f * 0.4);
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let px = -40; px <= w + 40; px += step) {
        const wx = px + scroll;
        const y =
          baseY + yShift +
          valueNoise(wx * L.freq, L.seed) * L.amp +
          valueNoise(wx * L.freq * 2.7, L.seed + 1) * L.amp * 0.35 +
          Math.sin(wx * 0.0004 + time * 0.02 + L.seed) * 6;
        const jx = valueNoise(px * 0.11 + L.seed, L.seed + 2) * 1.4;
        if (px === -40) ctx.moveTo(px + jx, y);
        else ctx.lineTo(px + jx, y);
      }
      ctx.stroke();
    }
  }

  /** 前景条（最快层，画面底部低矮的雪丘剪影，制造纵深）。
   *  刻意压扁 + 与相机 y 弱耦合：任何飞行高度下都只是底部细条，绝不遮挡玩法画面。
   *  恒定视差 1.45（比相机快 = 比鸟更近）。 */
  drawForeground(ctx: CanvasRenderingContext2D, cam: Camera, relY: number, pal: SkyPalette, time: number): void {
    const { w, h } = this;
    const scroll = cam.x * 1.45;
    const baseY = h * 1.12;
    ctx.fillStyle = withA(pal.fg, 0.96);
    ctx.beginPath();
    ctx.moveTo(-40, h + 60);
    const step = 26;
    for (let px = -40; px <= w + 40; px += step) {
      const wx = px + scroll;
      const y =
        baseY -
        Math.abs(valueNoise(wx * 0.003, 300)) * 46 -
        Math.abs(valueNoise(wx * 0.008, 301)) * 16 -
        relY * 0.05 +
        Math.sin(time * 0.4 + wx * 0.001) * 2;
      const jx = valueNoise(px * 0.13, 302) * 1.5;
      ctx.lineTo(px + jx, y);
    }
    ctx.lineTo(w + 40, h + 60);
    ctx.closePath();
    ctx.fill();
    // 顶部描边
    ctx.strokeStyle = withA(pal.snowOutline, 0.35);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let px = -40; px <= w + 40; px += step) {
      const wx = px + scroll;
      const y =
        baseY -
        Math.abs(valueNoise(wx * 0.003, 300)) * 46 -
        Math.abs(valueNoise(wx * 0.008, 301)) * 16 -
        relY * 0.05 +
        Math.sin(time * 0.4 + wx * 0.001) * 2;
      const jx = valueNoise(px * 0.13, 302) * 1.5;
      if (px === -40) ctx.moveTo(px + jx, y);
      else ctx.lineTo(px + jx, y);
    }
    ctx.stroke();
  }

  /** 世界系云层带：锚定局部地形之上的两层云（穿越云海的体感来源）。
   *  云的绝对海拔跟随地形（像雾层）—— 不受地形海拔长程漂移影响。
   *  在相机变换内、地形填充之前调用 —— 地形会遮住「插进山里」的部分。 */
  drawCloudBands(ctx: CanvasRenderingContext2D, cam: Camera, x0: number, x1: number, time: number, heightAt: (x: number) => number): void {
    const layers = [
      { alt: 380, gap: 430, s: 1.0, a: 0.55 }, // 低云层（300-600 境界附近）
      { alt: 950, gap: 520, s: 1.4, a: 0.6 }, // 云海层（600-1000 境界附近）
    ];
    for (let li = 0; li < layers.length; li++) {
      const L = layers[li];
      for (let gx = Math.floor(x0 / L.gap) * L.gap; gx <= x1 + L.gap; gx += L.gap) {
        const ox = gx + rand01(gx + li * 7777, 60) * L.gap * 0.55;
        const oy = heightAt(ox) - L.alt + (rand01(gx + li * 8888, 61) - 0.5) * 150 + Math.sin(time * 0.3 + gx * 0.001) * 10;
        const s = L.s * (0.7 + rand01(gx + li * 9999, 62) * 0.6);
        ctx.fillStyle = `rgba(255,255,255,${L.a})`;
        ctx.beginPath();
        ctx.ellipse(ox, oy, 85 * s, 24 * s, 0, 0, Math.PI * 2);
        ctx.ellipse(ox + 60 * s, oy + 8 * s, 55 * s, 18 * s, 0, 0, Math.PI * 2);
        ctx.ellipse(ox - 62 * s, oy + 10 * s, 48 * s, 16 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        // 底部阴影（两色云）
        ctx.fillStyle = `rgba(214,222,238,${L.a * 0.7})`;
        ctx.beginPath();
        ctx.ellipse(ox, oy + 16 * s, 78 * s, 10 * s, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    void cam;
  }

  /** 略微不规则的圆（避免裸圆的塑料感） */
  private wobblyCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, n: number, seedPhase: number): void {
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (1 + valueNoise(i % n + seedPhase, 500) * 0.045);
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
}
