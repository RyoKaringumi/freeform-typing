// ラウンドの進め方の決めごと（画面に依らない部分）。ゲーム（main.ts）と集計（tools/sim）が同じものを使う。

/** 1 ラウンドで送れる文の数（拍の予算と合わせて 2 つで区切る。短い文ばかり並べて、文ごとに効くカードを重ねすぎないように） */
export const HANDS = 7; // 前は 5（予算を入れたので、15 拍ほどの短い文でも予算を使い切れる数にした）
/**
 * 1 ラウンドに使える拍の予算。1 文の拍（読めない字は 1 字 1 拍、cards.ts の budgetCost）がここから引かれ、
 * 残りより長い文は送れない。長い文ほど点が大きいが、そのぶん予算を早く使う。
 */
export const MORA_BUDGET = 100;
/** クリアしたときに見せるカードの枚数 */
export const OFFER_COUNT = 3;

/** ラウンドごとのゲート。表の先は GATE_GROWTH 倍ずつ（50 点単位に丸め）。難易度はここだけで変えられる。 */
export const GATES = [70, 100, 160, 250, 360, 520, 750, 1100]; // 集計（docs/balance.md）で決めた。前は 70, 100, 170, 280, 450, 700, 1000, 1450（その前は 80, 150, 250, 400, 600, 900, 1300, 1900）
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
