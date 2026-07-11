import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcInvokeMock = vi.hoisted(() => vi.fn());
const ipcOnMock = vi.hoisted(() => vi.fn());
const ipcOffMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  ipcRenderer: {
    invoke: ipcInvokeMock,
    off: ipcOffMock,
    on: ipcOnMock,
  },
}));

import { worktreesApi } from "@preload/worktree-api.ts";

describe("worktreesApi.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_, index) => {
          bytes[index] = index;
        });
        return bytes;
      },
    });
  });

  it("只转发当前操作的合法进度，并在命令结束后解除订阅", async () => {
    let resolveInvoke!: (value: unknown) => void;
    ipcInvokeMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInvoke = resolve;
      })
    );
    const onProgress = vi.fn();

    const resultPromise = worktreesApi.create(
      { branch: "feature/a", name: "feature-a", path: "/repo" },
      { onProgress }
    );

    expect(ipcInvokeMock).toHaveBeenCalledWith(PIER.COMMAND_EXECUTE, {
      branch: "feature/a",
      name: "feature-a",
      operationId: "00010203-0405-4607-8809-0a0b0c0d0e0f",
      path: "/repo",
      type: "worktree.create",
    });
    expect(ipcOnMock).toHaveBeenCalledWith(
      PIER_BROADCAST.WORKTREE_CREATE_PROGRESS,
      expect.any(Function)
    );

    const listener = ipcOnMock.mock.calls[0]?.[1] as
      | ((event: unknown, payload: unknown) => void)
      | undefined;
    listener?.(
      {},
      {
        operationId: "00000000-0000-4000-8000-000000000099",
        phase: "initializing",
      }
    );
    listener?.(
      {},
      {
        operationId: "00010203-0405-4607-8809-0a0b0c0d0e0f",
        phase: "unknown",
      }
    );
    listener?.(
      {},
      {
        operationId: "00010203-0405-4607-8809-0a0b0c0d0e0f",
        phase: "creating",
      }
    );
    expect(onProgress).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith({
      operationId: "00010203-0405-4607-8809-0a0b0c0d0e0f",
      phase: "creating",
    });

    resolveInvoke({
      data: {
        copiedFiles: [],
        created: {
          bare: false,
          branch: "feature/a",
          detached: false,
          head: "abc123",
          isCurrent: false,
          isMain: false,
          locked: false,
          lockedReason: null,
          path: "/repo.worktree/feature-a",
          prunable: false,
          prunableReason: null,
        },
        targetPath: "/repo.worktree/feature-a",
        worktrees: [],
      },
      ok: true,
      requestId: "request-1",
    });

    await expect(resultPromise).resolves.toMatchObject({
      targetPath: "/repo.worktree/feature-a",
    });
    expect(ipcOffMock).toHaveBeenCalledWith(
      PIER_BROADCAST.WORKTREE_CREATE_PROGRESS,
      listener
    );
  });
});
