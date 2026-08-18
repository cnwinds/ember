import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/game';
import { TERRAIN_CP_W, BIRD_R, realmIndex, REALM_SCORE } from '../src/core/constants';

describe('高度境界（挑战阶梯）', () => {
  it('realmIndex 阈值映射正确', () => {
    expect(realmIndex(0)).toBe(0);
    expect(realmIndex(179)).toBe(0);
    expect(realmIndex(180)).toBe(1);
    expect(realmIndex(349)).toBe(1);
    expect(realmIndex(350)).toBe(2);
    expect(realmIndex(549)).toBe(2);
    expect(realmIndex(550)).toBe(3);
    expect(realmIndex(799)).toBe(3);
    expect(realmIndex(800)).toBe(4);
    expect(realmIndex(1099)).toBe(4);
    expect(realmIndex(1100)).toBe(5);
    expect(realmIndex(99999)).toBe(5);
  });

  it('发射台飞行触发境界事件 + 分数奖励 + maxAlt 记录（确定性）', () => {
    const s = new Sim(777);
    const t = s.terrain;
    let m = -1;
    for (let k = 0; k < 8; k++) if (t.isMegaLauncher(k)) { m = k; break; }
    const x0 = m * 13 * TERRAIN_CP_W;
    s.x = x0 + 260;
    const th0 = t.tangentAngle(s.x);
    s.y = t.heightAt(s.x) - BIRD_R * Math.cos(th0);
    s.vx = 1600 * Math.cos(th0);
    s.vy = 1600 * Math.sin(th0);
    s.grounded = true;
    s.phase = 'run';

    const realms: number[] = [];
    let released = false;
    const score0 = 0;
    let realmBonus = 0;
    const lipBaseX = x0 + 8 * TERRAIN_CP_W;
    for (let i = 0; i < 120 * 6; i++) {
      const held = !released && s.x < lipBaseX; // 骑满谷底，唇沿基座（CP8）松手
      if (!held && !released) released = true;
      s.step(held);
      for (const e of s.drainEvents()) {
        if (e.type === 'realm') {
          realms.push(e.realm!);
          realmBonus += REALM_SCORE * (e.realm! + 1);
        }
      }
      if (released && s.grounded && i > 120 * 2) break;
    }
    // 435px 飞行 → 至少跨过 低云(250)；云海(450) 视地形细节
    expect(realms.length).toBeGreaterThanOrEqual(1);
    expect(realms).toContain(1);
    for (let i = 1; i < realms.length; i++) expect(realms[i]).toBeGreaterThan(realms[i - 1]);
    expect(s.maxAlt).toBeGreaterThan(350);
    // 分数包含境界奖励
    expect(s.score).toBeGreaterThan(score0 + realmBonus - 1);
    expect(realmBonus).toBeGreaterThan(0);
  });

  it('agl 贴地 ≈ 0、腾空 > 0', () => {
    const s = new Sim(5);
    expect(s.agl).toBeLessThan(20);
    s.y -= 400;
    expect(s.agl).toBeGreaterThan(350);
  });

  it('境界事件确定性：两次运行事件序列一致', () => {
    const run = () => {
      const s = new Sim(777);
      const out: string[] = [];
      for (let i = 0; i < 120 * 20; i++) {
        s.step(i % 200 < 130);
        for (const e of s.drainEvents()) if (e.type === 'realm') out.push(`${e.realm}@${(s.maxAlt | 0)}`);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});
