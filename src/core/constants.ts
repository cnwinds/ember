/**
 * 全局数值表 —— 所有调参集中于此（README「数值表」的单一来源）。
 * 改手感只改这里，禁止在系统内散落魔法数。
 */

/** 固定物理步长：120Hz（不同刷新率手感一致） */
export const STEP = 1 / 120;

/* ---------- 重力与压坡（完全复刻 Tiny Wings 控制模型） ----------
 * 单键 = 「压坡」：按住时重力放大（非推力），沿坡面分解——下坡强加速、上坡强减速、平地压紧；
 * 松开时恒定 1× 重力做对称抛物线，飞行高度 100% 来自坡道动能转换（无襟翼/无上旋/无不对称）。 */
export const G = 1280;
/** 按住时的重力放大倍率（压坡）：3.0 —— 提速过程更绵长（时间常数拉长，速度是慢资产） */
export const PRESS_G_MULT = 3.0;
/** 上坡保底速度 px/s：按住贴地爬坡时，切向速度不低于此值 —— 失速退化为「慢爬」而非死局，
 *  任何坡任何按法都困不死（松手仍是纯物理：可失速、可滑回，摆锤技巧保留） */
export const UPHILL_FLOOR = 420;
/** 空气阻力（指数，几乎无——抛物线可预测性优先） */
export const AIR_DRAG = 0.02;
/** 地面摩擦（指数，几乎无——速度损失只来自上坡重力） */
export const GROUND_FRICTION = 0.004;

/* ---------- 速度上限 ---------- */
/** 软顶 px/s（红热 ×1.10 → 3080）。放宽上限 + 收敛速率放缓（SOFT_CAP_RATE）：
 *  冲坡末段仍有「还在涨」的收益感，速度是持续积累的资产 */
export const BASE_MAX_SPEED = 2800;
/** 超过软顶后的收敛速率（1/s，指数）—— 越小越「软」，越能感到接近上限时仍在加速 */
export const SOFT_CAP_RATE = 1.1;
/** 红热（80+）速度上限加成 ×1.10 —— 诱惑设计的核心 */
export const REDHEAT_SPEED_BONUS = 1.1;

/* ---------- 热度系统 ---------- */
export const HEAT = {
  /** 加速态积热下限 +4/s（低速攒速期几乎免费 —— 投资阶段不该被罚款） */
  BOOST_RATE_MIN: 4,
  /** 加速态积热上限 +16/s（仅满速红热区间到达）：
   *  热度是「满速生存的成本」，不是「攒速的罚款」—— 爆燃只惩罚贪婪，不惩罚勤奋 */
  BOOST_RATE_MAX: 16,
  /** 巡航态散热 -8/s */
  CRUISE_RATE: -8,
  /** 散热态基础散热 -12/s */
  COOL_RATE_BASE: -12,
  /** 风阻冷却：高速滑翔散热上限 -24/s —— 大飞行本身就是极速散热器，爽点即冷却 */
  COOL_RATE_MAX: -24,
  /** 红热阈值：速度上限+10%、×1.5 分数、屏幕抖动、vignette、心跳声、金币磁吸×1.5 */
  RED_THRESHOLD: 80,
  /** 红热分数倍率（危险与荣华并存的福利区） */
  RED_SCORE_MULT: 1.5,
  /** 爆燃阈值 */
  BLOWOUT_THRESHOLD: 100,
  /** 完美着陆「涡轮冷却」-20 热度 */
  PERFECT_LAND_COOL: 20,
  /** Fever 期间积热 ×1.25 */
  FEVER_HEAT_MULT: 1.25,
  /** 爆燃结束后的免热时长 s（热度保持 0、不积热） */
  IMMUNITY_TIME: 1.0,
} as const;

/* ---------- 完美着陆 / Combo / Fever ---------- */
/** 完美着陆角度容差（度）：鸟速度方向与坡面切线夹角 */
export const PERFECT_ANGLE_TOL_DEG = 15;
/** 完美着陆最低速度 px/s */
export const PERFECT_MIN_SPEED = 520;
/** 判定提示圈提前量 s */
export const PREDICT_RING_LEAD = 0.5;

export const COMBO = {
  /** 连续 3 次完美着陆进 Fever */
  FEVER_ENTER: 3,
  /** Fever 持续 s */
  FEVER_DURATION: 8,
  /** Fever 内再连续 3 次完美着陆触发「涡轮全开」 */
  TURBO_PERFECTS: 3,
  /** 涡轮全开慢放时长 s */
  TURBO_TIME: 1.0,
  /** 涡轮全开时间缩放 */
  TURBO_TIMESCALE: 0.4,
} as const;

