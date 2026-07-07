import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import type { ReactNode } from "react";
import type { FilesDocument } from "./files-document-types.ts";
import type { FilesTranslate } from "./files-i18n.ts";

export function ReadOnlyErrorState({
  message,
  title,
  t,
}: {
  message: string;
  title: string;
  t: FilesTranslate;
}) {
  return (
    <div className="flex h-full flex-col gap-3 bg-background p-4">
      <h1 className="font-semibold text-foreground text-sm">{title}</h1>
      <Alert variant="destructive">
        <AlertTitle>
          {t("filePanel.errors.restore.title", "Unable to restore file panel")}
        </AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    </div>
  );
}

export function MissingTemporaryState({
  name,
  t,
}: {
  name: string;
  t: FilesTranslate;
}) {
  return (
    <div className="flex h-full flex-col gap-3 bg-background p-4">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-foreground text-sm">
            {name}
          </h1>
          <p className="text-muted-foreground text-xs">
            {t("filePanel.readOnly", "Read-only")}
          </p>
        </div>
      </div>
      <Alert>
        <AlertTitle>
          {t(
            "filePanel.temporary.missing.title",
            "Temporary file cannot be restored"
          )}
        </AlertTitle>
        <AlertDescription>
          {t(
            "filePanel.temporary.missing.description",
            "Temporary document contents are restored from the local draft cache when possible, and are released when the file panel closes."
          )}
        </AlertDescription>
      </Alert>
    </div>
  );
}

export function EmptyFileState({
  hasProjectTree,
  t,
}: {
  hasProjectTree: boolean;
  t: FilesTranslate;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-background p-6 text-center">
      <h1 className="font-semibold text-foreground text-sm">
        {t("filePanel.empty.title", "No file selected")}
      </h1>
      <p className="max-w-sm text-muted-foreground text-xs">
        {hasProjectTree
          ? t(
              "filePanel.empty.withTree.description",
              "Select a file from the project tree to open it in this tab."
            )
          : t(
              "filePanel.empty.noTree.description",
              "Open a file or a terminal Markdown preview to start editing."
            )}
      </p>
    </div>
  );
}

export function FilePanelShell({
  children,
  sidebar,
}: {
  children: ReactNode;
  sidebar: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 bg-background">
      {sidebar}
      <section className="min-w-0 flex-1">{children}</section>
    </div>
  );
}

export function StatusLabel({
  document,
  t,
}: {
  document: FilesDocument;
  t: FilesTranslate;
}) {
  if (document.source.kind === "untitled") {
    return (
      <span className="rounded-md border border-border bg-muted px-2 py-1 text-muted-foreground text-xs">
        {document.dirty
          ? t("filePanel.status.unsaved", "Unsaved changes")
          : t("filePanel.status.temporary", "Temporary file")}
      </span>
    );
  }

  if (document.loadState === "loading") {
    return (
      <span className="rounded-md border border-border bg-muted px-2 py-1 text-muted-foreground text-xs">
        {t("filePanel.status.loading", "Loading…")}
      </span>
    );
  }

  if (document.error) {
    return (
      <span className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-destructive text-xs">
        {t("filePanel.status.error", "Error")}
      </span>
    );
  }

  return (
    <span className="rounded-md border border-border bg-muted px-2 py-1 text-muted-foreground text-xs">
      {document.dirty
        ? t("filePanel.status.unsaved", "Unsaved changes")
        : t("filePanel.status.saved", "Saved")}
    </span>
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
