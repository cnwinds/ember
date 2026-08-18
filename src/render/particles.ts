/**
 * ParticlePool —— 统一粒子系统。
 *
 * 尾焰、散热蒸汽、着陆蒸汽、雪雾、爆燃岩浆、金币火花共用一个池：
 *   - 预分配 + 槽位复用（零 GC 压力）
 *   - 尾焰活跃粒子硬上限 256，全池上限 900
 *   - 屏幕外（含边距）粒子不更新也不绘制
 *   - 密度系数由自适应降级（<55fps → ×0.7）缩放，绝不降物理步长
 * 尾焰三参数全部连续映射热度：颜色 = flameRamp(heat)，尺寸/寿命随速度，
 * 密度 40 度后随热度线性增加 —— 尾焰是活仪表盘。
 */

import { PARTICLES } from '../core/constants';
import { clamp, rampColor } from '../core/mathutil';
import { flameBucket } from './palette';

export type PKind = 'flame' | 'steam' | 'snow' | 'magma' | 'spark';

interface P {
  alive: boolean;
  kind: PKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size0: number;
  size1: number;
  /** 尾焰出生时的热度 0..1（决定颜色） */
  heat01: number;
  seed: number;
  grav: number;
  drag: number;
}

const MAX = PARTICLES.TOTAL_MAX;

/** 岩浆连续色阶（亮黄 → 橙红 → 深红），12 桶缓存避免字符串 churn */
const MAGMA_STOPS: Array<[number, number, number, number]> = [
  [0.0, 0xff, 0xca, 0x28],
  [0.4, 0xff, 0x70, 0x43],
  [1.0, 0xd8, 0x43, 0x15],
];
const MAGMA_BUCKETS = 12;
const magmaColors: string[] = [];
for (let i = 0; i < MAGMA_BUCKETS; i++) magmaColors.push(rampColor(MAGMA_STOPS, i / (MAGMA_BUCKETS - 1)));

export interface Ring {
  x: number;
  y: number;
  t: number;
  dur: number;
  r0: number;
  r1: number;
  color: string;
}

export class ParticlePool {
  private slots: P[] = [];
  private flameCount = 0;
  private rings: Ring[] = [];
  /** 密度缩放（自适应降级 ×0.7；Fever ×2 由调用方传入） */
  densityScale = 1;
  /** 视口剔除范围（渲染器每帧写入） */
  viewX0 = -1e9;
  viewX1 = 1e9;
  viewY0 = -1e9;
  viewY1 = 1e9;
  /** 累计发射数（调试） */
  spawned = 0;

  constructor() {
    for (let i = 0; i < MAX; i++) {
      this.slots.push({
        alive: false, kind: 'flame', x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1,
        size0: 4, size1: 0, heat01: 0, seed: 0, grav: 0, drag: 0,
      });
    }
  }

  private spawn(kind: PKind): P | null {
    const cap = kind === 'flame' ? PARTICLES.FLAME_MAX : MAX;
    const count = kind === 'flame' ? this.flameCount : this.countAlive();
    if (count >= cap) return null;
    // 复用第一个死亡槽（环形扫描游标避免每帧从 0 扫）
    for (let i = 0; i < MAX; i++) {
      const s = this.slots[(this.cursor + i) % MAX];
      if (!s.alive) {
        this.cursor = (this.cursor + i + 1) % MAX;
        s.alive = true;
        s.kind = kind;
        if (kind === 'flame') this.flameCount++;
        this.spawned++;
        return s;
      }
    }
    return null;
  }
  private cursor = 0;

  private countAlive(): number {
    let n = 0;
    for (const s of this.slots) if (s.alive) n++;
    return n;
  }

  get aliveCount(): number {
    return this.countAlive();
  }
  get flameAlive(): number {
    return this.flameCount;
  }

  /** 尾焰发射（帧驱动）：pos 尾根、dir 背向速度方向 */
  emitFlame(x: number, y: number, vx: number, vy: number, heat01: number, speed: number, fever: boolean, turbo: boolean, dt: number): void {
    // 密度：基础随速度，40 度后随热度线性增加；Fever ×2；自适应降级 ×0.7
    let rate = 26 + speed * 0.055 + Math.max(0, heat01 - 0.4) * 55;
    if (fever) rate *= 2;
    if (turbo) rate *= 1.5;
    rate *= this.densityScale;
    let n = rate * dt;
    let whole = Math.floor(n);
    if (Math.random() < n - whole) whole++;
    for (let i = 0; i < whole; i++) {
      const s = this.spawn('flame');
      if (!s) return;
      const back = 0.9 + Math.random() * 0.6;
      s.x = x + (Math.random() - 0.5) * 6;
      s.y = y + (Math.random() - 0.5) * 6;
      s.vx = -vx * 0.12 * back + (Math.random() - 0.5) * 40;
      s.vy = -vy * 0.12 * back + (Math.random() - 0.5) * 40 - 25;
      const lifeScale = turbo ? 1.8 : fever ? 1.35 : 1;
      s.maxLife = (0.32 + Math.random() * 0.3 + speed * 0.0002) * lifeScale;
      s.life = s.maxLife;
      s.size0 = (5 + Math.random() * 5 + heat01 * 4) * (turbo ? 1.5 : fever ? 1.2 : 1);
      s.size1 = 1;
      s.heat01 = fever || turbo ? 1 : heat01;
      s.grav = -60; // 热气上浮
      s.drag = 2.2;
      s.seed = Math.random();
    }
  }

