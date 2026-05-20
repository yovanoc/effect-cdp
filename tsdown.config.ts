import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/generated/*.ts",
    "src/helpers/*.ts",
    "src/layers/*.ts",
  ],
  outDir: "dist",
  format: "esm",
  clean: true,
  sourcemap: true,
  dts: true,
  deps: {
    neverBundle: [
      "effect",
      "effect/*",
      "@effect/platform-bun",
      "@effect/platform-node",
      "ws",
    ],
  },
});
