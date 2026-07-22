# Pier

**本地 AI 开发工作台。**

Pier 把稳定终端、可拖拽 panel 布局、文件查看、代码变更预览和多智能体状态放到同一桌面里，让 AI 编程从「单次会话」走向「项目连续性」。

[文档](docs/README.md) · [贡献](CONTRIBUTING.md) · [安全](SECURITY.md) · [变更日志](CHANGELOG.md) · [发布](https://github.com/runloom/pier/releases)

> 当前桌面端面向 **macOS**（Apple Silicon / Intel）。终端运行时依赖 Ghostty native + Swift。

## 功能概览

- **工作区布局** — dockview 驱动的 tab / split / floating panel，布局随偏好持久化
- **终端** — Ghostty native 嵌入，支持多会话、工作树与项目路径锚点
- **文件与变更** — 文件浏览 / 编辑预览，Git 变更实时可见
- **工作台** — 可组装的响应式物料网格（指标、配额、成本等）
- **多智能体可见性** — 前台活动聚合（agent / task / shell / idle），需要你处理时有明确反馈
- **官方插件** — Claude / Codex / Grok / SSH 等经签名官方索引分发的受管理插件
- **本机 CLI** — `pier open` / `status` / `panels` 等控制面命令，便于脚本与 MCP 调用

## 要求

| 项 | 版本 / 说明 |
| --- | --- |
| 操作系统 | macOS（开发与分发当前均仅支持 mac） |
| Node.js | `^24.15.0`（见 `package.json` `engines`） |
| pnpm | `>=11.12.0`（仓库锁定 `pnpm@11.12.0`） |
| Xcode CLI Tools | `xcode-select --install` |
| Homebrew + zig | `brew install zig@0.15`（编译 libghostty / native addon） |

## 快速开始

新机或首次 clone：

```bash
git clone https://github.com/runloom/pier.git
cd pier
pnpm bootstrap   # 预检依赖 → install → setup:worktree（含 native）
pnpm dev         # 启动 Electron 开发态
```

已有 git worktree（不共享 `node_modules` / native 构建产物）时，进入目录后先：

```bash
pnpm setup:worktree
pnpm dev
```

无交互 / CI：

```bash
BOOTSTRAP_YES=1 pnpm bootstrap
```

完整说明、常见失败与打包步骤见 [`docs/development.md`](docs/development.md)。

## 常用命令

```bash
pnpm dev              # Electron 开发态（含官方插件打包）
pnpm check            # typecheck + lint + depcruise + file-size + 测试
pnpm test:unit        # 单元测试
pnpm test:component   # 组件测试
pnpm test:e2e         # Playwright E2E
pnpm build            # electron-vite 构建
pnpm build:dist       # 签名 / 公证 / 双架构 mac 分发包
```

更多脚本与插件打包命令见 [`docs/development.md`](docs/development.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/README.md`](docs/README.md) | 文档索引 |
| [`docs/development.md`](docs/development.md) | 开发环境、worktree、检查与构建 |
| [`docs/cli.md`](docs/cli.md) | `pier` CLI 与本机控制通道 |
| [`docs/plugins.md`](docs/plugins.md) | 官方插件开发与校验 |
| [`docs/release.md`](docs/release.md) | 宿主 / 插件双通道发布 |
| [`docs/legal/licensing.md`](docs/legal/licensing.md) | 授权边界说明 |
| [`AGENTS.md`](AGENTS.md) | 给编码助手的项目级约束（非用户手册） |

## 插件

Pier 当前只接受：

1. **内置插件** — `src/plugins/builtin/*`，随宿主构建
2. **官方受管理外部插件** — `packages/plugin-*`（如 `pier.claude`、`pier.codex`、`pier.grok`、`pier.ssh`），经 Ed25519 签名官方索引安装

不支持第三方 marketplace、任意 registry / git / local 扫描。开发与发布流程见 [`docs/plugins.md`](docs/plugins.md)。

```bash
pnpm plugins:pack     # 打包全部官方插件
pnpm plugins:index    # 重新生成 plugins/index.v1.json
```

官方索引：`https://runloom.github.io/pier/plugins/index.v1.json`

## CLI

安装或开发态下可用 `pier` 控制运行中的桌面实例（类似 `code .`）：

```bash
pier open . --json
pier status --json
pier panels list --json
```

开发态验证：

```bash
pnpm dev
# 另一终端
pnpm --silent cli:dev -- status --json
```

完整命令、退出码约定与 MCP 定位顺序见 [`docs/cli.md`](docs/cli.md)。

## 贡献

欢迎 Issue 与 Pull Request。请先阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)：

- 平凡贡献（typo、小文档）可直接提 PR
- 非平凡贡献需完成贡献者授权流程后再合并，以免阻塞商业再授权

安全漏洞请按 [`SECURITY.md`](SECURITY.md) 私下报告，不要开公开 Issue。

## 授权

Pier 采用 **AGPLv3 + 商业授权**：

- 开源版源码按 [`AGPL-3.0-only`](LICENSE) 发布
- 闭源分发、白标、企业支持或 AGPLv3 之外的权利，需单独商业协议
- 商标与品牌资产不随 AGPLv3 授权，见 [`TRADEMARKS.md`](TRADEMARKS.md)
- 第三方依赖与字体保留各自许可证，见 [`NOTICE`](NOTICE) 与 [`docs/legal/licensing.md`](docs/legal/licensing.md)
