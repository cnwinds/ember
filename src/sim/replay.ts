/**
 * 回放 harness —— 输入序列录制 / 回放 / 逐帧对比。
 *
 * 用法：
 *   录制：每物理步调用 recorder.observe(step, held)（InputSource 已内置）。
 *   回放：new Sim(seed) + replay(sim, events)，与首次运行逐采样点对比 sample()。
 * 判定（着陆/Combo/爆燃）的正确性由 tests/replay.test.ts 用真实输入序列验证，
 * 「代码看一遍觉得对」不算数。
 */

import type { InputEvent } from '../core/input';
import type { Sim } from './game';

export interface ReplayData {
  version: 1;
  seed: number;
  /** 每采样点间隔的物理步数 */
  sampleEvery: number;
  events: InputEvent[];
}

/** 用给定输入事件序列驱动 Sim 跑 nSteps 步，每 sampleEvery 步采一次样 */
export function runWithEvents(sim: Sim, events: InputEvent[], nSteps: number, sampleEvery = 30): number[][] {
  const samples: number[][] = [];
  let ei = 0;
  let held = false;
  for (let s = 0; s < nSteps; s++) {
    while (ei < events.length && events[ei].step <= s) {
      held = events[ei].down;
      ei++;
    }
    sim.step(held);
    if (s % sampleEvery === 0) samples.push(sim.sample());
  }
  return samples;
}

export function samplesEqual(a: number[][], b: number[][]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ra = a[i];
    const rb = b[i];
    if (ra.length !== rb.length) return false;
    for (let j = 0; j < ra.length; j++) {
      if (Math.abs(ra[j] - rb[j]) > 1e-6) return false;
    }
  }
  return true;
}

export function serializeReplay(seed: number, events: InputEvent[]): ReplayData {
  return { version: 1, seed, sampleEvery: 30, events };
}
