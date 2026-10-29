// tools/sim/sim.ts を Node で動く 1 ファイルにまとめる（依存の node_modules は外に置いたまま）。
import { build } from "rolldown";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
await build({
  input: join(here, "sim.ts"),
  platform: "node",
  external: [/^kuromoji/, /^@huggingface\//],
  output: { file: join(here, ".out", "sim.mjs"), format: "esm" },
  logLevel: "warn",
});
