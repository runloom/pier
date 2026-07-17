import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getSearchQuery } from "@codemirror/search";
import type {
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import {
  FILES_EDITOR_COPY_COMMAND_ID,
  FILES_FILE_PANEL_ID,
  FILES_GROUP_VIEW_CONTENT_ID,
} from "@plugins/builtin/files/manifest.ts";
import { FileEditorAdapter } from "@plugins/builtin/files/renderer/file-editor-adapter.tsx";
import { FileEditorController } from "@plugins/builtin/files/renderer/file-editor-controller.ts";
import { FileImagePreview } from "@plugins/builtin/files/renderer/file-image-preview.tsx";
import { createFilePanel as createFilePanelWithController } from "@plugins/builtin/files/renderer/file-panel.tsx";
import {
  createFileFilePanelInstanceId,
  fileFilePanelIdentityKey,
} from "@plugins/builtin/files/renderer/file-panel-id.ts";
import {
  FilePanelBreadcrumb,
  SidebarToggleButton,
} from "@plugins/builtin/files/renderer/file-panel-parts.tsx";
import { FileTreeSidebar } from "@plugins/builtin/files/renderer/file-tree-sidebar.tsx";
import { createDiskDocumentRecord } from "@plugins/builtin/files/renderer/files-document-factory.ts";
import { withDocumentReadResult } from "@plugins/builtin/files/renderer/files-document-reducers.ts";
import {
  clearFilesDocumentStore,
  createUntitledMarkdownDocument,
  ensureDiskDocument,
  getDocument,
  markDocumentLoaded,
  removeDocument,
  restoreUntitledDocumentFromPanelSource,
  updateDocumentContents,
} from "@plugins/builtin/files/renderer/files-document-store.ts";
import type { FilesDocumentPanelSource } from "@plugins/builtin/files/renderer/files-document-types.ts";
import { createFilesEditorActions } from "@plugins/builtin/files/renderer/files-editor-actions.ts";
import {
  clearFilesNavHistory,
  pushFilesNavEntry,
} from "@plugins/builtin/files/renderer/files-nav-history.ts";
import { saveAsJournalForDocument } from "@plugins/builtin/files/renderer/files-save-as-journal.ts";
import {
  clearFileTreeSidebarCache,
  openFilesTreeSearch,
} from "@plugins/builtin/files/renderer/files-tree-registry.ts";
import { clearFilesTreeStore } from "@plugins/builtin/files/renderer/files-tree-store.ts";
import { FilesWatchHub } from "@plugins/builtin/files/renderer/files-watch-hub.ts";
import type * as MarkdownParserModule from "@plugins/builtin/files/renderer/markdown/markdown-parser.ts";
import type * as MarkdownRuntimeModule from "@plugins/builtin/files/renderer/markdown/markdown-runtime.ts";
import {
  FILES_TREE_DEFAULT_EXCLUDE_PATTERNS,
  FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
  FILES_TREE_SHOW_EXCLUDED_SETTING_KEY,
  FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY,
} from "@plugins/builtin/files/settings.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
import type { FilePreviewTicketIssueResult } from "@shared/contracts/file-preview-ticket.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { EditorView } from "codemirror";
import type { IDockviewPanelProps } from "dockview-react";
import type * as ReactDomClient from "react-dom/client";
import type { Container, Root, RootOptions } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHostGroupContentForTests,
  createHostGroupContentContext,
} from "@/lib/plugins/host-group-content-context.tsx";

const filesGroupViewRootProbe = vi.hoisted(() => ({
  renderCalls: 0,
  reset(): void {
    this.renderCalls = 0;
  },
}));

vi.mock("react-dom/client", async () => {
  const actual = (await vi.importActual(
    "react-dom/client"
  )) as typeof ReactDomClient;

  return {
    ...actual,
    createRoot(container: Container, options?: RootOptions): Root {
      const root = actual.createRoot(container, options);
      if (
        container instanceof HTMLElement &&
        container.dataset.slot === "pier.files.groupView"
      ) {
        const render = root.render.bind(root);
        root.render = (children) => {
          filesGroupViewRootProbe.renderCalls += 1;
          render(children);
        };
      }
      return root;
    },
  };
});

vi.mock(
  "@plugins/builtin/files/renderer/markdown/markdown-runtime.ts",
  async () => {
    const actual = await vi.importActual<typeof MarkdownRuntimeModule>(
      "@plugins/builtin/files/renderer/markdown/markdown-runtime.ts"
    );
    const parser = await vi.importActual<typeof MarkdownParserModule>(
      "@plugins/builtin/files/renderer/markdown/markdown-parser.ts"
    );
    const markdownRuntime: MarkdownRuntimeModule.MarkdownRuntime = {
      closeSession: () => undefined,
      dispose: () => undefined,
      parse: async (input) => {
        const document = parser.parseMarkdownToIr(input.source);
        return {
          document,
          pagination: actual.paginateMarkdownDocument(document),
          revision: input.revision,
          status: "parsed" as const,
        };
      },
      setSessionVisible: () => undefined,
    };
    return { ...actual, markdownRuntime };
  }
);

const OUTSIDE_WORKSPACE_PATTERN = /outside the restored workspace/i;
const PROJECT_ROOT = "/workspace/pier";
const CLASS_H_FULL = /\bh-full\b/;
const CLASS_FLEX = /\bflex\b/;
const CLASS_FLEX_COL = /\bflex-col\b/;
const CLASS_FLEX_1 = /\bflex-1\b/;
const CLASS_MIN_H_0 = /\bmin-h-0\b/;
const CM_GUTTERS_RULE = /"\.cm-gutters"\s*:\s*\{[^}]+\}/s;
const CM_BG_BACKGROUND = /backgroundColor:\s*"var\(--background\)"/;
const CM_POSITION_STICKY = /position:\s*"sticky"/;
const CM_ZINDEX_1 = /zIndex:\s*1\b/;
const CM_SEARCH_DOM_HANDLER_OVERRIDE =
  /Prec\.highest\(\s*EditorView\.domEventHandlers/s;
const FILE_PANEL_DISK_INSTANCE_ID =
  /^pier\.files\.filePanel:disk:[a-z0-9]+:[A-Za-z0-9_-]+$/;
const FILES_GROUP_VIEW_SELECTOR = `[data-slot="${FILES_GROUP_VIEW_CONTENT_ID}"]`;

interface TestFilesRuntime {
  controller: FileEditorController;
  watchHub: FilesWatchHub;
}

const testFilesRuntimes = new Set<TestFilesRuntime>();
const testFilesRuntimesByContext = new WeakMap<
  RendererPluginContext,
  TestFilesRuntime
>();

const panelContext: PanelContext = {
  branch: "main",
  contextId: "ctx-pier",
  cwd: PROJECT_ROOT,
  gitRoot: PROJECT_ROOT,
  openedPath: PROJECT_ROOT,
  projectRootPath: PROJECT_ROOT,
  source: "panel",
  updatedAt: 1_772_000_000_000,
  worktreeKey: PROJECT_ROOT,
  worktreeRoot: PROJECT_ROOT,
};

interface FilesPanelParams {
  context?: PanelContext;
  source?: FilesDocumentPanelSource | Record<string, unknown>;
}

type PathQueryListener = (
  event: import("@shared/contracts/file-query").FileQueryEvent
) => void;

function createPathQueryMock() {
  const listeners = new Set<PathQueryListener>();
  const starts: import("@shared/contracts/file-query").FilePathQueryStart[] =
    [];
  let nextId = 0;
  return {
    starts,
    emit(event: import("@shared/contracts/file-query").FileQueryEvent) {
      for (const listener of Array.from(listeners)) {
        listener(event);
      }
    },
    onPathQueryEvent(listener: PathQueryListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    queryPaths(
      request: Omit<
        import("@shared/contracts/file-query").FilePathQueryStart,
        "queryId"
      > & { queryId?: string }
    ) {
      nextId += 1;
      const queryId = request.queryId ?? `panel-q${nextId}`;
      starts.push({
        ...request,
        queryId,
      } as import("@shared/contracts/file-query").FilePathQueryStart);
      return {
        cancel: vi.fn(),
        queryId,
      };
    },
  };
}

function createMockContext(overrides?: {
  configurationGet?: RendererPluginContext["configuration"]["get"];
  configurationOnDidChange?: RendererPluginContext["configuration"]["onDidChange"];
  flushLayout?: RendererPluginContext["panels"]["flushLayout"];
  issuePreview?: RendererPluginContext["filePreviews"]["issue"];
  inspectWriteTarget?: RendererPluginContext["files"]["inspectWriteTarget"];
  list?: RendererPluginContext["files"]["list"];
  listIgnored?: RendererPluginContext["git"]["listIgnored"];
  listInstances?: RendererPluginContext["panels"]["listInstances"];
  notifyInfo?: RendererPluginContext["notifications"]["info"];
  onPathQueryEvent?: RendererPluginContext["files"]["onPathQueryEvent"];
  openExternal?: RendererPluginContext["externalNavigation"]["open"];
  queryPaths?: RendererPluginContext["files"]["queryPaths"];
  releasePreview?: RendererPluginContext["filePreviews"]["release"];
  openInstance?: RendererPluginContext["panels"]["openInstance"];
  pickSaveTarget?: RendererPluginContext["files"]["pickSaveTarget"];
  readDocument?: RendererPluginContext["files"]["readDocument"];
  readText?: RendererPluginContext["files"]["readText"];
  reveal?: RendererPluginContext["files"]["reveal"];
  translate?: RendererPluginContext["i18n"]["t"];
  watch?: RendererPluginContext["files"]["watch"];
  writeDocument?: RendererPluginContext["files"]["writeDocument"];
  writeText?: RendererPluginContext["files"]["writeText"];
}): RendererPluginContext {
  const drafts = new Map<
    string,
    { generation: number; updatedAt: number; value: string }
  >();
  const readText = overrides?.readText ?? vi.fn(async () => "");
  const writeText =
    overrides?.writeText ??
    vi.fn(async (request) => ({
      mtimeMs: 1,
      path: request.path,
      root: request.root,
      written: true as const,
    }));
  const stat = vi.fn(async (request: { path: string; root: string }) => ({
    exists: true,
    isDirectory: false,
    mtimeMs: 1,
    path: request.path,
    root: request.root,
    size: 0,
  }));
  const readDocument =
    overrides?.readDocument ??
    vi.fn(async (request: { path: string; root: string }) => {
      const metadata = await stat(request);
      const contents = await readText(request);
      return {
        canonicalPath: request.path,
        contents,
        eol: "lf" as const,
        format: { bom: false as const, encoding: "utf8" as const },
        kind: "text" as const,
        mode: 0o644,
        path: request.path,
        revision: `revision-${metadata.mtimeMs}`,
        root: request.root,
        size: contents.length,
        writable: true,
      };
    });
  const writeDocument =
    overrides?.writeDocument ??
    vi.fn(async (request) => {
      try {
        const result = await writeText({
          contents: request.contents,
          path: request.path,
          root: request.root,
        });
        return {
          committed: true as const,
          durability: "confirmed" as const,
          kind: "written" as const,
          mode: 0o644,
          mtimeMs: result.mtimeMs,
          revision: `revision-${result.mtimeMs}`,
          size: request.contents.length,
        };
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "file_conflict"
        ) {
          return {
            kind: "conflict" as const,
            reason: "revision-mismatch" as const,
          };
        }
        throw error;
      }
    });
  return {
    dialogs: {
      alert: vi.fn(async () => undefined),
      choice: vi.fn(async () => "confirm" as const),
      confirm: vi.fn(async () => true),
      prompt: vi.fn(async () => null),
    },
    configuration: {
      get: overrides?.configurationGet ?? vi.fn(() => false),
      onDidChange: overrides?.configurationOnDidChange ?? vi.fn(() => vi.fn()),
      reset: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    },
    externalNavigation: {
      open:
        overrides?.openExternal ??
        vi.fn(async () => ({ opened: true as const })),
    },
    filePreviews: {
      issue:
        overrides?.issuePreview ??
        vi.fn(async () => ({
          expiresAt: Date.now() + 60_000,
          issued: true as const,
          ticket: "preview-ticket-00000000",
          url: "pier-file-preview://file/preview-ticket-00000000",
        })),
      release: overrides?.releasePreview ?? vi.fn(async () => true),
    },
    git: {
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
        repoState: { kind: "clean" },
        stashCount: 0,
      })),
      listIgnored: overrides?.listIgnored ?? vi.fn(async () => []),
      watch: vi.fn(() => () => undefined),
    },
    files: {
      drafts: {
        claimLegacy: vi.fn(async () => ({ kind: "missing" as const })),
        delete: vi.fn(async (key: string) => drafts.delete(key)),
        get: vi.fn(async (key: string) => {
          const draft = drafts.get(key);
          return draft
            ? {
                generation: draft.generation,
                key,
                updatedAt: draft.updatedAt,
                value: draft.value,
              }
            : null;
        }),
        listKeys: vi.fn(async () => [...drafts.keys()]),
        set: vi.fn(async (key: string, generation: number, value: string) => {
          const current = drafts.get(key);
          if (current && current.generation > generation) {
            return {
              currentGeneration: current.generation,
              kind: "rejected" as const,
              reason: "stale-generation" as const,
            };
          }
          const updatedAt = Date.now();
          drafts.set(key, { generation, updatedAt, value });
          return { generation, kind: "stored" as const, updatedAt };
        }),
      },
      exists: vi.fn(async (request) => ({
        exists: true,
        path: request.path,
        root: request.root,
      })),
      list: overrides?.list ?? vi.fn(async () => []),
      onPathQueryEvent:
        overrides?.onPathQueryEvent ?? vi.fn(() => () => undefined),
      queryPaths:
        overrides?.queryPaths ??
        vi.fn(() => ({
          cancel: vi.fn(),
          queryId: "unused-query",
        })),
      mkdir: vi.fn(async (request) => ({
        created: true,
        path: request.path,
        root: request.root,
      })),
      move: vi.fn(async (request) => ({
        moved: true,
        newPath: request.newPath,
        oldPath: request.path,
        root: request.root,
      })),
      inspectWriteTarget:
        overrides?.inspectWriteTarget ??
        vi.fn(async () => ({
          fileType: "text" as const,
          kind: "existing" as const,
          revision: "revision-current",
          size: 0,
        })),
      pickSaveTarget: overrides?.pickSaveTarget ?? vi.fn(async () => null),
      readDocument,
      readText,
      reveal:
        overrides?.reveal ??
        vi.fn(async (request) => ({ ...request, revealed: true })),
      stat,
      trash: vi.fn(async (request) => ({
        path: request.path,
        root: request.root,
        trashed: true,
      })),
      watch: overrides?.watch ?? vi.fn(() => () => undefined),
      writeDocument,
      writeText,
    },
    groupContent: createHostGroupContentContext(undefined, () => undefined),
    i18n: {
      language: () => "en",
      t:
        overrides?.translate ??
        ((_key: string, _values?: unknown, fallback?: string) =>
          fallback ?? ""),
    },
    notifications: {
      error: vi.fn(),
      info: overrides?.notifyInfo ?? vi.fn(),
      loading: vi.fn(() => ({
        dismiss: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
      })),
      success: vi.fn(),
      system: vi.fn(async () => ({ shown: true })),
    },
    panels: {
      flushLayout: overrides?.flushLayout ?? vi.fn(async () => undefined),
      getActiveContext: vi.fn(() => panelContext),
      getActiveInstanceId: vi.fn(() => null),
      listInstances: overrides?.listInstances ?? vi.fn(() => []),
      open: vi.fn(),
      openInstance: overrides?.openInstance ?? vi.fn(),
      register: vi.fn(() => vi.fn()),
      registerCloseGuard: vi.fn(() => vi.fn()),
    },
  } as unknown as RendererPluginContext;
}

function filesRuntimeFor(context: RendererPluginContext): TestFilesRuntime {
  const existing = testFilesRuntimesByContext.get(context);
  if (existing) {
    return existing;
  }
  const watchHub = new FilesWatchHub(context.files);
  const runtime = {
    controller: new FileEditorController(context, watchHub),
    watchHub,
  };
  runtime.controller.initialize().catch(() => undefined);
  testFilesRuntimes.add(runtime);
  testFilesRuntimesByContext.set(context, runtime);
  return runtime;
}

function createFilePanel(context: RendererPluginContext) {
  const runtime = filesRuntimeFor(context);
  return createFilePanelWithController(
    context,
    runtime.controller,
    runtime.watchHub
  );
}

function makeProps(
  params: FilesPanelParams,
  apiOverrides: Record<string, unknown> = {}
): IDockviewPanelProps<FilesPanelParams> {
  return {
    api: {
      id: "pier.files.filePanel:test",
      isActive: true,
      isVisible: true,
      onDidActiveChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidVisibilityChange: vi.fn(() => ({ dispose: vi.fn() })),
      setTitle: vi.fn(),
      updateParameters: vi.fn(),
      ...apiOverrides,
    },
    containerApi: {},
    params,
  } as unknown as IDockviewPanelProps<FilesPanelParams>;
}

interface FakePanel {
  api: {
    onDidParametersChange: (listener: (event: unknown) => void) => {
      dispose: () => void;
    };
  };
  id: string;
  params?: Record<string, unknown> | undefined;
  view: { contentComponent: string };
}

interface FakeGroup {
  activePanel: FakePanel | null;
  api: { onDidActivePanelChange: ReturnType<typeof vi.fn> };
  element: HTMLDivElement;
  fireActiveChange: () => void;
  id: string;
  makeFilesPanel: (
    id: string,
    params?: Record<string, unknown>
  ) => FakePanel & {
    fireParamsChange: () => void;
    setParams: (params: Record<string, unknown>) => void;
  };
  model: { activePanel: FakePanel | null; element: HTMLDivElement };
  setActivePanel: (panel: FakePanel | null) => void;
  setActivePanelModelOnly: (panel: FakePanel | null) => void;
}

// 拉取模型的 fake group:视图直读 group.activePanel + panel.params,
// 事件仅触发重读 —— fake 也按同一契约实现。
function createFakeGroup(groupId = "group-1"): FakeGroup {
  const element = document.createElement("div");
  const content = document.createElement("div");
  content.className = "dv-content-container";
  content.style.position = "relative";
  content.style.height = "400px";
  element.appendChild(content);
  document.body.appendChild(element);
  const activeChangeListeners = new Set<() => void>();
  const group: FakeGroup = {
    activePanel: null,
    api: {
      onDidActivePanelChange: vi.fn((listener: () => void) => {
        activeChangeListeners.add(listener);
        return { dispose: () => activeChangeListeners.delete(listener) };
      }),
    },
    element,
    fireActiveChange: () => {
      for (const listener of activeChangeListeners) {
        listener();
      }
    },
    id: groupId,
    makeFilesPanel: (id, params) => {
      const paramsListeners = new Set<(event: unknown) => void>();
      const panel = {
        api: {
          onDidParametersChange: (listener: (event: unknown) => void) => {
            paramsListeners.add(listener);
            return { dispose: () => paramsListeners.delete(listener) };
          },
        },
        fireParamsChange: () => {
          for (const listener of paramsListeners) {
            listener(panel.params);
          }
        },
        id,
        params,
        setParams: (nextParams: Record<string, unknown>) => {
          panel.params = nextParams;
          for (const listener of paramsListeners) {
            listener(nextParams);
          }
        },
        view: { contentComponent: "pier.files.filePanel" },
      };
      return panel;
    },
    model: { activePanel: null, element },
    setActivePanelModelOnly: (panel) => {
      group.model.activePanel = panel;
      group.fireActiveChange();
    },
    setActivePanel: (panel) => {
      group.activePanel = panel;
      group.model.activePanel = panel;
      group.fireActiveChange();
    },
  };
  return group;
}

