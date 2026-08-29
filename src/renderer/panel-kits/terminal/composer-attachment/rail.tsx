import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import { openContentPreview } from "@/components/common/content-preview.ts";
import { useT } from "@/i18n/use-t.ts";
import type { ComposerAttachment } from "../composer-attachments-model.ts";
import { AttachmentTile } from "./tile.tsx";

export function TerminalComposerAttachmentRail({
  attachments,
  disabled,
  onEditPaste,
  onRemove,
  onReveal,
}: {
  attachments: readonly ComposerAttachment[];
  disabled: boolean;
  /** Paste attachments open the edit dialog instead of reveal. */
  onEditPaste: (attachment: ComposerAttachment) => void;
  onRemove: (id: string) => void;
  onReveal: (path: string) => void;
}) {
  const t = useT();

  if (attachments.length === 0) {
    return null;
  }

  const openAttachment = (attachment: ComposerAttachment) => {
    if (attachment.kind === "paste") {
      onEditPaste(attachment);
      return;
    }
    if (attachment.kind === "image" && !attachment.isDirectory) {
      openContentPreview({
        payload: {
          type: "image",
          source: { kind: "absolutePath", path: attachment.path },
          alt: attachment.name,
          ...(attachment.previewDataUrl
            ? { placeholderSrc: attachment.previewDataUrl }
            : {}),
        },
        title: t("dialog.imagePreview.title"),
      });
      return;
    }
    onReveal(attachment.path);
  };

  return (
    <TooltipProvider delayDuration={250}>
      <div
        className="flex w-full min-w-0 flex-nowrap gap-1 overflow-x-auto p-1"
        data-scrollbar="none"
        data-testid="terminal-composer-attachment-rail"
      >
        {attachments.map((attachment, index) => (
          <AttachmentTile
            attachment={attachment}
            disabled={disabled}
            key={attachment.id}
            onOpen={openAttachment}
            onRemove={onRemove}
            ordinal={index + 1}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}
