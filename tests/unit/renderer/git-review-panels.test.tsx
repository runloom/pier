import type {
  PierDiffViewAnchor,
  PierDiffViewHandle,
  PierDiffViewItem,
  PierDiffViewRenderWindow,
} from "@pier/ui/diff-view.tsx";
import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import type {
  RendererPluginAppearance,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { createGitChangesPanel } from "@plugins/builtin/git/renderer/git-changes-panel.tsx";
import { GitReviewDocumentGeneration } from "@plugins/builtin/git/renderer/git-review-document-generation.ts";
import {
  reconcileReviewDocumentSnapshot,
  resolveReviewAnchor,
} from "@plugins/builtin/git/renderer/git-review-document-projection.ts";
import {
  clearAllReviewSessionsForTests,
  readReviewSession,
} from "@plugins/builtin/git/renderer/git-review-session-cache.ts";
import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";
import type {
  GitReviewFileDocumentOk,
  GitReviewFileDocumentResult,
  GitReviewIndexEntry,
  GitReviewIndexOk,
  GitReviewIndexResult,
} from "@shared/contracts/git-review.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  act,
  cleanup,
  fireEvent,
  render as renderBase,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

function render(ui: ReactElement, options?: Parameters<typeof renderBase>[1]) {
  const wrapped = (
    <TooltipProvider delayDuration={0} disableHoverableContent>
      {ui}
    </TooltipProvider>
  );
  const view = renderBase(wrapped, options);
  const originalRerender = view.rerender;
  view.rerender = ((next: ReactNode) =>
    originalRerender(
      <TooltipProvider delayDuration={0} disableHoverableContent>
        {next}
      </TooltipProvider>
    )) as typeof view.rerender;
  return view;
}

import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const scrollToItem = vi.hoisted(() =>
  vi.fn<(id: string) => boolean>(() => true)
);
const captureTopAnchor = vi.hoisted(() =>
  vi.fn<() => PierDiffViewAnchor | null>(() => null)
);
const restoreAnchor = vi.hoisted(() => vi.fn(() => true));
const isItemVisible = vi.hoisted(() => vi.fn(() => true));
const diffViewRuntime = vi.hoisted(() => ({
  error: null as Error | null,
  bufferedItemIds: [] as string[],
  mounts: 0,
  onScroll: null as (() => void) | null,
  reportWindowOnScroll: true,
  unknownItemUpdates: [] as string[],
  unmounts: 0,
  visibleItemIds: [] as string[],
}));

vi.mock("@pier/ui/diff-view.tsx", () => ({
  PierDiffView: (props: {
    appearance: RendererPluginAppearance;
    items: readonly PierDiffViewItem[];
    onRenderWindowChange?: (window: PierDiffViewRenderWindow) => void;
    onScroll?: () => void;
    ref?: React.Ref<PierDiffViewHandle>;
  }) => {
    const [renderedItems, setRenderedItems] = useState(props.items);
    const renderedItemsRef = useRef(props.items);
    useLayoutEffect(() => {
      renderedItemsRef.current = props.items;
      setRenderedItems(props.items);
    }, [props.items]);
    useEffect(() => {
      diffViewRuntime.mounts += 1;
      return () => {
        diffViewRuntime.unmounts += 1;
      };
    }, []);
    if (diffViewRuntime.error) {
      throw diffViewRuntime.error;
    }
    useEffect(() => {
      const itemIds = new Set(renderedItems.map((item) => item.id));
      const retainedIds = diffViewRuntime.visibleItemIds.filter((id) =>
        itemIds.has(id)
      );
      const visibleItemIds =
        retainedIds.length > 0
          ? retainedIds
          : renderedItems.slice(0, 2).map((item) => item.id);
      diffViewRuntime.visibleItemIds = visibleItemIds;
      const bufferedItemIds =
        retainedIds.length > 0
          ? diffViewRuntime.bufferedItemIds.filter((id) => itemIds.has(id))
          : renderedItems.slice(2, 3).map((item) => item.id);
      diffViewRuntime.bufferedItemIds = bufferedItemIds;
      props.onRenderWindowChange?.({
        bufferedItemIds,
        visibleItemIds,
      });
    }, [props.onRenderWindowChange, renderedItems]);
    useImperativeHandle(
      props.ref,
      () => ({
        captureTopAnchor,
        getSelectedText: () => "",
        isItemVisible,
        restoreAnchor,
        scrollToItem(id) {
          const result = scrollToItem(id);
          diffViewRuntime.bufferedItemIds = [];
          diffViewRuntime.visibleItemIds = [id];
          if (diffViewRuntime.reportWindowOnScroll) {
            props.onRenderWindowChange?.({
              bufferedItemIds: [],
              visibleItemIds: [id],
            });
          }
          return result;
        },
        selectAll: () => false,
        setAllCollapsed: () => undefined,
        updateItems(items) {
          const currentIds = new Set(
            renderedItemsRef.current.map((item) => item.id)
          );
          diffViewRuntime.unknownItemUpdates.push(
            ...items
              .filter((item) => !currentIds.has(item.id))
              .map((item) => item.id)
          );
          // 增量合并：只替换传入 id，保留其余已渲染项（对齐生产 DiffView）。
          const updates = new Map(items.map((item) => [item.id, item]));
          const next = renderedItemsRef.current.map(
            (item) => updates.get(item.id) ?? item
          );
          renderedItemsRef.current = next;
          setRenderedItems(next);
          return true;
        },
      }),
      [props.onRenderWindowChange]
    );
    diffViewRuntime.onScroll = props.onScroll ?? null;
    return (
      <output
        data-cache-keys={renderedItems.map((item) => item.cacheKey).join("|")}
        data-file-paths={renderedItems
          .map((item) => item.fileDisplay?.path ?? "")
          .join(",")}
        data-file-statuses={renderedItems
          .map((item) => item.fileDisplay?.status ?? "")
          .join(",")}
        data-item-count={renderedItems.length}
        data-item-ids={renderedItems.map((item) => item.id).join(",")}
        data-previous-paths={renderedItems
          .map((item) => item.fileDisplay?.previousPath ?? "")
          .join(",")}
        data-testid="pierre-diff"
        data-theme={props.appearance.codeTheme}
      >
        {renderedItems
          .map((item) => item.stateNotice ?? item.patch ?? "")
          .join("\n")}
      </output>
    );
  },
}));

const ROOT = "/workspace/pier";
const panelContext = {
  contextId: "ctx-pier",
  gitRoot: ROOT,
  projectRootPath: ROOT,
  updatedAt: 1,
} satisfies PanelContext;
const scope = {
  contextId: panelContext.contextId,
  gitRootPath: ROOT,
  target: { kind: "uncommitted" },
} as const;

function entry(
  index: number,
  path = `src/file-${index}.ts`,
  renderSlots: GitReviewIndexEntry["renderSlots"] = [
    {
      group: "unstaged",
      oldPath: null,
      sectionKey: `section:${index}`,
      status: "modified",
      targetPath: path,
    },
  ]
): GitReviewIndexEntry {
  return {
    entryKey: `entry:${index}:${path}`,
    oldPaths: [],
    path,
    renderSlots,
    status: "modified",
  };
}

function indexResult(entries = [entry(0)]): GitReviewIndexOk {
  return { entries, kind: "ok", warnings: [] };
}

function documentResult(
  index: number,
  sections: GitReviewFileDocumentOk["sections"] = [
    {
      kind: "patch",
      patch: `diff --git a/src/file-${index}.ts b/src/file-${index}.ts\n@@ -1 +1 @@\n-old\n+new\n`,
      sectionKey: `section:${index}`,
    },
  ]
): GitReviewFileDocumentOk {
  return {
    kind: "ok",
    revision: `document:${index}`,
    sections,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitForRefreshWindow(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 140));
  });
}

function createPanelHarness(initialGroupId = "group-a") {
  const visibilityListeners = new Set<() => void>();
  const removeListeners = new Set<(panel: { id?: string }) => void>();
  let isVisible = true;
  const panelId = `panel-${initialGroupId}`;
  const api = {
    group: { id: initialGroupId },
    id: panelId,
    isActive: true,
    get isVisible() {
      return isVisible;
    },
    onDidActiveChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidGroupChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidVisibilityChange: vi.fn((listener: () => void) => {
      visibilityListeners.add(listener);
      return {
        dispose: () => {
          visibilityListeners.delete(listener);
        },
      };
    }),
    setVisible(next: boolean) {
      if (isVisible === next) {
        return;
      }
      isVisible = next;
      for (const listener of visibilityListeners) {
        listener();
      }
    },
  };
  const containerApi = {
    onDidRemovePanel: vi.fn((listener: (panel: { id?: string }) => void) => {
      removeListeners.add(listener);
      return {
        dispose: () => {
          removeListeners.delete(listener);
        },
      };
    }),
    removePanel() {
      for (const listener of [...removeListeners]) {
        listener({ id: panelId });
      }
    },
  };
  return { api, containerApi };
}

function panelProps(
  input:
    | ReturnType<typeof createPanelHarness>
    | ReturnType<typeof createPanelHarness>["api"]
): IDockviewPanelProps {
  const harness =
    "containerApi" in input
      ? input
      : {
          api: input,
          containerApi: {
            onDidRemovePanel: vi.fn(() => ({ dispose: vi.fn() })),
            removePanel: vi.fn(),
          },
        };
  return {
    api: harness.api,
    containerApi: harness.containerApi,
    params: { context: panelContext, source: scope },
  } as unknown as IDockviewPanelProps;
}

