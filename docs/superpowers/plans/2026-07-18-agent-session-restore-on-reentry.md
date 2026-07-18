# 智能体会话重进恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修 #65 回归：关窗/退出不再把可恢复 agent 标成 `exited`；重进对全 agent 走各自 resume，失败则打开该智能体界面。

**Architecture:** 会话属于各 agent。宿主只存恢复索引。关窗用同步 `armDetaching` 抑制一切 agent→exited 写源，并保持磁盘 `running`+`resume`。重进沿用 `resolveAgentResumeLaunch`；resume argv 只用于本次 create。

**Tech Stack:** Electron main/renderer、既有 terminal session store、`AGENT_RESUME_ADAPTERS`、Vitest

**Spec:** [`docs/superpowers/specs/2026-07-18-agent-session-restore-on-reentry-design.md`](../specs/2026-07-18-agent-session-restore-on-reentry-design.md)

## Global Constraints

- 全 agent 同一宿主策略；差异只在 adapter / sessionId
- 不 live attach PTY；不做宿主会话库
- FA 仍是活动语义源；session 只存恢复索引
- 用户文案走 i18n；禁止主路径 `restored agent` 实现词
- 显式 path stage；Conventional Commits；不 `git add .`
- 先 S0 抑制伪 exited，再做 UI

## File map

| 文件 | 职责 |
|---|---|
| `src/main/services/agents/window-detaching-guard.ts` | **新建** arm/disarm/isDetaching 双键 |
| `src/main/services/foreground-activity/entry.ts` | 导出 `isSuspendedJobExitCode` |
| `src/main/ipc/terminal-task-lifecycle-wiring.ts` | 悬挂码 + detaching 门闸 |
| `src/main/ipc/foreground-activity.ts` | SessionEnd → exited 门闸 |
| `src/main/state/terminal-session-state.ts` | `detachAgentsForWindow`；可选 list panels |
| `src/main/windows/window-manager.ts` | close/quit 调用 arm→detachAgents→detach |
| `src/main/ipc/terminal-initial-session.ts` | restore 合并 persist |
| `src/main/ipc/terminal-create-handler.ts` | restore 失败不清 agent |
| `src/renderer/panel-kits/terminal/*` | skipNativeCreate、终态卡、重启 |
| `src/main/ipc/agents.ts` + preload | 按原始 launch 注册 restart |
| i18n `terminal.ts` en/zh-CN | 文案 |

---

### Task 1: detaching 抑制窗 + 悬挂码（R1/R6 核心）

**Files:**
- Create: `src/main/services/agents/window-detaching-guard.ts`
- Modify: `src/main/services/foreground-activity/entry.ts`
- Modify: `src/main/ipc/terminal-task-lifecycle-wiring.ts`
- Modify: `src/main/ipc/foreground-activity.ts`（`markAgentSessionExited`）
- Test: `tests/unit/main/window-detaching-guard.test.ts`
- Test: extend `tests/unit/main/terminal-state-consistency.test.ts` 或新建 lifecycle wiring 测

**Interfaces:**
- Produces:
  ```ts
  // window-detaching-guard.ts
  export function armDetaching(keys: {
    electronWindowId: string;
    recordId: string;
  }): void;
  export function disarmDetaching(keys: {
    electronWindowId: string;
    recordId: string;
  }): void;
  export function isWindowDetaching(key: string): boolean;
  // true if key matches either registered electron id or recordId
  ```
  ```ts
  // entry.ts
  export function isSuspendedJobExitCode(
    code: number | undefined
  ): boolean;
  ```

- [ ] **Step 1: 写 guard 单测（先红）**

```ts
import { describe, expect, it } from "vitest";
import {
  armDetaching,
  disarmDetaching,
  isWindowDetaching,
} from "../../../src/main/services/agents/window-detaching-guard.ts";

describe("window-detaching-guard", () => {
  it("arms both electron id and recordId", () => {
    armDetaching({ electronWindowId: "7", recordId: "main" });
    expect(isWindowDetaching("7")).toBe(true);
    expect(isWindowDetaching("main")).toBe(true);
    expect(isWindowDetaching("other")).toBe(false);
    disarmDetaching({ electronWindowId: "7", recordId: "main" });
    expect(isWindowDetaching("7")).toBe(false);
    expect(isWindowDetaching("main")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测确认红**

```bash
pnpm exec vitest run tests/unit/main/window-detaching-guard.test.ts
```

Expected: FAIL module not found

- [ ] **Step 3: 实现 guard + `isSuspendedJobExitCode`**

```ts
// window-detaching-guard.ts
const armed = new Set<string>();

