import type {
  WorktreeCheckRequest,
  WorktreeCheckResult,
  WorktreeCreateRequest,
  WorktreeCreateResult,
  WorktreeCreationDefaults,
  WorktreeCreationDefaultsRequest,
  WorktreeListRequest,
  WorktreeListResult,
  WorktreeOpenRequest,
  WorktreeOpenTerminalRequest,
  WorktreePruneRequest,
  WorktreeRemoveRequest,
  WorktreeRemoveResult,
} from "@shared/contracts/worktree.ts";
import { invokePierCommand } from "./ipc-envelope.ts";

export interface PierWorktreesAPI {
  check: (request: WorktreeCheckRequest) => Promise<WorktreeCheckResult>;
  create: (request: WorktreeCreateRequest) => Promise<WorktreeCreateResult>;
  creationDefaults: (
    request: WorktreeCreationDefaultsRequest
  ) => Promise<WorktreeCreationDefaults>;
  list: (request: WorktreeListRequest) => Promise<WorktreeListResult>;
  open: (request: WorktreeOpenRequest) => Promise<unknown>;
  openTerminal: (request: WorktreeOpenTerminalRequest) => Promise<unknown>;
  prune: (request: WorktreePruneRequest) => Promise<WorktreeListResult>;
  remove: (request: WorktreeRemoveRequest) => Promise<WorktreeRemoveResult>;
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
  creationDefaults: (request) =>
    invokePierCommand<WorktreeCreationDefaults>({
      path: request.path,
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
