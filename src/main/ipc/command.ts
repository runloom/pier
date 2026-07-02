import { randomUUID } from "node:crypto";
import type { PierCommand } from "@shared/contracts/commands.ts";
import { pierCommandSchema } from "@shared/contracts/commands.ts";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { PIER } from "@shared/ipc-channels.ts";
import type { IpcMain } from "electron";
import { appCore } from "../app-core/app-core.ts";
import { windowManager } from "../windows/window-manager.ts";

const RENDERER_FACADE_COMMAND_TYPES = new Set<PierCommand["type"]>([
  "plugin.disable",
  "plugin.enable",
  "plugin.inspect",
  "plugin.list",
  "run.list",
  "run.cancel",
  "run.spawn",
  "run.status",
  "worktree.check",
  "worktree.create",
  "worktree.list",
  "worktree.open",
  "worktree.prune",
  "worktree.remove",
  // git 主体命令;capability 守门由 permissions.ts 配对
  "git.checkoutBranch",
  "git.commit",
  "git.createBranch",
  "git.deleteBranch",
  "git.discardChanges",
  "git.getCommit",
  "git.getCommitPatch",
  "git.getDiffPatch",
  "git.getDiffSummary",
  "git.getDiffText",
  "git.getFileContent",
  "git.getLog",
  "git.getRepoInfo",
  "git.getStatus",
  "git.isWorkingTreeClean",
  "git.listBranches",
  "git.listTags",
  "git.merge",
  "git.mergeAbort",
  "git.rebase",
  "git.rebaseAbort",
  "git.rebaseContinue",
  "git.resolveRef",
  "git.searchBranches",
  "git.stage",
  "git.stash",
  "git.stashList",
  "git.stashPop",
  "git.unstage",
  "git.undoLastCommit",
  "git.validateBranchName",
]);

function isRendererFacadeCommand(command: PierCommand): boolean {
  return RENDERER_FACADE_COMMAND_TYPES.has(command.type);
}

function ensureDesktopRendererClient(windowId: string): string {
  const clientId = `desktop-renderer:${windowId}`;
  const existing = appCore.clients.heartbeat(clientId);
  if (existing) {
    return clientId;
  }
  const now = Date.now();
  appCore.clients.register({
    capabilities: DEFAULT_CAPABILITIES_BY_CLIENT_KIND["desktop-renderer"],
    createdAt: now,
    id: clientId,
    kind: "desktop-renderer",
    lastSeenAt: now,
  });
  return clientId;
}

function senderWindowId(sender: Electron.WebContents): string {
  const window = windowManager.fromWebContents(sender);
  if (!window) {
    throw new Error("window not found");
  }
  const windowId = windowManager.findInternalIdByWindow(window);
  if (!windowId) {
    throw new Error("window context not found");
  }
  return windowId;
}

function commandForSender(command: PierCommand, windowId: string): PierCommand {
  if (command.type === "run.spawn" && !command.windowId) {
    return {
      ...command,
      windowId,
    };
  }
  return command;
}

export function registerCommandIpc(ipcMain: IpcMain): void {
  ipcMain.handle(PIER.COMMAND_EXECUTE, async (event, rawCommand: unknown) => {
    const parsed = pierCommandSchema.safeParse(rawCommand);
    if (!parsed.success) {
      throw new Error("invalid command");
    }
    const command: PierCommand = parsed.data;
    if (!isRendererFacadeCommand(command)) {
      throw new Error("unsupported renderer command");
    }
    const windowId = senderWindowId(event.sender);
    return await appCore.commandRouter.execute({
      clientId: ensureDesktopRendererClient(windowId),
      command: commandForSender(command, windowId),
      protocolVersion: 1,
      requestId: randomUUID(),
    });
  });
}
