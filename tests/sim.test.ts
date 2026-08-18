import { describe, it, expect } from 'vitest';
import { Sim, judgeLanding } from '../src/sim/game';
import { BIRD_R, PERFECT_MIN_SPEED, BASE_MAX_SPEED, REDHEAT_SPEED_BONUS } from '../src/core/constants';

const rad = (deg: number) => (deg * Math.PI) / 180;

describe('完美着陆判定（纯函数）', () => {
  it('速度方向贴合坡面 + 高速 → 完美', () => {
    // 坡面 10° 下坡，速度沿坡 900px/s
    const r = judgeLanding(900 * Math.cos(rad(10)), 900 * Math.sin(rad(10)), rad(10), 900);
    expect(r.perfect).toBe(true);
    expect(r.angleDiffDeg).toBeLessThan(0.5);
  });

  it('角度差 >15° → 普通（即使高速）', () => {
    // 垂直砸向 0° 平地：速度角 90°，差 90°
    const r = judgeLanding(0, 800, 0, 800);
    expect(r.perfect).toBe(false);
    // 差 20°
    const r2 = judgeLanding(900 * Math.cos(rad(20)), 900 * Math.sin(rad(20)), 0, 900);
    expect(r2.perfect).toBe(false);
    // 差 14.9° → 完美
    const r3 = judgeLanding(900 * Math.cos(rad(14.9)), 900 * Math.sin(rad(14.9)), 0, 900);
    expect(r3.perfect).toBe(true);
  });

  it('速度低于阈值 → 普通', () => {
    const r = judgeLanding(PERFECT_MIN_SPEED - 10, 0, 0, PERFECT_MIN_SPEED - 10);
    expect(r.perfect).toBe(false);
  });

  it('负角坡面（上坡）判定对称', () => {
    const th = rad(-12);
    const r = judgeLanding(600 * Math.cos(th), 600 * Math.sin(th), th, 600);
    expect(r.perfect).toBe(true);
  });
});

