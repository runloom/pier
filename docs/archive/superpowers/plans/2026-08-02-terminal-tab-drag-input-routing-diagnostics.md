# 终端 Tab 拖拽输入路由与诊断实施计划

> 执行约束：按任务逐项实施，使用复选框追踪；全过程不提交代码。

**Goal:** 让 Dockview tab 拖拽不会遗留终端 Web 输入 owner，并把拖拽与快捷键的决策链路写入终端调试快照和既有诊断日志。

**架构：** `components/workspace/` 持有每个窗口的 tab 拖拽输入会话，以 Dockview `onWillDragPanel` 开始；同一实例移动由 `onWillDrop` 结束，外来 payload 由 `onDidDrop` 补充，源窗口捕获阶段 `dragend` 覆盖取消与跨窗口终态。输入路由 store 只提供 owner/overlay 机制；renderer 以有界 trace 收集事件，main 通过经过 schema 校验的窄 IPC 将事件写入已有诊断 JSONL。

**Tech Stack:** Electron、React、TypeScript、dockview-react、Zustand、Zod、Vitest、Playwright/Electron。

## 全局约束

- 设计依据：`docs/archive/superpowers/specs/2026-08-02-terminal-tab-drag-input-routing-diagnostics-design.md`。
- 直接在当前工作目录修改；**全过程不得执行 `git commit`、`git push` 或创建 PR**。
- renderer 业务代码不得直接使用 Dockview 运行时 API；Dockview 生命周期逻辑只允许放在 `src/renderer/components/workspace/`。
- 输入 owner 只能由其生命周期所有者释放；不得在终端聚焦时清空所有 Web owner。
- 跨窗口拖拽的终态只以源窗口的 `dragend` 为权威；`window.blur` 不得作为完成信号。
- 诊断不得记录终端内容、粘贴内容、原始键字符、路径或任意用户输入；main 必须验证 renderer 负载并自行补充窗口身份。
- 单测：`pnpm exec vitest run <file>`；完整类型检查：`pnpm typecheck`；项目检查：`pnpm check`。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/shared/contracts/terminal/input-routing-diagnostics.ts` | 输入路由诊断事件的 Zod schema 与共享类型 |
| `src/shared/contracts/terminal/debug.ts` | 调试快照内的 trace 类型 |
| `src/renderer/lib/terminal-debug/input-routing-trace.ts` | 有界事件 ring、上报与快照读取 |
| `src/renderer/components/workspace/terminal-tab-drag-input-capture.ts` | Dockview tab 拖拽会话状态机与 disposer |
| `src/renderer/components/workspace/host.tsx` | 安装 tab 会话控制器 |
| `src/renderer/stores/terminal-input-routing-drag.ts` | 仅保留 sash 的全局 pointer 生命周期 |
| `src/renderer/main.tsx` | 改为安装 sash watcher，而非 tab 全局 watcher |
| `src/renderer/lib/keybindings/use-registry.ts` | 已解析快捷键的分派 trace |
| `src/shared/ipc-channels.ts`、`src/preload/terminal-api.ts`、preload 类型 | 窄诊断 IPC 的 channel 与 facade |
| `src/main/ipc/terminal/input-routing-diagnostics.ts` | sender/schema 校验、结构化日志写入 |
| `src/main/ipc/terminal/diagnostics-ipc.ts` | 聚合注册终端调试快照与输入路由诊断 IPC |
| `src/renderer/lib/terminal-debug/renderer-snapshot.ts` | 合并 renderer trace 到 `TerminalDebugSnapshot` |
| `src/renderer/components/common/terminal-debug/*` | 展示和复制拖拽/快捷键轨迹 |

## Task 1：共享诊断事件与 renderer 有界轨迹

**Files:**
- Create: `src/shared/contracts/terminal/input-routing-diagnostics.ts`
- Create: `src/renderer/lib/terminal-debug/input-routing-trace.ts`
- Modify: `src/shared/contracts/terminal/debug.ts`
- Modify: `src/renderer/lib/terminal-debug/renderer-snapshot.ts`
- Test: `tests/unit/renderer/terminal/input-routing-trace.test.ts`
- Test: `tests/unit/renderer/terminal/debug-renderer-snapshot.test.ts`

**Consumes:** 现有 `window.pier.terminal` facade（上报方法在 Task 4 接入；本任务在方法缺失时仅保留内存 trace）。

**Produces:**

```ts
export type TerminalInputRoutingDiagnosticInput = /* schema infer */;
export function recordTerminalInputRoutingTrace(
  input: TerminalInputRoutingDiagnosticInput
): void;
export function readTerminalInputRoutingTraceSnapshot(): TerminalInputRoutingTraceSnapshot;
export function resetTerminalInputRoutingTraceForTests(): void;
```

- [x] **Step 1: 写失败测试**

在 `tests/unit/renderer/terminal/input-routing-trace.test.ts` 写两个行为测试：第一条断言连续 tab 拖拽事件带递增 `seq`、固定上限会逐出最早项；第二条断言快捷键事件只接受白名单字段，输入对象没有 `key`、`text`、`chars` 等原始输入字段。

```ts
it("keeps a bounded ordered trace without raw keyboard data", () => {
  recordTerminalInputRoutingTrace({
    action: "started",
    panelId: "terminal-1",
    sessionId: "tab-drag-1",
    source: "workspace-tab-drag",
  });
  recordTerminalInputRoutingTrace({
    action: "dispatched",
    commandId: "pier.commandPalette.open",
    route: "web-keydown",
    source: "keybinding",
  });

  expect(readTerminalInputRoutingTraceSnapshot().events).toEqual([
    expect.objectContaining({ seq: 1, source: "workspace-tab-drag" }),
    expect.objectContaining({ commandId: "pier.commandPalette.open", seq: 2 }),
  ]);
});
```

- [x] **Step 2: 运行确认失败**

运行：`pnpm exec vitest run tests/unit/renderer/terminal/input-routing-trace.test.ts`

预期：失败，因 `input-routing-trace.ts` 和其导出尚不存在。

- [x] **Step 3: 实现共享 schema 与 trace ring**

在共享契约中用严格 Zod union 定义两个来源，所有字段都带最大长度与枚举限制：

```ts
export const terminalInputRoutingDiagnosticSchema = z.discriminatedUnion(
  "source",
  [
    z.object({
      source: z.literal("workspace-tab-drag"),
      action: z.enum(["started", "ended", "fallback-timeout", "disposed"]),
      sessionId: z.string().min(1).max(96),
      panelId: z.string().min(1).max(128).optional(),
      reason: z.enum(["dockview-will-drop", "dockview-did-drop", "window-dragend", "escape", "fallback-timeout", "dispose"]).optional(),
      elapsedMs: z.number().int().nonnegative().max(60_000).optional(),
      webOwnerCount: z.number().int().nonnegative().max(64).optional(),
    }).strict(),
    z.object({
      source: z.literal("keybinding"),
      action: z.enum(["dispatched", "text-input-suppressed", "overlay-blocked", "disabled", "handler-rejected"]),
      commandId: z.string().min(1).max(160),
      route: z.enum(["web-keydown", "native-forward"]),
      activePanelComponent: z.string().max(80).optional(),
      overlayCount: z.number().int().nonnegative().max(32),
    }).strict(),
  ]
);
```

在 renderer trace 文件中维护 `MAX_TRACE_EVENTS = 80`，用 `performance.now()` / `Date.now()` 写入 `at`，递增 `seq`，并在 `window.pier.terminal.recordInputRoutingDiagnostic` 存在时 fire-and-forget 上报。把 `TerminalInputRoutingTraceSnapshot` 作为可选字段加入 `TerminalDebugRendererSnapshot`，由 `buildRendererDebugSnapshot()` 读取。

- [x] **Step 4: 运行确认通过**

运行：`pnpm exec vitest run tests/unit/renderer/terminal/input-routing-trace.test.ts tests/unit/renderer/terminal/debug-renderer-snapshot.test.ts`

预期：两个文件通过，快照包含有界 trace，且没有原始键盘字段。

- [x] **Step 5: 检查当前改动，不提交**

运行：`git diff --check && git status --short`

预期：无空白错误；只出现本任务的新增/修改文件；不得执行 `git commit`。

## Task 2：工作台拥有 Dockview tab 拖拽输入会话

**Files:**
- Create: `src/renderer/components/workspace/terminal-tab-drag-input-capture.ts`
- Modify: `src/renderer/stores/terminal-input-routing-drag.ts`
- Modify: `src/renderer/main.tsx`
- Test: `tests/component/workspace/terminal-tab-drag-input-capture.test.ts`

**Consumes:** Task 1 的 `recordTerminalInputRoutingTrace()`；`registerTerminalFullscreenWebOverlay()` 与 `requestTerminalWebFocus()`。

**Produces:**

```ts
export function attachWorkspaceTerminalTabDragInputCapture(
  api: Pick<DockviewApi, "onDidDrop" | "onWillDragPanel" | "onWillDrop">
): () => void;
```

- [x] **Step 1: 写失败测试**

用可触发回调的 fake Dockview API 写以下独立测试：

```ts
it("releases a source capture exactly once after a local Dockview willDrop", () => {
  const detach = attachWorkspaceTerminalTabDragInputCapture(api);
  api.emitWillDragPanel({ panel: { id: "terminal-2" } });
  api.emitWillDrop({});
  window.dispatchEvent(new DragEvent("dragend"));

  expect(getTerminalFocusRoutingDebugSnapshot().webRequestIds).not.toContain(
    expect.stringMatching(/^dockview-tab-drag:/)
  );
  expect(readTerminalInputRoutingTraceSnapshot().events).toContainEqual(
    expect.objectContaining({ action: "ended", reason: "dockview-will-drop" })
  );
  detach();
});
```

再分别覆盖：`onDidDrop` 的外来 payload 补充信号、仅 `dragend` 的窗口外取消、目标窗口 `onDidDrop` 但没有本地会话、Esc、重复结束和 fake timer 触发 `fallback-timeout`。重复结束按会话编号无声幂等；每个测试断言仅活跃会话的 owner 被释放，已有 `dialog` owner 保持存在。

- [x] **Step 2: 运行确认失败**

运行：`pnpm exec vitest run tests/component/workspace/terminal-tab-drag-input-capture.test.ts`

预期：失败，因状态机模块不存在。

- [x] **Step 3: 最小实现状态机**

在新模块中创建单一 `activeSession`，其资源与完成语义如下：

```ts
interface ActiveTabDragSession {
  disposeCapture: () => void;
  panelId: string;
  sessionId: string;
  startedAt: number;
  timeoutId: number;
}

