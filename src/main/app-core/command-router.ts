import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import {
  type PierCommand,
  type PierCommandResult,
  pierCommandEnvelopeSchema,
} from "@shared/contracts/commands.ts";
import {
  type PanelContext,
  panelSnapshotSchema,
} from "@shared/contracts/panel.ts";
import type { WorktreeCreateResult } from "@shared/contracts/worktree.ts";
import { GitExecError } from "../services/git-exec.ts";
import { PluginServiceError } from "../services/plugin-service.ts";
import { copyWorktreeIncludes } from "../services/worktree-bootstrap.ts";
import { WorktreeServiceError } from "../services/worktree-service.ts";
import type { PierClientRegistry } from "./client-registry.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "./command-results.ts";
import type { PierCoreServices } from "./command-router-services.ts";
import { executeGitCommand } from "./git-commands.ts";
import {
  executePanelFocusCommand,
  executePanelListCommand,
  executePanelOpenCommand,
  executeTerminalOpenCommand,
} from "./panel-commands.ts";
import { authorizeCommand } from "./permissions.ts";
import {
  executeRunCancelCommand,
  executeRunListCommand,
  executeRunRecentCommand,
  executeRunSpawnCommand,
  executeRunStatusCommand,
} from "./run-commands.ts";
import { orderedWindows } from "./window-routing.ts";

export type { PierCoreServices } from "./command-router-services.ts";

export interface CommandRouter {
  execute(envelope: unknown): Promise<PierCommandResult>;
}

export interface CreateCommandRouterArgs {
  clients: PierClientRegistry;
  services: PierCoreServices;
}

export interface CommandExecutionContext {
  clientEnv?: Record<string, string> | undefined;
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

async function executePluginCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "plugin.list":
      return success(requestId, await services.plugins.list());
    case "plugin.disable":
      return success(
        requestId,
        await services.plugins.setEnabled(command.id, false)
      );
    case "plugin.enable":
      return success(
        requestId,
        await services.plugins.setEnabled(command.id, true)
      );
    case "plugin.inspect": {
      const plugin = await services.plugins.inspect(command.id);
      if (!plugin) {
        return failure(
          requestId,
          "not_found",
          `plugin not found: ${command.id}`
        );
      }
      return success(requestId, plugin);
    }
    default:
      return null;
  }
}

async function executeWorktreeCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "worktree.check":
      return success(requestId, await services.worktrees.check(command));
    case "worktree.list":
      return success(requestId, await services.worktrees.list(command));
    case "worktree.create": {
      const created = await services.worktrees.create(command);
      const copiedFiles = await copyCreateIncludes(created, services);
      return success(requestId, { ...created, copiedFiles });
    }
    case "worktree.open":
      return await executeWorktreeOpenCommand(requestId, command, services);
    case "worktree.remove":
      return success(requestId, await services.worktrees.remove(command));
    case "worktree.prune":
      return success(requestId, await services.worktrees.prune(command));
    default:
      return null;
  }
}

async function copyCreateIncludes(
  result: WorktreeCreateResult,
  services: PierCoreServices
): Promise<string[]> {
  const mainPath = result.worktrees.find((item) => item.isMain)?.path;
  if (!mainPath) {
    return [];
  }
  const preferences = await services.preferences.read();
  if (preferences.worktreeCopyPatterns.length === 0) {
    return [];
  }
  try {
    const copyResult = await copyWorktreeIncludes({
      mainPath,
      patterns: preferences.worktreeCopyPatterns,
      targetPath: result.targetPath,
    });
    return copyResult.copied;
  } catch (err) {
    // copy 失败不应让 create 整体失败:worktree 已建好,只是准备不完整。
    console.warn(
      "[command-router] worktree copy includes failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

function canonicalPath(path: string): string {
  // git worktree list 输出 realpath 化的路径;用户传入的可能经过符号链接
  // (macOS 上 /tmp → /private/tmp)。路径不存在时回退纯字符串归一化。
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function sameResolvedPath(a: string, b: string): boolean {
  return canonicalPath(a) === canonicalPath(b);
}

async function executeWorktreeOpenCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "worktree.open" }>,
  services: PierCoreServices
): Promise<PierCommandResult> {
  // 按目标路径自身所属仓库校验,与调用方 cwd 无关。
  const result = await services.worktrees.list({ path: command.path });
  if (result.status === "unavailable") {
    return failure(
      requestId,
      result.reason,
      `path is not a known worktree for this repository: ${command.path}`
    );
  }
  const target = result.worktrees.find(
    (item) =>
      sameResolvedPath(item.path, command.path) && !(item.bare || item.prunable)
  );
  if (!target) {
    return failure(
      requestId,
      "invalid_path",
      `path is not a known worktree for this repository: ${command.path}`
    );
  }
  return await executePanelOpenCommand(
    requestId,
    {
      focus: command.focus,
      path: target.path,
      placement: command.placement,
      type: "panel.open",
      windowId: command.windowId,
    },
    services
  );
}

async function executeAppStateCommand(
  requestId: string,
  command: PierCommand,
  clients: PierClientRegistry,
  services: PierCoreServices
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
    case "commandPaletteMru.clear":
      return success(requestId, await services.commandPaletteMru.clear());
    case "commandPaletteMru.read":
      return success(requestId, await services.commandPaletteMru.read());
    case "commandPaletteMru.record":
      await services.commandPaletteMru.recordUse(command.actionId);
      return success(requestId, null);
    case "preferences.read":
      return success(requestId, await services.preferences.read());
    case "preferences.update":
      return success(
        requestId,
        await services.preferences.update(command.patch)
      );
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
    case "window.close":
      services.window.close(command.windowId);
      return success(requestId, null);
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
    default:
      return null;
  }
}

async function executeRunCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices,
  context: CommandExecutionContext
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "run.list":
      return await executeRunListCommand(requestId, command, services);
    case "run.spawn":
      return await executeRunSpawnCommand(requestId, command, services, {
        clientEnv: context.clientEnv,
      });
    case "run.status":
      return executeRunStatusCommand(requestId, command, services);
    case "run.cancel":
      return executeRunCancelCommand(requestId, command, services);
    case "run.recent":
      return executeRunRecentCommand(requestId, services);
    default:
      return null;
  }
}

