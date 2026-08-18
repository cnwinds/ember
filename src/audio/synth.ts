/**
 * AudioSynth —— WebAudio 程序化音效引擎（零音频文件）。
 *
 * 连续声床（每帧参数驱动，听觉读状态）：
 *   - 风声：带通噪声，中心频率随速度连续升高（更快 = 更高）
 *   - 加速低鸣：锯齿低频 + 噪声（推背感）
 *   - 热嘶声：高通噪声，热度 60+ 渐入
 *   - 心跳：热度 80+ 双跳低频，音量随热度线性增加（视觉之外的听觉热度通道）
 * 单发音色：完美着陆上行琶音 C→E→G(150ms)、着陆闷响、金币拨弦、爆燃轰鸣、
 *   Fever 扫频、涡轮和弦、归巢风铃、展翅破空。
 */

export interface SynthSimState {
  speed: number;
  maxSpeed: number;
  heat: number;
  boost: boolean;
  cool: boolean;
  grounded: boolean;
  fever: boolean;
}

export class AudioSynth {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rumbleGain!: GainNode;
  private rumbleFilter!: BiquadFilterNode;
  private sizzleGain!: GainNode;
  private heartbeatT = 0;
  muted = false;
  /** 音量恢复用 */
  private targetVol = 0.85;

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  /** 首个用户手势时调用（浏览器自动播放策略） */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.targetVol;
    this.master.connect(comp);

    // ---- 噪声缓冲（2s 白噪声，所有噪声源共用） ----
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // ---- 风声（速度 → 带通中心频率） ----
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuf;
    windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.8;
    this.windFilter.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(this.windFilter).connect(this.windGain).connect(this.master);
    windSrc.start();

    // ---- 加速低鸣 ----
    const rumbleOsc = ctx.createOscillator();
    rumbleOsc.type = 'sawtooth';
    rumbleOsc.frequency.value = 52;
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.value = 39;
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.value = 240;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumbleOsc.connect(this.rumbleFilter);
    subOsc.connect(this.rumbleFilter);
    this.rumbleFilter.connect(this.rumbleGain).connect(this.master);
    rumbleOsc.start();
    subOsc.start();

