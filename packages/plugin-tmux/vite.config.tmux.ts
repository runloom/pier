import { defineConfig } from "vite";

/**
 * Fake tmux PATH binary. External only `node:*` — this bundle must not
 * depend on `@pier/plugin-api`.
 */
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: { tmux: "src/tmux/cli.ts" },
      fileName: () => "tmux.js",
      formats: ["es"],
    },
    minify: false,
    rollupOptions: {
      external: (id) => id.startsWith("node:"),
      output: {
        banner: "#!/usr/bin/env node\n",
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
