import "./style.css";
import type { IpadicFeatures, Tokenizer } from "kuromoji";
import { loadTokenizer, NOUN_RULE, type MorphLoadInfo, type TokenRow } from "./morph";
import { configKey, DEFAULT_CONFIG, loadModel, type EmbedConfig, type ModelLoadInfo } from "./embed";
import { SHIRITORI_RULE } from "./kana";
import { computeEntry, flatFeatures, type Entry, type Side } from "./features";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const f4 = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? "—" : x.toFixed(4));
const ms = (x: number) => `${x.toFixed(1)} ms`;

const STORE_KEY = "freeform-typing.history.v1";
const RULE_KEY = "freeform-typing.rule.v1";
const CFG_KEY = "freeform-typing.config.v2"; // v2: 既定モデルを ruri-v3-30m に替えたので、前に保存した e5 の設定を引き継がない

let tokenizer: Tokenizer<IpadicFeatures> | null = null;
let morphInfo: MorphLoadInfo | null = null;
const modelInfos = new Map<string, ModelLoadInfo>();
let history: Entry[] = [];
let busy = false;
const statusLines: Record<string, string> = {};

function setStatus(k: string, msg: string) {
  statusLines[k] = msg;
  $("status").innerHTML = Object.entries(statusLines)
    .map(([, v]) => `<div>${v}</div>`)
    .join("");
}

// ---- 設定 ----
function readConfig(): EmbedConfig {
  return {
    model: $<HTMLInputElement>("cfg-model").value.trim() || DEFAULT_CONFIG.model,
    dtype: $<HTMLSelectElement>("cfg-dtype").value as EmbedConfig["dtype"],
    device: $<HTMLSelectElement>("cfg-device").value as EmbedConfig["device"],
    pooling: $<HTMLSelectElement>("cfg-pooling").value as EmbedConfig["pooling"],
    prefix: $<HTMLInputElement>("cfg-prefix").value,
  };
}
function writeConfig(c: EmbedConfig) {
  $<HTMLInputElement>("cfg-model").value = c.model;
  $<HTMLSelectElement>("cfg-dtype").value = c.dtype;
  $<HTMLSelectElement>("cfg-device").value = c.device;
  $<HTMLSelectElement>("cfg-pooling").value = c.pooling;
  $<HTMLInputElement>("cfg-prefix").value = c.prefix;
}

async function ensureModel(c: EmbedConfig): Promise<ModelLoadInfo> {
  const key = configKey(c);
  const known = modelInfos.get(key);
  if (known) return known;
  setStatus("model", `埋め込みモデル ${esc(c.model)} を読み込み中…`);
  try {
    const { info } = await loadModel(c, (m) => setStatus("model", `埋め込みモデル ${esc(c.model)} を読み込み中… ${esc(m)}`));
    modelInfos.set(key, info);
    const files = Object.entries(info.files).map(([f, b]) => `${esc(f)} ${(b / 1e6).toFixed(1)} MB`).join(", ");
    setStatus(
      "model",
      `埋め込みモデル: ${esc(c.model)}（${c.dtype}, ${c.device}, ${c.pooling}, prefix=${esc(JSON.stringify(c.prefix))}）` +
        ` 読み込み ${ms(info.ms)} / 次元 ${info.dims} / ファイル合計 ${(info.totalBytes / 1e6).toFixed(1)} MB` +
        `（${files || "サイズ不明"}。2 回目以降はブラウザのキャッシュから）`,
    );
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
    return info;
  } catch (e) {
    setStatus("model", `<span class="err">埋め込みモデルの読み込みに失敗: ${esc(String(e))}</span>`);
    throw e;
  }
}

