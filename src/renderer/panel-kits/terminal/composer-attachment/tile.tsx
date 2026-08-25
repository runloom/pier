import { Button } from "@pier/ui/button.tsx";
import { PierFileIcon } from "@pier/ui/file/icon.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import { clipComposerTextPreview } from "@shared/composer-attachment-kind.ts";
import { Folder, X } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";
import type { ComposerAttachment } from "../composer-attachments-model.ts";
import {
  COMPOSER_ATTACHMENT_TILE_SIZE_PX,
  measureComposerImageTileSize,
} from "./layout.ts";

export type ComposerAttachmentSurface = "image" | "text" | "file";

/** Kind-first: failed images stay image; empty paste stays text. */
export function resolveComposerAttachmentSurface(
  attachment: ComposerAttachment
): ComposerAttachmentSurface {
  if (attachment.kind === "image" && !attachment.isDirectory) {
    return "image";
  }
  if (attachment.kind === "paste") {
    return "text";
  }
  if (textSnippetForAttachment(attachment).length > 0) {
    return "text";
  }
  return "file";
}

export function textSnippetForAttachment(
  attachment: ComposerAttachment
): string {
  if (attachment.isDirectory) {
    return "";
  }
  if (typeof attachment.textPreview === "string") {
    return attachment.textPreview;
  }
  if (attachment.kind === "paste") {
    return clipComposerTextPreview(attachment.pasteContent ?? "");
  }
  return "";
}

function measuredImageTile(attachment: ComposerAttachment) {
  const width = attachment.previewWidth;
  const height = attachment.previewHeight;
  if (
    typeof width !== "number" ||
    width < 1 ||
    typeof height !== "number" ||
    height < 1
  ) {
    return null;
  }
  return measureComposerImageTileSize({ height, width });
}

function tileShellClassName(centered: boolean): string {
  return cn(
    "composer-attachment-surface relative size-full overflow-hidden rounded-md",
    "select-none border border-border/60 bg-muted/40",
    "cursor-pointer outline-none transition-colors hover:bg-muted/60",
    "focus-visible:ring-3 focus-visible:ring-ring/30",
    centered && "flex items-center justify-center"
  );
}

function ImageFace({ attachment }: { attachment: ComposerAttachment }) {
  const preview = attachment.previewDataUrl;
  if (!preview) {
    return null;
  }
  const measured = measuredImageTile(attachment);
  return (
    <img
      alt=""
      className={cn(
        "pointer-events-none select-none object-contain",
        "max-h-full max-w-full [-webkit-user-drag:none]",
        measured ? null : "h-auto w-auto"
      )}
      draggable={false}
      height={measured?.contentHeight ?? COMPOSER_ATTACHMENT_TILE_SIZE_PX}
      src={preview}
      width={measured?.contentWidth ?? COMPOSER_ATTACHMENT_TILE_SIZE_PX}
    />
  );
}

function TextFace({
  emptyFallbackLabel,
  snippet,
}: {
  emptyFallbackLabel: string;
  snippet: string;
}) {
  const body = snippet.length > 0 ? snippet : emptyFallbackLabel;
  return (
    <div
      className={cn(
        "line-clamp-3 size-full px-1 py-1 text-left font-mono",
        "text-[9px] text-muted-foreground leading-[11px]",
        "whitespace-pre-wrap break-all"
      )}
    >
      {body}
    </div>
  );
}

function IconFace({ attachment }: { attachment: ComposerAttachment }) {
  if (attachment.isDirectory) {
    return <Folder aria-hidden="true" className="size-6 text-foreground" />;
  }
  return (
    <PierFileIcon aria-hidden="true" fileName={attachment.name} size={24} />
  );
}

export function AttachmentTile({
  attachment,
  disabled,
  onOpen,
  onRemove,
  ordinal,
}: {
  attachment: ComposerAttachment;
  disabled: boolean;
  onOpen: (attachment: ComposerAttachment) => void;
  onRemove: (id: string) => void;
  ordinal: number;
}) {
  const t = useT();
  const surface = resolveComposerAttachmentSurface(attachment);
  const snippet = textSnippetForAttachment(attachment);
  const pasteFallback = t("terminal.composer.pasteAttachmentLabel");
  const tooltipLabel =
    attachment.kind === "paste"
      ? t("terminal.composer.pasteAttachmentLabel")
      : attachment.name;
  const ariaLabel =
    attachment.kind === "paste"
      ? t("terminal.composer.pasteAttachmentAria", { n: ordinal })
      : attachment.name;

  return (
    <div
      className="group/att relative shrink-0"
      data-slot="composer-attachment-tile"
      data-surface={surface}
      data-testid={`terminal-composer-attachment-${ordinal}`}
      style={{
        height: COMPOSER_ATTACHMENT_TILE_SIZE_PX,
        width: COMPOSER_ATTACHMENT_TILE_SIZE_PX,
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label={ariaLabel}
            className={tileShellClassName(surface !== "text")}
            onClick={() => onOpen(attachment)}
            type="button"
          >
            {surface === "image" ? <ImageFace attachment={attachment} /> : null}
            {surface === "text" ? (
              <TextFace emptyFallbackLabel={pasteFallback} snippet={snippet} />
            ) : null}
            {surface === "file" ? <IconFace attachment={attachment} /> : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltipLabel}</TooltipContent>
      </Tooltip>

      <Button
        aria-label={t("terminal.composer.removeAttachment")}
        className={cn(
          "absolute -top-1 -right-1 z-20 size-4.5 rounded-full p-0",
          "border border-border bg-background text-foreground shadow-sm",
          "dark:bg-background dark:hover:bg-muted",
          "pointer-events-none opacity-0 transition-opacity duration-150",
          "focus-visible:pointer-events-auto focus-visible:opacity-100",
          "group-hover/att:pointer-events-auto group-hover/att:opacity-100",
          "hover:bg-muted hover:text-foreground"
        )}
        data-testid={`terminal-composer-attachment-remove-${ordinal}`}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(attachment.id);
        }}
        size="icon-xs"
        variant="outline"
      >
        <X aria-hidden="true" data-icon />
      </Button>
    </div>
  );
}
