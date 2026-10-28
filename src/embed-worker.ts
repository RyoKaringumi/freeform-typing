// 埋め込みの推論を担う Web Worker。送信のたびに画面が固まらないよう、transformers.js はここでだけ動かす。
// 設定はゲームの既定（DEFAULT_CONFIG）に固定。1 文ずつ推論する（決定性のため。embed.ts の embedOne と同じ）。
import { DEFAULT_CONFIG, embedOne, loadModel } from "./embed";

type Req = { id: number; type: "load" } | { id: number; type: "embed"; text: string };

self.onmessage = async (ev: MessageEvent<Req>) => {
  const req = ev.data;
  try {
    if (req.type === "load") {
      const { info } = await loadModel(DEFAULT_CONFIG, (msg) => self.postMessage({ type: "progress", msg }));
      self.postMessage({ id: req.id, ok: true, info });
    } else {
      const { vec } = await embedOne(DEFAULT_CONFIG, req.text);
      self.postMessage({ id: req.id, ok: true, vec });
    }
  } catch (e) {
    self.postMessage({ id: req.id, ok: false, error: String(e) });
  }
};
