<h1 align="center">Pier</h1>

<p align="center">
  <strong>几个 AI 终端开着，谁在等你一眼能看见。</strong><br />
  Claude Code、Codex 还在原来的终端里。改文件、看 Git，就在旁边。
</p>

<p align="center">
  <a href="https://pier.codes">官网</a> ·
  <a href="https://github.com/runloom/pier/releases">下载</a> ·
  <a href="docs/README.md">文档</a> ·
  <a href=".pier/canvases/pier-cli-user-manual/README.md">CLI 手册</a> ·
  <a href="CONTRIBUTING.md">贡献</a> ·
  <a href="CHANGELOG.md">变更日志</a>
</p>

> 当前桌面端仅支持 **macOS**（Apple Silicon / Intel）。

## 为什么是 Pier

**还是原来的终端。** 不是又一个聊天窗口。账号和订阅不动。Claude Code、Codex、OpenCode 还在它们自己的终端里跑。

**谁在等你看得见。** 运行中、需要你处理、出错的会话集中可见。不用翻标签，点一下回到原来的终端。

**改文件和 Git，不用另开窗口。** 打开文件改代码，按文件或片段暂存、提交、推送。日常改一行、处理 Git，不必再切到另一个编辑器。

## 核心工作流

1. 在项目或 Git 工作树里打开 Claude Code、Codex 或其它命令行。
2. 几个会话同时跑时，看清谁在跑、谁在等你、谁出错。
3. 点那一条，回到原来的终端做确认或接着写。
4. 终端还在跑。打开文件改，看完 diff 再提交。

## 核心能力

- **原生终端** — 在项目或工作树中运行 Shell 和命令行编程智能体；界面重新加载后，正在运行的终端仍可继续使用
- **会话状态** — 一处查看运行中、需要你处理和出错的会话，点击即可回到对应终端
- **不同任务，分开的目录** — 给每个任务开一份独立的项目目录（Git 工作树），改文件互不影响
- **文件、编辑与 Git** — 打开并编辑项目文件；审查 diff，按文件或片段暂存；提交、推送、分支、贮藏等可在命令面板完成
- **Canvas** — 随项目保存的页面已经可用。用终端和状态拼看板、画运行图，还在做
- **可保存布局** — 用标签页、分屏和浮动面板组织终端、编辑器和变更，布局自动保存

## 其他能力

- **项目内容预览** — 预览 Markdown、图片和其他受支持的项目文件
- **本机 CLI** — 用 `pier` 打开项目，定位窗口和面板，打开终端并发送文本或按键，以及查询智能体与工作树；只连接本机正在运行的 Pier
- **插件** — 现在能用内置插件和官方签名、校验、版本管理的插件。以后会支持更多来源；现在的安装范围见 [`docs/plugins.md`](docs/plugins.md)

## 产品边界

应用本身不带任务台账或自动调度。要用看板、运行图，拿终端和状态在 Canvas 里拼，这块还在做。

不做成聊天窗口。离开之后，原来的命令行、账号和仓库照常工作。

## 安装

### 使用发布版

从 [GitHub Releases](https://github.com/runloom/pier/releases) 下载适用于 Apple Silicon 或 Intel 的当前 macOS 版本。打开 Pier 并选择项目文件夹，即可在终端中运行智能体、浏览文件并审查变更。

发布版启动后，若目录可写会尽量把 `pier` 装到 `PATH`。也可在设置 → 终端中安装，或直接运行 `/Applications/Pier.app/Contents/Resources/bin/pier`，或按 [CLI 手册](.pier/canvases/pier-cli-user-manual/README.md) 将其目录加入当前终端的 `PATH`。

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

正式安装包里的 `pier` 在应用未运行时会先启动。CLI 用于控制本机 Pier，不是远程 API。

```bash
pier status --json
pier . --json
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
