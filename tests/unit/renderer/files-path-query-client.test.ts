import { createFilesPathQueryClient } from "@plugins/builtin/files/renderer/files-path-query-client.ts";
import {
  __resetFilesPathMruForTests,
  recordFilesPathMru,
} from "@plugins/builtin/files/renderer/files-quick-open-mru.ts";
import type {
  FilePathQueryStart,
  FileQueryEvent,
} from "@shared/contracts/file-query.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (event: FileQueryEvent) => void;

function createFakeFacade() {
  const listeners = new Set<Listener>();
  const starts: FilePathQueryStart[] = [];
  const cancels: string[] = [];
  let nextId = 0;

  return {
    cancels,
    listeners,
    starts,
    emit(event: FileQueryEvent) {
      for (const listener of Array.from(listeners)) {
        listener(event);
      }
    },
    facade: {
      onPathQueryEvent(listener: Listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      queryPaths(
        request: Omit<FilePathQueryStart, "queryId"> & { queryId?: string }
      ) {
        nextId += 1;
        const queryId = request.queryId ?? `q${nextId}`;
        starts.push({ ...request, queryId } as FilePathQueryStart);
        return {
          cancel: () => {
            cancels.push(queryId);
          },
          queryId,
          started: Promise.resolve(true),
        };
      },
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetFilesPathMruForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("files path query client", () => {
  it("emits a synchronous loading snapshot and debounces queryPaths by 80ms", () => {
    const env = createFakeFacade();
    const client = createFilesPathQueryClient(env.facade);
    const onUpdate = vi.fn();

    client.search({
      onUpdate,
      owner: "quick-open:s1",
      query: "theme",
      root: "/repo",
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenLastCalledWith({
      items: [],
      status: "loading",
      truncated: false,
    });
    expect(env.starts).toHaveLength(0);

    vi.advanceTimersByTime(79);
    expect(env.starts).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(env.starts).toHaveLength(1);
    expect(env.starts[0]?.query).toBe("theme");
    expect(env.starts[0]?.owner).toBe("quick-open:s1");
  });

  it("cancels the in-flight query when a new search is issued", () => {
    const env = createFakeFacade();
    const client = createFilesPathQueryClient(env.facade);

    client.search({
      onUpdate: vi.fn(),
      owner: "quick-open:s1",
      query: "a",
      root: "/repo",
    });
    vi.advanceTimersByTime(80);
    const firstId = env.starts[0]?.queryId as string;
    expect(firstId).toBeDefined();

    client.search({
      onUpdate: vi.fn(),
      owner: "quick-open:s1",
      query: "b",
      root: "/repo",
    });
    expect(env.cancels).toContain(firstId);
    // First listener detached so late strays cannot deliver.
    expect(env.listeners.size).toBe(0);

    vi.advanceTimersByTime(80);
    expect(env.starts).toHaveLength(2);
    expect(env.starts[1]?.query).toBe("b");
    expect(env.listeners.size).toBe(1);
  });

  it("clears a pending debounce when a new search arrives first", () => {
    const env = createFakeFacade();
    const client = createFilesPathQueryClient(env.facade);

    client.search({
      onUpdate: vi.fn(),
      owner: "own",
      query: "a",
      root: "/repo",
    });
    client.search({
      onUpdate: vi.fn(),
      owner: "own",
      query: "b",
      root: "/repo",
    });
    vi.advanceTimersByTime(80);
    expect(env.starts).toHaveLength(1);
    expect(env.starts[0]?.query).toBe("b");
    expect(env.cancels).toEqual([]);
  });

  it("filters stray events by queryId so a late batch from the cancelled query is dropped", () => {
    const env = createFakeFacade();
    const client = createFilesPathQueryClient(env.facade);
    const first = vi.fn();
    client.search({
      onUpdate: first,
      owner: "own",
      query: "a",
      root: "/repo",
    });
    vi.advanceTimersByTime(80);
    const firstId = env.starts[0]?.queryId as string;

    const second = vi.fn();
    client.search({
      onUpdate: second,
      owner: "own",
      query: "b",
      root: "/repo",
    });
    vi.advanceTimersByTime(80);

    first.mockClear();
    second.mockClear();
    env.emit({
      items: [{ path: "old.ts", score: 1 }],
      kind: "batch",
      queryId: firstId,
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("accumulates items across batches and marks the final snapshot done + truncated", () => {
    const env = createFakeFacade();
    const client = createFilesPathQueryClient(env.facade);
    const onUpdate = vi.fn();
    client.search({ onUpdate, owner: "own", query: "q", root: "/repo" });
    vi.advanceTimersByTime(80);
    const id = env.starts[0]?.queryId as string;

    onUpdate.mockClear();
    env.emit({ kind: "started", queryId: id });
    env.emit({
      items: [{ path: "a.ts", score: 10 }],
      kind: "batch",
      queryId: id,
    });
    env.emit({
      items: [{ path: "b.ts", score: 8 }],
      kind: "batch",
      queryId: id,
    });
    env.emit({
      elapsedMs: 3,
      kind: "done",
      queryId: id,
      reason: "completed",
      scanned: 42,
      truncated: true,
    });

    const calls = onUpdate.mock.calls.map((c) => c[0]);
    expect(calls.at(-2)).toEqual({
      items: [
        { path: "a.ts", score: 10 },
        { path: "b.ts", score: 8 },
      ],
      status: "loading",
      truncated: false,
    });
    expect(calls.at(-1)).toEqual({
      items: [
        { path: "a.ts", score: 10 },
        { path: "b.ts", score: 8 },
      ],
      status: "done",
      truncated: true,
    });
  });

  it("surfaces error events with the message text", () => {
    const env = createFakeFacade();
    const client = createFilesPathQueryClient(env.facade);
    const onUpdate = vi.fn();
    client.search({ onUpdate, owner: "own", query: "q", root: "/repo" });
    vi.advanceTimersByTime(80);
    const id = env.starts[0]?.queryId as string;

    onUpdate.mockClear();
    env.emit({
      code: "walk-failed",
      kind: "error",
      message: "no root",
      queryId: id,
    });
    expect(onUpdate).toHaveBeenLastCalledWith({
      errorMessage: "no root",
      items: [],
      status: "error",
      truncated: false,
    });
    expect(env.listeners.size).toBe(0);
  });

  it("stops listening after done so a stray late batch cannot fire onUpdate", () => {
    const env = createFakeFacade();
    const client = createFilesPathQueryClient(env.facade);
    const onUpdate = vi.fn();
    client.search({ onUpdate, owner: "own", query: "q", root: "/repo" });
    vi.advanceTimersByTime(80);
    const id = env.starts[0]?.queryId as string;

    env.emit({
      elapsedMs: 0,
      kind: "done",
      queryId: id,
      reason: "completed",
      scanned: 0,
      truncated: false,
    });
    onUpdate.mockClear();
    env.emit({
      items: [{ path: "late.ts", score: 1 }],
      kind: "batch",
      queryId: id,
    });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(env.listeners.size).toBe(0);
  });

  it("forwards the current MRU as query hints when firing the walk", () => {
    const env = createFakeFacade();
    const client = createFilesPathQueryClient(env.facade);
    recordFilesPathMru("/repo", "src/a.ts");
    recordFilesPathMru("/repo", "src/b.ts");

    client.search({
      onUpdate: vi.fn(),
      owner: "own",
      query: "",
      root: "/repo",
    });
    vi.advanceTimersByTime(80);
    expect(env.starts[0]?.mruPaths).toEqual(["src/b.ts", "src/a.ts"]);
  });

  it("dispose cancels the in-flight query and the pending debounce", () => {
    const env = createFakeFacade();
    const client = createFilesPathQueryClient(env.facade);

    const disposePending = client.search({
      onUpdate: vi.fn(),
      owner: "own",
      query: "a",
      root: "/repo",
    });
    disposePending();
    vi.advanceTimersByTime(80);
    expect(env.starts).toHaveLength(0);

    const disposeActive = client.search({
      onUpdate: vi.fn(),
      owner: "own",
      query: "b",
      root: "/repo",
    });
    vi.advanceTimersByTime(80);
    const id = env.starts[0]?.queryId as string;
    disposeActive();
    expect(env.cancels).toContain(id);
    expect(env.listeners.size).toBe(0);
  });

  it("honours caller-provided debounceMs", () => {
    const env = createFakeFacade();
    const client = createFilesPathQueryClient(env.facade);
    client.search({
      debounceMs: 200,
      onUpdate: vi.fn(),
      owner: "own",
      query: "q",
      root: "/repo",
    });
    vi.advanceTimersByTime(100);
    expect(env.starts).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(env.starts).toHaveLength(1);
  });

  it("forwards excludePatterns into the path query options", () => {
    const env = createFakeFacade();
    const client = createFilesPathQueryClient(env.facade);
    client.search({
      excludePatterns: "**/dist\n**/*.generated",
      onUpdate: vi.fn(),
      owner: "own",
      query: "q",
      root: "/repo",
    });
    vi.advanceTimersByTime(80);
    expect(env.starts[0]?.options).toMatchObject({
      applyExcludePatterns: true,
      applyGitIgnore: true,
      excludePatterns: "**/dist\n**/*.generated",
    });
  });

  it("surfaces started===false as an error snapshot so loading cannot hang", async () => {
    const env = createFakeFacade();
    env.facade.queryPaths = (
      request: Omit<FilePathQueryStart, "queryId"> & { queryId?: string }
    ) => {
      const queryId = request.queryId ?? "q-fail";
      env.starts.push({ ...request, queryId } as FilePathQueryStart);
      return {
        cancel: () => {
          env.cancels.push(queryId);
        },
        queryId,
        started: Promise.resolve(false),
      };
    };

    const client = createFilesPathQueryClient(env.facade);
    const onUpdate = vi.fn();
    client.search({ onUpdate, owner: "own", query: "q", root: "/repo" });
    await vi.advanceTimersByTimeAsync(80);
    await Promise.resolve();
    await Promise.resolve();

    expect(onUpdate).toHaveBeenLastCalledWith({
      errorMessage: expect.any(String),
      items: [],
      status: "error",
      truncated: false,
    });
    expect(env.listeners.size).toBe(0);
  });

  it("surfaces started rejection as an error snapshot", async () => {
    const env = createFakeFacade();
    env.facade.queryPaths = (
      request: Omit<FilePathQueryStart, "queryId"> & { queryId?: string }
    ) => {
      const queryId = request.queryId ?? "q-reject";
      env.starts.push({ ...request, queryId } as FilePathQueryStart);
      return {
        cancel: () => {
          env.cancels.push(queryId);
        },
        queryId,
        started: Promise.reject(new Error("ipc down")),
      };
    };

    const client = createFilesPathQueryClient(env.facade);
    const onUpdate = vi.fn();
    client.search({ onUpdate, owner: "own", query: "q", root: "/repo" });
    await vi.advanceTimersByTimeAsync(80);
    await Promise.resolve();
    await Promise.resolve();

    expect(onUpdate).toHaveBeenLastCalledWith({
      errorMessage: "ipc down",
      items: [],
      status: "error",
      truncated: false,
    });
  });

  it("subscribes to path query events before calling queryPaths", () => {
    const env = createFakeFacade();
    const order: string[] = [];
    const originalOn = env.facade.onPathQueryEvent.bind(env.facade);
    const originalQuery = env.facade.queryPaths.bind(env.facade);
    env.facade.onPathQueryEvent = (listener) => {
      order.push("subscribe");
      return originalOn(listener);
    };
    env.facade.queryPaths = (request) => {
      order.push("queryPaths");
      return originalQuery(request);
    };

    const client = createFilesPathQueryClient(env.facade);
    client.search({
      onUpdate: vi.fn(),
      owner: "own",
      query: "q",
      root: "/repo",
    });
    vi.advanceTimersByTime(80);
    expect(order).toEqual(["subscribe", "queryPaths"]);
  });
});
