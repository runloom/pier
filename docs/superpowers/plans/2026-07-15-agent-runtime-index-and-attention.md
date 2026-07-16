# Agent Runtime Index + Attention Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not expand scope into Canvas attach, Agents 侧栏, or host DAG.

**Goal:** 落地 [Agent Runtime Index 与注意力通知产品设计](../specs/2026-07-15-agent-runtime-index-and-attention-design.md) 的 **P1（L1/L3/L4）** 与 **P1.5（L2）**：本机 Agent Index facade、标题栏全局计数可点、命令面板发现列表、L4 `focusWaiting`（仅快捷键）、Attention 系统通知 click→focus。FA 仍为活动语义唯一源；本窗 FA 广播隔离不变。

**Architecture:**

```text
FA aggregator.snapshot()          ← 语义源（已支持无 windowId = 本机）
  ├─ publication / 本窗 store     ← tab / 状态栏 / 本窗仪表（不变）
  └─ Agent Runtime Index facade ← 投影 kind:agent + agentRef + focus
        ├─ 标题栏全局计数 / 短列表
        ├─ 命令面板 list；L4 focusWaiting 仅快捷键
        └─ Attention（P1.5）← 消费 FA 变迁，通知 click → Index.focus
```

`focus(agentRef)` 复用现有 `panel.focus`（含 `windowId`，经 `RendererCommandService` 先激活窗再 reveal）。

**Tech Stack:** Electron IPC + zod shared contracts + main service facade + zustand store（Index 专用，勿写入 FA store）+ 现有 QuickPick / action registry + vitest。

**Spec:** [docs/superpowers/specs/2026-07-15-agent-runtime-index-and-attention-design.md](../specs/2026-07-15-agent-runtime-index-and-attention-design.md)

### main 同步纪要（2026-07-15 · `54665211`）

已 fast-forward 合并 `origin/main`（#88：账号插件 hardening + Host Content Dialog + `pier.grok`）。

| 远程变更 | 对本计划影响 |
|---|---|
| FA / title-bar / notification IPC / agent start actions | **无改动**；Index 落点仍有效 |
| `AppContentDialogHost` + 插件 `dialogs.open/update/close` | **不改架构**：Index 发现用命令面板 QuickPick，不是 content dialog；失败反馈仍 `toast` / `showAppAlert` |
| `agentTabTitleFromTerminal`（长 OSC 不进 tab） | QuickPick **主标题用 catalog `agentId` label**；Index 无 OSC 字段，勿仿造长 prompt 标题 |
| Codex/Grok 账号私有域 | 强化「账号≠Index」；本计划继续不碰 accounts |
| AGENTS.md 弹窗/浮层规范加长 | 实施时遵守；与 Index 无冲突 |

**结论：产品设计与实施计划方向不需返工；仅补上述纪律。**

### 实现状态（2026-07-15）

**P1（Task 1–7）与 P1.5（Task 8–10）已实现**；Task 11 自动化门禁以相关 unit 为准。手工多窗/OS 通知清单仍建议发版前点验。

**非本计划范围：** Canvas 持久绑定、宿主 `attach/detach`、Agents 侧栏、插件正式 `agents.list/subscribe`（可在 P1.5 末尾留扩展点但不作为门禁）、通知历史库。

### 审查结论（正确性 / 冗余 / 多源）

**总评：架构正确，可实施；须按下列纪律消除冗余与伪多源。**


| 维度         | 裁决                                          |
| ---------- | ------------------------------------------- |
| 与 spec 一致性 | 通过：FA 语义单源、Index facade、双通道、P1 发现面=命令面板+标题栏 |
| 是否冗余       | 有条件：Task 6/7 列表必须同源；Task 7/10 标题栏合并；排序只在一处  |
| 是否多源       | 无第二套活动语义，但若做错会出现「镜像漂移 / 刷新双策略 / 计数双口径」——见下  |


**允许的双通道（不是多源）：**


| 数据                        | 范围          | 消费者                             |
| ------------------------- | ----------- | ------------------------------- |
| FA publication → FA store | 本窗          | tab、状态栏、activity-overview、关面板守卫 |
| Index list → Index store  | 本机 agent 投影 | 标题栏计数、发现 QuickPick、focusWaiting |


二者都只读 **同一 FA aggregator**；Index **禁止**自算 status。

**禁止的多源 / 伪多源：**

