import { GitReviewIndexLoader } from "@plugins/builtin/git/renderer/git-review-index-loader.ts";
import type {
  GitReviewIndexOk,
  GitReviewIndexResult,
} from "@shared/contracts/git-review.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const EMPTY_INDEX: GitReviewIndexOk = {
  entries: [],
  groupSummaries: {},
  indexRevision: "index:empty",
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
  it("用户 mutation 刷新绕过 debounce，并在权威 index 落定后完成", async () => {
    vi.useFakeTimers();
    const requests: ReturnType<typeof deferred<GitReviewIndexResult>>[] = [];
    const loader = new GitReviewIndexLoader({
      cancel: vi.fn(async () => undefined),
      load: () => {
        const request = deferred<GitReviewIndexResult>();
        requests.push(request);
        return request.promise;
      },
      watch: () => () => undefined,
    });
    requests[0]?.resolve(EMPTY_INDEX);
    await flush();

    let settled = false;
    const refresh = loader.refreshNow().then(() => {
      settled = true;
    });
    expect(requests).toHaveLength(2);
    expect(settled).toBe(false);
    requests[1]?.resolve({
      ...EMPTY_INDEX,
      entries: [
        {
          entryKey: "changed",
          oldPaths: [],
          path: "changed.ts",
          renderSlots: [
            {
              group: "staged",
              oldPath: null,
              sectionKey: "section:changed",
              status: "modified",
              targetPath: "changed.ts",
            },
          ],
          status: "modified",
        },
      ],
      indexRevision: "index:changed",
    });
    await refresh;

    expect(settled).toBe(true);
    expect(loader.getSnapshot()).toMatchObject({
      kind: "loaded",
      refreshing: false,
      result: { entries: [{ entryKey: "changed" }] },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("mutation 刷新失败不解除提交屏障，retry 成功后才完成", async () => {
    vi.useFakeTimers();
    const requests: ReturnType<typeof deferred<GitReviewIndexResult>>[] = [];
    const loader = new GitReviewIndexLoader({
      cancel: vi.fn(async () => undefined),
      load: () => {
        const request = deferred<GitReviewIndexResult>();
        requests.push(request);
        return request.promise;
      },
      watch: () => () => undefined,
    });
    requests[0]?.resolve(EMPTY_INDEX);
    await flush();

    let settled = false;
    const refresh = loader.refreshNow().then(() => {
      settled = true;
    });
    requests[1]?.resolve({
      kind: "error",
      message: "fatal: unable to read index",
      reason: "commandFailed",
      retryable: true,
    });
    await flush();

    expect(settled).toBe(false);
    expect(loader.getSnapshot()).toMatchObject({
      kind: "loaded",
      refreshFailure: { reason: "commandFailed" },
    });

    loader.retry();
    await vi.advanceTimersByTimeAsync(120);
    expect(requests).toHaveLength(3);
    requests[2]?.resolve({
      ...EMPTY_INDEX,
      indexRevision: "index:recovered",
    });
    await refresh;
    expect(settled).toBe(true);
    expect(loader.getSnapshot()).toMatchObject({
      kind: "loaded",
      refreshFailure: null,
      result: { indexRevision: "index:recovered" },
    });
  });

  it("相同 revision 与相同摘要的重复 watcher 结果不推进 generation", async () => {
    vi.useFakeTimers();
    let notify: () => void = () => undefined;
    const loader = new GitReviewIndexLoader({
      cancel: vi.fn(async () => undefined),
      load: async () => EMPTY_INDEX,
      watch: (listener) => {
        notify = listener;
        return () => undefined;
      },
    });
    await flush();
    const initial = loader.getSnapshot();
    expect(initial.kind).toBe("loaded");
    if (initial.kind !== "loaded") {
      throw new Error("expected loaded index");
    }

    notify();
    await vi.advanceTimersByTimeAsync(120);
    await flush();

    expect(loader.getSnapshot()).toMatchObject({
      generation: initial.generation,
      kind: "loaded",
      refreshing: false,
    });
  });

  it("同一 revision 的摘要从 filesOnly 恢复时接收新结果", async () => {
    vi.useFakeTimers();
    let notify: () => void = () => undefined;
    const results: GitReviewIndexResult[] = [
      {
        ...EMPTY_INDEX,
        groupSummaries: {
          unstaged: {
            changedFiles: 1,
            kind: "filesOnly",
            omittedFiles: 1,
            reasons: ["timeout"],
          },
        },
      },
      {
        ...EMPTY_INDEX,
        groupSummaries: {
          unstaged: {
            changedFiles: 1,
            deletions: 0,
            excludedFiles: 0,
            insertions: 2,
            kind: "lineDelta",
          },
        },
      },
    ];
    const loader = new GitReviewIndexLoader({
      cancel: vi.fn(async () => undefined),
      load: async () => results.shift() as GitReviewIndexResult,
      watch: (listener) => {
        notify = listener;
        return () => undefined;
      },
    });
    await flush();
    const initial = loader.getSnapshot();

    notify();
    await vi.advanceTimersByTimeAsync(120);
    await flush();

    expect(loader.getSnapshot()).toMatchObject({
      kind: "loaded",
      result: {
        groupSummaries: {
          unstaged: {
            insertions: 2,
            kind: "lineDelta",
          },
        },
      },
    });
    const refreshed = loader.getSnapshot();
    if (initial.kind === "loaded" && refreshed.kind === "loaded") {
      expect(refreshed.generation).toBeGreaterThan(initial.generation);
    }
  });

  it("同一 revision 的更高状态序列仍作为 mutation 权威发布", async () => {
    vi.useFakeTimers();
    let notify: () => void = () => undefined;
    const results: GitReviewIndexResult[] = [
      { ...EMPTY_INDEX, stateSequence: 1 },
      { ...EMPTY_INDEX, stateSequence: 2 },
    ];
    const loader = new GitReviewIndexLoader({
      cancel: vi.fn(async () => undefined),
      load: async () => results.shift() as GitReviewIndexResult,
      watch: (listener) => {
        notify = listener;
        return () => undefined;
      },
    });
    await flush();
    const initial = loader.getSnapshot();
    expect(initial).toMatchObject({
      generation: 1,
      kind: "loaded",
      result: { stateSequence: 1 },
    });

    notify();
    await vi.advanceTimersByTimeAsync(120);
    await flush();

    const authoritative = loader.getSnapshot();
    expect(authoritative).toMatchObject({
      kind: "loaded",
      result: { stateSequence: 2 },
    });
    if (initial.kind === "loaded" && authoritative.kind === "loaded") {
      expect(authoritative.generation).toBeGreaterThan(initial.generation);
    }
  });

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

  it("失败恢复后的同修订结果仍推进 generation 以清理文档错误", async () => {
    vi.useFakeTimers();
    const results: GitReviewIndexResult[] = [
      EMPTY_INDEX,
      {
        kind: "error",
        message: "refresh failed",
        reason: "commandFailed",
        retryable: true,
      },
      EMPTY_INDEX,
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
    const initial = loader.getSnapshot();
    expect(initial.kind).toBe("loaded");
    if (initial.kind !== "loaded") {
      throw new Error("expected loaded index");
    }

    notify();
    await vi.advanceTimersByTimeAsync(120);
    await flush();
    notify();
    await vi.advanceTimersByTimeAsync(120);
    await flush();

    expect(loader.getSnapshot()).toMatchObject({
      kind: "loaded",
      refreshFailure: null,
    });
    const recovered = loader.getSnapshot();
    expect(recovered.kind).toBe("loaded");
    if (recovered.kind === "loaded") {
      expect(recovered.generation).toBeGreaterThan(initial.generation);
    }
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
