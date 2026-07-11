import { resolve } from "node:path";

/**
 * Electron 沙箱 preload 必须是自包含的单文件 CommonJS。
 *
 * 沙箱只允许加载 Electron 和少量受限的 Node 内建模块，不能从 node_modules
 * 加载外部依赖。preload 会在 IPC 边界使用 zod 校验返回值，因此第三方依赖
 * 必须被打入产物；否则 contextBridge 注入会在 renderer 启动前失败并导致白屏。
 */
export function createSandboxedPreloadConfig(projectRoot: string) {
  return {
    build: {
      externalizeDeps: false,
      lib: {
        entry: resolve(projectRoot, "src/preload/index.ts"),
        formats: ["cjs"] as ["cjs"],
      },
    },
    resolve: {
      alias: {
        "@preload": resolve(projectRoot, "src/preload"),
        "@shared": resolve(projectRoot, "src/shared"),
      },
    },
  };
}
