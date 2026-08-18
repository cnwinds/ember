import { describe, it, expect } from 'vitest';
import { HeatSystem } from '../src/sim/heat';

const dt = 1 / 120;

function run(state: 'boost' | 'cruise' | 'cool', seconds: number, fever = false, speed01 = 0, start = 0): HeatSystem {
  const h = new HeatSystem();
  h.heat = start;
  for (let i = 0; i < Math.round(seconds / dt); i++) h.update(dt, state, fever, speed01);
  return h;
}

describe('HeatSystem（热度 = 满速生存的成本，不是攒速的罚款）', () => {
  it('攒速期近乎免费：低速 +4/s（5 秒仅 +20）', () => {
    const h = run('boost', 5, false, 0);
    expect(h.heat).toBeCloseTo(20, 0);
  });

  it('满速红线计价：+16/s（5 秒到 80 红热，6.25s 爆燃）', () => {
    const h = run('boost', 5, false, 1);
    expect(h.heat).toBeCloseTo(80, 0);
    const h2 = new HeatSystem();
    let steps = 0;
    for (; steps < 120 * 12; steps++) {
      h2.update(dt, 'boost', false, 1);
      if (h2.blowoutTriggered) break;
    }
    expect(h2.blowoutTriggered).toBe(true);
    expect(steps / 120).toBeGreaterThan(6.2);
    expect(steps / 120).toBeLessThan(6.5);
  });

  it('Fever 满速 ×1.25 → +20/s', () => {
    const h = run('boost', 2, true, 1);
    expect(h.heat).toBeCloseTo(40, 0);
  });

  it('风阻冷却：静止滑翔 -12/s，满速滑翔 -24/s（大飞行 = 极速散热器）', () => {
    expect(run('cool', 1, false, 0, 50).heat).toBeCloseTo(38, 0);
    expect(run('cool', 1, false, 1, 50).heat).toBeCloseTo(26, 0);
  });

  it('巡航 -8/s、低速滑翔 -12/s，钳到 0 不为负', () => {
    expect(run('cruise', 1, false, 0, 50).heat).toBeCloseTo(42, 0);
    expect(run('cool', 1, false, 0, 50).heat).toBeCloseTo(38, 0);
    expect(run('cool', 10, false, 0, 10).heat).toBe(0);
  });

  it('100 触发爆燃并立即归零', () => {
    const h = new HeatSystem();
    h.heat = 99.9;
    let triggered = false;
    for (let i = 0; i < 30; i++) {
      h.update(dt, 'boost', false);
      if (h.blowoutTriggered) {
        triggered = true;
        break;
      }
    }
    expect(triggered).toBe(true);
    expect(h.heat).toBe(0);
  });

  it('爆燃结束免热 1s：期间热度钉死 0，之后恢复积热', () => {
    const h = new HeatSystem();
    h.startImmunity();
    for (let i = 0; i < 0.9 / dt; i++) h.update(dt, 'boost', false, 1);
    expect(h.heat).toBe(0);
    for (let i = 0; i < 0.6 / dt; i++) h.update(dt, 'boost', false, 1); // 越过 1s 窗口（满速 +16/s）
    expect(h.heat).toBeGreaterThan(5);
  });

  it('红热区间：redness 线性（80→0，100→1）', () => {
    const h = new HeatSystem();
    h.heat = 80;
    expect(h.red).toBe(true);
    expect(h.redness).toBeCloseTo(0, 5);
    h.heat = 90;
    expect(h.redness).toBeCloseTo(0.5, 2);
    h.heat = 79.9;
    expect(h.red).toBe(false);
  });

  it('完美着陆涡轮冷却 -20，下限 0', () => {
    const h = new HeatSystem();
    h.heat = 75;
    h.perfectLandCool();
    expect(h.heat).toBeCloseTo(55, 0);
    h.heat = 10;
    h.perfectLandCool();
    expect(h.heat).toBe(0);
  });

  it('Fever 只放大积热，不放大散热', () => {
    expect(run('cool', 1, true, 0, 50).heat).toBeCloseTo(38, 0);
  });
});
