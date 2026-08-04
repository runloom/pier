import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEditorController } from "@plugins/builtin/files/renderer/editor/controller.ts";
import {
  FILES_GROUP_VIEW_CLAIM_MAX_ATTEMPTS,
  useFilesGroupViewClaim,
} from "@plugins/builtin/files/renderer/panel/use-group-view-claim.ts";
import type { FilesWatchHub } from "@plugins/builtin/files/renderer/watch-hub.ts";
import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const claimFilesGroupView = vi.hoisted(() =>
  vi.fn((..._args: unknown[]): boolean => false)
);
const releaseFilesGroupView = vi.hoisted(() =>
  vi.fn((..._args: unknown[]): void => undefined)
);

vi.mock("@plugins/builtin/files/renderer/panel/group-view-host.tsx", () => ({
  claimFilesGroupView,
  releaseFilesGroupView,
}));

describe("useFilesGroupViewClaim", () => {
  afterEach(() => {
    claimFilesGroupView.mockReset();
    claimFilesGroupView.mockReturnValue(false);
    releaseFilesGroupView.mockReset();
    vi.unstubAllGlobals();
  });

  it("surfaces a user-visible error after claim retries are exhausted", () => {
    const error = vi.fn();
    const t = vi.fn(
      (_key: string, _values: unknown, fallback: string) => fallback
    );
    const group = {
      id: "group-a",
    } as PierDockviewGroupHandle;
    const runtimeContext = {
      i18n: { t },
      notifications: { error },
    } as unknown as RendererPluginContext;

    const scheduledFrames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        scheduledFrames.push(callback);
        return scheduledFrames.length;
      })
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    renderHook(() =>
      useFilesGroupViewClaim({
        controller: {} as FileEditorController,
        group,
        ownerId: Symbol("owner"),
        panelApiId: "panel-1",
        prefersSharedGroupView: true,
        runtimeContext,
        runtimeWatchHub: {} as FilesWatchHub,
      })
    );

    // Initial attempt + rAF retries until max.
    for (let i = 0; i < FILES_GROUP_VIEW_CLAIM_MAX_ATTEMPTS; i += 1) {
      const next = scheduledFrames.shift();
      expect(next).toBeTypeOf("function");
      next?.(0);
    }

    expect(claimFilesGroupView).toHaveBeenCalledTimes(
      FILES_GROUP_VIEW_CLAIM_MAX_ATTEMPTS + 1
    );
    expect(t).toHaveBeenCalledWith(
      "filePanel.errors.groupViewClaimFailed",
      undefined,
      expect.any(String)
    );
    expect(error).toHaveBeenCalledWith(
      "Couldn't show the file view. Switch tabs or reopen the file."
    );
  });
});
