// kuromoji の辞書（node_modules/kuromoji/dict）を public/dict にコピーする。
// 辞書はリポジトリに含めず、dev / build の前に毎回コピーする。
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "kuromoji", "dict");
const dst = join(root, "public", "dict");
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src)) {
  if (f.endsWith(".dat.gz")) cpSync(join(src, f), join(dst, f));
}
// 辞書（mecab-ipadic 由来）のライセンス表示も一緒に配る
cpSync(join(root, "node_modules", "kuromoji", "NOTICE.md"), join(dst, "NOTICE.md"));
console.log("copied kuromoji dict ->", "public/dict");
