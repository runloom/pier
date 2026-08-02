# 前台活动回合语义收敛实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已封账回合只能由明确 prompt、新回合身份或适配器审计过的权威起点重新打开，并把终态、重开、进展和诊断语义收敛到单一分类器与状态归约器。

**Architecture:** 提供方适配器只声明原生事件事实，IPC 解析逐事件重开权威和证据来源，`foreground-activity` 内的纯分类器给出唯一事件语义，回合状态归约器据此完成身份校验、原子封账、幂等重开和迟到吸收。renderer 继续只消费主进程完整快照，不新增协议事件，也不引入延时清理。

**Tech Stack:** TypeScript 6 strict、Electron main、Zod 事件契约、Vitest 4、Biome 2.5 / Ultracite、pnpm 11。

## 全局约束

- 保留当前工作区中尚未提交的可信终态原子封账修复；禁止覆盖、回退或另起一套实现。
- 不新增 `setTimeout`、宽限期、轮询等待、TTL 转 `ready` 或延时清理。
- 不扩展 `AgentHookEventPayloadV3` 公共事件枚举；逐事件重开权威属于适配器运行语义。
- `PromptSubmit`、新的未结算 `turnId` 和适配器权威起点是仅有的可信重开入口。
- 无 `turnId`、无适配器权威的 `processing` / `running` 只能推进活跃回合，不能突破 `turnEnded`。
- 已结算 `turnId` 优先于适配器权威；任何权威声明都不能复活已结算身份。
- 提供方名称只能出现在适配器与适配器测试中；分类器、状态归约器和投影不得识别 Codex、Cline、Antigravity 等名称。
- 日志只增加来源、原生事件、有限枚举转换、拒绝原因和聚合数量；禁止记录 prompt、metadata、transcript 路径、工具名称、工具调用标识、命令或参数。
- 每个生产行为改动先写失败测试并确认失败原因，再写最小实现；测试期望必须是手写字面量，不能调用生产分类器计算期望。
- 单个生产文件不得超过 500 行；`src/main/ipc/foreground-activity.ts` 已接近上限，权威解析放入独立小模块。

---

### Task 1：建立逐原生事件的回合起点权威

**Files:**
- Create: `src/main/services/agents/integrations/runtime/event-authority.ts`
- Create: `tests/unit/main/agents/agent-runtime-event-authority.test.ts`
- Modify: `src/main/services/foreground-activity/types.ts`
- Modify: `src/main/services/agents/integrations/types.ts`
- Modify: `src/main/services/agents/integrations/cline.ts`
- Modify: `src/main/services/agents/integrations/antigravity.ts`
- Modify: `tests/unit/main/agents/agent-hook-runtime-semantics.test.ts`

**Interfaces:**
- Produces: `AgentTurnStartAuthority = "authoritative" | "none"`。
- Produces: `AgentRuntimeEventMapping.turnStartAuthority?: "authoritative"`。
- Produces: `resolveAgentTurnStartAuthority(runtime, event): AgentTurnStartAuthority`。
- Consumes: 现有 `AgentRuntimeSemantics.emittedMappings`、v1/v2/v3 `AgentHookEventPayload`。

- [ ] **Step 1: 写适配器权威清单的失败测试**

在 `agent-hook-runtime-semantics.test.ts` 增加行为断言，精确锁定只有两个原生事件获得无关联重开权威，并验证权威只附着在 `processing` / `running`：

```ts
it("只有审计过的原生活动起点拥有无关联重开权威", () => {
  const actual = AGENT_HOOK_INTEGRATIONS.flatMap((integration) =>
    integration.runtime.emittedMappings
      .filter((mapping) => mapping.turnStartAuthority === "authoritative")
      .map((mapping) => ({
        agentId: integration.id,
        nativeEvent: mapping.nativeEvent,
        pierEvent: mapping.pierEvent,
      }))
  );

  expect(actual).toEqual([
    {
      agentId: "antigravity",
      nativeEvent: "PreInvocation",
      pierEvent: "processing",
    },
    {
      agentId: "cline",
      nativeEvent: "TaskResume",
      pierEvent: "running",
    },
  ]);
  expect(actual.every(({ pierEvent }) =>
    ["processing", "running"].includes(pierEvent)
  )).toBe(true);
});
```

- [ ] **Step 2: 写权威解析器的失败测试**

新建 `agent-runtime-event-authority.test.ts`，用完整运行语义和真实事件形状验证三条边界：原生事件与规范事件必须同时匹配、v1 事件不能获得权威、未知映射退化为 `none`。

