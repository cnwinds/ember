/**
 * Sim —— 确定性游戏模拟（玩法核心：物理 + 三态 + 热度 + Combo/Fever + 爆燃 + 日落）。
 *
 * 架构约束：
 * - 纯逻辑、零 DOM / 零渲染 / 零音频引用 —— 状态是 (seed, 输入序列) 的纯函数，
 *   这是「回放逐帧对比物理状态」验证方式的前提。
 * - 每步产出事件列表（perfect/coin/blowout/...），由 App 分发给渲染与音频。
 * - prev/curr 双快照供渲染插值（120Hz 物理 → 任意刷新率丝滑渲染）。
 *
 * 三态物理（单键）：
 *   boost   按住：空中重力 ×2.1 俯冲；贴地沿坡面 +2600px/s² 推力，积热 +18/s
 *   cruise  松开+贴地：重力沿坡分量自然滑行 + 滚动摩擦，散热 -8/s
 *   cool    松开+空中：展翅滑翔，重力 ×0.55、气动阻力大，散热 -12/s
 * Tiny Wings 循环：按住压下坡攒速 → 松手展翅借上坡抛出 → 空中散热 → 贴坡瞬间判定着陆。
 */

import {
  STEP, G, PRESS_G_MULT, UPHILL_FLOOR, AIR_DRAG, GROUND_FRICTION, SOFT_CAP_RATE,
  BASE_MAX_SPEED, REDHEAT_SPEED_BONUS, PERFECT_ANGLE_TOL_DEG, PERFECT_MIN_SPEED,
  COMBO, BLOWOUT, SUNSET, COIN, BIRD_R, ROCK_FRICTION_MULT, PX_PER_M, HEAT,
  realmIndex, REALM_SCORE,
} from '../core/constants';
import { clamp, wrapAngle, dampAngle, damp } from '../core/mathutil';
import { Terrain } from './terrain';
import { HeatSystem } from './heat';

export type BirdMoveState = 'boost' | 'cruise' | 'cool';
export type BirdPhase = 'run' | 'tumble';

export interface SimEvent {
  type:
    | 'perfect' | 'landing' | 'flap' | 'coin'
    | 'blowout' | 'blowoutEnd'
    | 'feverEnter' | 'feverEnd' | 'turbo'
    | 'nest' | 'night' | 'realm';
  x?: number;
  y?: number;
  /** 爆燃点正下方地表 y（焦痕用） */
  groundY?: number;
  speed?: number;
  angleDiff?: number;
  combo?: number;
  level?: number;
  perfect?: boolean;
  material?: 'snow' | 'rock';
  /** 高度境界序号 */
  realm?: number;
}

export interface BirdSnapshot {
  x: number;
  y: number;
  angle: number;
  wing: number; // 0 收拢 .. 1 展翅
  phase: BirdPhase;
  flapPhase: number;
}

/** 完美着陆判定（纯函数，单测直达） */
export function judgeLanding(
  vx: number, vy: number, tangentAngle: number, speed: number
): { perfect: boolean; angleDiffDeg: number } {
  const velAngle = Math.atan2(vy, vx);
  const diff = Math.abs(wrapAngle(velAngle - tangentAngle));
  const diffDeg = (diff * 180) / Math.PI;
  return { perfect: diffDeg < PERFECT_ANGLE_TOL_DEG && speed > PERFECT_MIN_SPEED, angleDiffDeg: diffDeg };
}

export class Sim {
  readonly terrain: Terrain;
  readonly heatSys = new HeatSystem();

  // ---- 鸟（模拟态） ----
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  angle = 0;
  grounded = true;
  wing = 0.3;
  flapPhase = 0;
  phase: BirdPhase = 'run';
  state: BirdMoveState = 'cruise';

  // ---- 爆燃（原地爆炸） ----
  private tumbleT = 0;