function finishActiveSession(
  reason: "dockview-will-drop" | "dockview-did-drop" | "window-dragend" | "escape" | "fallback-timeout" | "dispose"
): void {
  // 没有会话时只记录 target/duplicate 观察，不释放其他 owner。
  // 有会话时先清 activeSession，再 clearTimeout、disposeCapture、写 trace，保证重入幂等。
}
```

`onWillDragPanel` 创建一个唯一 `dockview-tab-drag:<sequence>` owner；同一 Dockview 实例的 `onWillDrop` 用 `queueMicrotask` 完成会话，`onDidDrop` 作为外来 payload 的补充完成信号；`window.addEventListener("dragend", ..., { capture: true })` 完成源会话；Esc 辅助完成；超时仅写警告后完成。不得监听 `.dv-tab` 的 DOM `dragstart`，不得用 `window.blur` 或 `visibilitychange` 结束。

把旧 `terminal-input-routing-drag.ts` 收缩为 sash 专用 watcher，导出名改为 `installTerminalInputRoutingSashDragWatcher()`；`main.tsx` 只安装该 watcher。

- [x] **Step 4: 运行确认通过**

运行：`pnpm exec vitest run tests/component/workspace/terminal-tab-drag-input-capture.test.ts tests/unit/renderer/stores/terminal-input-routing.test.ts`

预期：所有 tab 拖拽结束路径释放自己的 owner；既有独立 durable owner 测试仍通过。

- [x] **Step 5: 检查当前改动，不提交**

运行：`git diff --check && git status --short`

预期：无空白错误；不得执行 `git commit`。

## Task 3：在工作台 host 接线并验证跨窗口职责

**Files:**
- Modify: `src/renderer/components/workspace/host.tsx`
- Modify: `tests/component/workspace/host.test.tsx`
- Modify: `tests/component/workspace/panel-transfer.test.tsx`

**Consumes:** Task 2 的 `attachWorkspaceTerminalTabDragInputCapture()` 与既有 `attachWorkspacePanelTransfer()`。

**Produces:** WorkspaceHost 生命周期同时、独立地安装面板转移与 tab 输入捕获，并在 unmount 时清理二者。

- [x] **Step 1: 写失败测试**

扩展 host fake Dockview API，使其保存 `onWillDragPanel` / `onWillDrop` / `onDidDrop` listener。断言 `WorkspaceHost` ready 后三类 listener 都已注册；卸载后对应 disposer 都被调用。添加一个双控制器场景：目标 API 只发 `onDidDrop` 不影响自己的 owner，源 API 的 `dragend` 才释放源 owner。

- [x] **Step 2: 运行确认失败**

运行：`pnpm exec vitest run tests/component/workspace/host.test.tsx tests/component/workspace/panel-transfer.test.tsx`

预期：新断言失败，因 host 尚未安装 tab 输入捕获器。

- [x] **Step 3: 接线实现**

在 `WorkspaceHost` 接收 `DockviewReadyEvent` 的同一生命周期块中并列创建 disposer：

```ts
const panelTransferDispose = attachWorkspacePanelTransfer(event.api);
const tabDragInputDispose = attachWorkspaceTerminalTabDragInputCapture(event.api);

