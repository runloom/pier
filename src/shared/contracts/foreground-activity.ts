import { z } from "zod";
import { agentKindSchema } from "./agent.ts";
import type { PanelTabStatus } from "./panel.ts";
/**
 * ForegroundActivity — 前台面板活动的统一模型（unified aggregator 契约）。
 *
 * 四种活动 kind，per-panel 一个 activity：
 * - `agent`  — 面板里跑着 agent（如 codex / claude），有会话生命周期。
 * - `task`   — 面板里跑着 pier task（用户显式触发的 npm/命令）。
 * - `shell`  — 面板里跑着普通 shell 命令（非 agent、非 task）。
 * - `idle`   — 面板存在但无活动（一般不产生 broadcast, 保留 kind 完整）。
 * 优先级（同 panel 出现多种候选时）：task > agent(hook) > agent(launch) > shell。
 * task 是用户显式操作, 覆盖一切；hook 证据优先于 launch 先验。
 */

export const activityKindSchema = z.enum(["agent", "task", "shell", "idle"]);
export type ActivityKind = z.infer<typeof activityKindSchema>;

/**
 * Agent 会话运行时状态（loomdesk 五态借鉴）：
 * - `ready`      — 进程存活但无活跃工作（回合结束, 等待输入）
 * - `processing` — 主循环推进中
 * - `tool`       — 调用工具
 * - `waiting`    — 等用户输入（PermissionRequest）
 * - `error`      — 最近事件是失败信号
 *
 * status 的唯一来源是 hook 证据。launch 先验（OSC 133 / launcher）只能
 * 证明「面板里有个 agent 二进制在跑」, 不能证明它处于任何会话状态——
 * 例如 `omp update` 这类非会话子命令。因此 AgentActivity.status 是
 * optional：缺席 = 没有足够证据断言具体运行态。它既可能来自 launch 先验，
 * 也可能是 hook 已观察到候选终态、但尚无可信完成证据；renderer 此时只出
 * 品牌图标，不展示“未知/待确认”等内部术语。
 */
export const activityStatusSchema = z.enum([
  "ready",
  "processing",
  "tool",
  "waiting",
  "error",
]);
export type ActivityStatus = z.infer<typeof activityStatusSchema>;

const baseActivityFields = {
  panelId: z.string().min(1),
  windowId: z.string().min(1).max(32),
  /** activity 首次建立的时刻（250ms 可见性消抖在 main 聚合器内完成）。 */
  spawnedAt: z.number().int().nonnegative(),
  /** 最近一次收到任何信号的时刻。 */
  updatedAt: z.number().int().nonnegative(),
};

const agentSessionTitleSourceSchema = z.enum(["user", "auto"]);

const agentActivitySchema = z
  .object({
    kind: z.literal("agent"),
    ...baseActivityFields,
    agentId: agentKindSchema,
    status: activityStatusSchema.optional(),
    /** `hook` = JSONL agentEvent 消息，`launch` = launcher/OSC133 先验点亮。 */
    source: z.enum(["hook", "launch"]),
    subagentCount: z.number().int().nonnegative(),
    /**
     * 状态最近一次「变化」的时刻（同状态内的心跳事件不重置, 供 UI 计时）。
     * 与 status 同生同灭：无可信状态投影时缺席。
     */
    stateStartedAt: z.number().int().nonnegative().optional(),
    /**
     * 产品会话名（≠ OSC terminalTitle）。P0 契约预留；P1 起由宿主写入。
     * status 映射禁止读/写本字段。
     */
    sessionTitle: z.string().min(1).max(40).optional(),
    sessionTitleSource: agentSessionTitleSourceSchema.optional(),
  })
  .strict();
export type AgentActivity = z.infer<typeof agentActivitySchema>;
export type AgentSessionTitleSource = z.infer<
  typeof agentSessionTitleSourceSchema
>;

const taskActivitySchema = z
  .object({
    kind: z.literal("task"),
    ...baseActivityFields,
    taskId: z.string().min(1),
    runId: z.string().min(1),
    label: z.string().min(1),
  })
  .strict();
export type TaskActivity = z.infer<typeof taskActivitySchema>;

const shellActivitySchema = z
  .object({
    kind: z.literal("shell"),
    ...baseActivityFields,
    /** native 未 embed cmdline 时 optional. */
    commandLine: z.string().max(4096).optional(),
  })
  .strict();
export type ShellActivity = z.infer<typeof shellActivitySchema>;

const idleActivitySchema = z
  .object({
    kind: z.literal("idle"),
    ...baseActivityFields,
  })
  .strict();
export type IdleActivity = z.infer<typeof idleActivitySchema>;

export const foregroundActivitySchema = z.discriminatedUnion("kind", [
  agentActivitySchema,
  taskActivitySchema,
  shellActivitySchema,
  idleActivitySchema,
]);
export type ForegroundActivity = z.infer<typeof foregroundActivitySchema>;

export const foregroundActivityBroadcastSchema = z.object({
  activities: z.array(foregroundActivitySchema),
  /** 单调递增广播序号（非 wall-clock——毫秒会并列, 破坏 store 单调守卫）。 */
  ts: z.number().int().positive(),
});
export type ForegroundActivityBroadcast = z.infer<
  typeof foregroundActivityBroadcastSchema
>;

/**
 * hook 事件名 → activity status。null = 未知事件，调用方应忽略。
 * 单源真理表：foreground-activity 的唯一权威映射。
 */
export function activityStatusForHookEvent(
  event: string
): ActivityStatus | null {
  switch (event) {
    case "PermissionRequest":
      return "waiting";
    case "ToolStart":
      return "tool";
    case "error":
      return "error";
    case "SessionStart":
    case "Stop":
    case "TurnCompleted":
    case "TurnInterrupted":
    case "SessionEnd":
      return "ready";
    case "PromptSubmit":
    case "ToolComplete":
    case "SubagentStart":
    case "SubagentStop":
    case "processing":
    case "running":
      return "processing";
    default:
      return null;
  }
}

/**
 * activity status → tab 指示器状态。ready 映射 idle = tab 无指示器；
 * undefined（launch 先验、无 hook 证据）同样无指示器。
 */
export function tabStatusForActivityStatus(
  status: ActivityStatus | undefined
): PanelTabStatus {
  switch (status) {
    case "processing":
    case "tool":
      return "running";
    case "waiting":
      return "waiting";
    case "error":
      return "failed";
    default:
      return "idle";
  }
}
