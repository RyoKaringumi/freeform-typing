// 点の釣り合いの集計。ゲームと同じ採点の関数（src/game/cards.ts の scoreSentence）に文例を通し、
// 「どんな文を打つか」と「どのカードを取るか」の方針を変えて多数のランを回す。
//
//   npm run sim -- [--runs 200] [--seed 1] [--out tools/sim/out] [--tune '{"haiku":{"x":2}}'] [--gates 80,150,...]
//
// 埋め込みは Node の transformers.js で ruri-v3-30m（ゲームと同じモデル・q8）を使う。ブラウザ（wasm）とは
// 小数の下の方がわずかに違いうる。ベクトルは tools/sim/.cache/ に保存し、2 回目からは読むだけ。
import kuromoji from "kuromoji";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { analyze, type MorphResult } from "../../src/morph";
import { CARDS, CARD_BY_ID, TUNING, moraCount, scoreSentence, type Played } from "../../src/game/cards";
import { HANDS, GATES, drawOffers, gateFor } from "../../src/game/rules";
import { REF_SENTENCES, REF_WORDS } from "../../src/game/refs";
import type { Embedder } from "../../src/game/distance";
import { CASUAL_CATS, CATS, CORPUS } from "./corpus";

const ROOT = process.cwd(); // npm run sim はリポジトリの一番上で動く

// ---- 引数 ----
const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf("--" + k);
  return i >= 0 ? args[i + 1] : d;
};
const RUNS = Number(arg("runs", "200"));
const SEED = Number(arg("seed", "1"));
const OUT = resolve(ROOT, arg("out", "tools/sim/out")!);
const LABEL = arg("label", "run")!;
const MAX_ROUND = 16;
function deepMerge(a: any, b: any) {
  for (const k of Object.keys(b)) {
    if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) deepMerge((a[k] ??= {}), b[k]);
    else a[k] = b[k];
  }
}
if (arg("tune")) deepMerge(TUNING, JSON.parse(arg("tune")!));
if (arg("gates")) GATES.splice(0, GATES.length, ...arg("gates")!.split(",").map(Number));

// ---- 乱数（種付き） ----
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 形態素解析（Node では kuromoji の組み込みローダーでよい） ----
const tokenizer: any = await new Promise((ok, ng) =>
  kuromoji.builder({ dicPath: join(ROOT, "node_modules/kuromoji/dict") }).build((e: unknown, t: unknown) => (e ? ng(e) : ok(t))),
);

// ---- 埋め込み（ディスクにキャッシュ） ----
const CACHE_DIR = join(ROOT, "tools/sim/.cache");
const CACHE_FILE = join(CACHE_DIR, "ruri-v3-30m-q8.json");
const vecCache: Record<string, number[]> = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {};
let extractor: any = null;
async function rawEmbed(text: string): Promise<number[]> {
  if (vecCache[text]) return vecCache[text];
  if (!extractor) {
    const { pipeline } = await import("@huggingface/transformers");
    extractor = await pipeline("feature-extraction", "sirasagi62/ruri-v3-30m-ONNX", { dtype: "q8" });
  }
  const out = await extractor(text, { pooling: "mean", normalize: true });
  const v = Array.from(out.data as Float32Array).map((x) => Math.round(x * 1e6) / 1e6);
  vecCache[text] = v;
  return v;
}
const emb: Embedder = { embed: async (t) => rawEmbed(t), refSent: [], refWord: [] };

// ---- 文例の下ごしらえ ----
type Item = { id: number; cat: string; text: string; morph: MorphResult; mora: number };
const items: Item[] = CORPUS.map((s, id) => {
  const morph = analyze(tokenizer, s.text);
  return { id, cat: s.cat, text: s.text, morph, mora: moraCount(morph.reading) };
});
{
  const need = new Set<string>([...REF_SENTENCES, ...REF_WORDS]);
  for (const it of items) { need.add(it.text); for (const n of it.morph.nouns) need.add(n); }
  let done = 0;
  for (const t of need) { await rawEmbed(t); if (++done % 200 === 0) process.stderr.write(`embed ${done}/${need.size}\n`); }
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(vecCache));
  emb.refSent = REF_SENTENCES.map((s) => vecCache[s]);
  emb.refWord = REF_WORDS.map((s) => vecCache[s]);
}
const casualItems = items.filter((i) => CASUAL_CATS.includes(i.cat));