1. 改 FA publication 为全机广播，或把 Index 条目 `setState` 进 FA store。
2. Index store 本地改 `status` / 本地猜 waiting（只允许整表替换为 main 快照）。
3. **两套刷新策略并行**：禁止「FA onChanged pull」与「Index push subscribe」同时作为真相；P1 **只选一种**（见 Task 3/4）。
4. **两套列表构建**：标题栏短列表与命令面板全量列表必须共享同一 builder（参数 `limit?`）。
5. **两套排序**：Needs you 序只在 `shared` 纯函数；main `listMachine` 调用它；renderer **不得**再实现第二套优先级。当前窗加权若需要，作为该纯函数的可选参数，仍单源。
6. **两套计数口径**：标题栏只读 Index counts；`activityCounts(FA)` 仅服务本窗仪表。文档写清，避免后人再把 taskRuns 加回标题栏 Agent 槽。

**可删减的冗余：**


| 项                                  | 处理                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Task 10 与 Task 7 标题栏强调             | **合并进 Task 7**；Task 10 仅留权限降级文案 / 设置开关（可并入 Task 9 收尾）                                                                   |
| Task 3 subscribe「可选」含糊             | P1 **必选 Index push**：每次 FA aggregator 发布后，向所有窗推送 Index 快照（独立 channel）。删除「用本窗 FA onChanged 触发 list」作为主路径（他窗变更会漏，且形成双刷新源） |
| focusWaiting 既是 main API 又是 action | **保留**：main 能力 + 薄 action 封装，不算冗余                                                                                       |
| Task 5 feedback helper             | **保留**：多入口共用，防文案分叉                                                                                                      |


**参考落点：**


| 能力                     | 现网路径                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| FA 本机 snapshot         | `src/main/services/foreground-activity/aggregator.ts` → `snapshot()`      |
| 按窗 publication         | `src/main/ipc/foreground-activity-publication.ts`                         |
| 本窗 store / counts      | `src/renderer/stores/foreground-activity.store.ts`                        |
| 标题栏                    | `src/renderer/components/common/title-bar.tsx`                            |
| 跨窗 panel focus         | `src/main/app-core/panel-commands.ts` + `renderer-command-service.ts`     |
| QuickPick 范本           | `src/renderer/lib/actions/terminal-list-quickpick.ts`                     |
| Agent start actions    | `src/renderer/lib/actions/agent-start-actions.ts` / `new-agent-action.ts` |
| 系统通知（无 click）          | `src/main/ipc/notification.ts` + `src/shared/contracts/notification.ts`   |
| 插件 agents（仅 selection） | `src/renderer/lib/plugins/host-agents-context.ts`                         |


---

## Phase map


| Phase    | 闭环       | Tasks     |
| -------- | -------- | --------- |
| **P1**   | L1 L3 L4 | Task 1–7  |
| **P1.5** | L2       | Task 8–10 |
| **验证**   | 门禁       | Task 11   |


---

### Task 1: Shared 契约 — Index 投影类型 + FA→Index 映射

**Files:**

- Create: `src/shared/contracts/agent-runtime-index.ts`
- Create: `tests/unit/shared/agent-runtime-index-schema.test.ts`
- Create: `tests/unit/shared/agent-runtime-index-project.test.ts`（纯函数映射）
- **Step 1: 定义 schema / 类型**

锁定产品口径（spec §4）：

- `agentRef`：不透明 `string`（实现可用 `windowId\0panelId` 派生，但契约不暴露解析义务）
- Index 条目字段：`agentRef`, `agentId`, `status?`, `windowId`, `panelId`, context 摘要可选字段, `updatedAt`, `stateStartedAt?`, `source`
- **不含** `attachments[]`
- `projectAgentActivities(activities: ForegroundActivity[]): AgentRuntimeIndexEntry[]`：仅 `kind === "agent"`；条目生命周期随 FA
- `sortAgentIndexEntries(entries, opts?)`：**唯一** Needs you / 时间排序实现（main list 与任何 UI 预览共用）
- **Step 2: 单测**
- 非 agent 活动被丢弃
- launch 无 status 仍产出条目
- 同 panel 一条；`agentRef` 稳定可复现
- 非法 status 拒绝（若走 zod）
- **Step 3: 跑测**

```bash
pnpm test:unit -- agent-runtime-index
```

Expected: PASS

---

### Task 2: Main Index facade — list + focus

**Files:**

