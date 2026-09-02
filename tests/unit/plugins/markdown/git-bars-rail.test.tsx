import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { MarkdownPreviewGitBars } from "@plugins/builtin/files/renderer/markdown/git-bars/rail.tsx";
import {
  filePatchForPath,
  useMarkdownPreviewGitModel,
} from "@plugins/builtin/files/renderer/markdown/git-bars/use-model.ts";
import type { GitDiffPatch } from "@shared/contracts/git.ts";
import {
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

function addedPatch(): GitDiffPatch {
  return {
    files: [
      {
        binary: false,
        hunks: [
          {
            lines: [
              { kind: "context", text: "a" },
              { kind: "add", text: "b" },
            ],
            newLines: 2,
            newStart: 1,
            oldLines: 1,
            oldStart: 1,
          },
        ],
        oldPath: "docs/readme.md",
        path: "docs/readme.md",
      },
    ],
  };
}

function renamedPatch(): GitDiffPatch {
  return {
    files: [
      {
        binary: false,
        hunks: [
          {
            lines: [
              { kind: "context", text: "a" },
              { kind: "add", text: "b" },
            ],
            newLines: 2,
            newStart: 1,
            oldLines: 1,
            oldStart: 1,
          },
        ],
        oldPath: "docs/readme.md",
        path: "docs/renamed.md",
      },
    ],
  };
}

function stubRect(top: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 0,
    top,
    width: 100,
    x: 0,
    y: top,
    toJSON() {
      return {};
    },
  } as DOMRect;
}

function makeContext(
  patch: GitDiffPatch | Error,
  watchImpl?: (
    root: string,
    listener: () => void,
    onStartFailure?: () => void
  ) => () => void
): RendererPluginContext {
  const getDiffPatch = vi.fn(async () => {
    if (patch instanceof Error) {
      throw patch;
    }
    return patch;
  });
  const openUncommittedChanges = vi.fn(() => true);
  return {
    git: {
      getDiffPatch,
      openUncommittedChanges,
      watch: watchImpl ? vi.fn(watchImpl) : vi.fn(() => () => undefined),
    },
    i18n: {
      t: (_key: string, _values?: unknown, fallback?: string) =>
        fallback ?? _key,
    },
    notifications: { error: vi.fn() },
    panels: { getActiveContext: () => undefined },
  } as unknown as RendererPluginContext;
}

describe("filePatchForPath", () => {
  it("matches the current path, then the rename source", () => {
    expect(filePatchForPath(renamedPatch(), "docs/renamed.md")?.path).toBe(
      "docs/renamed.md"
    );
    expect(filePatchForPath(renamedPatch(), "docs/readme.md")?.path).toBe(
      "docs/renamed.md"
    );
    expect(filePatchForPath(renamedPatch(), "docs/other.md")).toBeNull();
  });
});

