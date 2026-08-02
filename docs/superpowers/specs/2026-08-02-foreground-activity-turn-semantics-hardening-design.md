# 前台活动回合语义收敛设计

## 背景与结论

2026-08-02 的可信终态原子封账修复已经解决 Codex 输出最终答复后仍显示“执行工具中”的直接故障：可信终态到达时，主进程同步封账并退休未闭合的工具、交互和子智能体记录，工具账本不再反向否定终态。

本设计继续收口审查中发现的结构性风险。当前 `processing` / `running` 同时表示“活跃回合内继续推进”和“允许已封账回合重新开始”。这两个事实强度不同：前者只是进展，后者必须有新回合身份或提供方明确保证。若继续混用，无 `turnId` 的迟到进展事件仍可能把 `ready` 或 `error` 重新拉回活动态。

终案是在不扩展公共事件协议的前提下，引入统一、带类型的回合事件分类器，并由提供方适配器逐个声明哪些原生事件具有无关联重开权威。回合状态归约器（reducer）只消费规范事件、权威声明和当前回合状态，不识别 Codex、Cline 等提供方名称。

## 目标和完成标准

### 目标

1. 已封账回合只能由可证明的新回合信号重新打开。
2. 终态、候选终态、回合起点、普通进展和工作事件只在一个分类器中定义。
3. 重复、迟到和跨来源乱序事件在同一回合内收敛到确定结果。
4. 诊断能说明事件来自 hook 还是 transcript、对应哪个原生事件以及终态退休了多少未闭合工作，同时不记录输入正文、工具参数或工具标识。
5. 所有现役提供方继续保持其已审计的状态能力；没有证据的提供方不合成新回合或终态。

### 完成标准

- `TurnCompleted`、`TurnInterrupted`、`error` 和可信 `Stop` 仍然同步封账，不等待任何计时器。
- 已封账后，无 `turnId` 且没有适配器权威声明的 `processing` / `running` 被吸收。
- `PromptSubmit`、新的未结算 `turnId`、Cline `TaskResume` 和 Antigravity `PreInvocation` 可以开启合法新回合。
- 同一 `turnId` 的重复 `PromptSubmit` 不清空当前活跃工作集；已经结算的 `turnId` 不能复活。
- advisory `Stop` 只形成完成候选，不产生 `ready`；后续真实活动可取消候选。
- `error` 不会被较弱的 `ready` 事实降级；`ready` 可被同回合后到的 `error` 纠正。
- 推进时间只会降低陈旧状态置信度，永远不会制造 `ready`。
- 全部提供方状态轨迹、主进程状态机、Codex 跨层状态链、类型检查、静态检查、完整测试和构建通过。

## 当前结构为什么不足

### 回合起点与进展混为一谈

`entry.ts` 的 `TURN_RESET_EVENTS` 同时包含 `PromptSubmit`、`processing` 和 `running`。`turn-bookkeeping.ts` 允许这个集合绕过 `turnEnded` 闸门，并清理工作集、重置当前回合。

这意味着以下两个序列在当前实现中无法区分：

```text
合法：TurnCompleted → 新一轮 TaskResume → processing
迟到：TurnCompleted → 旧回合 processing 晚到
```

只删除 `processing` / `running` 也不正确。Cline 的 `TaskResume` 和 Antigravity 的 `PreInvocation` 没有统一的 `PromptSubmit` 等价事件，却能由原生语义证明智能体重新进入活动阶段。它们需要在适配器边界声明更强证据，不能由聚合器根据事件名称猜测。

### 事件语义分散

同一个规范事件当前在多处被重新解释：

- `activityStatusForHookEvent` 决定状态映射。
- `TURN_BOUNDARY_EVENTS` 决定可信终态。
- `TURN_RESET_EVENTS` 决定回合重开。
- `SESSION_CREATING_EVENTS` 决定是否可创建 hook 层。
- `Stop` 的权威分支位于回合记账函数。
- 子智能体关联退休和生命周期日志再次按事件名分类。

这些定义可以分别通过测试，却仍可能在一次修改后互相矛盾。此前将终态延后到工具账本排空，就是测试和实现共同锁定错误优先级的实例。

### 测试偏重示例，缺少不变量

当前提供方轨迹和聚合器示例覆盖广，但它们主要回答“这条给定序列得到什么状态”。还需要独立的不变量测试回答：无论活跃工作集如何组合、终态和迟到事件如何排列，可信终态是否始终立即生效、旧回合是否始终不可复活、时间是否始终不能制造完成事实。

## 方案比较

