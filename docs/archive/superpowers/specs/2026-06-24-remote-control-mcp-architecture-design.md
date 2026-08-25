# Pier 控制平面架构设计

> 日期: 2026-06-24
> 状态: 第一阶段基础已实施；CLI 本机控制通道与 renderer command bridge 已接入；MCP 与手机远程控制入口未实现
> 范围: 为后续手机远程控制和 MCP 控制提前重排 main 端架构边界

## 背景

Pier 当前是本地 Electron 应用。renderer 通过 `window.pier` 调用 preload 暴露的 API，preload 再通过 `ipcRenderer.invoke/send` 进入 main。main 里的 `src/main/ipc/*` 直接处理业务动作，并在需要时操作 `BrowserWindow`、原生菜单、用户数据文件和 Ghostty 原生终端视图。

这个形态适合本地桌面应用，但后续如果同时支持 MCP 和手机远程控制，会遇到两个问题:

1. MCP、手机端和 renderer 会各自需要一套入口，如果直接复制 `ipcMain` 逻辑，业务规则会分散。
2. 终端、窗口焦点、原生菜单和 dockview frame 同步强依赖 Electron 与 macOS 原生窗口，不能简单改成独立服务端。

因此，本次架构目标不是把 Pier 整体服务端化，而是在 Electron main 内建立稳定的控制核心。Electron IPC、MCP 和手机远程控制都作为协议适配器接入同一个核心。

## 目标

- 给 renderer、MCP 和手机端提供同一套命令入口和事件流。
- 保留 Electron main 作为桌面宿主，避免破坏原生终端、窗口焦点和菜单能力。
- 把业务能力从 `ipcMain` handler 中抽出，收敛到可测试的服务层。
- 从第一版开始引入客户端身份、权限检查和命令审计，避免远程能力上线后返工。
- 明确哪些能力可以远程暴露，哪些能力只能留在本地 UI 内部。

## 非目标

- 不把 Ghostty 原生终端迁移到独立后台进程。
- 不在第一版实现跨公网访问、云中继或账号系统。
- 不把 `terminal.setFrame`、`terminal.show/hide`、`setOverlayActive` 这类 UI 生命周期命令暴露给 MCP 或手机端。
- 不改变 renderer 现有 `window.pier` API 的外部形态；迁移应尽量保持页面代码稳定。

## 方案结论

Pier 采用本地优先的端口与适配器架构:

```text
renderer / MCP / 手机端
  -> 协议适配器
  -> 命令路由
  -> 权限检查
  -> 领域服务
  -> 平台宿主
```

Electron main 仍是本地桌面宿主。它负责创建窗口、持有原生终端、管理原生菜单，并在可选配置下启动 MCP 或手机远程控制入口。

核心原则:

> Pier 的业务能力收敛到本地控制核心。Electron IPC、MCP、手机远程控制都只是协议适配器；原生终端和窗口能力留在平台宿主层，不直接暴露给远程协议。

## 总体架构

```text
src/
  shared/
    contracts/
      commands.ts
      events.ts
      permissions.ts
      remote.ts
      terminal.ts

  main/
    app-core/
      app-core.ts
      command-router.ts
      event-bus.ts
      permissions.ts
      client-registry.ts

    services/
      preferences-service.ts
      workspace-service.ts
      window-service.ts
      panel-service.ts
      terminal-host-service.ts
      command-palette-service.ts

    adapters/
      electron-ipc/
        register-ipc.ts
        preferences-ipc.ts
        workspace-ipc.ts
        window-ipc.ts
        terminal-ipc.ts
        command-palette-ipc.ts
      cli/
        pier-cli.ts
        pier-path.ts
        local-command-client.ts
      mcp/
        mcp-server.ts
        mcp-tools.ts
        mcp-resources.ts
      remote-control/
        remote-server.ts
        websocket-server.ts
        pairing.ts
        auth.ts

    platform/
      electron-window-host.ts
      native-terminal-host.ts
      filesystem-user-data-store.ts
```

### shared/contracts

`shared/contracts` 定义跨入口共享的数据结构和校验规则。它只放纯类型、zod schema 和序列化安全的结构，不 import Electron、Node 文件系统或 renderer 代码。

建议新增:

