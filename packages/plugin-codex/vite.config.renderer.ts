import { defineConfig } from "vite";

/**
 * Codex plugin renderer entry build. Produces `dist/renderer.js` — a
 * browser-loadable ESM bundle served through `pier-plugin://`. React /
 * react-dom / JSX runtime specifiers are rewritten to `@pier/plugin-api`
 * shim aliases so the plugin never carries a second React copy
 * (design §7.4).
 */
export default defineConfig({
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
      external: ["@pier/plugin-api", /^@pier\/plugin-api\//],
      output: { inlineDynamicImports: true },
    },
    target: "esnext",
  },
});
