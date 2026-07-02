import { z } from "zod";
import {
  getFileContentOptionsSchema,
  gitCommitOptionsSchema,
  gitCreateBranchOptionsSchema,
  gitDeleteBranchOptionsSchema,
  gitDiffOptionsSchema,
  gitDiffSearchBranchesOptionsSchema,
  gitLogOptionsSchema,
  gitMergeOptionsSchema,
  gitPathsSchema,
  gitRebaseOptionsSchema,
  gitStashOptionsSchema,
  gitStashPopOptionsSchema,
  listBranchesOptionsSchema,
} from "./git.ts";
import { pluginInspectRequestSchema } from "./plugin.ts";
import { projectPreferencesSchema } from "./preferences.ts";
import {
  resolvedTerminalLaunchOptionsSchema,
  terminalLaunchEnvKeySchema,
  terminalLaunchOptionsSchema,
} from "./terminal-launch.ts";
import {
  type WorktreeOperationErrorReason,
  worktreeCheckRequestSchema,
  worktreeCreateRequestSchema,
  worktreeListRequestSchema,
  worktreeOpenRequestSchema,
  worktreeOpenTerminalRequestSchema,
  worktreePruneRequestSchema,
  worktreeRemoveRequestSchema,
} from "./worktree.ts";

export const pierProtocolVersionSchema = z.literal(1);
export type PierProtocolVersion = z.infer<typeof pierProtocolVersionSchema>;

export const projectPreferencesPatchSchema = projectPreferencesSchema.partial();
export type ProjectPreferencesPatch = z.infer<
  typeof projectPreferencesPatchSchema
>;

export const pierCommandPlacementSchema = z.enum([
  "active-tab",
  "split-right",
  "split-below",
  "split-left",
  "split-above",
]);
export type PierCommandPlacement = z.infer<typeof pierCommandPlacementSchema>;

