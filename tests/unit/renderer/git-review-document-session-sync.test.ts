import type { PierDiffViewItem } from "@pier/ui/diff-view.tsx";
import { areReviewProjectionItemsEqual } from "@plugins/builtin/git/renderer/git-review-document-session-sync.ts";
import { expect, it } from "vitest";

const changeKey = `sha256:${"a".repeat(64)}`;

function item(): PierDiffViewItem {
  return {
    cacheKey: "document:a",
    changeControls: [
      {
        canRevert: true,
        changeBlockIndex: 0,
        changeKey,
        hunkIndex: 0,
        state: "unstaged",
      },
    ],
    fileDisplay: {
      path: "src/a.ts",
      status: "modified",
    },
    id: "section:a",
    kind: "loaded",
    patch: "diff --git a/src/a.ts b/src/a.ts\n",
    stageControl: {
      canDiscard: true,
      state: "unstaged",
    },
  };
}

it("权威刷新产生的新对象在语义不变时不触发正文更新", () => {
  const previous = item();
  const clonedControls = item().changeControls?.map((control) => ({
    ...control,
  }));
  const next = {
    ...item(),
    ...(clonedControls === undefined ? {} : { changeControls: clonedControls }),
    fileDisplay: {
      ...(item().fileDisplay as NonNullable<PierDiffViewItem["fileDisplay"]>),
    },
    stageControl: {
      ...(item().stageControl as NonNullable<PierDiffViewItem["stageControl"]>),
    },
  };

  expect(areReviewProjectionItemsEqual(previous, next)).toBe(true);
});

it("暂存能力变化仍触发目标 item 的实时控制态更新", () => {
  const previous = item();
  const next: PierDiffViewItem = {
    ...item(),
    changeControls: [
      {
        canRevert: false,
        changeBlockIndex: 0,
        changeKey,
        hunkIndex: 0,
        state: "staged",
      },
    ],
    stageControl: { state: "staged" },
  };

  expect(areReviewProjectionItemsEqual(previous, next)).toBe(false);
});
