// ゲームの進行（状態と流れ）。見た目は ui/、音と動きは fx/、点の計算は cards.ts、ラウンドの決めごとは rules.ts。
import "./ui/theme.css";
import "./ui/base.css";
import "./ui/fx.css";
import type { IpadicFeatures, Tokenizer } from "kuromoji";
import { analyze, loadTokenizer } from "../morph";
import { EmbedClient } from "./embed-client";
import { BASE_CAP, CARDS, CARD_BY_ID, moraCount, scoreSentence, type CardDef } from "./cards";
import { drawOffers, gateFor, HANDS, OFFER_COUNT } from "./rules";
import { sfx, unlockAudio } from "./fx/audio";
import { bump, confetti, Run } from "./fx/motion";
import { onSettings, settings, updateSettings } from "./fx/settings";
import { renderLog, type Entry } from "./ui/breakdown";
import { showOffers } from "./ui/cards-view";
import { $, esc } from "./ui/dom";
import { renderHud } from "./ui/hud";
import { initInput, setInputEnabled, takeKeyStats } from "./ui/input";
import { closeOverlay, initOverlay, openOverlay, overlayOpen } from "./ui/overlay";
import { playScoring, stageIntro } from "./ui/scoring";
import { showSettings } from "./ui/settings-view";

const SEEN_KEY = "freeform-typing.seen-cards.v1";
const BEST_KEY = "freeform-typing.best.v1";

// ---- 状態 ----
// play: 打てる / busy: 点を計算中 / ending: ラウンドの最後の文の数え上げ中 / next: 「カードを選ぶ」等のボタン待ち / pick: カードを選ぶ画面 / over: 終わり
type Phase = "play" | "busy" | "ending" | "next" | "pick" | "over";
const S = {
  round: 1,
  owned: [] as string[],
  played: [] as Entry[],
  roundScore: 0,
  handsLeft: HANDS,
  phase: "play" as Phase,
  offers: [] as string[],
  runTotal: 0,
};
/** 画面に出しているラウンドの点（数え上げの途中は S.roundScore より小さい） */
let shown = 0;
let run: Run | null = null;
let animDone: Promise<void> = Promise.resolve();

let tokenizer: Tokenizer<IpadicFeatures> | null = null;
const emb = new EmbedClient();
const seen = new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"));
const markSeen = (id: string) => {
  seen.add(id);
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
};

// ---- 状態表示（下の帯） ----
const status: Record<string, string> = {};
function setStatus(k: string, v: string) {
  if (v) status[k] = v;
  else delete status[k];
  $("status").innerHTML = Object.values(status).join(" ／ ");
}
function embStatus(msg: string) {
  if (emb.state === "loading") setStatus("emb", `意味のモデルを読み込み中（終わるまで、意味の距離を使うカードは出ない）${msg ? "… " + esc(msg) : ""}`);
  else if (emb.state === "ready") setStatus("emb", `意味のモデル: 準備できた（${esc(emb.info?.key.split("|")[0] ?? "")}）`);
  else setStatus("emb", `<span class="err">意味のモデルが使えない: ${esc(emb.error)}（意味のカードは出ない）</span>`);
}

const hud = (newCard?: string) => renderHud({ round: S.round, gate: gateFor(S.round), shown, handsLeft: S.handsLeft, hands: HANDS, owned: S.owned }, newCard);

function intro() {
  stageIntro(`<div class="intro">
    <h2>遊び方</h2>
    <p>お題は無い。好きな日本語の文を打って <kbd>Enter</kbd> で送る。ローマ字で打ち、漢字に変換してよい（変換した方が文の解析が正しくなる）。</p>
    <p>1 ラウンドで送れるのは ${HANDS} 文。合計がゲートの点に届けばクリアで、得点のルールのカードを ${OFFER_COUNT} 枚から 1 枚選んで足せる。届かなければ終わり。</p>
    <p>最初のルールは「読みの音の数（拍）が点になる（1 文 ${BASE_CAP} まで）」だけ。カードを足すほど、何を打てば点になるかが変わっていく。同じ文には同じ点が付き、送るたびに内訳が出る。</p>
  </div>`);
}

function roundBanner() {
  stageIntro(`<div class="round-start"><div class="rs-round">ラウンド ${S.round}</div><div class="rs-gate">ゲート <b>${gateFor(S.round)}</b> 点 ・ ${HANDS} 文まで</div></div>`);
  bump($("stage").firstElementChild, "enter");
}

// ---- 進行 ----
/** 演出の途中なら最後まで飛ばす */
function skip() {
  run?.skip();
}

