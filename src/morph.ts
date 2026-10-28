// kuromoji.js の辞書を fetch で読み、Tokenizer を作る。
//
// kuromoji 本体のブラウザ用ローダーは「受け取ったバイト列を必ず gunzip する」。
// サーバーが .gz に Content-Encoding: gzip を付けて返すと、ブラウザが先に展開してしまい、
// 二重に展開しようとして失敗する（よく知られた落とし穴）。
// ここでは先頭 2 バイトが gzip のマジック (1f 8b) のときだけ展開するので、どちらの配信でも動く。
import type { IpadicFeatures, Tokenizer } from "kuromoji";
import TokenizerCtor from "kuromoji/src/Tokenizer.js";
import DynamicDictionaries from "kuromoji/src/dict/DynamicDictionaries.js";

export type DictFileStat = {
  file: string;
  fetchedBytes: number;
  gzipped: boolean; // 受け取った時点で gzip のままだったか
  contentEncoding: string | null;
  bytes: number; // 展開後
};

export type MorphLoadInfo = {
  ms: number;
  files: DictFileStat[];
};

const FILES = [
  "base.dat.gz", "check.dat.gz",
  "tid.dat.gz", "tid_pos.dat.gz", "tid_map.dat.gz",
  "cc.dat.gz",
  "unk.dat.gz", "unk_pos.dat.gz", "unk_map.dat.gz", "unk_char.dat.gz", "unk_compat.dat.gz", "unk_invoke.dat.gz",
] as const;

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

async function loadFile(dictUrl: string, file: string): Promise<{ buf: ArrayBuffer; stat: DictFileStat }> {
  const res = await fetch(dictUrl + file);
  if (!res.ok) throw new Error(`辞書 ${file} の取得に失敗: HTTP ${res.status}`);
  const raw = await res.arrayBuffer();
  const head = new Uint8Array(raw, 0, Math.min(2, raw.byteLength));
  const gzipped = head[0] === 0x1f && head[1] === 0x8b;
  const buf = gzipped ? await gunzip(raw) : raw;
  return {
    buf,
    stat: {
      file,
      fetchedBytes: raw.byteLength,
      gzipped,
      contentEncoding: res.headers.get("content-encoding"),
      bytes: buf.byteLength,
    },
  };
}

export async function loadTokenizer(dictUrl: string): Promise<{ tokenizer: Tokenizer<IpadicFeatures>; info: MorphLoadInfo }> {
  const t0 = performance.now();
  const loaded = await Promise.all(FILES.map((f) => loadFile(dictUrl, f)));
  const b = Object.fromEntries(loaded.map((l, i) => [FILES[i], l.buf])) as Record<(typeof FILES)[number], ArrayBuffer>;
  const dic = new DynamicDictionaries();
  dic.loadTrie(new Int32Array(b["base.dat.gz"]), new Int32Array(b["check.dat.gz"]));
  dic.loadTokenInfoDictionaries(new Uint8Array(b["tid.dat.gz"]), new Uint8Array(b["tid_pos.dat.gz"]), new Uint8Array(b["tid_map.dat.gz"]));
  dic.loadConnectionCosts(new Int16Array(b["cc.dat.gz"]));
  dic.loadUnknownDictionaries(
    new Uint8Array(b["unk.dat.gz"]), new Uint8Array(b["unk_pos.dat.gz"]), new Uint8Array(b["unk_map.dat.gz"]),
    new Uint8Array(b["unk_char.dat.gz"]), new Uint32Array(b["unk_compat.dat.gz"]), new Uint8Array(b["unk_invoke.dat.gz"]),
  );
  const tokenizer = new TokenizerCtor(dic);
  return { tokenizer, info: { ms: performance.now() - t0, files: loaded.map((l) => l.stat) } };
}

export type TokenRow = {
  surface: string;
  pos: string;
  pos1: string;
  pos2: string;
  pos3: string;
  conjType: string;
  conjForm: string;
  base: string;
  reading: string;
  pronunciation: string;
  wordType: string; // KNOWN / UNKNOWN
  proper: boolean;
};

export type MorphResult = {
  tokens: TokenRow[];
  reading: string; // 文全体の読み（カタカナ、読みが無いトークンは表層形）
  pronunciation: string;
  properNouns: string[];
  nouns: string[]; // 単語の埋め込みに使う名詞（重複なし）
  nounRule: string;
  ms: number;
};

const NOUN_EXCLUDE = new Set(["非自立", "接尾", "数", "代名詞"]);
export const NOUN_RULE = "品詞=名詞 で、細分類1 が 非自立・接尾・数・代名詞 でないもの。表層形で重複を除く。";

const v = (s: string | undefined) => (s === undefined || s === "*" ? "" : s);

export function analyze(tokenizer: Tokenizer<IpadicFeatures>, text: string): MorphResult {
  const t0 = performance.now();
  const raw = tokenizer.tokenize(text);
  const tokens: TokenRow[] = raw.map((t) => ({
    surface: t.surface_form,
    pos: v(t.pos),
    pos1: v(t.pos_detail_1),
    pos2: v(t.pos_detail_2),
    pos3: v(t.pos_detail_3),
    conjType: v(t.conjugated_type),
    conjForm: v(t.conjugated_form),
    base: v(t.basic_form),
    reading: v(t.reading),
    pronunciation: v(t.pronunciation),
    wordType: t.word_type,
    proper: t.pos === "名詞" && t.pos_detail_1 === "固有名詞",
  }));
  const reading = tokens.map((t) => t.reading || t.surface).join("");
  const pronunciation = tokens.map((t) => t.pronunciation || t.reading || t.surface).join("");
  const properNouns = tokens.filter((t) => t.proper).map((t) => t.surface);
  const nouns: string[] = [];
  for (const t of tokens) {
    if (t.pos === "名詞" && !NOUN_EXCLUDE.has(t.pos1) && !nouns.includes(t.surface)) nouns.push(t.surface);
  }
  return { tokens, reading, pronunciation, properNouns, nouns, nounRule: NOUN_RULE, ms: performance.now() - t0 };
}