export function armDetaching(keys: {
  electronWindowId: string;
  recordId: string;
}): void {
  if (keys.electronWindowId) armed.add(keys.electronWindowId);
  if (keys.recordId) armed.add(keys.recordId);
}

export function disarmDetaching(keys: {
  electronWindowId: string;
  recordId: string;
}): void {
  armed.delete(keys.electronWindowId);
  armed.delete(keys.recordId);
}

export function isWindowDetaching(key: string): boolean {
  return key.length > 0 && armed.has(key);
}
```

```ts
// entry.ts — 紧挨 SUSPENDED_JOB_EXIT_CODES
export function isSuspendedJobExitCode(
  code: number | undefined
): boolean {
  return code !== undefined && SUSPENDED_JOB_EXIT_CODES.has(code);
}
```

- [ ] **Step 4: wiring 门闸**

在 `command_finished` 写 exited 前：

```ts
import { isSuspendedJobExitCode } from "../services/foreground-activity/entry.ts";
import { isWindowDetaching } from "../services/agents/window-detaching-guard.ts";

// patch exited 条件改为：
if (
  !lifecycleId &&
  targetWindow &&
  !targetWindow.isDestroyed() &&
  exitCode >= 0 &&
  !isSuspendedJobExitCode(exitCode) &&
  !isWindowDetaching(windowRecordIdFor(targetWindow)) &&
  !isWindowDetaching(String(id))
) {
  patchTerminalPanelAgentStatus(...);
}
```

`process-closed` 里 `processAlive === false` 的 patch 同样加 detaching 双键检查。

`markAgentSessionExited`（foreground-activity.ts）开头：

```ts
if (
  isWindowDetaching(args.windowId) ||
  isWindowDetaching(windowRecordIdFor(win))
) {
  return;
}
```

（`win` 解析后；找不到 win 也 return。）

- [ ] **Step 5: 单测悬挂码 + detaching 不 patch（可用现有 harness 或纯函数级）**

至少覆盖：
- `isSuspendedJobExitCode(145)===true`，`0===false`
- arm 后模拟「若调用方检查 isWindowDetaching 则跳过」（guard 单测即可；wiring 集成可放 Task 2 后）

- [ ] **Step 6: 跑测绿并 commit**

```bash
pnpm exec vitest run tests/unit/main/window-detaching-guard.test.ts
git add src/main/services/agents/window-detaching-guard.ts \
  src/main/services/foreground-activity/entry.ts \
  src/main/ipc/terminal-task-lifecycle-wiring.ts \
  src/main/ipc/foreground-activity.ts \
  tests/unit/main/window-detaching-guard.test.ts
git commit -m "fix(terminal): suppress agent exited while window detaching"
```

---

### Task 2: 关窗/quit 接入 arm + detachAgents（R1）

**Files:**
- Modify: `src/main/state/terminal-session-state.ts`
- Modify: `src/main/windows/window-manager.ts`
- Modify: `src/main/services/window-service.ts`（若 quit 需在 destroy 前暴露 hook；优先全放 window-manager）
- Test: `tests/unit/main/terminal-session-detach-agents.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function detachAgentsForWindow(
    recordId: string
  ): Promise<void>;
  // running: keep resume/launch/startedAt; clear finishedAt/exitCode;
  //   set restore.detachedAt = Date.now() if schema allows optional restore
  // exited: unchanged
  ```

- [ ] **Step 1: schema 可选 `restore.detachedAt`（最小）**

在 `terminal-session-state-schemas.ts` / `terminal.ts` 的 agent metadata 上增加 optional：

```ts
restore: z
  .object({
    detachedAt: z.number().int().nonnegative().optional(),
  })
  .optional(),
