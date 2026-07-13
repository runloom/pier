import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import { agentTabIconId } from "@shared/contracts/agent-session.ts";
import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type { PanelTabChrome } from "@shared/contracts/panel.ts";
import type {
  WorktreeCreateProgress,
  WorktreeCreateResult,
} from "@shared/contracts/worktree.ts";
import { createLogger } from "@shared/logger.ts";
import { GitExecError } from "../services/git-exec.ts";
import {
  isLocalEnvironmentScriptError,
  LocalEnvironmentScriptError,
} from "../services/local-environment-scripts.ts";
import { LocalEnvironmentServiceError } from "../services/local-environments-service.ts";
import { copyWorktreeIncludes } from "../services/worktree-bootstrap.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "./command-results.ts";
import type { PierCoreServices } from "./command-router.ts";
import {
  executePanelOpenCommand,
  executeTerminalOpenCommand,
} from "./panel-commands.ts";

const worktreeCreateLog = createLogger("worktree.create");

type WorktreeCreateCommand = Extract<PierCommand, { type: "worktree.create" }>;

function worktreeCreateLogContext(
  requestId: string,
  command: WorktreeCreateCommand,
  phase: WorktreeCreateProgress["phase"]
): Record<string, unknown> {
  return {
    branch: command.branch,
    name: command.name,
    phase,
    requestId,
    requestedPath: command.path,
    ...(command.base ? { base: command.base } : {}),
    ...(command.operationId ? { operationId: command.operationId } : {}),
  };
}

