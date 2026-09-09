/**
 * HUD —— 顶部热度条 / combo / 分数 / 日落倒计时 / 巢穴距离。
 *
 * - 热度条与尾焰共用同一 lerp 色阶（palette.FLAME_STOPS）—— 余光读数
 * - 80 处红线段 + 红区背景；80+ 正弦脉动（透明度 0.7–1.0）
 * - combo 数字 1.5 倍弹跳回弹；Fever 白焰装饰 + 计时线
 * - hit-stop 期间 HUD 照常渲染（演出优先于信息，主角冻结但信息不冻结）
 * - HUD 永不随相机抖动/旋转
 */

import { flameColor, withA } from './palette';
import { clamp } from '../core/mathutil';
import { HEAT, REALMS, realmIndex } from '../core/constants';
import { themeForLevel } from './palette';

export interface HudState {
  heat: number;
  immune: boolean;
  combo: number;
  maxCombo: number;
  score: number;
  coins: number;
  fever: boolean;
  feverT: number; // 剩余
  feverDur: number;
  sunsetT: number;
  sunsetDur: number;
  nestDistanceM: number;
  level: number;
  distanceM: number;
  /** 当前离地高度 px */
  agl: number;
  /** 主题渲染的关卡号（默认 = level） */
  themeLevel?: number;
}

