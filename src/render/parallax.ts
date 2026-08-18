/**
 * Parallax —— 背景视差：天空渐变、太阳、云、远山、中景、前景条。
 * 至少 4 层滚动（天空/远山/中景/前景），层间速度差随游戏速度放大。
 * 手绘绘本画风：柔和渐变天空 + 扁平剪影层叠（剪纸拼贴感），全层无描边。
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
  /** 天空渐变缓存（颜色只随昼夜 101 档缓变，命中率极高） */
  private skyGrad: CanvasGradient | null = null;
  private skyKey = '';
  /** 云朵精灵缓存：每朵云形状固定（wobble 由 seed 决定），只有颜色随昼夜变 ——
   *  颜色不变时直接 drawImage，免去每朵云的路径 + 裁剪 + 渐变 */
  private cloudSprites: Array<{ cv: HTMLCanvasElement; ox: number; oy: number }> = [];
  private cloudColorKey = '';

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

  /** 天空（绘本：柔和纵向渐变 top→mid→horizon）+ 太阳柔光晕 + 云 + 高空暗化 + 星星。 */
  drawSky(ctx: CanvasRenderingContext2D, cam: Camera, relY: number, pal: SkyPalette, dayProgress: number, time: number, spaceMix = 0, starAlpha = 0): void {
    const { w, h } = this;
    const mix = (rgb: string, t: number, tr: number, tg: number, tb: number) => {
      const [r, g, b] = rgb.split(',').map(Number);
      return `rgb(${Math.round(r + (tr - r) * t)},${Math.round(g + (tg - g) * t)},${Math.round(b + (tb - b) * t)})`;
    };
    // 柔和三停渐变（顶→地平线），高空向深靛混合 —— 无硬边界色带（渐变按颜色键缓存）
    const cTop = mix(pal.top, spaceMix, 10, 8, 32);
    const cMid = mix(pal.mid, spaceMix * 0.7, 24, 16, 52);
    const cHor = mix(pal.horizon, spaceMix * 0.7, 42, 26, 70);
    const skyKey = `${cTop}|${cMid}|${cHor}|${h}`;
    if (skyKey !== this.skyKey) {
      const grad = ctx.createLinearGradient(0, 0, 0, h * 1.02);
      grad.addColorStop(0, cTop);
      grad.addColorStop(0.48, cMid);
      grad.addColorStop(0.92, cHor);
      grad.addColorStop(1, cHor);
      this.skyGrad = grad;
      this.skyKey = skyKey;
    }
    ctx.fillStyle = this.skyGrad!;
    ctx.fillRect(0, 0, w, h);

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

    // 太阳：径向渐变柔光晕（绘本暖阳）+ 手绘核心圆，高空变冷白（无大气散射）
    const [sx, sy] = this.sunScreenPos(dayProgress);
    const sunR = 46 + dayProgress * 14;
    const halo = ctx.createRadialGradient(sx, sy, sunR * 0.4, sx, sy, sunR * 2.6);
    halo.addColorStop(0, withA(pal.sunRim, 0.5 * (1 - spaceMix * 0.7)));
    halo.addColorStop(0.5, withA(pal.sunRim, 0.18 * (1 - spaceMix * 0.7)));
    halo.addColorStop(1, withA(pal.sunRim, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx, sy, sunR * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = mix(pal.sun, spaceMix * 0.8, 250, 252, 255);
    this.wobblyCircle(ctx, sx, sy, sunR, 11, dayProgress * 100);
    ctx.fill();

    // 云（真实感）：每朵云有自己的风速（大云=高空=慢，小云=近空=快）、
    // 缓慢上下浮游、视差系数随云大小分层 —— 整片云不再是同一速度的贴图带
    this.ensureCloudSprites(pal);
    for (const c of CLOUDS) {
      const v = 3 + rand01(c.seed, 901) * 7 + (1 - c.s) * 5;
      const factor = 0.08 + (1 - c.s) * 0.07;
      const px = ((c.x - cam.x * factor - time * v) % 6400 + 6400) % 6400 - 800;
      if (px < -300 || px > w + 300) continue;
      const py = c.y * (h / 720) - relY * 0.04 + Math.sin(time * 0.08 + c.seed * 2.1) * 5;
      const spr = this.cloudSprites[c.seed];
      ctx.drawImage(spr.cv, px + spr.ox, py + spr.oy, spr.cv.width / 2, spr.cv.height / 2);
    }
  }

  /** 云朵精灵：每朵云按自身 seed/s 预渲染到 2× 离屏画布（含柔和底影）。
   *  颜色键按 12/级量化 —— 昼夜档变化几乎不再触发重建，平时每朵云仅一次 drawImage */
  private ensureCloudSprites(pal: SkyPalette): void {
    const quant = (rgb: string) =>
      rgb.split(',').map((v) => Math.round(Number(v) / 12) * 12).join(',');
    const colCloud = quant(pal.cloud);
    const colShade = quant(pal.cloudShade);
    const key = colCloud + '|' + colShade;
    if (key === this.cloudColorKey && this.cloudSprites.length === CLOUDS.length) return;
    const RES = 2; // 2× 分辨率，DPR=2 下依旧清晰
    this.cloudSprites = CLOUDS.map((c) => {
      const s = c.s;
      // 包围盒（lobe 半径含 12% wobble，底部含 34s 柔影）
      const l = -(30 * s + 22 * s * 1.12) - 8;
      const r = 30 * s + 24 * s * 1.12 + 8;
      const top = -(14 * s + 22 * s * 1.12) - 8;
      const bot = 8 * s + 22 * s * 1.12 + 34 * s + 8;
      const w = Math.ceil(r - l);
      const h = Math.ceil(bot - top);
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(w * RES);
      cv.height = Math.ceil(h * RES);
      const c2 = cv.getContext('2d')!;
      c2.scale(RES, RES);
      c2.translate(-l, -top);
      const lobes = [
        [0, 0, 34], [30 * s, 6, 24], [-30 * s, 8, 22], [12 * s, -14, 22],
      ];
      c2.fillStyle = `rgb(${colCloud})`;
      c2.beginPath();
      for (let i = 0; i < lobes.length; i++) {
        const [dx, dy, rr] = lobes[i];
        const wobble = 1 + valueNoise(i + c.seed * 7, 4) * 0.12;
        c2.moveTo(dx + rr * wobble, dy);
        c2.arc(dx, dy, rr * wobble, 0, Math.PI * 2);
      }
      c2.fill();
      // 底部柔影：裁剪到云体后铺一条上透明→下 cloudShade 的渐变
      c2.save();
      c2.clip();
      const shade = c2.createLinearGradient(0, 2 * s, 0, 34 * s);
      shade.addColorStop(0, `rgba(${colShade},0)`);
      shade.addColorStop(1, `rgba(${colShade},0.85)`);
      c2.fillStyle = shade;
      c2.fillRect(-60 * s, 2 * s, 120 * s, 34 * s);
      c2.restore();
      return { cv, ox: l, oy: top };
    });
    this.cloudColorKey = key;
  }

  /** 远山层组（绘本大气透视）：4 层色阶剪影 —— 越远越融入地平线色（雾化）。
   *  性能：山形用「周期为条带宽度的正弦叠加」→ 每层预渲染成可平铺的离屏条带
   *  （颜色量化 12/级，重建极少）；每帧仅 2 次 drawImage 平铺 + 1 次补底 fillRect，
   *  替代原先 4~6 次大路径填充（约 2-3 倍屏幕面积的重复光栅）。 */
  private ridgeStrips: Array<{ cv: HTMLCanvasElement; period: number; yTop: number } | null> = [null, null, null, null];
  private ridgeStripKeys: string[] = ['', '', '', ''];

  drawRidges(ctx: CanvasRenderingContext2D, cam: Camera, relY: number, pal: SkyPalette, time: number, count: number): void {
    const { w, h } = this;
    const mixRGB = (a: string, b: string, t: number) => {
      const parse = (s: string) => s.replace('rgb(', '').replace(')', '').split(',').map(Number);
      const pa = parse(a);
      const pb = parse(b);
      return `rgb(${Math.round(pa[0] + (pb[0] - pa[0]) * t)},${Math.round(pa[1] + (pb[1] - pa[1]) * t)},${Math.round(pa[2] + (pb[2] - pa[2]) * t)})`;
    };
    const quant = (c: string) => c.replace(/[\d.]+/g, (v) => String(Math.round(Number(v) / 12) * 12));
    // 由远及近：视差系数、基线、振幅、正弦谐波、雾化度（远层混入地平线色的比例）
    const defs = [
      { f: 0.09, base: 0.38, amp: 30, harm: [0.55, 0.3, 0.25, 0.15], color: quant(mixRGB(pal.ridgeFar, pal.horizon, 0.42)), tree: false },
      { f: 0.14, base: 0.45, amp: 40, harm: [0.55, 0.3, 0.25, 0.15], color: quant(mixRGB(pal.ridgeFar, pal.horizon, 0.24)), tree: false },
      { f: 0.22, base: 0.52, amp: 46, harm: [0.55, 0.28, 0.26, 0.16], color: quant(`rgb(${pal.ridgeFar})`), tree: true },
      { f: 0.45, base: 0.6, amp: 74, harm: [0.52, 0.3, 0.24, 0.18], color: quant(`rgb(${pal.ridgeMid})`), tree: true },
    ];
    const layerCount = count >= 4 ? 4 : 3; // 降级时省去最近层
    void time;

    for (let li = 0; li < layerCount; li++) {
      const L = defs[li];
      const scroll = cam.x * L.f;
      const baseY = h * L.base;
      const yShift = -relY * (0.02 + L.f * 0.08);

      // 条带缓存（周期正弦山形 + 树线，一次性烘焙）
      const period = w + 1400;
      const key = `${L.color}|${period}`;
      let strip = this.ridgeStrips[li];
      if (!strip || this.ridgeStripKeys[li] !== key) {
        const top = -(L.amp * 1.3 + 8);
        const bot = L.amp * 1.3 + (L.tree ? 52 : 8);
        const H = Math.ceil(bot - top);
        const cv = document.createElement('canvas');
        cv.width = period;
        cv.height = H;
        const c2 = cv.getContext('2d')!;
        c2.translate(0, -top);
        // 山体：周期 = 条带宽度的正弦叠加（可无缝平铺）
        const prof = (u: number) => {
          const k = (2 * Math.PI) / period;
          let y = 0;
          const H1 = [1, 2, 5, 9];
          const PH = [0.7, 2.9, 5.1, 1.3];
          for (let m = 0; m < 4; m++) y += Math.sin(u * k * H1[m] + PH[m] + li * 1.9) * L.amp * L.harm[m];
          return y;
        };
        c2.fillStyle = L.color;
        c2.beginPath();
        c2.moveTo(0, H);
        for (let u = 0; u <= period; u += 10) c2.lineTo(u, prof(u));
        c2.lineTo(period, H);
        c2.closePath();
        c2.fill();
        // 树线带（近层）：颠簸顶边的深绿色带
        if (L.tree) {
          const treeCol = quant(mixRGB(L.color, 'rgb(34,60,44)', 0.45));
          c2.fillStyle = treeCol;
          c2.beginPath();
          c2.moveTo(0, H);
          for (let u = 0; u <= period; u += 8) {
            c2.lineTo(u, prof(u) + 6 + Math.sin(u * 0.021 + li * 3.7) * 7 + Math.sin(u * 0.093 + li) * 5);
          }
          c2.lineTo(period, H);
          c2.closePath();
          c2.fill();
        }
        strip = { cv, period, yTop: top };
        this.ridgeStrips[li] = strip;
        this.ridgeStripKeys[li] = key;
      }

      // 平铺绘制（2 张覆盖任意相位）+ 底部补色
      const off = ((scroll % strip.period) + strip.period) % strip.period;
      const y0 = baseY + yShift + strip.yTop;
      ctx.drawImage(strip.cv, -off, y0);
      ctx.drawImage(strip.cv, -off + strip.period, y0);
      const stripBottom = y0 + strip.cv.height;
      if (stripBottom < h + 40) {
        ctx.fillStyle = L.color;
        ctx.fillRect(0, stripBottom - 1, w, h + 40 - stripBottom + 1);
      }
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
    // 绘本剪影：无描边
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
        // 底部柔影（低透明度，绘本云的蓬松下缘）
        ctx.fillStyle = `rgba(226,232,246,${L.a * 0.45})`;
        ctx.beginPath();
        ctx.ellipse(ox, oy + 14 * s, 80 * s, 9 * s, 0, 0, Math.PI * 2);
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
