// ゲームの進行（状態と流れ）。見た目は ui/、音と動きは fx/、点の計算は cards.ts、ラウンドの決めごとは rules.ts。
import "./ui/theme.css";
import "./ui/base.css";
import "./ui/fx.css";
import type { IpadicFeatures, Tokenizer } from "kuromoji";
import { analyze, loadTokenizer } from "../morph";
import { EmbedClient } from "./embed-client";
import { BASE_CAP, CARDS, moraCount, scoreSentence, type CardDef } from "./cards";
import { drawOffers, gateFor, HANDS } from "./rules";
import { sfx, unlockAudio } from "./fx/audio";
import { bump, confetti, Run } from "./fx/motion";
import { onSettings, settings, updateSettings } from "./fx/settings";
import { renderLog, type Entry } from "./ui/breakdown";
import { setExampleEnv } from "./ui/card-guide";
import { hideTip, showOffers } from "./ui/cards-view";
import { $, esc } from "./ui/dom";
import { renderHud } from "./ui/hud";
import { initInput, setInputEnabled, takeKeyStats } from "./ui/input";
import { closeOverlay, initOverlay, openOverlay, overlayOpen } from "./ui/overlay";
import { playScoring, stageIntro } from "./ui/scoring";
import { setTitleReady, showGameOver, showTitle } from "./ui/screens";
import { showSettings } from "./ui/settings-view";
import { nextHint, verdicts, type Verdict } from "./ui/verdict";

const SEEN_KEY = "freeform-typing.seen-cards.v1";
const BEST_KEY = "freeform-typing.best.v1";

// ---- 状態 ----
// title: タイトル画面 / play: 打てる / busy: 点を計算中 / ending: ラウンドの最後の文の数え上げ中 / next: 「カードを選ぶ」等のボタン待ち / pick: カードを選ぶ画面 / over: 終わり
type Phase = "title" | "play" | "busy" | "ending" | "next" | "pick" | "over";
const S = {
  round: 1,
  owned: [] as string[],
  played: [] as Entry[],
  roundScore: 0,
  handsLeft: HANDS,
  phase: "title" as Phase,
  offers: [] as string[],
  runTotal: 0,
};
/** 画面に出しているラウンドの点（数え上げの途中は S.roundScore より小さい） */
let shown = 0;
let run: Run | null = null;
let animDone: Promise<void> = Promise.resolve();
/** 直前の文でのカードごとの判定（手持ちの列に出す） */
let lastVerdicts: Verdict[] = [];

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

/** 帯と手持ちの列を描き直す。withVerdicts=false なら判定の札を消す（数え上げの間は先に見せない）。 */
function hud(newCard?: string, withVerdicts = true) {
  const last = S.played.length ? S.played[S.played.length - 1] : null;
  const hints: Record<string, string> = {};
  if (withVerdicts) for (const id of S.owned) {
    const h = nextHint(id, last);
    if (h) hints[id] = h;
  }
  renderHud(
    {
      round: S.round,
      gate: gateFor(S.round),
      shown,
      handsLeft: S.handsLeft,
      hands: HANDS,
      owned: S.owned,
      runTotal: S.runTotal,
      verdicts: withVerdicts ? lastVerdicts : [],
      hints,
    },
    newCard,
  );
}

function roundBanner() {
  const first = S.round === 1;
  stageIntro(`<div class="round-start">
    <div class="rs-round">ラウンド ${S.round}</div>
    <div class="rs-gate">ゲート <b>${gateFor(S.round)}</b> 点 ・ ${HANDS} 文まで</div>
    <div class="rs-tip">${
      first
        ? `好きな文を打って <kbd>Enter</kbd>。いまは読みの音の数（拍）がそのまま点（1 文 ${BASE_CAP} 拍まで）。`
        : `手持ちのカード ${S.owned.length} 枚。カードに乗せると説明が出る。`
    }</div>
  </div>`);
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
    const vs = verdicts(e, prev, S.owned);
    lastVerdicts = [];
    hud(undefined, false);
    const unk = morph.tokens.filter((t) => t.wordType === "UNKNOWN").length;
    $("hint").textContent =
      !/[一-龯々ァ-ヶ]/.test(text) && [...text].length >= 6
        ? "ひらがなだけの文は解析が崩れやすい（区切りがずれて名詞や固有名詞が見えなくなる）。漢字に変換して送ると正しく読める。"
        : unk >= 2
          ? `辞書に無い語が ${unk} つあった（赤い字）。読みが取れないので、拍の数に入らない。`
          : "";
    const r = new Run();
    run = r;
    animDone = playScoring(r, e, vs, { roundFrom: from, roundTo: S.roundScore, gate })
      .catch((err) => console.error(err))
      .finally(() => {
        shown = S.roundScore;
        if (run === r) run = null;
        lastVerdicts = vs;
        hud();
        if (outcome !== "continue") showNext(outcome);
      });
    return true;
  } catch (err) {
    setStatus("send", `<span class="err">計算に失敗: ${esc(String(err))}</span>`);
    S.phase = "play";
    return false;
  }
}

