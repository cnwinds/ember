import { describe, it, expect } from 'vitest';
import { Terrain } from '../src/sim/terrain';
import { TERRAIN_CP_W } from '../src/core/constants';
import { rand01, mulberry32, dailySeed } from '../src/core/rng';

describe('Terrain（种子化地形）', () => {
  it('同种子 → 高度完全一致（每日挑战复现的前提）', () => {
    const a = new Terrain(12345);
    const b = new Terrain(12345);
    for (let x = -500; x < 20000; x += 37) {
      expect(a.heightAt(x)).toBe(b.heightAt(x));
    }
  });

  it('不同种子 → 地形不同', () => {
    const a = new Terrain(1);
    const b = new Terrain(2);
    let diff = 0;
    for (let x = 0; x < 10000; x += 50) {
      if (Math.abs(a.heightAt(x) - b.heightAt(x)) > 1) diff++;
    }
    expect(diff).toBeGreaterThan(100);
  });

  it('高度连续（无跳变）且坡度有界', () => {
    const t = new Terrain(777);
    let maxSlope = 0;
    for (let x = -1000; x < 30000; x += 4) {
      const s = Math.abs(t.slopeAt(x));
      maxSlope = Math.max(maxSlope, s);
    }
    // 限幅 165/260 ≈ 32° 平均坡，CR 局部过冲到 ~42°（发射唇沿），仍 < 45°
    expect(maxSlope).toBeLessThan(1.0);
  });

  it('惰性求值与调用顺序无关（缓存一致性）', () => {
    const forward = new Terrain(42);
    const backward = new Terrain(42);
    const random = new Terrain(42);
    const xs: number[] = [];
    for (let x = 0; x < 15000; x += TERRAIN_CP_W / 2) xs.push(x);
    const fwd = xs.map((x) => forward.heightAt(x));
    const bwd = xs.slice().reverse().map((x) => backward.heightAt(x)).reverse();
    const rng = mulberry32(9);
    const shuffledAgain = [...xs].sort(() => rng() - 0.5);
    for (let i = 0; i < xs.length; i++) {
      expect(fwd[i]).toBe(bwd[i]);
    }
    // random 池乱序求值后与 forward 池同 x 同值
    for (const x of shuffledAgain) {
      expect(random.heightAt(x)).toBe(forward.heightAt(x));
    }
  });

  it('金币确定性：同种子同位置，taken 状态可变', () => {
    const a = new Terrain(99);
    const b = new Terrain(99);
    const ca = a.coinsInRange(0, 20000);
    const cb = b.coinsInRange(0, 20000);
    expect(ca.length).toBe(cb.length);
    for (let i = 0; i < ca.length; i++) {
      expect(ca[i].x).toBe(cb[i].x);
      expect(ca[i].y).toBe(cb[i].y);
    }
    if (ca.length > 0) {
      ca[0].taken = true;
      expect(ca[0].taken).toBe(true);
      expect(cb[0].taken).toBe(false); // 实例独立
    }
  });

  it('巢穴位置解析确定且随关卡递增', () => {
    const t = new Terrain(5);
    const n1 = t.nestX(1);
    const n2 = t.nestX(2);
    const n3 = t.nestX(3);
    expect(n2 - n1).toBeGreaterThan(10000);
    expect(n3 - n2).toBeGreaterThanOrEqual(n2 - n1);
    expect(t.nestX(2)).toBe(n2);
  });

  it('巢穴附近地形被压平（着陆体验）', () => {
    const t = new Terrain(31);
    const nx = t.nestX(1);
    const slopeAtNest = Math.abs(t.slopeAt(nx));
    expect(slopeAtNest).toBeLessThan(0.12);
  });

  it('地形有全局下行趋势且围绕趋势线的摆动有界（平地死区根治 + 无视差漂移）', () => {
    for (const seed of [777, 42, 9]) {
      const t = new Terrain(seed);
      const h0 = t.heightAt(1000);
      const hEnd = t.heightAt(150000);
      // 趋势：150k px 下降 ~12000px（0.08 斜率，y 向下：hEnd > h0）± 容差
      expect(hEnd - h0).toBeGreaterThan(8000);
      expect(hEnd - h0).toBeLessThan(15000);
      // 围绕趋势线摆动有界（±2200px），不会指数发散
      let maxDev = 0;
      for (let x = 0; x <= 150000; x += 500) {
        const dev = Math.abs(t.heightAt(x) - x * 0.08);
        maxDev = Math.max(maxDev, dev);
      }
      expect(maxDev).toBeLessThan(2200);
    }
  });

  it('关卡难度递进：第 1 天发射台密集/岩石稀少，第 8 天+发射台稀疏/岩石遍地（简单=易连飞，难=速度易断）', () => {
    const t = new Terrain(777);
    const span = 40000;
    const countLaunchers = (xa: number) => {
      let n = 0;
      for (let m = Math.floor(xa / (13 * 260)); m <= Math.floor((xa + span) / (13 * 260)); m++) {
        if (t.isMegaLauncher(m)) n++;
      }
      return n;
    };
    const rockRate = (xa: number) => {
      let n = 0;
      let tot = 0;
      for (let x = xa; x < xa + 30000; x += 120) {
        tot++;
        if (t.materialAt(x) === 'rock') n++;
      }
      return n / tot;
    };
    const hardStart = t.nestX(7); // 第 8 天区域起点
    expect(countLaunchers(0)).toBeGreaterThan(countLaunchers(hardStart));
    expect(rockRate(hardStart)).toBeGreaterThan(rockRate(2000));
    // 难度函数本身单调（分桶内）
    expect(t.difficultyAt(5000)).toBe(0);
    expect(t.difficultyAt(hardStart + 10000)).toBe(1);
  });

  it('rng：hash 确定性 & dailySeed 可解析', () => {
    expect(rand01(100, 7)).toBe(rand01(100, 7));
    expect(rand01(100, 7)).not.toBe(rand01(101, 7));
    expect(Number.isInteger(dailySeed())).toBe(true);
  });
});