// ---- 1 文の点 ----
type Hist = { item: Item; total: number; round: number }[];
const played = (h: Hist): Played[] => h.map((x) => ({ text: x.item.text, morph: x.item.morph, total: x.total }));
async function score(it: Item, hist: Hist, round: number, owned: string[]) {
  const past = played(hist);
  return scoreSentence(
    { text: it.text, morph: it.morph, prev: past.length ? past[past.length - 1] : null, past, roundPast: past.filter((_, i) => hist[i].round === round), emb },
    owned,
  );
}

// ---- 方針 ----
type Typist = { name: string; choose: (avail: Item[], hist: Hist, round: number, owned: string[], rnd: () => number) => Promise<Item> };
const pickRandom = <T,>(xs: T[], rnd: () => number) => xs[Math.floor(rnd() * xs.length)];
function sample<T>(xs: T[], k: number, rnd: () => number): T[] {
  if (k >= xs.length) return xs.slice();
  const p = xs.slice(), out: T[] = [];
  while (out.length < k) out.push(p.splice(Math.floor(rnd() * p.length), 1)[0]);
  return out;
}
async function bestOf(cands: Item[], hist: Hist, round: number, owned: string[]) {
  let best = cands[0], bs = -1;
  for (const c of cands) {
    const s = (await score(c, hist, round, owned)).total;
    if (s > bs) { bs = s; best = c; }
  }
  return best;
}
const TYPISTS: Record<string, Typist> = {
  // カードを気にせず、ふつうの文を打つ
  casual: { name: "ふつうに打つ", choose: async (avail, _h, _r, _o, rnd) => pickRandom(avail.filter((i) => CASUAL_CATS.includes(i.cat)), rnd) },
  // 思いついた 8 文のうち、いまのカードで一番点の高いものを打つ（少し考える）
  think8: { name: "少し考える（8 文から）", choose: async (avail, h, r, o, rnd) => bestOf(sample(avail, 8, rnd), h, r, o) },
  // 文例の全部から一番点の高いものを打つ（よく考える。上限の目安）
  thinkAll: { name: "よく考える（全文例から）", choose: async (avail, h, r, o) => bestOf(avail, h, r, o) },
};

type Picker = { name: string; pick: (offers: string[], owned: string[], hist: Hist, avail: Item[], typist: string, rnd: () => number) => Promise<string | null> };
async function greedyPick(offers: string[], owned: string[], hist: Hist, avail: Item[], typist: string, rnd: () => number) {
  // 取ったあとの 1 文の点の見込み: 方針が casual なら無作為 30 文の平均、考える方針なら 40 文の上位 5 文の平均
  const cands = sample(typist === "casual" ? avail.filter((i) => CASUAL_CATS.includes(i.cat)) : avail, typist === "casual" ? 30 : 40, rnd);
  let best: string | null = null, bv = -1;
  for (const id of offers) {
    const sc: number[] = [];
    for (const c of cands) sc.push((await score(c, hist, 99, [...owned, id])).total);
    sc.sort((a, b) => b - a);
    const v = typist === "casual" ? sc.reduce((a, b) => a + b, 0) / sc.length : sc.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    if (v > bv) { bv = v; best = id; }
  }
  return best;
}
const focus = (ids: string[]): Picker["pick"] => async (offers, owned, hist, avail, typist, rnd) => {
  for (const id of ids) if (offers.includes(id)) return id;
  return greedyPick(offers, owned, hist, avail, typist, rnd);
};
const PICKERS: Record<string, Picker> = {
  none: { name: "取らない", pick: async () => null },
  random: { name: "無作為", pick: async (o, _ow, _h, _a, _t, rnd) => pickRandom(o, rnd) },
  greedy: { name: "貪欲（見込みの点が一番上がるもの）", pick: greedyPick },
  focusX: { name: "倍率× 寄せ（しりとり・十七音・名のあるもの）", pick: focus(["shiritori", "haiku", "proper"]) },
  focusEmb: { name: "埋め込み寄せ（話題転換・新境地・遠い名詞）", pick: focus(["topic", "frontier", "farnouns"]) },
  focusChips: { name: "点寄せ（名詞あつめ・カタカナ語・長文）", pick: focus(["nouns", "katakana", "long"]) },
};

