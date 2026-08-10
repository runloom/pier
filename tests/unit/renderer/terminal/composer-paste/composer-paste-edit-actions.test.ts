import { describe, expect, it, vi } from "vitest";
import type { ComposerAttachment } from "@/panel-kits/terminal/composer-attachments-model.ts";
import { runComposerPasteEdit } from "@/panel-kits/terminal/composer-paste-edit-actions.ts";

const openComposerPasteEditDialog = vi.hoisted(() => vi.fn());

vi.mock("@/panel-kits/terminal/composer-paste-edit-dialog.tsx", () => ({
  openComposerPasteEditDialog,
}));

function pasteAtt(): ComposerAttachment {
  return {
    id: "p1",
    kind: "paste",
    name: "paste.txt",
    path: "/tmp/pier-terminal-pastes/p1.txt",
    pasteContent: "hello",
    pasteTier: "medium",
  };
}

describe("runComposerPasteEdit", () => {
  it("updates paste content on save", async () => {
    openComposerPasteEditDialog.mockResolvedValueOnce({
      action: "save",
      text: "updated",
    });
    const updatePasteContent = vi.fn();
    const removeAttachment = vi.fn();
    await runComposerPasteEdit({
      attachment: pasteAtt(),
      removeAttachment,
      updatePasteContent,
    });
    expect(updatePasteContent).toHaveBeenCalledWith("p1", "updated");
    expect(removeAttachment).not.toHaveBeenCalled();
  });

  it("removes attachment on empty save (delete)", async () => {
    openComposerPasteEditDialog.mockResolvedValueOnce({ action: "delete" });
    const updatePasteContent = vi.fn();
    const removeAttachment = vi.fn();
    await runComposerPasteEdit({
      attachment: pasteAtt(),
      removeAttachment,
      updatePasteContent,
    });
    expect(removeAttachment).toHaveBeenCalledWith("p1");
    expect(updatePasteContent).not.toHaveBeenCalled();
  });

  it("no-ops on cancel", async () => {
    openComposerPasteEditDialog.mockResolvedValueOnce(null);
    const updatePasteContent = vi.fn();
    const removeAttachment = vi.fn();
    await runComposerPasteEdit({
      attachment: pasteAtt(),
      removeAttachment,
      updatePasteContent,
    });
    expect(updatePasteContent).not.toHaveBeenCalled();
    expect(removeAttachment).not.toHaveBeenCalled();
  });
});