### 方案一：仅收紧 `processing` / `running`

做法是把它们从回合重置集合移除，只保留 `PromptSubmit`。

优点是改动小。缺点是 Cline `TaskResume`、Antigravity `PreInvocation` 等缺少 `PromptSubmit` 的合法路径无法从终态恢复，也没有解决事件语义分散问题。因此不采用。

### 方案二：扩展公共协议，增加 `TurnStarted`

做法是在 `AgentHookEventPayloadV3` 增加规范事件 `TurnStarted`，并迁移相关生成脚本和适配器。

优点是事件名称直观。缺点是为了两个需要无关联重开的现役原生事件扩大公共协议、生成器和迁移面；同时 `running` 这类权威状态快照与“全新回合起点”仍不完全等价。因此本轮不采用。

### 方案三：统一分类器和逐事件重开权威

做法是在适配器运行语义中为确有证据的原生映射声明 `turnStartAuthority: "authoritative"`，IPC 将其与 `stopAuthority`、`evidenceSource` 一起传给聚合器；聚合器只调用一次统一分类器，再由回合状态归约器根据当前回合身份决定重开、推进、封账或拒绝。

该方案不改变 JSONL 事件格式，能明确区分提供方事实与聚合策略，并与现有 `stopAuthority` 模式一致，因此采用。

## 所有权划分

| 层级 | 所有权 | 不负责 |
|---|---|---|
| 提供方适配器 | 原生事件到规范事件的映射；逐原生事件的无关联重开权威；`Stop` 权威 | 不保存面板状态，不决定 UI，不读取其他提供方事件 |
| IPC 接入层 | 根据 `agent + nativeEvent + event` 查找已注册运行语义；标记 `hook` / `transcript` 证据来源 | 不修改回合状态，不按 UI 需要改写事件 |
| 回合事件分类器 | 将规范事件和权威输入一次性分类为会话、回合起点、进展、工作、候选终态、可信终态或忽略 | 不读提供方名称，不持有可变状态 |
| 回合状态归约器 | 回合身份校验、幂等、封账、合法重开、工作集记账和拒绝原因 | 不查适配器注册表，不发布 UI 状态 |
| scope 协调与投影 | 消费归约结果，退休子智能体关联，选择面板可见状态 | 不再次按事件名推断终态或重开 |
| 日志 | 记录分类、证据来源、原生事件、拒绝原因和退休数量 | 不记录 prompt、transcript 正文、工具参数或工具标识 |
| renderer | 镜像 `pier://foreground-activity:changed` 完整快照 | 不读取终端画面、hook 文件或计时器补状态 |
| 测试 | 适配器事实、分类、状态机不变量、跨层发布和全仓回归 | 不用源码字符串检查替代行为验证 |

## 类型与模块设计

### 事件接入选项

`src/main/services/foreground-activity/types.ts` 增加以下内部类型：

```ts
export type AgentTurnStartAuthority = "authoritative" | "none";
export type AgentEventEvidenceSource = "hook" | "transcript";

export interface AgentEventIngestOptions {
  evidenceSource: AgentEventEvidenceSource;
  stopAuthority: AgentStopAuthority;
  turnStartAuthority: AgentTurnStartAuthority;
}
```

`ForegroundActivityAggregator.ingestAgentEvent` 接收完整的 `AgentEventIngestOptions`。真实 hook 接入必须显式传 `evidenceSource: "hook"`；Codex、Claude、Grok 等对账器产生的终态传 `evidenceSource: "transcript"`。测试辅助函数可以集中提供 hook 默认值，生产调用点不使用隐式默认。

### 适配器运行语义

`src/main/services/agents/integrations/types.ts` 的 `AgentRuntimeEventMapping` 增加可选字段：

```ts
readonly turnStartAuthority?: "authoritative";
```

只有原生事件本身能够证明当前会话重新进入活动阶段时才允许声明。首批声明固定为：

| 提供方 | 原生事件 | 规范事件 | 原因 |
|---|---|---|---|
| Cline | `TaskResume` | `running` | 官方事件直接表示任务恢复，是新的活动阶段 |
| Antigravity | `PreInvocation` | `processing` | 调用开始前的活动事实；该集成没有 `PromptSubmit` 等价事件 |

OpenCode、Kilo、Mimo Code 的 `session.status=busy/retry` 不声明该权威：它们已有带消息身份的 `chat.message → PromptSubmit`，`busy/retry` 只保留为回合内状态推进和自动重试信号。其他压缩、工具收尾、权限结果及 `Stop.active` 同样不得声明重开权威。

