import type { TokenRow } from "./morph";

export function kataToHira(s: string): string {
  // ァ(30A1)〜ヶ(30F6) を ぁ〜ゖ へ。ー などはそのまま。
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function hiraToKata(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/** kuromoji の読みでひらがなにする。読みが無いトークン（未知語・記号・英字）は表層形をそのまま（カタカナならひらがなへ）。 */
export function hiraganize(tokens: TokenRow[]): string {
  return tokens.map((t) => kataToHira(t.reading || t.surface)).join("");
}

const SMALL_TO_LARGE: Record<string, string> = {
  ァ: "ア", ィ: "イ", ゥ: "ウ", ェ: "エ", ォ: "オ",
  ャ: "ヤ", ュ: "ユ", ョ: "ヨ", ヮ: "ワ", ヵ: "カ", ヶ: "ケ",
};
const DAKUTEN_STRIP: Record<string, string> = {};
{
  const voiced = "ガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポヴ";
  const plain = "カキクケコサシスセソタチツテトハヒフヘホハヒフヘホウ";
  for (let i = 0; i < voiced.length; i++) DAKUTEN_STRIP[voiced[i]] = plain[i];
}

export const SHIRITORI_RULE = [
  "文全体の読み（kuromoji の reading、カタカナ。は→ハ のように表記どおり、発音 ワ ではない）を使う。",
  "読みからカタカナ以外（句読点・英字・数字・記号）を除く。読みの無い未知語は表層形のカタカナ部分だけが残る。",
  "前の文の最後の仮名: 末尾の ー と ッ は飛ばして、その前の仮名を使う（例: コーヒー→ヒ、アッ→ア）。",
  "小書きの仮名は大きい仮名に直す（キャ→ヤ、ァ→ア、ヮ→ワ）。",
  "この文の最初の仮名: 読みの先頭の仮名（小書きなら大きく直す）。",
  "一致（厳密）: 二つが同じ仮名。一致（濁点・半濁点を無視）: ガ=カ、パ=ハ なども同じとみなす参考値。",
  "前の文の最後が ン なら「ンで終わる」を立てる（ゲームのルールにするかは未定）。",
];

export function kanaOnly(reading: string): string {
  return hiraToKata(reading).replace(/[^ァ-ヶー]/g, "");
}

export function lastKana(reading: string): string | null {
  const k = kanaOnly(reading);
  for (let i = k.length - 1; i >= 0; i--) {
    const c = k[i];
    if (c === "ー" || c === "ッ") continue;
    return SMALL_TO_LARGE[c] ?? c;
  }
  return null;
}

export function firstKana(reading: string): string | null {
  const k = kanaOnly(reading);
  for (const c of k) {
    if (c === "ー") continue;
    return SMALL_TO_LARGE[c] ?? c;
  }
  return null;
}

export type Shiritori = {
  prevLast: string | null;
  thisFirst: string | null;
  match: boolean;
  matchIgnoringDakuten: boolean;
  prevEndsWithN: boolean;
};

export function shiritori(prevReading: string, thisReading: string): Shiritori {
  const prevLast = lastKana(prevReading);
  const thisFirst = firstKana(thisReading);
  const strip = (c: string | null) => (c ? DAKUTEN_STRIP[c] ?? c : c);
  return {
    prevLast,
    thisFirst,
    match: prevLast !== null && prevLast === thisFirst,
    matchIgnoringDakuten: prevLast !== null && strip(prevLast) === strip(thisFirst),
    prevEndsWithN: prevLast === "ン",
  };
}
