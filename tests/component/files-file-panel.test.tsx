import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { createFilePanel } from "@plugins/builtin/files/renderer/file-panel.tsx";
import {
  clearFilesDocumentStore,
  createUntitledMarkdownDocument,
  ensureDiskDocument,
  getDocument,
  restoreUntitledDocumentFromPanelSource,
} from "@plugins/builtin/files/renderer/files-document-store.ts";
import type { FilesDocumentPanelSource } from "@plugins/builtin/files/renderer/files-document-types.ts";
import { clearFilesTreeStore } from "@plugins/builtin/files/renderer/files-tree-store.ts";
import type { FileEntry } from "@shared/contracts/file.ts";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OUTSIDE_WORKSPACE_PATTERN = /outside the restored workspace/i;
const PROJECT_ROOT = "/workspace/pier";

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

function createMockContext(overrides?: {
  list?: RendererPluginContext["files"]["list"];
  notifyInfo?: RendererPluginContext["notifications"]["info"];
  openInstance?: RendererPluginContext["panels"]["openInstance"];
  readText?: RendererPluginContext["files"]["readText"];
  translate?: RendererPluginContext["i18n"]["t"];
  writeText?: RendererPluginContext["files"]["writeText"];
}): RendererPluginContext {
  return {
    files: {
      list: overrides?.list ?? vi.fn(async () => []),
      move: vi.fn(async (request) => ({
        moved: true,
        newPath: request.newPath,
        oldPath: request.path,
        root: request.root,
      })),
      readText: overrides?.readText ?? vi.fn(async () => ""),
      trash: vi.fn(async (request) => ({
        path: request.path,
        root: request.root,
        trashed: true,
      })),
      writeText:
        overrides?.writeText ??
        vi.fn(async (request) => ({
          path: request.path,
          root: request.root,
          written: true,
        })),
    },
    i18n: {
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
      getActiveContext: vi.fn(() => panelContext),
      open: vi.fn(),
      openInstance: overrides?.openInstance ?? vi.fn(),
      register: vi.fn(() => vi.fn()),
    },
  } as unknown as RendererPluginContext;
}

function makeProps(
  params: FilesPanelParams,
  apiOverrides: Record<string, unknown> = {}
): IDockviewPanelProps<FilesPanelParams> {
  return {
    api: {
      id: "pier.files.filePanel:test",
      setTitle: vi.fn(),
      updateParameters: vi.fn(),
      ...apiOverrides,
    },
    containerApi: {},
    params,
  } as unknown as IDockviewPanelProps<FilesPanelParams>;
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
  window.localStorage.clear();
  clearFilesDocumentStore();
  clearFilesTreeStore();
});

