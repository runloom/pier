# IPC 单通道化实现计划（方案 F）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 [F 方案 spec](../specs/2026-07-03-ipc-single-channel-design.md) 消灭双通路重复：12 条命令的 renderer preload API 迁到通用通道，删除 `rendererFacade` 概念，IPC 层只保留 schema + capabilities 两层守门。

**Architecture:** 每条命令的迁移都是同一个模式——preload 里 `ipcRenderer.invoke(<专用通道>)` → `invokePierCommand<T>({type:<命令名>})`，删除 main 侧对应的 `ipcMain.handle`。preload API 外部签名不变，renderer 组件零改动。

**Tech Stack:** 同前（Electron 三端 · zod · Vitest）。

## Global Constraints

- Preload API 外部签名不变（renderer 组件调用方零改动）。
- 每条命令的迁移**必须**：删 main 侧 `ipcMain.handle` + 改 preload 里 `ipcRenderer.invoke` + 更新受影响测试。三步不齐即算未完成。
- 禁止 `@ts-ignore` / `@ts-expect-error` / `as any`。
- 每任务收尾 `pnpm lint:fix && pnpm typecheck && pnpm vitest run tests/unit tests/component`。
- Commit 只 stage 明确路径（禁止 `git add .`），Conventional Commits，结尾 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 保留不迁的专用通道列表：`PIER.COMMAND_EXECUTE`、`PIER.WINDOW_CLOSE_CURRENT/CONTEXT`、`PIER.GIT_WATCH_START/STOP`、`pier:secrets:*`、`pier:theme:*`、`pier:notification:*`、`pier:menu:*`、`pier:agent-session:*`、`pier:agents:*`、`pier:terminal:*`（除迁走的以外）、`pier:terminal-debug:*`——这些没有 PierCommand 对应，本身不是双通路。

---

### Task 1: 迁 `preferences.read/update`（探路，2 条）

**Files:**
- Modify: `src/preload/index.ts`（preferencesApi 实现，行 244-250 附近）
- Delete: `src/main/ipc/preferences.ts` 内的两个 `ipcMain.handle`
- Modify: `src/main/ipc/index.ts` 或对应 registerPreferencesIpc 调用点（若整个 preferences.ts 空了则整文件删除并去掉 register 调用；若还有其它 handler 则只删掉这两个）
- Test: `tests/unit/main/preferences-broadcast.test.ts`（若断言 pier:preferences:* 通道则改）

**Interfaces:**
- Consumes: `invokePierCommand<T>(command: PierCommand): Promise<T>`（已存在，[preload/ipc-envelope.ts](../../../src/preload/ipc-envelope.ts)）
- Produces: 无新 API。preload API 签名 `read(): Promise<ProjectPreferences>` / `update(patch): Promise<ProjectPreferences>` 保持不变。

- [ ] **Step 1: preload 改写**

在 `src/preload/index.ts` 找到 `preferencesApi` 对象，改为：

```ts
const preferencesApi: PierPreferencesAPI = {
  onChanged: (listener) => onPierEvent("preferenceChanged", listener),
  read: () =>
    invokePierCommand<ProjectPreferences>({ type: "preferences.read" }),
  update: (patch) =>
    invokePierCommand<ProjectPreferences>({
      patch,
      type: "preferences.update",
    }),
};
```

`onChanged` 保持不动（它是事件订阅，非命令）。若 `ProjectPreferences` 已 import 保持，否则从 `@shared/contracts/preferences.ts` type-only import。

- [ ] **Step 2: 删除 main 侧 handler**

`src/main/ipc/preferences.ts`：删除文件内两个 `ipcMain.handle("pier:preferences:read", ...)` 和 `ipcMain.handle("pier:preferences:update", ...)`。若文件因此空了（只剩广播代码），保留广播；若整文件无用则删除文件+对应 register 调用。

grep 确认 handler 无残留：`grep -rn "pier:preferences:read\|pier:preferences:update" src`——预期只在 preload 侧命中一次（invokePierCommand 里没有字面量）或零命中。

- [ ] **Step 3: 验证 + Commit**

Run: `pnpm vitest run tests/unit tests/component && pnpm lint:fix && pnpm typecheck`
Expected: 全 PASS。若 `preferences-broadcast.test.ts` 或其它测试断言 `pier:preferences:read/update` 通道字面量则更新为 command type 断言。

```bash
git add src/preload/index.ts src/main/ipc/preferences.ts <可能的 src/main/ipc/index.ts>
git commit -m "refactor(ipc): route preferences.read/update through command channel"
```

---

### Task 2: 迁 `window.close/create/focus/list`（同域批量，4 条）

