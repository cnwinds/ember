/**
 * Palette —— 全游戏配色单一来源。
 *
 * 尾焰色阶（本作最重要的视觉语言）：
 *   蓝 #4FC3F7 → 黄 #FFD54F → 红 #FF5252 → 白 #FFFFFF，随热度连续 lerp，禁止阶跃。
 *   HUD 热度条与尾焰粒子共用同一 ramp —— 玩家用余光读热度。
 *
 * 手绘绘本画风（Tiny Wings 式）：无描边、柔和渐变天空、丘陵沿水平方向
 * 以 hillA/hillB/hillC 三色平滑循环（条纹彩色山丘）。昼夜随 dayProgress
 * （0 清晨 → 1 日落）连续插值；最后 15 秒（p≈0.8+）进入深红危机阶段。
 */

import { rampColor, lerp, hexToRgb, rgba } from '../core/mathutil';

/* ---------------- 尾焰色阶 ---------------- */

export const FLAME_STOPS: Array<[number, number, number, number]> = [
  [0.0, 0x4f, 0xc3, 0xf7],
  [0.33, 0xff, 0xd5, 0x4f],
  [0.66, 0xff, 0x52, 0x52],
  [1.0, 0xff, 0xff, 0xff],
];

/** 热度 0..1 → 连续色（无阶跃） */
export function flameColor(t: number): string {
  return rampColor(FLAME_STOPS, Math.max(0, Math.min(1, t)));
}

/** 量化色桶缓存（粒子批量绘制用，避免每粒子字符串拼接） */
const FLAME_BUCKETS = 24;
const flameBucketCache: string[] = [];
for (let i = 0; i < FLAME_BUCKETS; i++) flameBucketCache.push(rampColor(FLAME_STOPS, i / (FLAME_BUCKETS - 1)));
export function flameBucket(t: number): string {
  const i = Math.max(0, Math.min(FLAME_BUCKETS - 1, Math.round(t * (FLAME_BUCKETS - 1))));
  return flameBucketCache[i];
}

/* ---------------- 昼夜关键帧 ---------------- */

export interface SkyKey {
  p: number;
  top: string;
  mid: string;
  horizon: string;
  sun: string;
  sunRim: string;
  ridgeFar: string;
  ridgeMid: string;
  snow: string;
  snowShade: string;
  /** 丘陵渐变暗部（无描边时代的「底纵深」色） */
  snowDeep: string;
  /** 丘陵轮廓条纹三色组（沿地表平行展开，色序随世界 x 轮转） */
  hillA: string;
  hillB: string;
  hillC: string;
  rock: string;
  rockShade: string;
  fg: string;
  cloud: string;
  cloudShade: string;
}

const KEYS: SkyKey[] = [
  {
    p: 0,
    top: '#5eb8e8', mid: '#b8dce8', horizon: '#ffe7b0', sun: '#fff8e0', sunRim: '#ffd88a',
    ridgeFar: '#9ec4d8', ridgeMid: '#7aa4c4', snow: '#f7f0e4', snowShade: '#e7d8c4', snowDeep: '#b8a488',
    hillA: '#e8d8b8', hillB: '#dcc8a0', hillC: '#e4d0a8',
    rock: '#93826f', rockShade: '#74655a', fg: '#e8d9c8', cloud: '#fff6ea', cloudShade: '#eeddc8',
  },
  {
    p: 0.45,
    top: '#6a98d0', mid: '#c8d8a8', horizon: '#ffd090', sun: '#ffe8b0', sunRim: '#ffc878',
    ridgeFar: '#98b0d0', ridgeMid: '#7e96bc', snow: '#f6ecdd', snowShade: '#e2cfb8', snowDeep: '#b39a82',
    hillA: '#e0d0a8', hillB: '#d0bc90', hillC: '#dcc898',
    rock: '#8e7c6a', rockShade: '#6f6055', fg: '#e4d2c0', cloud: '#ffefdd', cloudShade: '#ecd7c0',
  },
  {
    p: 0.72,
    top: '#5a6cb0', mid: '#e898c8', horizon: '#ff9458', sun: '#ffd090', sunRim: '#ff8e5c',
    ridgeFar: '#b0b8b8', ridgeMid: '#8868a0', snow: '#f4e4ce', snowShade: '#dcc2a6', snowDeep: '#a98e74',
    hillA: '#d8b888', hillB: '#cba070', hillC: '#d0a878',
    rock: '#87745f', rockShade: '#685a4c', fg: '#d9bfae', cloud: '#ffd9c0', cloudShade: '#e5bfa4',
  },
  {
    p: 0.88,
    top: '#3e3a6e', mid: '#d060a8', horizon: '#e03828', sun: '#ff8a58', sunRim: '#ff8040',
    ridgeFar: '#5858b8', ridgeMid: '#484878', snow: '#e8d2be', snowShade: '#c4a38c', snowDeep: '#886a56',
    hillA: '#c89870', hillB: '#b07858', hillC: '#c08860',
    rock: '#7d6a58', rockShade: '#5f5245', fg: '#c6a392', cloud: '#e8b09a', cloudShade: '#c68d7a',
  },
  {
    p: 1,
    top: '#2a1e40', mid: '#6e3048', horizon: '#8e2438', sun: '#d05040', sunRim: '#a83b38',
    ridgeFar: '#403c60', ridgeMid: '#343050', snow: '#d8c2b2', snowShade: '#b09284', snowDeep: '#785c50',
    hillA: '#a87868', hillB: '#906058', hillC: '#a07068',
    rock: '#6e5d50', rockShade: '#524639', fg: '#b0918a', cloud: '#b98a8a', cloudShade: '#9a6a6e',
  },
];

