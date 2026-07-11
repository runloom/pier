import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEditorController } from "@plugins/builtin/files/renderer/file-editor-controller.ts";
import { createSaveAllAction } from "@plugins/builtin/files/renderer/file-save-all-action.ts";
import {
  clearFilesDocumentStore,
  createUntitledMarkdownDocument,
  resetFilesDraftBackendForTests,
} from "@plugins/builtin/files/renderer/files-document-store.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  clearFilesDocumentStore({ persisted: false });
  resetFilesDraftBackendForTests();
});

describe("Save All action", () => {
  it("settles a shared document once and reports one aggregate failure", async () => {
    const document = createUntitledMarkdownDocument({ contents: "draft" });
    const source = {
      id: document.id,
      kind: "untitled" as const,
      name: document.name,
    };
    const alert = vi.fn(async () => undefined);
    const context = {
      dialogs: { alert },
      i18n: {
        t: vi.fn(
          (_key: string, _values?: unknown, fallback?: string) => fallback ?? ""
        ),
      },
      panels: {
        listInstances: vi.fn(() => [
          { id: "panel-a", params: { source } },
          { id: "panel-b", params: { source } },
        ]),
      },
    } as unknown as RendererPluginContext;
    const settleDocument = vi.fn(async (documentId: string) => ({
      documentId,
      outcome: "cancelled" as const,
    }));
    const controller = {
      documentId: () => document.id,
      settleDocument,
    } as unknown as FileEditorController;

    await createSaveAllAction(context, controller).handler();

    expect(settleDocument).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith({
      body: document.name,
      size: "default",
      title: "Some files could not be saved",
    });
  });
});
