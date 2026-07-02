import { z } from "zod";
import { panelTabChromeSchema } from "./panel.ts";

export const TASK_EXIT_TITLE_PREFIX = "pier-task-exit:";

export const taskSourceSchema = z.enum([
  "package-script",
  "deno",
  "composer",
  "vscode",
  "zed",
  "cargo",
  "make",
  "pyproject",
  "mise",
  "just",
  "taskfile",
  "history",
]);
export type TaskSource = z.infer<typeof taskSourceSchema>;

export const taskCommandSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    command: z.string().min(1),
    kind: z.literal("shell"),
  }),
  z.object({
    args: z.array(z.string()),
    command: z.string().min(1),
    kind: z.literal("process"),
  }),
]);
export type TaskCommandSpec = z.infer<typeof taskCommandSpecSchema>;

export const taskConcurrencyPolicySchema = z.enum([
  "allow-concurrent",
  "dedupe",
]);
export type TaskConcurrencyPolicy = z.infer<typeof taskConcurrencyPolicySchema>;

export const taskPresentationSchema = z
  .object({
    clear: z.boolean().optional(),
    focus: z.boolean().optional(),
    reveal: z.enum(["always", "silent", "never"]).optional(),
    showCommand: z.boolean().optional(),
    showSummary: z.boolean().optional(),
  })
  .strict();
export type TaskPresentation = z.infer<typeof taskPresentationSchema>;

export const taskInputRequestSchema = z.discriminatedUnion("type", [
  z.object({
    default: z.string().optional(),
    description: z.string().optional(),
    id: z.string().min(1),
    type: z.literal("promptString"),
  }),
  z.object({
    default: z.string().optional(),
    description: z.string().optional(),
    id: z.string().min(1),
    options: z.array(z.string()),
    type: z.literal("pickString"),
  }),
]);
export type TaskInputRequest = z.infer<typeof taskInputRequestSchema>;

export const taskCandidateSchema = z
  .object({
    commandSpec: taskCommandSpecSchema,
    concurrencyPolicy: taskConcurrencyPolicySchema,
    cwd: z.string().min(1),
    dependsOn: z.array(z.string()).optional(),
    dependsOrder: z.enum(["parallel", "sequence"]).optional(),
    description: z.string().optional(),
    env: z.record(z.string().min(1), z.string()).optional(),
    group: z.string().optional(),
    hidden: z.boolean().optional(),
    id: z.string().min(1),
    inputs: z.array(taskInputRequestSchema).optional(),
    label: z.string().min(1),
    presentation: taskPresentationSchema.optional(),
    source: taskSourceSchema,
    tags: z.array(z.string()).optional(),
    unsupportedReason: z.string().optional(),
  })
  .strict();
export type TaskCandidate = z.infer<typeof taskCandidateSchema>;

export const taskSourceErrorSchema = z
  .object({
    message: z.string().min(1),
    source: taskSourceSchema,
  })
  .strict();
export type TaskSourceError = z.infer<typeof taskSourceErrorSchema>;

export const taskListResultSchema = z
  .object({
    errors: z.array(taskSourceErrorSchema),
    projectRoot: z.string().min(1),
    tasks: z.array(taskCandidateSchema),
  })
  .strict();
export type TaskListResult = z.infer<typeof taskListResultSchema>;

export const taskRunIdSchema = z.string().min(1);
export type TaskRunId = z.infer<typeof taskRunIdSchema>;

export const taskLaunchPlanSchema = z
  .object({
    command: z.string().min(1),
    cwd: z.string().min(1),
    dependsOn: z.array(z.string()).optional(),
    dependsOrder: z.enum(["parallel", "sequence"]).optional(),
    env: z.record(z.string().min(1), z.string()).optional(),
    focus: z.boolean(),
    label: z.string().min(1),
    presentation: taskPresentationSchema,
    projectRoot: z.string().min(1),
    rawCommand: z.string().min(1),
    source: taskSourceSchema,
    tab: panelTabChromeSchema,
    taskId: z.string().min(1),
  })
  .strict();
