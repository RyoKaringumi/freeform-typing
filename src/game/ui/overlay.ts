// 画面に重ねる枠（カード選択・カードの説明・設定・結果）。開いている間のキー操作も受け持つ。
import "./overlay.css";

const $ = (id: string) => document.getElementById(id)!;
let keyHandler: ((ev: KeyboardEvent) => void) | null = null;
let onClose: (() => void) | null = null;
let closable = true;

export type OverlayOpts = {
  /** 外側のクリックや Esc で閉じてよいか（カード選択・結果は閉じない） */
  closable?: boolean;
  onKey?: (ev: KeyboardEvent) => void;
  onClose?: () => void;
  variant?: string; // 枠の見た目の種類（css の class）
};

export function openOverlay(html: string, opts: OverlayOpts = {}) {
  const ov = $("overlay");
  const body = $("overlay-body");
  body.className = `overlay-body ${opts.variant ?? ""}`;
  body.innerHTML = html;
  ov.classList.remove("hidden");
  ov.classList.remove("leaving");
  keyHandler = opts.onKey ?? null;
  onClose = opts.onClose ?? null;
  closable = opts.closable ?? true;
  body.scrollTop = 0;
}

export function closeOverlay() {
  const ov = $("overlay");
  if (ov.classList.contains("hidden")) return;
  ov.classList.add("hidden");
  keyHandler = null;
  const f = onClose;
  onClose = null;
  f?.();
}

export const overlayOpen = () => !$("overlay").classList.contains("hidden");

export function initOverlay() {
  const ov = $("overlay");
  ov.addEventListener("click", (ev) => {
    if (ev.target === ov && closable) closeOverlay();
  });
  document.addEventListener("keydown", (ev) => {
    if (!overlayOpen()) return;
    if (ev.key === "Escape" && closable) {
      ev.preventDefault();
      closeOverlay();
      return;
    }
    keyHandler?.(ev);
  });
}