  // ---- 进度/得分 ----
  steps = 0;
  score = 0;
  coinsTaken = 0;
  combo = 0;
  maxCombo = 0;
  level = 1;
  maxX = 0;
  fever = false;
  feverT = 0;
  feverPerfects = 0;
  /** 本局最高离地高度 px（境界挑战的记录） */
  maxAlt = 0;
  private realmCur = 0;

  // ---- 日落 ----
  sunsetTimer: number = SUNSET.BASE_TIME;
  sunsetDuration: number = SUNSET.BASE_TIME;

  // ---- 插值快照 ----
  prev: BirdSnapshot = { x: 0, y: 0, angle: 0, wing: 0.3, phase: 'run', flapPhase: 0 };
  curr: BirdSnapshot = { x: 0, y: 0, angle: 0, wing: 0.3, phase: 'run', flapPhase: 0 };

  /** 本步事件（drainEvents 消费） */
  private events: SimEvent[] = [];

  constructor(readonly seed: number) {
    this.terrain = new Terrain(seed);
    this.reset();
  }

  reset(): void {
    // 开局生在第一个像样的下坡段（Tiny Wings 式起步即有势能可用，避免平地死区）
    let sx = 200;
    for (let x = 200; x < 6000; x += 60) {
      if (this.terrain.slopeAt(x) > 0.12) {
        sx = x;
        break;
      }
    }
    const th0 = this.terrain.tangentAngle(sx);
    this.x = sx;
    this.y = this.terrain.heightAt(sx) - BIRD_R * Math.cos(th0);
    this.vx = 500 * Math.cos(th0);
    this.vy = 500 * Math.sin(th0);
    this.angle = th0;
    this.grounded = true;
    this.phase = 'run';
    this.state = 'cruise';
    this.heatSys.reset();
    this.tumbleT = 0;
    this.score = 0;
    this.coinsTaken = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.level = 1;
    this.maxX = this.x;
    this.maxAlt = 0;
    this.realmCur = 0;
    this.fever = false;
    this.feverT = 0;
    this.feverPerfects = 0;
    this.sunsetDuration = SUNSET.BASE_TIME;
    this.sunsetTimer = SUNSET.BASE_TIME;
    this.events = [];
    this.snapshot();
    this.prev = { ...this.curr };
  }

