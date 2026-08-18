/**
 * Terrain —— 种子化地形（LevelGen 的核心）。
 *
 * 设计要点：
 * - 控制点一维链：P[i] = (i·CP_W, y_i)，间距固定，y 由「带步长限幅的随机游走」生成 ——
 *   随机游走只依赖前一点，配合 Memo 缓存可惰性、确定性地求值任意区间（同种子 → 完全一致）。
 * - 高差限幅 |Δy| ≤ MAX_DELTA 保证坡度上限；「特征桶」哈希周期性注入长下坡（速度高速路）。
 * - 曲线用 Catmull-Rom（C1 连续），heightAt/slopeAt 任意 x 可查 —— 物理贴地滑行的地基。
 * - 材质：坡度超阈值 → 岩石（摩擦 +10%），否则雪坡（有雪雾尾迹）。
 * - 金币按 chunk 确定性撒放；巢穴位置按关卡距离解析求值，落巢区自动压平。
 */

import { TERRAIN_CP_W, TERRAIN_MAX_DELTA, TERRAIN_GRADIENT, LEVEL } from '../core/constants';
import { rand01, valueNoise } from '../core/rng';

export type GroundMaterial = 'snow' | 'rock';

export interface Coin {
  x: number;
  y: number;
  taken: boolean;
}

export interface NestInfo {
  /** 关卡号（1 起） */
  level: number;
  x: number;
}