- Create: `src/main/services/agent-runtime-index/index.ts`（或 `agent-runtime-index-service.ts`）
- Create: `src/main/services/agent-runtime-index/focus.ts`
- Create: `tests/unit/main/agent-runtime-index.test.ts`
- Modify: `src/main/app-core/app-core.ts` / command-router-services（按现有 wiring 模式挂服务）
- **Step 1: `listMachine()`**
- 调用 FA aggregator `snapshot()`（**无** `windowId`）
- 经 `projectAgentActivities` 投影
- 排序：**仅**调用 shared `sortAgentIndexEntries(entries, opts?)`（spec §4.5）；禁止在 main/renderer 另写一套 Needs you 优先级
- **Step 2: `focus(agentRef)`**

解析 scene（仅 main 内知道派生规则）→ 调现有 panel focus 路径（`executePanelFocusCommand` / `RendererCommandService`，带 `windowId`）。

返回结果判别：


| 结果            | 含义                   |
| ------------- | -------------------- |
| `ok`          | 已请求激活                |
| `panel_gone`  | 条目不在当前 Index / 面板不存在 |
| `window_gone` | 窗口不存在                |
| `error`       | 其它（带 message）        |


- **Step 3: `focusWaiting()`**
- `listMachine` 过滤 Needs you（`waiting`  `error`）取第一条 → `focus`
- 空 → `empty`
- **Step 4: 单测**
- mock aggregator snapshot 多窗多 agent → list 含他窗
- focus 调用带正确 windowId/panelId
- 失效 ref → `panel_gone`
- **Step 5: 跑测**

```bash
pnpm test:unit -- agent-runtime-index
```

---

### Task 3: IPC + preload + commands

**Files:**

- Create: `src/main/ipc/agent-runtime-index.ts`
- Modify: `src/main/index.ts`（register IPC）
- Modify: `src/shared/contracts/commands.ts`（若走 PierCommand）**或** 独立 invoke 通道（与 FA snapshot 同类；二选一，优先独立 invoke 以免撑大 command 面）
- Modify: `src/preload/index.ts`（或新建 `agent-runtime-index-api.ts`）
- Modify: 类型声明 `window.pier`（preload 类型文件）

建议 IPC：


| Channel                                 | 传输                 | 用途                                                                                |
| --------------------------------------- | ------------------ | --------------------------------------------------------------------------------- |
| `pier:agent-runtime-index:list`         | invoke             | 启动兜底 / 手动刷新                                                                       |
| `pier:agent-runtime-index:focus`        | invoke             | `{ agentRef }` → result                                                           |
| `pier:agent-runtime-index:focusWaiting` | invoke             | → result                                                                          |
| `pier:agent-runtime-index:changed`      | main→renderer push | **P1 必选**：FA aggregator 每次发布后，对所有窗推送本机 Index 快照（独立 channel，**不**改 FA publication） |


- **Step 1: 实现 handlers + preload API**（含 changed 订阅）
- **Step 2: 单元测试 IPC**（仿 `tests/unit/main/notification-ipc.test.ts`）
- **Step 3: 确认本窗 FA IPC 行为未变**（既有 FA 单测仍绿）

```bash
pnpm test:unit -- foreground-activity
pnpm test:unit -- agent-runtime-index
```

**纪律：** Index 刷新真相只有 push 快照（+ 启动 list 兜底）。禁止再加「本窗 FA onChanged → list()」第二刷新路径。

### Task 4: Renderer Index store（双通道纪律）

**Files:**

- Create: `src/renderer/stores/agent-runtime-index.store.ts`
- Create: `src/renderer/components/common/agent-runtime-index-bridge.tsx`（或并入现有 bridge 旁路）
- Modify: `src/renderer/main.tsx` / app shell 挂载 bridge
- Create: `tests/unit/renderer/agent-runtime-index.store.test.ts`
- **Step 1: store 只镜像 Index**
- `entries`, `ts`（单调）
- `replaceFromSnapshot(payload)` 整表替换
- **禁止**局部改 `status`；**禁止** `useForegroundActivityStore.setState` 写入他窗活动
- **Step 2: bridge**
- 启动 `list` 一次兜底
- 只订阅 `pier:agent-runtime-index:changed` 推送
- **禁止**用本窗 FA `onChanged` 再拉 list（避免双刷新源 + 他窗漏更新）
- **Step 3: 单测** store 整表替换 / 乱序 ts 拒绝

---

### Task 5: focus 结果 → 用户反馈（共享 helper）

**Files:**

- Create: `src/renderer/lib/agent-runtime/focus-feedback.ts`
- Create: `tests/unit/renderer/agent-runtime-focus-feedback.test.ts`
- i18n: `src/renderer/i18n/locales/{en,zh-CN}/…`（新建 `agents.ts` 或并入 `command-palette.ts` / `terminal.ts`）
- **Step 1: 映射**