export interface SkyPalette extends Omit<SkyKey, 'p'> {
  /** 鸟剪影对比度（黄昏增强） */
  silhouette: number;
}

const cached: SkyPalette[] = [];

function mixKey(a: SkyKey, b: SkyKey, t: number): SkyPalette {
  const mix = (h1: string, h2: string) => {
    const c1 = hexToRgb(h1);
    const c2 = hexToRgb(h2);
    return `${Math.round(lerp(c1[0], c2[0], t))},${Math.round(lerp(c1[1], c2[1], t))},${Math.round(lerp(c1[2], c2[2], t))}`;
  };
  return {
    top: mix(a.top, b.top),
    mid: mix(a.mid, b.mid),
    horizon: mix(a.horizon, b.horizon),
    sun: mix(a.sun, b.sun),
    sunRim: mix(a.sunRim, b.sunRim),
    ridgeFar: mix(a.ridgeFar, b.ridgeFar),
    ridgeMid: mix(a.ridgeMid, b.ridgeMid),
    snow: mix(a.snow, b.snow),
    snowShade: mix(a.snowShade, b.snowShade),
    snowDeep: mix(a.snowDeep, b.snowDeep),
    hillA: mix(a.hillA, b.hillA),
    hillB: mix(a.hillB, b.hillB),
    hillC: mix(a.hillC, b.hillC),
    rock: mix(a.rock, b.rock),
    rockShade: mix(a.rockShade, b.rockShade),
    fg: mix(a.fg, b.fg),
    cloud: mix(a.cloud, b.cloud),
    cloudShade: mix(a.cloudShade, b.cloudShade),
    silhouette: lerp(a.p, b.p, t) > 0.8 ? Math.min(1, (lerp(a.p, b.p, t) - 0.8) * 4) : 0,
  };
}

/** dayProgress → 全套调色板（结果缓存为 101 档，避免每帧字符串插值） */
export function skyAt(dayProgress: number): SkyPalette {
  const p = Math.max(0, Math.min(1, dayProgress));
  const idx = Math.round(p * 100);
  if (cached[idx]) return cached[idx];
  let out: SkyPalette;
  if (idx === 0) out = mixKey(KEYS[0], KEYS[0], 0);
  else {
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].p < p) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = Math.max(0, Math.min(1, (p - a.p) / (b.p - a.p)));
    out = mixKey(a, b, t);
  }
  cached[idx] = out;
  return out;
}

const withACache = new Map<string, string>();
/** rgb 三元组字符串 → rgba(...,a)（透明度量化 24 档 + memo：调色板按 101 档缓变，命中率极高） */
export function withA(rgb: string, a: number): string {
  const q = Math.max(0, Math.min(1, a));
  const key = `${rgb}|${Math.round(q * 24)}`;
  let s = withACache.get(key);
  if (s === undefined) {
    s = `rgba(${rgb},${(q).toFixed(3)})`;
    if (withACache.size > 512) withACache.clear();
    withACache.set(key, s);
  }
  return s;
}