export class Terrain {
  readonly seed: number;
  /** 控制点 y 缓存：index → y */
  private cp = new Map<number, number>();
  /** 规范锚点：所有 CP 从锚点出发顺序生成（正向/反向各一条链）→ 与查询顺序无关 */
  private static ANCHOR = -12;
  /** 金币 chunk 缓存 */
  private coinChunks = new Map<number, Coin[]>();
  /** 金币扁平窗口缓存（渲染/拾取用，按需重建） */
  private coinsWindow: Coin[] = [];
  private coinsWinMin = 0;
  private coinsWinMax = 0;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.cp.set(Terrain.ANCHOR, 0); // 锚点高度定义为 0
  }

  /* ---------------- 控制点（随机游走 + 限幅 + 特征桶） ---------------- */

  /** 计算控制点 i 的「原始期望增量」：随机 + 特征桶偏置。
   *  prevY：链上前一个控制点的真实高度 —— 回中项对真实高度做均值回复，
   *  否则特征桶的净下坡偏置会随里程累积成无界海拔漂移（远景层跟着漂移遮挡半屏的根因）。 */
  private rawDelta(i: number, prevY: number): number {
    // 随机成分 = 平滑低频起伏（波长 ~2900px）；难度越高越颠簸（幅度 0.5 → 0.7）
    const diff = this.difficultyAt(i * TERRAIN_CP_W);
    let d = valueNoise(i * 0.35, this.seed ^ 0xbeef) * TERRAIN_MAX_DELTA * (0.5 + 0.2 * diff);
    const megaIdx = Math.floor(i / 13);
    // 发射台唇沿后的第一个控制点强制陡降：无论下一个区域是什么形态，
    // 唇沿永远是一个锐利顶点（发射感的地形保证）
    const isPostCrest = megaIdx >= 1 && this.isMegaLauncher(megaIdx - 1) && i === megaIdx * 13;
    if (isPostCrest) {
      d += TERRAIN_MAX_DELTA * 0.95;
    } else if (this.isMegaLauncher(megaIdx)) {
      /* 云霄发射台（13 CP ≈ 3.4kpx 的专属山坳）：
       * mp 0-5   长直下坡攒速（深度 ~700px）
       * mp 6-8   谷底缓冲（衔接感）
       * mp 9-12  陡峭唇沿（每点 -1.08Δ，累计抬升 ~660px）
       * mp 12→13 交界即唇沿顶点：满速冲上 → 直飞云霄 */
      const mp = i - megaIdx * 13;
      if (mp <= 5) d += TERRAIN_MAX_DELTA * 0.7; // 谷壁 ~578px
      else if (mp <= 8) d += TERRAIN_MAX_DELTA * (0.3 - 0.18 * diff); // 谷底 0.3 → 0.12：越难越难保持速度
      else if (mp === 9) d -= TERRAIN_MAX_DELTA * 0.4; // 唇沿 ~454px，刻意矮于谷壁 ——
      else if (mp === 10) d -= TERRAIN_MAX_DELTA * 0.6; // 回摆能量必有净富余：误按也能一摆翻出
      else if (mp === 11) d -= TERRAIN_MAX_DELTA * 0.8;
      else d -= TERRAIN_MAX_DELTA * 0.95;
    } else {
      // 普通特征桶：比例随难度移动 —— 简单关「高速路+发射台」为主，难关「减速带」为主
      const bucket = Math.floor(i / 7);
      const b = rand01(bucket, this.seed ^ 0x9e37);
      const phase = i - bucket * 7;
      const hwyEnd = 0.38 - 0.22 * diff; // 高速路 38% → 16%
      const valEnd = hwyEnd + 0.14 - 0.04 * diff; // 大谷 14% → 10%
      const decEnd = valEnd + 0.08 + 0.32 * diff; // 减速带 8% → 40%
      if (b < hwyEnd) {
        // 高速路 + 发射台：4 点下压攒速，2 点陡抬唇沿，末点回弹
        d += phase < 4 ? TERRAIN_MAX_DELTA * 0.82 : phase < 6 ? -TERRAIN_MAX_DELTA * 1.05 : TERRAIN_MAX_DELTA * 0.55;
      } else if (b < valEnd) {
        // 大谷跳台（唇沿收敛到 2 CP × 0.85 —— 满速可翻越，失败则腾空跳过）
        d += phase < 3 ? TERRAIN_MAX_DELTA * 0.95 : phase < 5 ? -TERRAIN_MAX_DELTA * 0.85 : TERRAIN_MAX_DELTA * 0.5;
      } else if (b < decEnd) {
        // 长上坡减速带（散热窗口）：难度越高越陡（3 点 × 0.5 → 0.72）
        d += phase < 3 ? -TERRAIN_MAX_DELTA * (0.5 + 0.22 * diff) : TERRAIN_MAX_DELTA * 0.35;
      }
    }
    // （均值回复不放在这里：下坡 CP 会饱和在 ±165 钳制上，钳内回中力作用不到 —— 见 ensureCpForward）
    return d;
  }

  /** mega 桶（floor(i/13)）是否为云霄发射台（确定性；密度随关卡难度递减：
   *  第 1 天 45%（连飞天堂）→ 第 8 天+ 15%（起飞机会稀缺） */
  isMegaLauncher(megaIdx: number): boolean {
    const d = this.difficultyAt(megaIdx * 13 * TERRAIN_CP_W);
    return rand01(megaIdx, this.seed ^ 0xc10d) < 0.45 - 0.3 * d;
  }

  /** 难度 0..1：第 1 天 0 → 第 8 天 1（封顶）。由巢穴布局按里程确定性推导。
   *  简单 = 容易连续快速连飞（发射台多/缓坡/无阻速段）；难 = 速度易被阻断。 */
  difficultyAt(x: number): number {
    const bucket = Math.floor(x / 10000);
    const cached = this.diffCache.get(bucket);
    if (cached !== undefined) return cached;
    let cum = 0;
    let lvl = 1;
    while (cum <= x && lvl < 64) {
      cum += this.levelDist(lvl);
      if (cum > x) break;
      lvl++;
    }
    const d = Math.min(1, (lvl - 1) / 7);
    this.diffCache.set(bucket, d);
    return d;
  }
  private diffCache = new Map<number, number>();

  /** 控制点 y（惰性、确定性、与查询顺序无关：永远从锚点出发顺序生成） */
  cpY(i: number): number {
    const cached = this.cp.get(i);
    if (cached !== undefined) return cached;
    const A = Terrain.ANCHOR;
    if (i >= A) {
      for (let j = A; j <= i; j++) this.ensureCpForward(j);
    } else {
      for (let j = A - 1; j >= i; j--) this.ensureCpBackward(j);
    }
    return this.cp.get(i)!;
  }

  private ensureCpForward(i: number): void {
    if (this.cp.has(i)) return;
    const prevY = this.cp.get(i - 1)!; // 正向链：前一项必已生成
    let d = this.rawDelta(i, prevY);
    const flatten = this.nestFlattenFactor(i); // 巢穴区压平（着陆体验）
    d *= flatten;
    // 坡度限幅（特征形状）之后，向「全局下行趋势线」做均值回复（Tiny Wings 岛屿整体向前下坡：
    // 没有它，水平基线 = 平地死区，失速的鸟卡死谷底；趋势保证任何位置都在向前流）
    const trend = i * TERRAIN_CP_W * TERRAIN_GRADIENT;
    const y = prevY + Math.max(-TERRAIN_MAX_DELTA, Math.min(TERRAIN_MAX_DELTA, d)) - (prevY - trend) * 0.02 * flatten;
    this.cp.set(i, y);
  }

  /** 巢穴压平系数：巢前后 ±1.2 控制点内增量 ×0.06（着陆体验） */
  private nestFlattenFactor(i: number): number {
    for (let lvl = 1; lvl <= 32; lvl++) {
      const nx = this.nestX(lvl);
      const cpIdx = nx / TERRAIN_CP_W;
      if (Math.abs(cpIdx - i) <= 1.2) return 0.06;
      if (cpIdx > i + 40) break; // 巢在很前方，无需继续
    }
    return 1;
  }

  /** 锚点左侧（镜头左缘背景）：反向链，同样有界步长 + 趋势线回复 */
  private ensureCpBackward(i: number): void {
    if (this.cp.has(i)) return;
    const prevY = this.cp.get(i + 1)!;
    const d = this.rawDelta(50000 - i, prevY); // 独立哈希源
    const trend = i * TERRAIN_CP_W * TERRAIN_GRADIENT;
    const y = prevY - Math.max(-TERRAIN_MAX_DELTA, Math.min(TERRAIN_MAX_DELTA, d)) - (prevY - trend) * 0.02;
    this.cp.set(i, y);
  }

  /* ---------------- 高度 / 坡度查询（Catmull-Rom） ---------------- */

  /** 地表 y 坐标（y 向下为正；越小越高） */
  heightAt(x: number): number {
    const fi = x / TERRAIN_CP_W;
    const i = Math.floor(fi);
    const t = fi - i;
    const p0 = i === 0 ? 0 : this.cpY(i - 1);
    const p1 = this.cpY(i);
    const p2 = this.cpY(i + 1);
    const p3 = this.cpY(i + 2);
    // Catmull-Rom 切线
    const m1 = (p2 - p0) * 0.5;
    const m2 = (p3 - p1) * 0.5;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * p1 +
      (t3 - 2 * t2 + t) * m1 +
      (-2 * t3 + 3 * t2) * p2 +
      (t3 - t2) * m2
    );
  }

  /** 地表坡度 dy/dx（中心差分，足够光滑） */
  slopeAt(x: number): number {
    const h = 3;
    return (this.heightAt(x + h) - this.heightAt(x - h)) / (2 * h);
  }

  /** 坡面切线角（弧度，切向取 +x 方向；y 向下 → 下坡为正角） */
  tangentAngle(x: number): number {
    return Math.atan(this.slopeAt(x));
  }

  /** 材质：陡坡为岩石（难度越高岩石阈值越低 —— 摩擦区遍地） */
  materialAt(x: number): GroundMaterial {
    const th = Math.max(0.5, 0.95 - 0.4 * this.difficultyAt(x));
    return Math.abs(this.slopeAt(x)) > th ? 'rock' : 'snow';
  }

  /* ---------------- 金币（确定性撒放） ---------------- */

  private chunkCoins(ci: number): Coin[] {
    const cached = this.coinChunks.get(ci);
    if (cached) return cached;
    const out: Coin[] = [];

    // 云霄发射台专属引导：下坡速度线 + 唇沿攀升线 + 发射轨迹弧（起飞点一目了然）
    const megaIdx = Math.floor(ci / 13);
    if (this.isMegaLauncher(megaIdx)) {
      const mp = ci - megaIdx * 13;
      if (mp >= 1 && mp <= 5) {
        const x = (ci + 0.5) * TERRAIN_CP_W;
        out.push({ x, y: this.heightAt(x) - 34, taken: false });
      } else if (mp >= 10 && mp <= 12) {
        const x = (ci + 0.5) * TERRAIN_CP_W;
        out.push({ x, y: this.heightAt(x) - 34, taken: false });
      }
      if (mp === 12) {
        // 越过唇沿顶点后的发射抛物线（h = 2.0x' - 0.0015x'²，顶点 ~660px）
        const crestX = (megaIdx * 13 + 13) * TERRAIN_CP_W;
        const crestY = this.heightAt(crestX);
        for (const dx of [120, 300, 480, 660, 840]) {
          const h = 2.0 * dx - 0.0015 * dx * dx;
          out.push({ x: crestX + dx, y: crestY - 30 - h, taken: false });
        }
      }
      if (out.length > 0) {
        this.coinChunks.set(ci, out);
        return out;
      }
    }

    const h = rand01(ci, this.seed ^ 0xC0DE);
    if (h < 0.55) {
      const kind = rand01(ci, this.seed ^ 0xF00D);
      const n = 3 + Math.floor(rand01(ci, this.seed ^ 0x1234) * 4); // 3..6 枚
      if (kind < 0.5) {
        // 沿地表排布
        for (let k = 0; k < n; k++) {
          const x = (ci + (k + 1) / (n + 1)) * TERRAIN_CP_W;
          out.push({ x, y: this.heightAt(x) - 34, taken: false });
        }
      } else {
        // 谷上高弧线（大飞行的奖励线：沿抛物线顶点附近布币）
        const cx = (ci + 0.5) * TERRAIN_CP_W;
        for (let k = 0; k < n; k++) {
          const f = (k + 1) / (n + 1); // 0..1
          const x = cx + (f - 0.5) * TERRAIN_CP_W * 1.4;
          const arc = Math.sin(f * Math.PI) * 240;
          out.push({ x, y: this.heightAt(x) - 34 - arc, taken: false });
        }
      }
    }
    this.coinChunks.set(ci, out);
    return out;
  }

  /** 取 [x0,x1] 窗口内金币（缓存窗口，供模拟与渲染共用） */
  coinsInRange(x0: number, x1: number): readonly Coin[] {
    if (x0 < this.coinsWinMin || x1 > this.coinsWinMax) {
      const c0 = Math.floor(x0 / TERRAIN_CP_W) - 1;
      const c1 = Math.floor(x1 / TERRAIN_CP_W) + 1;
      const list: Coin[] = [];
      for (let ci = c0; ci <= c1; ci++) list.push(...this.chunkCoins(ci));
      this.coinsWindow = list;
      this.coinsWinMin = c0 * TERRAIN_CP_W;
      this.coinsWinMax = (c1 + 1) * TERRAIN_CP_W;
    }
    return this.coinsWindow;
  }

  /* ---------------- 巢穴（关卡节点） ---------------- */

  /** 第 level 关巢穴的世界 x（解析求值 → 确定性）。第 1 关巢穴在本关距离终点处。 */
  nestX(level: number): number {
    let x = 0;
    for (let l = 1; l <= level; l++) x += this.levelDist(l);
    return x;
  }

  levelDist(level: number): number {
    return Math.min(LEVEL.BASE_DIST + (level - 1) * LEVEL.PER_LEVEL, LEVEL.MAX_DIST);
  }

  /** 红热提示：找前方最近的长下坡起点（x 之后的下坡段中点） */
  nextDownhillAhead(x: number): number | null {
    for (let d = 0; d < 2600; d += 130) {
      const xx = x + d;
      if (this.slopeAt(xx) > 0.35 && this.slopeAt(xx + 130) > 0.2) return xx;
    }
    return null;
  }
}
