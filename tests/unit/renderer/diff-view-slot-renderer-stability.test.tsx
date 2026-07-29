import type { PierDiffViewItem } from "@pier/ui/diff-view.tsx";
import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import { act, render, renderHook, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { PierHunkAnnotationMetadata } from "../../../packages/ui/src/diff-view-hunk-actions.tsx";
import { createDiffViewInputStore } from "../../../packages/ui/src/diff-view-input-store.ts";
import {
  type ParsedItemCacheEntry,
  type PierDiffCodeViewItem,
  toCodeViewItems,
} from "../../../packages/ui/src/diff-view-items.ts";
import { useDiffViewCodeOptions } from "../../../packages/ui/src/use-diff-view-code-options.ts";
import type {
  DiffViewCollapsedItemState,
  DiffViewRenderItemIdentity,
} from "../../../packages/ui/src/use-diff-view-handle.ts";
import { useDiffViewHeaders } from "../../../packages/ui/src/use-diff-view-headers.tsx";

const labels = {
  collapseDiff: "Collapse diff",
  discardChanges: "Discard changes",
  expandDiff: "Expand diff",
  revertHunk: "Revert",
  stageChanges: "Stage",
  stageHunk: "Stage hunk",
  unstageChanges: "Unstage",
  unstageHunk: "Unstage hunk",
} as const;

const changeKey = `sha256:${"a".repeat(64)}`;
const baseItem: PierDiffViewItem = {
  cacheKey: "revision:a",
  changeControls: [
    {
      canRevert: true,
      changeBlockIndex: 0,
      changeKey,
      hunkIndex: 0,
      state: "unstaged",
    },
  ],
  id: "section:a",
  patch:
    "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
  stageControl: { canDiscard: true, state: "unstaged" },
};

function busyItem(): PierDiffViewItem {
  return {
    ...baseItem,
    changeControls: (baseItem.changeControls ?? []).map((control) => ({
      ...control,
      busy: true,
      pendingAction: "stage",
    })),
    stageControl: {
      busy: true,
      canDiscard: true,
      pendingAction: "stage",
      state: "unstaged",
    },
  };
}

it("局部 busy 变化不更换 hunk annotation renderer，并读取最新控制态", () => {
  const inputStore = createDiffViewInputStore([baseItem]);
  const props = {
    appearance: {
      codeFontFamily: "monospace",
      codeFontSize: "13px",
      codeTheme: "github-dark",
      colorMode: "dark" as const,
    },
    codeViewRef: { current: null },
    diffStyle: "split" as const,
    fileHoverCleanupsRef: { current: new Map<string, () => void>() },
    fileHoverHostsRef: { current: new Map<string, HTMLElement>() },
    inputStore,
    labels,
    markRendered: vi.fn(),
    metrics: { diffHeaderHeight: 32, lineHeight: 23 },
    onHunkAction: vi.fn(),
    overflow: "scroll" as const,
    scheduleRenderWindowReport: vi.fn(),
  };
  const hook = renderHook(() => useDiffViewCodeOptions(props));
  const renderer = hook.result.current.renderAnnotation;
  const metadata: PierHunkAnnotationMetadata = {
    changeBlockIndex: 0,
    changeKey,
    hunkIndex: 0,
    kind: "hunk-actions",
    path: "src/a.ts",
    stageState: "unstaged",
  };
  const rendered = hook.result.current.renderAnnotation(
    { metadata },
    { id: baseItem.id }
  );
  render(<TooltipProvider>{rendered}</TooltipProvider>);
  expect(screen.getByTestId("pier-hunk-stage")).toBeEnabled();
  expect(screen.getByTestId("pier-hunk-revert")).toBeEnabled();

  act(() => inputStore.update([busyItem()]));

  expect(hook.result.current.renderAnnotation).toBe(renderer);
  expect(screen.getByTestId("pier-hunk-stage")).toBeDisabled();
  expect(screen.getByTestId("pier-hunk-stage")).toHaveAttribute(
    "aria-busy",
    "true"
  );
  const hunkSpinner = screen
    .getByTestId("pier-hunk-stage")
    .querySelector('[data-slot="spinner"]');
  expect(hunkSpinner).toBeInTheDocument();
  expect(hunkSpinner).toHaveClass("size-3.5");
  expect(hunkSpinner).toHaveAttribute("aria-hidden", "true");
  expect(hunkSpinner).not.toHaveAttribute("role");
  expect(screen.getByTestId("pier-hunk-revert")).not.toHaveAttribute(
    "aria-busy"
  );
  expect(
    screen
      .getByTestId("pier-hunk-revert")
      .querySelector('[data-slot="spinner"]')
  ).toBeNull();
});

it("正文 annotation 不变时仍以实时 change capability 收起 Revert", () => {
  const inputStore = createDiffViewInputStore([baseItem]);
  const hook = renderHook(() =>
    useDiffViewCodeOptions({
      appearance: {
        codeFontFamily: "monospace",
        codeFontSize: "13px",
        codeTheme: "github-dark",
        colorMode: "dark",
      },
      codeViewRef: { current: null },
      diffStyle: "split",
      fileHoverCleanupsRef: { current: new Map<string, () => void>() },
      fileHoverHostsRef: { current: new Map<string, HTMLElement>() },
      inputStore,
      labels,
      markRendered: vi.fn(),
      metrics: { diffHeaderHeight: 32, lineHeight: 23 },
      onHunkAction: vi.fn(),
      overflow: "scroll",
      scheduleRenderWindowReport: vi.fn(),
    })
  );
  const metadata: PierHunkAnnotationMetadata = {
    canRevert: true,
    changeBlockIndex: 0,
    changeKey,
    hunkIndex: 0,
    kind: "hunk-actions",
    path: "src/a.ts",
    stageState: "unstaged",
  };
  render(
    <TooltipProvider>
      {hook.result.current.renderAnnotation({ metadata }, { id: baseItem.id })}
    </TooltipProvider>
  );
  expect(screen.getByTestId("pier-hunk-revert")).toBeInTheDocument();

  act(() =>
    inputStore.update([
      {
        ...baseItem,
        changeControls: [
          {
            canRevert: false,
            changeBlockIndex: 0,
            changeKey,
            hunkIndex: 0,
            state: "staged",
          },
        ],
      },
    ])
  );

  expect(screen.queryByTestId("pier-hunk-revert")).not.toBeInTheDocument();
  expect(screen.getByTestId("pier-hunk-unstage")).toBeEnabled();
});

it("change 控制态只通知目标 changeKey，不唤醒同文件其他 hunk 或文件订阅", () => {
  const secondKey = `sha256:${"b".repeat(64)}`;
  const inputStore = createDiffViewInputStore([
    {
      ...baseItem,
      changeControls: [
        ...(baseItem.changeControls ?? []),
        {
          canRevert: true,
          changeBlockIndex: 1,
          changeKey: secondKey,
          hunkIndex: 0,
          state: "unstaged",
        },
      ],
    },
  ]);
  const fileListener = vi.fn();
  const firstListener = vi.fn();
  const secondListener = vi.fn();
  const unsubscribeFile = inputStore.subscribe(baseItem.id, fileListener);
  const unsubscribeFirst = inputStore.subscribeChange(
    baseItem.id,
    changeKey,
    firstListener
  );
  const unsubscribeSecond = inputStore.subscribeChange(
    baseItem.id,
    secondKey,
    secondListener
  );

  inputStore.update([
    {
      ...baseItem,
      changeControls: [
        {
          ...(baseItem.changeControls?.[0] as NonNullable<
            PierDiffViewItem["changeControls"]
          >[number]),
          busy: true,
        },
        {
          canRevert: true,
          changeBlockIndex: 1,
          changeKey: secondKey,
          hunkIndex: 0,
          state: "unstaged",
        },
      ],
    },
  ]);

  expect(firstListener).toHaveBeenCalledOnce();
  expect(secondListener).not.toHaveBeenCalled();
  expect(fileListener).not.toHaveBeenCalled();
  unsubscribeFile();
  unsubscribeFirst();
  unsubscribeSecond();
});

it("大文件控制态对账按 changeKey 线性建索引，不执行逐项 find", () => {
  const controls = Array.from({ length: 5000 }, (_, index) => ({
    busy: false,
    canRevert: true,
    changeBlockIndex: index,
    changeKey: `sha256:${index.toString(16).padStart(64, "0")}`,
    hunkIndex: index,
    state: "unstaged" as const,
  }));
  const previousFind = vi.spyOn(controls, "find");
  const nextControls = controls.map((control) => ({
    ...control,
    busy: true,
  }));
  const nextFind = vi.spyOn(nextControls, "find");
  const inputStore = createDiffViewInputStore([
    { ...baseItem, changeControls: controls },
  ]);

  inputStore.update([{ ...baseItem, changeControls: nextControls }]);

  expect(previousFind).not.toHaveBeenCalled();
  expect(nextFind).not.toHaveBeenCalled();
});

it("局部 busy 变化不更换 header renderer，并读取最新控制态", () => {
  const inputStore = createDiffViewInputStore([baseItem]);
  const codeViewItem = toCodeViewItems([baseItem], new Map()).items[0] as
    | PierDiffCodeViewItem
    | undefined;
  expect(codeViewItem).toBeDefined();
  const stable = {
    appliedItemsRef: {
      current: null as {
        readonly items: Map<string, PierDiffCodeViewItem>;
        readonly key: string;
      } | null,
    },
    auditVisibleItems: vi.fn(),
    bumpItemEpoch: vi.fn(),
    codeViewItems: [codeViewItem as PierDiffCodeViewItem],
    codeViewRef: { current: null },
    collapsedItemsRef: {
      current: new Map<string, DiffViewCollapsedItemState>(),
    },
    expectItemRender: vi.fn(),
    inputStore,
    labels,
    onDiscardFile: vi.fn(),
    onOpenFile: vi.fn(),
    onScroll: vi.fn(),
    onToggleStage: vi.fn(),
    parsedItemIndexesRef: { current: new Map<string, number>() },
    parsedItemListRef: { current: [] as PierDiffCodeViewItem[] },
    parsedItemsRef: { current: new Map<string, ParsedItemCacheEntry>() },
    renderItemIdentitiesRef: {
      current: new Map<string, DiffViewRenderItemIdentity>(),
    },
    scheduleRenderWindowReport: vi.fn(),
  };
  const hook = renderHook(() => useDiffViewHeaders(stable));
  const metadataRenderer = hook.result.current.renderHeaderMetadata;
  const prefixRenderer = hook.result.current.renderHeaderPrefix;
  const rendered = hook.result.current.renderHeaderMetadata(
    codeViewItem as PierDiffCodeViewItem
  );
  render(<TooltipProvider>{rendered}</TooltipProvider>);
  expect(screen.getByTestId("pier-diff-stage-button")).toBeEnabled();

  act(() => inputStore.update([busyItem()]));

  expect(hook.result.current.renderHeaderMetadata).toBe(metadataRenderer);
  expect(hook.result.current.renderHeaderPrefix).toBe(prefixRenderer);
  expect(screen.getByTestId("pier-diff-stage-button")).toBeDisabled();
  expect(screen.getByTestId("pier-diff-stage-button")).toHaveAttribute(
    "aria-busy",
    "true"
  );
  expect(
    screen
      .getByTestId("pier-diff-stage-button")
      .querySelector('[data-slot="spinner"]')
  ).toBeInTheDocument();
  expect(screen.getByTestId("pier-diff-discard-button")).toBeDisabled();
  expect(screen.getByTestId("pier-diff-discard-button")).not.toHaveAttribute(
    "aria-busy"
  );
  expect(
    screen
      .getByTestId("pier-diff-discard-button")
      .querySelector('[data-slot="spinner"]')
  ).toBeNull();
});