```ts
const runtime: AgentRuntimeSemantics = {
  emittedMappings: [
    {
      nativeEvent: "TaskResume",
      pierEvent: "running",
      turnStartAuthority: "authoritative",
    },
  ],
  stopAuthority: "none",
};

expect(resolveAgentTurnStartAuthority(runtime, {
  agent: "cline",
  event: "running",
  kind: "agentEvent",
  nativeEvent: "TaskResume",
  panelId: "p1",
  v: 3,
  windowId: "w1",
})).toBe("authoritative");

expect(resolveAgentTurnStartAuthority(runtime, {
  agent: "cline",
  event: "processing",
  kind: "agentEvent",
  nativeEvent: "TaskResume",
  panelId: "p1",
  v: 2,
  windowId: "w1",
})).toBe("none");

expect(resolveAgentTurnStartAuthority(runtime, {
  agent: "cline",
  event: "running",
  kind: "agentEvent",
  panelId: "p1",
  v: 1,
  windowId: "w1",
})).toBe("none");
```

- [ ] **Step 3: 运行测试并确认按预期失败**

Run:

```bash
pnpm exec vitest run tests/unit/main/agents/agent-hook-runtime-semantics.test.ts tests/unit/main/agents/agent-runtime-event-authority.test.ts
```

Expected: FAIL，原因分别是 `turnStartAuthority` 尚不存在、解析器模块尚不存在；不能接受语法错误或测试环境错误作为红灯。

- [ ] **Step 4: 写最小权威类型与解析器**

在 `foreground-activity/types.ts` 导出：

```ts
export type AgentTurnStartAuthority = "authoritative" | "none";
```

在 `integrations/types.ts` 扩展映射：

```ts
export interface AgentRuntimeEventMapping {
  readonly nativeEvent: string;
  readonly pierEvent: string;
  readonly turnStartAuthority?: "authoritative";
}
```

在新模块实现纯解析函数：

```ts
export function resolveAgentTurnStartAuthority(
  runtime: AgentRuntimeSemantics | undefined,
  event: AgentHookEventPayload
): AgentTurnStartAuthority {
  if (!(runtime && event.v !== 1)) return "none";
  return runtime.emittedMappings.some(
    (mapping) =>
      mapping.nativeEvent === event.nativeEvent &&
      mapping.pierEvent === event.event &&
      mapping.turnStartAuthority === "authoritative"
  )
    ? "authoritative"
    : "none";
}
```

给 Antigravity `PreInvocation → processing` 和 Cline `TaskResume → running` 的运行映射增加 `turnStartAuthority: "authoritative"`。Cline 从 `CLINE_EVENTS` 生成 `emittedMappings` 时必须透传该可选字段；生成的 JSONL 内容保持不变。

- [ ] **Step 5: 运行权威测试并确认通过**

Run:

```bash
pnpm exec vitest run tests/unit/main/agents/agent-hook-runtime-semantics.test.ts tests/unit/main/agents/agent-runtime-event-authority.test.ts tests/unit/agent-integrations/antigravity.test.ts tests/unit/agent-integrations/cline.test.ts
```

Expected: PASS；Antigravity 与 Cline 的安装产物仍只写现有严格 v3 事件，没有新增 payload 字段。

- [ ] **Step 6: 提交适配器权威单元**

```bash
git add src/main/services/foreground-activity/types.ts src/main/services/agents/integrations/types.ts src/main/services/agents/integrations/runtime/event-authority.ts src/main/services/agents/integrations/cline.ts src/main/services/agents/integrations/antigravity.ts tests/unit/main/agents/agent-hook-runtime-semantics.test.ts tests/unit/main/agents/agent-runtime-event-authority.test.ts
git commit -m "feat: declare authoritative agent turn starts"
```

---

### Task 2：建立统一回合事件分类器

**Files:**
- Create: `src/main/services/foreground-activity/agent-turn-event-semantics.ts`
- Create: `tests/unit/main/panel/agent-turn-event-semantics.test.ts`
- Modify: `src/main/services/foreground-activity/types.ts`

**Interfaces:**
- Consumes: `AgentHookEventPayload`、`AgentStopAuthority`、`AgentTurnStartAuthority`、`activityStatusForHookEvent`。
- Produces: `AgentEventEvidenceSource`、`AgentEventIngestOptions`。
- Produces: `AgentTurnEventCategory`、`TurnResetEvidence`、`AgentTurnEventSemantics`。
- Produces: `classifyAgentTurnEvent(event, options): AgentTurnEventSemantics`。