describe("useMarkdownPreviewGitModel", () => {
  it("loads path-scoped markers from the disk patch", async () => {
    const context = makeContext(addedPatch());
    const { result } = renderHook(() =>
      useMarkdownPreviewGitModel({
        context,
        source: { kind: "disk", path: "docs/readme.md", root: "/repo" },
      })
    );
    await waitFor(() => {
      expect(result.current.markers.get(2)).toEqual({
        count: 1,
        kind: "added",
      });
    });
    expect(context.git.getDiffPatch).toHaveBeenCalledWith("/repo", {
      from: "HEAD",
      path: "docs/readme.md",
    });
  });

  it("matches a renamed file via oldPath", async () => {
    const context = makeContext(renamedPatch());
    const { result } = renderHook(() =>
      useMarkdownPreviewGitModel({
        context,
        source: { kind: "disk", path: "docs/readme.md", root: "/repo" },
      })
    );
    await waitFor(() => {
      expect(result.current.markers.get(2)).toEqual({
        count: 1,
        kind: "added",
      });
    });
  });

  it("clears on fetch failure", async () => {
    const context = makeContext(new Error("boom"));
    const { result } = renderHook(() =>
      useMarkdownPreviewGitModel({
        context,
        source: { kind: "disk", path: "docs/readme.md", root: "/repo" },
      })
    );
    await waitFor(() => {
      expect(result.current.markers.size).toBe(0);
      expect(result.current.ranges).toEqual([]);
    });
  });

  it("clears stale bars when the path changes before the next fetch returns", async () => {
    let releaseSecond: ((patch: GitDiffPatch) => void) | undefined;
    const getDiffPatch = vi.fn(
      async (_cwd: string, options?: { path?: string }) => {
        if (options?.path === "docs/other.md") {
          return await new Promise<GitDiffPatch>((resolve) => {
            releaseSecond = resolve;
          });
        }
        return addedPatch();
      }
    );
    const context = {
      git: {
        getDiffPatch,
        watch: vi.fn(() => () => undefined),
      },
    } as unknown as RendererPluginContext;
    const { result, rerender } = renderHook(
      ({ path }) =>
        useMarkdownPreviewGitModel({
          context,
          source: { kind: "disk", path, root: "/repo" },
        }),
      { initialProps: { path: "docs/readme.md" } }
    );
    await waitFor(() => {
      expect(result.current.markers.size).toBe(1);
    });
    rerender({ path: "docs/other.md" });
    await waitFor(() => {
      expect(result.current.markers.size).toBe(0);
    });
    releaseSecond?.({ files: [] });
  });

  it("refetches when the disk revision changes", async () => {
    const context = makeContext(addedPatch());
    const { rerender } = renderHook(
      ({ refreshKey }) =>
        useMarkdownPreviewGitModel({
          context,
          refreshKey,
          source: { kind: "disk", path: "docs/readme.md", root: "/repo" },
        }),
      { initialProps: { refreshKey: "rev-1" } }
    );
    await waitFor(() => {
      expect(context.git.getDiffPatch).toHaveBeenCalledTimes(1);
    });
    rerender({ refreshKey: "rev-2" });
    await waitFor(() => {
      expect(context.git.getDiffPatch).toHaveBeenCalledTimes(2);
    });
  });

  it("unsubscribes git.watch on unmount", async () => {
    const unsub = vi.fn();
    const context = makeContext(
      addedPatch(),
      vi.fn(() => unsub)
    );
    const { unmount } = renderHook(() =>
      useMarkdownPreviewGitModel({
        context,
        source: { kind: "disk", path: "docs/readme.md", root: "/repo" },
      })
    );
    await waitFor(() => {
      expect(context.git.watch).toHaveBeenCalled();
    });
    unmount();
    expect(unsub).toHaveBeenCalled();
  });

  it("still loads when watch throws", async () => {
    const context = makeContext(addedPatch(), () => {
      throw new Error("watch unavailable");
    });
    const { result } = renderHook(() =>
      useMarkdownPreviewGitModel({
        context,
        source: { kind: "disk", path: "docs/readme.md", root: "/repo" },
      })
    );
    await waitFor(() => {
      expect(result.current.markers.get(2)).toEqual({
        count: 1,
        kind: "added",
      });
    });
  });

  it("refetches after git.watch", async () => {
    let listener: () => void = () => undefined;
    const context = makeContext(addedPatch(), (_root, next) => {
      listener = next;
      return () => undefined;
    });
    renderHook(() =>
      useMarkdownPreviewGitModel({
        context,
        source: { kind: "disk", path: "docs/readme.md", root: "/repo" },
      })
    );
    await waitFor(() => {
      expect(context.git.getDiffPatch).toHaveBeenCalledTimes(1);
    });
    listener();
    await waitFor(
      () => {
        expect(context.git.getDiffPatch).toHaveBeenCalledTimes(2);
      },
      { timeout: 1000 }
    );
  });
});

describe("MarkdownPreviewGitBars", () => {
  it("renders a left bar and opens Changes on the clicked line", async () => {
    const context = makeContext(addedPatch());
    const scrollRoot = document.createElement("div");
    scrollRoot.dataset.slot = "markdown-preview";
    const page = document.createElement("section");
    page.dataset.slot = "markdown-page";
    page.dataset.markdownPageRendered = "true";
    const paragraph = document.createElement("p");
    paragraph.dataset.sourceLine = "1";
    paragraph.dataset.sourceEndLine = "4";
    page.append(paragraph);
    scrollRoot.append(page);
    document.body.append(scrollRoot);
    paragraph.getBoundingClientRect = () => stubRect(40, 40);
    scrollRoot.getBoundingClientRect = () => stubRect(0, 400);

    render(
      <MarkdownPreviewGitBars
        context={context}
        panelContext={{
          contextId: "ctx",
          gitRoot: "/repo",
          projectRootPath: "/repo",
          updatedAt: 0,
          worktreeRoot: "/repo",
        }}
        ready
        scrollRoot={scrollRoot}
        source={{ kind: "disk", path: "docs/readme.md", root: "/repo" }}
      />
    );

    const mark = await screen.findByRole("button", {
      name: "Review added change at line 2",
    });
    expect(mark).toHaveAttribute("tabindex", "-1");
    const track = mark.closest("nav");
    expect(track).toHaveAttribute("data-slot", "markdown-preview-git-bars");
    expect(track).toHaveStyle({ height: "0px" });
    fireEvent.click(mark, { clientY: 55 });
    expect(context.git.openUncommittedChanges).toHaveBeenCalledWith({
      panelContext: expect.objectContaining({ gitRoot: "/repo" }),
      pendingReveal: {
        allowGroupFallback: true,
        line: 2,
        path: "docs/readme.md",
        side: "new",
      },
    });
    scrollRoot.remove();
  });
});