| 文件 | 职责 |
|---|---|
| `commands.ts` | 定义可调用命令、命令参数和命令结果 |
| `events.ts` | 定义对外事件流 |
| `permissions.ts` | 定义权限 scope、客户端能力和高风险动作 |
| `remote.ts` | 定义远程会话、配对状态、客户端信息 |
| `terminal.ts` | 保留终端基础类型，并逐步区分 UI 生命周期命令和可观察状态 |

### main/app-core

`app-core` 是所有入口共用的控制核心。

| 文件 | 职责 |
|---|---|
| `app-core.ts` | 组合 services、platform hosts、event bus 和 command router |
| `command-router.ts` | 接收命令信封，校验 schema，检查权限，分发到 service |
| `event-bus.ts` | main 内统一事件流，供 IPC、MCP 和手机端订阅 |
| `permissions.ts` | 根据客户端身份和命令类型做能力检查 |
| `client-registry.ts` | 管理 renderer、MCP、本地手机端等客户端生命周期 |

### main/services

`services` 承载 Pier 的业务能力。它不关心命令来自哪个协议入口。

| 服务 | 职责 |
|---|---|
| `preferences-service.ts` | 读取、更新偏好，并发出偏好变化事件 |
| `workspace-service.ts` | 读取、保存、清理 dockview 布局 |
| `window-service.ts` | 创建、列出、聚焦、关闭窗口 |
| `panel-service.ts` | 汇总 panel 元信息，提供可远程观察的工作区状态 |
| `terminal-host-service.ts` | 管理终端高层动作和终端状态，不直接泄漏 frame/show/hide |
| `command-palette-service.ts` | 管理命令面板最近使用数据 |

### main/platform

`platform` 包装 Electron 和原生能力。它是服务层访问平台能力的唯一出口。

| 平台宿主 | 职责 |
|---|---|
| `electron-window-host.ts` | 包装 `BrowserWindow`、窗口 id、窗口焦点和关闭逻辑 |
| `native-terminal-host.ts` | 包装 Ghostty native addon、原生 handle、终端 focus/create/reconcile |
| `filesystem-user-data-store.ts` | 包装 `app.getPath("userData")` 和 JSON 原子写入 |

这样做的目的不是隐藏所有 Electron 细节，而是把 Electron 依赖限制在平台层和 IPC 适配器层，避免业务规则散落在 handler 里。

### main/adapters

适配器只负责协议转换，不写业务规则。

| 适配器 | 职责 |
|---|---|
| `electron-ipc` | 保持现有 `window.pier` API，内部改为调用命令路由或 service |
| `cli` | 提供本机命令行入口，供 MCP、脚本和调试工具调用 |
| `mcp` | 把 MCP tool/resource 映射为安全的 Pier 命令和只读资源 |
| `remote-control` | 提供手机端配对、会话认证、WebSocket 状态同步和命令调用 |

## 命令模型

所有可跨入口调用的动作都使用命令信封。

```ts
export interface PierCommandEnvelope {
  protocolVersion: 1;
  requestId: string;
  clientId: string;
  command: PierCommand;
}
```

第一版命令集合聚焦低风险能力:

```ts
export type PierCommand =
  | { type: "app.status" }
  | { type: "preferences.read" }
  | { type: "preferences.update"; patch: ProjectPreferencesPatch }
  | { type: "workspace.layout.read" }
  | { type: "workspace.layout.save"; layout: unknown }
  | { type: "workspace.layout.clear" }
  | { type: "workspace.open"; path: string }
  | { type: "window.list" }
  | { type: "window.create" }
  | { type: "window.focus"; windowId: string }
  | { type: "window.close"; windowId: string }
  | { type: "panel.list"; windowId?: string }
  | { type: "panel.focus"; panelId: string }
  | { type: "terminal.list" }
  | { type: "terminal.open" }
  | { type: "terminal.focus"; panelId: string }
  | { type: "commandPaletteMru.read" }
  | { type: "commandPaletteMru.record"; actionId: string }
  | { type: "commandPaletteMru.clear" };
```

命令结果统一包装:

```ts
export type PierCommandResult =
  | { ok: true; requestId: string; data: unknown }
  | {
      ok: false;
      requestId: string;
      error: {
        code:
          | "invalid_command"
          | "permission_denied"
          | "not_found"
          | "platform_unavailable"
          | "internal_error";
        message: string;
      };
    };
```

`command-router` 负责:

1. 校验 `protocolVersion`。
2. 校验命令 schema。
3. 从 `client-registry` 读取客户端能力。
4. 调用 `authorize(command, client)`。
5. 分发到对应 service。
6. 返回统一结果。

## 事件模型

事件流由 `event-bus` 统一发布。IPC、MCP 和手机端都只订阅 `event-bus`，不直接监听 native callback 或 Electron 事件。

```ts
export type PierEvent =
  | { type: "preferences.changed"; snapshot: PreferencesSnapshot }
  | { type: "window.changed"; windows: WindowInfo[] }
  | { type: "panel.changed"; panels: PanelSnapshot[] }
  | { type: "terminal.cwd.changed"; panelId: string; cwd: string }
  | { type: "terminal.title.changed"; panelId: string; title: string }
  | { type: "client.connected"; clientId: string; kind: PierClientKind }
  | { type: "client.disconnected"; clientId: string };
```

事件分两类:

- 内部事件: 用于 main 内服务协作，可以包含平台对象引用。
- 对外事件: 必须可序列化，允许通过 IPC、WebSocket 或 MCP 资源读取。

对外事件不得携带 `BrowserWindow`、native handle、DOM 节点或函数。

## 客户端与权限模型

所有入口都注册为客户端。

```ts
export type PierClientKind =
  | "desktop-renderer"
  | "cli-local"
  | "mcp-local"
  | "mobile-paired";

export interface PierClient {
  id: string;
  kind: PierClientKind;
  capabilities: PierCapability[];
  createdAt: number;
  lastSeenAt: number;
}
```

第一版能力集合:

```ts
export type PierCapability =
  | "app:read"
  | "preferences:read"
  | "preferences:write"
  | "workspace:read"
  | "workspace:write"
  | "workspace:open"
  | "window:read"
  | "window:control"
  | "window:create"
  | "window:focus"
  | "window:close"
  | "panel:read"
  | "panel:control"
  | "terminal:read"
  | "terminal:control";
```

默认权限:

| 客户端 | 默认能力 |
|---|---|
| `desktop-renderer` | 完整控制，本地桌面 UI 使用 |
| `cli-local` | 本机命令行读 + 聚焦类控制；默认不允许关闭窗口或写配置 |
| `mcp-local` | 读取 + 选定高层动作，默认不允许关闭窗口或写配置 |
| `mobile-paired` | 用户批准后的控制能力，按配对授权决定 |

高风险命令必须单独授权:

| 命令 | 风险 | 要求 |
|---|---|---|
| `window.close` | 可能丢失用户上下文 | `window:close` |
| `preferences.update` | 改变用户偏好 | `preferences:write` |
| `workspace.layout.clear` | 清除布局 | `workspace:write` |
| 未来终端输入命令 | 可执行任意 shell 输入 | 独立高风险能力，不在第一版开放 |

## MCP 暴露边界

MCP 适配器只暴露高层语义，不暴露 UI 生命周期细节。MCP 有两种部署方式:

1. 进程内 MCP: 随 Pier Electron main 启动，直接调用 `command-router`。
2. 外部 MCP: 作为独立 Node 进程运行，通过 Pier CLI 调用运行中的 Pier。

外部 MCP 使用 CLI 的原因是它不应直接 import Electron main，也不应直接读写 Pier 的 userData。CLI 是稳定的本机自动化边界，负责定位 Pier、连接本机命令通道、发送命令信封并返回结构化 JSON。

进程内 MCP 和后续内置手机 server 不通过 CLI。它们运行在 Electron main 内，应按自己的适配器身份注册客户端，然后直接调用 `appCore.commandRouter.execute(envelope)`。

建议第一版 MCP tools:

| MCP tool | 内部命令 |
|---|---|
| `pier_list_windows` | `window.list` |
| `pier_focus_window` | `window.focus` |
| `pier_list_panels` | `panel.list` |
| `pier_focus_panel` | `panel.focus` |
| `pier_list_terminals` | `terminal.list` |
| `pier_open_terminal` | `terminal.open` |
| `pier_read_workspace_state` | `panel.list` + `window.list` |
| `pier_open_workspace` | `workspace.open` |
| `pier_read_preferences` | `preferences.read` |