- [ ] **Step 1: 写分类表的失败测试**

新测试用手写字面量覆盖以下完整决策表，测试辅助函数只能构造事件，不能计算期望：

```ts
it.each([
  {
    event: event("PromptSubmit"),
    options: options(),
    expected: {
      category: "turn-start",
      createsSession: true,
      mappedStatus: "processing",
      resetEvidence: "explicit-prompt",
    },
  },
  {
    event: event("processing", { turnId: "turn-2" }),
    options: options(),
    expected: {
      category: "turn-start",
      createsSession: true,
      mappedStatus: "processing",
      resetEvidence: "turn-correlatable",
    },
  },
  {
    event: event("running"),
    options: options({ turnStartAuthority: "authoritative" }),
    expected: {
      category: "turn-start",
      createsSession: true,
      mappedStatus: "processing",
      resetEvidence: "provider-authoritative",
    },
  },
  {
    event: event("processing"),
    options: options(),
    expected: {
      category: "progress",
      createsSession: true,
      mappedStatus: "processing",
      resetEvidence: "none",
    },
  },
  {
    event: event("Stop"),
    options: options({ stopAuthority: "advisory" }),
    expected: {
      category: "terminal-candidate",
      createsSession: false,
      mappedStatus: undefined,
      resetEvidence: "none",
    },
  },
  {
    event: event("Stop"),
    options: options({ stopAuthority: "none" }),
    expected: {
      category: "ignored",
      createsSession: false,
      mappedStatus: null,
      resetEvidence: "none",
    },
  },
  {
    event: event("TurnCompleted"),
    options: options(),
    expected: {
      category: "terminal-trusted",
      createsSession: false,
      mappedStatus: "ready",
      resetEvidence: "none",
      terminalStatus: "ready",
    },
  },
  {
    event: event("error"),
    options: options(),
    expected: {
      category: "terminal-trusted",
      createsSession: false,
      mappedStatus: "error",
      resetEvidence: "none",
      terminalStatus: "error",
    },
  },
])("$event.event → $expected.category", ({ event, options, expected }) => {
  expect(classifyAgentTurnEvent(event, options)).toEqual(expected);
});
```

另写独立断言覆盖：`SessionStart` / `SessionEnd`、`ToolStart` / `ToolComplete`、成对交互、子智能体、`TurnInterrupted`、`authoritative/reset-only Stop`、v1/v2 `PermissionRequest`、严格 v3 不接受旧单边事件、未知 v1 事件。

- [ ] **Step 2: 运行分类器测试并确认按预期失败**

Run:

```bash
pnpm exec vitest run tests/unit/main/panel/agent-turn-event-semantics.test.ts
```

Expected: FAIL，原因是分类器与接入选项类型尚不存在。

- [ ] **Step 3: 定义接入选项和判别联合**

在 `types.ts` 增加：

```ts
export type AgentEventEvidenceSource = "hook" | "transcript";

export interface AgentEventIngestOptions {
  evidenceSource: AgentEventEvidenceSource;
  stopAuthority: AgentStopAuthority;
  turnStartAuthority: AgentTurnStartAuthority;
}
```

分类器文件导出：

```ts
export type AgentTurnEventCategory =
  | "session-start"
  | "session-end"
  | "turn-start"
  | "progress"
  | "work"
  | "terminal-candidate"
  | "terminal-trusted"
  | "ignored";

export type TurnResetEvidence =
  | "explicit-prompt"
  | "provider-authoritative"
  | "turn-correlatable"
  | "none";

export interface AgentTurnEventSemantics {
  readonly category: AgentTurnEventCategory;
  readonly createsSession: boolean;
  readonly mappedStatus: ActivityStatus | null | undefined;
  readonly resetEvidence: TurnResetEvidence;
  readonly terminalStatus?: "ready" | "error";
}
```

- [ ] **Step 4: 实现唯一分类函数**

实现顺序固定为：会话生命周期 → `Stop` 权威 →可信终态 → `PromptSubmit` → `processing/running` 的身份或适配器权威 → 旧交互兼容 → 其余基础映射。核心分支写成单个纯函数：