return () => {
  tabDragInputDispose();
  panelTransferDispose();
};
```

不要让 `transfer/attach.ts` 调用输入路由 store；两个模块只在工作台边界并列订阅同一 Dockview API。跨窗口目标的 `onDidDrop` 若没有本地 session 必须是无害 no-op，并由 trace 记录观察而不是释放源资源。

- [x] **Step 4: 运行确认通过**

运行：`pnpm exec vitest run tests/component/workspace/host.test.tsx tests/component/workspace/panel-transfer.test.tsx tests/integration/panel-transfer-recovery.test.ts`

预期：host 安装与清理成立，既有跨窗口转移恢复用例保持通过。

- [x] **Step 5: 检查当前改动，不提交**

运行：`git diff --check && git status --short`

预期：无空白错误；不得执行 `git commit`。

## Task 4：经验证 IPC 写入既有诊断日志

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/preload/terminal-api.ts`
- Modify: 终端 preload 全局类型声明文件（按现有 `TerminalApi` 声明位置）
- Create: `src/main/ipc/terminal/input-routing-diagnostics.ts`
- Create: `src/main/ipc/terminal/diagnostics-ipc.ts`
- Test: `tests/unit/main/terminal/input-routing-diagnostics.test.ts`
- Test: `tests/unit/shared/terminal/input-routing-diagnostics.test.ts`