export type TaskLaunchPlan = z.infer<typeof taskLaunchPlanSchema>;

export const taskPanelStatusSchema = z.enum([
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type TaskPanelStatus = z.infer<typeof taskPanelStatusSchema>;

export const taskExitReasonSchema = z.enum([
  "process",
  "user",
  "renderer-dispose",
  "restore",
  "unknown",
]);
export type TaskExitReason = z.infer<typeof taskExitReasonSchema>;

export const taskExitSourceSchema = z.enum([
  "native-process-close",
  "shell-command-finished",
  "task-exit-marker",
  "panel-close",
  "restore",
]);
export type TaskExitSource = z.infer<typeof taskExitSourceSchema>;

export const taskPanelMetadataSchema = z
  .object({
    cwd: z.string().min(1),
    exitCode: z.number().int().optional(),
    exitReason: taskExitReasonSchema.optional(),
    exitSource: taskExitSourceSchema.optional(),
    finishedAt: z.number().int().nonnegative().optional(),
    label: z.string().min(1),
    projectRoot: z.string().min(1),
    rawCommand: z.string().min(1),
    runId: taskRunIdSchema,
    source: taskSourceSchema,
    startedAt: z.number().int().nonnegative(),
    status: taskPanelStatusSchema,
    taskId: z.string().min(1),
  })
  .strict();
export type TaskPanelMetadata = z.infer<typeof taskPanelMetadataSchema>;

export const taskRunNodeStatusSchema = z.enum([
  "pending",
  "running",
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
    projectRoot: z.string().min(1),
    rootTaskId: z.string().min(1),
    runId: taskRunIdSchema,
    status: taskRunNodeStatusSchema,
  })
  .strict();
export type TaskRunSnapshot = z.infer<typeof taskRunSnapshotSchema>;

export const taskPanelRefSchema = z
  .object({
    panelId: z.string().min(1),
    windowId: z.string().min(1).optional(),
  })
  .strict();
export type TaskPanelRef = z.infer<typeof taskPanelRefSchema>;

export const taskSpawnPreparationSchema = z.discriminatedUnion("status", [
  z.object({
    inputs: z.array(taskInputRequestSchema),
    status: z.literal("requires-input"),
  }),
  z.object({
    panelId: z.string().min(1),
    status: z.literal("already-running"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    launches: z.array(taskLaunchPlanSchema).min(1),
    restartRunId: taskRunIdSchema.optional(),
    reusablePanels: z.record(z.string().min(1), taskPanelRefSchema).optional(),
    status: z.literal("ready"),
  }),
  z.object({
    message: z.string().min(1),
    status: z.literal("unsupported"),
  }),
]);
export type TaskSpawnPreparation = z.infer<typeof taskSpawnPreparationSchema>;

export const taskSpawnResultSchema = z.discriminatedUnion("status", [
  z.object({
    panelId: z.string().min(1),
    status: z.literal("already-running"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    inputs: z.array(taskInputRequestSchema),
    status: z.literal("requires-input"),
  }),
  z.object({
    panelIds: z.array(z.string().min(1)),
    primaryPanelId: z.string().min(1),
    runId: taskRunIdSchema.optional(),
    snapshot: taskRunSnapshotSchema.optional(),
    status: z.literal("started"),
  }),
  z.object({
    message: z.string().min(1),
    status: z.literal("unsupported"),
  }),
]);
export type TaskSpawnResult = z.infer<typeof taskSpawnResultSchema>;

export const taskRecentEntrySchema = z
  .object({
    command: z.string().min(1),
    cwd: z.string().min(1),
    lastUsedAt: z.number().int().optional(),
    label: z.string().min(1),
    source: z.literal("history"),
    taskId: z.string().min(1).optional(),
    useCount: z.number().int().nonnegative().optional(),
  })
  .strict();
export type TaskRecentEntry = z.infer<typeof taskRecentEntrySchema>;

export const taskRecentStateSchema = z
  .object({
    entries: z.array(taskRecentEntrySchema),
    version: z.literal(1),
  })
  .strict();
export type TaskRecentState = z.infer<typeof taskRecentStateSchema>;