/* ---------- 爆燃（零死亡哲学：原地爆炸 5s 惩罚，无全屏旋转） ---------- */
export const BLOWOUT = {
  /** 原地爆炸时长 s：无控制的惩罚窗口（爆炸演出 + 焦黑宕机 + 复燃） */
  TIME: 3.0,
  /** 爆炸瞬间慢放（时间缩放 × 持续真实秒） */
  SLOWMO_SCALE: 0.4,
  SLOWMO_TIME: 0.25,
} as const;

/* ---------- 演出 ---------- */
/** 完美着陆 hit-stop 冻结时长（2 帧 @60fps） */
export const HITSTOP_TIME = 2 / 60;
/** hit-stop 白闪时长 s */
export const FLASH_TIME = 0.08;

/* ---------- 日落与关卡 ---------- */
export const SUNSET = {
  /** 第 1 关日落倒计时 s */
  BASE_TIME: 75,
  /** 每关递减 s */
  PER_LEVEL: -5,
  /** 下限 s */
  MIN_TIME: 55,
  /** 最后 N 秒天空进入「深红危机」阶段 */
  DUSK_LAST_SECONDS: 15,
} as const;

export const LEVEL = {
  /** 第 1 关巢穴距离 px */
  BASE_DIST: 24000,
  /** 每关递增 px */
  PER_LEVEL: 4000,
  /** 上限 px */
  MAX_DIST: 52000,
} as const;

/* ---------- 金币 ---------- */
export const COIN = {
  VALUE: 100,
  RADIUS: 15,
  /** 基础吸收半径 px（鸟中心到币中心） */
  PICKUP_RADIUS: 42,
  /** 红热（80+）吸收半径 ×1.5 */
  RED_MAGNET_MULT: 1.5,
} as const;

/* ---------- 鸟 ---------- */
export const BIRD_R = 21;

/* ---------- 物理/地形 ---------- */
/** 地形控制点间距 px */
export const TERRAIN_CP_W = 260;
/** 全局下行趋势（dy/dx）：Tiny Wings 岛屿整体向前的缓下坡。任何失速的鸟都会被趋势
 *  带着往前滑重新攒能 —— 「卡死在谷底」在数学上不可能（平地死区的根治）。
 *  0.08 ≈ 4.6°：松手自流 105px/s²、按住 372px/s² 的永续前向分量 */
export const TERRAIN_GRADIENT = 0.08;
/** 相邻控制点最大高差 px（限制坡度）。165/260 ≈ 32° 平均坡——深谷+陡唇沿，
 *  Tiny Wings 式「下坡攒速 → 唇沿发射」的地形前提 */
export const TERRAIN_MAX_DELTA = 165;
/** 岩石坡判定坡度阈值 |dy/dx|（调高：陡段更常见，只有真正陡的地方才是岩石） */
export const ROCK_SLOPE_THRESHOLD = 0.75;
/** 岩石坡摩擦倍率（相对雪坡 +10%） */
export const ROCK_FRICTION_MULT = 1.1;

/* ---------- 粒子 ---------- */
export const PARTICLES = {
  /** 尾焰活跃粒子上限（硬约束） */
  FLAME_MAX: 256,
  /** 全池上限（所有 kind 合计） */
  TOTAL_MAX: 900,
  /** 屏外剔除边距 px */
  CULL_MARGIN: 160,
  /** 低帧率降级：粒子密度系数 */
  LOW_FPS_DENSITY: 0.7,
  /** 低帧率降级：视差层数 4→3 */
  LOW_FPS_PARALLAX_LAYERS: 3,
  /** 触发降级的 fps 阈值 */
  LOW_FPS_THRESHOLD: 55,
} as const;

/** 米换算：50px = 1m（HUD 距离显示用） */
export const PX_PER_M = 50;

/* ---------- 高度境界（挑战阶梯：越层 = 横幅 + 升调音阶 + 分数奖励） ---------- */
export interface RealmDef {
  /** 离地高度阈值 px（AGL） */
  min: number;
  name: string;
}

export const REALMS: RealmDef[] = [
  { min: 0, name: '山麓' },
  { min: 180, name: '低云' },
  { min: 350, name: '云海' },
  { min: 550, name: '平流层' },
  { min: 800, name: '中间层' },
  { min: 1100, name: '外太空' },
];

/** AGL → 境界序号 */
export function realmIndex(agl: number): number {
  let idx = 0;
  for (let i = 0; i < REALMS.length; i++) {
    if (agl >= REALMS[i].min) idx = i;
  }
  return idx;
}

/** 越层分数奖励 = REALM_SCORE × (层号+1) */
export const REALM_SCORE = 150;