export class HUD {
  private w = 0;
  private h = 0;
  /** 刘海屏安全区（横屏时左右 insets 避开刘海/打孔；resize 时由 App 写入） */
  inset = { l: 0, t: 0, r: 0 };
  /** combo 弹跳动画（1=静止；触发时跳到 1.5 弹回） */
  private comboPop = 1;
  private perfectFlashT = 0;
  private turboBannerT = 0;
  private dpr = 1;
  /** 境界横幅：名称 + 计时 */
  private realmBanner = { name: '', t: 0, idx: 0 };

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
  }

  onPerfect(combo: number): void {
    // 1.5 倍弹跳回弹（弹簧衰减）
    this.comboPop = 1.5 + Math.min(combo, 6) * 0.06;
    this.perfectFlashT = 0.6;
  }
  onTurbo(): void {
    this.turboBannerT = 1.6;
  }
  /** 越层横幅（外太空更宏大） */
  onRealm(idx: number): void {
    this.realmBanner = { name: REALMS[idx]?.name ?? '未知之境', t: 1.8, idx };
  }

  update(dt: number): void {
    this.comboPop += (1 - this.comboPop) * Math.min(1, dt * 9);
    this.perfectFlashT = Math.max(0, this.perfectFlashT - dt);
    this.turboBannerT = Math.max(0, this.turboBannerT - dt);
    this.realmBanner.t = Math.max(0, this.realmBanner.t - dt);
  }

  /* ---------------- 游玩 HUD ---------------- */

  draw(ctx: CanvasRenderingContext2D, s: HudState, time: number): void {
    ctx.save();
    ctx.textBaseline = 'middle';
    const uiScale = clamp(this.w / 1280, 0.72, 1.15);

    // ===== 热度条（顶部中央） =====
    const bw = 300 * uiScale;
    const bh = 15 * uiScale;
    const bx = this.w / 2 - bw / 2;
    const by = 18 * uiScale + this.inset.t;

    // 底槽
    ctx.fillStyle = 'rgba(48,30,24,0.4)';
    this.roundRect(ctx, bx - 3, by - 3, bw + 6, bh + 6, 9 * uiScale);
    ctx.fill();

    // 80+ 脉动（0.7–1.0）
    const red = s.heat >= HEAT.RED_THRESHOLD;
    const pulse = red ? 0.7 + Math.sin(time * 7.5) * 0.15 + 0.15 : 1;
    ctx.globalAlpha = pulse;

    // 分段填充（10 段，段间 1px 缝 —— 手绘感 & 可读性）
    const segs = 10;
    const segW = (bw - (segs - 1) * 1.5) / segs;
    for (let i = 0; i < segs; i++) {
      const segStart = i / segs;
      const segEnd = (i + 1) / segs;
      const fill = clamp((s.heat / 100 - segStart) / (segEnd - segStart), 0, 1);
      if (fill <= 0) continue;
      const midHeat = (segStart + segEnd) / 2;
      ctx.fillStyle = flameColor(midHeat);
      ctx.globalAlpha = pulse * 0.92;
      this.roundRect(ctx, bx + i * (segW + 1.5), by, segW * fill, bh, 3 * uiScale);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 80 红线段
    const redX = bx + bw * 0.8;
    ctx.fillStyle = 'rgba(255,64,64,0.95)';
    ctx.fillRect(redX - 1, by - 6 * uiScale, 3, bh + 12 * uiScale);
    // 红区背景提示
    ctx.fillStyle = 'rgba(255,64,64,0.10)';
    this.roundRect(ctx, redX + 2, by - 3, bx + bw - redX - 2, bh + 6, 6 * uiScale);
    ctx.fill();

    // 红热区：从「警告」重新定位为「危险与荣华并存」—— 分数倍率标识
    if (s.heat >= HEAT.RED_THRESHOLD && !s.fever) {
      ctx.textAlign = 'left';
      ctx.font = `900 ${12 * uiScale}px system-ui`;
      ctx.fillStyle = `rgba(214,64,54,${(0.65 + Math.sin(time * 7.5) * 0.3).toFixed(2)})`;
      ctx.fillText(`红热 ×1.5`, bx + bw + 14 * uiScale, by + bh / 2);
    }

    // 免热标识
    if (s.immune) {
      ctx.fillStyle = withA('190,235,255', 0.85);
      ctx.font = `bold ${11 * uiScale}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText('散热保护', this.w / 2, by + bh + 12 * uiScale);
    }

    // Fever：两侧白焰装饰 + 计时线
    if (s.fever) {
      this.drawFlameGlyph(ctx, bx - 16 * uiScale, by + bh / 2, 10 * uiScale, time);
      this.drawFlameGlyph(ctx, bx + bw + 16 * uiScale, by + bh / 2, 10 * uiScale, time + 0.5);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(bx, by + bh + 5, bw * clamp(s.feverT / s.feverDur, 0, 1), 2.5);
    }

    // ===== 分数（左上） =====
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(56,34,28,0.85)';
    ctx.font = `900 ${30 * uiScale}px system-ui`;
    ctx.fillText(`${Math.floor(s.score)}`, 22 * uiScale + this.inset.l, 30 * uiScale + this.inset.t);
    // 金币
    this.drawCoinIcon(ctx, 26 * uiScale + this.inset.l, 58 * uiScale + this.inset.t, 8 * uiScale);
    ctx.fillStyle = 'rgba(56,34,28,0.8)';
    ctx.font = `700 ${16 * uiScale}px system-ui`;
    ctx.fillText(`${s.coins}`, 42 * uiScale + this.inset.l, 58 * uiScale + this.inset.t);
    // 关卡
    ctx.fillStyle = 'rgba(56,34,28,0.55)';
    ctx.font = `700 ${12 * uiScale}px system-ui`;
    ctx.fillText(`第 ${s.level} 天 · ${themeForLevel(s.themeLevel ?? s.level).name}`, 22 * uiScale + this.inset.l, 80 * uiScale + this.inset.t);

    // ===== 日落倒计时（右上） =====
    const dusk = s.sunsetT <= 15;
    const tColor = dusk ? (Math.sin(time * 8) > 0 ? 'rgba(232,64,54,1)' : 'rgba(160,40,44,1)') : 'rgba(56,34,28,0.85)';
    ctx.textAlign = 'right';
    ctx.fillStyle = tColor;
    ctx.font = `900 ${26 * uiScale}px system-ui`;
    ctx.fillText(`${s.sunsetT.toFixed(1)}s`, this.w - 24 * uiScale - this.inset.r, 30 * uiScale + this.inset.t);
    // 太阳小图标
    this.drawSunIcon(ctx, this.w - 24 * uiScale - this.inset.r - ctx.measureText(`${s.sunsetT.toFixed(1)}s`).width - 22 * uiScale, 30 * uiScale + this.inset.t, 10 * uiScale, 1 - s.sunsetT / s.sunsetDur);
    // 巢穴距离
    ctx.fillStyle = 'rgba(56,34,28,0.7)';
    ctx.font = `700 ${15 * uiScale}px system-ui`;
    ctx.fillText(`巢 ${Math.ceil(s.nestDistanceM)}m`, this.w - 24 * uiScale - this.inset.r, 58 * uiScale + this.inset.t);
    // 实时高度 + 境界（高空才显示 —— 余光即可确认「现在在哪一层」）
    if (s.agl > 150) {
      const ri = realmIndex(s.agl);
      const climbing = Math.sin(time * 6) > 0;
      ctx.fillStyle = ri >= 3 ? 'rgba(70,90,160,0.95)' : 'rgba(56,34,28,0.65)';
      ctx.font = `800 ${15 * uiScale}px system-ui`;
      ctx.fillText(`${climbing ? '↗' : '↘'} ${s.agl | 0} · ${REALMS[ri].name}`, this.w - 24 * uiScale - this.inset.r, 82 * uiScale + this.inset.t);
    }

    // ===== Combo（热度条下方中央） =====
    if (s.combo >= 2) {
      ctx.save();
      ctx.translate(this.w / 2, by + bh + 34 * uiScale);
      ctx.scale(this.comboPop, this.comboPop);
      ctx.textAlign = 'center';
      ctx.fillStyle = s.fever ? '#ffffff' : 'rgba(56,34,28,0.9)';
      ctx.strokeStyle = 'rgba(56,34,28,0.35)';
      ctx.lineWidth = 1.5;
      ctx.font = `900 ${26 * uiScale}px system-ui`;
      ctx.fillText(`×${s.combo}`, 0, 0);
      ctx.restore();
    }
    // PERFECT! 闪现
    if (this.perfectFlashT > 0) {
      const a = clamp(this.perfectFlashT / 0.6, 0, 1);
      ctx.textAlign = 'center';
      ctx.fillStyle = withA('150,110,30', a * 0.9);
      ctx.font = `900 ${15 * uiScale}px system-ui`;
      ctx.fillText('PERFECT', this.w / 2, by + bh + 14 * uiScale);
    }
    // 涡轮全开横幅
    if (this.turboBannerT > 0) {
      const a = clamp(this.turboBannerT / 1.6, 0, 1);
      const pop2 = 1 + (1 - a) * 0.2;
      ctx.save();
      ctx.translate(this.w / 2, this.h * 0.3);
      ctx.scale(pop2, pop2);
      ctx.textAlign = 'center';
      ctx.fillStyle = withA('255,255,255', a);
      ctx.font = `900 ${44 * uiScale}px system-ui`;
      ctx.fillText('涡轮全开！', 0, 0);
      ctx.restore();
    }
    // 高度境界横幅（挑战阶梯的正反馈时刻；外太空更宏大）
    if (this.realmBanner.t > 0) {
      const rb = this.realmBanner;
      const t = 1 - rb.t / 1.8;
      const a = Math.sin(clamp(t, 0, 1) * Math.PI);
      const rise = (1 - a) * -26;
      const big = rb.idx >= 5 ? 54 : rb.idx >= 3 ? 42 : 32;
      ctx.save();
      ctx.translate(this.w / 2, this.h * 0.36 + rise);
      ctx.textAlign = 'center';
      ctx.font = `900 ${big * uiScale}px system-ui`;
      ctx.fillStyle = withA('255,255,255', a * 0.95);
      ctx.strokeStyle = withA('40,30,50', a * 0.5);
      ctx.lineWidth = 4;
      ctx.strokeText(rb.name, 0, 0);
      ctx.fillText(rb.name, 0, 0);
      ctx.font = `700 ${15 * uiScale}px system-ui`;
      ctx.fillStyle = withA('255,255,255', a * 0.8);
      ctx.fillText(`高度境界 +${150 * (rb.idx + 1)}`, 0, 30 * uiScale);
      ctx.restore();
    }
    ctx.restore();
    void this.dpr;
  }

  /* ---------------- 场景文字辅助（标题/结算/演出，App 调用） ---------------- */

  drawTitle(ctx: CanvasRenderingContext2D, time: number, best: number, daily: boolean): void {
    const cx = this.w / 2;
    ctx.save();
    ctx.textAlign = 'center';
    // 标题鸟剪影 + 尾焰（程序化绘制，无图片资源）
    const birdY = this.h * 0.18 + Math.sin(time * 1.2) * 8;
    this.drawTitleBird(ctx, cx, birdY, time);
    // 标题
    const ty = this.h * 0.3 + Math.sin(time * 1.4) * 6;
    ctx.font = `900 ${Math.min(84, this.w * 0.09)}px system-ui`;
    ctx.fillStyle = 'rgba(64,38,32,0.92)';
    ctx.fillText('熔岩尾焰鸟', cx, ty);
    ctx.font = `800 ${Math.min(26, this.w * 0.03)}px system-ui`;
    ctx.fillStyle = 'rgba(64,38,32,0.6)';
    ctx.fillText('EMBER', cx, ty + 42);
    // 操作提示（无教程文字原则：图标 + 动词）
    const hy = this.h * 0.62;
    ctx.font = `700 ${17}px system-ui`;
    ctx.fillStyle = 'rgba(64,38,32,0.8)';
    ctx.fillText('按住 —— 俯冲加速 · 松开 —— 展翅散热', cx, hy);
    ctx.fillStyle = 'rgba(64,38,32,0.55)';
    ctx.font = `600 ${14}px system-ui`;
    ctx.fillText(`${daily ? '每日挑战 · ' : ''}空格 / 触屏 开始`, cx, hy + 30);
    if (best > 0) {
      ctx.fillStyle = 'rgba(64,38,32,0.5)';
      ctx.fillText(`最佳 ${Math.floor(best)}`, cx, hy + 56);
    }
    ctx.restore();
  }

  drawGameOver(
    ctx: CanvasRenderingContext2D,
    score: number,
    best: number,
    coins: number,
    maxCombo: number,
    distM: number,
    newBest: boolean,
    time: number,
    maxAlt = 0,
    bestAlt = 0
  ): void {
    ctx.save();
    // 夜幕渐入
    ctx.fillStyle = 'rgba(16,12,32,0.72)';
    ctx.fillRect(0, 0, this.w, this.h);
    const cx = this.w / 2;
    ctx.textAlign = 'center';
    // 小鸟剪影（悲伤熄火态）
    this.drawResultBird(ctx, cx - this.w * 0.25, this.h * 0.26, time);
    ctx.fillStyle = 'rgba(240,230,240,0.95)';
    ctx.font = `900 ${Math.min(56, this.w * 0.06)}px system-ui`;
    ctx.fillText('夜幕降临', cx, this.h * 0.28);
    ctx.font = `800 ${26}px system-ui`;
    ctx.fillStyle = 'rgba(255,213,79,0.95)';
    ctx.fillText(`${Math.floor(score)} 分${newBest ? '  · 新纪录！' : ''}`, cx, this.h * 0.4);
    // 最高境界（挑战高度的荣誉行）
    const realm = REALMS[realmIndex(maxAlt)].name;
    const altNew = maxAlt >= bestAlt;
    ctx.font = `700 ${18}px system-ui`;
    ctx.fillStyle = 'rgba(190,210,255,0.95)';
    ctx.fillText(
      `最高飞行 ${maxAlt | 0} · ${realm}${altNew && maxAlt > 300 ? ' · 新境界！' : bestAlt > 0 ? `（纪录 ${bestAlt | 0}）` : ''}`,
      cx,
      this.h * 0.46
    );
    ctx.font = `600 ${16}px system-ui`;
    ctx.fillStyle = 'rgba(220,210,230,0.75)';
    ctx.fillText(`飞行 ${Math.floor(distM)}m · 金币 ${coins} · 最大连击 ×${maxCombo} · 最佳 ${Math.floor(best)}`, cx, this.h * 0.52);
    ctx.fillStyle = `rgba(240,230,240,${0.6 + Math.sin(time * 4) * 0.3})`;
    ctx.font = `700 ${17}px system-ui`;
    ctx.fillText('按住 重新起飞', cx, this.h * 0.64);
    ctx.restore();
  }

  /** 巢穴抵达霞光演出文字 */
  drawNestBanner(ctx: CanvasRenderingContext2D, level: number, t: number, dur: number): void {
    const a = Math.sin(clamp(t / dur, 0, 1) * Math.PI);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(74,42,34,0.9)';
    ctx.font = `900 ${40}px system-ui`;
    ctx.fillText(`第 ${level} 天 · 日落归巢`, this.w / 2, this.h * 0.34);
    ctx.font = `700 ${18}px system-ui`;
    ctx.fillStyle = 'rgba(94,56,44,0.8)';
    ctx.fillText('新的一天开始了', this.w / 2, this.h * 0.34 + 34);
    ctx.restore();
  }

  /** 标题鸟：圆胖身体 + 超小翅膀 + 三片火焰尾羽（程序化，无图片） */
  private drawTitleBird(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
    ctx.save();
    ctx.translate(x, y);
    const s = 1.6; // 放大系数
    // 火焰尾羽三片（橙→黄→红渐变）
    for (let i = -1; i <= 1; i++) {
      const colors = ['#ff8e5c', '#ffd54f', '#ff5252'];
      ctx.fillStyle = colors[i + 1];
      const len = (22 + Math.abs(i) * 6) * s;
      const wob = Math.sin(time * 6 + i * 2) * 3 * s;
      ctx.beginPath();
      ctx.moveTo(-18 * s, i * 4 * s - 3 * s);
      ctx.quadraticCurveTo(-18 * s - len * 0.5, i * 4 * s + wob, -18 * s - len, i * 4 * s + wob);
      ctx.quadraticCurveTo(-18 * s - len * 0.5, i * 4 * s + 3 * s + wob, -18 * s, i * 4 * s + 3 * s);
      ctx.closePath();
      ctx.fill();
    }
    // 身体（圆润椭圆）
    ctx.fillStyle = 'rgb(76,67,64)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 18 * s, 14 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // 肚皮（奶油色）
    ctx.fillStyle = 'rgb(242,227,201)';
    ctx.beginPath();
    ctx.ellipse(2 * s, 6 * s, 11 * s, 7 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // 超小翅膀（左右各一个小三角）
    ctx.fillStyle = 'rgb(58,50,48)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * -3 * s, side * -5 * s);
      ctx.quadraticCurveTo(side * -8 * s, side * -10 * s, side * -12 * s, side * -6 * s);
      ctx.quadraticCurveTo(side * -7 * s, side * 2 * s, side * -3 * s, side * 2 * s);
      ctx.closePath();
      ctx.fill();
    }
    // 喙
    ctx.fillStyle = '#ffa94d';
    ctx.beginPath();
    ctx.moveTo(16 * s, -2 * s);
    ctx.lineTo(24 * s, 0);
    ctx.lineTo(16 * s, 2 * s);
    ctx.closePath();
    ctx.fill();
    // 眼睛
    ctx.fillStyle = '#fff8ec';
    ctx.beginPath();
    ctx.arc(8 * s, -4 * s, 4 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a2226';
    ctx.beginPath();
    ctx.arc(9 * s, -3.5 * s, 2 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** 结算鸟：焦黑态 + 熄火尾羽（悲伤但可爱） */
  private drawResultBird(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
    ctx.save();
    ctx.translate(x, y);
    const s = 1.2;
    // 身体（焦黑色）
    ctx.fillStyle = 'rgb(32,26,30)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 16 * s, 13 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgb(58,50,54)';
    ctx.beginPath();
    ctx.ellipse(2 * s, 6 * s, 10 * s, 6 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // 翅膀垂落
    ctx.fillStyle = 'rgb(40,33,38)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * -3 * s, side * 4 * s);
      ctx.quadraticCurveTo(side * -10 * s, side * 8 * s, side * -8 * s, side * 14 * s);
      ctx.quadraticCurveTo(side * -4 * s, side * 10 * s, side * -2 * s, side * 8 * s);
      ctx.closePath();
      ctx.fill();
    }
    // 喙
    ctx.fillStyle = '#8a6a4a';
    ctx.beginPath();
    ctx.moveTo(14 * s, -1 * s);
    ctx.lineTo(20 * s, 0);
    ctx.lineTo(14 * s, 1 * s);
    ctx.closePath();
    ctx.fill();
    // 眼睛（螺旋眩晕眼）
    ctx.fillStyle = '#fff8ec';
    ctx.beginPath();
    ctx.arc(7 * s, -3 * s, 4 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a2226';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 3; a += 0.3) {
      const r = a * 0.4 * s;
      const px = 7 * s + Math.cos(a + time * 2) * r;
      const py = -3 * s + Math.sin(a + time * 2) * r;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // 冒烟（焦黑态）
    ctx.fillStyle = 'rgba(120,116,128,0.4)';
    for (let i = 0; i < 2; i++) {
      const p = (time * 0.6 + i * 0.5) % 1;
      ctx.globalAlpha = 0.4 * (1 - p);
      ctx.beginPath();
      ctx.arc(4 * s + Math.sin(time * 2 + i) * 3 * s, -18 * s - p * 20 * s, 3 * s + p * 5 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ---------------- 小图标 ---------------- */

  private drawCoinIcon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.fillStyle = '#e0a93e';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath();
    ctx.arc(x - r * 0.08, y - r * 0.08, r * 0.66, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawSunIcon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, dayP: number): void {
    ctx.fillStyle = dayP > 0.85 ? '#e86a54' : '#ffd98a';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 白色小火焰（Fever 装饰） */
  private drawFlameGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, time: number): void {
    const sway = Math.sin(time * 9) * s * 0.15;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.moveTo(x, y - s * 1.7);
    ctx.quadraticCurveTo(x + s * 0.9 + sway, y - s * 0.4, x, y + s);
    ctx.quadraticCurveTo(x - s * 0.9 + sway, y - s * 0.4, x, y - s * 1.7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,220,150,0.9)';
    ctx.beginPath();
    ctx.arc(x + sway * 0.4, y + s * 0.2, s * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}