async function executeTerminalCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices,
  context: CommandExecutionContext
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "terminal.open":
      return await executeTerminalOpenCommand(requestId, command, services, {
        clientEnv: context.clientEnv,
      });
    case "terminal.profile.delete":
      return success(
        requestId,
        await services.terminalProfiles.delete(command.profileId)
      );
    case "terminal.profile.list":
      return success(requestId, await services.terminalProfiles.list());
    case "terminal.profile.read":
      return success(
        requestId,
        await services.terminalProfiles.read(command.profileId)
      );
    case "terminal.profile.upsert":
      return success(
        requestId,
        await services.terminalProfiles.upsert(
          command.profileId,
          command.profile
        )
      );
    default:
      return null;
  }
}

async function executeKnownCommand(
  requestId: string,
  command: PierCommand,
  clients: PierClientRegistry,
  services: PierCoreServices,
  context: CommandExecutionContext = {}
): Promise<PierCommandResult> {
  try {
    const executors = [
      (cmd: PierCommand) => executePluginCommand(requestId, cmd, services),
      (cmd: PierCommand) => executeWorktreeCommand(requestId, cmd, services),
      (cmd: PierCommand) => executeGitCommand(requestId, cmd, services),
      (cmd: PierCommand) =>
        executeRunCommand(requestId, cmd, services, context),
      (cmd: PierCommand) =>
        executeTerminalCommand(requestId, cmd, services, context),
      (cmd: PierCommand) =>
        executeAppStateCommand(requestId, cmd, clients, services),
      (cmd: PierCommand) =>
        executeWindowWorkspaceCommand(requestId, cmd, services),
      (cmd: PierCommand) => executePanelCommand(requestId, cmd, services),
    ];
    for (const executor of executors) {
      const result = await executor(command);
      if (result) {
        return result;
      }
    }
    return failure(
      requestId,
      "invalid_command",
      `unsupported command: ${command.type}`
    );
  } catch (err) {
    if (err instanceof WorktreeServiceError) {
      return failure(requestId, err.reason, err.message);
    }
    if (err instanceof PluginServiceError) {
      const code =
        err.code === "invalid_manifest" ? "invalid_command" : err.code;
      return failure(requestId, code, err.message);
    }
    if (err instanceof GitExecError) {
      // 取 stderr 优先,空则 fallback stdout(git 把 "nothing to commit" 之类放 stdout)
      // 前 3 行作摘要,让插件能按内容分类("already exists"/"not fully merged"/
      // "dirty worktree"/"nothing to commit" 等)
      const rawSummary = err.stderr.trim() || err.stdout.trim();
      const summary = rawSummary.split("\n").slice(0, 3).join(" | ");
      const detail = summary.length > 0 ? ` -- ${summary}` : "";
      return failure(requestId, "git_error", `${err.message}${detail}`);
    }
    return failure(
      requestId,
      "internal_error",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function createCommandRouter({
  clients,
  services,
}: CreateCommandRouterArgs): CommandRouter {
  return {
    async execute(rawEnvelope) {
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

      return await executeKnownCommand(requestId, command, clients, services, {
        clientEnv,
      });
    },
  };
}
