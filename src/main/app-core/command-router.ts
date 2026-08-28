import {
  type PierCommand,
  type PierCommandResult,
  pierCommandEnvelopeSchema,
} from "@shared/contracts/commands.ts";
import type { LocalEnvironmentState } from "@shared/contracts/environment.ts";
import {
  type PanelContext,
  panelSnapshotSchema,
} from "@shared/contracts/panel.ts";
import type { WorktreeCreateProgress } from "@shared/contracts/worktree.ts";
import { applyAgentStatusHooksPreference } from "../services/agents/integrations/registry.ts";
import { requestOpenSettings } from "../settings-menu.ts";
import { windowManager } from "../windows/manager.ts";
import type { PierClientRegistry } from "./client-registry.ts";
import { mapCommandError } from "./command-error-mapping.ts";
import type { CommandExecutionContext } from "./command-execution-context.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "./command-results.ts";
import {
  executeRunCommand,
  executeTerminalCommand,
} from "./command-router-run-terminal.ts";
import type { PierCoreServices } from "./command-router-services.ts";
import { executeAgentAssetsCommand } from "./commands/agent-assets.ts";
import { executeAgentAttentionRespondCommand } from "./commands/agent-attention-respond.ts";
import { executeAiCommand } from "./commands/ai.ts";
import { executeAppCliCommand } from "./commands/app-cli.ts";
import { executeAppSnapshotCommand } from "./commands/app-snapshot.ts";
import { executeCanvasCommand } from "./commands/canvas-command.ts";
import { executeCommentsCommand } from "./commands/comments.ts";
import { executeEnvironmentCommand } from "./commands/environment.ts";
import { executeFileCommand } from "./commands/file.ts";
import { executeGitCommand } from "./commands/git.ts";
import { executeGitReviewCommand } from "./commands/git-review.ts";
import { executeLiveModulesCommand } from "./commands/live-modules.ts";
import { executeMemoryCommand } from "./commands/memory.ts";
import {
  executeNotificationsFocusCommand,
  executeNotificationsGetCommand,
  executeNotificationsListCommand,
  executeNotificationsMarkReadCommand,
  executeNotificationsWatchCommand,
} from "./commands/notifications.ts";
import {
  executePanelFocusCommand,
  executePanelListCommand,
  executePanelOpenCommand,
} from "./commands/panel.ts";
import {
  executePanelEqualizeCommand,
  executePanelSetSizeCommand,
} from "./commands/panel-size.ts";
import { executePanelTransferCommand } from "./commands/panel-transfer.ts";
import { executePierHomeCommand } from "./commands/pier-home.ts";
import { executePluginCommand } from "./commands/plugin.ts";
import { executeProjectSkillsCommand } from "./commands/project-skills.ts";
import { executeRemoteAccessCommand } from "./commands/remote-access.ts";
import { executeWorktreeCommand } from "./commands/worktree.ts";
import { authorizeCommand } from "./permissions.ts";
import { buildShellEnvironmentHostStatus } from "./shell-environment-commands.ts";
import { orderedWindows } from "./window-routing.ts";

export type { CommandExecutionContext } from "./command-execution-context.ts";
export type { PierCoreServices } from "./command-router-services.ts";

export interface CommandRouter {
  execute(
    envelope: unknown,
    context?: CommandExecutionContext
  ): Promise<PierCommandResult>;
}

export interface CreateCommandRouterArgs {
  clients: PierClientRegistry;
  onEnvironmentsChanged?: (snapshot: LocalEnvironmentState) => void;
  onWorktreeCreateProgress?: (progress: WorktreeCreateProgress) => void;
  services: PierCoreServices;
}

function requestIdOf(rawEnvelope: unknown): string {
  if (
    rawEnvelope &&
    typeof rawEnvelope === "object" &&
    "requestId" in rawEnvelope &&
    typeof rawEnvelope.requestId === "string" &&
    rawEnvelope.requestId.length > 0
  ) {
    return rawEnvelope.requestId;
  }
  return "unknown";
}

