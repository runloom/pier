# 终端结果查看态收敛：单一终态（Terminal End State）

**日期：** 2026-07-30  
**状态：** **已拍板并落地 PR1–PR4**（行为产品 v1；架构 EndState 单源）  
**拍板摘要：**

| 项 | 决定 |
|----|------|
| 产品路径 | **路径 A**：agent / task 结束后保留结果面板，仅显式关闭（⌘W / 关 tab / 运行控制「关闭」） |
| 会话结束语义 | 智能体会话结束 **≠** 任务成功 → **不打绿勾**；非 0 退出码才 `failed` |
| 退出文案 | buffer 注入（`injectDisplayText`）+ i18n；不做 web banner |
| 架构方向 | 抽出 **面板终态（`TerminalEndState`）** 为唯一派生源；tab / 保留 / 键盘 / 文案 / 持久化只消费它 |
| 非目标 | 不改 shell any-key 关窗；不引入任务看板 / SQLite 任务台账；不重做 FA 全局模型 |
| 一期 IPC | **先 session 物化 EndState（PR2）**；广播作 PR4 |
| shell 与 EndState | shell **不进** EndState，保持 any-key 关窗 |
| task 绿勾 | **保留** task success 绿勾（与 agent 会话结束区分） |
| bufferInjected | **仅内存**；remount 结果卡不重复 inject |

---

## 0. 一句话

把「进程已结束、面板仍开着供查看」从 **多层 merge + 模块 Map + 读取消毒 + 乐观补丁** 收敛成：

```
ProcessExit / Session 事实
        │
        ▼
  TerminalEndState（按 panelId 一份）
        │
        ├── buffer 文案
        ├── surface / panel 保留
        ├── 键盘钉 web
        ├── tab chrome（icon / failed / 无 success）
        └── session 持久化（只写派生结果）
```

**产品行为保持 v1 不变**；本文只收所有权与数据流。

---

## 1. 背景

### 1.1 产品 v1 已落地的行为

| 能力 | 现状入口 |
|------|----------|
| 结果面板保留 | main `shouldRetainTaskSurfaceOnProcessExit` + renderer `shouldRetainTaskResultPanel` |
| 禁止任意键关 | `useTaskResultKeyboardRetain` + 忽略 retain 面板的 `SURFACE_CLOSE` |
| 退出文案 i18n | `SHOW_CHILD_EXITED` 吞英文 → renderer 拼串 → `injectDisplayText` |
| Agent 图标不丢 | FA 清空后 residual overlay + latch `agentId` |
| 无绿勾 | main 干净退出剥 `tab.state` + read 消毒 + base strip + live 乐观更新 |
| 失败红叉 | 非 0 退出码 → `failed` |

### 1.2 为何还要收敛

当前能工作，但是 **防御式补丁叠出来的闭环**：

```
child-exited / process-closed / command-finished
  │
  ├─ FA 清 slot（agent 消失）
  ├─ session 写 agent.exited + tab 补丁（main，renderer 默认不订阅）
  ├─ latch Map（非 React 状态）+ epoch 硬刷
  ├─ 四层 mergeTabChrome（session → FA → residual → task*）
  ├─ readSession 消毒历史 succeeded
  └─ child-exited 乐观改 savedSession
```

问题：

1. **多源叠 merge** 易再引入 success / running 泄漏  
2. **latch 是模块 Map**，靠 epoch 触发重渲，HMR / 多窗边界脆弱  
3. **session 与 UI 不同步推送**，live 靠乐观更新，remount 靠读消毒  
4. **main / renderer 保留判定双份**，语义靠人工对齐  
5. 新人无法从一处读懂「结果查看态」

局部再补 strip / sanitize **不改变数据面所有权**。

### 1.3 与既有子系统边界