async function initMorph() {
  setStatus("morph", "kuromoji の辞書を読み込み中…");
  try {
    const r = await loadTokenizer(import.meta.env.BASE_URL + "dict/");
    tokenizer = r.tokenizer;
    morphInfo = r.info;
    const fetched = r.info.files.reduce((a, f) => a + f.fetchedBytes, 0);
    const expanded = r.info.files.reduce((a, f) => a + f.bytes, 0);
    const gz = r.info.files.filter((f) => f.gzipped).length;
    const enc = [...new Set(r.info.files.map((f) => f.contentEncoding ?? "なし"))].join(",");
    setStatus(
      "morph",
      `kuromoji 辞書: 読み込み ${ms(r.info.ms)} / 受信 ${(fetched / 1e6).toFixed(1)} MB / 展開後 ${(expanded / 1e6).toFixed(1)} MB` +
        ` / gzip のまま届いたファイル ${gz}/${r.info.files.length}（Content-Encoding: ${esc(enc)}）`,
    );
    (window as unknown as { __morphInfo: MorphLoadInfo }).__morphInfo = r.info;
  } catch (e) {
    setStatus("morph", `<span class="err">kuromoji 辞書の読み込みに失敗: ${esc(String(e))}</span>`);
    throw e;
  }
}

// ---- 送信 ----
async function submit(text: string) {
  if (!text.trim() || busy) return;
  if (!tokenizer) {
    setStatus("send", "辞書の読み込みを待っています");
    return;
  }
  busy = true;
  try {
    const cfg = readConfig();
    await ensureModel(cfg);
    setStatus("send", "計算中…");
    const t0 = performance.now();
    const id = history.length ? history[history.length - 1].id + 1 : 1;
    const e = await computeEntry(tokenizer, cfg, text, history, {
      id,
      createdAt: new Date().toISOString(),
      withHira: $<HTMLInputElement>("opt-hira").checked,
    });
    history.push(e);
    save();
    render();
    setStatus("send", `#${id} を計算（全体 ${ms(performance.now() - t0)}）`);
  } catch (e) {
    setStatus("send", `<span class="err">失敗: ${esc(String(e))}</span>`);
  } finally {
    busy = false;
  }
}

/** 全件を今の設定で順に計算し直す。以前と同じ設定のエントリは数値の差の最大を出す（決定性の確認）。 */
async function recomputeAll() {
  if (!tokenizer || busy || !history.length) return;
  busy = true;
  try {
    const cfg = readConfig();
    await ensureModel(cfg);
    const key = configKey(cfg);
    const withHira = $<HTMLInputElement>("opt-hira").checked;
    const next: Entry[] = [];
    let maxDiff = 0;
    let compared = 0;
    for (const old of history) {
      setStatus("send", `再計算中… #${old.id}`);
      const e = await computeEntry(tokenizer, cfg, old.text, next, { id: old.id, createdAt: old.createdAt, withHira });
      if (old.embedKey === key) {
        compared++;
        maxDiff = Math.max(maxDiff, maxAbsDiff(old.original.sentence.vec, e.original.sentence.vec));
        old.original.nounEmb.vecs.forEach((v, i) => {
          if (e.original.nounEmb.vecs[i]) maxDiff = Math.max(maxDiff, maxAbsDiff(v, e.original.nounEmb.vecs[i]));
        });
        old.past.forEach((p) => {
          const q = e.past.find((x) => x.id === p.id);
          if (q) maxDiff = Math.max(maxDiff, Math.abs(p.cos - q.cos));
        });
      }
      next.push(e);
    }
    history = next;
    save();
    render();
    setStatus(
      "send",
      compared
        ? `再計算した。同じ設定だった ${compared} 件で、ベクトルの各成分とコサインの差の最大 = ${maxDiff.toExponential(3)}`
        : `再計算した（以前と同じ設定のエントリが無いので比較なし）`,
    );
    (window as unknown as { __lastRecomputeDiff: number }).__lastRecomputeDiff = maxDiff;
  } catch (e) {
    setStatus("send", `<span class="err">再計算に失敗: ${esc(String(e))}</span>`);
  } finally {
    busy = false;
  }
}

