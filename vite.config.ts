import { defineConfig } from "vite";

export default defineConfig({
  base: "/freeform-typing/",
  optimizeDeps: {
    // kuromoji は CommonJS。辞書ローダーを自前にするため内部モジュールを直接読む。
    include: ["kuromoji/src/Tokenizer.js", "kuromoji/src/dict/DynamicDictionaries.js"],
    exclude: ["@huggingface/transformers"],
  },
  build: {
    target: "es2022",
    commonjsOptions: { include: [/kuromoji/, /node_modules/] },
  },
});
