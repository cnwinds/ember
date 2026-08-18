/** 数学小工具 —— 全项目共用的纯函数 */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 帧率无关阻尼趋近（k 越大越快），等价于每秒保留 e^-k */
export function damp(a: number, b: number, k: number, dt: number): number {
  return b + (a - b) * Math.exp(-k * dt);
}

/** 将「每帧 lerp 系数 @基准帧率」换算为帧率无关形式 */
export function lerpPerFrame(a: number, b: number, perFrame: number, dt: number, baseFps = 60): number {
  const t = 1 - Math.pow(1 - perFrame, dt * baseFps);
  return a + (b - a) * t;
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** 按帧率无关系数做角度 lerp（处理跨 ±π） */
export function dampAngle(a: number, b: number, perFrame: number, dt: number): number {
  const t = 1 - Math.pow(1 - perFrame, dt * 60);
  return a + wrapAngle(b - a) * t;
}

export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 多段色阶连续插值（尾焰/热度条共用） */
export function rampColor(stops: Array<[number, number, number, number]>, t: number): string {
  // stops: [pos, r, g, b]，pos∈[0,1] 升序
  if (t <= stops[0][0]) t = stops[0][0];
  const last = stops[stops.length - 1];
  if (t >= last[0]) t = last[0];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const k = (t - a[0]) / (b[0] - a[0] || 1);
      const r = Math.round(a[1] + (b[1] - a[1]) * k);
      const g = Math.round(a[2] + (b[2] - a[2]) * k);
      const bl = Math.round(a[3] + (b[3] - a[3]) * k);
      return `rgb(${r},${g},${bl})`;
    }
  }
  return `rgb(${last[1]},${last[2]},${last[3]})`;
}

/** rgba 快写 */
export function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r | 0},${g | 0},${b | 0},${clamp(a, 0, 1).toFixed(3)})`;
}

/** 解析 '#RRGGBB' → [r,g,b] */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 两个 hex 色按 t 插值为 rgb 字符串 */
export function mixHex(h1: string, h2: string, t: number): string {
  const a = hexToRgb(h1);
  const b = hexToRgb(h2);
  return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
}
