declare module "kuromoji/src/Tokenizer.js" {
  import type { IpadicFeatures, Tokenizer } from "kuromoji";
  const TokenizerCtor: new (dic: unknown) => Tokenizer<IpadicFeatures>;
  export default TokenizerCtor;
}
declare module "kuromoji/src/dict/DynamicDictionaries.js" {
  const DynamicDictionaries: new () => {
    loadTrie(base: Int32Array, check: Int32Array): unknown;
    loadTokenInfoDictionaries(a: Uint8Array, b: Uint8Array, c: Uint8Array): unknown;
    loadConnectionCosts(cc: Int16Array): unknown;
    loadUnknownDictionaries(
      unk: Uint8Array, unkPos: Uint8Array, unkMap: Uint8Array,
      cat: Uint8Array, compat: Uint32Array, invoke: Uint8Array,
    ): unknown;
  };
  export default DynamicDictionaries;
}