**Files:**
- Modify: `src/preload/index.ts`（window API 实现）
- Modify: `src/main/ipc/window.ts`（删除 4 个 handler，保留 close-current 和 context）

**Interfaces:**
- Consumes: `invokePierCommand`（同 F1）
- Produces: preload window API 4 个方法内部实现变化，签名不变。

- [ ] **Step 1: preload 改写**

`src/preload/index.ts` 找到 window API 对象，将四个方法改为：

```ts
close: (windowId) =>
  invokePierCommand<null>({ type: "window.close", windowId }),
create: () =>
  invokePierCommand<{ windowId: string }>({ type: "window.create" }),
focus: (windowId) =>
  invokePierCommand<null>({ type: "window.focus", windowId }),
list: () =>
  invokePierCommand<WindowListResult>({ type: "window.list" }),
```

（返回类型以 PierCommand schema 为准，若返回类型不确定则 fallback 到 `unknown`。`closeCurrent` 和 `getContext` 保持原 `PIER.WINDOW_CLOSE_CURRENT` / `PIER.WINDOW_CONTEXT` invoke 不动。）

- [ ] **Step 2: 删除 main 侧 handler**

`src/main/ipc/window.ts` 删除四行 handler：
- `ipcMain.handle(PIER.WINDOW_CREATE, ...)`
- `ipcMain.handle(PIER.WINDOW_LIST, ...)`
- `ipcMain.handle(PIER.WINDOW_FOCUS, ...)`
- `ipcMain.handle(PIER.WINDOW_CLOSE, ...)`

保留：`WINDOW_CLOSE_CURRENT`、`WINDOW_CONTEXT`。

- [ ] **Step 3: 验证 + Commit**

Run: `pnpm vitest run tests/unit tests/component && pnpm lint:fix && pnpm typecheck`
Expected: 全 PASS

```bash
git add src/preload/index.ts src/main/ipc/window.ts
git commit -m "refactor(ipc): route window.close/create/focus/list through command channel"
```

---

### Task 3: 迁 `workspace.layout.clear/read/save`（同域批量，3 条）

**Files:**
- Modify: `src/preload/index.ts`（workspace layout API 实现）
- Modify: `src/main/ipc/workspace.ts`（删除 3 个 handler）

**Interfaces:**
- Consumes: `invokePierCommand`
- Produces: 签名不变

- [ ] **Step 1: preload 改写**

`src/preload/index.ts` 找到 workspace layout API，改三个方法为：

```ts
clearLayout: (recordId) =>
  invokePierCommand<null>({ recordId, type: "workspace.layout.clear" }),
loadLayout: (recordId) =>
  invokePierCommand<WorkspaceLayoutReadResult>({
    recordId,
    type: "workspace.layout.read",
  }),
saveLayout: (layout, recordId) =>
  invokePierCommand<null>({
    layout,
    recordId,
    type: "workspace.layout.save",
  }),
```

参数名与 PierCommand schema 对齐（`layout`/`recordId`）。类型以 `@shared/contracts/commands.ts` workspace.layout 段 schema 为准。

- [ ] **Step 2: 删除 main 侧 handler**

`src/main/ipc/workspace.ts` 删除三条 `ipcMain.handle("pier:workspace:*")`。

- [ ] **Step 3: 验证 + Commit**

Run: `pnpm vitest run tests/unit tests/component && pnpm lint:fix && pnpm typecheck`

```bash
git add src/preload/index.ts src/main/ipc/workspace.ts
git commit -m "refactor(ipc): route workspace.layout.* through command channel"
```

---

### Task 4: 迁 `commandPaletteMru.read/clear/record`（3 条，含 send → invoke）

**Files:**
- Modify: `src/preload/index.ts`（command palette MRU API）
- Modify: `src/main/ipc/command-palette-mru.ts`

**Interfaces:**
- Consumes: `invokePierCommand`
- Produces: `record()` 签名从 `void` 改为 `Promise<null>`（若 caller 未 await 无影响）。若担心破坏兼容，保留 `void` 返回值：`record: async (actionId) => { await invokePierCommand({...}); }`。

- [ ] **Step 1: preload 改写**

改 mru API 为：

```ts
read: () =>
  invokePierCommand<CommandPaletteMruSnapshot>({
    type: "commandPaletteMru.read",
  }),
clear: () =>
  invokePierCommand<null>({ type: "commandPaletteMru.clear" }),
record: async (actionId) => {
  await invokePierCommand({ actionId, type: "commandPaletteMru.record" });
},
```

- [ ] **Step 2: 删除 main 侧 handler**

