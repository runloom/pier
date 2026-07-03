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
 *
 * 优先级（同 panel 出现多种候选时）：agent > task > shell > idle。
 * 例如 agent 会话进行中用户触发 task rerun → task 覆盖 agent。
 */

export const activityKindSchema = z.enum(["agent", "task", "shell", "idle"]);
export type ActivityKind = z.infer<typeof activityKindSchema>;

/**
 * Agent 会话运行时状态（loomdesk 五态借鉴）：
 * - `ready`      — 进程存活但无活跃工作
 * - `processing` — 主循环推进中
 * - `tool`       — 调用工具
 * - `waiting`    — 等用户输入（PermissionRequest）
 * - `error`      — 最近事件是失败信号
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
  /** activity 首次建立的时刻。renderer 侧 250ms visibility gating 依赖。 */
  spawnedAt: z.number().int().nonnegative(),
  /** 最近一次收到任何信号的时刻。 */
  updatedAt: z.number().int().nonnegative(),
};

const agentActivitySchema = z
  .object({
    kind: z.literal("agent"),
    ...baseActivityFields,
    agentId: agentKindSchema,
    status: activityStatusSchema,
    /** `hook` = JSONL agentEvent 消息，`launch` = launcher/OSC133 先验点亮。 */
    source: z.enum(["hook", "launch"]),
    subagentCount: z.number().int().nonnegative(),
    /** 状态最近一次「变化」的时刻（同状态内的心跳事件不重置, 供 UI 计时）。 */
    stateStartedAt: z.number().int().nonnegative(),
  })
  .strict();
export type AgentActivity = z.infer<typeof agentActivitySchema>;

const taskActivitySchema = z
  .object({
    kind: z.literal("task"),
    ...baseActivityFields,
    taskId: z.string().min(1),
    label: z.string().min(1),
    status: z.enum(["running", "success", "failure", "cancelled"]),
    exitCode: z.number().int().optional(),
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
 * hook 事件名 → agent activity status。null = 未知事件，调用方应忽略。
 *
 * **同步维护提醒**：与 `src/shared/contracts/agent-session.ts` 的
 * `runtimeStatusForHookEvent` 逻辑相同。老 aggregator 删除前 (plan §C.4)
 * 两处必须同步——修一处务必修另一处，否则 broadcast 状态漂移。
 */
export function activityStatusForHookEvent(
  event: string
): ActivityStatus | null {
  switch (event) {
    case "PermissionRequest":
      return "waiting";
    case "ToolStart":
    case "ToolComplete":
      return "tool";
    case "error":
      return "error";
    case "SessionStart":
    case "Stop":
    case "SessionEnd":
      return "ready";
    case "PromptSubmit":
    case "SubagentStart":
    case "SubagentStop":
    case "processing":
    case "running":
      return "processing";
    default:
      return null;
  }
}

/** activity status → tab 指示器状态。ready 映射 idle = tab 无指示器。 */
export function tabStatusForActivityStatus(
  status: ActivityStatus
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
