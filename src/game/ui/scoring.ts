// 送った文の点の数え上げ（Balatro の数え上げのように、効いたカードを 1 枚ずつ順に見せる）。
// 内訳の行は最初に全部作っておき、順に見せていく。飛ばされたら（skip）残りを一度に出して最後の状態にする。
// 行には「効いた・あと少し・効かず」の札を付ける（判定は verdict.ts）。最後に枚数のまとめを出す。
import "./stage.css";
import { sfx } from "../fx/audio";
import { bump, burst, countUp, floatText, type Run } from "../fx/motion";
import { breakdownTable, formulaHtml, moraDetail, speedText, tokenChips, type Entry } from "./breakdown";
import { fireDeckCard } from "./cards-view";
import { $, esc, fmtMult } from "./dom";
import { setGateShown } from "./hud";
import { STATE_LABEL, type Verdict, type VerdictState } from "./verdict";

const r1 = (x: number) => Math.round(x * 10) / 10;
/** 解析の区切りを最初から開いておく語の数（これより長い文は閉じておき、判定の行を先に見せる） */
const PARSE_OPEN_MAX = 28;

type Kind = "base" | "chips" | "mult" | "xmult" | "rule";
type Row = { v: Verdict | null; kind: Kind; amount: number };

function rowHtml(i: number, kind: Kind, state: VerdictState, name: string, detail: string, val: string, tip = "") {
  return `<li class="ln k-${kind} s-${state} pending" data-row="${i}">
    <span class="ln-state">${kind === "base" ? "基本" : STATE_LABEL[state]}</span>
    <span class="ln-name">${esc(name)}</span>
    <span class="ln-val">${val}</span>
    <span class="ln-detail">${esc(detail)}${tip ? `<span class="ln-tip">${esc(tip)}</span>` : ""}</span>
  </li>`;
}

export function setScorebox(chips: number, mult: number, total: number | null) {
  $("sb-chips").textContent = String(Math.round(chips));
  $("sb-mult").textContent = fmtMult(r1(mult));
  $("sb-total").textContent = total === null ? "—" : String(Math.round(total));
}

/** 舞台の中だけを動かして el を見せる（ページは動かさない） */
function keepInView(el: Element | null) {
  const stage = $("stage");
  if (!el) return;
  const a = el.getBoundingClientRect(), b = stage.getBoundingClientRect();
  if (a.bottom > b.bottom) stage.scrollTop += a.bottom - b.bottom + 8;
  else if (a.top < b.top) stage.scrollTop += a.top - b.top - 8;
}

/** 文の長さで字の大きさの段を決める（長い文は舞台の中で折り返し、字を一段ずつ小さくする） */
function textSize(text: string) {
  const n = [...text].length;
  return n > 80 ? "xl" : n > 48 ? "l" : n > 26 ? "m" : "s";
}

export async function playScoring(run: Run, e: Entry, vs: Verdict[], o: { roundFrom: number; roundTo: number; gate: number }) {
  const b = e.bd;
  const stage = $("stage");
  const byId = new Map(vs.map((v) => [v.card.id, v]));
  const rows: Row[] = [{ v: null, kind: "base", amount: b.base }];
  const html: string[] = [rowHtml(0, "base", "hit", "読みの音の数", moraDetail(b), String(b.base))];
  const add = (v: Verdict | undefined, kind: Kind, amount: number) => {
    if (!v) return;
    html.push(rowHtml(rows.length, kind, v.state, v.card.name, v.why, v.value, v.tip));
    rows.push({ v, kind, amount });
  };
  for (const l of b.chipLines) add(byId.get(l.card.id), "chips", l.result.amount);
  for (const l of b.multLines) add(byId.get(l.card.id), "mult", l.result.amount);
  for (const l of b.xLines) add(byId.get(l.card.id), "xmult", l.result.amount);
  const count = (s: VerdictState) => vs.filter((v) => v.state === s).length;
  const summary = vs.length
    ? `<div class="st-summary pending"><span class="sm s-hit">効いた <b>${count("hit")}</b></span><span class="sm s-near">あと少し <b>${count("near")}</b></span><span class="sm s-miss">効かず <b>${count("miss")}</b></span></div>`
    : `<div class="st-summary pending"><span class="sm s-none">カードはまだ無い。拍の数だけが点になる。</span></div>`;
  const sp = speedText(e);
  stage.scrollTop = 0;
  stage.innerHTML = `<div class="st ${b.duplicate ? "dup" : ""}">
    <div class="st-head">
      <div class="st-text size-${textSize(e.text)}">${esc(e.text)}</div>
      <details class="st-parse" ${e.morph.tokens.length <= PARSE_OPEN_MAX ? "open" : ""}>
        <summary>解析の区切り（${e.morph.tokens.length} 語）</summary>
        <div class="tokens st-tokens">${tokenChips(e.morph.tokens)}</div>
        <div class="reading">読み: ${esc(e.morph.reading)}${sp ? `　<span class="speed">${sp}</span>` : ""}</div>
      </details>
    </div>
    ${b.duplicate ? `<div class="st-dup">このランで前にも送った文なので 0 点（同じ文は 2 回目から点にならない）</div>` : `${summary}<ol class="st-lines">${html.join("")}</ol>`}
    <div class="st-foot"><div class="st-formula pending">${formulaHtml(b)}</div>
    <details class="st-table"><summary>表で見る</summary>${breakdownTable(b)}</details></div>
  </div>`;
  const st = stage.firstElementChild as HTMLElement;
  bump(st, "enter");
  const box = $("scorebox");
  box.classList.add("active");
  box.classList.remove("dup", "big");
  setScorebox(0, 1, null);
  const reveal = (i: number) => {
    const el = stage.querySelector(`[data-row="${i}"]`);
    el?.classList.remove("pending");
    if (run.live) keepInView(el);
  };

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
    let chips = b.base, addm = 0, x = 1, step = 0;
    for (const [i, r] of rows.entries()) {
      if (!r.v || r.v.state !== "hit" || r.kind === "base" || r.kind === "rule") continue;
      if (run.live) {
        fireDeckCard(r.v.card.id);
        reveal(i);
      }
      const a = r.amount;
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
        addm = r1(addm + a);
        $("sb-mult").textContent = fmtMult(r1((1 + addm) * x));
        if (run.live) {
          sfx.mult(step++);
          floatText($("sb-mult"), `＋${fmtMult(a)}`, "mult");
        }
        bump($("sb-mult").parentElement, "bump");
        await run.wait(300);
      } else {
        x *= a;
        $("sb-mult").textContent = fmtMult(r1((1 + addm) * x));
        if (run.live) {
          sfx.xmult();
          floatText($("sb-mult"), `×${fmtMult(a)}`, "xmult");
          burst($("sb-mult"), 10, "xmult");
        }
        bump($("sb-mult").parentElement, "slam");
        await run.wait(440);
      }
    }
    // 効かなかった・あと少しのカードの行は最後にまとめて出す
    rows.forEach((_, i) => stage.querySelector(`[data-row="${i}"]`)?.classList.remove("pending"));
    stage.querySelector(".st-summary")?.classList.remove("pending");
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
  const stage = $("stage");
  stage.scrollTop = 0;
  stage.innerHTML = html;
  setScorebox(0, 1, null);
}