`src/main/ipc/command-palette-mru.ts`：删除两个 `ipcMain.handle` 和一个 `ipcMain.on` 对 `pier:command-palette-mru:*`。若整文件因此空则删除文件+register 调用。

- [ ] **Step 3: 验证 + Commit**

Run: `pnpm vitest run tests/unit tests/component && pnpm lint:fix && pnpm typecheck`

```bash
git add src/preload/index.ts src/main/ipc/command-palette-mru.ts <可能 src/main/ipc/index.ts>
git commit -m "refactor(ipc): route commandPaletteMru.* through command channel"
```

---

### Task 5: 删 rendererFacade 概念层 + 清理 shared 常量 + 全量验证

**Files:**
- Modify: `src/main/app-core/permissions.ts`（删 `rendererFacade` 字段、`commandAllowsRendererFacade` helper）
- Modify: `src/main/ipc/command.ts`（删 `isRendererFacadeCommand` 检查）
- Modify: `src/shared/ipc-channels.ts`（删已迁的 `PIER.WINDOW_CLOSE/CREATE/FOCUS/LIST` 常量）
- Modify: `tests/unit/app-core/permissions.test.ts`（删 rendererFacade 相关断言）
- Modify: `tests/unit/main/ipc-command.test.ts`（删/改白名单相关断言）

**Interfaces:**
- Consumes: 无
- Produces: `CommandMetadata` 简化为 `{ capabilities: readonly PierCapability[] }`。IPC 层只保留 schema 校验 + capabilities 校验。

- [ ] **Step 1: 删概念层**

`src/main/app-core/permissions.ts`：
- 将 `CommandMetadata` 接口简化为只留 `capabilities` 字段
- `COMMAND_METADATA` record 每行删除 `rendererFacade: xxx`
- 删除 `commandAllowsRendererFacade` export

```ts
export interface CommandMetadata {
  readonly capabilities: readonly PierCapability[];
}

const COMMAND_METADATA: Record<PierCommand["type"], CommandMetadata> = {
  "app.status": { capabilities: ["app:read"] },
  // ...每行只留 capabilities
};
```

`src/main/ipc/command.ts`：删除 `isRendererFacadeCommand` 函数与调用它的 `if (!isRendererFacadeCommand(command)) throw new Error("unsupported renderer command")` 检查。IPC handler 简化为直接调 router。删除 `commandAllowsRendererFacade` import。

- [ ] **Step 2: 清理 shared 常量**

`src/shared/ipc-channels.ts`：删除 `WINDOW_CLOSE/CREATE/FOCUS/LIST` 四个常量（F2 已迁）。其它常量保留（还在用）。

grep 确认无残留：`grep -rn "PIER\.WINDOW_\(CLOSE\|CREATE\|FOCUS\|LIST\)\b" src tests`——预期零命中（`CLOSE_CURRENT` 因边界不匹配不被误捕）。

- [ ] **Step 3: 更新测试**

`tests/unit/app-core/permissions.test.ts`：删除两条 `commandAllowsRendererFacade` 断言。

`tests/unit/main/ipc-command.test.ts`：
- 删除断言"允许 renderer facade 调用 xxx"的用例（rendererFacade 概念消失，所有通过 schema 的命令都能走通用通道）
- 保留"拒绝无效 command 直通"的用例（schema 校验仍生效）
- 加断言：所有原 rendererFacade=false 的命令现在也能通过通用通道调用（如 `preferences.read`、`window.close`）——防止有人误加回白名单。

- [ ] **Step 4: 全量验证**

Run: `pnpm check && pnpm vitest run tests/unit tests/component`
Expected: 全 PASS（typecheck 全部覆盖，因为 `Record<PierCommand["type"], CommandMetadata>` 编译强制每条命令都有 capabilities）

- [ ] **Step 5: 手动验收（`pnpm dev`）**

主要路径：
- 创建 worktree 面板打开成功（F 前的原始 bug）
- 应用打开、窗口切换、close 按钮工作（window.*）
- 布局保存/恢复（workspace.layout.*）
- 偏好设置读写（preferences.*）
- 命令面板打开命令、执行、MRU 记录（commandPaletteMru.*）

- [ ] **Step 6: Commit + 阶段终审派发**

```bash
git add src/main/app-core/permissions.ts src/main/ipc/command.ts src/shared/ipc-channels.ts tests/unit/app-core/permissions.test.ts tests/unit/main/ipc-command.test.ts
git commit -m "refactor(ipc): drop rendererFacade concept, single-channel terminus"
```

派发阶段 whole-branch review（模型：opus；范围：`e0ed7ec..HEAD`）。