afterEach(() => {
  clearFilesDocumentStore();
  clearFilesTreeStore();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("Files file-panel", () => {
  it("localizes file-panel chrome through plugin i18n messages", () => {
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

    expect(screen.getByText("[临时]")).toBeVisible();
    expect(screen.getByRole("button", { name: "[源码]" })).toBeVisible();
    expect(screen.getByRole("button", { name: "[预览]" })).toBeVisible();
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
      screen.getByRole("button", { name: "Collapse file tree" })
    ).toBeVisible();
    const tree = within(getFileTree(container));
    expect(tree.getByRole("treeitem", { name: "README.md" })).toBeVisible();
  });

  it("opens integrated file tree files inside the current file-panel tab", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const openInstance =
      vi.fn<RendererPluginContext["panels"]["openInstance"]>();
    const updateParameters = vi.fn();
    const setTitle = vi.fn();
    const context = createMockContext({
      list,
      openInstance,
      readText: vi.fn(async () => "# Loaded from tree\n"),
    });
    const Panel = createFilePanel(context);
    const { container } = render(
      <Panel
        {...makeProps(
          { context: panelContext },
          { setTitle, updateParameters }
        )}
      />
    );

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });
    fireEvent.click(
      within(getFileTree(container)).getByRole("treeitem", {
        name: "README.md",
      })
    );

    expect(openInstance).not.toHaveBeenCalled();
    expect(updateParameters).toHaveBeenCalledWith({
      context: panelContext,
      source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
    });
    expect(setTitle).toHaveBeenCalledWith("README.md");
    expect(
      await screen.findByRole("heading", { name: "README.md" })
    ).toBeVisible();
    expect(await screen.findByText("Loaded from tree")).toBeVisible();
  });

  it("blocks integrated tree navigation when the current document is dirty", async () => {
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      async () =>
        [
          { kind: "file", path: "README.md", root: PROJECT_ROOT },
        ] satisfies FileEntry[]
    );
    const notifyInfo = vi.fn<RendererPluginContext["notifications"]["info"]>();
    const updateParameters = vi.fn();
    const setTitle = vi.fn();
    const document = createUntitledMarkdownDocument({ contents: "# Before\n" });
    const context = createMockContext({ list, notifyInfo });
    const Panel = createFilePanel(context);
    const { container } = render(
      <Panel
        {...makeProps(
          {
            context: panelContext,
            source: { id: document.id, kind: "untitled", name: document.name },
          },
          { setTitle, updateParameters }
        )}
      />
    );

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(PROJECT_ROOT, { path: "" });
    });
    replaceEditorText(container, "# Dirty edit\n");
    fireEvent.click(
      within(getFileTree(container)).getByRole("treeitem", {
        name: "README.md",
      })
    );

    expect(updateParameters).not.toHaveBeenCalled();
    expect(setTitle).not.toHaveBeenCalled();
    expect(getDocument(document.id)?.currentContents).toBe("# Dirty edit\n");
    expect(getDocument(document.id)?.dirty).toBe(true);
    expect(screen.getByRole("heading", { name: document.name })).toBeVisible();
    expect(notifyInfo).toHaveBeenCalledWith(
      "Save or discard the current file before opening another file from the tree."
    );
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

  it("opens an untitled Markdown document with title, unsaved status, and source editor", () => {
    const document = createUntitledMarkdownDocument({
      contents: "# Terminal notes\n\n- keep this local",
    });

    const { container } = renderFilePanel({
      context: panelContext,
      source: { id: document.id, kind: "untitled", name: document.name },
    });

    expect(screen.getByRole("heading", { name: document.name })).toBeVisible();
    expect(screen.getByText("Temporary file")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Save" })
    ).not.toBeInTheDocument();
    expect(container.querySelector(".cm-editor")).toBeInstanceOf(HTMLElement);
    expect(screen.getByRole("button", { name: "Source" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("renders Markdown tables, lists, and code blocks in preview mode", () => {
    const document = createUntitledMarkdownDocument({
      contents:
        "| A | B |\n| - | - |\n| 1 | 2 |\n\n- alpha\n- beta\n\n```ts\nconst value = 1;\n```",
    });

    renderFilePanel({
      context: panelContext,
      source: { id: document.id, kind: "untitled", name: document.name },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByRole("list")).toBeVisible();
    expect(screen.getByText("const value = 1;")).toBeVisible();
  });

  it("does not render raw HTML or allow link clicks to navigate the current window", () => {
    const startHref = window.location.href;
    const document = createUntitledMarkdownDocument({
      contents:
        '<span id="raw-html">raw</span>\n\n[bad](javascript:alert(1)) [vb](vbscript:msgbox(1)) [data](data:text/html,<script>alert(1)</script>) [safe](https://example.com/docs)',
    });

    const { container } = renderFilePanel({
      context: panelContext,
      source: { id: document.id, kind: "untitled", name: document.name },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(container.querySelector("#raw-html")).toBeNull();
    for (const label of ["bad", "vb", "data"]) {
      expect(screen.getByText(label).closest("a")).not.toHaveAttribute("href");
    }

    const safeLink = screen.getByRole("link", { name: "safe" });
    expect(safeLink).toHaveAttribute("href", "https://example.com/docs");
    expect(fireEvent.click(safeLink)).toBe(false);
    expect(window.location.href).toBe(startHref);
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
    expect(readText).toHaveBeenCalledTimes(1);
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

  it("restores an untitled Markdown document body after renderer memory is lost", () => {
    const document = createUntitledMarkdownDocument({
      contents: "# Restored after force quit\n\n- persisted draft",
    });
    const params = {
      context: panelContext,
      source: { id: document.id, kind: "untitled", name: document.name },
    } satisfies FilesPanelParams;

    clearFilesDocumentStore({ persisted: false });
    renderFilePanel(params);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(
      screen.getByRole("heading", { name: "Restored after force quit" })
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
    expect(readText).not.toHaveBeenCalled();
  });

  it("updates the document contents from CodeMirror and shows dirty state", () => {
    const document = createUntitledMarkdownDocument({ contents: "# Before\n" });
    const { container } = renderFilePanel({
      context: panelContext,
      source: { id: document.id, kind: "untitled", name: document.name },
    });

    replaceEditorText(container, "# After\n");

    expect(getDocument(document.id)?.currentContents).toBe("# After\n");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
  });

  it("saves dirty disk documents through writeText", async () => {
    const writeText = vi.fn<RendererPluginContext["files"]["writeText"]>(
      async (request) => ({
        path: request.path,
        root: request.root,
        written: true,
      })
    );
    renderFilePanel(
      {
        context: panelContext,
        source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
      },
      createMockContext({
        readText: vi.fn(async () => "# Before\n"),
        writeText,
      })
    );

    await screen.findByText("Saved");
    replaceEditorText(document.body, "# After\n");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith({
        contents: "# After\n",
        path: "README.md",
        root: PROJECT_ROOT,
      });
    });
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("keeps Save enabled after a failed disk write so retry can succeed", async () => {
    let shouldFail = true;
    const writeText = vi.fn<RendererPluginContext["files"]["writeText"]>(
      (request) => {
        if (shouldFail) {
          return Promise.reject(new Error("disk full"));
        }
        return Promise.resolve({
          path: request.path,
          root: request.root,
          written: true,
        });
      }
    );
    renderFilePanel(
      {
        context: panelContext,
        source: { kind: "disk", path: "README.md", root: PROJECT_ROOT },
      },
      createMockContext({
        readText: vi.fn(async () => "# Before\n"),
        writeText,
      })
    );

    await screen.findByText("Saved");
    replaceEditorText(document.body, "# After\n");
    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    expect(await screen.findByText("Unable to save file")).toBeVisible();
    expect(screen.getByText("disk full")).toBeVisible();
    expect(saveButton).toBeEnabled();
    shouldFail = false;
    fireEvent.click(saveButton);

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

  it("removes untitled documents on unmount while keeping disk buffers", async () => {
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
    expect(getDocument(diskDocument.id)).not.toBeNull();
  });

  it("does not include unsafe Markdown rendering primitives in implementation", async () => {
    const rendererDir = join(
      process.cwd(),
      "src/plugins/builtin/files/renderer"
    );
    const [previewSource, panelSource] = await Promise.all([
      readFile(join(rendererDir, "markdown-preview.tsx"), "utf8"),
      readFile(join(rendererDir, "file-panel.tsx"), "utf8"),
    ]);

    expect(`${previewSource}\n${panelSource}`).not.toContain("rehype-raw");
    expect(`${previewSource}\n${panelSource}`).not.toContain(
      "dangerouslySetInnerHTML"
    );
    expect(previewSource).toContain("rehype-sanitize");
  });
});