async function deriveActivePanelContext(
  services: PierCoreServices
): Promise<PanelContext | null> {
  const focusedWindow = orderedWindows(services.window.list()).find(
    (windowInfo) => windowInfo.focused
  );
  if (!focusedWindow) {
    return null;
  }
  const result = await services.rendererCommand.execute({
    type: "panel.list",
    windowId: focusedWindow.id,
  });
  if (!(result.ok && Array.isArray(result.data))) {
    return null;
  }
  for (const rawPanel of result.data) {
    const parsed = panelSnapshotSchema.safeParse(rawPanel);
    if (parsed.success && parsed.data.active) {
      return parsed.data.context ?? null;
    }
  }
  return null;
}

async function executeAppStateCommand(
  requestId: string,
  command: PierCommand,
  clients: PierClientRegistry,
  services: PierCoreServices,
  context: CommandExecutionContext = {}
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "app.status":
      return success(requestId, {
        clients: clients.list().length,
        panelContext: {
          active: await deriveActivePanelContext(services),
          recent: await services.panelContexts.listRecent(),
        },
        protocolVersion: 1,
      });
    case "app.snapshot":
      return await executeAppSnapshotCommand(requestId, command, services);
    case "app.cli.status":
    case "app.cli.install":
    case "app.cli.uninstall":
      return await executeAppCliCommand(requestId, command);
    case "notifications.list":
      return await executeNotificationsListCommand(
        requestId,
        command,
        services
      );
    case "notifications.get":
      return await executeNotificationsGetCommand(requestId, command, services);
    case "notifications.watch":
      return await executeNotificationsWatchCommand(
        requestId,
        command,
        services,
        context
      );
    case "notifications.focus":
      return await executeNotificationsFocusCommand(
        requestId,
        command,
        services
      );
    case "notifications.mark-read":
      return await executeNotificationsMarkReadCommand(
        requestId,
        command,
        services
      );
    case "appUpdate.status":
      return success(requestId, services.appUpdates.getStatus());
    case "appUpdate.check":
      return success(requestId, await services.appUpdates.check());
    case "appUpdate.download":
      return success(requestId, await services.appUpdates.download());
    case "appUpdate.quitAndInstall": {
      const status = services.appUpdates.getStatus();
      if (status.state !== "downloaded") {
        return success(requestId, status);
      }
      // 不直接调 updater：必须先走 before-quit flush（含 layout），
      // 否则更新安装会丢掉未落盘的工作区布局。
      const { performProdQuitAndInstall } = await import("./relaunch.ts");
      await performProdQuitAndInstall();
      return success(requestId, services.appUpdates.getStatus());
    }
    case "app.relaunch": {
      const { isDevRuntime } = await import("../runtime-mode.ts");
      const { performDevSoftRelaunch, performProdRelaunch } = await import(
        "./relaunch.ts"
      );
      if (isDevRuntime()) {
        await performDevSoftRelaunch(services.managedPlugins);
      } else {
        await performProdRelaunch();
      }
      return success(requestId, null);
    }
    case "commandPaletteMru.clear":
      return success(requestId, await services.commandPaletteMru.clear());
    case "commandPaletteMru.read":
      return success(requestId, await services.commandPaletteMru.read());
    case "commandPaletteMru.record":
      await services.commandPaletteMru.recordUse(command.actionId);
      return success(requestId, null);
    case "preferences.read":
      return success(requestId, await services.preferences.read());
    case "preferences.update": {
      const merged = await services.preferences.update(command.patch);
      if (command.patch.agentStatusHooks !== undefined) {
        // 偏好与摄入门闸以落盘值为准；hook 安装/卸载 best-effort，
        // 单家失败只记日志，不让 preferences.update 失败回滚 UI。
        try {
          await applyAgentStatusHooksPreference(merged.agentStatusHooks);
        } catch (err) {
          console.error("[preferences] agent hook install failed:", err);
        }
      }
      return success(requestId, merged);
    }
    case "shellEnvironment.status": {
      const prefs = await services.preferences.read();
      return success(
        requestId,
        buildShellEnvironmentHostStatus({
          diagnostics: services.processEnvironment.getHostDiagnostics(),
          disabled: prefs.shellEnvironment.disabled,
          timeoutMs: prefs.shellEnvironment.timeoutMs,
        })
      );
    }
    case "shellEnvironment.refresh": {
      const diagnostics = await services.processEnvironment.invalidate({
        reapplyHost: true,
      });
      const prefs = await services.preferences.read();
      return success(
        requestId,
        buildShellEnvironmentHostStatus({
          diagnostics,
          disabled: prefs.shellEnvironment.disabled,
          fallbackStatus: "skipped",
          timeoutMs: prefs.shellEnvironment.timeoutMs,
        })
      );
    }
    case "terminalStatusBar.prefs.getAll":
      return success(requestId, await services.terminalStatusBarPrefs.getAll());
    case "terminalStatusBar.prefs.resetItem":
      return success(
        requestId,
        await services.terminalStatusBarPrefs.resetItem(command.itemId)
      );
    case "terminalStatusBar.prefs.setItemOverride":
      return success(
        requestId,
        await services.terminalStatusBarPrefs.setItemOverride(
          command.itemId,
          command.patch
        )
      );
    case "terminalStatusBar.prefs.applyOverrides":
      return success(
        requestId,
        await services.terminalStatusBarPrefs.applyOverrides(command.patches)
      );
    case "settings.open": {
      const targeted = context.runtimeWindowId
        ? windowManager.get(context.runtimeWindowId)
        : undefined;
      const win = targeted ?? windowManager.getFocused();
      requestOpenSettings(
        win,
        command.section ? { section: command.section } : undefined
      );
      return success(requestId, null);
    }
    case "usageData.refresh":
      await services.usageData.refreshAll();
      return success(requestId, null);
    default:
      return null;
  }
}

