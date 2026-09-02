import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src/renderer"),
      "@shared": resolve(import.meta.dirname, "src/shared"),
      "@main": resolve(import.meta.dirname, "src/main"),
      "@preload": resolve(import.meta.dirname, "src/preload"),
      "@plugins": resolve(import.meta.dirname, "src/plugins"),
      "@pier/ui": resolve(import.meta.dirname, "packages/ui/src"),
      // 画布源码里的 `pier/canvas` 在应用里是编译期桩；
      // 组件测试指向真实实现，这样 .pier 下的画布可以直接 import 并渲染。
      "pier/canvas": resolve(
        import.meta.dirname,
        "tests/support/pier-canvas.ts"
      ),
      "pier/host": resolve(import.meta.dirname, "tests/support/pier-host.ts"),
      "@pier-applet/pier.tasks/tracker-board": resolve(
        import.meta.dirname,
        "packages/plugin-tasks/applets/tracker-board/index.applet.tsx"
      ),
      "@pier-applet/pier.tasks/task-list": resolve(
        import.meta.dirname,
        "packages/plugin-tasks/applets/task-list/index.applet.tsx"
      ),
      "@pier-applet/pier.tasks/task-dag": resolve(
        import.meta.dirname,
        "packages/plugin-tasks/applets/task-dag/index.applet.tsx"
      ),
    },
  },
  test: {
    allowOnly: false,
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup/jsdom-setup.ts"],
    include: ["tests/{unit,component,integration}/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    // Parallel test files = main coverage wall-clock win. Isolation for flaky
    // suites is per-file / `test:integration --no-file-parallelism`, not global serial.
    fileParallelism: true,
    pool: "forks",
    coverage: {
      provider: "v8",
      // CI: less report IO. Local: html/json for browsing.
      reporter: process.env.CI
        ? (["text-summary", "json-summary"] as const)
        : (["text", "html", "json"] as const),
      include: [
        "src/**/*.{ts,tsx}",
        "packages/{plugin-api,plugin-claude,plugin-codex,plugin-grok,ui}/src/**/*.{ts,tsx}",
      ],
      exclude: ["**/*.{test,spec}.{ts,tsx}", "**/*.d.ts", "src/**/index.html"],
      thresholds: {
        "packages/plugin-claude/src/main/{accounts-service,claude-provider,state}.ts":
          {
            branches: 20,
            functions: 30,
            lines: 25,
            statements: 25,
          },
        "packages/plugin-codex/src/main/{accounts-service,codex-provider,state}.ts":
          {
            branches: 20,
            functions: 30,
            lines: 25,
            statements: 25,
          },
        "packages/plugin-grok/src/main/{accounts-service,grok-provider,state}.ts":
          {
            branches: 20,
            functions: 30,
            lines: 25,
            statements: 25,
          },
        "src/main/plugins/{external-main-runtime,activation-ipc,rpc-bus,rpc-ipc,secrets}.ts":
          {
            branches: 50,
            functions: 60,
            lines: 70,
            statements: 70,
          },
        "src/main/services/managed-plugins/{data-schema-compatibility,index-state,install-runtime,package-content-hash}.ts":
          {
            branches: 50,
            functions: 60,
            lines: 65,
            statements: 65,
          },
        // Develop batch (git review ledger/hunk stage, content search, workbench
        // dialogs) lands large surfaces slightly under prior floors; keep ratchet.
        branches: 64,
        functions: 73,
        lines: 74,
        statements: 73,
      },
    },
  },
});
