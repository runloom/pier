import { defineConfig } from "vite";

/**
 * SSH plugin main entry build. Produces `dist/main.js` — a self-contained
 * ESM bundle loadable by `external-main-runtime.ts` via
 * `pathToFileURL(installed/pier.ssh/<version>/dist/main.js)`.
 *
 * - Third-party deps (zod) are inlined into the bundle so no node_modules
 *   resolution is required from userData.
 * - Node builtins stay external (node:child_process, node:fs, ...) — Node ESM
 *   resolves them at runtime.
 * - `@pier/plugin-api` / `@pier/plugin-api/main` are types-only entry points
 *   and stay external.
 */
export default defineConfig({
  build: {
    // Preserve dist/renderer.js when only main is rebuilt.
    emptyOutDir: false,
    lib: {
      entry: { main: "src/main/index.ts" },
      formats: ["es"],
    },
    minify: false,
    rollupOptions: {
      external: (id) =>
        id.startsWith("node:") ||
        id === "@pier/plugin-api" ||
        id === "@pier/plugin-api/main",
      output: {
        inlineDynamicImports: true,
      },
    },
    ssr: true,
    target: "node22",
  },
  ssr: {
    noExternal: true,
  },
});
