import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { createDiskDocumentRecord } from "@plugins/builtin/files/renderer/document/factory.ts";
import type { FilesDocument } from "@plugins/builtin/files/renderer/document/types.ts";
import type { FileEditorController } from "@plugins/builtin/files/renderer/editor/controller.ts";
import type { FilesTranslate } from "@plugins/builtin/files/renderer/i18n.ts";
import { FileDeletedOnDiskBar } from "@plugins/builtin/files/renderer/panel/deleted-on-disk/bar.tsx";
import { FilePanelPreviewBranch } from "@plugins/builtin/files/renderer/panel/preview/index.tsx";
import { openDocumentInDefaultApp } from "@plugins/builtin/files/renderer/preview/document/open-default.ts";
import { DocumentPreviewFrame } from "@plugins/builtin/files/renderer/preview/document/shell.tsx";
import {
  DocumentErrorState,
  DocumentLoadingState,
  DocumentUnsupportedState,
} from "@plugins/builtin/files/renderer/preview/document/states.tsx";
import type { DocumentPreviewContext } from "@plugins/builtin/files/renderer/preview/document/types.ts";
import { useDocumentExternalLink } from "@plugins/builtin/files/renderer/preview/document/use-external-link.ts";
import { usePreviewSource } from "@plugins/builtin/files/renderer/preview/document/use-preview-source.ts";
import FileDocxPreview from "@plugins/builtin/files/renderer/preview/docx/index.tsx";
import { PdfPage } from "@plugins/builtin/files/renderer/preview/pdf/page.tsx";
import { XlsxGrid } from "@plugins/builtin/files/renderer/preview/xlsx/grid.tsx";
import FileXlsxPreview from "@plugins/builtin/files/renderer/preview/xlsx/index.tsx";
import { XLSX_PARSE_TIMEOUT_MS } from "@plugins/builtin/files/renderer/preview/xlsx/limits.ts";
import type { SerializedXlsxSheet } from "@plugins/builtin/files/renderer/preview/xlsx/protocol.ts";
import { SheetTabs } from "@plugins/builtin/files/renderer/preview/xlsx/sheet-tabs.tsx";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import JSZip from "jszip";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const xlsxWorkerMock = vi.hoisted(() => {
  type Listener = (event: { data: unknown }) => void;
  interface FakeWorker {
    onerror: (() => void) | null;
    onmessage: Listener | null;
    posted: { bytes: ArrayBuffer; id: number }[];
    postMessage: (message: { bytes: ArrayBuffer; id: number }) => void;
    terminate: () => void;
    terminated: boolean;
  }
  const workers: FakeWorker[] = [];
  return {
    createXlsxWorker(): FakeWorker {
      const worker: FakeWorker = {
        onerror: null,
        onmessage: null,
        postMessage(message) {
          worker.posted.push(message);
        },
        posted: [],
        terminate() {
          worker.terminated = true;
        },
        terminated: false,
      };
      workers.push(worker);
      return worker;
    },
    workers,
  };
});

vi.mock(
  "@plugins/builtin/files/renderer/preview/xlsx/worker-client.ts",
  () => ({ createXlsxWorker: xlsxWorkerMock.createXlsxWorker })
);

vi.mock("docx-preview", () => ({
  renderAsync: vi.fn(
    async (_data: unknown, body: HTMLElement, style: HTMLElement) => {
      body.innerHTML = `
        <p>Pier DOCX body</p>
        <script>alert(1)</script>
        <img src="https://example.com/tracker.png">
        <a href="https://example.com">web</a>
      `;
      style.innerHTML =
        '<style>@import url("https://example.com/x.css");</style>';
    }
  ),
}));

