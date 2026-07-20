import { defineConfig } from "vite";

/**
 * Claude plugin main entry build. Produces `dist/main.js` — a self-contained
 * ESM bundle loadable by `external-main-runtime.ts`.
 *
 * Mirrors the Codex/Grok plugin build: third-party deps inlined, node builtins
 * external, `@pier/plugin-api` / `@pier/plugin-api/main` types-only entries
 * external, runtime helpers under `@pier/plugin-api/*` inlined.
 */
export default defineConfig({
  build: {
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
        banner: [
          "import { fileURLToPath as __pierFURL } from 'node:url';",
          "import { dirname as __pierDir } from 'node:path';",
          "const __filename = __pierFURL(import.meta.url);",
          "const __dirname = __pierDir(__filename);",
        ].join("\n"),
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
