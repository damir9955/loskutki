'use client';

/**
 * Звук на WebAudio: мягкие «текстильные» эффекты без внешних файлов.
 * Все вызовы безопасны, если контекст ещё не создан.
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;

  ensure() {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.42;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slide?: number } = {}) {
    if (!this.ctx || !this.master || !this.enabled) return;
    const t0 = this.ctx.currentTime + (opts.delay ?? 0);
    const osc = this.ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + opts.slide), t0 + dur);
    const g = this.ctx.createGain();
    const peak = opts.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, opts: { freq?: number; q?: number; gain?: number; delay?: number; sweep?: number } = {}) {
    if (!this.ctx || !this.master || !this.enabled) return;
    const t0 = this.ctx.currentTime + (opts.delay ?? 0);
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(opts.freq ?? 800, t0);
    if (opts.sweep) filter.frequency.linearRampToValueAtTime(opts.sweep, t0 + dur);
    filter.Q.value = opts.q ?? 1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur);
  }

  /** лоскуток лёг на полотно */
  place() {
    this.tone(170, 0.14, { type: 'triangle', gain: 0.3, slide: -90 });
    this.noise(0.09, { freq: 420, gain: 0.22, q: 0.8 });
  }

  /** доход пуговиц */
  income() {
    this.tone(880, 0.1, { type: 'triangle', gain: 0.16 });
    this.tone(1318, 0.14, { type: 'triangle', gain: 0.14, delay: 0.07 });
  }

  /** продвижение по дорожке */
  advance() {
    this.noise(0.22, { freq: 500, sweep: 1500, gain: 0.13, q: 0.7 });
    this.tone(300, 0.18, { type: 'sine', gain: 0.1, slide: 220 });
  }

  /** покупка лоскутка */
  buy() {
    this.tone(523, 0.09, { type: 'triangle', gain: 0.16 });
    this.tone(784, 0.12, { type: 'triangle', gain: 0.13, delay: 0.06 });
    this.noise(0.06, { freq: 1800, gain: 0.1, delay: 0.02 });
  }

  /** кожаный лоскуток */
  leather() {
    this.tone(660, 0.07, { type: 'square', gain: 0.07 });
    this.tone(990, 0.08, { type: 'sine', gain: 0.1, delay: 0.05 });
  }

  /** спецплитка 7×7 */
  tile() {
    [660, 880, 1320].forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', gain: 0.15, delay: i * 0.09 }));
  }

  /** победа */
  win() {
    [523, 659, 784, 1046, 1318].forEach((f, i) =>
      this.tone(f, 0.24, { type: 'triangle', gain: 0.16, delay: i * 0.12 }),
    );
  }

  /** поражение */
  lose() {
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.3, { type: 'sine', gain: 0.13, delay: i * 0.16 }));
  }

  /** клик по кнопке */
  tap() {
    this.noise(0.03, { freq: 2400, gain: 0.08, q: 2 });
  }

  /** ошибка */
  error() {
    this.tone(150, 0.12, { type: 'square', gain: 0.08 });
  }
}

export const sound = new SoundEngine();

/** Вибрация с учётом настроек */
export function vibrate(ms: number | number[], enabled: boolean) {
  if (!enabled) return;
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(ms);
  } catch {
    /* игнорируем */
  }
}
