import { GitReviewIndexLoader } from "@plugins/builtin/git/renderer/git-review-index-loader.ts";
import type {
  GitReviewIndexOk,
  GitReviewIndexResult,
} from "@shared/contracts/git-review.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const EMPTY_INDEX: GitReviewIndexOk = {
  entries: [],
  kind: "ok",
  warnings: [],
};

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
}

afterEach(() => {
  vi.useRealTimers();
});

describe("GitReviewIndexLoader", () => {
  it("把在飞期间的一百个事件合并为一轮尾随刷新", async () => {
    vi.useFakeTimers();
    const requests: ReturnType<typeof deferred<GitReviewIndexResult>>[] = [];
    let notify: () => void = () => undefined;
    const cancel = vi.fn(async () => undefined);
    const loader = new GitReviewIndexLoader({
      cancel,
      createOperationId: (() => {
        let index = 0;
        return () => `operation:${index++}`;
      })(),
      load: () => {
        const request = deferred<GitReviewIndexResult>();
        requests.push(request);
        return request.promise;
      },
      watch: (listener) => {
        notify = listener;
        return () => undefined;
      },
    });

    for (let index = 0; index < 100; index += 1) {
      notify();
    }
    expect(cancel).toHaveBeenCalledTimes(1);
    requests[0]?.resolve(EMPTY_INDEX);
    await flush();
    expect(requests).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(120);
    expect(requests).toHaveLength(2);
    requests[1]?.resolve(EMPTY_INDEX);
    await flush();
    expect(loader.getSnapshot()).toMatchObject({
      kind: "loaded",
      refreshing: false,
    });
  });

  it("拒绝被变更事件淘汰的旧响应", async () => {
    vi.useFakeTimers();
    const requests: ReturnType<typeof deferred<GitReviewIndexResult>>[] = [];
    let notify: () => void = () => undefined;
    const loader = new GitReviewIndexLoader({
      cancel: vi.fn(async () => undefined),
      load: () => {
        const request = deferred<GitReviewIndexResult>();
        requests.push(request);
        return request.promise;
      },
      watch: (listener) => {
        notify = listener;
        return () => undefined;
      },
    });
    notify();
    requests[0]?.resolve({
      ...EMPTY_INDEX,
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
    });
    await flush();
    expect(loader.getSnapshot()).toEqual({ kind: "loading" });

    await vi.advanceTimersByTimeAsync(120);
    requests[1]?.resolve(EMPTY_INDEX);
    await flush();
    expect(loader.getSnapshot()).toMatchObject({
      kind: "loaded",
      result: EMPTY_INDEX,
    });
  });

  it("刷新失败时保留已接受的旧 index", async () => {
    vi.useFakeTimers();
    const results: GitReviewIndexResult[] = [
      EMPTY_INDEX,
      {
        kind: "error",
        message: "refresh failed",
        reason: "commandFailed",
        retryable: true,
      },
    ];
    let notify: () => void = () => undefined;
    const loader = new GitReviewIndexLoader({
      cancel: vi.fn(async () => undefined),
      load: async () => results.shift() as GitReviewIndexResult,
      watch: (listener) => {
        notify = listener;
        return () => undefined;
      },
    });
    await flush();
    notify();
    await vi.advanceTimersByTimeAsync(120);
    await flush();

    expect(loader.getSnapshot()).toMatchObject({
      kind: "loaded",
      refreshFailure: { message: "refresh failed" },
      result: EMPTY_INDEX,
    });
  });

  it("初次失败重试后立即进入 loading 并只启动一轮请求", async () => {
    vi.useFakeTimers();
    const load = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "error",
        message: "initial failure",
        reason: "commandFailed",
        retryable: true,
      })
      .mockResolvedValueOnce(EMPTY_INDEX);
    const loader = new GitReviewIndexLoader({
      cancel: vi.fn(async () => undefined),
      load,
      watch: () => () => undefined,
    });
    await flush();
    expect(loader.getSnapshot().kind).toBe("error");

    loader.retry();
    expect(loader.getSnapshot()).toEqual({ kind: "loading" });
    expect(load).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(120);
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(loader.getSnapshot().kind).toBe("loaded");
  });

  it("watch 异步启动失败可见，并由 Retry 重新订阅和读取 index", async () => {
    vi.useFakeTimers();
    const failures: ((error: Error) => void)[] = [];
    const unsubscribes = [vi.fn(), vi.fn()];
    const watch = vi.fn((_listener, onStartFailure) => {
      failures.push(onStartFailure);
      return unsubscribes[failures.length - 1] ?? vi.fn();
    });
    const load = vi.fn(async () => EMPTY_INDEX);
    const loader = new GitReviewIndexLoader({
      cancel: vi.fn(async () => undefined),
      load,
      watch,
    });
    await flush();

    failures[0]?.(new Error("watch start failed"));
    expect(loader.getSnapshot()).toMatchObject({
      kind: "loaded",
      refreshFailure: {
        message: "watch start failed",
        reason: "internal",
        retryable: true,
      },
    });
    expect(unsubscribes[0]).toHaveBeenCalledOnce();

    loader.retry();
    expect(watch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120);
    await flush();

    expect(load).toHaveBeenCalledTimes(2);
    expect(loader.getSnapshot()).toMatchObject({
      kind: "loaded",
      refreshFailure: null,
    });
    loader.dispose();
    expect(unsubscribes[1]).toHaveBeenCalledOnce();
  });

  it("dispose 精确取消请求、定时器和 watcher", () => {
    vi.useFakeTimers();
    const cancel = vi.fn(async () => undefined);
    const unsubscribe = vi.fn();
    const loader = new GitReviewIndexLoader({
      cancel,
      createOperationId: () => "operation:active",
      load: () => new Promise<GitReviewIndexResult>(() => undefined),
      watch: () => unsubscribe,
    });

    loader.dispose();
    loader.dispose();
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith("operation:active");
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
