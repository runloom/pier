import { Button } from "@pier/ui/button.tsx";
import { cn } from "@pier/ui/utils.ts";
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileMusic,
  FileText,
  FileVideo,
  Folder,
  type LucideIcon,
  X,
} from "lucide-react";
import { openContentPreview } from "@/components/common/content-preview.ts";
import { useT } from "@/i18n/use-t.ts";
import type { ComposerAttachment } from "./terminal-composer-attachments-model.ts";

/**
 * Pick a Lucide file-type icon that matches the attachment's extension.
 * Falls back to the generic File icon for unknown extensions.
 */
function fileIconForName(name: string, isDirectory = false): LucideIcon {
  if (isDirectory) return Folder;
  const lower = name.toLowerCase();
  if (
    /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|heic|avif|raw|ico|psd|ai|sketch)$/.test(
      lower
    )
  ) {
    return FileImage;
  }
  if (
    /\.(zip|tar|gz|tgz|bz2?|xz|7z|rar|cab|iso|dmg|jar|war|pak|whl|egg)$/.test(
      lower
    )
  ) {
    return FileArchive;
  }
  if (
    /\.(mp[34]|wav|flac|aac|ogg|opus|m4a|amr|wma|aiff?|dsf|alac)$/.test(lower)
  ) {
    return FileAudio;
  }
  if (
    /\.(mp4|mov|avi|mkv|webm|flv|wmv|mpeg|mpg|m4v|3gp|vob|ogv)$/.test(lower)
  ) {
    return FileVideo;
  }
  if (/\.(md|txt|csv|log|rtf|pdf|tex|epub|pages|key|numbers)$/.test(lower)) {
    return FileText;
  }
  if (
    /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|go|rs|java|kt|kts|swift|c|cc|cpp|cxx|h|hpp|rb|php|sh|zsh|bash|fish|ps1|lua|pl|r|jl|ex|exs|erl|hs|ml|nim|v|dart|scala|clj|cljs|gradle|sbt|cs|fs|vb|elm|pas|f90|f95|f03)$/.test(
      lower
    )
  ) {
    return FileCode;
  }
  if (
    /\.(json|ya?ml|toml|xml|html?|css|scss|sass|less|styl|pcss|postcss|ini|conf|env|properties)$/.test(
      lower
    )
  ) {
    return FileText;
  }
  if (/\.(mid|midi|mod|s3m|xm|it|abc)$/.test(lower)) {
    return FileMusic;
  }
  return File;
}

function AttachmentTile({
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
  const preview = attachment.previewDataUrl;
  const FileIcon = fileIconForName(attachment.name, attachment.isDirectory);
  const isImage = attachment.kind === "image" && !attachment.isDirectory;

  return (
    <div
      className="group/att relative h-14 w-14 shrink-0"
      data-testid={`terminal-composer-attachment-${ordinal}`}
    >
      <button
        className={cn(
          "composer-attachment-surface relative size-full overflow-hidden rounded-lg",
          "border border-border/60 bg-muted/40 shadow-sm",
          "cursor-pointer transition-colors hover:bg-muted/60"
        )}
        onClick={() => onOpen(attachment)}
        type="button"
      >
        {preview && isImage ? (
          <img
            alt=""
            className="pointer-events-none size-full select-none object-cover"
            draggable={false}
            height={56}
            src={preview}
            // Chromium still starts HTML5 drag from images without this.
            style={{ WebkitUserDrag: "none" }}
            width={56}
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 p-1.5">
            <FileIcon
              aria-hidden="true"
              className="size-6 text-muted-foreground"
            />
            <span
              className={cn(
                "shrink-0 rounded bg-primary/10 px-1 font-mono text-[9px]",
                "font-semibold text-primary leading-none"
              )}
            >
              #{ordinal}
            </span>
          </div>
        )}

        {preview && isImage ? (
          <span
            className={cn(
              // Opaque badge — no backdrop-blur. Blur samples native/sash under
              // the translucent composer and leaves stale “history” frames.
              "pointer-events-none absolute bottom-1 left-1 rounded bg-primary/10 px-1",
              "font-mono font-semibold text-[9px] text-primary leading-none"
            )}
          >
            #{ordinal}
          </span>
        ) : null}
      </button>

      <Button
        aria-label={t("terminal.composer.removeAttachment")}
        className={cn(
          "absolute -top-1 -right-1 z-20 size-4.5 rounded-full p-0",
          "bg-background/80 text-muted-foreground shadow-sm",
          "opacity-0 transition-opacity duration-150",
          "focus-visible:opacity-100 group-hover/att:opacity-100",
          "hover:bg-muted hover:text-foreground"
        )}
        data-icon
        data-testid={`terminal-composer-attachment-remove-${ordinal}`}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(attachment.id);
        }}
        size="icon-xs"
        variant="ghost"
      >
        <X aria-hidden="true" className="size-2.5" />
      </Button>
    </div>
  );
}

export function TerminalComposerAttachmentRail({
  attachments,
  disabled,
  onRemove,
  onReveal,
}: {
  attachments: readonly ComposerAttachment[];
  disabled: boolean;
  onRemove: (id: string) => void;
  onReveal: (path: string) => void;
}) {
  const t = useT();

  if (attachments.length === 0) {
    return null;
  }

  const openAttachment = (attachment: ComposerAttachment) => {
    if (attachment.kind === "image" && !attachment.isDirectory) {
      openContentPreview({
        payload: {
          type: "image",
          source: { kind: "absolutePath", path: attachment.path },
          alt: attachment.name,
        },
        title: t("dialog.imagePreview.title"),
      });
      return;
    }
    onReveal(attachment.path);
  };

  return (
    <div
      className="flex w-full min-w-0 flex-wrap gap-2 pt-1 pr-1"
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
  );
}