// ---- 1 ラン ----
type SentRec = { round: number; total: number; owned: string[]; marg: Record<string, number>; hits: Record<string, number>; amt: Record<string, number>; t: Record<string, number> };
type RunRec = { cleared: number; owned: string[]; sents: SentRec[]; roundScores: number[] };
const EMB_IDS = CARDS.filter((c) => c.source === "埋め込み").map((c) => c.id);

async function runOnce(typist: string, picker: string, rnd: () => number, detail: boolean): Promise<RunRec> {
  let owned: string[] = [];
  const hist: Hist = [];
  const used = new Set<number>();
  const sents: SentRec[] = [];
  const roundScores: number[] = [];
  let round = 1;
  for (; round <= MAX_ROUND; round++) {
    let sum = 0;
    for (let h = 0; h < HANDS && sum < gateFor(round); h++) {
      const avail = items.filter((i) => !used.has(i.id));
      const it = await TYPISTS[typist].choose(avail, hist, round, owned, rnd);
      const bd = await score(it, hist, round, owned);
      const rec: SentRec = { round, total: bd.total, owned: owned.slice(), marg: {}, hits: {}, amt: {}, t: {} };
      if (detail) {
        for (const l of [...bd.chipLines, ...bd.multLines, ...bd.xLines]) {
          rec.hits[l.card.id] = l.result.hit ? 1 : 0;
          rec.amt[l.card.id] = l.result.amount;
          const m = /t=([0-9.]+)/.exec(l.result.detail);
          if (m) rec.t[l.card.id] = Number(m[1]);
        }
        for (const id of owned) rec.marg[id] = bd.total - (await score(it, hist, round, owned.filter((x) => x !== id))).total;
        const ownedEmb = owned.filter((x) => EMB_IDS.includes(x));
        if (ownedEmb.length) rec.marg["_emb"] = bd.total - (await score(it, hist, round, owned.filter((x) => !EMB_IDS.includes(x)))).total;
        for (let i = 0; i < owned.length; i++)
          for (let j = i + 1; j < owned.length; j++) {
            const k = [owned[i], owned[j]].sort().join("+");
            rec.marg[k] = bd.total - (await score(it, hist, round, owned.filter((x) => x !== owned[i] && x !== owned[j]))).total;
          }
      }
      sents.push(rec);
      hist.push({ item: it, total: bd.total, round });
      used.add(it.id);
      sum += bd.total;
    }
    roundScores.push(sum);
    if (sum < gateFor(round)) break;
    const pool = CARDS.filter((c) => !owned.includes(c.id)).map((c) => c.id);
    const offers = drawOffers(pool, 3, rnd);
    if (offers.length) {
      const p = await PICKERS[picker].pick(offers, owned, hist, items.filter((i) => !used.has(i.id)), typist, rnd);
      if (p) owned = [...owned, p];
    }
  }
  return { cleared: round - 1, owned, sents, roundScores };
}

// ---- 集計 ----
const q = (xs: number[], p: number) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "—");
const pct = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) + "%" : "—");
const md: string[] = [];
const out: any = { label: LABEL, runs: RUNS, seed: SEED, tuning: TUNING, gates: GATES.slice(), configs: {} };
md.push(`# 集計 ${LABEL}（各 ${RUNS} ラン、種 ${SEED}）`, "", "ゲート: " + Array.from({ length: 12 }, (_, i) => gateFor(i + 1)).join(", "), "", "TUNING: `" + JSON.stringify(TUNING) + "`", "");

