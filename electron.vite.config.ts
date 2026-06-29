import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolveDevProfile } from "./scripts/dev-profile.mjs";

// 当前 worktree dev profile (端口/HMR/userData). 多 worktree 并存时按 worktree
// 路径派生不同端口, 避免抢用. 详 scripts/dev-profile.mjs.
const devProfile = resolveDevProfile();

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve(import.meta.dirname, "src/main/index.ts") },
    },
    resolve: {
      alias: {
        "@shared": resolve(import.meta.dirname, "src/shared"),
        "@main": resolve(import.meta.dirname, "src/main"),
        "@plugins": resolve(import.meta.dirname, "src/plugins"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // Electron sandboxed preload 必须是 CJS (sandbox 不支持 ESM dynamic import).
      // formats: ['cjs'] 让 vite 输出 out/preload/index.cjs (main/index.ts 据此 join).
      lib: {
        entry: resolve(import.meta.dirname, "src/preload/index.ts"),
        formats: ["cjs"],
      },
    },
    resolve: {
      alias: {
        "@shared": resolve(import.meta.dirname, "src/shared"),
        "@preload": resolve(import.meta.dirname, "src/preload"),
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, "src/renderer"),
    // 端口由 worktree dev profile 管理, 避免多 worktree 互相抢 5173.
    // strictPort 关键: vite 默认 +1 fallback 与 main 进程 ELECTRON_RENDERER_URL
    // 静态注入不同步 → renderer 加载 404 白屏.
    server: {
      port: devProfile.devPort,
      strictPort: true,
      host: devProfile.host,
    },
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, "src/renderer/index.html"),
      },
    },
    resolve: {
      alias: {
        "@": resolve(import.meta.dirname, "src/renderer"),
        "@shared": resolve(import.meta.dirname, "src/shared"),
        "@plugins": resolve(import.meta.dirname, "src/plugins"),
        "@pier/ui": resolve(import.meta.dirname, "packages/ui/src"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
