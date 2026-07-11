import type {
  ExternalRendererPluginContext,
  ExternalRendererPluginModule,
} from "@pier/plugin-api/renderer";
import type {
  RendererPluginContext,
  RendererPluginModule,
} from "@plugins/api/renderer.ts";
import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { clearHostGroupContentForTests } from "@/lib/plugins/host-group-content-context.tsx";
import { pluginLifecycleBarriers } from "@/lib/plugins/plugin-lifecycle-barriers.ts";
import {
  clearPluginPanelsForTests,
  getPluginPanelRegistrations,
  setPluginPanelCloser,
} from "@/lib/plugins/plugin-panel-registry.ts";
import {
  clearRendererPluginRuntimeDiagnosticsForTests,
  getRendererPluginRuntimeDiagnostics,
} from "@/lib/plugins/plugin-runtime-diagnostics.ts";
import { RendererPluginRuntime } from "@/lib/plugins/runtime.ts";
import { suspendAndDisposeRendererPlugin } from "@/lib/plugins/runtime-plugin-disposal.ts";

const RUNTIME_DISPOSE_FAILED_LOG = "[renderer-plugin-runtime] dispose failed:";

const pluginEntry = {
  effectivePermissions: [],
  enabled: true,
  manifest: {
    apiVersion: 1,
    commands: [],
    missionControlWidgets: [],
    settingsPages: [],
    engines: { pier: ">=0.1.0" },
    groupContent: [{ id: "runtime.test.groupView", title: "Group View" }],
    id: "runtime.test",
    name: "Runtime Test",
    panels: [],
    permissions: [],
    source: { kind: "builtin" },
    terminalStatusItems: [],
    version: "1.0.0",
  },
  runtime: {
    canToggle: true,
    enabled: true,
    kind: "builtin",
  },
} satisfies PluginRegistryEntry;

function externalEntry(
  id: string,
  sourceRevision = "rev-1"
): PluginRegistryEntry {
  return {
    ...pluginEntry,
    manifest: {
      ...pluginEntry.manifest,
      groupContent: [],
      id,
      name: id,
      source: { kind: "official" },
    },
    runtime: {
      canToggle: true,
      enabled: true,
      kind: "external",
      rendererEntryUrl: `pier-plugin://${id}/${sourceRevision}/renderer.js`,
      sourceRevision,
    },
  };
}

