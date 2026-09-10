import { defineConfig } from "tsup";

// Two entries: the core (framework-free, ~2 KB) and a React component that
// wraps it. ESM + CJS + types; the browser is the only target.
export default defineConfig({
  entry: { index: "src/index.ts", react: "src/react.tsx" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  target: "es2020",
  platform: "browser",
  external: ["react"],
});
