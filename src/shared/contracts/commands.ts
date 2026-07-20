import { z } from "zod";
import { aiGenerateTextRequestSchema } from "./ai.ts";
import {
  environmentProjectRequestSchema,
  environmentSnapshotRequestSchema,
  environmentUpdateRequestSchema,
  environmentWorktreeBindingRequestSchema,
} from "./environment.ts";
import { fileCommandSchemas } from "./file-commands.ts";
import { gitCommandSchemas } from "./git-commands.ts";
import { pluginInspectRequestSchema } from "./plugin.ts";
import {
  appRelaunchCommandSchema,
  pluginCatalogListCommandSchema,
  pluginCheckUpdatesCommandSchema,
  pluginDevOverrideClearCommandSchema,
  pluginDevOverrideSetCommandSchema,
  pluginInstallCommandSchema,
  pluginRollbackCommandSchema,
  pluginUninstallCommandSchema,
  pluginUpdateCommandSchema,
} from "./plugin-commands.ts";
import { jsonValueSchema } from "./plugin-settings.ts";
import { taskSpawnModeSchema } from "./tasks.ts";
import {
  resolvedTerminalLaunchOptionsSchema,
  terminalLaunchEnvKeySchema,
  terminalLaunchOptionsSchema,
} from "./terminal-launch.ts";
import {
  terminalStatusBarItemOverridePatchSchema,
  terminalStatusBarOverridePatchesSchema,
} from "./terminal-status-bar.ts";
import {
  type WorktreeOperationErrorReason,
  worktreeCheckRequestSchema,
  worktreeCreateRequestSchema,
  worktreeCreationDefaultsRequestSchema,
  worktreeListRequestSchema,
  worktreeOpenRequestSchema,
  worktreeOpenTerminalRequestSchema,
  worktreePruneRequestSchema,
  worktreeRemoveRequestSchema,
} from "./worktree.ts";
export const pierProtocolVersionSchema = z.literal(1);
export type PierProtocolVersion = z.infer<typeof pierProtocolVersionSchema>;

import { projectPreferencesPatchSchema } from "./preferences-patch.ts";

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
  z.object({ type: z.literal("appUpdate.status") }),
  z.object({ type: z.literal("appUpdate.check") }),
  z.object({ type: z.literal("appUpdate.download") }),
  z.object({ type: z.literal("appUpdate.quitAndInstall") }),
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
    projectRootPath: z.string().min(1),
    type: z.literal("run.list"),
  }),
  z.object({
    type: z.literal("run.backgroundSnapshot"),
  }),
  z.object({
    type: z.literal("run.runsSnapshot"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    focus: z.boolean().optional(),
    forceRestart: z.boolean().optional(),
    inputs: z.record(z.string().min(1), z.string()).optional(),
    mode: taskSpawnModeSchema.optional(),
    placement: pierCommandPlacementSchema.optional(),
    projectRootPath: z.string().min(1),
    taskId: z.string().min(1),
    targetGroupId: z.string().min(1).optional(),
    terminalPanelId: z.string().min(1).optional(),
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
    force: z.boolean().optional(),
    runId: z.string().min(1),
    type: z.literal("run.stop"),
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
    operationId: z.uuid().optional(),
    type: z.literal("worktree.create"),
  }),
  worktreeCreationDefaultsRequestSchema.extend({
    type: z.literal("worktree.creationDefaults"),
  }),
  worktreeOpenRequestSchema.extend({
    focus: z.boolean().optional(),
    placement: pierCommandPlacementSchema.optional(),
    type: z.literal("worktree.open"),
    windowId: z.string().min(1).optional(),
  }),
  worktreeOpenTerminalRequestSchema.extend({
    windowId: z.string().min(1).optional(),
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
  z.object({ type: z.literal("pluginSettings.getAll") }),
  z.object({
    key: z.string().min(1),
    type: z.literal("pluginSettings.set"),
    value: jsonValueSchema,
  }),
  z.object({
    key: z.string().min(1),
    type: z.literal("pluginSettings.reset"),
  }),
  z.object({ type: z.literal("terminalStatusBar.prefs.getAll") }),
  z.object({
    itemId: z.string().min(1),
    // F7:携带 patch(值→设置;null→清除;缺省→保留现值),main 侧单线程合成,
    // 消除 renderer 端 read-modify-write 竞态(见 withItemOverridePatch)。
    patch: terminalStatusBarItemOverridePatchSchema,
    type: z.literal("terminalStatusBar.prefs.setItemOverride"),
  }),
  z.object({
    itemId: z.string().min(1),
    type: z.literal("terminalStatusBar.prefs.resetItem"),
  }),
  z.object({
    // F8:批量 patch 一次 IPC 原子应用(全部落盘 + 恰一次广播),
    // moveWithinGroup 等多字段重排场景改走这条,替代 N 次顺序 setItemOverride。
    patches: terminalStatusBarOverridePatchesSchema,
    type: z.literal("terminalStatusBar.prefs.applyOverrides"),
  }),
  ...fileCommandSchemas,
  ...gitCommandSchemas,
  // Local environment 域命令
  environmentSnapshotRequestSchema.extend({
    type: z.literal("environment.snapshot"),
  }),
  environmentProjectRequestSchema.extend({
    type: z.literal("environment.project.add"),
  }),
  environmentProjectRequestSchema.extend({
    type: z.literal("environment.project.remove"),
  }),
  environmentUpdateRequestSchema.extend({
    type: z.literal("environment.update"),
  }),
  environmentWorktreeBindingRequestSchema.extend({
    type: z.literal("environment.worktreeBinding"),
  }),
  // accounts.* commands removed: Codex accounts now live behind plugin RPC.
  // AI 任务级命令(main 侧持有配置与密钥,renderer 不经手 prompt/key)
  z.object({ type: z.literal("ai.status") }),
  aiGenerateTextRequestSchema.extend({
    type: z.literal("ai.generateText"),
  }),
  pluginCatalogListCommandSchema,
  pluginCheckUpdatesCommandSchema,
  pluginInstallCommandSchema,
  pluginUpdateCommandSchema,
  pluginRollbackCommandSchema,
  pluginUninstallCommandSchema,
  pluginDevOverrideSetCommandSchema,
  pluginDevOverrideClearCommandSchema,
  appRelaunchCommandSchema,
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
  | "cancelled"
  | "permission_denied"
  | "not_found"
  | "platform_unavailable"
  | "unsupported"
  | "internal_error"
  | "file_conflict"
  /**
   * git CLI 退出非 0 时的统一错误码;message 含 git 返回的 stderr 摘要,
   * 插件可据此分类("already exists"、"not fully merged"、"dirty worktree" 等)。
   */
  | "git_error"
  /**
   * git 触发的 hook 被外部信号杀掉（stderr 中出现 `died of signal N`）。
   * 典型场景：macOS 26+ XProtect 首次扫描 hook 慢，上游给 git spawn 设 timeout
   * → SIGKILL 波及 hook。UI 侧应当引导用户重试而非展示技术噪音。
   */
  | "git_hook_signal_killed"
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