| 系统 | 关系 |
|------|------|
| ForegroundActivity | **运行中** 活动权威；终态 **不是** FA 再挂一个 ready/succeeded |
| TaskRunsSnapshot | **任务** 活体与终态权威；agent 会话不冒充 task success |
| terminal-session-state | 持久化 agent / tab / task 元数据；终态写入由其消费 EndState 派生 |
| Ghostty host copy | 启动失败 / 粘贴确认仍走 catalog；**进程退出主路径**走 inject |

---

## 2. 目标与非目标

### 2.1 目标

1. 每个 terminal panel 在进程结束后有一份可测试的 **`TerminalEndState`**  
2. tab / 保留 / 键盘 / buffer 文案 / session 写入 **只读 EndState 或由其派生的纯函数**  
3. 删除长期依赖：模块 latch Map、`agentExitEpoch`、read 路径 `sanitizeAgentExitTab`（迁移完成后）  
4. main 与 renderer **共用同一 retain / dismiss / tab 语义**（shared 纯函数）  
5. 历史磁盘 `succeeded` 一次 migrate 写回，账本干净  

### 2.2 非目标

- 不改变路径 A 产品语义（保留结果、显式关闭、会话结束无绿勾）  
- 不把普通 shell 的 any-key 关窗改成强制保留  
- 不做跨 panel 的结果列表 / 历史浏览器  
- 不合并 TaskRuns 与 Agent 为统一「作业」模型（边界保留）  
- 不在本设计重做 Ghostty 启动失败 catalog 管线  

---

## 3. 终态模型

### 3.1 类型（shared）

建议：`src/shared/contracts/terminal-end-state.ts`

```ts
/** 结果查看角色：决定默认 dismiss 与文案 role */
export type TerminalEndRole = "shell" | "agent" | "task" | "taskOutput";

/**
 * 面板是否处于「进程已结束、仍开着看结果」。
 * 运行中为 null / absent；一旦进入 end 则单调，直到 panel 关闭或 relaunch。
 */
export type TerminalEndState = {
  panelId: string;
  role: TerminalEndRole;
  /** 进程退出码；process-closed 先到时可能暂缺，后由 command-finished 补全 */
  exitCode?: number;
  finishedAt: number;
  runtimeMs?: number;

  /** agent 结果查看时保留品牌 icon；非 agent 可无 */
  agentId?: AgentKind;

  /**
   * tab 结果呈现（已是最终 UI 语义，不是 session 原始补丁）
   * - clean agent：无 status（不写 succeeded）
   * - failed agent / task：failed + 可选 label
   * - task success：仍允许 succeeded（任务语义）
   */
  tab: {
    iconId?: string;
    title?: string;
    /** 缺省 = 不渲染 status 指示器 */
    status?: PanelTabStatus;
    colorToken?: string;
    label?: string;
  };

  retainPanel: true; // end state 成立时恒 true；shell 干净 any-key 不进 end 或 retain=false
  dismissMode: "any-key" | "explicit";

  /** 已注入 buffer 则 true，防重复 inject */
  bufferInjected?: boolean;
};
```

### 3.2 派生规则（纯函数，shared）

| 输入事实 | role | retain | dismiss | tab.status |
|----------|------|--------|---------|------------|
| agent session 退出，code 0 / 未知 | agent | true | explicit | **omit** |
| agent session 退出，code ≠ 0 | agent | true | explicit | failed |
| task / task-output 成功 | task* | true | explicit | succeeded |
| task / task-output 失败 | task* | true | explicit | failed |
| task 用户取消 | task* | true | explicit | cancelled |
| 普通 shell 退出 | shell | false* | any-key | omit 或沿用 shell 策略 |

\* shell 默认不进「结果查看 EndState」：process-closed 仍可转发 `SURFACE_CLOSE`。若未来 shell 也要保留日志，再扩展，不在本版。

**硬规则：**

- `role === "agent"` 且 `(exitCode === undefined || exitCode === 0)` → **禁止** `tab.status === "succeeded"`  
- Agent 结果态 **禁止** 用 TaskRuns success 覆盖 icon / title（task overlay 仅在真正 task 面板生效）