function renderFilePanel(
  params: FilesPanelParams,
  context = createMockContext()
) {
  const Panel = createFilePanel(context);
  return render(<Panel {...makeProps(params)} />);
}

function findCodeMirrorView(container: HTMLElement): EditorView {
  const editorElement = container.querySelector(".cm-editor");
  expect(editorElement).toBeInstanceOf(HTMLElement);
  const view = EditorView.findFromDOM(editorElement as HTMLElement);
  expect(view).not.toBeNull();
  return view as EditorView;
}

function replaceEditorText(container: HTMLElement, value: string): void {
  const view = findCodeMirrorView(container);
  act(() => {
    view.dispatch({
      changes: { from: 0, insert: value, to: view.state.doc.length },
    });
  });
}

function getFileTree(container: HTMLElement): HTMLElement {
  const host = container.querySelector(
    'file-tree-container[data-slot="pier-file-tree"]'
  );
  expect(host).toBeInstanceOf(HTMLElement);
  const tree = (host as HTMLElement).shadowRoot?.querySelector('[role="tree"]');
  expect(tree).toBeInstanceOf(HTMLElement);
  return tree as HTMLElement;
}

beforeEach(() => {
  clearHostGroupContentForTests();
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearFilesDocumentStore();
  clearFilesNavHistory();
  clearFilesTreeStore();
  clearFileTreeSidebarCache();
  filesGroupViewRootProbe.reset();
});

afterEach(() => {
  clearHostGroupContentForTests();
  clearFilesDocumentStore();
  clearFilesNavHistory();
  clearFilesTreeStore();
  clearFileTreeSidebarCache();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  filesGroupViewRootProbe.reset();
  for (const runtime of testFilesRuntimes) {
    runtime.controller.dispose();
    runtime.watchHub.dispose();
  }
  testFilesRuntimes.clear();
});

