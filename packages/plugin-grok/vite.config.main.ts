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
 * - `@pier/plugin-api/main` is types-only — kept as external so the type
 *   contract is not duplicated into the plugin bundle.
 */
export default defineConfig({
  build: {
    lib: {
      entry: { main: "src/main/index.ts" },
      formats: ["es"],
    },
    minify: false,
    rollupOptions: {
      external: (id) =>
        id.startsWith("node:") ||
        id === "@pier/plugin-api" ||
        id.startsWith("@pier/plugin-api/"),
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
