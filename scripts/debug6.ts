/**
 * 云霄发射台验证：扫描每个种子的前 30000px，
 * 统计「深谷+陡唇沿」特征与实际飞行高度。
 */
import { Sim } from '../src/sim/game';
import { Terrain } from '../src/sim/terrain';
import { TERRAIN_CP_W } from '../src/core/constants';
import { mulberry32 } from '../src/core/rng';
import type { InputEvent } from '../src/core/input';

function rhythmEvents(seed: number, nSteps: number): InputEvent[] {
  const rng = mulberry32(seed);
  const events: InputEvent[] = [{ step: 0, down: false }];
  let step = 0;
  let down = false;
  while (step < nSteps) {
    step += down ? Math.round((0.2 + rng() * 0.6) * 120) : Math.round((0.3 + rng() * 0.9) * 120);
    down = !down;
    events.push({ step, down });
  }
  return events;
}

// 1) 地形侧：统计发射台数量与形态
for (const seed of [777, 42, 9, 5, 100]) {
  const t = new Terrain(seed);
  let launchers = 0;
  let maxDrop = 0;
  let maxRise = 0;
  const megaCount = Math.floor(30000 / TERRAIN_CP_W / 13);
  for (let m = 0; m < megaCount; m++) {
    if (!t.isMegaLauncher(m)) continue;
    launchers++;
    const x0 = m * 13 * TERRAIN_CP_W;
    const xBottom = x0 + 6 * TERRAIN_CP_W;
    const xCrest = x0 + 13 * TERRAIN_CP_W;
    const drop = t.heightAt(xBottom) - t.heightAt(x0 + 0.2 * TERRAIN_CP_W);
    const rise = t.heightAt(xBottom) - t.heightAt(xCrest - 0.3 * TERRAIN_CP_W);
    maxDrop = Math.max(maxDrop, drop);
    maxRise = Math.max(maxRise, rise);
  }
  console.log(`seed=${seed} 发射台=${launchers}/${megaCount} 最深谷=${maxDrop | 0}px 最大唇沿抬升=${maxRise | 0}px`);
}

// 2) 飞行侧：bot 打 40s 的最高飞行
const N = 120 * 40;
for (const seed of [777, 42, 9]) {
  const s = new Sim(seed);
  const events = rhythmEvents(1234, N);
  let ei = 0;
  let held = false;
  let maxAGL = 0;
  let airSteps = 0;
  for (let i = 0; i < N; i++) {
    while (ei < events.length && events[ei].step <= i) {
      held = events[ei].down;
      ei++;
    }
    s.step(held);
    if (!s.grounded) {
      airSteps++;
      maxAGL = Math.max(maxAGL, s.terrain.heightAt(s.x) - s.y);
    }
    s.drainEvents();
  }
  console.log(`seed=${seed} 最高飞行=${maxAGL | 0}px 空中占比=${((airSteps / N) * 100) | 0}%`);
}
