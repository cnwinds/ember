/**
 * Input —— 单键三态的输入源 + 可录制事件流。
 *
 * 单键 = 空格 / ↓ / W/S / 鼠标 / 触屏，任意一个按下即「按住」。
 * DOM 事件到达即翻转 held（零延迟：最迟下一个物理步生效，≤1 帧）。
 * 录制采用「按步号 RLE」：每步调用 observe()，状态变化才落一条事件 → 回放逐帧一致。
 */

export interface InputEvent {
  /** 第几个物理步（120Hz） */
  step: number;
  down: boolean;
}

export class InputSource {
  /** 当前是否按住（供模拟读取） */
  held = false;
  /** 录制开关 */
  recording = false;
  /** 已录制的事件（RLE，仅状态变化） */
  readonly events: InputEvent[] = [];

  private stepCount = 0;
  /** 回放源：设置后 held 由回放驱动，忽略真实输入 */
  private replay: InputEvent[] | null = null;
  private replayIdx = 0;

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.replay) return;
    if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'KeyW' || e.code === 'KeyS') {
      if (!e.repeat) this.setHeld(true);
      e.preventDefault();
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    if (this.replay) return;
    if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'KeyW' || e.code === 'KeyS') {
      this.setHeld(false);
      e.preventDefault();
    }
  };
  private onPointerDown = (e: PointerEvent) => {
    if (this.replay) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.setHeld(true);
  };
  private onPointerUp = () => {
    if (this.replay) return;
    this.setHeld(false);
  };
  private onBlur = () => {
    this.setHeld(false); // 失焦强制松开，防止「卡按住」
  };

  attach(el: HTMLElement | Window = window): void {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp, { passive: false });
    const target = el as HTMLElement;
    target.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private setHeld(v: boolean): void {
    if (this.held !== v) {
      this.held = v;
      this.anyPress = true;
    }
  }

  /** 是否有过任何按键（标题页 → 开始游戏 / 解锁音频手势用） */
  anyPress = false;

  /** 每个物理步调用一次：驱动回放 & 录制变化 */
  observe(): void {
    if (this.replay) {
      while (this.replayIdx < this.replay.length && this.replay[this.replayIdx].step <= this.stepCount) {
        this.held = this.replay[this.replayIdx].down;
        this.replayIdx++;
      }
    }
    if (this.recording) {
      const last = this.events[this.events.length - 1];
      if (!last || last.down !== this.held) {
        this.events.push({ step: this.stepCount, down: this.held });
      }
    }
    this.stepCount++;
  }

  get steps(): number {
    return this.stepCount;
  }

  /** 开始回放（重置到给定事件流开头） */
  startReplay(events: InputEvent[]): void {
    this.replay = events;
    this.replayIdx = 0;
    this.held = false;
  }

  stopReplay(): void {
    this.replay = null;
  }

  /** 重置录制（新一局） */
  resetRecorder(): void {
    this.events.length = 0;
    this.stepCount = 0;
    this.replayIdx = 0;
  }
}
