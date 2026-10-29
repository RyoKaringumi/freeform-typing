// ラウンドの進め方の決めごと（画面に依らない部分）。ゲーム（main.ts）と集計（tools/sim）が同じものを使う。

/** 1 ラウンドで送れる文の数 */
export const HANDS = 5;
/** クリアしたときに見せるカードの枚数 */
export const OFFER_COUNT = 3;

/** ラウンドごとのゲート。表の先は GATE_GROWTH 倍ずつ（50 点単位に丸め）。難易度はここだけで変えられる。 */
export const GATES = [70, 100, 170, 280, 450, 700, 1000, 1450]; // 集計（docs/balance.md）で決めた。前は 80, 150, 250, 400, 600, 900, 1300, 1900
export const GATE_GROWTH = 1.5;

export function gateFor(round: number): number {
  if (round <= GATES.length) return GATES[round - 1];
  let g = GATES[GATES.length - 1];
  for (let r = GATES.length; r < round; r++) g = Math.round((g * GATE_GROWTH) / 50) * 50;
  return g;
}

/** pool から count 枚を無作為に選ぶ（rand は 0〜1 の乱数。集計では種付きの乱数を渡す）。 */
export function drawOffers<T>(pool: T[], count = OFFER_COUNT, rand: () => number = Math.random): T[] {
  const p = pool.slice();
  const out: T[] = [];
  while (out.length < count && p.length) out.push(p.splice(Math.floor(rand() * p.length), 1)[0]);
  return out;
}
