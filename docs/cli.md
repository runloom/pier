# Pier CLI

Pier 控制平面提供本机 CLI，供人工命令行、脚本与 MCP server 调用运行中的桌面实例。仓库已实现 `pier` 可执行入口、参数解析、路径解析、命令信封、开发态本机控制通道与 renderer command bridge。

可执行文件：

- 开发：`pnpm --silent cli:dev -- <args…>` 或 `node ./bin/pier.mjs`
- 安装包：`Pier.app/Contents/Resources/bin/pier`

## 约定

- 默认成功时**不输出内容**，只用退出码表达成功 / 失败（类似 `code .`）
- 需要机器可读结果时加 `--json`
- 只想看解析后的命令信封时加 `--print-envelope`
- 默认客户端身份为 `cli-local`：可读状态、打开路径、聚焦窗口 / panel；默认不能关窗口、写配置或向终端注入输入

## 已实现命令

```bash
pier open <path> --json
pier status --json
pier windows list --json
pier windows focus <windowId> --json
pier panels list [--window <windowId>] --json
pier panels focus <panelId> [--window <windowId>] --json
pier preferences read --json
```

### 窗口与分屏

```bash
pier open . --window main
pier open . --split right
```

- `--window <windowId>`：把 renderer 命令发到指定窗口；未指定时优先当前聚焦窗口
- `--split`：`right`、`below` / `down`、`left`、`above` / `up`；未指定时在当前 active group 内作为 tab 打开

### 焦点

默认情况下，`open` 与 `panels focus` 会主动聚焦目标 Pier 窗口。MCP 或后台 agent 不想打断用户时：

```bash
pier open . --no-focus --json
```

## 开发态验证

先启动 Pier：

```bash
pnpm dev
```

另一终端：

```bash
pnpm --silent cli:dev -- status --json
pnpm --silent cli:dev -- windows list --json
pnpm --silent cli:dev -- windows focus main --json
pnpm --silent cli:dev -- panels list --window main --json
pnpm --silent cli:dev -- panels focus terminal-1 --window main --json
pnpm --silent cli:dev -- open . --json
pnpm --silent cli:dev -- open .
pnpm --silent cli:dev -- open . --window main --split right --json
pnpm --silent cli:dev -- open . --no-focus --json
pnpm --silent cli:dev -- preferences read --json
pnpm --silent cli:dev -- status --json --print-envelope
```

这些命令通过 dev profile 对应的 userData socket 连接运行中的 main，并返回 `PierCommandResult`。

相关单测：

```bash
pnpm vitest run tests/unit/app-core/cli-bin.test.ts
pnpm vitest run tests/unit/app-core/cli-adapter.test.ts
pnpm vitest run tests/unit/app-core/local-control.test.ts
```

## `open` 语义

`pier open <path>` 是高层「打开路径 / 工作区」命令。当前阶段会在 main 解析路径、Git 根与 worktree，形成公共 `PanelContext`，再经 renderer command bridge 打开带上下文的 terminal panel，并把解析目录作为终端初始 cwd。更多文件 panel / 插件业务由后续扩展承接。

## MCP 定位 `pier` 的顺序

1. `PIER_CLI_PATH`
2. `PATH` 中的 `pier`
3. `/Applications/Pier.app/Contents/Resources/bin/pier`
4. `$HOME/Applications/Pier.app/Contents/Resources/bin/pier`
5. fallback 到 `pier`

## 相关

- 架构与命令授权：[`AGENTS.md`](../AGENTS.md)
- 开发环境：[`development.md`](./development.md)
