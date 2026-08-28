import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 独立 SPA：产物落 out/mobile-web/，不进 electron renderer bundle；
// 帧契约经 @shared 别名直连 src/shared（单一来源，运行时同源）。
export default defineConfig({
  base: "./",
  build: {
    emptyOutDir: true,
    outDir: "../../out/mobile-web",
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "../../src/shared"),
    },
  },
});