```ts
export function classifyAgentTurnEvent(
  event: AgentHookEventPayload,
  options: AgentEventIngestOptions
): AgentTurnEventSemantics {
  if (event.event === "SessionStart") return sessionStartSemantics;
  if (event.event === "SessionEnd") return sessionEndSemantics;
  if (event.event === "Stop") return stopSemantics(options.stopAuthority);
  if (event.event === "TurnCompleted" || event.event === "TurnInterrupted") {
    return trustedTerminal("ready");
  }
  if (event.event === "error") return trustedTerminal("error");
  if (event.event === "PromptSubmit") {
    return turnStart("explicit-prompt");
  }
  if (event.event === "processing" || event.event === "running") {
    if (event.turnId?.trim()) return turnStart("turn-correlatable");
    if (options.turnStartAuthority === "authoritative") {
      return turnStart("provider-authoritative");
    }
    return progressSemantics;
  }
  if (event.v !== 3 && event.event === "PermissionRequest") {
    return legacyWaitingSemantics;
  }
  return semanticsForMappedWorkEvent(event.event);
}
```

所有常量留在该文件内部，不导出事件名集合。`activityStatusForHookEvent` 只作为基础状态表使用。

- [ ] **Step 5: 运行分类器和共享契约测试**

Run:

```bash
pnpm exec vitest run tests/unit/main/panel/agent-turn-event-semantics.test.ts tests/unit/agent/session-contract.test.ts tests/unit/main/agents/agent-waiting-evidence-gates.test.ts
```

Expected: PASS；共享状态映射和旧 `PermissionRequest` 兼容行为保持不变。

- [ ] **Step 6: 提交统一分类器**

```bash
git add src/main/services/foreground-activity/types.ts src/main/services/foreground-activity/agent-turn-event-semantics.ts tests/unit/main/panel/agent-turn-event-semantics.test.ts
git commit -m "feat: classify foreground turn events centrally"
```

---

### Task 3：切换回合状态机、接入权威并补不变量

**Files:**
- Create: `tests/unit/main/panel/foreground-activity-turn-state-machine.test.ts`
- Modify: `src/main/services/foreground-activity/types.ts`
- Modify: `src/main/services/foreground-activity/entry.ts`
- Modify: `src/main/services/foreground-activity/turn-bookkeeping.ts`
- Modify: `src/main/services/foreground-activity/aggregator.ts`
- Modify: `src/main/services/foreground-activity/aggregator-hook-scopes.ts`
- Modify: `src/main/services/foreground-activity/aggregator-tracing.ts`
- Delete: `src/main/services/foreground-activity/agent-hook-compatibility.ts`
- Modify: `src/main/ipc/foreground-activity.ts`
- Modify: `tests/unit/main/panel/foreground-activity-aggregator.test.ts`
- Modify: `tests/unit/agent-integrations/status-traces/status-trace-harness.ts`
- Modify: `tests/unit/agent-integrations/status-traces/special-command-traces.ts`
- Modify: `tests/unit/agent-integrations/status-traces/branching-command-traces.ts`
- Modify: `tests/unit/agent-integrations/antigravity.test.ts`
- Modify: `tests/unit/renderer/accounts/codex-status-chain.test.tsx`
- Modify: every test call site found by `rg -n "ingestAgentEvent\\(" tests` that passes the old partial options shape directly.

**Interfaces:**
- Consumes: `classifyAgentTurnEvent` and `resolveAgentTurnStartAuthority` from Tasks 1–2。
- Changes: `ForegroundActivityAggregator.ingestAgentEvent(event, options: AgentEventIngestOptions): boolean`。
- Produces: discriminated `TurnBookkeepingResult` with `transition` or `reason`。
- Produces: `TurnTransition = "none" | "reset" | "terminal-candidate" | "terminal-trusted"`。
- Preserves: `TerminalRetiredWork` aggregated counts from the current uncommitted atomic-terminal fix。

- [ ] **Step 1: 写可信终态和迟到吸收的不变量测试**

新建状态机测试，测试辅助函数始终显式提供完整接入选项：

```ts
const HOOK_OPTIONS: AgentEventIngestOptions = {
  evidenceSource: "hook",
  stopAuthority: "authoritative",
  turnStartAuthority: "none",
};

function ingest(
  aggregator: ForegroundActivityAggregator,
  event: AgentHookEventPayload,
  overrides: Partial<AgentEventIngestOptions> = {}
): boolean {
  return aggregator.ingestAgentEvent(event, {
    ...HOOK_OPTIONS,
    ...overrides,
  });
}
```

用字面量表验证任意活动工作前缀接可信终态立即完成：

