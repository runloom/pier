import type {
  ReviewFailedResource,
  ReviewFailureChange,
} from "@plugins/builtin/git/renderer/git-review-document-generation.ts";
import {
  GitReviewFailureAccumulator,
  useReviewFailureSummary,
} from "@plugins/builtin/git/renderer/git-review-failure-state.ts";
import type { GitReviewIndexEntry } from "@shared/contracts/git-review.ts";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

function entry(index: number, sectionCount = 1): GitReviewIndexEntry {
  const path = `src/file-${index}.ts`;
  return {
    entryKey: `entry:${index}`,
    oldPaths: [],
    path,
    renderSlots: Array.from({ length: sectionCount }, (_, sectionIndex) => ({
      group: sectionIndex === 0 ? "unstaged" : "staged",
      oldPath: null,
      sectionKey: `section:${index}:${sectionIndex}`,
      status: "modified",
      targetPath: path,
    })),
    status: "modified",
  };
}

function failure(
  item: GitReviewIndexEntry,
  message = item.path,
  retryable = true
): ReviewFailedResource {
  return {
    entry: item,
    failure: {
      kind: "error",
      message,
      reason: "internal",
      retryable,
    },
    kind: "error",
  };
}

function change(
  resource: ReviewFailedResource | null,
  entryKey: string,
  source: ReviewFailureChange["source"] = "document"
): ReviewFailureChange {
  return { entryKey, resource, source };
}

describe("Git Review failure state", () => {
  it("最多显示五项，并把当前选择的第七项提升到可见失败区", () => {
    const accumulator = new GitReviewFailureAccumulator();
    const resources = Array.from({ length: 7 }, (_, index) =>
      failure(entry(index))
    );
    accumulator.reset(
      resources.map((resource) => change(resource, resource.entry.entryKey))
    );

    const initial = accumulator.summary(null);
    expect(initial.visibleFailures.map((item) => item.entry.entryKey)).toEqual([
      "entry:0",
      "entry:1",
      "entry:2",
      "entry:3",
      "entry:4",
    ]);
    expect(initial.hasHiddenFailures).toBe(true);

    const selected = accumulator.summary("entry:6");
    expect(selected.visibleFailures).toHaveLength(5);
    expect(
      selected.visibleFailures.map((item) => item.entry.entryKey)
    ).toContain("entry:6");
    expect(
      selected.visibleFailures.find((item) => item.entry.entryKey === "entry:6")
        ?.failure.retryable
    ).toBe(true);
  });

  it("同 entry 多 section 去重，并按 document、refresh、render 优先级逐层回退", () => {
    const accumulator = new GitReviewFailureAccumulator();
    const item = entry(0, 2);
    const documentFailure = failure(item, "document");
    const refreshFailure = failure(item, "refresh");
    accumulator.reset([
      change(documentFailure, item.entryKey),
      change(refreshFailure, item.entryKey, "refresh"),
    ]);
    accumulator.updateRenderError(
      "section:0:0",
      new Error("render zero"),
      item
    );
    accumulator.updateRenderError("section:0:1", new Error("render one"), item);
    expect(accumulator.summary(null).visibleFailures).toEqual([
      documentFailure,
    ]);

    accumulator.applyGenerationChanges([change(null, item.entryKey)]);
    expect(accumulator.summary(null).visibleFailures).toEqual([refreshFailure]);
    accumulator.applyGenerationChanges([
      change(null, item.entryKey, "refresh"),
    ]);
    expect(accumulator.summary(null).visibleFailures[0]?.failure.message).toBe(
      "render zero"
    );

    accumulator.updateRenderError("section:0:0", null, undefined);
    expect(accumulator.summary(null).visibleFailures[0]?.failure.message).toBe(
      "render one"
    );
    accumulator.updateRenderError("section:0:1", null, undefined);
    expect(accumulator.summary(null)).toEqual({
      hasHiddenFailures: false,
      visibleFailures: [],
    });
  });

  it("2,001 个同轮渲染错误只发布一次，且旧 generation 回调被丢弃", async () => {
    const entries = Array.from({ length: 2001 }, (_, index) => entry(index));
    const entryKeyBySectionId = new Map(
      entries.map((item) => [
        item.renderSlots[0]?.sectionKey ?? "",
        item.entryKey,
      ])
    );
    const entryKeyBySectionIdRef = { current: entryKeyBySectionId };
    let renders = 0;
    const hook = renderHook(() => {
      renders += 1;
      return useReviewFailureSummary({
        entries,
        entryKeyBySectionIdRef,
        selectedEntryKey: null,
      });
    });
    act(() => {
      hook.result.current.resetGenerationFailures(1, []);
    });
    await act(async () => Promise.resolve());
    const rendersBeforeErrors = renders;

    act(() => {
      for (const item of entries) {
        const sectionId = item.renderSlots[0]?.sectionKey;
        if (sectionId) {
          hook.result.current.updateRenderItemError(
            1,
            sectionId,
            new Error(sectionId)
          );
        }
      }
    });
    await act(async () => Promise.resolve());

    expect(renders - rendersBeforeErrors).toBe(1);
    expect(hook.result.current.summary.visibleFailures).toHaveLength(5);
    expect(hook.result.current.summary.hasHiddenFailures).toBe(true);

    act(() => {
      hook.result.current.resetGenerationFailures(2, []);
      hook.result.current.updateRenderItemError(
        1,
        "section:0:0",
        new Error("late")
      );
    });
    await act(async () => Promise.resolve());
    expect(hook.result.current.summary.visibleFailures).toHaveLength(0);

    const updateAfterUnmount = hook.result.current.updateRenderItemError;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    hook.unmount();
    updateAfterUnmount(2, "section:0:0", new Error("after unmount"));
    await Promise.resolve();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