// 1) 文例そのものの点（カード 1 枚だけ持ったとき）。prev は同じ種類の別の文。
{
  md.push("## カード 1 枚だけのときの 1 文の点", "", "ふつう = 「ふつうに打つ」文例の平均、上位 = 全文例で点の高い 10 文の平均、効いた割合 = ふつうの文例のうちそのカードが効いた割合。カード無しの基本点だけだと、ふつう " + f1(mean(casualItems.map((i) => Math.min(i.mora, TUNING.baseCap)))) + " 点。", "");
  md.push("| カード | ふつう | 上位 10 | 効いた割合 |", "| --- | ---: | ---: | ---: |");
  const rnd = mulberry32(SEED + 77);
  for (const c of CARDS) {
    const cas: number[] = [], all: number[] = [];
    let hit = 0;
    for (const it of items) {
      const other = pickRandom(items.filter((x) => x.id !== it.id), rnd);
      const hist: Hist = [{ item: other, total: 0, round: 1 }];
      const bd = await score(it, hist, 1, [c.id]);
      all.push(bd.total);
      if (CASUAL_CATS.includes(it.cat)) {
        cas.push(bd.total);
        if ([...bd.chipLines, ...bd.multLines, ...bd.xLines].some((l) => l.result.hit) || (c.id === "long" && it.mora > TUNING.baseCap)) hit++;
      }
    }
    all.sort((a, b) => b - a);
    md.push(`| ${c.name} | ${f1(mean(cas))} | ${f1(mean(all.slice(0, 10)))} | ${pct(hit / cas.length)} |`);
  }
  md.push("");
  // 文例の種類ごとの拍
  md.push("文例の種類ごとの拍（平均・17 拍ちょうどの数）: " + CATS.map((cat) => { const xs = items.filter((i) => i.cat === cat); return `${cat} ${f1(mean(xs.map((i) => i.mora)))}（${xs.filter((i) => i.mora === 17).length}/${xs.length}）`; }).join("、"), "");
}

// 2) ラン
const CONFIGS: [string, string][] = [
  ["casual", "none"], ["casual", "random"], ["casual", "greedy"],
  ["think8", "none"], ["think8", "random"], ["think8", "greedy"],
  ["thinkAll", "random"], ["thinkAll", "greedy"], ["thinkAll", "focusX"], ["thinkAll", "focusEmb"], ["thinkAll", "focusChips"],
  ["think8", "focusEmb"],
];
const ROUNDS_SHOWN = 12;
md.push("## ラン: 何ラウンドまで越えたか", "", "R1〜R12 = そのラウンドを越えたランの割合。", "");
md.push(`| 打ち方 | カードの取り方 | 越えた数 中央 | 平均 | p10〜p90 | ${Array.from({ length: ROUNDS_SHOWN }, (_, i) => "R" + (i + 1)).join(" | ")} |`);
md.push(`| --- | --- | ---: | ---: | --- | ${Array.from({ length: ROUNDS_SHOWN }, () => "---:").join(" | ")} |`);
const contrib: Record<string, Record<string, { marg: number[]; hit: number[]; t: number[]; tot: number[] }>> = {};
for (const [ty, pk] of CONFIGS) {
  const rnd = mulberry32(SEED * 1000 + CONFIGS.findIndex((c) => c[0] === ty && c[1] === pk));
  const runs: RunRec[] = [];
  const detail = pk !== "none";
  const n = ty === "thinkAll" ? Math.max(20, Math.round(RUNS / 4)) : RUNS;
  for (let r = 0; r < n; r++) runs.push(await runOnce(ty, pk, rnd, detail));
  const cl = runs.map((r) => r.cleared);
  const rates = Array.from({ length: ROUNDS_SHOWN }, (_, i) => runs.filter((r) => r.cleared >= i + 1).length / runs.length);
  md.push(`| ${TYPISTS[ty].name} | ${PICKERS[pk].name} | ${q(cl, 0.5)} | ${f1(mean(cl))} | ${q(cl, 0.1)}〜${q(cl, 0.9)} | ${rates.map(pct).join(" | ")} |`);
  const key = `${ty}/${pk}`;
  out.configs[key] = { runs: n, cleared: cl, rates, owned: runs.map((r) => r.owned) };
  if (detail) {
    const c: Record<string, { marg: number[]; hit: number[]; t: number[]; tot: number[] }> = {};
    for (const run of runs)
      for (const s of run.sents)
        for (const [k, v] of Object.entries(s.marg)) {
          const e = (c[k] ??= { marg: [], hit: [], t: [], tot: [] });
          e.marg.push(v);
          e.tot.push(s.total);
          if (k in s.hits) e.hit.push(s.hits[k]);
          if (k in s.t) e.t.push(s.t[k]);
        }
    contrib[key] = c;
  }
  process.stderr.write(`done ${key} median ${q(cl, 0.5)}\n`);
}
md.push("");