describe('Sim 物理（Tiny Wings 贴地循环）', () => {
  it('初始状态：贴地、在巢穴起点前、热度 0', () => {
    const s = new Sim(1);
    expect(s.grounded).toBe(true);
    expect(s.heatSys.heat).toBe(0);
    expect(s.x).toBeGreaterThanOrEqual(200); // 生于下坡段（避免平地死区）
  });

  it('不按键时，贴地滑行不爆炸、能量有界（重力做功守恒近似）', () => {
    const s = new Sim(3);
    let maxSpeed = 0;
    for (let i = 0; i < 120 * 20; i++) {
      s.step(false);
      maxSpeed = Math.max(maxSpeed, s.speed);
    }
    expect(maxSpeed).toBeGreaterThan(100); // 仍在滚动（重型节奏：加速慢但持续推进）
    expect(maxSpeed).toBeLessThan(BASE_MAX_SPEED * 1.15); // 没有无限加速
    expect(s.phase).toBe('run'); // 没死（不存在死亡）
  });

  it('持续按住 30s：物理稳定、热度被钳制在 100 内、不死亡（爆燃 3s 冻结也计入）', () => {
    const s = new Sim(7);
    let maxHeat = 0;
    let maxSpeed = 0;
    let returnedToRun = false;
    let sawBlowout = false;
    for (let i = 0; i < 120 * 30; i++) {
      s.step(true);
      maxHeat = Math.max(maxHeat, s.heatSys.heat);
      maxSpeed = Math.max(maxSpeed, s.speed);
      for (const e of s.drainEvents()) if (e.type === 'blowout') sawBlowout = true;
      if (sawBlowout && s.phase === 'run') returnedToRun = true; // 爆燃后必然复活
    }
    expect(maxHeat).toBeLessThanOrEqual(100);
    expect(maxSpeed).toBeGreaterThan(100); // 攒到过速度（含爆燃冻结期）
    expect(sawBlowout ? returnedToRun : true).toBe(true); // 零死亡：若爆燃过，冻结结束必然恢复控制
  });

  it('热度到顶 → 原地爆炸 5s 惩罚 → 免热 1s → 恢复（零死亡闭环）', () => {
    const s = new Sim(11);
    // 预热到 99 再按住：必然爆燃（完美着陆冷却来不及救）
    s.heatSys.heat = 99;
    let sawBlowout = false;
    let tumbleSteps = 0;
    let immunityAt = -1;
    let steps = 0;
    let boomPos: { x: number; y: number } | null = null;
    let endPos: { x: number; y: number } | null = null;
    for (let i = 0; i < 120 * 9; i++) {
      s.step(true);
      steps++;
      if (s.phase === 'tumble') tumbleSteps++;
      for (const e of s.drainEvents()) {
        if (e.type === 'blowout') {
          sawBlowout = true;
          boomPos = { x: e.x!, y: e.y! };
        }
        if (e.type === 'blowoutEnd') {
          immunityAt = steps;
          endPos = { x: e.x!, y: e.y! };
        }
      }
    }
    expect(sawBlowout).toBe(true);
    expect(immunityAt).toBeGreaterThan(0);
    expect(s.heatSys.immunity).toBeLessThanOrEqual(1); // 免热已开（或已消耗）
    expect(tumbleSteps).toBeGreaterThan(120 * 2.5); // 原地爆炸 ≈ 3s
    expect(tumbleSteps).toBeLessThan(120 * 3.7);
    expect(s.phase).toBe('run'); // 惩罚结束回到正常
    // 原地：爆燃期间位置冻结；结束时可「凤凰复燃」前移（越过围挡坡顶），绝不后退
    expect(endPos).not.toBeNull();
    expect(endPos!.x).toBeGreaterThanOrEqual(boomPos!.x - 5);
    // 复燃点在下坡上（立即回场的动能）
    expect(s.terrain.slopeAt(endPos!.x)).toBeGreaterThan(0.05);
  });

  it('红热时速度上限 +10%（诱惑设计）', () => {
    const s = new Sim(13);
    s.heatSys.heat = 85; // 直接进入红热
    let maxSpd = 0;
    for (let i = 0; i < 120 * 8; i++) {
      s.step(true);
      maxSpd = Math.max(maxSpd, s.speed);
      if (s.heatSys.blowoutTriggered) break;
    }
    // 硬顶：稳态不得超过 红热上限
    expect(maxSpd).toBeLessThanOrEqual(BASE_MAX_SPEED * REDHEAT_SPEED_BONUS + 1);
  });

  it('着陆事件必然带 perfect 布尔值；普通着陆打断 combo', () => {
    const s = new Sim(17);
    let landed = 0;
    s.combo = 2; // 伪造 combo
    for (let i = 0; i < 120 * 15; i++) {
      // 制造「高速按住 + 偶尔松手」的腾空节奏
      s.step(i % 240 < 180);
      for (const e of s.drainEvents()) {
        if (e.type === 'landing') {
          landed++;
          expect(typeof e.perfect).toBe('boolean');
          if (!e.perfect) expect(s.combo).toBe(0);
        }
      }
    }
    expect(landed).toBeGreaterThan(0);
  });

  it('金币拾取增加计数与分数', () => {
    const s = new Sim(19);
    // 找到一枚未拿的金币，把鸟传送过去
    const coins = s.terrain.coinsInRange(0, 4000).filter((c) => !c.taken);
    if (coins.length > 0) {
      const c = coins[0];
      s.x = c.x;
      s.y = c.y - BIRD_R; // 贴币
      s.step(false);
      expect(s.coinsTaken).toBe(1);
      expect(s.score).toBeGreaterThanOrEqual(100);
    }
  });

  it('到达巢穴 → level+1、日落计时重置、nest 事件', () => {
    const s = new Sim(23);
    s.sunsetTimer = 30;
    const before = s.sunsetDuration;
    s.x = s.terrain.nestX(s.level) - 1;
    s.step(false);
    expect(s.level).toBe(2);
    expect(s.sunsetTimer).toBeGreaterThan(30); // 重置为新时长
    expect(before).toBeGreaterThan(0);
  });

  it('日落归零 → night 事件', () => {
    const s = new Sim(29);
    s.sunsetTimer = 0.05;
    let night = false;
    for (let i = 0; i < 30; i++) {
      s.step(false);
      for (const e of s.drainEvents()) if (e.type === 'night') night = true;
    }
    expect(night).toBe(true);
  });

  it('上坡保底速度：低速按住爬陡坡永不失速，必然翻过（卡坡死局的根治）', () => {
    const s = new Sim(13);
    const t = s.terrain;
    let ux = -1;
    for (let x = 1000; x < 20000; x += 40) {
      if (t.slopeAt(x) < -0.35 && t.slopeAt(x - 200) < -0.1) {
        ux = x;
        break;
      }
    }
    expect(ux).toBeGreaterThan(0);
    const th = t.tangentAngle(ux);
    s.x = ux;
    s.y = t.heightAt(ux) - BIRD_R * Math.cos(th);
    s.vx = 100 * Math.cos(th);
    s.vy = 100 * Math.sin(th);
    s.grounded = true;
    s.phase = 'run';
    let minClimbSpeed = Infinity;
    let crested = false;
    for (let i = 0; i < 120 * 10; i++) {
      s.step(true); // 全程按住（最差玩法）
      if (s.grounded && t.slopeAt(s.x) < -0.02) {
        minClimbSpeed = Math.min(minClimbSpeed, s.speed);
      }
      if (s.x > ux + 700 && t.slopeAt(s.x) > 0) {
        crested = true; // 翻过坡顶进入下坡
        break;
      }
      s.drainEvents();
    }
    expect(minClimbSpeed).toBeGreaterThanOrEqual(415); // 保底 420 生效
    expect(crested).toBe(true); // 必然翻过
  });

  it('角度贴合：持续贴地滑行时鸟角 ≈ 坡面切线角', () => {
    const s = new Sim(31);
    let checked = false;
    let groundedRun = 0;
    for (let i = 0; i < 120 * 10 && !checked; i++) {
      s.step(false);
      groundedRun = s.grounded ? groundedRun + 1 : 0;
      if (groundedRun > 36 && s.speed > 150) {
        // 贴地稳定 0.3s 后再断言（刚着陆时角度仍在追赶）
        const diff = Math.abs(s.angle - s.terrain.tangentAngle(s.x));
        expect(Math.min(diff, Math.abs(diff - Math.PI * 2))).toBeLessThan(0.25); // ~14° 内
        checked = true;
      }
    }
    expect(checked).toBe(true); // 10 秒内必然出现稳定贴地滑行窗口
  });
});