```

契约类型同步。

- [ ] **Step 2: `detachAgentsForWindow` 单测先红再实现**

行为：
- running + resume → 仍 running，resume 在，finishedAt 被清，detachedAt 有值
- exited → 原样

- [ ] **Step 3: window-manager `close` 成功路径（intercept 未 veto 之后、detachWindow 之前）**

```ts
const electronWindowId = String(window.id); // 与 FA 一致
const recordId = context.recordId;
armDetaching({ electronWindowId, recordId });
try {
  await detachAgentsForWindow(recordId); // close handler 若不能 async，改为同步 mutate API 或 fire-and-await flush pattern 与现网一致
} finally {
  // detachWindow 仍在此处；disarm 放到 closed 末尾，覆盖迟到事件
}
getTerminalAddon()?.detachWindow(...);
```

`closed` 末尾：`disarmDetaching({ electronWindowId, recordId })`。

**注意：** 现 `close` 回调是同步的。优先把 `detachAgentsForWindow` 做成 **store 同步 mutate**（与其它 session mutate 一样通过 ensureStore 的同步路径），或在 intercept allow 之后的 async close prepare 里完成 arm+detachAgents（看 `closeCoordinator` 现网：prepare 已在 service 层 async）。  
**推荐：** 在 `flushWindowBeforeClose` / allow 路径末尾 arm+detachAgents（async），`close` 事件里只保证 armed 仍在再 detachWindow；`closed` disarm。

查 `window-service.ts` `flushWindowBeforeClose`：在 `flushAllStoresSettled` **之前** arm，detachAgents mutate，再 flush，确保 resume 落盘。

- [ ] **Step 4: `destroyAllForQuit`**

在每个窗 `detachWindow` 前：

```ts
armDetaching({ electronWindowId, recordId });
// detachAgents sync mutate
detachWindow...
// closed/disarm 在 quit 路径也要执行；若 closed 仍触发则依赖 closed；否则循环末 disarm
```

- [ ] **Step 5: 测 + commit**

```bash
pnpm exec vitest run tests/unit/main/terminal-session-detach-agents.test.ts
git add src/main/state/terminal-session-state.ts \
  src/main/state/terminal-session-state-schemas.ts \
  src/shared/contracts/terminal.ts \
  src/main/windows/window-manager.ts \
  src/main/services/window-service.ts \
  tests/unit/main/terminal-session-detach-agents.test.ts