**Consumes:** Task 1 的 `terminalInputRoutingDiagnosticSchema`；现有 `createLogger()` 与 main diagnostics sink。

**Produces:**

```ts
window.pier.terminal.recordInputRoutingDiagnostic(
  event: TerminalInputRoutingDiagnosticInput
): void;

export function registerTerminalInputRoutingDiagnosticsIpc(
  ipcMain: IpcMain
): void;
```

- [x] **Step 1: 写失败测试**

为 schema 覆盖合法拖拽事件、带 `key` 字段的非法事件、过长 `sessionId`。为 main handler 注入 `setDefaultLogSink()` spy，发送一个合法事件，断言日志 scope 是 `terminal.input-routing` 且 ctx 中包含 main 解析出的 `browserWindowId`；未知 sender 和非法 payload 必须只写 warn，不写 info 诊断记录。

- [x] **Step 2: 运行确认失败**

运行：`pnpm exec vitest run tests/unit/shared/terminal/input-routing-diagnostics.test.ts tests/unit/main/terminal/input-routing-diagnostics.test.ts`

预期：失败，因 schema/channel/handler 尚不存在。

- [x] **Step 3: 实现窄 IPC**

添加 `PIER.TERMINAL_INPUT_ROUTING_DIAGNOSTIC`，preload 使用 `ipcRenderer.send` 上报。main handler 必须：

```ts
const win = findAppWindowByWebContents(event.sender);
const parsed = terminalInputRoutingDiagnosticSchema.safeParse(raw);
if (!win || !parsed.success) {
  log.warn("Dropped terminal input-routing diagnostic", { senderId: event.sender.id });
  return;
}
log.info("Terminal input-routing event", {
  ...parsed.data,
  browserWindowId: win.id,
  windowId: stableWindowIdFor(win),
});
```

该 logger 已由 `installMainDiagnosticsLogging()` 接到 `userData/diagnostics/app-*.jsonl`。`fallback-timeout` 作为异常改用 `warn`；不要让 renderer 指定日志级别、窗口 id 或任意 message。

- [x] **Step 4: 运行确认通过**

运行：`pnpm exec vitest run tests/unit/shared/terminal/input-routing-diagnostics.test.ts tests/unit/main/terminal/input-routing-diagnostics.test.ts tests/unit/shared/app/logger.test.ts`

