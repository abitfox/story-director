import { defineConfig } from "tsup";

/**
 * Root entry = pure director logic (zero deps). The yaml entry pulls in the
 * optional js-yaml peer — separate so core consumers never load it.
 */
export default defineConfig([
  {
    entry: { index: "src/core/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2020",
    clean: true,
  },
  {
    entry: { yaml: "src/yaml/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2020",
  },
]);