```ts
it.each([
  { terminal: "TurnCompleted", want: "ready" },
  { terminal: "TurnInterrupted", want: "ready" },
  { terminal: "error", want: "error" },
])("活跃工具不能否定 $terminal", ({ terminal, want }) => {
  const aggregator = createForegroundActivityAggregator();
  ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }));
  ingest(aggregator, event("ToolStart", {
    toolUseId: "tool-1",
    turnId: "turn-1",
  }));

  expect(ingest(aggregator, event(terminal, { turnId: "turn-1" }))).toBe(true);
  expect(statusOf(aggregator)).toBe(want);
});
```

再写一组表驱动测试，终态后依次投递无 `turnId` 的 `processing`、`running`、`ToolStart`、`ToolComplete` 和同身份迟到事件，逐条断言返回 `false` 且状态保持 `ready/error`。

- [ ] **Step 2: 写合法重开、身份幂等和错误优先级的失败测试**

必须分别覆盖：

```ts
it("无关联进展不能重开，明确 prompt 可以", () => {
  // PromptSubmit(turn-1) → TurnCompleted(turn-1)
  // processing(no turn) 返回 false，仍 ready
  // PromptSubmit(no turn) 返回 true，进入 processing
});

it("新的 turnId 可关联重开，已结算 turnId 不可复活", () => {
  // turn-1 完成后 processing(turn-2) → processing
  // turn-1 完成后 processing(turn-1) → false
});

it("同一活跃 turnId 的重复 PromptSubmit 不清空工具账本", () => {
  // PromptSubmit(turn-1) → ToolStart(turn-1) → PromptSubmit(turn-1)
  // 最终仍为 tool
});

it("提供方权威起点只在封账后重开，活跃时不重复清账", () => {
  // ready + processing(authoritative, no turn) → processing
  // 活跃工具 + processing(authoritative, no turn) → 仍 tool
});

it("error 不被完成事实降级，ready 可被 error 纠正", () => {
  // error → TurnCompleted 保持 error 且拒绝
  // TurnCompleted → error 进入 error
});
```

- [ ] **Step 3: 写乱序、候选终态和时间不造假的失败测试**

```ts
it.each([
  ["terminal-then-late-complete", ["PromptSubmit", "ToolStart", "TurnCompleted", "ToolComplete"]],
  ["complete-then-terminal", ["PromptSubmit", "ToolStart", "ToolComplete", "TurnCompleted"]],
])("$0 最终收敛到 ready", (_name, sequence) => {
  expect(runSequence(sequence)).toBe("ready");
});

it("advisory Stop 永不生成 ready，后续真实活动取消候选", () => {
  // PromptSubmit → Stop(advisory) → status undefined
  // ToolStart → tool
});

it("推进 TTL 和广播计时器不会生成 ready", () => {
  // PromptSubmit 后推进 HOOK_FRESH_TTL_MS，只允许 status undefined
});
```

- [ ] **Step 4: 把真实提供方重开序列加入轨迹并确认失败**

在 Cline 轨迹中把首次 `TaskComplete` 后的下一次回合起点改为 `TaskResume`，期望 `processing`；在 Antigravity 轨迹末尾增加 `error → PreInvocation`，期望从 `error` 恢复 `processing`。这两个事件都不带 `turnId`，确保测试验证的是适配器权威而非身份路径。

Run:

```bash
pnpm exec vitest run tests/unit/main/panel/foreground-activity-turn-state-machine.test.ts tests/unit/agent-integrations/agent-status-trace-e2e.test.ts
```

Expected: FAIL；当前实现会让无权威的迟到 `processing/running` 重开，且轨迹 harness 尚未把逐事件权威传入聚合器。

- [ ] **Step 5: 写诊断来源和隐私边界的失败测试**

在现有生命周期日志测试中使用 v3 事件和完整接入选项，断言：

```ts
expect(trustedRecord?.ctx).toMatchObject({
  category: "terminal-trusted",
  evidenceSource: "transcript",
  nativeEvent: "codex.transcript.task_complete",
  transition: "terminal-trusted",
  terminalRetiredWork: {
    interactionCount: 0,
    subagentCount: 0,
    toolCount: 1,
  },
});
expect(JSON.stringify(records)).not.toContain("SENSITIVE_TOOL_ID");
expect(JSON.stringify(records)).not.toContain("SENSITIVE_PROMPT");
expect(JSON.stringify(records)).not.toContain("/private/transcript.jsonl");
```

