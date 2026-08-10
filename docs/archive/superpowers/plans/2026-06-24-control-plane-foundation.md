# Pier 控制平面基础实施计划

> 状态: 第一阶段基础已实施。CLI 已具备可执行入口、本机控制通道和 renderer command bridge；MCP server 与手机 WebSocket server 仍是后续任务。

**目标:** 建立 Pier 控制平面的第一阶段基础，让 Electron IPC 先接入共享命令、权限、事件和服务边界，为后续 MCP 与手机远程控制留出稳定入口。

**架构:** 保留 Electron main 作为本地宿主。新增 `shared/contracts`、`main/app-core`、`main/services` 三层；现有 preload API 不变，IPC handler 内部逐步改为调用服务或命令路由。

**技术栈:** Electron 42、TypeScript 6 strict、zod 4、Vitest 4、现有 `ipcMain` / `BrowserWindow` / userData JSON 持久化。

---

## 文件结构

- 新增 `src/shared/contracts/permissions.ts`: 客户端类型、能力集合和权限 schema。
- 新增 `src/shared/contracts/commands.ts`: 第一阶段可共享命令、命令信封和结果类型。
- 新增 `src/shared/contracts/events.ts`: 对外事件类型。
- 新增 `src/shared/contracts/remote.ts`: 远程客户端与配对基础类型。
- 新增 `src/main/app-core/event-bus.ts`: main 内事件发布订阅。
- 新增 `src/main/app-core/client-registry.ts`: 客户端注册、读取和心跳。
- 新增 `src/main/app-core/permissions.ts`: 命令授权逻辑。
- 新增 `src/main/app-core/command-router.ts`: 命令校验、授权、分发和错误包装。
- 新增 `src/main/app-core/app-core.ts`: 组合服务并导出单例。
- 新增 `src/main/adapters/cli/*`: CLI 参数解析、路径解析和本机命令客户端骨架，供外部 MCP server 调用。
- 新增 `src/main/services/preferences-service.ts`: 偏好服务。
- 新增 `src/main/services/workspace-service.ts`: 布局服务。
- 新增 `src/main/services/window-service.ts`: 窗口服务。
- 新增 `src/main/services/renderer-command-service.ts`: main 到 renderer 的命令请求/响应桥。
- 新增 `src/main/services/command-palette-service.ts`: 命令面板 MRU 服务。
- 修改 `src/main/ipc/preferences.ts`: 通过 app core 服务处理，保留原 channel。
- 修改 `src/main/ipc/workspace.ts`: 通过 app core 服务处理。
- 修改 `src/main/ipc/window.ts`: 通过 app core 服务处理。
- 修改 `src/main/ipc/command-palette-mru.ts`: 通过 app core 服务处理。
- 新增测试:
  - `tests/unit/app-core/permissions.test.ts`
  - `tests/unit/app-core/event-bus.test.ts`
  - `tests/unit/app-core/command-router.test.ts`
  - `tests/unit/app-core/services.test.ts`
  - `tests/unit/app-core/cli-adapter.test.ts`
  - `tests/unit/app-core/cli-bin.test.ts`
  - `tests/unit/app-core/local-control.test.ts`
  - `tests/unit/app-core/renderer-command-service.test.ts`

## 任务 1: 共享契约和权限核心

- [x] 先写 `permissions` 测试，验证 renderer、MCP、手机端默认能力。
- [x] 运行测试，确认因模块不存在失败。
- [x] 新增 `permissions.ts`、`commands.ts`、`events.ts`、`remote.ts`。
- [x] 新增 `main/app-core/permissions.ts`。
- [x] 运行权限测试，确认通过。
- [x] 补充 `cli-local` 权限测试，确认 CLI 默认能聚焦窗口但不能关闭窗口。

## 任务 2: 事件总线

- [x] 先写事件总线测试，验证订阅、取消订阅和多 listener 顺序。
- [x] 运行测试，确认因模块不存在失败。
- [x] 新增 `main/app-core/event-bus.ts`。
- [x] 运行事件总线测试，确认通过。

## 任务 3: 客户端注册和命令路由

- [x] 先写命令路由测试，覆盖权限拒绝、未知命令、成功分发。
- [x] 运行测试，确认因模块不存在失败。
- [x] 新增 `client-registry.ts`、`command-router.ts`。
- [x] 运行命令路由测试，确认通过。

## 任务 4: 服务层抽取

- [x] 新增 preferences、workspace、window、command-palette 服务。
- [x] 新增 `app-core.ts` 组合服务、事件总线、客户端注册和命令路由。
- [x] 保持原 state 模块不搬迁，只由服务层调用，降低迁移风险。

## 任务 5: IPC 接入新边界

- [x] `preferences` IPC 调用 `appCore.services.preferences`。
- [x] `workspace` IPC 调用 `appCore.services.workspace`。
- [x] `window` IPC 调用 `appCore.services.window`。
- [x] `command-palette-mru` IPC 调用 `appCore.services.commandPaletteMru`。
- [x] 保持所有 channel 名称和 preload API 不变。

## 任务 6: 验证

- [x] 运行新增单元测试。
- [x] 运行相关旧单元测试: preferences schema、command palette MRU、window id allocator。
- [x] 运行 `pnpm typecheck`。
- [x] 运行 `pnpm check`；如果现有 lint 规则暴露格式问题，只修本次触达文件。

## 后续任务: CLI 入口

- [x] 新增 CLI 路径解析，顺序为 `PIER_CLI_PATH`、PATH、macOS app bundle 默认路径、fallback 到 `pier`。
- [x] 新增本机命令客户端骨架，负责把 CLI 参数转换为命令信封并交给注入的传输层。
- [x] 新增 `pier open <path> --json`、`pier status --json`、`pier windows list --json`、`pier panels list --json`、`pier terminals open --json`、`pier preferences read --json` 等基础命令解析。
- [x] 新增连接运行中 Pier 的本机控制通道。
- [x] 新增 `bin/pier.mjs` 可执行入口，并在打包资源中输出到 `Resources/bin/pier`。
- [x] 新增 renderer command bridge，让 `pier terminals open --json` 和 `pier open <path> --json` 能创建 dockview terminal panel。
- [ ] MCP 外部进程优先调用 CLI，不直接 import Electron main。
- [ ] 内置 server 直接调用 `appCore.commandRouter.execute(envelope)`，不绕 CLI。

## 暂不实施

- 不实现 MCP server。
- 不实现手机 WebSocket server。
- 不改 terminal native addon、GhosttyBridge 或 frame 同步。
- 不实现文件 panel、项目模型或 terminal 初始 cwd 注入。
- 不创建 commit。
