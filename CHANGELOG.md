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

### Still deferred

仅剩 `Project` 与 task 层的最后一里迁移，plan `local://finalize-double-source-plan.md` §D.6-D.7 与 §C.7-C.9：

- `task-run-coordinator` / `run-commands.ts` / task/run 契约从 `projectRoot: string` 迁到 `projectId + projectRootPath`（60+ callsite）
- Task 生命周期 wire：`terminal-task-lifecycle-wiring` 里的 `taskExitCode` 分支调 `agentSessionService.taskFinished`；`task-run-coordinator.start` 调 `taskLaunched`——目前 aggregator 已实现 API + 29 case tests 全绿, 只差 wire。
- `pier://project:list` / `pier://project:get` / `pier://project:changed` renderer IPC + preload API
- `panel-context-state.ts:keyForContext` 清 `projectRoot` fallback 层

以上是可 rollback 的独立后续 commit；当前 commit 已完成 A/B/C 的 contract 单源切换 + D 的 Project 基础设施。