### 3.3 状态机（每 panel）

```
         create / relaunch
               │
               ▼
          ┌─────────┐
          │ running │  ← FA agent|task|shell + 可选 TaskRuns 活跃
          └────┬────┘
               │ child-exited / process-closed / task complete
               │（retain 角色）
               ▼
          ┌─────────┐
          │   end   │  ← TerminalEndState 存在
          └────┬────┘
               │ 显式关闭 panel / relaunch 同 panel
               ▼
            gone
```

- **running → end**：单调；end 上允许 **补全 exitCode**（先 process-closed 后 command-finished）  
- **end → running**：仅 relaunch / 重启智能体  
- **end → gone**：关 panel；清 EndState + session 策略保持现有 remove  

---

## 4. 所有权与数据流

### 4.1 谁写 EndState

**唯一写入方：main**（与 FA / TaskRuns 同级的权威）。

触发：

1. `process-closed`（processAlive=false）且 retain  
2. `child-exited`（可补 runtimeMs / 与 inject 协同）  
3. task lifecycle complete（task 面板）  
4. `command-finished` 补 exitCode（agent 已 end 时 CAS 更新）

写入后：

- 更新 `terminal-session-state`（agent / tab **按 EndState.tab 派生**，不再独立 `agentExitTabPatch` 分叉语义）  
- 广播 `pier://terminal-end-state:changed`（或并入现有 session / 专用通道）  

**renderer 禁止** 再发明第二套 latch Map 当权威；本地 store 只镜像广播。

### 4.2 谁读 EndState

| 消费者 | 用法 |
|--------|------|
| buffer inject | `formatGhosttyChildExitedBufferText` 读 role / dismiss / exitCode；inject 后标 `bufferInjected` |
| surface retain | main `shouldRetain…` → `endState != null || running task/agent 预测` |
| keyboard retain | renderer：`endState != null` → 钉 web |
| tab chrome | `effectiveTab = merge(running overlays, endState.tab)`；**end 时 running FA 已空**，以 end 为准 |
| 结果恢复 | remount：`readSession` → 若 agent.exited 或 task 终态 → 物化 EndState 镜像 |

### 4.3 运行中仍用 FA / TaskRuns

```
running:
  effectiveTab = merge(session.tab, activityOverlay, taskRunOverlay, …)

end:
  effectiveTab = endState.tab  （+ 可选 display title 覆盖）
  // 不再 residual + strip + sanitize 三连
```

**删除（迁移完成后）：**

- `agent-result-panel-latch.ts` 模块 Map  
- `agentExitEpoch`  
- `tabChromeForAgentResultBase` / 呈现层 strip 作为主路径（可留纯函数给测试）  
- `sanitizeAgentExitTab` 读路径（migrate 后）  
- child-exited 乐观 `setSavedSession` 补丁（由镜像 store 替代）

### 4.4 架构图

```
┌──────────── Ghostty / lifecycle ────────────┐
│  child-exited · process-closed · task done  │
└───────────────────┬─────────────────────────┘
                    ▼
         main: reduceTerminalEndState()
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   session.json  broadcast   retain gate
        │           │
        ▼           ▼
   remount 读   renderer EndState store
                    │
        ┌───────────┼────────────┐
        ▼           ▼            ▼
   inject copy   tab chrome   keyboard park
```

---

## 5. 实现分期

### 阶段 0 — 契约与纯函数（无行为变化）

- 新增 `terminal-end-state.ts`：类型 + `buildAgentEndTab` / `buildTaskEndTab` / `shouldRetainFromEnd`  
- 单测锁死：**agent clean → 无 status**；**agent failed → failed**；**task success → succeeded**  
- main `agentExitTabPatch` / renderer residual **改为调用同一纯函数**（行为对齐现网）

### 阶段 1 — main 权威 + 广播

