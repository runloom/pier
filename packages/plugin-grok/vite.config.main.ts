import { defineConfig } from "vite";

/**
 * Grok plugin main entry build. Produces `dist/main.js` — a self-contained
 * ESM bundle loadable by `external-main-runtime.ts` via
 * `pathToFileURL(installed/pier.grok/<version>/dist/main.js)`.
 *
 * - All third-party deps (write-file-atomic, etc.) are inlined into the
 *   bundle so no node_modules resolution is required from userData.
 * - Node builtins stay external (node:crypto, node:fs, ...) — Node ESM
 *   resolves them at runtime.
 * - `@pier/plugin-api` / `@pier/plugin-api/main` are types-only entry points
 *   and stay external. Runtime helpers under `@pier/plugin-api/*` (e.g.
 *   `account-usage`, `peer-sync/main`) must be **inlined** — installed packages have no
 *   node_modules, and package validation rejects unresolved main imports.
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
        // ESM bundle needs CJS globals shimmed for inlined libs (write-file-atomic
        // uses `__filename` inside getTmpname). Emit a banner that computes both
        // from `import.meta.url`.
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
