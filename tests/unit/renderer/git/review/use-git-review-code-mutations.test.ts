import type { PierDiffViewItem } from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  GitReviewIndexEntry,
  GitReviewMutationResult,
} from "@shared/contracts/git/review.ts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useGitReviewCodeMutations } from "../../../../../src/plugins/builtin/git/renderer/hooks/use-code-mutations.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const entry: GitReviewIndexEntry = {
  entryKey: "entry:a",
  oldPaths: [],
  path: "src/a.ts",
  renderSlots: [
    {
      group: "unstaged",
      oldPath: null,
      sectionKey: "section:a",
      status: "modified",
      targetPath: "src/a.ts",
    },
  ],
  status: "modified",
};

const item: PierDiffViewItem = {
  cacheKey: "document:a",
  id: "section:a",
  patch: "diff --git a/src/a.ts b/src/a.ts\n",
  stageControl: { state: "unstaged" },
};

it("暂存 busy 持续到权威 index 刷新完成", async () => {
  const stageResult = deferred<GitReviewMutationResult>();
  const refreshResult = deferred<void>();
  const onMutationCommitted = vi.fn(() => refreshResult.promise);
  const context = {
    git: {
      applyReviewMutation: vi.fn(() => stageResult.promise),
    },
    i18n: { t: vi.fn((_key, _values, fallback) => fallback) },
  } as unknown as RendererPluginContext;
  const hook = renderHook(() =>
    useGitReviewCodeMutations({
      context,
      contextId: "context:a",
      entries: [entry],
      gitRootPath: "/workspace/pier",
      items: [item],
      onMutationCommitted,
      revisionBySectionId: new Map([[item.id, "revision:a"]]),
    })
  );
  const onToggleStage = hook.result.current.onToggleStage;

  act(() => hook.result.current.onToggleStage(item.id));
  expect(hook.result.current.onToggleStage).toBe(onToggleStage);
  expect(hook.result.current.displayItems[0]?.stageControl?.busy).toBe(true);
  expect(hook.result.current.displayItems[0]?.stageControl?.pendingAction).toBe(
    "stage"
  );

  await act(async () => {
    stageResult.resolve({
      kind: "ok",
      operationId: "operation:a",
    });
    await Promise.resolve();
  });
  expect(onMutationCommitted).toHaveBeenCalledOnce();
  expect(hook.result.current.displayItems[0]?.stageControl?.busy).toBe(true);

  await act(async () => {
    refreshResult.resolve();
    await refreshResult.promise;
  });
  await waitFor(() =>
    expect(hook.result.current.displayItems[0]?.stageControl?.busy).not.toBe(
      true
    )
  );
  expect(
    hook.result.current.displayItems[0]?.stageControl?.pendingAction
  ).toBeUndefined();
});

it("任一写请求开始即原子锁住同仓全部操作，避免第二个旧 revision 入队", () => {
  const write = deferred<GitReviewMutationResult>();
  const secondEntry: GitReviewIndexEntry = {
    ...entry,
    entryKey: "entry:b",
    path: "src/b.ts",
    renderSlots: [
      {
        group: "unstaged",
        oldPath: null,
        sectionKey: "section:b",
        status: "modified",
        targetPath: "src/b.ts",
      },
    ],
  };
  const secondItem: PierDiffViewItem = {
    ...item,
    id: "section:b",
  };
  let locked = false;
  const onMutationStart = vi.fn(() => {
    if (locked) {
      return null;
    }
    locked = true;
    return { minimumIndexGeneration: 7 };
  });
  const applyReviewMutation = vi.fn(() => write.promise);
  const context = {
    git: { applyReviewMutation },
    i18n: { t: vi.fn((_key, _values, fallback) => fallback) },
  } as unknown as RendererPluginContext;
  const hook = renderHook(
    ({ mutationBlocked }: { readonly mutationBlocked: boolean }) =>
      useGitReviewCodeMutations({
        context,
        contextId: "context:a",
        entries: [entry, secondEntry],
        gitRootPath: "/workspace/pier",
        items: [item, secondItem],
        mutationBlocked,
        onMutationStart,
        revisionBySectionId: new Map([
          [item.id, "revision:a"],
          [secondItem.id, "revision:b"],
        ]),
      }),
    { initialProps: { mutationBlocked: false } }
  );

  act(() => {
    hook.result.current.onToggleStage(item.id);
    hook.result.current.onToggleStage(secondItem.id);
  });
  expect(applyReviewMutation).toHaveBeenCalledOnce();
  expect(onMutationStart).toHaveBeenCalledTimes(2);

  hook.rerender({ mutationBlocked: true });
  expect(hook.result.current.displayItems[0]?.stageControl?.pendingAction).toBe(
    "stage"
  );
  expect(hook.result.current.displayItems[0]?.stageControl?.busy).toBe(true);
  expect(hook.result.current.displayItems[1]).toBe(secondItem);
});

