// 送った文の点の数え上げ（Balatro の数え上げのように、効いたカードを 1 枚ずつ順に見せる）。
// 内訳の行は最初に全部作っておき、順に見せていく。飛ばされたら（skip）残りを一度に出して最後の状態にする。
import "./stage.css";
import type { Line } from "../cards";
import { sfx } from "../fx/audio";
import { bump, burst, countUp, floatText, type Run } from "../fx/motion";
import { breakdownTable, formulaHtml, speedText, tokenChips, type Entry } from "./breakdown";
import { fireDeckCard } from "./cards-view";
import { $, esc, fmtMult } from "./dom";
import { setGateShown } from "./hud";

const r1 = (x: number) => Math.round(x * 10) / 10;

type Row = { line: Line | null; kind: "base" | "chips" | "mult" | "xmult"; html: string };

function rowHtml(i: number, kind: Row["kind"], name: string, detail: string, val: string, hit: boolean) {
  return `<li class="ln k-${kind} ${hit ? "hit" : "miss"} pending" data-row="${i}"><span class="ln-name">${esc(name)}</span><span class="ln-detail">${esc(detail)}</span><span class="ln-val">${val}</span></li>`;
}

export function setScorebox(chips: number, mult: number, total: number | null) {
  $("sb-chips").textContent = String(Math.round(chips));
  $("sb-mult").textContent = fmtMult(r1(mult));
  $("sb-total").textContent = total === null ? "—" : String(Math.round(total));
}

export async function playScoring(run: Run, e: Entry, o: { roundFrom: number; roundTo: number; gate: number }) {
  const b = e.bd;
  const stage = $("stage");
  const rows: Row[] = [];
  rows.push({ line: null, kind: "base", html: rowHtml(0, "base", "読みの音の数", `${b.mora} 拍${b.mora > b.cap ? `（上限 ${b.cap} で頭打ち）` : `（上限 ${b.cap}）`}`, String(b.base), true) });
  for (const l of b.chipLines) rows.push({ line: l, kind: "chips", html: rowHtml(rows.length, "chips", l.card.name, l.result.detail, l.result.hit ? `＋${l.result.amount}` : "—", l.result.hit) });
  for (const l of b.multLines) rows.push({ line: l, kind: "mult", html: rowHtml(rows.length, "mult", l.card.name, l.result.detail, l.result.hit ? `＋${fmtMult(l.result.amount)}` : "—", l.result.hit) });
  for (const l of b.xLines) rows.push({ line: l, kind: "xmult", html: rowHtml(rows.length, "xmult", l.card.name, l.result.detail, l.result.hit ? `×${fmtMult(l.result.amount)}` : "—", l.result.hit) });
  const sp = speedText(e);
  stage.innerHTML = `<div class="st ${b.duplicate ? "dup" : ""}">
    <div class="st-text">${esc(e.text)}</div>
    <div class="tokens st-tokens">${tokenChips(e.morph.tokens)}</div>
    <div class="reading">読み: ${esc(e.morph.reading)}${sp ? `　<span class="speed">${sp}</span>` : ""}</div>
    <ol class="st-lines">${b.duplicate ? "" : rows.map((r) => r.html).join("")}</ol>
    <div class="st-formula pending">${formulaHtml(b)}</div>
    <details class="st-table"><summary>表で見る</summary>${breakdownTable(b)}</details>
  </div>`;
  const st = stage.firstElementChild as HTMLElement;
  bump(st, "enter");
  const box = $("scorebox");
  box.classList.add("active");
  box.classList.remove("dup", "big");
  setScorebox(0, 1, null);
  const reveal = (i: number) => stage.querySelector(`[data-row="${i}"]`)?.classList.remove("pending");

  await run.wait(Math.min(520, 140 + e.morph.tokens.length * 28));

  if (b.duplicate) {
    sfx.zero();
    box.classList.add("dup");
    bump(box, "shake");
    setScorebox(0, 0, 0);
  } else {
    // 基本点
    reveal(0);
    await countUp(run, (v) => ($("sb-chips").textContent = String(Math.round(v))), 0, b.base, 420, (i) => run.live && sfx.tick(i), Math.min(10, b.base));
    bump($("sb-chips").parentElement, "bump");
    await run.wait(160);
    let chips = b.base, add = 0, x = 1, step = 0;
    for (const [i, r] of rows.entries()) {
      if (!r.line || !r.line.result.hit) continue;
      if (run.live) {
        fireDeckCard(r.line.card.id);
        reveal(i);
      }
      const a = r.line.result.amount;
      if (r.kind === "chips") {
        const from = chips;
        chips += a;
        if (run.live) {
          sfx.chips(step++);
          floatText($("sb-chips"), `＋${a}`, "chips");
        }
        await countUp(run, (v) => ($("sb-chips").textContent = String(Math.round(v))), from, chips, 220, undefined, 4);
        bump($("sb-chips").parentElement, "bump");
        await run.wait(200);
      } else if (r.kind === "mult") {
        add = r1(add + a);
        $("sb-mult").textContent = fmtMult(r1((1 + add) * x));
        if (run.live) {
          sfx.mult(step++);
          floatText($("sb-mult"), `＋${fmtMult(a)}`, "mult");
        }
        bump($("sb-mult").parentElement, "bump");
        await run.wait(300);
      } else {
        x *= a;
        $("sb-mult").textContent = fmtMult(r1((1 + add) * x));
        if (run.live) {
          sfx.xmult();
          floatText($("sb-mult"), `×${fmtMult(a)}`, "xmult");
          burst($("sb-mult"), 10, "xmult");
        }
        bump($("sb-mult").parentElement, "slam");
        await run.wait(440);
      }
    }
    // 効かなかったカードの行は最後にまとめて出す
    rows.forEach((_, i) => reveal(i));
    setScorebox(b.chips, b.mult * b.xmult, null);
    await run.wait(160);
    // この文の点
    const big = b.total >= o.gate * 0.4 || b.xmult > 1;
    await countUp(run, (v) => ($("sb-total").textContent = String(Math.round(v))), 0, b.total, big ? 520 : 320, undefined, 10);
    if (run.live) sfx.total(big);
    if (big) {
      box.classList.add("big");
      if (run.live) burst($("sb-total"), 16, "total");
    }
    bump($("sb-total").parentElement, "slam");
  }
  stage.querySelector(".st-formula")?.classList.remove("pending");
  await run.wait(200);

  // ラウンドの点へ足す
  const crossed = o.roundFrom < o.gate && o.roundTo >= o.gate;
  if (run.live && o.roundTo !== o.roundFrom) floatText($("gate-text"), `＋${o.roundTo - o.roundFrom}`, "gain");
  await countUp(run, (v) => setGateShown(v, o.gate), o.roundFrom, o.roundTo, 420, undefined, 12);
  setGateShown(o.roundTo, o.gate);
  if (crossed) {
    if (run.live) {
      sfx.gate();
      burst($("bar-fill"), 22, "gate");
    }
    await run.wait(300);
  }
  // 飛ばされても、最後の状態はかならず同じにする
  stage.querySelectorAll(".pending").forEach((el) => el.classList.remove("pending"));
  if (b.duplicate) setScorebox(0, 0, 0);
  else setScorebox(b.chips, b.mult * b.xmult, b.total);
  box.classList.remove("active");
}

export function stageIntro(html: string) {
  $("stage").innerHTML = html;
  setScorebox(0, 1, null);
}
