import { beforeEach, describe, expect, it, vi } from "vitest";

const revealAfterAncestors = vi.hoisted(() => vi.fn());

vi.mock(
  "../../../../../src/plugins/builtin/files/renderer/tree/reveal.ts",
  () => ({
    revealFilesTreePathAfterAncestors: revealAfterAncestors,
  })
);

vi.mock(
  "../../../../../src/plugins/builtin/files/renderer/tree/visibility.ts",
  () => ({
    filesTreeVisibilityForContext: () => ({
      list: { list: vi.fn() },
    }),
  })
);

import { revealDiskBreadcrumbInTree } from "../../../../../src/plugins/builtin/files/renderer/panel/breadcrumb-reveal.ts";

describe("revealDiskBreadcrumbInTree", () => {
  beforeEach(() => {
    revealAfterAncestors.mockClear();
  });

  it("reveals without a fixed delay when the sidebar is already open", () => {
    const setTreeCollapsed = vi.fn();
    revealDiskBreadcrumbInTree({
      context: {} as never,
      index: 1,
      instanceId: "panel-1",
      path: "src/preload/ai-api.ts",
      projectName: "pier",
      root: "/tmp/proj",
      setTreeCollapsed,
      source: {
        kind: "disk",
        path: "src/preload/ai-api.ts",
        root: "/tmp/proj",
      },
      treeCollapsed: false,
    });

    expect(setTreeCollapsed).not.toHaveBeenCalled();
    expect(revealAfterAncestors).toHaveBeenCalledOnce();
    expect(revealAfterAncestors).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: "panel-1",
        options: { expandTarget: true, scroll: "center" },
        root: "/tmp/proj",
      })
    );
  });

  it("expands a collapsed sidebar then reveals without waiting a fixed 80ms", () => {
    const setTreeCollapsed = vi.fn();
    revealDiskBreadcrumbInTree({
      context: {} as never,
      index: 0,
      instanceId: "panel-1",
      path: "src/app.tsx",
      projectName: "pier",
      root: "/tmp/proj",
      setTreeCollapsed,
      source: { kind: "disk", path: "src/app.tsx", root: "/tmp/proj" },
      treeCollapsed: true,
    });

    expect(setTreeCollapsed).toHaveBeenCalledWith(false);
    // Immediate call: readiness wait lives inside revealAfterAncestors.
    expect(revealAfterAncestors).toHaveBeenCalledOnce();
  });
});