function pluginContext(input: {
  appearance?: RendererPluginAppearance;
  appearanceOnDidChange?: RendererPluginContext["appearance"]["onDidChange"];
  cancelReviewRequest?: RendererPluginContext["git"]["cancelReviewRequest"];
  getReviewFileDocument?: RendererPluginContext["git"]["getReviewFileDocument"];
  getReviewIndex?: RendererPluginContext["git"]["getReviewIndex"];
  translate?: RendererPluginContext["i18n"]["t"];
  watch?: RendererPluginContext["git"]["watch"];
}): RendererPluginContext {
  const appearance: RendererPluginAppearance = input.appearance ?? {
    codeTheme: "github-dark",
    density: "compact",
    language: "en",
    locale: "en",
    theme: "dark",
    typography: {
      baseFontSize: "16px",
      codeFontFamily: "Berkeley Mono",
      fontFamily: "Inter",
    },
  };
  return {
    appearance: {
      current: () => appearance,
      onDidChange: input.appearanceOnDidChange ?? (() => () => undefined),
    },
    ai: {
      generateText: vi.fn(async () => ({
        message: "not configured",
        reason: "not_configured" as const,
        status: "unavailable" as const,
      })),
      status: vi.fn(async () => ({
        agent: null,
        configured: false,
        label: "",
      })),
    },
    configuration: {
      get: vi.fn(() => undefined),
      onDidChange: vi.fn(() => () => undefined),
      reset: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    },
    contextMenu: {
      popup: vi.fn(async () => undefined),
      registerSelectionSelectAllProvider: () => () => undefined,
      registerSelectionTextProvider: () => () => undefined,
    },
    dialogs: {
      alert: vi.fn(async () => undefined),
      confirm: vi.fn(async () => false),
    },
    git: {
      cancelReviewRequest:
        input.cancelReviewRequest ?? vi.fn(async () => undefined),
      commit: vi.fn(async () => true),
      getDiffText: vi.fn(async () => ""),
      getLog: vi.fn(async () => []),
      getReviewFileDocument:
        input.getReviewFileDocument ?? vi.fn(async () => documentResult(0)),
      getReviewIndex: input.getReviewIndex ?? vi.fn(async () => indexResult()),
      getStatus: vi.fn(async () => ({
        branch: {
          ahead: 0,
          behind: 0,
          branch: "main",
          mergedIntoDefault: null,
          oid: "abc",
          upstream: null,
          upstreamGone: false,
        },
        counts: { conflict: 0, modified: 0, staged: 0, untracked: 0 },
        delta: null,
        files: [],
        remoteSync: null,
        repoState: { kind: "clean" as const },
        stashCount: 0,
      })),
      stage: vi.fn(async () => true),
      watch: input.watch ?? vi.fn(() => () => undefined),
    },
    i18n: {
      language: () => appearance.language,
      t:
        input.translate ??
        ((_key: string, values: unknown, fallback?: string) => {
          let text = fallback ?? "";
          if (values && typeof values === "object") {
            for (const [key, value] of Object.entries(values)) {
              text = text.replaceAll(`{{${key}}}`, String(value));
            }
          }
          return text;
        }),
    },
    notifications: { error: vi.fn(), success: vi.fn() },
    panels: { openInstance: vi.fn(() => ({ kind: "opened" })) },
  } as unknown as RendererPluginContext;
}

function fileTree(container: HTMLElement): ShadowRoot {
  const host = container.querySelector(
    'file-tree-container[data-slot="pier-file-tree"]'
  );
  expect(host?.shadowRoot).not.toBeNull();
  return host?.shadowRoot as ShadowRoot;
}

function findTreeItem(container: HTMLElement, name: string): Element {
  const item = [
    ...fileTree(container).querySelectorAll('[role="treeitem"]'),
  ].find((element) => element.textContent?.includes(name));
  expect(item).toBeDefined();
  return item as Element;
}

afterEach(() => {
  globalThis.localStorage.clear();
  vi.restoreAllMocks();
  diffViewRuntime.error = null;
  diffViewRuntime.bufferedItemIds = [];
  diffViewRuntime.mounts = 0;
  diffViewRuntime.onScroll = null;
  diffViewRuntime.reportWindowOnScroll = true;
  diffViewRuntime.unknownItemUpdates = [];
  diffViewRuntime.visibleItemIds = [];
  diffViewRuntime.unmounts = 0;
  captureTopAnchor.mockReset();
  captureTopAnchor.mockReturnValue(null);
  restoreAnchor.mockReset();
  restoreAnchor.mockReturnValue(true);
  isItemVisible.mockReset();
  isItemVisible.mockReturnValue(true);
  scrollToItem.mockReset();
  scrollToItem.mockReturnValue(true);
  cleanup();
  // cleanup unmount 会写 session；必须在其后清空。
  clearAllReviewSessionsForTests();
});

