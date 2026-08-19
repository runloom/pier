import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolveDevProfile } from "./scripts/dev-profile.mjs";
import { createSandboxedPreloadConfig } from "./scripts/preload-build-config.ts";

// 当前 worktree dev profile (端口/HMR/userData). 多 worktree 并存时按 worktree
// 路径派生不同端口, 避免抢用. 详 scripts/dev-profile.mjs.
const devProfile = resolveDevProfile();
const nodeRequire = createRequire(import.meta.url);
const uiRequire = createRequire(
  resolve(import.meta.dirname, "packages/ui/package.json")
);
// Renderer 的 browser condition 会选中 DOM 解码器；Markdown module worker
// 没有 document，统一使用包的 default/worker-safe 入口。
const workerSafeNamedCharacterReference = nodeRequire.resolve(
  "decode-named-character-reference"
);
// mermaid 默认入口 mermaid.core.mjs 会再解析 @mermaid-js/parser → langium →
// `vscode-jsonrpc/lib/common/events.js`。该深路径不在 jsonrpc 9 的 exports 里，
// CI rolldown 解析失败。esm.min 已内联 parser，避开这层幽灵依赖。
const mermaidEsmMin = uiRequire.resolve("mermaid/dist/mermaid.esm.min.mjs");
// 强制 react / react-dom 收敛到宿主唯一物理副本。@pier/ui 源码 alias +
// packages/ui/node_modules 软链 + @pierre/diffs 预打包并存时，仅靠 dedupe
// 仍可能让 packages/ui 下的 import 与 .vite/deps 预打包图各取一份 React →
// Invalid hook call / useRef of null（打开 diff 的 PierDiffView 即踩中）。
const reactPackageRoot = dirname(nodeRequire.resolve("react/package.json"));
const reactDomPackageRoot = dirname(
  nodeRequire.resolve("react-dom/package.json")
);

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: {
          index: resolve(import.meta.dirname, "src/main/index.ts"),
          "lsp-windows-runtime": resolve(
            import.meta.dirname,
            "src/main/services/lsp/process-termination.ts"
          ),
          "lsp-windows-process-supervisor": resolve(
            import.meta.dirname,
            "src/main/lsp-windows-process-supervisor.ts"
          ),
        },
      },
    },
    resolve: {
      alias: {
        "@shared": resolve(import.meta.dirname, "src/shared"),
        "@main": resolve(import.meta.dirname, "src/main"),
        "@plugins": resolve(import.meta.dirname, "src/plugins"),
      },
    },
  },
  preload: createSandboxedPreloadConfig(import.meta.dirname),
  renderer: {
    root: resolve(import.meta.dirname, "src/renderer"),
    // 依赖优化缓存必须 worktree 本地：node_modules 是软链到主仓的
    // (setup:worktree)，默认 cacheDir=node_modules/.vite 会被所有 worktree
    // 的 dev 会话共享互踩——任一会话 re-optimize 就撕裂其它会话的模块图
    // (同一依赖图混载两代 ?v= 哈希 → React/事件系统分叉，实测表现为
    // RGL 拖拽/调整在 dev 全哑而 build 正常)。
    cacheDir: resolve(import.meta.dirname, ".vite"),
    // 端口由 worktree dev profile 管理, 避免多 worktree 互相抢 5173.
    // strictPort 关键: vite 默认 +1 fallback 与 main 进程 ELECTRON_RENDERER_URL
    // 静态注入不同步 → renderer 加载 404 白屏.
    server: {
      port: devProfile.devPort,
      strictPort: true,
      host: devProfile.host,
    },
    build: {
      // renderer.root is src/renderer; default outDir would be src/renderer/out
      // and pollute the source tree / git status. Keep artifacts under /out.
      outDir: resolve(import.meta.dirname, "out/renderer"),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(import.meta.dirname, "src/renderer/index.html"),
      },
    },
    resolve: {
      alias: [
        {
          find: "@",
          replacement: resolve(import.meta.dirname, "src/renderer"),
        },
        {
          find: "@shared",
          replacement: resolve(import.meta.dirname, "src/shared"),
        },
        {
          find: "@plugins",
          replacement: resolve(import.meta.dirname, "src/plugins"),
        },
        {
          find: "@pier/ui",
          replacement: resolve(import.meta.dirname, "packages/ui/src"),
        },
        {
          find: "decode-named-character-reference",
          replacement: workerSafeNamedCharacterReference,
        },
        { find: /^mermaid$/, replacement: mermaidEsmMin },
        // 精确匹配：勿用字符串 "react"（会误伤 react-dom / react-grid-layout）。
        { find: /^react$/, replacement: reactPackageRoot },
        {
          find: /^react\/jsx-runtime$/,
          replacement: resolve(reactPackageRoot, "jsx-runtime.js"),
        },
        {
          find: /^react\/jsx-dev-runtime$/,
          replacement: resolve(reactPackageRoot, "jsx-dev-runtime.js"),
        },
        { find: /^react-dom$/, replacement: reactDomPackageRoot },
        {
          find: /^react-dom\/client$/,
          replacement: resolve(reactDomPackageRoot, "client.js"),
        },
        // 注意: 不要给 react-grid-layout 加 alias 或 optimizeDeps.exclude 让它
        // 绕过预打包生服 —— 其依赖 fast-equals@4(browser 字段指向 UMD)、
        // react-draggable / react-resizable(CJS)在 dev 原样服务时会直接
        // SyntaxError。预打包的 CJS 入口(dist/index.js)与 build 的 ESM 入口
        // (dist/index.mjs)是同一现代 API 的孪生构建, 语义一致。
      ],
      // @pier/ui 走源码 alias + optimizeDeps 预打包并存时, dev 可能出现两份
      // react-dom(根容器与子树的 fiber key 不同源), React 委托事件在错误副本
      // 上派发 → 子树 onMouseDown 等 handler 永不触发。dedupe 强制唯一副本。
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      // 启动即预打包关键 React 入口与 diff 引擎，避免首次打开 review 时
      // "Re-optimizing dependencies" 造成新旧 chunk 混载（长驻 dev 会话 +
      // 懒加载 PierDiffView 时尤其致命 → Invalid hook call）。
      include: [
        "react",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "react-dom",
        "react-dom/client",
        "react-grid-layout",
        "@pierre/diffs",
        "@pierre/diffs/react",
      ],
      rolldownOptions: {
        transform: {
          define: {
            // react-draggable 的 log() 无条件读 process.env.DRAGGABLE_DEBUG,
            // Vite 依赖预构建默认只替换 NODE_ENV。dev renderer 走 http:// 加载,
            // Electron 不给远程内容注入 process 全局 → 每次 mousedown 在
            // handleDragStart 入口抛 ReferenceError 且被 React 吞掉, 表现为
            // dev 拖拽/调整尺寸全部失效; prod 走 file:// 有 process 全局故无恙。
            "process.env.DRAGGABLE_DEBUG": "undefined",
          },
        },
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
