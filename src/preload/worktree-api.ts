import type {
  WorktreeCheckRequest,
  WorktreeCheckResult,
  WorktreeCreateRequest,
  WorktreeCreateResult,
  WorktreeListRequest,
  WorktreeListResult,
  WorktreeOpenRequest,
  WorktreePruneRequest,
  WorktreeRemoveRequest,
  WorktreeRemoveResult,
} from "@shared/contracts/worktree.ts";
import { invokePierCommand } from "./ipc-envelope.ts";

export interface PierWorktreesAPI {
  check: (request: WorktreeCheckRequest) => Promise<WorktreeCheckResult>;
  create: (request: WorktreeCreateRequest) => Promise<WorktreeCreateResult>;
  list: (request: WorktreeListRequest) => Promise<WorktreeListResult>;
  open: (request: WorktreeOpenRequest) => Promise<unknown>;
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
