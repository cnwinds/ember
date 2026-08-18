/**
 * BGM —— 程序化背景音乐（调度器 + 前瞻排程）。
 *
 * - 108 BPM，4 小节循环（C → G → Am → F），五声旋律随机但种子化
 * - 三层：贝斯（三角波根音八分）、和声垫（双振荡轻微失谐 + 低通）、拨弦旋律（稀疏）
 * - 场景：title（仅垫音，疏）/ play（全奏）/ over（小调慢垫）
 * - Fever：整体升半调（所有频率 ×2^(1/12)）+ 16 分踩镲噪声，密度提升
 * - 排程：setInterval 25ms 唤醒，音频时钟前瞻 0.12s，无 GC 抖动
 */

import type { AudioSynth } from './synth';
import { mulberry32 } from '../core/rng';

type Scene = 'title' | 'play' | 'over';

const BPM = 108;
const BEAT = 60 / BPM;
const EIGHTH = BEAT / 2;
const SIXTEENTH = BEAT / 4;

/** 和弦进行（根音 MIDI）：C3 G2 A2 F2 */
const PROG = [48, 43, 45, 41];
/** 和弦音（相对根音的半音） */
const CHORD = [0, 7, 12, 16];
/** 五声旋律池（相对 C 大调） */
const MELODY = [0, 2, 4, 7, 9, 12, 14, 16];

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class BGM {
  private scene: Scene = 'title';
  private fever = false;
  private nextNoteT = 0;
  private step16 = 0;
  private timer: number | null = null;
  private rng = mulberry32(20260814);
  /** 旋律动机（16 步 × 概率/音高），种子化生成 */
  private motif: Array<number | null> = [];

  constructor(private synth: AudioSynth) {
    this.regenerateMotif();
  }

  private regenerateMotif(): void {
    this.motif = [];
    for (let i = 0; i < 32; i++) {
      // 4 步一组的节奏骨架 + 随机留白，保持「稀疏拨弦」
      const r = this.rng();
      if (i % 4 === 0 || r < 0.22) {
        this.motif.push(MELODY[Math.floor(this.rng() * MELODY.length)] + 72);
      } else {
        this.motif.push(null);
      }
    }
  }

  setScene(s: Scene): void {
    this.scene = s;
  }
  setFever(on: boolean): void {
    this.fever = on;
  }

  start(): void {
    if (this.timer !== null) return;
    this.nextNoteT = 0;
    const tick = () => this.schedule();
    this.timer = window.setInterval(tick, 25);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    const ctx = this.synth.context;
    if (!ctx || this.synth.muted) return;
    if (this.nextNoteT === 0) this.nextNoteT = ctx.currentTime + 0.06;
    const horizon = ctx.currentTime + 0.12;
    while (this.nextNoteT < horizon) {
      this.playStep(this.nextNoteT);
      this.nextNoteT += SIXTEENTH;
      this.step16++;
    }
  }

  private playStep(t: number): void {
    const bar = Math.floor(this.step16 / 16) % PROG.length;
    const s16 = this.step16 % 16;
    const root = PROG[bar];
    const transpose = this.fever ? 1 : 0; // Fever 升半调

    if (this.scene === 'over') {
      // 慢垫：每小节一个低音 + 长和声
      if (s16 === 0) {
        this.note(t, midiToFreq(root - 12 + transpose), BEAT * 3.6, 'sine', 0.07);
        this.note(t, midiToFreq(root + transpose), BEAT * 3.6, 'triangle', 0.03, 0.6);
      }
      return;
    }

    const full = this.scene === 'play';

    // ---- 和声垫（每小节头换） ----
    if (s16 === 0) {
      for (const iv of CHORD) {
        this.note(t, midiToFreq(root + 12 + iv + transpose), BEAT * 3.8, 'triangle', full ? 0.022 : 0.016, 0.5, 900);
      }
    }

    if (!full) {
      // 标题：只有垫 + 偶尔单音
      if (s16 === 8) this.note(t, midiToFreq(72 + transpose), BEAT * 1.5, 'sine', 0.05);
      return;
    }

    // ---- 贝斯（八分） ----
    if (s16 % 2 === 0) {
      const oct = s16 % 8 === 4 ? 12 : 0; // 后半拍抬升
      this.note(t, midiToFreq(root + oct + transpose), EIGHTH * 0.92, 'triangle', 0.075);
    }

    // ---- 旋律拨弦（动机） ----
    const m = this.motif[this.step16 % 32];
    if (m != null) {
      this.note(t, midiToFreq(m + transpose), BEAT * 0.9, 'triangle', 0.045);
    }

    // ---- Fever 踩镲（16 分噪声点） ----
    if (this.fever && s16 % 2 === 1) {
      this.hat(t, 0.016);
    }
    // 结尾小鼓点
    if (s16 === 14) this.hat(t, 0.03);
  }

  private note(t: number, freq: number, dur: number, type: OscillatorType, vol: number, attack = 0.01, lowpass = 0): void {
    const ctx = this.synth.context;
    const master = this.synth.masterGain;
    if (!ctx || !master) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    let dest: AudioNode = g;
    if (lowpass > 0) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      g.connect(f);
      dest = f;
    }
    dest.connect(master);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.6, dur * 0.25);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.3);
  }

  private hat(t: number, vol: number): void {
    const ctx = this.synth.context;
    const master = this.synth.masterGain;
    if (!ctx || !master) return;
    const len = Math.floor(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(master);
    src.start(t);
  }
}