async function executeWindowWorkspaceCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "window.close": {
      const closeResult = await services.window.close(command.windowId);
      switch (closeResult) {
        case "closed":
          return success(requestId, null);
        case "not-found":
          return failure(
            requestId,
            "not_found",
            `window not found: ${command.windowId}`
          );
        case "veto":
          return failure(
            requestId,
            "internal_error",
            `window close was vetoed: ${command.windowId}`
          );
        default: {
          const _exhaustive: never = closeResult;
          return _exhaustive;
        }
      }
    }
    case "window.create":
      return success(requestId, await services.window.create());
    case "window.focus":
      services.window.focus(command.windowId);
      return success(requestId, null);
    case "window.list":
      return success(requestId, services.window.list());
    case "workspace.layout.clear":
      await services.workspace.clearLayout(command.recordId);
      return success(requestId, null);
    case "workspace.layout.read":
      return success(
        requestId,
        await services.workspace.readLayout(command.recordId)
      );
    case "workspace.layout.save":
      await services.workspace.saveLayout(command.layout, command.recordId);
      return success(requestId, null);
    default:
      return null;
  }
}

async function executePanelCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "panel.focus":
      return await executePanelFocusCommand(requestId, command, services);
    case "panel.list":
      return await executePanelListCommand(requestId, command, services);
    case "panel.open":
      return await executePanelOpenCommand(requestId, command, services);
    case "panel.setSize":
      return await executePanelSetSizeCommand(requestId, command, services);
    case "panel.equalize":
      return await executePanelEqualizeCommand(requestId, command, services);
    default:
      return null;
  }
}

