// 上の帯（ラウンド・ゲートの棒・残りの文）と手持ちのカードの列。
import "./hud.css";
import { CARD_BY_ID } from "../cards";
import { bump } from "../fx/motion";
import { miniCard, showCardDetail } from "./cards-view";
import { $ } from "./dom";

export type HudState = { round: number; gate: number; shown: number; handsLeft: number; hands: number; owned: string[] };

/** ラウンドの点の表示（数え上げの途中の値も入る） */
export function setGateShown(shown: number, gate: number) {
  $("gate-text").innerHTML = `<b>${Math.round(shown)}</b><span class="of"> / ${gate} 点</span>`;
  const fill = $("bar-fill");
  fill.style.width = `${Math.min(100, (shown / gate) * 100)}%`;
  const done = shown >= gate;
  if (done && !fill.classList.contains("done")) bump($("gate"), "reached");
  fill.classList.toggle("done", done);
}

export function setHands(left: number, hands: number) {
  $("hands").innerHTML =
    `<span class="hands-label">残り</span>` +
    Array.from({ length: hands }, (_, i) => `<span class="dot ${i < left ? "on" : ""}"></span>`).join("") +
    `<span class="hands-n">${left}</span>`;
}

let lastDeck = "";
export function renderHud(h: HudState, newCard?: string) {
  const r = $("round");
  if (r.textContent !== String(h.round)) {
    r.textContent = String(h.round);
    bump(r.parentElement, "bump");
  }
  setGateShown(h.shown, h.gate);
  setHands(h.handsLeft, h.hands);
  const key = h.owned.join(",");
  if (key !== lastDeck) {
    lastDeck = key;
    const deck = $("deck");
    deck.innerHTML = h.owned.length
      ? h.owned.map((id) => miniCard(CARD_BY_ID.get(id)!)).join("")
      : `<span class="empty">まだ無い。いまは読みの音の数（拍）だけが点になる。ラウンドを越えるとカードを 1 枚選べる。</span>`;
    deck.querySelectorAll<HTMLElement>("[data-card]").forEach((el) => el.addEventListener("click", () => showCardDetail(el.dataset.card!)));
    if (newCard) bump(deck.querySelector(`[data-card="${newCard}"]`), "arrive");
  }
}
