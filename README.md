# Pier

**本地 AI 开发工作台。**

Pier 提供 dockview panel 布局、终端、代码变更预览、文件查看和多 agent 状态可见性，让 AI 编程从会话走向项目连续性。

## 技术栈

- Electron 43 · React 19 · TypeScript · pnpm
- dockview-react 6.6.1（panel 布局核心）
- Tailwind CSS v4 + shadcn primitives
- Biome 2.5 + Ultracite（lint + format）
- Vitest + Playwright（测试）

## 开发命令

```bash
pnpm install          # 安装依赖
pnpm dev              # 启动 Electron 桌面应用
pnpm check            # typecheck + lint + depcruise + file-size
pnpm test             # vitest
pnpm build            # electron-vite build
```

## 插件开发

官方插件位于 `packages/plugin-*/`，通过受管理的签名官方索引发布。完整流程见 [`docs/plugins.md`](docs/plugins.md)：

```bash
pnpm plugin:codex:pack       # 打包 Codex 官方插件，生成 tgz 与 sha256
pnpm plugins:pack            # 打包所有官方插件
pnpm plugins:index           # 重新生成 plugins/index.v1.json
```

发布通过 GitHub Actions 完成：

- 单个 `packages/plugin-*/package.json` 版本变更合入 `main` 后，工作流构建并发布 `plugin-<id>-v<version>` GitHub Release，再更新签名官方索引。
- 索引托管在 `https://runloom.github.io/pier/plugins/index.v1.json`。
- 当前只支持仓内官方插件和官方受管理外部插件，不支持第三方插件、任意 local / git / registry 来源、自建索引或 marketplace。

## CLI 命令

Pier 控制平面已经定义 CLI 命令形态，用于后续 MCP server、脚本和本机自动化调用。当前仓库已实现 `pier` 可执行入口、CLI 参数解析、路径解析、命令信封生成、开发态本机控制通道和 renderer command bridge。

已定义的第一批命令:

```bash
pier open <path> --json
pier status --json
pier windows list --json
pier windows focus <windowId> --json
pier panels list [--window <windowId>] --json
pier panels focus <panelId> [--window <windowId>] --json
pier preferences read --json
```

和 `code .` 一样，CLI 默认成功时不输出内容，只用退出码表达成功或失败。需要机器可读结果时加 `--json`；需要只看命令信封时加 `--print-envelope`。

窗口和分屏路由:

```bash
pier open . --window main
pier open . --split right
```

`--window <windowId>` 会把 renderer 命令发到指定窗口；未指定时优先使用当前聚焦窗口。`--split` 支持 `right`、`below` / `down`、`left`、`above` / `up`；未指定时在当前 active group 内作为 tab 打开。

默认情况下，`open` 和 `panels focus` 会主动聚焦目标 Pier 窗口，适合人工命令行调用。MCP server 或后台 agent 不希望打断当前用户时，加 `--no-focus`:

```bash
pier open . --no-focus --json
```

开发态验证真实 CLI 通道时，先启动 Pier:

```bash
pnpm dev
```

然后在另一个终端运行:

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
pnpm vitest run tests/unit/app-core/cli-bin.test.ts
pnpm vitest run tests/unit/app-core/cli-adapter.test.ts
pnpm vitest run tests/unit/app-core/local-control.test.ts
```

这些命令会通过 dev profile 对应的 userData socket 连接运行中的 Pier main 进程，并返回 `PierCommandResult`。只想查看 CLI 解析后的命令信封时，可以加 `--print-envelope`:

```bash
pnpm --silent cli:dev -- status --json --print-envelope
```

CLI 默认以 `cli-local` 客户端身份调用控制平面: 可以读取状态、打开路径、聚焦窗口和 panel；默认不能关闭窗口、写配置或发送终端输入。

说明: `pier open <path> --json` 是类似 `code .` 的高层命令，语义是“打开路径/工作区”。当前阶段会在 main 进程解析路径、Git 根目录和 worktree 信息，形成公共 `PanelContext`，再通过 renderer command bridge 打开一个带上下文的 terminal panel，并把解析后的目录作为终端初始 cwd。真正的文件 panel 和插件业务留给后续扩展。

MCP 外部进程定位 `pier` CLI 的顺序:

1. `PIER_CLI_PATH`
2. `PATH` 中的 `pier`
3. `/Applications/Pier.app/Contents/Resources/bin/pier`
4. `$HOME/Applications/Pier.app/Contents/Resources/bin/pier`
5. fallback 到 `pier`

完整规则见 [`AGENTS.md`](AGENTS.md)。
