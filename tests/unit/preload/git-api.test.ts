import { GitReviewIndexLoader } from "@plugins/builtin/git/renderer/git-review-index-loader.ts";
import type { GitReviewIndexResult } from "@shared/contracts/git-review.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const offMock = vi.hoisted(() => vi.fn());
const onMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  ipcRenderer: { invoke: invokeMock, off: offMock, on: onMock },
}));

import { gitApi } from "@preload/git-api.ts";

const operationId = "00000000-0000-4000-8000-000000000001";
const source = { contextId: "ctx-1", gitRootPath: "/repo" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("gitApi Review command boundary", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    offMock.mockReset();
    onMock.mockReset();
    invokeMock.mockResolvedValue({
      data: null,
      ok: true,
      requestId: "request-1",
    });
  });

  it("严格转发 index、document 和 cancel 三个只读命令", async () => {
    const indexRequest = { operationId, source };
    const documentRequest = {
      operationId,
      source: {
        ...source,
        oldPaths: [],
        path: "src/app.ts",
      },
    };
    const cancelRequest = { operationId };

    await gitApi.getReviewIndex(indexRequest);
    await gitApi.getReviewFileDocument(documentRequest);
    await gitApi.cancelReviewRequest(cancelRequest);

    expect(invokeMock.mock.calls).toEqual([
      [
        PIER.COMMAND_EXECUTE,
        { request: indexRequest, type: "git.getReviewIndex" },
      ],
      [
        PIER.COMMAND_EXECUTE,
        { request: documentRequest, type: "git.getReviewFileDocument" },
      ],
      [
        PIER.COMMAND_EXECUTE,
        { request: cancelRequest, type: "git.cancelReviewRequest" },
      ],
    ]);
  });

  it.each([
    ["返回 false", () => Promise.resolve(false)],
    ["拒绝", () => Promise.reject(new Error("watch unavailable"))],
  ])("watch START %s 时通知失败且不误发 STOP", async (_label, start) => {
    invokeMock.mockImplementationOnce(start);
    const onStartFailure = vi.fn();

    const unsubscribe = gitApi.watch("/repo", vi.fn(), onStartFailure);
    await Promise.resolve();
    await Promise.resolve();

    expect(onMock).toHaveBeenCalledWith(
      PIER_BROADCAST.GIT_CHANGED,
      expect.any(Function)
    );
    expect(onStartFailure).toHaveBeenCalledWith(expect.any(Error));
    expect(offMock).toHaveBeenCalledWith(
      PIER_BROADCAST.GIT_CHANGED,
      expect.any(Function)
    );

    unsubscribe();
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("使用 START 返回的 canonical 身份接收别名事件，并按稳定租约停止", async () => {
    invokeMock.mockResolvedValueOnce({
      gitRoot: "/canonical/repo",
      leaseId: "00000000-0000-4000-8000-000000000002",
    });
    const listener = vi.fn();
    const unsubscribe = gitApi.watch("/repo-alias", listener);
    await Promise.resolve();
    await Promise.resolve();
    const filtered = onMock.mock.calls[0]?.[1] as
      | ((event: unknown, payload: unknown) => void)
      | undefined;
    expect(filtered).toBeTypeOf("function");

    filtered?.(undefined, {
      changeKind: "worktree",
      gitRoot: "/canonical/repo",
    });
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    await Promise.resolve();
    await Promise.resolve();
    expect(invokeMock).toHaveBeenLastCalledWith(PIER.GIT_WATCH_STOP, {
      leaseId: "00000000-0000-4000-8000-000000000002",
    });
  });

  it("watch 租约就绪会让已完成首读的 IndexLoader 再读一次", async () => {
    vi.useFakeTimers();
    const started = deferred<unknown>();
    invokeMock.mockReturnValueOnce(started.promise);
    const requests: ReturnType<typeof deferred<GitReviewIndexResult>>[] = [];
    const oldIndex: GitReviewIndexResult = {
      entries: [
        {
          entryKey: "old",
          oldPaths: [],
          path: "old.ts",
          renderSlots: [
            {
              group: "unstaged",
              oldPath: null,
              sectionKey: "section:old",
              status: "modified",
              targetPath: "old.ts",
            },
          ],
          status: "modified",
        },
      ],
      kind: "ok",
      warnings: [],
    };
    const freshIndex: GitReviewIndexResult = {
      entries: [
        {
          entryKey: "fresh",
          oldPaths: [],
          path: "fresh.ts",
          renderSlots: [
            {
              group: "unstaged",
              oldPath: null,
              sectionKey: "section:fresh",
              status: "modified",
              targetPath: "fresh.ts",
            },
          ],
          status: "modified",
        },
      ],
      kind: "ok",
      warnings: [],
    };
    const loader = new GitReviewIndexLoader({
      cancel: vi.fn(async () => undefined),
      createOperationId: (() => {
        let index = 0;
        return () => `operation:${index++}`;
      })(),
      load: () => {
        const request = deferred<GitReviewIndexResult>();
        requests.push(request);
        return request.promise;
      },
      watch: (listener, onStartFailure, onReady) =>
        gitApi.watch("/repo", () => listener(), onStartFailure, onReady),
    });

    requests[0]?.resolve(oldIndex);
    await flush();
    expect(loader.getSnapshot()).toMatchObject({
      kind: "loaded",
      result: oldIndex,
    });

    started.resolve({
      gitRoot: "/repo",
      leaseId: "00000000-0000-4000-8000-000000000003",
    });
    await flush();
    expect(loader.getSnapshot()).toMatchObject({
      kind: "loaded",
      refreshing: true,
      result: oldIndex,
    });

    await vi.advanceTimersByTimeAsync(120);
    expect(requests).toHaveLength(2);
    requests[1]?.resolve(freshIndex);
    await flush();
    expect(loader.getSnapshot()).toMatchObject({
      kind: "loaded",
      refreshing: false,
      result: freshIndex,
    });
    loader.dispose();
  });

  it("已释放订阅的迟到 START 成功只停止租约且不发送就绪刷新", async () => {
    const started = deferred<unknown>();
    invokeMock.mockReturnValueOnce(started.promise);
    const listener = vi.fn();
    const onReady = vi.fn();
    const unsubscribe = gitApi.watch("/repo", listener, undefined, onReady);

    unsubscribe();
    started.resolve({
      gitRoot: "/repo",
      leaseId: "00000000-0000-4000-8000-000000000004",
    });
    await flush();

    expect(onReady).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenLastCalledWith(PIER.GIT_WATCH_STOP, {
      leaseId: "00000000-0000-4000-8000-000000000004",
    });
  });
});
