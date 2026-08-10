# IPC 单通道化设计（方案 F）

更新时间：2026-07-03。前置：[co-location 修复](../../../src/main/app-core/permissions.ts) commit `e0ed7ec`。

## 背景与问题

Pier 的 IPC 层设计上有两条并行通路：

1. **通用通道**：`PIER.COMMAND_EXECUTE`（router → services），承载 12 域 82 条命令（`PierCommand` union）。
2. **专用通道**：34 个 `pier:xxx` 独立 `ipcMain.handle`，其中 12 条命令**在通用通道也有对应 case**——形成"双通路重复"。

两条通路是历史演进的产物（早期只有专用通道，后引入 command-router 未完成迁移）。带来三重问题：

- **手工同步**：`COMMAND_METADATA.rendererFacade` 字段必须与"是否存在专用 handler"人工对齐（2026-07-03 Plug-Task 2 事故根因）。
- **测试盲区**：router 单测和 IPC 层单测互相绕过，双通路任意一条测漏都不会被抓到。
- **概念冗余**：renderer 通过 preload 访问某条命令时，专用通道和通用通道**功能等价**（专用只是省一层 zod 解析，微秒级）——两条通路对同一命令做同一件事。

## 目标与非目标

目标：

- **消灭"双通路重复"**：12 条命令的 renderer preload API 从专用通道迁到通用通道，删除对应专用 handler。
- **删除 `rendererFacade` 概念**：`CommandMetadata` 字段、`commandAllowsRendererFacade` helper、`isRendererFacadeCommand` 检查全部移除。IPC 层只做 schema 校验 + 客户端能力校验，不再有第三道白名单。
- **保持 preload API 签名不变**：如 `preferences.read(): Promise<ProjectPreferences>` 内部从 `ipcRenderer.invoke("pier:preferences:read")` 换成 `invokePierCommand<ProjectPreferences>({type:"preferences.read"})`。renderer 调用方零改动。
- **保留 shared 常量表用于剩余专用通道**：secrets/theme/notification/menu/agent-session/agents/git-watch/terminal pty 等**没有 PierCommand 对应**的 handler 保持原样（它们不是双通路问题）。

非目标（本次明确不做）：

- **迁移没有 PierCommand 对应的专用通道**：如 `pier:secrets:*`、`pier:terminal:create` 等，它们是单通路专用 API，本身不是双通路问题。给它们额外定义 PierCommand 是**扩大 scope 而非收窄冗余**，另立独立 spec 决策。
- **收窄 `DEFAULT_CAPABILITIES_BY_CLIENT_KIND`**：删掉 rendererFacade 后，几条 rendererFacade=false 命令（app.status、panel.*、run.recent、terminal.open、terminal.profile.*、terminalStatusBar.prefs.applyOverrides）从 renderer 客户端也能通过通用通道访问。permissions 层允许即允许——这是从"配置驱动"转向"能力驱动"的合理结果，若需精细化 renderer 能力另立 spec。
- **迁移 `ipcMain.on` 单向消息**：如 `pier:terminal:apply-input-routing`。fire-and-forget 与 request/response 是不同语义，不属于双通路问题。
- **迁移 `webContents.send` 事件推送**：主→渲染的事件广播不是命令，机制正交。

## 迁移清单（12 条命令）

| 命令 | preload 现调用 | main 现 handler | 迁移后 |
|---|---|---|---|
| `preferences.read` | `pier:preferences:read` | `preferences.ts:7` | `invokePierCommand` |
| `preferences.update` | `pier:preferences:update` | `preferences.ts:11` | `invokePierCommand` |
| `window.close` | `PIER.WINDOW_CLOSE` | `window.ts:35` | `invokePierCommand` |
| `window.create` | `PIER.WINDOW_CREATE` | `window.ts:15` | `invokePierCommand` |
| `window.focus` | `PIER.WINDOW_FOCUS` | `window.ts:31` | `invokePierCommand` |
| `window.list` | `PIER.WINDOW_LIST` | `window.ts:29` | `invokePierCommand` |
| `workspace.layout.clear` | `pier:workspace:clear-layout` | `workspace.ts` | `invokePierCommand` |
| `workspace.layout.read` | `pier:workspace:load-layout` | `workspace.ts` | `invokePierCommand` |
| `workspace.layout.save` | `pier:workspace:save-layout` | `workspace.ts` | `invokePierCommand` |
| `commandPaletteMru.read` | `pier:command-palette-mru:read` | `command-palette-mru.ts:15` | `invokePierCommand` |
| `commandPaletteMru.clear` | `pier:command-palette-mru:clear` | `command-palette-mru.ts:28` | `invokePierCommand` |
| `commandPaletteMru.record` | `pier:command-palette-mru:record` (send) | main 侧 `on` 处理 | `invokePierCommand`（语义从 send → invoke，忽略返回） |

