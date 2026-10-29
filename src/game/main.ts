import "./game.css";
import type { IpadicFeatures, Tokenizer } from "kuromoji";
import { analyze, loadTokenizer, type TokenRow } from "../morph";
import { EmbedClient } from "./embed-client";
import { drawOffers, gateFor, HANDS, OFFER_COUNT } from "./rules";
import { BASE_CAP, CARDS, CARD_BY_ID, scoreSentence, type Breakdown, type CardDef, type Line, type Played } from "./cards";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const SEEN_KEY = "freeform-typing.seen-cards.v1";
const BEST_KEY = "freeform-typing.best.v1";

// ---- 状態 ----
type Entry = Played & { round: number; bd: Breakdown; keys: number; secs: number };
type Phase = "play" | "busy" | "pick" | "over";
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
let tokenizer: Tokenizer<IpadicFeatures> | null = null;
const emb = new EmbedClient();
const seen = new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"));
const markSeen = (id: string) => {
  seen.add(id);
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
};

// 打鍵の記録（点には入れない。表示だけ）
let keyCount = 0;
let keyStart = 0;

// ---- 状態表示 ----
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

// ---- 描画 ----
function renderTop() {
  const gate = gateFor(S.round);
  $("round").textContent = String(S.round);
  $("gate-text").innerHTML = `<b>${S.roundScore}</b> / ${gate} 点`;
  const fill = $("bar-fill");
  fill.style.width = `${Math.min(100, (S.roundScore / gate) * 100)}%`;
  fill.classList.toggle("done", S.roundScore >= gate);
  $("hands").innerHTML =
    `<span class="hands-label">残り</span>` +
    Array.from({ length: HANDS }, (_, i) => `<span class="dot ${i < S.handsLeft ? "on" : ""}"></span>`).join("");
  const deck = $("deck");
  deck.innerHTML = S.owned.length
    ? S.owned.map((id) => cardTile(CARD_BY_ID.get(id)!, "mini")).join("")
    : `<span class="empty">まだ無い。いまは読みの音の数（拍）だけが点になる。ラウンドを越えるとカードを 1 枚選べる。</span>`;
  deck.querySelectorAll<HTMLElement>("[data-card]").forEach((el) => el.addEventListener("click", () => showCard(el.dataset.card!)));
}

const KIND_LABEL: Record<CardDef["kind"], string> = { chips: "点", mult: "倍率＋", xmult: "倍率×", rule: "決まり" };

function cardTile(c: CardDef, mode: "mini" | "offer", idx?: number) {
  const isNew = !seen.has(c.id);
  const src = `<span class="src ${c.source === "埋め込み" ? "emb" : "morph"}">${c.source}</span>`;
  const kind = `<span class="kind k-${c.kind}">${KIND_LABEL[c.kind]}</span>`;
  if (mode === "mini") return `<button class="card mini k-${c.kind}" data-card="${c.id}" title="${esc(c.short)}">${esc(c.name)}</button>`;
  return `<div class="card offer k-${c.kind}">
    <div class="card-head">${kind}${src}${isNew ? `<span class="new">NEW</span>` : ""}</div>
    <div class="card-name">${esc(c.name)}</div>
    <div class="card-short">${esc(c.short)}</div>
    <details ${isNew ? "open" : ""}><summary>くわしく</summary><div class="card-long">${esc(c.long)}</div></details>
    <button class="pick" data-pick="${idx}">これを取る</button>
  </div>`;
}

function showCard(id: string) {
  const c = CARD_BY_ID.get(id)!;
  openOverlay(`<h2>${esc(c.name)}</h2>
    <p class="card-meta"><span class="kind k-${c.kind}">${KIND_LABEL[c.kind]}</span> <span class="src ${c.source === "埋め込み" ? "emb" : "morph"}">${c.source}</span></p>
    <p><b>${esc(c.short)}</b></p><p class="card-long">${esc(c.long)}</p>
    <div class="ov-actions"><button id="ov-close">閉じる</button></div>`);
  $("ov-close").addEventListener("click", closeOverlay);
}