- 进程退出路径统一 `upsertTerminalEndState(panelId, partial)`  
- session 写入只从 EndState 派生 tab  
- 广播镜像；renderer store `useTerminalEndStateStore`  
- `shouldRetainTaskSurfaceOnProcessExit` 读 EndState 或「即将 end」的 agent/task 探测  

### 阶段 2 — renderer 拆补丁

- tab：`endState` 优先于 residual / strip  
- inject：以 EndState.role 为准；写回 `bufferInjected`（IPC 或本地 once-set）  
- keyboard retain：`endState != null`  
- 删除 latch Map / epoch / 乐观 session 补丁  
- `shouldRetainTaskResultPanel` 与 main 共用 shared 谓词  

### 阶段 3 — 磁盘迁移与删消毒

- 启动时 `migrateAgentSuccessTabs()`：  
  `agent.status === "exited" && (exitCode == null || exitCode === 0) && tab.state.succeeded` → 剥 state 并 **flush 写盘**  
- 删除 `sanitizeAgentExitTab`  
- 治理测试：禁止 agent clean 路径再出现 `status: "succeeded"` 字符串写入  

### 阶段 4（可选）— 文档与治理

- Agents.md / 终端相关说明补「结果查看态」一节  
- depcruise 或 unit governance：renderer 不得直接 `noteAgentResultPanel` 类旁路  

---

## 6. API / IPC 草案

### 6.1 广播

```ts
// 全量或增量均可；建议与 FA 类似：snapshot pull + changed push
type TerminalEndStateBroadcast = {
  ts: number;
  /** 本窗 panelId → EndState；无 end 的 panel 不出现 */
  ends: Record<string, TerminalEndState>;
};
```

通道名：`pier://terminal-end-state:changed`（具体常量进 `ipc-channels`）。

### 6.2 读

- 启动 / 进窗：`terminal.endState.snapshot()` 或并入现有 session snapshot 扩展字段 `endState?`  
- **优先**：session 已有 agent.exited 时，renderer 可用纯函数 **本地物化** EndState，减少一期 IPC；阶段 1 再统一广播  

**推荐落地顺序：** 阶段 0 纯函数 → 阶段 2 本地物化（session + child-exited 事件）→ 阶段 1 广播（若多窗 / 多订阅方需要）。

> 说明：若一期只服务单窗 tab+inject，**本地物化即可达金标准数据流**；广播在多窗同步 EndState 时再上。

### 6.3 写入幂等

```ts
upsertEndState(prev, event) {
  // 1. 同 panel 已 end：只允许补 exitCode / runtimeMs / bufferInjected
  // 2. 禁止 end → 写回 succeeded（agent）
  // 3. relaunch 显式 clearEndState(panelId)
}
```

---

## 7. 与现有文件的映射

| 现状 | 终态归属 |
|------|----------|
| `agentExitTabPatch` / `tabChromeAfterAgentExit` | `buildAgentEndTab`（shared） |
| `agentResultTabChromeOverlay` + strip base | 读 `endState.tab` |
| `agent-result-panel-latch` | EndState.agentId + end 存在性 |
| `shouldRetainTaskResultPanel` / `shouldRetainTaskSurface…` | shared `shouldRetainPanel(end, runningHints)` |
| `useTaskResultKeyboardRetain` | `endState != null` |
| `useTerminalChildExitedInject` | 事件 → main/upsert 或本地 reduce + inject once |
| `sanitizeAgentExitTab` | 阶段 3 migrate 后删除 |
| `taskExitTabPatch` | `buildTaskEndTab`（仍允许 succeeded） |

---

## 8. 测试计划

### 8.1 纯函数（必保）

- agent exit 0 / undefined → tab 无 status、无 success colorToken  
- agent exit 42 → failed  
- task exit 0 → succeeded  
- upsert 补 exitCode 不丢失 agentId / retain  
- relaunch clear 后无 end  

### 8.2 集成 / 组件

