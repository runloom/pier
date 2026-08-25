import { defineConfig } from "vite";

/**
 * pier.agent-splits main entry. Fake tmux is a separate config so the PATH binary
 * can run under bare Node without `@pier/plugin-api`.
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
