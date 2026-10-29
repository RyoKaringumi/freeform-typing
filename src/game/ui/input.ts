// 入力欄の手触り: 打鍵ごとの小さな反応と音、IME の変換中と確定の見せ方、送るときの手応え。
// 決めごと: IME の変換確定の Enter では送らない（isComposing / keyCode 229 を見る）。打鍵数と時間は表示だけ。
// 打っている途中の文が使う拍（ラウンドの拍の予算から引く量）を入力欄の横に出し、残りより長ければ送らない。
import "./input.css";
import { sfx, unlockAudio } from "../fx/audio";
import { bump, flyText } from "../fx/motion";
import { $ } from "./dom";

export type InputHooks = {
  /** 送ってよい状態か */
  canSubmit: () => boolean;
  onSubmit: (text: string) => void;
  /** 空の Enter。演出の途中なら飛ばす */
  onSkip: () => void;
  /** 打っている途中の文が使う拍。数えられなければ（辞書の読み込み中など）null */
  liveCost: (text: string) => number | null;
  /** このラウンドで残っている拍 */
  budgetLeft: () => number;
  /** 打っている途中の文が使う拍が変わったとき（帯の棒に先に見せる）。空なら null */
  onPreview?: (cost: number | null) => void;
};

let keyCount = 0;
let keyStart = 0;
/** 送るまでの打鍵数と秒数を取り出して数え直す */
export function takeKeyStats() {
  const r = { keys: keyCount, secs: keyStart ? (performance.now() - keyStart) / 1000 : 0 };
  keyCount = 0;
  keyStart = 0;
  return r;
}

export function initInput(h: InputHooks) {
  const input = $<HTMLInputElement>("text");
  const wrap = $("inputwrap");
  const live = $("live");
  let composing = false;

  const send = () => {
    const t = input.value;
    if (!t.trim()) {
      h.onSkip();
      return;
    }
    if (!h.canSubmit()) {
      bump(wrap, "deny");
      return;
    }
    const cost = h.liveCost(t);
    if (cost !== null && cost > h.budgetLeft()) {
      // 残りの拍より長い文は送らない（打った文は消さない。短くして送り直す）
      sfx.backspace();
      bump(wrap, "deny");
      bump(live, "shake");
      return;
    }
    sfx.submit();
    flyText(input, $("stage"), t.trim());
    bump(wrap, "sent");
    input.value = "";
    updateLive();
    h.onSubmit(t);
  };

  let liveTimer = 0;
  const updateLive = () => {
    clearTimeout(liveTimer);
    liveTimer = window.setTimeout(() => {
      const n = input.value.trim() ? h.liveCost(input.value) : null;
      const left = h.budgetLeft();
      const over = n !== null && n > left;
      live.classList.toggle("over", over);
      live.innerHTML = n === null ? "" : `<b>${n}</b> 拍${over ? `<span class="lv-over">残り ${left} より長い</span>` : ""}`;
      wrap.classList.toggle("over", over);
      h.onPreview?.(n);
    }, 60);
  };

  input.addEventListener("keydown", (ev) => {
    unlockAudio();
    if (ev.key === "Enter") {
      // IME の変換確定の Enter では送らない
      if (ev.isComposing || ev.keyCode === 229) return;
      ev.preventDefault();
      if (ev.repeat) return;
      send();
      return;
    }
    if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab", "Escape"].includes(ev.key)) return;
    if (ev.key.startsWith("Arrow") || ev.key === "Home" || ev.key === "End") return;
    if (!keyStart) keyStart = performance.now();
    keyCount++;
    if (ev.key === "Backspace" || ev.key === "Delete") {
      sfx.backspace();
      bump(wrap, "del");
    } else {
      sfx.key(composing || ev.isComposing || ev.keyCode === 229);
      bump(wrap, "tap");
    }
  });
  input.addEventListener("compositionstart", () => {
    composing = true;
    wrap.classList.add("composing");
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    wrap.classList.remove("composing");
    sfx.confirm();
    bump(wrap, "confirm");
  });
  input.addEventListener("input", updateLive);
  input.addEventListener("focus", () => wrap.classList.add("focus"));
  input.addEventListener("blur", () => wrap.classList.remove("focus"));
  $("send").addEventListener("click", () => {
    unlockAudio();
    send();
    input.focus();
  });
  return { updateLive };
}

export function setInputEnabled(on: boolean) {
  const input = $<HTMLInputElement>("text");
  input.disabled = !on;
  $<HTMLButtonElement>("send").disabled = !on;
  $("inputwrap").classList.toggle("disabled", !on);
  if (on) input.focus({ preventScroll: true });
}