md.push("## カードごとの寄与", "", "持っているときの 1 文あたり: 寄与 = その 1 枚を外すと減る点の平均、割合 = 寄与の合計 ÷ その文の点の合計、効いた = 効いた文の割合、t = 埋め込みのカードの t の中央値（p10〜p90）。「埋め込み全部」は埋め込みのカードをまとめて外したとき。", "");
for (const key of ["casual/random", "think8/random", "thinkAll/greedy", "thinkAll/focusEmb"]) {
  const c = contrib[key];
  if (!c) continue;
  md.push(`### ${key}`, "", "| カード | 文の数 | 寄与 | 割合 | 効いた | t |", "| --- | ---: | ---: | ---: | ---: | --- |");
  for (const id of [...CARDS.map((x) => x.id), "_emb"]) {
    const e = c[id];
    if (!e) continue;
    const name = id === "_emb" ? "埋め込み全部" : CARD_BY_ID.get(id)!.name;
    const share = e.marg.reduce((a, b) => a + b, 0) / e.tot.reduce((a, b) => a + b, 0);
    md.push(`| ${name} | ${e.marg.length} | ${f1(mean(e.marg))} | ${pct(share)} | ${e.hit.length ? pct(mean(e.hit)) : "—"} | ${e.t.length ? `${q(e.t, 0.5).toFixed(2)}（${q(e.t, 0.1).toFixed(2)}〜${q(e.t, 0.9).toFixed(2)}）` : "—"} |`);
  }
  md.push("");
  // 組み合わせ: 2 枚まとめて外したときの減り − 1 枚ずつの減りの和（正なら掛け合わせで強い）
  const pairs = Object.keys(c).filter((k) => k.includes("+")).map((k) => {
    const [a, b] = k.split("+");
    const e = c[k];
    const ea = c[a], eb = c[b];
    return { k, n: e.marg.length, joint: mean(e.marg), syn: mean(e.marg) - mean(ea.marg) - mean(eb.marg), share: e.marg.reduce((x, y) => x + y, 0) / e.tot.reduce((x, y) => x + y, 0) };
  }).filter((p) => p.n >= 30).sort((x, y) => y.joint - x.joint).slice(0, 6);
  if (pairs.length) {
    md.push("寄与の大きい 2 枚の組（2 枚まとめて外すと減る点、文の数 30 以上）:", "", "| 組 | 文の数 | 減る点 | 割合 |", "| --- | ---: | ---: | ---: |");
    for (const p of pairs) md.push(`| ${p.k.split("+").map((x) => CARD_BY_ID.get(x)!.name).join("＋")} | ${p.n} | ${f1(p.joint)} | ${pct(p.share)} |`);
    md.push("");
  }
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `${LABEL}.md`), md.join("\n"));
writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(out));
console.log(md.join("\n"));
