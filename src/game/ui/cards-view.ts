// カードの見た目（手持ちの列・選ぶ画面・説明・乗せたときの説明の札）。
// どのカードも、いちばん大きく「何をすると得か」（card-guide.ts の goal）、その下に効果の一行。くわしい説明と例文は、開く・乗せると出る。
import "./cards.css";
import { CARD_BY_ID, type CardDef } from "../cards";
import { sfx } from "../fx/audio";
import { bump } from "../fx/motion";
import { guideOf, runExample } from "./card-guide";
import { esc } from "./dom";
import { closeOverlay, openOverlay } from "./overlay";
import { STATE_LABEL, valueText, type Verdict } from "./verdict";

export const KIND_LABEL: Record<CardDef["kind"], string> = { chips: "点", mult: "倍率＋", xmult: "倍率×", rule: "決まり" };

const srcTag = (c: CardDef) => `<span class="src ${c.source === "埋め込み" ? "emb" : "morph"}">${c.source === "埋め込み" ? "意味（埋め込み）" : "形態素"}</span>`;
const kindTag = (c: CardDef) => `<span class="kind">${KIND_LABEL[c.kind]}</span>`;

/** 例文の欄（中身はあとから fillExamples で埋める） */
const exampleSlot = (c: CardDef) => (guideOf(c.id).example ? `<div class="card-ex" data-ex="${c.id}"><span class="ex-lbl">例</span><span class="ex-body"></span></div>` : "");

/** data-ex の欄に、例文をカードの関数に通した結果を入れる（辞書がまだなら文だけ） */
export function fillExamples(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-ex]").forEach(async (el) => {
    const c = CARD_BY_ID.get(el.dataset.ex!)!;
    const g = guideOf(c.id);
    const body = el.querySelector(".ex-body")!;
    const before = g.before?.length ? `<span class="ex-before">${g.before.map((t) => `「${esc(t)}」`).join("→")} のあとに</span>` : "";
    body.innerHTML = `${before}<span class="ex-text">「${esc(g.example)}」</span>`;
    const r = await runExample(c);
    if (!r || !el.isConnected) return;
    const v = r.result.hit ? (c.kind === "rule" ? `＋${r.result.amount} 点` : valueText({ card: c, result: r.result })) : "効かない";
    body.innerHTML = `${before}<span class="ex-text">「${esc(g.example)}」</span><span class="ex-arrow">→</span><b class="ex-val ${r.result.hit ? "hit" : "miss"}">${esc(v)}</b><span class="ex-detail">${esc(r.result.detail)}</span>`;
  });
}

/** 手持ちの列のカード。v は直前の文での判定、hint は次の文への一言。 */
export function deckCard(c: CardDef, v?: Verdict, hint = "") {
  const st = v ? `<span class="dk-state s-${v.state}">${STATE_LABEL[v.state]}${v.state === "hit" ? ` <b>${esc(v.value)}</b>` : ""}</span>` : "";
  const sub = v?.tip ? `<span class="dk-tip">${esc(v.tip)}</span>` : hint ? `<span class="dk-hint">${esc(hint)}</span>` : "";
  return `<button class="card deck-card k-${c.kind} ${v ? "v-" + v.state : ""}" data-card="${c.id}">
    <span class="dk-top"><span class="dk-kind">${KIND_LABEL[c.kind]}</span><span class="dk-name">${esc(c.name)}</span>${st}</span>
    <span class="dk-goal">${esc(guideOf(c.id).goal)}</span>${sub}
  </button>`;
}

/** 選ぶ画面の大きなカード */
export function offerCard(c: CardDef, idx: number, isNew: boolean) {
  return `<div class="card offer k-${c.kind} ${isNew ? "is-new" : ""}" data-offer="${idx}" style="--i:${idx}">
    ${isNew ? `<span class="new">はじめて</span>` : ""}
    <div class="card-head">${kindTag(c)}${srcTag(c)}</div>
    <div class="card-name">${esc(c.name)}</div>
    <div class="card-goal">${esc(guideOf(c.id).goal)}</div>
    <div class="card-short">${esc(c.short)}</div>
    ${exampleSlot(c)}
    <details ${isNew ? "open" : ""}><summary>くわしい説明</summary><div class="card-long">${esc(c.long)}</div></details>
    <button class="pick" data-pick="${idx}"><span class="key">${idx + 1}</span> これを取る</button>
  </div>`;
}

