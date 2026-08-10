import type { ComposerAttachment } from "./composer-attachments-model.ts";
import { openComposerPasteEditDialog } from "./composer-paste-edit-dialog.tsx";

/** Run paste-tile edit dialog and apply save / delete. */
export async function runComposerPasteEdit(input: {
  attachment: ComposerAttachment;
  removeAttachment: (id: string) => void;
  updatePasteContent: (id: string, text: string) => void;
}): Promise<void> {
  const result = await openComposerPasteEditDialog({
    attachment: input.attachment,
  });
  if (!result) {
    return;
  }
  if (result.action === "save") {
    input.updatePasteContent(input.attachment.id, result.text);
    return;
  }
  input.removeAttachment(input.attachment.id);
}
