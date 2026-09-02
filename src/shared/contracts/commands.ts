import { z } from "zod";
import { assetCommandSchemas } from "./agent/asset-commands.ts";
import { aiGenerateTextRequestSchema } from "./ai.ts";
import {
  appCliInstallRequestSchema,
  appCliStatusRequestSchema,
  appCliUninstallRequestSchema,
} from "./app-cli.ts";
import { canvasCommandInvokeRequestSchema } from "./canvas-command.ts";
import { commentsCommandSchemas } from "./comments/index.ts";
import {
  environmentProjectRequestSchema,
  environmentSnapshotRequestSchema,
  environmentUpdateRequestSchema,
  environmentWorktreeBindingRequestSchema,
} from "./environment.ts";
import { appOpenExternalCommandSchema } from "./external-navigation.ts";
import { fileCommandSchemas } from "./file/commands.ts";
import { gitCommandSchemas } from "./git/commands.ts";
import { hostControlCommandSchemas } from "./host/control-commands.ts";
import {
  liveModulesCanvasTrustRequestSchema,
  liveModulesCompileRequestSchema,
  liveModulesGetUrlRequestSchema,
  liveModulesRegisterRootRequestSchema,
  liveModulesUnregisterRootRequestSchema,
} from "./live-modules.ts";
import { panelTransferPierCommandSchemas } from "./panel-transfer.ts";
import {
  pierHomeInfoRequestSchema,
  pierHomeRevealRequestSchema,
  pierHomeSkillsCreateRequestSchema,
  pierHomeSkillsDeleteRequestSchema,
  pierHomeSkillsListRequestSchema,
  pierHomeSkillsReadRequestSchema,
  pierHomeSkillsRevealRequestSchema,
  pierHomeSkillsSetAlwaysIncludeRequestSchema,
  pierHomeSkillsSnapshotRequestSchema,
  pierHomeSkillsWriteRequestSchema,
  skillsPierBindingsListRequestSchema,
  skillsPierBindingsMutateRequestSchema,
} from "./pier-home.ts";
import { managedPluginCommandSchemas } from "./plugin/commands.ts";
import { jsonValueSchema } from "./plugin/settings.ts";
import { pluginInspectRequestSchema } from "./plugin.ts";
import { projectPreferencesPatchSchema } from "./preferences-patch.ts";
import { projectSkillsCommandSchemas } from "./project-skills-commands.ts";
import { taskSpawnModeSchema } from "./tasks.ts";
import {
  resolvedTerminalLaunchOptionsSchema,
  terminalLaunchEnvKeySchema,
  terminalLaunchOptionsSchema,
} from "./terminal/launch.ts";
import {
  terminalStatusBarItemOverridePatchSchema,
  terminalStatusBarOverridePatchesSchema,
} from "./terminal/status-bar.ts";
import {
  type WorktreeOperationErrorReason,
  worktreeCheckRequestSchema,
  worktreeCreateRequestSchema,
  worktreeCreationDefaultsRequestSchema,
  worktreeGetRequestSchema,
  worktreeListRequestSchema,
  worktreeOpenRequestSchema,
  worktreeOpenTerminalRequestSchema,
  worktreePruneRequestSchema,
  worktreeRemoveRequestSchema,
} from "./worktree.ts";
export const pierProtocolVersionSchema = z.literal(1);
export type PierProtocolVersion = z.infer<typeof pierProtocolVersionSchema>;

export const pierCommandPlacementSchema = z.enum([
  "active-tab",
  "split-right",
  "split-below",
  "split-left",
  "split-above",
]);
export type PierCommandPlacement = z.infer<typeof pierCommandPlacementSchema>;

export const panelOpenPathEntrySchema = z.object({
  column: z.number().int().positive().optional(),
  line: z.number().int().positive().optional(),
  path: z.string().min(1),
});
export type PanelOpenPathEntry = z.infer<typeof panelOpenPathEntrySchema>;

