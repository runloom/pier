import { Button } from "@pier/ui/button.tsx";
import { cn } from "@pier/ui/utils.ts";
import { useSyncExternalStore } from "react";
import { LANGUAGE_LABELS } from "./cm-language.ts";
import {
  type FilesDraftProtectionState,
  subscribeFilesDraftProtection,
} from "./files-document-drafts.ts";
import type { FilesDocument } from "./files-document-types.ts";
import { filesDraftProtectionForDocument } from "./files-draft-protection.ts";
import type { FilesTranslate } from "./files-i18n.ts";

export function DocumentStatusDot({
  document,
  onProtectionError,
  t,
}: {
  document: FilesDocument;
  onProtectionError: (message: string) => void;
  t: FilesTranslate;
}) {
  const protection = useDraftProtection(document);
  const { label, tone } = statusToneForDocument(document, protection, t);
  if (protection.status === "failed") {
    return (
      <button
        aria-label={label}
        className={cn("size-2 rounded-full", tone)}
        onClick={() => onProtectionError(protection.message)}
        title={`${label}: ${protection.message}`}
        type="button"
      />
    );
  }
  return (
    <span
      aria-label={label}
      className={cn("size-1.5 rounded-full", tone)}
      role="status"
      title={label}
    />
  );
}

export function LanguageBadge({
  document,
  t,
}: {
  document: FilesDocument;
  t: FilesTranslate;
}) {
  const label = LANGUAGE_LABELS[document.language] ?? LANGUAGE_LABELS.text;
  return (
    <span
      className="rounded-md border border-transparent px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground uppercase tracking-wide"
      data-language={document.language}
    >
      {label}
      <StatusLabel document={document} hidden t={t} />
    </span>
  );
}

export function DocumentFormatBadge({ document }: { document: FilesDocument }) {
  if (!(document.format && document.eol)) {
    return null;
  }
  const encoding = formatEncodingLabel(document.format);
  const eol = document.eol === "none" ? "—" : document.eol.toUpperCase();
  return (
    <span className="rounded-md px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
      {encoding} · {eol}
    </span>
  );
}

function formatEncodingLabel(
  format: NonNullable<FilesDocument["format"]>
): string {
  if (format.encoding === "utf8") {
    return format.bom ? "UTF-8 BOM" : "UTF-8";
  }
  return format.encoding === "utf16le" ? "UTF-16 LE" : "UTF-16 BE";
}

export function StatusLabel({
  document,
  hidden = false,
  t,
}: {
  document: FilesDocument;
  hidden?: boolean;
  t: FilesTranslate;
}) {
  const protection = useDraftProtection(document);
  const text = statusTextForDocument(document, protection, t);
  const className = hidden
    ? "sr-only"
    : "ml-1 rounded-md border border-border bg-muted px-2 py-1 text-muted-foreground text-xs";
  return <span className={className}>{text}</span>;
}

function statusTextForDocument(
  document: FilesDocument,
  protection: FilesDraftProtectionState,
  t: FilesTranslate
): string {
  if (protection.status === "protecting") {
    return t("filePanel.status.protecting", "Protecting…");
  }
  if (protection.status === "failed") {
    return t("filePanel.status.protectionFailed", "Not protected");
  }
  if (protection.status === "protected" && document.dirty) {
    return t("filePanel.status.protected", "Protected");
  }
  if (document.durabilityUnknown) {
    return t(
      "filePanel.status.durabilityUnknown",
      "Written; durability unknown"
    );
  }
  if (document.deletedOnDisk) {
    return t("filePanel.status.deletedOnDisk", "Deleted on disk");
  }
  if (document.source.kind === "untitled") {
    return document.dirty
      ? t("filePanel.status.unsaved", "Unsaved changes")
      : t("filePanel.status.temporary", "Temporary file");
  }
  if (document.loadState === "loading") {
    return t("filePanel.status.loading", "Loading…");
  }
  if (document.saveState === "saving") {
    return t("filePanel.status.saving", "Saving…");
  }
  if (document.error) {
    return t("filePanel.status.error", "Error");
  }
  return document.dirty
    ? t("filePanel.status.unsaved", "Unsaved changes")
    : t("filePanel.status.saved", "Saved");
}

function statusToneForDocument(
  document: FilesDocument,
  protection: FilesDraftProtectionState,
  t: FilesTranslate
): { label: string; tone: string } {
  if (protection.status === "failed") {
    return {
      label: t("filePanel.status.protectionFailed", "Not protected"),
      tone: "bg-destructive",
    };
  }
  if (protection.status === "protecting") {
    return {
      label: t("filePanel.status.protecting", "Protecting…"),
      tone: "bg-info animate-pulse",
    };
  }
  if (protection.status === "protected" && document.dirty) {
    return {
      label: t("filePanel.status.protected", "Protected"),
      tone: "bg-success",
    };
  }
  if (document.durabilityUnknown) {
    return {
      label: t(
        "filePanel.status.durabilityUnknown",
        "Written; durability unknown"
      ),
      tone: "bg-warning",
    };
  }
  if (document.deletedOnDisk) {
    return {
      label: t("filePanel.status.deletedOnDisk", "Deleted on disk"),
      tone: "bg-warning",
    };
  }
  if (document.error) {
    return {
      label: t("filePanel.status.error", "Error"),
      tone: "bg-destructive",
    };
  }
  if (document.loadState === "loading") {
    return {
      label: t("filePanel.status.loading", "Loading…"),
      tone: "bg-info animate-pulse",
    };
  }
  if (document.saveState === "saving") {
    return {
      label: t("filePanel.status.saving", "Saving…"),
      tone: "bg-info animate-pulse",
    };
  }
  if (document.dirty) {
    return {
      label: t("filePanel.status.unsaved", "Unsaved changes"),
      tone: "bg-warning",
    };
  }
  if (document.source.kind === "untitled") {
    return {
      label: t("filePanel.status.temporary", "Temporary file"),
      tone: "bg-muted-foreground",
    };
  }
  return {
    label: t("filePanel.status.saved", "Saved"),
    tone: "bg-success",
  };
}

function useDraftProtection(
  document: FilesDocument
): FilesDraftProtectionState {
  return useSyncExternalStore(
    subscribeFilesDraftProtection,
    () => filesDraftProtectionForDocument(document),
    () => filesDraftProtectionForDocument(document)
  );
}

export function ViewModeButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-pressed={active}
      onClick={onClick}
      size="xs"
      type="button"
      variant={active ? "secondary" : "ghost"}
    >
      {children}
    </Button>
  );
}
