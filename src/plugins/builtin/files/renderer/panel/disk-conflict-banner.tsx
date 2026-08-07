import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FilesDocument } from "../document/types.ts";
import { noteFilesHangBreadcrumb } from "../hang-breadcrumb.ts";
import type { FilesTranslate } from "../i18n.ts";

/** Initial soft peek; “Show more” reveals up to the expanded cap. */
const LOCAL_PEEK_INITIAL_CHARS = 1200;
const LOCAL_PEEK_EXPANDED_CHARS = 12_000;

/**
 * Open-document disk conflict decision UI.
 *
 * Default: full-panel Empty (same shell as unsupported / missing file states).
 * Diff mode: compact chrome above the compare view so the user can still
 * load disk or keep local edits after comparing.
 *
 * Empty still shows a read-only peek of dirty local contents so users can
 * recognize their edits before Load vs Keep (especially when Compare is
 * unavailable). Expand when the buffer exceeds the initial soft cap.
 */
export function FileDiskConflictState({
  canCompare,
  document,
  onCompare,
  onDismiss,
  onLoadDisk,
  t,
  variant = "empty",
}: {
  canCompare: boolean;
  document: FilesDocument;
  onCompare: () => void;
  onDismiss: () => void;
  onLoadDisk: () => void;
  t: FilesTranslate;
  variant?: "diff-chrome" | "empty";
}) {
  const [peekExpanded, setPeekExpanded] = useState(false);
  const pathHint =
    document.source.kind === "disk" ? document.source.path : document.name;

  // Hang trail: enter conflict Empty / chrome (once per path/variant/dirty).
  useEffect(() => {
    noteFilesHangBreadcrumb({
      kind: "files-conflict",
      phase: "state",
      path: pathHint,
      dirty: document.dirty,
      diskConflict: true,
      deletedOnDisk: document.deletedOnDisk,
      detail: variant === "empty" ? "empty-state" : "diff-chrome",
      mode: variant === "diff-chrome" ? "diff" : undefined,
    });
  }, [document.deletedOnDisk, document.dirty, pathHint, variant]);

  const peekBudget = peekExpanded
    ? LOCAL_PEEK_EXPANDED_CHARS
    : LOCAL_PEEK_INITIAL_CHARS;

  const localPeek = useMemo(() => {
    if (!(document.dirty && document.currentContents.length > 0)) {
      return null;
    }
    const raw = document.currentContents;
    if (raw.length <= peekBudget) {
      return { text: raw, truncated: false, total: raw.length };
    }
    return {
      text: `${raw.slice(0, peekBudget)}…`,
      truncated: true,
      total: raw.length,
    };
  }, [document.currentContents, document.dirty, peekBudget]);

  const title = t("filePanel.conflict.bannerTitle", "File changed on disk");
  const body = canCompare
    ? t(
        "filePanel.conflict.bannerBodyWithCompare",
        "This file was modified outside Pier. Keep your edits, load the disk version, or compare the differences."
      )
    : t(
        "filePanel.conflict.bannerBody",
        "This file was modified outside Pier. Keep your edits, or load the disk version."
      );

  const actions = (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button onClick={onLoadDisk} type="button" variant="default">
        {t("filePanel.conflict.loadDiskLabel", "Load disk version")}
      </Button>
      <Button onClick={onDismiss} type="button" variant="outline">
        {t("filePanel.conflict.keepLocalLabel", "Keep my edits")}
      </Button>
      {canCompare ? (
        <Button onClick={onCompare} type="button" variant="outline">
          {t("filePanel.conflict.compareLabel", "Compare")}
        </Button>
      ) : null}
    </div>
  );

  if (variant === "diff-chrome") {
    return (
      <div
        className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3"
        data-slot="file-disk-conflict-chrome"
        data-testid="file-disk-conflict-chrome"
      >
        <div className="min-w-0 text-left">
          <p className="font-medium text-sm">{title}</p>
          <p className="text-muted-foreground text-xs">{document.name}</p>
        </div>
        {actions}
      </div>
    );
  }

  return (
    <Empty
      className="min-h-0 border-0"
      data-slot="file-disk-conflict-state"
      data-testid="file-disk-conflict-state"
    >
      <h1 className="sr-only">{document.name}</h1>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlert />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {actions}
        <p className="font-mono text-muted-foreground text-xs">
          {document.name}
        </p>
        {localPeek === null ? null : (
          <div
            className="mt-1 w-full max-w-lg text-left"
            data-testid="file-disk-conflict-local-peek"
          >
            <p className="mb-1 text-muted-foreground text-xs">
              {t("filePanel.conflict.localPeekLabel", "Your unsaved edits")}
            </p>
            <pre className="max-h-[min(50vh,24rem)] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono text-foreground text-xs">
              {localPeek.text}
            </pre>
            {localPeek.truncated && !peekExpanded ? (
              <Button
                className="mt-2"
                onClick={() => {
                  setPeekExpanded(true);
                }}
                type="button"
                variant="ghost"
              >
                {t("filePanel.conflict.localPeekShowMore", "Show more")}
              </Button>
            ) : null}
            {peekExpanded &&
            document.currentContents.length > LOCAL_PEEK_EXPANDED_CHARS ? (
              <p className="mt-1 text-muted-foreground text-xs">
                {t(
                  "filePanel.conflict.localPeekTruncatedHint",
                  "Preview only — Keep my edits restores the full buffer."
                )}
              </p>
            ) : null}
          </div>
        )}
      </EmptyContent>
    </Empty>
  );
}

/** @deprecated Prefer FileDiskConflictState. */
export const FileDiskConflictBanner = FileDiskConflictState;
