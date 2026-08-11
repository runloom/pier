import { defineConfig } from "vite";

/** Thin language packs have no UI; still ship renderer entry for managed runtime. */
export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    emptyOutDir: false,
    lib: {
      entry: "src/renderer/index.ts",
      fileName: () => "renderer.js",
      formats: ["es"],
    },
    minify: false,
    outDir: "dist",
    rollupOptions: {
      external: ["@pier/plugin-api", "@pier/plugin-api/renderer"],
      output: { inlineDynamicImports: true },
    },
    target: "esnext",
  },
});
