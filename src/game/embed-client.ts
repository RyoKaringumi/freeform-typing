// ゲーム側から Worker の埋め込みを使う窓口。文字列ごとにベクトルをキャッシュする（同じ文字列は同じベクトル）。
import type { ModelLoadInfo } from "../embed";
import { cosine } from "../vec";
import { REF_SENTENCES, REF_WORDS } from "./refs";

type Pending = { resolve: (v: any) => void; reject: (e: unknown) => void };

export class EmbedClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private cache = new Map<string, Promise<number[]>>();
  state: "loading" | "ready" | "error" = "loading";
  error = "";
  info: ModelLoadInfo | null = null;
  refSent: number[][] = [];
  refWord: number[][] = [];
  onChange: (msg: string) => void = () => {};

  constructor() {
    this.worker = new Worker(new URL("../embed-worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev) => {
      const d = ev.data;
      if (d.type === "progress") {
        this.onChange(d.msg);
        return;
      }
      const p = this.pending.get(d.id);
      if (!p) return;
      this.pending.delete(d.id);
      if (d.ok) p.resolve(d.info ?? d.vec);
      else p.reject(new Error(d.error));
    };
    this.worker.onerror = (e) => {
      this.state = "error";
      this.error = e.message || "Worker の起動に失敗";
      this.onChange("");
    };
  }

  private call<T>(msg: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...msg });
    });
  }

  /** モデルを読み、基準の文・語のベクトルを先に作っておく。終わるまで埋め込みのカードは出さない。 */
  async load(): Promise<void> {
    try {
      this.info = await this.call<ModelLoadInfo>({ type: "load" });
      this.onChange("基準の文と語を準備中…");
      this.refSent = [];
      for (const s of REF_SENTENCES) this.refSent.push(await this.embed(s));
      this.refWord = [];
      for (const w of REF_WORDS) this.refWord.push(await this.embed(w));
      this.state = "ready";
      this.onChange("");
    } catch (e) {
      this.state = "error";
      this.error = String(e);
      this.onChange("");
    }
  }

  embed(text: string): Promise<number[]> {
    const hit = this.cache.get(text);
    if (hit) return hit;
    const p = this.call<number[]>({ type: "embed", text });
    this.cache.set(text, p);
    p.catch(() => this.cache.delete(text));
    return p;
  }
}

/**
 * 生の cos は狭い幅に詰まるので、基準との順位で 0〜1 に引き伸ばす。
 * anchor から見て、基準のベクトルのうち target より anchor に近いものの割合。
 * 1 に近いほど「ふつうの文（語）のほとんどより遠い」。
 */
export function farness(anchor: number[], target: number[], refs: number[][]): { t: number; beaten: number; of: number; cos: number } {
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