function maxAbsDiff(a: number[], b: number[]) {
  let m = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) m = Math.max(m, Math.abs((a[i] ?? NaN) - (b[i] ?? NaN)) || 0);
  if (a.length !== b.length) return Infinity;
  return m;
}

// ---- 保存・入出力 ----
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(history));
  } catch {
    setStatus("store", "localStorage に保存できなかった（容量超過の可能性）。JSON で書き出しておくこと。");
  }
}

function exportJson() {
  const data = { app: "freeform-typing-testbench", version: 1, exportedAt: new Date().toISOString(), entries: history };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `freeform-typing-history-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importJson(file: File) {
  try {
    const data = JSON.parse(await file.text());
    const entries = Array.isArray(data) ? data : data.entries;
    if (!Array.isArray(entries)) throw new Error("entries が無い");
    history = entries as Entry[];
    save();
    render();
    setStatus("send", `${history.length} 件を読み込んだ（数値は書き出したときのまま。今の設定で計算し直すなら「全件を再計算」）`);
  } catch (e) {
    setStatus("send", `<span class="err">読み込みに失敗: ${esc(String(e))}</span>`);
  }
}

// ---- 描画 ----
function tokenTable(tokens: TokenRow[]) {
  const rows = tokens
    .map(
      (t) => `<tr class="${t.proper ? "proper" : ""}${t.wordType === "UNKNOWN" ? " unknown" : ""}">
      <td>${esc(t.surface)}</td><td>${esc(t.pos)}</td><td>${esc([t.pos1, t.pos2, t.pos3].filter(Boolean).join(","))}</td>
      <td>${esc([t.conjType, t.conjForm].filter(Boolean).join(","))}</td><td>${esc(t.base)}</td><td>${esc(t.reading)}</td>
      <td>${esc(t.pronunciation)}</td><td>${t.proper ? "固有名詞" : ""}${t.wordType === "UNKNOWN" ? " 未知語" : ""}</td></tr>`,
    )
    .join("");
  return `<table class="tokens"><thead><tr><th>表層形</th><th>品詞</th><th>品詞細分類</th><th>活用</th><th>原形</th><th>読み</th><th>発音</th><th>印</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function nounMatrix(s: Side) {
  const n = s.nounEmb;
  if (!n.nouns.length) return `<p class="note">名詞なし</p>`;
  const head = n.nouns.map((x) => `<th>${esc(x)}</th>`).join("");
  const body = n.nouns
    .map(
      (x, i) =>
        `<tr><th>${esc(x)}</th>${n.distance[i]
          .map((d, j) => (i === j ? `<td class="diag">—</td>` : `<td style="background:${heat(d)}">${f4(d)}</td>`))
          .join("")}</tr>`,
    )
    .join("");
  const st = n.stats
    ? `距離（1−cos）の組 ${n.stats.pairs} 個: 最小 ${f4(n.stats.min)} / 平均 ${f4(n.stats.mean)} / 最大 ${f4(n.stats.max)}`
    : "名詞が 2 つ未満なので距離なし";
  return `<p>${st}（単語の推論 ${ms(n.ms)}）</p><table class="matrix"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function heat(d: number) {
  // 距離 0 → 白、0.3 以上 → 濃い橙（e5 は距離が狭い範囲に集まりやすいので幅を絞る）
  const t = Math.max(0, Math.min(1, d / 0.3));
  return `hsl(30, 90%, ${100 - t * 40}%)`;
}

function sideBlock(title: string, s: Side, extra = "") {
  const m = s.morph;
  return `<div class="side">
    <h4>${esc(title)}: ${esc(s.text)}</h4>
    ${extra}
    <p>読み: ${esc(m.reading)}<br>発音: ${esc(m.pronunciation)}</p>
    <p>固有名詞: ${m.properNouns.length ? m.properNouns.map(esc).join("、") : "なし"} ／ 名詞（単語の埋め込みに使う）: ${m.nouns.length ? m.nouns.map(esc).join("、") : "なし"}</p>
    <p class="note">形態素解析 ${ms(m.ms)} ／ 文の推論 ${ms(s.sentence.ms)} ／ トークン ${m.tokens.length}</p>
    ${tokenTable(m.tokens)}
    <h5>名詞どうしの距離</h5>
    ${nounMatrix(s)}
  </div>`;
}

function entryBlock(e: Entry) {
  const byId = new Map(history.map((h) => [h.id, h]));
  const prev = e.prev;
  const sh = prev?.shiritori;
  const shiritoriHtml = sh
    ? `前の文の最後 <b>${esc(sh.prevLast ?? "—")}</b> → この文の最初 <b>${esc(sh.thisFirst ?? "—")}</b>:
       一致（厳密）<b>${sh.match ? "○" : "×"}</b> ／ 濁点無視 ${sh.matchIgnoringDakuten ? "○" : "×"}${sh.prevEndsWithN ? " ／ 前の文が ン で終わる" : ""}`
    : "最初の文なので比較なし";
  const pastRows = e.past
    .slice()
    .reverse()
    .map((p) => {
      const t = byId.get(p.id)?.text ?? "(履歴に無い)";
      return `<tr class="${p.id === e.prevId ? "prevrow" : ""}"><td>#${p.id}</td><td>${esc(t)}</td><td>${f4(p.cos)}</td><td>${f4(p.dist)}</td></tr>`;
    })
    .join("");
  const otherKey = e.prevId !== null && prev && Number.isNaN(prev.cos) ? `<p class="note">直前の文は別の埋め込み設定で計算されているため比べていない。</p>` : "";
  const hira = e.hira
    ? sideBlock("ひらがな化", e.hira, `<p>元の文との文の cos: <b>${f4(e.hira.cosToOriginal)}</b>（距離 ${f4(1 - e.hira.cosToOriginal)}）</p>`)
    : "";
  return `<article class="entry">
    <h3>#${e.id} ${esc(e.text)}</h3>
    <p class="note">${esc(e.createdAt)} ／ 埋め込み: ${esc(e.embedKey)}</p>
    <div class="summary">
      <div>直前の文 ${prev ? `#${prev.id}` : ""} との cos: <b>${f4(prev?.cos)}</b> ／ 距離: <b>${f4(prev?.dist)}</b></div>
      <div>しりとり: ${shiritoriHtml}</div>
      <div>固有名詞: ${e.original.morph.properNouns.length} 個 ／ 名詞の距離 平均: ${f4(e.original.nounEmb.stats?.mean)}</div>
    </div>
    ${otherKey}
    <div class="sides ${e.hira ? "two" : ""}">${sideBlock("元の文", e.original)}${hira}</div>
    <details><summary>過去の全文との類似度（${e.past.length} 件）</summary>
      <table class="past"><thead><tr><th>#</th><th>文</th><th>cos</th><th>距離</th></tr></thead><tbody>${pastRows || `<tr><td colspan="4">なし</td></tr>`}</tbody></table>
    </details>
    <details><summary>ルール用の特徴量（得点ルールの関数に渡る f）</summary><pre>${esc(JSON.stringify(flatFeatures(e), null, 2))}</pre></details>
    <details><summary>生の JSON（ベクトルを含む全部）</summary><pre class="raw" data-id="${e.id}"></pre></details>
  </article>`;
}

function render() {
  const h = $("history");
  h.innerHTML =
    `<div class="panel note">しりとりの判定:<ul>${SHIRITORI_RULE.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>名詞の選び方: ${esc(NOUN_RULE)}</div>` +
    history.slice().reverse().map(entryBlock).join("");
  // 生 JSON は開いたときに入れる（ベクトルで重いため）
  h.querySelectorAll<HTMLDetailsElement>("details").forEach((d) => {
    const pre = d.querySelector<HTMLPreElement>("pre.raw");
    if (!pre) return;
    d.addEventListener("toggle", () => {
      if (d.open && !pre.textContent) {
        const e = history.find((x) => x.id === Number(pre.dataset.id));
        pre.textContent = JSON.stringify(e, null, 2);
      }
    });
  });
}

// ---- ルール試作 ----
const DEFAULT_RULE = `// f: この文の特徴量 / prev: 一つ前の文の特徴量（無ければ null） / all: 全件
(f, prev, all) => {
  let score = f.length;                                  // 基本点: 文字数
  if (f.properNouns.length > 0) score += 10;             // 固有名詞があれば +10
  if (f.distPrev !== null) score += Math.round(f.distPrev * 100); // 前の文から遠いほど加点
  if (f.nounDist) score += Math.round(f.nounDist.mean * 100);     // 名詞どうしが遠いほど加点
  if (f.shiritori && f.shiritori.match) score *= 2;      // しりとりなら 2 倍
  return score;
}`;

function runRule() {
  const code = $<HTMLTextAreaElement>("rule-code").value;
  localStorage.setItem(RULE_KEY, code);
  const out = $("rule-out");
  let fn: (f: unknown, prev: unknown, all: unknown) => unknown;
  try {
    fn = new Function(`"use strict"; return (${code});`)();
    if (typeof fn !== "function") throw new Error("関数になっていない");
  } catch (e) {
    out.innerHTML = `<p class="err">${esc(String(e))}</p>`;
    return;
  }
  const feats = history.map(flatFeatures);
  const rows = feats
    .map((f, i) => {
      let r: string;
      try {
        const v = fn(f, i > 0 ? feats[i - 1] : null, feats);
        r = typeof v === "number" ? f4(v) : esc(JSON.stringify(v));
      } catch (e) {
        r = `<span class="err">${esc(String(e))}</span>`;
      }
      return `<tr><td>#${f.id}</td><td>${esc(f.text)}</td><td>${r}</td></tr>`;
    })
    .join("");
  out.innerHTML = `<table class="past"><thead><tr><th>#</th><th>文</th><th>結果</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---- 起動 ----
function init() {
  let cfg = DEFAULT_CONFIG;
  try {
    const s = localStorage.getItem(CFG_KEY);
    if (s) cfg = { ...DEFAULT_CONFIG, ...JSON.parse(s) };
  } catch {}
  writeConfig(cfg);
  try {
    const s = localStorage.getItem(STORE_KEY);
    if (s) history = JSON.parse(s);
  } catch {}
  $<HTMLTextAreaElement>("rule-code").value = localStorage.getItem(RULE_KEY) ?? DEFAULT_RULE;

  const input = $<HTMLInputElement>("text");
  const send = () => {
    const t = input.value;
    if (!t.trim()) return;
    input.value = "";
    void submit(t);
  };
  input.addEventListener("keydown", (ev) => {
    // IME の変換確定の Enter では送らない
    if (ev.key === "Enter" && !ev.isComposing && ev.keyCode !== 229) {
      ev.preventDefault();
      send();
    }
  });
  $("btn-send").addEventListener("click", send);
  $("btn-load").addEventListener("click", () => void ensureModel(readConfig()).catch(() => {}));
  $("btn-export").addEventListener("click", exportJson);
  $<HTMLInputElement>("file-import").addEventListener("change", (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (f) void importJson(f);
  });
  $("btn-recompute").addEventListener("click", () => void recomputeAll());
  $("btn-clear").addEventListener("click", () => {
    if (!confirm("履歴を消しますか（書き出していない分は戻せません）")) return;
    history = [];
    save();
    render();
  });
  $("btn-rule").addEventListener("click", runRule);

  render();
  void initMorph();
  void ensureModel(cfg).catch(() => {});

  // ヘッドレス検証用の口
  (window as unknown as Record<string, unknown>).__bench = {
    submit,
    recomputeAll,
    history: () => history,
    ready: () => !!tokenizer && modelInfos.has(configKey(readConfig())),
    morphInfo: () => morphInfo,
    modelInfo: () => modelInfos.get(configKey(readConfig())),
    flatFeatures,
  };
}

init();
