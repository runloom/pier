import type {
  WorktreeCheckRequest,
  WorktreeCheckResult,
  WorktreeCreateProgress,
  WorktreeCreateRequest,
  WorktreeCreateResult,
  WorktreeCreationDefaults,
  WorktreeCreationDefaultsRequest,
  WorktreeListRequest,
  WorktreeListResult,
  WorktreeOpenRequest,
  WorktreeOpenResult,
  WorktreeOpenTerminalRequest,
  WorktreeOpenTerminalResult,
  WorktreePruneRequest,
  WorktreeRemoveRequest,
  WorktreeRemoveResult,
} from "@shared/contracts/worktree.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { invokePierCommand, subscribeIpc } from "./ipc-envelope.ts";

export interface WorktreeCreateOptions {
  onProgress?: (progress: WorktreeCreateProgress) => void;
}

function createOperationId(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  // RFC 9562 UUID v4：主进程契约使用 z.uuid() 校验操作标识。
  bytes[6] = ((bytes[6] ?? 0) % 16) + 64;
  bytes[8] = ((bytes[8] ?? 0) % 64) + 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}

// sandboxed preload 不能加载普通 npm 依赖。这里保持为无依赖类型守卫，
// 不要改成运行时导入 contracts 中的 zod schema，否则构建会留下 require("zod")。
function isWorktreeCreateProgress(
  payload: unknown
): payload is WorktreeCreateProgress {
  if (!(payload && typeof payload === "object")) {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.operationId === "string" &&
    (candidate.phase === "creating" || candidate.phase === "initializing")
  );
}

export interface PierWorktreesAPI {
  check: (request: WorktreeCheckRequest) => Promise<WorktreeCheckResult>;
  create: (
    request: WorktreeCreateRequest,
    options?: WorktreeCreateOptions
  ) => Promise<WorktreeCreateResult>;
  creationDefaults: (
    request: WorktreeCreationDefaultsRequest
  ) => Promise<WorktreeCreationDefaults>;
  list: (request: WorktreeListRequest) => Promise<WorktreeListResult>;
  open: (request: WorktreeOpenRequest) => Promise<WorktreeOpenResult>;
  openTerminal: (
    request: WorktreeOpenTerminalRequest
  ) => Promise<WorktreeOpenTerminalResult>;
  prune: (request: WorktreePruneRequest) => Promise<WorktreeListResult>;
  remove: (request: WorktreeRemoveRequest) => Promise<WorktreeRemoveResult>;
}

export const worktreesApi: PierWorktreesAPI = {
  check: (request) =>
    invokePierCommand<WorktreeCheckResult>({
      path: request.path,
      type: "worktree.check",
    }),
  create: async (request, options) => {
    const operationId = options?.onProgress ? createOperationId() : undefined;
    const dispose = operationId
      ? subscribeIpc<unknown>(
          PIER_BROADCAST.WORKTREE_CREATE_PROGRESS,
          (payload) => {
            if (
              isWorktreeCreateProgress(payload) &&
              payload.operationId === operationId
            ) {
              options?.onProgress?.(payload);
            }
          }
        )
      : undefined;
    try {
      return await invokePierCommand<WorktreeCreateResult>({
        ...(request.base !== undefined && { base: request.base }),
        branch: request.branch,
        name: request.name,
        ...(operationId ? { operationId } : {}),
        path: request.path,
        type: "worktree.create",
      });
    } finally {
      dispose?.();
    }
  },
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
    invokePierCommand<WorktreeOpenResult>({
      path: request.path,
      type: "worktree.open",
    }),
  openTerminal: (request) =>
    invokePierCommand<WorktreeOpenTerminalResult>({
      ...request,
      type: "worktree.openTerminal",
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