预期：合法事件可记录，非法或未知来源被拒绝，敏感字段无法通过 schema。

- [x] **Step 5: 检查当前改动，不提交**

运行：`git diff --check && git status --short`

预期：无空白错误；不得执行 `git commit`。

## Task 5：快捷键分派轨迹

**Files:**
- Modify: `src/renderer/lib/keybindings/use-registry.ts`
- Test: `tests/unit/renderer/lib/keybindings/use-registry-input-routing-trace.test.ts`

**Consumes:** Task 1 的 trace API。

**Produces:** 对已解析命令产生以下可查询结果：`dispatched`、`text-input-suppressed`、`overlay-blocked`、`disabled`、`handler-rejected`；并标记 `web-keydown` 或 `native-forward` 路径。

- [x] **Step 1: 写失败测试**

抽取最小可测 dispatch 决策函数，测试 DOM 路径和 native-forward 路径对相同命令都记录 route；文本输入抑制记录 `text-input-suppressed`；overlay 中 registry 返回空且输入本可解析时记录 `overlay-blocked`。测试只断言命令 id 与枚举结果，断言 trace 事件没有 `key`、`chars` 或 `text` 属性。

- [x] **Step 2: 运行确认失败**

运行：`pnpm exec vitest run tests/unit/renderer/lib/keybindings/use-registry-input-routing-trace.test.ts`

预期：失败，因可测决策出口和 trace 还未接入。

- [x] **Step 3: 最小实现**

保留现有快捷键选择行为。只在命令已解析或已知被 scope/text-input 阻断时调用：

```ts
recordTerminalInputRoutingTrace({
  action: "dispatched",
  commandId: action.id,
  overlayCount: useKeybindingScope.getState().overlayStack.length,
  route,
  source: "keybinding",
});
```

动作执行函数的 Promise rejection 和同步 throw 分别记录 `handler-rejected`，再保留原有 `console.error`。不对未注册键或普通文本输入创建事件；不改变 `preventDefault`、`stopPropagation`、动作选择、toast 或 native forward 行为。

- [x] **Step 4: 运行确认通过**

运行：`pnpm exec vitest run tests/unit/renderer/lib/keybindings/use-registry-input-routing-trace.test.ts tests/unit/app/keybindings.test.ts tests/unit/renderer/app/text-input-keybinding-guard.test.ts`

预期：两条快捷键路径均可定位，既有快捷键解析和文本输入保护不回归。

- [x] **Step 5: 检查当前改动，不提交**

运行：`git diff --check && git status --short`

预期：无空白错误；不得执行 `git commit`。

## Task 6：调试快照与调试窗口展示

**Files:**
- Modify: `src/renderer/components/common/terminal-debug/focus-routing-summary.tsx` 或新建同目录的 trace summary 组件
- Modify: `src/renderer/components/common/terminal-debug/window.tsx`
- Modify: `src/renderer/components/common/terminal-debug/routing-banners.tsx`（仅在确有异常需要 banner 时）
- Test: `tests/component/terminal-debug/input-routing-trace-summary.test.tsx`
- Test: `tests/unit/renderer/terminal/debug-actions.test.ts`

**Consumes:** Task 1 已纳入 `TerminalDebugRendererSnapshot` 的 trace。

**Produces:** 调试窗口内“拖拽会话”和“快捷键分派”区块；复制的诊断输出包含同一份脱敏轨迹。

- [x] **Step 1: 写失败测试**

渲染一个带 `workspace-tab-drag` 的 `fallback-timeout` 与一条 `keybinding/dispatched` 的 mock snapshot。断言 UI 展示会话 id、结束原因、耗时、命令 id、分派路径，并且复制文本包含这些字段；断言不会渲染不存在的 raw-key 字段。

- [x] **Step 2: 运行确认失败**

运行：`pnpm exec vitest run tests/component/terminal-debug/input-routing-trace-summary.test.tsx tests/unit/renderer/terminal/debug-actions.test.ts`

预期：失败，因调试视图尚未消费 trace。

- [x] **Step 3: 实现最小 UI**

复用现有终端调试窗口的 `Item`/`Card`/等宽诊断文本样式，增加两个只读列表。异常拖拽结束采用现有状态语义展示，但不新增业务 toast 或 modal。复制操作直接序列化已脱敏的 snapshot trace，不访问浏览器原始 KeyboardEvent。

