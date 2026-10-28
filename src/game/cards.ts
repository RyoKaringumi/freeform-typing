// 得点のルール（カード）と、1 文の点の計算。
// 点 = 基本点（チップ）× 倍率。基本点 = 読みの拍の数（上限あり）＋「点」のカード、
// 倍率 = 1 ＋「倍率＋」のカード、そのあと「倍率×」のカードを掛ける。
import type { MorphResult } from "../morph";
import { firstKana, kanaOnly, lastKana } from "../kana";
import { cosine } from "../vec";
import { farness, type EmbedClient } from "./embed-client";

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
  emb: EmbedClient | null; // 埋め込みが使えるときだけ
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

const SMALL = new Set([..."ァィゥェォャュョヮ"]);
/** 読みの拍の数。小さい ァィゥェォャュョヮ は前の仮名と合わせて 1 拍、ッ・ー・ン は 1 拍。読みの無い語（未知の漢字など）は数えない。 */
export function moraCount(reading: string): number {
  let n = 0;
  for (const c of kanaOnly(reading)) if (!SMALL.has(c)) n++;
  return n;
}

export const BASE_CAP = 30;
export const LONG_CAP = 50;
const r1 = (x: number) => Math.round(x * 10) / 10;
const list = (xs: string[]) => (xs.length ? xs.join("・") : "なし");

