import { Sim } from '../src/sim/game';
import { mulberry32 } from '../src/core/rng';
import type { InputEvent } from '../src/core/input';

function rhythmEvents(seed: number, nSteps: number): InputEvent[] {
  const rng = mulberry32(seed);
  const events: InputEvent[] = [{ step: 0, down: false }];
  let step = 0;
  let down = false;
  while (step < nSteps) {
    const hold = Math.round((0.3 + rng() * 0.9) * 120);
    const release = Math.round((0.2 + rng() * 0.6) * 120);
    step += down ? release : hold;
    down = !down;
    events.push({ step, down });
  }
  return events;
}

const N = 120 * 40;
for (const seed of [777, 42, 9]) {
  const s = new Sim(seed);
  let airSteps = 0;
  let sumSpeed = 0;
  let landings = 0;
  let perfects = 0;
  let maxAir = 0;
  let airRun = 0;
  let maxAGL = 0; // 最大离地高度（爽感核心指标）
  const aglSamples: number[] = [];
  for (let i = 0; i < N; i++) {
    // Tiny Wings 读坡策略：平滑前视，前方净上坡 → 松手放飞
    s.step(s.terrain.slopeAt(s.x + 60) > -0.05 || s.speed < 400); // 即时读坡：下坡按/上坡松；低速必按防卡死
    sumSpeed += s.speed;
    const agl = s.terrain.heightAt(s.x) - s.y;
    if (!s.grounded) {
      airSteps++;
      airRun++;
      maxAGL = Math.max(maxAGL, agl);
      aglSamples.push(agl);
    } else {
      maxAir = Math.max(maxAir, airRun);
      airRun = 0;
    }
    for (const e of s.drainEvents()) {
      if (e.type === 'landing') landings++;
      if (e.type === 'perfect') perfects++;
    }
  }
  aglSamples.sort((a, b) => b - a);
  const p90 = aglSamples[Math.floor(aglSamples.length * 0.1)] ?? 0;
  console.log(
    `seed=${seed} 空中占比=${((airSteps / N) * 100).toFixed(0)}% 均速=${(sumSpeed / N) | 0} ` +
      `着陆=${landings} 完美=${perfects} 最长滞空=${(maxAir / 120).toFixed(2)}s ` +
      `最高飞行=${maxAGL | 0}px P90=${p90 | 0}px 距离=${(s.maxX / 50) | 0}m`
  );
}