/** 明暗派生（柔和渐变的色标来源）：对 'r,g,b' 或 'rgb(r,g,b)' 字符串做明暗（k<1 压暗 / k>1 提亮） */
export function shadeRGB(rgb: string, k: number): string {
  const m = rgb.replace('rgb(', '').replace(')', '');
  const [r, g, b] = m.split(',').map(Number);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/* ---------------- 关卡主题（每关一个名字 + 一套调色盘分级） ---------------- */

export interface ThemeDef {
  /** 关卡名（HUD 展示） */
  name: string;
  /** 整体混合强度 0..1（1 = 完全替换基础色） */
  strength: number;
  /** 各通道目标色（hex），未列出的通道保持基础昼夜色 */
  fields: Partial<Record<keyof SkyPalette, string>>;
}

export const THEMES: ThemeDef[] = [
  {
    name: '晨曦草原', strength: 0.62,
    fields: { horizon: '#ffd9a0', ridgeFar: '#88b8a0', ridgeMid: '#689888', snow: '#f3f0e2', snowShade: '#dfd2c0', snowDeep: '#b0a080', hillA: '#5cb86a', hillB: '#c8dc58', hillC: '#3ca890', rock: '#7a8670', cloud: '#f8f4e8' },
  },
  {
    name: '金穗丘陵', strength: 0.68,
    fields: { horizon: '#ffc45c', ridgeFar: '#d0b870', ridgeMid: '#b09848', snow: '#f6ecd2', snowShade: '#e2d0a8', snowDeep: '#c0a878', cloud: '#fff2d8', hillA: '#e8b83c', hillB: '#d09028', hillC: '#f0d868', rock: '#a8906c' },
  },
  {
    name: '珊瑚沙谷', strength: 0.65,
    fields: { horizon: '#ff9e88', ridgeFar: '#d89890', ridgeMid: '#b87880', snow: '#f5e6e0', snowShade: '#e0c8c2', snowDeep: '#c09888', hillA: '#f08068', hillB: '#e05858', hillC: '#f4b088', rock: '#b88870', cloud: '#fff0e8' },
  },
  {
    name: '翠风峡湾', strength: 0.68,
    fields: { top: '#78c0b8', mid: '#bfe0d2', horizon: '#e8e0b0', ridgeFar: '#70b0a0', ridgeMid: '#50907e', snow: '#eef5ea', snowShade: '#d5e2d4', snowDeep: '#a8c8a8', hillA: '#40b878', hillB: '#2e9070', hillC: '#88d070', rock: '#607860', cloud: '#f0f8f0' },
  },
  {
    name: '赤岩火山', strength: 0.72,
    fields: { horizon: '#ff8a40', ridgeFar: '#c08880', ridgeMid: '#986060', snow: '#f0dcc8', snowShade: '#d4b49a', snowDeep: '#a0785c', hillA: '#e06830', hillB: '#b84828', hillC: '#f09050', rock: '#906048', rockShade: '#684030', cloud: '#ffe0c8' },
  },
  {
    name: '薄暮紫原', strength: 0.70,
    fields: { top: '#9080c0', mid: '#c8a8d8', horizon: '#e890b0', ridgeFar: '#9080b0', ridgeMid: '#705888', snow: '#ece6f0', snowShade: '#d2c8dc', snowDeep: '#b0a0c8', hillA: '#a070c8', hillB: '#8050a8', hillC: '#c898d8', rock: '#886890', cloud: '#f4f0f8' },
  },
  {
    name: '极夜冰原', strength: 0.68,
    fields: { top: '#a0c0e0', mid: '#d8e8f0', horizon: '#e8e0e8', ridgeFar: '#b0c8e0', ridgeMid: '#88a8c8', snow: '#f0f6fa', snowShade: '#d8e4ee', snowDeep: '#c0d8e8', hillA: '#a8c8e0', hillB: '#7898b8', hillC: '#d0e4f0', rock: '#8898a8', cloud: '#f8fcff' },
  },
  {
    name: '星海之巅', strength: 0.75,
    fields: { top: '#5858a0', mid: '#8878b0', horizon: '#b06878', ridgeFar: '#686890', ridgeMid: '#505078', snow: '#dcd8e8', snowShade: '#c0bcd4', snowDeep: '#9890b0', hillA: '#6868b0', hillB: '#484890', hillC: '#8880c0', rock: '#605878', cloud: '#e8e0f0' },
  },
];

/** 关卡 → 主题（循环；难度第 8 天封顶后视觉按 8 关轮换） */
export function themeForLevel(level: number): ThemeDef {
  return THEMES[(Math.max(1, level) - 1) % THEMES.length];
}

function mixRgbStr(a: string, b: string, t: number): string {
  const pa = a.split(',').map(Number);
  const pb = b.split(',').map(Number);
  return `${Math.round(pa[0] + (pb[0] - pa[0]) * t)},${Math.round(pa[1] + (pb[1] - pa[1]) * t)},${Math.round(pa[2] + (pb[2] - pa[2]) * t)}`;
}

/** 将主题色分级应用到一个调色板（原地修改；k 为主题权重 0..1）。
 *  hillA/B/C（山丘条纹主色）用更高强度 —— Tiny Wings 式山丘需要高饱和度，
 *  若按普通强度与基础米色混合会褪成淡彩色。 */
export function applyTheme(pal: SkyPalette, theme: ThemeDef, k: number): void {
  if (k <= 0) return;
  const eff = theme.strength * k;
  for (const key of Object.keys(theme.fields) as Array<keyof SkyPalette>) {
    const hex = theme.fields[key as keyof typeof theme.fields];
    if (typeof hex !== 'string' || typeof pal[key] !== 'string') continue;
    const w = key === 'hillA' || key === 'hillB' || key === 'hillC' ? Math.min(1, eff + 0.42) : eff;
    (pal as unknown as Record<string, string>)[key] = mixRgbStr(pal[key] as string, hexToRgb(hex).join(','), w);
  }
}

export { rgba };
