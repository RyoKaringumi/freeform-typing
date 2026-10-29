// 1 文の内訳（解析の区切りと、カードごとの効き方）の表。履歴の一覧と、数え上げのあとの表示に使う。
import "./breakdown.css";
import type { TokenRow } from "../../morph";
import type { Breakdown, Line, Played } from "../cards";
import { esc, fmtMult } from "./dom";

export type Entry = Played & { round: number; bd: Breakdown; keys: number; secs: number };

const POS_CLASS: Record<string, string> = { 名詞: "n", 動詞: "v", 形容詞: "a", 副詞: "d", 助詞: "p", 助動詞: "x" };
export function tokenChips(tokens: TokenRow[]) {
  return tokens
    .map((t, i) => {
      const label = t.proper ? "固有名詞" : t.pos + (t.pos === "名詞" && t.pos1 && t.pos1 !== "一般" ? "・" + t.pos1 : "");
      return `<span class="tok ${t.proper ? "proper" : POS_CLASS[t.pos] ?? ""}${t.wordType === "UNKNOWN" ? " unk" : ""}" style="--i:${i}" title="読み: ${esc(t.reading || "—")}"><span class="s">${esc(t.surface)}</span><span class="p">${esc(label)}</span></span>`;
    })
    .join("");
}

function lineRow(l: Line, fmt: (x: number) => string) {
  return `<tr class="${l.result.hit ? "hit" : "miss"}"><td class="n">${esc(l.card.name)}</td><td class="d">${esc(l.result.detail)}</td><td class="v">${l.result.hit ? fmt(l.result.amount) : "—"}</td></tr>`;
}

export function formulaHtml(b: Breakdown) {
  return b.duplicate
    ? `このランで同じ文を前にも送ったので <b>0</b> 点`
    : `${b.chips} × ${fmtMult(b.mult)}${b.xmult !== 1 ? ` × ${fmtMult(b.xmult)}` : ""} = <b>${b.total}</b> 点`;
}

export function breakdownTable(b: Breakdown) {
  const rows = [
    `<tr class="sec"><td colspan="3">基本点</td></tr>`,
    `<tr class="hit"><td class="n">読みの音の数</td><td class="d">${b.mora} 拍${b.mora > b.cap ? `（上限 ${b.cap} で頭打ち）` : `（上限 ${b.cap}）`}</td><td class="v">${b.base}</td></tr>`,
    ...b.chipLines.map((l) => lineRow(l, (x) => `＋${x}`)),
    `<tr class="sum"><td colspan="2">基本点</td><td class="v">${b.chips}</td></tr>`,
    `<tr class="sec"><td colspan="3">倍率</td></tr>`,
    `<tr class="hit"><td class="n">はじめ</td><td class="d"></td><td class="v">1</td></tr>`,
    ...b.multLines.map((l) => lineRow(l, (x) => `＋${fmtMult(x)}`)),
    ...b.xLines.map((l) => lineRow(l, (x) => `×${fmtMult(x)}`)),
    `<tr class="sum"><td colspan="2">倍率</td><td class="v">${fmtMult(b.mult)}${b.xmult !== 1 ? ` × ${fmtMult(b.xmult)}` : ""}</td></tr>`,
  ].join("");
  return `<table class="lines">${rows}</table>`;
}

export function speedText(e: Entry) {
  return e.keys ? `打鍵 ${e.keys}・${e.secs.toFixed(1)} 秒（点には入らない）` : "";
}

export function breakdownHtml(e: Entry) {
  const sp = speedText(e);
  return `<div class="bd">
    <div class="bd-head"><span class="bd-text">${esc(e.text)}</span><span class="bd-total">${formulaHtml(e.bd)}</span></div>
    <div class="tokens">${tokenChips(e.morph.tokens)}</div>
    <div class="reading">読み: ${esc(e.morph.reading)}${sp ? `　<span class="speed">${sp}</span>` : ""}</div>
    ${breakdownTable(e.bd)}
  </div>`;
}

export function renderLog(el: HTMLElement, played: Entry[]) {
  const parts: string[] = [];
  let r = 0;
  for (let i = played.length - 1; i >= 0; i--) {
    const e = played[i];
    if (e.round !== r) {
      r = e.round;
      parts.push(`<div class="log-round">ラウンド ${r}</div>`);
    }
    parts.push(`<details class="log-e"><summary><span class="log-t">${esc(e.text)}</span><span class="log-s">${e.total} 点</span></summary>${breakdownHtml(e)}</details>`);
  }
  el.innerHTML = parts.length ? `<div class="log-title">これまでの文（押すと内訳が開く）</div>${parts.join("")}` : "";
}
