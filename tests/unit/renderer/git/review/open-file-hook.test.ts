import type { PierDiffViewItem } from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useGitReviewOpenFile } from "@plugins/builtin/git/renderer/hooks/use-open-file.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("useGitReviewOpenFile", () => {
  it("passes active panel context when opening a file from the diff header", () => {
    const openInEditor = vi.fn(() => true);
    const getActiveContext = vi.fn(
      (): PanelContext => ({
        branch: "feature",
        contextId: "ctx-1",
        cwd: "/repo/packages/ui",
        gitRoot: "/repo",
        projectRootPath: "/repo",
        source: "panel",
        updatedAt: 1,
        worktreeKey: "/repo",
        worktreeRoot: "/repo",
      })
    );
    const context = {
      files: { openInEditor },
      i18n: {
        t: (_key: string, _values: unknown, fallback: string) => fallback,
      },
      notifications: { error: vi.fn() },
      panels: { getActiveContext },
    } as unknown as RendererPluginContext;

    const itemsRef = {
      current: [
        {
          cacheKey: "item-1",
          fileDisplay: { path: "src/a.ts", status: "modified" },
          id: "item-1",
          patch: "",
        },
      ],
    } satisfies { current: readonly PierDiffViewItem[] };

    const { result } = renderHook(() =>
      useGitReviewOpenFile({
        context,
        contextId: "ctx-1",
        gitRootPath: "/repo",
        itemsRef,
      })
    );

    result.current("item-1");

    expect(getActiveContext).toHaveBeenCalled();
    expect(openInEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          branch: "feature",
          cwd: "/repo/packages/ui",
          gitRoot: "/repo",
        }),
        path: "src/a.ts",
        root: "/repo",
      })
    );
  });

  it("prefers an explicit sourcePanelContext over the active panel", () => {
    const openInEditor = vi.fn(() => true);
    const getActiveContext = vi.fn(() => null);
    const context = {
      files: { openInEditor },
      i18n: {
        t: (_key: string, _values: unknown, fallback: string) => fallback,
      },
      notifications: { error: vi.fn() },
      panels: { getActiveContext },
    } as unknown as RendererPluginContext;

    const itemsRef = {
      current: [
        {
          cacheKey: "item-1",
          fileDisplay: { path: "src/a.ts", status: "modified" },
          id: "item-1",
          patch: "",
        },
      ],
    } satisfies { current: readonly PierDiffViewItem[] };

    const { result } = renderHook(() =>
      useGitReviewOpenFile({
        context,
        contextId: "ctx-1",
        gitRootPath: "/repo",
        itemsRef,
        sourcePanelContext: {
          branch: "explicit",
          contextId: "ctx-1",
          cwd: "/repo/apps",
          gitRoot: "/repo",
          projectRootPath: "/repo",
          source: "panel",
          updatedAt: 1,
          worktreeRoot: "/repo",
        },
      })
    );

    result.current("item-1");

    expect(getActiveContext).not.toHaveBeenCalled();
    expect(openInEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          branch: "explicit",
          cwd: "/repo/apps",
        }),
      })
    );
  });
});
