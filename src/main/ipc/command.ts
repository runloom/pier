import { randomUUID } from "node:crypto";
import type { PierCommand } from "@shared/contracts/commands.ts";
import { pierCommandSchema } from "@shared/contracts/commands.ts";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { PIER } from "@shared/ipc-channels.ts";
import type { IpcMain } from "electron";
import { appCore } from "../app-core/app-core.ts";
import { findWindowContext } from "../windows/window-identity.ts";
import { windowManager } from "../windows/window-manager.ts";
import { isTrustedMainFrame } from "./trusted-main-frame.ts";

interface GitReviewSenderState {
  clientId: string;
  generation: number;
  recordId: string;
}

const gitReviewSenderStates = new Map<number, GitReviewSenderState>();
const gitReviewSenderListeners = new Set<number>();

function gitReviewOwner(
  senderId: number,
  state: GitReviewSenderState
): {
  clientId: string;
  generation: number;
  windowRecordId: string;
} {
  return {
    clientId: state.clientId,
    generation: state.generation,
    windowRecordId: `${state.recordId}:webContents:${senderId}`,
  };
}

function releaseGitReviewSender(senderId: number): void {
  const state = gitReviewSenderStates.get(senderId);
  if (state !== undefined) {
    appCore.services.gitReview.releaseOwner(gitReviewOwner(senderId, state));
  }
}

function trackGitReviewSender(
  sender: Electron.WebContents,
  identity: { clientId: string; recordId: string }
): number {
  let state = gitReviewSenderStates.get(sender.id);
  if (state === undefined) {
    state = { ...identity, generation: 0 };
    gitReviewSenderStates.set(sender.id, state);
  } else {
    state.clientId = identity.clientId;
    state.recordId = identity.recordId;
  }
  if (!gitReviewSenderListeners.has(sender.id)) {
    gitReviewSenderListeners.add(sender.id);
    sender.on("did-navigate", () => {
      const current = gitReviewSenderStates.get(sender.id);
      if (current !== undefined) {
        releaseGitReviewSender(sender.id);
        current.generation += 1;
      }
    });
    sender.on("render-process-gone", () => {
      const current = gitReviewSenderStates.get(sender.id);
      if (current !== undefined) {
        releaseGitReviewSender(sender.id);
        current.generation += 1;
      }
    });
    sender.once("destroyed", () => {
      releaseGitReviewSender(sender.id);
      gitReviewSenderStates.delete(sender.id);
      gitReviewSenderListeners.delete(sender.id);
    });
  }
  return state.generation;
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

function senderWindowContext(sender: Electron.WebContents): {
  recordId: string;
  windowId: string;
} {
  const window = windowManager.fromWebContents(sender);
  if (!window) {
    throw new Error("window not found");
  }
  const windowId = windowManager.findInternalIdByWindow(window);
  if (!windowId) {
    throw new Error("window context not found");
  }
  const context = findWindowContext(window);
  if (!context) {
    throw new Error("window record context not found");
  }
  return { recordId: context.recordId, windowId };
}

function commandForSender(command: PierCommand, windowId: string): PierCommand {
  if (
    command.type === "run.spawn" ||
    command.type === "run.runsSnapshot" ||
    command.type === "worktree.openTerminal"
  ) {
    return {
      ...command,
      windowId,
    };
  }
  return command;
}

export function registerCommandIpc(ipcMain: IpcMain): void {
  ipcMain.handle(PIER.COMMAND_EXECUTE, async (event, rawCommand: unknown) => {
    if (!isTrustedMainFrame(event)) {
      throw new Error("command sender is not the main frame");
    }
    const parsed = pierCommandSchema.safeParse(rawCommand);
    if (!parsed.success) {
      throw new Error("invalid command");
    }
    const command: PierCommand = parsed.data;
    const { recordId, windowId } = senderWindowContext(event.sender);
    const clientId = ensureDesktopRendererClient(windowId);
    const navigationGeneration = trackGitReviewSender(event.sender, {
      clientId,
      recordId,
    });
    return await appCore.commandRouter.execute(
      {
        clientId,
        command: commandForSender(command, windowId),
        protocolVersion: 1,
        requestId: randomUUID(),
      },
      {
        navigationGeneration,
        webContentsId: event.sender.id,
        windowRecordId: recordId,
      }
    );
  });
}