export function cardDetailHtml(c: CardDef) {
  return `<div class="card-detail k-${c.kind}">
    <div class="card-head">${kindTag(c)}${srcTag(c)}</div>
    <div class="card-name">${esc(c.name)}</div>
    <div class="card-goal">${esc(guideOf(c.id).goal)}</div>
    <div class="card-short">${esc(c.short)}</div>
    ${exampleSlot(c)}
    <div class="card-long">${esc(c.long)}</div>
  </div>`;
}

export function showCardDetail(id: string) {
  const c = CARD_BY_ID.get(id)!;
  hideTip();
  openOverlay(`${cardDetailHtml(c)}<div class="ov-actions"><button id="ov-close">閉じる</button></div>`, { variant: "narrow" });
  fillExamples(document.getElementById("overlay-body")!);
  document.getElementById("ov-close")!.addEventListener("click", closeOverlay);
  (document.getElementById("ov-close") as HTMLButtonElement).focus();
}

// ---- 乗せたときの説明の札（手持ちの列） ----
const tipEl = () => document.getElementById("card-tip")!;
export function hideTip() {
  tipEl().classList.add("hidden");
}
/** anchor の横（入らなければ上下）に、カードの説明の札を出す。v があれば直前の文での効き方も。 */
export function showTip(anchor: HTMLElement, id: string, v?: Verdict) {
  const c = CARD_BY_ID.get(id)!;
  const tip = tipEl();
  tip.className = `card-tip k-${c.kind}`;
  const last = v
    ? `<div class="tip-last s-${v.state}"><span class="tl-lbl">直前の文では</span> <b>${STATE_LABEL[v.state]}</b>${v.state === "hit" ? ` ${esc(v.value)}` : ""}<div class="tl-why">${esc(v.why)}${v.tip ? `<br/>${esc(v.tip)}` : ""}</div></div>`
    : "";
  tip.innerHTML = `${cardDetailHtml(c)}${last}<div class="tip-foot">押すと大きく開く</div>`;
  fillExamples(tip);
  const place = () => {
    const a = anchor.getBoundingClientRect();
    const W = innerWidth, H = innerHeight;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = a.left - w - 12;
    let top = Math.min(Math.max(8, a.top), H - h - 8);
    if (left < 8) {
      // 左に入らなければ下か上へ（縦長の画面の横の列）
      left = Math.min(Math.max(8, a.left), W - w - 8);
      top = a.bottom + 8 + h < H ? a.bottom + 8 : Math.max(8, a.top - h - 8);
    }
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  place();
  // 例文の結果が入ると背が変わるので、少しあとで置き直す
  setTimeout(place, 80);
}

/**
 * カードを選ぶ画面。数字キー 1〜3 でも選べる。選んだら onPick(i)（取らないなら -1）。
 * 選んだカードを光らせてから閉じる（演出を減らす設定なら即座に）。
 */
export function showOffers(head: string, offers: string[], seen: Set<string>, note: string, onPick: (i: number) => void) {
  let done = false;
  hideTip();
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
  fillExamples(document.getElementById("overlay-body")!);
  offers.forEach((_, i) => sfx.deal(i));
  document.querySelectorAll<HTMLButtonElement>("[data-pick]").forEach((b) => b.addEventListener("click", () => choose(Number(b.dataset.pick))));
  document.querySelectorAll<HTMLElement>("[data-offer]").forEach((o) => o.addEventListener("mouseenter", () => sfx.hover()));
  document.getElementById("ov-skip")!.addEventListener("click", () => choose(-1));
  document.querySelector<HTMLButtonElement>("[data-pick]")?.focus({ preventScroll: true });
}

/** 手持ちの列のカードを光らせる（点の数え上げで効いたとき） */
export function fireDeckCard(id: string) {
  const el = document.querySelector<HTMLElement>(`#deck [data-card="${id}"]`);
  bump(el, "fire");
  // 手持ちの列の中だけを動かす（ページは動かさない）
  const deck = document.getElementById("deck");
  if (el && deck) {
    const a = el.getBoundingClientRect(), b = deck.getBoundingClientRect();
    if (a.top < b.top) deck.scrollTop += a.top - b.top - 4;
    else if (a.bottom > b.bottom) deck.scrollTop += a.bottom - b.bottom + 4;
    if (a.left < b.left) deck.scrollLeft += a.left - b.left - 4;
    else if (a.right > b.right) deck.scrollLeft += a.right - b.right + 4;
  }
  return el;
}
