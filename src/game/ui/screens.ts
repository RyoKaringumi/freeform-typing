// 画面全体を覆う場面（タイトル・ゲームオーバー）。重ねる枠（overlay.ts）の「screen」の型で出す。
import "./screens.css";
import { CARD_BY_ID } from "../cards";
import { HANDS, MORA_BUDGET, OFFER_COUNT } from "../rules";
import { KIND_LABEL } from "./cards-view";
import { $, esc } from "./dom";
import { openOverlay } from "./overlay";

export function showTitle(o: { best: number; firstGate: number; onStart: () => void }) {
  const steps = [
    ["お題は出ない", "打つ文は自分で決める。好きな日本語の文を打って <kbd>Enter</kbd>。ローマ字で打ち、漢字に変換してよい。"],
    ["文が点になる", `はじめは、読みの音の数（拍）がそのまま点。送るたびに、何で何点入ったかが出る。`],
    ["拍には限りがある", `1 ラウンドで使える拍は ${MORA_BUDGET} まで、送れる文は ${HANDS} 文まで。長い文は点が大きいぶん、拍を早く使い切る。1 拍あたりの点を上げるのがこつ。`],
    ["ゲートを越える", `ラウンドの合計がゲートの点に届けばクリア。最初のゲートは ${o.firstGate} 点。拍か文を使い切って届かなければ終わり。`],
    ["カードでルールを足す", `クリアするたびに、得点のルールのカードを ${OFFER_COUNT} 枚から 1 枚選ぶ。カードに合う文を打つほど点が伸びる。`],
  ];
  openOverlay(
    `<div class="scr title-scr">
      <div class="ts-logo"><span class="ts-l1">freeform</span><span class="ts-l2">typing</span></div>
      <div class="ts-tag">お題の無いタイピング。打つ文で点を稼ぐ。<span class="tag">試作版</span></div>
      <ol class="ts-steps">${steps.map(([h, p], i) => `<li style="--i:${i}"><span class="ts-n">${i + 1}</span><div><b>${h}</b><p>${p}</p></div></li>`).join("")}</ol>
      <div class="ts-actions">
        <button id="ts-start" class="big-btn">はじめる <kbd>Enter</kbd></button>
        <span id="ts-ready" class="ts-ready"></span>
      </div>
      <div class="ts-foot">${o.best > 0 ? `これまでの最高: ラウンド <b>${o.best}</b> まで越えた ・ ` : ""}<a href="./bench.html">評価のテストベンチ</a> ・ <a href="https://github.com/RyoKaringumi/freeform-typing">GitHub</a></div>
    </div>`,
    {
      closable: false,
      variant: "screen",
      onKey: (ev) => {
        if (ev.key === "Enter" && !ev.repeat && document.activeElement?.id !== "ts-start") {
          ev.preventDefault();
          o.onStart();
        }
      },
    },
  );
  $("ts-start").addEventListener("click", o.onStart);
  $("ts-start").focus();
}

/** タイトルの「準備」の一言（辞書の読み込み） */
export function setTitleReady(msg: string) {
  const el = document.getElementById("ts-ready");
  if (el) el.innerHTML = msg;
}

export type OverData = {
  round: number;
  roundScore: number;
  gate: number;
  best: number;
  newBest: boolean;
  runTotal: number;
  sentences: number;
  rounds: { round: number; score: number; gate: number }[];
  top: { text: string; total: number } | null;
  owned: string[];
};

export function showGameOver(d: OverData, on: { restart: () => void; look: () => void; title: () => void }) {
  const cleared = d.round - 1;
  const maxScore = Math.max(1, ...d.rounds.map((r) => Math.max(r.score, r.gate)));
  openOverlay(
    `<div class="scr over-scr">
      <div class="os-title">ゲームオーバー</div>
      <div class="os-sub">ラウンド ${d.round} のゲート <b>${d.gate}</b> 点に、<b>${d.roundScore}</b> 点で届かなかった（あと ${d.gate - d.roundScore}）</div>
      <div class="os-stats">
        <div class="os-stat main"><span class="lbl">越えたラウンド</span><b>${cleared}</b>${d.newBest ? `<span class="os-new">最高を更新</span>` : ""}</div>
        <div class="os-stat"><span class="lbl">これまでの最高</span><b>${d.best}</b></div>
        <div class="os-stat"><span class="lbl">このランの合計</span><b>${d.runTotal}</b></div>
        <div class="os-stat"><span class="lbl">送った文</span><b>${d.sentences}</b></div>
      </div>
      <div class="os-grid">
        <section class="os-rounds"><div class="os-h">ラウンドごとの点とゲート</div>
          ${d.rounds
            .map(
              (r) => `<div class="os-r ${r.score >= r.gate ? "ok" : "ng"}"><span class="os-rn">R${r.round}</span>
              <span class="os-bar"><span class="os-fill" style="width:${(r.score / maxScore) * 100}%"></span><span class="os-gate" style="left:${(r.gate / maxScore) * 100}%"></span></span>
              <span class="os-rv">${r.score} / ${r.gate}</span></div>`,
            )
            .join("")}
        </section>
        <section class="os-side">
          ${d.top ? `<div class="os-h">一番点の高かった文</div><div class="os-top">「${esc(d.top.text)}」<b>${d.top.total} 点</b></div>` : ""}
          <div class="os-h">手持ちのカード</div>
          <div class="os-deck">${d.owned.length ? d.owned.map((id) => { const c = CARD_BY_ID.get(id)!; return `<span class="os-card k-${c.kind}"><span class="k">${KIND_LABEL[c.kind]}</span>${esc(c.name)}</span>`; }).join("") : `<span class="muted">なし</span>`}</div>
        </section>
      </div>
      <div class="ts-actions">
        <button id="ov-restart" class="big-btn">もう一度 <kbd>Enter</kbd></button>
        <button id="ov-look" class="ghost">内訳を見返す</button>
        <button id="ov-title" class="ghost">タイトルへ</button>
      </div>
    </div>`,
    { closable: false, variant: "screen" },
  );
  $("ov-restart").addEventListener("click", on.restart);
  $("ov-look").addEventListener("click", on.look);
  $("ov-title").addEventListener("click", on.title);
  $("ov-restart").focus();
}