另写被拒事件断言，要求日志包含 `reason: "sealed-turn"`、`evidenceSource`、`nativeEvent`，但快照和广播不变。

- [ ] **Step 6: 运行全部新测试并确认红灯来自缺失行为**

Run:

```bash
pnpm exec vitest run tests/unit/main/panel/foreground-activity-turn-state-machine.test.ts tests/unit/main/panel/foreground-activity-aggregator.test.ts tests/unit/agent-integrations/agent-status-trace-e2e.test.ts tests/unit/renderer/accounts/codex-status-chain.test.tsx
```

Expected: FAIL；至少明确暴露“无关联进展复活终态”“逐事件权威未接入”“日志缺少来源/原生事件/拒绝原因”三类差距。

- [ ] **Step 7: 把回合记账改为消费分类语义**

将 `TurnBookkeepingResult` 改成判别联合：

```ts
export type TurnTransition =
  | "none"
  | "reset"
  | "terminal-candidate"
  | "terminal-trusted";

export type TurnBookkeepingRejectionReason =
  | "foreign-turn"
  | "sealed-turn"
  | "settled-turn"
  | "stop-without-authority";

export type TurnBookkeepingResult =
  | { accepted: false; reason: TurnBookkeepingRejectionReason }
  | {
      accepted: true;
      transition: TurnTransition;
      terminalRetiredWork?: TerminalRetiredWork;
    };
```

`applyTurnBookkeeping` 的签名改为：

```ts
export function applyTurnBookkeeping(
  scope: HookScope,
  event: AgentHookEventPayload,
  semantics: AgentTurnEventSemantics,
  at: number,
  subagentWorkId?: string
): TurnBookkeepingResult;
```

状态判断顺序必须严格实现为：

1. `ignored` 返回 `stop-without-authority`。
2. 已结算 `eventTurnId` 且不是允许的终态纠正，返回 `settled-turn`。
3. 允许 `ready → error/TurnInterrupted` 的同回合终态纠正。
4. `explicit-prompt`：同一活跃身份只按进展接受；无身份或新身份执行 `reset`。
5. `turn-correlatable`：活跃回合无身份时只补记身份；同身份按进展；新身份执行 `reset`；封账后未结算的新身份执行 `reset`。
6. `provider-authoritative`：封账后执行 `reset`，活跃时只按进展；若事件携带已结算身份，步骤 2 已拒绝。
7. 已封账且未命中合法重开或终态纠正，返回 `sealed-turn`。
8. 可信终态同步设置 `turnEnded`、退休工作集并返回 `terminal-trusted`。
9. advisory `Stop` 清活动工作、保留未知状态并返回 `terminal-candidate`。
10. 其他工作事件沿用具名/匿名幂等记账并返回 `none`。

删除 `TURN_BOUNDARY_EVENTS`、`TURN_RESET_EVENTS`、`SESSION_CREATING_EVENTS`；`entry.ts` 只保留数据结构和与事件语义无关的常量。

- [ ] **Step 8: 让聚合器只分类一次并让所有消费者使用归约结果**

`aggregator.ts` 在身份路由前调用一次：

```ts
const semantics = classifyAgentTurnEvent(event, options);
```

随后：

- hook 层创建只读 `semantics.createsSession`。
- `SessionStart` / `SessionEnd` 协调只读 `semantics.category`。
- `applyTurnBookkeeping` 消费 `semantics`。
- `nextStatusAfterTurnBookkeeping` 消费 `semantics.mappedStatus`。
- 子智能体关联退休只读 `result.transition`。
- 生命周期和拒绝日志只读 `semantics`、`result` 和接入选项。

删除 `agent-hook-compatibility.ts`，并确认：

```bash
rg -n "TURN_BOUNDARY_EVENTS|TURN_RESET_EVENTS|SESSION_CREATING_EVENTS|activityStatusForAgentHookEvent|isSessionCreatingAgentHookEvent" src/main/services/foreground-activity
```

Expected: 无结果。

- [ ] **Step 9: 切换完整接入选项并解析真实权威**

把公共内部接口改为：

```ts
ingestAgentEvent(
  event: AgentHookEventPayload,
  options: AgentEventIngestOptions
): boolean;
```

`src/main/ipc/foreground-activity.ts` 的 transcript 路径固定传：

```ts
{
  evidenceSource: "transcript",
  stopAuthority: "authoritative",
  turnStartAuthority: "none",
}
```

hook 路径先取注册项，再传：

