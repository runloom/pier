import type {
  PierCommand,
  PierCommandErrorCode,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type {
  WorktreeCheckRequest,
  WorktreeCheckResult,
  WorktreeCreateRequest,
  WorktreeCreateResult,
  WorktreeCreationDefaults,
  WorktreeListRequest,
  WorktreeListResult,
  WorktreeOpenRequest,
  WorktreeOpenTerminalRequest,
  WorktreePruneRequest,
  WorktreeRemoveRequest,
  WorktreeRemoveResult,
} from "@shared/contracts/worktree.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

export interface PierWorktreesAPI {
  check: (request: WorktreeCheckRequest) => Promise<WorktreeCheckResult>;
  create: (request: WorktreeCreateRequest) => Promise<WorktreeCreateResult>;
  creationDefaults: () => Promise<WorktreeCreationDefaults>;
  list: (request: WorktreeListRequest) => Promise<WorktreeListResult>;
  open: (request: WorktreeOpenRequest) => Promise<unknown>;
  openTerminal: (request: WorktreeOpenTerminalRequest) => Promise<unknown>;
  prune: (request: WorktreePruneRequest) => Promise<WorktreeListResult>;
  remove: (request: WorktreeRemoveRequest) => Promise<WorktreeRemoveResult>;
}

async function invokePierCommand<T>(command: PierCommand): Promise<T> {
  const result = (await ipcRenderer.invoke(
    PIER.COMMAND_EXECUTE,
    command
  )) as PierCommandResult;
  if (result.ok) {
    return result.data as T;
  }
  const error = new Error(result.error.message) as Error & {
    code?: PierCommandErrorCode;
  };
  error.code = result.error.code;
  throw error;
}

export const worktreesApi: PierWorktreesAPI = {
  check: (request) =>
    invokePierCommand<WorktreeCheckResult>({
      path: request.path,
      type: "worktree.check",
    }),
  create: (request) =>
    invokePierCommand<WorktreeCreateResult>({
      ...(request.base !== undefined && { base: request.base }),
      branch: request.branch,
      name: request.name,
      path: request.path,
      type: "worktree.create",
    }),
  creationDefaults: () =>
    invokePierCommand<WorktreeCreationDefaults>({
      type: "worktree.creationDefaults",
    }),
  list: (request) =>
    invokePierCommand<WorktreeListResult>({
      path: request.path,
      type: "worktree.list",
    }),
  open: (request) =>
    invokePierCommand<unknown>({
      path: request.path,
      type: "worktree.open",
    }),
  openTerminal: (request) =>
    invokePierCommand<unknown>({ ...request, type: "worktree.openTerminal" }),
  prune: (request) =>
    invokePierCommand<WorktreeListResult>({
      path: request.path,
      type: "worktree.prune",
    }),
  remove: (request) =>
    invokePierCommand<WorktreeRemoveResult>({
      ...(request.currentPath !== undefined && {
        currentPath: request.currentPath,
      }),
      path: request.path,
      type: "worktree.remove",
    }),
};
