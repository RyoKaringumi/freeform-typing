// transformers.js で文・単語の埋め込みを取る。モデルは Hugging Face Hub から読み、ブラウザのキャッシュに残る。
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

env.allowLocalModels = false; // 自サイトの /models/ は探さない（重みはリポジトリに置かない）
env.useBrowserCache = true;

export type EmbedConfig = {
  model: string;
  dtype: "fp32" | "fp16" | "q8" | "q4";
  device: "wasm" | "webgpu";
  pooling: "mean" | "cls";
  prefix: string; // 文・単語の前に付ける文字列。ruri-v3 は意味の比較なら ""、e5 は "query: "
};

// 既定は日本語専用の ruri-v3-30m（取得 約 44 MB）。e5-small との比較で文の順番が妥当、単語もましだった
export const DEFAULT_CONFIG: EmbedConfig = {
  model: "sirasagi62/ruri-v3-30m-ONNX",
  dtype: "q8",
  device: "wasm",
  pooling: "mean",
  prefix: "",
};

export function configKey(c: EmbedConfig): string {
  return `${c.model}|${c.dtype}|${c.device}|${c.pooling}|${JSON.stringify(c.prefix)}`;
}

export type ModelLoadInfo = {
  key: string;
  ms: number;
  files: Record<string, number>; // ファイルごとのバイト数（progress の total）
  totalBytes: number;
  dims: number;
};

type Loaded = { extractor: FeatureExtractionPipeline; info: ModelLoadInfo };
const cache = new Map<string, Promise<Loaded>>();

export function loadModel(c: EmbedConfig, onProgress?: (msg: string) => void): Promise<Loaded> {
  const key = configKey(c);
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const t0 = performance.now();
    const files: Record<string, number> = {};
    const extractor = (await pipeline("feature-extraction", c.model, {
      dtype: c.dtype,
      device: c.device,
      progress_callback: (i) => {
        if (i.status === "progress") {
          files[i.file] = i.total;
          onProgress?.(`${i.file} ${(i.loaded / 1e6).toFixed(1)} / ${(i.total / 1e6).toFixed(1)} MB`);
        } else if (i.status === "progress_total") {
          onProgress?.(`合計 ${(i.loaded / 1e6).toFixed(1)} / ${(i.total / 1e6).toFixed(1)} MB`);
        }
      },
    })) as FeatureExtractionPipeline;
    const ms = performance.now() - t0;
    const probe = await extractor(c.prefix + "テスト", { pooling: c.pooling, normalize: true });
    const dims = probe.dims[probe.dims.length - 1];
    const totalBytes = Object.values(files).reduce((a, b) => a + b, 0);
    return { extractor, info: { key, ms, files, totalBytes, dims } };
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

/** 1 文ずつ推論する（バッチにするとパディングの有無で値がわずかに揺れうるため、決定性を優先）。 */
export async function embedOne(c: EmbedConfig, text: string): Promise<{ vec: number[]; ms: number }> {
  const { extractor } = await loadModel(c);
  const t0 = performance.now();
  const out = await extractor(c.prefix + text, { pooling: c.pooling, normalize: true });
  const vec = Array.from(out.data as Float32Array);
  return { vec, ms: performance.now() - t0 };
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
