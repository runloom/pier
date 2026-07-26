import { PierFileIcon } from "@pier/ui/file-icon.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { ComposerAttachment } from "../terminal-composer-attachments-model.ts";
import {
  ComposerSuggestList,
  type ComposerSuggestRowModel,
} from "./composer-suggest-list.tsx";

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
  const rows: ComposerSuggestRowModel[] = items.map((item) => ({
    detail: null,
    icon: (
      <span className="relative flex size-4 items-center justify-center">
        <PierFileIcon
          aria-hidden="true"
          fileName={item.attachment.name}
          size={16}
        />
        <span
          className={cn(
            "absolute -right-1 -bottom-0.5 rounded px-0.5",
            "bg-muted font-mono text-[8px] text-muted-foreground leading-none"
          )}
        >
          {item.ordinal}
        </span>
      </span>
    ),
    key: item.attachment.id,
    label: item.attachment.name,
    meta: `#${item.ordinal}`,
  }));

  return (
    <ComposerSuggestList
      activeIndex={activeIndex}
      emptyBody={hasAttachments ? null : emptyAttachmentsBody}
      emptyTitle={hasAttachments ? null : emptyAttachmentsTitle}
      items={rows}
      listboxId={ATTACHMENT_LISTBOX_ID}
      noResults={noResults}
      onHover={onHover}
      onSelect={onSelect}
      optionIdPrefix="terminal-composer-attachment-option"
      showEmpty={!hasAttachments}
      testId="terminal-composer-attachment-autocomplete"
    />
  );
}