| result                       | UI                   |
| ---------------------------- | -------------------- |
| `ok`                         | 无 toast              |
| `empty`（focusWaiting）        | `toast`：「没有需要处理的智能体」 |
| `panel_gone` / `window_gone` | `toast.error` 短文案    |
| `error` + message            | `showAppAlert`       |


- **Step 2: i18n keys**（禁内联英文字符串）
- **Step 3: 单测** 映射表

---

### Task 6: 命令面板列表（L1）+ focusWaiting 快捷键（L4）

**Files:**

- Create: `src/renderer/lib/agent-runtime/agent-index-quickpick.ts`（**唯一**列表 UI builder）
- Create: `src/renderer/lib/actions/agent-runtime-actions.ts`
- Modify: `src/renderer/main.tsx` 注册
- Modify: `src/shared/commands.ts` / `keybindings.ts`（`pier.agents.focusWaiting`；`pier.agents.list`）
- Modify: i18n
- Create: `tests/unit/renderer/actions/agent-runtime-actions.test.ts`
- 参考: `terminal-list-quickpick.ts`
- **Step 1: 共享 QuickPick builder**

```ts
buildAgentIndexQuickPick(entries, { limit?: number; emptyAction?: "new-agent" })
```

- 分组 / 终端同源状态文案 / 空态集中于此
- 行主标题用 catalog agent label（无 OSC；对齐 `agentTabTitleFromTerminal` 纪律）
- Task 7 标题栏短列表 **必须** `limit: 8` 调用同一函数，禁止复制一份
- **Step 2: `pier.agents.list`**
- 打开全量 QuickPick → 选中 `index.focus` → focus-feedback；成功无 toast
- **Step 3: `pier.agents.focusWaiting`**
- 调 main `focusWaiting` → feedback（`surfaces: []`，仅快捷键；不嵌列表假行）
- **Step 4: 确认 L3 不改启动链路**（`start.*` / `new` 不变）
- **Step 5: 单测 builder 空态与分组

---

### Task 7: 标题栏全局计数 + 可点短列表 + Needs you 强调（L1 / L2 表面）

**Files:**

- Modify: `src/renderer/components/common/title-bar.tsx`
- Create: `src/renderer/lib/agent-runtime/index-counts.ts`
- **不要**为全局计数去改 `activityCounts` 语义（本窗仪表继续用 FA `activityCounts`）
- Modify: 相关 component 测
- i18n：aria-label
- **Step 1: 计数只读 Index store**
- `running`：`processing`  `tool`  无 status
- `needsYou`：`waiting`  `error`
- **移除**标题栏对 `useTaskRunsStore` / 本窗 FA `activityCounts` 的依赖（有意产品变更：标题栏 = 纯 Agent 本机信号；本窗 task 仍在 activity-overview）
- PR 说明写清此语义分叉，避免「多源计数」误解
- **Step 2: 可点 → `buildAgentIndexQuickPick(entries, { limit: 8 })`**
- **Step 3: `needsYou > 0` 时 warning 强调**（P1 一并做完，不必等 Task 10）
- **Step 4: 组件测**

---

### Task 8（P1.5）: 通知契约扩展 — payload + click

**Files:**

- Modify: `src/shared/contracts/notification.ts`
- Modify: `src/main/ipc/notification.ts`
- Modify: preload `notifications.system`
- Modify: `tests/unit/main/notification-ipc.test.ts`
- **Step 1: 扩展请求**

```ts
// 产品字段口径（命名实施可调）
{
  title: string;
  body?: string;
  kind?: "agent.attention" | string; // Attention 只发 agent.attention
  agentRef?: string;
  tag?: string; // replace 用
}
```

- **Step 2: main `Notification`**
- `notification.on("click", …)` → `index.focus(agentRef)`（若有）
- 支持 tag/replace（Electron `Notification` 能力范围内）
- 仍返回 `{ shown: boolean }`；权限拒绝 → `shown: false`
- **Step 3: 单测** click 回调触发 focus（mock Index）

---

### Task 9（P1.5）: Attention 服务

**Files:**