function openOverlay(html: string) {
  $("overlay-body").innerHTML = html;
  $("overlay").classList.remove("hidden");
}
function closeOverlay() {
  $("overlay").classList.add("hidden");
  if (S.phase === "play") $<HTMLInputElement>("text").focus();
}

const POS_CLASS: Record<string, string> = { 名詞: "n", 動詞: "v", 形容詞: "a", 副詞: "d", 助詞: "p", 助動詞: "x" };
function tokenChips(tokens: TokenRow[]) {
  return tokens
    .map((t) => {
      const label = t.proper ? "固有名詞" : t.pos + (t.pos === "名詞" && t.pos1 && t.pos1 !== "一般" ? "・" + t.pos1 : "");
      return `<span class="tok ${t.proper ? "proper" : POS_CLASS[t.pos] ?? ""}${t.wordType === "UNKNOWN" ? " unk" : ""}" title="読み: ${esc(t.reading || "—")}"><span class="s">${esc(t.surface)}</span><span class="p">${esc(label)}</span></span>`;
    })
    .join("");
}

function lineRow(l: Line, fmt: (x: number) => string) {
  return `<tr class="${l.result.hit ? "hit" : "miss"}"><td class="n">${esc(l.card.name)}</td><td class="d">${esc(l.result.detail)}</td><td class="v">${l.result.hit ? fmt(l.result.amount) : "—"}</td></tr>`;
}

function breakdownHtml(e: Entry) {
  const b = e.bd;
  const fmtMult = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
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
  const formula = b.duplicate
    ? `このランで同じ文を前にも送ったので <b>0</b> 点`
    : `${b.chips} × ${fmtMult(b.mult)}${b.xmult !== 1 ? ` × ${fmtMult(b.xmult)}` : ""} = <b>${b.total}</b> 点`;
  const speed = e.keys ? `打鍵 ${e.keys}・${e.secs.toFixed(1)} 秒` : "";
  return `<div class="bd">
    <div class="bd-head"><span class="bd-text">${esc(e.text)}</span><span class="bd-total">${formula}</span></div>
    <div class="tokens">${tokenChips(e.morph.tokens)}</div>
    <div class="reading">読み: ${esc(e.morph.reading)}${speed ? `　<span class="speed">${speed}（点には入らない）</span>` : ""}</div>
    <table class="lines">${rows}</table>
  </div>`;
}

function renderLog() {
  const log = $("log");
  const parts: string[] = [];
  let r = 0;
  for (let i = S.played.length - 1; i >= 0; i--) {
    const e = S.played[i];
    if (e.round !== r) {
      r = e.round;
      parts.push(`<div class="log-round">ラウンド ${r}</div>`);
    }
    parts.push(`<details class="log-e"><summary><span class="log-t">${esc(e.text)}</span><span class="log-s">${e.total} 点</span></summary>${breakdownHtml(e)}</details>`);
  }
  log.innerHTML = parts.join("");
}

function renderIntro() {
  $("last").innerHTML = `<div class="intro">
    <h2>遊び方</h2>
    <p>お題は無い。好きな日本語の文を打って Enter で送る。ローマ字で打ち、漢字に変換してよい（変換した方が文の解析が正しくなる）。</p>
    <p>1 ラウンドで送れるのは ${HANDS} 文。合計がゲートの点に届けばクリアで、得点のルールのカードを ${OFFER_COUNT} 枚から 1 枚選んで足せる。届かなければ終わり。</p>
    <p>最初のルールは「読みの音の数（拍）が点になる（1 文 ${BASE_CAP} まで）」だけ。カードを足すほど、何を打てば点になるかが変わっていく。同じ文には同じ点が付き、送るたびに内訳が出る。</p>
  </div>`;
}