git commit -m "fix(terminal): keep running agent sessions across window close"
```

---

### Task 3: restore persist 合并 + 失败保留元数据（R2/R3/R7）

**Files:**
- Modify: `src/main/ipc/terminal-initial-session.ts`
- Modify: `src/main/ipc/terminal-create-handler.ts`
- Modify: `src/main/state/terminal-session-state.ts`（如需 read-modify-write helper）
- Test: `tests/unit/main/terminal-create-launch.test.ts` / `terminal-state-consistency.test.ts` / `terminal-focus.test.ts`

**Interfaces:**
- Change `persistInitialTerminalAgent` options:

```ts
options?: {
  resume?: TerminalAgentResumeMetadata;
  restoredAgentLaunch?: boolean;
  existing?: TerminalAgentPanelMetadata | null;
}
```

当 `restoredAgentLaunch`：
- `startedAt = existing?.startedAt ?? Date.now()`
- `resume = existing?.resume ?? options.resume`
- `launch` = **existing.launch 优先**（原始用户 launch），不要用 resume 后的 command
- createTerminal 仍用 `launchForNative`（含 resume argv）

- [ ] **Step 1: 失败路径**

```ts
if (!ok) {
  foregroundActivityService.panelClosed(...);
  if (!launch.restoredAgentLaunch) {
    await clearTerminalPanelAgent(sessionScope, createArgs.panelId);
  }
  return { ok: false, error: "createTerminal returned false" };
}
// catch 同样
```

- [ ] **Step 2: 单测**

- restored running + sessionId → native create 收到 resume command；磁盘 launch.command **不含** `--resume`（仍是原 command）
- restore create false → agent 元数据仍在

- [ ] **Step 3: commit**

```bash
git commit -m "fix(terminal): preserve resume metadata on agent restore"
```

---

### Task 4: renderer 终态卡 + skipNativeCreate + 重启（R3/R4/R5）

**Files:**
- Modify: `use-terminal-native-lifecycle.ts` — 增加 `skipNativeCreate: boolean`
- Modify: `terminal-panel.tsx` — 传入 `skipNativeCreate={Boolean(restoredAgentResult)}`
- Modify: `terminal-restored-result-view.tsx` — 文案 i18n + 重新启动按钮
- Modify: `src/main/ipc/agents.ts` — `prepareLaunchFromSpec` 或扩展 prepareLaunch
- Modify: preload + 类型
- Modify: `src/renderer/i18n/locales/zh-CN/terminal.ts` + `en/terminal.ts`
- Modify: relaunch store 使用方
- Test: `tests/component/terminal-panel-lifecycle.test.tsx`

**Interfaces:**
- IPC:

```ts
// pier:agents:prepareLaunchFromSpec
{
  agentId: AgentKind;
  command?: string;
  cwd?: string;
} → { launchId: string | null }
```

main：`terminalLaunchRegistry.register({ agentId, command, cwd })`，**不要**走 prefs 默认覆盖已给 command。

- 重启流程（结果卡按钮）：

```ts
const { launchId } = await window.pier.agents.prepareLaunchFromSpec({
  agentId: agent.agentId,
  command: agent.launch.command,
  cwd: agent.launch.cwd,
});
// 触发既有 relaunch：与 start agent 相同渠道写入 terminal-relaunch.store
```

- cold-start 提示：restore 成功但 `resolveAgentResumeLaunch.resumed===false` 时，可在 create 后经 session 标志或一次性 banner；最小做 i18n 键 + 结果卡/终端提示二选一。优先：**无 id 时仍 create 真终端**（#65 已会 cold launch），组件测确保 running 无 id 会 create。

- [ ] **Step 1: 组件测**

- exited → 不调用 `terminal.create`，即使将来有 anchor  
- 有「重新启动」  
- running + resume 仍 create（既有）

- [ ] **Step 2: 实现 skipNativeCreate**

```ts
// use-terminal-native-lifecycle 顶部
if (!sessionLoaded) { ... return; }
if (skipNativeCreate) {
  markLifecycle({ phase: "skipped_restored_result", createPending: false });
  return () => { disposed = true; ... };
}
```

- [ ] **Step 3: i18n**

```ts
// zh-CN
agentSession: {
  endedTitle: "智能体已结束",
  endedBody: "上次会话已退出。可以重新启动。",
  restart: "重新启动智能体",
  coldStart: "未能恢复上次会话，已重新打开智能体。",
  unsupported: "该智能体不支持恢复上次会话，已重新打开智能体。",
}
```

结果卡去掉主路径 `[pier] restored agent` 硬编码，改用 `endedTitle`。

- [ ] **Step 4: commit**

```bash
git commit -m "fix(terminal): restore agent UI and explicit relaunch from saved launch"
```

---

### Task 5: GC 无主 session + 回归测矩阵（收尾）

**Files:**
- Modify: layout load 路径（`workspace-host` 或 main `workspace` readLayout 后 reconcile）— **最小**：main 在 `readLayout` 应用后由 renderer reconcile 调 `pier:terminal:gcOrphanSessions(activePanelIds)`  
- 或 window restore 后 `retain` 式 GC  
- Test: 单元 GC；扩展 resume 多 agent 抽测（claude/codex/omp 已有 adapter 测）

- [ ] **Step 1: GC API**

```ts
export async function retainTerminalPanelSessions(
  recordId: string,
  activePanelIds: readonly string[]
): Promise<void>
// 删除不在 activePanelIds 中的 panels
```

renderer layout ready 后调用（与 terminal reconcile 同节拍）。

- [ ] **Step 2: 跑相关单测+组件测**

```bash
pnpm exec vitest run tests/unit/main/window-detaching-guard.test.ts \
  tests/unit/main/terminal-session-detach-agents.test.ts \
  tests/unit/main/agent-resume-adapters.test.ts \
  tests/unit/main/terminal-create-launch.test.ts \
  tests/unit/main/terminal-focus.test.ts \
  tests/component/terminal-panel-lifecycle.test.tsx
```

- [ ] **Step 3: commit**

```bash
git commit -m "fix(terminal): gc orphan agent sessions after layout restore"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| R1 关窗保持 running+id | T1+T2 |
| R2 resume 命令 | T3（#65 已有 adapter） |
| R3 无 id / unsupported 打开智能体 | T3+T4 |
| R4 窗内退出终态卡 | 既有 + T4 文案 |
| R5 重启原始 launch | T4 |
| R6 detaching 不写 exited | T1 |
| R7 restore 失败保留 | T3 |
| 全 agent 策略 | T1–T3 无 omp 特判 |
| 无主 GC | T5 |
| 有界温和结束 L1 | **本 plan 不做**（spec 可选；避免拖主路径） |

## 执行方式

Plan 已保存：`docs/superpowers/plans/2026-07-18-agent-session-restore-on-reentry.md`

**1. Subagent-Driven（推荐）** — 每 Task 新开子代理，Task 间审查  

**2. Inline Execution** — 本会话按 Task 连续做  

选哪个？
