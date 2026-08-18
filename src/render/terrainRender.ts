/**
 * TerrainRender —— 手绘感地形渲染（世界坐标系，相机已应用）。
 *
 * - 多层贝塞尔式平滑山丘 + 2px 手绘抖动描边（确定性噪声，幅度 ≤1.5px，不随帧闪烁）
 * - 扁平两色：底色 + 暗部色块（朝阳/背阴坡的暗条，长度随太阳高度变化 —— 太阳越低阴影越长）
 * - 岩石坡：坡度超阈值换成岩石色块（无雪雾，摩擦更高由 sim 决定）
 * - 金币（不规则多边形金片）、巢穴（树枝 scribble + 金色信标）、焦痕（爆燃砸地）
 * - 只绘制视口内的控制点段（按需绘制）
 */

import { Terrain } from '../sim/terrain';
import { valueNoise, rand01 } from '../core/rng';
import { withA, SkyPalette } from './palette';
import type { Camera } from './camera';
import { clamp } from '../core/mathutil';
import { PX_PER_M, ROCK_SLOPE_THRESHOLD } from '../core/constants';

/** 岩石色块的视觉坡度阈值（略高于物理阈值，只给真正的陡壁上色） */
const ROCK_SLOPE_VISUAL = ROCK_SLOPE_THRESHOLD + 0.1;

interface Scorch {
  x: number;
  y: number;
  age: number;
}

export class TerrainRenderer {
  private scorches: Scorch[] = [];
  /** 完美着陆判定提示圈（由渲染器预测计算后绘制） */
  hintRing: { x: number; y: number; alpha: number } | null = null;

  addScorch(x: number, y: number): void {
    this.scorches.push({ x, y, age: 0 });
    if (this.scorches.length > 14) this.scorches.shift();
  }

  clearScorches(): void {
    this.scorches.length = 0;
  }

  update(dt: number): void {
    for (const s of this.scorches) s.age += dt;
  }

  /** 主绘制入口 */
  draw(
    ctx: CanvasRenderingContext2D,
    terrain: Terrain,
    cam: Camera,
    pal: SkyPalette,
    dayProgress: number,
    time: number,
    viewH: number,
    simX: number,
    fever: boolean
  ): void {
    const [x0, x1] = cam.viewBounds();
    const step = 13 / cam.zoom; // 屏幕上约 13px 一段
    const bottom = cam.y + viewH; // 世界坐标底部

    // ---- 采样 ----
    const n = Math.ceil((x1 - x0) / step) + 2;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step;
      xs.push(x);
      ys.push(terrain.heightAt(x));
    }

    // 阴影条深度（太阳越低越长）—— 供下方赛璐璐色块使用
    const shadeDepth = 14 + dayProgress * 30;

