<h1 align="center">Pier</h1>

<p align="center">
  <strong>本地 AI 开发工作台。</strong><br />
  让 Claude Code、Codex、OpenCode 等原生 CLI 在本地项目中持续运行；<br />
  在同一个可保存的工作区查看状态、回到终端并审查 Git 变更。
</p>

<p align="center">
  <a href="https://github.com/runloom/pier/releases">下载</a> ·
  <a href="docs/README.md">文档</a> ·
  <a href=".pier/canvases/pier-cli-user-manual/README.md">CLI 手册</a> ·
  <a href="CONTRIBUTING.md">贡献</a> ·
  <a href="CHANGELOG.md">变更日志</a>
</p>

> 当前桌面端仅支持 **macOS**（Apple Silicon / Intel）。

## 为什么是 Pier

Pier 不把不同 CLI 包成另一套聊天界面。智能体仍运行在各自的原生终端里；当多个会话持续运行时，Pier 在同一个可保存的工作区补上跨会话状态，让运行中、需要你处理和出错的会话集中可见。

状态不是终点：找到需要处理的会话后，你可以立即回到原生终端继续工作，并在终端旁审查同一项目的 Git 变更。

## 核心工作流

1. 在项目或 Git 工作树中启动 Claude Code、Codex、OpenCode 等原生 CLI。
2. 在 Pier 中关注运行中、需要你处理和出错的跨会话状态。
3. 选择会话，回到它原来的终端处理输入、确认或后续工作。
4. 保留会话的同时审查工作区或暂存区的 Git 变更，并按文件或片段暂存、取消暂存。

## 核心能力

- **原生终端** — 在项目或工作树中运行 Shell 和 CLI 编程智能体；界面重新加载后，正在运行的终端仍可继续使用
- **会话状态** — 一处查看运行中、需要你处理和出错的会话，点击即可回到对应终端
- **并行隔离** — 创建和管理 Git 工作树，让不同任务在独立分支目录中推进
- **文件与变更** — 浏览项目文件，审查工作区与暂存区差异，并按文件或片段暂存、取消暂存
- **Canvas** — 将方案、流程、图表、文档或轻量原型作为随项目保存的可预览页面；它不是任务编排器
- **可保存布局** — 用标签页、分屏和浮动面板组织终端、文件与变更，布局自动保存

## 其他能力

- **项目内容预览** — 在工作区中查看代码、Markdown、图片和其他受支持的项目文件
- **本机 CLI** — 用 `pier` 打开项目，定位窗口和面板，打开终端并发送文本或按键，以及查询智能体与工作树；只连接本机正在运行的 Pier
- **官方插件** — 当前支持随应用提供的内置插件，以及经过官方签名、校验和版本管理的官方插件

## 产品边界

Pier 负责承载终端、呈现状态和组织开发现场；它不自动拆分、分发或调度任务，也不提供任务台账或看板。Canvas 是项目内容，不是任务编排器。

插件目前仅支持内置与 Pier 官方管理版本，不开放第三方插件市场。开发方式和信任边界见 [`docs/plugins.md`](docs/plugins.md)。

## 安装

### 使用发布版

从 [GitHub Releases](https://github.com/runloom/pier/releases) 下载适用于 Apple Silicon 或 Intel 的当前 macOS 版本。打开 Pier 并选择项目文件夹，即可在终端中运行智能体、浏览文件并审查变更。

发布版不会自动修改 Shell 的 `PATH`。如需使用本机 CLI，可直接运行 `/Applications/Pier.app/Contents/Resources/bin/pier`，或按 [CLI 手册](.pier/canvases/pier-cli-user-manual/README.md) 将其目录加入当前终端的 `PATH`。

### 从源码运行

需要 Node.js `^24.15.0`、pnpm `>=11.12.0`、Xcode Command Line Tools、Homebrew 与 `zig@0.15`。仓库通过 `packageManager` 锁定 pnpm `11.18.0`。

```bash
git clone https://github.com/runloom/pier.git
cd pier
pnpm bootstrap
pnpm dev
```

已有 Git 工作树第一次进入时，先运行 `pnpm setup:worktree`。依赖检查、常见问题和构建方式见 [`docs/development.md`](docs/development.md)。

## 本机 CLI

先启动 Pier，再运行 `pier`。CLI 用于控制本机已经打开的 Pier，不是远程 API。

```bash
pier status --json
pier open . --json
pier panels list --json
```

常用命令、开发态调用方式和状态语义见 [CLI 用户手册](.pier/canvases/pier-cli-user-manual/README.md)。

## 文档

- [开发指南](docs/development.md) — 环境、工作树、检查与构建
- [CLI 用户手册](.pier/canvases/pier-cli-user-manual/README.md) — 控制已运行的本机 Pier
- [官方插件](docs/plugins.md) — 范围、开发与校验
- [发布指南](docs/release.md) — 维护者发布流程
- [变更日志](CHANGELOG.md) — 已发布和待发布的变化
- [完整文档索引](docs/README.md) — 按用户、贡献者和维护者查找资料

## 贡献

欢迎提交 Issue 和 Pull Request。开始前请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)；除小型文档修正外，贡献合并前需完成贡献者授权。

提交前运行：

```bash
pnpm check
```

## 安全与授权

安全问题请按 [`SECURITY.md`](SECURITY.md) 私下报告，不要公开提交 Issue。

- 源码按 [`AGPL-3.0-only`](LICENSE) 发布
- 闭源分发、白标、企业支持或 AGPLv3 之外的权利需要单独商业协议
- 商标与第三方资产说明见 [`TRADEMARKS.md`](TRADEMARKS.md)、[`NOTICE`](NOTICE) 与 [`docs/legal/licensing.md`](docs/legal/licensing.md)
