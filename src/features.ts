// 1 回の送信から、表示とルール試作に使う特徴量をすべて計算する。
import type { IpadicFeatures, Tokenizer } from "kuromoji";
import { analyze, type MorphResult } from "./morph";
import { hiraganize, shiritori, type Shiritori } from "./kana";
import { configKey, cosine, embedOne, type EmbedConfig } from "./embed";

export type NounEmbedding = {
  nouns: string[];
  vecs: number[][];
  ms: number;
  /** 距離 = 1 - コサイン類似度 */
  distance: number[][];
  /** i<j の組についての距離の統計。名詞が 2 つ未満なら null */
  stats: { min: number; mean: number; max: number; pairs: number } | null;
};

export type Side = {
  text: string;
  morph: MorphResult;
  sentence: { vec: number[]; ms: number };
  nounEmb: NounEmbedding;
};

export type PastSim = { id: number; cos: number; dist: number };

export type Entry = {
  id: number;
  createdAt: string;
  text: string;
  embedKey: string;
  embedConfig: EmbedConfig;
  original: Side;
  /** ひらがな化して再解析した側（トグルが ON のときだけ） */
  hira?: Side & { cosToOriginal: number };
  prevId: number | null;
  /** 直前の文との比較 */
  prev: (PastSim & { shiritori: Shiritori }) | null;
  /** 過去の全文との比較（同じ埋め込み設定のものだけ） */
  past: PastSim[];
};

async function nounEmbedding(cfg: EmbedConfig, nouns: string[]): Promise<NounEmbedding> {
  const vecs: number[][] = [];
  let ms = 0;
  for (const n of nouns) {
    const r = await embedOne(cfg, n);
    vecs.push(r.vec);
    ms += r.ms;
  }
  const distance = vecs.map((a) => vecs.map((b) => 1 - cosine(a, b)));
  let stats: NounEmbedding["stats"] = null;
  if (vecs.length >= 2) {
    const ds: number[] = [];
    for (let i = 0; i < vecs.length; i++) for (let j = i + 1; j < vecs.length; j++) ds.push(distance[i][j]);
    stats = {
      min: Math.min(...ds),
      max: Math.max(...ds),
      mean: ds.reduce((a, b) => a + b, 0) / ds.length,
      pairs: ds.length,
    };
  }
  return { nouns, vecs, ms, distance, stats };
}

async function side(tokenizer: Tokenizer<IpadicFeatures>, cfg: EmbedConfig, text: string): Promise<Side> {
  const morph = analyze(tokenizer, text);
  const sentence = await embedOne(cfg, text);
  const nounEmb = await nounEmbedding(cfg, morph.nouns);
  return { text, morph, sentence, nounEmb };
}

export async function computeEntry(
  tokenizer: Tokenizer<IpadicFeatures>,
  cfg: EmbedConfig,
  text: string,
  history: Entry[],
  opts: { id: number; createdAt: string; withHira: boolean },
): Promise<Entry> {
  const key = configKey(cfg);
  const original = await side(tokenizer, cfg, text);
  let hira: Entry["hira"];
  if (opts.withHira) {
    const h = await side(tokenizer, cfg, hiraganize(original.morph.tokens));
    hira = { ...h, cosToOriginal: cosine(original.sentence.vec, h.sentence.vec) };
  }
  const past: PastSim[] = history
    .filter((e) => e.embedKey === key)
    .map((e) => {
      const cos = cosine(original.sentence.vec, e.original.sentence.vec);
      return { id: e.id, cos, dist: 1 - cos };
    });
  const p = history.length ? history[history.length - 1] : null;
  let prev: Entry["prev"] = null;
  if (p) {
    const ps = past.find((s) => s.id === p.id);
    prev = {
      id: p.id,
      cos: ps ? ps.cos : NaN, // 埋め込み設定が違うと比べられない
      dist: ps ? ps.dist : NaN,
      shiritori: shiritori(p.original.morph.reading, original.morph.reading),
    };
  }
  return { id: opts.id, createdAt: opts.createdAt, text, embedKey: key, embedConfig: { ...cfg }, original, hira, prevId: p ? p.id : null, prev, past };
}

/** ルール試作に渡す、平たい特徴量（ベクトルは含めない） */
export function flatFeatures(e: Entry) {
  const o = e.original;
  return {
    id: e.id,
    text: e.text,
    length: [...e.text].length,
    readingLength: o.morph.reading.length,
    tokenCount: o.morph.tokens.length,
    tokens: o.morph.tokens,
    nouns: o.morph.nouns,
    properNouns: o.morph.properNouns,
    simPrev: e.prev ? e.prev.cos : null,
    distPrev: e.prev ? e.prev.dist : null,
    past: e.past,
    nounDist: o.nounEmb.stats,
    shiritori: e.prev ? e.prev.shiritori : null,
    hira: e.hira
      ? {
          text: e.hira.text,
          properNouns: e.hira.morph.properNouns,
          nouns: e.hira.morph.nouns,
          nounDist: e.hira.nounEmb.stats,
          cosToOriginal: e.hira.cosToOriginal,
        }
      : null,
  };
}
export type FlatFeatures = ReturnType<typeof flatFeatures>;
