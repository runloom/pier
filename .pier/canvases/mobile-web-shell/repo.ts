/**
 * 会话工作树的示范 git 状态与文件树。作用域按工作树叶子名：
 * feat-mobile 有未提交变更；其余工作树干净，用来展示「没有变更」空态。
 */
import type { DemoChange, DemoFileEntry } from "./model.ts";

export interface RepoScope {
  branch: string;
  ahead: number;
  changes: DemoChange[];
  /** 目录键是相对路径，根为空串。 */
  tree: Record<string, DemoFileEntry[]>;
  text: Record<string, string>;
}

const FEAT_MOBILE_CHANGES: DemoChange[] = [
  {
    added: 18,
    hunks: [
      {
        header: "@@ -1,9 +1,12 @@",
        lines: [
          { kind: "ctx", text: 'import { useEffect } from "react";' },
          {
            kind: "add",
            text: 'import { ConnectionBanner } from "./components/connection-banner.tsx";',
          },
          { kind: "ctx", text: 'import { CurrentPage } from "./pages/current.tsx";' },
          { kind: "ctx", text: 'import { resumeActiveHost } from "./lib/session.ts";' },
          { kind: "ctx", text: "" },
          { kind: "ctx", text: "export function App() {" },
          { kind: "ctx", text: "  useEffect(() => {" },
          { kind: "del", text: "    resumeActiveHost();" },
          { kind: "add", text: "    resumeActiveHost().catch(() => undefined);" },
          { kind: "ctx", text: "  }, []);" },
          { kind: "del", text: "  return <CurrentPage />;" },
          { kind: "add", text: "  return (" },
          { kind: "add", text: "    <>" },
          { kind: "add", text: "      <ConnectionBanner />" },
          { kind: "add", text: "      <CurrentPage />" },
          { kind: "add", text: "    </>" },
          { kind: "add", text: "  );" },
          { kind: "ctx", text: "}" },
          { kind: "ctx", text: "" },
          { kind: "ctx", text: "export function boot() {" },
          { kind: "del", text: "  void hydrateHosts();" },
          { kind: "add", text: "  void hydrateHosts().catch(() => undefined);" },
          { kind: "ctx", text: "  listenResume();" },
          { kind: "add", text: "  watchRelayStatus();" },
          { kind: "ctx", text: "}" },
        ],
      },
    ],
    letter: "M",
    path: "apps/mobile-web/src/app.tsx",
    removed: 4,
  },
  {
    added: 86,
    hunks: [
      {
        header: "@@ -0,0 +1,86 @@",
        lines: [
          { kind: "add", text: "/**" },
          { kind: "add", text: " * 全局连接状态横幅：投影必须诚实——断线时明示" },
          { kind: "add", text: " * 「内容可能不是最新」，重连自愈后自动消失。" },
          { kind: "add", text: " */" },
          { kind: "add", text: 'import { useMobileWebStore } from "../lib/store.ts";' },
          { kind: "add", text: "" },
          { kind: "add", text: "export function ConnectionBanner() {" },
          { kind: "add", text: "  const connection = useMobileWebStore(" },
          { kind: "add", text: "    (state) => state.connection" },
          { kind: "add", text: "  );" },
          { kind: "add", text: '  if (connection === "connected") {' },
          { kind: "add", text: "    return null;" },
          { kind: "add", text: "  }" },
          { kind: "meta", text: "… 还有 73 行" },
        ],
      },
    ],
    letter: "A",
    path: "apps/mobile-web/src/components/connection-banner.tsx",
    removed: 0,
  },
  {
    added: 12,
    hunks: [
      {
        header: "@@ -61,7 +61,9 @@",
        lines: [
          { kind: "ctx", text: "| 过渡 | 见 §5。有返回 = 必须有反向滑出。没有底栏 |" },
          { kind: "del", text: "| 系统高亮 | 可以继续关掉 UA tap 高亮 |" },
          {
            kind: "add",
            text: "| 系统高亮 | 可以继续关掉 UA tap 高亮，但必须有自绘按下态顶上 |",
          },
          { kind: "add", text: "| 连接态 | 跟在电脑身份旁，不是正文调试行 |" },
          { kind: "meta", text: "… 还有 9 行改动" },
        ],
      },
    ],
    letter: "M",
    path: "docs/superpowers/specs/2026-09-01-mobile-web-visual-language.md",
    removed: 3,
  },
];

