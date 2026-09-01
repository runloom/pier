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
