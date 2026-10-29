// カードの「何をすると得か」の一文と、効きを示す例文。画面の文言なので ui/ に置く（点の計算は cards.ts のまま）。
// 例文の効き方は決め打ちで書かず、その場で cards.ts のカードの関数に通して出す（runExample）。数値を変えても例がずれない。
import { BASE_CAP, CARD_BY_ID, LONG_CAP, moraCount, TUNING, type CardDef, type CardResult, type Ctx, type Played } from "../cards";
import type { MorphResult } from "../../morph";
import type { Embedder } from "../distance";

export type Guide = {
  /** 何をすると得か（カードの面に大きく書く一文） */
  goal: string;
  /** 効きを示す例文 */
  example: string;
  /** 例文の前に送った文（前の文・このラウンドの文を見るカード） */
  before?: string[];
};

export const GUIDE: Record<string, Guide> = {
  proper: { goal: "人名・地名・会社名を入れる", example: "東京で山田さんに会った" },
  nouns: { goal: "名詞をたくさん入れる", example: "朝の公園で犬と散歩した" },
  pos: { goal: "いろいろな品詞を混ぜる", example: "とても静かな森で小鳥がそっと鳴いた" },
  verbs: { goal: "動詞をたくさん使う", example: "走って跳んで笑った" },
  katakana: { goal: "カタカナの名詞を入れる", example: "コーヒーとケーキを頼んだ" },
  long: {
    goal: `${BASE_CAP} 拍を超える長い文も点になる`,
    example: "週末は友達と電車に乗って海の近くの小さな町へ出かけて、夕方まで散歩をしながら写真をたくさん撮った",
  },
  shiritori: { goal: "前の文の最後の音から始める", example: "猫がこたつで丸くなった", before: ["庭で遊ぶのは楽しいね"] },
  haiku: { goal: `読みをちょうど ${TUNING.haiku.mora} 拍にする`, example: "雨の日は傘をさして駅へと行く" },
  topic: { goal: "前の文と違う話題にする", example: "火星の探査機が砂嵐を観測した", before: ["朝ごはんにパンを食べた"] },
  frontier: { goal: "このラウンドのどの文とも違う話題にする", example: "古い寺の鐘が夕方に鳴った", before: ["朝ごはんにパンを食べた", "新しいスマホを買った"] },
  farnouns: { goal: "かけ離れた名詞を組み合わせる", example: "ペンギンが株価を気にしている" },
};

export const guideOf = (id: string): Guide => GUIDE[id] ?? { goal: CARD_BY_ID.get(id)?.short ?? "", example: "" };

/** 例文を解析・推論する道具。main.ts が辞書と埋め込みの準備ができたら渡す。 */
export type ExampleEnv = { analyze: (text: string) => MorphResult; emb: () => Embedder | null };
let env: ExampleEnv | null = null;
export function setExampleEnv(e: ExampleEnv) {
  env = e;
}

export type ExampleOut = { text: string; before: string[]; result: CardResult } | null;
const cache = new Map<string, Promise<ExampleOut>>();

/** 例文をカードの関数に通す。辞書がまだなら null。埋め込みのカードはモデルが使えるときだけキャッシュする。 */
export function runExample(card: CardDef): Promise<ExampleOut> {
  const g = guideOf(card.id);
  if (!env || !g.example) return Promise.resolve(null);
  const embedder = env.emb();
  const key = `${card.id}|${card.source === "埋め込み" ? (embedder ? "emb" : "none") : ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const e = env;
  const p = (async (): Promise<ExampleOut> => {
    const morph = e.analyze(g.example);
    const mora = moraCount(morph.reading);
    const before: Played[] = (g.before ?? []).map((t) => ({ text: t, morph: e.analyze(t), total: 0 }));
    const ctx: Ctx = { text: g.example, morph, mora, prev: before.at(-1) ?? null, past: before, roundPast: before, emb: embedder };
    let result: CardResult;
    if (card.eval) result = await card.eval(ctx);
    else if (card.id === "long") {
      const extra = Math.min(mora, LONG_CAP) - Math.min(mora, BASE_CAP);
      result = { amount: extra, hit: extra > 0, detail: `読み ${mora} 拍（ふだんは ${BASE_CAP} で頭打ち）` };
    } else return null;
    return { text: g.example, before: g.before ?? [], result };
  })().catch(() => null);
  cache.set(key, p);
  return p;
}
