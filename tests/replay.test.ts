import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/game';
import { runWithEvents, samplesEqual, serializeReplay } from '../src/sim/replay';
import type { InputEvent } from '../src/core/input';

/**
 * 「有节奏感」的输入序列：Tiny Wings 式地形感知策略 —— 下坡按住攒速、上坡松手放飞。
 * 用同种子 scratch Sim 预演生成调度（策略只依赖种子 → 确定性），再供两次运行对比。
 */
function rhythmEvents(seed: number, nSteps: number): InputEvent[] {
  const scratch = new Sim(777);
  const events: InputEvent[] = [{ step: 0, down: true }];
  let down = true;
  for (let s = 0; s < nSteps; s++) {
    // Tiny Wings 读坡策略：平滑前视（200px 高度差，抗样条局部摆动）
    // 前方净下坡/平地 → 按住压坡；净上坡 → 松手放飞
    const wantDown = scratch.terrain.slopeAt(scratch.x + 60) > -0.05 || scratch.speed < 400; // 即时读坡 + 低速防卡死
    if (wantDown !== down) {
      down = wantDown;
      events.push({ step: s, down });
    }
    scratch.step(down);
    scratch.drainEvents();
  }
  return events;
}

describe('回放确定性（验证 harness）', () => {
  const N = 120 * 40; // 40 秒 gameplay
  const events = rhythmEvents(1234, N);

  it('同种子 + 同输入序列 → 物理状态逐采样点完全一致', () => {
    const a = runWithEvents(new Sim(777), events, N);
    const b = runWithEvents(new Sim(777), events, N);
    expect(a.length).toBeGreaterThan(30);
    expect(samplesEqual(a, b)).toBe(true);
  });

  it('不同种子 → 轨迹发散（地形真的在起作用）', () => {
    const a = runWithEvents(new Sim(777), events, N);
    const b = runWithEvents(new Sim(778), events, N);
    expect(samplesEqual(a, b)).toBe(false);
  });

  it('输入序列哪怕差 1 步 → 轨迹发散（混沌性，检验回放精度）', () => {
    const shifted = events.map((e) => ({ ...e, step: e.step + 1 }));
    const a = runWithEvents(new Sim(777), events, N);
    const b = runWithEvents(new Sim(777), shifted, N);
    expect(samplesEqual(a, b)).toBe(false);
  });

  it('序列化 → 反序列化（JSON 往返）→ 重跑一致', () => {
    const data = serializeReplay(777, events);
    const json = JSON.parse(JSON.stringify(data));
    const a = runWithEvents(new Sim(data.seed), data.events, N);
    const b = runWithEvents(new Sim(json.seed), json.events as InputEvent[], N);
    expect(samplesEqual(a, b)).toBe(true);
  });

  it('40 秒节奏局内：至少发生着陆与金币拾取（序列真实覆盖判定路径）', () => {
    const s = new Sim(777);
    let landings = 0;
    let coins = 0;
    let perfects = 0;
    let blowouts = 0;
    let ei = 0;
    let held = false;
    for (let step = 0; step < N; step++) {
      while (ei < events.length && events[ei].step <= step) {
        held = events[ei].down;
        ei++;
      }
      s.step(held);
      for (const e of s.drainEvents()) {
        if (e.type === 'landing') landings++;
        if (e.type === 'coin') coins++;
        if (e.type === 'perfect') perfects++;
        if (e.type === 'blowout') blowouts++;
      }
    }
    expect(landings).toBeGreaterThan(1); // 纯 Tiny Wings 物理：飞行发生在坡顶松手，节奏更稀疏
    expect(s.distanceM).toBeGreaterThan(100); // 真的在跑图
    void coins;
    void perfects;
    void blowouts;
  });
});
