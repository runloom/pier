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

### 新 worktree 首次启动 checklist

git worktree **不复制** `node_modules` 也不复制 `native/build/`。第一次进 worktree 必须先：

```bash
pnpm setup:worktree   # 软链 node_modules → 主仓 + 自动编译 native addon (首次约 30s)
pnpm dev              # 否则 panel 内会报 "Cannot find module .../ghostty_native.node"
```

`pnpm dev` 的 `predev` 阶段也已加 native addon 存在性守卫，缺了会清楚提示去跑 `pnpm setup:worktree`，不会进 Electron 后才在 panel 内炸。

## 05 安全边界

- Git 默认只读。除非用户明确要求，不创建 commit、分支、PR 或 push。
- 需要 commit 时，先 stage 明确路径，展示 `git diff --staged` 和拟用 Conventional Commits message，等待用户确认。
- 禁止 `git add .`、`git reset`、`git rebase`、`git commit --amend` 和 force-push。
- 不要用 `@ts-ignore`、`@ts-expect-error` 或 `as any` 压制类型错误。