- Create: `src/main/services/agent-attention/attention-service.ts`
- Create: `src/shared/contracts/agent-attention.ts`（设置：enableErrorAttention 默认 false；cooldownMs 默认 180000）
- Create: `tests/unit/main/agent-attention.test.ts`
- Modify: FA broadcast 路径旁路挂钩（在 aggregator 发布后或 publication 前比较 prev/next status）
- Modify: preferences 或独立小 json（若需持久化开关；可先硬编码默认 + 后续设置页）
- **Step 1: 状态变迁检测**
- 输入：本机 FA snapshot 前后 diff
- 进入 `waiting`（及可选 `error`）→ attention candidate
- 离开 Needs you → 清强调态（若有 main 侧标记）
- **Step 2: 不扰己判定（spec §5.2）**
- 目标窗为前台 Pier 窗 **且** 该窗 active panel == 目标 panel → **不**发系统通知
- 否则尝试 `notifications` 系统通知（`kind: agent.attention`）
- **Step 3: 冷却 / replace**
- 同 `agentRef` 冷却 3min；优先同 tag replace
- **Step 4: 单测**
- 聚焦中不通知
- 失焦通知
- 冷却期内不重复
- 默认不因 error 通知

---

### Task 10（P1.5）: Attention 收尾（权限文案 / 可选设置）

**说明：** 标题栏 Needs you 强调已在 Task 7 完成，本任务不再改标题栏交互。

**Files:**

- i18n：权限拒绝 / 降级说明（若设置页引导）
- Optional: 设置项 `enableErrorAttention`（默认可硬编码 false，设置页可 follow-up）
- **Step 1: `shown: false` 路径不冒充已通知**（单测或 Attention 测覆盖）
- **Step 2: 通知 click 失败走 Task 5 feedback（与 Task 8 联调）**
- **Step 3: 手工清单并入 Task 11

---

### Task 11: 验收门禁与回归

**Files:**

- 视需要: `tests/e2e/…`（若 e2e 可多窗；否则以单元 + 手工清单为准）
- Modify: 本 plan 或 spec 勾选门禁
- **Step 1: 自动化**

```bash
pnpm test:unit -- agent-runtime-index
pnpm test:unit -- agent-attention
pnpm test:unit -- notification-ipc
pnpm test:unit -- foreground-activity
pnpm check  # 或至少 typecheck + 相关 unit
```

- **Step 2: 手工 / e2e 门禁（对照 spec §9）**


| #   | 门禁   | 操作                               |
| --- | ---- | -------------------------------- |
| 1   | 语义单源 | Index 条目随关面板消失；status 与 FA 一致    |
| 2   | 双通道  | 本窗状态栏仍只反映本窗；标题栏可见他窗 Agent        |
| 3   | 回跳   | 列表 / 通知 click 能 focus；失效有 toast  |
| 4   | 跨窗   | 窗 A 列出并 focus 窗 B waiting Agent  |
| 5   | 注意力  | 聚焦该面板不弹系统通知；失焦可弹；拒绝权限不谎报         |
| 6   | 启动   | start 后消抖内可不出现在 Index；之后出现；失败无静默 |
| 7   | 边界   | 无侧栏、无 attachments 字段、未改 FA 按窗广播  |


- **Step 3: 更新 spec 状态行**为「P1/P1.5 已实现」或在本 plan 顶部标记完成日期（仅当门禁全绿）

---

## 实施顺序建议

```text
Task 1 (契约)
  → Task 2 (main facade)
  → Task 3 (IPC)
  → Task 4 (renderer store)
  → Task 5 (feedback)
  → Task 6 + Task 7 可并行（都依赖 4/5）
  → Task 8 → Task 9 → Task 10
  → Task 11
```

## 风险与纪律

1. **禁止**为跨窗把 FA publication 改成全机广播。
2. **禁止**在 Index store 里复制可变 status 状态机（只整表替换 main 快照）。
3. **禁止**双刷新源（Index 只 push + 启动 list 兜底）。
4. **禁止**双列表 builder / 双 Needs you 排序实现。
5. **禁止** P1 插件 API 膨胀为必达；宿主 IPC 闭环优先。
6. `agentRef` 寿命按 spec §4.2；不要在本计划「顺便」做逻辑 id 升级。
7. 操作反馈：成功 focus/启动无 success toast；失败分 toast / alert。
8. 标题栏 Agent 计数与本窗 `activityCounts`/taskRuns **刻意分口径**；勿重新合并成「一个 counts 函数打天下」。

## 完成定义

- P1：L1/L3/L4 手工可演示；Task 1–7 测绿。  
- P1.5：L2 手工可演示（含不扰己与 click）；Task 8–10 测绿。  
- Task 11 门禁表全部勾选。

