import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/game';
import { BIRD_R } from '../src/core/constants';

/**
 * 构造一次「完美着陆」（对地形曲率零敏感）：
 * 判定发生在下一步 x+7.5px 处 → 把速度精确对齐到「落点」的坡面切线再向下偏 6°，
 * 入射角偏差恒为 6° < 15°、速度 ~903 > 520 → perfect。
 */
function forcePerfectLanding(s: Sim, x: number): void {
  const dt = 1 / 120;
  const xland = x + 900 * dt; // 一步前进后的判定点
  const theta = s.terrain.tangentAngle(xland);
  const gy = s.terrain.heightAt(xland);
  const v = 900;
  s.x = x;
  s.y = gy - BIRD_R + 2; // 相对落点微穿透
  s.vx = Math.cos(theta) * v;
  s.vy = Math.sin(theta) * v + Math.tan((6 * Math.PI) / 180) * v;
  s.grounded = false;
  s.phase = 'run';
  for (let i = 0; i < 6; i++) {
    s.step(false);
    if (s.grounded) return;
  }
  throw new Error('未在预期步数内着陆');
}

/** 构造一次「普通着陆」：近乎垂直砸地 */
function forceHardLanding(s: Sim, x: number): void {
  const gy = s.terrain.heightAt(x);
  s.x = x;
  s.y = gy - BIRD_R - 120;
  s.vx = 60;
  s.vy = 500;
  s.grounded = false;
  for (let i = 0; i < 40; i++) {
    s.step(false);
    if (s.grounded) return;
  }
  throw new Error('未在预期步数内着陆');
}

/** 从 fromX 向前找一段下坡（任何坡度 0.04..0.5）——判定构造已对曲率免疫 */
function findDownhillX(s: Sim, fromX = 400): number {
  for (let x = fromX; x < fromX + 20000; x += 30) {
    const sl = s.terrain.slopeAt(x);
    if (sl > 0.04 && sl < 0.5) return x;
  }
  throw new Error('未找到下坡');
}

describe('完美着陆 → Combo → Fever → 涡轮全开（事件链）', () => {
  it('连续 3 次完美着陆：combo 递增、-20 热度/次、第 3 次进 Fever', () => {
    const s = new Sim(101);
    let x = findDownhillX(s);
    s.heatSys.heat = 60;
    forcePerfectLanding(s, x);
    expect(s.combo).toBe(1);
    // -20（涡轮冷却）+ 单步判定的微量散热
    expect(s.heatSys.heat).toBeGreaterThan(35);
    expect(s.heatSys.heat).toBeLessThanOrEqual(40);
    x = findDownhillX(s, x + 200);
    forcePerfectLanding(s, x);
    expect(s.combo).toBe(2);
    let feverEntered = false;
    x = findDownhillX(s, x + 200);
    forcePerfectLanding(s, x);
    for (const e of s.drainEvents()) if (e.type === 'feverEnter') feverEntered = true;
    expect(s.combo).toBe(3);
    expect(feverEntered).toBe(true);
    expect(s.fever).toBe(true);
    expect(s.feverT).toBeGreaterThan(7.5); // 8s 减去构造着陆的耗时（地形趋势微移）
  });

  it('Fever 内再 3 次完美着陆 → 涡轮全开事件；普通着陆打断 combo', () => {
    const s = new Sim(103);
    let x = findDownhillX(s);
    for (let i = 0; i < 3; i++) {
      forcePerfectLanding(s, x);
      x = findDownhillX(s, x + 200);
    }
    s.drainEvents();
    expect(s.fever).toBe(true);
    let turbo = 0;
    for (let i = 0; i < 3; i++) {
      forcePerfectLanding(s, x);
      for (const e of s.drainEvents()) if (e.type === 'turbo') turbo++;
      x = findDownhillX(s, x + 200);
    }
    expect(turbo).toBe(1); // Fever 内第 3 次完美触发涡轮全开
    expect(s.combo).toBe(6);
    // 普通着陆打断
    const xFlat = findDownhillX(s, x + 200);
    forceHardLanding(s, xFlat + 300);
    s.drainEvents();
    expect(s.combo).toBe(0);
  });

  it('Fever 8 秒后自然结束；期间加速积热 ×1.25（22.5/s）', () => {
    const s = new Sim(107);
    let x = findDownhillX(s);
    for (let i = 0; i < 3; i++) {
      forcePerfectLanding(s, x);
      x = findDownhillX(s, x + 200);
    }
    s.drainEvents();
    expect(s.fever).toBe(true);
    // 满速按住 1 秒：Fever ×1.25 × 16/s = 20/s 左右（先定速到上限再测）
    const thF = s.terrain.tangentAngle(s.x);
    s.vx = 2400 * Math.cos(thF);
    s.vy = 2400 * Math.sin(thF);
    s.grounded = true;
    const h0 = s.heatSys.heat;
    for (let i = 0; i < 120; i++) s.step(true);
    s.drainEvents();
    expect(s.heatSys.heat - h0).toBeGreaterThan(5); // Fever ×1.25 显著放大（速度受地形影响，区间放宽；精确倍率由热度单测锁定）
    expect(s.heatSys.heat - h0).toBeLessThan(24);
    // 推到 8s 结束
    for (let i = 0; i < 120 * 8; i++) {
      s.step(false);
      if (!s.fever) break;
    }
    expect(s.fever).toBe(false);
  });

  it('普通着陆不进 Fever、combo 归零后重新计数', () => {
    const s = new Sim(109);
    const x = findDownhillX(s);
    forcePerfectLanding(s, x);
    forcePerfectLanding(s, findDownhillX(s, x + 200));
    forceHardLanding(s, x + 900);
    expect(s.combo).toBe(0);
    expect(s.fever).toBe(false);
    forcePerfectLanding(s, findDownhillX(s, x + 1000));
    expect(s.combo).toBe(1);
  });
});