export const pierCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("app.status") }),
  appOpenExternalCommandSchema,
  appCliStatusRequestSchema,
  appCliInstallRequestSchema,
  appCliUninstallRequestSchema,
  z.object({ type: z.literal("appUpdate.status") }),
  z.object({ type: z.literal("appUpdate.check") }),
  z.object({ type: z.literal("appUpdate.download") }),
  z.object({ type: z.literal("appUpdate.quitAndInstall") }),
  z.object({ type: z.literal("preferences.read") }),
  z.object({
    type: z.literal("preferences.update"),
    patch: projectPreferencesPatchSchema,
  }),
  z.object({ type: z.literal("shellEnvironment.status") }),
  z.object({ type: z.literal("shellEnvironment.refresh") }),
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
  z
    .object({
      type: z.literal("panel.open"),
      focus: z.boolean().optional(),
      path: z.string().min(1),
      paths: z.array(panelOpenPathEntrySchema).min(1).optional(),
      placement: pierCommandPlacementSchema.optional(),
      referencePanelId: z.string().min(1).optional(),
      windowId: z.string().min(1).optional(),
    })
    .superRefine((value, ctx) => {
      const first = value.paths?.[0];
      if (first && first.path !== value.path) {
        ctx.addIssue({
          code: "custom",
          message: "panel.open path must equal paths[0].path",
        });
      }
    }),
  z
    .object({
      type: z.literal("terminal.open"),
      focus: z.boolean().optional(),
      launch: terminalLaunchOptionsSchema.optional(),
      /** 后台创建：跳过可见性门控，挂载即建面（agents.start 委派路径）。 */
      backgroundCreate: z.boolean().optional(),
      /** 复用已有 panel 并换启动；与 `referencePanelId` 互斥。 */
      panelId: z.string().min(1).optional(),
      placement: pierCommandPlacementSchema.optional(),
      /** 相对分屏锚点；缺省为当前 active panel。不可与复用 `panelId` 同时出现。 */
      referencePanelId: z.string().min(1).optional(),
      windowId: z.string().min(1).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.panelId && value.referencePanelId) {
        ctx.addIssue({
          code: "custom",
          message: "terminal.open cannot combine panelId and referencePanelId",
        });
      }
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
    /** 依赖 label 缺失时仍只启动当前任务（及可解析依赖）。 */
    skipMissingDependencies: z.boolean().optional(),
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
  worktreeGetRequestSchema.extend({
    type: z.literal("worktree.get"),
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
  z.object({ type: z.literal("plugin.workspace.plan") }),
  pluginInspectRequestSchema.extend({
    type: z.literal("plugin.inspect"),
  }),
  pluginInspectRequestSchema.extend({
    type: z.literal("plugin.enable"),
  }),
  pluginInspectRequestSchema.extend({
    type: z.literal("plugin.disable"),
  }),
  z.object({
    payload: z.object({
      key: z.string().min(1),
      params: z.record(z.string().min(1), z.string().min(1)).optional(),
      pluginId: z.string().min(1),
    }),
    type: z.literal("pluginData.snapshot"),
  }),
  z.object({
    payload: z.object({
      key: z.string().min(1),
      params: z.record(z.string().min(1), z.string().min(1)).optional(),
      pluginId: z.string().min(1),
    }),
    type: z.literal("pluginData.watchStart"),
  }),
  z.object({
    payload: z.object({
      key: z.string().min(1),
      params: z.record(z.string().min(1), z.string().min(1)).optional(),
      pluginId: z.string().min(1),
    }),
    type: z.literal("pluginData.watchStop"),
  }),
  z.object({
    payload: z.object({
      key: z.string().min(1),
      payload: z.unknown().optional(),
      pluginId: z.string().min(1),
    }),
    type: z.literal("pluginAction.invoke"),
  }),
  canvasCommandInvokeRequestSchema,
  z.object({
    section: z.string().min(1).optional(),
    type: z.literal("settings.open"),
  }),
  z.object({ type: z.literal("usageData.refresh") }),
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
  ...commentsCommandSchemas,
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
  pierHomeInfoRequestSchema.extend({
    type: z.literal("pierHome.info"),
  }),
  pierHomeRevealRequestSchema.extend({
    type: z.literal("pierHome.reveal"),
  }),
  pierHomeSkillsListRequestSchema.extend({
    type: z.literal("pierHome.skills.list"),
  }),
  pierHomeSkillsSnapshotRequestSchema.extend({
    type: z.literal("pierHome.skills.snapshot"),
  }),
  pierHomeSkillsCreateRequestSchema.extend({
    type: z.literal("pierHome.skills.create"),
  }),
  pierHomeSkillsReadRequestSchema.extend({
    type: z.literal("pierHome.skills.read"),
  }),
  pierHomeSkillsWriteRequestSchema.extend({
    type: z.literal("pierHome.skills.write"),
  }),
  pierHomeSkillsDeleteRequestSchema.extend({
    type: z.literal("pierHome.skills.delete"),
  }),
  pierHomeSkillsSetAlwaysIncludeRequestSchema.extend({
    type: z.literal("pierHome.skills.setAlwaysInclude"),
  }),
  pierHomeSkillsRevealRequestSchema.extend({
    type: z.literal("pierHome.skills.reveal"),
  }),
  skillsPierBindingsListRequestSchema.extend({
    type: z.literal("skills.pierBindings.list"),
  }),
  skillsPierBindingsMutateRequestSchema.extend({
    type: z.literal("skills.pierBindings.bind"),
  }),
  skillsPierBindingsMutateRequestSchema.extend({
    type: z.literal("skills.pierBindings.unbind"),
  }),
  liveModulesRegisterRootRequestSchema.extend({
    type: z.literal("liveModules.registerRoot"),
  }),
  liveModulesUnregisterRootRequestSchema.extend({
    type: z.literal("liveModules.unregisterRoot"),
  }),
  liveModulesCompileRequestSchema.extend({
    type: z.literal("liveModules.compile"),
  }),
  liveModulesGetUrlRequestSchema.extend({
    type: z.literal("liveModules.getUrl"),
  }),
  liveModulesCanvasTrustRequestSchema.extend({
    type: z.literal("liveModules.trustStatus"),
  }),
  liveModulesCanvasTrustRequestSchema.extend({
    type: z.literal("liveModules.grantTrust"),
  }),
  liveModulesCanvasTrustRequestSchema.extend({
    type: z.literal("liveModules.revokeTrust"),
  }),
  ...assetCommandSchemas,
  // accounts.* commands removed: Codex accounts now live behind plugin RPC.
  // AI 任务级命令(main 侧持有配置与密钥,renderer 不经手 prompt/key)
  z.object({ type: z.literal("ai.status") }),
  aiGenerateTextRequestSchema.extend({
    type: z.literal("ai.generateText"),
  }),
  ...managedPluginCommandSchemas,
  ...panelTransferPierCommandSchemas,
  ...projectSkillsCommandSchemas,
  ...hostControlCommandSchemas,
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
   * 审批回写双重门未过：未决交互登记缺失/不符，或 agent 当前非 waiting。
   * 客户端应刷新快照后重读 pendingInteractionId，而非重试同一 interactionId。
   */
  | "interaction_stale"
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
        /** Node errno string (`EPERM` / `EACCES`) when the failure is a filesystem denial. */
        osCode?: string;
      };
      ok: false;
      requestId: string;
    };