const t: FilesTranslate = (_key, fallback, values) => {
  let text = fallback ?? "";
  for (const [name, value] of Object.entries(values ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
};

function diskDocument(path: string): FilesDocument {
  return {
    ...createDiskDocumentRecord({
      draft: null,
      id: "doc",
      path,
      root: "/repo",
    }),
    canonicalPath: path,
  };
}

function previewContext(
  overrides: Partial<Record<keyof DocumentPreviewContext, unknown>>
): DocumentPreviewContext {
  return {
    dialogs: { alert: vi.fn(async () => undefined) },
    externalNavigation: { open: vi.fn(async () => ({ opened: true })) },
    filePreviews: {
      issue: vi.fn(),
      release: vi.fn(async () => true),
    },
    files: { openPath: vi.fn(async () => ({ opened: true })) },
    notifications: { info: vi.fn() },
    ...overrides,
  } as unknown as DocumentPreviewContext;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  xlsxWorkerMock.workers.length = 0;
});

describe("FileDeletedOnDiskBar", () => {
  it("does not tell a read-only preview to save", () => {
    const document: FilesDocument = {
      ...diskDocument("report.pdf"),
      capabilities: [],
      deletedOnDisk: true,
      hasBackingStore: false,
      preview: {
        kind: "image",
        mime: "image/png",
        revision: "r1",
      },
      readOnly: true,
      revision: null,
    };
    render(
      <FileDeletedOnDiskBar
        controller={{} as FileEditorController}
        document={document}
        panelId={undefined}
        t={t}
      />
    );

    expect(
      screen.getByText(
        "This preview shows the last version. Restore the file to open it again."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save to Restore" })
    ).toBeNull();
  });

  it("does not promise a last-version preview for unsupported documents", () => {
    const document: FilesDocument = {
      ...diskDocument("report.pptx"),
      capabilities: [],
      deletedOnDisk: true,
      hasBackingStore: false,
      preview: {
        format: "pptx",
        kind: "document-unsupported",
        reason: "not-supported",
      },
      readOnly: true,
      revision: null,
    };
    render(
      <FileDeletedOnDiskBar
        controller={{} as FileEditorController}
        document={document}
        panelId={undefined}
        t={t}
      />
    );

    expect(
      screen.getByText("Restore the file to open it again.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/This preview shows the last version/u)
    ).toBeNull();
  });
});

describe("DocumentUnsupportedState", () => {
  it.each([
    ["encrypted", "encrypted"],
    ["legacy", "older Office format"],
    ["not-supported", "can’t be previewed"],
    ["too-large", "larger than 64 MB"],
  ] as const)("explains %s and offers the default app", (reason, copy) => {
    const onOpen = vi.fn();
    render(
      <DocumentUnsupportedState
        document={diskDocument("report.pptx")}
        onOpenInDefaultApp={onOpen}
        preview={{ format: "pptx", kind: "document-unsupported", reason }}
        t={t}
      />
    );

    expect(screen.getByText(new RegExp(copy, "u"))).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open in default app" })
    );
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("hides the default-app action when the file is not on disk", () => {
    render(
      <DocumentUnsupportedState
        document={diskDocument("report.pptx")}
        preview={{
          format: "pptx",
          kind: "document-unsupported",
          reason: "not-supported",
        }}
        t={t}
      />
    );
    expect(
      screen.queryByRole("button", { name: "Open in default app" })
    ).toBeNull();
  });

  it("tells a deleted unsupported document to restore it", () => {
    render(
      <DocumentUnsupportedState
        document={{ ...diskDocument("report.pptx"), deletedOnDisk: true }}
        preview={{
          format: "pptx",
          kind: "document-unsupported",
          reason: "not-supported",
        }}
        t={t}
      />
    );

    expect(
      screen.getByText("Restore the file to open it again.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Open it in the default app to view the full document."
      )
    ).toBeNull();
  });
});

describe("DocumentErrorState", () => {
  it("shows a retry action and the default-app fallback", () => {
    const onRetry = vi.fn();
    const onOpen = vi.fn();
    render(
      <DocumentErrorState
        error="stale"
        onOpenInDefaultApp={onOpen}
        onRetry={onRetry}
        t={t}
      />
    );

    expect(screen.getByText("Document changed on disk")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Open in default app" })
    );
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("renders a loading state", () => {
    render(<DocumentLoadingState t={t} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("DocumentPreviewFrame", () => {
  it("offers the default-app action in the ready toolbar", () => {
    const onOpen = vi.fn();
    render(
      <DocumentPreviewFrame onOpenInDefaultApp={onOpen} t={t}>
        <div>body</div>
      </DocumentPreviewFrame>
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open in default app" })
    );
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("omits the default-app action when the host does not offer it", () => {
    render(
      <DocumentPreviewFrame t={t}>
        <div>body</div>
      </DocumentPreviewFrame>
    );

    expect(
      screen.queryByRole("button", { name: "Open in default app" })
    ).toBeNull();
  });
});

describe("useDocumentExternalLink", () => {
  it("uses the link-specific failure title", async () => {
    const alert = vi.fn(async () => undefined);
    const context = previewContext({
      dialogs: { alert },
      externalNavigation: {
        open: vi.fn(async () => ({ opened: false, reason: "open-failed" })),
      },
    });
    const localize = vi.fn((_key: string, fallback?: string) => fallback ?? "");
    const { result } = renderHook(() =>
      useDocumentExternalLink({
        context,
        t: localize as unknown as FilesTranslate,
      })
    );

    act(() => result.current("https://example.com"));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(localize).toHaveBeenCalledWith(
      "filePanel.markdown.externalOpenFailed.title",
      expect.any(String)
    );
  });
});

describe("openDocumentInDefaultApp", () => {
  it("opens the canonical absolute path", async () => {
    const openPath = vi.fn(async () => ({ opened: true as const }));
    const context = previewContext({ files: { openPath } });

    await openDocumentInDefaultApp({
      context,
      document: diskDocument("docs/report.docx"),
      t,
    });

    expect(openPath).toHaveBeenCalledWith({ path: "/repo/docs/report.docx" });
    expect(context.dialogs.alert).not.toHaveBeenCalled();
  });

  it("alerts when the system app cannot open the file", async () => {
    const openPath = vi.fn(async () => ({
      opened: false as const,
      reason: "open-failed" as const,
    }));
    const context = previewContext({ files: { openPath } });

    await openDocumentInDefaultApp({
      context,
      document: diskDocument("report.docx"),
      t,
    });

    expect(context.dialogs.alert).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "default" })
    );
  });
});

describe("usePreviewSource", () => {
  it("issues one ticket, fetches once and releases after reading bytes", async () => {
    const issue = vi.fn(async () => ({
      expiresAt: 0,
      issued: true as const,
      ticket: "t1",
      url: "pier-file-preview://file/t1",
    }));
    const release = vi.fn(async () => true);
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "application/pdf" },
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const context = previewContext({
      filePreviews: { issue, release },
    });

    const { result } = renderHook(() =>
      usePreviewSource({
        context,
        mime: "application/pdf",
        path: "a.pdf",
        revision: "r1",
        root: "/repo",
      })
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(issue).toHaveBeenCalledOnce();
    await waitFor(() => expect(release).toHaveBeenCalledWith("t1"));
  });

  it("maps an unissued too-large ticket without fetching", async () => {
    const issue = vi.fn(async () => ({
      issued: false as const,
      reason: "too-large" as const,
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const context = previewContext({
      filePreviews: { issue, release: vi.fn() },
    });

    const { result } = renderHook(() =>
      usePreviewSource({
        context,
        mime: "application/pdf",
        path: "too-large.pdf",
        revision: "r1",
        root: "/repo",
      })
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("too-large");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps HTTP 409 to stale", async () => {
    const issue = vi.fn(async () => ({
      expiresAt: 0,
      issued: true as const,
      ticket: "t1",
      url: "pier-file-preview://file/t1",
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 409 }))
    );
    const context = previewContext({
      filePreviews: { issue, release: vi.fn(async () => true) },
    });

    const { result } = renderHook(() =>
      usePreviewSource({
        context,
        mime: "application/pdf",
        path: "stale.pdf",
        revision: "r1",
        root: "/repo",
      })
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("stale");
  });

  it("refetches with a new revision and releases the old ticket", async () => {
    let issued = 0;
    const issue = vi.fn(async () => {
      issued += 1;
      return {
        expiresAt: 0,
        issued: true as const,
        ticket: `t${issued}`,
        url: `pier-file-preview://file/t${issued}`,
      };
    });
    const release = vi.fn(async () => true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1]), {
            headers: { "content-type": "application/pdf" },
          })
      )
    );
    const context = previewContext({ filePreviews: { issue, release } });

    const { result, rerender } = renderHook(
      ({ revision }) =>
        usePreviewSource({
          context,
          mime: "application/pdf",
          path: "refetch.pdf",
          revision,
          root: "/repo",
        }),
      { initialProps: { revision: "r1" } }
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      rerender({ revision: "r2" });
    });
    await waitFor(() => expect(issue).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(release).toHaveBeenCalledWith("t1");
  });
});

describe("FilePanelPreviewBranch", () => {
  it("reports a failed reload instead of swallowing the rejection", async () => {
    const issue = vi.fn(async () => ({
      expiresAt: 0,
      issued: true as const,
      ticket: "t1",
      url: "pier-file-preview://file/t1",
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 409 }))
    );
    const notifications = { error: vi.fn(), info: vi.fn() };
    const context = {
      ...previewContext({
        filePreviews: { issue, release: vi.fn(async () => true) },
        notifications,
      }),
      notifications,
    } as unknown as RendererPluginContext;
    const reloadDocumentFromDisk = vi.fn(async () => {
      throw new Error("reload unavailable");
    });
    const controller = {
      reloadDocumentFromDisk,
    } as unknown as FileEditorController;
    const preview = {
      format: "pdf" as const,
      kind: "document" as const,
      mime: "application/pdf" as const,
      revision: "r1",
    };
    const document: FilesDocument = {
      ...diskDocument("reload.pdf"),
      loadState: "loaded",
      preview,
    };

    render(
      <FilePanelPreviewBranch
        context={context}
        controller={controller}
        document={document}
        panelId={undefined}
        preview={preview}
        searchRequest={0}
        t={t}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(reloadDocumentFromDisk).toHaveBeenCalledOnce());
    await waitFor(() => expect(notifications.error).toHaveBeenCalledOnce());
    expect(notifications.error.mock.calls[0]?.[0]).toBe(
      "Couldn't reload the document. Try again."
    );
  });

  it("uses document copy when find is requested in a document preview", async () => {
    const info = vi.fn();
    const context = {
      ...previewContext({ notifications: { info } }),
      notifications: { info },
    } as unknown as RendererPluginContext;
    const preview = {
      format: "pptx" as const,
      kind: "document-unsupported" as const,
      reason: "not-supported" as const,
    };
    const document: FilesDocument = {
      ...diskDocument("find.pptx"),
      loadState: "loaded",
      preview,
    };
    const branch = (searchRequest: number) => (
      <FilePanelPreviewBranch
        context={context}
        controller={{} as FileEditorController}
        document={document}
        panelId={undefined}
        preview={preview}
        searchRequest={searchRequest}
        t={t}
      />
    );

    const { rerender } = render(branch(0));
    rerender(branch(1));

    await waitFor(() =>
      expect(info).toHaveBeenCalledWith(
        "Find isn't available in document previews."
      )
    );
  });
});

async function makeDocxBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", "<w:document/>");
  return zip.generateAsync({ type: "uint8array" });
}

describe("FileDocxPreview", () => {
  it("offers the default-app action in the ready state", async () => {
    const onOpen = vi.fn();
    render(
      <FileDocxPreview
        bytes={await makeDocxBytes()}
        context={previewContext({})}
        fileName="a.docx"
        onOpenInDefaultApp={onOpen}
        onRetry={vi.fn()}
        t={t}
      />
    );

    await waitFor(() => {
      const host = document.querySelector(
        '[data-slot="document-preview-docx"]'
      );
      expect(host?.shadowRoot?.textContent).toContain("Pier DOCX body");
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Open in default app" })
    );
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("renders into a sanitized shadow root and routes links through the host", async () => {
    const bytes = await makeDocxBytes();
    const context = previewContext({});
    render(
      <FileDocxPreview
        bytes={bytes}
        context={context}
        fileName="a.docx"
        onRetry={vi.fn()}
        t={t}
      />
    );

    await waitFor(() => {
      const host = document.querySelector(
        '[data-slot="document-preview-docx"]'
      );
      expect(host?.shadowRoot?.textContent).toContain("Pier DOCX body");
    });
    const shadow = document.querySelector('[data-slot="document-preview-docx"]')
      ?.shadowRoot as ShadowRoot;
    expect(shadow.querySelector("script")).toBeNull();
    const image = shadow.querySelector("img");
    expect(image?.hasAttribute("src")).toBe(false);
    expect(image?.getAttribute("data-pier-blocked-image")).toBe("true");
    expect(shadow.querySelector("style")?.textContent).not.toContain("@import");

    const anchor = shadow.querySelector("a") as HTMLAnchorElement;
    fireEvent.click(anchor);
    await waitFor(() =>
      expect(context.externalNavigation.open).toHaveBeenCalledWith(
        "https://example.com/"
      )
    );
  });

  it("does not commit a stale render after the document changes", async () => {
    const { renderAsync } = await import("docx-preview");
    const mockedRender = vi.mocked(renderAsync);
    const gate: { release: (() => void) | null } = { release: null };
    mockedRender.mockImplementationOnce(
      (_data, body) =>
        new Promise<void>((resolve) => {
          gate.release = () => {
            body.textContent = "STALE DOCX";
            resolve();
          };
        })
    );
    mockedRender.mockImplementationOnce((_data, body) => {
      body.textContent = "FRESH DOCX";
      return Promise.resolve();
    });

    const first = await makeDocxBytes();
    const second = await makeDocxBytes();
    const context = previewContext({});
    const { rerender } = render(
      <FileDocxPreview
        bytes={first}
        context={context}
        fileName="a.docx"
        onRetry={vi.fn()}
        t={t}
      />
    );

    await waitFor(() => expect(gate.release).not.toBeNull());
    rerender(
      <FileDocxPreview
        bytes={second}
        context={context}
        fileName="a.docx"
        onRetry={vi.fn()}
        t={t}
      />
    );
    await waitFor(() => {
      const shadow = document.querySelector(
        '[data-slot="document-preview-docx"]'
      )?.shadowRoot;
      expect(shadow?.textContent).toContain("FRESH DOCX");
    });

    gate.release?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const committed = document.querySelector(
      '[data-slot="document-preview-docx"]'
    )?.shadowRoot;
    expect(committed?.textContent).toContain("FRESH DOCX");
    expect(committed?.textContent).not.toContain("STALE DOCX");
  });
});

const dataSheet: SerializedXlsxSheet = {
  columnCount: 2,
  columnWidthsPx: [null, null],
  fullColumnCount: 2,
  fullRowCount: 2,
  merges: [],
  name: "Data",
  rowCount: 2,
  rowHeights: [],
  rows: [
    [
      { align: "left", text: "Name" },
      { align: "left", text: "Score" },
    ],
    [
      { align: "left", text: "Alice" },
      { align: "right", text: "42" },
    ],
  ],
  startColumn: 0,
  startRow: 0,
  truncated: false,
};

const summarySheet: SerializedXlsxSheet = {
  columnCount: 1,
  columnWidthsPx: [null],
  fullColumnCount: 1,
  fullRowCount: 2,
  merges: [],
  name: "Summary",
  rowCount: 2,
  rowHeights: [],
  rows: [[{ align: "left", text: "Total" }], [{ align: "right", text: "42" }]],
  startColumn: 0,
  startRow: 0,
  truncated: false,
};

async function respondWithSheets(sheets: SerializedXlsxSheet[]): Promise<void> {
  await waitFor(() => expect(xlsxWorkerMock.workers.length).toBeGreaterThan(0));
  const worker = xlsxWorkerMock.workers.at(-1);
  if (!worker) {
    throw new Error("worker missing");
  }
  await waitFor(() => expect(worker.posted.length).toBeGreaterThan(0));
  const request = worker.posted.at(-1);
  if (!request) {
    throw new Error("request missing");
  }
  await act(async () => {
    worker.onmessage?.({ data: { id: request.id, kind: "ok", sheets } });
  });
}

describe("SheetTabs", () => {
  it("marks the active worksheet and reports selection", () => {
    const onSelect = vi.fn();
    render(
      <SheetTabs
        activeIndex={1}
        names={["Data", "Summary"]}
        onSelect={onSelect}
        t={t}
      />
    );

    expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Data" }));
    expect(onSelect).toHaveBeenCalledWith(0);
  });
});

describe("FileXlsxPreview", () => {
  function renderPreview(onOpenInDefaultApp?: () => void): void {
    render(
      <FileXlsxPreview
        bytes={new Uint8Array([0x50, 0x4b, 0x03, 0x04])}
        documentId="doc-1"
        fileName="a.xlsx"
        {...(onOpenInDefaultApp ? { onOpenInDefaultApp } : {})}
        onRetry={vi.fn()}
        t={t}
      />
    );
  }

  it("offers the default-app action in the ready state", async () => {
    const onOpen = vi.fn();
    renderPreview(onOpen);
    await respondWithSheets([dataSheet]);

    fireEvent.click(
      screen.getByRole("button", { name: "Open in default app" })
    );
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("renders the first worksheet and switches sheets", async () => {
    renderPreview();
    await respondWithSheets([dataSheet, summarySheet]);

    expect(
      screen.getByRole("grid", { name: "Sheet Data" })
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Data" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Summary" }));
    expect(
      screen.getByRole("grid", { name: "Sheet Summary" })
    ).toBeInTheDocument();
  });

  it("shows a truncation infobar with the visible dimensions", async () => {
    renderPreview();
    await respondWithSheets([
      {
        ...dataSheet,
        fullColumnCount: 10,
        fullRowCount: 60_000,
        truncated: true,
      },
    ]);

    expect(
      screen.getByText(/Showing 2 rows × 2 columns \(4 cells\)/u)
    ).toBeInTheDocument();
  });

  it("explains an offset-only truncation without fake row counts", async () => {
    renderPreview();
    await respondWithSheets([
      {
        ...dataSheet,
        rowCount: 0,
        rows: [],
        truncated: true,
        truncatedReason: "offset",
      },
    ]);

    expect(
      screen.getByText(/used range starts below the preview row limit/u)
    ).toBeInTheDocument();
  });

  it("shows an error state when the worker reports a parse failure", async () => {
    renderPreview();
    await waitFor(() =>
      expect(xlsxWorkerMock.workers.length).toBeGreaterThan(0)
    );
    const worker = xlsxWorkerMock.workers.at(-1);
    await waitFor(() => expect(worker?.posted.length).toBeGreaterThan(0));
    const request = worker?.posted.at(-1);
    await act(async () => {
      worker?.onmessage?.({
        data: { code: "parse-failed", id: request?.id ?? -1, kind: "error" },
      });
    });

    expect(screen.getByText("Unable to display document")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("terminates a worker that exceeds the parse timeout", async () => {
    vi.useFakeTimers();
    try {
      renderPreview();
      expect(xlsxWorkerMock.workers).toHaveLength(1);
      const worker = xlsxWorkerMock.workers[0];

      act(() => {
        vi.advanceTimersByTime(XLSX_PARSE_TIMEOUT_MS);
      });

      expect(worker?.terminated).toBe(true);
      expect(
        screen.getByText("Unable to display document")
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("XlsxGrid", () => {
  const noopColumnWidths = () => undefined;

  it("copies the active cell as TSV text from the native copy event", async () => {
    render(
      <XlsxGrid
        columnWidths={{}}
        onColumnWidthsChange={noopColumnWidths}
        sheet={dataSheet}
        t={t}
      />
    );

    const cell = await screen.findByText("Alice");
    fireEvent.mouseDown(cell);
    fireEvent.click(cell);
    const clipboard = { setData: vi.fn() };
    fireEvent.copy(cell, { clipboardData: clipboard });

    expect(clipboard.setData).toHaveBeenCalledWith("text/plain", "Alice");
  });

  it("labels columns and rows from the used-range origin", () => {
    render(
      <XlsxGrid
        columnWidths={{}}
        onColumnWidthsChange={noopColumnWidths}
        sheet={{ ...dataSheet, startColumn: 2, startRow: 4 }}
        t={t}
      />
    );

    const headerNames = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    // jsdom has no real viewport width, so react-data-grid virtualizes the
    // second data column away; the first header still proves the offset.
    expect(headerNames).toEqual(["", "C"]);
    const rowNumbers = [...document.querySelectorAll(".pier-csv-rownum")].map(
      (node) => node.textContent
    );
    expect(rowNumbers.slice(0, 2)).toEqual(["5", "6"]);
    // Trailing empty rows keep the sheet filling the viewport like Excel.
    expect(rowNumbers[2]).toBe("7");
  });

  it("leaves the clipboard untouched when the active cell is gone", () => {
    const { rerender } = render(
      <XlsxGrid
        columnWidths={{}}
        onColumnWidthsChange={noopColumnWidths}
        sheet={dataSheet}
        t={t}
      />
    );
    const cell = screen.getByText("Alice");
    fireEvent.mouseDown(cell);
    fireEvent.click(cell);

    rerender(
      <XlsxGrid
        columnWidths={{}}
        onColumnWidthsChange={noopColumnWidths}
        sheet={{
          ...summarySheet,
          fullRowCount: 1,
          rowCount: 1,
          rows: [[{ align: "left", text: "Only" }]],
        }}
        t={t}
      />
    );
    const clipboard = { setData: vi.fn() };
    fireEvent.copy(screen.getByRole("grid"), { clipboardData: clipboard });

    expect(clipboard.setData).not.toHaveBeenCalled();
  });

  it("leaves the clipboard untouched for blank cells", () => {
    render(
      <XlsxGrid
        columnWidths={{}}
        onColumnWidthsChange={noopColumnWidths}
        sheet={{
          ...dataSheet,
          columnCount: 1,
          columnWidthsPx: [null],
          fullColumnCount: 1,
          rows: [[{ align: "left", text: "" }], [{ align: "left", text: "" }]],
        }}
        t={t}
      />
    );
    const [cell] = screen.getAllByRole("gridcell");
    if (!cell) {
      throw new Error("blank grid cell is missing");
    }
    fireEvent.mouseDown(cell);
    fireEvent.click(cell);
    const clipboard = { setData: vi.fn() };
    fireEvent.copy(cell, { clipboardData: clipboard });

    // Writing an empty string would wipe the system clipboard.
    expect(clipboard.setData).not.toHaveBeenCalled();
  });

  it("makes data columns resizable while the row-number column stays fixed", () => {
    render(
      <XlsxGrid
        columnWidths={{}}
        onColumnWidthsChange={noopColumnWidths}
        sheet={dataSheet}
        t={t}
      />
    );

    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]).not.toHaveClass("rdg-cell-resizable");
    expect(headers[1]).toHaveClass("rdg-cell-resizable");
  });

  it("applies a persisted width instead of the auto-fit width", () => {
    render(
      <XlsxGrid
        columnWidths={{ c0: 300 }}
        onColumnWidthsChange={noopColumnWidths}
        sheet={dataSheet}
        t={t}
      />
    );

    expect(screen.getByRole("grid").getAttribute("style")).toContain(
      "grid-template-columns: 56px 300px"
    );
  });

  it("renders document column widths when the user has not resized", () => {
    render(
      <XlsxGrid
        columnWidths={{}}
        onColumnWidthsChange={noopColumnWidths}
        sheet={{ ...dataSheet, columnWidthsPx: [200, 120] }}
        t={t}
      />
    );

    expect(screen.getByRole("grid").getAttribute("style")).toContain(
      "grid-template-columns: 56px 200px 120px"
    );
  });

  it("lets a persisted width override the document width", () => {
    render(
      <XlsxGrid
        columnWidths={{ c0: 300 }}
        onColumnWidthsChange={noopColumnWidths}
        sheet={{ ...dataSheet, columnWidthsPx: [200, 120] }}
        t={t}
      />
    );

    expect(screen.getByRole("grid").getAttribute("style")).toContain(
      "grid-template-columns: 56px 300px"
    );
  });

  it("spans horizontal merges instead of clipping the anchored value", () => {
    render(
      <XlsxGrid
        columnWidths={{}}
        onColumnWidthsChange={noopColumnWidths}
        sheet={{
          ...dataSheet,
          merges: [{ column: 0, columnSpan: 2, row: 1 }],
        }}
        t={t}
      />
    );

    expect(
      screen.getByText("Alice").closest('[role="gridcell"]')
    ).toHaveAttribute("aria-colspan", "2");
  });

  it("honors document row heights and wraps tall rows", () => {
    render(
      <XlsxGrid
        columnWidths={{}}
        onColumnWidthsChange={noopColumnWidths}
        sheet={{
          ...dataSheet,
          rowHeights: [
            { height: 21, row: 0 },
            { height: 120, row: 1 },
          ],
        }}
        t={t}
      />
    );

    // react-data-grid applies variable heights through the grid template.
    const gridStyle = screen.getByRole("grid").getAttribute("style");
    expect(gridStyle).toContain("120px");
    expect(gridStyle).toContain("28px");
    expect(screen.getByText("Alice").className).toContain(
      "whitespace-pre-wrap"
    );
    expect(screen.getByText("Name").className).toContain("whitespace-nowrap");
  });
});

describe("PdfPage", () => {
  it("reports a rendered-page failure instead of swallowing it", async () => {
    const onRenderError = vi.fn();
    const pdf = {
      getPage: vi.fn().mockRejectedValue(new Error("bad page")),
      numPages: 1,
    } as unknown as PDFDocumentProxy;

    render(
      <PdfPage
        fileName="a.pdf"
        onExternalLink={vi.fn()}
        onNavigatePage={vi.fn()}
        onRenderError={onRenderError}
        pageNumber={1}
        pdf={pdf}
        t={t}
        zoom={1}
      />
    );

    await waitFor(() => expect(onRenderError).toHaveBeenCalledTimes(1));
  });
});
