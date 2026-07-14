# CHANGELOG

按 [Keep a Changelog](https://keepachangelog.com/) 与 Conventional Commits 组织。日期用 ISO 8601。

## [Unreleased]

### Added

- **成本管理归宿主指挥中心。** 新增 core widget `core.cost-overview`（分类
  `analytics`，可搜索关键词包括 `cost` / `spending` / `tokens` / `成本` /
  `花费` / `令牌`），跨插件聚合 API 等价成本估算：4 KPI（今日 / 近 31 天 /
  tokens / 来源数）+ 堆叠 Bar chart（每源一层，走 `--chart-1..5` 语义色）
  + 未定价日数提示。三态齐全（loading / empty / error），响应式三档
  container query（<@14rem 只显今天；@22rem 3 列；@34rem 4 列），
  `refreshToken` 变化触发 `window.pier.usageData.refreshAll()`。
- **`window.pier.usageData` preload API** 暴露 `read` / `refreshAll` /
  `onChanged`，配套 renderer store `useUsageDataStore` + `initUsageDataBridge()`。
- **`UsageSourceRegistry`**（`src/main/services/usage-data/source-registry.ts`）
  + 插件 facade `context.usageData.registerSource({ id, rescan })`；
  `refreshAll` fan-out 到全部注册源，单源失败不短路其他源。
- **6 个 `core.cost.*` metrics** 注册到 mission-control metric registry：
  `today` / `periodInstant` / `periodTokens` / `dailySeries` / `byModel` /
  `bySource`，供自定义卡片物料按指标组装。
- **定价目录扩展**：`src/main/services/usage-data/pricing-catalog.json` 抽出
  为独立 JSON，新增 Anthropic（Claude Haiku 4.5、Sonnet 4.5/4.6/4.7、Opus
  4.7、3.5 Sonnet/Haiku、3 Opus）、Google（Gemini 2.5 Pro/Flash/Flash-Lite、
  Gemini 3 Pro/Flash）、xAI（Grok 4、Grok Code）条目，支持精确 → 别名 →
  最长前缀通配三段匹配。文档见 `docs/model-pricing.md`。
- **`UsageAggregateSnapshot` 跨插件成本聚合契约**
  （`src/shared/contracts/usage-data.ts`）+ `aggregator.ts`。broadcast 通道
  `pier://usage-data:changed` 是 renderer 侧唯一数据源。
- `**ForegroundActivityAggregator**` (`src/main/services/foreground-activity/`)
统一 agent / task / shell / idle 四态活动模型，per-panel 单一 activity。
新广播通道 `pier://foreground-activity:changed`，新 preload API
`window.pier.foregroundActivity`，新 renderer store
`useForegroundActivityStore` + `<ForegroundActivityBridge />`。
- `**Project` 实体** (`src/shared/contracts/project.ts` + `src/main/state/project-store.ts`)
稳定 `id: uuid` + `rootPath` + `name` (派生自 package.json > deno.json >
Cargo.toml [package].name > basename)。`upsertProjectFromPath()` 提供
in-flight 去重防并发落两条记录。
- `**PanelContext.projectId` / `projectRootPath`** 附加可选字段，与老
`projectRoot` 并存渐进迁移。

### Changed

- **`pier.codex` 插件版本 1.1.6 → 1.2.0。** Codex 只保留会话日志采集 + 账号
  管理；成本 UI / 定价 / 展示由宿主统一负责。历史布局中的 `pier.codex.cost`
  widget 会走宿主 unknown widget fallback（`mission-control-merge.ts:101`），
  显示占位卡带移除按钮，用户可手工从物料库添加 `core.cost-overview`。
- **Path B agent hook 通路收敛为 emit 脚本 + JSONL 直写。**
  - emit 脚本升级为 `commandStart` / `commandFinished` / `agentEvent` 三 kind
  dispatch，`agentHookEventSchema` 变为 zod discriminated union。
  - 7 个 inline agent 插件 (amp / kilo / mimo-code / opencode / omp / pi /
  hermes) 从 HTTP `fetch(/agent-event)` 切换到本地 `appendFile` (JS/TS) 或
  `open(log, "a")` (Python)。
  - `pierHookCommand` 输出首位固定 `"agentEvent"` 位置参数。

### Removed

- `**pier.codex.cost` widget 三件套**（`cost-widget.tsx` / `cost-card.tsx` /
  `cost-usage-visualization.tsx`）+ `usage.refreshCost` RPC +
  `CodexCostUsageSnapshot` 类型 + `CodexAccountsSnapshot.costUsage` 字段 +
  `setCostUsage` 服务方法 + 15+ `pier.codex.accounts.settings.cost*` /
  `pier.codex.widget.cost*` / `pier.codex.widget.noCost*` i18n key。
  成本相关的 renderer refresh 分支（`refreshCost` / `costRefreshing`）从
  `use-accounts-refresh.ts` 移除。
- `**agent-hook-server`** (HTTP loopback) 与相关 test 文件删除。
- 环境变量 `PIER_AGENT_HOOK_PORT` / `PIER_AGENT_HOOK_TOKEN` 从 PTY hookEnv
中删除。`hookEnv()` 变同步（不再等 loopback server 启动）。
- `LEGACY_HOOK_MARK` 常量删除；`isPierHookCommand` 只识别新 marker
`PIER_AGENT_HOOKS_DIR`。

### Fixed

- **Codex 账号与配额物料完整展示。** 配额窗口改为按 `limitId` 排序的单一 CSS
  Grid；`auto-fit` / `minmax` 按内容宽度自动单列或多列，窄卡不再丢模型配额，
  宽卡左右排布，多余高度不再拉伸指标行。
- **Codex 账号切换菜单恢复可用布局。** 无其他账号时不再显示切换入口；多账号
  菜单只列出可切换目标，并以可用视口约束 16rem 最小宽度。切换期间按钮只显示
  单一 loading 指示，不再叠加切换图标。
- **成本物料 Tooltip 不再被卡片裁切。** 图表 hover 明细通过共享
  `ChartTooltipPortalContent` 渲染到卡片滚动层之外，按视口自动翻转并约束位置；
  浮层保持 `pointer-events: none`，不干扰图表 hover 命中。

- `**ForegroundActivityAggregator.acquireHookAgentEntry**` 迟到的
`Stop` / `ToolComplete` / `SubagentStop` / `error` 事件不再销毁已有 task /
shell activity（仅 `SESSION_CREATING_EVENTS` 才允许覆盖为 agent kind）。
- `**agentLaunched**` 覆盖已有 hook agent activity 时清 `hookTtlTimer`，防止
30min 后回落 ready 的旧 callback 触发。
- **Task tab 退出状态谎报**——任务结束后 tab 永久回落 "Running" 谎报运行中。
五处根因一并修复：
  - `taskFinished` 终态常驻：移除 5s linger 清理，task activity 保留最终
  status 直到 panelClosed / rerun / 新命令接管（tab 退出 chrome 的唯一
  live 来源，消失即回退 mount 时的陈旧 "Running" 基线）。
  - 新增 `ptyExited(panelId)`（native process-close 改走此入口）：pty 进程
  退出 ≠ 面板关闭——task 面板保留终态 activity，只清 hook 证据；其余面板
  等同 `panelClosed`。
  - `taskLaunched` 门面把内部 windowId（如 `"main"`）换算成 electron
  BrowserWindow.id 字符串——否则广播路由 `Number("main")=NaN`，task
  activity 永远到不了 renderer。
  - 新共享单源 `taskTabStateForActivityStatus`：renderer 活动 overlay 与
  main 持久化 `taskExitTabPatch` 输出同一份完整 tab state
  （指示器+label+色 token），修 label 停留 "Running" 的半更新。
  - `bin/pier-cli-parser.js` `run.list`/`run.spawn` 的 `projectRoot` 字段
  改回 schema 现名 `projectRootPath`（#53 迁移遗漏，CLI `tasks list/run`
  与 terminal-task-status e2e 因此全断）。
- **Task 面板 reload/restart 混淆**——renderer reload（main 进程未死）被当作
app restart 处理：running task 面板渲染静态 "Cancelled" 结果卡，活 pty 沦为
不可见僵尸（reconcile 按 layout 上报而保留）, 完成后 tab 又与卡片矛盾。
重设计为「活性单源 + 磁盘不说谎」：
  - 新契约字段 `TerminalPanelSessionSnapshot.taskLive`：main 以
  foreground-activity 的 task slot（终态常驻, 与面板同寿命）担保该 task
  面板寿命仍在本进程内；`read-session` 注入。
  - renderer 结果卡只给真死面板（`task && !taskLive`）；live 面板照常渲染
  终端 → `create` → swift 对已存在 panelId 纯 reattach（PTY/scrollback
  零销毁, 与 C 方案对齐）。`restoredTaskTabPatch` 推断层删除。
  - `resolveCreateTerminalLaunch` 增 `taskLive` 直通分支：reattach 时 task
  元数据原样保留, 不再把 running 强转 cancelled 落盘（否则真实退出时
  `patchTaskStatus` 的 running 守卫失败, 终态永久丢失）。
  - 新增启动孤儿清算 `reconcileOrphanedRunningTasks()`（`app.whenReady` 内
  先于窗口恢复）：上进程遗留的 running 一律 cancelled（exitReason/Source
  `"restore"`, 该枚举首个消费者）+ Cancelled tab chrome 落盘。
  - e2e 实证：reload 重挂（终端非卡片, 存活 pty 退出后 tab 仍正确翻
  succeeded）+ restart 清算（Cancelled 卡 + Cancelled tab）双场景 ×2 稳定。
- **上游漏更新的死测试修复**（均在 clean main 上失败）：
  - `workspace-host.test.tsx` 9 例：#53 preload API 改 `pier.window.getContext`
  命名空间后 mock 仍是平铺 `getWindowContext`。
  - `terminal-panel-lifecycle.test.tsx` 3 例：#56 状态栏恒挂载（自锁修复）与
  #57 删除运行时 tab-patch 通路后, 测试仍钉旧契约/不可能值
  （"old runtime tab" 等无 emitter 的死期望）。
- **Layout 保存 500ms debounce 空窗**——面板创建后 <500ms 内 reload 会恢复
旧 layout：新面板从 UI 消失, 其活 pty 被 reconcile 判孤儿回收。
`workspace-host` 增 `beforeunload` flush：有未落盘变更时立即补发
`saveLayout`（invoke 消息投递即达 main, renderer teardown 不影响写盘）。
- **e2e 无人值守可靠性**：
  - `command-palette.spec.ts` 用显式条件等待（`[cmdk-input]` 可见等）替代
  固定 `waitForTimeout` 睡眠——冷启动慢机上点击不再竞速 UI。
  - `native-terminal-focus.spec.ts` 五个 osascript System Events keystroke
  测试增加投递能力探测（首个门控测试内 6s 试写 marker, 模块级缓存判定）：
  无人值守/缺 Accessibility 权限时显式 SKIP 而非 3×retry 失败。
- `**pnpm check` 纳入 unit + component 测试套件**——此前门禁不含任何测试,
是 12 个死测试烂在 main 的直接原因（AGENTS.md 同步更新）。
- `**buildBroadcast`** 浅拷贝 `activity` 引用，防同进程 listener 意外
mutate 污染 aggregator 内部状态。
- `**Cargo.toml` name 派生** 用 `[package]` 段锚定正则，修复
`[[bin]] name` 排在 `[package] name` 之前时项目名错取的 bug。
- `**upsertProjectFromPath` 并发**——`Map<rootPath, Promise<Project>>` 去重
in-flight 请求 + `mutate` 回调内二次 find 兜底，防止同 rootPath 落两条
不同 UUID 的记录。
- `**resolvePanelContextForPath` 静默 catch**——加一次性 warn 让磁盘故障
等失败可见。
- **emit `commandStart` sed 转义链**——前置 `head -c 4096` 后置
`tr -d '\000-\037\177'` 剥控制字符再 sed 转义 `\` 与 `"`，防命令行含
换行/tab/NUL 破坏 JSONL 行结构。
- `**JsonlObserver.processLine` disposed 守卫**——dispose 后剩余行不派发。
- `**omp/pi` 生成插件** 从 `require("node:fs/promises")` 改为
`await import("node:fs/promises")`，兼容 ESM-only Node 20+ 宿主
（原 `require` 在 ESM 环境会 `ReferenceError` 被 catch 静默吞掉，事件全丢）。
- `**hermes` Python except** 收紧到 `except OSError`，不再宽泛 catch
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
- ✅ Task 生命周期 wire：`task-service.startRun` / `completePanel` / `cancelRun` 走 `onTaskActivity` 回调转发 `foregroundActivityService.taskLaunched` / `taskFinished` → `ForegroundActivityAggregator`
- ✅ Project registry renderer 面：`pier://project:list` / `pier://project:changed` IPC + `PierProjectAPI` preload + `useProjectStore` + `ProjectBridge`（`pier://project:get` 早期实现，后续 hygiene sweep 因 0 caller 删除，见下）
- ✅ `panel-context-state.ts:keyForContext` 清 legacy `projectRoot` fallback 一层
- ✅ `PanelContext.projectRoot` 删（→ `projectId + projectRootPath`）
- ✅ `panel-context-resolver` 输出改产 `projectRootPath`；`upsertProjectFromPath` 兜底 catch 保留（Electron `app.getPath` 不可用时 project 保持 null，`projectRootPath` 从 gitRoot/cwd 派生）

### Cleanup (double-write collapse)

双写与 pragmatic 收敛清理，达 GREEN 终态：

- ✅ **删 `TERMINAL_TAB_CHROME_PATCHED` 广播**：main→renderer task exit chrome 通路统一走 `FOREGROUND_ACTIVITY_CHANGED` + `activityTabChromeOverlay`。删 `TerminalTabChromePatchEvent` contract、`onTabChromePatch` preload、`forwardTabPatch` wiring 依赖、renderer `mergeTabChrome` 4 层缩到 3 层（base → restore-patch → activity）。
- ✅ **删 `foreground-activity` aggregator 中孤儿 `ignoredNativeUserClosePanels` Set + `ignoreNextNativeUserClose` / `consumeIgnoreNativeUserClose` API**：该状态实际由 `terminal-task-lifecycle` 维护并消费（`terminal.ts` 唯一 caller）；aggregator 侧的副本 0 caller，双源同义 collapse 到单源。
- ✅ `**src/main/ipc/agent-session.ts` 改名 `foreground-activity.ts`**；`agentSessionService` → `foregroundActivityService`，`registerAgentSessionIpc` → `registerForegroundActivityIpc`，`closeAgentSessionResources` → `closeForegroundActivityResources`。5 处 callsite 全更名。共享契约 `src/shared/contracts/agent-session.ts` 保留（仍承担 `agentHookEventSchema` + `agentTabIconId` icon 工具函数）。
- ✅ `**terminal-task-lifecycle.ts` 职责 JSDoc 清晰化**：native shell 回调协调器（exit hint 排序 / dedupe / ignore-close / 持久化 patchTab+patchTaskStatus）。broadcast 责任明确外包给 `foregroundActivityService.taskFinished` → aggregator 单源。
- ✅ **删陈旧 sync 维护提醒**：`foreground-activity.ts:111-113` 老 `runtimeStatusForHookEvent` 与 `agent-session.ts` 同步注释（引用的函数已删）。`pi.ts:16` / `shared.ts:118` 相同注释同步更新为当前 `activityStatusForHookEvent`。

### Fixed

- `**task-service.cancelRun` 覆盖已 success activity → cancelled 的回归 bug**：
`taskRuns.cancel` 只把 pending/running 节点改状态，但 task-service 遍历 fire
`onTaskActivity.onFinished({ status: "cancelled" })` 时不看 `node.status`。
多 task DAG 部分完成后 restart 会让已 succeeded 的 tab 在 5s linger 内闪回
cancelled。修：filter 只对 `node.status === "cancelled"` 才 fire。
- **App quit 500ms debounce 窗口内 mutate 丢失**：`flushProjectStore` +
`flushPanelContextState` 从未在 `before-quit` 调用。加入
`window-service.flushOpenWindows` / `flushWindowBeforeClose` batch，与已有
flush 队列同步落盘。
- `**upsertProjectFromPath` 失败日志 flood**：`upsertWarned` 一次性 flag 换成
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
