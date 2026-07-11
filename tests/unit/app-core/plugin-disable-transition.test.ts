import { PluginDisableTransitionCoordinator } from "@main/app-core/plugin-disable-transition.ts";
import { describe, expect, it, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

describe("PluginDisableTransitionCoordinator", () => {
  it("prepares every live window before committing a disable", async () => {
    const coordinator = new PluginDisableTransitionCoordinator();
    const events: string[] = [];

    const result = await coordinator.runDisable({
      commit: async ({ generation }) => {
        events.push(`commit:${generation}`);
        return "disabled";
      },
      listWindowIds: () => ["main", "w-1"],
      pluginId: "pier.files",
      prepareWindow: async ({ generation, windowId }) => {
        events.push(`prepare:${windowId}:${generation}`);
      },
    });

    expect(result).toBe("disabled");
    expect(events).toEqual(["prepare:main:1", "prepare:w-1:1", "commit:1"]);
    expect(coordinator.snapshot()).toBeNull();
  });

  it("rolls back the transition without committing when a live window vetoes", async () => {
    const coordinator = new PluginDisableTransitionCoordinator();
    const commit = vi.fn(async () => "disabled");

    await expect(
      coordinator.runDisable({
        commit,
        listWindowIds: () => ["main"],
        pluginId: "pier.files",
        prepareWindow: async () => {
          throw new Error("draft flush failed");
        },
      })
    ).rejects.toThrow("plugin disable preparation failed: pier.files");

    expect(commit).not.toHaveBeenCalled();
    expect(coordinator.snapshot()).toBeNull();
  });

  it("ignores a failed renderer that closed while preparation was pending", async () => {
    const coordinator = new PluginDisableTransitionCoordinator();
    const gate = deferred<void>();
    let liveWindowIds = ["main"];
    const commit = vi.fn(async () => "disabled");
    const pending = coordinator.runDisable({
      commit,
      listWindowIds: () => liveWindowIds,
      pluginId: "pier.files",
      prepareWindow: async () => gate.promise,
    });
    await vi.waitFor(() =>
      expect(coordinator.snapshot()?.phase).toBe("disabling")
    );

    liveWindowIds = [];
    gate.reject(new Error("renderer destroyed"));

    await expect(pending).resolves.toBe("disabled");
    expect(commit).toHaveBeenCalledOnce();
  });

  it("does not finalize a renderer that closed during preparation", async () => {
    const coordinator = new PluginDisableTransitionCoordinator();
    const gate = deferred<void>();
    let liveWindowIds = ["main"];
    const finalizeWindow = vi.fn(async () => undefined);
    const pending = coordinator.runDisable({
      commit: async () => "disabled",
      finalizeWindow,
      listWindowIds: () => liveWindowIds,
      pluginId: "pier.files",
      prepareWindow: async () => gate.promise,
    });
    await vi.waitFor(() =>
      expect(coordinator.snapshot()?.phase).toBe("disabling")
    );

    liveWindowIds = [];
    gate.reject(new Error("renderer destroyed"));

    await expect(pending).resolves.toBe("disabled");
    expect(finalizeWindow).not.toHaveBeenCalled();
  });

  it("holds new window creation until disable commit or rollback completes", async () => {
    const coordinator = new PluginDisableTransitionCoordinator();
    const barrier = deferred<void>();
    const events: string[] = [];
    const disable = coordinator.runDisable({
      commit: async () => {
        events.push("commit");
      },
      listWindowIds: () => ["main"],
      pluginId: "pier.files",
      prepareWindow: async () => {
        events.push("prepare");
        await barrier.promise;
      },
    });
    const createWindow = coordinator.runWindowCreation(async () => {
      events.push("create");
      return "w-1";
    });
    await vi.waitFor(() => expect(events).toEqual(["prepare"]));

    barrier.resolve();

    await expect(disable).resolves.toBeUndefined();
    await expect(createWindow).resolves.toBe("w-1");
    expect(events).toEqual(["prepare", "commit", "create"]);
  });

  it("increments the transition generation across retries", async () => {
    const coordinator = new PluginDisableTransitionCoordinator();
    const generations: number[] = [];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await coordinator.runDisable({
        commit: async ({ generation }) => {
          generations.push(generation);
        },
        listWindowIds: () => [],
        pluginId: "pier.files",
        prepareWindow: async () => undefined,
      });
    }

    expect(generations).toEqual([1, 2]);
  });

  it("rejects when abort finalization fails in a live renderer", async () => {
    const coordinator = new PluginDisableTransitionCoordinator();
    const finalizeWindow = vi.fn(async () => {
      throw new Error("renderer abort failed");
    });

    await expect(
      coordinator.runDisable({
        commit: async () => ({ ok: false }),
        finalizeWindow,
        isCommitted: () => false,
        listWindowIds: () => ["main"],
        pluginId: "pier.files",
        prepareWindow: async () => undefined,
      })
    ).rejects.toThrow(
      "plugin transition aborted but renderer finalization failed: pier.files"
    );
    expect(finalizeWindow).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "abort", windowId: "main" })
    );
    expect(coordinator.snapshot()).toBeNull();
  });

  it("aborts every prepared live renderer when one commit finalizer fails", async () => {
    const coordinator = new PluginDisableTransitionCoordinator();
    const finalizeWindow = vi.fn(
      async ({ outcome, windowId }: { outcome: string; windowId: string }) => {
        if (outcome === "commit" && windowId === "w-1") {
          throw new Error("w-1 commit failed");
        }
      }
    );

    await expect(
      coordinator.runDisable({
        commit: async () => "disabled",
        finalizeWindow,
        listWindowIds: () => ["main", "w-1"],
        pluginId: "pier.files",
        prepareWindow: async () => undefined,
      })
    ).rejects.toThrow(
      "plugin transition committed but renderer finalization failed: pier.files"
    );

    expect(finalizeWindow).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "abort", windowId: "main" })
    );
    expect(finalizeWindow).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "abort", windowId: "w-1" })
    );
  });
});
