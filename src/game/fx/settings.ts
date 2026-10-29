// 遊び心地の設定（音・演出・数え上げの速さ）。ブラウザに覚える。
export type MotionPref = "auto" | "full" | "reduced";
export type Settings = {
  sound: boolean;
  volume: number; // 0〜1
  motion: MotionPref; // auto は OS の「視差効果を減らす」（prefers-reduced-motion）に従う
  speed: "normal" | "fast"; // 点の数え上げの速さ
};

const KEY = "freeform-typing.settings.v1";
const DEFAULTS: Settings = { sound: true, volume: 0.6, motion: "auto", speed: "normal" };

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: Settings = load();
const listeners = new Set<(s: Settings) => void>();

export function updateSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  localStorage.setItem(KEY, JSON.stringify(settings));
  applyMotionClass();
  for (const f of listeners) f(settings);
}
export function onSettings(f: (s: Settings) => void) {
  listeners.add(f);
}

const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
/** 演出を減らすか（設定が auto なら OS の設定に従う） */
export function reducedMotion(): boolean {
  if (settings.motion === "reduced") return true;
  if (settings.motion === "full") return false;
  return !!mq?.matches;
}
/** 演出の待ち時間に掛ける倍率。減らす設定なら 0（すぐ最後の状態にする） */
export function timeScale(): number {
  if (reducedMotion()) return 0;
  return settings.speed === "fast" ? 0.5 : 1;
}

function applyMotionClass() {
  document.documentElement.classList.toggle("reduce-motion", reducedMotion());
}
mq?.addEventListener?.("change", applyMotionClass);
applyMotionClass();