```ts
const integration = getAgentHookIntegration(routed.agent);
const options: AgentEventIngestOptions = {
  evidenceSource: "hook",
  stopAuthority: integration?.runtime.stopAuthority ?? "none",
  turnStartAuthority: resolveAgentTurnStartAuthority(
    integration?.runtime,
    routed
  ),
};
```

状态轨迹 harness 对每个实际 event 调用同一解析器，不能把 fixture 级布尔值硬编码成所有事件的权威。单元测试辅助包装器可以默认 `{ evidenceSource: "hook", stopAuthority: "authoritative", turnStartAuthority: "none" }`；生产代码不得默认。

用以下检查找出旧调用：

```bash
rg -n "ingestAgentEvent\\(" src/main tests
```

逐个直接调用都必须传完整选项或进入测试专用包装器。

- [ ] **Step 10: 用转换结果重写结构化日志**

给日志增加安全字段提取：

```ts
function nativeEventForLog(event: AgentHookEventPayload): string {
  return event.v === 1 ? event.event : event.nativeEvent;
}
```

生命周期日志参数包含 `semantics`、`transition`、`options`；消息名由 `transition` 决定，不再检查 `event === "Stop" | "TurnCompleted"`。拒绝日志携带归约器的有限枚举 `reason`。保留现有 `terminalRetiredWork` 数量，不新增任何工作标识或正文。

- [ ] **Step 11: 运行核心状态机、提供方轨迹和跨层测试直到全绿**

Run:

```bash
pnpm exec vitest run tests/unit/main/panel/agent-turn-event-semantics.test.ts tests/unit/main/panel/foreground-activity-turn-state-machine.test.ts tests/unit/main/panel/foreground-activity-aggregator.test.ts tests/unit/main/agents/agent-hook-runtime-semantics.test.ts tests/unit/main/agents/agent-runtime-event-authority.test.ts tests/unit/agent-integrations/agent-status-trace-e2e.test.ts tests/unit/agent-integrations/antigravity.test.ts tests/unit/agent-integrations/cline.test.ts tests/unit/renderer/accounts/codex-status-chain.test.tsx
```

Expected: PASS。不得通过放宽失败断言、删除乱序排列或把无关联进展改回全局重开来变绿。

- [ ] **Step 12: 重构重复逻辑并保持测试全绿**

只在绿灯后执行：

- 将测试接入选项辅助函数放在各测试文件或现有测试工具中，不加入生产类。
- 把 `turnId` 判定提取为 `turnStartDecision` 私有纯函数，避免 `applyTurnBookkeeping` 嵌套复杂度超限。
- 保持分类器、记账、投影、日志文件职责单一。
- 运行 Step 11 的同一命令确认重构未改变行为。

- [ ] **Step 13: 提交状态机闭环**

先执行：

```bash
git diff --check
pnpm typecheck:host
```

再只暂存本任务涉及的生产与测试文件，包括当前未提交的可信终态原子封账改动：

```bash
git add src/main/ipc/foreground-activity.ts src/main/services/foreground-activity src/main/services/agents/integrations/runtime/event-authority.ts tests/unit/main/panel/agent-turn-event-semantics.test.ts tests/unit/main/panel/foreground-activity-turn-state-machine.test.ts tests/unit/main/panel/foreground-activity-aggregator.test.ts tests/unit/agent-integrations/status-traces/status-trace-harness.ts tests/unit/agent-integrations/status-traces/special-command-traces.ts tests/unit/agent-integrations/status-traces/branching-command-traces.ts tests/unit/agent-integrations/antigravity.test.ts tests/unit/renderer/accounts/codex-status-chain.test.tsx
git commit -m "fix: seal foreground activity turn transitions"
```

---

### Task 4：同步架构记录并完成验证闭环

**Files:**
- Modify: `docs/superpowers/specs/2026-07-13-agent-status-adapter-contract-audit.md`
- Modify: `docs/superpowers/specs/2026-08-02-foreground-activity-turn-semantics-hardening-design.md` only if implementation proves a named interface must differ; behavior and ownership may not drift silently.
- Verify: all files changed since `9b65adc2`。

**Interfaces:**
- Consumes: Tasks 1–3 的最终类型、测试名和日志字段。
- Produces: 与实现一致的控制流、反模式清单和需求到证据矩阵。

- [ ] **Step 1: 更新既有审计记录中的终态增补**

在 `2026-07-13-agent-status-adapter-contract-audit.md` 的“可信终态原子封账”之后补充“回合重开语义收敛”，明确记录：