function externalModule(
  id: string,
  activate: () => () => void = () => () => undefined
): ExternalRendererPluginModule {
  return { activate, id };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createMockGroup(): {
  container: HTMLElement;
  group: PierDockviewGroupHandle;
} {
  const root = document.createElement("div");
  const container = document.createElement("div");
  container.className = "dv-content-container";
  root.appendChild(container);
  document.body.appendChild(root);
  const group: PierDockviewGroupHandle = {
    activePanel: {
      id: "active-panel",
      view: { contentComponent: "runtime.test.panel" },
    },
    api: {
      onDidActivePanelChange: () => ({ dispose: () => undefined }),
    },
    element: root,
    id: "group-a",
  };
  return { container, group };
}

afterEach(() => {
  pluginLifecycleBarriers.clear("runtime.test");
  clearHostGroupContentForTests();
  clearRendererPluginRuntimeDiagnosticsForTests();
  clearPluginPanelsForTests();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RendererPluginRuntime", () => {
  it("clears host group content for a plugin when that plugin is deactivated", async () => {
    const { container, group } = createMockGroup();
    const dispose = vi.fn();
    const module: RendererPluginModule = {
      activate: (context: RendererPluginContext) => {
        context.groupContent.claim({
          group,
          id: "runtime.test.groupView",
          ownerId: Symbol("runtime-owner"),
          render: () => createElement("div", null, "Runtime Group View"),
          visible: () => true,
        });
        return dispose;
      },
      id: "runtime.test",
    };
    const runtime = new RendererPluginRuntime([module]);

    await runtime.refresh([pluginEntry]);
    expect(
      container.querySelector('[data-slot="runtime.test.groupView"]')
    ).toBeInstanceOf(HTMLElement);

    await runtime.refresh([]);

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-slot="runtime.test.groupView"]')
    ).toBeNull();
  });

  it("clears host group content when runtime.dispose is called directly", async () => {
    const { container, group } = createMockGroup();
    const dispose = vi.fn();
    const module: RendererPluginModule = {
      activate: (context: RendererPluginContext) => {
        context.groupContent.claim({
          group,
          id: "runtime.test.groupView",
          ownerId: Symbol("runtime-owner"),
          render: () => createElement("div", null, "Runtime Group View"),
          visible: () => true,
        });
        return dispose;
      },
      id: "runtime.test",
    };
    const runtime = new RendererPluginRuntime([module]);

    await runtime.refresh([pluginEntry]);
    expect(
      container.querySelector('[data-slot="runtime.test.groupView"]')
    ).toBeInstanceOf(HTMLElement);

    await runtime.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-slot="runtime.test.groupView"]')
    ).toBeNull();
  });

  it("clears host group content even when the plugin disposer throws", async () => {
    const { container, group } = createMockGroup();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dispose = vi.fn(() => {
      throw new Error("dispose failed");
    });
    const module: RendererPluginModule = {
      activate: (context: RendererPluginContext) => {
        context.groupContent.claim({
          group,
          id: "runtime.test.groupView",
          ownerId: Symbol("runtime-owner"),
          render: () => createElement("div", null, "Runtime Group View"),
          visible: () => true,
        });
        return dispose;
      },
      id: "runtime.test",
    };
    const runtime = new RendererPluginRuntime([module]);

    await runtime.refresh([pluginEntry]);
    expect(
      container.querySelector('[data-slot="runtime.test.groupView"]')
    ).toBeInstanceOf(HTMLElement);

    await expect(runtime.dispose()).rejects.toThrow(
      "renderer plugin dispose failed"
    );
    expect(errorSpy).toHaveBeenCalledWith(
      RUNTIME_DISPOSE_FAILED_LOG,
      expect.any(Error)
    );
    expect(
      container.querySelector('[data-slot="runtime.test.groupView"]')
    ).toBeNull();
  });

  it("retains runtime ownership and retries a failed plugin disposer", async () => {
    const dispose = vi
      .fn<() => void>()
      .mockImplementationOnce(() => {
        throw new Error("first dispose failed");
      })
      .mockImplementationOnce(() => undefined);
    const runtime = new RendererPluginRuntime([
      { activate: () => dispose, id: "runtime.test" },
    ]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runtime.refresh([pluginEntry]);

    await expect(runtime.refresh([])).rejects.toThrow(
      "renderer plugin refresh failed"
    );
    await expect(runtime.refresh([])).resolves.toBeUndefined();

    expect(dispose).toHaveBeenCalledTimes(2);
    await runtime.dispose();
  });

  it("waits for a cancelled preparation drain before terminal disposal", async () => {
    const preparation = deferred<void>();
    const preparationStarted = deferred<void>();
    const dispose = vi.fn();
    const runtime = new RendererPluginRuntime([
      {
        activate: (context) => {
          context.lifecycle.beforeSuspend({
            prepare: async () => {
              preparationStarted.resolve();
              await preparation.promise;
            },
          });
          return dispose;
        },
        id: "runtime.test",
      },
    ]);
    await runtime.refresh([pluginEntry]);

    const refresh = runtime.refresh([]);
    await preparationStarted.promise;
    const terminalDispose = runtime.dispose();
    await expect(refresh).resolves.toBeUndefined();
    expect(dispose).not.toHaveBeenCalled();

    preparation.resolve();
    await terminalDispose;

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("disposes drained plugins even while another plugin drain is pending", async () => {
    const hangingPreparation = deferred<void>();
    const preparationStarted = deferred<void>();
    const disposeA = vi.fn();
    const disposeB = vi.fn();
    const entryA = {
      ...pluginEntry,
      manifest: { ...pluginEntry.manifest, id: "runtime.dispose-a" },
    };
    const entryB = {
      ...pluginEntry,
      manifest: { ...pluginEntry.manifest, id: "runtime.dispose-b" },
    };
    const runtime = new RendererPluginRuntime([
      { activate: () => disposeA, id: "runtime.dispose-a" },
      { activate: () => disposeB, id: "runtime.dispose-b" },
    ]);
    const unregister = pluginLifecycleBarriers.register("runtime.dispose-a", {
      prepare: async () => {
        preparationStarted.resolve();
        await hangingPreparation.promise;
      },
    });
    await runtime.refresh([entryA, entryB]);
    const pendingPreparation = pluginLifecycleBarriers.prepare(
      "runtime.dispose-a",
      "runtime-refresh",
      "runtime:terminal-dispose-isolation"
    );
    await preparationStarted.promise;
    pluginLifecycleBarriers.cancelRuntimePreparations();
    await expect(pendingPreparation).rejects.toMatchObject({
      name: "AbortError",
    });

    const terminalDispose = runtime.dispose();
    await vi.waitFor(() => expect(disposeB).toHaveBeenCalledOnce());
    expect(disposeA).not.toHaveBeenCalled();

    hangingPreparation.resolve();
    await terminalDispose;
    expect(disposeA).toHaveBeenCalledOnce();
    unregister();
    pluginLifecycleBarriers.clear("runtime.dispose-a");
    pluginLifecycleBarriers.clear("runtime.dispose-b");
  });

  it("keeps a main receipt until failed disposal is compensated", async () => {
    const abort = vi.fn();
    const commit = vi.fn();
    const prepare = vi.fn();
    const dispose = vi
      .fn<() => void>()
      .mockImplementationOnce(() => {
        throw new Error("first disposer failure");
      })
      .mockImplementationOnce(() => undefined);
    const activate = vi.fn((context: RendererPluginContext) => {
      context.lifecycle.beforeSuspend({ abort, commit, prepare });
      return dispose;
    });
    const runtime = new RendererPluginRuntime([
      {
        activate,
        id: "runtime.test",
      },
    ]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runtime.refresh([pluginEntry]);
    expect(
      runtime.prepareExternalTransition(
        "runtime.test",
        "plugin-disable",
        "disable-receipt-retained",
        1
      )
    ).toBe(true);
    await pluginLifecycleBarriers.prepare(
      "runtime.test",
      "plugin-disable",
      "disable-receipt-retained"
    );

    await expect(runtime.refresh([])).rejects.toThrow(
      "renderer plugin refresh failed"
    );
    await expect(
      runtime.finalizeExternalTransition(
        "runtime.test",
        "disable-receipt-retained",
        1,
        "commit"
      )
    ).rejects.toThrow("renderer plugin refresh failed");
    await pluginLifecycleBarriers.finalize("disable-receipt-retained", "abort");
    await runtime.refresh([pluginEntry]);

    expect(abort).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(2);
    await runtime.dispose();
    expect(dispose).toHaveBeenCalledTimes(3);
  });

  it("fully cleans and reactivates a partial plugin when desired reverts", async () => {
    const dispose = vi
      .fn<() => void>()
      .mockImplementationOnce(() => {
        throw new Error("partial cleanup failed");
      })
      .mockImplementation(() => undefined);
    const activate = vi.fn((context: RendererPluginContext) => {
      context.lifecycle.beforeSuspend({ prepare: () => undefined });
      return dispose;
    });
    const runtime = new RendererPluginRuntime([
      { activate, id: "runtime.test" },
    ]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runtime.refresh([pluginEntry]);

    await expect(runtime.refresh([])).rejects.toThrow(
      "renderer plugin refresh failed"
    );
    await runtime.refresh([pluginEntry]);

    expect(dispose).toHaveBeenCalledTimes(2);
    expect(activate).toHaveBeenCalledTimes(2);
    await runtime.dispose();
  });

  it("keeps the instance after a local commit failure and retries removal", async () => {
    const abort = vi.fn();
    const commit = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("first local commit failed"))
      .mockResolvedValueOnce(undefined);
    const dispose = vi.fn();
    const prepare = vi.fn();
    const activate = vi.fn((context: RendererPluginContext) => {
      context.lifecycle.beforeSuspend({ abort, commit, prepare });
      return dispose;
    });
    const runtime = new RendererPluginRuntime([
      { activate, id: "runtime.test" },
    ]);
    await runtime.refresh([pluginEntry]);

    await expect(runtime.refresh([])).rejects.toThrow(
      "renderer plugin refresh failed"
    );
    await runtime.refresh([pluginEntry]);

    expect(abort).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledOnce();

    await runtime.refresh([]);

    expect(commit).toHaveBeenCalledTimes(2);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledOnce();
    await runtime.dispose();
  });

  it("aborts a stale local disposal lease before calling the disposer", async () => {
    const commitStarted = deferred<void>();
    const releaseCommit = deferred<void>();
    const abort = vi.fn();
    const dispose = vi.fn();
    const activate = vi.fn((context: RendererPluginContext) => {
      context.lifecycle.beforeSuspend({
        abort,
        commit: async () => {
          commitStarted.resolve();
          await releaseCommit.promise;
        },
        prepare: () => undefined,
      });
      return dispose;
    });
    const runtime = new RendererPluginRuntime([
      { activate, id: "runtime.test" },
    ]);
    await runtime.refresh([pluginEntry]);

    const stale = runtime.refresh([]);
    await commitStarted.promise;
    const latest = runtime.refresh([pluginEntry]);
    releaseCommit.resolve();
    await Promise.all([stale, latest]);

    expect(abort).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledOnce();
    await runtime.dispose();
  });

  it("does not dispose after a main lifecycle lease is rolled back", async () => {
    const dispose = vi.fn();
    vi.spyOn(
      pluginLifecycleBarriers,
      "consumePreparedOrCommitted"
    ).mockResolvedValue(true);
    vi.spyOn(pluginLifecycleBarriers, "acquireCommittedLease")
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({
        isCurrent: () => false,
        transitionId: "main-transition",
      });

    await suspendAndDisposeRendererPlugin({
      dispose,
      mainAuthorization: {
        reason: "plugin-disable",
        transitionId: "main-transition",
      },
      onDisposed: vi.fn(),
      pluginId: "runtime.test",
      reason: "runtime-refresh",
      shouldContinue: () => true,
    });
    await suspendAndDisposeRendererPlugin({
      dispose,
      mainAuthorization: {
        reason: "plugin-disable",
        transitionId: "main-transition",
      },
      onDisposed: vi.fn(),
      pluginId: "runtime.test",
      reason: "runtime-refresh",
      shouldContinue: () => true,
    });

    expect(dispose).not.toHaveBeenCalled();
    expect(
      pluginLifecycleBarriers.consumePreparedOrCommitted
    ).toHaveBeenCalledWith(
      "runtime.test",
      "plugin-disable",
      expect.any(Function),
      { retainCommit: true, transitionId: "main-transition" }
    );
    expect(pluginLifecycleBarriers.acquireCommittedLease).toHaveBeenCalledWith(
      "runtime.test",
      "plugin-disable",
      "main-transition"
    );
  });

  it("waits for the target plugin barrier before calling its disposer", async () => {
    const events: string[] = [];
    const module: RendererPluginModule = {
      activate: () => () => {
        events.push("dispose");
      },
      id: "runtime.test",
    };
    const runtime = new RendererPluginRuntime([module]);
    pluginLifecycleBarriers.register("runtime.test", async (reason) => {
      await Promise.resolve();
      events.push(`barrier:${reason}`);
    });

    await runtime.refresh([pluginEntry]);
    await runtime.refresh([]);

    expect(events).toEqual(["barrier:runtime-refresh", "dispose"]);
  });

  it("keeps the plugin active and records diagnostics when its barrier vetoes", async () => {
    const dispose = vi.fn();
    const module: RendererPluginModule = {
      activate: () => dispose,
      id: "runtime.test",
    };
    const runtime = new RendererPluginRuntime([module]);
    pluginLifecycleBarriers.register("runtime.test", () => {
      throw new Error("draft flush failed");
    });

    await runtime.refresh([pluginEntry]);
    await expect(runtime.refresh([])).rejects.toThrow(
      "renderer plugin refresh failed"
    );

    expect(dispose).not.toHaveBeenCalled();
    expect(runtime.diagnostics().lastTransitionError?.message).toBe(
      "renderer plugin refresh failed"
    );
  });

  it("does not dispose and reactivate an unchanged plugin", async () => {
    const activate = vi.fn(() => vi.fn());
    const runtime = new RendererPluginRuntime([
      { activate, id: "runtime.test" },
    ]);

    await runtime.refresh([pluginEntry]);
    await runtime.refresh([{ ...pluginEntry }]);

    expect(activate).toHaveBeenCalledOnce();
  });

  it("does not let one hanging external plugin block another or runtime disposal", async () => {
    const activateB = vi.fn(() => vi.fn());
    const loadExternalModule = vi.fn(
      async ({ expectedPluginId }: { expectedPluginId: string }) => {
        if (expectedPluginId === "pier.external-a") {
          return await new Promise<ExternalRendererPluginModule>(() => {});
        }
        return externalModule("pier.external-b", activateB);
      }
    );
    const runtime = new RendererPluginRuntime([], { loadExternalModule });

    await runtime.refresh([
      externalEntry("pier.external-a"),
      externalEntry("pier.external-b"),
    ]);
    runtime.startExternalActivations();

    await vi.waitFor(() => {
      expect(activateB).toHaveBeenCalledOnce();
    });
    expect(runtime.diagnostics().pendingExternalPluginIds).toContain(
      "pier.external-a"
    );

    await runtime.dispose();
    expect(runtime.diagnostics().pendingExternalPluginIds).toEqual([]);
  });

  it("does not activate a module that resolves after the plugin is disabled", async () => {
    const pending = deferred<ExternalRendererPluginModule>();
    const activate = vi.fn(() => vi.fn());
    const runtime = new RendererPluginRuntime([], {
      loadExternalModule: vi.fn(async () => await pending.promise),
    });

    await runtime.refresh([externalEntry("pier.external")]);
    runtime.startExternalActivations();
    await runtime.refresh([]);
    pending.resolve(externalModule("pier.external", activate));
    await Promise.resolve();

    expect(activate).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it("cancels a pending import during the real disable prepare window", async () => {
    const first = deferred<ExternalRendererPluginModule>();
    const activate = vi.fn(() => vi.fn());
    const loadExternalModule = vi
      .fn()
      .mockImplementationOnce(async () => await first.promise)
      .mockImplementationOnce(async () =>
        externalModule("pier.external", activate)
      );
    const runtime = new RendererPluginRuntime([], { loadExternalModule });
    await runtime.refresh([externalEntry("pier.external")]);
    runtime.startExternalActivations();

    runtime.prepareExternalTransition(
      "pier.external",
      "plugin-disable",
      "disable-1",
      1
    );
    first.resolve(externalModule("pier.external", activate));
    await Promise.resolve();
    expect(activate).not.toHaveBeenCalled();

    runtime.finalizeExternalTransition(
      "pier.external",
      "disable-1",
      1,
      "abort"
    );
    await vi.waitFor(() => expect(activate).toHaveBeenCalledOnce());
    await runtime.dispose();
  });

  it("does not let a superseded queued snapshot activate a builtin plugin", async () => {
    const prepared = deferred<void>();
    const activateB = vi.fn(() => vi.fn());
    const entryA = {
      ...pluginEntry,
      manifest: { ...pluginEntry.manifest, id: "runtime.a" },
    };
    const entryB = {
      ...pluginEntry,
      manifest: { ...pluginEntry.manifest, id: "runtime.b" },
    };
    const runtime = new RendererPluginRuntime([
      {
        id: "runtime.a",
        activate: (context) => {
          context.lifecycle.beforeSuspend({
            prepare: async () => await prepared.promise,
          });
          return vi.fn();
        },
      },
      { activate: activateB, id: "runtime.b" },
    ]);
    await runtime.refresh([entryA]);

    const stale = runtime.refresh([entryB]);
    await Promise.resolve();
    const latest = runtime.refresh([]);
    prepared.resolve();
    await stale;
    await latest;

    expect(activateB).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it("aborts a stale suspend when the latest snapshot keeps the active plugin", async () => {
    const prepared = deferred<void>();
    const preparationStarted = deferred<void>();
    const abort = vi.fn();
    const disposeA = vi.fn();
    const activateA = vi.fn((context: RendererPluginContext) => {
      context.lifecycle.beforeSuspend({
        abort,
        prepare: async () => {
          preparationStarted.resolve();
          await prepared.promise;
        },
      });
      return disposeA;
    });
    const entryA = {
      ...pluginEntry,
      manifest: { ...pluginEntry.manifest, id: "runtime.keep-a" },
    };
    const entryB = {
      ...pluginEntry,
      manifest: { ...pluginEntry.manifest, id: "runtime.replace-b" },
    };
    const runtime = new RendererPluginRuntime([
      { activate: activateA, id: "runtime.keep-a" },
      { activate: () => vi.fn(), id: "runtime.replace-b" },
    ]);
    await runtime.refresh([entryA]);

    const stale = runtime.refresh([entryB]);
    await preparationStarted.promise;
    const latest = runtime.refresh([entryA]);
    prepared.resolve();
    await stale;
    await latest;

    expect(abort).toHaveBeenCalledOnce();
    expect(disposeA).not.toHaveBeenCalled();
    expect(activateA).toHaveBeenCalledOnce();
    await runtime.dispose();
  });

  it("actively aborts a hanging stale preparation before running the latest refresh", async () => {
    const preparationStarted = deferred<void>();
    const preparationAborted = deferred<void>();
    const dispose = vi.fn();
    const abort = vi.fn();
    let firstPreparation = true;
    const activate = vi.fn((context: RendererPluginContext) => {
      context.lifecycle.beforeSuspend({
        abort,
        prepare: ({ signal }) => {
          if (!firstPreparation) return;
          firstPreparation = false;
          preparationStarted.resolve();
          return new Promise<void>((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                preparationAborted.resolve();
                resolve();
              },
              { once: true }
            );
          });
        },
      });
      return dispose;
    });
    const entry = {
      ...pluginEntry,
      manifest: { ...pluginEntry.manifest, id: "runtime.cancel-stale" },
    };
    const runtime = new RendererPluginRuntime([
      { activate, id: "runtime.cancel-stale" },
    ]);
    await runtime.refresh([entry]);

    const stale = runtime.refresh([]);
    await preparationStarted.promise;
    const latest = runtime.refresh([entry]);
    await preparationAborted.promise;
    await Promise.all([stale, latest]);

    expect(abort).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledOnce();
    await runtime.dispose();
  });

  it("reconciles automatically after a timed-out finalizer finishes draining", async () => {
    vi.useFakeTimers();
    const firstCommit = deferred<void>();
    const dispose = vi.fn();
    const commit = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(async () => await firstCommit.promise)
      .mockResolvedValueOnce(undefined);
    const abort = vi.fn();
    const activate = vi.fn((context: RendererPluginContext) => {
      context.lifecycle.beforeSuspend({
        abort,
        commit,
        prepare: () => undefined,
      });
      return dispose;
    });
    const entry = {
      ...pluginEntry,
      manifest: { ...pluginEntry.manifest, id: "runtime.finalizer-drain" },
    };
    const runtime = new RendererPluginRuntime([
      { activate, id: "runtime.finalizer-drain" },
    ]);
    await runtime.refresh([entry]);

    const refresh = runtime.refresh([]);
    await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(refresh).resolves.toBeUndefined();
    expect(dispose).not.toHaveBeenCalled();

    firstCommit.resolve();
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(abort).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledTimes(2);
    await runtime.dispose();
  });

  it("retries runtime abort cleanup after preparation and first recovery fail", async () => {
    const pluginId = "runtime.abort-retry";
    const dispose = vi.fn();
    const prepare = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("first preparation failed"))
      .mockResolvedValueOnce(undefined);
    const abort = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("first abort failed"))
      .mockResolvedValueOnce(undefined);
    const activate = vi.fn((context: RendererPluginContext) => {
      context.lifecycle.beforeSuspend({ abort, prepare });
      return dispose;
    });
    const entry = {
      ...pluginEntry,
      manifest: { ...pluginEntry.manifest, id: pluginId },
    };
    const runtime = new RendererPluginRuntime([{ activate, id: pluginId }]);
    await runtime.refresh([entry]);

    await expect(runtime.refresh([])).rejects.toThrow(
      "renderer plugin refresh failed"
    );
    expect(dispose).not.toHaveBeenCalled();

    await expect(runtime.refresh([])).resolves.toBeUndefined();
    expect(dispose).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(abort).toHaveBeenCalledTimes(2);
    await runtime.dispose();
  });

  it("does not start lifecycle preparation for an already stale refresh", async () => {
    const prepare = vi.fn(() => new Promise<void>(() => undefined));
    const dispose = vi.fn();
    const unregister = pluginLifecycleBarriers.register(
      "runtime.stale-before-prepare",
      { prepare }
    );

    await suspendAndDisposeRendererPlugin({
      dispose,
      onDisposed: vi.fn(),
      pluginId: "runtime.stale-before-prepare",
      reason: "runtime-refresh",
      shouldContinue: () => false,
    });

    expect(prepare).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    unregister();
  });

  it("disposes after consuming a committed receipt even if the refresh becomes stale", async () => {
    const pluginId = "runtime.committed-before-stale";
    const dispose = vi.fn();
    const unregister = pluginLifecycleBarriers.register(pluginId, {
      prepare: () => undefined,
    });
    await pluginLifecycleBarriers.prepare(
      pluginId,
      "plugin-disable",
      "committed-before-stale"
    );
    await pluginLifecycleBarriers.finalize("committed-before-stale", "commit");
    let current = true;
    queueMicrotask(() => {
      current = false;
    });

    await suspendAndDisposeRendererPlugin({
      dispose,
      mainAuthorization: {
        reason: "plugin-disable",
        transitionId: "committed-before-stale",
      },
      onDisposed: vi.fn(),
      pluginId,
      reason: "runtime-refresh",
      shouldContinue: () => current,
    });

    expect(dispose).toHaveBeenCalledOnce();
    await expect(
      pluginLifecycleBarriers.consumePreparedOrCommitted(
        pluginId,
        "plugin-disable"
      )
    ).resolves.toBe(false);
    unregister();
  });

  it("keeps a registry-first disable retryable after commit finalization fails", async () => {
    const id = "pier.external.registry-first-disable";
    const entry = externalEntry(id);
    const dispose = vi.fn();
    const commit = vi
      .fn<() => void>()
      .mockImplementationOnce(() => {
        throw new Error("first commit finalizer failed");
      })
      .mockImplementation(() => undefined);
    const runtime = new RendererPluginRuntime([], {
      loadExternalModule: vi.fn(async () => ({
        id,
        activate(context: ExternalRendererPluginContext) {
          context.lifecycle.beforeSuspend({ commit, prepare: () => undefined });
          return dispose;
        },
      })),
    });

    await runtime.refresh([entry]);
    runtime.startExternalActivations();
    await vi.waitFor(() =>
      expect(runtime.diagnostics().pendingExternalPluginIds).toEqual([])
    );
    expect(
      runtime.prepareExternalTransition(
        id,
        "plugin-disable",
        "registry-first-disable",
        1
      )
    ).toBe(true);
    await pluginLifecycleBarriers.prepare(
      id,
      "plugin-disable",
      "registry-first-disable"
    );

    await expect(runtime.refresh([])).rejects.toThrow(
      "renderer plugin refresh failed"
    );
    expect(dispose).not.toHaveBeenCalled();
    await expect(
      pluginLifecycleBarriers.finalize("registry-first-disable", "commit")
    ).rejects.toThrow("plugin lifecycle commit failed");

    await runtime.refresh([entry]);
    await pluginLifecycleBarriers.finalize("registry-first-disable", "abort");
    await runtime.finalizeExternalTransition(
      id,
      "registry-first-disable",
      1,
      "abort"
    );

    expect(dispose).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledOnce();
    await runtime.dispose();
  });

  it("keeps only the latest external source revision", async () => {
    const rev1 = deferred<ExternalRendererPluginModule>();
    const rev2 = deferred<ExternalRendererPluginModule>();
    const activateRev1 = vi.fn(() => vi.fn());
    const activateRev2 = vi.fn(() => vi.fn());
    const runtime = new RendererPluginRuntime([], {
      loadExternalModule: vi.fn(async ({ rendererEntryUrl }) =>
        rendererEntryUrl.includes("rev-1") ? rev1.promise : rev2.promise
      ),
    });

    await runtime.refresh([externalEntry("pier.external", "rev-1")]);
    runtime.startExternalActivations();
    await runtime.refresh([externalEntry("pier.external", "rev-2")]);
    rev1.resolve(externalModule("pier.external", activateRev1));
    rev2.resolve(externalModule("pier.external", activateRev2));

    await vi.waitFor(() => {
      expect(activateRev2).toHaveBeenCalledOnce();
    });
    expect(activateRev1).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it("reports external renderer activation success and failure to main", async () => {
    const successReport = vi.fn(async () => undefined);
    const successRuntime = new RendererPluginRuntime([], {
      loadExternalModule: vi.fn(async () =>
        externalModule("pier.external.success", () => vi.fn())
      ),
      reportExternalActivation: successReport,
    });
    await successRuntime.refresh([externalEntry("pier.external.success")]);
    successRuntime.startExternalActivations();
    await vi.waitFor(() =>
      expect(successReport).toHaveBeenCalledWith({
        ok: true,
        pluginId: "pier.external.success",
        version: "1.0.0",
      })
    );
    await successRuntime.dispose();

    const failureReport = vi.fn(async () => undefined);
    const failureRuntime = new RendererPluginRuntime([], {
      loadExternalModule: vi.fn(async () => ({
        activate() {
          throw new Error("activation failed");
        },
        id: "pier.external.failure",
      })),
      reportExternalActivation: failureReport,
    });
    await failureRuntime.refresh([externalEntry("pier.external.failure")]);
    failureRuntime.startExternalActivations();
    await vi.waitFor(() =>
      expect(failureReport).toHaveBeenCalledWith({
        error: "activation failed",
        ok: false,
        pluginId: "pier.external.failure",
        version: "1.0.0",
      })
    );
    await failureRuntime.dispose();
  });

  it("times out an external load, reports diagnostics, and ignores a late module", async () => {
    vi.useFakeTimers();
    const pending = deferred<ExternalRendererPluginModule>();
    const activate = vi.fn(() => vi.fn());
    const runtime = new RendererPluginRuntime([], {
      externalLoadTimeoutMs: 25,
      loadExternalModule: vi.fn(async () => await pending.promise),
    });

    await runtime.refresh([externalEntry("pier.external")]);
    runtime.startExternalActivations();
    await vi.advanceTimersByTimeAsync(25);

    expect(getRendererPluginRuntimeDiagnostics()).toEqual([
      expect.objectContaining({
        pluginId: "pier.external",
        message: expect.stringContaining("timed out"),
      }),
    ]);
    pending.resolve(externalModule("pier.external", activate));
    await Promise.resolve();
    expect(activate).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it("disposes exactly once when activation synchronously becomes stale", async () => {
    const dispose = vi.fn();
    let runtime!: RendererPluginRuntime;
    const activate = vi.fn(() => {
      runtime.refresh([]).catch(() => undefined);
      return dispose;
    });
    runtime = new RendererPluginRuntime([], {
      loadExternalModule: vi.fn(async () =>
        externalModule("pier.external", activate)
      ),
    });

    await runtime.refresh([externalEntry("pier.external")]);
    runtime.startExternalActivations();

    await vi.waitFor(() => {
      expect(dispose).toHaveBeenCalledOnce();
    });
    expect(activate).toHaveBeenCalledOnce();
    await runtime.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("cleans scoped registrations when a stale plugin disposer throws", async () => {
    const id = "pier.external.stale-cleanup";
    const entry = externalEntry(id);
    entry.manifest.commands = [
      { id: `${id}.action`, permissions: [], title: "Stale action" },
    ];
    let runtime!: RendererPluginRuntime;
    runtime = new RendererPluginRuntime([], {
      loadExternalModule: vi.fn(async () => ({
        id,
        activate(context: ExternalRendererPluginContext) {
          context.actions.register({
            id: `${id}.action`,
            invoke: vi.fn(),
            title: "Stale action",
          });
          runtime.refresh([]).catch(() => undefined);
          return () => {
            throw new Error("stale plugin disposer failed");
          };
        },
      })),
    });

    await runtime.refresh([entry]);
    runtime.startExternalActivations();
    await vi.waitFor(() => {
      expect(actionRegistry.get(`${id}.action`)).toBeUndefined();
    });

    await runtime.dispose();
  });

  it("rolls back scoped registrations when external activation throws", async () => {
    const id = "pier.external.scoped";
    const entry = externalEntry(id);
    entry.manifest.commands = [
      { id: `${id}.action`, permissions: [], title: "Scoped action" },
    ];
    const runtime = new RendererPluginRuntime([], {
      loadExternalModule: vi.fn(async () => ({
        id,
        activate(context: ExternalRendererPluginContext) {
          context.actions.register({
            id: `${id}.action`,
            invoke: vi.fn(),
            title: "Scoped action",
          });
          throw new Error("activation failed after registration");
        },
      })),
    });

    await runtime.refresh([entry]);
    runtime.startExternalActivations();
    await vi.waitFor(() => {
      expect(getRendererPluginRuntimeDiagnostics()).toHaveLength(1);
    });

    expect(actionRegistry.get(`${id}.action`)).toBeUndefined();
    await runtime.dispose();
  });

  it("rejects an invalid external disposer without leaking registrations", async () => {
    const id = "pier.external.invalid-disposer";
    const entry = externalEntry(id);
    entry.manifest.commands = [
      { id: `${id}.action`, permissions: [], title: "Scoped action" },
    ];
    const runtime = new RendererPluginRuntime([], {
      loadExternalModule: vi.fn(async () => ({
        id,
        activate: ((
          context: Parameters<ExternalRendererPluginModule["activate"]>[0]
        ) => {
          context.actions.register({
            id: `${id}.action`,
            invoke: vi.fn(),
            title: "Scoped action",
          });
        }) as unknown as ExternalRendererPluginModule["activate"],
      })),
    });

    await runtime.refresh([entry]);
    runtime.startExternalActivations();
    await vi.waitFor(() => {
      expect(getRendererPluginRuntimeDiagnostics()[0]?.message).toContain(
        "must return a disposer"
      );
    });

    expect(actionRegistry.get(`${id}.action`)).toBeUndefined();
    await runtime.dispose();
  });

  it("keeps a failed placeholder when a plugin omits a declared panel", async () => {
    const id = "pier.external.missing-panel";
    const entry = externalEntry(id);
    entry.effectivePermissions = ["panel:register"];
    entry.manifest.panels = [
      { id: `${id}.panel`, permissions: [], title: "Missing panel" },
    ];
    const pluginDispose = vi.fn();
    const runtime = new RendererPluginRuntime([], {
      loadExternalModule: vi.fn(async () =>
        externalModule(id, () => pluginDispose)
      ),
    });

    await runtime.refresh([entry]);
    runtime.startExternalActivations();
    await vi.waitFor(() => {
      expect(getRendererPluginRuntimeDiagnostics()[0]?.message).toContain(
        "did not register declared panels"
      );
    });

    expect(pluginDispose).toHaveBeenCalledOnce();
    await runtime.dispose();
  });

  it("keeps the dockview instance when activation fails after panel registration", async () => {
    const id = "pier.external.partial-panel";
    const entry = externalEntry(id);
    entry.effectivePermissions = ["panel:register"];
    entry.manifest.panels = [
      { id: `${id}.panel`, permissions: [], title: "Partial panel" },
    ];
    const closePanel = vi.fn();
    setPluginPanelCloser(closePanel);
    const runtime = new RendererPluginRuntime([], {
      loadExternalModule: vi.fn(async () => ({
        id,
        activate(context: ExternalRendererPluginContext) {
          context.panels.register({
            component: () => createElement("div", null, "partial"),
            id: `${id}.panel`,
          });
          throw new Error("failed after panel registration");
        },
      })),
    });

    await runtime.refresh([entry]);
    runtime.startExternalActivations();
    await vi.waitFor(() => {
      expect(getRendererPluginRuntimeDiagnostics()[0]?.message).toContain(
        "failed after panel registration"
      );
    });

    expect(closePanel).not.toHaveBeenCalled();
    expect(getPluginPanelRegistrations().has(`${id}.panel`)).toBe(true);
    await runtime.dispose();
  });

  it("atomically swaps a real external panel through a successful reload", async () => {
    const id = "pier.external.reload-panel";
    const entryV1 = externalEntry(id, "rev-1");
    entryV1.effectivePermissions = ["panel:register"];
    entryV1.manifest.panels = [
      { id: `${id}.panel`, permissions: [], title: "Reload panel" },
    ];
    const entryV2 = externalEntry(id, "rev-2");
    entryV2.effectivePermissions = ["panel:register"];
    entryV2.manifest.panels = entryV1.manifest.panels;
    const PanelV1 = () => createElement("div", null, "rev-1");
    const PanelV2 = () => createElement("div", null, "rev-2");
    const closePanel = vi.fn();
    setPluginPanelCloser(closePanel);
    const loadExternalModule = vi.fn(async ({ rendererEntryUrl }) => ({
      id,
      activate(context: ExternalRendererPluginContext) {
        context.panels.register({
          component: rendererEntryUrl.includes("rev-1") ? PanelV1 : PanelV2,
          id: `${id}.panel`,
        });
        return vi.fn();
      },
    }));
    const runtime = new RendererPluginRuntime([], {
      loadExternalModule,
    });

    await runtime.refresh([entryV1]);
    const stableSlot = getPluginPanelRegistrations().get(
      `${id}.panel`
    )?.component;
    runtime.startExternalActivations();
    await vi.waitFor(() => {
      expect(getRendererPluginRuntimeDiagnostics()).toEqual([]);
      expect(runtime.diagnostics().pendingExternalPluginIds).toEqual([]);
    });
    await runtime.refresh([entryV2]);
    await vi.waitFor(() => {
      expect(getPluginPanelRegistrations().get(`${id}.panel`)?.component).toBe(
        stableSlot
      );
      expect(loadExternalModule).toHaveBeenCalledTimes(2);
    });

    expect(closePanel).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it("starts other external plugins when one plugin cleanup fails", async () => {
    const activateB = vi.fn(() => vi.fn());
    const hangingReload = deferred<ExternalRendererPluginModule>();
    const loadExternalModule = vi.fn(
      async ({ expectedPluginId, rendererEntryUrl }) => {
        if (expectedPluginId === "pier.external.a") {
          if (rendererEntryUrl.includes("rev-2")) {
            return await hangingReload.promise;
          }
          return externalModule("pier.external.a", () => () => {
            throw new Error("cleanup a failed");
          });
        }
        return externalModule("pier.external.b", activateB);
      }
    );
    const runtime = new RendererPluginRuntime([], { loadExternalModule });
    await runtime.refresh([externalEntry("pier.external.a", "rev-1")]);
    runtime.startExternalActivations();
    await vi.waitFor(() =>
      expect(runtime.diagnostics().pendingExternalPluginIds).toEqual([])
    );

    await expect(
      runtime.refresh([
        externalEntry("pier.external.a", "rev-2"),
        externalEntry("pier.external.b", "rev-1"),
      ])
    ).rejects.toThrow("renderer plugin refresh failed");
    await vi.waitFor(() => expect(activateB).toHaveBeenCalledOnce());
    expect(getRendererPluginRuntimeDiagnostics()).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("cleanup"),
        pluginId: "pier.external.a",
      }),
    ]);
    await expect(runtime.dispose()).rejects.toThrow(
      "renderer plugin dispose failed"
    );
  });

  it("skips main-only external plugins without leaving pending state", async () => {
    const entry = externalEntry("pier.external.main-only");
    entry.runtime = { ...entry.runtime, rendererEntryUrl: undefined };
    const loadExternalModule = vi.fn();
    const runtime = new RendererPluginRuntime([], { loadExternalModule });

    await runtime.refresh([entry]);
    runtime.startExternalActivations();

    expect(loadExternalModule).not.toHaveBeenCalled();
    expect(runtime.diagnostics().pendingExternalPluginIds).toEqual([]);
    await runtime.dispose();
  });
});