const FEAT_MOBILE_TREE: Record<string, DemoFileEntry[]> = {
  "": [
    { kind: "dir", name: "apps" },
    { kind: "dir", name: "docs" },
    { kind: "dir", name: "packages" },
    { kind: "dir", name: "src" },
    { kind: "dir", name: "tests" },
    { kind: "file", name: "AGENTS.md", size: "48 KB" },
    { kind: "file", name: "README.md", size: "6.2 KB" },
    { kind: "file", name: "package.json", size: "4.1 KB" },
  ],
  apps: [
    { kind: "dir", name: "mobile-web" },
    { kind: "dir", name: "relay" },
  ],
  "apps/mobile-web": [
    { kind: "dir", name: "public" },
    { kind: "dir", name: "src" },
    { kind: "file", name: "index.html", size: "612 B" },
    { kind: "file", name: "package.json", size: "688 B" },
    { kind: "file", name: "vite.config.ts", size: "1.1 KB" },
  ],
  "apps/mobile-web/src": [
    { kind: "dir", name: "components" },
    { kind: "dir", name: "lib" },
    { kind: "dir", name: "pages" },
    { kind: "file", name: "app.tsx", size: "1.4 KB" },
    { kind: "file", name: "main.tsx", size: "320 B" },
    { kind: "file", name: "styles.css", size: "2.0 KB" },
  ],
  docs: [
    { kind: "dir", name: "superpowers" },
    { kind: "file", name: "README.md", size: "3.8 KB" },
    { kind: "file", name: "release.md", size: "5.5 KB" },
  ],
};

const FEAT_MOBILE_TEXT: Record<string, string> = {
  "AGENTS.md": `# Pier Agent Context

本文件是开发 Pier 时给编码助手共用的项目级上下文（硬约束与治理规则）。

## 01 项目定位

Pier 是本地 AI 开发工作台。核心能力：稳定终端、面板布局、
代码变更预览、文件查看、多智能体状态可见性。
`,
  "README.md": `# Pier

本地 AI 开发工作台。稳定终端、面板布局、代码变更预览、
文件查看，以及多智能体状态可见性。

## 快速开始

\`\`\`bash
pnpm bootstrap
pnpm dev
\`\`\`

## 移动端

在「设置 · 远程访问」出示二维码，用手机扫一次即可配对。
之后打开手机端直接看到这台电脑。
`,
  "apps/mobile-web/index.html": `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <title>Pier</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  "apps/mobile-web/package.json": `{
  "name": "@pier/mobile-web",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch"
  }
}
`,
  "apps/mobile-web/src/app.tsx": `import { useEffect } from "react";
import { ConnectionBanner } from "./components/connection-banner.tsx";
import { CurrentPage } from "./pages/current.tsx";
import { resumeActiveHost } from "./lib/session.ts";
import { watchRelayStatus } from "./lib/relay.ts";

export function App() {
  useEffect(() => {
    resumeActiveHost().catch(() => undefined);
  }, []);
  useEffect(() => {
    return watchRelayStatus();
  }, []);
  return (
    <>
      <ConnectionBanner />
      <CurrentPage />
    </>
  );
}

export function boot() {
  void hydrateHosts().catch(() => undefined);
  listenResume();
  watchRelayStatus();
}

function listenResume() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void resumeActiveHost();
    }
  });
}
`,
  "apps/mobile-web/src/main.tsx": `import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { registerServiceWorker } from "./lib/register-sw.ts";
import "./styles.css";

registerServiceWorker();
createRoot(document.getElementById("root")!).render(<App />);
`,
  "apps/mobile-web/src/styles.css": `@import "tailwindcss";

:root {
  color-scheme: dark;
}

body {
  margin: 0;
  -webkit-tap-highlight-color: transparent;
  padding-bottom: env(safe-area-inset-bottom);
}
`,
  "apps/mobile-web/vite.config.ts": `import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
});
`,
  "docs/README.md": `# Pier 文档

- 用户手册：从设置里的「物料」进入
- 设计规格：\`superpowers/specs/\`
- 发布流程：\`release.md\`
`,
  "docs/release.md": `# 发布

宿主默认发候选版（vX.Y.Z-rc.N），观察期后晋升正式版。
会合云 / Web 壳用 relay-v* / mobile-web-v* 独立打 tag。
`,
  "package.json": `{
  "name": "pier",
  "private": true,
  "packageManager": "pnpm@11",
  "scripts": {
    "dev": "electron-vite dev",
    "check": "pnpm check:static && pnpm test:unit",
    "build:dist": "bash scripts/build-dist.sh"
  }
}
`,
};

