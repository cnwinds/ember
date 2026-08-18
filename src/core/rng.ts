/**
 * 确定性随机 —— 所有影响模拟的随机量必须走这里（回放一致性的前提）。
 * 渲染层专用随机（粒子散布等，不影响判定）可以用 Math.random。
 */

/** 32 位整数散列（murmur3 变体，无状态、可按索引惰性求值） */
export function hash32(n: number, seed = 0): number {
  let h = (n ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 按索引取 [0,1) 确定性伪随机 —— 地形/金币/抖动描边的基石 */
export function rand01(index: number, seed = 0): number {
  return hash32(index, seed) / 4294967296;
}

/** mulberry32 —— 顺序 PRNG，用于「一次生成、整段复用」的场景（如每日种子派生） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 平滑值噪声（整数格点 hash + smoothstep 插值），返回 [-1,1] */
export function valueNoise(x: number, seed = 0): number {
  const i = Math.floor(x);
  const t = x - i;
  const s = t * t * (3 - 2 * t);
  const a = rand01(i, seed);
  const b = rand01(i + 1, seed);
  return (a + (b - a) * s) * 2 - 1;
}

/** 一维抖动噪声（手绘描边用），返回 [-1,1]，随 boilTick 离散翻页形成「手绘沸腾」 */
export function jitterNoise(x: number, boilTick: number, seed = 0): number {
  return valueNoise(x * 1.7 + boilTick * 37.3, seed);
}

/** 每日挑战种子：YYYYMMDD → 整数 */
export function dailySeed(date = new Date()): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}
