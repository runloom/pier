import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { createDiskDocumentRecord } from "@plugins/builtin/files/renderer/document/factory.ts";
import { withDocumentDeletedOnDisk } from "@plugins/builtin/files/renderer/document/reducers.ts";
import type {
  FilesDocument,
  FilesDocumentPreview,
} from "@plugins/builtin/files/renderer/document/types.ts";
import type { FilesTranslate } from "@plugins/builtin/files/renderer/i18n.ts";
import { FileDocumentPreview } from "@plugins/builtin/files/renderer/preview/document/index.tsx";
import type { DocumentPreviewContext } from "@plugins/builtin/files/renderer/preview/document/types.ts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

const t: FilesTranslate = (_key, fallback) => fallback ?? "";

function rendererContext(
  context: DocumentPreviewContext
): RendererPluginContext {
  return context as unknown as RendererPluginContext;
}

function documentWithPreview(preview: FilesDocumentPreview): FilesDocument {
  return {
    ...createDiskDocumentRecord({
      draft: null,
      id: "doc",
      path: "report.pdf",
      root: "/repo",
    }),
    canonicalPath: "report.pdf",
    preview,
  };
}

function previewContext(): DocumentPreviewContext {
  return {
    dialogs: { alert: vi.fn(async () => undefined) },
    externalNavigation: { open: vi.fn(async () => ({ opened: true })) },
    filePreviews: {
      issue: vi.fn(),
      release: vi.fn(async () => true),
    },
    files: { openPath: vi.fn(async () => ({ opened: true })) },
    notifications: { info: vi.fn() },
  } as unknown as DocumentPreviewContext;
}

describe("document preview lifecycle", () => {
  it("keeps the last preview when the file is deleted on disk", () => {
    const preview: FilesDocumentPreview = {
      format: "pdf",
      kind: "document",
      mime: "application/pdf",
      revision: "r1",
    };
    const deleted = withDocumentDeletedOnDisk(documentWithPreview(preview));

    expect(deleted.deletedOnDisk).toBe(true);
    expect(deleted.revision).toBeNull();
    expect(deleted.preview).toEqual(preview);
  });

  it("does not fetch bytes for unsupported documents", () => {
    const context = previewContext();
    render(
      createElement(FileDocumentPreview, {
        context: rendererContext(context),
        document: documentWithPreview({
          format: "pptx",
          kind: "document-unsupported",
          reason: "not-supported",
        }),
        onReload: vi.fn(),
        preview: {
          format: "pptx",
          kind: "document-unsupported",
          reason: "not-supported",
        },
        t,
      })
    );

    expect(
      screen.getByText("This format can’t be previewed in the workspace.")
    ).toBeInTheDocument();
    expect(context.filePreviews.issue).not.toHaveBeenCalled();
  });

  it("reloads the document instead of refetching a stale revision", async () => {
    const context = previewContext();
    const issue = vi.mocked(context.filePreviews.issue);
    issue.mockResolvedValue({
      expiresAt: 0,
      issued: true,
      ticket: "t1",
      url: "pier-file-preview://file/t1",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 409 }))
    );
    const onReload = vi.fn();
    const preview = {
      format: "pdf" as const,
      kind: "document" as const,
      mime: "application/pdf" as const,
      revision: "r1",
    };

    render(
      createElement(FileDocumentPreview, {
        context: rendererContext(context),
        document: documentWithPreview(preview),
        onReload,
        preview,
        t,
      })
    );

    const retry = await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(retry);

    await waitFor(() => expect(onReload).toHaveBeenCalledOnce());
    expect(issue).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