export const pierCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("app.status") }),
  z.object({ type: z.literal("preferences.read") }),
  z.object({
    type: z.literal("preferences.update"),
    patch: projectPreferencesPatchSchema,
  }),
  z.object({
    recordId: z.string().min(1),
    type: z.literal("workspace.layout.read"),
  }),
  z.object({
    layout: z.unknown(),
    recordId: z.string().min(1),
    type: z.literal("workspace.layout.save"),
  }),
  z.object({
    recordId: z.string().min(1),
    type: z.literal("workspace.layout.clear"),
  }),
  z.object({
    type: z.literal("panel.open"),
    focus: z.boolean().optional(),
    path: z.string().min(1),
    placement: pierCommandPlacementSchema.optional(),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("terminal.open"),
    focus: z.boolean().optional(),
    launch: terminalLaunchOptionsSchema.optional(),
    placement: pierCommandPlacementSchema.optional(),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    projectRoot: z.string().min(1),
    type: z.literal("run.list"),
  }),
  z.object({
    focus: z.boolean().optional(),
    inputs: z.record(z.string().min(1), z.string()).optional(),
    placement: pierCommandPlacementSchema.optional(),
    projectRoot: z.string().min(1),
    taskId: z.string().min(1),
    type: z.literal("run.spawn"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    runId: z.string().min(1),
    type: z.literal("run.status"),
  }),
  z.object({
    runId: z.string().min(1),
    type: z.literal("run.cancel"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("run.recent"),
  }),
  z.object({ type: z.literal("terminal.profile.list") }),
  z.object({
    type: z.literal("terminal.profile.read"),
    profileId: z.string().min(1),
  }),
  z.object({
    type: z.literal("terminal.profile.upsert"),
    profile: resolvedTerminalLaunchOptionsSchema,
    profileId: z.string().min(1),
  }),
  z.object({
    type: z.literal("terminal.profile.delete"),
    profileId: z.string().min(1),
  }),
  z.object({ type: z.literal("window.list") }),
  z.object({ type: z.literal("window.create") }),
  z.object({
    type: z.literal("window.focus"),
    windowId: z.string().min(1),
  }),
  z.object({
    type: z.literal("window.close"),
    windowId: z.string().min(1),
  }),
  z.object({
    type: z.literal("panel.list"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("panel.focus"),
    focus: z.boolean().optional(),
    panelId: z.string().min(1),
    windowId: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal("commandPaletteMru.read") }),
  z.object({
    type: z.literal("commandPaletteMru.record"),
    actionId: z.string().min(1).max(128),
  }),
  z.object({ type: z.literal("commandPaletteMru.clear") }),
  worktreeListRequestSchema.extend({
    type: z.literal("worktree.list"),
  }),
  worktreeCheckRequestSchema.extend({
    type: z.literal("worktree.check"),
  }),
  worktreeCreateRequestSchema.extend({
    type: z.literal("worktree.create"),
  }),
  z.object({ type: z.literal("worktree.creationDefaults") }),
  worktreeOpenRequestSchema.extend({
    focus: z.boolean().optional(),
    placement: pierCommandPlacementSchema.optional(),
    type: z.literal("worktree.open"),
    windowId: z.string().min(1).optional(),
  }),
  worktreeOpenTerminalRequestSchema.extend({
    type: z.literal("worktree.openTerminal"),
  }),
  worktreeRemoveRequestSchema.extend({
    type: z.literal("worktree.remove"),
  }),
  worktreePruneRequestSchema.extend({
    type: z.literal("worktree.prune"),
  }),
  z.object({ type: z.literal("plugin.list") }),
  pluginInspectRequestSchema.extend({
    type: z.literal("plugin.inspect"),
  }),
  pluginInspectRequestSchema.extend({
    type: z.literal("plugin.enable"),
  }),
  pluginInspectRequestSchema.extend({
    type: z.literal("plugin.disable"),
  }),
  // Git 只读底座命令（renderer/插件经 IPC 调用 main 的 GitService）
  z.object({ type: z.literal("git.getStatus"), cwd: z.string().min(1) }),
  z.object({ type: z.literal("git.getRepoInfo"), cwd: z.string().min(1) }),
  z.object({
    type: z.literal("git.isWorkingTreeClean"),
    cwd: z.string().min(1),
  }),
  z.object({
    cwd: z.string().min(1),
    options: gitDiffOptionsSchema.optional(),
    type: z.literal("git.getDiffText"),
  }),
  z.object({
    cwd: z.string().min(1),
    options: gitDiffOptionsSchema.optional(),
    type: z.literal("git.getDiffSummary"),
  }),
  z.object({
    cwd: z.string().min(1),
    options: gitDiffOptionsSchema.optional(),
    type: z.literal("git.getDiffPatch"),
  }),
  z.object({
    cwd: z.string().min(1),
    options: gitLogOptionsSchema.optional(),
    type: z.literal("git.getLog"),
  }),
  z.object({
    cwd: z.string().min(1),
    oid: z.string().min(1),
    type: z.literal("git.getCommit"),
  }),
  z.object({
    cwd: z.string().min(1),
    oid: z.string().min(1),
    type: z.literal("git.getCommitPatch"),
  }),
  z.object({
    cwd: z.string().min(1),
    options: getFileContentOptionsSchema,
    type: z.literal("git.getFileContent"),
  }),
  z.object({
    cwd: z.string().min(1),
    options: listBranchesOptionsSchema,
    type: z.literal("git.listBranches"),
  }),
  z.object({
    cwd: z.string().min(1),
    options: gitDiffSearchBranchesOptionsSchema.optional(),
    type: z.literal("git.searchBranches"),
  }),
  z.object({ type: z.literal("git.listTags"), cwd: z.string().min(1) }),
  z.object({
    cwd: z.string().min(1),
    ref: z.string().min(1),
    type: z.literal("git.resolveRef"),
  }),
  z.object({
    cwd: z.string().min(1),
    name: z.string().min(1),
    type: z.literal("git.validateBranchName"),
  }),
  // Git 写命令(需 git:write capability)
  gitPathsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.stage"),
  }),
  gitPathsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.unstage"),
  }),
  gitPathsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.discardChanges"),
  }),
  gitCommitOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.commit"),
  }),
  gitCreateBranchOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.createBranch"),
  }),
  gitDeleteBranchOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.deleteBranch"),
  }),
  z.object({
    cwd: z.string().min(1),
    name: z.string().min(1),
    type: z.literal("git.checkoutBranch"),
  }),
  gitMergeOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.merge"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.mergeAbort"),
  }),
  gitStashOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.stash"),
  }),
  gitStashPopOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.stashPop"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.stashList"),
  }),
  gitRebaseOptionsSchema.extend({
    cwd: z.string().min(1),
    type: z.literal("git.rebase"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.rebaseAbort"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.rebaseContinue"),
  }),
  z.object({
    cwd: z.string().min(1),
    type: z.literal("git.undoLastCommit"),
  }),
]);

export type PierCommand = z.infer<typeof pierCommandSchema>;

export const pierCommandClientEnvSchema = z.record(
  terminalLaunchEnvKeySchema,
  z.string()
);

export const pierCommandEnvelopeSchema = z.object({
  protocolVersion: pierProtocolVersionSchema,
  requestId: z.string().min(1),
  clientId: z.string().min(1),
  clientEnv: pierCommandClientEnvSchema.optional(),
  command: pierCommandSchema,
});

export type PierCommandEnvelope = z.infer<typeof pierCommandEnvelopeSchema>;

export type PierCommandErrorCode =
  | "invalid_command"
  | "permission_denied"
  | "not_found"
  | "platform_unavailable"
  | "unsupported"
  | "internal_error"
  /**
   * git CLI 退出非 0 时的统一错误码;message 含 git 返回的 stderr 摘要,
   * 插件可据此分类("already exists"、"not fully merged"、"dirty worktree" 等)。
   */
  | "git_error"
  | WorktreeOperationErrorReason;

export type PierCommandResult =
  | { data: unknown; ok: true; requestId: string }
  | {
      error: {
        code: PierCommandErrorCode;
        message: string;
      };
      ok: false;
      requestId: string;
    };
