/**
 * HeatSystem —— 热度系统（本作最高优先级子系统）。
 *
 * 单键三态与热度耦合，构成「贪速度 vs 保命」的节奏博弈：
 *
 *   加速态（按住）      积热 +18/s（Fever ×1.25 → +22.5/s）
 *   巡航态（松开+贴地） 散热 -8/s
 *   散热态（松开+空中） 散热 -12/s（风阻大、掉速快）
 *
 *   80+ 红热：速度上限 +10%、屏幕抖动、红色 vignette、心跳声、金币磁吸 ×1.5
 *        —— 「过热边缘」被刻意设计成诱惑：玩家是自己选择贪的。
 *   100  爆燃：翻滚坠落 2s、combo 清零、热度重置 0、不死亡。
 *        结束后 1s 免热（热度保持 0、不积热）—— 惩罚是「节奏打断」，不是「挫败」。
 *   完美着陆：「涡轮冷却」-20 热度 —— 双收益的另一半。
 *
 * 纯数值状态机：不持有 DOM/渲染引用，保证回放确定性。
 */

import { HEAT } from '../core/constants';
import type { BirdMoveState } from './game';

export class HeatSystem {
  /** 当前热度 0..100 */
  heat = 0;
  /** 免热剩余时间 s（爆燃后失而复得窗口） */
  immunity = 0;
  /** 本步是否刚触发爆燃（由 Sim 消费并清掉） */
  blowoutTriggered = false;
  /** 上一步是否处于红热（边沿检测，音效用） */
  wasRed = false;

  /** 每物理步调用。state：三态；fever：积热 ×1.25；speed01：当前速度/上限 0..1 ——
   *  热量随速度分段：攒速期便宜（+4/s），满速红热区昂贵（+16/s）；
   *  滑翔冷却随速度增强（-12 → -24/s，风阻冷却）。 */
  update(dt: number, state: BirdMoveState, fever: boolean, speed01 = 0): void {
    this.blowoutTriggered = false;

    if (this.immunity > 0) {
      // 失而复得：热度钉死 0，任何状态都不积热
      this.immunity -= dt;
      this.heat = 0;
      this.wasRed = false;
      return;
    }

    let rate: number;
    const s01 = Math.max(0, Math.min(1, speed01));
    switch (state) {
      case 'boost':
        // 低速攒速近乎免费，满速生存按红线计价
        rate = HEAT.BOOST_RATE_MIN + (HEAT.BOOST_RATE_MAX - HEAT.BOOST_RATE_MIN) * Math.pow(s01, 1.5);
        if (fever) rate *= HEAT.FEVER_HEAT_MULT;
        break;
      case 'cruise':
        rate = HEAT.CRUISE_RATE;
        break;
      case 'cool':
        // 风阻冷却：飞得越快散热越猛（大飞行 = 极速散热器）
        rate = HEAT.COOL_RATE_BASE + (HEAT.COOL_RATE_MAX - HEAT.COOL_RATE_BASE) * s01;
        break;
      default:
        rate = 0;
    }

    this.heat = Math.max(0, Math.min(HEAT.BLOWOUT_THRESHOLD, this.heat + rate * dt));

    if (this.heat >= HEAT.BLOWOUT_THRESHOLD) {
      // 爆燃：热度立即归零（翻滚演出期间就是冷的，符合「惩罚是打断不是死亡」）
      this.blowoutTriggered = true;
      this.heat = 0;
    }

    this.wasRed = this.red;
  }

  /** 红热（80+）：诱惑区间 */
  get red(): boolean {
    return this.heat >= HEAT.RED_THRESHOLD;
  }

  /** 红热程度 0..1（80→0，100→1；驱动抖动/vignette/心跳的线性量） */
  get redness(): number {
    return Math.max(0, (this.heat - HEAT.RED_THRESHOLD) / (HEAT.BLOWOUT_THRESHOLD - HEAT.RED_THRESHOLD));
  }

  /** 完美着陆：涡轮冷却 -20 */
  perfectLandCool(): void {
    this.heat = Math.max(0, this.heat - HEAT.PERFECT_LAND_COOL);
  }

  /** 爆燃翻滚结束时调用：开启 1s 免热 */
  startImmunity(): void {
    this.immunity = HEAT.IMMUNITY_TIME;
    this.heat = 0;
  }

  reset(): void {
    this.heat = 0;
    this.immunity = 0;
    this.blowoutTriggered = false;
    this.wasRed = false;
  }
}