function worktreeCreateErrorContext(
  requestId: string,
  command: WorktreeCreateCommand,
  phase: WorktreeCreateProgress["phase"],
  err: unknown
): Record<string, unknown> {
  const context = {
    ...worktreeCreateLogContext(requestId, command, phase),
    errorMessage: err instanceof Error ? err.message : String(err),
    errorName: err instanceof Error ? err.name : "UnknownError",
  };
  if (!(err instanceof GitExecError)) {
    return context;
  }
  return {
    ...context,
    gitArgs: err.args,
    gitCwd: err.cwd,
    gitExitCode: err.exitCode,
    gitStderr: err.stderr,
    gitStdout: err.stdout,
  };
}
async function copyCreateIncludes(
  result: WorktreeCreateResult,
  patterns: readonly string[]
): Promise<string[]> {
  const mainPath = result.worktrees.find((item) => item.isMain)?.path;
  if (!mainPath) {
    return [];
  }
  if (patterns.length === 0) {
    return [];
  }
  try {
    const copyResult = await copyWorktreeIncludes({
      mainPath,
      patterns: [...patterns],
      targetPath: result.targetPath,
    });
    return copyResult.copied;
  } catch (err) {
    // copy 失败不应让 create 整体失败:worktree 已建好,只是准备不完整。
    console.warn(
      "[worktree-commands] worktree copy includes failed:",
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

function agentTerminalTab(
  agentId: NonNullable<
    Extract<PierCommand, { type: "worktree.openTerminal" }>["agentId"]
  >
): PanelTabChrome {
  const entry = getAgentCatalogEntry(agentId);
  return {
    icon: { id: agentTabIconId(agentId) },
    title: entry?.label ?? agentId,
  };
}

function buildAgentInitialInput(
  taskPrompt: string | undefined
): string | undefined {
  const normalized = taskPrompt
    ?.replaceAll("\0", "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!normalized) {
    return;
  }
  return `${normalized}\r`;
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

async function executeWorktreeOpenTerminalCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "worktree.openTerminal" }>,
  services: PierCoreServices
): Promise<PierCommandResult> {
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
  let environmentEnv: Record<string, string> = {};
  try {
    const binding = await services.localEnvironments.resolveForWorktree(
      target.path
    );
    environmentEnv = binding?.project.env ?? {};
  } catch (err) {
    if (!(err instanceof LocalEnvironmentServiceError)) {
      throw err;
    }
  }
  const launchEnv =
    Object.keys(environmentEnv).length > 0 ? { env: environmentEnv } : {};
  const launch = command.agentId
    ? { agentId: command.agentId, cwd: target.path, ...launchEnv }
    : { cwd: target.path, ...launchEnv };
  const initialInput = command.agentId
    ? buildAgentInitialInput(command.taskPrompt)
    : undefined;
  return await executeTerminalOpenCommand(
    requestId,
    {
      focus: true,
      launch,
      ...(command.windowId ? { windowId: command.windowId } : {}),
      type: "terminal.open",
    },
    services,
    {
      ...(command.agentId ? { tab: agentTerminalTab(command.agentId) } : {}),
      ...(initialInput ? { initialInput } : {}),
      ...(command.targetGroupId
        ? { targetGroupId: command.targetGroupId }
        : {}),
    }
  );
}

async function executeWorktreeCreateCommand(
  requestId: string,
  command: WorktreeCreateCommand,
  services: PierCoreServices,
  onProgress?: (progress: WorktreeCreateProgress) => void
): Promise<PierCommandResult> {
  const reportProgress = (phase: WorktreeCreateProgress["phase"]): void => {
    if (command.operationId) {
      onProgress?.({ operationId: command.operationId, phase });
    }
  };
  let phase: WorktreeCreateProgress["phase"] = "creating";
  let created: WorktreeCreateResult | null = null;
  worktreeCreateLog.info(
    "create started",
    worktreeCreateLogContext(requestId, command, phase)
  );

  try {
    reportProgress(phase);
    const check = await services.worktrees.check({ path: command.path });
    if (check.status !== "supported") {
      // unsupported/unavailable — fall through to raw create for compat
      created = await services.worktrees.create(command);
      const copiedFiles = await copyCreateIncludes(created, []);
      worktreeCreateLog.info("create succeeded", {
        ...worktreeCreateLogContext(requestId, command, phase),
        targetPath: created.targetPath,
      });
      return success(requestId, { ...created, copiedFiles });
    }

    const project = await services.localEnvironments.resolveProject(
      check.mainPath
    );
    const shouldRunSetup =
      project !== null && project.setupCommand.trim() !== "";

    created = await services.worktrees.create(command);
    phase = "initializing";
    reportProgress(phase);

    await services.localEnvironments.bindWorktree({
      projectRootPath: check.mainPath,
      worktreePath: created.targetPath,
    });

    const copiedFiles = await copyCreateIncludes(
      created,
      project?.copyPatterns ?? []
    );

    if (shouldRunSetup && project) {
      await services.localEnvironments.runLifecycle({
        cwd: created.targetPath,
        project,
        phase: "setup",
      });
    }

    worktreeCreateLog.info("create succeeded", {
      ...worktreeCreateLogContext(requestId, command, phase),
      targetPath: created.targetPath,
    });
    return success(requestId, { ...created, copiedFiles });
  } catch (err) {
    worktreeCreateLog.error(
      "create failed",
      worktreeCreateErrorContext(requestId, command, phase, err)
    );
    if (
      err instanceof LocalEnvironmentScriptError ||
      isLocalEnvironmentScriptError(err) ||
      err instanceof LocalEnvironmentServiceError
    ) {
      const code =
        err instanceof LocalEnvironmentServiceError
          ? "environment_not_found"
          : "environment_script_failed";
      return failure(
        requestId,
        code,
        err instanceof Error ? err.message : String(err)
      );
    }
    throw err;
  } finally {
    if (created) {
      services.gitWatch.pulse(command.path);
    }
  }
}

export async function executeWorktreeCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices,
  onWorktreeCreateProgress?: (progress: WorktreeCreateProgress) => void
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "worktree.check":
      return success(requestId, await services.worktrees.check(command));
    case "worktree.list":
      return success(requestId, await services.worktrees.list(command));
    case "worktree.create":
      return await executeWorktreeCreateCommand(
        requestId,
        command,
        services,
        onWorktreeCreateProgress
      );
    case "worktree.creationDefaults": {
      const [project, rootPath] = await Promise.all([
        services.localEnvironments.resolveProject(command.path),
        services.worktrees.resolveRootPath({ path: command.path }),
      ]);
      return success(requestId, {
        copyPatterns: project?.copyPatterns ?? [],
        rootPath,
      });
    }
    case "worktree.open":
      return await executeWorktreeOpenCommand(requestId, command, services);
    case "worktree.openTerminal":
      return await executeWorktreeOpenTerminalCommand(
        requestId,
        command,
        services
      );
    case "worktree.remove": {
      const removed = await services.worktrees.remove(command, {
        beforeRemove: async ({ targetPath }) => {
          const binding =
            await services.localEnvironments.resolveForWorktree(targetPath);
          if (!binding) {
            return;
          }
          if (binding.project.cleanupCommand.trim() !== "") {
            await services.localEnvironments.runLifecycle({
              cwd: targetPath,
              project: binding.project,
              phase: "cleanup",
            });
          }
        },
      });
      await services.localEnvironments.clearWorktreeBinding(
        removed.removedPath
      );
      services.gitWatch.pulse(command.path);
      return success(requestId, removed);
    }
    case "worktree.prune": {
      const pruned = await services.worktrees.prune(command);
      services.gitWatch.pulse(command.path);
      return success(requestId, pruned);
    }
    default:
      return null;
  }
}
