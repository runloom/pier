# Pier Agent Context

本文件是开发 Pier 时给 Claude Code、Codex 和 OpenCode 共用的项目级上下文。

## 01 项目定位

Pier 是本地 AI 开发工作台。参考 loomdesk 产品形态，使用 bay 的工具链栈重写。

- 核心能力：稳定终端、dockview panel 布局、代码变更预览、文件查看、多 agent 状态可见性。
- 不做：任务生命周期、SQLite 任务台账、看板、自动调度。
- 持久化分层：用户偏好/布局写 userData JSON；原始终端输出写 transcript 分段文件；代码变更实时读 Git；密钥走 safeStorage。

## 02 技术栈

- Electron 42 · React 19 · TypeScript 6 strict
- electron-vite 5 + Vite 8（main / preload / renderer 三端）
- dockview-react 6.6.1（panel 布局核心：tab + split + floating + drag）
- Tailwind CSS v4 + shadcn primitives
- Zustand 5（client state）
- Biome 2.5 + Ultracite（lint + format 单工具栈）
- pnpm 10
- Vitest 4 + Playwright（测试）

## 03 架构边界

进程边界由 dependency-cruiser 守护：

- `main/` ⊥ `renderer/`（双向禁止）
- `preload/` 只可 import `shared/` + `electron`
- `main/` 内 L1 持久化 ⊥ L2/L3/L4（单向依赖）
- **renderer 业务代码不可直接 import dockview**，必经 `components/workspace/` 边界
- renderer 不同 panel-kits 不跨域 import（走 `components/common` 或 `stores`）

## 04 项目命令

- 安装依赖：`pnpm install`
- Electron 桌面开发：`pnpm dev`（或 `pnpm electron:dev`）
- 类型检查：`pnpm typecheck`
- Lint + Format：`pnpm lint` / `pnpm lint:fix`
- 完整检查：`pnpm check`（typecheck + lint + depcruise + file-size）
- 单元测试：`pnpm test` / `pnpm test:unit`
- E2E 测试：`pnpm test:e2e`
- 构建：`pnpm build`（electron-vite build）
- 图标重建：`pnpm build:icons`（改 `build/app-icon-*.svg` 后跑一次，产出 `build/icon.{icns,ico,png}`）

### 新机首次 clone → dev 一键：`pnpm bootstrap`

`scripts/bootstrap.sh` 会依次预检 & 安装依赖，然后调 `setup:worktree`：

```bash
git clone <repo> && cd pier
pnpm bootstrap        # 预检 Xcode CLI / brew / zig@0.15 / pnpm / node → pnpm install → setup:worktree
pnpm dev              # 起 Electron dev
```

CI / 无交互场景：`BOOTSTRAP_YES=1 pnpm bootstrap` 缺依赖直接自动装。

### 已有 worktree 首次启动 checklist

git worktree **不复制** `node_modules` 也不复制 `native/build/`。第一次进 worktree 必须先：

```bash
pnpm setup:worktree   # 软链 node_modules → 主仓 + 补 GhosttyKit.xcframework + 编译 native addon
pnpm dev              # 否则 panel 内会报 "Cannot find module .../ghostty_native.node"
```

`setup:worktree` 内部：

1. 软链 `node_modules` 到主仓（避免每次 worktree 都 `pnpm install`）
2. 若 `native/Vendor/libghostty-spm/GhosttyKit.xcframework/` 缺失（首次 clone / 新电脑）自动跑 `pnpm build:libghostty`——**首次约 3-5 分钟**（含 fetch ghostty 上游、apply patches、跨 arch build），后续增量 60-90s
3. native addon（`ghostty_native.node` + `libGhosttyBridge.dylib`）过期则重编，约 30s

`pnpm build:libghostty` 依赖：
- `brew install zig@0.15`（硬要求 zig 0.15.2）
- `xcode-select --install`

产出：`native/Vendor/libghostty-spm/GhosttyKit.xcframework/` universal（arm64 + x86_64）。xcframework 二进制不入库；patches 在 `native/Vendor/libghostty-spm/Patches/ghostty/` 下按 `0100-` 起编号（Lakr233 的 `0001-0010` 由 `.libghostty-spm-src/` 里的仓提供）。

`pnpm dev` 的 `predev` 阶段也已加 native addon 存在性守卫，缺了会清楚提示去跑 `pnpm setup:worktree`，不会进 Electron 后才在 panel 内炸。

## 05 安全边界

- Git 默认只读。除非用户明确要求，不创建 commit、分支、PR 或 push。
- 需要 commit 时，先 stage 明确路径，展示 `git diff --staged` 和拟用 Conventional Commits message，等待用户确认。
- 禁止 `git add .`、`git reset`、`git rebase`、`git commit --amend` 和 force-push。
- 不要用 `@ts-ignore`、`@ts-expect-error` 或 `as any` 压制类型错误。