/** ラウンドの終わり。最後の文の内訳を読めるように、すぐには重ねず、入力欄の場所にボタンを出して待つ。 */
function showNext(kind: "clear" | "over") {
  S.phase = "next";
  setInputEnabled(false);
  const gate = gateFor(S.round);
  $("next").innerHTML =
    kind === "clear"
      ? `<div class="next clear"><span><b>ラウンド ${S.round} クリア</b> ${S.roundScore} / ${gate} 点</span><button id="next-btn" disabled>カードを選ぶ <kbd>Enter</kbd></button></div>`
      : `<div class="next over"><span><b>ゲートに届かなかった</b> ${S.roundScore} / ${gate} 点</span><button id="next-btn" disabled>結果を見る <kbd>Enter</kbd></button></div>`;
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
    `<p class="ov-lead">得点のルールを 1 枚選んで足す。大きい字が「何をすると得か」。</p>`;
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
  const prevBest = Number(localStorage.getItem(BEST_KEY) ?? "0");
  const best = Math.max(prevBest, S.round - 1);
  localStorage.setItem(BEST_KEY, String(best));
  const top = S.played.reduce<Entry | null>((a, e) => (!a || e.total > a.total ? e : a), null);
  const rounds = Array.from({ length: S.round }, (_, i) => {
    const round = i + 1;
    return { round, gate: gateFor(round), score: S.played.filter((p) => p.round === round).reduce((a, p) => a + p.total, 0) };
  });
  showGameOver(
    {
      round: S.round,
      roundScore: S.roundScore,
      gate: gateFor(S.round),
      best,
      newBest: S.round - 1 > prevBest,
      runTotal: S.runTotal,
      sentences: S.played.length,
      rounds,
      top: top ? { text: top.text, total: top.total } : null,
      owned: S.owned,
    },
    {
      restart,
      title: toTitle,
      look: () => {
        closeOverlay();
        $("next").innerHTML = `<div class="next over"><span>このランは終わり。内訳は「これまでの文」で開ける。</span><button id="next-btn">もう一度</button></div>`;
        $("next-btn").addEventListener("click", restart);
        $("next-btn").focus();
      },
    },
  );
}

/** これまでの文の一覧を重ねる枠で出す（縦長の画面や、横の列に入りきらないとき） */
function showLog() {
  hideTip();
  const html = $("log").innerHTML || `<p class="note">まだ何も送っていない。</p>`;
  openOverlay(`<div class="log log-ov">${html}</div><div class="ov-actions"><button id="ov-close">閉じる</button></div>`, {
    variant: "wide",
    onClose: () => {
      if (S.phase === "play") $<HTMLInputElement>("text").focus();
    },
  });
  $("ov-close").addEventListener("click", closeOverlay);
  $("ov-close").focus();
}

function resetRun() {
  skip();
  Object.assign(S, { round: 1, owned: [], played: [], roundScore: 0, handsLeft: HANDS, offers: [], runTotal: 0 });
  shown = 0;
  lastVerdicts = [];
  $("hint").textContent = "";
  $("next").innerHTML = "";
  renderLog($("log"), S.played);
}

function restart() {
  resetRun();
  S.phase = "play";
  closeOverlay();
  roundBanner();
  hud();
  setInputEnabled(true);
}

function toTitle() {
  resetRun();
  S.phase = "title";
  closeOverlay();
  setInputEnabled(false);
  hud();
  stageIntro("");
  showTitle({ best: Number(localStorage.getItem(BEST_KEY) ?? "0"), firstGate: gateFor(1), cap: BASE_CAP, onStart: start });
  setTitleReady(tokenizer ? "準備できた" : "辞書を読み込み中…（はじめても、読み込みが終われば送れる）");
}

/** タイトルからはじめる */
function start() {
  if (S.phase !== "title") return;
  unlockAudio();
  sfx.click();
  closeOverlay();
  S.phase = "play";
  roundBanner();
  hud();
  setInputEnabled(true);
}

// ---- 起動 ----
async function initMorph() {
  setStatus("morph", "辞書を読み込み中…");
  try {
    const tk = (await loadTokenizer(import.meta.env.BASE_URL + "dict/")).tokenizer;
    tokenizer = tk;
    setExampleEnv({ analyze: (t) => analyze(tk, t), emb: () => (emb.state === "ready" ? emb : null) });
    setStatus("morph", "");
    setTitleReady("準備できた");
  } catch (e) {
    setStatus("morph", `<span class="err">辞書の読み込みに失敗: ${esc(String(e))}</span>`);
    setTitleReady(`<span class="err">辞書の読み込みに失敗した</span>`);
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
  $("stage").addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).closest("summary, details")) return; // 「表で見る」を開くときは飛ばさない
    skip();
  });
  $("scorebox").addEventListener("click", skip);
  $("btn-settings").addEventListener("click", () => {
    unlockAudio();
    hideTip();
    showSettings(() => {
      if (S.phase === "play") $<HTMLInputElement>("text").focus();
    });
  });
  $("btn-log").addEventListener("click", showLog);
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

  void initMorph();
  emb.onChange = embStatus;
  embStatus("");
  void emb.load();
  toTitle();

  // ヘッドレス検証用の口
  (window as unknown as Record<string, unknown>).__game = {
    state: () => S,
    phase: () => S.phase,
    submit,
    pick,
    restart,
    start,
    toTitle,
    skip,
    next: () => $<HTMLButtonElement>("next-btn")?.click(),
    animating: () => !!run,
    idle: () => animDone,
    ready: () => !!tokenizer,
    embState: () => emb.state,
    gateFor,
    settings: () => ({ ...settings }),
    setSettings: updateSettings,
    verdicts: () => lastVerdicts.map((v) => ({ id: v.card.id, state: v.state, value: v.value, tip: v.tip ?? "" })),
  };
}

init();