async function executeCommandByDomain(
  requestId: string,
  command: PierCommand,
  clients: PierClientRegistry,
  services: PierCoreServices,
  context: CommandExecutionContext,
  onEnvironmentsChanged?: (snapshot: LocalEnvironmentState) => void,
  onWorktreeCreateProgress?: (progress: WorktreeCreateProgress) => void
): Promise<PierCommandResult | null> {
  const executors = [
    (cmd: PierCommand) =>
      executeAgentAttentionRespondCommand(requestId, cmd, services),
    (cmd: PierCommand) => executeRemoteAccessCommand(requestId, cmd, services),
    (cmd: PierCommand) => executePluginCommand(requestId, cmd, services),
    (cmd: PierCommand) => executeAiCommand(requestId, cmd, services),
    (cmd: PierCommand) =>
      executeEnvironmentCommand(
        requestId,
        cmd,
        services,
        onEnvironmentsChanged
      ),
    (cmd: PierCommand) => executePierHomeCommand(requestId, cmd, services),
    (cmd: PierCommand) => executeLiveModulesCommand(requestId, cmd, services),
    (cmd: PierCommand) =>
      executeCanvasCommand(requestId, cmd, services, context),
    (cmd: PierCommand) => executeAgentAssetsCommand(requestId, cmd, services),
    (cmd: PierCommand) => executeMemoryCommand(requestId, cmd, services),
    (cmd: PierCommand) =>
      executeWorktreeCommand(
        requestId,
        cmd,
        services,
        onWorktreeCreateProgress
      ),
    (cmd: PierCommand) => executeFileCommand(requestId, cmd, services, context),
    (cmd: PierCommand) =>
      executeGitReviewCommand(requestId, cmd, services, context),
    (cmd: PierCommand) =>
      executeCommentsCommand(requestId, cmd, services, context),
    (cmd: PierCommand) => executeGitCommand(requestId, cmd, services),
    (cmd: PierCommand) => executeRunCommand(requestId, cmd, services, context),
    (cmd: PierCommand) =>
      executeTerminalCommand(requestId, cmd, services, context),
    (cmd: PierCommand) =>
      executeAppStateCommand(requestId, cmd, clients, services, context),
    (cmd: PierCommand) =>
      executeWindowWorkspaceCommand(requestId, cmd, services),
    (cmd: PierCommand) => executePanelCommand(requestId, cmd, services),
    (cmd: PierCommand) =>
      executePanelTransferCommand(requestId, cmd, services, context),
    (cmd: PierCommand) => executeProjectSkillsCommand(requestId, cmd, services),
  ];
  for (const executor of executors) {
    const result = await executor(command);
    if (result) {
      return result;
    }
  }
  return null;
}

async function executeKnownCommand(
  requestId: string,
  command: PierCommand,
  clients: PierClientRegistry,
  services: PierCoreServices,
  context: CommandExecutionContext = {},
  onEnvironmentsChanged?: (snapshot: LocalEnvironmentState) => void,
  onWorktreeCreateProgress?: (progress: WorktreeCreateProgress) => void
): Promise<PierCommandResult> {
  try {
    const result = await executeCommandByDomain(
      requestId,
      command,
      clients,
      services,
      context,
      onEnvironmentsChanged,
      onWorktreeCreateProgress
    );
    if (result) {
      return result;
    }
    return failure(
      requestId,
      "invalid_command",
      `unsupported command: ${command.type}`
    );
  } catch (err) {
    return mapCommandError(requestId, err);
  }
}

export function createCommandRouter({
  clients,
  onEnvironmentsChanged,
  onWorktreeCreateProgress,
  services,
}: CreateCommandRouterArgs): CommandRouter {
  return {
    async execute(rawEnvelope, trustedContext = {}) {
      const requestStartedAtMs = Date.now();
      const requestId = requestIdOf(rawEnvelope);
      const parsed = pierCommandEnvelopeSchema.safeParse(rawEnvelope);
      if (!parsed.success) {
        return failure(requestId, "invalid_command", "invalid command");
      }

      const { clientEnv, clientId, command } = parsed.data;
      const client = clients.get(clientId);
      if (!client) {
        return failure(requestId, "permission_denied", "unknown client");
      }

      const auth = authorizeCommand(command, client);
      if (!auth.ok) {
        return failure(requestId, "permission_denied", auth.reason);
      }

      return await executeKnownCommand(
        requestId,
        command,
        clients,
        services,
        { ...trustedContext, clientEnv, clientId, requestStartedAtMs },
        onEnvironmentsChanged,
        onWorktreeCreateProgress
      );
    },
  };
}
