// 得点のルール（カード）と、1 文の点の計算。
// 点 = 基本点（チップ）× 倍率。基本点 = 読みの拍の数（上限あり）＋「点」のカード、
// 倍率 = 1 ＋「倍率＋」のカード、そのあと「倍率×」のカードを掛ける。
// カードの数値はすべて下の TUNING にまとめてある（説明の文もここから作る）。釣り合いの集計は tools/sim/。
import type { MorphResult } from "../morph";
import { firstKana, kanaOnly, lastKana } from "../kana";
import { farthestNounPair, sentenceFarness, type Embedder } from "./distance";

export type Played = {
  text: string;
  morph: MorphResult;
  total: number;
};

export type Ctx = {
  text: string;
  morph: MorphResult;
  mora: number;
  prev: Played | null; // このランで一つ前に送った文（ラウンドをまたぐ）
  past: Played[]; // このランで前に送った全部の文
  roundPast: Played[]; // このラウンドで前に送った文
  emb: Embedder | null; // 埋め込みが使えるときだけ
};

export type CardKind = "chips" | "mult" | "xmult" | "rule";

export type CardResult = {
  amount: number; // chips なら足す点、mult なら足す倍率、xmult なら掛ける倍率（効かないときは 0 / 1）
  detail: string; // 何を見て、どう効いたか
  hit: boolean;
};

export type CardDef = {
  id: string;
  name: string;
  source: "形態素" | "埋め込み";
  kind: CardKind;
  short: string; // カードの面に書く一行
  long: string; // くわしい説明（式と例）
  eval?: (c: Ctx) => CardResult | Promise<CardResult>;
};

/** カードの数値。変えると点が変わる（tools/sim で集計し直す）。 */
export const TUNING = {
  baseCap: 30,
  longCap: 60, // 50 → 60（長く打つことに報いる。集計で寄与が小さかった）
  proper: { per: 1, max: 3 },
  nouns: { per: 4 },
  pos: { over: 3, per: 0.5 }, // 4 超え×1 → 3 超え×0.5（ふつうの文でも少し効き、狙うと伸びる）
  verbs: { per: 0.4 }, // 0.5 → 0.4（ふつうの文で一番強かった）
  katakana: { per: 10 }, // 8 → 10
  shiritori: { x: 2 },
  haiku: { mora: 17, x: 3 },
  topic: { max: 1 }, // 2 → 1（埋め込みは「おまけ」。ふつうの文で一番強かった）
  frontier: { max: 1.5 },
  farnouns: { max: 12 }, // 30 → 12（名詞が 2 つあればたいてい t が高く、ほぼ無条件の加点だった）
};
const T = TUNING;

const SMALL = new Set([..."ァィゥェォャュョヮ"]);
/** 読みの拍の数。小さい ァィゥェォャュョヮ は前の仮名と合わせて 1 拍、ッ・ー・ン は 1 拍。読みの無い語（未知の漢字など）は数えない。 */
export function moraCount(reading: string): number {
  let n = 0;
  for (const c of kanaOnly(reading)) if (!SMALL.has(c)) n++;
  return n;
}

export const BASE_CAP = T.baseCap;
export const LONG_CAP = T.longCap;
const r1 = (x: number) => Math.round(x * 10) / 10;
const list = (xs: string[]) => (xs.length ? xs.join("・") : "なし");
const POS_SKIP = new Set(["記号", "フィラー", "その他"]);

