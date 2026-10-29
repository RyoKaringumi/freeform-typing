// 演出の道具。待ち時間は設定（速さ・演出を減らす）で伸び縮みし、skip() でいつでも最後まで飛ばせる。
import { reducedMotion, timeScale } from "./settings";

/** 1 回の演出の進行。skip されると、以後の wait は即座に返る（演出の途中で操作が詰まらないように）。 */
export class Run {
  skipped = false;
  private wakers = new Set<() => void>();
  skip() {
    this.skipped = true;
    for (const w of this.wakers) w();
    this.wakers.clear();
  }
  /** 演出を見せる状態か（飛ばされていない・減らす設定でない） */
  get live() {
    return !this.skipped && timeScale() > 0;
  }
  wait(ms: number): Promise<void> {
    const d = ms * timeScale();
    if (this.skipped || d <= 0) return Promise.resolve();
    return new Promise((res) => {
      const wake = () => {
        clearTimeout(t);
        res();
      };
      const t = setTimeout(() => {
        this.wakers.delete(wake);
        res();
      }, d);
      this.wakers.add(wake);
    });
  }
}

/** CSS のアニメーションを付け直す（同じ class を続けて付けても毎回動くように） */
export function bump(el: Element | null, cls = "bump") {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

/** 数を from から to へ数え上げる。onStep は表示が変わるたびに呼ぶ（音を鳴らす等）。 */
export async function countUp(run: Run, set: (v: number) => void, from: number, to: number, ms: number, onStep?: (i: number) => void, steps = 0) {
  if (!run.live || from === to) {
    set(to);
    return;
  }
  const dur = ms * timeScale();
  const n = steps || Math.min(12, Math.max(1, Math.abs(to - from)));
  for (let i = 1; i <= n; i++) {
    if (run.skipped) break;
    set(from + ((to - from) * i) / n);
    onStep?.(i);
    await run.wait(dur / n / Math.max(timeScale(), 0.01));
  }
  set(to);
}

function layer(): HTMLElement {
  let l = document.getElementById("fx-layer");
  if (!l) {
    l = document.createElement("div");
    l.id = "fx-layer";
    l.setAttribute("aria-hidden", "true");
    document.body.appendChild(l);
  }
  return l;
}

/** anchor の上に、浮かび上がって消える文字を出す（＋12、×2 など） */
export function floatText(anchor: Element | null, text: string, cls = "") {
  if (!anchor || reducedMotion()) return;
  const r = anchor.getBoundingClientRect();
  const s = document.createElement("span");
  s.className = `fx-float ${cls}`;
  s.textContent = text;
  s.style.left = `${r.left + r.width / 2}px`;
  s.style.top = `${r.top}px`;
  layer().appendChild(s);
  setTimeout(() => s.remove(), 1200);
}

/** anchor から小さな粒を飛ばす */
export function burst(anchor: Element | null, n = 14, cls = "") {
  if (!anchor || reducedMotion()) return;
  const r = anchor.getBoundingClientRect();
  const l = layer();
  for (let i = 0; i < n; i++) {
    const p = document.createElement("span");
    p.className = `fx-dot ${cls}`;
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
    const d = 40 + Math.random() * 60;
    p.style.left = `${r.left + r.width / 2}px`;
    p.style.top = `${r.top + r.height / 2}px`;
    p.style.setProperty("--dx", `${Math.cos(a) * d}px`);
    p.style.setProperty("--dy", `${Math.sin(a) * d}px`);
    l.appendChild(p);
    setTimeout(() => p.remove(), 900);
  }
}

/** 画面の上から紙吹雪を降らせる（ラウンドクリア） */
export function confetti(n = 40) {
  if (reducedMotion()) return;
  const l = layer();
  for (let i = 0; i < n; i++) {
    const p = document.createElement("span");
    p.className = "fx-confetti";
    p.style.left = `${Math.random() * 100}vw`;
    p.style.setProperty("--hue", String(Math.floor(Math.random() * 360)));
    p.style.setProperty("--delay", `${Math.random() * 0.4}s`);
    p.style.setProperty("--drift", `${(Math.random() * 2 - 1) * 80}px`);
    l.appendChild(p);
    setTimeout(() => p.remove(), 2600);
  }
}

/** 入力欄の文字が上へ飛んでいく（送ったときの手応え） */
export function flyText(from: Element, to: Element | null, text: string) {
  if (reducedMotion() || !to) return;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const s = document.createElement("span");
  s.className = "fx-fly";
  s.textContent = text;
  s.style.left = `${a.left + 14}px`;
  s.style.top = `${a.top + a.height / 2}px`;
  s.style.setProperty("--dx", `${b.left + 16 - (a.left + 14)}px`);
  s.style.setProperty("--dy", `${b.top + 20 - (a.top + a.height / 2)}px`);
  layer().appendChild(s);
  setTimeout(() => s.remove(), 600);
}
