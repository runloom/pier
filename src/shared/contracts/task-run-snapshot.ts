import { z } from "zod";

export const taskRunIdSchema = z.string().min(1);
export type TaskRunId = z.infer<typeof taskRunIdSchema>;

export const taskSpawnModeSchema = z.enum(["background", "terminal-tab"]);
export type TaskSpawnMode = z.infer<typeof taskSpawnModeSchema>;

export const taskRunNodeStatusSchema = z.enum([
  "pending",
  "running",
  "stopping",
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
]);
export type TaskRunNodeStatus = z.infer<typeof taskRunNodeStatusSchema>;

export const taskRunNodeSnapshotSchema = z
  .object({
    blockedBy: z.string().min(1).optional(),
    exitCode: z.number().int().optional(),
    label: z.string().min(1),
    panelId: z.string().min(1).optional(),
    status: taskRunNodeStatusSchema,
    taskId: z.string().min(1),
    windowId: z.string().min(1).optional(),
  })
  .strict();
export type TaskRunNodeSnapshot = z.infer<typeof taskRunNodeSnapshotSchema>;

export const taskRunSnapshotSchema = z
  .object({
    nodes: z.record(z.string().min(1), taskRunNodeSnapshotSchema),
    projectRootPath: z.string().min(1),
    rootTaskId: z.string().min(1),
    runId: taskRunIdSchema,
    status: taskRunNodeStatusSchema,
  })
  .strict();
export type TaskRunSnapshot = z.infer<typeof taskRunSnapshotSchema>;

export const taskOutputStreamSchema = z.enum(["stdout", "stderr"]);
export type TaskOutputStream = z.infer<typeof taskOutputStreamSchema>;

export const taskOutputChunkSchema = z
  .object({
    sequence: z.number().int().positive(),
    stream: taskOutputStreamSchema,
    text: z.string().min(1),
  })
  .strict();
export type TaskOutputChunk = z.infer<typeof taskOutputChunkSchema>;

/**
 * 后台任务输出的快照/增量统一载荷。快照携带当前保留的全部 chunks，广播只
 * 携带本批新增 chunks；renderer 依靠 sequence 去重，并按 firstSequence 清除
 * main 端已因容量限制淘汰的旧内容。
 */
export const taskOutputUpdateSchema = z
  .object({
    chunks: z.array(taskOutputChunkSchema),
    firstSequence: z.number().int().positive(),
    runId: taskRunIdSchema,
    taskId: z.string().min(1),
    truncated: z.boolean(),
    version: z.number().int().nonnegative(),
  })
  .strict();
export type TaskOutputUpdate = z.infer<typeof taskOutputUpdateSchema>;

export const legacyTaskOutputPanelParamsSchema = z
  .object({
    label: z.string().min(1),
    runId: taskRunIdSchema,
    taskId: z.string().min(1),
  })
  .strict();

export const taskOutputPanelParamsV2Schema = z
  .object({
    contextId: z.string().min(1),
    generation: z.number().int().nonnegative(),
    instanceId: z.string().min(1).optional(),
    label: z.string().min(1),
    projectRootPath: z.string().min(1),
    selectedRunId: taskRunIdSchema,
    taskId: z.string().min(1),
    version: z.literal(2),
  })
  .strict();

/**
 * Task Output 是逻辑任务视图，不是某次运行的永久快照。
 *
 * v1 把 runId 当作面板身份，保留只用于读取旧布局；所有新建或重新绑定的面板
 * 必须写入 v2，并用 contextId + taskId + instanceId 标识视图、selectedRunId 标识
 * 当前展示的运行。
 */
export const taskOutputPanelParamsSchema = z.union([
  taskOutputPanelParamsV2Schema,
  legacyTaskOutputPanelParamsSchema,
]);
export type TaskOutputPanelParams = z.infer<typeof taskOutputPanelParamsSchema>;
export type TaskOutputPanelParamsV2 = z.infer<
  typeof taskOutputPanelParamsV2Schema
>;

export const taskRunTerminationSchema = z.enum(["interrupt", "force"]);
export type TaskRunTermination = z.infer<typeof taskRunTerminationSchema>;

export const TASK_STOP_GRACE_MS = 2000;

export const taskRunControlNodeSchema = taskRunNodeSnapshotSchema.extend({
  stopRequestedAt: z.number().int().nonnegative().optional(),
  termination: taskRunTerminationSchema.optional(),
});
export type TaskRunControlNode = z.infer<typeof taskRunControlNodeSchema>;

export const taskRunControlEntrySchema = z
  .object({
    mode: taskSpawnModeSchema,
    nodes: z.record(z.string().min(1), taskRunControlNodeSchema),
    originPanelId: z.string().min(1).optional(),
    ownerWindowId: z.string().min(1).optional(),
    projectRootPath: z.string().min(1),
    rootTaskId: z.string().min(1),
    runId: taskRunIdSchema,
    startedAt: z.number().int().nonnegative(),
    status: taskRunNodeStatusSchema,
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type TaskRunControlEntry = z.infer<typeof taskRunControlEntrySchema>;

export const taskRunsSnapshotSchema = z
  .object({
    runs: z.record(z.string().min(1), taskRunControlEntrySchema),
    version: z.number().int().nonnegative(),
  })
  .strict();
export type TaskRunsSnapshot = z.infer<typeof taskRunsSnapshotSchema>;

export function emptyTaskRunsSnapshot(): TaskRunsSnapshot {
  return { runs: {}, version: 0 };
}