// ---- 進行 ----
async function submit(text: string) {
  text = text.trim();
  if (!text || S.phase !== "play") return;
  if (!tokenizer) {
    setStatus("send", "辞書の読み込みを待っている…");
    return;
  }
  S.phase = "busy";
  setStatus("send", "");
  const keys = keyCount;
  const secs = keyStart ? (performance.now() - keyStart) / 1000 : 0;
  keyCount = 0;
  keyStart = 0;
  try {
    const morph = analyze(tokenizer, text);
    const prev = S.played.length ? S.played[S.played.length - 1] : null;
    const bd = await scoreSentence({ text, morph, prev, past: S.played, roundPast: S.played.filter((p) => p.round === S.round), emb: emb.state === "ready" ? emb : null }, S.owned);
    const e: Entry = { text, morph, total: bd.total, round: S.round, bd, keys, secs };
    S.played.push(e);
    S.roundScore += bd.total;
    S.runTotal += bd.total;
    S.handsLeft--;
    $("last").innerHTML = breakdownHtml(e);
    renderLog();
    renderTop();
    const unk = morph.tokens.filter((t) => t.wordType === "UNKNOWN").length;
    $("hint").textContent = !/[一-龯々ァ-ヶ]/.test(text) && [...text].length >= 6
      ? "ひらがなだけの文は解析が崩れやすい（区切りがずれて名詞や固有名詞が見えなくなる）。漢字に変換して送ると正しく読める。"
      : unk >= 2 ? `辞書に無い語が ${unk} つあった（赤い字）。読みが取れないので、拍の数に入らない。` : "";
    if (S.roundScore >= gateFor(S.round)) showNext("clear");
    else if (S.handsLeft <= 0) showNext("over");
    else S.phase = "play";
  } catch (err) {
    setStatus("send", `<span class="err">計算に失敗: ${esc(String(err))}</span>`);
    S.phase = "play";
  }
}

/** ラウンドの終わり。最後の文の内訳を読めるように、すぐには重ねず、ボタンを出して待つ。 */
function showNext(kind: "clear" | "over") {
  S.phase = kind === "clear" ? "pick" : "over";
  const input = $<HTMLInputElement>("text");
  input.disabled = true;
  $("next").innerHTML =
    kind === "clear"
      ? `<div class="next clear"><span>ラウンド ${S.round} クリア（${S.roundScore} / ${gateFor(S.round)} 点）</span><button id="next-btn">カードを選ぶ</button></div>`
      : `<div class="next over"><span>ゲートに届かなかった（${S.roundScore} / ${gateFor(S.round)} 点）</span><button id="next-btn">結果を見る</button></div>`;
  const btn = $<HTMLButtonElement>("next-btn");
  btn.addEventListener("click", () => (kind === "clear" ? clearRound() : gameOver()));
  btn.focus();
}

function eligibleCards(): CardDef[] {
  return CARDS.filter((c) => !S.owned.includes(c.id) && (c.source !== "埋め込み" || emb.state === "ready"));
}

function clearRound() {
  const pool = eligibleCards();
  const best = Number(localStorage.getItem(BEST_KEY) ?? "0");
  if (S.round > best) localStorage.setItem(BEST_KEY, String(S.round));
  // 3 枚を無作為に（引くのは毎回ちがってよい。点の計算は決定的）
  const offers = drawOffers(pool).map((c) => c.id);
  S.offers = offers;
  const used = HANDS - S.handsLeft;
  const head = `<h2>ラウンド ${S.round} クリア</h2><p>${used} 文で ${S.roundScore} 点（ゲート ${gateFor(S.round)}）。次のゲートは ${gateFor(S.round + 1)} 点。</p>`;
  if (!offers.length) {
    openOverlay(`${head}<p>取れるカードはもう無い。</p><div class="ov-actions"><button id="ov-next">次のラウンドへ</button></div>`);
    $("ov-next").addEventListener("click", () => pick(-1));
    return;
  }
  const waiting = emb.state === "loading" ? `<p class="note">意味のモデルを読み込み中なので、意味の距離を使うカードはまだ出ていない。</p>` : "";
  openOverlay(`${head}<p>ルールを 1 枚選んで足す。</p>${waiting}<div class="offers">${offers.map((id, i) => cardTile(CARD_BY_ID.get(id)!, "offer", i)).join("")}</div>
    <div class="ov-actions"><button id="ov-skip" class="ghost">取らずに進む</button></div>`);
  document.querySelectorAll<HTMLButtonElement>("[data-pick]").forEach((b) => b.addEventListener("click", () => pick(Number(b.dataset.pick))));
  $("ov-skip").addEventListener("click", () => pick(-1));
  offers.forEach(markSeen);
}

