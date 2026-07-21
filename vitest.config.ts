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
    },
  },
  test: {
    allowOnly: false,
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup/jsdom-setup.ts"],
    include: ["tests/{unit,component,integration}/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
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
        "src/main/plugins/{external-main-runtime,plugin-activation-ipc,plugin-rpc-bus,plugin-rpc-ipc,plugin-secrets}.ts":
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
        branches: 67,
        functions: 75,
        lines: 76,
        statements: 76,
      },
    },
  },
});
