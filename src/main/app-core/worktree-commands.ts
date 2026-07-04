import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type { WorktreeCreateResult } from "@shared/contracts/worktree.ts";
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
  // setup 命令只来自用户偏好 —— 插件调用方传不了任意命令字符串。
  const preferences = await services.preferences.read();
  const setup = command.runSetup ? preferences.worktreeSetupCommand.trim() : "";
  return await executeTerminalOpenCommand(
    requestId,
    {
      focus: true,
      launch: { cwd: target.path, ...(setup ? { command: setup } : {}) },
      type: "terminal.open",
    },
    services
  );
}

export async function executeWorktreeCommand(
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
    case "worktree.creationDefaults": {
      const [preferences, rootPath] = await Promise.all([
        services.preferences.read(),
        services.worktrees.resolveRootPath({ path: command.path }),
      ]);
      return success(requestId, {
        copyPatterns: preferences.worktreeCopyPatterns,
        rootPath,
        setupCommand: preferences.worktreeSetupCommand,
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
    case "worktree.remove":
      return success(requestId, await services.worktrees.remove(command));
    case "worktree.prune":
      return success(requestId, await services.worktrees.prune(command));
    default:
      return null;
  }
}