IPC 只在 `nativeEvent` 和规范 `event` 同时匹配已注册映射时授予权威；旧 v1 事件或未知映射一律为 `none`。这样历史残留生成器不能仅伪造一个原生事件名获得更强语义。

### 统一回合事件分类器

新增 `src/main/services/foreground-activity/agent-turn-event-semantics.ts`。分类器接收 `AgentHookEventPayload` 和 `AgentEventIngestOptions`，返回只读、带判别字段的语义对象，至少包含：

```ts
type AgentTurnEventCategory =
  | "session-start"
  | "session-end"
  | "turn-start"
  | "progress"
  | "work"
  | "terminal-candidate"
  | "terminal-trusted"
  | "ignored";

type TurnResetEvidence =
  | "explicit-prompt"
  | "provider-authoritative"
  | "turn-correlatable"
  | "none";

interface AgentTurnEventSemantics {
  readonly category: AgentTurnEventCategory;
  readonly createsSession: boolean;
  readonly mappedStatus: ActivityStatus | null | undefined;
  readonly resetEvidence: TurnResetEvidence;
  readonly terminalStatus?: "ready" | "error";
}
```

最终实现可以在不改变这些语义边界的前提下细分 `work` 类型，但不得把事件名集合重新散落到消费者中。

分类规则固定为：

- `PromptSubmit` 是 `turn-start + explicit-prompt`。
- 带非空 `turnId` 的 `processing` / `running` 是 `turn-start + turn-correlatable` 候选，是否确为新回合由归约器结合当前身份判断。
- 获得适配器权威的 `processing` / `running` 是 `turn-start + provider-authoritative`。
- 其余 `processing` / `running` 是普通 `progress`。
- `TurnCompleted`、`TurnInterrupted`、`error` 以及 `authoritative/reset-only Stop` 是可信终态。
- advisory `Stop` 是候选终态，映射状态为 `undefined`。
- `stopAuthority: "none"` 的 `Stop` 是忽略事件。
- v1/v2 `PermissionRequest` 的兼容 waiting 规则保留在分类器中；严格 v3 仍只接受成对交互事件。
- `SessionStart` / `SessionEnd` 只表达会话生命周期，不伪造回合状态。

同一事件同时带 `turnId` 和适配器权威时，身份事实优先：已结算身份直接拒绝，新的身份按可关联起点处理，只有缺少身份时才使用提供方权威进行无关联重开。这样适配器权威不能绕过已结算回合集合。

分类器替代 `TURN_BOUNDARY_EVENTS`、`TURN_RESET_EVENTS`、`SESSION_CREATING_EVENTS` 和 `agent-hook-compatibility.ts` 中分散的行为判定。共享层的 `activityStatusForHookEvent` 仍保留为无权威上下文的基础状态映射，但主进程不得绕过分类器直接据此改变回合状态。

### 回合状态归约结果

`applyTurnBookkeeping` 改为消费已分类语义，并返回可判别结果：

```ts
type TurnTransition =
  | "none"
  | "reset"
  | "terminal-candidate"
  | "terminal-trusted";

type TurnBookkeepingResult =
  | {
      accepted: false;
      reason:
        | "foreign-turn"
        | "sealed-turn"
        | "settled-turn"
        | "stop-without-authority";
    }
  | {
      accepted: true;
      transition: TurnTransition;
      terminalRetiredWork?: TerminalRetiredWork;
    };
```

scope 协调、子智能体关联退休和日志只消费 `transition`，不再次按事件名分类。

## 状态转换规则

### 可信终态

可信终态同步执行以下原子步骤：

1. 将当前 `turnId` 加入有限的已结算集合。
2. 设置 `turnEnded` 和终态时间。
3. 清除完成候选。
4. 同步退休工具、交互和子智能体工作集。
5. 投影 `ready` 或 `error`。

工具账本、交互账本和子智能体计数不能否定这次提交。终态之后同回合的工作事件、进展事件和重复终态被吸收。

### 终态纠正

- `ready → error`：允许，错误是更强事实。
- `ready → TurnInterrupted`：允许记录更精确的结束原因，状态仍为 `ready`。
- `error → ready`：拒绝，不能用较弱完成事实覆盖错误。
- 已结算 `turnId` 的重复终态：幂等吸收。

### 明确回合起点

`PromptSubmit` 的处理规则：

- 无 `turnId`：开启新回合并清理上一回合的活动记账。
- 新的、未结算 `turnId`：开启新回合并记录该身份。
- 与当前活跃回合相同的 `turnId`：按重复起点接受，但不清空当前工作集。
- 已结算 `turnId`：拒绝。

