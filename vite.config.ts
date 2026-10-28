import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "/freeform-typing/",
  optimizeDeps: {
    // kuromoji は CommonJS。辞書ローダーを自前にするため内部モジュールを直接読む。
    include: ["kuromoji/src/Tokenizer.js", "kuromoji/src/dict/DynamicDictionaries.js"],
    exclude: ["@huggingface/transformers"],
  },
  worker: { format: "es" },
  build: {
    target: "es2022",
    commonjsOptions: { include: [/kuromoji/, /node_modules/] },
    // ゲーム（index.html）と評価のテストベンチ（bench.html）の 2 ページ
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        bench: resolve(import.meta.dirname, "bench.html"),
      },
    },
  },
});