- [x] **Step 4: 运行确认通过**

运行：`pnpm exec vitest run tests/component/terminal-debug/input-routing-trace-summary.test.tsx tests/unit/renderer/terminal/debug-actions.test.ts tests/unit/renderer/terminal/debug-renderer-snapshot.test.ts`

预期：调试窗口可立即看到并复制同一轨迹。

- [x] **Step 5: 检查当前改动，不提交**

运行：`git diff --check && git status --short`

预期：无空白错误；不得执行 `git commit`。

## Task 7：端到端回归与完整验证

**Files:**
- Modify/Create: `tests/e2e/...` 中现有 terminal/workspace harness 相邻的 tab 拖拽回归 spec
- Modify: 本设计与本计划的验收状态段落（只记录实际运行结果）

**Consumes:** Tasks 1–6 的状态机、snapshot 与 debug IPC。

- [x] **Step 1: 写失败 Electron 回归测试**

复用现有同窗口 Dockview 重排 Electron 回归：真实拖动同组 tab 后读取 `window.pier.terminal.debugSnapshot()`，断言同一 session 的 `started/ended` 成对出现、结束原因为 `dockview-will-drop`，且没有 `fallback-timeout`。同一回归轮询临时 `userData/diagnostics/app-*.jsonl`，断言实际落盘一条 `terminal.input-routing` 完成记录。跨窗口终端转移复用既有 PID 迁移回归；控制器单测断言目标无本地会话不释放 owner、源 `dragend` 才释放。

- [x] **Step 2: 运行确认失败或标记环境限制**

运行：`pnpm exec playwright test --config playwright.config.ts tests/e2e/panel/cross-window-drag.spec.ts --grep 'in-window.*reorders tabs'`

实际：首版断言失败，trace 只有 `started`，据此定位同实例移动未发 `onDidDrop`。加入 `onWillDrop` 后同一 Electron 回归通过并验证 JSONL 落盘。真实原生键入/`firstResponder` 回归仍会在缺少 macOS 辅助功能权限时跳过，跳过不计为通过。

- [x] **Step 3: 用实现后的行为更新断言**

不得为了适配自动化而注入未暴露给产品的“强制清 owner”测试后门。若 CDP 无法生成真实 AppKit mouse event，保留 trace/owner 的 Electron 断言，并在有辅助功能权限的 macOS runner 增加真实原生焦点检查。

- [x] **Step 4: 运行分层验证**

运行：

```bash
pnpm test:unit
pnpm test:component
pnpm test:integration
pnpm typecheck
pnpm depcruise
pnpm check:file-size
pnpm build:electron
pnpm exec playwright test --config playwright.config.ts tests/e2e/panel/cross-window-drag.spec.ts --grep 'in-window.*reorders tabs'
pnpm exec playwright test --config playwright.config.ts tests/e2e/panel/cross-window-drag.spec.ts --grep 'PID file unchanged after transfer'
```

实际：`pnpm test:unit`（949 个文件、8212 个测试通过，另有 1 个文件/2 个测试跳过）、`pnpm test:component`（47/597）和 `pnpm test:integration`（6/53）均通过；其余上述命令与受影响文件的 `ultracite check` 也通过。全项目 `pnpm lint` 仍被未触及的 `src/main/services/usage-data/pricing-catalog.json` 格式项阻塞，因此没有把它或 `pnpm check` 误报为通过。若原生 e2e 因环境权限跳过，报告为未覆盖项而非通过。

- [x] **Step 5: 最终差异审阅，不提交**

运行：`git diff --check && git status --short && git diff --stat`

实际：`git diff --check` 通过；已核对 tracked 与 untracked 文件，均属于本计划的工作台输入路由、诊断、测试和说明范围；未执行 `git commit`。

## 计划自检

- 设计第 1 节的所有完成标准分别由 Task 2、3、4、5、6、7 覆盖。
- 设计第 8 节反模式分别在 Task 2（Dockview 生命周期/不使用 blur）、Task 3（transfer 不持 owner）、Task 4（main 校验）、Task 5（不采集原始按键）中禁止。
- 所有跨 task 函数名在本计划的 Produces/Consumes 块中一致：`recordTerminalInputRoutingTrace`、`attachWorkspaceTerminalTabDragInputCapture`、`registerTerminalInputRoutingDiagnosticsIpc`。
- 计划不含待办占位、占位实现或提交步骤；这是用户明确的全过程不提交要求。