describe("Git review panel", () => {
  it("复用 Files 的 header、可折叠侧栏与树内搜索交互", async () => {
    const entries = [entry(0), entry(1)];
    const getReviewIndex = vi.fn(async () => indexResult(entries));
    const getReviewFileDocument = vi.fn(async (request) =>
      documentResult(request.source.path.endsWith("file-1.ts") ? 1 : 0)
    );
    const context = pluginContext({ getReviewFileDocument, getReviewIndex });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() => expect(view.getByTestId("pierre-diff")).toBeVisible());
    const header = view.container.querySelector(
      '[data-slot="file-panel-header"]'
    );
    expect(header).toBeInstanceOf(HTMLElement);
    expect(header).toHaveClass("h-10", "border-b", "px-2");
    // header 左侧是 scope 切换器(不再展示路径面包屑)。
    const scopeSwitcher = within(header as HTMLElement).getByTestId(
      "git-review-scope-switcher"
    );
    expect(scopeSwitcher).toBeVisible();
    expect(within(scopeSwitcher).getByText("Uncommitted")).toBeVisible();
    expect(
      within(header as HTMLElement).queryByRole("navigation", {
        name: "Review location",
      })
    ).toBeNull();
    expect(
      view.getByRole("button", { name: "Collapse changed files" })
    ).toHaveAttribute("aria-expanded", "true");
    const treeHost = view.container.querySelector(
      'file-tree-container[data-slot="pier-file-tree"]'
    );
    expect(treeHost).toBeInstanceOf(HTMLElement);
    expect(
      (treeHost as HTMLElement).style.getPropertyValue(
        "--trees-padding-inline-override"
      )
    ).toBe("4px");
    const initialDiffMounts = diffViewRuntime.mounts;
    const initialDiffUnmounts = diffViewRuntime.unmounts;

    fireEvent.click(
      view.getByRole("button", { name: "Collapse changed files" })
    );
    expect(
      globalThis.localStorage.getItem(`pier.git.review.treeCollapsed:${ROOT}`)
    ).toBe("true");
    expect(
      view.container.querySelector(
        'file-tree-container[data-slot="pier-file-tree"]'
      )
    ).toBeNull();
    expect(view.getByTestId("pierre-diff")).toBeVisible();
    expect(diffViewRuntime.mounts).toBe(initialDiffMounts);
    expect(diffViewRuntime.unmounts).toBe(initialDiffUnmounts);

    fireEvent.click(
      view.getByRole("button", { name: "Find in changed files" })
    );
    const searchInput = await view.findByRole("textbox", {
      name: "Find in changed files",
    });
    expect(searchInput).toHaveFocus();
    expect(
      view.getByRole("button", { name: "Collapse changed files" })
    ).toHaveAttribute("aria-expanded", "true");

    fireEvent.change(searchInput, { target: { value: "file-1" } });
    await waitFor(() => {
      expect(
        within(view.getByTestId("git-review-tree-search-bar")).getByText("1")
      ).toBeVisible();
      expect(
        within(view.getByTestId("git-review-tree-search-bar")).getByRole(
          "status"
        )
      ).toHaveTextContent("Matching changes: 1");
    });
    fireEvent.keyDown(searchInput, { key: "Enter" });
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledWith("section:1"));

    fireEvent.change(searchInput, { target: { value: "not-present" } });
    await expect(
      view.findByTestId("git-review-tree-search-empty")
    ).resolves.toBeVisible();
    fireEvent.keyDown(searchInput, { key: "Escape" });
    await waitFor(() => {
      expect(view.queryByTestId("git-review-tree-search-bar")).toBeNull();
      expect(fileTree(view.container).textContent).toContain("file-0.ts");
      expect(fileTree(view.container).textContent).toContain("file-1.ts");
    });
    fireEvent.click(
      view.getByRole("button", { name: "Find in changed files" })
    );
    await expect(
      view.findByTestId("git-review-tree-search-bar")
    ).resolves.toBeVisible();
    fireEvent.click(
      view.getByRole("button", { name: "Find in changed files" })
    );
    await waitFor(() => {
      expect(view.queryByTestId("git-review-tree-search-bar")).toBeNull();
    });
    fireEvent.click(
      view.getByRole("button", { name: "Collapse changed files" })
    );
    fireEvent.click(view.getByRole("button", { name: "Expand changed files" }));
    expect(view.queryByTestId("git-review-tree-search-bar")).toBeNull();
    expect(diffViewRuntime.mounts).toBe(initialDiffMounts);
    expect(diffViewRuntime.unmounts).toBe(initialDiffUnmounts);
    expect(getReviewIndex).toHaveBeenCalledTimes(1);
  });

  it("加载、错误和空态都保留同一顶部结构", async () => {
    const pendingIndex = deferred<GitReviewIndexResult>();
    const context = pluginContext({
      getReviewIndex: vi.fn(() => pendingIndex.promise),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    expect(
      view.container.querySelector('[data-slot="file-panel-header"]')
    ).toBeInstanceOf(HTMLElement);
    pendingIndex.resolve(indexResult([]));
    await expect(view.findByText("No changes")).resolves.toBeVisible();
    expect(
      view.container.querySelectorAll('[data-slot="file-panel-header"]')
    ).toHaveLength(1);
  });

  it("初次 index 读取失败时可重试并进入 Review 正文", async () => {
    const getReviewIndex = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "error",
        message: "initial index failed",
        reason: "commandFailed",
        retryable: true,
      })
      .mockResolvedValueOnce(indexResult());
    const context = pluginContext({ getReviewIndex });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await expect(
      view.findByText("Git could not read this change.")
    ).resolves.toBeVisible();
    // 初次加载失败没有正文可看:错误是主体状态,用 Empty 呈现而非 Alert 横条。
    expect(
      view
        .getByText("Failed to load changes")
        .closest('[data-slot="error-empty"]')
    ).toBeVisible();
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.queryByText("initial index failed")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    expect(view.queryByRole("button", { name: "Retry" })).toBeNull();

    await waitFor(() => expect(view.getByTestId("pierre-diff")).toBeVisible());
    expect(getReviewIndex).toHaveBeenCalledTimes(2);
  });

  it("空 index 刷新失败仍显示可恢复入口", async () => {
    let notify: () => void = () => undefined;
    const getReviewIndex = vi
      .fn()
      .mockResolvedValueOnce(indexResult([]))
      .mockResolvedValueOnce({
        kind: "error",
        message: "empty refresh failed",
        reason: "commandFailed",
        retryable: true,
      })
      .mockResolvedValueOnce(indexResult([]));
    const context = pluginContext({
      getReviewIndex,
      watch: (_gitRoot, listener) => {
        notify = () => listener({ changeKind: "worktree", gitRoot: ROOT });
        return () => undefined;
      },
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);
    await expect(view.findByText("No changes")).resolves.toBeVisible();

    act(() => notify());
    await waitForRefreshWindow();
    await expect(
      view.findByText("Failed to refresh changes")
    ).resolves.toBeVisible();
    expect(
      view
        .getByText("Failed to refresh changes")
        .closest('[data-slot="scroll-area"]')
    ).toHaveClass("max-h-[40%]");
    expect(view.getByText("No changes")).toBeVisible();

    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await waitForRefreshWindow();
    await waitFor(() => {
      expect(view.queryByText("Failed to refresh changes")).toBeNull();
      expect(getReviewIndex).toHaveBeenCalledTimes(3);
    });
  });

  it("source 切换时同步隐藏旧正文且不按新仓读取旧 entry", async () => {
    const nextIndex = deferred<GitReviewIndexResult>();
    const getReviewIndex = vi
      .fn()
      .mockResolvedValueOnce(indexResult([entry(0)]))
      .mockImplementationOnce(() => nextIndex.promise);
    const getReviewFileDocument = vi.fn(async () => documentResult(0));
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex,
    });
    const Panel = createGitChangesPanel(context);
    const props = panelProps(createPanelHarness().api);
    const view = render(<Panel {...props} />);
    await waitFor(() => expect(view.getByTestId("pierre-diff")).toBeVisible());
    expect(getReviewFileDocument).toHaveBeenCalledTimes(1);

    const nextSource = {
      contextId: "ctx-other",
      gitRootPath: "/workspace/other",
      target: { kind: "uncommitted" },
    };
    view.rerender(
      <Panel
        {...({
          ...props,
          params: { context: panelContext, source: nextSource },
        } as IDockviewPanelProps)}
      />
    );

    expect(view.queryByTestId("pierre-diff")).toBeNull();
    expect(getReviewFileDocument).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(getReviewIndex).toHaveBeenLastCalledWith(
        expect.objectContaining({ source: nextSource })
      );
    });
    nextIndex.resolve(indexResult([]));
  });

  it("source 切换后不继承相同 entryKey 的旧树选择", async () => {
    const getReviewIndex = vi
      .fn()
      .mockResolvedValueOnce(indexResult([entry(0)]))
      .mockResolvedValueOnce(indexResult([entry(0)]));
    const getReviewFileDocument = vi.fn(async () => documentResult(0));
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex,
    });
    const Panel = createGitChangesPanel(context);
    const props = panelProps(createPanelHarness().api);
    const view = render(<Panel {...props} />);
    await waitFor(() => expect(view.getByTestId("pierre-diff")).toBeVisible());
    fireEvent.click(findTreeItem(view.container, "file-0.ts"));
    await waitFor(() =>
      expect(isItemVisible).toHaveBeenCalledWith(
        "section:0",
        "document:0:section:0"
      )
    );
    scrollToItem.mockClear();

    const nextSource = {
      contextId: "ctx-other-with-same-entry",
      gitRootPath: "/workspace/other-with-same-entry",
      target: { kind: "uncommitted" },
    };
    view.rerender(
      <Panel
        {...({
          ...props,
          params: { context: panelContext, source: nextSource },
        } as IDockviewPanelProps)}
      />
    );

    await waitFor(() => expect(getReviewIndex).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getReviewFileDocument).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.getByTestId("pierre-diff")).toBeVisible());
    expect(scrollToItem).not.toHaveBeenCalled();
  });

  it("锚点移除时优先选择任意后继，再回退到前驱", () => {
    expect(
      resolveReviewAnchor(
        {
          anchor: { id: "section:2", offset: -12 },
          entryKey: "entry:2",
          generation: 2,
          previousItemIds: [
            "section:0",
            "section:1",
            "section:2",
            "section:3",
            "section:4",
          ],
          restored: false,
        },
        ["section:1", "section:4"]
      )
    ).toEqual({ id: "section:4", offset: 0 });
  });

  it("刷新双缓冲不按文件数量截断旧代与新代正文", () => {
    const previous = new Map(
      Array.from({ length: 200 }, (_, index) => {
        const resource = {
          document: documentResult(index),
          entry: entry(index),
          kind: "loaded" as const,
        };
        return [resource.entry.entryKey, resource] as const;
      })
    );
    const insertedEntries = [entry(200), entry(201)];
    const currentResources = [
      ...insertedEntries.map((item, index) => ({
        document: documentResult(index + 200),
        entry: item,
        kind: "loaded" as const,
      })),
      ...Array.from({ length: 200 }, (_, index) => ({
        entry: entry(index),
        kind: "idle" as const,
      })),
    ];

    const reconciled = reconcileReviewDocumentSnapshot(
      {
        retainedEntryKeys: insertedEntries.map((item) => item.entryKey),
        resources: currentResources,
        settled: false,
      },
      previous,
      2,
      null
    );

    expect(
      reconciled.snapshot.resources.filter(
        (resource) => resource.kind === "loaded"
      )
    ).toHaveLength(202);
    expect(previous.size).toBe(200);
  });

  it("刷新双缓冲按最近使用顺序保留上一代当前正文", () => {
    const previous = new Map(
      [...Array.from({ length: 199 }, (_, index) => index + 1), 0].map(
        (index) => {
          const resource = {
            document: documentResult(index),
            entry: entry(index),
            kind: "loaded" as const,
          };
          return [resource.entry.entryKey, resource] as const;
        }
      )
    );
    const inserted = {
      document: documentResult(200),
      entry: entry(200),
      kind: "loaded" as const,
    };

    reconcileReviewDocumentSnapshot(
      {
        retainedEntryKeys: [inserted.entry.entryKey],
        resources: [
          inserted,
          ...Array.from({ length: 200 }, (_, index) => ({
            entry: entry(index),
            kind: "idle" as const,
          })),
        ],
        settled: false,
      },
      previous,
      2,
      null
    );

    expect(previous.has(entry(0).entryKey)).toBe(true);
    expect(previous.has(entry(1).entryKey)).toBe(true);
  });

  it("刷新双缓冲超预算时保留最老的当前选择和对应失败回退", () => {
    const previous = new Map(
      Array.from({ length: 200 }, (_, index) => {
        const resource = {
          document: documentResult(index),
          entry: entry(index),
          kind: "loaded" as const,
        };
        return [resource.entry.entryKey, resource] as const;
      })
    );
    const selectedEntryKey = entry(0).entryKey;
    const inserted = {
      document: documentResult(200),
      entry: entry(200),
      kind: "loaded" as const,
    };

    const controller = new GitReviewDocumentGeneration({
      current: {
        retainedEntryKeys: [inserted.entry.entryKey],
        resources: [
          inserted,
          {
            entry: entry(0),
            failure: {
              kind: "error",
              message: "selected refresh failed",
              reason: "internal",
              retryable: true,
            },
            kind: "error" as const,
          },
          ...Array.from({ length: 199 }, (_, index) => ({
            entry: entry(index + 1),
            kind: "idle" as const,
          })),
        ],
        settled: false,
      },
      generation: 2,
      previousByEntryKey: previous,
      protectedEntryKey: selectedEntryKey,
    });
    const reconciled = controller.snapshot([]);

    expect(
      controller
        .initialFailureChanges()
        .filter((change) => change.source === "refresh")
    ).toHaveLength(1);
    expect(
      reconciled.resources.find(
        (resource) => resource.entry.entryKey === selectedEntryKey
      )
    ).toMatchObject({
      document: { revision: "document:0" },
      kind: "loaded",
    });
    expect(
      reconciled.resources.filter((resource) => resource.kind === "loaded")
    ).toHaveLength(201);
    expect(previous.has(selectedEntryKey)).toBe(true);
    expect(previous.has(entry(1).entryKey)).toBe(true);
  });

  it("窗口外选择刷新失败后保留旧正文和跨刷新重试意图", async () => {
    const entries = [
      ...Array.from({ length: 200 }, (_, index) => entry(index)),
      entry(200, "src/aaa-selected.ts"),
    ];
    let notify: () => void = () => undefined;
    let refreshing = false;
    let selectedReads = 0;
    const getReviewFileDocument = vi.fn(async (request) => {
      const isSelected = request.source.path === "src/aaa-selected.ts";
      const match = request.source.path.match(/file-(\d+)\.ts$/u);
      const index = isSelected ? 200 : Number(match?.[1] ?? 0);
      if (isSelected) {
        selectedReads += 1;
        if (refreshing) {
          return {
            kind: "error" as const,
            message: "selected refresh failed",
            reason: "internal" as const,
            retryable: true,
          };
        }
      }
      return documentResult(index);
    });
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex: vi.fn(async () => indexResult(entries)),
      watch: (_gitRoot, listener) => {
        notify = () => listener({ changeKind: "worktree", gitRoot: ROOT });
        return () => undefined;
      },
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-count",
        "201"
      )
    );
    fireEvent.click(findTreeItem(view.container, "aaa-selected.ts"));
    await waitFor(() => expect(selectedReads).toBe(1));
    await waitFor(() =>
      expect(scrollToItem).toHaveBeenCalledWith("section:200")
    );

    refreshing = true;
    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() => expect(selectedReads).toBe(2));
    await expect(
      view.findByText("An internal error occurred while reading the change.")
    ).resolves.toBeVisible();
    expect(view.getByTestId("pierre-diff")).toHaveAttribute(
      "data-item-ids",
      expect.stringContaining("section:200")
    );

    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() => expect(selectedReads).toBe(3));
    expect(view.getByTestId("pierre-diff")).toHaveAttribute(
      "data-item-ids",
      expect.stringContaining("section:200")
    );
  }, 20_000);

  it("刷新失败回退到旧正文时首次树选择仍能定位当前投影", async () => {
    const entries = [
      ...Array.from({ length: 199 }, (_, index) => entry(index)),
      entry(199, "src/aaa-refresh-fallback.ts"),
      entry(200),
    ];
    const refreshedTarget = deferred<GitReviewFileDocumentResult>();
    let notify: () => void = () => undefined;
    let targetReads = 0;
    const getReviewFileDocument = vi.fn(async (request) => {
      if (request.source.path === "src/aaa-refresh-fallback.ts") {
        targetReads += 1;
        return targetReads === 1
          ? documentResult(199)
          : await refreshedTarget.promise;
      }
      const match = request.source.path.match(/file-(\d+)\.ts$/u);
      return documentResult(Number(match?.[1] ?? 0));
    });
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex: vi.fn(async () => indexResult(entries)),
      watch: (_gitRoot, listener) => {
        notify = () => listener({ changeKind: "worktree", gitRoot: ROOT });
        return () => undefined;
      },
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() => expect(getReviewFileDocument).toHaveBeenCalled());
    expect(getReviewFileDocument.mock.calls.length).toBeLessThanOrEqual(96);
    fireEvent.click(findTreeItem(view.container, "aaa-refresh-fallback.ts"));
    await waitFor(() => expect(targetReads).toBe(1));
    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() => expect(targetReads).toBe(2));
    act(() =>
      refreshedTarget.resolve({
        kind: "error",
        message: "selected refresh failed",
        reason: "internal",
        retryable: true,
      })
    );
    await expect(
      view.findByText("An internal error occurred while reading the change.")
    ).resolves.toBeVisible();
    expect(view.getByTestId("pierre-diff")).toHaveAttribute(
      "data-item-ids",
      expect.stringContaining("section:199")
    );
  }, 20_000);

  it("Pierre 渲染失败时显示错误，并可通过重试恢复正文", async () => {
    diffViewRuntime.error = new Error("Pierre chunk unavailable");
    const context = pluginContext({});
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await expect(
      view.findByText("Failed to render diff")
    ).resolves.toBeVisible();
    expect(view.queryByText("Pierre chunk unavailable")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Details" }));
    expect(context.dialogs.alert).toHaveBeenCalledWith({
      body: "Pierre chunk unavailable",
      title: "Failed to render diff",
    });
    diffViewRuntime.error = null;
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await expect(view.findByTestId("pierre-diff")).resolves.toBeVisible();
    expect(view.queryByText("Pierre chunk unavailable")).toBeNull();
  });

  it("已加载正文经历 Pierre 失败与重挂后从 latest-map 恢复且不重复读取", async () => {
    const getReviewFileDocument = vi.fn(async () => documentResult(0));
    const context = pluginContext({ getReviewFileDocument });
    const Panel = createGitChangesPanel(context);
    const props = panelProps(createPanelHarness().api);
    const view = render(<Panel {...props} />);

    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveTextContent("+new")
    );
    const readsBeforeFailure = getReviewFileDocument.mock.calls.length;

    diffViewRuntime.error = new Error("Pierre runtime unavailable");
    view.rerender(<Panel {...props} />);
    await expect(
      view.findByText("Failed to render diff")
    ).resolves.toBeVisible();

    diffViewRuntime.error = null;
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveTextContent("+new")
    );
    expect(getReviewFileDocument).toHaveBeenCalledTimes(readsBeforeFailure);
  });

  it("新代新增 staged 拓扑提交前不把新 section 发给旧 Pierre handle", async () => {
    const path = "src/topology.ts";
    const unstagedSlot = {
      group: "unstaged" as const,
      oldPath: null,
      sectionKey: "section:topology:unstaged",
      status: "modified" as const,
      targetPath: path,
    };
    const stagedSlot = {
      group: "staged" as const,
      oldPath: null,
      sectionKey: "section:topology:staged",
      status: "modified" as const,
      targetPath: path,
    };
    const initialEntry = entry(0, path, [unstagedSlot]);
    const refreshedEntry = entry(0, path, [unstagedSlot, stagedSlot]);
    let notify: () => void = () => undefined;
    let reads = 0;
    const getReviewFileDocument = vi.fn(async () => {
      reads += 1;
      return documentResult(0, [
        {
          kind: "patch",
          patch:
            "diff --git a/src/topology.ts b/src/topology.ts\n@@ -1 +1 @@\n-old\n+unstaged\n",
          sectionKey: unstagedSlot.sectionKey,
        },
        ...(reads === 1
          ? []
          : [
              {
                kind: "patch" as const,
                patch:
                  "diff --git a/src/topology.ts b/src/topology.ts\n@@ -1 +1 @@\n-old\n+staged\n",
                sectionKey: stagedSlot.sectionKey,
              },
            ]),
      ]);
    });
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex: vi
        .fn()
        .mockResolvedValueOnce(indexResult([initialEntry]))
        .mockResolvedValueOnce(indexResult([refreshedEntry])),
      watch: (_gitRoot, listener) => {
        notify = () => listener({ changeKind: "worktree", gitRoot: ROOT });
        return () => undefined;
      },
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-ids",
        unstagedSlot.sectionKey
      )
    );
    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() => expect(reads).toBe(2));
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-ids",
        `${stagedSlot.sectionKey},${unstagedSlot.sectionKey}`
      )
    );
    expect(diffViewRuntime.unknownItemUpdates).toEqual([]);
  });

  it("在同一 Review 内显示目录树和多文件 CodeView，不打开第二个 panel", async () => {
    const entries = [entry(0), entry(1)];
    const context = pluginContext({
      getReviewFileDocument: vi.fn(async (request) =>
        documentResult(request.source.path.endsWith("1.ts") ? 1 : 0)
      ),
      getReviewIndex: vi.fn(async () => indexResult(entries)),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() => {
      expect(fileTree(view.container).textContent).toContain("file-0.ts");
      expect(fileTree(view.container).textContent).toContain("file-1.ts");
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-ids",
        "section:0,section:1"
      );
    });
    fireEvent.click(findTreeItem(view.container, "file-1.ts"));
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledWith("section:1"));
    expect(context.panels.openInstance).not.toHaveBeenCalled();
  });

  it("同一路径 staged 与 unstaged 各保留一个树项和两个正文 item", async () => {
    const path = "src/app.ts";
    const context = pluginContext({
      getReviewFileDocument: vi.fn(async () =>
        documentResult(0, [
          {
            kind: "patch",
            patch:
              "diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-a\n+b\n",
            sectionKey: "unstaged:app",
          },
          {
            kind: "patch",
            patch:
              "diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-b\n+c\n",
            sectionKey: "staged:app",
          },
        ])
      ),
      getReviewIndex: vi.fn(async () =>
        indexResult([
          entry(0, path, [
            {
              group: "unstaged",
              oldPath: null,
              sectionKey: "unstaged:app",
              status: "modified",
              targetPath: path,
            },
            {
              group: "staged",
              oldPath: null,
              sectionKey: "staged:app",
              status: "modified",
              targetPath: path,
            },
          ]),
        ])
      ),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() => {
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-ids",
        "staged:app,unstaged:app"
      );
    });
    const appRows = [
      ...fileTree(view.container).querySelectorAll('[role="treeitem"]'),
    ].filter((element) => element.textContent?.includes("app.ts"));
    expect(appRows).toHaveLength(2);
    const scrolledSectionIds: string[] = [];
    for (const row of appRows) {
      scrollToItem.mockClear();
      fireEvent.click(row);
      const sectionId = scrollToItem.mock.calls[0]?.[0];
      if (typeof sectionId === "string") {
        scrolledSectionIds.push(sectionId);
      }
    }
    expect(scrolledSectionIds.sort()).toEqual(
      ["staged:app", "unstaged:app"].sort()
    );
  });

  it("远树点击导航期间 CodeView 拓扑身份保持稳定", async () => {
    const entries = [
      ...Array.from({ length: 40 }, (_, index) => entry(index)),
      entry(79, "src/aaa-far.ts"),
    ];
    const farPending = deferred<GitReviewFileDocumentResult>();
    let farRequested = false;
    const getReviewFileDocument = vi.fn(async (request) => {
      if (request.source.path === "src/aaa-far.ts") {
        farRequested = true;
        return farPending.promise;
      }
      const match = request.source.path.match(/file-(\d+)\.ts$/u);
      return documentResult(Number(match?.[1] ?? 0));
    });
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex: vi.fn(async () => indexResult(entries)),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-count",
        String(entries.length)
      )
    );
    const countBeforeNav = Number(
      view.getByTestId("pierre-diff").getAttribute("data-item-count")
    );
    const unmountsBefore = diffViewRuntime.unmounts;
    const idsBefore = view
      .getByTestId("pierre-diff")
      .getAttribute("data-item-ids");

    fireEvent.click(findTreeItem(view.container, "aaa-far.ts"));
    await waitFor(() => expect(farRequested).toBe(true));
    // 金标准：点击不改 id 拓扑，不 remount CodeView。
    expect(
      Number(view.getByTestId("pierre-diff").getAttribute("data-item-count"))
    ).toBe(countBeforeNav);
    expect(view.getByTestId("pierre-diff").getAttribute("data-item-ids")).toBe(
      idsBefore
    );
    expect(scrollToItem).not.toHaveBeenCalledWith("section:79");

    act(() => farPending.resolve(documentResult(79)));
    await waitFor(() =>
      expect(scrollToItem).toHaveBeenCalledWith("section:79")
    );
    expect(diffViewRuntime.unmounts).toBe(unmountsBefore);
    expect(
      Number(view.getByTestId("pierre-diff").getAttribute("data-item-count"))
    ).toBe(countBeforeNav);
    expect(view.getByTestId("pierre-diff").getAttribute("data-item-ids")).toBe(
      idsBefore
    );
  });

  it("连续点击不同树文件时立即切换排他 demand 并定位最新目标", async () => {
    const entries = [
      entry(0),
      entry(1),
      entry(20, "src/aaa-first.ts"),
      entry(21, "src/aaa-second.ts"),
    ];
    const pending = new Map<
      string,
      ReturnType<typeof deferred<GitReviewFileDocumentResult>>
    >();
    const getReviewFileDocument = vi.fn((request) => {
      const next = deferred<GitReviewFileDocumentResult>();
      pending.set(request.source.path, next);
      return next.promise;
    });
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex: vi.fn(async () => indexResult(entries)),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);
    await waitFor(() => expect(getReviewFileDocument).toHaveBeenCalled());

    // 先完成 seed 窗口读取，建立稳定投影。
    for (const [path, request] of pending) {
      if (path === "src/aaa-first.ts" || path === "src/aaa-second.ts") {
        continue;
      }
      const match = path.match(/file-(\d+)\.ts$/u);
      act(() => request.resolve(documentResult(Number(match?.[1] ?? 0))));
    }

    fireEvent.click(findTreeItem(view.container, "aaa-first.ts"));
    await waitFor(() => expect(pending.has("src/aaa-first.ts")).toBe(true));
    const firstCalls = getReviewFileDocument.mock.calls.length;

    // navigationPending 仍为 true 时点第二个目标，必须同步改 demand。
    fireEvent.click(findTreeItem(view.container, "aaa-second.ts"));
    await waitFor(() => expect(pending.has("src/aaa-second.ts")).toBe(true));
    expect(getReviewFileDocument.mock.calls.length).toBeGreaterThan(firstCalls);
    expect(
      getReviewFileDocument.mock.calls.some(
        (call) => call[0].source.path === "src/aaa-second.ts"
      )
    ).toBe(true);

    act(() => {
      pending.get("src/aaa-first.ts")?.resolve(documentResult(20));
      pending.get("src/aaa-second.ts")?.resolve(documentResult(21));
    });
    await waitFor(() =>
      expect(scrollToItem).toHaveBeenCalledWith("section:21")
    );
  });

  it("树目标进入窗口后取消旧请求，并在旧请求结算后读取目标", async () => {
    const entries = [0, 1, 2, 3].map((index) => entry(index));
    const pending = new Map<
      string,
      ReturnType<typeof deferred<GitReviewFileDocumentResult>>
    >();
    const getReviewFileDocument = vi.fn((request) => {
      const next = deferred<GitReviewFileDocumentResult>();
      pending.set(request.source.path, next);
      return next.promise;
    });
    const cancelReviewRequest = vi.fn(async () => undefined);
    const context = pluginContext({
      cancelReviewRequest,
      getReviewFileDocument,
      getReviewIndex: vi.fn(async () => indexResult(entries)),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() => expect(getReviewFileDocument).toHaveBeenCalledTimes(2));
    fireEvent.click(findTreeItem(view.container, "file-3.ts"));
    await waitFor(() => expect(cancelReviewRequest).toHaveBeenCalledTimes(2));
    act(() => pending.get("src/file-0.ts")?.resolve(documentResult(0)));
    await waitFor(() => {
      expect(getReviewFileDocument.mock.calls[2]?.[0].source.path).toBe(
        "src/file-3.ts"
      );
    });
    act(() => pending.get("src/file-3.ts")?.resolve(documentResult(3)));
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledWith("section:3"));
  });

  it("目标已在当前窗口且滚动窗口未变化时仍切换为目标优先需求", async () => {
    const entries = [0, 1, 2].map((index) => entry(index));
    const pending = new Map<
      string,
      ReturnType<typeof deferred<GitReviewFileDocumentResult>>
    >();
    const getReviewFileDocument = vi.fn((request) => {
      const next = deferred<GitReviewFileDocumentResult>();
      pending.set(request.source.path, next);
      return next.promise;
    });
    const cancelReviewRequest = vi.fn(async () => undefined);
    const context = pluginContext({
      cancelReviewRequest,
      getReviewFileDocument,
      getReviewIndex: vi.fn(async () => indexResult(entries)),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() => expect(getReviewFileDocument).toHaveBeenCalledTimes(2));
    diffViewRuntime.reportWindowOnScroll = false;
    fireEvent.click(findTreeItem(view.container, "file-2.ts"));
    await waitFor(() => expect(cancelReviewRequest).toHaveBeenCalledTimes(2));

    act(() => pending.get("src/file-0.ts")?.resolve(documentResult(0)));
    await waitFor(() => {
      expect(getReviewFileDocument.mock.calls[2]?.[0].source.path).toBe(
        "src/file-2.ts"
      );
    });
  });

  it("已取消的旧窗口正文迟到时不发布也不重复定位", async () => {
    const entries = [0, 1, 2, 3].map((index) => entry(index));
    const pending = new Map<
      string,
      ReturnType<typeof deferred<GitReviewFileDocumentResult>>
    >();
    const getReviewFileDocument = vi.fn((request) => {
      const next = deferred<GitReviewFileDocumentResult>();
      pending.set(request.source.path, next);
      return next.promise;
    });
    const cancelReviewRequest = vi.fn(async () => undefined);
    const context = pluginContext({
      cancelReviewRequest,
      getReviewFileDocument,
      getReviewIndex: vi.fn(async () => indexResult(entries)),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() => expect(getReviewFileDocument).toHaveBeenCalledTimes(2));
    fireEvent.click(findTreeItem(view.container, "file-3.ts"));
    await waitFor(() => expect(cancelReviewRequest).toHaveBeenCalledTimes(2));
    act(() => pending.get("src/file-0.ts")?.resolve(documentResult(0)));
    await waitFor(() => expect(pending.has("src/file-3.ts")).toBe(true));
    act(() => pending.get("src/file-3.ts")?.resolve(documentResult(3)));
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledWith("section:3"));
    await waitFor(() =>
      expect(isItemVisible).toHaveBeenCalledWith(
        "section:3",
        "document:3:section:3"
      )
    );
    const callsAfterFirstVisibility = scrollToItem.mock.calls.filter(
      ([sectionId]) => sectionId === "section:3"
    ).length;

    act(() => pending.get("src/file-1.ts")?.resolve(documentResult(1)));

    expect(
      scrollToItem.mock.calls.filter(([sectionId]) => sectionId === "section:3")
    ).toHaveLength(callsAfterFirstVisibility);

    act(() => diffViewRuntime.onScroll?.());
    expect(pending.has("src/file-2.ts")).toBe(false);
    expect(
      scrollToItem.mock.calls.filter(([sectionId]) => sectionId === "section:3")
    ).toHaveLength(callsAfterFirstVisibility);
  });

  it("目标后方正文增量插入时不重复滚动已可见的树选择", async () => {
    const entries = [0, 1, 2].map((index) => entry(index));
    const pending = new Map<
      string,
      ReturnType<typeof deferred<GitReviewFileDocumentResult>>
    >();
    const getReviewFileDocument = vi.fn((request) => {
      const next = deferred<GitReviewFileDocumentResult>();
      pending.set(request.source.path, next);
      return next.promise;
    });
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex: vi.fn(async () => indexResult(entries)),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() => expect(getReviewFileDocument).toHaveBeenCalledTimes(2));
    fireEvent.click(findTreeItem(view.container, "file-0.ts"));
    act(() => pending.get("src/file-0.ts")?.resolve(documentResult(0)));
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledWith("section:0"));
    await waitFor(() =>
      expect(isItemVisible).toHaveBeenCalledWith(
        "section:0",
        "document:0:section:0"
      )
    );
    const callsAfterFirstVisibility = scrollToItem.mock.calls.filter(
      ([sectionId]) => sectionId === "section:0"
    ).length;

    act(() => pending.get("src/file-1.ts")?.resolve(documentResult(1)));
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-ids",
        expect.stringContaining("section:1")
      )
    );

    expect(
      scrollToItem.mock.calls.filter(([sectionId]) => sectionId === "section:0")
    ).toHaveLength(callsAfterFirstVisibility);
  });

  it("导航超时后增量投影不静默清错或自动重启定位", async () => {
    const entries = [0, 1, 2].map((index) => entry(index));
    const pending = new Map<
      string,
      ReturnType<typeof deferred<GitReviewFileDocumentResult>>
    >();
    const frames: FrameRequestCallback[] = [];
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (callback) => {
        frames.push(callback);
        return frames.length;
      }
    );
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(
      () => undefined
    );
    isItemVisible.mockReturnValue(false);
    const getReviewFileDocument = vi.fn((request) => {
      const next = deferred<GitReviewFileDocumentResult>();
      pending.set(request.source.path, next);
      return next.promise;
    });
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex: vi.fn(async () => indexResult(entries)),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() => expect(getReviewFileDocument).toHaveBeenCalledTimes(2));
    fireEvent.click(findTreeItem(view.container, "file-2.ts"));
    act(() => pending.get("src/file-0.ts")?.resolve(documentResult(0)));
    await waitFor(() => expect(pending.has("src/file-2.ts")).toBe(true));
    act(() => pending.get("src/file-2.ts")?.resolve(documentResult(2)));
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledWith("section:2"));

    now = 2000;
    act(() => {
      for (let frame = frames.shift(); frame; frame = frames.shift()) {
        frame(now);
      }
    });
    // 目标已投影但未进 isItemVisible：静默结束，不弹 banner/alert。
    await waitFor(() => {
      expect(view.queryByText("Failed to navigate to file")).toBeNull();
    });
    const callsAfterTimeout = scrollToItem.mock.calls.filter(
      ([sectionId]) => sectionId === "section:2"
    ).length;

    act(() => pending.get("src/file-1.ts")?.resolve(documentResult(1)));
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-ids",
        expect.stringContaining("section:1")
      )
    );

    expect(view.queryByText("Failed to navigate to file")).toBeNull();
    expect(
      scrollToItem.mock.calls.filter(([sectionId]) => sectionId === "section:2")
    ).toHaveLength(callsAfterTimeout);
  });

  it("通过显式入口重试瞬时读取失败的文件并在成功后定位", async () => {
    const getReviewFileDocument = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "error",
        message: "temporary document failure",
        reason: "internal",
        retryable: true,
      })
      .mockResolvedValueOnce(documentResult(0));
    const context = pluginContext({ getReviewFileDocument });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);
    await expect(
      view.findByText("An internal error occurred while reading the change.")
    ).resolves.toBeVisible();
    expect(view.queryByText("temporary document failure")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Details" }));
    expect(context.dialogs.alert).toHaveBeenCalledWith({
      body: "temporary document failure",
      title: "src/file-0.ts",
    });

    fireEvent.click(view.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(getReviewFileDocument).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledWith("section:0"));
  });

  it("重试失败文件时取消离窗请求，并在旧请求结算后读取当前目标", async () => {
    const entries = [0, 1, 2].map((index) => entry(index));
    const requests = new Map<
      string,
      ReturnType<typeof deferred<GitReviewFileDocumentResult>>[]
    >();
    const getReviewFileDocument = vi.fn((request) => {
      const next = deferred<GitReviewFileDocumentResult>();
      const pathRequests = requests.get(request.source.path) ?? [];
      pathRequests.push(next);
      requests.set(request.source.path, pathRequests);
      return next.promise;
    });
    const cancelReviewRequest = vi.fn(async () => undefined);
    const context = pluginContext({
      cancelReviewRequest,
      getReviewFileDocument,
      getReviewIndex: vi.fn(async () => indexResult(entries)),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() => expect(getReviewFileDocument).toHaveBeenCalledTimes(2));
    act(() =>
      requests.get("src/file-0.ts")?.[0]?.resolve({
        kind: "error",
        message: "temporary document failure",
        reason: "internal",
        retryable: true,
      })
    );
    await waitFor(() => expect(getReviewFileDocument).toHaveBeenCalledTimes(3));
    await view.findByRole("button", { name: "Retry" });

    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    // loading 占位不 scroll；ready 后再定位。
    await waitFor(() => expect(cancelReviewRequest).toHaveBeenCalledTimes(2));
    act(() => requests.get("src/file-1.ts")?.[0]?.resolve(documentResult(1)));
    await waitFor(() => expect(getReviewFileDocument).toHaveBeenCalledTimes(4));
    expect(requests.get("src/file-0.ts")).toHaveLength(2);
    act(() => requests.get("src/file-0.ts")?.[1]?.resolve(documentResult(0)));

    await waitFor(() => expect(scrollToItem).toHaveBeenCalledWith("section:0"));
    await waitFor(() =>
      expect(isItemVisible).toHaveBeenCalledWith(
        "section:0",
        "document:0:section:0"
      )
    );
  });

  it("请求完成顺序颠倒时正文仍按 index 顺序排列", async () => {
    const entries = [0, 1, 2].map((index) => entry(index));
    const pending = new Map<
      string,
      ReturnType<typeof deferred<GitReviewFileDocumentResult>>
    >();
    const context = pluginContext({
      getReviewFileDocument: vi.fn((request) => {
        const next = deferred<GitReviewFileDocumentResult>();
        pending.set(request.source.path, next);
        return next.promise;
      }),
      getReviewIndex: vi.fn(async () => indexResult(entries)),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() => expect(pending.size).toBe(2));
    act(() => pending.get("src/file-1.ts")?.resolve(documentResult(1)));
    await waitFor(() => expect(pending.has("src/file-2.ts")).toBe(true));
    act(() => pending.get("src/file-2.ts")?.resolve(documentResult(2)));
    act(() => pending.get("src/file-0.ts")?.resolve(documentResult(0)));

    await waitFor(() => {
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-ids",
        "section:0,section:1,section:2"
      );
    });
  });

  it("卸载时只取消仍在飞的文件请求，不重复取消已完成 index", async () => {
    const cancelReviewRequest = vi.fn(
      async (_request: { operationId: string }) => undefined
    );
    const context = pluginContext({
      cancelReviewRequest,
      getReviewFileDocument: vi.fn(
        () => new Promise<GitReviewFileDocumentResult>(() => undefined)
      ),
      getReviewIndex: vi.fn(async () =>
        indexResult([entry(0), entry(1), entry(2)])
      ),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() => {
      expect(context.git.getReviewFileDocument).toHaveBeenCalledTimes(2);
    });
    view.unmount();
    expect(cancelReviewRequest).toHaveBeenCalledTimes(2);
    expect(
      new Set(
        cancelReviewRequest.mock.calls.map(([request]) => request.operationId)
      ).size
    ).toBe(2);
  });

  it("轻量槽位显示后立即订阅 appearance", async () => {
    const pending = deferred<GitReviewFileDocumentResult>();
    const appearanceOnDidChange = vi.fn(() => () => undefined);
    const context = pluginContext({
      appearanceOnDidChange,
      getReviewFileDocument: vi.fn(() => pending.promise),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() =>
      expect(context.git.getReviewFileDocument).toHaveBeenCalled()
    );
    expect(appearanceOnDidChange).toHaveBeenCalledTimes(1);
    act(() => pending.resolve(documentResult(0)));
    await waitFor(() => expect(view.getByTestId("pierre-diff")).toBeVisible());
    expect(appearanceOnDidChange).toHaveBeenCalledTimes(1);
  });

  it("文件与同名目录同时变更时保留两个导航入口", async () => {
    const entries = [entry(0, "a"), entry(1, "a/b")];
    const context = pluginContext({
      getReviewFileDocument: vi.fn(async (request) =>
        documentResult(request.source.path === "a" ? 0 : 1)
      ),
      getReviewIndex: vi.fn(async () => indexResult(entries)),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() => {
      expect(fileTree(view.container).textContent).toContain("File change · a");
      expect(fileTree(view.container).textContent).toContain("b");
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-ids",
        "section:0,section:1"
      );
    });
    fireEvent.click(findTreeItem(view.container, "File change · a"));
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledWith("section:0"));
  });

  it("Git 事件刷新同一路径正文并通过官方锚点保持阅读位置", async () => {
    let notify: () => void = () => undefined;
    const refreshedDocument = deferred<GitReviewFileDocumentResult>();
    const getReviewFileDocument = vi
      .fn()
      .mockResolvedValueOnce(documentResult(0))
      .mockImplementationOnce(() => refreshedDocument.promise);
    const getReviewIndex = vi.fn(async () => indexResult([entry(0)]));
    captureTopAnchor.mockReturnValue({ id: "section:0", offset: -24 });
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex,
      watch: (_gitRoot, listener) => {
        notify = () => listener({ changeKind: "worktree", gitRoot: ROOT });
        return () => undefined;
      },
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);
    await waitFor(() => expect(view.getByTestId("pierre-diff")).toBeVisible());

    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() => expect(getReviewIndex).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getReviewFileDocument).toHaveBeenCalledTimes(2));
    expect(view.getByTestId("pierre-diff")).toHaveTextContent("+new");

    act(() => {
      refreshedDocument.resolve(
        documentResult(0, [
          {
            kind: "patch",
            patch:
              "diff --git a/src/file-0.ts b/src/file-0.ts\n@@ -1 +1 @@\n-old\n+fresh\n",
            sectionKey: "section:0",
          },
        ])
      );
    });
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveTextContent("+fresh")
    );
    expect(captureTopAnchor).toHaveBeenCalled();
    expect(restoreAnchor).toHaveBeenCalledWith({
      id: "section:0",
      offset: -24,
    });
  });

  it("用户在渐进刷新期间滚动后不再被旧锚点拉回", async () => {
    let notify: () => void = () => undefined;
    const refreshPending = [
      deferred<GitReviewFileDocumentResult>(),
      deferred<GitReviewFileDocumentResult>(),
    ];
    let documentCalls = 0;
    const context = pluginContext({
      getReviewFileDocument: vi.fn(async (request) => {
        documentCalls += 1;
        const index = Number(request.source.path.match(/(\d+)\.ts$/u)?.[1]);
        if (documentCalls <= 3 || index === 0) {
          return documentResult(index);
        }
        return await (refreshPending[index - 1]?.promise ??
          Promise.resolve(documentResult(index)));
      }),
      getReviewIndex: vi.fn(async () =>
        indexResult([entry(0), entry(1), entry(2)])
      ),
      watch: (_gitRoot, listener) => {
        notify = () => listener({ changeKind: "worktree", gitRoot: ROOT });
        return () => undefined;
      },
    });
    captureTopAnchor.mockReturnValue({ id: "section:0", offset: -10 });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-count",
        "3"
      )
    );

    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() => expect(restoreAnchor).toHaveBeenCalled());
    const restoreCount = restoreAnchor.mock.calls.length;
    act(() => diffViewRuntime.onScroll?.());
    act(() => {
      refreshPending[0]?.resolve(documentResult(1));
      refreshPending[1]?.resolve(documentResult(2));
    });
    await waitFor(() =>
      expect(context.git.getReviewFileDocument).toHaveBeenCalledTimes(6)
    );
    expect(restoreAnchor).toHaveBeenCalledTimes(restoreCount);
  });

  it("index 新代接受前保留旧 document 代，接受后取消并忽略晚到结果", async () => {
    let notify: () => void = () => undefined;
    const lateDocument = deferred<GitReviewFileDocumentResult>();
    const refreshedIndex = deferred<GitReviewIndexOk>();
    const cancelReviewRequest = vi.fn(async () => undefined);
    const getReviewIndex = vi
      .fn()
      .mockResolvedValueOnce(indexResult([entry(0), entry(1)]))
      .mockImplementationOnce(() => refreshedIndex.promise);
    const getReviewFileDocument = vi.fn((request) =>
      request.source.path.endsWith("0.ts")
        ? Promise.resolve(documentResult(0))
        : lateDocument.promise
    );
    const context = pluginContext({
      cancelReviewRequest,
      getReviewFileDocument,
      getReviewIndex,
      watch: (_gitRoot, listener) => {
        notify = () => listener({ changeKind: "worktree", gitRoot: ROOT });
        return () => undefined;
      },
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);
    await waitFor(() => expect(view.getByTestId("pierre-diff")).toBeVisible());

    act(() => notify());
    expect(cancelReviewRequest).not.toHaveBeenCalled();
    await waitForRefreshWindow();
    act(() => refreshedIndex.resolve(indexResult([entry(0), entry(1)])));
    await waitFor(() => expect(cancelReviewRequest).toHaveBeenCalled());
    act(() =>
      lateDocument.resolve(
        documentResult(1, [
          {
            kind: "patch",
            patch:
              "diff --git a/src/file-1.ts b/src/file-1.ts\n@@ -1 +1 @@\n-old\n+late-old-generation\n",
            sectionKey: "section:1",
          },
        ])
      )
    );
    expect(view.getByTestId("pierre-diff")).not.toHaveTextContent(
      "late-old-generation"
    );
  });

  it("2,000 项刷新时优先重读并重新定位当前树选择", async () => {
    const entries = [
      ...Array.from({ length: 1999 }, (_, index) =>
        entry(index, `src/z-file-${String(index).padStart(4, "0")}.ts`)
      ),
      entry(1999, "src/aaa-current.ts"),
    ];
    let notify: () => void = () => undefined;
    let currentFileReads = 0;
    const refreshedCurrent = deferred<GitReviewFileDocumentResult>();
    const getReviewFileDocument = vi.fn(async (request) => {
      if (request.source.path === "src/aaa-current.ts") {
        currentFileReads += 1;
        return currentFileReads === 1
          ? documentResult(1999)
          : await refreshedCurrent.promise;
      }
      const match = request.source.path.match(/z-file-(\d+)\.ts$/u);
      return documentResult(Number(match?.[1] ?? 0));
    });
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex: vi
        .fn()
        .mockResolvedValueOnce(indexResult(entries))
        .mockResolvedValueOnce(indexResult(entries)),
      watch: (_gitRoot, listener) => {
        notify = () => listener({ changeKind: "worktree", gitRoot: ROOT });
        return () => undefined;
      },
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-count",
        "2000"
      )
    );
    // 全量轻量槽稳定；首批 document 读取仍受 seed/demand 有界。
    await waitFor(() =>
      expect(getReviewFileDocument.mock.calls.length).toBeGreaterThan(0)
    );
    expect(getReviewFileDocument.mock.calls.length).toBeLessThanOrEqual(96);
    fireEvent.click(findTreeItem(view.container, "aaa-current.ts"));
    await waitFor(() => expect(currentFileReads).toBe(1));
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-ids",
        expect.stringContaining("section:1999")
      )
    );
    await waitFor(() =>
      expect(scrollToItem).toHaveBeenCalledWith("section:1999")
    );
    await waitFor(() =>
      expect(isItemVisible).toHaveBeenCalledWith(
        "section:1999",
        "document:1999:section:1999"
      )
    );
    const navigationCount = scrollToItem.mock.calls.filter(
      ([sectionId]) => sectionId === "section:1999"
    ).length;
    captureTopAnchor.mockReturnValue({ id: "section:1999", offset: -20 });

    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() => expect(currentFileReads).toBe(2));
    expect(
      scrollToItem.mock.calls.filter(
        ([sectionId]) => sectionId === "section:1999"
      ).length
    ).toBeGreaterThan(navigationCount);
    act(() => {
      refreshedCurrent.resolve({
        ...documentResult(1999, [
          {
            kind: "patch",
            patch:
              "diff --git a/src/aaa-current.ts b/src/aaa-current.ts\n@@ -1 +1 @@\n-old\n+fresh-current\n",
            sectionKey: "section:1999",
          },
        ]),
        revision: "document:fresh-current",
      });
    });
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveTextContent("fresh-current")
    );
    await waitFor(() => {
      expect(
        scrollToItem.mock.calls.filter(
          ([sectionId]) => sectionId === "section:1999"
        ).length
      ).toBeGreaterThan(navigationCount);
    });
    await waitFor(() =>
      expect(isItemVisible).toHaveBeenCalledWith(
        "section:1999",
        "document:fresh-current:section:1999"
      )
    );
    expect(restoreAnchor).not.toHaveBeenCalled();
  }, 15_000);

  it("状态文件与文本文件共用树导航和当前投影缓存身份", async () => {
    const stateDocument = documentResult(1, [
      {
        kind: "state",
        oldPath: null,
        reason: "binary",
        sectionKey: "state:1",
        status: "modified",
        targetPath: "src/file-1.ts",
      },
    ]);
    const context = pluginContext({
      getReviewFileDocument: vi.fn(async (request) =>
        request.source.path.endsWith("0.ts") ? documentResult(0) : stateDocument
      ),
      getReviewIndex: vi.fn(async () =>
        indexResult([
          entry(0),
          entry(1, "src/file-1.ts", [
            {
              group: "unstaged",
              oldPath: null,
              sectionKey: "state:1",
              status: "modified",
              targetPath: "src/file-1.ts",
            },
          ]),
        ])
      ),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-ids",
        "section:0,state:1"
      )
    );
    expect(view.getByTestId("pierre-diff")).toHaveAttribute(
      "data-file-paths",
      "src/file-0.ts,src/file-1.ts"
    );
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveTextContent(
        "Binary file — content not shown"
      )
    );
    fireEvent.click(findTreeItem(view.container, "file-1.ts"));
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledWith("state:1"));
    const stateCacheKey = view
      .getByTestId("pierre-diff")
      .getAttribute("data-cache-keys")
      ?.split("|")[1];
    expect(stateCacheKey).toBeTruthy();
    await waitFor(() =>
      expect(isItemVisible).toHaveBeenCalledWith("state:1", stateCacheKey)
    );
  });

  it("状态 section 使用各自的变更状态和旧路径，不复用聚合树状态", async () => {
    const path = "src/current.bin";
    const currentEntry: GitReviewIndexEntry = {
      ...entry(0, path),
      oldPaths: ["src/old.bin"],
      renderSlots: [
        {
          group: "unstaged",
          oldPath: null,
          sectionKey: "unstaged:binary",
          status: "modified",
          targetPath: "src/current.bin",
        },
        {
          group: "staged",
          oldPath: "src/old.bin",
          sectionKey: "staged:binary",
          status: "renamed",
          targetPath: "src/staged-current.bin",
        },
      ],
      status: "renamed",
    };
    const context = pluginContext({
      getReviewFileDocument: vi.fn(async () =>
        documentResult(0, [
          {
            kind: "state",
            oldPath: null,
            reason: "binary",
            sectionKey: "unstaged:binary",
            status: "modified",
            targetPath: "src/current.bin",
          },
          {
            kind: "state",
            oldPath: "src/old.bin",
            reason: "binary",
            sectionKey: "staged:binary",
            status: "renamed",
            targetPath: "src/staged-current.bin",
          },
        ])
      ),
      getReviewIndex: vi.fn(async () => indexResult([currentEntry])),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-ids",
        "staged:binary,unstaged:binary"
      )
    );
    expect(view.getByTestId("pierre-diff")).toHaveAttribute(
      "data-file-statuses",
      "renamed,modified"
    );
    expect(view.getByTestId("pierre-diff")).toHaveAttribute(
      "data-file-paths",
      "src/staged-current.bin,src/current.bin"
    );
    expect(view.getByTestId("pierre-diff")).toHaveAttribute(
      "data-previous-paths",
      "src/old.bin,"
    );
  });

  it("系统语言的解析 locale 变化会同时更新状态正文和缓存身份", async () => {
    let language = "en";
    let notifyAppearance: (appearance: RendererPluginAppearance) => void = () =>
      undefined;
    const context = pluginContext({
      appearance: {
        codeTheme: "github-dark",
        density: "compact",
        language: "system",
        locale: "en",
        theme: "dark",
        typography: {
          baseFontSize: "16px",
          codeFontFamily: "Berkeley Mono",
          fontFamily: "Inter",
        },
      },
      appearanceOnDidChange: (listener) => {
        notifyAppearance = listener;
        return () => undefined;
      },
      getReviewFileDocument: vi.fn(async () =>
        documentResult(0, [
          {
            kind: "patch",
            patch:
              "diff --git a/src/file-0.ts b/src/file-0.ts\n@@ -1 +1 @@\n-old\n+new\n",
            sectionKey: "patch:localized",
          },
          {
            kind: "state",
            oldPath: null,
            reason: "binary",
            sectionKey: "state:localized",
            status: "modified",
            targetPath: "src/file-0.ts",
          },
        ])
      ),
      getReviewIndex: vi.fn(async () =>
        indexResult([
          entry(0, "src/file-0.ts", [
            {
              group: "unstaged",
              oldPath: null,
              sectionKey: "patch:localized",
              status: "modified",
              targetPath: "src/file-0.ts",
            },
            {
              group: "staged",
              oldPath: null,
              sectionKey: "state:localized",
              status: "modified",
              targetPath: "src/file-0.ts",
            },
          ]),
        ])
      ),
      translate: (key, _values, fallback) => {
        if (
          language === "zh" &&
          (key === "ui.reviewStateBinary" ||
            key === "ui.reviewStateBinaryDetail")
        ) {
          return "二进制文件 — 不显示内容";
        }
        return fallback ?? "";
      },
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);
    const output = await view.findByTestId("pierre-diff");
    await waitFor(() =>
      expect(output).toHaveTextContent("Binary file — content not shown")
    );
    expect(output).toHaveTextContent("+new");
    const englishCacheKeys = output.getAttribute("data-cache-keys")?.split("|");

    language = "zh";
    act(() =>
      notifyAppearance({
        ...context.appearance.current(),
        language: "system",
        locale: "zh-CN",
      })
    );

    await waitFor(() =>
      expect(output).toHaveTextContent("二进制文件 — 不显示内容")
    );
    expect(output).not.toHaveTextContent("Binary file — content not shown");
    expect(output).toHaveTextContent("+new");
    const localizedCacheKeys = output
      .getAttribute("data-cache-keys")
      ?.split("|");
    // Item order is staged then unstaged; patch (index 1) is locale-stable,
    // state section (index 0) embeds localized copy in its cache key.
    expect(localizedCacheKeys?.[1]).toBe(englishCacheKeys?.[1]);
    expect(localizedCacheKeys?.[0]).not.toBe(englishCacheKeys?.[0]);
  });

  it("不可重试的 index 刷新失败后旧树窗口外文件仍可读取和定位", async () => {
    const entries = [
      ...Array.from({ length: 200 }, (_, index) => entry(index)),
      entry(200, "src/deferred-after-failure.ts"),
    ];
    let notify: () => void = () => undefined;
    const getReviewIndex = vi
      .fn()
      .mockResolvedValueOnce(indexResult(entries))
      .mockResolvedValueOnce({
        kind: "error",
        message: "refresh failed",
        reason: "commandFailed",
        retryable: false,
      });
    let deferredReads = 0;
    const getReviewFileDocument = vi.fn(async (request) => {
      if (request.source.path === "src/deferred-after-failure.ts") {
        deferredReads += 1;
        return documentResult(200);
      }
      const match = request.source.path.match(/file-(\d+)\.ts$/u);
      return documentResult(Number(match?.[1] ?? 0));
    });
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex,
      watch: (_gitRoot, listener) => {
        notify = () => listener({ changeKind: "worktree", gitRoot: ROOT });
        return () => undefined;
      },
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);
    await waitFor(() => expect(getReviewFileDocument).toHaveBeenCalled());
    expect(getReviewFileDocument.mock.calls.length).toBeLessThanOrEqual(96);

    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() => {
      expect(view.getByText("Failed to refresh changes")).toBeVisible();
    });
    expect(fileTree(view.container).textContent).toContain(
      "deferred-after-failure.ts"
    );
    expect(view.getByTestId("pierre-diff")).toHaveTextContent("+new");
    expect(view.queryByRole("button", { name: "Retry" })).toBeNull();
    fireEvent.click(findTreeItem(view.container, "deferred-after-failure.ts"));
    await waitFor(() => expect(deferredReads).toBe(1));
    await waitFor(() =>
      expect(scrollToItem).toHaveBeenCalledWith("section:200")
    );
  });

  it("刷新失败后可重试，并恢复用户选择的窗口外文件", async () => {
    const entries = [
      ...Array.from({ length: 200 }, (_, index) =>
        entry(index, `src/z-file-${String(index).padStart(3, "0")}.ts`)
      ),
      entry(200, "src/aaa-deferred.ts"),
    ];
    let notify: () => void = () => undefined;
    let deferredReads = 0;
    const getReviewFileDocument = vi.fn(async (request) => {
      if (request.source.path === "src/aaa-deferred.ts") {
        deferredReads += 1;
        return documentResult(200);
      }
      const match = request.source.path.match(/z-file-(\d+)\.ts$/u);
      return documentResult(Number(match?.[1] ?? 0));
    });
    const getReviewIndex = vi
      .fn()
      .mockResolvedValueOnce(indexResult(entries))
      .mockResolvedValueOnce({
        kind: "error",
        message: "refresh failed",
        reason: "commandFailed",
        retryable: true,
      })
      .mockResolvedValueOnce(indexResult(entries));
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex,
      watch: (_gitRoot, listener) => {
        notify = () => listener({ changeKind: "worktree", gitRoot: ROOT });
        return () => undefined;
      },
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);
    await waitFor(() => expect(getReviewFileDocument).toHaveBeenCalled());
    expect(getReviewFileDocument.mock.calls.length).toBeLessThanOrEqual(96);

    act(() => notify());
    await waitForRefreshWindow();
    await expect(
      view.findByText("Failed to refresh changes")
    ).resolves.toBeVisible();
    fireEvent.click(findTreeItem(view.container, "aaa-deferred.ts"));
    await waitFor(() => expect(deferredReads).toBe(1));
    await waitFor(() =>
      expect(scrollToItem).toHaveBeenCalledWith("section:200")
    );
    fireEvent.click(view.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(getReviewIndex).toHaveBeenCalledTimes(3));
  }, 15_000);

  it("刷新期间的树导航优先于已删除文件的旧锚点", async () => {
    let notify: () => void = () => undefined;
    const nextDocument = deferred<GitReviewFileDocumentResult>();
    const getReviewIndex = vi
      .fn()
      .mockResolvedValueOnce(indexResult([entry(0)]))
      .mockResolvedValueOnce(indexResult([entry(2)]));
    const getReviewFileDocument = vi
      .fn()
      .mockResolvedValueOnce(documentResult(0))
      .mockImplementationOnce(() => nextDocument.promise);
    captureTopAnchor.mockReturnValue({ id: "section:0", offset: -12 });
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex,
      watch: (_gitRoot, listener) => {
        notify = () => listener({ changeKind: "worktree", gitRoot: ROOT });
        return () => undefined;
      },
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);
    await waitFor(() => expect(view.getByTestId("pierre-diff")).toBeVisible());

    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() =>
      expect(fileTree(view.container).textContent).toContain("file-2.ts")
    );
    fireEvent.click(findTreeItem(view.container, "file-2.ts"));
    act(() => nextDocument.resolve(documentResult(2)));
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledWith("section:2"));
    expect(restoreAnchor).not.toHaveBeenCalled();
  });

  it("同组 hide/show 立即恢复树、选中与已加载正文", async () => {
    const entries = [entry(0), entry(1)];
    const file1Patch =
      "diff --git a/src/file-1.ts b/src/file-1.ts\n@@ -1 +1 @@\n-old\n+file-1-body\n";
    const getReviewIndex = vi.fn(async () => indexResult(entries));
    const getReviewFileDocument = vi.fn(async (request) => {
      if (request.source.path.endsWith("file-1.ts")) {
        return documentResult(1, [
          {
            kind: "patch",
            patch: file1Patch,
            sectionKey: "section:1",
          },
        ]);
      }
      return documentResult(0);
    });
    const context = pluginContext({ getReviewFileDocument, getReviewIndex });
    const Panel = createGitChangesPanel(context);
    const harness = createPanelHarness();
    const view = render(<Panel {...panelProps(harness)} />);

    await waitFor(() => expect(view.getByTestId("pierre-diff")).toBeVisible());
    fireEvent.click(findTreeItem(view.container, "file-1.ts"));
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveTextContent("file-1-body")
    );
    const sourceKey = JSON.stringify(scope);
    await waitFor(() =>
      expect(readReviewSession(sourceKey)?.index.kind).toBe("loaded")
    );
    const file1CallsBefore = getReviewFileDocument.mock.calls.filter((call) =>
      String(call[0]?.source?.path ?? "").endsWith("file-1.ts")
    ).length;
    const indexCallsBeforeHide = getReviewIndex.mock.calls.length;

    // 同组切 tab = hide，不是 close：session 必须保留。
    act(() => {
      harness.api.setVisible(false);
    });
    expect(view.queryByTestId("pierre-diff")).toBeNull();
    expect(readReviewSession(sourceKey)?.index.kind).toBe("loaded");
    expect(readReviewSession(sourceKey)?.loadedByEntryKey.size).toBeGreaterThan(
      0
    );

    act(() => {
      harness.api.setVisible(true);
    });
    // 树与正文立即从 session 恢复。
    expect(fileTree(view.container).textContent).toContain("file-0.ts");
    expect(fileTree(view.container).textContent).toContain("file-1.ts");
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveTextContent("file-1-body")
    );
    expect(
      getReviewFileDocument.mock.calls.filter((call) =>
        String(call[0]?.source?.path ?? "").endsWith("file-1.ts")
      )
    ).toHaveLength(file1CallsBefore);

    const header = view.container.querySelector(
      '[data-slot="file-panel-header"]'
    );
    expect(header).toBeInstanceOf(HTMLElement);
    expect(
      within(header as HTMLElement).queryByText("file-1.ts") ??
        findTreeItem(view.container, "file-1.ts").getAttribute("aria-selected")
    ).toBeTruthy();

    fireEvent.click(findTreeItem(view.container, "file-0.ts"));
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveTextContent(
        "diff --git a/src/file-0.ts"
      )
    );
    expect(getReviewIndex.mock.calls.length).toBeGreaterThanOrEqual(
      indexCallsBeforeHide
    );
  });

  it("关闭 panel 后回收 session，再打开冷启动", async () => {
    const entries = [entry(0), entry(1)];
    const getReviewIndex = vi.fn(async () => indexResult(entries));
    const getReviewFileDocument = vi.fn(async (request) =>
      documentResult(request.source.path.endsWith("file-1.ts") ? 1 : 0)
    );
    const context = pluginContext({ getReviewFileDocument, getReviewIndex });
    const Panel = createGitChangesPanel(context);
    const harness = createPanelHarness();
    const first = render(<Panel {...panelProps(harness)} />);

    await waitFor(() => expect(first.getByTestId("pierre-diff")).toBeVisible());
    fireEvent.click(findTreeItem(first.container, "file-1.ts"));
    await waitFor(() =>
      expect(first.getByTestId("pierre-diff")).toHaveTextContent(
        "diff --git a/src/file-1.ts"
      )
    );
    const sourceKey = JSON.stringify(scope);
    expect(readReviewSession(sourceKey)?.index.kind).toBe("loaded");

    // dockview 关闭：先 removePanel 事件，再 unmount。
    act(() => {
      harness.containerApi.removePanel();
    });
    expect(readReviewSession(sourceKey)).toBeNull();
    first.unmount();

    const second = render(<Panel {...panelProps(createPanelHarness())} />);
    await waitFor(() =>
      expect(fileTree(second.container).textContent).toContain("file-0.ts")
    );
    expect(getReviewIndex.mock.calls.length).toBeGreaterThan(1);
  });
});
