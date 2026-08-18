/**
 * Palette —— 全游戏配色单一来源。
 *
 * 尾焰色阶（本作最重要的视觉语言）：
 *   蓝 #4FC3F7 → 黄 #FFD54F → 红 #FF5252 → 白 #FFFFFF，随热度连续 lerp，禁止阶跃。
 *   HUD 热度条与尾焰粒子共用同一 ramp —— 玩家用余光读热度。
 *
 * 天空采用 Alto's Odyssey 式「暖到冷」分层，随 dayProgress（0 清晨 → 1 日落）连续插值；
 * 最后 15 秒（p≈0.8+）进入深红危机阶段。
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
  snowOutline: string;
  rock: string;
  rockShade: string;
  fg: string;
  cloud: string;
  cloudShade: string;
}

const KEYS: SkyKey[] = [
  {
    p: 0,
    top: '#7ec9ea', mid: '#bfe3ef', horizon: '#ffe9c0', sun: '#fff6d8', sunRim: '#ffdf9e',
    ridgeFar: '#b9d3e4', ridgeMid: '#93b7d6', snow: '#f7f0e4', snowShade: '#e7d8c4', snowOutline: '#cdb9a2',
    rock: '#93826f', rockShade: '#74655a', fg: '#e8d9c8', cloud: '#fff6ea', cloudShade: '#eeddc8',
  },
  {
    p: 0.45,
    top: '#7fa9d6', mid: '#d3dcc2', horizon: '#ffd9a0', sun: '#ffe9b8', sunRim: '#ffc98a',
    ridgeFar: '#a9beda', ridgeMid: '#8fa8ce', snow: '#f6ecdd', snowShade: '#e2cfb8', snowOutline: '#c9b099',
    rock: '#8e7c6a', rockShade: '#6f6055', fg: '#e4d2c0', cloud: '#ffefdd', cloudShade: '#ecd7c0',
  },
  {
    p: 0.72,
    top: '#6d7fbe', mid: '#e9a97c', horizon: '#ffad6e', sun: '#ffd9a0', sunRim: '#ff9e6e',
    ridgeFar: '#9398c4', ridgeMid: '#7a7cb2', snow: '#f4e4ce', snowShade: '#dcc2a6', snowOutline: '#bfa184',
    rock: '#87745f', rockShade: '#685a4c', fg: '#d9bfae', cloud: '#ffd9c0', cloudShade: '#e5bfa4',
  },
  {
    p: 0.88,
    top: '#4e4a82', mid: '#d97c63', horizon: '#e8543f', sun: '#ff9e6e', sunRim: '#ff7a54',
    ridgeFar: '#6f6d9e', ridgeMid: '#5c5a8e', snow: '#e8d2be', snowShade: '#c4a38c', snowOutline: '#9c7a62',
    rock: '#7d6a58', rockShade: '#5f5245', fg: '#c6a392', cloud: '#e8b09a', cloudShade: '#c68d7a',
  },
  {
    p: 1,
    top: '#3a2c55', mid: '#8e4257', horizon: '#b03a48', sun: '#e86a54', sunRim: '#c84a44',
    ridgeFar: '#565178', ridgeMid: '#494568', snow: '#d8c2b2', snowShade: '#b09284', snowOutline: '#8a6a5c',
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
    snowOutline: mix(a.snowOutline, b.snowOutline),
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

/** rgb 三元组字符串 → rgba(...,a) */
export function withA(rgb: string, a: number): string {
  return `rgba(${rgb},${a.toFixed(3)})`;
}

/** 赛璐璐调色：对 'r,g,b' 或 'rgb(r,g,b)' 字符串做硬性明暗（k<1 压暗 / k>1 提亮），无渐变 */
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
    name: '晨曦草原', strength: 0.5,
    fields: { horizon: '#ffd9b0', ridgeFar: '#8fb8a8', ridgeMid: '#6e9c8a', snow: '#f3f0e2', snowShade: '#dfd2c0' },
  },
  {
    name: '金穗丘陵', strength: 0.55,
    fields: { horizon: '#ffcf7a', ridgeFar: '#c9b06a', ridgeMid: '#a98f52', snow: '#f6ecd2', snowShade: '#e2d0a8', cloud: '#fff2d8' },
  },
  {
    name: '珊瑚沙谷', strength: 0.55,
    fields: { horizon: '#ffb4a2', ridgeFar: '#cf9a9c', ridgeMid: '#a87780', snow: '#f5e6e0', snowShade: '#e0c8c2' },
  },
  {
    name: '翠风峡湾', strength: 0.55,
    fields: { top: '#7fc4c0', mid: '#bfe0d2', horizon: '#f2e8c8', ridgeFar: '#7ab8a6', ridgeMid: '#52907e', snow: '#eef5ea', snowShade: '#d5e2d4' },
  },
  {
    name: '赤岩火山', strength: 0.6,
    fields: { horizon: '#ff9a5c', ridgeFar: '#b07a80', ridgeMid: '#8a5a62', snow: '#f0dcc8', snowShade: '#d4b49a', snowOutline: '#9a6a50' },
  },
  {
    name: '薄暮紫原', strength: 0.6,
    fields: { top: '#8a7ab8', mid: '#c2a8cc', horizon: '#e8a8c0', ridgeFar: '#8a7ca8', ridgeMid: '#6a5e88', snow: '#ece6f0', snowShade: '#d2c8dc' },
  },
  {
    name: '极夜冰原', strength: 0.6,
    fields: { top: '#9ab8d8', mid: '#d0e0ea', horizon: '#f0e8ea', ridgeFar: '#a8c4dc', ridgeMid: '#7ea0c0', snow: '#f0f6fa', snowShade: '#d8e4ee' },
  },
  {
    name: '星海之巅', strength: 0.65,
    fields: { top: '#4a4a7c', mid: '#7c6a9c', horizon: '#c07a88', ridgeFar: '#5c5880', ridgeMid: '#484468', snow: '#dcd8e8', snowShade: '#c0bcd4' },
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

/** 将主题色分级应用到一个调色板（原地修改；k 为主题权重 0..1） */
export function applyTheme(pal: SkyPalette, theme: ThemeDef, k: number): void {
  if (k <= 0) return;
  const eff = theme.strength * k;
  for (const key of Object.keys(theme.fields) as Array<keyof SkyPalette>) {
    const hex = theme.fields[key as keyof typeof theme.fields];
    if (typeof hex !== 'string' || typeof pal[key] !== 'string') continue;
    (pal as unknown as Record<string, string>)[key] = mixRgbStr(pal[key] as string, hexToRgb(hex).join(','), eff);
  }
}

export { rgba };
