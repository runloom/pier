import { describe, expect, it, vi } from "vitest";
import { PluginLifecycleBarrierRegistry } from "@/lib/plugins/plugin-lifecycle-barriers.ts";
import { PluginLifecycleDrainTracker } from "@/lib/plugins/plugin-lifecycle-drains.ts";

function deferred<T>() {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

describe("PluginLifecycleBarrierRegistry", () => {
  it("waits for drains added by an earlier drain recovery", async () => {
    const tracker = new PluginLifecycleDrainTracker();
    const first = deferred<void>();
    const second = deferred<void>();
    const pluginIds = new Set(["pier.files"]);
    const recovery = first.promise.then(() => {
      tracker.track(pluginIds, second.promise);
    });
    tracker.track(pluginIds, recovery);

    let settled = false;
    const wait = tracker.wait("pier.files").then(() => {
      settled = true;
    });
    first.resolve();
    await recovery;
    await Promise.resolve();

    expect(settled).toBe(false);
    second.resolve();
    await wait;
    expect(settled).toBe(true);
  });

  it("serializes abort compensation behind an in-flight commit", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    let releaseCommit: () => void = () => undefined;
    const events: string[] = [];
    registry.register("pier.files", {
      abort: () => {
        events.push("abort");
      },
      commit: async () => {
        events.push("commit:start");
        await new Promise<void>((resolve) => {
          releaseCommit = resolve;
        });
        events.push("commit:end");
      },
      prepare: () => undefined,
    });
    await registry.prepare("pier.files", "app-quit", "serialized-finalize");

    const commit = registry.finalize("serialized-finalize", "commit");
    await vi.waitFor(() => expect(events).toEqual(["commit:start"]));
    const abort = registry.finalize("serialized-finalize", "abort");
    await Promise.resolve();
    expect(events).toEqual(["commit:start"]);

    releaseCommit();
    await Promise.all([commit, abort]);

    expect(events).toEqual(["commit:start", "commit:end", "abort"]);
    await expect(
      registry.consumePreparedOrCommitted("pier.files", "app-quit")
    ).resolves.toBe(false);
  });

  it("waits for every barrier registered by the target plugin", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const events: string[] = [];
    registry.register("pier.files", async (reason) => {
      await Promise.resolve();
      events.push(`first:${reason}`);
    });
    registry.register("pier.files", (reason) => {
      events.push(`second:${reason}`);
    });
    registry.register("pier.git", () => {
      events.push("unrelated");
    });

    await registry.runGuarded("pier.files", "plugin-disable", () => true);

    expect(events).toEqual(["second:plugin-disable", "first:plugin-disable"]);
  });

  it("runs a stable snapshot and supports explicit unregister", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const second = vi.fn();
    let unregisterSecond: () => void = () => undefined;
    registry.register("pier.files", () => {
      unregisterSecond();
    });
    unregisterSecond = registry.register("pier.files", second);

    await registry.runGuarded("pier.files", "runtime-refresh", () => true);
    await registry.runGuarded("pier.files", "runtime-refresh", () => true);

    expect(second).toHaveBeenCalledTimes(1);
  });

  it("waits for all plugins and reports failures only after every attempt", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const completed = vi.fn();
    registry.register("pier.files", () => {
      throw new Error("draft flush failed");
    });
    registry.register("pier.git", completed);

    await expect(
      registry.prepareAll("window-close", "prepare-all-failure")
    ).rejects.toThrow("plugin lifecycle preparation failed: window-close");
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed abort compensation retryable until cleanup succeeds", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const abort = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("abort cleanup failed"))
      .mockResolvedValueOnce(undefined);
    registry.register("pier.files", {
      abort,
      prepare: () => {
        throw new Error("draft flush failed");
      },
    });

    await expect(
      registry.prepare("pier.files", "window-close", "retry-abort")
    ).rejects.toThrow(
      "plugin lifecycle preparation and abort compensation failed"
    );
    await expect(
      registry.finalize("retry-abort", "abort")
    ).resolves.toBeUndefined();
    await expect(
      registry.prepare("pier.files", "window-close", "after-retry-abort")
    ).rejects.toThrow("plugin lifecycle preparation failed");

    expect(abort).toHaveBeenCalledTimes(3);
  });

  it("recovers an aborted conflicting session before a new preparation", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const prepare = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("first preparation failed"))
      .mockResolvedValueOnce(undefined);
    const abort = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("first abort failed"))
      .mockResolvedValueOnce(undefined);
    registry.register("pier.files", { abort, prepare });

    await expect(
      registry.prepare("pier.files", "window-close", "failed-close")
    ).rejects.toThrow(
      "plugin lifecycle preparation and abort compensation failed"
    );
    await expect(
      registry.prepare("pier.files", "window-close", "retry-close")
    ).resolves.toBeUndefined();
    await registry.finalize("retry-close", "abort");

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(abort).toHaveBeenCalledTimes(3);
  });

  it("retries failed abort cleanup inside runtime-local runs", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const prepare = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("first preparation failed"))
      .mockResolvedValueOnce(undefined);
    const abort = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("first abort failed"))
      .mockResolvedValueOnce(undefined);
    registry.register("pier.files", { abort, prepare });

    await expect(
      registry.runGuarded("pier.files", "runtime-refresh", () => true)
    ).rejects.toThrow(
      "plugin lifecycle preparation and abort compensation failed"
    );
    await expect(
      registry.runGuarded("pier.files", "runtime-refresh", () => true)
    ).resolves.toBe(true);

    expect(abort).toHaveBeenCalledTimes(2);
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("compensates a failed local commit before allowing another run", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const abort = vi.fn();
    const commit = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("draft commit failed"))
      .mockResolvedValueOnce(undefined);
    const prepare = vi.fn();
    registry.register("pier.files", { abort, commit, prepare });

    await expect(
      registry.runGuarded("pier.files", "runtime-refresh", () => true)
    ).rejects.toThrow("plugin lifecycle commit failed");
    await expect(
      registry.runGuarded("pier.files", "runtime-refresh", () => true)
    ).resolves.toBe(true);

    expect(abort).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledTimes(2);
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("compensates an older same-reason receipt before a new main transition", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const abort = vi.fn();
    registry.register("pier.files", { abort, prepare: vi.fn() });
    await registry.prepare("pier.files", "plugin-disable", "disable-old");
    await registry.finalize("disable-old", "commit");

    await registry.prepare("pier.files", "plugin-disable", "disable-new");
    await registry.finalize("disable-new", "commit");

    expect(abort).toHaveBeenCalledOnce();
    expect(
      registry.acquireCommittedLease(
        "pier.files",
        "plugin-disable",
        "disable-old"
      )
    ).toBeUndefined();
    expect(
      registry.acquireCommittedLease(
        "pier.files",
        "plugin-disable",
        "disable-new"
      )?.transitionId
    ).toBe("disable-new");
  });

  it("compensates a committed receipt before a different-reason transition", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const abort = vi.fn();
    registry.register("pier.files", { abort, prepare: vi.fn() });
    await registry.prepare("pier.files", "plugin-disable", "disable-old");
    await registry.finalize("disable-old", "commit");

    await registry.prepare("pier.files", "plugin-reload", "reload-new");

    expect(abort).toHaveBeenCalledOnce();
    expect(
      registry.acquireCommittedLease(
        "pier.files",
        "plugin-disable",
        "disable-old"
      )
    ).toBeUndefined();
    await registry.finalize("reload-new", "abort");
  });

  it("compensates existing plugin receipts before an all-plugin preparation", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const abort = vi.fn();
    registry.register("pier.files", { abort, prepare: vi.fn() });
    await registry.prepare("pier.files", "plugin-disable", "disable-old");
    await registry.finalize("disable-old", "commit");

    await registry.prepareAll("window-close", "close-new");

    expect(abort).toHaveBeenCalledOnce();
    expect(
      registry.acquireCommittedLease(
        "pier.files",
        "plugin-disable",
        "disable-old"
      )
    ).toBeUndefined();
    await registry.finalize("close-new", "abort");
  });

  it("compensates a receipt after its participant unregisters", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const abort = vi.fn();
    const unregister = registry.register("pier.files", {
      abort,
      prepare: vi.fn(),
    });
    await registry.prepare("pier.files", "plugin-disable", "disable-old");
    await registry.finalize("disable-old", "commit");
    unregister();

    await registry.prepare("pier.files", "plugin-reload", "reload-new");

    expect(abort).toHaveBeenCalledOnce();
    expect(
      registry.acquireCommittedLease(
        "pier.files",
        "plugin-disable",
        "disable-old"
      )
    ).toBeUndefined();
    await registry.finalize("reload-new", "abort");
  });

  it("includes unregistered receipt owners in all-plugin preparation", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const abort = vi.fn();
    const unregister = registry.register("pier.files", {
      abort,
      prepare: vi.fn(),
    });
    await registry.prepare("pier.files", "plugin-disable", "disable-old");
    await registry.finalize("disable-old", "commit");
    unregister();

    await registry.prepareAll("window-close", "close-new");

    expect(abort).toHaveBeenCalledOnce();
    expect(
      registry.acquireCommittedLease(
        "pier.files",
        "plugin-disable",
        "disable-old"
      )
    ).toBeUndefined();
    await registry.finalize("close-new", "abort");
  });

  it("quarantines a cancelled preparation that ignores its abort signal", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    let current = true;
    let activePreparations = 0;
    let maxActivePreparations = 0;
    let callCount = 0;
    const firstPreparation = deferred<void>();
    registry.register("pier.files", {
      prepare: async () => {
        callCount += 1;
        activePreparations += 1;
        maxActivePreparations = Math.max(
          maxActivePreparations,
          activePreparations
        );
        try {
          if (callCount === 1) await firstPreparation.promise;
        } finally {
          activePreparations -= 1;
        }
      },
    });

    const stale = registry.runGuarded(
      "pier.files",
      "runtime-refresh",
      () => current
    );
    await vi.waitFor(() => expect(callCount).toBe(1));
    current = false;
    registry.cancelRuntimePreparations();
    await expect(stale).resolves.toBe(false);

    current = true;
    await expect(
      registry.runGuarded("pier.files", "runtime-refresh", () => current)
    ).rejects.toThrow("preparation is still aborting");
    firstPreparation.resolve();
    await registry.waitForPluginDrain("pier.files");
    await expect(
      registry.runGuarded("pier.files", "runtime-refresh", () => current)
    ).resolves.toBe(true);

    expect(maxActivePreparations).toBe(1);
  });

  it("retries a requested abort after a preparation drain finalizer fails", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const preparation = deferred<void>();
    const preparationStarted = deferred<void>();
    const abort = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("first drained abort failed"))
      .mockResolvedValueOnce(undefined);
    registry.register("pier.files", {
      abort,
      prepare: async () => {
        preparationStarted.resolve();
        await preparation.promise;
      },
    });

    const pending = registry.prepare(
      "pier.files",
      "runtime-refresh",
      "runtime:preparation-drain-retry"
    );
    await preparationStarted.promise;
    registry.cancelRuntimePreparations();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      registry.finalize("runtime:preparation-drain-retry", "abort")
    ).resolves.toBeUndefined();

    preparation.resolve();
    await registry.waitForPluginDrain("pier.files");

    expect(abort).toHaveBeenCalledTimes(2);
    await expect(
      registry.prepare("pier.files", "runtime-refresh", "after-drain-retry")
    ).resolves.toBeUndefined();
  });

  it("retries an abort requested while a timed-out abort is draining", async () => {
    vi.useFakeTimers();
    try {
      const registry = new PluginLifecycleBarrierRegistry();
      const firstAbort = deferred<void>();
      const abort = vi
        .fn<() => Promise<void>>()
        .mockImplementationOnce(async () => await firstAbort.promise)
        .mockResolvedValueOnce(undefined);
      registry.register("pier.files", { abort, prepare: () => undefined });
      await registry.prepare("pier.files", "window-close", "late-abort-fail");

      const first = registry.finalize("late-abort-fail", "abort");
      const firstExpectation = expect(first).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10_000);
      await firstExpectation;
      await expect(
        registry.finalize("late-abort-fail", "abort")
      ).resolves.toBeUndefined();

      firstAbort.reject(new Error("late abort failed"));
      await registry.waitForPluginDrain("pier.files");

      expect(abort).toHaveBeenCalledTimes(2);
      await expect(
        registry.prepare("pier.files", "window-close", "after-late-abort")
      ).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retain committed sessions without lifecycle participants", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    for (let index = 0; index < 140; index += 1) {
      const transitionId = `empty-${index}`;
      await registry.prepare("pier.empty", "plugin-disable", transitionId);
      await registry.finalize(transitionId, "commit");
    }

    const receipts = Reflect.get(registry, "receipts") as {
      sessionCount(): number;
    };
    expect(receipts.sessionCount()).toBe(0);
  });

  it("can compensate a committed receipt after completion history eviction", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const abort = vi.fn();
    registry.register("pier.files", { abort, prepare: () => undefined });
    await registry.prepare(
      "pier.files",
      "plugin-disable",
      "old-committed-transition"
    );
    await registry.finalize("old-committed-transition", "commit");
    for (let index = 0; index < 140; index += 1) {
      const transitionId = `completion-eviction-${index}`;
      await registry.prepare("pier.empty", "plugin-disable", transitionId);
      await registry.finalize(transitionId, "commit");
    }

    await registry.finalize("old-committed-transition", "abort");

    expect(abort).toHaveBeenCalledOnce();
    await expect(
      registry.consumePreparedOrCommitted("pier.files", "plugin-disable")
    ).resolves.toBe(false);
  });

  it("turns a stalled barrier into a deterministic veto", async () => {
    vi.useFakeTimers();
    try {
      const registry = new PluginLifecycleBarrierRegistry();
      registry.register("pier.files", () => new Promise(() => undefined));

      const pending = registry.prepare(
        "pier.files",
        "app-quit",
        "stalled-preparation",
        { timeoutMs: 25 }
      );
      const expectation = expect(pending).rejects.toThrow(
        "plugin lifecycle preparation timed out"
      );
      await vi.advanceTimersByTimeAsync(25);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts a prepared transition and invokes participant recovery", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const events: string[] = [];
    registry.register("pier.files", {
      abort: (reason) => {
        events.push(`abort:${reason}`);
      },
      commit: (reason) => {
        events.push(`commit:${reason}`);
      },
      prepare: ({ reason, transitionId }) => {
        events.push(`prepare:${reason}:${transitionId}`);
      },
    });

    await registry.prepare("pier.files", "plugin-disable", "disable-attempt-1");
    await registry.finalize("disable-attempt-1", "abort");

    expect(events).toEqual([
      "prepare:plugin-disable:disable-attempt-1",
      "abort:plugin-disable",
    ]);
    await expect(
      registry.prepare("pier.files", "plugin-disable", "disable-attempt-2")
    ).resolves.toBeUndefined();
  });

  it("attempts every finalizer when an earlier participant throws synchronously", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const laterCommit = vi.fn();
    registry.register("pier.files", {
      commit: () => {
        throw new Error("first commit failed");
      },
      prepare: () => undefined,
    });
    registry.register("pier.files", {
      commit: laterCommit,
      prepare: () => undefined,
    });
    await registry.prepare("pier.files", "window-close", "sync-finalizer");

    await expect(registry.finalize("sync-finalizer", "commit")).rejects.toThrow(
      "plugin lifecycle commit failed"
    );

    expect(laterCommit).toHaveBeenCalledOnce();
  });

  it("prevents finalizer retry overlap until a timed-out participant drains", async () => {
    vi.useFakeTimers();
    try {
      const registry = new PluginLifecycleBarrierRegistry();
      let release: () => void = () => undefined;
      const abort = vi.fn();
      const commit = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      );
      registry.register("pier.files", {
        abort,
        commit,
        prepare: () => undefined,
      });
      await registry.prepare("pier.files", "window-close", "finalizer-timeout");

      const first = registry.finalize("finalizer-timeout", "commit");
      const firstExpectation = expect(first).rejects.toThrow(
        "plugin lifecycle commit timed out"
      );
      await vi.advanceTimersByTimeAsync(10_000);
      await firstExpectation;
      await expect(
        registry.finalize("finalizer-timeout", "abort")
      ).resolves.toBeUndefined();
      expect(commit).toHaveBeenCalledOnce();
      expect(abort).not.toHaveBeenCalled();

      release();
      await vi.waitFor(() => expect(abort).toHaveBeenCalledOnce());
      await expect(
        registry.consumePreparedOrCommitted("pier.files", "window-close")
      ).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases the transition after a timed-out abort compensation eventually drains", async () => {
    vi.useFakeTimers();
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const registry = new PluginLifecycleBarrierRegistry();
      let releaseCommit: () => void = () => undefined;
      let releaseAbort: () => void = () => undefined;
      const abort = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseAbort = resolve;
          })
      );
      registry.register("pier.files", {
        abort,
        commit: () =>
          new Promise<void>((resolve) => {
            releaseCommit = resolve;
          }),
        prepare: () => undefined,
      });
      await registry.prepare("pier.files", "window-close", "double-timeout");
      const commit = registry.finalize("double-timeout", "commit");
      const commitExpectation = expect(commit).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10_000);
      await commitExpectation;
      await registry.finalize("double-timeout", "abort");

      releaseCommit();
      await vi.waitFor(() => expect(abort).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(10_000);
      releaseAbort();

      await vi.waitFor(async () => {
        await registry.prepare(
          "pier.files",
          "window-close",
          "after-double-timeout"
        );
      });
      expect(errorLog).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("consumes a committed main transition exactly once", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const prepare = vi.fn();
    registry.register("pier.files", { prepare });

    await registry.prepare("pier.files", "plugin-disable", "disable-commit");
    await registry.finalize("disable-commit", "commit");

    await expect(
      registry.consumePreparedOrCommitted("pier.files", "plugin-disable")
    ).resolves.toBe(true);
    await expect(
      registry.consumePreparedOrCommitted("pier.files", "plugin-disable")
    ).resolves.toBe(false);
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("compensates a committed transition when another window vetoes the cohort", async () => {
    const registry = new PluginLifecycleBarrierRegistry();
    const events: string[] = [];
    registry.register("pier.files", {
      abort: () => {
        events.push("abort");
      },
      commit: () => {
        events.push("commit");
      },
      prepare: () => {
        events.push("prepare");
      },
    });

    await registry.prepare("pier.files", "app-quit", "quit-cohort");
    await registry.finalize("quit-cohort", "commit");
    await registry.finalize("quit-cohort", "abort");

    expect(events).toEqual(["prepare", "commit", "abort"]);
    await expect(
      registry.consumePreparedOrCommitted("pier.files", "app-quit")
    ).resolves.toBe(false);
  });

  it("signals cancellation and prevents retry overlap while a timed-out participant drains", async () => {
    vi.useFakeTimers();
    try {
      const registry = new PluginLifecycleBarrierRegistry();
      let firstPreparation = true;
      let release: () => void = () => undefined;
      const receivedSignals: AbortSignal[] = [];
      registry.register("pier.files", {
        prepare: ({ signal }) => {
          receivedSignals.push(signal);
          if (!firstPreparation) {
            return;
          }
          firstPreparation = false;
          return new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      });
      const pending = registry.prepare(
        "pier.files",
        "window-close",
        "close-timeout",
        { timeoutMs: 25 }
      );
      const expectation = expect(pending).rejects.toThrow("timed out");

      await vi.advanceTimersByTimeAsync(25);
      await expectation;
      expect(receivedSignals[0]?.aborted).toBe(true);
      await expect(
        registry.prepare("pier.files", "window-close", "close-retry")
      ).rejects.toThrow("still aborting");

      release();
      await vi.runAllTimersAsync();
      await Promise.resolve();
      await expect(
        registry.prepare("pier.files", "window-close", "close-retry-2")
      ).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