- child-exited 后 tab 无绿勾、有 agent icon  
- retain 面板不响应 SURFACE_CLOSE  
- 键盘不落到「+」  
- remount 历史 success 磁盘 → migrate 后无绿勾  

### 8.3 治理

- 扫描 main agent 退出路径禁止写入 `"succeeded"`（agent 角色）  
- 禁止 renderer 新增模块级 panel latch Map  

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| process-closed 与 command-finished 乱序 | EndState 允许缺 exitCode；后到者 CAS 补全；tab 在未知码时仍不写 success |
| FA 清空早于 EndState 写入 | 短暂无 icon：写入须与 process-closed **同回调**；或 running→end 过渡仍保留 last agentId 一帧 |
| 双窗拖 panel | EndState 随 ownership transfer 与 session 同迁；或阶段 1 广播按 windowId 过滤 |
| inject 重复 | `bufferInjected` 门闩 |
| 与 TaskRuns success 竞态 | end.role===agent 时 **忽略** task overlay 的 succeeded |

---

## 10. 验收标准（金标准检查表）

完成阶段 0–3 后应满足：

1. **单源：** 解释结果查看态只需打开 `TerminalEndState` + 派生表  
2. **无补丁主路径：** 无 latch Map、无 epoch、无 read sanitize、无 setSavedSession 乐观剥 state  
3. **语义锁死：** 契约测试保证 agent clean 永不绿勾；task success 仍可绿勾  
4. **main/renderer 同谓词：** retain / dismiss / tab 规则一份 shared  
5. **产品路径 A 回归：** 保留、显式关闭、buffer i18n、焦点、失败红叉全绿  

未完成阶段 1–3 前，**产品 v1 可继续用现网补丁路径**；本文不要求立刻大爆改。

---

## 11. 建议实施顺序（PR 切分）

| PR | 内容 | 风险 |
|----|------|------|
| PR1 | shared 类型 + 纯函数 + 单测；main/renderer 调用替换，行为不变 | 低 |
| PR2 | renderer 以「session 物化 EndState」替换 residual/strip/latch/epoch | 中 |
| PR3 | 启动 migrate 写盘 + 删 sanitize | 低 |
| PR4（可选） | main 广播 EndState store，多订阅方统一 | 中 |

---

## 12. 决策记录

| 日期 | 决策 |
|------|------|
| 2026-07-30 前 | 产品路径 A：agent 与 task 同为结果保留 + 显式关闭 |
| 2026-07-30 前 | 会话结束不打 success；退出文案 buffer inject + i18n |
| 2026-07-30 | 架构收敛为 TerminalEndState 单源（本文）；**先设计后拆 PR** |
| 2026-07-30 | §13 四项全部确认；**PR1 已落地**：`src/shared/contracts/terminal-end-state.ts` + main/renderer 改调 shared |
| 2026-07-30 | **PR2–PR4 落地**：renderer `terminal-end-state.store`、session 水合、main 广播、`migrateLegacyAgentSuccessTabs`、删 latch 主路径 |

---

## 13. 已拍板（2026-07-30）

1. EndState 一期：**先 session 物化（PR2）**；IPC 广播作 **PR4**。  
2. shell **不进** EndState；any-key 关窗保持 Ghostty 默认。  
3. task success **保留绿勾**（任务成功语义；与 agent 会话结束区分）。  
4. `bufferInjected` **仅内存**；remount 结果卡若不挂 live PTY 则不再 inject。  

---

## 附录 A — 现状 → 终态对照（agent 干净退出）

| 步骤 | 现状 | 终态 |
|------|------|------|
| 退出事件 | 多回调各自写 session / 清 FA | reduce → 一份 EndState |
| tab | merge + strip + sanitize + 乐观 | `endState.tab`（无 status） |
| 保留 | 双份 shouldRetain* + latch | shared 谓词读 EndState |
| 文案 | inject 钩子自判 role | EndState.role + 一次 inject |
| 重开窗 | 读消毒 | migrate 后干净 session 或物化 EndState |
