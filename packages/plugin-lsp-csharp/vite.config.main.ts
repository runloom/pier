import { defineConfig } from "vite";

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
