import { Button } from "@pier/ui/button.tsx";
import { cn } from "@pier/ui/utils.ts";
import { LANGUAGE_LABELS } from "./cm-language.ts";
import type { FilesDocument } from "./files-document-types.ts";
import type { FilesTranslate } from "./files-i18n.ts";

export function DocumentStatusDot({
  document,
  t,
}: {
  document: FilesDocument;
  t: FilesTranslate;
}) {
  const { label, tone } = statusToneForDocument(document, t);
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

export function StatusLabel({
  document,
  hidden = false,
  t,
}: {
  document: FilesDocument;
  hidden?: boolean;
  t: FilesTranslate;
}) {
  const text = statusTextForDocument(document, t);
  const className = hidden
    ? "sr-only"
    : "ml-1 rounded-md border border-border bg-muted px-2 py-1 text-muted-foreground text-xs";
  return <span className={className}>{text}</span>;
}

function statusTextForDocument(
  document: FilesDocument,
  t: FilesTranslate
): string {
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
  t: FilesTranslate
): { label: string; tone: string } {
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