export const CARDS: CardDef[] = [
  {
    id: "proper",
    name: "名のあるもの",
    source: "形態素",
    kind: "mult",
    short: `固有名詞 1 つにつき 倍率＋${T.proper.per}（${T.proper.max} つまで）`,
    long: `形態素解析（kuromoji）が「名詞・固有名詞」とした語を数える。人名・地名・組織名など。1 つにつき倍率＋${T.proper.per}、上限は ${T.proper.max} つ分。同じ語が 2 回出ても 2 つと数える。例: 「東京で山田さんに会った」→ 東京・山田 で倍率＋${r1(2 * T.proper.per)}。`,
    eval: (c) => {
      const ps = c.morph.properNouns;
      const n = Math.min(T.proper.max, ps.length);
      return { amount: r1(n * T.proper.per), hit: n > 0, detail: `固有名詞 ${ps.length}（${list(ps)}）× ${T.proper.per}` };
    },
  },
  {
    id: "nouns",
    name: "名詞あつめ",
    source: "形態素",
    kind: "chips",
    short: `名詞 1 つにつき ＋${T.nouns.per} 点`,
    long: `名詞（数・代名詞・「こと」などの非自立・「さん」などの接尾は除く）を、同じ表記の重複を除いて数える。1 つにつき＋${T.nouns.per} 点。例: 「朝の公園で犬と散歩した」→ 朝・公園・犬・散歩 で＋${4 * T.nouns.per} 点。`,
    eval: (c) => {
      const ns = c.morph.nouns;
      return { amount: ns.length * T.nouns.per, hit: ns.length > 0, detail: `名詞 ${ns.length}（${list(ns)}）× ${T.nouns.per}` };
    },
  },
  {
    id: "pos",
    name: "品詞のパレット",
    source: "形態素",
    kind: "mult",
    short: `品詞の種類が ${T.pos.over} を超えた分、1 種につき 倍率＋${T.pos.per}`,
    long: `文に出てくる品詞の種類（名詞・動詞・形容詞・副詞・助詞・助動詞・連体詞・接続詞・感動詞・接頭詞。記号とフィラーは数えない）を数え、${T.pos.over} 種を超えた分だけ倍率を足す。例: 名詞・助詞・動詞・助動詞・形容詞・副詞 の 6 種 → 倍率＋${r1((6 - T.pos.over) * T.pos.per)}。`,
    eval: (c) => {
      const kinds = [...new Set(c.morph.tokens.map((t) => t.pos).filter((p) => p && !POS_SKIP.has(p)))];
      const n = Math.max(0, kinds.length - T.pos.over);
      return { amount: r1(n * T.pos.per), hit: n > 0, detail: `品詞 ${kinds.length} 種（${list(kinds)}）− ${T.pos.over}` };
    },
  },
  {
    id: "verbs",
    name: "動詞の連鎖",
    source: "形態素",
    kind: "mult",
    short: `動詞 1 つにつき 倍率＋${T.verbs.per}`,
    long: `「動詞・自立」の語を数える（「〜ている」の「いる」のような非自立は数えない）。1 つにつき倍率＋${T.verbs.per}。例: 「走って跳んで笑った」→ 走る・跳ぶ・笑う で倍率＋${r1(3 * T.verbs.per)}。`,
    eval: (c) => {
      const vs = c.morph.tokens.filter((t) => t.pos === "動詞" && t.pos1 === "自立").map((t) => t.base || t.surface);
      return { amount: r1(vs.length * T.verbs.per), hit: vs.length > 0, detail: `動詞 ${vs.length}（${list(vs)}）× ${T.verbs.per}` };
    },
  },
  {
    id: "katakana",
    name: "カタカナ語",
    source: "形態素",
    kind: "chips",
    short: `カタカナだけで書かれた名詞 1 つにつき ＋${T.katakana.per} 点`,
    long: `表記がカタカナ（と長音の ー）だけの名詞を、重複を除いて数える。1 つにつき＋${T.katakana.per} 点。例: 「コーヒーとケーキを頼んだ」→ コーヒー・ケーキ で＋${2 * T.katakana.per} 点。`,
    eval: (c) => {
      const ks = [...new Set(c.morph.tokens.filter((t) => t.pos === "名詞" && /^[ァ-ヶー]+$/.test(t.surface) && t.surface !== "ー").map((t) => t.surface))];
      return { amount: ks.length * T.katakana.per, hit: ks.length > 0, detail: `カタカナの名詞 ${ks.length}（${list(ks)}）× ${T.katakana.per}` };
    },
  },
  {
    id: "long",
    name: "長文の心得",
    source: "形態素",
    kind: "rule",
    short: `基本点の上限を ${T.baseCap} 拍 → ${T.longCap} 拍に上げる`,
    long: `ふだん基本点（読みの拍の数）は ${T.baseCap} で頭打ちになる。このカードがあると上限が ${T.longCap} になり、長い文がそのまま点になる。`,
  },
  {
    id: "shiritori",
    name: "しりとり",
    source: "形態素",
    kind: "xmult",
    short: `前の文の最後の仮名で始まると 倍率×${T.shiritori.x}`,
    long: `前に送った文（ラウンドをまたいでよい）の読みの最後の仮名と、この文の読みの最初の仮名が同じなら倍率×${T.shiritori.x}。読みは kuromoji の読み（カタカナ）で、句読点は無視、最後の ー・ッ は飛ばし、小さい仮名は大きく直す（キャ→ヤ）。濁点の有無は区別する（ガ と カ は別）。例: 「…ねこ。」の次に「こたつで…」。`,
    eval: (c) => {
      if (!c.prev) return { amount: 1, hit: false, detail: "前の文が無い" };
      const a = lastKana(c.prev.morph.reading);
      const b = firstKana(c.morph.reading);
      const ok = a !== null && a === b;
      return { amount: ok ? T.shiritori.x : 1, hit: ok, detail: `前の文の最後「${a ?? "—"}」→ この文の最初「${b ?? "—"}」` };
    },
  },
  {
    id: "haiku",
    name: "十七音",
    source: "形態素",
    kind: "xmult",
    short: `読みがちょうど ${T.haiku.mora} 拍なら 倍率×${T.haiku.x}`,
    long: `読みの拍の数（小さい ゃゅょ などは前と合わせて 1 拍、っ・ー・ん は 1 拍）がちょうど ${T.haiku.mora} なら倍率×${T.haiku.x}。五七五の区切りは見ない。例: 「ふるいけや かわずとびこむ みずのおと」は 17 拍。`,
    eval: (c) => ({ amount: c.mora === T.haiku.mora ? T.haiku.x : 1, hit: c.mora === T.haiku.mora, detail: `読み ${c.mora} 拍` }),
  },
  {
    id: "topic",
    name: "話題転換",
    source: "埋め込み",
    kind: "mult",
    short: `前の文から意味が遠いほど 倍率＋（最大＋${T.topic.max}）`,
    long: `文の埋め込み（ruri-v3-30m）で、前の文とこの文の近さ（cos）を測る。生の cos は狭い幅に詰まるので、基準の 24 文を前の文と比べ、そのうち何文よりもこの文の方が遠いかの割合 t（0〜1）に直す。倍率＋${T.topic.max}×t（小数 1 桁に丸め）。注意: 埋め込みが測るのは話題の近さで、「好き／嫌い」のような反対の意味は遠くならない。`,
    eval: async (c) => {
      if (!c.emb || !c.prev) return { amount: 0, hit: false, detail: c.prev ? "埋め込みが使えない" : "前の文が無い" };
      const f = await sentenceFarness(c.emb, c.prev.text, c.text);
      const amt = r1(T.topic.max * f.t);
      return { amount: amt, hit: amt > 0, detail: `前の文から、基準の ${f.of} 文のうち ${f.beaten} 文より遠い → t=${f.t.toFixed(2)}（cos ${f.cos.toFixed(3)}）× ${T.topic.max}` };
    },
  },
  {
    id: "frontier",
    name: "新境地",
    source: "埋め込み",
    kind: "mult",
    short: `このラウンドのどの文からも遠いほど 倍率＋（最大＋${T.frontier.max}）`,
    long: `「話題転換」と同じ引き伸ばし方で、このラウンドで前に送った文それぞれについて t を出し、一番近い文（t が一番小さい文）の t を使う。倍率＋${T.frontier.max}×t。ラウンドの中で、前に書いたどの話題とも違うことを書くと伸びる。ラウンドの最初の文には効かない。`,
    eval: async (c) => {
      if (!c.emb || !c.roundPast.length) return { amount: 0, hit: false, detail: c.roundPast.length ? "埋め込みが使えない" : "このラウンドの最初の文" };
      let best: { t: number; text: string } | null = null;
      for (const p of c.roundPast) {
        const f = await sentenceFarness(c.emb, p.text, c.text);
        if (!best || f.t < best.t) best = { t: f.t, text: p.text };
      }
      const amt = r1(T.frontier.max * best!.t);
      return { amount: amt, hit: amt > 0, detail: `このラウンドで一番近い文「${best!.text.slice(0, 14)}${best!.text.length > 14 ? "…" : ""}」で t=${best!.t.toFixed(2)} × ${T.frontier.max}` };
    },
  },
  {
    id: "farnouns",
    name: "遠い名詞",
    source: "埋め込み",
    kind: "chips",
    short: `文の中の名詞どうしが遠いほど ＋点（最大＋${T.farnouns.max}）`,
    long: `文の中の名詞（「名詞あつめ」と同じ数え方）を単語として埋め込み、一番遠い 2 語 A・B を選ぶ。A から見て基準の 24 語のうち何語より B が遠いか、B から見て何語より A が遠いかの割合の平均を t（0〜1）とし、＋${T.farnouns.max}×t 点（整数に丸め）。名詞が 2 つ以上要る。単語の埋め込みは当てにならないことがある（宇宙と味噌汁が意外に近い、など）。`,
    eval: async (c) => {
      const ns = c.morph.nouns;
      if (!c.emb || ns.length < 2) return { amount: 0, hit: false, detail: !c.emb ? "埋め込みが使えない" : `名詞が ${ns.length} つ（2 つ以上要る）` };
      const p = (await farthestNounPair(c.emb, ns))!;
      const amt = Math.round(T.farnouns.max * p.t);
      return { amount: amt, hit: amt > 0, detail: `一番遠い組「${p.a}」と「${p.b}」: t=${p.t.toFixed(2)}（cos ${p.cos.toFixed(3)}）× ${T.farnouns.max}` };
    },
  },
];