    // ---- 热嘶声 ----
    const sizzleSrc = ctx.createBufferSource();
    sizzleSrc.buffer = noiseBuf;
    sizzleSrc.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3800;
    this.sizzleGain = ctx.createGain();
    this.sizzleGain.gain.value = 0;
    sizzleSrc.connect(hp).connect(this.sizzleGain).connect(this.master);
    sizzleSrc.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.targetVol, this.ctx.currentTime, 0.05);
  }

  /** 每帧：连续声床参数 */
  update(dt: number, s: SynthSimState): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const speed01 = Math.min(1, s.speed / s.maxSpeed);
    // 风声：音量随速度，频率 400→1800 连续变化
    this.windGain.gain.setTargetAtTime(0.02 + speed01 * 0.16 + (s.cool ? 0.03 : 0), t, 0.08);
    this.windFilter.frequency.setTargetAtTime(380 + speed01 * speed01 * 1500, t, 0.08);
    // 加速低鸣
    const rumbleTarget = s.boost ? 0.05 + speed01 * 0.09 : 0;
    this.rumbleGain.gain.setTargetAtTime(rumbleTarget, t, 0.07);
    this.rumbleFilter.frequency.setTargetAtTime(180 + speed01 * 260, t, 0.1);
    // 热嘶声 60+
    const sizzle = Math.max(0, (s.heat - 60) / 40);
    this.sizzleGain.gain.setTargetAtTime(sizzle * 0.035, t, 0.15);
    // 心跳 80+：0.85s 周期双跳，音量 = redness × 0.4
    if (s.heat >= 80) {
      this.heartbeatT -= dt;
      if (this.heartbeatT <= 0) {
        this.heartbeatT = 0.85;
        const vol = ((s.heat - 80) / 20) * 0.42;
        this.thump(t, vol);
        this.thump(t + 0.16, vol * 0.7);
      }
    } else {
      this.heartbeatT = 0;
    }
  }

  private thump(t: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const g = ctx.createGain();
    o.frequency.setValueAtTime(64, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.16);
  }

  /* ---------------- 单发音色 ---------------- */

  /** 完美着陆：上行琶音 C→E→G（150ms 内），combo 越高音越高 */
  sfxPerfect(combo: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const semis = Math.min(combo, 8);
    const base = 523.25 * Math.pow(2, semis / 12); // C5 起，随 combo 上行
    const notes = [base, base * 1.26, base * 1.5]; // C E G
    notes.forEach((f, i) => {
      this.pluck(t + i * 0.05, f, 0.14, 'triangle', 0.16);
    });
    // 气浪嘶
    this.noiseBurst(t, 0.18, 1400, 0.06);
  }

  /** 普通着陆闷响 */
  sfxLand(material: 'snow' | 'rock'): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.pluck(t, material === 'rock' ? 96 : 130, 0.12, 'sine', material === 'rock' ? 0.22 : 0.15);
    this.noiseBurst(t, 0.12, material === 'rock' ? 900 : 500, 0.05);
  }

  /** 金币：短拨弦，连击音高上行 */
  sfxCoin(index: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 880 * Math.pow(2, (Math.min(index, 12) % 12) / 12);
    this.pluck(t, f, 0.1, 'triangle', 0.1);
    this.pluck(t + 0.03, f * 2, 0.07, 'sine', 0.05);
  }

  /** 展翅破空 */
  sfxFlap(): void {
    if (!this.ctx) return;
    this.noiseBurst(this.ctx.currentTime, 0.16, 2400, 0.06, 'highpass');
  }

  /** 爆燃：原地爆炸 —— 深沉轰鸣 + 下坠锯齿 + 余烬噼啪（对应 5s 惩罚的分量） */
  sfxBlowout(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(t, 1.4, 500, 0.4, 'lowpass');
    this.pluck(t, 55, 1.2, 'sine', 0.4);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(36, t + 1.1);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 1.3);
    // 余烬噼啪
    for (let i = 0; i < 5; i++) {
      this.noiseBurst(t + 0.5 + i * 0.22 + Math.random() * 0.1, 0.08, 3000, 0.06, 'highpass');
    }
  }

  /** 爆燃砸地 */
  sfxImpact(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.pluck(t, 70, 0.3, 'sine', 0.3);
    this.noiseBurst(t, 0.3, 400, 0.2, 'lowpass');
  }

  /** Fever 进入：上行扫频 + 明亮和弦 */
  sfxFever(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.6);
    [523, 659, 784, 1046].forEach((f, i) => this.pluck(t + 0.4 + i * 0.06, f, 0.3, 'triangle', 0.09));
  }

  /** 涡轮全开：大和弦 + 白噪涌起 */
  sfxTurbo(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 988, 1318].forEach((f, i) => this.pluck(t + i * 0.03, f, 0.8, 'triangle', 0.11));
    this.noiseBurst(t, 0.8, 2000, 0.08);
  }

  /** 归巢：风铃琶音下行 */
  sfxNest(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [1568, 1318, 1046, 784].forEach((f, i) => this.pluck(t + i * 0.09, f, 0.5, 'sine', 0.1));
  }

  /** 高度境界：每高一层升 2 个半音的两音音阶（外太空加八度长音 —— 「到了」的仪式感） */
  sfxRealm(idx: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 523.25 * Math.pow(2, (idx * 2) / 12);
    this.pluck(t, base, 0.35, 'triangle', 0.14);
    this.pluck(t + 0.09, base * 1.498, 0.4, 'triangle', 0.12); // 纯五度
    if (idx >= 5) {
      this.pluck(t + 0.18, base * 2, 0.9, 'sine', 0.14);
      this.noiseBurst(t + 0.15, 0.6, 5000, 0.04, 'highpass');
    }
  }

  /** 夜幕（失败）：低音下沉 */
  sfxNight(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.pluck(t, 220, 1.2, 'sine', 0.15);
    this.pluck(t + 0.1, 110, 1.6, 'sine', 0.15);
    this.pluck(t + 0.25, 55, 2.0, 'sine', 0.12);
  }

  /* ---------------- 底层发声原语 ---------------- */

  private pluck(t: number, freq: number, dur: number, type: OscillatorType, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBurst(t: number, dur: number, cutoff: number, vol: number, type: BiquadFilterType = 'bandpass'): void {
    const ctx = this.ctx!;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  /** 供 BGM 共用主增益 */
  get masterGain(): GainNode | null {
    return this.ctx ? this.master : null;
  }
  get context(): AudioContext | null {
    return this.ctx;
  }
}