### 可关联起点

普通 `processing` / `running` 带 `turnId` 时：

- 当前回合已封账且该身份未结算：开启新回合。
- 当前活跃回合没有身份：补记 `turnId`，不清空工作集。
- 与当前活跃回合身份相同：作为普通进展。
- 与当前活跃回合身份不同：开启新回合。
- 身份已结算：拒绝。

### 提供方权威起点

获得 `turnStartAuthority: "authoritative"` 的 `processing` / `running`：

- 当前回合已封账：允许无 `turnId` 重开。
- 当前回合只是 advisory 完成候选：取消候选并恢复活动。
- 当前回合仍活跃：只作为进展，不重复清空工作集。

### 普通进展

没有回合身份和适配器权威的 `processing` / `running`：

- 活跃回合内正常推进状态。
- advisory 完成候选之后可证明仍在活动，因此取消候选。
- 可信终态之后拒绝，不能重新打开回合。

## 控制流

```text
提供方原生 hook ─┐
                  ├→ JSONL 规范事件 → IPC 查运行语义 ─┐
provider transcript ┘                                 │
                                                      ▼
                                     统一回合事件分类器
                                                      │
                                                      ▼
                                   回合身份校验与状态归约
                                                      │
                         ┌────────────────────────────┴─────────────┐
                         ▼                                          ▼
                 scope 状态与工作集                         安全结构化诊断
                         │
                         ▼
                   面板状态投影
                         │
                         ▼
          pier://foreground-activity:changed
                         │
                         ▼
               renderer 镜像 store → UI
```

Codex transcript 的 `task_complete` / `turn_aborted` 继续只补可信终态；它不获得回合起点权威，也不投影工具、进展或交互状态。

## 诊断设计

生命周期与拒绝日志增加以下安全字段：

- `evidenceSource`: `hook` 或 `transcript`。
- `nativeEvent`: v2/v3 原生事件名；v1 回退为规范事件名。
- `category` / `transition`: 分类和实际状态转换。
- `reason`: 被吸收时的有限枚举原因。
- `terminalRetiredWork`: 只含 `toolCount`、`interactionCount`、`subagentCount`。

继续允许现有的 `agent`、`panelId`、`sessionId`、`turnId` 和状态字段。禁止新增 prompt 片段、metadata、transcript 路径、工具名称、工具调用标识、交互标识、命令文本或参数。

## 明确禁止的反模式

- 不增加延时清理、宽限期、轮询等待或“若干毫秒后再设为 ready”。
- 不让 TTL、可见性消抖或广播批量计时器生成终态。
- 不根据终端文字、最终答复外观、窗口焦点或 renderer 生命周期推断完成。
- 不补造 `ToolComplete`、不在终态处等待工具账本归零。
- 不把 Codex、Cline、Antigravity 等提供方名称写入分类器或状态归约器。
- 不把所有 `processing` / `running` 一刀切为回合起点。
- 不仅通过修改示例期望值来证明设计正确；必须有独立不变量和乱序枚举测试。
- 不扩大 transcript 公共能力，不把提供方会话文件暴露给 renderer 或插件。

## 最小实施范围

### 新增

- `src/main/services/foreground-activity/agent-turn-event-semantics.ts`
- `tests/unit/main/panel/foreground-activity-turn-state-machine.test.ts`
- `tests/unit/main/panel/agent-turn-event-semantics.test.ts`

### 修改

- `src/main/services/foreground-activity/types.ts`
- `src/main/services/foreground-activity/entry.ts`
- `src/main/services/foreground-activity/turn-bookkeeping.ts`
- `src/main/services/foreground-activity/aggregator.ts`
- `src/main/services/foreground-activity/aggregator-hook-scopes.ts`
- `src/main/services/foreground-activity/aggregator-tracing.ts`
- `src/main/ipc/foreground-activity.ts`
- `src/main/services/agents/integrations/types.ts`
- `src/main/services/agents/integrations/cline.ts`
- `src/main/services/agents/integrations/antigravity.ts`
- 对应聚合器、集成轨迹、IPC 和 Codex 状态链测试
- `docs/superpowers/specs/2026-07-13-agent-status-adapter-contract-audit.md`

`agent-hook-compatibility.ts` 的兼容行为迁入统一分类器后删除，避免保留第二解释入口。若实施时发现其他真实消费者，允许保留仅做无状态输入归一化的薄函数，但它不得继续拥有会话创建、终态或重开语义。

## 测试策略

### 分类器测试

