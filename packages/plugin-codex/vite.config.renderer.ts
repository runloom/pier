import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/**
 * Codex plugin renderer entry build. Produces `dist/renderer.js` — a
 * browser-loadable ESM bundle served through `pier-plugin://`. React /
 * react-dom / JSX runtime specifiers are rewritten to `@pier/plugin-api`
 * shim aliases so the plugin never carries a second React copy
 * (design §7.4).
 */
export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  plugins: [tailwindcss()],
  resolve: {
    alias: [
      {
        find: "react/jsx-runtime",
        replacement: "@pier/plugin-api/jsx-runtime",
      },
      {
        find: "react/jsx-dev-runtime",
        replacement: "@pier/plugin-api/jsx-dev-runtime",
      },
      {
        find: "react-dom/client",
        replacement: "@pier/plugin-api/react-dom-client",
      },
      { find: "react-dom", replacement: "@pier/plugin-api/react-dom-client" },
      { find: /^react$/, replacement: "@pier/plugin-api/react" },
    ],
  },
  build: {
    emptyOutDir: false,
    lib: {
      entry: "src/renderer/index.tsx",
      fileName: () => "renderer.js",
      formats: ["es"],
    },
    minify: false,
    outDir: "dist",
    rollupOptions: {
      // `@pier/plugin-api` and `@pier/plugin-api/main` are types-only in the
      // renderer bundle, but the subpaths react / react-dom-client /
      // jsx-runtime / jsx-dev-runtime are runtime shims. They MUST be bundled
      // inline — the browser can't resolve bare `@pier/plugin-api/react`
      // specifiers via `pier-plugin://`, and the shims themselves only read
      // from `globalThis.__PIER_PLUGIN_SHARED__` (installed by the host
      // before the external renderer loads), so bundling adds no second
      // React copy.
      external: ["@pier/plugin-api", "@pier/plugin-api/renderer"],
      output: { inlineDynamicImports: true },
    },
    target: "esnext",
  },
});
