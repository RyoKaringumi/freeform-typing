// 送った文に対する、カードごとの「効いた・あと少し・効かなかった」の判定（見せ方のためだけ。点は変えない）。
// 「あと少し」は、少し直せば効いた／もっと効いた、が分かる場合だけ出す（十七音の拍の差、しりとりの濁点違い など）。
import { BASE_CAP, CARD_BY_ID, LONG_CAP, TUNING, type CardDef, type Line } from "../cards";
import { lastKana, shiritori } from "../../kana";
import type { Entry } from "./breakdown";
import { fmtMult } from "./dom";

export type VerdictState = "hit" | "near" | "miss";
export type Verdict = {
  card: CardDef;
  state: VerdictState;
  /** 点の箱に入った値（＋4、＋1.0、×2 など）。効かなければ "—" */
  value: string;
  /** 一言の理由（何を見てどうだったか） */
  why: string;
  /** あと少しのとき、何をすれば効いたか */
  tip?: string;
};

const POS_ALL = ["名詞", "動詞", "形容詞", "副詞", "助詞", "助動詞", "連体詞", "接続詞", "感動詞", "接頭詞"];
const POS_SKIP = new Set(["記号", "フィラー", "その他"]);

export function valueText(l: Line): string {
  if (!l.result.hit) return "—";
  const a = l.result.amount;
  return l.card.kind === "chips" ? `＋${a}` : l.card.kind === "mult" ? `＋${fmtMult(a)}` : `×${fmtMult(a)}`;
}

function nearFor(l: Line, e: Entry, prev: Entry | null): { tip: string } | null {
  const id = l.card.id;
  const hit = l.result.hit;
  if (id === "haiku" && !hit) {
    const d = TUNING.haiku.mora - e.bd.mora;
    if (Math.abs(d) <= 3) return { tip: d > 0 ? `あと ${d} 拍で ${TUNING.haiku.mora} 拍` : `${-d} 拍多い（${TUNING.haiku.mora} 拍で効く）` };
  }
  if (id === "pos" && !hit) {
    const kinds = new Set(e.morph.tokens.map((t) => t.pos).filter((p) => p && !POS_SKIP.has(p)));
    if (kinds.size === TUNING.pos.over) {
      const missing = POS_ALL.filter((p) => !kinds.has(p) && p !== "接頭詞" && p !== "感動詞").slice(0, 3);
      return { tip: `あと 1 種で効く（${missing.join("・")} など）` };
    }
  }
  if (id === "shiritori" && !hit && prev) {
    const s = shiritori(prev.morph.reading, e.morph.reading);
    if (s.matchIgnoringDakuten) return { tip: `濁点の違い（「${s.prevLast}」と「${s.thisFirst}」は別の音）` };
  }
  if (l.card.source === "埋め込み" && !hit) {
    const m = /t=([\d.]+)/.exec(l.result.detail);
    if (m && Number(m[1]) > 0) return { tip: "もう少し遠ければ効いた" };
  }
  return null;
}

/** 手持ちのカードそれぞれの判定（手持ちの順）。 */
export function verdicts(e: Entry, prev: Entry | null, owned: string[]): Verdict[] {
  const lines = new Map([...e.bd.chipLines, ...e.bd.multLines, ...e.bd.xLines].map((l) => [l.card.id, l]));
  const out: Verdict[] = [];
  for (const id of owned) {
    const card = CARD_BY_ID.get(id);
    if (!card) continue;
    if (id === "long") {
      const used = e.bd.mora > BASE_CAP;
      out.push({
        card,
        state: used ? "hit" : "miss",
        value: used ? `＋${Math.min(e.bd.mora, LONG_CAP) - BASE_CAP}` : "—",
        why: used ? `${e.bd.mora} 拍。上限 ${BASE_CAP} を超えた分も点になった` : `${e.bd.mora} 拍（${BASE_CAP} 拍以下なので使わなかった）`,
      });
      continue;
    }
    const l = lines.get(id);
    if (!l) continue;
    const near = nearFor(l, e, prev);
    out.push({ card, state: l.result.hit ? "hit" : near ? "near" : "miss", value: valueText(l), why: l.result.detail, tip: near?.tip });
  }
  return out;
}

/** 次の文に向けた一言（しりとりの次の音など）。手持ちの列のカードに出す。 */
export function nextHint(id: string, last: Entry | null): string {
  if (!last) return "";
  if (id === "shiritori") {
    const k = lastKana(last.morph.reading);
    return k ? `次は「${k}」から` : "";
  }
  return "";
}

export const STATE_LABEL: Record<VerdictState, string> = { hit: "効いた", near: "あと少し", miss: "効かず" };