用表驱动的字面量期望验证每种规范事件、四种 `stopAuthority`、两种 `turnStartAuthority` 和旧 `PermissionRequest` 兼容路径。测试直接调用真实分类器，不复制生产集合或用生产辅助函数计算期望值。

### 状态机不变量

使用真实聚合器和手写事件序列验证：

1. 任意活跃工作组合后接任意可信终态，都同步进入对应终态。
2. 终态后的无关联进展、工作开始、工作结束和重复事件不能复活旧回合。
3. 明确 prompt、新 `turnId` 和提供方权威起点能重开；同 `turnId` 重复 prompt 不清账。
4. advisory `Stop` 在任何工具组合下都不产生 `ready`。
5. `ready` 可被错误纠正，`error` 不被完成事实覆盖。
6. 终态与迟到事件的排列、重复和跨来源顺序得到相同最终状态。
7. 推进所有相关假计时器不会产生 `ready`。

测试期望使用手写状态字面量，不从分类器或状态映射函数反算，以保证测试能捕获错误分支。

### 提供方与跨层测试

- Cline 状态轨迹增加 `TurnCompleted → TaskResume`，证明适配器权威可重开。
- Antigravity 状态轨迹增加 `error → PreInvocation`，证明无 `PromptSubmit` 的新活动可恢复。
- OpenCode、Kilo、Mimo Code 保持 `PromptSubmit` 为回合起点；其 `busy/retry` 不获得无关联重开权威。
- Codex 状态链保留 hook 与 transcript 的双顺序收敛，并断言 transcript 来源诊断。
- 全部现役提供方状态轨迹继续通过，确保没有因统一分类器丢失已审计能力。

## 需求到证据的验收矩阵

| 需求 | 代码或测试证据 | 通过条件 |
|---|---|---|
| 事件语义单一来源 | `agent-turn-event-semantics.ts`、分类器单测 | 聚合器、scope 协调和日志不再维护终态/重开事件集合 |
| 可信终态原子封账 | 状态机不变量测试、原聚合器回归测试 | 活跃工具、交互或子智能体不阻止 `ready/error` |
| 无关联迟到进展不复活 | 状态机不变量测试 | 终态后无 `turnId`、无权威的 `processing/running` 被拒绝 |
| 合法新回合可恢复 | Cline、Antigravity 轨迹和状态机测试 | prompt、新身份、`TaskResume`、`PreInvocation` 均能恢复活动态 |
| 重复事件幂等 | 状态机不变量测试 | 同身份重复 prompt 不清账，已结算身份不复活 |
| 候选终态保持诚实 | 状态机不变量测试 | advisory `Stop` 从不生成 `ready`，后续活动可取消候选 |
| 错误优先级稳定 | 状态机不变量测试 | `ready → error` 可纠正，`error → ready` 被拒绝 |
| 乱序最终收敛 | 状态机排列测试、Codex 状态链 | 可信终态与迟到收尾的不同顺序得到相同最终状态 |
| 时间不制造完成 | 假计时器测试 | TTL 只投影未知状态，不投影 `ready` |
| 诊断可追踪且不泄漏内容 | 生命周期和拒绝日志测试 | 有来源、原生事件、转换、原因和数量；无正文、路径、参数或工作标识 |
| 提供方能力不退化 | 全部提供方状态轨迹 | 所有现役轨迹与证据维度通过 |
| 进程与 UI 边界不变 | IPC、发布层、renderer store、Codex 状态链测试 | renderer 仍只消费主进程完整快照 |
| 全仓质量闭环 | `pnpm typecheck:host`、静态检查、`pnpm check`、`pnpm build` | 命令全部成功且没有新增警告 |

## 风险与回退

### 主要风险

1. 某个提供方实际依赖无关联 `processing/running` 从可信终态恢复，但审计中没有声明。防护方式是运行全部提供方轨迹，并为发现的真实原生起点在适配器侧补权威，不放宽聚合器全局规则。
2. 适配器映射声明与生成脚本不一致。IPC 同时匹配 `nativeEvent` 和规范 `event`，运行语义测试验证安装产物实际写出的事件。
3. 大范围重构时改变旧 v1/v2 兼容行为。分类器测试明确覆盖旧 `PermissionRequest` 和无 `nativeEvent` 输入。

### 回退边界

本设计不迁移持久化数据，也不改变 renderer 契约。若实现阶段发现未覆盖的提供方问题，可以回退分类器接线和适配器权威字段，保留已经验证的可信终态原子封账修复；不得回退到延时清理或工具账本批准终态。
