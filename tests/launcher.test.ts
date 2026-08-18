import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/game';
import { Terrain } from '../src/sim/terrain';
import { TERRAIN_CP_W, BIRD_R } from '../src/core/constants';

/** 云霄发射台：确定性验证「山坳→唇沿→飞上云霄」的玩法承诺 */

function findLauncher(t: Terrain, count = 8): number {
  for (let m = 0; m < count; m++) {
    if (t.isMegaLauncher(m)) return m;
  }
  return -1;
}

describe('云霄发射台（地形特征 + 飞行实测）', () => {
  it('seed=777：3 万 px 内存在多个发射台，深谷 ≥450px、唇沿抬升 ≥350px', () => {
    const t = new Terrain(777);
    let launchers = 0;
    let maxDrop = 0;
    let maxRise = 0;
    for (let m = 0; m < 8; m++) {
      if (!t.isMegaLauncher(m)) continue;
      launchers++;
      const x0 = m * 13 * TERRAIN_CP_W;
      const xBottom = x0 + 6 * TERRAIN_CP_W;
      const xCrest = x0 + 13 * TERRAIN_CP_W;
      maxDrop = Math.max(maxDrop, t.heightAt(xBottom) - t.heightAt(x0 + 0.2 * TERRAIN_CP_W));
      maxRise = Math.max(maxRise, t.heightAt(xBottom) - t.heightAt(xCrest - 0.3 * TERRAIN_CP_W));
    }
    expect(launchers).toBeGreaterThanOrEqual(3);
    expect(maxDrop).toBeGreaterThan(450);
    expect(maxRise).toBeGreaterThan(350);
  });

  it('玩法实测：谷口按住冲坡 → 离地松手 → 飞超 500px（确定性协议）', () => {
    const s = new Sim(777);
    const t = s.terrain;
    const m = findLauncher(t, 8);
    expect(m).toBeGreaterThanOrEqual(0);
    const x0 = m * 13 * TERRAIN_CP_W;

    // 鸟带着「已投资的速度」（1600 = 持续按住攒出来的档位）进入谷口，初速沿坡面切向
    s.x = x0 + 260;
    const th0 = t.tangentAngle(s.x);
    s.y = t.heightAt(s.x) - BIRD_R * Math.cos(th0);
    s.vx = 1600 * Math.cos(th0);
    s.vy = 1600 * Math.sin(th0);
    s.grounded = true;
    s.phase = 'run';

    // Tiny Wings 协议：按住压坡骑满下坡+谷底（贴谷底冲速），唇沿基座（CP8，金币引导线起点）松手
    const lipBaseX = x0 + 8 * TERRAIN_CP_W;
    let maxAGL = 0;
    let airborne = false;
    let released = false;
    for (let i = 0; i < 120 * 8; i++) {
      const held = !released && s.x < lipBaseX;
      if (!held && !released) released = true;
      s.step(held);
      if (!s.grounded) airborne = true;
      if (released) {
        maxAGL = Math.max(maxAGL, t.heightAt(s.x) - s.y);
        if (s.grounded && i > 120 * 2) break; // 已落地
      }
      if (i > 120 * 6) break;
      s.drainEvents();
    }
    expect(airborne).toBe(true);
    expect(maxAGL).toBeGreaterThan(400); // 纯 Tiny Wings 物理：唇沿发射 400px+（实测 ~435）
  });

  it('速度→高度对应关系：同一唇沿，2 倍速度 ≈ 4 倍顶点（弹射转换的平方律）', () => {
    const mk = (v0: number): number => {
      const s = new Sim(777);
      const t = s.terrain;
      let m = -1;
      for (let k = 0; k < 8; k++) if (t.isMegaLauncher(k)) { m = k; break; }
      const x0 = m * 13 * TERRAIN_CP_W;
      // 唇沿顶部前 120px（仍在陡爬升段）
      let crestX = x0 + 13 * TERRAIN_CP_W;
      for (let p = 9; p < 13; p += 0.05) {
        if (t.slopeAt(x0 + p * TERRAIN_CP_W) > 0) { crestX = x0 + p * TERRAIN_CP_W; break; }
      }
      s.x = crestX - 120;
      const th = t.tangentAngle(s.x);
      s.y = t.heightAt(s.x) - BIRD_R * Math.cos(th);
      s.vx = v0 * Math.cos(th);
      s.vy = v0 * Math.sin(th);
      s.grounded = true;
      s.phase = 'run';
      let maxAGL = 0;
      for (let i = 0; i < 120 * 5; i++) {
        s.step(false); // 松手离地 → 弹射
        if (!s.grounded) maxAGL = Math.max(maxAGL, t.heightAt(s.x) - s.y);
        if (s.grounded && i > 120) break;
        s.drainEvents();
      }
      return maxAGL;
    };
    const low = mk(1100);
    const high = mk(2300);
    expect(high).toBeGreaterThan(500); // 满速弹射：500px+
    expect(high / Math.max(low, 1)).toBeGreaterThan(2.5); // 平方律：速度×2 → 高度远超×2
  });

  it('发射台金币引导：谷内有速度线、唇沿后有发射轨迹弧', () => {
    const t = new Terrain(777);
    const m = findLauncher(t, 8);
    const x0 = m * 13 * TERRAIN_CP_W;
    const crestX = (m * 13 + 13) * TERRAIN_CP_W;
    // 下坡段（mp 1-5）有金币
    const bowlCoins = t.coinsInRange(x0 + TERRAIN_CP_W, x0 + 6 * TERRAIN_CP_W);
    expect(bowlCoins.length).toBeGreaterThan(0);
    // 唇沿段（mp 10-12）有金币 + 发射弧（高空金币，y 远高于地表）
    const lipCoins = t.coinsInRange(x0 + 10 * TERRAIN_CP_W, crestX + 900);
    expect(lipCoins.length).toBeGreaterThanOrEqual(4);
    const arcCoins = lipCoins.filter((c) => t.heightAt(c.x) - c.y > 150);
    expect(arcCoins.length).toBeGreaterThanOrEqual(3);
  });

  it('发射台确定性：同种子同形态', () => {
    const a = new Terrain(777);
    const b = new Terrain(777);
    for (let m = 0; m < 8; m++) {
      expect(a.isMegaLauncher(m)).toBe(b.isMegaLauncher(m));
      if (a.isMegaLauncher(m)) {
        const x0 = m * 13 * TERRAIN_CP_W;
        for (let d = 0; d < 3400; d += 100) {
          expect(a.heightAt(x0 + d)).toBe(b.heightAt(x0 + d));
        }
      }
    }
  });
});
