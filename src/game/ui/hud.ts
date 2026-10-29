// 上の帯（ラウンド・ゲートの棒・残りの文・合計）と、手持ちのカードの列。
import "./hud.css";
import { CARD_BY_ID } from "../cards";
import { bump } from "../fx/motion";
import { deckCard, hideTip, showCardDetail, showTip } from "./cards-view";
import { $ } from "./dom";
import type { Verdict } from "./verdict";

export type HudState = {
  round: number;
  gate: number;
  shown: number;
  handsLeft: number;
  hands: number;
  owned: string[];
  runTotal?: number;
  /** 直前の文でのカードごとの判定（無ければ出さない） */
  verdicts?: Verdict[];
  /** 次の文への一言（カードの id ごと） */
  hints?: Record<string, string>;
};

/** ラウンドの点の表示（数え上げの途中の値も入る） */
export function setGateShown(shown: number, gate: number) {
  const left = Math.max(0, gate - Math.round(shown));
  $("gate-text").innerHTML = `<b>${Math.round(shown)}</b><span class="of"> / ${gate} 点</span>${left > 0 ? `<span class="left">あと ${left}</span>` : `<span class="left ok">到達</span>`}`;
  const fill = $("bar-fill");
  fill.style.width = `${Math.min(100, (shown / gate) * 100)}%`;
  const done = shown >= gate;
  if (done && !fill.classList.contains("done")) bump($("gate"), "reached");
  fill.classList.toggle("done", done);
}

export function setHands(left: number, hands: number) {
  $("hands").innerHTML =
    `<span class="lbl">残りの文</span><span class="dots">` +
    Array.from({ length: hands }, (_, i) => `<span class="dot ${i < left ? "on" : ""}"></span>`).join("") +
    `</span><b class="hands-n">${left}</b>`;
}

export function setRunTotal(n: number) {
  $("run-total").textContent = String(Math.round(n));
}

let lastDeck = "";
let lastVerdicts: Verdict[] = [];
export function renderHud(h: HudState, newCard?: string) {
  const r = $("round");
  if (r.textContent !== String(h.round)) {
    r.textContent = String(h.round);
    bump(r.parentElement, "bump");
  }
  setGateShown(h.shown, h.gate);
  setHands(h.handsLeft, h.hands);
  if (h.runTotal !== undefined) setRunTotal(h.runTotal);
  const vs = h.verdicts ?? [];
  const key = h.owned.join(",") + "|" + vs.map((v) => v.card.id + v.state + v.value + (v.tip ?? "")).join(",") + "|" + JSON.stringify(h.hints ?? {});
  if (key === lastDeck) return;
  lastDeck = key;
  lastVerdicts = vs;
  const deck = $("deck");
  const byId = new Map(vs.map((v) => [v.card.id, v]));
  deck.innerHTML = h.owned.length
    ? h.owned.map((id) => deckCard(CARD_BY_ID.get(id)!, byId.get(id), h.hints?.[id])).join("")
    : `<div class="empty"><b>まだ無い</b>いまは、読みの音の数（拍）だけが点になる。ゲートを越えるとカードを 1 枚選べる。</div>`;
  deck.querySelectorAll<HTMLElement>("[data-card]").forEach((el) => {
    const id = el.dataset.card!;
    const v = () => lastVerdicts.find((x) => x.card.id === id);
    el.addEventListener("click", () => showCardDetail(id));
    el.addEventListener("mouseenter", () => showTip(el, id, v()));
    el.addEventListener("focus", () => showTip(el, id, v()));
    el.addEventListener("mouseleave", hideTip);
    el.addEventListener("blur", hideTip);
  });
  if (newCard) bump(deck.querySelector(`[data-card="${newCard}"]`), "arrive");
}