默认不开放:

- `terminal.setFrame`
- `terminal.show`
- `terminal.hide`
- `terminal.setOverlayActive`
- `theme.setNativeChrome`
- `menu.popup`
- 终端输入

这些能力要么属于 Electron UI 内部生命周期，要么风险过高。

## CLI 能力边界

Pier 应提供本机 CLI 能力。CLI 不是新的业务后端，而是命令路由的本机入口适配器。

建议命令名:

```text
pier
```

在 macOS app bundle 内建议放置:

```text
Pier.app/Contents/Resources/bin/pier
```

开发环境可通过 `pnpm pier ...` 或脚本入口调用。正式安装后，MCP server 可按以下顺序定位 CLI:

1. 环境变量覆盖，例如 `PIER_CLI_PATH`。
2. `PATH` 中的 `pier`。
3. macOS app bundle 默认路径:
   - `/Applications/Pier.app/Contents/Resources/bin/pier`
   - `$HOME/Applications/Pier.app/Contents/Resources/bin/pier`
4. fallback 到 `pier`，让运行时自行依赖 PATH。

CLI 的职责:

- 解析命令行参数。
- 生成 `PierCommandEnvelope`。
- 通过本机 IPC 连接运行中的 Pier。
- 输出结构化 JSON。
- 不直接 import renderer、Electron IPC handler 或 native addon。
- 不直接修改 `userData` 文件，除非未来明确支持离线维护命令。

第一版 CLI 命令建议:

| CLI 命令 | 内部命令 |
|---|---|
| `pier open <path> --json` | `workspace.open` |
| `pier status --json` | `app.status` |
| `pier windows list --json` | `window.list` |
| `pier windows focus <windowId> --json` | `window.focus` |
| `pier panels list [--window <windowId>] --json` | `panel.list` |
| `pier panels focus <panelId> --json` | `panel.focus` |
| `pier terminals open --json` | `terminal.open` |
| `pier preferences read --json` | `preferences.read` |

CLI 默认成功时不输出内容，只用退出码表达成功或失败，行为接近 `code .`。需要机器可读结果时使用 `--json`；需要检查命令信封时使用 `--print-envelope`。

CLI 支持目标路由参数:

| 参数 | 含义 |
|---|---|
| `--window <windowId>` | 指定 renderer command 发送到哪个 Pier 窗口 |
| `--split right` | 在当前 active panel 右侧打开 |
| `--split below` / `--split down` | 在当前 active panel 下方打开 |
| `--split left` | 在当前 active panel 左侧打开 |
| `--split above` / `--split up` | 在当前 active panel 上方打开 |

未指定 `--window` 时，main 优先选择当前聚焦窗口；没有聚焦窗口时使用第一个存活窗口。未指定 `--split` 时，renderer 在当前 active group 内作为 tab 打开。

`terminal.open` 是高层命令，不等于 main 端直接调用 native `createTerminal`。它通过 renderer command bridge 请求 dockview 创建 terminal panel，panel 挂载后再由现有 TerminalPanel 生命周期创建 Ghostty native view。

`workspace.open` 是类似 `code .` 的高层命令，保留原始路径字符串。当前阶段先通过 renderer command bridge 创建一个带路径语义的 terminal panel；后续由项目模型继续扩展为聚焦现有 Pier 窗口、创建新窗口、打开文件 panel，或设置新终端的初始工作目录。

CLI 连接运行中 Pier 的通道使用本机私有通道:

```text
macOS/Linux: Unix domain socket under userData
Windows: named pipe
```

开发态 `pnpm dev` 启动后，Pier main 会在当前 dev profile 的 userData 下监听 `pier-control.sock`。`pnpm --silent cli:dev -- ...` 会复用同一个 dev profile，向该 socket 发送 `PierCommandEnvelope` 并输出 `PierCommandResult`。打包时 `bin/pier.mjs` 会作为 `Resources/bin/pier` 进入 app bundle，供外部 MCP server 按固定路径调用。

