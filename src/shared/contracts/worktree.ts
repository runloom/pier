import { z } from "zod";
import { agentKindSchema } from "./agent.ts";
import { panelContextSchema } from "./panel.ts";

export const worktreeUnavailableReasonSchema = z.enum([
  "not_git_repo",
  "git_unavailable",
  "invalid_path",
  "invalid_name",
]);
export type WorktreeUnavailableReason = z.infer<
  typeof worktreeUnavailableReasonSchema
>;

export const worktreeOperationErrorReasonSchema = z.enum([
  "not_git_repo",
  "git_unavailable",
  "invalid_path",
  "invalid_name",
  "invalid_branch",
  "not_found",
  "main_worktree",
  "current_worktree",
  "unsafe_path",
  "environment_not_found",
  "environment_script_failed",
]);
export type WorktreeOperationErrorReason = z.infer<
  typeof worktreeOperationErrorReasonSchema
>;

export const worktreeItemSchema = z.object({
  bare: z.boolean(),
  branch: z.string().min(1).nullable(),
  detached: z.boolean(),
  head: z.string().min(1).nullable(),
  isCurrent: z.boolean(),
  isMain: z.boolean(),
  locked: z.boolean(),
  lockedReason: z.string().min(1).nullable(),
  path: z.string().min(1),
  prunable: z.boolean(),
  prunableReason: z.string().min(1).nullable(),
});
export type WorktreeItem = z.infer<typeof worktreeItemSchema>;

export const worktreeListRequestSchema = z.object({
  path: z.string().min(1),
});
export type WorktreeListRequest = z.infer<typeof worktreeListRequestSchema>;

export const worktreeCheckRequestSchema = z.object({
  path: z.string().min(1),
});
export type WorktreeCheckRequest = z.infer<typeof worktreeCheckRequestSchema>;

export const worktreeCreateRequestSchema = z.object({
  base: z.string().min(1).optional(),
  branch: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  /**
   * 返回创建结果前完成项目 setup。用于随后立即启动 agent 的流程，避免 agent
   * 在尚未初始化的工作树中启动。普通终端流程不传，setup 仍交给终端展示输出。
   */
  runSetupBeforeReturn: z.boolean().optional(),
});

export const worktreeCreationDefaultsRequestSchema = z.object({
  path: z.string().min(1),
});
export type WorktreeCreationDefaultsRequest = z.infer<
  typeof worktreeCreationDefaultsRequestSchema
>;
export type WorktreeCreateRequest = z.infer<typeof worktreeCreateRequestSchema>;

export const worktreeCreatePhaseSchema = z.enum(["creating", "initializing"]);
export type WorktreeCreatePhase = z.infer<typeof worktreeCreatePhaseSchema>;

export const worktreeCreateProgressSchema = z.object({
  operationId: z.uuid(),
  phase: worktreeCreatePhaseSchema,
});
export type WorktreeCreateProgress = z.infer<
  typeof worktreeCreateProgressSchema
>;

export const worktreeOpenRequestSchema = z.object({
  path: z.string().min(1),
});
export type WorktreeOpenRequest = z.infer<typeof worktreeOpenRequestSchema>;

export const worktreeRemoveRequestSchema = z.object({
  currentPath: z.string().min(1).optional(),
  path: z.string().min(1),
});
export type WorktreeRemoveRequest = z.infer<typeof worktreeRemoveRequestSchema>;

export const worktreePruneRequestSchema = z.object({
  path: z.string().min(1),
});
export type WorktreePruneRequest = z.infer<typeof worktreePruneRequestSchema>;

export const worktreeListResultSchema = z.discriminatedUnion("status", [
  z.object({
    currentPath: z.string().min(1).optional(),
    mainPath: z.string().min(1),
    path: z.string().min(1),
    status: z.literal("available"),
    worktrees: z.array(worktreeItemSchema),
  }),
  z.object({
    path: z.string().min(1),
    reason: worktreeUnavailableReasonSchema,
    status: z.literal("unavailable"),
    worktrees: z.array(worktreeItemSchema),
  }),
]);
export type WorktreeListResult = z.infer<typeof worktreeListResultSchema>;

export const worktreeCheckResultSchema = z.discriminatedUnion("status", [
  z.object({
    currentPath: z.string().min(1).optional(),
    mainPath: z.string().min(1),
    path: z.string().min(1),
    status: z.literal("supported"),
  }),
  z.object({
    path: z.string().min(1),
    reason: worktreeUnavailableReasonSchema,
    status: z.literal("unsupported"),
  }),
]);
export type WorktreeCheckResult = z.infer<typeof worktreeCheckResultSchema>;

export const worktreeCreateResultSchema = z.object({
  copiedFiles: z.array(z.string()).optional(),
  created: worktreeItemSchema,
  /**
   * 项目 setupCommand（如已配置、非空且请求未要求在返回前执行）。renderer
   * 收到后在新开终端里作为 initialCommand 执行，让用户看到实时输出并可自行
   * Ctrl+C / retry。agent 启动流程会在 main 返回前完成 setup，因此不返回此字段。
   */
  pendingSetupCommand: z.string().min(1).optional(),
  targetPath: z.string().min(1),
  worktrees: z.array(worktreeItemSchema),
});
export type WorktreeCreateResult = z.infer<typeof worktreeCreateResultSchema>;

export const worktreeRemoveResultSchema = z.object({
  removedPath: z.string().min(1),
  worktrees: z.array(worktreeItemSchema),
});
export type WorktreeRemoveResult = z.infer<typeof worktreeRemoveResultSchema>;

export const worktreeCreationDefaultsSchema = z.object({
  copyPatterns: z.array(z.string()),
  rootPath: z.string().min(1),
});
export type WorktreeCreationDefaults = z.infer<
  typeof worktreeCreationDefaultsSchema
>;

export const worktreeOpenTerminalRequestSchema = z.object({
  agentId: agentKindSchema.optional(),
  /**
   * 非 agent 场景下，作为 shell 首次输入自动执行（末尾自动补 `\r`）。
   * agent 场景由 `taskPrompt` 承担，`initialCommand` 会被忽略。
   * 典型用途：worktree 创建后把 setup 命令挪到终端里跑，让输出对用户可见。
   */
  initialCommand: z.string().min(1).optional(),
  path: z.string().min(1),
  targetGroupId: z.string().min(1).optional(),
  taskPrompt: z.string().min(1).max(12_000).optional(),
});
export type WorktreeOpenTerminalRequest = z.infer<
  typeof worktreeOpenTerminalRequestSchema
>;

/**
 * worktree.open / worktree.openTerminal 的成功载荷。
 * 生产方是 renderer 的 panel.open / terminal.open 命令处理器
 * (workspace-renderer-commands.ts),经 main 透传回调用方。
 */
export const worktreeOpenResultSchema = z.object({
  context: panelContextSchema,
  panelId: z.string().min(1),
});
export type WorktreeOpenResult = z.infer<typeof worktreeOpenResultSchema>;

export const worktreeOpenTerminalResultSchema = z.object({
  context: panelContextSchema.optional(),
  panelId: z.string().min(1),
});
export type WorktreeOpenTerminalResult = z.infer<
  typeof worktreeOpenTerminalResultSchema
>;
