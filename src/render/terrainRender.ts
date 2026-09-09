/**
 * TerrainRender —— 手绘绘本地形渲染（世界坐标系，相机已应用）。
 *
 * - 一关一套色：轮廓条纹（A/B/C 沿坡向下循环）整关固定，换关随主题整套更替；地表下白渐变受光唇边
 * - 背阴坡柔影：暗色多层叠描边近似渐变，深度随太阳高度变化（太阳越低影越长）
 * - 全程无描边；岩石坡保留扁平色块（绘本平色点缀）
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
  /** 底纵深渐变缓存（颜色+量化坐标键，坐标 8px 量化视觉不可辨） */
  private depthGrad: CanvasGradient | null = null;
  private depthGradKey = '';
  /** 植被色阶缓存：调色板对象在 themeCache 内按档稳定，WeakMap 命中率极高 */
  private scenCache = new WeakMap<SkyPalette, Record<string, string>>();

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
    fever: boolean,
    themeIdx = 0
  ): void {
    const [x0, x1] = cam.viewBounds();
    const step = 16 / cam.zoom; // 屏幕上约 16px 一段（山体平滑，16px 足够）
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

    // 柔影深度（太阳越低越长）—— 决定背阴坡暗色层的宽度
    const shadeDepth = 14 + dayProgress * 30;

    // ---- 手绘抖动（裁剪路径与地表描边共用，确定性噪声 ≤1.5px） ----
    const js: number[] = [];
    for (let i = 0; i < n; i++) js.push(valueNoise(xs[i] * 0.05, 600) * 1.2);
    const surfPath = new Path2D();
    for (let i = 0; i < n; i++) {
      if (i === 0) surfPath.moveTo(xs[i] + js[i], ys[i] + js[i]);
      else surfPath.lineTo(xs[i] + js[i], ys[i] + js[i]);
    }
    surfPath.lineTo(x1, bottom + 80);
    surfPath.lineTo(x0, bottom + 80);
    surfPath.closePath();

    // ---- 绘本轮廓条纹 + 底纵深 + 受光/背阴柔影（全部裁剪进地形内，无描边） ----
    ctx.save();
    ctx.clip(surfPath);

    let yMin = ys[0];
    for (let i = 1; i < n; i++) if (ys[i] < yMin) yMin = ys[i];

    // 一关一套色：轮廓条纹色带沿地表平行展开（等高线感），整关内颜色固定
    // （山坡向下 A→B→C 逐层循环、沿 x 不变）—— 换关时整套配色随主题更替
    const cols = [`rgb(${pal.hillA})`, `rgb(${pal.hillB})`, `rgb(${pal.hillC})`];
    const BAND = 62; // 条纹厚度（世界像素）
    const bandCount = Math.min(16, Math.ceil((bottom + 80 - yMin) / BAND));
    for (let k = 0; k < bandCount; k++) {
      ctx.fillStyle = cols[k % 3];
      const top = k * BAND;
      const bot = (k + 1) * BAND + 1; // +1 与下一带搭接防缝
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (i === 0) ctx.moveTo(xs[i], ys[i] + top);
        else ctx.lineTo(xs[i], ys[i] + top);
      }
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(xs[i], ys[i] + bot);
      ctx.closePath();
      ctx.fill();
    }

    // 底纵深：向屏幕底渐入 snowDeep（丘陵向下的空气感；渐变按量化坐标缓存）
    const yMinQ = Math.round(yMin / 8) * 8;
    const bottomQ = Math.round(bottom / 8) * 8;
    const depthKey = `${pal.snowDeep}|${yMinQ}|${bottomQ}`;
    if (depthKey !== this.depthGradKey || !this.depthGrad) {
      const g = ctx.createLinearGradient(0, yMinQ, 0, bottomQ + 80);
      g.addColorStop(0, withA(pal.snowDeep, 0));
      g.addColorStop(1, withA(pal.snowDeep, 0.38));
      this.depthGrad = g;
      this.depthGradKey = depthKey;
    }
    ctx.fillStyle = this.depthGrad;
    ctx.fillRect(x0 - 4, yMin - 4, x1 - x0 + 8, bottom + 90 - yMin);

    // 受光/背阴柔影：按坡度把地表切成向阳/背阴段，分别叠多层半透明描边（近似渐变）
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const lipLayers = [
      { w: 14, off: 7, a: 0.10 },
      { w: 6, off: 3, a: 0.12 },
    ];
    const shadeLayers = [
      { w: shadeDepth, off: shadeDepth * 0.45, a: 0.16 },
      { w: shadeDepth * 0.4, off: shadeDepth * 0.15, a: 0.13 },
    ];
    const slopeAt = (i: number) =>
      (ys[Math.min(i + 1, n - 1)] - ys[Math.max(i - 1, 0)]) /
      (xs[Math.min(i + 1, n - 1)] - xs[Math.max(i - 1, 0)] || 1);
    let segStart = 0;
    for (let i = 1; i <= n; i++) {
      const curShady = i < n ? slopeAt(i) < -0.16 : null;
      const prevShady = slopeAt(i - 1) < -0.16;
      if (i < n && curShady === prevShady) continue;
      // 段落 [segStart, i-1] 结束：向阳段画受光唇边，背阴段画暗影
      const shady = prevShady;
      for (const L of shady ? shadeLayers : lipLayers) {
        ctx.strokeStyle = shady ? withA(pal.snowShade, L.a) : `rgba(255,250,235,${L.a})`;
        ctx.lineWidth = L.w;
        ctx.beginPath();
        for (let k = segStart; k <= i - 1 && k < n; k++) {
          const px = xs[k] + js[k];
          const py = ys[k] + js[k] + L.off;
          if (k === segStart) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      segStart = i;
    }

    ctx.restore();

    // ---- 岩石色块（陡坡，绘本扁平平色点缀） ----
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

    // ---- 赛璐璐植被（松/圆树/灌木/草丛，确定性散布 + 风摆） ----
    this.drawScenery(ctx, terrain, cam, pal, time, themeIdx);

    // ---- 焦痕（径向渐变软化边缘） ----
    for (const s of this.scorches) {
      const fade = clamp(1 - s.age / 30, 0.15, 1);
      const g = ctx.createRadialGradient(s.x, s.y - 3, 4, s.x, s.y - 3, 60);
      g.addColorStop(0, withA('44,32,28', 0.55 * fade));
      g.addColorStop(1, withA('44,32,28', 0));
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(s.x, s.y - 3);
      ctx.rotate(terrain.tangentAngle(s.x));
      ctx.scale(1, 0.24);
      ctx.beginPath();
      ctx.arc(0, 0, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
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

  /** 绘本植被：可玩地形上的松树/圆树/灌木/草丛，每主题有特色剪影语言。
   *  确定性散布（hash 网格）、陡坡不长树、黄昏随天色调暖、微风摆动、无描边无硬边暗面。
   *  颜色每次绘制只构建一次（每树每帧拼字符串会造成 GC 卡顿）。 */
  drawScenery(ctx: CanvasRenderingContext2D, terrain: Terrain, cam: Camera, pal: SkyPalette, time: number, themeIdx = 0): void {
    const [x0, x1] = cam.viewBounds();
    // 植被色阶按调色板对象缓存（每帧只取引用；重建仅发生在昼夜档/主题变化时）
    let C = this.scenCache.get(pal);
    if (!C) {
      // 黄昏混色：植被随天色注入地平线暖调（整体调色板一致性）
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
      C = {
        trunk: build(TRUNK, 0.4),
        pine0: build(PINE, 0),
        pine1: build(PINE, 0.08),
        pine2: build(PINE, 0.16),
        pineShade: build(PINE, 0.75),
        round0: build(ROUND, 0),
        roundShade: build(ROUND, 0.7),
        bush0: build(ROUND, 0.1),
        grass: build(PINE, -0.1),
        rockDark: build('90,76,68', 0.6),
        rockLight: build('120,98,84', 0.2),
      };
      this.scenCache.set(pal, C);
    }

    // 主题道具配置：0=晨曦草原 1=金穗丘陵 2=珊瑚沙谷 3=翠风峡湾 4=赤岩火山 5=薄暮紫原 6=极夜冰原 7=星海之巅
    const theme = themeIdx % 8;

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

      // 主题 4 火山：增加尖锐岩石剪影
      if (theme === 4 && type < 0.28) {
        const h = (32 + rand01(gx, 777006) * 24) * s;
        ctx.fillStyle = C.rockDark;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-7 * s, 0);
        ctx.lineTo(-4 * s, -h * 0.6);
        ctx.lineTo(-2 * s, -h * 0.85);
        ctx.lineTo(0, -h);
        ctx.lineTo(2 * s, -h * 0.78);
        ctx.lineTo(5 * s, -h * 0.52);
        ctx.lineTo(8 * s, 0);
        ctx.closePath();
        ctx.fill();
        // 受光面
        ctx.fillStyle = C.rockLight;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -h);
        ctx.lineTo(2 * s, -h * 0.78);
        ctx.lineTo(5 * s, -h * 0.52);
        ctx.lineTo(8 * s, 0);
        ctx.closePath();
        ctx.fill();
      } else if (type < 0.42) {
        // 松树：三层近似色阶三角（远暗近亮）+ 树干，无暗面切分
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
        }
      } else if (type < 0.78) {
        // 圆树：干 + 圆冠（底部柔渐变暗影）
        ctx.fillStyle = C.trunk;
        ctx.fillRect(-2.5 * s, -16 * s, 5 * s, 17 * s);
        const r = 14 * s;
        ctx.fillStyle = C.round0;
        ctx.beginPath();
        ctx.arc(0, -26 * s, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, -26 * s, r, 0, Math.PI * 2);
        ctx.clip();
        const crownGrad = ctx.createLinearGradient(0, -34 * s, 0, -12 * s);
        crownGrad.addColorStop(0, 'rgba(0,0,0,0)');
        crownGrad.addColorStop(1, C.roundShade);
        ctx.fillStyle = crownGrad;
        ctx.fillRect(-r, -26 * s - r, r * 2, r * 2);
        ctx.restore();
      } else {
        // 灌木：双圆 + 下侧深色椭圆（无裁剪硬带）
        ctx.fillStyle = C.bush0;
        ctx.beginPath();
        ctx.arc(-5 * s, -6 * s, 8 * s, 0, Math.PI * 2);
        ctx.arc(6 * s, -5 * s, 6.5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.pineShade;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.ellipse(0, -2 * s, 10 * s, 5 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
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
      // 木柱（扁平色，无描边）
      ctx.fillStyle = km ? '#8a6a3a' : '#7c6650';
      ctx.fillRect(-4 * k, -70 * k, 8 * k, 70 * k);
      // 牌面（随坡微倾，绘本扁平双色 + 柔和纵向渐变）
      ctx.translate(0, -70 * k);
      ctx.rotate(clamp(ang, -0.15, 0.15) * 0.5);
      const bw = 118 * k;
      const bh = 54 * k;
      const boardLight = km ? '#eec26a' : '#a88c6e';
      const boardDark = km ? '#cf9c48' : '#8a7058';
      const boardGrad = ctx.createLinearGradient(0, -bh, 0, 0);
      boardGrad.addColorStop(0, boardLight);
      boardGrad.addColorStop(1, boardDark);
      ctx.fillStyle = boardGrad;
      ctx.beginPath();
      this.roundRectPath(ctx, -bw / 2, -bh, bw, bh, 8 * k);
      ctx.fill();
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

  /** 金币：预渲染 4 种手绘 12 边形变体精灵（2× 分辨率），翻转用宽度缩放 ——
   *  免去每币每帧的两组多边形路径 + 噪声求值 */
  private coinSprites: HTMLCanvasElement[] | null = null;

  private ensureCoinSprites(): void {
    if (this.coinSprites) return;
    const RES = 2;
    const R = 13;
    this.coinSprites = [];
    for (let v = 0; v < 4; v++) {
      const cv = document.createElement('canvas');
      cv.width = 34 * RES;
      cv.height = 34 * RES;
      const c2 = cv.getContext('2d')!;
      c2.scale(RES, RES);
      c2.translate(17, 17);
      const n = 12;
      const tracePoly = (r: number, noiseSeed: number) => {
        c2.beginPath();
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          const rr = r * (1 + valueNoise((i % n) + v * 31 + noiseSeed, 900) * 0.14);
          const px = Math.cos(a) * rr;
          const py = Math.sin(a) * rr;
          if (i === 0) c2.moveTo(px, py);
          else c2.lineTo(px, py);
        }
        c2.closePath();
      };
      c2.fillStyle = '#e0a93e';
      tracePoly(R, 0);
      c2.fill();
      c2.fillStyle = '#ffd54f';
      tracePoly(R * 0.72, 3);
      c2.fill();
      // 高光小点（绘本式柔点）
      c2.fillStyle = 'rgba(255,255,244,0.75)';
      c2.beginPath();
      c2.arc(-4, -5, 2.4, 0, Math.PI * 2);
      c2.fill();
      this.coinSprites.push(cv);
    }
  }

  private drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, seed: number): void {
    this.ensureCoinSprites();
    const spin = Math.sin(time * 2.2 + seed * 0.13);
    const squash = 0.35 + Math.abs(spin) * 0.65; // 翻转感
    const spr = this.coinSprites![Math.floor(seed * 0.137) & 3];
    ctx.drawImage(spr, x - 17 * squash, y - 17, 34 * squash, 34);
  }
}
