/**
 * DebugOverlay —— F1 调试面板（fps/粒子/模拟状态/种子/降级状态）。
 * F2 导出回放 JSON、F3 重放（见 App）。
 */

import type { Sim } from '../sim/game';
import type { QualityState } from '../core/loop';

export interface DebugInfo {
  fps: number;
  sim: Sim;
  particles: number;
  flame: number;
  quality: QualityState;
  seed: number;
  replaying: boolean;
}

export class DebugOverlay {
  on = false;

  toggle(): void {
    this.on = !this.on;
  }

  draw(ctx: CanvasRenderingContext2D, info: DebugInfo): void {
    const { sim } = info;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const lines = [
      `fps ${info.fps.toFixed(1)}  粒子 ${info.particles} (尾焰 ${info.flame})`,
      `种子 ${info.seed}  ${info.replaying ? '[回放]' : ''}`,
      `状态 ${sim.state} ${sim.grounded ? '贴地' : '空中'}  速度 ${sim.speed.toFixed(0)}`,
      `热度 ${sim.heatSys.heat.toFixed(1)}${sim.heatSys.immunity > 0 ? ' (免热)' : ''}  combo ${sim.combo}  fever ${sim.fever ? sim.feverT.toFixed(1) + 's' : '-'}`,
      `第 ${sim.level} 天  日落 ${sim.sunsetTimer.toFixed(1)}s  巢 ${sim.nestDistanceM.toFixed(0)}m`,
      `分数 ${Math.floor(sim.score)}  金币 ${sim.coinsTaken}  距离 ${sim.distanceM.toFixed(0)}m`,
      `高度 ${sim.agl | 0}（最高 ${sim.maxAlt | 0}）`,
      `降级 密度×${info.quality.particleDensity} 视差${info.quality.parallaxLayers}层`,
    ];
    ctx.font = '13px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const w = 330;
    ctx.fillStyle = 'rgba(10,8,14,0.78)';
    ctx.fillRect(8, 8, w, lines.length * 17 + 12);
    ctx.fillStyle = '#9fe8b8';
    lines.forEach((l, i) => ctx.fillText(l, 16, 17 + i * 17));
    ctx.restore();
  }
}
