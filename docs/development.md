# 开发指南

本文说明如何在本机跑起 Pier、跑检查，以及构建分发包。仓库约束的完整细则见 [`AGENTS.md`](../AGENTS.md)。

## 平台

当前 **仅支持 macOS**（arm64 / x64）。终端依赖 Ghostty native（Swift / Zig / xcframework），Linux / Windows 桌面端尚未提供。

## 依赖

| 依赖 | 说明 |
| --- | --- |
| Node.js `^24.15.0` | 与 `package.json` `engines` 一致 |
| pnpm `>=11.12.0` | 仓库 `packageManager` 锁定 11.12.0 |
| Xcode Command Line Tools | `xcode-select --install` |
| Homebrew | https://brew.sh |
| zig 0.15 | `brew install zig@0.15`（编译 libghostty） |

## 首次启动

### 新 clone

```bash
git clone https://github.com/runloom/pier.git
cd pier
pnpm bootstrap
pnpm dev
```

`pnpm bootstrap`（`scripts/bootstrap.sh`）会：

1. 预检 macOS / Xcode CLI / brew / zig@0.15 / pnpm / node
2. `pnpm install`（如需）
3. `pnpm setup:worktree` — 建立本 worktree 的 `node_modules`，补齐 `GhosttyKit.xcframework`（缺失时约 3–5 分钟），编译 native addon

CI / 无交互：

```bash
BOOTSTRAP_YES=1 pnpm bootstrap
```

### 已有 git worktree

git worktree **不复制** `node_modules` 与 `native/build/`。第一次进入新 worktree：

```bash
pnpm setup:worktree
pnpm dev
```

若旧 worktree 曾把整个 `node_modules` 软链到主仓，pnpm 11 可能在进脚本前失败。一次性执行：

```bash
node scripts/setup-worktree.mjs
```

之后继续用 `pnpm setup:worktree`。

`pnpm dev` 的 `predev` 会检查 native addon；缺失时提示先跑 `setup:worktree`，避免进 Electron 后才在 panel 内报错。

## 日常命令

```bash
pnpm dev                 # 开发态（predev 会 pack 官方插件）
pnpm typecheck           # 宿主 + packages
pnpm lint / pnpm lint:fix
pnpm depcruise           # 架构边界
pnpm check:file-size
pnpm check:dir-density   # 单目录直接源码文件数（配置 .pier/dir-density.json）
pnpm check:static        # typecheck + lint + depcruise + file-size + dir-density
pnpm check               # static + unit + component + integration
pnpm test:unit
pnpm test:component
pnpm test:integration
pnpm test:coverage       # 与 CI coverage job 同形（含阈值门槛）
pnpm test:e2e
pnpm build               # electron-vite → out/
pnpm build:dist          # 双架构 dmg/zip（签名 / 公证）
pnpm build:icons         # 改 build/app-icon-*.svg 后重建 icon
```

## Quality Gate：正确性优先，CI 做确认与加速

两条硬原则：

1. **先本地保证正确，再 push**，目标 **CI 一次绿**。不要用远程 job 当调试器。
2. **CI 只跑必要的活，并尽量跑快**：path filter 去掉不会挂的重 job；coverage 文件并行 + CI 轻量报告。

### 本地 preflight（正确性）

| 档位 | 命令 | 内容 | 何时用 |
|------|------|------|--------|
| **push（默认 pre-push）** | `pnpm preflight:push` | static + unit + component + plugin-index | 每次 push，挡住绝大多数远程红 |
| merge | `pnpm preflight:merge` | + integration + build | 合 main 前更稳 |
| ci | `pnpm preflight:ci` | static + coverage（含棘轮）+ build | 对齐 Ubuntu static/coverage/build；发版前 |
| full | `pnpm preflight:full` | ci + native | mac 上再对齐 native |

```bash
# 默认 git push 已跑 preflight:push
git push

# 发版 / 怀疑覆盖率棘轮：
pnpm preflight:ci
# 或
PIER_PREFLIGHT=ci git push
```

### CI 与本机对应

| CI job | 本机 | 何时跑（远程） |
|--------|------|----------------|
| static | `check:static` | 总是 |
| coverage | `test:coverage` | 应用源码/单元测试等路径变更 |
| build | `build` | 同上 |
| native | mac native + 相关 e2e | native / 终端 / 相关 e2e 路径变更 |
| windows-lsp | （本机通常不跑） | Windows LSP 相关路径变更 |

远程加速：**path filter** 跳过无关 OS job；coverage **文件并行**；CI **轻量 reporter**；同 ref **cancel-in-progress**（新 push 取消旧 run）。

插件相关：

```bash
pnpm plugin:codex:pack   # 单插件
pnpm plugins:pack        # 全部 @pier/plugin-*
pnpm plugins:index       # 生成 plugins/index.v1.json
```

## 插件开发模式（workspace）

对齐 VS Code `extensionDevelopmentPath` 思路：

- `PIER_PLUGIN_MODE=workspace|release`（生产打包恒为 `release`；dev 默认 `workspace`）
- worktree 配置：`.pier-dev/plugin-workspace.json`（示例见 `.pier-dev/plugin-workspace.example.json`）

**workspace**：安装使用本地 `dist-pkg`；可 `devOverride` 钉本地路径；禁用官方更新覆盖本地。  
**release**：即使用 electron-vite 开发，也可模拟生产官方索引 / HTTP 安装。

自定义插件本地联调步骤见 [`plugins.md`](./plugins.md)。生产包仍禁止任意第三方加载。

## 打包分发

```bash
pnpm build:dist                 # 默认不 publish
pnpm build:dist --no-notarize   # 只签名不公证
```

流程概要：`electron-builder.env` → universal native → `build:electron` → electron-builder 双架构 mac。产物在 `dist-builder/`。

新机器签名与公证 checklist、secrets 说明见 [`app-release.md`](./app-release.md)；双通道总览见 [`release.md`](./release.md)。

## 架构要点

Pier 是本地 AI 开发工作台：稳定终端、dockview 布局、变更预览、文件查看、多智能体状态可见性。

- **进程边界**：`main` ⊥ `renderer`；`preload` 仅 `shared` + `electron`；renderer 不直连 dockview 运行时
- **插件边界**：纪律边界 ≠ 安全沙箱；当前仅内置 + 官方 managed 外部插件

UI / 弹窗 / 文案 / 颜色 / shadcn 治理以 [`AGENTS.md`](../AGENTS.md) 为准，并有对应 governance 单测锁定。

## 相关文档

- [CLI 用户手册（Canvas）](../.pier/canvases/pier-cli-user-manual/)
- [插件](./plugins.md)
- [发布](./release.md)
- [贡献](../CONTRIBUTING.md)