it("变更块操作只向 main 传稳定 changeKey 和文档修订号", async () => {
  const applyReviewMutation = vi.fn(async () => ({
    kind: "ok" as const,
    operationId: "operation:change",
    stateSequence: 12,
  }));
  const onMutationCommitted = vi.fn(async () => undefined);
  const captureReadingAnchor = vi.fn((itemId: string) => ({
    id: itemId,
    offset: 96,
  }));
  const context = {
    git: { applyReviewMutation },
    i18n: { t: vi.fn((_key, _values, fallback) => fallback) },
  } as unknown as RendererPluginContext;
  const changeItem: PierDiffViewItem = {
    ...item,
    changeControls: [
      {
        changeBlockIndex: 8,
        changeKey: `sha256:${"a".repeat(64)}`,
        hunkIndex: 4,
        state: "unstaged",
        targetSectionKey: "section:head-semantic",
      },
    ],
  };
  const hook = renderHook(() =>
    useGitReviewCodeMutations({
      captureReadingAnchor,
      context,
      contextId: "context:a",
      entries: [entry],
      gitRootPath: "/workspace/pier",
      items: [changeItem],
      onMutationStart: () => ({ minimumIndexGeneration: 7 }),
      onMutationCommitted,
      revisionBySectionId: new Map([[changeItem.id, "revision:a"]]),
    })
  );
  const onHunkAction = hook.result.current.onHunkAction;

  act(() =>
    hook.result.current.onHunkAction({
      action: "stage",
      changeKey: `sha256:${"a".repeat(64)}`,
      itemId: changeItem.id,
      path: entry.path,
      scope: "hunk",
    })
  );

  await waitFor(() => expect(applyReviewMutation).toHaveBeenCalledOnce());
  expect(hook.result.current.onHunkAction).toBe(onHunkAction);
  expect(captureReadingAnchor).toHaveBeenCalledWith(changeItem.id);
  expect(applyReviewMutation).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "stage",
      expectedRevision: "revision:a",
      source: expect.objectContaining({ path: entry.path }),
      target: {
        changeKey: `sha256:${"a".repeat(64)}`,
        kind: "change",
        sectionKey: "section:head-semantic",
      },
    })
  );
  expect(onMutationCommitted).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "ok" }),
    {
      anchorOffset: 96,
      entryKey: "entry:a",
      minimumIndexGeneration: 12,
      path: "src/a.ts",
      sourceItemId: changeItem.id,
      targetSurface: "staged",
    }
  );
});