async function submit(text: string): Promise<boolean> {
  text = text.trim();
  if (!text || S.phase !== "play") return false;
  if (!tokenizer) {
    setStatus("send", "辞書の読み込みを待っている…");
    return false;
  }
  // 前の文の数え上げが残っていれば飛ばす（打つ手を止めない）
  skip();
  S.phase = "busy";
  await animDone;
  setStatus("send", "");
  const { keys, secs } = takeKeyStats();
  try {
    const morph = analyze(tokenizer, text);
    const prev = S.played.length ? S.played[S.played.length - 1] : null;
    const bd = await scoreSentence(
      { text, morph, prev, past: S.played, roundPast: S.played.filter((p) => p.round === S.round), emb: emb.state === "ready" ? emb : null },
      S.owned,
    );
    const e: Entry = { text, morph, total: bd.total, round: S.round, bd, keys, secs };
    const from = S.roundScore;
    S.played.push(e);
    S.roundScore += bd.total;
    S.runTotal += bd.total;
    S.handsLeft--;
    const gate = gateFor(S.round);
    const outcome = S.roundScore >= gate ? "clear" : S.handsLeft <= 0 ? "over" : "continue";
    S.phase = outcome === "continue" ? "play" : "ending";
    renderLog($("log"), S.played);
    renderHud({ round: S.round, gate, shown, handsLeft: S.handsLeft, hands: HANDS, owned: S.owned });
    const unk = morph.tokens.filter((t) => t.wordType === "UNKNOWN").length;
    $("hint").textContent =
      !/[一-龯々ァ-ヶ]/.test(text) && [...text].length >= 6
        ? "ひらがなだけの文は解析が崩れやすい（区切りがずれて名詞や固有名詞が見えなくなる）。漢字に変換して送ると正しく読める。"
        : unk >= 2
          ? `辞書に無い語が ${unk} つあった（赤い字）。読みが取れないので、拍の数に入らない。`
          : "";
    const r = new Run();
    run = r;
    animDone = playScoring(r, e, { roundFrom: from, roundTo: S.roundScore, gate })
      .catch((err) => console.error(err))
      .finally(() => {
        shown = S.roundScore;
        if (run === r) run = null;
        if (outcome !== "continue") showNext(outcome);
      });
    return true;
  } catch (err) {
    setStatus("send", `<span class="err">計算に失敗: ${esc(String(err))}</span>`);
    S.phase = "play";
    return false;
  }
}

/** ラウンドの終わり。最後の文の内訳を読めるように、すぐには重ねず、ボタンを出して待つ。 */
function showNext(kind: "clear" | "over") {
  S.phase = "next";
  setInputEnabled(false);
  const gate = gateFor(S.round);
  $("next").innerHTML =
    kind === "clear"
      ? `<div class="next clear"><span><b>ラウンド ${S.round} クリア</b>（${S.roundScore} / ${gate} 点）</span><button id="next-btn" disabled>カードを選ぶ <kbd>Enter</kbd></button></div>`
      : `<div class="next over"><span><b>ゲートに届かなかった</b>（${S.roundScore} / ${gate} 点）</span><button id="next-btn" disabled>結果を見る <kbd>Enter</kbd></button></div>`;
  const banner = $("next").firstElementChild!;
  bump(banner, "enter");
  if (kind === "clear") {
    sfx.clear();
    confetti();
  } else {
    sfx.over();
    bump(banner, "shake");
  }
  const btn = $<HTMLButtonElement>("next-btn");
  btn.addEventListener("click", () => (kind === "clear" ? clearRound() : gameOver()));
  // 押しっぱなしの Enter がそのままボタンを押さないよう、少し置いてから押せるようにする
  setTimeout(() => {
    btn.disabled = false;
    if (S.phase === "next" && !overlayOpen()) btn.focus();
  }, 300);
}

function eligibleCards(): CardDef[] {
  return CARDS.filter((c) => !S.owned.includes(c.id) && (c.source !== "埋め込み" || emb.state === "ready"));
}

function clearRound() {
  if (S.phase !== "next") return;
  S.phase = "pick";
  const best = Number(localStorage.getItem(BEST_KEY) ?? "0");
  if (S.round > best) localStorage.setItem(BEST_KEY, String(S.round));
  // 3 枚を無作為に（引くのは毎回ちがってよい。点の計算は決定的）
  S.offers = drawOffers(eligibleCards()).map((c) => c.id);
  const used = HANDS - S.handsLeft;
  const head = `<div class="clear-head"><div class="ch-title">ラウンド ${S.round} クリア</div>
    <div class="ch-stats"><span>${used} 文で <b>${S.roundScore}</b> 点（ゲート ${gateFor(S.round)}）</span><span>次のゲート <b>${gateFor(S.round + 1)}</b> 点</span></div></div>`;
  if (!S.offers.length) {
    openOverlay(`${head}<p>取れるカードはもう無い。</p><div class="ov-actions"><button id="ov-next">次のラウンドへ</button></div>`, { closable: false, variant: "wide" });
    $("ov-next").addEventListener("click", () => pick(-1));
    $("ov-next").focus();
    return;
  }
  const note =
    (emb.state === "loading" ? `<p class="note">意味のモデルを読み込み中なので、意味の距離を使うカードはまだ出ていない。</p>` : "") +
    `<p class="ov-lead">ルールを 1 枚選んで足す。</p>`;
  showOffers(head, S.offers, seen, note, pick);
  S.offers.forEach(markSeen);
}