  /** 散热蒸汽（滑翔态持续 + 着陆爆发） */
  emitSteam(x: number, y: number, n: number, power = 1): void {
    n = Math.round(n * this.densityScale);
    for (let i = 0; i < n; i++) {
      const s = this.spawn('steam');
      if (!s) return;
      s.x = x + (Math.random() - 0.5) * 18 * power;
      s.y = y + (Math.random() - 0.5) * 10;
      s.vx = (Math.random() - 0.5) * 60 * power;
      s.vy = -30 - Math.random() * 70 * power;
      s.maxLife = 0.5 + Math.random() * 0.5;
      s.life = s.maxLife;
      s.size0 = (6 + Math.random() * 7) * power;
      s.size1 = s.size0 * 2.4;
      s.grav = -40;
      s.drag = 1.6;
      s.seed = Math.random();
    }
  }

  /** 雪坡滑行雪雾（速度越快尾迹越长） */
  emitSnow(x: number, y: number, vx: number, n: number): void {
    n = Math.round(n * this.densityScale);
    for (let i = 0; i < n; i++) {
      const s = this.spawn('snow');
      if (!s) return;
      s.x = x + (Math.random() - 0.5) * 10;
      s.y = y - Math.random() * 4;
      s.vx = -vx * (0.08 + Math.random() * 0.16) + (Math.random() - 0.5) * 40;
      s.vy = -40 - Math.random() * 90;
      s.maxLife = 0.35 + Math.random() * 0.35;
      s.life = s.maxLife;
      s.size0 = 2.5 + Math.random() * 3.5;
      s.size1 = 1;
      s.grav = 260;
      s.drag = 1.2;
      s.seed = Math.random();
    }
  }

  /** 爆燃岩浆（翻滚拖尾 + 砸地爆发） */
  emitMagma(x: number, y: number, vx: number, vy: number, n: number, power = 1): void {
    n = Math.round(n * this.densityScale);
    for (let i = 0; i < n; i++) {
      const s = this.spawn('magma');
      if (!s) return;
      s.x = x + (Math.random() - 0.5) * 14;
      s.y = y + (Math.random() - 0.5) * 14;
      s.vx = -vx * 0.1 + (Math.random() - 0.5) * 220 * power;
      s.vy = -vy * 0.1 - Math.random() * 120 * power + (Math.random() - 0.5) * 80;
      s.maxLife = 0.5 + Math.random() * 0.7;
      s.life = s.maxLife;
      s.size0 = (3 + Math.random() * 5) * power;
      s.size1 = 1.5;
      s.grav = 420;
      s.drag = 0.8;
      s.seed = Math.random();
    }
  }

  /** 金币火花 */
  emitSpark(x: number, y: number, n = 8): void {
    for (let i = 0; i < n; i++) {
      const s = this.spawn('spark');
      if (!s) return;
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 160;
      s.x = x;
      s.y = y;
      s.vx = Math.cos(a) * sp;
      s.vy = Math.sin(a) * sp - 60;
      s.maxLife = 0.3 + Math.random() * 0.25;
      s.life = s.maxLife;
      s.size0 = 2.5 + Math.random() * 2;
      s.size1 = 0.5;
      s.grav = 300;
      s.drag = 1;
      s.seed = Math.random();
    }
  }

  /** 蒸汽圆环（完美着陆） */
  addRing(x: number, y: number, color: string): void {
    if (this.rings.length > 8) this.rings.shift();
    this.rings.push({ x, y, t: 0, dur: 0.45, r0: 12, r1: 90, color });
  }

