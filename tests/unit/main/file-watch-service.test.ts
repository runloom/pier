import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFileWatchService,
  type FsWatchFn,
} from "@main/services/file-watch-service.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

class FakeWatcher extends EventEmitter {
  close = vi.fn();
}

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
});