通道必须带客户端身份和能力。CLI 默认注册为 `cli-local` 客户端，具体能力由运行中的 Pier 配置决定。外部 MCP server 调用 CLI 时，不继承 desktop renderer 的完整控制权限。

## 手机远程控制边界

手机端是远程控制面板，不是 Pier renderer 的第二份 UI。它应使用状态快照和命令调用，不直接理解 dockview 内部结构。

第一版手机端能力:

- 读取窗口列表。
- 读取 panel 列表和 active panel。
- 聚焦窗口或 panel。
- 查看终端 cwd/title 元信息。
- 触发低风险命令，例如打开设置、聚焦终端、切换窗口。

第一版手机端不做:

- 实时渲染完整终端画面。
- 发送任意终端输入。
- 操作 dockview frame。
- 远程打开原生菜单。

远程控制入口默认关闭。用户显式开启后，本机生成一次性配对码或二维码。配对成功后，手机端得到一个受限 `clientId` 和能力集合。

## 现有代码迁移策略

迁移必须保持现有 renderer 行为稳定。第一阶段不要求页面代码感知新架构。

### 第一阶段: 服务层抽取

从低风险模块开始:

- `src/main/ipc/preferences.ts`
- `src/main/ipc/workspace.ts`
- `src/main/ipc/window.ts`
- `src/main/ipc/command-palette-mru.ts`

这些 handler 当前主要是读写状态或调用 `windowManager`，适合先抽成 service。

### 第二阶段: 命令路由接入 IPC

新增 `command-router` 后，Electron IPC 可以有两种迁移方式:

1. 保持原 IPC channel 名称，handler 内部调用 service。
2. 对可共享命令改走 `command-router`，但 preload 暴露的 `window.pier` API 不变。

推荐第二种。这样 renderer 不改调用方式，MCP 和手机端也能复用命令。

### 第三阶段: 事件总线

把这些现有事件汇入 `event-bus`:

- preferences changed
- command palette mru changed
- terminal cwd changed
- terminal title changed
- terminal focus request
- window changed
- panel changed

Electron IPC 继续把事件转发给 renderer；手机端 WebSocket 订阅同一份对外事件。

### 第四阶段: 终端宿主封装

`terminal-host-service` 不应简单复制现在所有 `terminalApi` 方法。它需要分层:

| 类型 | 示例 | 是否可远程 |
|---|---|---|
| UI 生命周期 | `setFrame`、`show`、`hide`、`setOverlayActive` | 否 |
| 本地宿主动作 | `setupWindow`、`createTerminal`、`reconcile` | 仅 Electron IPC |
| 高层控制 | `focusTerminal`、`listTerminals`、读取 cwd/title | 可按权限开放 |

这样后续远程控制不会被 dockview frame 和原生视图生命周期绑死。

## 依赖方向

新增依赖方向:

```text
shared/contracts
  <- main/app-core
  <- main/services
  <- main/adapters/*

main/services
  -> main/platform
  -> main/app-core/event-bus

main/adapters/electron-ipc
  -> main/app-core
  -> electron

main/adapters/mcp
  -> main/app-core

main/adapters/remote-control
  -> main/app-core
```

禁止方向:

- `shared` 不 import `main`、`renderer` 或 `electron`。
- `services` 不 import `adapters`。
- `mcp` 和 `remote-control` 不直接 import `native-terminal-host`。
- renderer 不 import `main`，仍只通过 preload。

后续应把这些规则补进 dependency-cruiser。

## 服务端形态

终态支持三种形态，但分阶段实现:

| 形态 | 阶段 | 说明 |
|---|---|---|
| 进程内入口 | 当前推荐 | 随 Pier Electron main 启动，MCP 和手机远程控制都在 main 内作为可选入口 |
| CLI 本机入口 | MCP 前置 | 独立 MCP server 和脚本通过 CLI 调用运行中的 Pier |
| sidecar 后台进程 | 未来可选 | 需要无 UI 常驻或多 Pier 窗口共享后台能力时再引入 |
| 云中继 | 远期 | 需要跨公网手机控制时再设计 |

当前不要直接做 sidecar。Pier 现阶段的原生终端和窗口能力必须留在 Electron main 附近，过早拆进程会放大同步、授权、生命周期和崩溃恢复成本。

## 安全策略

第一版必须包含:

- 远程控制默认关闭。
- MCP 默认只允许本机访问。
- 手机端必须配对后才能连接。
- 每个客户端有 `clientId` 和能力集合。
- 每个命令都经过 `authorize`。
- 所有失败返回结构化错误，不把内部 stack 直接暴露给外部客户端。
- 高风险动作有审计记录。

建议审计事件:

```ts
export interface PierAuditEvent {
  at: number;
  clientId: string;
  commandType: string;
  result: "allowed" | "denied" | "failed";
  reason?: string;
}
```

审计记录第一版可以只写到内存 ring buffer，后续再决定是否持久化。

## 错误处理

统一错误码:

| 错误码 | 含义 |
|---|---|
| `invalid_command` | 命令 schema 校验失败 |
| `permission_denied` | 客户端没有对应能力 |
| `not_found` | 目标窗口、panel 或终端不存在 |
| `platform_unavailable` | 当前平台不支持目标能力，例如非 macOS 原生终端 |
| `internal_error` | 未预期错误，日志记录详细信息，对外只返回简短说明 |

适配器不得自行发明错误形态。它们只负责把 `PierCommandResult` 转换成对应协议的响应。

## 测试策略

第一版测试重点:

1. `command-router` 单元测试: schema 校验、权限拒绝、成功分发、错误包装。
2. `permissions` 单元测试: 不同客户端默认能力和高风险命令拒绝。
3. `preferences-service` / `workspace-service` 单元测试: 读取、写入、事件发布。
4. `electron-ipc` 适配器测试: 旧 IPC channel 仍返回原有结果。
5. `event-bus` 单元测试: 订阅、取消订阅、事件序列化。

终端 native 路径仍按现有验证链路处理。控制平面第一版不应要求重写 Ghostty 原生集成。

## 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 抽象过早变厚 | 开发变慢，代码路径绕远 | 第一版只抽低风险服务，终端只包高层控制和状态 |
| MCP 和手机端需求不同 | 命令模型被拉扯 | 用统一命令核心，但每个适配器只开放自己的白名单 |
| 远程控制安全边界不清 | 高风险动作被误暴露 | 默认关闭、配对、能力检查、审计记录 |
| 原生终端生命周期被误暴露 | 手机端或 MCP 破坏 UI 状态 | `setFrame/show/hide/overlay` 仅 Electron IPC 可用 |
| 多窗口事件路由混乱 | 事件发错窗口或客户端 | 所有事件包含 windowId/panelId；event-bus 做对外序列化 |

## 开放问题

1. 手机端第一版是否只支持同一局域网，还是需要同机浏览器验证入口。
2. MCP 第一版是随 Pier app 自动启动，还是用户在设置中显式开启。
3. 是否需要在 UI 中展示已连接客户端和最近审计记录。
4. `panel-service` 的 panel snapshot 需要覆盖哪些字段，需等代码变更预览和文件查看 panel 成型后补充。

## 推荐实施顺序

1. 新增 `shared/contracts/commands.ts`、`events.ts`、`permissions.ts`、`remote.ts`。
2. 新增 `main/app-core/event-bus.ts`、`permissions.ts`、`client-registry.ts`、`command-router.ts`。
3. 抽取 preferences、workspace、window、command-palette-mru 服务。
4. 让现有 Electron IPC handler 改为调用服务或命令路由，保持 preload API 不变。
5. 把现有 main -> renderer 事件汇入 `event-bus`。
6. 封装 `terminal-host-service`，只暴露高层终端状态和控制。
7. 增加 dependency-cruiser 规则守护新边界。
8. 增加 CLI 入口和 CLI 路径解析，支持外部 MCP server 调用。
9. 后续单独实现 MCP 适配器。
10. 再实现手机远程控制适配器。

## 结论

Pier 的最佳终态不是整体服务端化，而是本地控制核心加多协议适配器。这样可以同时满足本地桌面体验、MCP 控制和手机远程控制，又不破坏当前原生终端和窗口焦点链路。

第一阶段要做的是把业务能力从 Electron IPC handler 中抽到服务层，并建立命令路由、事件总线和权限模型。只要这个边界先立住，后续增加 MCP 或手机端就不会变成对 main 进程的一次大重写。