  /** 更新（渲染帧 dt）。屏幕外粒子不更新。 */
  update(dt: number): void {
    const m = PARTICLES.CULL_MARGIN;
    for (const s of this.slots) {
      if (!s.alive) continue;
      if (s.x < this.viewX0 - m || s.x > this.viewX1 + m || s.y < this.viewY0 - m || s.y > this.viewY1 + m) {
        continue; // 屏外冻结（不更新不老化）
      }
      s.life -= dt;
      if (s.life <= 0) {
        s.alive = false;
        if (s.kind === 'flame') this.flameCount--;
        continue;
      }
      s.vy += s.grav * dt;
      const d = Math.exp(-s.drag * dt);
      s.vx *= d;
      s.vy *= d;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].t += dt;
      if (this.rings[i].t >= this.rings[i].dur) this.rings.splice(i, 1);
    }
  }

  /** 绘制（世界坐标系下调用；ctx 已被相机变换）。
   *  性能：按「颜色桶 × 透明度桶」分组批量绘制（每桶一次 fill），
   *  把最坏 ~900 次逐粒子 fill 压到 ~20 次；透明度量化 12 档视觉不可辨 */
  draw(ctx: CanvasRenderingContext2D): void {
    const m = PARTICLES.CULL_MARGIN;
    const AB = 12; // 透明度桶数
    // 分组桶（惰性创建；绘制后清空复用，零持续分配）
    const white: P[][] = [];
    const flame: P[][] = [];
    const magma: P[][] = [];
    const spark: P[][] = [];
    const alphaIdx = (a: number) => Math.max(0, Math.min(AB - 1, (a * AB) | 0));

    for (const s of this.slots) {
      if (!s.alive) continue;
      if (s.x < this.viewX0 - m || s.x > this.viewX1 + m) continue;
      const t = 1 - s.life / s.maxLife;
      let gi: number;
      if (s.kind === 'flame') {
        const heatT = clamp(s.heat01 * (1 - t * 0.25) + t * 0.35, 0, 1);
        const cb = Math.round(heatT * 23); // 与 flameBucket 相同的 24 档
        gi = cb * AB + alphaIdx(0.85 * (1 - t) * (1 - t));
        (flame[gi] ??= []).push(s);
      } else if (s.kind === 'magma') {
        const cb = Math.min(11, Math.round(t * 11));
        gi = cb * AB + alphaIdx(0.95 * (1 - t));
        (magma[gi] ??= []).push(s);
      } else if (s.kind === 'spark') {
        (spark[alphaIdx(1 - t)] ??= []).push(s);
      } else {
        // steam / snow：同为白色圆，合并按透明度分桶
        const a = s.kind === 'steam' ? 0.32 * (1 - t) : 0.5 * (1 - t);
        (white[alphaIdx(a)] ??= []).push(s);
      }
    }

    // ---- 批量绘制：每桶一次 beginPath + fill ----
    const drawCircles = (groups: P[][], colorOf: (gi: number) => string, radiusOf: (s: P, t: number) => number) => {
      for (let gi = 0; gi < groups.length; gi++) {
        const arr = groups[gi];
        if (arr === undefined) continue;
        ctx.fillStyle = colorOf(gi);
        ctx.globalAlpha = ((gi % AB) + 0.5) / AB;
        ctx.beginPath();
        for (const s of arr) {
          const t = 1 - s.life / s.maxLife;
          const r = radiusOf(s, t);
          ctx.moveTo(s.x + r, s.y);
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        }
        ctx.fill();
        arr.length = 0;
      }
    };

    // 白色（蒸汽 + 雪雾，最底）
    ctx.fillStyle = '#ffffff';
    drawCircles(white, () => '#ffffff', (s, t) =>
      s.kind === 'steam' ? s.size0 + (s.size1 - s.size0) * t : s.size0 * (1 - t * 0.5)
    );
    // 尾焰（分桶颜色，flameBucket 自带 24 档缓存）
    drawCircles(flame, (gi) => flameBucket(((gi / AB) | 0) / 23), (s, t) => s.size0 * (1 - t * 0.7) + s.size1);
    // 岩浆（连续色阶）
    drawCircles(magma, (gi) => magmaColors[(gi / AB) | 0], (s, t) => s.size0 * (1 - t * 0.6));
    // 火花（小十字，按透明度分桶批量 stroke）
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = 2;
    for (let gi = 0; gi < spark.length; gi++) {
      const arr = spark[gi];
      if (arr === undefined) continue;
      ctx.globalAlpha = (gi + 0.5) / AB;
      ctx.beginPath();
      for (const s of arr) {
        const t = 1 - s.life / s.maxLife;
        const r = s.size0 * (1 - t);
        ctx.moveTo(s.x - r, s.y);
        ctx.lineTo(s.x + r, s.y);
        ctx.moveTo(s.x, s.y - r);
        ctx.lineTo(s.x, s.y + r);
      }
      ctx.stroke();
      arr.length = 0;
    }
    // 圆环（完美着陆蒸汽环，数量极少，逐个绘制）
    ctx.lineWidth = 3;
    for (const ring of this.rings) {
      const t = ring.t / ring.dur;
      ctx.globalAlpha = 0.7 * (1 - t);
      ctx.strokeStyle = ring.color;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r0 + (ring.r1 - ring.r0) * t, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    for (const s of this.slots) s.alive = false;
    this.flameCount = 0;
    this.rings.length = 0;
  }
}