it("文件暂存结构化失败会先刷新，再用 alert 展示友好说明和技术详情", async () => {
  const alert = vi.fn(async () => undefined);
  const onMutationCommitted = vi.fn(async () => undefined);
  const context = {
    dialogs: { alert },
    git: {
      applyReviewMutation: vi.fn(async () => ({
        kind: "error" as const,
        message: "fatal: index.lock already exists",
        reason: "commandFailed" as const,
        retryable: true,
      })),
    },
    i18n: { t: vi.fn((_key, _values, fallback) => fallback) },
  } as unknown as RendererPluginContext;
  const hook = renderHook(() =>
    useGitReviewCodeMutations({
      context,
      contextId: "context:a",
      entries: [entry],
      gitRootPath: "/workspace/pier",
      items: [item],
      onMutationCommitted,
      revisionBySectionId: new Map([[item.id, "revision:a"]]),
    })
  );

  act(() => hook.result.current.onToggleStage(item.id));

  await waitFor(() => expect(alert).toHaveBeenCalledOnce());
  expect(onMutationCommitted).toHaveBeenCalledWith(null);
  expect(alert).toHaveBeenCalledWith({
    body: expect.stringContaining("fatal: index.lock already exists"),
    title: "Unable to Stage",
  });
});

it("投影展示 id 通过 stageControl 指向真实 Git sectionKey", async () => {
  const applyReviewMutation = vi.fn(async () => ({
    kind: "ok" as const,
    operationId: "operation:head",
  }));
  const projectedItem: PierDiffViewItem = {
    ...item,
    fileDisplay: { path: entry.path, status: "modified" },
    id: "projected:entry:a",
    stageControl: {
      state: "unstaged",
      targetSectionKey: "section:a",
    },
  };
  const context = {
    git: { applyReviewMutation },
    i18n: { t: vi.fn((_key, _values, fallback) => fallback) },
  } as unknown as RendererPluginContext;
  const hook = renderHook(() =>
    useGitReviewCodeMutations({
      context,
      contextId: "context:a",
      entries: [entry],
      gitRootPath: "/workspace/pier",
      items: [projectedItem],
      revisionBySectionId: new Map([[projectedItem.id, "revision:a"]]),
    })
  );

  act(() => hook.result.current.onToggleStage(projectedItem.id));

  await waitFor(() => expect(applyReviewMutation).toHaveBeenCalledOnce());
  expect(applyReviewMutation).toHaveBeenCalledWith(
    expect.objectContaining({
      target: { kind: "file", sectionKey: "section:a" },
    })
  );
});

it("变更块结构化失败立即展示技术详情，并保持 busy 到权威刷新完成", async () => {
  const authority = deferred<void>();
  const alert = vi.fn(async () => undefined);
  const onMutationCommitted = vi.fn(() => authority.promise);
  const changeItem: PierDiffViewItem = {
    ...item,
    changeControls: [
      {
        canRevert: true,
        changeBlockIndex: 0,
        changeKey: `sha256:${"c".repeat(64)}`,
        hunkIndex: 0,
        state: "unstaged",
      },
    ],
  };
  const context = {
    dialogs: { alert },
    git: {
      applyReviewMutation: vi.fn(async () => ({
        kind: "error" as const,
        message: "fatal: patch does not apply",
        reason: "commandFailed" as const,
        retryable: true,
      })),
    },
    i18n: { t: vi.fn((_key, _values, fallback) => fallback) },
  } as unknown as RendererPluginContext;
  const hook = renderHook(() =>
    useGitReviewCodeMutations({
      context,
      contextId: "context:a",
      entries: [entry],
      gitRootPath: "/workspace/pier",
      items: [changeItem],
      onMutationCommitted,
      revisionBySectionId: new Map([[changeItem.id, "revision:a"]]),
    })
  );

  act(() =>
    hook.result.current.onHunkAction({
      action: "stage",
      changeKey: `sha256:${"c".repeat(64)}`,
      itemId: changeItem.id,
      path: entry.path,
      scope: "hunk",
    })
  );

  await waitFor(() => expect(alert).toHaveBeenCalledOnce());
  expect(onMutationCommitted).toHaveBeenCalledWith(null);
  expect(alert).toHaveBeenCalledWith({
    body: expect.stringContaining("fatal: patch does not apply"),
    title: "Unable to stage hunk",
  });
  expect(hook.result.current.displayItems[0]?.changeControls?.[0]?.busy).toBe(
    true
  );

  await act(async () => {
    authority.resolve();
    await authority.promise;
  });
  await waitFor(() =>
    expect(
      hook.result.current.displayItems[0]?.changeControls?.[0]?.busy
    ).not.toBe(true)
  );
});