function pick(i: number) {
  if (S.phase !== "pick") return;
  if (i >= 0 && S.offers[i]) S.owned.push(S.offers[i]);
  S.round++;
  S.roundScore = 0;
  S.handsLeft = HANDS;
  S.offers = [];
  S.phase = "play";
  $("next").innerHTML = "";
  $<HTMLInputElement>("text").disabled = false;
  closeOverlay();
  renderTop();
  renderLog();
}

function gameOver() {
  S.phase = "over";
  const best = Math.max(Number(localStorage.getItem(BEST_KEY) ?? "0"), S.round - 1);
  localStorage.setItem(BEST_KEY, String(best));
  openOverlay(`<h2>ゲートに届かなかった</h2>
    <p>ラウンド ${S.round}: ${S.roundScore} / ${gateFor(S.round)} 点。越えたラウンド ${S.round - 1}（これまでの最高 ${best}）。このランの合計 ${S.runTotal} 点。</p>
    <p>手持ちのルール: ${S.owned.length ? S.owned.map((id) => esc(CARD_BY_ID.get(id)!.name)).join("、") : "なし"}</p>
    <div class="ov-actions"><button id="ov-look" class="ghost">内訳を見返す</button><button id="ov-restart">はじめから</button></div>`);
  $("ov-restart").addEventListener("click", restart);
  $("ov-look").addEventListener("click", () => {
    $("overlay").classList.add("hidden");
    $("next").innerHTML = `<div class="next over"><span>このランは終わり。内訳は下の一覧で開ける。</span><button id="next-btn">はじめから</button></div>`;
    $("next-btn").addEventListener("click", restart);
  });
}

function restart() {
  Object.assign(S, { round: 1, owned: [], played: [], roundScore: 0, handsLeft: HANDS, phase: "play", offers: [], runTotal: 0 });
  $("hint").textContent = "";
  $("next").innerHTML = "";
  $<HTMLInputElement>("text").disabled = false;
  closeOverlay();
  renderIntro();
  renderTop();
  renderLog();
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
  const input = $<HTMLInputElement>("text");
  const send = () => {
    if (S.phase !== "play") return;
    const t = input.value;
    if (!t.trim()) return;
    input.value = "";
    void submit(t);
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      // IME の変換確定の Enter では送らない
      if (!ev.isComposing && ev.keyCode !== 229) {
        ev.preventDefault();
        send();
      }
      return;
    }
    if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(ev.key)) return;
    if (!keyStart) keyStart = performance.now();
    keyCount++;
  });
  $("send").addEventListener("click", send);
  $("overlay").addEventListener("click", (ev) => {
    if (ev.target === $("overlay") && S.phase !== "pick" && S.phase !== "over") closeOverlay();
  });

  renderIntro();
  renderTop();
  void initMorph();
  emb.onChange = embStatus;
  embStatus("");
  void emb.load();
  input.focus();

  // ヘッドレス検証用の口
  (window as unknown as Record<string, unknown>).__game = {
    state: () => S,
    submit,
    pick,
    restart,
    ready: () => !!tokenizer,
    embState: () => emb.state,
    gateFor,
  };
}

init();
