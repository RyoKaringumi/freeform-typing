// 埋め込みのカードが使う「遠さ」の計算を、ここ一か所に集める。
// 別の測り方（たとえば分類の木の距離）に差し替えるときは、この 2 つの関数の中身だけを変えればよい。
// 戻り値の t は 0〜1（1 に近いほど遠い）。カードの側は t に係数を掛けるだけ。
import { cosine } from "../vec";

/** 埋め込みの窓口。ゲームでは Web Worker（embed-client.ts）、集計（tools/sim）では Node の推論が入る。 */
export interface Embedder {
  embed(text: string): Promise<number[]>;
  /** 基準の文・語のベクトル（refs.ts の順） */
  refSent: number[][];
  refWord: number[][];
}

export type Farness = { t: number; beaten: number; of: number; cos: number };

/**
 * 生の cos は狭い幅に詰まるので、基準との順位で 0〜1 に引き伸ばす。
 * anchor から見て、基準のベクトルのうち target より anchor に近いものの割合。
 * 1 に近いほど「ふつうの文（語）のほとんどより遠い」。
 */
export function farness(anchor: number[], target: number[], refs: number[][]): Farness {
  const c = cosine(anchor, target);
  let beaten = 0, of = 0;
  for (const r of refs) {
    const x = cosine(anchor, r);
    if (x > 0.9999) continue; // anchor が基準と同じ文字列なら、その基準は数えない
    of++;
    if (x > c) beaten++;
  }
  return { t: of ? beaten / of : 0, beaten, of, cos: c };
}

/** 文 a から見た文 b の遠さ（「話題転換」「新境地」）。 */
export async function sentenceFarness(emb: Embedder, a: string, b: string): Promise<Farness> {
  const [va, vb] = await Promise.all([emb.embed(a), emb.embed(b)]);
  return farness(va, vb, emb.refSent);
}

export type NounPair = { a: string; b: string; t: number; cos: number };

/**
 * 文の中の名詞のうち、一番遠い組とその遠さ（「遠い名詞」）。名詞が 2 つ未満なら null。
 * 一番 cos の小さい組を選び、両側から見た順位の割合の平均を t にする。
 */
export async function farthestNounPair(emb: Embedder, nouns: string[]): Promise<NounPair | null> {
  if (nouns.length < 2) return null;
  const vs: number[][] = [];
  for (const n of nouns) vs.push(await emb.embed(n));
  let bi = 0, bj = 1, bc = Infinity;
  for (let i = 0; i < vs.length; i++)
    for (let j = i + 1; j < vs.length; j++) {
      const x = cosine(vs[i], vs[j]);
      if (x < bc) { bc = x; bi = i; bj = j; }
    }
  const f1 = farness(vs[bi], vs[bj], emb.refWord);
  const f2 = farness(vs[bj], vs[bi], emb.refWord);
  return { a: nouns[bi], b: nouns[bj], t: (f1.t + f2.t) / 2, cos: bc };
}
