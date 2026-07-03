import { z } from "zod";

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
});

export const worktreeCreationDefaultsRequestSchema = z.object({
  path: z.string().min(1),
});
export type WorktreeCreationDefaultsRequest = z.infer<
  typeof worktreeCreationDefaultsRequestSchema
>;
export type WorktreeCreateRequest = z.infer<typeof worktreeCreateRequestSchema>;

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
  setupCommand: z.string(),
});
export type WorktreeCreationDefaults = z.infer<
  typeof worktreeCreationDefaultsSchema
>;

export const worktreeOpenTerminalRequestSchema = z.object({
  path: z.string().min(1),
  runSetup: z.boolean(),
});
export type WorktreeOpenTerminalRequest = z.infer<
  typeof worktreeOpenTerminalRequestSchema
>;