function pick(i: number) {
  if (S.phase !== "pick") return;
  const got = i >= 0 && S.offers[i] ? S.offers[i] : undefined;
  if (got) S.owned.push(got);
  S.round++;
  S.roundScore = 0;
  shown = 0;
  S.handsLeft = HANDS;
  S.offers = [];
  S.phase = "play";
  $("next").innerHTML = "";
  closeOverlay();
  hud(got);
  roundBanner();
  setInputEnabled(true);
}

function gameOver() {
  if (S.phase !== "next") return;
  S.phase = "over";
  const best = Math.max(Number(localStorage.getItem(BEST_KEY) ?? "0"), S.round - 1);
  localStorage.setItem(BEST_KEY, String(best));
  const top = S.played.reduce<Entry | null>((a, e) => (!a || e.total > a.total ? e : a), null);
  openOverlay(
    `<div class="over-head"><div class="oh-title">ゲームオーバー</div>
      <div class="oh-sub">ラウンド ${S.round}: ${S.roundScore} / ${gateFor(S.round)} 点</div></div>
    <div class="over-stats">
      <div><span class="lbl">越えたラウンド</span><b>${S.round - 1}</b></div>
      <div><span class="lbl">これまでの最高</span><b>${best}</b></div>
      <div><span class="lbl">このランの合計</span><b>${S.runTotal}</b></div>
      <div><span class="lbl">送った文</span><b>${S.played.length}</b></div>
    </div>
    ${top ? `<p class="over-best"><span class="lbl">一番点の高かった文</span><br/>「${esc(top.text)}」 <b>${top.total}</b> 点</p>` : ""}
    <p class="over-deck">手持ちのルール: ${S.owned.length ? S.owned.map((id) => esc(CARD_BY_ID.get(id)!.name)).join("、") : "なし"}</p>
    <div class="ov-actions"><button id="ov-look" class="ghost">内訳を見返す</button><button id="ov-restart">はじめから <kbd>Enter</kbd></button></div>`,
    { closable: false, variant: "narrow over" },
  );
  $("ov-restart").addEventListener("click", restart);
  $("ov-restart").focus();
  $("ov-look").addEventListener("click", () => {
    closeOverlay();
    $("next").innerHTML = `<div class="next over"><span>このランは終わり。内訳は下の一覧で開ける。</span><button id="next-btn">はじめから</button></div>`;
    $("next-btn").addEventListener("click", restart);
  });
}

function restart() {
  skip();
  Object.assign(S, { round: 1, owned: [], played: [], roundScore: 0, handsLeft: HANDS, phase: "play", offers: [], runTotal: 0 });
  shown = 0;
  $("hint").textContent = "";
  $("next").innerHTML = "";
  closeOverlay();
  intro();
  hud();
  renderLog($("log"), S.played);
  setInputEnabled(true);
}

// ---- 起動 ----
async function initMorph() {
  setStatus("morph", "辞書を読み込み中…");
  try {
    tokenizer = (await loadTokenizer(import.meta.env.BASE_URL + "dict/")).tokenizer;
    setStatus("morph", "");
  } catch (e) {
    setStatus("morph", `<span class="err">辞書の読み込みに失敗: ${esc(String(e))}</span>`);
  }
}

function init() {
  initOverlay();
  const inp = initInput({
    canSubmit: () => S.phase === "play",
    onSubmit: (t) => void submit(t),
    onSkip: skip,
    liveMora: (t) => (tokenizer ? moraCount(analyze(tokenizer, t).reading) : null),
  });
  onSettings(() => inp.updateLive());
  // 数え上げの表示を押すと最後まで飛ばす
  $("stage").addEventListener("click", skip);
  $("scorebox").addEventListener("click", skip);
  $("btn-settings").addEventListener("click", () => {
    unlockAudio();
    showSettings(() => {
      if (S.phase === "play") $<HTMLInputElement>("text").focus();
    });
  });
  document.addEventListener("keydown", (ev) => {
    if (overlayOpen() || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const input = $<HTMLInputElement>("text");
    if (document.activeElement === input) return;
    // ラウンドの最後の文の数え上げ中は Enter・スペースで飛ばす
    if ((ev.key === "Enter" || ev.key === " ") && run && S.phase === "ending") {
      ev.preventDefault();
      skip();
      return;
    }
    // 入力欄の外で文字を打ち始めたら入力欄へ
    if (S.phase === "play" && ev.key.length === 1 && ev.key !== " ") input.focus();
  });

  intro();
  hud();
  void initMorph();
  emb.onChange = embStatus;
  embStatus("");
  void emb.load();
  setInputEnabled(true);

  // ヘッドレス検証用の口
  (window as unknown as Record<string, unknown>).__game = {
    state: () => S,
    phase: () => S.phase,
    submit,
    pick,
    restart,
    skip,
    next: () => $<HTMLButtonElement>("next-btn")?.click(),
    animating: () => !!run,
    idle: () => animDone,
    ready: () => !!tokenizer,
    embState: () => emb.state,
    gateFor,
    settings: () => ({ ...settings }),
    setSettings: updateSettings,
  };
}

init();