it("文件暂存抛错会刷新权威索引并通过 alert 展示错误详情", async () => {
  const alert = vi.fn(async () => undefined);
  const onMutationCommitted = vi.fn(async () => undefined);
  const context = {
    dialogs: { alert },
    git: {
      applyReviewMutation: vi.fn(async () => {
        throw new Error("IPC channel closed");
      }),
    },
    i18n: { t: vi.fn((_key, _values, fallback) => fallback) },
  } as unknown as RendererPluginContext;
  const hook = renderHook(() =>
    useGitReviewCodeMutations({
      context,
      contextId: "context:a",
      entries: [entry],
      gitRootPath: "/workspace/pier",
      items: [item],
      onMutationCommitted,
      revisionBySectionId: new Map([[item.id, "revision:a"]]),
    })
  );

  act(() => hook.result.current.onToggleStage(item.id));

  await waitFor(() => expect(alert).toHaveBeenCalledOnce());
  expect(onMutationCommitted).toHaveBeenCalledWith(null);
  expect(alert).toHaveBeenCalledWith({
    body: "IPC channel closed",
    title: "Unable to Stage",
  });
});

it.each([
  {
    activeStatus: "modified" as const,
    aggregateStatus: "added" as const,
    expectedConfirmLabel: "Discard",
    expectedTitle: "Discard Changes",
  },
  {
    activeStatus: "added" as const,
    aggregateStatus: "deleted" as const,
    expectedConfirmLabel: "Move to Trash",
    expectedTitle: "Move to Trash",
  },
])("半暂存文件丢弃确认使用活动分组状态 $activeStatus", async ({
  activeStatus,
  aggregateStatus,
  expectedConfirmLabel,
  expectedTitle,
}) => {
  const sectionKey = `section:unstaged:${activeStatus}`;
  const halfStagedEntry: GitReviewIndexEntry = {
    entryKey: `entry:${activeStatus}`,
    oldPaths: [],
    path: `src/${activeStatus}.ts`,
    renderSlots: [
      {
        group: "staged",
        oldPath: null,
        sectionKey: `section:staged:${aggregateStatus}`,
        status: aggregateStatus,
        targetPath: `src/${activeStatus}.ts`,
      },
      {
        group: "unstaged",
        oldPath: null,
        sectionKey,
        status: activeStatus,
        targetPath: `src/${activeStatus}.ts`,
      },
    ],
    status: aggregateStatus,
  };
  const activeItem: PierDiffViewItem = {
    cacheKey: `document:${activeStatus}`,
    fileDisplay: {
      path: halfStagedEntry.path,
      status: activeStatus,
    },
    id: `projection:${activeStatus}`,
    patch: `diff --git a/src/${activeStatus}.ts b/src/${activeStatus}.ts\n`,
    stageControl: {
      canDiscard: true,
      state: "unstaged",
      targetSectionKey: sectionKey,
    },
  };
  const confirm = vi.fn(async () => false);
  const context = {
    dialogs: { confirm },
    i18n: { t: vi.fn((_key, _values, fallback) => fallback) },
  } as unknown as RendererPluginContext;
  const hook = renderHook(() =>
    useGitReviewCodeMutations({
      context,
      contextId: "context:a",
      entries: [halfStagedEntry],
      gitRootPath: "/workspace/pier",
      items: [activeItem],
      revisionBySectionId: new Map([[activeItem.id, "revision:a"]]),
    })
  );

  act(() => hook.result.current.onDiscardFile(activeItem.id));

  await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({
      confirmLabel: expectedConfirmLabel,
      title: expectedTitle,
    })
  );
});