describe("Files file-panel", () => {
  it("preserves breadcrumb scroll position across unrelated rerenders", () => {
    const segments = ["pier", "src", "file.ts"];
    const { container, rerender } = render(
      <FilePanelBreadcrumb
        ariaLabel="File location"
        onSegmentClick={() => undefined}
        segments={segments}
      />
    );
    const breadcrumb = container.firstElementChild;
    expect(breadcrumb).toBeInstanceOf(HTMLElement);
    expect(
      screen.getByRole("navigation", { name: "File location" })
    ).toContainElement(screen.getByRole("list"));
    expect(screen.getAllByRole("listitem")).toHaveLength(segments.length);
    expect(screen.getByRole("button", { name: "file.ts" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    Object.defineProperty(breadcrumb, "scrollWidth", {
      configurable: true,
      value: 480,
    });
    (breadcrumb as HTMLElement).scrollLeft = 120;

    rerender(
      <FilePanelBreadcrumb
        ariaLabel="File location"
        onSegmentClick={() => undefined}
        segments={[...segments]}
      />
    );
    expect((breadcrumb as HTMLElement).scrollLeft).toBe(120);

    rerender(
      <FilePanelBreadcrumb
        ariaLabel="File location"
        onSegmentClick={() => undefined}
        segments={["pier", "packages", "file.ts"]}
      />
    );
    expect((breadcrumb as HTMLElement).scrollLeft).toBe(480);
  });
  it("uses FolderTree for the collapsed file-tree opener", () => {
    const { container } = render(
      <SidebarToggleButton
        collapsed
        hidden={false}
        onToggle={() => undefined}
        t={(key, fallback) => fallback ?? key}
      />
    );

    expect(
      screen.getByRole("button", { name: "Expand file tree" })
    ).toBeVisible();
    expect(container.querySelector("svg")).toHaveClass("lucide-folder-tree");
  });
  it("localizes file-panel chrome through plugin i18n messages", async () => {
    const translations = new Map<string, string>([
      ["filePanel.empty.title", "[未选择文件]"],
      ["filePanel.editor.sourceLabel", "[源码编辑器]"],
      ["filePanel.empty.withTree.description", "[从项目树选择文件]"],
      ["filePanel.status.temporary", "[临时]"],
      ["filePanel.tree.collapse", "[收起树]"],
      ["filePanel.view.preview", "[预览]"],
      ["filePanel.view.source", "[源码]"],
    ]);
    const translate = vi.fn<RendererPluginContext["i18n"]["t"]>(
      (key: string, _values?: unknown, fallback?: string) =>
        translations.get(key) ?? fallback ?? key
    );
    const context = createMockContext({ translate });

    renderFilePanel({ context: panelContext }, context);

    expect(screen.getByText("[未选择文件]")).toBeVisible();
    expect(screen.getByText("[从项目树选择文件]")).toBeVisible();
    expect(screen.getByRole("button", { name: "[收起树]" })).toBeVisible();

    const document = createUntitledMarkdownDocument({ contents: "# 本地化" });
    const Panel = createFilePanel(context);
    render(
      <Panel
        {...makeProps({
          context: panelContext,
          source: { id: document.id, kind: "untitled", name: document.name },
        })}
      />
    );

    expect(await screen.findByText("[临时]")).toBeVisible();
    expect(screen.getByRole("radio", { name: "[源码]" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "[预览]" })).toBeVisible();
    expect(screen.getByLabelText("[源码编辑器]")).toBeVisible();
    expect(translate).toHaveBeenCalledWith(
      "filePanel.status.temporary",
      undefined,
      "Temporary file"
    );
  });

  it("renders a project-scoped empty file-panel with an integrated collapsible file tree", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
          { kind: "directory", path: "src", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );

    const { container } = renderFilePanel(
      { context: panelContext },
      createMockContext({ list })
    );

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });
    expect(screen.getByText("No file selected")).toBeVisible();
    expect(
      screen.getByText("No file selected").closest('[data-slot="empty"]')
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Collapse file tree" })
    ).toBeVisible();
    const tree = within(getFileTree(container));
    expect(tree.getByRole("treeitem", { name: "README.md" })).toBeVisible();
  });

  it("renders signature-classified images with fit, zoom, actual-size, and failure states", async () => {
    const readDocument = vi.fn<RendererPluginContext["files"]["readDocument"]>(
      async (request) => ({
        canonicalPath: request.path,
        kind: "image" as const,
        mime: "image/png" as const,
        mtimeMs: 1,
        path: request.path,
        revision: "file-v1:image-revision",
        root: request.root,
        size: 2048,
      })
    );
    renderFilePanel(
      {
        context: panelContext,
        source: { kind: "disk", path: "assets/photo.png", root: PROJECT_ROOT },
      },
      createMockContext({ readDocument })
    );

    const image = await screen.findByRole("img", { name: "photo.png" });
    expect(image.getAttribute("src")).toMatch(
      /^pier-file-preview:\/\/file\/[A-Za-z0-9_-]{22,}$/u
    );
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading image");
    expect(
      screen.getByRole("region", { name: "Image preview" })
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.queryByRole("toolbar", { name: "Image controls" })
    ).toBeNull();

    fireEvent.load(image);

    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.getByRole("region", { name: "Image preview" })
    ).toHaveAttribute("aria-busy", "false");
    const toolbar = screen.getByRole("toolbar", { name: "Image controls" });
    expect(toolbar).toBeVisible();
    expect(toolbar).toHaveClass("absolute", "right-3", "bottom-3");
    expect(screen.getByText("Fit to window", { exact: true })).toBeVisible();
    expect(screen.queryByText("1:1", { exact: true })).toBeNull();
    const zoomMenu = screen.getByRole("button", {
      name: "Zoom level: Fit to window",
    });
    expect(zoomMenu).toHaveAttribute("data-variant", "secondary");
    expect(screen.queryByText("Saved")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Source" })).toBeNull();

    fireEvent.keyDown(zoomMenu, { key: "Enter" });
    const actualSizeItem = await screen.findByRole("menuitemradio", {
      name: /100%/u,
    });
    fireEvent.click(actualSizeItem);
    expect(screen.getByText("100%")).toBeVisible();
    fireEvent.keyDown(screen.getByRole("region", { name: "Image preview" }), {
      key: "+",
    });
    expect(screen.getByText("110%")).toBeVisible();
    fireEvent.doubleClick(image);
    expect(screen.getByText("Fit to window", { exact: true })).toBeVisible();

    fireEvent.error(image);
    expect(screen.getByText("Unable to display image")).toBeVisible();
    expect(
      screen.getByText("Unable to display image").closest('[data-slot="empty"]')
    ).not.toBeNull();
  });

  it("exchanges and revokes image tickets after a revision change", async () => {
    const initial = createDiskDocumentRecord({
      draft: null,
      id: "disk:image-preview-retry",
      path: "assets/photo.png",
      root: PROJECT_ROOT,
    });
    const imageResult = (revision: string) => ({
      canonicalPath: "assets/photo.png",
      kind: "image" as const,
      mime: "image/png" as const,
      mtimeMs: 1,
      path: "assets/photo.png",
      revision,
      root: PROJECT_ROOT,
      size: 2048,
    });
    const t = (_key: string, fallback?: string) => fallback ?? _key;
    const issuePreview = vi
      .fn<RendererPluginContext["filePreviews"]["issue"]>()
      .mockResolvedValueOnce({
        expiresAt: 1,
        issued: true,
        ticket: "first-ticket-0000000000",
        url: "pier-file-preview://file/first-ticket-0000000000",
      })
      .mockResolvedValueOnce({
        expiresAt: 2,
        issued: true,
        ticket: "second-ticket-000000000",
        url: "pier-file-preview://file/second-ticket-000000000",
      });
    const releasePreview = vi.fn(async () => true);
    const context = createMockContext({ issuePreview, releasePreview });
    const first = withDocumentReadResult(initial, imageResult("file-v1:first"));
    const view = render(
      <FileImagePreview context={context} document={first} t={t} />
    );
    expect(screen.queryByText("Unable to display image")).toBeNull();
    expect(
      view.container.querySelector('[data-slot="skeleton"]')
    ).not.toBeNull();
    const failedImage = await screen.findByRole("img", { name: "photo.png" });
    fireEvent.load(failedImage);
    const failedUrl = failedImage.getAttribute("src");

    const next = withDocumentReadResult(first, imageResult("file-v1:next"));
    view.rerender(<FileImagePreview context={context} document={next} t={t} />);

    await waitFor(() => {
      expect(
        screen.getByRole("img", { name: "photo.png" }).getAttribute("src")
      ).not.toBe(failedUrl);
    });
    const retriedImage = screen.getByRole("img", { name: "photo.png" });
    fireEvent.load(retriedImage);
    expect(issuePreview).toHaveBeenLastCalledWith(
      expect.objectContaining({ revision: "file-v1:next" }),
      "first-ticket-0000000000"
    );
    expect(screen.queryByText("Unable to display image")).toBeNull();

    fireEvent.error(failedImage);
    expect(screen.getByRole("img", { name: "photo.png" })).toBeVisible();
    expect(screen.queryByText("Unable to display image")).toBeNull();
    fireEvent.error(retriedImage);
    expect(screen.getByText("Unable to display image")).toBeVisible();
    expect(releasePreview).toHaveBeenCalledWith("second-ticket-000000000");
  });

  it("ignores stale image events while a replacement ticket is pending", async () => {
    const source = createDiskDocumentRecord({
      draft: null,
      id: "disk:image-preview-stale-event",
      path: "assets/photo.png",
      root: PROJECT_ROOT,
    });
    const imageResult = (revision: string) => ({
      canonicalPath: "assets/photo.png",
      kind: "image" as const,
      mime: "image/png" as const,
      mtimeMs: 1,
      path: "assets/photo.png",
      revision,
      root: PROJECT_ROOT,
      size: 2048,
    });
    let resolveReplacement:
      | ((result: FilePreviewTicketIssueResult) => void)
      | undefined;
    const replacement = new Promise<FilePreviewTicketIssueResult>((resolve) => {
      resolveReplacement = resolve;
    });
    const issuePreview = vi
      .fn<RendererPluginContext["filePreviews"]["issue"]>()
      .mockResolvedValueOnce({
        expiresAt: 1,
        issued: true,
        ticket: "stale-ticket-0000000000",
        url: "pier-file-preview://file/stale-ticket-0000000000",
      })
      .mockReturnValueOnce(replacement);
    const releasePreview = vi.fn(async () => true);
    const context = createMockContext({ issuePreview, releasePreview });
    const first = withDocumentReadResult(source, imageResult("file-v1:first"));
    const view = render(
      <FileImagePreview
        context={context}
        document={first}
        t={(_key, fallback) => fallback ?? _key}
      />
    );
    const staleImage = await screen.findByRole("img", { name: "photo.png" });
    fireEvent.load(staleImage);

    view.rerender(
      <FileImagePreview
        context={context}
        document={withDocumentReadResult(first, imageResult("file-v1:next"))}
        t={(_key, fallback) => fallback ?? _key}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading image");

    fireEvent.error(staleImage);

    expect(screen.getByRole("status")).toHaveTextContent("Loading image");
    expect(releasePreview).not.toHaveBeenCalled();

    await act(async () => {
      resolveReplacement?.({
        expiresAt: 2,
        issued: true,
        ticket: "replacement-ticket-00000",
        url: "pier-file-preview://file/replacement-ticket-00000",
      });
      await replacement;
    });
    const replacementImage = await screen.findByRole("img", {
      name: "photo.png",
    });
    expect(replacementImage).not.toBe(staleImage);
    fireEvent.load(replacementImage);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("releases the active image ticket on unmount", async () => {
    const source = createDiskDocumentRecord({
      draft: null,
      id: "disk:image-preview-unmount",
      path: "assets/photo.png",
      root: PROJECT_ROOT,
    });
    const document = withDocumentReadResult(source, {
      canonicalPath: "assets/photo.png",
      kind: "image" as const,
      mime: "image/png" as const,
      mtimeMs: 1,
      path: "assets/photo.png",
      revision: "file-v1:unmount",
      root: PROJECT_ROOT,
      size: 2048,
    });
    const releasePreview = vi.fn(async () => true);
    const context = createMockContext({
      issuePreview: vi.fn(async () => ({
        expiresAt: 1,
        issued: true as const,
        ticket: "unmount-ticket-00000000",
        url: "pier-file-preview://file/unmount-ticket-00000000",
      })),
      releasePreview,
    });
    const view = render(
      <FileImagePreview
        context={context}
        document={document}
        t={(_key, fallback) => fallback ?? _key}
      />
    );
    await screen.findByRole("img", { name: "photo.png" });
    expect(releasePreview).not.toHaveBeenCalled();

    view.unmount();

    await waitFor(() => {
      expect(releasePreview).toHaveBeenCalledOnce();
    });
    expect(releasePreview).toHaveBeenCalledWith("unmount-ticket-00000000");
  });

  it("shows an error and releases the active ticket when replacement issuance rejects", async () => {
    const initial = createDiskDocumentRecord({
      draft: null,
      id: "disk:image-preview-rejection",
      path: "assets/photo.png",
      root: PROJECT_ROOT,
    });
    const imageResult = (revision: string) => ({
      canonicalPath: "assets/photo.png",
      kind: "image" as const,
      mime: "image/png" as const,
      mtimeMs: 1,
      path: "assets/photo.png",
      revision,
      root: PROJECT_ROOT,
      size: 2048,
    });
    const issuePreview = vi
      .fn<RendererPluginContext["filePreviews"]["issue"]>()
      .mockResolvedValueOnce({
        expiresAt: 1,
        issued: true,
        ticket: "active-ticket-000000000",
        url: "pier-file-preview://file/active-ticket-000000000",
      })
      .mockRejectedValueOnce(new Error("preview service unavailable"));
    const releasePreview = vi.fn(async () => true);
    const context = createMockContext({ issuePreview, releasePreview });
    const first = withDocumentReadResult(initial, imageResult("file-v1:first"));
    const view = render(
      <FileImagePreview
        context={context}
        document={first}
        t={(_key, fallback) => fallback ?? _key}
      />
    );
    await screen.findByRole("img", { name: "photo.png" });

    const next = withDocumentReadResult(first, imageResult("file-v1:next"));
    view.rerender(
      <FileImagePreview
        context={context}
        document={next}
        t={(_key, fallback) => fallback ?? _key}
      />
    );

    expect(await screen.findByText("Unable to display image")).toBeVisible();
    expect(releasePreview).toHaveBeenCalledWith("active-ticket-000000000");
  });

  it("clamps image zoom controls between 10% and 800%", async () => {
    const readDocument = vi.fn<RendererPluginContext["files"]["readDocument"]>(
      async (request) => ({
        canonicalPath: request.path,
        kind: "image" as const,
        mime: "image/webp" as const,
        mtimeMs: 1,
        path: request.path,
        revision: "file-v1:webp-revision",
        root: request.root,
        size: 12,
      })
    );
    renderFilePanel(
      {
        context: panelContext,
        source: { kind: "disk", path: "preview.webp", root: PROJECT_ROOT },
      },
      createMockContext({ readDocument })
    );
    await screen.findByRole("img", { name: "preview.webp" });
    fireEvent.load(screen.getByRole("img", { name: "preview.webp" }));
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Zoom level: Fit to window" }),
      { key: "Enter" }
    );
    fireEvent.click(
      await screen.findByRole("menuitemradio", {
        name: /100%/u,
      })
    );
    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    for (let index = 0; index < 20; index += 1) fireEvent.click(zoomOut);
    expect(screen.getByText("10%")).toBeVisible();
    expect(zoomOut).toBeDisabled();

    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    for (let index = 0; index < 100; index += 1) fireEvent.click(zoomIn);
    expect(screen.getByText("800%")).toBeVisible();
    expect(zoomIn).toBeDisabled();
  });

  it("renders binary metadata in Empty and reveals it through the system file manager", async () => {
    const reveal = vi.fn<RendererPluginContext["files"]["reveal"]>(
      async (request) => ({ ...request, revealed: true })
    );
    const context = createMockContext({
      readDocument: vi.fn(async (request) => ({
        canonicalPath: request.path,
        kind: "binary" as const,
        mime: "application/pdf",
        mtimeMs: 1,
        path: request.path,
        revision: "file-v1:pdf-revision",
        root: request.root,
        size: 1536,
      })),
      reveal,
    });
    renderFilePanel(
      {
        context: panelContext,
        source: { kind: "disk", path: "docs/report.pdf", root: PROJECT_ROOT },
      },
      context
    );

    expect(await screen.findByText("application/pdf · 1.5 KB")).toBeVisible();
    expect(
      screen
        .getByText("application/pdf · 1.5 KB")
        .closest('[data-slot="empty"]')
    ).not.toBeNull();
    expect(screen.queryByText("Saved")).toBeNull();

    const revealButton = screen.getByRole("button", {
      name: "Show in file manager",
    });
    expect(revealButton).toHaveAttribute("data-variant", "default");
    fireEvent.click(revealButton);
    await waitFor(() => {
      expect(reveal).toHaveBeenCalledWith({
        path: "docs/report.pdf",
        root: PROJECT_ROOT,
      });
    });
  });

  it("shows technical reveal failures in the host dialog", async () => {
    const context = createMockContext({
      readDocument: vi.fn(async (request) => ({
        canonicalPath: request.path,
        kind: "binary" as const,
        mime: "application/octet-stream",
        mtimeMs: 1,
        path: request.path,
        revision: "file-v1:binary-revision",
        root: request.root,
        size: 4,
      })),
      reveal: vi.fn(async () => {
        throw new Error("Finder unavailable");
      }),
    });
    renderFilePanel(
      {
        context: panelContext,
        source: { kind: "disk", path: "data.bin", root: PROJECT_ROOT },
      },
      context
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Show in file manager" })
    );

    await waitFor(() => {
      expect(context.dialogs.alert).toHaveBeenCalledWith({
        body: "Finder unavailable",
        title: "Unable to show file in file manager",
      });
    });
  });

  it("uses Empty for views that are not implemented", () => {
    const context = createMockContext();
    const controller = filesRuntimeFor(context).controller;
    const { container } = render(
      <FileEditorAdapter
        controller={controller}
        documentId="unimplemented"
        editorSessionId="unimplemented"
        mode="rich"
        openExternal={() => undefined}
        value=""
      />
    );

    expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
    expect(
      screen.getByText("Rich Markdown editing is not enabled yet.")
    ).toBeVisible();
  });

  it("hides repository metadata by default while keeping developer dotfiles visible", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(async () => [
      { kind: "file", path: ".git", root: PROJECT_ROOT },
      { kind: "directory", path: ".svn", root: PROJECT_ROOT },
      { kind: "file", path: ".DS_Store", root: PROJECT_ROOT },
      { kind: "file", path: ".env", root: PROJECT_ROOT },
      { kind: "directory", path: ".github", root: PROJECT_ROOT },
      { kind: "file", path: ".gitignore", root: PROJECT_ROOT },
    ]);
    const { container } = renderFilePanel(
      { context: panelContext },
      createMockContext({ list })
    );

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });
    const tree = within(getFileTree(container));
    expect(tree.queryByRole("treeitem", { name: /^\.git$/ })).toBeNull();
    expect(tree.queryByRole("treeitem", { name: /^\.svn$/ })).toBeNull();
    expect(tree.queryByRole("treeitem", { name: /^\.DS_Store$/ })).toBeNull();
    expect(tree.getByRole("treeitem", { name: /^\.env$/ })).toBeVisible();
    expect(tree.getByRole("treeitem", { name: /^\.github$/ })).toBeVisible();
    expect(tree.getByRole("treeitem", { name: /^\.gitignore$/ })).toBeVisible();
  });

  it("can hide Git-ignored files independently from default exclusions", async () => {
    const configurationGet = <T,>(key: string): T =>
      (key === FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY
        ? false
        : undefined) as T;
    const list = vi.fn<RendererPluginContext["files"]["list"]>(async () => [
      { kind: "file", path: ".env", root: PROJECT_ROOT },
      { kind: "directory", path: "dist", root: PROJECT_ROOT },
      { kind: "directory", path: "src", root: PROJECT_ROOT },
    ]);
    const listIgnored = vi.fn(async () => ["dist/"]);
    const { container } = renderFilePanel(
      { context: panelContext },
      createMockContext({ configurationGet, list, listIgnored })
    );

    await waitFor(() => {
      expect(listIgnored).toHaveBeenCalledWith(PROJECT_ROOT);
    });
    const tree = within(getFileTree(container));
    expect(tree.queryByRole("treeitem", { name: /^dist$/ })).toBeNull();
    expect(tree.getByRole("treeitem", { name: /^src$/ })).toBeVisible();
    expect(tree.getByRole("treeitem", { name: /^\.env$/ })).toBeVisible();
  });

  it("applies customized exclusion patterns instead of hardcoded paths", async () => {
    const configurationGet = <T,>(key: string): T => {
      if (key === FILES_TREE_SHOW_EXCLUDED_SETTING_KEY) {
        return false as T;
      }
      if (key === FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY) {
        return "**/build" as T;
      }
      if (key === FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY) {
        return true as T;
      }
      return undefined as T;
    };
    const list = vi.fn<RendererPluginContext["files"]["list"]>(async () => [
      { kind: "directory", path: ".git", root: PROJECT_ROOT },
      { kind: "directory", path: "build", root: PROJECT_ROOT },
      { kind: "file", path: ".env", root: PROJECT_ROOT },
    ]);
    const { container } = renderFilePanel(
      { context: panelContext },
      createMockContext({ configurationGet, list })
    );

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });
    const tree = within(getFileTree(container));
    expect(tree.queryByRole("treeitem", { name: /^build$/ })).toBeNull();
    expect(tree.getByRole("treeitem", { name: /^\.git$/ })).toBeVisible();
    expect(tree.getByRole("treeitem", { name: /^\.env$/ })).toBeVisible();
  });

  it("applies visibility settings live without reopening a collapsed directory", async () => {
    let excludePatterns = FILES_TREE_DEFAULT_EXCLUDE_PATTERNS;
    let showExcluded = true;
    const configurationListeners = new Set<
      Parameters<RendererPluginContext["configuration"]["onDidChange"]>[0]
    >();
    const configurationGet = <T,>(key: string): T => {
      if (key === FILES_TREE_SHOW_EXCLUDED_SETTING_KEY) {
        return showExcluded as T;
      }
      if (key === FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY) {
        return excludePatterns as T;
      }
      if (key === FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY) {
        return true as T;
      }
      return undefined as T;
    };
    const configurationOnDidChange: RendererPluginContext["configuration"]["onDidChange"] =
      (listener) => {
        configurationListeners.add(listener);
        return () => configurationListeners.delete(listener);
      };
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async (_root, options) => {
        switch (options?.path) {
          case "":
            return [
              { kind: "directory", path: ".git", root: PROJECT_ROOT },
              { kind: "directory", path: "docs", root: PROJECT_ROOT },
              { kind: "directory", path: "src", root: PROJECT_ROOT },
            ];
          case "docs":
            return [
              { kind: "file", path: "docs/index.md", root: PROJECT_ROOT },
            ];
          case "src":
            return [{ kind: "file", path: "src/index.ts", root: PROJECT_ROOT }];
          default:
            return [];
        }
      }
    );
    const { container } = renderFilePanel(
      { context: panelContext },
      createMockContext({
        configurationGet,
        configurationOnDidChange,
        list,
      })
    );

    await waitFor(() => {
      expect(
        within(getFileTree(container)).getByRole("treeitem", {
          name: /^\.git$/,
        })
      ).toBeVisible();
    });
    let tree = within(getFileTree(container));
    fireEvent.click(tree.getByRole("treeitem", { name: /^src$/ }));
    await waitFor(() => {
      expect(tree.getByRole("treeitem", { name: "index.ts" })).toBeVisible();
    });
    fireEvent.click(tree.getByRole("treeitem", { name: /^src$/ }));
    fireEvent.click(tree.getByRole("treeitem", { name: /^docs$/ }));
    await waitFor(() => {
      expect(tree.getByRole("treeitem", { name: "index.md" })).toBeVisible();
    });

    showExcluded = false;
    act(() => {
      const event = {
        affectsConfiguration: (prefix: string) =>
          prefix === FILES_TREE_SHOW_EXCLUDED_SETTING_KEY,
      };
      for (const listener of configurationListeners) {
        listener(event);
      }
    });

    await waitFor(() => {
      tree = within(getFileTree(container));
      expect(tree.queryByRole("treeitem", { name: /^\.git$/ })).toBeNull();
      expect(tree.getByRole("treeitem", { name: /^src$/ })).toHaveAttribute(
        "aria-expanded",
        "false"
      );
      expect(tree.getByRole("treeitem", { name: /^docs$/ })).toHaveAttribute(
        "aria-expanded",
        "true"
      );
      expect(tree.getByRole("treeitem", { name: "index.md" })).toBeVisible();
    });

    excludePatterns = "**/docs";
    act(() => {
      const event = {
        affectsConfiguration: (prefix: string) =>
          prefix === FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
      };
      for (const listener of configurationListeners) {
        listener(event);
      }
    });

    await waitFor(() => {
      tree = within(getFileTree(container));
      expect(tree.getByRole("treeitem", { name: /^\.git$/ })).toBeVisible();
      expect(tree.queryByRole("treeitem", { name: /^docs$/ })).toBeNull();
      expect(tree.getByRole("treeitem", { name: /^src$/ })).toHaveAttribute(
        "aria-expanded",
        "false"
      );
    });
  });

  it("shows the contents of an isolated directory chain on the first expansion", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async (_root, options) => {
        switch (options?.path) {
          case "":
            return [{ kind: "directory", path: "src", root: PROJECT_ROOT }];
          case "src":
            return [
              {
                kind: "directory",
                path: "src/generated",
                root: PROJECT_ROOT,
              },
            ];
          case "src/generated":
            return [
              {
                kind: "file",
                path: "src/generated/index.ts",
                root: PROJECT_ROOT,
              },
            ];
          default:
            return [];
        }
      }
    );
    const { container } = renderFilePanel(
      { context: panelContext },
      createMockContext({ list })
    );

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });
    const tree = getFileTree(container);
    // Empty-directory chains may render as a single flattened row
    // ("src / generated") after the first child list resolves.
    const srcRow = within(tree).queryByRole("treeitem", { name: "src" });
    if (srcRow) {
      fireEvent.click(srcRow);
    }
    await waitFor(() => {
      expect(
        within(tree).getByRole("treeitem", {
          name: /generated|index\.ts/u,
        })
      ).toBeVisible();
    });
    const chainRow = within(tree).queryByRole("treeitem", {
      name: /generated/u,
    });
    if (chainRow?.getAttribute("aria-expanded") === "false") {
      fireEvent.click(chainRow);
    }
    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, {
        path: "src/generated",
      });
      expect(
        within(tree).getByRole("treeitem", {
          name: /index\.ts/u,
        })
      ).toBeVisible();
    });
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it("shows directory read details in the host alert and leaves the row retryable", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async (_root, options) => {
        if (options?.path === "") {
          return [{ kind: "directory", path: "src", root: PROJECT_ROOT }];
        }
        throw new Error("Permission denied");
      }
    );
    const context = createMockContext({ list });
    const { container } = renderFilePanel({ context: panelContext }, context);

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });
    fireEvent.click(
      within(getFileTree(container)).getByRole("treeitem", { name: "src" })
    );

    await waitFor(() => {
      expect(context.dialogs.alert).toHaveBeenCalledWith({
        body: "Permission denied",
        size: "default",
        title: "Unable to load folder",
      });
    });
    const row = within(getFileTree(container)).getByRole("treeitem", {
      name: "src",
    });
    fireEvent.click(row);
    fireEvent.click(row);
    await waitFor(() => {
      expect(list).toHaveBeenCalledTimes(3);
    });
  });

  it("dispatches files/tree-item context menu with the row's data-item-path metadata", async () => {
    // 右键树某行 → @pierre/trees 先解析压缩行的真实目标并维护焦点语义，
    // Pier 桥接层再把 caller path 与类型转发给宿主原生菜单。
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const popup = vi.fn<RendererPluginContext["contextMenu"]["popup"]>(
      async () => {
        /* accept without further processing */
      }
    );
    const context = createMockContext({ list });
    context.contextMenu = { popup };
    const Panel = createFilePanel(context);
    const { container } = render(
      <Panel {...makeProps({ context: panelContext })} />
    );

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });

    const row = within(getFileTree(container)).getByRole("treeitem", {
      name: "README.md",
    });
    expect(row.getAttribute("data-item-path")).toBe("README.md");
    fireEvent.contextMenu(row);

    await waitFor(() => {
      expect(popup).toHaveBeenCalledTimes(1);
    });
    expect(popup.mock.calls[0]?.[0]).toBe("files/tree-item");
    expect(popup.mock.calls[0]?.[2]).toMatchObject({
      metadata: {
        kind: "file",
        path: "README.md",
        root: PROJECT_ROOT,
      },
    });
  });

  it("dispatches the same command surface for directory rows", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(async () => [
      { kind: "directory", path: "src", root: PROJECT_ROOT },
    ]);
    const popup = vi.fn<RendererPluginContext["contextMenu"]["popup"]>(
      async () => undefined
    );
    const context = createMockContext({ list });
    context.contextMenu = { popup };
    const { container } = renderFilePanel({ context: panelContext }, context);

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });
    fireEvent.contextMenu(
      within(getFileTree(container)).getByRole("treeitem", { name: "src" })
    );

    await waitFor(() => {
      expect(popup).toHaveBeenCalledWith(
        "files/tree-item",
        expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
        }),
        expect.objectContaining({
          metadata: expect.objectContaining({
            kind: "directory",
            path: "src",
            root: PROJECT_ROOT,
          }),
        })
      );
    });
  });

  it("opens files/tree-background context menu when the right-click target has no data-item-path", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const popup = vi.fn<RendererPluginContext["contextMenu"]["popup"]>(
      async () => undefined
    );
    const context = createMockContext({ list });
    context.contextMenu = { popup };
    const Panel = createFilePanel(context);
    const { container } = render(
      <Panel {...makeProps({ context: panelContext })} />
    );

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });

    // 右键 sidebar 空白区(aside 内但不属于任何 treeitem) → 根级新建菜单。
    const sidebar = container.querySelector("aside") as HTMLElement;
    const header = sidebar.querySelector("div") as HTMLElement;
    fireEvent.contextMenu(header);

    expect(popup).toHaveBeenCalledWith(
      "files/tree-background",
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          root: PROJECT_ROOT,
        }),
      })
    );
  });

  it("dispatches files/editor context menu with selection ranges", async () => {
    const popup = vi.fn<RendererPluginContext["contextMenu"]["popup"]>(
      async () => {
        /* accept without further processing */
      }
    );
    const context = createMockContext({
      readText: vi.fn(async () => "line-1\nline-2\nline-3\n"),
    });
    context.contextMenu = { popup };
    const Panel = createFilePanel(context);
    const { container } = render(
      <Panel
        {...makeProps({
          context: panelContext,
          source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
        })}
      />
    );

    await screen.findByText("Saved");

    // 选中前 6 个字符,右键编辑器 → 拿 selection.ranges 拼 metadata。
    const view = findCodeMirrorView(container);
    act(() => {
      view.dispatch({ selection: { anchor: 0, head: 6 } });
    });
    const editorEl = container.querySelector(".cm-content") as HTMLElement;
    fireEvent.contextMenu(editorEl);

    expect(popup).toHaveBeenCalledTimes(1);
    expect(popup.mock.calls[0]?.[0]).toBe("files/editor");
    const invocation = popup.mock.calls[0]?.[2] as {
      metadata?: { ranges?: readonly unknown[]; source?: unknown };
      sourcePanelComponent?: string;
    };
    expect(invocation.sourcePanelComponent).toBe("pier.files.filePanel");
    expect(invocation.metadata?.source).toMatchObject({
      kind: "disk",
      path: "README.md",
      root: PROJECT_ROOT,
    });
    const ranges = invocation.metadata?.ranges as
      | readonly {
          endCol: number;
          endLine: number;
          from: number;
          startCol: number;
          startLine: number;
          to: number;
        }[]
      | undefined;
    expect(ranges?.length).toBe(1);
    expect(ranges?.[0]).toEqual({
      endCol: 7,
      endLine: 1,
      from: 0,
      startCol: 1,
      startLine: 1,
      to: 6,
    });
  });

  it("routes editor actions to the editor session that opened the context menu", async () => {
    const source = {
      kind: "disk" as const,
      path: "README.md",
      root: PROJECT_ROOT,
    };
    const contents = "alpha\nbeta\n";
    const document = ensureDiskDocument(source);
    markDocumentLoaded(document.id, contents, 10);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      globalThis.navigator,
      "clipboard"
    );
    const writeText = vi.fn<(text: string) => Promise<void>>(
      async () => undefined
    );
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn(async () => ""),
        writeText,
      },
    });

    try {
      const popup = vi.fn<RendererPluginContext["contextMenu"]["popup"]>(
        async () => {
          /* accept without further processing */
        }
      );
      const context = createMockContext({
        readText: vi.fn(async () => contents),
      });
      context.contextMenu = { popup };
      const Panel = createFilePanel(context);
      const left = render(
        <Panel
          {...makeProps(
            { context: panelContext, source },
            { id: "left-file-panel" }
          )}
        />
      );
      const right = render(
        <Panel
          {...makeProps(
            { context: panelContext, source },
            { id: "right-file-panel" }
          )}
        />
      );

      await waitFor(() => {
        expect(findCodeMirrorView(left.container).state.doc.toString()).toBe(
          contents
        );
        expect(findCodeMirrorView(right.container).state.doc.toString()).toBe(
          contents
        );
      });

      const leftView = findCodeMirrorView(left.container);
      const rightView = findCodeMirrorView(right.container);
      act(() => {
        leftView.dispatch({ selection: { anchor: 0, head: 5 } });
        rightView.dispatch({ selection: { anchor: 6, head: 10 } });
      });

      fireEvent.contextMenu(
        left.container.querySelector(".cm-content") as HTMLElement
      );

      expect(popup).toHaveBeenCalledTimes(1);
      const invocation = popup.mock.calls[0]?.[2] as
        | RendererPluginActionInvocation
        | undefined;
      const metadata = invocation?.metadata as
        | { documentId?: string; editorSessionId?: string }
        | undefined;
      expect(metadata?.documentId).toBe(document.id);
      expect(metadata?.editorSessionId).toContain("left-file-panel");

      const copyAction = createFilesEditorActions(
        context,
        filesRuntimeFor(context).controller
      ).find((action) => action.id === FILES_EDITOR_COPY_COMMAND_ID);
      if (!copyAction) {
        throw new Error("copy action was not registered");
      }
      await copyAction.handler(invocation);

      expect(writeText).toHaveBeenCalledWith("alpha");
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(
          globalThis.navigator,
          "clipboard",
          clipboardDescriptor
        );
      } else {
        Reflect.deleteProperty(globalThis.navigator, "clipboard");
      }
    }
  });

  it("routes editor actions to the source group editor session when the same file is open in two groups", async () => {
    const source = {
      kind: "disk" as const,
      path: "README.md",
      root: PROJECT_ROOT,
    };
    const contents = "alpha\nbeta\n";
    const document = ensureDiskDocument(source);
    markDocumentLoaded(document.id, contents, 10);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      globalThis.navigator,
      "clipboard"
    );
    const writeText = vi.fn<(text: string) => Promise<void>>(
      async () => undefined
    );
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn(async () => ""),
        writeText,
      },
    });

    try {
      const popup = vi.fn<RendererPluginContext["contextMenu"]["popup"]>(
        async () => {
          /* accept without further processing */
        }
      );
      const context = createMockContext({
        readText: vi.fn(async () => contents),
      });
      context.contextMenu = { popup };
      const Panel = createFilePanel(context);
      const groupA = createFakeGroup("same-file-group-a");
      const groupB = createFakeGroup("same-file-group-b");
      const panelA = groupA.makeFilesPanel("same-file-panel-a", {
        context: panelContext,
        source,
      });
      const panelB = groupB.makeFilesPanel("same-file-panel-b", {
        context: panelContext,
        source,
      });
      groupA.setActivePanel(panelA);
      groupB.setActivePanel(panelB);

      render(
        <>
          <Panel
            {...makeProps(
              { context: panelContext, source },
              { group: groupA, id: "same-file-panel-a", isActive: true }
            )}
          />
          <Panel
            {...makeProps(
              { context: panelContext, source },
              { group: groupB, id: "same-file-panel-b", isActive: true }
            )}
          />
        </>
      );

      const containerA = groupA.element.querySelector(".dv-content-container");
      const containerB = groupB.element.querySelector(".dv-content-container");
      await waitFor(() => {
        expect(
          findCodeMirrorView(containerA as HTMLElement).state.doc.toString()
        ).toBe(contents);
        expect(
          findCodeMirrorView(containerB as HTMLElement).state.doc.toString()
        ).toBe(contents);
      });

      const viewA = findCodeMirrorView(containerA as HTMLElement);
      const viewB = findCodeMirrorView(containerB as HTMLElement);
      act(() => {
        viewA.dispatch({ selection: { anchor: 0, head: 5 } });
        viewB.dispatch({ selection: { anchor: 6, head: 10 } });
      });
      fireEvent.contextMenu(
        containerA?.querySelector(".cm-content") as HTMLElement
      );

      const invocation = popup.mock.calls[0]?.[2] as
        | RendererPluginActionInvocation
        | undefined;
      const metadata = invocation?.metadata as
        | { documentId?: string; editorSessionId?: string }
        | undefined;
      expect(metadata?.documentId).toBe(document.id);
      expect(metadata?.editorSessionId).toContain("same-file-panel-a");

      const copyAction = createFilesEditorActions(
        context,
        filesRuntimeFor(context).controller
      ).find((action) => action.id === FILES_EDITOR_COPY_COMMAND_ID);
      if (!copyAction) {
        throw new Error("copy action was not registered");
      }
      await copyAction.handler(invocation);

      expect(writeText).toHaveBeenCalledWith("alpha");
      groupA.element.remove();
      groupB.element.remove();
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(
          globalThis.navigator,
          "clipboard",
          clipboardDescriptor
        );
      } else {
        Reflect.deleteProperty(globalThis.navigator, "clipboard");
      }
    }
  });

  it("does not run editor actions against a removed document's stale editor view", async () => {
    const source = {
      kind: "disk" as const,
      path: "README.md",
      root: PROJECT_ROOT,
    };
    const document = ensureDiskDocument(source);
    markDocumentLoaded(document.id, "alpha\n", 10);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      globalThis.navigator,
      "clipboard"
    );
    const writeText = vi.fn<(text: string) => Promise<void>>(
      async () => undefined
    );
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn(async () => ""),
        writeText,
      },
    });

    try {
      const popup = vi.fn<RendererPluginContext["contextMenu"]["popup"]>(
        async () => {
          /* accept without further processing */
        }
      );
      const context = createMockContext({
        readText: vi.fn(async () => "alpha\n"),
      });
      context.contextMenu = { popup };
      const Panel = createFilePanel(context);
      const { container } = render(
        <Panel
          {...makeProps(
            { context: panelContext, source },
            { id: "stale-action-panel" }
          )}
        />
      );

      await screen.findByText("Saved");
      const view = findCodeMirrorView(container);
      act(() => {
        view.dispatch({ selection: { anchor: 0, head: 5 } });
      });
      fireEvent.contextMenu(
        container.querySelector(".cm-content") as HTMLElement
      );
      const invocation = popup.mock.calls[0]?.[2] as
        | RendererPluginActionInvocation
        | undefined;

      act(() => {
        removeDocument(document.id);
      });

      const copyAction = createFilesEditorActions(
        context,
        filesRuntimeFor(context).controller
      ).find((action) => action.id === FILES_EDITOR_COPY_COMMAND_ID);
      if (!copyAction) {
        throw new Error("copy action was not registered");
      }
      await copyAction.handler(invocation);

      expect(writeText).not.toHaveBeenCalled();
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(
          globalThis.navigator,
          "clipboard",
          clipboardDescriptor
        );
      } else {
        Reflect.deleteProperty(globalThis.navigator, "clipboard");
      }
    }
  });

  it("opens tree files as a preview instance via openInstance (dropUnpinnedInstances = true)", async () => {
    // Cursor 语义:单击树 = preview,宿主 openInstance 收到 pinned:false +
    // dropUnpinnedInstances:true,新 preview 面板顶替现有 preview 位置。
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const openInstance =
      vi.fn<RendererPluginContext["panels"]["openInstance"]>();
    const updateParameters = vi.fn();
    const context = createMockContext({
      list,
      openInstance,
      readText: vi.fn(async () => "# Loaded\n"),
    });
    const Panel = createFilePanel(context);
    const { container } = render(
      <Panel {...makeProps({ context: panelContext }, { updateParameters })} />
    );

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });
    fireEvent.click(
      within(getFileTree(container)).getByRole("treeitem", {
        name: "README.md",
      })
    );

    expect(openInstance).toHaveBeenCalledTimes(1);
    const firstCall = openInstance.mock.calls[0]?.[0];
    expect(firstCall).toMatchObject({
      componentId: "pier.files.filePanel",
      context: panelContext,
      dropUnpinnedInstances: true,
      params: {
        pinned: false,
        source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
      },
      title: "README.md",
    });
    expect(firstCall?.instanceId).toMatch(FILE_PANEL_DISK_INSTANCE_ID);
    // 单击不再复用当前 panel 的 updateParameters —— 新 preview 走 openInstance。
    expect(updateParameters).not.toHaveBeenCalled();
  });

  it("opens two different tree files each as a preview (dropUnpinnedInstances stays true)", async () => {
    // 单击 A 后单击 B:两次都走 pinned:false + dropUnpinnedInstances:true,
    // 宿主 openInstance 逻辑负责关掉旧 preview 面板。文件面板本身两次调用
    // 用相同语义,不做区分。
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "src/a.ts", root: PROJECT_ROOT },
          { kind: "file", path: "src/b.ts", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const openInstance =
      vi.fn<RendererPluginContext["panels"]["openInstance"]>();
    const context = createMockContext({ list, openInstance });
    const Panel = createFilePanel(context);
    const { container } = render(
      <Panel {...makeProps({ context: panelContext })} />
    );

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });
    fireEvent.click(
      within(getFileTree(container)).getByRole("treeitem", { name: "a.ts" })
    );
    fireEvent.click(
      within(getFileTree(container)).getByRole("treeitem", { name: "b.ts" })
    );

    expect(openInstance).toHaveBeenCalledTimes(2);
    expect(openInstance.mock.calls[0]?.[0]).toMatchObject({
      dropUnpinnedInstances: true,
      params: {
        pinned: false,
        source: { kind: "disk", path: "src/a.ts", root: PROJECT_ROOT },
      },
    });
    expect(openInstance.mock.calls[1]?.[0]).toMatchObject({
      dropUnpinnedInstances: true,
      params: {
        pinned: false,
        source: { kind: "disk", path: "src/b.ts", root: PROJECT_ROOT },
      },
    });
    // 两次不同文件的 instanceId 必须不同,否则新 preview 会被"激活已有"分支
    // 吞掉而不新开,与"每个文件独占一个 panel id"契约不一致。
    expect(openInstance.mock.calls[0]?.[0].instanceId).not.toBe(
      openInstance.mock.calls[1]?.[0].instanceId
    );
  });

  it("double-clicks a tree row to promote from preview to pinned", async () => {
    // Cursor 语义:第一次点开 preview (pinned:false);随后 dblclick 同一 row
    // → 走 pinned:true 分支。组内已有同源 preview 时复用同一实例并提升
    // pinned,不再依赖 deterministic id。
    // @pierre/trees 的 onOpenPath 只在 selection 变化时触发,双击靠原生
    // dblclick 分支承接。
    const source = {
      kind: "disk",
      path: "src/a.ts",
      root: PROJECT_ROOT,
    } satisfies FilesDocumentPanelSource;
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: source.path, root: source.root },
        ] satisfies FileEntry[]
    );
    const openedInstances: Array<{
      groupId: string | null;
      id: string;
      params?: Record<string, unknown> | undefined;
      title: string;
    }> = [];
    const listInstances = vi.fn<
      RendererPluginContext["panels"]["listInstances"]
    >(() =>
      openedInstances.map((instance) => {
        const snapshot = {
          componentId: "pier.files.filePanel",
          groupId: instance.groupId,
          id: instance.id,
          title: instance.title,
        };
        return instance.params === undefined
          ? snapshot
          : { ...snapshot, params: instance.params };
      })
    );
    const openInstance = vi.fn<RendererPluginContext["panels"]["openInstance"]>(
      (options) => {
        openedInstances.push({
          groupId: options.targetGroupId ?? null,
          id: options.instanceId,
          params: options.params,
          title: options.title ?? options.instanceId,
        });
        return { kind: "opened" };
      }
    );
    const context = createMockContext({ list, listInstances, openInstance });
    const Panel = createFilePanel(context);
    const group = createFakeGroup("promote-existing-group");
    const filesPanel = group.makeFilesPanel("empty-promote-panel", {
      context: panelContext,
    });
    group.setActivePanel(filesPanel);
    render(
      <Panel
        {...makeProps(
          { context: panelContext },
          { group, id: "empty-promote-panel", isActive: true }
        )}
      />
    );

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });

    const row = within(getFileTree(group.element)).getByRole("treeitem", {
      name: "a.ts",
    });
    fireEvent.click(row);
    fireEvent.doubleClick(row);

    expect(openInstance).toHaveBeenCalledTimes(2);
    expect(openInstance.mock.calls[0]?.[0]).toMatchObject({
      dropUnpinnedInstances: true,
      instanceId: expect.stringMatching(FILE_PANEL_DISK_INSTANCE_ID),
      params: { pinned: false },
      targetGroupId: "promote-existing-group",
    });
    expect(openInstance.mock.calls[1]?.[0]).toMatchObject({
      dropUnpinnedInstances: false,
      instanceId: openInstance.mock.calls[0]?.[0].instanceId,
      params: { pinned: true },
      targetGroupId: "promote-existing-group",
    });
    expect(openInstance.mock.calls[0]?.[0].instanceId).toContain(
      `${fileFilePanelIdentityKey(source)}:`
    );
    group.element.remove();
  });

  it("reuses an already-open tree file in the same group without dropping full params", async () => {
    const source = {
      kind: "disk",
      path: "README.md",
      root: PROJECT_ROOT,
    } satisfies FilesDocumentPanelSource;
    const list = vi.fn<RendererPluginContext["files"]["list"]>(async () => [
      { kind: "file", path: source.path, root: source.root },
    ]);
    const openInstance =
      vi.fn<RendererPluginContext["panels"]["openInstance"]>();
    const existingParams = {
      context: panelContext,
      dirty: true,
      pinned: false,
      pluginComponentId: "pier.files.filePanel",
      source,
    };
    const listInstances = vi.fn<
      RendererPluginContext["panels"]["listInstances"]
    >(() => [
      {
        componentId: "pier.files.filePanel",
        groupId: "reuse-same-group",
        id: "existing-file-panel",
        params: existingParams,
        title: "README.md",
      },
      {
        componentId: "pier.files.filePanel",
        groupId: "other-group",
        id: "other-group-file-panel",
        params: existingParams,
        title: "README.md",
      },
    ]);
    const context = createMockContext({
      list,
      listInstances,
      openInstance,
      readText: vi.fn(async () => "# Already open\n"),
    });
    const Panel = createFilePanel(context);
    const group = createFakeGroup("reuse-same-group");
    const filesPanel = group.makeFilesPanel("reuse-active-panel", {
      context: panelContext,
    });
    group.setActivePanel(filesPanel);
    render(
      <Panel
        {...makeProps(
          { context: panelContext },
          { group, id: "reuse-active-panel", isActive: true }
        )}
      />
    );

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });
    fireEvent.click(
      within(getFileTree(group.element)).getByRole("treeitem", {
        name: "README.md",
      })
    );

    expect(openInstance).toHaveBeenCalledTimes(1);
    expect(openInstance.mock.calls[0]?.[0]).toMatchObject({
      componentId: "pier.files.filePanel",
      dropUnpinnedInstances: false,
      instanceId: "existing-file-panel",
      params: existingParams,
      targetGroupId: "reuse-same-group",
      title: "README.md",
    });
    group.element.remove();
  });

  it("reuses an already pinned same-source tab without overwriting its source", async () => {
    const groupId = "reuse-pinned-source-group";
    const staleSource = {
      id: "pier.files.untitled:shared-nav",
      kind: "untitled",
      name: "Old Name.md",
    } satisfies FilesDocumentPanelSource;
    const currentSource = {
      ...staleSource,
      name: "Current Name.md",
    } satisfies FilesDocumentPanelSource;
    const otherSource = {
      kind: "disk",
      path: "README.md",
      root: PROJECT_ROOT,
    } satisfies FilesDocumentPanelSource;
    pushFilesNavEntry(groupId, staleSource);
    pushFilesNavEntry(groupId, otherSource);

    const existingParams = {
      context: panelContext,
      dirty: true,
      pinned: true,
      pluginComponentId: "pier.files.filePanel",
      source: currentSource,
    };
    const listInstances = vi.fn<
      RendererPluginContext["panels"]["listInstances"]
    >(() => [
      {
        componentId: "pier.files.filePanel",
        groupId,
        id: "existing-pinned-untitled",
        params: existingParams,
        title: "Current Name.md",
      },
    ]);
    const openInstance =
      vi.fn<RendererPluginContext["panels"]["openInstance"]>();
    const context = createMockContext({ listInstances, openInstance });
    const Panel = createFilePanel(context);
    const group = createFakeGroup(groupId);
    const activePanel = group.makeFilesPanel("active-other-file", {
      context: panelContext,
      source: otherSource,
    });
    group.setActivePanel(activePanel);

    render(
      <Panel
        {...makeProps(
          { context: panelContext, source: otherSource },
          { group, id: "active-other-file", isActive: true }
        )}
      />
    );

    const backButton = await screen.findByRole("button", { name: "Back" });
    expect(backButton).toBeEnabled();
    fireEvent.click(backButton);

    expect(openInstance).toHaveBeenCalledTimes(1);
    expect(openInstance.mock.calls[0]?.[0]).toMatchObject({
      componentId: "pier.files.filePanel",
      dropUnpinnedInstances: false,
      instanceId: "existing-pinned-untitled",
      params: existingParams,
      targetGroupId: groupId,
      title: "Current Name.md",
    });
    group.element.remove();
  });

  it("opens the same disk file as independent tab instances in different groups", async () => {
    const source = {
      kind: "disk",
      path: "README.md",
      root: PROJECT_ROOT,
    } satisfies FilesDocumentPanelSource;
    const list = vi.fn<RendererPluginContext["files"]["list"]>(async () => [
      { kind: "file", path: source.path, root: source.root },
    ]);
    const groupAInstanceId = createFileFilePanelInstanceId(source, "group-a");
    const listInstances = vi.fn<
      RendererPluginContext["panels"]["listInstances"]
    >(() => [
      {
        componentId: "pier.files.filePanel",
        groupId: "group-a",
        id: groupAInstanceId,
        params: { context: panelContext, pinned: false, source },
        title: "README.md",
      },
    ]);
    const openInstance =
      vi.fn<RendererPluginContext["panels"]["openInstance"]>();
    const context = createMockContext({ list, listInstances, openInstance });
    const Panel = createFilePanel(context);
    const groupB = createFakeGroup("group-b");
    const filesPanel = groupB.makeFilesPanel("group-b-active-panel", {
      context: panelContext,
    });
    groupB.setActivePanel(filesPanel);
    render(
      <Panel
        {...makeProps(
          { context: panelContext },
          { group: groupB, id: "group-b-active-panel", isActive: true }
        )}
      />
    );

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });
    fireEvent.click(
      within(getFileTree(groupB.element)).getByRole("treeitem", {
        name: "README.md",
      })
    );

    expect(openInstance).toHaveBeenCalledTimes(1);
    expect(openInstance.mock.calls[0]?.[0]).toMatchObject({
      componentId: "pier.files.filePanel",
      dropUnpinnedInstances: true,
      params: { pinned: false, source },
      targetGroupId: "group-b",
      title: "README.md",
    });
    expect(openInstance.mock.calls[0]?.[0].instanceId).toMatch(
      FILE_PANEL_DISK_INSTANCE_ID
    );
    expect(openInstance.mock.calls[0]?.[0].instanceId).not.toBe(
      groupAInstanceId
    );
    groupB.element.remove();
  });

  it("shares project tree state across file-panel tabs for the same project root", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const context = createMockContext({ list });
    const Panel = createFilePanel(context);

    render(
      <>
        <Panel {...makeProps({ context: panelContext })} />
        <Panel
          {...makeProps({
            context: panelContext,
            source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
          })}
        />
      </>
    );

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("renders an inline project tree when no dockview group is available", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const { container } = renderFilePanel(
      { context: panelContext },
      createMockContext({ list })
    );

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });
    const treeHost = container.querySelector(
      'file-tree-container[data-slot="pier-file-tree"]'
    );
    expect(treeHost).toBeInstanceOf(HTMLElement);
    expect(
      (treeHost as HTMLElement).style.getPropertyValue(
        "--trees-padding-inline-override"
      )
    ).toBe("4px");
  });

  it("never mounts an inline project tree in the thin panel shell when a dockview group is present", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const context = createMockContext({ list });
    const Panel = createFilePanel(context);
    const group = createFakeGroup("no-inline-tree-group");
    const panelParams = {
      context: panelContext,
      source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
    };
    group.setActivePanel(group.makeFilesPanel("thin-file-panel", panelParams));
    const { container } = render(
      <div data-testid="thin-panel-shell">
        <Panel
          {...makeProps(panelParams, {
            group,
            id: "thin-file-panel",
            isActive: true,
          })}
        />
      </div>
    );

    await waitFor(() => {
      expect(
        group.element.querySelector(FILES_GROUP_VIEW_SELECTOR)
      ).toBeInstanceOf(HTMLElement);
    });
    expect(
      container.querySelector(
        'file-tree-container[data-slot="pier-file-tree"]'
      ),
      "thin shell must not render its own tree while the group view owns it"
    ).toBeNull();
    expect(
      group.element.querySelector(
        'file-tree-container[data-slot="pier-file-tree"]'
      )
    ).toBeInstanceOf(HTMLElement);
    group.element.remove();
  });

  it("keeps the group-view project tree host when opening the first file in an empty files tab", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
          { kind: "file", path: "NOTES.md", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const context = createMockContext({ list });
    const Panel = createFilePanel(context);
    const group = createFakeGroup("open-first-file-group");
    const filesPanel = group.makeFilesPanel("empty-file-panel", {
      context: panelContext,
    });
    group.setActivePanel(filesPanel);

    render(
      <Panel
        {...makeProps(
          { context: panelContext },
          { group, id: "empty-file-panel", isActive: true }
        )}
      />
    );

    await waitFor(() => {
      expect(
        group.element.querySelector(
          'file-tree-container[data-slot="pier-file-tree"]'
        )
      ).toBeInstanceOf(HTMLElement);
    });
    const treeHost = group.element.querySelector(
      'file-tree-container[data-slot="pier-file-tree"]'
    );
    expect(treeHost).toBeInstanceOf(HTMLElement);

    // 打开文件 = dockview params 更新(拉取模型:视图经 params 事件重读)。
    act(() => {
      filesPanel.setParams({
        context: panelContext,
        source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
      });
    });

    await waitFor(() => {
      expect(
        group.element.querySelector(FILES_GROUP_VIEW_SELECTOR)
      ).toBeInstanceOf(HTMLElement);
      // Breadcrumb segments are separate nodes; also tolerate tree labels.
      expect(group.element.textContent?.includes("README.md")).toBe(true);
    });
    expect(
      group.element.querySelector(
        'file-tree-container[data-slot="pier-file-tree"]'
      ),
      "opening a file in the active group view must not remount the tree"
    ).toBe(treeHost);
    group.element.remove();
  });

  it("renders the newly opened file after a pinned file remains in the same group", async () => {
    // 回归:pin A 后再打开 B,共享 group view 曾经出现空白或继续绑定 A。
    // 这里模拟 dockview 同组中 pinned A 留存、新 preview B 被创建并激活。
    const readmeSource = {
      kind: "disk" as const,
      path: "README.md",
      root: PROJECT_ROOT,
    };
    const notesSource = {
      kind: "disk" as const,
      path: "NOTES.md",
      root: PROJECT_ROOT,
    };
    const readmeDocument = ensureDiskDocument(readmeSource);
    const notesDocument = ensureDiskDocument(notesSource);
    markDocumentLoaded(readmeDocument.id, "# README\n", 10);
    markDocumentLoaded(notesDocument.id, "# NOTES\n", 20);
    const context = createMockContext({
      readText: vi.fn(async ({ path }) =>
        path === "NOTES.md" ? "# NOTES\n" : "# README\n"
      ),
    });
    const Panel = createFilePanel(context);
    const group = createFakeGroup("pinned-then-open-group");
    const pinnedParams = {
      context: panelContext,
      pinned: true,
      source: readmeSource,
    };
    const previewParams = {
      context: panelContext,
      pinned: false,
      source: notesSource,
    };
    const pinnedPanel = group.makeFilesPanel(
      "readme-pinned-panel",
      pinnedParams
    );
    group.setActivePanel(pinnedPanel);
    const pinnedProps = makeProps(pinnedParams, {
      group,
      id: "readme-pinned-panel",
      isActive: true,
    });
    const rendered = render(<Panel {...pinnedProps} />);
    const container = group.element.querySelector(".dv-content-container");

    await waitFor(() => {
      const groupView = container?.querySelector(FILES_GROUP_VIEW_SELECTOR);
      expect((groupView as HTMLElement)?.textContent).toContain("README.md");
      expect((groupView as HTMLElement)?.textContent).toContain("# README");
    });

    const previewPanel = group.makeFilesPanel(
      "notes-preview-panel",
      previewParams
    );
    const previewProps = makeProps(previewParams, {
      group,
      id: "notes-preview-panel",
      isActive: true,
    });
    act(() => {
      group.setActivePanel(previewPanel);
    });
    rendered.rerender(
      <>
        <Panel {...pinnedProps} />
        <Panel {...previewProps} />
      </>
    );

    await waitFor(() => {
      const groupView = container?.querySelector(FILES_GROUP_VIEW_SELECTOR);
      expect(groupView).toBeInstanceOf(HTMLElement);
      expect((groupView as HTMLElement).textContent).toContain("NOTES.md");
      expect((groupView as HTMLElement).textContent).toContain("# NOTES");
      expect((groupView as HTMLElement).textContent).not.toContain("# README");
    });
    expect(getDocument(readmeDocument.id)?.dirty).toBe(false);
    expect(getDocument(notesDocument.id)?.dirty).toBe(false);
    group.element.remove();
  });

  it("migrates the shared group view when a file panel is dragged to another group", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const context = createMockContext({ list });
    const Panel = createFilePanel(context);
    const groupA = createFakeGroup("drag-source-group");
    const groupB = createFakeGroup("drag-target-group");
    const groupChangeListeners = new Set<() => void>();
    const props = makeProps(
      {
        context: panelContext,
        source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
      },
      {
        group: groupA,
        id: "dragged-file-panel",
        isActive: true,
        onDidGroupChange: vi.fn((listener: () => void) => {
          groupChangeListeners.add(listener);
          return { dispose: () => groupChangeListeners.delete(listener) };
        }),
      }
    );
    const draggedPanel = groupA.makeFilesPanel("dragged-file-panel", {
      context: panelContext,
      source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
    });
    groupA.setActivePanel(draggedPanel);

    render(<Panel {...props} />);

    const containerA = groupA.element.querySelector(".dv-content-container");
    const containerB = groupB.element.querySelector(".dv-content-container");
    await waitFor(() => {
      expect(
        containerA?.querySelector(FILES_GROUP_VIEW_SELECTOR)
      ).toBeInstanceOf(HTMLElement);
    });
    expect(containerB?.querySelector(FILES_GROUP_VIEW_SELECTOR)).toBeNull();

    // 模拟 dockview 拖拽跨组:api.group 换成目标 group + 触发 onDidGroupChange。
    // 组件不 remount(dockview 只 reparent 内容 DOM)。
    act(() => {
      Object.defineProperty(props.api, "group", {
        configurable: true,
        value: groupB,
      });
      groupA.setActivePanel(null);
      groupB.setActivePanel(draggedPanel);
      for (const listener of groupChangeListeners) {
        listener();
      }
    });

    // 目标 group 建立共享视图并渲染出文件内容(不空白)。
    await waitFor(() => {
      const viewB = containerB?.querySelector(FILES_GROUP_VIEW_SELECTOR);
      expect(viewB).toBeInstanceOf(HTMLElement);
      expect((viewB as HTMLElement).textContent).toContain("README.md");
    });

    // 源 group 的注入视图在 owner 清零后延迟 GC(真实 1s 定时器)。
    await waitFor(
      () => {
        expect(containerA?.querySelector(FILES_GROUP_VIEW_SELECTOR)).toBeNull();
      },
      { timeout: 2500 }
    );

    groupA.element.remove();
    groupB.element.remove();
  });

  it("preserves full dockview params (context) when promoting inside the shared group view", async () => {
    // 回归:group view 曾经由 activeTab.updateParameters 用 {pinned,source}
    // 局部快照回写 params,丢 context → 面板落入 outside-workspace 错误态。
    // 现在 params 唯一写者是薄壳,promote 必须保留 context。
    const document = createUntitledMarkdownDocument({ contents: "# Before\n" });
    const context = createMockContext();
    const Panel = createFilePanel(context);
    const group = createFakeGroup("promote-params-group");
    const initialParams = {
      context: panelContext,
      pinned: false,
      source: { id: document.id, kind: "untitled", name: document.name },
    };
    const filesPanel = group.makeFilesPanel("promote-panel", initialParams);
    // 模拟 dockview updateParameters:merge 进 panel.params 并广播事件。
    const updateParameters = vi.fn((next: Record<string, unknown>) => {
      filesPanel.setParams({ ...filesPanel.params, ...next });
    });
    const props = makeProps(initialParams, {
      group,
      id: "promote-panel",
      isActive: true,
      updateParameters,
    });
    group.setActivePanel(filesPanel);

    render(<Panel {...props} />);
    const container = group.element.querySelector(".dv-content-container");
    await waitFor(() => {
      expect(container?.querySelector(".cm-editor")).toBeInstanceOf(
        HTMLElement
      );
    });

    replaceEditorText(container as HTMLElement, "# After\n");

    await waitFor(() => {
      expect(updateParameters).toHaveBeenCalled();
    });
    for (const call of updateParameters.mock.calls) {
      const params = call[0] as {
        context?: unknown;
        pinned?: unknown;
      };
      // 每一次 params 回写都必须保留 context,不允许局部快照覆盖。
      expect(params.context).toBe(panelContext);
    }
    const lastParams = updateParameters.mock.calls.at(-1)?.[0] as {
      dirty?: unknown;
      pinned?: unknown;
    };
    expect(lastParams.pinned).toBe(true);
    expect(lastParams.dirty).toBe(true);
    group.element.remove();
  });

  it("keeps the source group on its remaining tab after dragging a sibling tab away", async () => {
    // 回归:A 组开 a1/a2,把 a2 拖到 B 组后 A 曾显示 a2 的内容。
    // 拉取模型下视图直读本组 activePanel.params,断言两组各自正确。
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
          { kind: "file", path: "NOTES.md", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const context = createMockContext({
      list,
      readText: vi.fn(async () => "# contents\n"),
    });
    const Panel = createFilePanel(context);
    const groupA = createFakeGroup("two-tab-source-group");
    const groupB = createFakeGroup("two-tab-target-group");
    const a2GroupChangeListeners = new Set<() => void>();

    const a1Props = makeProps(
      {
        context: panelContext,
        source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
      },
      { group: groupA, id: "panel-a1", isActive: false }
    );
    const a2Props = makeProps(
      {
        context: panelContext,
        source: { kind: "disk", path: "NOTES.md", root: PROJECT_ROOT },
      },
      {
        group: groupA,
        id: "panel-a2",
        isActive: true,
        onDidGroupChange: vi.fn((listener: () => void) => {
          a2GroupChangeListeners.add(listener);
          return { dispose: () => a2GroupChangeListeners.delete(listener) };
        }),
      }
    );
    const a1Panel = groupA.makeFilesPanel("panel-a1", {
      context: panelContext,
      source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
    });
    const a2Panel = groupA.makeFilesPanel("panel-a2", {
      context: panelContext,
      source: { kind: "disk", path: "NOTES.md", root: PROJECT_ROOT },
    });
    groupA.setActivePanel(a2Panel);

    render(
      <>
        <Panel {...a1Props} />
        <Panel {...a2Props} />
      </>
    );

    const containerA = groupA.element.querySelector(".dv-content-container");
    const containerB = groupB.element.querySelector(".dv-content-container");
    await waitFor(() => {
      const viewA = containerA?.querySelector(FILES_GROUP_VIEW_SELECTOR);
      expect((viewA as HTMLElement)?.textContent).toContain("NOTES.md");
    });

    // 拖拽 a2 → B:A 组 active 切到 a1、B 组 active = a2,a2 面板收到
    // group change。视图各自拉取本组 live 状态,不依赖任何镜像写入顺序。
    act(() => {
      Object.defineProperty(a2Props.api, "group", {
        configurable: true,
        value: groupB,
      });
      groupA.setActivePanel(a1Panel);
      groupB.setActivePanel(a2Panel);
      for (const listener of a2GroupChangeListeners) {
        listener();
      }
    });

    // A 组自愈到 a1 的文件;B 组展示 a2 的文件。
    await waitFor(() => {
      const viewA = containerA?.querySelector(FILES_GROUP_VIEW_SELECTOR);
      expect((viewA as HTMLElement)?.textContent).toContain("README.md");
      expect((viewA as HTMLElement)?.textContent).not.toContain("NOTES.md");
    });
    await waitFor(() => {
      const viewB = containerB?.querySelector(FILES_GROUP_VIEW_SELECTOR);
      expect((viewB as HTMLElement)?.textContent).toContain("NOTES.md");
    });

    groupA.element.remove();
    groupB.element.remove();
  });

  it("does not write the dragged sibling file contents into the source group remaining document", async () => {
    // 回归: A 组 active=a2,拖 a2 到 B 后,A 组 active 切回 a1。
    // 如果 CodeMirror 会话缓存把 a2 的 EditorState 记到 a1 document 下,
    // a2 内容会写入 a1 document 并把 a1 tab 置脏。
    const packageSource = {
      kind: "disk" as const,
      path: "package.json",
      root: PROJECT_ROOT,
    };
    const builderSource = {
      kind: "disk" as const,
      path: "electron-builder.yml",
      root: PROJECT_ROOT,
    };
    const packageContents = '{ "name": "pier" }\n';
    const builderContents = "appId: io.pier.app\nproductName: Pier\n";
    const packageDocument = ensureDiskDocument(packageSource);
    const builderDocument = ensureDiskDocument(builderSource);
    markDocumentLoaded(packageDocument.id, packageContents, 10);
    markDocumentLoaded(builderDocument.id, builderContents, 20);

    const context = createMockContext({
      readText: vi.fn(async ({ path }) =>
        path === "electron-builder.yml" ? builderContents : packageContents
      ),
    });
    const Panel = createFilePanel(context);
    const groupA = createFakeGroup("drag-content-source-group");
    const groupB = createFakeGroup("drag-content-target-group");
    const builderGroupChangeListeners = new Set<() => void>();
    const packageProps = makeProps(
      { context: panelContext, source: packageSource },
      { group: groupA, id: "package-panel", isActive: false }
    );
    const builderProps = makeProps(
      { context: panelContext, source: builderSource },
      {
        group: groupA,
        id: "builder-panel",
        isActive: true,
        onDidGroupChange: vi.fn((listener: () => void) => {
          builderGroupChangeListeners.add(listener);
          return {
            dispose: () => builderGroupChangeListeners.delete(listener),
          };
        }),
      }
    );
    const packagePanel = groupA.makeFilesPanel("package-panel", {
      context: panelContext,
      source: packageSource,
    });
    const builderPanel = groupA.makeFilesPanel("builder-panel", {
      context: panelContext,
      source: builderSource,
    });
    groupA.setActivePanel(builderPanel);

    render(
      <>
        <Panel {...packageProps} />
        <Panel {...builderProps} />
      </>
    );

    const containerA = groupA.element.querySelector(".dv-content-container");
    const containerB = groupB.element.querySelector(".dv-content-container");
    await waitFor(() => {
      const viewA = containerA?.querySelector(FILES_GROUP_VIEW_SELECTOR);
      expect((viewA as HTMLElement)?.textContent).toContain(
        "electron-builder.yml"
      );
      expect((viewA as HTMLElement)?.textContent).toContain("appId");
    });

    act(() => {
      Object.defineProperty(builderProps.api, "group", {
        configurable: true,
        value: groupB,
      });
      groupA.setActivePanel(packagePanel);
      groupB.setActivePanel(builderPanel);
      for (const listener of builderGroupChangeListeners) {
        listener();
      }
    });

    await waitFor(() => {
      const viewA = containerA?.querySelector(FILES_GROUP_VIEW_SELECTOR);
      expect((viewA as HTMLElement)?.textContent).toContain("package.json");
      expect((viewA as HTMLElement)?.textContent).toContain('"name": "pier"');
    });
    await waitFor(() => {
      const viewB = containerB?.querySelector(FILES_GROUP_VIEW_SELECTOR);
      expect((viewB as HTMLElement)?.textContent).toContain(
        "electron-builder.yml"
      );
      expect((viewB as HTMLElement)?.textContent).toContain("appId");
    });

    expect(getDocument(packageDocument.id)?.currentContents).toBe(
      packageContents
    );
    expect(getDocument(packageDocument.id)?.dirty).toBe(false);
    expect(getDocument(builderDocument.id)?.currentContents).toBe(
      builderContents
    );
    expect(getDocument(builderDocument.id)?.dirty).toBe(false);

    groupA.element.remove();
    groupB.element.remove();
  });

  it("marks only the edited document dirty when two file panels are open", async () => {
    const packageSource = {
      kind: "disk" as const,
      path: "package.json",
      root: PROJECT_ROOT,
    };
    const builderSource = {
      kind: "disk" as const,
      path: "electron-builder.yml",
      root: PROJECT_ROOT,
    };
    const packageDocument = ensureDiskDocument(packageSource);
    const builderDocument = ensureDiskDocument(builderSource);
    markDocumentLoaded(packageDocument.id, '{ "name": "pier" }\n', 10);
    markDocumentLoaded(builderDocument.id, "appId: io.pier.app\n", 20);
    const packageUpdateParameters = vi.fn();
    const builderUpdateParameters = vi.fn();
    const context = createMockContext({
      readText: vi.fn(async ({ path }) =>
        path === "electron-builder.yml"
          ? "appId: io.pier.app\n"
          : '{ "name": "pier" }\n'
      ),
    });
    const Panel = createFilePanel(context);
    const packageRender = render(
      <Panel
        {...makeProps(
          { context: panelContext, source: packageSource },
          {
            id: "dirty-package-panel",
            updateParameters: packageUpdateParameters,
          }
        )}
      />
    );
    const builderRender = render(
      <Panel
        {...makeProps(
          { context: panelContext, source: builderSource },
          {
            id: "dirty-builder-panel",
            updateParameters: builderUpdateParameters,
          }
        )}
      />
    );

    await waitFor(() => {
      expect(
        findCodeMirrorView(packageRender.container).state.doc.toString()
      ).toBe('{ "name": "pier" }\n');
      expect(
        findCodeMirrorView(builderRender.container).state.doc.toString()
      ).toBe("appId: io.pier.app\n");
    });

    replaceEditorText(packageRender.container, '{ "name": "changed" }\n');

    await waitFor(() => {
      expect(getDocument(packageDocument.id)?.dirty).toBe(true);
    });
    expect(getDocument(packageDocument.id)?.currentContents).toBe(
      '{ "name": "changed" }\n'
    );
    expect(getDocument(builderDocument.id)?.dirty).toBe(false);
    expect(getDocument(builderDocument.id)?.currentContents).toBe(
      "appId: io.pier.app\n"
    );
    expect(packageUpdateParameters).toHaveBeenCalledWith(
      expect.objectContaining({ dirty: true })
    );
    expect(builderUpdateParameters).not.toHaveBeenCalledWith(
      expect.objectContaining({ dirty: true })
    );
  });

  it("prefers the live dockview model active panel when a group handle keeps a stale active panel snapshot", async () => {
    // 回归:真实 dockview 跨组拖拽后,group handle 上的 activePanel 可能短暂
    // 仍是被拖走的 panel,而 model.activePanel 已指向本组剩余 tab。group
    // view 必须读 live model,否则 A 组会继续显示被拖到 B 的文件,直到用户点击。
    const context = createMockContext({
      readText: vi.fn(async ({ path }) =>
        path === "electron-builder.yml"
          ? "appId: io.pier.app\n"
          : '{ "name": "pier" }\n'
      ),
    });
    const packageDocument = ensureDiskDocument({
      path: "package.json",
      root: PROJECT_ROOT,
    });
    const builderDocument = ensureDiskDocument({
      path: "electron-builder.yml",
      root: PROJECT_ROOT,
    });
    markDocumentLoaded(packageDocument.id, '{ "name": "pier" }\n', 10);
    markDocumentLoaded(builderDocument.id, "appId: io.pier.app\n", 20);
    const Panel = createFilePanel(context);
    const group = createFakeGroup("stale-active-group");
    const packagePanel = group.makeFilesPanel("package-panel", {
      context: panelContext,
      source: {
        kind: "disk",
        path: "package.json",
        root: PROJECT_ROOT,
      },
    });
    const builderPanel = group.makeFilesPanel("builder-panel", {
      context: panelContext,
      source: {
        kind: "disk",
        path: "electron-builder.yml",
        root: PROJECT_ROOT,
      },
    });
    group.setActivePanel(builderPanel);

    render(
      <Panel
        {...makeProps(
          {
            context: panelContext,
            source: {
              kind: "disk",
              path: "electron-builder.yml",
              root: PROJECT_ROOT,
            },
          },
          { group, id: "builder-panel", isActive: true }
        )}
      />
    );

    const container = group.element.querySelector(".dv-content-container");
    await waitFor(() => {
      const view = container?.querySelector(FILES_GROUP_VIEW_SELECTOR);
      expect((view as HTMLElement)?.textContent).toContain(
        "electron-builder.yml"
      );
    });

    act(() => {
      // 模拟 stale 快照:group.activePanel 仍是 builderPanel,live model 已变为
      // packagePanel。用户点击后通常会刷新 activePanel,但这里必须无需点击。
      group.setActivePanelModelOnly(packagePanel);
    });

    await waitFor(() => {
      const view = container?.querySelector(FILES_GROUP_VIEW_SELECTOR);
      expect((view as HTMLElement)?.textContent).toContain("package.json");
      expect((view as HTMLElement)?.textContent).not.toContain(
        "electron-builder.yml"
      );
    });
    expect(getDocument(packageDocument.id)?.currentContents).toBe(
      '{ "name": "pier" }\n'
    );
    expect(getDocument(packageDocument.id)?.dirty).toBe(false);
    expect(getDocument(builderDocument.id)?.currentContents).toBe(
      "appId: io.pier.app\n"
    );
    expect(getDocument(builderDocument.id)?.dirty).toBe(false);

    group.element.remove();
  });

  it("scopes tree search to the sidebar instance that requested it", async () => {
    // 回归:注册表曾按 root 键控,分屏同项目时 B 的搜索/定位打到 A 的树。
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const context = createMockContext({ list });
    const { container } = render(
      <>
        <div data-testid="sidebar-a">
          <FileTreeSidebar
            context={context}
            controller={filesRuntimeFor(context).controller}
            instanceId="tree-instance-a"
            onOpenFile={vi.fn()}
            root={PROJECT_ROOT}
            watchHub={filesRuntimeFor(context).watchHub}
          />
        </div>
        <div data-testid="sidebar-b">
          <FileTreeSidebar
            context={context}
            controller={filesRuntimeFor(context).controller}
            instanceId="tree-instance-b"
            onOpenFile={vi.fn()}
            root={PROJECT_ROOT}
            watchHub={filesRuntimeFor(context).watchHub}
          />
        </div>
      </>
    );
    await waitFor(() => {
      expect(list).toHaveBeenCalled();
    });

    act(() => {
      expect(openFilesTreeSearch({ instanceId: "tree-instance-a" })).toBe(true);
    });

    const sidebarA = container.querySelector('[data-testid="sidebar-a"]');
    const sidebarB = container.querySelector('[data-testid="sidebar-b"]');
    expect(
      sidebarA?.querySelector('[data-testid="files-tree-search-bar"]')
    ).toBeInstanceOf(HTMLElement);
    expect(
      sidebarB?.querySelector('[data-testid="files-tree-search-bar"]')
    ).toBeNull();
  });

  it("searches via path query without recursive list and opens ranked theme hit", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onOpenFile = vi.fn();
    const pathQuery = createPathQueryMock();
    const listed: string[] = [];
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async (_requestOrRoot, options) => {
        const path = options?.path ?? "";
        listed.push(path);
        if (path === "") {
          return [
            { kind: "file", path: "README.md", root: PROJECT_ROOT },
            { kind: "directory", path: "src", root: PROJECT_ROOT },
          ];
        }
        if (path === "src") {
          return [
            {
              kind: "directory",
              path: "src/plugins",
              root: PROJECT_ROOT,
            },
          ];
        }
        if (path === "src/plugins") {
          return [
            {
              kind: "directory",
              path: "src/plugins/builtin",
              root: PROJECT_ROOT,
            },
          ];
        }
        if (path === "src/plugins/builtin") {
          return [
            {
              kind: "directory",
              path: "src/plugins/builtin/files",
              root: PROJECT_ROOT,
            },
          ];
        }
        if (path === "src/plugins/builtin/files") {
          return [
            {
              kind: "directory",
              path: "src/plugins/builtin/files/renderer",
              root: PROJECT_ROOT,
            },
          ];
        }
        if (path === "src/plugins/builtin/files/renderer") {
          return [
            {
              kind: "file",
              path: "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts",
              root: PROJECT_ROOT,
            },
          ];
        }
        return [];
      }
    );
    const context = createMockContext({
      list,
      onPathQueryEvent: pathQuery.onPathQueryEvent.bind(pathQuery),
      queryPaths: pathQuery.queryPaths.bind(pathQuery),
    });
    const { container } = render(
      <FileTreeSidebar
        context={context}
        controller={filesRuntimeFor(context).controller}
        instanceId="tree-search-lazy"
        onOpenFile={onOpenFile}
        root={PROJECT_ROOT}
        watchHub={filesRuntimeFor(context).watchHub}
      />
    );
    await waitFor(() => {
      expect(
        within(getFileTree(container)).getByRole("treeitem", {
          name: "README.md",
        })
      ).toBeVisible();
    });
    const listCallsBeforeSearch = list.mock.calls.length;

    act(() => {
      expect(openFilesTreeSearch({ instanceId: "tree-search-lazy" })).toBe(
        true
      );
    });
    const searchBar = await screen.findByTestId("files-tree-search-bar");
    expect(searchBar).toHaveClass("bg-sidebar", "text-sidebar-foreground");
    expect(searchBar.closest("aside")).toHaveClass("bg-sidebar");
    const searchInput = within(searchBar).getByRole("textbox", {
      name: "Find in tree",
    });
    expect(searchBar.firstElementChild).toHaveClass("flex-wrap");
    expect(searchInput.parentElement).toHaveClass("min-w-0");
    const searchControls = searchBar.querySelector(
      '[data-slot="files-search-controls"]'
    );
    expect(searchControls).toHaveClass("max-w-full", "flex-wrap");
    expect(
      within(searchBar).getByRole("button", { name: "Open selected file" })
    ).toBeVisible();

    fireEvent.change(searchInput, { target: { value: "theme.ts" } });
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    expect(pathQuery.starts.length).toBeGreaterThan(0);
    expect(pathQuery.starts.at(-1)?.query).toBe("theme.ts");
    // Must not recurse list for search indexing.
    expect(list.mock.calls.length).toBe(listCallsBeforeSearch);

    const queryId = pathQuery.starts.at(-1)?.queryId ?? "";
    act(() => {
      pathQuery.emit({
        kind: "batch",
        queryId,
        items: [
          {
            path: "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts",
            score: 100,
          },
          { path: "src/theme.ts", score: 10 },
        ],
      });
    });

    await waitFor(() => {
      expect(within(searchBar).getByText("2")).toBeVisible();
      expect(screen.getByTestId("files-tree-search-results")).toBeVisible();
      expect(screen.getByText("code-mirror-editor-theme.ts")).toBeVisible();
    });
    // Tree hide-non-matches is not used; tree content is replaced by result layer.
    expect(screen.queryByTestId("files-tree-search-empty")).toBeNull();

    fireEvent.keyDown(searchInput, { key: "ArrowDown" });
    fireEvent.keyDown(searchInput, { key: "Enter" });
    await waitFor(() => {
      expect(onOpenFile).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "src/theme.ts",
        }),
        undefined
      );
    });
    expect(searchInput).toHaveValue("theme.ts");

    fireEvent.change(searchInput, { target: { value: ".missing" } });
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    const missingId = pathQuery.starts.at(-1)?.queryId ?? "";
    act(() => {
      pathQuery.emit({
        kind: "done",
        queryId: missingId,
        reason: "completed",
        truncated: false,
        scanned: 0,
        elapsedMs: 1,
      });
    });
    await waitFor(() => {
      expect(within(searchBar).getByText("0")).toBeVisible();
      expect(screen.getByTestId("files-tree-search-empty")).toHaveTextContent(
        "No matching files"
      );
      expect(screen.getByTestId("files-tree-search-empty")).toHaveTextContent(
        "Try another file name or path."
      );
    });

    fireEvent.change(searchInput, { target: { value: "" } });
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    // Empty query still uses result layer (MRU / walk), not the tree filter.
    expect(screen.getByTestId("files-tree-search-results")).toBeTruthy();
    vi.useRealTimers();
  });

  it("shows progressive batches before done and never empty while loading", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pathQuery = createPathQueryMock();
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const context = createMockContext({
      list,
      onPathQueryEvent: pathQuery.onPathQueryEvent.bind(pathQuery),
      queryPaths: pathQuery.queryPaths.bind(pathQuery),
    });
    render(
      <FileTreeSidebar
        context={context}
        controller={filesRuntimeFor(context).controller}
        instanceId="tree-search-before-mount"
        onOpenFile={vi.fn()}
        root={PROJECT_ROOT}
        watchHub={filesRuntimeFor(context).watchHub}
      />
    );

    act(() => {
      expect(
        openFilesTreeSearch({ instanceId: "tree-search-before-mount" })
      ).toBe(true);
    });
    const searchBar = await screen.findByTestId("files-tree-search-bar");
    const searchInput = within(searchBar).getByRole("textbox", {
      name: "Find in tree",
    });
    fireEvent.change(searchInput, { target: { value: "theme" } });
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    const queryId = pathQuery.starts.at(-1)?.queryId ?? "";

    expect(screen.queryByTestId("files-tree-search-empty")).toBeNull();

    act(() => {
      pathQuery.emit({
        kind: "batch",
        queryId,
        items: [
          {
            path: "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts",
            score: 50,
          },
        ],
      });
    });
    await waitFor(() => {
      expect(within(searchBar).getByText("1")).toBeVisible();
      expect(screen.getByText("code-mirror-editor-theme.ts")).toBeVisible();
      expect(screen.queryByTestId("files-tree-search-empty")).toBeNull();
    });

    act(() => {
      pathQuery.emit({
        kind: "done",
        queryId,
        reason: "completed",
        truncated: true,
        scanned: 9000,
        elapsedMs: 12,
      });
    });
    await waitFor(() => {
      expect(within(searchBar).getByText("1+")).toBeVisible();
      expect(screen.getByTestId("files-tree-search-truncated")).toBeVisible();
    });
    vi.useRealTimers();
  });

  it("opens the focused path-query result with Enter", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onOpenFile = vi.fn();
    const pathQuery = createPathQueryMock();
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async (_requestOrRoot, options) =>
        options?.path
          ? []
          : [
              {
                kind: "file",
                path: "README.md",
                root: PROJECT_ROOT,
              },
            ]
    );
    const context = createMockContext({
      list,
      onPathQueryEvent: pathQuery.onPathQueryEvent.bind(pathQuery),
      queryPaths: pathQuery.queryPaths.bind(pathQuery),
    });
    const { container } = render(
      <FileTreeSidebar
        context={context}
        controller={filesRuntimeFor(context).controller}
        instanceId="tree-search-directory"
        onOpenFile={onOpenFile}
        root={PROJECT_ROOT}
        watchHub={filesRuntimeFor(context).watchHub}
      />
    );
    await waitFor(() => {
      expect(
        within(getFileTree(container)).getByRole("treeitem", {
          name: "README.md",
        })
      ).toBeVisible();
    });

    act(() => {
      expect(openFilesTreeSearch({ instanceId: "tree-search-directory" })).toBe(
        true
      );
    });
    const searchBar = await screen.findByTestId("files-tree-search-bar");
    const searchInput = within(searchBar).getByRole("textbox", {
      name: "Find in tree",
    });
    const openButton = within(searchBar).getByRole("button", {
      name: "Open selected file",
    });
    fireEvent.change(searchInput, { target: { value: "readme" } });
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    const queryId = pathQuery.starts.at(-1)?.queryId ?? "";
    act(() => {
      pathQuery.emit({
        kind: "batch",
        queryId,
        items: [{ path: "README.md", score: 10 }],
      });
      pathQuery.emit({
        kind: "done",
        queryId,
        reason: "completed",
        truncated: false,
        scanned: 1,
        elapsedMs: 1,
      });
    });

    await waitFor(() => {
      expect(within(searchBar).getByText("1")).toBeVisible();
      expect(openButton).not.toBeDisabled();
    });
    fireEvent.keyDown(searchInput, { key: "Enter" });
    await waitFor(() => {
      expect(onOpenFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: "README.md", kind: "file" }),
        undefined
      );
    });
    expect(screen.queryByTestId("files-tree-search-empty")).toBeNull();
    vi.useRealTimers();
  });

  it("does not fall back to another same-root tree when a target tree instance is missing", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const context = createMockContext({ list });
    const { container } = render(
      <>
        <div data-testid="sidebar-a">
          <FileTreeSidebar
            context={context}
            controller={filesRuntimeFor(context).controller}
            instanceId="tree-instance-a"
            onOpenFile={vi.fn()}
            root={PROJECT_ROOT}
            watchHub={filesRuntimeFor(context).watchHub}
          />
        </div>
        <div data-testid="sidebar-b">
          <FileTreeSidebar
            context={context}
            controller={filesRuntimeFor(context).controller}
            instanceId="tree-instance-b"
            onOpenFile={vi.fn()}
            root={PROJECT_ROOT}
            watchHub={filesRuntimeFor(context).watchHub}
          />
        </div>
      </>
    );
    await waitFor(() => {
      expect(list).toHaveBeenCalled();
    });

    let opened = true;
    act(() => {
      opened = openFilesTreeSearch({
        instanceId: "tree-instance-missing",
        root: PROJECT_ROOT,
      });
    });

    const sidebarA = container.querySelector('[data-testid="sidebar-a"]');
    const sidebarB = container.querySelector('[data-testid="sidebar-b"]');
    expect(opened).toBe(false);
    expect(
      sidebarA?.querySelector('[data-testid="files-tree-search-bar"]')
    ).toBeNull();
    expect(
      sidebarB?.querySelector('[data-testid="files-tree-search-bar"]')
    ).toBeNull();
  });

  it("keeps the injected files group view node across thin panel tab switches", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const context = createMockContext({ list });
    const Panel = createFilePanel(context);
    const group = createFakeGroup("sentinel-group");
    const contentContainer = group.element.querySelector(
      ".dv-content-container"
    );
    expect(contentContainer).toBeInstanceOf(HTMLElement);

    const firstActiveListeners = new Set<
      (event: { isActive: boolean }) => void
    >();
    const secondActiveListeners = new Set<
      (event: { isActive: boolean }) => void
    >();
    const firstProps = makeProps(
      {
        context: panelContext,
        source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
      },
      {
        group,
        id: "first-file-panel",
        isActive: true,
        onDidActiveChange: vi.fn(
          (listener: (event: { isActive: boolean }) => void) => {
            firstActiveListeners.add(listener);
            return { dispose: () => firstActiveListeners.delete(listener) };
          }
        ),
      }
    );
    const secondProps = makeProps(
      {
        context: panelContext,
        source: { kind: "disk", path: "NOTES.md", root: PROJECT_ROOT },
      },
      {
        group,
        id: "second-file-panel",
        isActive: false,
        onDidActiveChange: vi.fn(
          (listener: (event: { isActive: boolean }) => void) => {
            secondActiveListeners.add(listener);
            return { dispose: () => secondActiveListeners.delete(listener) };
          }
        ),
      }
    );

    const firstPanel = group.makeFilesPanel("first-file-panel", {
      context: panelContext,
      source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
    });
    const secondPanel = group.makeFilesPanel("second-file-panel", {
      context: panelContext,
      source: { kind: "disk", path: "NOTES.md", root: PROJECT_ROOT },
    });
    group.setActivePanel(firstPanel);

    render(
      <>
        <Panel {...firstProps} />
        <Panel {...secondProps} />
      </>
    );

    await waitFor(() => {
      expect(
        contentContainer?.querySelector(FILES_GROUP_VIEW_SELECTOR)
      ).toBeInstanceOf(HTMLElement);
    });
    const groupView = contentContainer?.querySelector(
      FILES_GROUP_VIEW_SELECTOR
    );
    expect(groupView).toBeInstanceOf(HTMLElement);
    expect(
      contentContainer?.querySelector('[data-slot="pier.files.groupView"]')
    ).toBe(groupView);
    expect(
      filesGroupViewRootProbe.renderCalls,
      "initial files group view should mount through the host groupContent slot"
    ).toBeGreaterThan(0);
    filesGroupViewRootProbe.reset();

    act(() => {
      Object.defineProperty(firstProps.api, "isActive", {
        configurable: true,
        value: false,
      });
      Object.defineProperty(secondProps.api, "isActive", {
        configurable: true,
        value: true,
      });
      group.setActivePanel(secondPanel);
      for (const listener of firstActiveListeners) {
        listener({ isActive: false });
      }
      for (const listener of secondActiveListeners) {
        listener({ isActive: true });
      }
    });

    expect(contentContainer?.querySelector(FILES_GROUP_VIEW_SELECTOR)).toBe(
      groupView
    );
    expect(
      filesGroupViewRootProbe.renderCalls,
      "group view root should not remount during thin-panel tab switch"
    ).toBe(0);
    // 拉取模型:切 tab 后视图展示新 active 面板的文件。
    expect((groupView as HTMLElement).textContent).toContain("NOTES.md");
    group.element.remove();
  });

  it("remembers the file tree collapsed option per project root", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const context = createMockContext({ list });
    const { unmount } = renderFilePanel({ context: panelContext }, context);

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });
    fireEvent.click(screen.getByRole("button", { name: "Collapse file tree" }));
    expect(
      screen.getByRole("button", { name: "Expand file tree" })
    ).toBeVisible();

    unmount();
    clearFilesTreeStore();
    list.mockClear();
    renderFilePanel({ context: panelContext }, createMockContext({ list }));

    expect(
      screen.getByRole("button", { name: "Expand file tree" })
    ).toBeVisible();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Expand file tree" }));
    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });
  });

  it("re-expands a collapsed file tree from the loaded root snapshot without listing the root again", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const { container } = renderFilePanel(
      { context: panelContext },
      createMockContext({ list })
    );

    await waitFor(() => {
      expect(
        within(getFileTree(container)).getByRole("treeitem", {
          name: "README.md",
        })
      ).toBeVisible();
    });
    expect(list).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Collapse file tree" }));
    expect(
      screen.getByRole("button", { name: "Expand file tree" })
    ).toBeVisible();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand file tree" }));
    await waitFor(() => {
      expect(
        within(getFileTree(container)).getByRole("treeitem", {
          name: "README.md",
        })
      ).toBeVisible();
    });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("retries a failed project tree root load when the file-panel is reopened", async () => {
    let shouldFail = true;
    const list = vi.fn<RendererPluginContext["files"]["list"]>(() => {
      if (shouldFail) {
        return Promise.reject(new Error("Permission denied loading root"));
      }
      return Promise.resolve([
        { kind: "file", path: "README.md", root: PROJECT_ROOT },
      ] satisfies FileEntry[]);
    });

    const { unmount } = renderFilePanel(
      { context: panelContext },
      createMockContext({ list })
    );
    expect(
      await screen.findByText("Permission denied loading root")
    ).toBeVisible();

    unmount();
    shouldFail = false;
    const { container } = renderFilePanel(
      { context: panelContext },
      createMockContext({ list })
    );

    await waitFor(() => {
      expect(list).toHaveBeenCalledTimes(2);
    });
    expect(
      within(getFileTree(container)).getByRole("treeitem", {
        name: "README.md",
      })
    ).toBeVisible();
  });

  it("opens an untitled Markdown document without redundant save toolbar buttons", async () => {
    const document = createUntitledMarkdownDocument({
      contents: "# Terminal notes\n\n- keep this local",
    });

    const { container } = renderFilePanel({
      context: panelContext,
      source: { id: document.id, kind: "untitled", name: document.name },
    });

    expect(screen.getByRole("heading", { name: document.name })).toBeVisible();
    expect(await screen.findByText("Temporary file")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save As…" })).toBeNull();
    expect(container.querySelector(".cm-editor")).toBeInstanceOf(HTMLElement);
    expect(screen.getByRole("radio", { name: "Source" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("saves an untitled document to a selected target and rebinds the panel", async () => {
    const document = createUntitledMarkdownDocument({
      contents: "# Save this\n",
    });
    const pickSaveTarget = vi.fn(async () => ({
      context: panelContext,
      path: "notes/saved.md",
      root: PROJECT_ROOT,
    }));
    const inspectWriteTarget = vi.fn(async () => ({
      kind: "absent" as const,
    }));
    const writeDocument = vi.fn(async (request) => ({
      canonicalPath: "notes/saved.md",
      committed: true as const,
      durability: "confirmed" as const,
      kind: "written" as const,
      mode: 0o644,
      mtimeMs: 2,
      revision: "revision-saved-as",
      size: request.contents.length,
    }));
    const openInstance = vi.fn();
    const flushLayout = vi.fn(async () => undefined);
    const context = createMockContext({
      flushLayout,
      inspectWriteTarget,
      openInstance,
      pickSaveTarget,
      writeDocument,
    });
    const close = vi.fn();
    const Panel = createFilePanel(context);
    const panelId = "pier.files.filePanel:untitled:save-as-test";

    render(
      <Panel
        {...makeProps(
          {
            context: panelContext,
            source: { id: document.id, kind: "untitled", name: document.name },
          },
          { close, id: panelId }
        )}
      />
    );

    await act(async () => {
      await filesRuntimeFor(context).controller.savePanel(panelId);
    });

    await waitFor(() => {
      expect(writeDocument).toHaveBeenCalledWith({
        contents: "# Save this\n",
        eol: "lf",
        expected: { kind: "absent" },
        format: { bom: false, encoding: "utf8" },
        operationId: expect.any(String),
        path: "notes/saved.md",
        root: PROJECT_ROOT,
      });
    });
    expect(pickSaveTarget).toHaveBeenCalledWith({
      context: panelContext,
      suggestedName: document.name,
    });
    expect(openInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        componentId: FILES_FILE_PANEL_ID,
        context: panelContext,
        params: {
          pinned: true,
          source: {
            kind: "disk",
            path: "notes/saved.md",
            root: PROJECT_ROOT,
          },
        },
      })
    );
    expect(close).toHaveBeenCalledOnce();
    expect(flushLayout).toHaveBeenCalledOnce();
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(
      flushLayout.mock.invocationCallOrder[0] ?? 0
    );
    expect(getDocument(document.id)).toBeNull();
  });

  it("keeps Save As recovery state when the panel layout cannot be persisted", async () => {
    const document = createUntitledMarkdownDocument({
      contents: "# Keep recovery state\n",
    });
    const flushLayout = vi.fn(async () => {
      throw new Error("layout disk full");
    });
    const context = createMockContext({
      flushLayout,
      inspectWriteTarget: vi.fn(async () => ({ kind: "absent" as const })),
      pickSaveTarget: vi.fn(async () => ({
        context: panelContext,
        path: "notes/recover.md",
        root: PROJECT_ROOT,
      })),
      writeDocument: vi.fn(async (request) => ({
        canonicalPath: request.path,
        committed: true as const,
        durability: "confirmed" as const,
        kind: "written" as const,
        mode: 0o644,
        mtimeMs: 2,
        revision: "revision-recovery",
        size: request.contents.length,
      })),
    });
    const close = vi.fn();
    const panelId = "pier.files.filePanel:untitled:save-as-layout-failure";
    const Panel = createFilePanel(context);
    render(
      <Panel
        {...makeProps(
          {
            context: panelContext,
            source: { id: document.id, kind: "untitled", name: document.name },
          },
          { close, id: panelId }
        )}
      />
    );

    await expect(
      filesRuntimeFor(context).controller.savePanel(panelId, "none")
    ).resolves.toBe("failed");

    expect(close).toHaveBeenCalledOnce();
    expect(flushLayout).toHaveBeenCalledOnce();
    expect(getDocument(document.id)).not.toBeNull();
    expect(saveAsJournalForDocument(document.id)).toMatchObject({
      phase: "written",
      sourceDocumentId: document.id,
      writtenResult: { revision: "revision-recovery" },
    });
  });

  it("renders a no-project-context Markdown document without mounting or loading the sidebar", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(() =>
      Promise.reject(
        new Error("no project context should not load a file tree")
      )
    );
    const document = createUntitledMarkdownDocument({
      contents: "# Standalone note\n\nNo workspace attached.",
    });
    const { container } = renderFilePanel(
      {
        source: { id: document.id, kind: "untitled", name: document.name },
      },
      createMockContext({ list })
    );

    fireEvent.click(screen.getByRole("radio", { name: "Preview" }));

    expect(
      await screen.findByRole("heading", { name: "Standalone note" })
    ).toBeVisible();
    expect(screen.getByText("No workspace attached.")).toBeVisible();
    expect(
      container.querySelector('file-tree-container[data-slot="pier-file-tree"]')
    ).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it("renders Markdown tables, lists, and code blocks in preview mode", async () => {
    const document = createUntitledMarkdownDocument({
      contents:
        "| A | B |\n| - | - |\n| 1 | 2 |\n\n- alpha\n- beta\n\n```ts\nconst value = 1;\n```",
    });

    const { container } = renderFilePanel({
      context: panelContext,
      source: { id: document.id, kind: "untitled", name: document.name },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Preview" }));

    const markdownPreview = container.querySelector(
      '[data-slot="markdown-preview"]'
    );
    expect(markdownPreview).toHaveAttribute("data-scrollbar", "stable");
    const table = await screen.findByRole("table");
    expect(table).toBeVisible();
    expect(
      within(markdownPreview as HTMLElement).getByRole("list")
    ).toBeVisible();
    expect(screen.getByText("const value = 1;")).toBeVisible();
    expect(container.querySelector("pre")).toHaveAttribute(
      "data-scrollbar",
      "overlay"
    );
    expect(table.parentElement).toHaveAttribute("data-scrollbar", "overlay");
  });

  it("preserves editor state, selection, scroll, and undo history across view mode switches", async () => {
    const document = createUntitledMarkdownDocument({
      contents: "# Before\n\n- draft",
    });
    const { container } = renderFilePanel({
      context: panelContext,
      source: { id: document.id, kind: "untitled", name: document.name },
    });

    replaceEditorText(container, "# After\n\n- kept through preview\n");
    const editedView = findCodeMirrorView(container);
    act(() => {
      editedView.dispatch({ selection: { anchor: 2, head: 7 } });
      editedView.scrollDOM.scrollLeft = 17;
      editedView.scrollDOM.scrollTop = 143;
    });
    fireEvent.click(screen.getByRole("radio", { name: "Preview" }));
    expect(await screen.findByRole("heading", { name: "After" })).toBeVisible();
    expect(screen.getByText("kept through preview")).toBeVisible();

    fireEvent.click(screen.getByRole("radio", { name: "Source" }));

    const restoredView = findCodeMirrorView(container);
    expect(restoredView.state.doc.toString()).toBe(
      "# After\n\n- kept through preview\n"
    );
    expect(restoredView.state.selection.main).toMatchObject({
      anchor: 2,
      head: 7,
    });
    expect(restoredView.scrollDOM.scrollLeft).toBe(17);
    expect(restoredView.scrollDOM.scrollTop).toBe(143);
    expect(getDocument(document.id)?.currentContents).toBe(
      "# After\n\n- kept through preview\n"
    );
    fireEvent.keyDown(restoredView.contentDOM, { ctrlKey: true, key: "z" });
    expect(restoredView.state.doc.toString()).toBe("# Before\n\n- draft");
  });

  it("preserves the view session when an open disk document is renamed", async () => {
    const source = {
      kind: "disk" as const,
      path: "before.md",
      root: PROJECT_ROOT,
    };
    const document = ensureDiskDocument(source);
    markDocumentLoaded(document.id, "before\n", 1);
    const pluginContext = createMockContext();
    const { container } = renderFilePanel(
      { context: panelContext, source },
      pluginContext
    );
    const originalView = findCodeMirrorView(container);
    act(() => {
      originalView.dispatch({
        changes: {
          from: 0,
          insert: "edited",
          to: originalView.state.doc.length,
        },
        selection: { anchor: 2, head: 4 },
      });
      originalView.scrollDOM.scrollTop = 91;
    });
    await act(async () => {
      await filesRuntimeFor(pluginContext).controller.moveDiskDocumentSource(
        PROJECT_ROOT,
        "before.md",
        "after.md"
      );
    });

    const renamedView = findCodeMirrorView(container);
    expect(renamedView.state.doc.toString()).toBe("edited");
    expect(renamedView.state.selection.main).toMatchObject({
      anchor: 2,
      head: 4,
    });
    expect(renamedView.scrollDOM.scrollTop).toBe(91);
    fireEvent.keyDown(renamedView.contentDOM, { ctrlKey: true, key: "z" });
    expect(renamedView.state.doc.toString()).toBe("before\n");
  });

  it("does not render raw HTML and routes safe links through the host", async () => {
    const startHref = window.location.href;
    const openExternal = vi.fn(async () => ({ opened: true as const }));
    const context = createMockContext({ openExternal });
    const document = createUntitledMarkdownDocument({
      contents:
        '<span id="raw-html">raw</span>\n\n[bad](javascript:alert(1)) [vb](vbscript:msgbox(1)) [data](data:text/html,<script>alert(1)</script>) [safe](https://example.com/docs)',
    });

    const { container } = renderFilePanel(
      {
        context: panelContext,
        source: { id: document.id, kind: "untitled", name: document.name },
      },
      context
    );
    fireEvent.click(screen.getByRole("radio", { name: "Preview" }));

    expect(container.querySelector("#raw-html")).toBeNull();
    const safeLink = await screen.findByRole("link", { name: "safe" });
    for (const label of ["bad", "vb", "data"]) {
      expect(screen.getByText(label).closest("a")).not.toHaveAttribute("href");
    }

    expect(safeLink).toHaveAttribute("href", "https://example.com/docs");
    expect(fireEvent.click(safeLink)).toBe(false);
    await waitFor(() => {
      expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");
    });
    expect(window.location.href).toBe(startHref);
  });

  it("shows external link failures in the host dialog", async () => {
    const context = createMockContext({
      openExternal: vi.fn(async () => ({
        opened: false as const,
        reason: "open-failed" as const,
      })),
    });
    const document = createUntitledMarkdownDocument({
      contents: "[safe](https://example.com/docs)",
    });
    renderFilePanel(
      {
        context: panelContext,
        source: { id: document.id, kind: "untitled", name: document.name },
      },
      context
    );
    fireEvent.click(screen.getByRole("radio", { name: "Preview" }));

    fireEvent.click(await screen.findByRole("link", { name: "safe" }));
    await waitFor(() => {
      expect(context.dialogs.alert).toHaveBeenCalledWith({
        body: "The external link could not be opened.",
        size: "sm",
        title: "Unable to open link",
      });
    });
  });

  it("uses busy feedback when another preview owns external navigation", async () => {
    const notifyInfo = vi.fn();
    const context = createMockContext({
      notifyInfo,
      openExternal: vi.fn(async () => ({
        opened: false as const,
        reason: "busy" as const,
      })),
    });
    const document = createUntitledMarkdownDocument({
      contents: "[safe](https://example.com/docs)",
    });
    renderFilePanel(
      {
        context: panelContext,
        source: { id: document.id, kind: "untitled", name: document.name },
      },
      context
    );
    fireEvent.click(screen.getByRole("radio", { name: "Preview" }));

    fireEvent.click(await screen.findByRole("link", { name: "safe" }));
    await waitFor(() => {
      expect(notifyInfo).toHaveBeenCalledWith(
        "Another external link is already opening."
      );
    });
    expect(context.dialogs.alert).not.toHaveBeenCalled();
  });

  it("coalesces duplicate clicks while an external link is opening", async () => {
    let resolveOpen: ((result: { opened: true }) => void) | undefined;
    const openExternal = vi.fn(
      () =>
        new Promise<{ opened: true }>((resolve) => {
          resolveOpen = resolve;
        })
    );
    const context = createMockContext({ openExternal });
    const document = createUntitledMarkdownDocument({
      contents: "[safe](https://example.com/docs)",
    });
    renderFilePanel(
      {
        context: panelContext,
        source: { id: document.id, kind: "untitled", name: document.name },
      },
      context
    );
    fireEvent.click(screen.getByRole("radio", { name: "Preview" }));

    const link = await screen.findByRole("link", { name: "safe" });
    fireEvent.click(link);
    fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledOnce();
    expect(context.dialogs.alert).not.toHaveBeenCalled();

    await act(async () => {
      resolveOpen?.({ opened: true });
      await Promise.resolve();
    });
    expect(context.dialogs.alert).not.toHaveBeenCalled();
  });

  it("keeps temporary document bodies out of dockview params", () => {
    const secretBody = "token=do-not-persist";
    const document = createUntitledMarkdownDocument({ contents: secretBody });
    const params = {
      context: panelContext,
      source: { id: document.id, kind: "untitled", name: document.name },
    } satisfies FilesPanelParams;

    renderFilePanel(params);

    expect(JSON.stringify(params.source)).not.toContain(secretBody);
    expect(JSON.stringify(document.source)).not.toContain(secretBody);
  });

  it("renders missing source params as an empty file-panel and rejects corrupt legacy params without file IO", () => {
    const readText = vi.fn<RendererPluginContext["files"]["readText"]>();
    const writeText = vi.fn<RendererPluginContext["files"]["writeText"]>();
    const context = createMockContext({ readText, writeText });

    const { rerender } = renderFilePanel({ context: panelContext }, context);
    expect(screen.getByText("No file selected")).toBeVisible();

    const Panel = createFilePanel(context);
    rerender(
      <Panel
        {...makeProps({
          context: panelContext,
          source: { documentId: "legacy-only" },
        })}
      />
    );
    expect(screen.getByText("Unable to restore file panel")).toBeVisible();
    expect(readText).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("rebuilds a disk document shell, marks loading before readText, and does not duplicate reads on rerender", async () => {
    let resolveRead: (value: string) => void = () => undefined;
    const readText = vi.fn<RendererPluginContext["files"]["readText"]>(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        })
    );
    const context = createMockContext({ readText });
    const params = {
      context: panelContext,
      source: { kind: "disk", path: "docs/guide.md", root: PROJECT_ROOT },
    } satisfies FilesPanelParams;

    const { rerender } = renderFilePanel(params, context);
    const diskDocument = ensureDiskDocument({
      path: "docs/guide.md",
      root: PROJECT_ROOT,
    });

    expect(getDocument(diskDocument.id)?.loadState).toBe("loading");
    // 读取前先 stat(大文件守卫),readText 在其后一拍发出。
    await waitFor(() => {
      expect(readText).toHaveBeenCalledTimes(1);
    });
    expect(readText).toHaveBeenCalledWith({
      path: "docs/guide.md",
      root: PROJECT_ROOT,
    });

    const Panel = createFilePanel(context);
    rerender(<Panel {...makeProps(params)} />);
    expect(readText).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRead("# Loaded from disk\n");
      await Promise.resolve();
    });
    expect(screen.getByText("Saved")).toBeVisible();
  });

  it("rejects disk sources outside the restored panel context without file IO", () => {
    const readText = vi.fn<RendererPluginContext["files"]["readText"]>();
    const writeText = vi.fn<RendererPluginContext["files"]["writeText"]>();

    renderFilePanel(
      {
        context: panelContext,
        source: { kind: "disk", path: "notes.md", root: "/other/repo" },
      },
      createMockContext({ readText, writeText })
    );

    expect(screen.getByText("Unable to restore file panel")).toBeVisible();
    expect(screen.getByText(OUTSIDE_WORKSPACE_PATTERN)).toBeVisible();
    expect(readText).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("restores an untitled Markdown document body after renderer memory is lost", async () => {
    const document = createUntitledMarkdownDocument({
      contents: "# Restored after force quit\n\n- persisted draft",
    });
    const params = {
      context: panelContext,
      source: { id: document.id, kind: "untitled", name: document.name },
    } satisfies FilesPanelParams;

    clearFilesDocumentStore({ persisted: false });
    renderFilePanel(params);
    fireEvent.click(screen.getByRole("radio", { name: "Preview" }));

    expect(
      await screen.findByRole("heading", { name: "Restored after force quit" })
    ).toBeVisible();
    expect(screen.getByText("persisted draft")).toBeVisible();
    expect(getDocument(document.id)?.currentContents).toContain(
      "persisted draft"
    );
  });

  it("shows a non-recoverable read-only state for missing temporary documents without disk reads", () => {
    const readText = vi.fn<RendererPluginContext["files"]["readText"]>();

    renderFilePanel(
      {
        context: panelContext,
        source: { id: "missing-temp", kind: "untitled", name: "Lost.md" },
      },
      createMockContext({ readText })
    );

    expect(screen.getByRole("heading", { name: "Lost.md" })).toBeVisible();
    expect(screen.getByText("Temporary file cannot be restored")).toBeVisible();
    expect(
      screen
        .getByText("Temporary file cannot be restored")
        .closest('[data-slot="empty"]')
    ).not.toBeNull();
    expect(readText).not.toHaveBeenCalled();
  });

  it("updates the document contents from CodeMirror and protects dirty state", async () => {
    const document = createUntitledMarkdownDocument({ contents: "# Before\n" });
    const { container } = renderFilePanel({
      context: panelContext,
      source: { id: document.id, kind: "untitled", name: document.name },
    });

    replaceEditorText(container, "# After\n");

    expect(getDocument(document.id)?.currentContents).toBe("# After\n");
    expect(await screen.findByText("Protected")).toBeVisible();
  });

  it("saves dirty disk documents through writeText", async () => {
    const writeText = vi.fn<RendererPluginContext["files"]["writeText"]>(
      async (request) => ({
        mtimeMs: 1,
        path: request.path,
        root: request.root,
        written: true as const,
      })
    );
    const context = createMockContext({
      readText: vi.fn(async () => "# Before\n"),
      writeText,
    });
    renderFilePanel(
      {
        context: panelContext,
        source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
      },
      context
    );

    await screen.findByText("Saved");
    replaceEditorText(document.body, "# After\n");
    await act(async () => {
      await filesRuntimeFor(context).controller.savePanel(
        "pier.files.filePanel:test"
      );
    });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith({
        contents: "# After\n",
        path: "README.md",
        root: PROJECT_ROOT,
      });
    });
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("saves the active disk panel through the shared controller path", async () => {
    const writeText = vi.fn<RendererPluginContext["files"]["writeText"]>(
      async (request) => ({
        mtimeMs: 1,
        path: request.path,
        root: request.root,
        written: true as const,
      })
    );
    const panelId = "pier.files.filePanel:disk:save-shortcut";
    const context = createMockContext({
      readText: vi.fn(async () => "# Before\n"),
      writeText,
    });
    (
      context.panels.getActiveInstanceId as ReturnType<typeof vi.fn>
    ).mockReturnValue(panelId);
    const Panel = createFilePanel(context);
    render(
      <Panel
        {...makeProps(
          {
            context: panelContext,
            source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
          },
          { id: panelId }
        )}
      />
    );

    await screen.findByText("Saved");
    replaceEditorText(document.body, "# After\n");

    await act(async () => {
      await filesRuntimeFor(context).controller.savePanel(panelId);
    });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith({
        contents: "# After\n",
        path: "README.md",
        root: PROJECT_ROOT,
      });
    });
  });

  it("auto-saves dirty disk documents after the idle delay when the setting is on", async () => {
    const writeText = vi.fn<RendererPluginContext["files"]["writeText"]>(
      async (request) => ({
        mtimeMs: 2,
        path: request.path,
        root: request.root,
        written: true as const,
      })
    );
    const context = createMockContext({
      readText: vi.fn(async () => "# Before\n"),
      writeText,
    });
    (context.configuration.get as ReturnType<typeof vi.fn>).mockImplementation(
      () => true
    );

    renderFilePanel(
      {
        context: panelContext,
        source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
      },
      context
    );

    await screen.findByText("Saved");
    replaceEditorText(document.body, "# Auto saved\n");

    await waitFor(
      () => {
        expect(writeText).toHaveBeenCalledWith(
          expect.objectContaining({
            contents: "# Auto saved\n",
            path: "README.md",
            root: PROJECT_ROOT,
          })
        );
      },
      { timeout: 3000 }
    );
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("keeps manual save retryable after a failed disk write", async () => {
    let shouldFail = true;
    const writeText = vi.fn<RendererPluginContext["files"]["writeText"]>(
      (request) => {
        if (shouldFail) {
          return Promise.reject(new Error("disk full"));
        }
        return Promise.resolve({
          mtimeMs: 2,
          path: request.path,
          root: request.root,
          written: true as const,
        });
      }
    );
    const context = createMockContext({
      readText: vi.fn(async () => "# Before\n"),
      writeText,
    });
    renderFilePanel(
      {
        context: panelContext,
        source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
      },
      context
    );

    await screen.findByText("Saved");
    replaceEditorText(document.body, "# After\n");
    await act(async () => {
      await filesRuntimeFor(context).controller.savePanel(
        "pier.files.filePanel:test"
      );
    });

    expect(await screen.findByText("Unable to save file")).toBeVisible();
    expect(screen.getByText("disk full")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    shouldFail = false;
    await act(async () => {
      await filesRuntimeFor(context).controller.savePanel(
        "pier.files.filePanel:test"
      );
    });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("keeps an untitled document mounted when dockview recreates equivalent params", () => {
    const document = createUntitledMarkdownDocument({ contents: "temporary" });
    const context = createMockContext();
    const Panel = createFilePanel(context);
    const { rerender } = render(
      <Panel
        {...makeProps({
          context: panelContext,
          source: { id: document.id, kind: "untitled", name: document.name },
        })}
      />
    );

    rerender(
      <Panel
        {...makeProps({
          context: panelContext,
          source: { id: document.id, kind: "untitled", name: document.name },
        })}
      />
    );

    expect(getDocument(document.id)).not.toBeNull();
    expect(screen.getByRole("heading", { name: document.name })).toBeVisible();
    expect(
      screen.queryByText("Temporary file cannot be restored")
    ).not.toBeInTheDocument();
  });

  it("keeps documents across component remounts (unmount without a panel-remove signal)", async () => {
    const untitled = createUntitledMarkdownDocument({ contents: "temporary" });
    const untitledPanelSource = {
      id: untitled.id,
      kind: "untitled" as const,
      name: untitled.name,
    };
    const untitledRender = renderFilePanel({
      context: panelContext,
      source: untitledPanelSource,
    });
    untitledRender.unmount();
    expect(getDocument(untitled.id)).toBeNull();
    clearFilesDocumentStore({ persisted: false });
    expect(
      restoreUntitledDocumentFromPanelSource(untitledPanelSource)
    ).toBeNull();

    const diskRender = renderFilePanel(
      {
        context: panelContext,
        source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
      },
      createMockContext({ readText: vi.fn(async () => "# Disk\n") })
    );
    const diskDocument = ensureDiskDocument({
      path: "README.md",
      root: PROJECT_ROOT,
    });
    await screen.findByRole("heading", { name: "README.md" });
    diskRender.unmount();
    // 无 onDidRemovePanel 信号的 unmount = remount 场景,文档必须保留。
    expect(getDocument(diskDocument.id)).not.toBeNull();
  });

  it("keeps a clean disk document while another same-source tab is still open", async () => {
    const removeListeners = new Set<(panel: { id?: string }) => void>();
    const source = {
      kind: "disk" as const,
      path: "README.md",
      root: PROJECT_ROOT,
    };
    const context = createMockContext({
      listInstances: vi.fn(() => [
        {
          componentId: FILES_FILE_PANEL_ID,
          groupId: "group-b",
          id: "panel-b",
          params: { context: panelContext, source },
          title: "README.md",
        },
      ]),
      readText: vi.fn(async () => "# Disk\n"),
    });
    const Panel = createFilePanel(context);
    const props = {
      ...makeProps(
        {
          context: panelContext,
          source,
        },
        { id: "panel-a" }
      ),
      containerApi: {
        onDidRemovePanel: vi.fn(
          (listener: (panel: { id?: string }) => void) => {
            removeListeners.add(listener);
            return { dispose: () => removeListeners.delete(listener) };
          }
        ),
      },
    } as unknown as IDockviewPanelProps<FilesPanelParams>;

    const rendered = render(<Panel {...props} />);
    const diskDocument = ensureDiskDocument(source);
    await screen.findByRole("heading", { name: "README.md" });

    act(() => {
      for (const listener of removeListeners) {
        listener({ id: "panel-a" });
      }
    });
    rendered.unmount();

    expect(getDocument(diskDocument.id)).not.toBeNull();
  });

  it("drops a clean disk document when the last same-source tab is really closed", async () => {
    const removeListeners = new Set<(panel: { id?: string }) => void>();
    const source = {
      kind: "disk" as const,
      path: "README.md",
      root: PROJECT_ROOT,
    };
    const context = createMockContext({
      listInstances: vi.fn(() => []),
      readText: vi.fn(async () => "# Disk\n"),
    });
    const Panel = createFilePanel(context);
    const props = {
      ...makeProps(
        {
          context: panelContext,
          source,
        },
        { id: "closable-panel" }
      ),
      containerApi: {
        onDidRemovePanel: vi.fn(
          (listener: (panel: { id?: string }) => void) => {
            removeListeners.add(listener);
            return { dispose: () => removeListeners.delete(listener) };
          }
        ),
      },
    } as unknown as IDockviewPanelProps<FilesPanelParams>;

    const rendered = render(<Panel {...props} />);
    const diskDocument = ensureDiskDocument(source);
    await screen.findByRole("heading", { name: "README.md" });

    // dockview 真关闭:先发 onDidRemovePanel,再卸载 React 内容。
    act(() => {
      for (const listener of removeListeners) {
        listener({ id: "closable-panel" });
      }
    });
    rendered.unmount();

    // 干净文档随真关闭丢弃,重开从磁盘新读(不保留 undo/光标/内容缓存)。
    expect(getDocument(diskDocument.id)).toBeNull();
  });

  it("renders a Cursor-style breadcrumb from project root through the disk path", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          {
            kind: "file",
            path: "src/index.ts",
            root: PROJECT_ROOT,
          },
        ] satisfies FileEntry[]
    );
    renderFilePanel(
      {
        context: panelContext,
        source: { kind: "disk", path: "src/index.ts", root: PROJECT_ROOT },
      },
      createMockContext({
        list,
        readText: vi.fn(async () => "export const x = 1;\n"),
      })
    );

    // 面包屑 = 项目 basename ("pier") > src > index.ts。项目名同时出现在
    // sidebar 顶部标题里,所以断言有 >=1 处即可(具体位置由 breadcrumb DOM
    // 结构进一步约束)。
    await waitFor(() => {
      expect(screen.getAllByText("pier").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText("index.ts").length).toBeGreaterThanOrEqual(1);

    // 语言徽章按扩展名推断,展示 TypeScript;并把 status label ("Saved") 挂在
    // sr-only 里给测试和读屏。
    await waitFor(() => {
      expect(screen.getByText("TypeScript")).toBeVisible();
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("hides the Markdown mode toggle for non-Markdown documents", async () => {
    renderFilePanel(
      {
        context: panelContext,
        source: { kind: "disk", path: "src/index.ts", root: PROJECT_ROOT },
      },
      createMockContext({
        readText: vi.fn(async () => "const value = 1;\n"),
      })
    );

    await screen.findByText("TypeScript");
    expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
  });

  it("does not render a restoration error while acquiring a disk document", () => {
    renderFilePanel(
      {
        context: panelContext,
        source: { kind: "disk", path: "src/pending.ts", root: PROJECT_ROOT },
      },
      createMockContext({
        readText: vi.fn(() => new Promise<string>(() => undefined)),
      })
    );

    expect(
      screen.queryByText("This disk file document could not be restored.")
    ).toBeNull();
    expect(screen.getByRole("status", { name: "Loading…" })).toBeVisible();
  });

  it("renders the search button in the chrome for CodeMirror find widget", async () => {
    // Search 按钮始终存在;back/forward 属于宿主级全局导航,不在文件面板里。
    renderFilePanel(
      {
        context: panelContext,
        source: { kind: "disk", path: "src/index.ts", root: PROJECT_ROOT },
      },
      createMockContext({
        readText: vi.fn(async () => "export const x = 1;\n"),
      })
    );

    await screen.findByText("TypeScript");
    expect(screen.getByRole("button", { name: "Find in file" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Go forward" })).toBeNull();
  });

  it("opens the project search bar instead of CodeMirror's default search panel on Cmd+F", async () => {
    const { container } = renderFilePanel(
      {
        context: panelContext,
        source: { kind: "disk", path: "src/index.ts", root: PROJECT_ROOT },
      },
      createMockContext({
        readText: vi.fn(async () => "export const x = 1;\n"),
      })
    );

    await screen.findByText("TypeScript");
    const editorContent = container.querySelector(".cm-content");
    expect(editorContent).toBeInstanceOf(HTMLElement);

    fireEvent.keyDown(editorContent as HTMLElement, {
      key: "f",
      metaKey: true,
    });

    expect(await screen.findByTestId("files-editor-search-bar")).toBeVisible();
    expect(container.querySelector(".cm-search")).toBeNull();
  });

  it("keeps replace and search option behavior in the project search bar", async () => {
    const document = createUntitledMarkdownDocument({
      contents: "foo Foo foo\n",
    });
    const { container } = renderFilePanel({
      context: panelContext,
      source: { id: document.id, kind: "untitled", name: document.name },
    });

    fireEvent.click(screen.getByRole("button", { name: "Find in file" }));
    const searchInput = await screen.findByRole("textbox", { name: "Find" });
    const replaceInput = screen.getByRole("textbox", { name: "Replace" });

    fireEvent.change(searchInput, { target: { value: "foo" } });
    fireEvent.change(replaceInput, { target: { value: "bar" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));

    await waitFor(() => {
      expect(findCodeMirrorView(container).state.doc.toString()).toBe(
        "bar Foo foo\n"
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Match case" }));
    fireEvent.change(replaceInput, { target: { value: "baz" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));

    await waitFor(() => {
      expect(findCodeMirrorView(container).state.doc.toString()).toBe(
        "bar Foo baz\n"
      );
    });

    fireEvent.change(searchInput, { target: { value: "ba." } });
    fireEvent.click(screen.getByRole("button", { name: "Regexp" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all matches" }));

    expect(findCodeMirrorView(container).state.selection.ranges.length).toBe(2);
    expect(screen.getByRole("button", { name: "Whole word" })).toBeVisible();
    expect(container.querySelector(".cm-search")).toBeNull();
  });

  it("recomputes search results after local and external document changes", async () => {
    const document = createUntitledMarkdownDocument({
      contents: "foo foo\n",
    });
    const { container } = renderFilePanel({
      context: panelContext,
      source: { id: document.id, kind: "untitled", name: document.name },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find in file" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Find" }), {
      target: { value: "foo" },
    });
    expect(screen.getByText("1/2")).toBeVisible();

    const view = findCodeMirrorView(container);
    act(() => {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: "foo" },
      });
    });
    expect(screen.getByText("1/3")).toBeVisible();

    act(() => updateDocumentContents(document.id, "foo"));
    expect(screen.getByText("1/1")).toBeVisible();
  });

  it("clears retained search decorations when returning from preview", async () => {
    const document = createUntitledMarkdownDocument({
      contents: "# foo\n\nfoo\n",
    });
    const { container } = renderFilePanel({
      context: panelContext,
      source: { id: document.id, kind: "untitled", name: document.name },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find in file" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Find" }), {
      target: { value: "foo" },
    });
    expect(getSearchQuery(findCodeMirrorView(container).state).valid).toBe(
      true
    );

    fireEvent.click(screen.getByRole("radio", { name: "Preview" }));
    fireEvent.click(screen.getByRole("radio", { name: "Source" }));

    await waitFor(() => {
      expect(container.querySelector(".cm-editor")).toBeInstanceOf(HTMLElement);
    });
    expect(screen.queryByTestId("files-editor-search-bar")).toBeNull();
    expect(getSearchQuery(findCodeMirrorView(container).state).valid).toBe(
      false
    );
    fireEvent.click(screen.getByRole("button", { name: "Find in file" }));
    expect(await screen.findByRole("textbox", { name: "Find" })).toHaveValue(
      ""
    );
  });

  it("installs a high-priority CodeMirror DOM handler before basicSetup can open the default search panel", async () => {
    const editorSource = await readFile(
      join(
        process.cwd(),
        "src/plugins/builtin/files/renderer/file-editor-view-session.ts"
      ),
      "utf8"
    );

    const overrideMatch = CM_SEARCH_DOM_HANDLER_OVERRIDE.exec(editorSource);
    const overrideIndex = overrideMatch?.index ?? -1;
    const setupIndex = editorSource.indexOf("      basicSetup");
    expect(overrideIndex).toBeGreaterThanOrEqual(0);
    expect(setupIndex).toBeGreaterThanOrEqual(0);
    expect(overrideIndex).toBeLessThan(setupIndex);
    expect(editorSource).toContain("keydown: (event)");
    expect(editorSource).toContain("this.#presentation.onOpenSearch()");
  });

  it("promotes a preview panel to pinned when the user first modifies the document", async () => {
    // preview→pinned 语义:document.dirty 从 false→true 那一刻,file panel
    // 通过 api.updateParameters({...params, pinned:true}) 就地 promote,tab
    // 视觉去斜体、后续单击树的 dropUnpinnedInstances 不会顶掉这个面板。
    const document = createUntitledMarkdownDocument({ contents: "# Before\n" });
    const updateParameters = vi.fn();
    const initialParams = {
      context: panelContext,
      pinned: false,
      source: { id: document.id, kind: "untitled", name: document.name },
    } as const;
    const Panel = createFilePanel(createMockContext());
    const { container } = render(
      <Panel {...makeProps(initialParams, { updateParameters })} />
    );

    replaceEditorText(container, "# After\n");

    await waitFor(() => {
      expect(updateParameters).toHaveBeenCalled();
    });
    const lastCall = updateParameters.mock.calls.at(-1)?.[0] as {
      pinned?: unknown;
    };
    expect(lastCall?.pinned).toBe(true);
  });

  it("keeps the editor body sized as a flex remainder so CodeMirror can scroll", () => {
    // Regression:body 层曾用 h-full,导致在 flex-col section 里超出 chrome
    // 之外还额外撑高一整层,CodeMirror scroller 无 viewport = 用户滚不动。
    // 锁死 flex-1 + min-h-0 组合,避免以后再犯。
    const document = createUntitledMarkdownDocument({
      contents: Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join(
        "\n"
      ),
    });
    const { container } = renderFilePanel({
      context: panelContext,
      source: { id: document.id, kind: "untitled", name: document.name },
    });

    const editor = container.querySelector(
      '[data-testid="files-code-mirror-editor"]'
    );
    expect(editor).toBeInstanceOf(HTMLElement);
    expect((editor as HTMLElement).className).toMatch(CLASS_H_FULL);
    expect((editor as HTMLElement).className).toMatch(CLASS_FLEX_1);
    expect((editor as HTMLElement).className).toMatch(CLASS_MIN_H_0);

    const main = container.querySelector("main");
    expect(main).toBeInstanceOf(HTMLElement);
    const mainClass = (main as HTMLElement).className;
    expect(mainClass).toMatch(CLASS_FLEX);
    expect(mainClass).toMatch(CLASS_FLEX_COL);
    expect(mainClass).toMatch(CLASS_FLEX_1);
    expect(mainClass).toMatch(CLASS_MIN_H_0);

    // body root 不能 h-full——会撑出 chrome 之外,滚动死掉。
    const bodyRoot = main?.parentElement;
    expect(bodyRoot).toBeInstanceOf(HTMLElement);
    const bodyClass = (bodyRoot as HTMLElement).className;
    expect(bodyClass).not.toMatch(CLASS_H_FULL);
    expect(bodyClass).toMatch(CLASS_FLEX_1);
  });

  it("routes CodeMirror scrolling through the Pier scrollbar policy", () => {
    const document = createUntitledMarkdownDocument({
      contents: Array.from(
        { length: 60 },
        (_, index) => `line ${index + 1} ${"content ".repeat(30)}`
      ).join("\n"),
    });
    const { container } = renderFilePanel({
      context: panelContext,
      source: { id: document.id, kind: "untitled", name: document.name },
    });

    expect(findCodeMirrorView(container).scrollDOM).toHaveAttribute(
      "data-scrollbar",
      "stable"
    );
  });

  it("keeps CodeMirror gutters opaque and sticky so horizontal scroll cannot bleed into line numbers", async () => {
    // Regression:CM 把 gutters position:sticky 钉在左边;bg 若为 transparent,
    // 横向滚动时行内代码会穿透 gutter 盖到行号上。锁死主题里 `.cm-gutters`
    // 声明 opaque + sticky + z-index。
    const editorSource = await readFile(
      join(
        process.cwd(),
        "src/plugins/builtin/files/renderer/code-mirror-editor-theme.ts"
      ),
      "utf8"
    );
    const guttersRule = editorSource.match(CM_GUTTERS_RULE);
    expect(guttersRule, ".cm-gutters theme rule must exist").not.toBeNull();
    const rule = guttersRule?.[0] ?? "";
    expect(rule).not.toContain('backgroundColor: "transparent"');
    expect(rule).toMatch(CM_BG_BACKGROUND);
    expect(rule).toMatch(CM_POSITION_STICKY);
    expect(rule).toMatch(CM_ZINDEX_1);
  });
});
