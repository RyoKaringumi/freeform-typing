// 効果音。外部の音素材は使わず、WebAudio でその場で合成する。
// AudioContext は最初の操作（キー・クリック）のときに作る（ブラウザの自動再生の制限のため）。
import { settings } from "./settings";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function ac(): AudioContext | null {
  if (!settings.sound || settings.volume <= 0) return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
  master!.gain.value = settings.volume * 0.6;
  return ctx;
}

/** 最初の操作のときに呼ぶ（音を鳴らせる状態にしておく） */
export function unlockAudio() {
  ac();
}

type ToneOpt = { f: number; to?: number; type?: OscillatorType; dur: number; gain: number; at?: number; attack?: number };
function tone(o: ToneOpt) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + (o.at ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.f, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
  const a = o.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.gain, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  osc.connect(g).connect(master!);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.02);
}

type NoiseOpt = { dur: number; gain: number; f: number; to?: number; q?: number; filter?: BiquadFilterType; at?: number };
function noise(o: NoiseOpt) {
  const c = ac();
  if (!c || !noiseBuf) return;
  const t0 = c.currentTime + (o.at ?? 0);
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const fl = c.createBiquadFilter();
  fl.type = o.filter ?? "bandpass";
  fl.frequency.setValueAtTime(o.f, t0);
  if (o.to) fl.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
  fl.Q.value = o.q ?? 1;
  const g = c.createGain();
  g.gain.setValueAtTime(o.gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  src.connect(fl).connect(g).connect(master!);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + o.dur + 0.02);
}

// 音階（ペンタトニック）。数え上げの音が段ごとに上がる
const PENTA = [0, 2, 4, 7, 9];
const note = (step: number, base = 523.25) => base * Math.pow(2, (PENTA[step % 5] + 12 * Math.floor(step / 5)) / 12);
const jitter = (x: number, r = 0.06) => x * (1 + (Math.random() * 2 - 1) * r);

export const sfx = {
  /** 打鍵。変換中は少し柔らかく */
  key(composing = false) {
    noise({ dur: 0.022, gain: composing ? 0.1 : 0.16, f: jitter(composing ? 2300 : 3400, 0.1), q: 1.4 });
    tone({ f: jitter(composing ? 1500 : 2100, 0.05), type: "triangle", dur: 0.018, gain: 0.025 });
  },
  backspace() {
    noise({ dur: 0.03, gain: 0.12, f: 1300, q: 1.2 });
  },
  /** 変換の確定 */
  confirm() {
    tone({ f: 1046.5, type: "sine", dur: 0.07, gain: 0.07 });
    tone({ f: 1568, type: "sine", dur: 0.09, gain: 0.06, at: 0.04 });
  },
  submit() {
    noise({ dur: 0.16, gain: 0.16, f: 700, to: 3200, q: 0.8, filter: "lowpass" });
    tone({ f: 140, to: 60, type: "sine", dur: 0.16, gain: 0.3 });
  },
  /** 基本点の数え上げ */
  tick(step: number) {
    tone({ f: note(step, 392), type: "triangle", dur: 0.06, gain: 0.07 });
  },
  chips(step: number) {
    tone({ f: note(step + 3, 392), type: "triangle", dur: 0.12, gain: 0.12 });
    noise({ dur: 0.05, gain: 0.06, f: 4200, q: 2 });
  },
  mult(step: number) {
    tone({ f: note(step + 5, 330), type: "square", dur: 0.12, gain: 0.05 });
    tone({ f: note(step + 7, 330), type: "triangle", dur: 0.14, gain: 0.08, at: 0.02 });
  },
  xmult() {
    tone({ f: 260, to: 1040, type: "sawtooth", dur: 0.18, gain: 0.06 });
    tone({ f: 523.25, type: "triangle", dur: 0.3, gain: 0.08, at: 0.12 });
    tone({ f: 659.25, type: "triangle", dur: 0.3, gain: 0.07, at: 0.12 });
    tone({ f: 783.99, type: "triangle", dur: 0.3, gain: 0.07, at: 0.12 });
  },
  total(big: boolean) {
    tone({ f: 160, to: 48, type: "sine", dur: 0.26, gain: 0.4 });
    noise({ dur: 0.12, gain: 0.1, f: 900, q: 0.7, filter: "lowpass" });
    if (big) for (const [i, f] of [523.25, 659.25, 783.99].entries()) tone({ f, type: "triangle", dur: 0.4, gain: 0.06, at: 0.03 * i });
  },
  zero() {
    tone({ f: 110, type: "square", dur: 0.2, gain: 0.06 });
    tone({ f: 98, type: "square", dur: 0.22, gain: 0.05, at: 0.08 });
  },
  gate() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ f, type: "triangle", dur: 0.16, gain: 0.1, at: i * 0.07 }));
  },
  clear() {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone({ f, type: "triangle", dur: 0.22, gain: 0.09, at: i * 0.08 }));
    [523.25, 783.99, 1046.5].forEach((f) => tone({ f, type: "sine", dur: 0.9, gain: 0.05, at: 0.42, attack: 0.03 }));
  },
  over() {
    [440, 349.23, 293.66, 220].forEach((f, i) => tone({ f, type: "sine", dur: 0.35, gain: 0.1, at: i * 0.18 }));
  },
  deal(i: number) {
    noise({ dur: 0.05, gain: 0.12, f: 1600 + i * 300, q: 1.5, at: i * 0.09 });
  },
  hover() {
    tone({ f: 2600, type: "sine", dur: 0.02, gain: 0.025 });
  },
  pick() {
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone({ f, type: "sine", dur: 0.25, gain: 0.05, at: i * 0.05 }));
  },
  click() {
    tone({ f: 880, type: "triangle", dur: 0.04, gain: 0.06 });
  },
};
