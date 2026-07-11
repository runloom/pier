import type { RendererCommandEnvelope } from "@shared/contracts/renderer-command.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installWorkspaceRendererCommandListener } from "@/components/workspace/workspace-renderer-command-listener.ts";
import { pluginLifecycleBarriers } from "@/lib/plugins/plugin-lifecycle-barriers.ts";
import { rendererPluginRuntime } from "@/lib/plugins/runtime.ts";
import {
  markWorkspaceLayoutPersistenceStarting,
  markWorkspaceLayoutPersistenceUnavailable,
  registerWorkspaceLayoutFlusher,
  resetWorkspaceLayoutPersistenceForTests,
} from "@/lib/workspace/workspace-layout-persistence.ts";
import {
  resetAppDialogForTests,
  useAppDialogStore,
} from "@/stores/app-dialog.store.ts";

describe("workspace renderer command listener", () => {
  afterEach(() => {
    resetAppDialogForTests();
    resetWorkspaceLayoutPersistenceForTests();
    Reflect.deleteProperty(window, "pier");
    vi.restoreAllMocks();
  });

  it("acknowledges close-failure feedback while the application alert remains open", async () => {
    let listener: ((envelope: RendererCommandEnvelope) => void) | undefined;
    const resolve = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        rendererCommand: {
          onCommand: vi.fn((nextListener) => {
            listener = nextListener;
            return vi.fn();
          }),
          resolve,
        },
      },
    });
    const dispose = installWorkspaceRendererCommandListener();

    listener?.({
      command: {
        body: "draft flush failed",
        type: "workspace.reportCloseFailure",
        windowId: "main",
      },
      requestId: "report-close-failure",
    });
    await Promise.resolve();

    expect(resolve).toHaveBeenCalledWith({
      data: null,
      ok: true,
      requestId: "report-close-failure",
    });
    expect(useAppDialogStore.getState().current).toMatchObject({
      body: "draft flush failed",
      kind: "alert",
    });
    dispose();
  });

  it("allows prepareClose before workspace layout ever becomes ready", async () => {
    let listener: ((envelope: RendererCommandEnvelope) => void) | undefined;
    const resolve = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        rendererCommand: {
          onCommand: vi.fn((nextListener) => {
            listener = nextListener;
            return vi.fn();
          }),
          resolve,
        },
      },
    });
    resetWorkspaceLayoutPersistenceForTests();
    const dispose = installWorkspaceRendererCommandListener();

    listener?.({
      command: {
        reason: "window-close",
        transitionId: "startup-close",
        type: "workspace.prepareClose",
      },
      requestId: "startup-close",
    });

    await vi.waitFor(() =>
      expect(resolve).toHaveBeenCalledWith({
        data: null,
        ok: true,
        requestId: "startup-close",
      })
    );
    listener?.({
      command: {
        outcome: "commit",
        transitionId: "startup-close",
        type: "workspace.finalizeClose",
      },
      requestId: "startup-close-finalize",
    });
    await vi.waitFor(() =>
      expect(resolve).toHaveBeenCalledWith({
        data: null,
        ok: true,
        requestId: "startup-close-finalize",
      })
    );
    dispose();
  });

  it("answers flush commands before Dockview ready instead of timing out", async () => {
    let listener: ((envelope: RendererCommandEnvelope) => void) | undefined;
    const resolve = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        rendererCommand: {
          onCommand: vi.fn((nextListener) => {
            listener = nextListener;
            return vi.fn();
          }),
          resolve,
        },
      },
    });
    markWorkspaceLayoutPersistenceStarting();
    const dispose = installWorkspaceRendererCommandListener();

    listener?.({
      command: { type: "workspace.flushLayout" },
      requestId: "flush-starting",
    });
    await Promise.resolve();

    expect(resolve).toHaveBeenCalledWith({
      error: {
        code: "platform_unavailable",
        message:
          "The workspace is still starting, so its layout could not be saved yet.",
      },
      ok: false,
      requestId: "flush-starting",
    });
    dispose();
  });

  it("flushes when ready and fails deterministically after unmount", async () => {
    let listener: ((envelope: RendererCommandEnvelope) => void) | undefined;
    const resolve = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        rendererCommand: {
          onCommand: vi.fn((nextListener) => {
            listener = nextListener;
            return vi.fn();
          }),
          resolve,
        },
      },
    });
    const disposeListener = installWorkspaceRendererCommandListener();
    const flush = vi.fn(async () => undefined);
    const disposeFlusher = registerWorkspaceLayoutFlusher(flush);

    listener?.({
      command: { type: "workspace.flushLayout" },
      requestId: "flush-ready",
    });
    await vi.waitFor(() => {
      expect(flush).toHaveBeenCalledOnce();
      expect(resolve).toHaveBeenCalledWith({
        data: null,
        ok: true,
        requestId: "flush-ready",
      });
    });

    disposeFlusher();
    markWorkspaceLayoutPersistenceUnavailable();
    listener?.({
      command: { type: "workspace.flushLayout" },
      requestId: "flush-unavailable",
    });
    await vi.waitFor(() => {
      expect(resolve).toHaveBeenCalledWith({
        error: {
          code: "platform_unavailable",
          message:
            "The workspace is unavailable, so its layout could not be saved safely.",
        },
        ok: false,
        requestId: "flush-unavailable",
      });
    });
    disposeListener();
  });

  it("routes plugin transition generations into the runtime gate", async () => {
    let listener: ((envelope: RendererCommandEnvelope) => void) | undefined;
    const resolve = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        rendererCommand: {
          onCommand: vi.fn((nextListener) => {
            listener = nextListener;
            return vi.fn();
          }),
          resolve,
        },
      },
    });
    const prepare = vi.spyOn(
      rendererPluginRuntime,
      "prepareExternalTransition"
    );
    const finalize = vi.spyOn(
      rendererPluginRuntime,
      "finalizeExternalTransition"
    );
    const dispose = installWorkspaceRendererCommandListener();

    listener?.({
      command: {
        generation: 7,
        pluginId: "pier.external",
        transitionId: "disable-7",
        type: "plugin.prepareDisable",
      },
      requestId: "prepare-disable",
    });
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    listener?.({
      command: {
        generation: 7,
        outcome: "abort",
        pluginId: "pier.external",
        transitionId: "disable-7",
        type: "plugin.finalizeDisable",
      },
      requestId: "finalize-disable",
    });
    await vi.waitFor(() =>
      expect(finalize).toHaveBeenCalledWith(
        "pier.external",
        "disable-7",
        7,
        "abort"
      )
    );
    expect(resolve).toHaveBeenCalledWith({
      data: null,
      ok: true,
      requestId: "finalize-disable",
    });
    dispose();
  });

  it("releases the runtime gate even when a plugin finalizer fails", async () => {
    let listener: ((envelope: RendererCommandEnvelope) => void) | undefined;
    const resolve = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        rendererCommand: {
          onCommand: vi.fn((nextListener) => {
            listener = nextListener;
            return vi.fn();
          }),
          resolve,
        },
      },
    });
    vi.spyOn(pluginLifecycleBarriers, "finalize").mockRejectedValueOnce(
      new Error("renderer finalizer failed")
    );
    const finalizeRuntime = vi.spyOn(
      rendererPluginRuntime,
      "finalizeExternalTransition"
    );
    const dispose = installWorkspaceRendererCommandListener();

    listener?.({
      command: {
        generation: 8,
        outcome: "abort",
        pluginId: "pier.external",
        transitionId: "disable-8",
        type: "plugin.finalizeDisable",
      },
      requestId: "finalize-disable-failure",
    });

    await vi.waitFor(() =>
      expect(resolve).toHaveBeenCalledWith({
        error: { message: "renderer finalizer failed" },
        ok: false,
        requestId: "finalize-disable-failure",
      })
    );
    expect(finalizeRuntime).toHaveBeenCalledWith(
      "pier.external",
      "disable-8",
      8,
      "abort"
    );
    dispose();
  });

  it("returns a renderer error when runtime plugin disposal fails", async () => {
    let listener: ((envelope: RendererCommandEnvelope) => void) | undefined;
    const resolve = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        rendererCommand: {
          onCommand: vi.fn((nextListener) => {
            listener = nextListener;
            return vi.fn();
          }),
          resolve,
        },
      },
    });
    vi.spyOn(pluginLifecycleBarriers, "finalize").mockResolvedValueOnce();
    vi.spyOn(
      rendererPluginRuntime,
      "finalizeExternalTransition"
    ).mockRejectedValueOnce(new Error("plugin disposer failed"));
    const dispose = installWorkspaceRendererCommandListener();

    listener?.({
      command: {
        generation: 9,
        outcome: "commit",
        pluginId: "pier.files",
        transitionId: "disable-files-9",
        type: "plugin.finalizeDisable",
      },
      requestId: "finalize-disable-runtime-failure",
    });

    await vi.waitFor(() =>
      expect(resolve).toHaveBeenCalledWith({
        error: { message: "plugin disposer failed" },
        ok: false,
        requestId: "finalize-disable-runtime-failure",
      })
    );
    dispose();
  });

  it("reports close preparation and abort compensation failures together", async () => {
    let listener: ((envelope: RendererCommandEnvelope) => void) | undefined;
    const resolve = vi.fn();
    const abort = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("first abort failed"))
      .mockRejectedValueOnce(new Error("retry abort failed"))
      .mockResolvedValueOnce(undefined);
    const unregister = pluginLifecycleBarriers.register("pier.close-failure", {
      abort,
      prepare: () => {
        throw new Error("draft flush failed");
      },
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        rendererCommand: {
          onCommand: vi.fn((nextListener) => {
            listener = nextListener;
            return vi.fn();
          }),
          resolve,
        },
      },
    });
    const dispose = installWorkspaceRendererCommandListener();

    listener?.({
      command: {
        reason: "window-close",
        transitionId: "close-compensation-failure",
        type: "workspace.prepareClose",
      },
      requestId: "close-compensation-failure",
    });

    await vi.waitFor(() =>
      expect(resolve).toHaveBeenCalledWith({
        error: {
          message: "workspace close preparation and abort compensation failed",
        },
        ok: false,
        requestId: "close-compensation-failure",
      })
    );
    await pluginLifecycleBarriers.finalize(
      "close-compensation-failure",
      "abort"
    );
    expect(abort).toHaveBeenCalledTimes(3);
    unregister();
    pluginLifecycleBarriers.clear("pier.close-failure");
    dispose();
  });

  it("ignores a prepare command whose generation was already finalized", async () => {
    let listener: ((envelope: RendererCommandEnvelope) => void) | undefined;
    const resolve = vi.fn();
    const prepare = vi.fn();
    const unregister = pluginLifecycleBarriers.register("pier.early", {
      prepare,
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        rendererCommand: {
          onCommand: vi.fn((nextListener) => {
            listener = nextListener;
            return vi.fn();
          }),
          resolve,
        },
      },
    });
    const dispose = installWorkspaceRendererCommandListener();

    listener?.({
      command: {
        generation: 50,
        outcome: "abort",
        pluginId: "pier.early",
        transitionId: "early-50",
        type: "plugin.finalizeReload",
      },
      requestId: "early-finalize",
    });
    await vi.waitFor(() =>
      expect(resolve).toHaveBeenCalledWith({
        data: null,
        ok: true,
        requestId: "early-finalize",
      })
    );
    listener?.({
      command: {
        generation: 50,
        pluginId: "pier.early",
        transitionId: "early-50",
        type: "plugin.prepareReload",
      },
      requestId: "late-prepare",
    });
    await vi.waitFor(() =>
      expect(resolve).toHaveBeenCalledWith({
        data: null,
        ok: true,
        requestId: "late-prepare",
      })
    );

    expect(prepare).not.toHaveBeenCalled();
    unregister();
    pluginLifecycleBarriers.clear("pier.early");
    dispose();
  });
});