export const CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]));

export type Line = { card: CardDef; result: CardResult };
export type Breakdown = {
  mora: number;
  cap: number;
  base: number;
  chipLines: Line[];
  multLines: Line[];
  xLines: Line[];
  chips: number;
  mult: number;
  xmult: number;
  total: number;
  duplicate: boolean;
};

export async function scoreSentence(ctx: Omit<Ctx, "mora">, owned: string[]): Promise<Breakdown> {
  const mora = moraCount(ctx.morph.reading);
  const c: Ctx = { ...ctx, mora };
  const cards = owned.map((id) => CARD_BY_ID.get(id)!).filter(Boolean);
  const cap = cards.some((k) => k.id === "long") ? T.longCap : T.baseCap;
  const base = Math.min(mora, cap);
  const run = async (kind: CardKind) => {
    const out: Line[] = [];
    for (const card of cards.filter((k) => k.kind === kind && k.eval)) out.push({ card, result: await card.eval!(c) });
    return out;
  };
  const chipLines = await run("chips");
  const multLines = await run("mult");
  const xLines = await run("xmult");
  const chips = base + chipLines.reduce((a, l) => a + l.result.amount, 0);
  const mult = r1(1 + multLines.reduce((a, l) => a + l.result.amount, 0));
  const xmult = xLines.reduce((a, l) => a * l.result.amount, 1);
  const duplicate = ctx.past.some((p) => p.text.trim() === ctx.text.trim());
  const total = duplicate ? 0 : Math.round(chips * mult * xmult);
  return { mora, cap, base, chipLines, multLines, xLines, chips, mult, xmult, total, duplicate };
}
