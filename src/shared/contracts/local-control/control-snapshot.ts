/**
 * 顶层 control.snapshot / control.watch 负载（W4-S3 / W6-S5 after）。
 * FA 事实并入此流；无独立 activity 命令组。
 */
import { z } from "zod";
import { controlCursorAfterSchema } from "./cursor.ts";
import { worktreeRefSchema } from "./worktree-ref.ts";

const nonEmpty = z.string().min(1);

export const controlSnapshotAgentEntrySchema = z
  .object({
    agentId: nonEmpty,
    panelId: nonEmpty,
    windowId: nonEmpty,
    status: nonEmpty.optional(),
    worktreeKey: nonEmpty.optional(),
    cwd: nonEmpty.optional(),
    projectRootPath: nonEmpty.optional(),
  })
  .strict();

export const controlSnapshotTaskEntrySchema = z
  .object({
    runId: nonEmpty,
    status: nonEmpty,
    projectRootPath: nonEmpty,
    rootTaskId: nonEmpty.optional(),
  })
  .strict();

export const controlSnapshotWindowEntrySchema = z
  .object({
    windowId: nonEmpty,
    recordId: nonEmpty.optional(),
    focused: z.boolean().optional(),
  })
  .strict();

export const controlSnapshotPanelEntrySchema = z
  .object({
    panelId: nonEmpty,
    windowId: nonEmpty,
    component: nonEmpty.optional(),
    active: z.boolean().optional(),
    canonicalPath: nonEmpty.optional(),
    worktreeKey: nonEmpty.optional(),
    agentId: nonEmpty.optional(),
  })
  .strict();

export const controlSnapshotWorktreeEntrySchema = z
  .object({
    path: nonEmpty,
    canonicalPath: nonEmpty.optional(),
    worktreeRef: worktreeRefSchema.optional(),
    isMain: z.boolean().optional(),
    branch: nonEmpty.nullable().optional(),
  })
  .strict();

export const controlSnapshotActivityEntrySchema = z
  .object({
    kind: nonEmpty,
    status: nonEmpty.optional(),
    panelId: nonEmpty.optional(),
    windowId: nonEmpty.optional(),
    /**
     * M1 审批回写：waiting 态 agent 的未决交互 id（SPA 审批条数据源，
     * 客户端不得猜测）；无登记则缺省。
     */
    pendingInteractionId: nonEmpty.optional(),
  })
  .strict();

/** 指针级消息投影（W5-S4）；list/get 可含 body，snapshot 保持有界。 */
export const controlSnapshotNotificationEntrySchema = z
  .object({
    id: nonEmpty,
    kind: nonEmpty,
    severity: nonEmpty,
    title: nonEmpty,
    read: z.boolean(),
    ts: z.number().int().nonnegative(),
    panelId: nonEmpty.optional(),
    agentRef: nonEmpty.optional(),
  })
  .strict();

/** snapshot 内 notifications 条数上限（未读优先截断后的预算）。 */
export const CONTROL_SNAPSHOT_NOTIFICATIONS_LIMIT = 50;

/** E11：RuntimeControl 精确运行摘要；≠ screen 全文，无内容 cursor。 */
export const controlSnapshotRuntimeEntrySchema = z
  .object({
    bootId: nonEmpty,
    runtimeId: nonEmpty,
    generation: z.number().int().nonnegative(),
    agentId: nonEmpty,
    panelId: nonEmpty,
    windowId: nonEmpty,
    /** 运行事实字符串；非工作完成结论 */
    fact: nonEmpty,
    closed: z.boolean(),
    worktreeKey: nonEmpty.optional(),
    cwd: nonEmpty.optional(),
  })
  .strict();

export const controlSnapshotPayloadSchema = z
  .object({
    bootId: nonEmpty,
    revision: z.number().int().nonnegative(),
    capturedAt: z.number().int().nonnegative(),
    agents: z.array(controlSnapshotAgentEntrySchema),
    activity: z.array(controlSnapshotActivityEntrySchema),
    windows: z.array(controlSnapshotWindowEntrySchema),
    panels: z.array(controlSnapshotPanelEntrySchema),
    worktrees: z.array(controlSnapshotWorktreeEntrySchema),
    tasks: z.array(controlSnapshotTaskEntrySchema),
    /** W5-S4：NCS 指针；缺省空数组以兼容旧夹具 */
    notifications: z
      .array(controlSnapshotNotificationEntrySchema)
      .max(CONTROL_SNAPSHOT_NOTIFICATIONS_LIMIT)
      .default([]),
    /** E11：精确 RuntimeRef 投影；缺省空数组 */
    runtimes: z.array(controlSnapshotRuntimeEntrySchema).default([]),
  })
  .strict();

export type ControlSnapshotPayload = z.infer<
  typeof controlSnapshotPayloadSchema
>;

export const controlSnapshotParamsSchema = z
  .object({
    scope: nonEmpty.optional(),
  })
  .strict();

export type ControlSnapshotParams = z.infer<typeof controlSnapshotParamsSchema>;

export const controlWatchParamsSchema = z
  .object({
    /**
     * 续接游标（W6-S5）。
     * - number：历史兼容，仅 revision（boot=会话 boot，scope=global）
     * - object：`{ bootId?, revision, scope? }`；跨 boot/scope → snapshot_required
     * 缺省 = 先推当前 snapshot 再 live
     */
    after: controlCursorAfterSchema.optional(),
    timeoutMs: z.number().int().positive().max(3_600_000).optional(),
    pollMs: z.number().int().positive().max(60_000).optional(),
  })
  .strict();

export type ControlWatchParams = z.infer<typeof controlWatchParamsSchema>;
