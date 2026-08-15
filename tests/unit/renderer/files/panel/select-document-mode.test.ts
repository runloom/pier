import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEditorController } from "@plugins/builtin/files/renderer/editor/controller.ts";
import { openDocumentLanguagePicker } from "@plugins/builtin/files/renderer/panel/document-mode/select.ts";
import { describe, expect, it, vi } from "vitest";

describe("openDocumentLanguagePicker", () => {
  it("applies the selected language to the current document", () => {
    const openQuickPick = vi.fn();
    const setDocumentLanguage = vi.fn();
    openDocumentLanguagePicker({
      context: {
        commandPalette: { openQuickPick },
      } as unknown as RendererPluginContext,
      controller: { setDocumentLanguage } as unknown as FileEditorController,
      currentLanguage: "text",
      documentId: "doc-1",
      t: (_key, fallback) => fallback ?? _key,
    });

    expect(openQuickPick).toHaveBeenCalledOnce();
    const pick = openQuickPick.mock.calls[0]?.[0] as {
      items: { id: string; checked?: boolean }[];
      onAccept: (item: { id: string }) => void;
      title: string;
    };
    expect(pick.items.some((item) => item.id === "text" && item.checked)).toBe(
      true
    );
    pick.onAccept({ id: "typescript" });
    expect(setDocumentLanguage).toHaveBeenCalledWith("doc-1", "typescript");
    expect(pick.title).toBe("Select Language");
  });
});