- `processing/running` 不再全局重开。
- Cline `TaskResume`、Antigravity `PreInvocation` 是首批逐事件权威。
- 分类器和归约器的文件所有权。
- `hook/transcript` 来源与安全日志字段。
- 新状态机不变量和全部提供方轨迹证据。

不要把实施过程或命令输出整段粘入文档；只写稳定结论和可复验路径。

- [ ] **Step 2: 做设计与实现一致性复核**

逐项核对设计文档的类型名、文件名、重开优先级、拒绝原因和验收矩阵。若实现为满足 TypeScript 判别联合而调整了字段名称，只修改对应行并说明同一语义；禁止扩大到公共 `TurnStarted` 协议或引入提供方分支。

- [ ] **Step 3: 运行变更文件静态检查**

Run:

```bash
git diff --check
pnpm exec ultracite check src/main/ipc/foreground-activity.ts src/main/services/foreground-activity src/main/services/agents/integrations/types.ts src/main/services/agents/integrations/runtime/event-authority.ts src/main/services/agents/integrations/cline.ts src/main/services/agents/integrations/antigravity.ts tests/unit/main/agents/agent-hook-runtime-semantics.test.ts tests/unit/main/agents/agent-runtime-event-authority.test.ts tests/unit/main/panel/agent-turn-event-semantics.test.ts tests/unit/main/panel/foreground-activity-turn-state-machine.test.ts tests/unit/main/panel/foreground-activity-aggregator.test.ts tests/unit/agent-integrations/status-traces/status-trace-harness.ts tests/unit/agent-integrations/status-traces/special-command-traces.ts tests/unit/agent-integrations/status-traces/branching-command-traces.ts tests/unit/agent-integrations/antigravity.test.ts tests/unit/renderer/accounts/codex-status-chain.test.tsx
pnpm typecheck:host
```

Expected: 全部成功；不得新增格式、复杂度、文件大小或类型警告。

- [ ] **Step 4: 运行前台活动和全部提供方回归**

Run:

```bash
pnpm exec vitest run tests/unit/main/panel/agent-turn-event-semantics.test.ts tests/unit/main/panel/foreground-activity-turn-state-machine.test.ts tests/unit/main/panel/foreground-activity-aggregator.test.ts tests/unit/main/agents/agent-hook-runtime-semantics.test.ts tests/unit/main/agents/agent-runtime-event-authority.test.ts tests/unit/agent-integrations/agent-status-trace-e2e.test.ts tests/unit/renderer/accounts/codex-status-chain.test.tsx
```

Expected: 分类、状态机、27 个主动提供方轨迹和 Codex 跨层状态链全部通过。

- [ ] **Step 5: 运行完整质量检查和构建**

Run:

```bash
pnpm check
pnpm build
```

Expected:

- Unit、Component、Integration 全部通过。
- 构建成功。
- 只允许仓库已有、与本改动无关且可明确指出来源的警告；任何新增警告必须修复。
- 若完整并发测试出现超时，先单文件复现并按 `systematic-debugging` 查明是行为失败还是资源争用；不得直接重跑后忽略。

- [ ] **Step 6: 使用验证与代码审查 skill 做最终门禁**

先使用 `superpowers:verification-before-completion` 核对本计划全部命令的最新输出，再使用 `superpowers:requesting-code-review` 对 `9b65adc2..HEAD` 加当前工作区做只读审查。必须处理所有 Critical、Important 和确认有效的 Minor 发现；修复时重新进入对应 TDD 红绿循环。

- [ ] **Step 7: 提交文档与审查修正**

```bash
git add docs/superpowers/specs/2026-07-13-agent-status-adapter-contract-audit.md docs/superpowers/specs/2026-08-02-foreground-activity-turn-semantics-hardening-design.md
git commit -m "docs: record foreground turn state invariants"
```

如果设计文档没有发生变化，只提交审计记录；不得用空提交满足步骤。

- [ ] **Step 8: 最终验收报告**

最终答复必须列出：

- 可信终态、合法重开和迟到吸收分别由哪些文件拥有。
- 哪些测试证明 Cline、Antigravity、Codex 和全部提供方闭环。
- `pnpm check` 与 `pnpm build` 的最新结果。
- 明确避免了哪些反模式：延时清理、TTL 转完成、UI 推断、工具账本批准终态、提供方分支进入归约器。
- 工作区是否仍有未提交文件，以及每个未提交文件是否属于本任务。
