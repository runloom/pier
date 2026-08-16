import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "/tmp/pier-canvas-materials-gold-vitest",
  root: import.meta.dirname,
  test: {
    environment: "node",
    include: ["*.test.ts"],
  },
});
