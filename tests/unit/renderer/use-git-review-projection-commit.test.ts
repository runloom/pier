import type { PierDiffViewHandle } from "@pier/ui/diff-view.tsx";
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { reviewDocumentDemandForRenderWindow } from "../../../src/plugins/builtin/git/renderer/git-review-document-demand.ts";
import { useGitReviewProjectionCommit } from "../../../src/plugins/builtin/git/renderer/use-git-review-projection-commit.ts";

it("未暂存投影只合并所属 section 映射，视口可按真实 section demand", () => {
  const entry = {
    entryKey: "entry:40",
    oldPaths: [],
    path: "src/unstaged.ts",
    renderSlots: [
      {
        group: "unstaged" as const,
        oldPath: null,
        sectionKey: "unstaged:40",
        status: "modified" as const,
        targetPath: "src/unstaged.ts",
      },
    ],
    status: "modified" as const,
  };
  const entryKeyBySectionIdRef = {
    current: new Map<string, string>(),
  };
  const firstSectionIdByEntryKeyRef = {
    current: new Map<string, string>(),
  };
  renderHook(() =>
    useGitReviewProjectionCommit({
      active: false,
      committedProjectionGenerationRef: { current: 0 },
      diffBase: "index",
      diffHandleRef: { current: null as PierDiffViewHandle | null },
      documentGenerationRef: { current: 1 },
      entries: [entry],
      entryKeyBySectionIdRef,
      firstSectionIdByEntryKeyRef,
      itemCacheKeysRef: { current: new Map() },
      itemIdsRef: { current: [] },
      itemIndexByIdRef: { current: new Map() },
      latestItemUpdatesRef: { current: new Map() },
      projection: {
        entryKeyBySectionId: new Map(),
        items: [],
        revisionBySectionId: new Map(),
        sourceIndexGeneration: 1,
      },
      projectionGeneration: 1,
      renderedGenerationRef: { current: 0 },
      replayLatestItemUpdates: vi.fn(() => true),
      resumeSelectedNavigation: vi.fn(),
      tryPendingNavigation: vi.fn(),
    })
  );

  expect(entryKeyBySectionIdRef.current).toEqual(
    new Map([["unstaged:40", "entry:40"]])
  );
  expect(firstSectionIdByEntryKeyRef.current).toEqual(
    new Map([["entry:40", "unstaged:40"]])
  );
  expect(
    reviewDocumentDemandForRenderWindow(
      entryKeyBySectionIdRef.current,
      new Set(["entry:40"]),
      {
        bufferedItemIds: [],
        visibleItemIds: ["unstaged:40"],
      }
    )
  ).toEqual({
    bufferedEntryKeys: [],
    visibleEntryKeys: ["entry:40"],
  });
});