const XYZ_TREE: Record<string, DemoFileEntry[]> = {
  "": [
    { kind: "dir", name: "src" },
    { kind: "dir", name: "tests" },
    { kind: "file", name: "README.md", size: "1.1 KB" },
    { kind: "file", name: "package.json", size: "540 B" },
  ],
  src: [{ kind: "file", name: "index.ts", size: "860 B" }],
  tests: [{ kind: "file", name: "index.test.ts", size: "410 B" }],
};

const XYZ_TEXT: Record<string, string> = {
  "README.md": `# xyz

四态前台活动聚合器的独立试验场：agent / task / shell / idle。
`,
  "package.json": `{
  "name": "xyz",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run" }
}
`,
  "src/index.ts": `export type Activity =
  | { kind: "agent"; status: "waiting" | "processing" | "ready" }
  | { kind: "task"; status: "running" | "done" }
  | { kind: "shell" }
  | { kind: "idle" };

export function isBlocking(activity: Activity): boolean {
  return activity.kind === "agent" && activity.status === "waiting";
}
`,
  "tests/index.test.ts": `import { expect, it } from "vitest";
import { isBlocking } from "../src/index.ts";

it("waiting agent blocks", () => {
  expect(isBlocking({ kind: "agent", status: "waiting" })).toBe(true);
});
`,
};

const GHOSTTY_TREE: Record<string, DemoFileEntry[]> = {
  "": [
    { kind: "dir", name: "src" },
    { kind: "dir", name: "pkg" },
    { kind: "file", name: "README.md", size: "9.4 KB" },
    { kind: "file", name: "build.zig", size: "3.2 KB" },
  ],
  src: [
    { kind: "file", name: "main.zig", size: "2.7 KB" },
    { kind: "file", name: "Surface.zig", size: "61 KB" },
  ],
  pkg: [{ kind: "file", name: "README.md", size: "380 B" }],
};

const GHOSTTY_TEXT: Record<string, string> = {
  "README.md": `# Ghostty

Fast, feature-rich, and cross-platform terminal emulator that uses
platform-native UI and GPU acceleration.
`,
  "build.zig": `const std = @import("std");

pub fn build(b: *std.Build) !void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const exe = b.addExecutable(.{ .name = "ghostty", .target = target, .optimize = optimize });
    b.installArtifact(exe);
}
`,
  "src/main.zig": `const std = @import("std");
const App = @import("App.zig");

pub fn main() !void {
    var app = try App.create(std.heap.c_allocator);
    defer app.destroy();
    try app.run();
}
`,
  "src/Surface.zig": `//! Surface represents a single terminal "surface": a terminal screen,
//! its renderer, IO thread, and input handling.
const Surface = @This();
`,
  "pkg/README.md": `Vendored third-party packages built with the Zig build system.
`,
};

const SCOPES: Record<string, RepoScope> = {
  "feat-mobile": {
    ahead: 2,
    branch: "feat/mobile-20260901",
    changes: FEAT_MOBILE_CHANGES,
    text: FEAT_MOBILE_TEXT,
    tree: FEAT_MOBILE_TREE,
  },
  ghostty: {
    ahead: 0,
    branch: "main",
    changes: [],
    text: GHOSTTY_TEXT,
    tree: GHOSTTY_TREE,
  },
  xyz: {
    ahead: 0,
    branch: "main",
    changes: [],
    text: XYZ_TEXT,
    tree: XYZ_TREE,
  },
};

const EMPTY_SCOPE: RepoScope = {
  ahead: 0,
  branch: "main",
  changes: [],
  text: {},
  tree: { "": [] },
};

export function repoScope(worktree: string): RepoScope {
  return SCOPES[worktree] ?? EMPTY_SCOPE;
}

export function worktreeIsDirty(worktree: string): boolean {
  return changesSummary(repoScope(worktree).changes).files > 0;
}

export function changesSummary(changes: readonly DemoChange[]): {
  added: number;
  files: number;
  removed: number;
} {
  return changes.reduce(
    (acc, change) => ({
      added: acc.added + change.added,
      files: acc.files + 1,
      removed: acc.removed + change.removed,
    }),
    { added: 0, files: 0, removed: 0 }
  );
}

export function fileText(scope: RepoScope, path: string): string {
  return scope.text[path] ?? `// ${path}\n`;
}

export function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export function joinPath(dir: string, name: string): string {
  return dir.length === 0 ? name : `${dir}/${name}`;
}

export function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}