  /* ---------------- 读数 ---------------- */

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }
  get red(): boolean {
    return this.heatSys.red;
  }
  get dayProgress(): number {
    return clamp(1 - this.sunsetTimer / this.sunsetDuration, 0, 1);
  }
  get nestX(): number {
    return this.terrain.nestX(this.level);
  }
  /** 距下一巢穴的米数 */
  get nestDistanceM(): number {
    return Math.max(0, (this.nestX - this.x) / PX_PER_M);
  }
  get distanceM(): number {
    return this.maxX / PX_PER_M;
  }
  /** 离地高度 px（正下方地表到鸟底） */
  get agl(): number {
    return Math.max(0, this.terrain.heightAt(this.x) - this.y - BIRD_R);
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /* ---------------- 主步进 ---------------- */

  step(held: boolean): void {
    // 保存渲染插值快照
    this.prev = { ...this.curr };
    this.steps++;

    if (this.phase === 'tumble') {
      this.stepTumble();
    } else {
      this.stepRun(held);
    }

    this.snapshot();

    // 日落
    this.sunsetTimer -= STEP;
    if (this.sunsetTimer <= 0 && this.sunsetTimer > -999) {
      this.sunsetTimer = 0;
      this.emit({ type: 'night' });
    }
  }

  private emit(e: SimEvent): void {
    this.events.push(e);
  }

  private snapshot(): void {
    this.curr = {
      x: this.x, y: this.y, angle: this.angle, wing: this.wing,
      phase: this.phase, flapPhase: this.flapPhase,
    };
  }

  /* ---------------- 正常三态 ---------------- */

  private stepRun(held: boolean): void {
    const terrain = this.terrain;

    // ---- 三态判定（零延迟：读的是本步即时输入） ----
    const state: BirdMoveState = held ? 'boost' : this.grounded ? 'cruise' : 'cool';
    this.state = state;

    // ---- 热度（speed01：热量按速度分段计价 —— 攒速便宜，满速昂贵） ----
    const vmaxH = BASE_MAX_SPEED * (this.heatSys.red ? REDHEAT_SPEED_BONUS : 1);
    this.heatSys.update(STEP, state, this.fever, this.speed / vmaxH);
    if (this.heatSys.blowoutTriggered) {
      this.startTumble();
      return;
    }

    // ---- Fever 计时 ----
    if (this.fever) {
      this.feverT -= STEP;
      if (this.feverT <= 0) {
        this.fever = false;
        this.feverPerfects = 0;
        this.emit({ type: 'feverEnd' });
      }
    }

    /* ---- 力阶段（Tiny Wings 压坡模型 + 上坡保底）----
     * 按住 = 重力放大 ×3.5（压坡储能/俯冲）；松开 = 恒定 1× 对称抛物线。
     * 上坡保底在接触投影中实现（见下）。 */
    const gMult = held ? PRESS_G_MULT : 1;
    this.vy += G * gMult * STEP;
    {
      // 空气阻力（几乎无，仅数值稳定）
      const d = Math.exp(-AIR_DRAG * STEP);
      this.vx *= d;
      this.vy *= d;
    }

    // ---- 积分（半隐式欧拉） ----
    this.x += this.vx * STEP;
    this.y += this.vy * STEP;

    /* ---- 地形接触（Tiny Wings 穿透投影模型）----
     * 每步弹道积分后检查与曲线的穿透：侵入 → 吸附 + 速度投影到切线（无弹跳、保留切向）。
     * 平地/凹谷：重力每步把鸟压入曲线 → 投影持续生效 = 贴合滑行；
     * 凸坡顶：地形下弯快于抛物线 → 不穿透 → 自然分离起飞。
     * 没有胶水距离/逃逸速度/按住吸附 —— 按住更重（压坡）只是让抛物线更弯、更晚分离。 */
    const gy = terrain.heightAt(this.x);
    const ntheta = terrain.tangentAngle(this.x);
    const ntx = Math.cos(ntheta);
    const nty = Math.sin(ntheta);
    const nx = Math.sin(ntheta);
    const ny = -Math.cos(ntheta); // 朝上法线
    const wasAir = !this.grounded;
    const vn = this.vx * nx + this.vy * ny; // >0 远离地面，<0 冲向地面
    const penetrating = this.y + BIRD_R >= gy;

    if (penetrating) {
      this.y = gy - BIRD_R * Math.cos(ntheta);
      const impactSpeed = -vn;

      if (wasAir && impactSpeed > 70) {
        const spd = this.speed;
        const { perfect, angleDiffDeg } = judgeLanding(this.vx, this.vy, ntheta, spd);
        this.onLanding(perfect, angleDiffDeg, spd, terrain.materialAt(this.x));
        this.emit({ type: 'landing', perfect, x: this.x, y: this.y, speed: spd, material: terrain.materialAt(this.x) });
      }
      // 速度投影到切线（完全非弹性）+ 极小地面摩擦 + 材质（岩石 ×1.1）
      let vt = this.vx * ntx + this.vy * nty;
      const fric = GROUND_FRICTION * (terrain.materialAt(this.x) === 'rock' ? ROCK_FRICTION_MULT : 1);
      vt *= Math.exp(-fric * STEP);
      // 上坡保底：按住贴地爬坡时切向速度不低于 UPHILL_FLOOR —— 失速退化为慢爬，
      // 「卡在山坳」在数学上不可能（松手不受保底：纯物理失速/滑回，摆锤技巧保留）
      if (held && ntheta < -0.02 && vt < UPHILL_FLOOR) vt = UPHILL_FLOOR;
      this.vx = vt * ntx;
      this.vy = vt * nty;
      this.grounded = true;
    } else {
      // 唇沿弹射（ski-jump 转换）：陡爬升（坡角 ≤ -8°）中带速（>700）离地 →
      // 速度大小不变、方向转换到弹射角（14° + 1.6×坡角，封顶 42°）。
      // 此后 顶点 ∝ v²：速度→高度的对应关系一目了然，高空落回再压坡攒速 = 自我强化的正反馈环
      if (!wasAir && ntheta < -0.14 && this.speed > 700) {
        const ang = Math.min(0.73, 0.24 + Math.abs(ntheta) * 1.6);
        const v = this.speed;
        this.vx = v * Math.cos(ang);
        this.vy = -v * Math.sin(ang);
      }
      this.grounded = false; // 抛物线追不上地形曲率 → 飞行
    }

    // ---- 朝向：贴地咬合坡面切线；空中咬合速度方向。每帧 lerp 0.15（帧率归一） ----
    const targetAngle = this.grounded ? ntheta : this.speed > 90 ? Math.atan2(this.vy, this.vx) : this.angle;
    this.angle = dampAngle(this.angle, targetAngle, 0.15, STEP);

    // ---- 翅膀姿态（视觉状态量，不影响物理） ----
    const wingTarget = state === 'cool' ? 1 : state === 'boost' ? 0.05 : 0.3;
    this.wing = damp(this.wing, wingTarget, 10, STEP);
    this.flapPhase += STEP * (state === 'cool' ? 9 : 5);

    // ---- 速度软顶（红热 +10%）：收敛速率放缓 —— 冲坡末段仍有加速收益感 ----
    const vmax = BASE_MAX_SPEED * (this.red ? REDHEAT_SPEED_BONUS : 1);
    const spd = this.speed;
    if (spd > vmax) {
      const k = Math.exp(-SOFT_CAP_RATE * STEP * (1 - vmax / spd));
      this.vx *= k;
      this.vy *= k;
    }

    // ---- 金币 ----
    this.collectCoins();

    // ---- 巢穴 ----
    if (this.x >= this.nestX) {
      this.score += 500 * this.level;
      this.emit({ type: 'nest', level: this.level, x: this.nestX, y: this.terrain.heightAt(this.nestX) });
      this.level++;
      this.sunsetDuration = Math.max(SUNSET.MIN_TIME, SUNSET.BASE_TIME + (this.level - 1) * SUNSET.PER_LEVEL);
      this.sunsetTimer = this.sunsetDuration;
    }

    // ---- 高度境界：越层横幅 + 分数奖励（挑战更高的动力） ----
    {
      const agl = this.agl;
      if (agl > this.maxAlt) this.maxAlt = agl;
      const ri = realmIndex(agl);
      if (ri > this.realmCur) {
        this.realmCur = ri;
        this.score += REALM_SCORE * (ri + 1);
        this.emit({ type: 'realm', x: this.x, y: this.y, realm: ri });
      } else if (ri < this.realmCur) {
        this.realmCur = ri;
      }
    }

    // ---- 分数与统计（Fever ×2 / 红热 ×1.5：危险与荣华并存的红线福利区） ----
    const scoreMult = this.fever ? 2 : this.red ? HEAT.RED_SCORE_MULT : 1;
    this.score += (spd / PX_PER_M) * STEP * scoreMult;
    this.maxX = Math.max(this.maxX, this.x);
  }

  /* ---------------- 着陆 → Combo / Fever / 涡轮 ---------------- */

  private onLanding(perfect: boolean, angleDiffDeg: number, speed: number, material: 'snow' | 'rock'): void {
    if (perfect) {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.heatSys.perfectLandCool(); // 涡轮冷却 -20
      this.score += 300 * (this.fever ? 2 : 1);
      this.emit({ type: 'perfect', x: this.x, y: this.y, speed, angleDiff: angleDiffDeg, combo: this.combo });

      if (!this.fever && this.combo >= COMBO.FEVER_ENTER) {
        this.fever = true;
        this.feverT = COMBO.FEVER_DURATION;
        this.feverPerfects = 0;
        this.emit({ type: 'feverEnter' });
      } else if (this.fever) {
        this.feverPerfects++;
        if (this.feverPerfects > 0 && this.feverPerfects % COMBO.TURBO_PERFECTS === 0) {
          this.emit({ type: 'turbo', x: this.x, y: this.y }); // 涡轮全开：App 触发 1s 慢放
        }
      }
    } else {
      // 普通着陆打断 combo
      this.combo = 0;
      this.feverPerfects = 0;
    }
  }

  /* ---------------- 爆燃（零死亡：原地爆炸 5s 惩罚） ---------------- */

  private startTumble(): void {
    this.phase = 'tumble';
    this.tumbleT = 0;
    this.combo = 0;
    this.feverPerfects = 0;
    this.vx = 0;
    this.vy = 0; // 原地爆炸：速度清零，位置冻结
    this.grounded = false;
    if (this.fever) {
      this.fever = false;
      this.emit({ type: 'feverEnd' });
    }
    this.emit({ type: 'blowout', x: this.x, y: this.y, groundY: this.terrain.heightAt(this.x) });
  }

  private stepTumble(): void {
    this.tumbleT += STEP;
    // 原地宕机：只缓慢摆正朝向，无物理
    this.angle = dampAngle(this.angle, this.terrain.tangentAngle(this.x), 2, STEP);
    this.wing = damp(this.wing, 0, 12, STEP);

    if (this.tumbleT >= BLOWOUT.TIME) {
      // 凤凰复燃：惩罚 = 3s 冻禁 + combo 清零 + 速度归零，绝不附赠「困死深坑」——
      // 越过前方第一道围挡的坡顶，在其后的下坡重生（立即回场的动能）
      let px = this.x;
      let sawClimb = false;
      for (let dx = 100; dx <= 4200; dx += 50) {
        const x = this.x + dx;
        const sl = this.terrain.slopeAt(x);
        if (!sawClimb && sl < -0.08) sawClimb = true; // 先爬上围挡的墙（slope<0 = 上坡）
        else if (sawClimb && sl > 0.08) {
          px = x + 120; // 越过墙顶（slope 转 + = 下坡）→ 墙后重生
          break;
        }
      }
      this.phase = 'run';
      const th = this.terrain.tangentAngle(px);
      this.x = px;
      this.y = this.terrain.heightAt(px) - BIRD_R * Math.cos(th);
      this.grounded = true;
      this.angle = th;
      this.vx = 700 * Math.cos(th); // 复燃起步（配合上坡保底：坑内也能按住爬出）
      this.vy = 700 * Math.sin(th);
      this.heatSys.startImmunity();
      this.emit({ type: 'blowoutEnd', x: this.x, y: this.y });
    }
  }

  /** 爆燃已进行时长 s（演出驱动） */
  get boomElapsed(): number {
    return this.tumbleT;
  }

  /* ---------------- 金币 ---------------- */

  private collectCoins(): void {
    const range = COIN.PICKUP_RADIUS * (this.red ? COIN.RED_MAGNET_MULT : 1);
    const coins = this.terrain.coinsInRange(this.x - 300, this.x + 600);
    for (const c of coins) {
      if (c.taken) continue;
      const d = Math.hypot(c.x - this.x, c.y - this.y);
      if (d < range) {
        c.taken = true;
        this.coinsTaken++;
        this.score += COIN.VALUE * (this.fever ? 2 : 1);
        this.emit({ type: 'coin', x: c.x, y: c.y, combo: this.coinsTaken });
      }
    }
  }

  /* ---------------- 回放采样（测试用） ---------------- */

  sample(): number[] {
    return [
      Math.round(this.x * 100) / 100,
      Math.round(this.y * 100) / 100,
      Math.round(this.vx * 100) / 100,
      Math.round(this.vy * 100) / 100,
      Math.round(this.heatSys.heat * 100) / 100,
      this.combo,
      Math.round(this.score),
      this.coinsTaken,
    ];
  }
}
