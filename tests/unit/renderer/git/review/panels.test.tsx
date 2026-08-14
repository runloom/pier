import type {
  PierDiffViewAnchor,
  PierDiffViewAppearance,
  PierDiffViewHandle,
  PierDiffViewItem,
  PierDiffViewRenderWindow,
} from "@pier/ui/diff-view/index.tsx";
import { resetTreeExpansionAuthoritiesForTests } from "@pier/ui/file/tree.tsx";
import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import type {
  RendererPluginAppearance,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { createGitChangesPanel } from "@plugins/builtin/git/renderer/changes-panel.tsx";
import { GitReviewDocumentGeneration } from "@plugins/builtin/git/renderer/review/document/generation.ts";
import { reconcileReviewDocumentSnapshot } from "@plugins/builtin/git/renderer/review/document/projection.ts";
import {
  beginGitReviewMutationTransition,
  commitGitReviewMutationTransition,
} from "@plugins/builtin/git/renderer/review/mutation-transitions.ts";
import {
  clearAllReviewSessionsForTests,
  readReviewSession,
  reviewSurfaceSessionKey,
} from "@plugins/builtin/git/renderer/review/session-cache.ts";
import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";
import type {
  GitReviewFileDocumentOk,
  GitReviewFileDocumentResult,
  GitReviewIndexEntry,
  GitReviewIndexOk,
  GitReviewIndexResult,
} from "@shared/contracts/git/review.ts";
import type { GitCommitSearchResult } from "@shared/contracts/git.ts";
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
import { patchDocument, stateDocument } from "./document-fixture.ts";

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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalScrollIntoView = Element.prototype.scrollIntoView;

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
  instanceSequence: 0,
  mounts: 0,
  onScroll: null as (() => void) | null,
  reportWindowOnScroll: true,
  unknownItemUpdates: [] as string[],
  unmounts: 0,
  visibleItemIds: [] as string[],
}));