    // ---- 主体填充（雪底色） ----
    ctx.fillStyle = withA(pal.snow, 1);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const j = valueNoise(xs[i] * 0.05, 600) * 1.2; // 手绘抖动 ≤1.5px
      if (i === 0) ctx.moveTo(xs[i] + j, ys[i] + j);
      else ctx.lineTo(xs[i] + j, ys[i] + j);
    }
    ctx.lineTo(x1, bottom + 80);
    ctx.lineTo(x0, bottom + 80);
    ctx.closePath();
    ctx.fill();

    // ---- 赛璐璐暗部色块（背阴坡）：扁平色 + 硬边界，叠在雪底之上 ----
    ctx.fillStyle = withA(pal.snowShade, 1);
    ctx.beginPath();
    let inShade = false;
    for (let i = 0; i < n; i++) {
      const slope = (ys[Math.min(i + 1, n - 1)] - ys[Math.max(i - 1, 0)]) / (xs[Math.min(i + 1, n - 1)] - xs[Math.max(i - 1, 0)] || 1);
      const shady = slope < -0.16;
      if (shady && !inShade) {
        ctx.moveTo(xs[i], ys[i]);
        inShade = true;
      } else if (shady) {
        ctx.lineTo(xs[i], ys[i]);
      } else if (inShade) {
        ctx.lineTo(xs[i - 1], ys[i - 1] + shadeDepth);
        for (let j = i - 1; j >= 0; j--) {
          ctx.lineTo(xs[j], ys[j] + shadeDepth);
          const s2 = (ys[Math.min(j + 1, n - 1)] - ys[Math.max(j - 1, 0)]) / (xs[Math.min(j + 1, n - 1)] - xs[Math.max(j - 1, 0)] || 1);
          if (j === 0 || s2 > -0.1) break;
        }
        ctx.closePath();
        inShade = false;
      }
    }
    ctx.fill();

    // ---- 赛璐璐岩石色块（陡坡）：扁平双色 ----
    ctx.fillStyle = withA(pal.rock, 1);
    ctx.beginPath();
    let inRock = false;
    for (let i = 0; i < n; i++) {
      const slope = Math.abs((ys[Math.min(i + 1, n - 1)] - ys[Math.max(i - 1, 0)]) / (xs[Math.min(i + 1, n - 1)] - xs[Math.max(i - 1, 0)] || 1));
      const rocky = slope > ROCK_SLOPE_VISUAL;
      if (rocky && !inRock) {
        ctx.moveTo(xs[i], ys[i]);
        inRock = true;
      } else if (rocky) {
        ctx.lineTo(xs[i], ys[i]);
      } else if (inRock) {
        ctx.lineTo(xs[i - 1], ys[i - 1] + 22);
        ctx.lineTo(xs[i - 1], ys[i - 1]);
        ctx.closePath();
        inRock = false;
      }
    }
    ctx.fill();

    // ---- 赛璐璐受光脊线（亮边）：粗亮描边在暗描边之下，露出上缘 ----
    ctx.strokeStyle = 'rgba(255,252,240,0.85)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const j = valueNoise(xs[i] * 0.05, 600) * 1.2;
      if (i === 0) ctx.moveTo(xs[i] + j, ys[i] + j + 2.5);
      else ctx.lineTo(xs[i] + j, ys[i] + j + 2.5);
    }
    ctx.stroke();

    // ---- 顶部 2px 手绘描边 ----
    ctx.strokeStyle = withA(pal.snowOutline, 0.9);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const j = valueNoise(xs[i] * 0.05, 600) * 1.2;
      if (i === 0) ctx.moveTo(xs[i] + j, ys[i] + j);
      else ctx.lineTo(xs[i] + j, ys[i] + j);
    }
    ctx.stroke();

    // ---- 赛璐璐植被（松/圆树/灌木/草丛，确定性散布 + 风摆） ----
    this.drawScenery(ctx, terrain, cam, pal, time);

    // ---- 焦痕 ----
    for (const s of this.scorches) {
      const fade = clamp(1 - s.age / 30, 0.15, 1);
      ctx.fillStyle = withA('58,44,38', 0.5 * fade);
      ctx.beginPath();
      ctx.ellipse(s.x, s.y - 3, 60, 14, terrain.tangentAngle(s.x), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = withA('30,22,20', 0.4 * fade);
      for (let i = 0; i < 5; i++) {
        const ox = valueNoise(i + s.x, 700) * 90;
        ctx.beginPath();
        ctx.ellipse(s.x + ox, s.y - 2, 7, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ---- 金币 ----
    const coins = terrain.coinsInRange(x0 - 100, x1 + 100);
    for (let ci = 0; ci < coins.length; ci++) {
      const c = coins[ci];
      if (c.taken || c.x < x0 - 40 || c.x > x1 + 40) continue;
      this.drawCoin(ctx, c.x, c.y + Math.sin(time * 3 + c.x * 0.05) * 4, time, c.x);
    }

    // ---- 巢穴（下一关终点） ----
    // 由调用方传入 nestX；此处通过 simX 推算当前关卡号对应巢位
    void simX;
    // ---- 完美判定提示圈（淡金色，提前 0.5s 出现） ----
    if (this.hintRing) {
      const hr = this.hintRing;
      const pulse = 0.75 + Math.sin(time * 14) * 0.25;
      ctx.strokeStyle = withA('255,213,79', 0.55 * pulse);
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.ellipse(hr.x, hr.y, 30, 30 * Math.cos(terrain.tangentAngle(hr.x)), terrain.tangentAngle(hr.x), 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = withA('255,245,200', 0.3 * pulse);
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.ellipse(hr.x, hr.y, 34, 34 * Math.cos(terrain.tangentAngle(hr.x)), terrain.tangentAngle(hr.x), 0, Math.PI * 2);
      ctx.stroke();
    }

    void fever;
  }

  /** 赛璐璐植被：可玩地形上的松树/圆树/灌木/草丛。
   *  确定性散布（hash 网格）、陡坡不长树、黄昏随天色调暖、微风摆动。
   *  颜色每次绘制只构建一次（每树每帧拼字符串会造成 GC 卡顿）。 */
  drawScenery(ctx: CanvasRenderingContext2D, terrain: Terrain, cam: Camera, pal: SkyPalette, time: number): void {
    const [x0, x1] = cam.viewBounds();
    // 黄昏混色：植被随天色注入地平线暖调（赛璐璐整体调色板一致性）
    const horizon = pal.horizon.split(',').map(Number);
    const duskT = pal.silhouette * 0.4;
    const build = (rgb: string, k: number): string => {
      const p = rgb.split(',').map(Number);
      const c = p.map((v, i) => Math.round(v + (horizon[i] - v) * duskT));
      const d = [Math.round(c[0] * 0.68), Math.round(c[1] * 0.68), Math.round(c[2] * 0.68)];
      return `rgb(${Math.round(c[0] + (d[0] - c[0]) * k)},${Math.round(c[1] + (d[1] - c[1]) * k)},${Math.round(c[2] + (d[2] - c[2]) * k)})`;
    };
    const PINE = '62,108,84';
    const ROUND = '86,138,94';
    const TRUNK = '110,84,60';
    // 每帧一次性构建全部 8 个色阶（松 3 层 + 干 / 圆树 3 / 灌木 2 / 草）
    const C = {
      trunk: build(TRUNK, 0.4),
      pine0: build(PINE, 0),
      pine1: build(PINE, 0.08),
      pine2: build(PINE, 0.16),
      pineD0: build(PINE, 0.75),
      pineD1: build(PINE, 0.8),
      pineD2: build(PINE, 0.85),
      round0: build(ROUND, 0),
      roundD: build(ROUND, 0.8),
      roundH: build(ROUND, -0.25),
      bush0: build(ROUND, 0.1),
      grass: build(PINE, -0.1),
    };

    for (let gx = Math.floor(x0 / 210) * 210; gx <= x1 + 210; gx += 210) {
      const h1 = rand01(gx, 777001);
      if (h1 > 0.58) continue; // 密度
      const x = gx + (h1 - 0.5) * 150;
      const slope = Math.abs(terrain.slopeAt(x));
      if (slope > 0.5) continue; // 陡岩不长树
      const gy = terrain.heightAt(x) + 2;
      const s = 0.75 + rand01(gx, 777003) * 0.65;
      const type = rand01(gx, 777002);
      const sway = Math.sin(time * 1.3 + gx * 0.013) * 0.045; // 微风摆
      ctx.save();
      ctx.translate(x, gy);
      ctx.rotate(terrain.tangentAngle(x) * 0.45 + sway);
      if (type < 0.42) {
        // 松树：三层三角 + 右侧硬边暗面 + 树干
        ctx.fillStyle = C.trunk;
        ctx.fillRect(-2 * s, -10 * s, 4 * s, 11 * s);
        for (let i = 0; i < 3; i++) {
          const topY = (-46 + i * 13) * s;
          const halfW = (17 - i * 4) * s;
          const botY = topY + 18 * s;
          ctx.fillStyle = i === 0 ? C.pine0 : i === 1 ? C.pine1 : C.pine2;
          ctx.beginPath();
          ctx.moveTo(0, topY);
          ctx.lineTo(-halfW, botY);
          ctx.lineTo(halfW, botY);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = i === 0 ? C.pineD0 : i === 1 ? C.pineD1 : C.pineD2;
          ctx.beginPath();
          ctx.moveTo(0, topY);
          ctx.lineTo(halfW, botY);
          ctx.lineTo(0, botY);
          ctx.closePath();
          ctx.fill();
        }
      } else if (type < 0.78) {
        // 圆树：干 + 圆冠（硬边暗面 + 高光点）
        ctx.fillStyle = C.trunk;
        ctx.fillRect(-2.5 * s, -16 * s, 5 * s, 17 * s);
        const r = 14 * s;
        ctx.fillStyle = C.round0;
        ctx.beginPath();
        ctx.arc(0, -26 * s, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.fillStyle = C.roundD;
        ctx.beginPath();
        ctx.arc(4 * s, -18 * s, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.roundH;
        ctx.beginPath();
        ctx.arc(-5 * s, -31 * s, 4.5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        // 灌木：双圆 + 暗面
        ctx.fillStyle = C.bush0;
        ctx.beginPath();
        ctx.arc(-5 * s, -6 * s, 8 * s, 0, Math.PI * 2);
        ctx.arc(6 * s, -5 * s, 6.5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.fillStyle = C.roundD;
        ctx.fillRect(-16 * s, -4 * s, 32 * s, 14 * s);
        ctx.restore();
      }
      ctx.restore();
    }
    // 草丛点缀（更密的细碎元素）
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.grass;
    ctx.beginPath();
    for (let gx = Math.floor(x0 / 90) * 90; gx <= x1 + 90; gx += 90) {
      if (rand01(gx, 777004) > 0.4) continue;
      const x = gx + rand01(gx, 777005) * 60;
      if (Math.abs(terrain.slopeAt(x)) > 0.45) continue;
      const gy = terrain.heightAt(x) + 1;
      const sway = Math.sin(time * 2 + gx * 0.05) * 1.5;
      for (let b = -1; b <= 1; b++) {
        ctx.moveTo(x + b * 2, gy);
        ctx.lineTo(x + b * 2 + b * 1.5 + sway, gy - 6 - Math.abs(b) * -2);
      }
    }
    ctx.stroke();
  }

  /** 巢穴（世界系）：金色信标 + 树枝巢 + 里程旗 */  drawNest(ctx: CanvasRenderingContext2D, x: number, terrain: Terrain, pal: SkyPalette, time: number, fever: boolean): void {
    const y = terrain.heightAt(x);
    const ang = terrain.tangentAngle(x);
    // 信标光圈（脉动）
    const pulse = 0.6 + Math.sin(time * 4) * 0.4;
    ctx.strokeStyle = withA('255,200,90', 0.4 * pulse);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(x, y - 4, 70, 70 * Math.cos(ang), ang, 0, Math.PI * 2);
    ctx.stroke();
    // 巢：三层 scribble 椭圆
    const browns = ['#8a6a4a', '#75553a', '#9c7c58'];
    for (let l = 0; l < 3; l++) {
      ctx.strokeStyle = browns[l];
      ctx.lineWidth = 6 - l;
      ctx.beginPath();
      const rx = 34 - l * 6;
      const ry = 13 - l * 2.5;
      for (let i = 0; i <= 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const r2 = 1 + valueNoise(i * 3 + l, 800 + l) * 0.18;
        const px = x + Math.cos(a) * rx * r2;
        const py = y - 6 - l * 3 + Math.sin(a) * ry * r2;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
    // 巢内暖光
    ctx.fillStyle = withA('255,180,80', 0.25 + pulse * 0.15);
    ctx.beginPath();
    ctx.ellipse(x, y - 8, 20, 7, ang, 0, Math.PI * 2);
    ctx.fill();
    // 小旗（手绘三角）
    const fx = x;
    const fy = y - 46 + Math.sin(time * 2.5) * 2;
    ctx.strokeStyle = '#6d5642';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(fx, y - 4);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    ctx.fillStyle = fever ? '#fff3d6' : '#ff8a5c';
    ctx.beginPath();
    ctx.moveTo(fx + 1, fy);
    ctx.lineTo(fx + 26, fy + 7);
    ctx.lineTo(fx + 1, fy + 15);
    ctx.closePath();
    ctx.fill();
    void pal;
  }

  /** 红热长坡提示箭头（诱惑设计：贪速路标） */
  drawDownhillHint(ctx: CanvasRenderingContext2D, terrain: Terrain, birdX: number): void {
    const t = terrain.nextDownhillAhead(birdX);
    if (t == null) return;
    const y = terrain.heightAt(t) - 60;
    ctx.strokeStyle = 'rgba(255,120,80,0.55)';
    ctx.lineWidth = 4;
    for (let i = 0; i < 3; i++) {
      const ox = t + i * 26;
      const oy = y + i * 6;
      ctx.beginPath();
      ctx.moveTo(ox - 10, oy - 8);
      ctx.lineTo(ox + 8, oy);
      ctx.lineTo(ox - 10, oy + 8);
      ctx.stroke();
    }
  }

  /** 里程路牌（每 250m）：大牌面 + 加粗距离数字；每 1000m 金牌庆祝。
   *  远景（zoom 小）时牌面相对放大（上限 2.6×）—— 任何缩放下数字都清晰可读。 */
  drawMilestones(ctx: CanvasRenderingContext2D, terrain: Terrain, cam: Camera, pal: SkyPalette): void {
    const [x0, x1] = cam.viewBounds();
    const stepM = 250;
    const i0 = Math.ceil(x0 / PX_PER_M / stepM);
    const i1 = Math.floor(x1 / PX_PER_M / stepM);
    const k = clamp(1.05 / cam.zoom, 1, 2.6); // 相对放大系数
    for (let i = Math.max(1, i0); i <= i1; i++) {
      const x = i * stepM * PX_PER_M;
      const km = i % 4 === 0; // 每 1000m 金牌
      const y = terrain.heightAt(x);
      const ang = terrain.tangentAngle(x);
      ctx.save();
      ctx.translate(x, y + 2);
      // 木柱
      ctx.fillStyle = km ? '#8a6a3a' : '#7c6650';
      ctx.strokeStyle = 'rgba(46,34,28,0.9)';
      ctx.lineWidth = 3;
      ctx.fillRect(-4 * k, -70 * k, 8 * k, 70 * k);
      ctx.strokeRect(-4 * k, -70 * k, 8 * k, 70 * k);
      // 牌面（随坡微倾，赛璐璐双色 + 粗描边）
      ctx.translate(0, -70 * k);
      ctx.rotate(clamp(ang, -0.15, 0.15) * 0.5);
      const bw = 118 * k;
      const bh = 54 * k;
      ctx.fillStyle = km ? '#e8b45a' : '#9c8266';
      ctx.beginPath();
      this.roundRectPath(ctx, -bw / 2, -bh, bw, bh, 8 * k);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = km ? '#c99647' : '#846952'; // 底部硬边暗带
      ctx.fillRect(-bw / 2, -14 * k, bw, 14 * k);
      ctx.restore();
      ctx.lineWidth = 3 * k;
      ctx.strokeStyle = 'rgba(46,34,28,0.95)';
      ctx.beginPath();
      this.roundRectPath(ctx, -bw / 2, -bh, bw, bh, 8 * k);
      ctx.stroke();
      // 距离数字（大、加粗）
      ctx.fillStyle = '#3c2a1e';
      ctx.font = `900 ${27 * k}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${i * stepM}m`, 0, -bh / 2 + 2 * k);
      // 金牌小火焰装饰
      if (km) {
        ctx.fillStyle = '#ff7043';
        ctx.beginPath();
        ctx.moveTo(bw / 2 - 16 * k, -bh + 8 * k);
        ctx.quadraticCurveTo(bw / 2 - 8 * k, -bh - 6 * k, bw / 2 - 14 * k, -bh - 14 * k);
        ctx.quadraticCurveTo(bw / 2 - 22 * k, -bh - 6 * k, bw / 2 - 16 * k, -bh + 8 * k);
        ctx.fill();
      }
      ctx.restore();
    }
    void pal;
  }

  /** 圆角矩形路径 */
  private roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /** 金币：不规则 12 边形金片 + 暗缘 + 高光刻痕（拒绝裸圆） */
  private drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, seed: number): void {
    const n = 12;
    const r = 13;
    const spin = Math.sin(time * 2.2 + seed * 0.13);
    const squash = 0.35 + Math.abs(spin) * 0.65; // 翻转感
    ctx.fillStyle = '#e0a93e';
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (1 + valueNoise(i % n + seed, 900) * 0.14);
      const px = x + Math.cos(a) * rr * squash;
      const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * 0.72 * (1 + valueNoise(i % n + seed + 3, 901) * 0.14);
      const px = x + Math.cos(a) * rr * squash;
      const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    // 高光刻痕
    ctx.strokeStyle = 'rgba(255,255,240,0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - 5 * squash, y - 5);
    ctx.lineTo(x - 1 * squash, y - 6);
    ctx.stroke();
  }
}
