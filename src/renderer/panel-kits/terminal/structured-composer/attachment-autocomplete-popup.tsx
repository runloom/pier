import { PierFileIcon } from "@pier/ui/file-icon.tsx";
import { MENU_ITEM_DENSITY_CLASS } from "@pier/ui/interactive-density.ts";
import { cn } from "@pier/ui/utils.ts";
import type { ComposerAttachment } from "../terminal-composer-attachments-model.ts";

export const ATTACHMENT_LISTBOX_ID =
  "terminal-composer-attachment-autocomplete-listbox";

export interface AttachmentAutocompleteItem {
  attachment: ComposerAttachment;
  ordinal: number;
}

export interface AttachmentAutocompletePopupProps {
  activeIndex: number;
  emptyAttachmentsBody: string;
  emptyAttachmentsTitle: string;
  hasAttachments: boolean;
  items: readonly AttachmentAutocompleteItem[];
  noResults: string;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
}

export function AttachmentAutocompletePopup({
  activeIndex,
  emptyAttachmentsBody,
  emptyAttachmentsTitle,
  hasAttachments,
  items,
  noResults,
  onHover,
  onSelect,
}: AttachmentAutocompletePopupProps) {
  return (
    <div
      className={cn(
        // Position comes from ComposerAutocompletePortal (fixed above input).
        "max-h-56 w-full min-w-0",
        "overflow-y-auto overflow-x-hidden rounded-xl border bg-popover p-1 shadow-md",
        "no-scrollbar"
      )}
      data-scrollbar="none"
      data-testid="terminal-composer-attachment-autocomplete"
      id={ATTACHMENT_LISTBOX_ID}
      role="listbox"
    >
      {hasAttachments ? null : (
        <div className="px-2 py-1.5">
          <div className="font-medium text-foreground text-xs/tight">
            {emptyAttachmentsTitle}
          </div>
          <div className="mt-0.5 text-muted-foreground text-xs/tight">
            {emptyAttachmentsBody}
          </div>
        </div>
      )}

      {hasAttachments && items.length === 0 ? (
        <div className="px-2 py-1.5 text-muted-foreground text-xs/tight">
          {noResults}
        </div>
      ) : null}

      {hasAttachments
        ? items.map((item, index) => (
            <button
              aria-selected={index === activeIndex}
              className={cn(
                "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left",
                MENU_ITEM_DENSITY_CLASS,
                index === activeIndex
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-accent/50"
              )}
              data-testid={`terminal-composer-attachment-item-${index}`}
              id={`terminal-composer-attachment-option-${index}`}
              key={item.attachment.id}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(index);
              }}
              onMouseEnter={() => onHover(index)}
              role="option"
              type="button"
            >
              <span
                className={cn(
                  "inline-flex size-4 shrink-0 items-center justify-center rounded-sm",
                  "border border-status-done-border bg-status-done-bg",
                  "font-mono text-[10px]/tight text-status-done-fg tabular-nums"
                )}
              >
                {item.ordinal}
              </span>
              <PierFileIcon
                aria-hidden="true"
                className="shrink-0"
                fileName={item.attachment.name}
                size={14}
              />
              <span className="min-w-0 flex-1 truncate font-medium font-mono text-xs/tight">
                {item.attachment.name}
              </span>
            </button>
          ))
        : null}
    </div>
  );
}