export const CARDS: CardDef[] = [
  {
    id: "proper",
    name: "名のあるもの",
    source: "形態素",
    kind: "mult",
    short: "固有名詞 1 つにつき 倍率＋1（3 つまで）",
    long: "形態素解析（kuromoji）が「名詞・固有名詞」とした語を数える。人名・地名・組織名など。1 つにつき倍率＋1、上限は＋3。同じ語が 2 回出ても 2 つと数える。例: 「東京で山田さんに会った」→ 東京・山田 で倍率＋2。",
    eval: (c) => {
      const ps = c.morph.properNouns;
      const n = Math.min(3, ps.length);
      return { amount: n, hit: n > 0, detail: `固有名詞 ${ps.length}（${list(ps)}）` };
    },
  },
  {
    id: "nouns",
    name: "名詞あつめ",
    source: "形態素",
    kind: "chips",
    short: "名詞 1 つにつき ＋4 点",
    long: "名詞（数・代名詞・「こと」などの非自立・「さん」などの接尾は除く）を、同じ表記の重複を除いて数える。1 つにつき＋4 点。例: 「朝の公園で犬と散歩した」→ 朝・公園・犬・散歩 で＋16 点。",
    eval: (c) => {
      const ns = c.morph.nouns;
      return { amount: ns.length * 4, hit: ns.length > 0, detail: `名詞 ${ns.length}（${list(ns)}）× 4` };
    },
  },
  {
    id: "pos",
    name: "品詞のパレット",
    source: "形態素",
    kind: "mult",
    short: "品詞の種類が 4 を超えた分、1 種につき 倍率＋1",
    long: "文に出てくる品詞の種類（名詞・動詞・形容詞・副詞・助詞・助動詞・連体詞・接続詞・感動詞・接頭詞。記号とフィラーは数えない）を数え、4 種を超えた分だけ倍率を足す。例: 名詞・助詞・動詞・助動詞・形容詞・副詞 の 6 種 → 倍率＋2。",
    eval: (c) => {
      const kinds = [...new Set(c.morph.tokens.map((t) => t.pos).filter((p) => p && p !== "記号" && p !== "フィラー"))];
      const n = Math.max(0, kinds.length - 4);
      return { amount: n, hit: n > 0, detail: `品詞 ${kinds.length} 種（${list(kinds)}）− 4` };
    },
  },
  {
    id: "verbs",
    name: "動詞の連鎖",
    source: "形態素",
    kind: "mult",
    short: "動詞 1 つにつき 倍率＋0.5",
    long: "「動詞・自立」の語を数える（「〜ている」の「いる」のような非自立は数えない）。1 つにつき倍率＋0.5。例: 「走って跳んで笑った」→ 走る・跳ぶ・笑う で倍率＋1.5。",
    eval: (c) => {
      const vs = c.morph.tokens.filter((t) => t.pos === "動詞" && t.pos1 === "自立").map((t) => t.base || t.surface);
      return { amount: vs.length * 0.5, hit: vs.length > 0, detail: `動詞 ${vs.length}（${list(vs)}）× 0.5` };
    },
  },
  {
    id: "katakana",
    name: "カタカナ語",
    source: "形態素",
    kind: "chips",
    short: "カタカナだけで書かれた名詞 1 つにつき ＋8 点",
    long: "表記がカタカナ（と長音の ー）だけの名詞を、重複を除いて数える。1 つにつき＋8 点。例: 「コーヒーとケーキを頼んだ」→ コーヒー・ケーキ で＋16 点。",
    eval: (c) => {
      const ks = [...new Set(c.morph.tokens.filter((t) => t.pos === "名詞" && /^[ァ-ヶー]+$/.test(t.surface) && t.surface !== "ー").map((t) => t.surface))];
      return { amount: ks.length * 8, hit: ks.length > 0, detail: `カタカナの名詞 ${ks.length}（${list(ks)}）× 8` };
    },
  },
  {
    id: "long",
    name: "長文の心得",
    source: "形態素",
    kind: "rule",
    short: `基本点の上限を ${BASE_CAP} 拍 → ${LONG_CAP} 拍に上げる`,
    long: `ふだん基本点（読みの拍の数）は ${BASE_CAP} で頭打ちになる。このカードがあると上限が ${LONG_CAP} になり、長い文がそのまま点になる。`,
  },
  {
    id: "shiritori",
    name: "しりとり",
    source: "形態素",
    kind: "xmult",
    short: "前の文の最後の仮名で始まると 倍率×2",
    long: "前に送った文（ラウンドをまたいでよい）の読みの最後の仮名と、この文の読みの最初の仮名が同じなら倍率×2。読みは kuromoji の読み（カタカナ）で、句読点は無視、最後の ー・ッ は飛ばし、小さい仮名は大きく直す（キャ→ヤ）。濁点の有無は区別する（ガ と カ は別）。例: 「…ねこ。」の次に「こたつで…」。",
    eval: (c) => {
      if (!c.prev) return { amount: 1, hit: false, detail: "前の文が無い" };
      const a = lastKana(c.prev.morph.reading);
      const b = firstKana(c.morph.reading);
      const ok = a !== null && a === b;
      return { amount: ok ? 2 : 1, hit: ok, detail: `前の文の最後「${a ?? "—"}」→ この文の最初「${b ?? "—"}」` };
    },
  },
  {
    id: "haiku",
    name: "十七音",
    source: "形態素",
    kind: "xmult",
    short: "読みがちょうど 17 拍なら 倍率×3",
    long: "読みの拍の数（小さい ゃゅょ などは前と合わせて 1 拍、っ・ー・ん は 1 拍）がちょうど 17 なら倍率×3。五七五の区切りは見ない。例: 「ふるいけや かわずとびこむ みずのおと」は 17 拍。",
    eval: (c) => ({ amount: c.mora === 17 ? 3 : 1, hit: c.mora === 17, detail: `読み ${c.mora} 拍` }),
  },
  {
    id: "topic",
    name: "話題転換",
    source: "埋め込み",
    kind: "mult",
    short: "前の文から意味が遠いほど 倍率＋（最大＋2）",
    long: "文の埋め込み（ruri-v3-30m）で、前の文とこの文の近さ（cos）を測る。生の cos は狭い幅に詰まるので、基準の 24 文を前の文と比べ、そのうち何文よりもこの文の方が遠いかの割合 t（0〜1）に直す。倍率＋2×t（小数 1 桁に丸め）。注意: 埋め込みが測るのは話題の近さで、「好き／嫌い」のような反対の意味は遠くならない。",
    eval: async (c) => {
      if (!c.emb || !c.prev) return { amount: 0, hit: false, detail: c.prev ? "埋め込みが使えない" : "前の文が無い" };
      const [a, b] = await Promise.all([c.emb.embed(c.prev.text), c.emb.embed(c.text)]);
      const f = farness(a, b, c.emb.refSent);
      const amt = r1(2 * f.t);
      return { amount: amt, hit: amt > 0, detail: `前の文から、基準の ${f.of} 文のうち ${f.beaten} 文より遠い → t=${f.t.toFixed(2)}（cos ${f.cos.toFixed(3)}）× 2` };
    },
  },
  {
    id: "frontier",
    name: "新境地",
    source: "埋め込み",
    kind: "mult",
    short: "このラウンドのどの文からも遠いほど 倍率＋（最大＋1.5）",
    long: "「話題転換」と同じ引き伸ばし方で、このラウンドで前に送った文それぞれについて t を出し、一番近い文（t が一番小さい文）の t を使う。倍率＋1.5×t。ラウンドの中で、前に書いたどの話題とも違うことを書くと伸びる。ラウンドの最初の文には効かない。",
    eval: async (c) => {
      if (!c.emb || !c.roundPast.length) return { amount: 0, hit: false, detail: c.roundPast.length ? "埋め込みが使えない" : "このラウンドの最初の文" };
      const b = await c.emb.embed(c.text);
      let best: { t: number; beaten: number; of: number; text: string } | null = null;
      for (const p of c.roundPast) {
        const a = await c.emb.embed(p.text);
        const f = farness(a, b, c.emb.refSent);
        if (!best || f.t < best.t) best = { ...f, text: p.text };
      }
      const amt = r1(1.5 * best!.t);
      return { amount: amt, hit: amt > 0, detail: `このラウンドで一番近い文「${best!.text.slice(0, 14)}${best!.text.length > 14 ? "…" : ""}」で t=${best!.t.toFixed(2)} × 1.5` };
    },
  },
  {
    id: "farnouns",
    name: "遠い名詞",
    source: "埋め込み",
    kind: "chips",
    short: "文の中の名詞どうしが遠いほど ＋点（最大＋30）",
    long: "文の中の名詞（「名詞あつめ」と同じ数え方）を単語として埋め込み、一番遠い 2 語 A・B を選ぶ。A から見て基準の 24 語のうち何語より B が遠いか、B から見て何語より A が遠いかの割合の平均を t（0〜1）とし、＋30×t 点（整数に丸め）。名詞が 2 つ以上要る。単語の埋め込みは当てにならないことがある（宇宙と味噌汁が意外に近い、など）。",
    eval: async (c) => {
      const ns = c.morph.nouns;
      if (!c.emb || ns.length < 2) return { amount: 0, hit: false, detail: !c.emb ? "埋め込みが使えない" : `名詞が ${ns.length} つ（2 つ以上要る）` };
      const vs: number[][] = [];
      for (const n of ns) vs.push(await c.emb.embed(n));
      let bi = 0, bj = 1, bc = Infinity;
      for (let i = 0; i < vs.length; i++)
        for (let j = i + 1; j < vs.length; j++) {
          const x = cosine(vs[i], vs[j]);
          if (x < bc) { bc = x; bi = i; bj = j; }
        }
      const f1 = farness(vs[bi], vs[bj], c.emb.refWord);
      const f2 = farness(vs[bj], vs[bi], c.emb.refWord);
      const t = (f1.t + f2.t) / 2;
      const amt = Math.round(30 * t);
      return { amount: amt, hit: amt > 0, detail: `一番遠い組「${ns[bi]}」と「${ns[bj]}」: t=${t.toFixed(2)}（cos ${bc.toFixed(3)}）× 30` };
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
  const cap = cards.some((k) => k.id === "long") ? LONG_CAP : BASE_CAP;
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