vi.mock("@pier/ui/diff-view/index.tsx", () => ({
  PierDiffView: (props: {
    appearance: PierDiffViewAppearance;
    items: readonly PierDiffViewItem[];
    labels?: { readonly retry?: string };
    onRenderWindowChange?: (window: PierDiffViewRenderWindow) => void;
    onRetryItem?: (itemId: string) => void;
    onScroll?: () => void;
    ref?: React.Ref<PierDiffViewHandle>;
  }) => {
    const [renderedItems, setRenderedItems] = useState(props.items);
    const renderedItemsRef = useRef(props.items);
    const instanceIdRef = useRef(++diffViewRuntime.instanceSequence);
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
      // 小列表整窗可见，避免 seed 撤出后仅 1 项 visible 把邻项误 cancel。
      let visibleItemIds = retainedIds;
      if (retainedIds.length === 0) {
        visibleItemIds =
          renderedItems.length <= 8
            ? renderedItems.map((item) => item.id)
            : renderedItems.slice(0, 2).map((item) => item.id);
      }
      diffViewRuntime.visibleItemIds = visibleItemIds;
      let bufferedItemIds =
        retainedIds.length > 0
          ? diffViewRuntime.bufferedItemIds.filter((id) => itemIds.has(id))
          : [];
      if (retainedIds.length === 0 && renderedItems.length > 8) {
        bufferedItemIds = renderedItems.slice(2, 3).map((item) => item.id);
      }
      diffViewRuntime.bufferedItemIds = bufferedItemIds;
      const estimatedItemIds = renderedItems
        .filter(
          (item) =>
            item.kind === "estimate" &&
            (visibleItemIds.includes(item.id) ||
              bufferedItemIds.includes(item.id))
        )
        .map((item) => item.id);
      props.onRenderWindowChange?.({
        bufferedItemIds,
        estimatedItemIds,
        visibleItemIds,
      });
    }, [props.onRenderWindowChange, renderedItems]);
    useImperativeHandle(
      props.ref,
      () => ({
        captureTopAnchor,
        getScrollTop: () => null,
        getSelectedLines: () => null,
        getSelectedText: () => "",
        getViewportLayoutKey: (targetItemId?: string) =>
          `layout:${targetItemId ?? "none"}`,
        isItemVisible,
        isViewportReady: () => true,
        requestViewportLayoutSettled: (
          _targetItemId: string,
          _stableFrames: number,
          callback: () => void
        ) => {
          let cancelled = false;
          queueMicrotask(() => {
            if (!cancelled) {
              callback();
            }
          });
          return () => {
            cancelled = true;
          };
        },
        resolvePointerLineHit: () => null,
        restoreAnchor,
        scrollToItem(id) {
          const result = scrollToItem(id);
          diffViewRuntime.bufferedItemIds = [];
          diffViewRuntime.visibleItemIds = [id];
          if (diffViewRuntime.reportWindowOnScroll) {
            props.onRenderWindowChange?.({
              bufferedItemIds: [],
              estimatedItemIds: [],
              visibleItemIds: [id],
            });
          }
          return result;
        },
        scrollToLine: () => true,
        selectAll: () => false,
        setAllCollapsed: () => undefined,
        setScrollTop: () => false,
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
        data-pierre-instance-id={instanceIdRef.current}
        data-previous-paths={renderedItems
          .map((item) => item.fileDisplay?.previousPath ?? "")
          .join(",")}
        data-stage-control-count={
          renderedItems.filter((item) => item.stageControl != null).length
        }
        data-testid="pierre-diff"
        data-theme={
          props.appearance.colorMode === "light"
            ? props.appearance.codeThemes.light
            : props.appearance.codeThemes.dark
        }
      >
        {renderedItems
          .map((item) => item.stateNotice ?? item.patch ?? "")
          .join("\n")}
        {renderedItems
          .filter((item) => item.kind === "error" && props.onRetryItem)
          .map((item) => (
            <button
              data-testid="pier-diff-retry-button"
              key={`retry-${item.id}`}
              onClick={() => props.onRetryItem?.(item.id)}
              type="button"
            >
              {props.labels?.retry ?? "Retry"}
            </button>
          ))}
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
    entryKey: `entry:${index}`,
    oldPaths: [],
    path,
    renderSlots,
    status: "modified",
  };
}

function indexResult(
  entries = [entry(0)],
  groupSummaries: GitReviewIndexOk["groupSummaries"] = {}
): GitReviewIndexOk {
  return { entries, groupSummaries, kind: "ok", warnings: [] };
}

function documentResult(
  index: number,
  sections: readonly (
    | {
        readonly kind: "patch";
        readonly patch: string;
        readonly sectionKey: string;
      }
    | {
        readonly kind: "state";
        readonly oldPath: string | null;
        readonly reason:
          | "binary"
          | "conflict"
          | "invalidEncoding"
          | "readError"
          | "submodule"
          | "symlink"
          | "tooLarge";
        readonly sectionKey: string;
        readonly status: GitReviewIndexEntry["status"];
        readonly targetPath: string;
      }
  )[] = [
    {
      kind: "patch",
      patch: `diff --git a/src/file-${index}.ts b/src/file-${index}.ts\n@@ -1 +1 @@\n-old\n+new\n`,
      sectionKey: `section:${index}`,
    },
  ],
  surfaceOverrides?: Partial<GitReviewFileDocumentOk["surfaceSections"]>
): GitReviewFileDocumentOk {
  const entryKey = `entry:${index}`;
  const documentSections = sections.flatMap((content) => {
    if (content.kind === "state") {
      return stateDocument({
        entryKey,
        oldPath: content.oldPath,
        path: content.targetPath,
        reason: content.reason,
        revision: `document:${index}`,
        sectionKey: content.sectionKey,
        status: content.status,
      }).sections;
    }
    return patchDocument({
      entryKey,
      patch: content.patch,
      revision: `document:${index}`,
      sectionKey: content.sectionKey,
      stageState:
        content.sectionKey.includes("staged") &&
        !content.sectionKey.includes("unstaged")
          ? "staged"
          : "unstaged",
    }).sections;
  });
  const sectionKeys = documentSections.map((section) => section.sectionKey);
  const single = sectionKeys.length === 1 ? (sectionKeys[0] ?? null) : null;
  return {
    entryKey,
    kind: "ok",
    revision: `document:${index}`,
    sections: documentSections,
    surfaceSections: {
      committed:
        sectionKeys.find((sectionKey) => sectionKey.includes("committed")) ??
        null,
      head:
        sectionKeys.find(
          (sectionKey) =>
            sectionKey.includes("head:") || sectionKey.includes("conflict")
        ) ?? null,
      index:
        sectionKeys.find(
          (sectionKey) =>
            sectionKey.includes("unstaged") || sectionKey.startsWith("section:")
        ) ?? single,
      staged:
        sectionKeys.find(
          (sectionKey) =>
            sectionKey.includes("staged") && !sectionKey.includes("unstaged")
        ) ?? null,
      ...surfaceOverrides,
    },
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
    setTitle: vi.fn(),
    title: "Changes",
    updateParameters: vi.fn(),
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
  searchBranches?: RendererPluginContext["git"]["searchBranches"];
  searchCommits?: RendererPluginContext["git"]["searchCommits"];
  translate?: RendererPluginContext["i18n"]["t"];
  watch?: RendererPluginContext["git"]["watch"];
}): RendererPluginContext {
  const appearance: RendererPluginAppearance = input.appearance ?? {
    codeTheme: "github-dark",
    codeThemes: { dark: "github-dark", light: "github-light" },
    density: "compact",
    language: "en",
    locale: "en",
    theme: "dark",
    typography: {
      baseFontSize: "16px",
      codeFontFamily: "Berkeley Mono",
      codeFontSize: "13px",
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
    comments: {
      snapshot: vi.fn(async () => null),
      watch: vi.fn(() => () => undefined),
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
      getReviewFileDocument:
        input.getReviewFileDocument ?? vi.fn(async () => documentResult(0)),
      getReviewIndex: input.getReviewIndex ?? vi.fn(async () => indexResult()),
      searchBranches:
        input.searchBranches ??
        vi.fn(async () => ({
          currentBranch: "main",
          durationMs: 0,
          items: [],
          message: null,
          status: "ok" as const,
        })),
      searchCommits:
        input.searchCommits ??
        vi.fn(async () => ({
          durationMs: 0,
          items: [],
          message: null,
          status: "ok" as const,
        })),
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
        changeSummary: {
          changedFiles: 0,
          deletions: 0,
          excludedFiles: 0,
          insertions: 0,
          kind: "lineDelta" as const,
        },
        counts: { conflict: 0, modified: 0, staged: 0, untracked: 0 },
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
    notifications: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
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
  ].find((element) => {
    const label =
      element.getAttribute("aria-label") ?? element.textContent ?? "";
    return label.includes(name);
  });
  expect(item).toBeDefined();
  return item as Element;
}

function activeDiff(container: HTMLElement): HTMLElement {
  const activeSurface = container.querySelector(
    '[data-git-review-surface][aria-hidden="false"]'
  );
  const output = activeSurface?.querySelector('[data-testid="pierre-diff"]');
  expect(output).toBeInstanceOf(HTMLElement);
  return output as HTMLElement;
}

/** 直接打开默认优先「已暂存」；需要「更改」面时显式点 tab。 */
async function selectUncommittedTab(
  view: ReturnType<typeof render>,
  name: "Changes" | "Staged Changes" | "Merge Changes"
): Promise<void> {
  const tab = await view.findByRole("tab", { name });
  fireEvent.mouseDown(tab, { button: 0 });
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  globalThis.localStorage.clear();
  vi.restoreAllMocks();
  diffViewRuntime.error = null;
  diffViewRuntime.bufferedItemIds = [];
  diffViewRuntime.instanceSequence = 0;
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
  // Shared expansion authority scopes leak collapsed/expanded intents across
  // tests that reuse contextId + gitRoot; clear so file-ancestors seed re-runs.
  resetTreeExpansionAuthoritiesForTests();
  if (originalScrollIntoView) {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  } else {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  }
});

describe("Git review panel", () => {
  it("未提交页签复用目录树文案和顺序，并只展示树中存在的分组", async () => {
    const context = pluginContext({
      getReviewFileDocument: vi.fn(async () => documentResult(0)),
      getReviewIndex: vi.fn(async () => indexResult([entry(0)])),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    const switcher = await view.findByTestId("git-review-surface-switcher");
    const tabs = within(switcher).getAllByRole("tab");
    expect(tabs).toHaveLength(1);
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Changes"]);
    expect(within(switcher).queryByRole("tab", { name: "Merge Changes" })).toBe(
      null
    );
    expect(
      within(switcher).getByRole("tab", { name: "Changes" })
    ).toHaveAttribute("aria-selected", "true");
    expect(within(switcher).getByRole("tab", { name: "Changes" })).toHaveClass(
      "text-xs"
    );
    expect(
      within(switcher).queryByRole("tab", { name: "Staged Changes" })
    ).toBeNull();
    expect(within(switcher).queryByText("All Changes")).toBeNull();
  });

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
      view.getByRole("button", { name: "Hide changed files" })
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

    fireEvent.click(view.getByRole("button", { name: "Hide changed files" }));
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
      view.getByRole("button", { name: "Hide changed files" })
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
    fireEvent.click(view.getByRole("button", { name: "Hide changed files" }));
    fireEvent.click(view.getByRole("button", { name: "Show changed files" }));
    expect(view.queryByTestId("git-review-tree-search-bar")).toBeNull();
    expect(diffViewRuntime.mounts).toBe(initialDiffMounts);
    expect(diffViewRuntime.unmounts).toBe(initialDiffUnmounts);
    expect(getReviewIndex).toHaveBeenCalledTimes(1);
  });

  it("顶部摘要跟随当前未提交阅读面，并在行统计不完整时退回文件数", async () => {
    const path = "src/both.ts";
    const unstagedSectionKey = "unstaged:both";
    const stagedSectionKey = "staged:both";
    const bothSurfacesEntry = entry(0, path, [
      {
        group: "unstaged",
        oldPath: null,
        sectionKey: unstagedSectionKey,
        status: "modified",
        targetPath: path,
      },
      {
        group: "staged",
        oldPath: null,
        sectionKey: stagedSectionKey,
        status: "modified",
        targetPath: path,
      },
    ]);
    const context = pluginContext({
      getReviewFileDocument: vi.fn(async () =>
        documentResult(
          0,
          [
            {
              kind: "patch",
              patch: "unstaged patch",
              sectionKey: unstagedSectionKey,
            },
            {
              kind: "patch",
              patch: "staged patch",
              sectionKey: stagedSectionKey,
            },
          ],
          { index: unstagedSectionKey, staged: stagedSectionKey }
        )
      ),
      getReviewIndex: vi.fn(async () =>
        indexResult([bothSurfacesEntry], {
          staged: {
            changedFiles: 1,
            kind: "filesOnly",
            omittedFiles: 1,
            reasons: ["invalidEncoding"],
          },
          unstaged: {
            changedFiles: 1,
            deletions: 2,
            excludedFiles: 0,
            insertions: 7,
            kind: "lineDelta",
          },
        })
      ),
    });
    const Panel = createGitChangesPanel(context);
    const harness = createPanelHarness();
    const view = render(<Panel {...panelProps(harness.api)} />);

    // 默认面 = 已暂存；摘要在共享 header（不在 surface 内）
    await waitFor(() => {
      expect(
        view.container.querySelector(
          '[data-git-review-surface="staged"][aria-hidden="false"]'
        )
      ).toBeInstanceOf(HTMLElement);
    });
    const stagedSummary = await view.findByTestId("git-review-change-summary");
    expect(stagedSummary).toHaveClass("text-xs");
    expect(stagedSummary).toHaveTextContent("1 file");

    await selectUncommittedTab(view, "Changes");
    await waitFor(() => {
      expect(
        view.container.querySelector(
          '[data-git-review-surface="index"][aria-hidden="false"]'
        )
      ).toBeInstanceOf(HTMLElement);
      const summary = view.getByTestId("git-review-change-summary");
      expect(summary).toHaveTextContent("+7");
      expect(summary).toHaveTextContent("−2");
    });

    await selectUncommittedTab(view, "Staged Changes");
    await waitFor(() => {
      const summary = view.getByTestId("git-review-change-summary");
      expect(summary).toHaveTextContent("1 file");
      expect(summary).not.toHaveTextContent("+7");
      expect(summary).toHaveAttribute(
        "title",
        "Line totals are incomplete. Showing the changed file count."
      );
    });
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
    // 冷加载：侧栏树骨架可见
    expect(
      view.getByRole("status", { name: "Loading changed files" })
    ).toBeVisible();
    pendingIndex.resolve(indexResult([]));
    await expect(view.findByText("No changes")).resolves.toBeVisible();
    expect(
      view.container.querySelectorAll('[data-slot="file-panel-header"]')
    ).toHaveLength(1);
    // 空态：隐藏变更树侧栏，主区 Empty 为唯一占位
    expect(
      view.queryByRole("status", { name: "Loading changed files" })
    ).toBeNull();
    expect(
      view.container.querySelector(
        'file-tree-container[data-slot="pier-file-tree"]'
      )
    ).toBeNull();
    expect(
      view.queryByRole("button", { name: "Hide changed files" })
    ).toBeNull();
    expect(
      view.queryByRole("button", { name: "Find in changed files" })
    ).toBeNull();
  });

  it("当前阅读面没有成员时显示明确空态而不是空 CodeView", async () => {
    // 仅 unstaged 为空组：无 index entry 时整页空态（无空页签可切）
    // 产品空态：index 无任何变更 → No changes
    const context = pluginContext({
      getReviewIndex: vi.fn(async () => indexResult([])),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await expect(view.findByText("No changes")).resolves.toBeVisible();
    expect(
      view.container.querySelector('[data-testid="pierre-diff"]')
    ).toBeNull();
    // 方案 A：无变更不挂空目录树，也不展示树折叠/搜索 chrome。
    expect(
      view.container.querySelector(
        'file-tree-container[data-slot="pier-file-tree"]'
      )
    ).toBeNull();
    expect(
      view.queryByRole("button", { name: "Hide changed files" })
    ).toBeNull();
    expect(
      view.queryByRole("button", { name: "Show changed files" })
    ).toBeNull();
    expect(
      view.queryByRole("button", { name: "Find in changed files" })
    ).toBeNull();
  });

  it("仅已暂存有文件时直接打开默认聚焦已暂存面", async () => {
    const path = "src/staged-only.ts";
    const stagedSectionKey = "staged:only";
    const stagedEntry = entry(0, path, [
      {
        group: "staged",
        oldPath: null,
        sectionKey: stagedSectionKey,
        status: "modified",
        targetPath: path,
      },
    ]);
    const context = pluginContext({
      getReviewFileDocument: vi.fn(async () =>
        documentResult(0, [
          {
            kind: "patch",
            patch: "staged only",
            sectionKey: stagedSectionKey,
          },
        ])
      ),
      getReviewIndex: vi.fn(async () => indexResult([stagedEntry])),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() =>
      expect(
        view.container.querySelector(
          '[data-git-review-surface="staged"][aria-hidden="false"]'
        )
      ).toBeInstanceOf(HTMLElement)
    );
    expect(view.getByRole("tab", { name: "Staged Changes" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("外部 Git 操作清空当前阅读面时接受权威空态", async () => {
    const path = "src/externally-cleared.ts";
    const sectionKey = "unstaged:external";
    const initialEntry = entry(0, path, [
      {
        group: "unstaged",
        oldPath: null,
        sectionKey,
        status: "modified",
        targetPath: path,
      },
    ]);
    let notify: () => void = () => undefined;
    const getReviewIndex = vi
      .fn()
      .mockResolvedValueOnce(indexResult([initialEntry]))
      .mockResolvedValueOnce(indexResult([]));
    const context = pluginContext({
      getReviewFileDocument: vi.fn(async () =>
        documentResult(0, [
          {
            kind: "patch",
            patch: `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-old\n+new\n`,
            sectionKey,
          },
        ])
      ),
      getReviewIndex,
      watch: (_gitRoot, listener) => {
        notify = () => listener({ changeKind: "worktree", gitRoot: ROOT });
        return () => undefined;
      },
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() =>
      expect(activeDiff(view.container)).toHaveAttribute(
        "data-item-ids",
        sectionKey
      )
    );
    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() => expect(getReviewIndex).toHaveBeenCalledTimes(2));
    await expect(view.findByText("No changes")).resolves.toBeVisible();
    expect(
      view.container.querySelector('[data-testid="pierre-diff"]')
    ).toBeNull();
    // files→empty 过渡：权威空态下树与折叠/搜索 chrome 一并消失
    expect(
      view.container.querySelector(
        'file-tree-container[data-slot="pier-file-tree"]'
      )
    ).toBeNull();
    expect(
      view.queryByRole("button", { name: "Hide changed files" })
    ).toBeNull();
    expect(
      view.queryByRole("button", { name: "Show changed files" })
    ).toBeNull();
    expect(
      view.queryByRole("button", { name: "Find in changed files" })
    ).toBeNull();
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
      view.findByText("Git could not complete this operation. Try again.")
    ).resolves.toBeVisible();
    // 初次加载失败没有正文可看:错误是主体状态,用 Empty 呈现而非 Alert 横条。
    expect(
      view
        .getByText("Failed to load changes")
        .closest('[data-slot="error-empty"]')
    ).toBeVisible();
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.queryByText("initial index failed")).toBeNull();
    // 错误态与成功空态一致：不挂变更树与树 chrome
    expect(
      view.container.querySelector(
        'file-tree-container[data-slot="pier-file-tree"]'
      )
    ).toBeNull();
    expect(
      view.queryByRole("button", { name: "Hide changed files" })
    ).toBeNull();
    expect(
      view.queryByRole("button", { name: "Find in changed files" })
    ).toBeNull();
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
    await waitFor(() => expect(getReviewIndex).toHaveBeenCalledTimes(2));
    // 背景 index 刷新失败：零 toast；空态仍可读；下一次 watch 自愈。
    expect(context.notifications.error).not.toHaveBeenCalled();
    expect(context.notifications.info).not.toHaveBeenCalled();
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("No changes")).toBeVisible();

    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() => {
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
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledWith("section:0"));
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
    await waitFor(() =>
      expect(getReviewFileDocument.mock.calls.length).toBeGreaterThanOrEqual(2)
    );
    await waitFor(() => expect(view.getByTestId("pierre-diff")).toBeVisible());
    expect(scrollToItem).not.toHaveBeenCalled();
  });

  it("同仓 target 切换会重建 CodeView，并只读取新 target 的正文", async () => {
    const committedEntry = entry(1, "src/committed.ts", [
      {
        group: "committed",
        oldPath: null,
        sectionKey: "committed:1",
        status: "modified",
        targetPath: "src/committed.ts",
      },
    ]);
    const getReviewIndex = vi
      .fn()
      .mockResolvedValueOnce(
        indexResult([entry(0)], {
          unstaged: {
            changedFiles: 1,
            deletions: 1,
            excludedFiles: 0,
            insertions: 3,
            kind: "lineDelta",
          },
        })
      )
      .mockResolvedValueOnce(
        indexResult([committedEntry], {
          committed: {
            changedFiles: 1,
            deletions: 4,
            excludedFiles: 0,
            insertions: 9,
            kind: "lineDelta",
          },
        })
      );
    const getReviewFileDocument = vi.fn(async (request) =>
      request.source.target.kind === "commit"
        ? documentResult(
            1,
            [
              {
                kind: "patch",
                patch:
                  "diff --git a/src/committed.ts b/src/committed.ts\n@@ -1 +1 @@\n-old\n+commit\n",
                sectionKey: "committed:1",
              },
            ],
            { committed: "committed:1", head: null, index: null, staged: null }
          )
        : documentResult(0)
    );
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex,
    });
    const Panel = createGitChangesPanel(context);
    const props = panelProps(createPanelHarness().api);
    const view = render(<Panel {...props} />);
    const oldRoot = await view.findByTestId("pierre-diff");
    expect(view.getByTestId("git-review-change-summary")).toHaveTextContent(
      "+3"
    );
    fireEvent.click(findTreeItem(view.container, "file-0.ts"));
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledWith("section:0"));
    scrollToItem.mockClear();

    const commitOid = "a".repeat(40);
    const commitSource = {
      contextId: panelContext.contextId,
      gitRootPath: ROOT,
      target: { kind: "commit" as const, oid: commitOid },
    };
    view.rerender(
      <Panel
        {...({
          ...props,
          params: { context: panelContext, source: commitSource },
        } as IDockviewPanelProps)}
      />
    );

    await waitFor(() =>
      expect(getReviewIndex).toHaveBeenLastCalledWith(
        expect.objectContaining({ source: commitSource })
      )
    );
    await waitFor(() =>
      expect(getReviewFileDocument).toHaveBeenLastCalledWith(
        expect.objectContaining({
          source: expect.objectContaining({
            target: { kind: "commit", oid: commitOid },
          }),
        })
      )
    );
    const newRoot = await view.findByTestId("pierre-diff");
    expect(newRoot).not.toBe(oldRoot);
    expect(newRoot).toHaveAttribute("data-item-ids", "committed:1");
    expect(newRoot).not.toHaveAttribute("data-item-ids", "section:0");
    expect(scrollToItem).not.toHaveBeenCalled();
    expect(view.getByTestId("git-review-change-summary")).toHaveTextContent(
      "+9"
    );
    expect(view.getByTestId("git-review-change-summary")).not.toHaveTextContent(
      "+3"
    );
  });

  it("目标冷切换在 estimate 期间可挂 CodeView，水合后露出真正文", async () => {
    const committedEntry = entry(1, "src/committed.ts", [
      {
        group: "committed",
        oldPath: null,
        sectionKey: "committed:1",
        status: "modified",
        targetPath: "src/committed.ts",
      },
    ]);
    const laterCommittedEntry = entry(2, "src/later.ts", [
      {
        group: "committed",
        oldPath: null,
        sectionKey: "committed:2",
        status: "modified",
        targetPath: "src/later.ts",
      },
    ]);
    const committedDocument = deferred<GitReviewFileDocumentResult>();
    const laterCommittedDocument = deferred<GitReviewFileDocumentResult>();
    const getReviewIndex = vi
      .fn()
      .mockResolvedValueOnce(indexResult([entry(0)]))
      .mockResolvedValueOnce(
        indexResult([committedEntry, laterCommittedEntry])
      );
    const getReviewFileDocument = vi.fn((request) => {
      if (request.source.target.kind !== "commit") {
        return Promise.resolve(documentResult(0));
      }
      if (request.source.path === committedEntry.path) {
        return committedDocument.promise;
      }
      return laterCommittedDocument.promise;
    });
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex,
    });
    const Panel = createGitChangesPanel(context);
    const props = panelProps(createPanelHarness().api);
    const view = render(<Panel {...props} />);
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveTextContent("+new")
    );

    const commitSource = {
      contextId: panelContext.contextId,
      gitRootPath: ROOT,
      target: { kind: "commit" as const, oid: "a".repeat(40) },
    };
    view.rerender(
      <Panel
        {...({
          ...props,
          params: { context: panelContext, source: commitSource },
        } as IDockviewPanelProps)}
      />
    );

    await waitFor(() => {
      expect(
        getReviewFileDocument.mock.calls.filter(
          ([request]) => request.source.target.kind === "commit"
        )
      ).toHaveLength(2);
    });
    // 有 index 槽后即可挂 CodeView，禁止整页 loading 挡住水合
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toBeInTheDocument()
    );

    await act(async () => {
      laterCommittedDocument.resolve(
        documentResult(
          2,
          [
            {
              kind: "patch",
              patch:
                "diff --git a/src/later.ts b/src/later.ts\n@@ -1 +1 @@\n-old\n+later\n",
              sectionKey: "committed:2",
            },
          ],
          { committed: "committed:2", head: null, index: null, staged: null }
        )
      );
      committedDocument.resolve(
        documentResult(
          1,
          [
            {
              kind: "patch",
              patch:
                "diff --git a/src/committed.ts b/src/committed.ts\n@@ -1 +1 @@\n-old\n+commit\n",
              sectionKey: "committed:1",
            },
          ],
          { committed: "committed:1", head: null, index: null, staged: null }
        )
      );
      await Promise.all([
        laterCommittedDocument.promise,
        committedDocument.promise,
      ]);
    });
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveTextContent("+commit")
    );
  });

  it("首次打开在 estimate 期间即可挂 CodeView，水合后露出真正文", async () => {
    // 不得整页 ReviewLoading 挡住：冷开 estimate 必须可挂 Pierre 才能报 window / 水合。
    const firstDocument = deferred<GitReviewFileDocumentResult>();
    const laterDocument = deferred<GitReviewFileDocumentResult>();
    const trailingDocument = deferred<GitReviewFileDocumentResult>();
    const getReviewFileDocument = vi.fn((request) => {
      if (request.source.path === "src/file-0.ts") {
        return firstDocument.promise;
      }
      return request.source.path === "src/file-1.ts"
        ? laterDocument.promise
        : trailingDocument.promise;
    });
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex: vi.fn(async () =>
        indexResult([entry(0), entry(1), entry(2)])
      ),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() =>
      expect(getReviewFileDocument.mock.calls.length).toBeGreaterThanOrEqual(2)
    );
    // CodeView 在 estimate 阶段就应挂上（不再 aria-hidden 整页遮罩）
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toBeInTheDocument()
    );
    expect(
      view.getByTestId("pierre-diff").closest('[aria-hidden="true"]')
    ).toBeNull();

    await act(async () => {
      laterDocument.resolve(documentResult(1));
      firstDocument.resolve(documentResult(0));
      trailingDocument.resolve(documentResult(2));
      await Promise.all([
        laterDocument.promise,
        firstDocument.promise,
        trailingDocument.promise,
      ]);
    });
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveTextContent("+new")
    );
  });

  it("自动选择目标期间立即隐藏旧目标正文并展示骨架", async () => {
    const commitSearch = deferred<GitCommitSearchResult>();
    const context = pluginContext({
      getReviewFileDocument: vi.fn(async () => documentResult(0)),
      getReviewIndex: vi.fn(async () => indexResult([entry(0)])),
      searchCommits: vi.fn(() => commitSearch.promise),
    });
    const Panel = createGitChangesPanel(context);
    const harness = createPanelHarness();
    const view = render(<Panel {...panelProps(harness.api)} />);
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveTextContent("+new")
    );

    fireEvent.click(view.getByTestId("git-review-scope-switcher"));
    fireEvent.click(await view.findByRole("option", { name: "Commit" }));

    await waitFor(() =>
      expect(
        view.getByRole("status", { name: "Loading changes" })
      ).toBeVisible()
    );
    expect(view.queryByTestId("pierre-diff")).toBeNull();
    expect(view.queryByTestId("git-review-change-summary")).toBeNull();
    expect(
      view.container.querySelector(
        'file-tree-container[data-slot="pier-file-tree"]'
      )
    ).toBeNull();

    const commitOid = "b".repeat(40);
    act(() => {
      commitSearch.resolve({
        durationMs: 1,
        items: [
          {
            author: "dev",
            date: "2026-07-29",
            hash: commitOid,
            message: "fix review transition",
          },
        ],
        message: null,
        status: "ok",
      });
    });
    await waitFor(() =>
      expect(harness.api.updateParameters).toHaveBeenCalledWith({
        source: {
          ...scope,
          target: { kind: "commit", oid: commitOid },
        },
        tabChangeSummary: null,
      })
    );
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

    // 金标准：content 全表 estimate 账本（折叠总高 = n×header）；demand 只调度 document 读
    await waitFor(() => {
      const count = Number(
        view.getByTestId("pierre-diff").getAttribute("data-item-count")
      );
      expect(count).toBe(201);
    });
    fireEvent.click(findTreeItem(view.container, "aaa-selected.ts"));
    await waitFor(() => expect(selectedReads).toBe(1));
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-ids",
        expect.stringContaining("section:200")
      )
    );
    await waitFor(() =>
      expect(scrollToItem).toHaveBeenCalledWith("section:200")
    );

    refreshing = true;
    act(() => notify());
    await waitForRefreshWindow();
    // 跨刷新仍会尝试重读选中项；soft-retain 可保正文在投影中
    await waitFor(() => expect(selectedReads).toBeGreaterThanOrEqual(2), {
      timeout: 10_000,
    });
    expect(view.getByTestId("pierre-diff")).toHaveAttribute(
      "data-item-ids",
      expect.stringContaining("section:200")
    );

    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() => expect(selectedReads).toBeGreaterThanOrEqual(3), {
      timeout: 10_000,
    });
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
    // soft-retain：旧正文仍在；背景刷新失败零 toast（2026-08-02 契约）
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-ids",
        expect.stringContaining("section:199")
      )
    );
    expect(context.notifications.error).not.toHaveBeenCalled();
    expect(context.notifications.info).not.toHaveBeenCalled();
  }, 20_000);

  it("Pierre 渲染失败时显示错误，并可通过重试恢复正文", async () => {
    diffViewRuntime.error = new Error("Pierre chunk unavailable");
    const context = pluginContext({});
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await expect(
      view.findByText("Failed to render diff")
    ).resolves.toBeVisible();
    // F1：面板内 Empty，禁止全局 toast（契约 2026-08-02）
    expect(context.notifications.error).not.toHaveBeenCalled();
    expect(context.notifications.info).not.toHaveBeenCalled();
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
    expect(context.notifications.error).not.toHaveBeenCalled();
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
    expect(context.notifications.error).not.toHaveBeenCalled();
    expect(context.notifications.info).not.toHaveBeenCalled();

    diffViewRuntime.error = null;
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveTextContent("+new")
    );
    expect(getReviewFileDocument).toHaveBeenCalledTimes(readsBeforeFailure);
    expect(context.notifications.error).not.toHaveBeenCalled();
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
        unstagedSlot.sectionKey
      )
    );
    fireEvent.mouseDown(view.getByRole("tab", { name: "Staged Changes" }), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() =>
      expect(activeDiff(view.container)).toHaveAttribute(
        "data-item-ids",
        stagedSlot.sectionKey
      )
    );
    expect(diffViewRuntime.unknownItemUpdates).toEqual([]);
  });

  it.each([
    {
      initialGroup: "unstaged" as const,
      initialSectionKey: "unstaged:only",
      targetGroup: "staged" as const,
      targetSectionKey: "staged:only",
      targetSurface: "staged" as const,
    },
    {
      initialGroup: "staged" as const,
      initialSectionKey: "staged:only",
      targetGroup: "unstaged" as const,
      targetSectionKey: "unstaged:only",
      targetSurface: "index" as const,
    },
  ])("暂存状态迁移使源分组为空时原子切换 $initialGroup → $targetGroup", async ({
    initialGroup,
    initialSectionKey,
    targetGroup,
    targetSectionKey,
    targetSurface,
  }) => {
    const sourceSurface = targetSurface === "staged" ? "index" : "staged";
    const path = "src/single-surface.ts";
    const initialEntry = entry(0, path, [
      {
        group: initialGroup,
        oldPath: null,
        sectionKey: initialSectionKey,
        status: "modified",
        targetPath: path,
      },
    ]);
    const targetEntry = entry(0, path, [
      {
        group: targetGroup,
        oldPath: null,
        sectionKey: targetSectionKey,
        status: "modified",
        targetPath: path,
      },
    ]);
    let notify: () => void = () => undefined;
    const getReviewIndex = vi
      .fn()
      .mockResolvedValueOnce(indexResult([initialEntry]))
      .mockResolvedValueOnce(indexResult([targetEntry]));
    let documentRead = 0;
    const getReviewFileDocument = vi.fn(async () => {
      documentRead += 1;
      const sectionKey =
        documentRead === 1 ? initialSectionKey : targetSectionKey;
      return documentResult(
        0,
        [
          {
            kind: "patch",
            patch: `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-old\n+${sectionKey}\n`,
            sectionKey,
          },
        ],
        {
          index: targetSurface === "index" ? sectionKey : null,
          staged: targetSurface === "staged" ? sectionKey : null,
        }
      );
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

    if (initialGroup === "staged") {
      fireEvent.mouseDown(
        await view.findByRole("tab", { name: "Staged Changes" }),
        {
          button: 0,
          ctrlKey: false,
        }
      );
    }
    await waitFor(() =>
      expect(activeDiff(view.container)).toHaveAttribute(
        "data-item-ids",
        initialSectionKey
      )
    );
    const transitionId = crypto.randomUUID();
    act(() =>
      beginGitReviewMutationTransition({
        contextId: panelContext.contextId,
        gitRootPath: ROOT,
        path,
        targetSurface,
        transitionId,
      })
    );
    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() => expect(getReviewIndex).toHaveBeenCalledTimes(2));
    act(() => commitGitReviewMutationTransition(transitionId));

    await waitFor(() => expect(documentRead).toBeGreaterThanOrEqual(2));
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-git-review-navigation-surface]")
      ).toHaveAttribute("data-git-review-navigation-surface", "")
    );
    await waitFor(() =>
      expect(
        view.container.querySelector(
          `[data-git-review-surface="${targetSurface}"][aria-hidden="false"]`
        )
      ).toBeInTheDocument()
    );
    expect(getReviewIndex).toHaveBeenCalledTimes(2);
    const targetTabName =
      targetSurface === "staged" ? "Staged Changes" : "Changes";
    const sourceTabName =
      sourceSurface === "staged" ? "Staged Changes" : "Changes";
    // 页签在共享 header；空组不会出现
    expect(view.getByRole("tab", { name: targetTabName })).toBeVisible();
    expect(view.queryByRole("tab", { name: sourceTabName })).toBeNull();
    expect(activeDiff(view.container)).toHaveAttribute(
      "data-item-ids",
      targetSectionKey
    );
  });

  it("目标阅读面仍在后台准备时，当前阅读面独立提交权威投影", async () => {
    const movedPath = "src/moved.ts";
    const stablePath = "src/stable.ts";
    const movedUnstaged = "unstaged:moved";
    const movedStaged = "staged:moved";
    const stableUnstaged = "unstaged:stable";
    const initialEntries = [
      entry(0, movedPath, [
        {
          group: "unstaged",
          oldPath: null,
          sectionKey: movedUnstaged,
          status: "modified",
          targetPath: movedPath,
        },
      ]),
      entry(1, stablePath, [
        {
          group: "unstaged",
          oldPath: null,
          sectionKey: stableUnstaged,
          status: "modified",
          targetPath: stablePath,
        },
      ]),
    ];
    const refreshedEntries = [
      entry(0, movedPath, [
        {
          group: "staged",
          oldPath: null,
          sectionKey: movedStaged,
          status: "modified",
          targetPath: movedPath,
        },
      ]),
      initialEntries[1] as GitReviewIndexEntry,
    ];
    const targetDocument = deferred<GitReviewFileDocumentResult>();
    let notify: () => void = () => undefined;
    let stableReads = 0;
    let movedReads = 0;
    const getReviewFileDocument = vi.fn(async (request) => {
      if (request.source.path === movedPath) {
        movedReads += 1;
        if (movedReads > 1) {
          return targetDocument.promise;
        }
        return documentResult(
          0,
          [
            {
              kind: "patch",
              patch: `diff --git a/${movedPath} b/${movedPath}\n@@ -1 +1 @@\n-old\n+old-moved\n`,
              sectionKey: movedUnstaged,
            },
          ],
          { index: movedUnstaged, staged: null }
        );
      }
      stableReads += 1;
      return documentResult(
        1,
        [
          {
            kind: "patch",
            patch: `diff --git a/${stablePath} b/${stablePath}\n@@ -1 +1 @@\n-old\n+${stableReads === 1 ? "old-stable" : "fresh-stable"}\n`,
            sectionKey: stableUnstaged,
          },
        ],
        { index: stableUnstaged, staged: null }
      );
    });
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex: vi
        .fn()
        .mockResolvedValueOnce(indexResult(initialEntries))
        .mockResolvedValueOnce(indexResult(refreshedEntries)),
      watch: (_gitRoot, listener) => {
        notify = () => listener({ changeKind: "worktree", gitRoot: ROOT });
        return () => undefined;
      },
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() =>
      expect(activeDiff(view.container)).toHaveAttribute(
        "data-item-ids",
        `${movedUnstaged},${stableUnstaged}`
      )
    );
    const transitionId = crypto.randomUUID();
    act(() =>
      beginGitReviewMutationTransition({
        contextId: panelContext.contextId,
        gitRootPath: ROOT,
        path: movedPath,
        targetSurface: "staged",
        transitionId,
      })
    );
    act(() => commitGitReviewMutationTransition(transitionId));
    act(() => notify());
    await waitForRefreshWindow();

    await waitFor(() => expect(stableReads).toBeGreaterThanOrEqual(2));
    // 当前 index 阅读面独立提交权威投影（仅剩 stable unstaged）。
    await waitFor(() =>
      expect(activeDiff(view.container)).toHaveAttribute(
        "data-item-ids",
        stableUnstaged
      )
    );
    expect(activeDiff(view.container)).toHaveTextContent("fresh-stable");
    // soft-retain 可让 staged 目标面立刻就绪并清掉 navigation 标记；
    // 仍在等权威文档时也可能短暂标 staged——两者均可。
    const navigationSurface = view.container.querySelector(
      "[data-git-review-navigation-surface]"
    );
    expect(["", "staged"]).toContain(
      navigationSurface?.getAttribute("data-git-review-navigation-surface")
    );

    act(() => {
      targetDocument.resolve(
        documentResult(
          0,
          [
            {
              kind: "patch",
              patch: `diff --git a/${movedPath} b/${movedPath}\n@@ -1 +1 @@\n-old\n+fresh-moved\n`,
              sectionKey: movedStaged,
            },
          ],
          { index: null, staged: movedStaged }
        )
      );
    });
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-git-review-navigation-surface]")
      ).toHaveAttribute("data-git-review-navigation-surface", "")
    );
  });

  it("mutation 前旧读取不能越过 ack stateSequence 因果屏障", async () => {
    const path = "src/causal-barrier.ts";
    const unstagedSectionKey = "unstaged:causal";
    const stagedSectionKey = "staged:causal";
    const bothSurfacesEntry = entry(0, path, [
      {
        group: "unstaged",
        oldPath: null,
        sectionKey: unstagedSectionKey,
        status: "modified",
        targetPath: path,
      },
      {
        group: "staged",
        oldPath: null,
        sectionKey: stagedSectionKey,
        status: "modified",
        targetPath: path,
      },
    ]);
    const indexAt = (stateSequence: number, indexRevision: string) => ({
      ...indexResult([bothSurfacesEntry]),
      indexRevision,
      stateSequence,
    });
    let notify: () => void = () => undefined;
    const getReviewIndex = vi
      .fn()
      .mockResolvedValueOnce(indexAt(1, "index:initial"))
      .mockResolvedValueOnce(indexAt(2, "index:old-in-flight"))
      .mockResolvedValueOnce(indexAt(3, "index:after-mutation"));
    const context = pluginContext({
      getReviewFileDocument: vi.fn(async () =>
        documentResult(
          0,
          [
            {
              kind: "patch",
              patch: `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-old\n+unstaged\n`,
              sectionKey: unstagedSectionKey,
            },
            {
              kind: "patch",
              patch: `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-old\n+staged\n`,
              sectionKey: stagedSectionKey,
            },
          ],
          { index: unstagedSectionKey, staged: stagedSectionKey }
        )
      ),
      getReviewIndex,
      watch: (_gitRoot, listener) => {
        notify = () => listener({ changeKind: "worktree", gitRoot: ROOT });
        return () => undefined;
      },
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await selectUncommittedTab(view, "Changes");
    await waitFor(() =>
      expect(activeDiff(view.container)).toHaveAttribute(
        "data-item-ids",
        unstagedSectionKey
      )
    );
    const transitionId = crypto.randomUUID();
    act(() =>
      beginGitReviewMutationTransition({
        contextId: panelContext.contextId,
        gitRootPath: ROOT,
        path,
        targetSurface: "staged",
        transitionId,
      })
    );

    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() => expect(getReviewIndex).toHaveBeenCalledTimes(2));
    act(() => commitGitReviewMutationTransition(transitionId, 3));

    await waitFor(() =>
      expect(
        view.container.querySelector(
          '[data-git-review-surface="staged"][aria-hidden="true"]'
        )
      ).toBeInTheDocument()
    );
    expect(
      view.container.querySelector(
        '[data-git-review-surface="index"][aria-hidden="false"]'
      )
    ).toBeInTheDocument();

    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() => expect(getReviewIndex).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-git-review-navigation-surface]")
      ).toHaveAttribute("data-git-review-navigation-surface", "")
    );
    expect(
      view.container.querySelector(
        '[data-git-review-surface="staged"][aria-hidden="true"]'
      )
    ).toBeInTheDocument();
    expect(
      view.container.querySelector(
        '[data-git-review-surface="index"][aria-hidden="false"]'
      )
    ).toBeInTheDocument();
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

  it("同一路径 staged 与 unstaged 保留两个树项并路由到独立阅读面", async () => {
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

    await selectUncommittedTab(view, "Changes");
    await waitFor(() =>
      expect(activeDiff(view.container)).toHaveAttribute(
        "data-item-ids",
        "unstaged:app"
      )
    );
    const appRows = [
      ...fileTree(view.container).querySelectorAll('[role="treeitem"]'),
    ].filter((element) => {
      const label =
        element.getAttribute("aria-label") ?? element.textContent ?? "";
      return label.includes("app.ts");
    });
    expect(appRows).toHaveLength(2);
    const scrolledSectionIds: string[] = [];
    for (const row of appRows) {
      scrollToItem.mockClear();
      fireEvent.click(row);
      const sectionId = await waitFor(() => {
        const next = scrollToItem.mock.calls[0]?.[0];
        expect(next).toBeTruthy();
        return next;
      });
      if (typeof sectionId === "string") {
        scrolledSectionIds.push(sectionId);
      }
    }
    expect(scrolledSectionIds.sort()).toEqual(
      ["staged:app", "unstaged:app"].sort()
    );
  });

  it("冲突树条目保留语义选中态，并只定位一次真实正文", async () => {
    const path = "src/conflict.ts";
    const conflictEntry = entry(0, path, [
      {
        group: "conflict",
        oldPath: null,
        sectionKey: "conflict:app",
        status: "conflicted",
        targetPath: path,
      },
    ]);
    const context = pluginContext({
      getReviewFileDocument: vi.fn(async () =>
        documentResult(
          0,
          [
            {
              kind: "patch",
              patch:
                "diff --git a/src/conflict.ts b/src/conflict.ts\n@@ -1 +1 @@\n-a\n+b\n",
              sectionKey: "conflict:app",
            },
          ],
          { head: "conflict:app", index: null, staged: null }
        )
      ),
      getReviewIndex: vi.fn(async () => indexResult([conflictEntry])),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    const row = await waitFor(() => {
      const next = findTreeItem(view.container, "conflict.ts");
      expect(next).toBeVisible();
      return next;
    });
    await waitFor(() =>
      expect(
        view.container.querySelector(
          '[data-git-review-surface="conflict"][aria-hidden="false"]'
        )
      ).toBeInTheDocument()
    );
    const switcher = view.getByTestId("git-review-surface-switcher");
    expect(
      within(switcher)
        .getAllByRole("tab")
        .map((tab) => tab.textContent)
    ).toEqual(["Merge Changes"]);
    scrollToItem.mockClear();
    fireEvent.click(row);

    await waitFor(() =>
      expect(activeDiff(view.container)).toHaveAttribute(
        "data-item-ids",
        "conflict:app"
      )
    );
    await waitFor(() =>
      expect(scrollToItem).toHaveBeenCalledWith("conflict:app")
    );
    expect(
      scrollToItem.mock.calls.filter(([id]) => id === "conflict:app")
    ).toHaveLength(1);
    expect(
      view.container.querySelector(
        '[data-git-review-surface="conflict"][aria-hidden="false"]'
      )
    ).toBeInTheDocument();
    expect(activeDiff(view.container)).toHaveAttribute(
      "data-item-ids",
      "conflict:app"
    );
    expect(row).toHaveAttribute("aria-selected", "true");
  });

  it("冲突分组消失时先物化同文件普通更改，再切换活动阅读面", async () => {
    const path = "src/resolved.ts";
    const conflictEntry = entry(0, path, [
      {
        group: "conflict",
        oldPath: null,
        sectionKey: "conflict:resolved",
        status: "conflicted",
        targetPath: path,
      },
    ]);
    const resolvedEntry = entry(0, path, [
      {
        group: "unstaged",
        oldPath: null,
        sectionKey: "unstaged:resolved",
        status: "modified",
        targetPath: path,
      },
    ]);
    let notify: () => void = () => undefined;
    let documentRead = 0;
    const resolvedDocument = deferred<GitReviewFileDocumentResult>();
    const context = pluginContext({
      getReviewFileDocument: vi.fn(async () => {
        documentRead += 1;
        if (documentRead > 1) {
          return resolvedDocument.promise;
        }
        return documentResult(
          0,
          [
            {
              kind: "patch",
              patch: `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-old\n+conflict\n`,
              sectionKey: "conflict:resolved",
            },
          ],
          {
            head: "conflict:resolved",
            index: null,
            staged: null,
          }
        );
      }),
      getReviewIndex: vi
        .fn()
        .mockResolvedValueOnce(indexResult([conflictEntry]))
        .mockResolvedValueOnce(indexResult([resolvedEntry])),
      watch: (_gitRoot, listener) => {
        notify = () => listener({ changeKind: "worktree", gitRoot: ROOT });
        return () => undefined;
      },
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    fireEvent.click(
      await waitFor(() => {
        const row = findTreeItem(view.container, "resolved.ts");
        expect(row).toBeVisible();
        return row;
      })
    );
    await waitFor(() =>
      expect(activeDiff(view.container)).toHaveAttribute(
        "data-item-ids",
        "conflict:resolved"
      )
    );

    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() => expect(documentRead).toBeGreaterThanOrEqual(2));

    await act(async () =>
      resolvedDocument.resolve(
        documentResult(
          0,
          [
            {
              kind: "patch",
              patch: `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-old\n+resolved\n`,
              sectionKey: "unstaged:resolved",
            },
          ],
          {
            head: "unstaged:resolved",
            index: "unstaged:resolved",
            staged: null,
          }
        )
      )
    );

    // 冲突消失后落到普通更改面并展示已物化正文
    await waitFor(() =>
      expect(
        view.container.querySelector(
          '[data-git-review-surface="index"][aria-hidden="false"]'
        )
      ).toBeInTheDocument()
    );
    await waitFor(() =>
      expect(activeDiff(view.container)).toHaveAttribute(
        "data-item-ids",
        "unstaged:resolved"
      )
    );
    const activeSurface = view.container.querySelector(
      '[data-git-review-surface="index"][aria-hidden="false"]'
    );
    expect(activeSurface).toBeInstanceOf(HTMLElement);
    // 页签在共享 header，不在 surface 内
    const switcher = view.getByTestId("git-review-surface-switcher");
    expect(switcher.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(
      [...switcher.querySelectorAll('[role="tab"]')].map(
        (tab) => tab.textContent
      )
    ).toEqual(["Changes"]);
  });

  it("远树点击：正文水合前保留当前视口，水合后只定位一次", async () => {
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

    // 全 content 账本：远文件首帧即有 estimate id，点树只 boost demand + scrollTo
    await waitFor(() => expect(view.getByTestId("pierre-diff")).toBeTruthy());
    const unmountsBefore = diffViewRuntime.unmounts;
    await waitFor(() =>
      expect(
        view.getByTestId("pierre-diff").getAttribute("data-item-ids")
      ).toContain("section:79")
    );

    fireEvent.click(findTreeItem(view.container, "aaa-far.ts"));
    await waitFor(() =>
      expect(
        scrollToItem.mock.calls.filter(([id]) => id === "section:79").length
      ).toBeGreaterThanOrEqual(1)
    );
    await waitFor(() => expect(farRequested).toBe(true));
    const scrollsBeforeLoad = scrollToItem.mock.calls.filter(
      ([id]) => id === "section:79"
    ).length;

    act(() => farPending.resolve(documentResult(79)));
    await waitFor(() =>
      expect(
        view.getByTestId("pierre-diff").getAttribute("data-cache-keys")
      ).toMatch(/git-review-section:section:79/)
    );
    // estimate 与 loaded 各至多一次定位（cacheKey 变体）；禁止连环 scroll
    const scrollsAfterLoad = scrollToItem.mock.calls.filter(
      ([id]) => id === "section:79"
    ).length;
    expect(scrollsAfterLoad).toBeGreaterThanOrEqual(scrollsBeforeLoad);
    expect(scrollsAfterLoad).toBeLessThanOrEqual(2);
    expect(diffViewRuntime.unmounts).toBe(unmountsBefore);
  });

  it("跨阅读面点击：目标面立即切换，正文水合后保持定位", async () => {
    const stagedPath = "src/far-staged.ts";
    const stagedSectionKey = "staged:far";
    const stagedEntry = entry(1, stagedPath, [
      {
        group: "staged",
        oldPath: null,
        sectionKey: stagedSectionKey,
        status: "modified",
        targetPath: stagedPath,
      },
    ]);
    const stagedPending = deferred<GitReviewFileDocumentResult>();
    let stagedRequested = false;
    const context = pluginContext({
      getReviewFileDocument: vi.fn(async (request) => {
        if (request.source.path === stagedPath) {
          stagedRequested = true;
          return stagedPending.promise;
        }
        return documentResult(0);
      }),
      getReviewIndex: vi.fn(async () => indexResult([entry(0), stagedEntry])),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    // 两侧都有内容时默认已暂存；本用例要测从「更改」面跨到 staged
    await selectUncommittedTab(view, "Changes");
    await waitFor(() =>
      expect(activeDiff(view.container)).toHaveAttribute(
        "data-item-ids",
        "section:0"
      )
    );
    scrollToItem.mockClear();
    fireEvent.click(findTreeItem(view.container, "far-staged.ts"));
    await waitFor(() => expect(stagedRequested).toBe(true));

    await waitFor(() =>
      expect(
        view.container.querySelector(
          '[data-git-review-surface="staged"][aria-hidden="false"]'
        )
      ).toBeInTheDocument()
    );
    expect(activeDiff(view.container)).toHaveAttribute(
      "data-item-ids",
      stagedSectionKey
    );
    await waitFor(() =>
      expect(
        scrollToItem.mock.calls.filter(([id]) => id === stagedSectionKey).length
      ).toBeGreaterThanOrEqual(1)
    );
    const scrollsBeforeLoad = scrollToItem.mock.calls.filter(
      ([id]) => id === stagedSectionKey
    ).length;

    act(() =>
      stagedPending.resolve(
        documentResult(
          1,
          [
            {
              kind: "patch",
              patch:
                "diff --git a/src/far-staged.ts b/src/far-staged.ts\n@@ -1 +1 @@\n-old\n+staged\n",
              sectionKey: stagedSectionKey,
            },
          ],
          { head: stagedSectionKey, index: null, staged: stagedSectionKey }
        )
      )
    );

    await waitFor(() =>
      expect(
        view.container.querySelector(
          '[data-git-review-surface="staged"][aria-hidden="false"]'
        )
      ).toBeInTheDocument()
    );
    expect(activeDiff(view.container)).toHaveAttribute(
      "data-item-ids",
      stagedSectionKey
    );
    const scrollsAfterLoad = scrollToItem.mock.calls.filter(
      ([id]) => id === stagedSectionKey
    ).length;
    expect(scrollsAfterLoad).toBeGreaterThanOrEqual(scrollsBeforeLoad);
    expect(scrollsAfterLoad).toBeLessThanOrEqual(2);
  });

  it("连续点击不同树文件时 boost demand 并定位最新目标", async () => {
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

    // navigationPending 仍为 true 时点第二个目标，必须 boost 并开始读取。
    fireEvent.click(findTreeItem(view.container, "aaa-second.ts"));
    await waitFor(() => expect(pending.has("src/aaa-second.ts")).toBe(true));
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

    await waitFor(() =>
      expect(getReviewFileDocument.mock.calls.length).toBeGreaterThanOrEqual(2)
    );
    fireEvent.click(findTreeItem(view.container, "file-3.ts"));
    // 金标准：boost selected，并发未满时可不 cancel；目标必须进入 demand 读取
    await waitFor(() => expect(pending.has("src/file-3.ts")).toBe(true));
    act(() => pending.get("src/file-0.ts")?.resolve(documentResult(0)));
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

    await waitFor(() =>
      expect(getReviewFileDocument.mock.calls.length).toBeGreaterThanOrEqual(2)
    );
    diffViewRuntime.reportWindowOnScroll = false;
    fireEvent.click(findTreeItem(view.container, "file-2.ts"));
    // boost 后目标入队；并发 cap=8 下小夹具可不抢占 cancel
    await waitFor(() => expect(pending.has("src/file-2.ts")).toBe(true));

    act(() => pending.get("src/file-0.ts")?.resolve(documentResult(0)));
    await waitFor(() => expect(pending.has("src/file-2.ts")).toBe(true));
  });

  it("导航正文仍在读取时用户滚动会接管，迟到结果不得把视口拉回", async () => {
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
    const context = pluginContext({
      cancelReviewRequest: vi.fn(async () => undefined),
      getReviewFileDocument,
      getReviewIndex: vi.fn(async () => indexResult(entries)),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() =>
      expect(getReviewFileDocument.mock.calls.length).toBeGreaterThanOrEqual(2)
    );
    fireEvent.click(findTreeItem(view.container, "file-3.ts"));
    act(() => pending.get("src/file-0.ts")?.resolve(documentResult(0)));
    await waitFor(() => expect(pending.has("src/file-3.ts")).toBe(true));

    scrollToItem.mockClear();
    act(() => diffViewRuntime.onScroll?.());
    act(() => pending.get("src/file-3.ts")?.resolve(documentResult(3)));
    await waitFor(() => {
      expect(
        view.getByTestId("pierre-diff").getAttribute("data-cache-keys")
      ).not.toContain("estimate:section:3");
    });
    expect(scrollToItem).not.toHaveBeenCalledWith("section:3");

    fireEvent.click(findTreeItem(view.container, "file-3.ts"));
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledWith("section:3"));
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

    await waitFor(() =>
      expect(getReviewFileDocument.mock.calls.length).toBeGreaterThanOrEqual(2)
    );
    fireEvent.click(findTreeItem(view.container, "file-3.ts"));
    await waitFor(() =>
      expect(cancelReviewRequest.mock.calls.length).toBeGreaterThanOrEqual(1)
    );
    act(() => pending.get("src/file-0.ts")?.resolve(documentResult(0)));
    await waitFor(() => expect(pending.has("src/file-3.ts")).toBe(true));
    act(() => pending.get("src/file-3.ts")?.resolve(documentResult(3)));
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledWith("section:3"));
    const callsAfterFirstVisibility = scrollToItem.mock.calls.filter(
      ([sectionId]) => sectionId === "section:3"
    ).length;

    act(() => pending.get("src/file-1.ts")?.resolve(documentResult(1)));

    expect(
      scrollToItem.mock.calls.filter(([sectionId]) => sectionId === "section:3")
    ).toHaveLength(callsAfterFirstVisibility);

    act(() => diffViewRuntime.onScroll?.());
    // 滚动后不得因迟到的旧窗口结果重启对目标的 scrollTo。
    expect(
      scrollToItem.mock.calls.filter(([sectionId]) => sectionId === "section:3")
    ).toHaveLength(callsAfterFirstVisibility);
  });

  it("目标后方正文增量插入时不重复滚动已可见的树选择", async () => {
    const entries = [0, 1, 2].map((index) => entry(index));
    // 终态：先灌满 seed 真成员，再点选；后续兄弟项插入不得重滚已可见目标。
    const getReviewFileDocument = vi.fn(async (request) => {
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
        "3"
      )
    );
    fireEvent.click(findTreeItem(view.container, "file-0.ts"));
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledWith("section:0"));
    const callsAfterFirstVisibility = scrollToItem.mock.calls.filter(
      ([sectionId]) => sectionId === "section:0"
    ).length;

    // 用户滚动触发窗口变化：不应重滚已可见的 section:0。
    act(() => diffViewRuntime.onScroll?.());
    expect(
      scrollToItem.mock.calls.filter(([sectionId]) => sectionId === "section:0")
    ).toHaveLength(callsAfterFirstVisibility);
  });

  it("文件瞬时读取失败不弹全局 toast，静默重试后恢复正文并定位", async () => {
    let documentReads = 0;
    const getReviewFileDocument = vi.fn(async () => {
      documentReads += 1;
      if (documentReads === 1) {
        return {
          kind: "error" as const,
          message: "temporary document failure",
          reason: "internal" as const,
          retryable: true,
        };
      }
      return documentResult(0);
    });
    const context = pluginContext({ getReviewFileDocument });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);
    await waitFor(() => expect(getReviewFileDocument).toHaveBeenCalled());
    expect(context.notifications.error).not.toHaveBeenCalled();
    expect(context.notifications.info).not.toHaveBeenCalled();
    expect(view.queryByText("temporary document failure")).toBeNull();

    await waitFor(() =>
      expect(getReviewFileDocument.mock.calls.length).toBeGreaterThanOrEqual(2)
    );
    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveTextContent("+new")
    );
    expect(view.queryByTestId("pier-diff-retry-button")).toBeNull();
  });

  it("文件读取失败不弹 toast；watch 换代后重读目标并恢复正文", async () => {
    const entries = [0, 1, 2].map((index) => entry(index));
    let notify: () => void = () => undefined;
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
      watch: (_gitRoot, listener) => {
        notify = () => listener({ changeKind: "worktree", gitRoot: ROOT });
        return () => undefined;
      },
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() =>
      expect(getReviewFileDocument.mock.calls.length).toBeGreaterThanOrEqual(2)
    );
    act(() =>
      requests.get("src/file-0.ts")?.[0]?.resolve({
        kind: "error",
        message: "temporary document failure",
        reason: "internal",
        retryable: true,
      })
    );
    // 旁路文件结算，避免卡住 generation
    act(() => requests.get("src/file-1.ts")?.[0]?.resolve(documentResult(1)));
    act(() => requests.get("src/file-2.ts")?.[0]?.resolve(documentResult(2)));
    await waitFor(() =>
      expect(context.notifications.error).not.toHaveBeenCalled()
    );

    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() =>
      expect(requests.get("src/file-0.ts")?.length ?? 0).toBeGreaterThanOrEqual(
        2
      )
    );
    act(() => requests.get("src/file-0.ts")?.[1]?.resolve(documentResult(0)));
    // 同代旁路文件可能再读
    for (const path of ["src/file-1.ts", "src/file-2.ts"] as const) {
      const pending = requests.get(path)?.at(-1);
      if (pending && path === "src/file-1.ts") {
        act(() => pending.resolve(documentResult(1)));
      }
      if (pending && path === "src/file-2.ts") {
        act(() => pending.resolve(documentResult(2)));
      }
    }

    await waitFor(() =>
      expect(view.getByTestId("pierre-diff")).toHaveTextContent("+new")
    );
    expect(context.notifications.error).not.toHaveBeenCalled();
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

    await waitFor(() => expect(pending.size).toBeGreaterThanOrEqual(2));
    act(() => pending.get("src/file-1.ts")?.resolve(documentResult(1)));
    // 更高 content 并发下 3 个可能已在飞
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
    const getReviewFileDocument = vi.fn(
      () => new Promise<GitReviewFileDocumentResult>(() => undefined)
    );
    const context = pluginContext({
      cancelReviewRequest,
      getReviewFileDocument,
      getReviewIndex: vi.fn(async () =>
        indexResult([entry(0), entry(1), entry(2)])
      ),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() => {
      expect(getReviewFileDocument.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    view.unmount();
    // 在飞 document 请求数 = min(seed, concurrent)；不再钉死 2
    expect(cancelReviewRequest.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(
      new Set(
        cancelReviewRequest.mock.calls.map(([request]) => request.operationId)
      ).size
    ).toBe(cancelReviewRequest.mock.calls.length);
  });

  it("seed materialize 前即订阅 appearance（loading 壳）", async () => {
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
    // 终态：未 materialize 时 CodeView 为空，仍挂 loading 壳并订阅 appearance。
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
      // Tree DFS under `a/`: sibling `b` before collision label `File change · a`.
      expect(view.getByTestId("pierre-diff")).toHaveAttribute(
        "data-item-ids",
        "section:1,section:0"
      );
    });
    fireEvent.click(findTreeItem(view.container, "File change · a"));
    await waitFor(() => expect(scrollToItem).toHaveBeenCalledWith("section:0"));
  });

  it("Git 事件刷新同一 sectionKey 正文时不外层 restoreAnchor（Pierre 行锚）", async () => {
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
    await waitFor(() =>
      expect(getReviewFileDocument.mock.calls.length).toBeGreaterThanOrEqual(2)
    );
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
    // 同 id 内容变高：外层不得 pin scroll / restoreAnchor 抢 Pierre
    expect(restoreAnchor).not.toHaveBeenCalled();
  });

  it("渐进刷新期间同 id 存在时外层不 restoreAnchor 拉回视口", async () => {
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
    expect(restoreAnchor).not.toHaveBeenCalled();
    act(() => diffViewRuntime.onScroll?.());
    act(() => {
      refreshPending[0]?.resolve(documentResult(1));
      refreshPending[1]?.resolve(documentResult(2));
    });
    await waitFor(() =>
      expect(context.git.getReviewFileDocument).toHaveBeenCalledTimes(6)
    );
    expect(restoreAnchor).not.toHaveBeenCalled();
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

    // 首代可能仍有 in-flight（邻域预取）；记录基线，新代接受后才应新增 cancel。
    const cancelsBeforeNotify = cancelReviewRequest.mock.calls.length;
    act(() => notify());
    await waitForRefreshWindow();
    expect(cancelReviewRequest.mock.calls.length).toBe(cancelsBeforeNotify);
    act(() => refreshedIndex.resolve(indexResult([entry(0), entry(1)])));
    await waitFor(() =>
      expect(cancelReviewRequest.mock.calls.length).toBeGreaterThan(
        cancelsBeforeNotify
      )
    );
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

  it("2,000 项刷新时重读当前文件并由 CodeView 原位更新，不重新导航", async () => {
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

    // 金标准：2000 content 全挂 estimate id；document 读仍由 seed/demand 有界
    await waitFor(() => {
      const count = Number(
        view.getByTestId("pierre-diff").getAttribute("data-item-count")
      );
      expect(count).toBe(2000);
    });
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
    const navigationCount = scrollToItem.mock.calls.filter(
      ([sectionId]) => sectionId === "section:1999"
    ).length;
    captureTopAnchor.mockClear();

    act(() => notify());
    await waitForRefreshWindow();
    await waitFor(() => expect(currentFileReads).toBe(2));
    expect(
      scrollToItem.mock.calls.filter(
        ([sectionId]) => sectionId === "section:1999"
      ).length
    ).toBe(navigationCount);
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
      ).toBe(navigationCount);
    });
    // renderer 不再采集或恢复滚动；同一稳定槽位由 CodeView 原位更新。
    expect(captureTopAnchor).not.toHaveBeenCalled();
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
  });

  it("状态文件使用单一 HEAD→Working Tree 文件事实", async () => {
    // 金标准：binary/notice 默认不进正文；侧栏仍有树项，正文为空态
    const path = "src/current.bin";
    const currentEntry: GitReviewIndexEntry = {
      ...entry(0, path),
      oldPaths: ["src/old.bin"],
      renderSlots: [
        {
          binary: true,
          group: "unstaged",
          oldPath: null,
          sectionKey: "unstaged:binary",
          status: "modified",
          targetPath: "src/current.bin",
        },
        {
          binary: true,
          group: "staged",
          oldPath: "src/old.bin",
          sectionKey: "staged:binary",
          status: "renamed",
          targetPath: "src/staged-current.bin",
        },
      ],
      status: "renamed",
    };
    const getReviewFileDocument = vi.fn(async () =>
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
    );
    const context = pluginContext({
      getReviewFileDocument,
      getReviewIndex: vi.fn(async () => indexResult([currentEntry])),
    });
    const Panel = createGitChangesPanel(context);
    const view = render(<Panel {...panelProps(createPanelHarness().api)} />);

    await waitFor(() =>
      expect(
        view.container.querySelector(
          '[data-git-review-document-content="empty"]'
        )
      ).not.toBeNull()
    );
    // notice 不进 materialize 主路径
    expect(getReviewFileDocument).not.toHaveBeenCalled();
    expect(findTreeItem(view.container, "current.bin")).toBeTruthy();
    fireEvent.mouseDown(view.getByRole("tab", { name: "Staged Changes" }), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() =>
      expect(
        view.container.querySelector(
          '[data-git-review-document-content="empty"]'
        )
      ).not.toBeNull()
    );
  });

  it("系统语言的解析 locale 变化会同时更新状态正文和缓存身份", async () => {
    let language = "en";
    let notifyAppearance: (appearance: RendererPluginAppearance) => void = () =>
      undefined;
    const context = pluginContext({
      appearance: {
        codeTheme: "github-dark",
        codeThemes: { dark: "github-dark", light: "github-light" },
        density: "compact",
        language: "system",
        locale: "en",
        theme: "dark",
        typography: {
          baseFontSize: "16px",
          codeFontFamily: "Berkeley Mono",
          codeFontSize: "13px",
          fontFamily: "Inter",
        },
      },
      appearanceOnDidChange: (listener) => {
        notifyAppearance = listener;
        return () => undefined;
      },
      getReviewFileDocument: vi.fn(async () =>
        documentResult(
          0,
          [
            {
              kind: "state",
              oldPath: null,
              reason: "binary",
              sectionKey: "state:localized",
              status: "modified",
              targetPath: "src/file-0.ts",
            },
          ],
          { index: null, staged: "state:localized" }
        )
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
    await view.findByTestId("git-review-surface-switcher");
    fireEvent.mouseDown(view.getByRole("tab", { name: "Staged Changes" }), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() => expect(activeDiff(view.container)).toBeInTheDocument());
    const output = activeDiff(view.container);
    await waitFor(() =>
      expect(output).toHaveTextContent("Binary file — content not shown")
    );
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
    const localizedCacheKeys = output
      .getAttribute("data-cache-keys")
      ?.split("|");
    // 单一状态正文的缓存身份包含本地化说明。
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
    await waitFor(() => expect(getReviewIndex).toHaveBeenCalledTimes(2));
    // 有 last-good：index 刷新失败零 toast，树与正文仍可用
    expect(context.notifications.error).not.toHaveBeenCalled();
    expect(context.notifications.info).not.toHaveBeenCalled();
    expect(fileTree(view.container).textContent).toContain(
      "deferred-after-failure.ts"
    );
    expect(view.getByTestId("pierre-diff")).toHaveTextContent("+new");
    fireEvent.click(findTreeItem(view.container, "deferred-after-failure.ts"));
    await waitFor(() => expect(deferredReads).toBe(1));
    await waitFor(() =>
      expect(scrollToItem).toHaveBeenCalledWith("section:200")
    );
  });

  it("刷新失败后下一次 watch 可恢复，并定位用户选择的窗口外文件", async () => {
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
    await waitFor(() => expect(getReviewIndex).toHaveBeenCalledTimes(2));
    expect(context.notifications.error).not.toHaveBeenCalled();
    fireEvent.click(findTreeItem(view.container, "aaa-deferred.ts"));
    await waitFor(() => expect(deferredReads).toBe(1));
    await waitFor(() =>
      expect(scrollToItem).toHaveBeenCalledWith("section:200")
    );
    act(() => notify());
    await waitForRefreshWindow();

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
    expect(view.getByTestId("pierre-diff")).toBeInTheDocument();
    expect(view.container.firstElementChild).toHaveAttribute(
      "aria-hidden",
      "true"
    );
    expect(readReviewSession(sourceKey)?.index.kind).toBe("loaded");

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
    expect(
      readReviewSession(reviewSurfaceSessionKey(scope, "index"))
    ).toBeNull();
    first.unmount();

    const second = render(<Panel {...panelProps(createPanelHarness())} />);
    await waitFor(() =>
      expect(fileTree(second.container).textContent).toContain("file-0.ts")
    );
    expect(getReviewIndex.mock.calls.length).toBeGreaterThan(1);
  });
});
