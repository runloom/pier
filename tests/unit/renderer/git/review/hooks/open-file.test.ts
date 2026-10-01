import type { PierDiffViewItem } from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useGitReviewOpenFile } from "@plugins/builtin/git/renderer/hooks/use-open-file.ts";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("useGitReviewOpenFile", () => {
  it.each([
    "DD",
    "DU",
  ] as const)("does not open an absent worktree file for a %s conflict", (xy) => {
    const openInEditor = vi.fn(() => true);
    const context = {
      files: { openInEditor },
      notifications: { error: vi.fn() },
      panels: { getActiveContext: () => null },
    } as unknown as RendererPluginContext;
    const itemsRef = {
      current: [
        {
          cacheKey: `conflict:${xy}`,
          conflict: {
            contents: null,
            contentsDigest: `sha256:${xy}`,
            presentation: "file-level",
            stages: { baseOid: null, oursOid: null, theirsOid: null },
            xy,
          },
          fileDisplay: { path: "src/deleted.ts", status: "conflicted" },
          id: "deleted",
          kind: "conflict",
          patch: null,
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

    result.current("deleted");

    expect(openInEditor).not.toHaveBeenCalled();
    expect(context.notifications.error).not.toHaveBeenCalled();
  });
});
