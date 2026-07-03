# CHANGELOG

按 [Keep a Changelog](https://keepachangelog.com/) 与 Conventional Commits 组织。日期用 ISO 8601。

## [Unreleased]

### Added

- **`ForegroundActivityAggregator`** (`src/main/services/foreground-activity/`)
  统一 agent / task / shell / idle 四态活动模型，per-panel 单一 activity。
  新广播通道 `pier://foreground-activity:changed`，新 preload API
  `window.pier.foregroundActivity`，新 renderer store
  `useForegroundActivityStore` + `<ForegroundActivityBridge />`。
- **`Project` 实体** (`src/shared/contracts/project.ts` + `src/main/state/project-store.ts`)
  稳定 `id: uuid` + `rootPath` + `name` (派生自 package.json > deno.json >
  Cargo.toml [package].name > basename)。`upsertProjectFromPath()` 提供
  in-flight 去重防并发落两条记录。
- **`PanelContext.projectId` / `projectRootPath`** 附加可选字段，与老
  `projectRoot` 并存渐进迁移。

### Changed

- **Path B agent hook 通路收敛为 emit 脚本 + JSONL 直写。**
  - emit 脚本升级为 `commandStart` / `commandFinished` / `agentEvent` 三 kind
    dispatch，`agentHookEventSchema` 变为 zod discriminated union。
  - 7 个 inline agent 插件 (amp / kilo / mimo-code / opencode / omp / pi /
    hermes) 从 HTTP `fetch(/agent-event)` 切换到本地 `appendFile` (JS/TS) 或
    `open(log, "a")` (Python)。
  - `pierHookCommand` 输出首位固定 `"agentEvent"` 位置参数。

### Removed

- **`agent-hook-server`** (HTTP loopback) 与相关 test 文件删除。
- 环境变量 `PIER_AGENT_HOOK_PORT` / `PIER_AGENT_HOOK_TOKEN` 从 PTY hookEnv
  中删除。`hookEnv()` 变同步（不再等 loopback server 启动）。
- `LEGACY_HOOK_MARK` 常量删除；`isPierHookCommand` 只识别新 marker
  `PIER_AGENT_HOOKS_DIR`。

### Fixed

- **`ForegroundActivityAggregator.acquireHookAgentEntry`** 迟到的
  `Stop` / `ToolComplete` / `SubagentStop` / `error` 事件不再销毁已有 task /
  shell activity（仅 `SESSION_CREATING_EVENTS` 才允许覆盖为 agent kind）。
- **`agentLaunched`** 覆盖已有 hook agent activity 时清 `hookTtlTimer`，防止
  30min 后回落 ready 的旧 callback 触发。
- **`taskFinished` linger 幂等**——多次上报 task exit 时首个 linger timer
  优先，防止 timer 无限延长。
- **`buildBroadcast`** 浅拷贝 `activity` 引用，防同进程 listener 意外
  mutate 污染 aggregator 内部状态。
- **`Cargo.toml` name 派生** 用 `[package]` 段锚定正则，修复
  `[[bin]] name` 排在 `[package] name` 之前时项目名错取的 bug。
- **`upsertProjectFromPath` 并发**——`Map<rootPath, Promise<Project>>` 去重
  in-flight 请求 + `mutate` 回调内二次 find 兜底，防止同 rootPath 落两条
  不同 UUID 的记录。
- **`resolvePanelContextForPath` 静默 catch**——加一次性 warn 让磁盘故障
  等失败可见。
- **emit `commandStart` sed 转义链**——前置 `head -c 4096` 后置
  `tr -d '\000-\037\177'` 剥控制字符再 sed 转义 `\` 与 `"`，防命令行含
  换行/tab/NUL 破坏 JSONL 行结构。
- **`JsonlObserver.processLine` disposed 守卫**——dispose 后剩余行不派发。
- **`omp/pi` 生成插件** 从 `require("node:fs/promises")` 改为
  `await import("node:fs/promises")`，兼容 ESM-only Node 20+ 宿主
  （原 `require` 在 ESM 环境会 `ReferenceError` 被 catch 静默吞掉，事件全丢）。
- **`hermes` Python except** 收紧到 `except OSError`，不再宽泛 catch
  `Exception` 掩盖内部 bug。

### Upgrade notes

⚠️ **HTTP → JSONL cutover 一次性代价（受影响：从 <此版本前的 pier 版本> 升级）**

老版本 pier 装到用户 `~/.claude/settings.json` / `~/.factory/settings.json` /
其他 hooks.json 里的 curl 条目（含 `PIER_AGENT_HOOK_PORT` 引用），在新版本
中**不再被 `isPierHookCommand` 识别为 pier-managed**，因此：

- 新 pier 的 `uninstallAllAgentHooks` 不会自动清理这些老条目。
- 老条目在新 pier 运行时 curl 会因 `PIER_AGENT_HOOK_PORT` 未设导致 EADDRNOTAVAIL
  静默失败，agent 每次 hook trigger 浪费一次子进程（无功能影响，用户无感）。

**用户手动清理路径**（可选）：搜索 hooks.json 里包含
`PIER_AGENT_HOOK_PORT` 的行，手动删除。或者在关闭 pier 的
`agentStatusHooks` 偏好后再打开一次（新 pier 会走 install 幂等路径，不动
老条目，但用户可以在关闭态下手工清）。

### Removed (contract cutover)

以下老 API 已彻底删除，contract 单源：

- `AGENT_SESSIONS_CHANGED` 广播通道（→ `FOREGROUND_ACTIVITY_CHANGED`）
- `agentSessionsApi` preload API / `pier.agentSessions.*` renderer 入口（→ `pier.foregroundActivity.*`）
- `useAgentSessionStore` + `agentSessionCounts` (→ `useForegroundActivityStore` + `activityCounts`)
- `AgentSessionsBridge` component (→ `ForegroundActivityBridge`)
- `AgentSessionSnapshot` / `AgentSessionsBroadcast` / `agentSessionSourceSchema` / `agentRuntimeStatusSchema` / `runtimeStatusForHookEvent` / `tabStatusForAgentStatus` shared contract 全部删除（→ 新 `foreground-activity.ts` 契约）
- `createAgentSessionAggregator` + `agent-session-entry` + `agent-session-timers` main-side 模块（→ `foreground-activity/{aggregator,entry,types}.ts`）
- `agent-session-aggregator.test.ts` / `agent-session-store.test.ts` / `agent-tab-overlay.test.ts` 测试（→ `foreground-activity-aggregator.test.ts` 29 case）

`agentTabIconId` / `agentKindFromTabIconId` 保留在 `agent-session.ts` 契约（agent 图标命名工具，非 aggregator state）。

### Final migration (all done)

`Project` + task 层最后一里 6 项迁移全部完成，双源架构收? complete：

- ✅ task/run 契约 `projectRoot: string` 迁到 `projectId: uuid + projectRootPath: string`（TaskListResult / TaskLaunchPlan / TaskPanelMetadata / TaskRunSnapshot + PierCommand run.list/run.spawn + PierTasksAPI + PanelContext + 60+ callsite）
- ✅ Task 生命周期 wire：`task-service.startRun` / `completePanel` / `cancelRun` 走 `onTaskActivity` 回调转发 `agentSessionService.taskLaunched` / `taskFinished` → `ForegroundActivityAggregator`
- ✅ Project registry renderer 面：新 `pier://project:list` / `pier://project:get` / `pier://project:changed` IPC + `PierProjectAPI` preload + `useProjectStore` + `ProjectBridge`
- ✅ `panel-context-state.ts:keyForContext` 清 legacy `projectRoot` fallback 一层
- ✅ `PanelContext.projectRoot` 删（→ `projectId + projectRootPath`）
- ✅ `panel-context-resolver` 输出改产 `projectRootPath`；`upsertProjectFromPath` 兜底 catch 保留（Electron `app.getPath` 不可用时 project 保持 null，`projectRootPath` 从 gitRoot/cwd 派生）

### Cleanup (double-write collapse)

双写与 pragmatic 收敛清理，达 GREEN 终态：

- ✅ **删 `TERMINAL_TAB_CHROME_PATCHED` 广播**：main→renderer task exit chrome 通路统一走 `FOREGROUND_ACTIVITY_CHANGED` + `activityTabChromeOverlay`。删 `TerminalTabChromePatchEvent` contract、`onTabChromePatch` preload、`forwardTabPatch` wiring 依赖、renderer `mergeTabChrome` 4 层缩到 3 层（base → restore-patch → activity）。
- ✅ **删 `foreground-activity` aggregator 中孤儿 `ignoredNativeUserClosePanels` Set + `ignoreNextNativeUserClose` / `consumeIgnoreNativeUserClose` API**：该状态实际由 `terminal-task-lifecycle` 维护并消费（`terminal.ts` 唯一 caller）；aggregator 侧的副本 0 caller，双源同义 collapse 到单源。
- ✅ **`src/main/ipc/agent-session.ts` 改名 `foreground-activity.ts`**；`agentSessionService` → `foregroundActivityService`，`registerAgentSessionIpc` → `registerForegroundActivityIpc`，`closeAgentSessionResources` → `closeForegroundActivityResources`。5 处 callsite 全更名。共享契约 `src/shared/contracts/agent-session.ts` 保留（仍承担 `agentHookEventSchema` + `agentTabIconId` icon 工具函数）。
- ✅ **`terminal-task-lifecycle.ts` 职责 JSDoc 清晰化**：native shell 回调协调器（exit hint 排序 / dedupe / ignore-close / 持久化 patchTab+patchTaskStatus）。broadcast 责任明确外包给 `foregroundActivityService.taskFinished` → aggregator 单源。
- ✅ **删陈旧 sync 维护提醒**：`foreground-activity.ts:111-113` 老 `runtimeStatusForHookEvent` 与 `agent-session.ts` 同步注释（引用的函数已删）。`pi.ts:16` / `shared.ts:118` 相同注释同步更新为当前 `activityStatusForHookEvent`。

### Fixed

- **`task-service.cancelRun` 覆盖已 success activity → cancelled 的回归 bug**：
  `taskRuns.cancel` 只把 pending/running 节点改状态，但 task-service 遍历 fire
  `onTaskActivity.onFinished({ status: "cancelled" })` 时不看 `node.status`。
  多 task DAG 部分完成后 restart 会让已 succeeded 的 tab 在 5s linger 内闪回
  cancelled。修：filter 只对 `node.status === "cancelled"` 才 fire。
- **App quit 500ms debounce 窗口内 mutate 丢失**：`flushProjectStore` +
  `flushPanelContextState` 从未在 `before-quit` 调用。加入
  `window-service.flushOpenWindows` / `flushWindowBeforeClose` batch，与已有
  flush 队列同步落盘。
- **`upsertProjectFromPath` 失败日志 flood**：`upsertWarned` 一次性 flag 换成
  30s throttle 窗口，磁盘故障时不再首次 warn 后完全静默。

### Removed

- `PIER_BROADCAST.TERMINAL_TAB_CHROME_PATCHED` channel。
- `TerminalAPI.onTabChromePatch` preload API。
- `TerminalTabChromePatchEvent` contract type。
- `ForegroundActivityAggregator.ignoreNextNativeUserClose` / `consumeIgnoreNativeUserClose` API + 内部 `ignoredNativeUserClosePanels` Set（迁移到 `terminal-task-lifecycle` 单源）。

### Hygiene (best-practice terminal state)

达"最佳实践终态"的最后一波：

- **删死码**：
  - `ForegroundActivityAggregator.resetPanel` 全仓 0 caller 3 行删。
  - `pier://project:get` IPC + `pier.project.get` preload API + `useProjectById` renderer hook — 全套 forward-compat 0-caller trio 删。
  - `tests/component/terminal-panel-lifecycle.test.tsx` 里针对已删 `TERMINAL_TAB_CHROME_PATCHED` 广播的 stale mock + 相关未用 fixture 删。
- **回归测试**（覆盖 e40d01d8 的 3 项 bug fix）：
  - `task-service-activity.test.ts` — `cancelRun` fire onFinished 只对 `node.status === "cancelled"` 生效，守卫已成功任务的 activity 不被闪回 cancelled。
  - `window-service.test.ts` — flushOpenWindows / flushWindowBeforeClose 断言 `flushProjectStore` + `flushPanelContextState` 也在 flush 队列里。
  - `panel-context-resolver-upsert-warn.test.ts` — `upsertProjectFromPath` 失败的 30s 时间窗口 throttle（配合新导出的 `_resetUpsertWarnForTests` 测试重置）。
- **一致性打磨**：
  - `CollectTaskCandidatesOptions.projectRoot` / `ComposerSourceOptions` / `DenoSourceOptions` / `VscodeSourceOptions` 等所有内部 fs-path 字段全部改名 `projectRootPath`，与契约层 `TaskListResult.projectRootPath` / `TaskLaunchPlan.projectRootPath` 命名对齐；task-sources.ts 内部 destructure 与 utils.packageManagerFor 参数同步改名。
  - `window-service` flushOpenWindows / flushWindowBeforeClose 从 `Promise.all` 换成 `Promise.allSettled`，抽出 `flushAllStoresSettled` 单点，每一路失败独立 log 不再吞其他成功。
  - 抽 `task-recent-launcher.ts`（99 行）承接 recent-tasks 记忆 + 排序，`task-service.ts` 从 491 行降到 425 行（距硬帽 500 有 75 行缓冲，下一次 task lifecycle 变更空间充足）。
- **JSDoc + 陈旧注释**：`foreground-activity.ts` 门面 JSDoc 更新为"前台活动服务门面"（旧文本"agent-session facade 历史命名保留"删）。
