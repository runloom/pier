import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFileWatchService,
  FILE_WATCH_PROBE_CONCURRENCY,
  type FsWatchFn,
} from "@main/services/files/watch-service.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

class FakeWatcher extends EventEmitter {
  close = vi.fn();
}

const pathExists = async (absolutePath: string): Promise<boolean> =>
  existsSync(absolutePath);

describe("createFileWatchService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces and emits relative path changes for a root", async () => {
    vi.useFakeTimers();
    const watchers: FakeWatcher[] = [];
    const fsWatch: FsWatchFn = (_target, _options, listener) => {
      const watcher = new FakeWatcher();
      watchers.push(watcher);
      watcher.on("change", (eventType: string, filename: string) => {
        listener(eventType, filename);
      });
      return watcher as unknown as ReturnType<FsWatchFn>;
    };
    const root = await mkdtemp(join(tmpdir(), "pier-file-watch-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "a.ts"), "export {};\n");
    const service = createFileWatchService({
      pathExists,
      debounceMs: 50,
      fsWatch,
      maxWaitMs: 200,
      pollMs: 60_000,
    });
    const events: Array<{ path: string; kind: string }> = [];
    const stop = service.watch(root, (event) => {
      for (const change of event.changes) {
        events.push({ kind: change.kind, path: change.path });
      }
    });

    expect(watchers).toHaveLength(1);
    watchers[0]?.emit("change", "rename", "src/b.ts");
    await writeFile(join(root, "src", "b.ts"), "export {};\n");
    watchers[0]?.emit("change", "rename", "src/b.ts");

    await vi.advanceTimersByTimeAsync(60);
    expect(events.some((event) => event.path === "src/b.ts")).toBe(true);

    stop();
    service.dispose();
  });

  it("does not emit poll sentinels while the fs watcher is healthy", async () => {
    vi.useFakeTimers();
    const fsWatch: FsWatchFn = () =>
      new FakeWatcher() as unknown as ReturnType<FsWatchFn>;
    const root = await mkdtemp(join(tmpdir(), "pier-file-watch-healthy-"));
    const service = createFileWatchService({
      pathExists,
      debounceMs: 10,
      fsWatch,
      maxWaitMs: 50,
      pollMs: 100,
    });
    const listener = vi.fn();
    const stop = service.watch(root, listener);

    await vi.advanceTimersByTimeAsync(500);

    expect(listener).not.toHaveBeenCalled();
    stop();
    service.dispose();
  });

  it("falls back to poll sentinels when the fs watcher cannot start", async () => {
    vi.useFakeTimers();
    const fsWatch: FsWatchFn = () => {
      throw new Error("watch unavailable");
    };
    const root = await mkdtemp(join(tmpdir(), "pier-file-watch-fallback-"));
    const service = createFileWatchService({
      pathExists,
      debounceMs: 10,
      fsWatch,
      maxWaitMs: 50,
      pollMs: 100,
    });
    const listener = vi.fn();
    const stop = service.watch(root, listener);

    await vi.advanceTimersByTimeAsync(150);

    expect(listener).toHaveBeenCalled();
    const event = listener.mock.calls.at(0)?.at(0) as {
      changes: Array<{ kind: string; path: string }>;
    };
    expect(event.changes).toEqual([{ kind: "changed", path: "." }]);
    stop();
    service.dispose();
  });

  it("emits events with the client-subscribed root string, not only resolve()", async () => {
    vi.useFakeTimers();
    const watchers: FakeWatcher[] = [];
    const fsWatch: FsWatchFn = (_target, _options, listener) => {
      const watcher = new FakeWatcher();
      watchers.push(watcher);
      watcher.on("change", (eventType: string, filename: string) => {
        listener(eventType, filename);
      });
      return watcher as unknown as ReturnType<FsWatchFn>;
    };
    const root = await mkdtemp(join(tmpdir(), "pier-file-watch-client-root-"));
    const clientRoot = `${root}/`;
    const service = createFileWatchService({
      pathExists,
      debounceMs: 10,
      fsWatch,
      maxWaitMs: 50,
      pollMs: 60_000,
    });
    const listener = vi.fn();
    const stop = service.watch(clientRoot, listener);

    await writeFile(join(root, "notes.md"), "# hi\n");
    watchers[0]?.emit("change", "change", "notes.md");
    await vi.advanceTimersByTimeAsync(30);

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: [{ kind: "changed", path: "notes.md" }],
        root: clientRoot,
      })
    );
    stop();
    service.dispose();
  });

  it("filters noise segments such as node_modules", async () => {
    vi.useFakeTimers();
    const watchers: FakeWatcher[] = [];
    const fsWatch: FsWatchFn = (_target, _options, listener) => {
      const watcher = new FakeWatcher();
      watchers.push(watcher);
      watcher.on("change", (eventType: string, filename: string) => {
        listener(eventType, filename);
      });
      return watcher as unknown as ReturnType<FsWatchFn>;
    };
    const root = await mkdtemp(join(tmpdir(), "pier-file-watch-noise-"));
    const service = createFileWatchService({
      pathExists,
      debounceMs: 10,
      fsWatch,
      maxWaitMs: 50,
      pollMs: 60_000,
    });
    const listener = vi.fn();
    const stop = service.watch(root, listener);
    watchers[0]?.emit("change", "change", "node_modules/pkg/index.js");
    await vi.advanceTimersByTimeAsync(30);
    expect(listener).not.toHaveBeenCalled();
    stop();
    service.dispose();
  });

  it("classifies rename of a missing path as deleted without sync fs in the watch callback", async () => {
    vi.useFakeTimers();
    const watchers: FakeWatcher[] = [];
    const fsWatch: FsWatchFn = (_target, _options, listener) => {
      const watcher = new FakeWatcher();
      watchers.push(watcher);
      watcher.on("change", (eventType: string, filename: string) => {
        listener(eventType, filename);
      });
      return watcher as unknown as ReturnType<FsWatchFn>;
    };
    const root = await mkdtemp(join(tmpdir(), "pier-file-watch-deleted-"));
    const service = createFileWatchService({
      pathExists,
      debounceMs: 10,
      fsWatch,
      maxWaitMs: 50,
      pollMs: 60_000,
    });
    const events: Array<{ path: string; kind: string }> = [];
    const stop = service.watch(root, (event) => {
      for (const change of event.changes) {
        events.push({ kind: change.kind, path: change.path });
      }
    });
    watchers[0]?.emit("change", "rename", "gone.ts");
    await vi.advanceTimersByTimeAsync(20);
    expect(events).toEqual([{ kind: "deleted", path: "gone.ts" }]);
    stop();
    service.dispose();
  });

  it("bounds concurrent existence probes within one flush and keeps event order", async () => {
    vi.useFakeTimers();
    const watchers: FakeWatcher[] = [];
    const fsWatch: FsWatchFn = (_target, _options, listener) => {
      const watcher = new FakeWatcher();
      watchers.push(watcher);
      watcher.on("change", (eventType: string, filename: string) => {
        listener(eventType, filename);
      });
      return watcher as unknown as ReturnType<FsWatchFn>;
    };
    let inFlight = 0;
    let peakInFlight = 0;
    const release: Array<() => void> = [];
    const gatedPathExists = (): Promise<boolean> => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      return new Promise<boolean>((resolve) => {
        release.push(() => {
          inFlight -= 1;
          resolve(true);
        });
      });
    };
    const root = await mkdtemp(join(tmpdir(), "pier-file-watch-bounded-"));
    const service = createFileWatchService({
      pathExists: gatedPathExists,
      debounceMs: 10,
      fsWatch,
      maxWaitMs: 50,
      pollMs: 60_000,
    });
    const events: string[][] = [];
    const stop = service.watch(root, (event) => {
      events.push(event.changes.map((change) => change.path));
    });
    const total = FILE_WATCH_PROBE_CONCURRENCY * 3;
    const paths = Array.from({ length: total }, (_, index) => `f-${index}.ts`);
    for (const path of paths) {
      watchers[0]?.emit("change", "rename", path);
    }
    await vi.advanceTimersByTimeAsync(20);
    expect(peakInFlight).toBe(FILE_WATCH_PROBE_CONCURRENCY);

    while (release.length > 0) {
      release.shift()?.();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(peakInFlight).toBe(FILE_WATCH_PROBE_CONCURRENCY);
    expect(events).toEqual([paths]);
    stop();
    service.dispose();
  });

  it("does not let an in-flight flush restart the maxWait clock for later events", async () => {
    vi.useFakeTimers();
    const watchers: FakeWatcher[] = [];
    const fsWatch: FsWatchFn = (_target, _options, listener) => {
      const watcher = new FakeWatcher();
      watchers.push(watcher);
      watcher.on("change", (eventType: string, filename: string) => {
        listener(eventType, filename);
      });
      return watcher as unknown as ReturnType<FsWatchFn>;
    };
    const gate: { release: (() => void) | null } = { release: null };
    const slowPathExists = (absolutePath: string): Promise<boolean> => {
      if (absolutePath.endsWith("slow.ts") && gate.release === null) {
        return new Promise<boolean>((resolve) => {
          gate.release = () => resolve(true);
        });
      }
      return Promise.resolve(true);
    };
    const root = await mkdtemp(join(tmpdir(), "pier-file-watch-maxwait-"));
    const service = createFileWatchService({
      pathExists: slowPathExists,
      debounceMs: 50,
      fsWatch,
      maxWaitMs: 200,
      pollMs: 60_000,
    });
    const batches: Array<{ at: number; paths: string[] }> = [];
    const start = Date.now();
    const stop = service.watch(root, (event) => {
      batches.push({
        at: Date.now() - start,
        paths: event.changes.map((change) => change.path),
      });
    });

    watchers[0]?.emit("change", "change", "slow.ts");
    await vi.advanceTimersByTimeAsync(50);
    expect(batches).toEqual([]);
    // First flush is now blocked on the slow probe; keep writing every 40ms so
    // the debounce timer keeps expiring while that flush is still in flight.
    for (let tick = 0; tick < 10; tick += 1) {
      watchers[0]?.emit("change", "change", `later-${tick}.ts`);
      await vi.advanceTimersByTimeAsync(40);
    }
    gate.release?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(batches).toHaveLength(2);
    expect(batches[0]?.paths).toEqual(["slow.ts"]);
    // Later events waited well past maxWait already → flushed immediately,
    // not re-debounced from scratch.
    expect(batches[1]?.paths).toHaveLength(10);
    expect(batches[1]?.at).toBeLessThanOrEqual((batches[0]?.at ?? 0) + 1);
    stop();
    service.dispose();
  });
});
