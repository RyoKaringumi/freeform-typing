// カードの見た目（手持ちの列・選ぶ画面・説明）。
import "./cards.css";
import { CARD_BY_ID, type CardDef } from "../cards";
import { sfx } from "../fx/audio";
import { bump } from "../fx/motion";
import { esc } from "./dom";
import { closeOverlay, openOverlay } from "./overlay";

export const KIND_LABEL: Record<CardDef["kind"], string> = { chips: "点", mult: "倍率＋", xmult: "倍率×", rule: "決まり" };

const srcTag = (c: CardDef) => `<span class="src ${c.source === "埋め込み" ? "emb" : "morph"}">${c.source}</span>`;
const kindTag = (c: CardDef) => `<span class="kind">${KIND_LABEL[c.kind]}</span>`;

/** 手持ちの列の小さなカード */
export function miniCard(c: CardDef) {
  return `<button class="card mini k-${c.kind}" data-card="${c.id}" title="${esc(c.short)}"><span class="mini-kind">${KIND_LABEL[c.kind]}</span><span class="mini-name">${esc(c.name)}</span></button>`;
}

/** 選ぶ画面の大きなカード */
export function offerCard(c: CardDef, idx: number, isNew: boolean) {
  return `<div class="card offer k-${c.kind}" data-offer="${idx}" style="--i:${idx}">
    <div class="card-head">${kindTag(c)}${srcTag(c)}${isNew ? `<span class="new">NEW</span>` : ""}</div>
    <div class="card-name">${esc(c.name)}</div>
    <div class="card-short">${esc(c.short)}</div>
    <details ${isNew ? "open" : ""}><summary>くわしく</summary><div class="card-long">${esc(c.long)}</div></details>
    <button class="pick" data-pick="${idx}"><span class="key">${idx + 1}</span> これを取る</button>
  </div>`;
}

export function showCardDetail(id: string) {
  const c = CARD_BY_ID.get(id)!;
  openOverlay(
    `<div class="card-detail k-${c.kind}">
      <div class="card-head">${kindTag(c)}${srcTag(c)}</div>
      <h2>${esc(c.name)}</h2>
      <p class="card-short"><b>${esc(c.short)}</b></p><p class="card-long">${esc(c.long)}</p>
    </div>
    <div class="ov-actions"><button id="ov-close">閉じる</button></div>`,
    { variant: "narrow" },
  );
  document.getElementById("ov-close")!.addEventListener("click", closeOverlay);
  (document.getElementById("ov-close") as HTMLButtonElement).focus();
}

/**
 * カードを選ぶ画面。数字キー 1〜3 でも選べる。選んだら onPick(i)（取らないなら -1）。
 * 選んだカードを光らせてから閉じる（演出を減らす設定なら即座に）。
 */
export function showOffers(head: string, offers: string[], seen: Set<string>, note: string, onPick: (i: number) => void) {
  let done = false;
  const choose = (i: number) => {
    if (done) return;
    done = true;
    const el = document.querySelector<HTMLElement>(`[data-offer="${i}"]`);
    if (i >= 0 && el) {
      sfx.pick();
      el.classList.add("chosen");
      document.querySelectorAll<HTMLElement>("[data-offer]").forEach((o) => o !== el && o.classList.add("dismissed"));
      const ms = document.documentElement.classList.contains("reduce-motion") ? 0 : 420;
      setTimeout(() => onPick(i), ms);
    } else {
      sfx.click();
      onPick(-1);
    }
  };
  openOverlay(
    `${head}${note}<div class="offers">${offers.map((id, i) => offerCard(CARD_BY_ID.get(id)!, i, !seen.has(id))).join("")}</div>
    <div class="ov-actions"><span class="ov-keys">数字キー 1〜${offers.length} でも選べる</span><button id="ov-skip" class="ghost">取らずに進む</button></div>`,
    {
      closable: false,
      variant: "wide offers-screen",
      onKey: (ev) => {
        const n = Number(ev.key);
        if (Number.isInteger(n) && n >= 1 && n <= offers.length && !ev.repeat) {
          ev.preventDefault();
          choose(n - 1);
        }
      },
    },
  );
  offers.forEach((_, i) => sfx.deal(i));
  document.querySelectorAll<HTMLButtonElement>("[data-pick]").forEach((b) => b.addEventListener("click", () => choose(Number(b.dataset.pick))));
  document.querySelectorAll<HTMLElement>("[data-offer]").forEach((o) => o.addEventListener("mouseenter", () => sfx.hover()));
  document.getElementById("ov-skip")!.addEventListener("click", () => choose(-1));
  document.querySelector<HTMLButtonElement>("[data-pick]")?.focus({ preventScroll: true });
}

/** 手持ちの列のカードを光らせる（点の数え上げで効いたとき） */
export function fireDeckCard(id: string) {
  const el = document.querySelector(`#deck [data-card="${id}"]`);
  bump(el, "fire");
  return el;
}