**保留不迁**（专用通道无双通路重复）：

- `PIER.WINDOW_CLOSE_CURRENT` / `PIER.WINDOW_CONTEXT`：没有对应 PierCommand
- `PIER.GIT_WATCH_START` / `PIER.GIT_WATCH_STOP`：订阅型 API，非命令
- `pier:secrets:*` × 4、`pier:theme:*`、`pier:notification:*`、`pier:menu:*`、`pier:agent-session:*`、`pier:agents:*` × 3、`pier:terminal:*` × 8（`create/setup/end-search/navigate-search/perform-operation/read-session/search/debug-snapshot` 等）、`pier:terminal-debug:open-window`

## 设计

### 迁移单条命令的模式（以 `preferences.read` 为例）

**Before**（preload 侧）：

```ts
// src/preload/index.ts
read: () => ipcRenderer.invoke("pier:preferences:read"),
```

**After**：

```ts
read: () => invokePierCommand<ProjectPreferences>({ type: "preferences.read" }),
```

**Before**（main 侧 `src/main/ipc/preferences.ts`）：

```ts
ipcMain.handle("pier:preferences:read", async () =>
  appCore.services.preferences.read()
);
```

**After**：删除。命令走 `PIER.COMMAND_EXECUTE` → command-router → `preferences.read` case → 同一 service 调用。

### 概念层清理（Task F5）

删除：
- `CommandMetadata.rendererFacade` 字段
- `commandAllowsRendererFacade` helper
- `src/main/ipc/command.ts` 里的 `isRendererFacadeCommand` 检查（`if (!isRendererFacadeCommand) throw` 整段删除，schema 解析失败仍会拒绝无效命令）
- shared 常量：`PIER.WINDOW_CLOSE/CREATE/FOCUS/LIST`（其它 PIER.* 常量保留，因为对应的 handler 未迁）

保留：
- `PIER.COMMAND_EXECUTE`（唯一入口）
- `PIER.WINDOW_CLOSE_CURRENT / CONTEXT`（无对应命令，专用通道保留）
- `PIER.GIT_WATCH_START / STOP`（订阅型）
- `CommandMetadata.capabilities` 字段与 `authorizeCommand`（能力校验保持）

### 测试影响

- **删除**：所有 `mock ipcRenderer.invoke("pier:xxx")` 的测试改为 mock `invokePierCommand`（若测试关心 IPC 层交互）；若测试关心的只是 preload API 签名，无需改动。
- **保留**：`tests/unit/main/ipc-command.test.ts` 的 IPC 白名单相关测试全部删除（rendererFacade 概念消失）；replaced by permissions.test 里的 capabilities 断言。
- **新增**：`tests/unit/main/ipc-command.test.ts` 加断言"所有 rendererFacade=false 的命令现在也能通过通用通道调用"（迁移语义正确性）。
- **未受影响**：router 单测（仍直调 router）、renderer 组件测试（preload 签名不变）。

## 安全性论证

**问：删掉 rendererFacade 是否扩大 renderer 攻击面？**

不扩大有效攻击面。理由：
- rendererFacade=false 的 12 条命令中，10 条（preferences/window/workspace.layout/commandPaletteMru）本来就通过专用通道被 renderer 调用——通用通道打开只是**换了一条同能力的路**，非新增权限。
- 剩余的 rendererFacade=false 命令（app.status、panel.*、run.recent、terminal.open、terminal.profile.*、terminalStatusBar.prefs.applyOverrides）迁移后确实**新增了 renderer 通过通用通道调用的可能性**。但这些命令的 capability 已在 `desktop-renderer` 默认表里——说明设计上就允许 renderer 拥有这些能力，只是靠 rendererFacade "配置层" 挡住。删除 rendererFacade = 让 permissions 成为唯一守门 = 从"配置驱动"转向"能力驱动"，语义更清晰。
- 若某条命令**真的**不应给 renderer，正确做法是从 `DEFAULT_CAPABILITIES_BY_CLIENT_KIND["desktop-renderer"]` 移除相应 capability，不是靠白名单挡（这在本 spec 非目标章节声明留待独立评估）。

## 分期

- **F1**：迁 `preferences.read/update`（探路，2 条）
- **F2**：迁 `window.close/create/focus/list`（同域批量，4 条）
- **F3**：迁 `workspace.layout.clear/read/save`（同域批量，3 条）
- **F4**：迁 `commandPaletteMru.read/clear/record`（含 send → invoke 语义换（3 条）
- **F5**：删 rendererFacade 概念层 + 清理 shared 常量 + 全量验证 + 阶段终审

每期独立可测：迁完一条命令后 preload API 签名不变，renderer 组件测试全绿即证明迁移正确。
