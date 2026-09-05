import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { PierDiffExcerpt } from "@pier/ui/diff-view/excerpt/index.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pier/ui/tabs.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { ArrowDown, ArrowUp, ExternalLink, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getDocument } from "../document/store.ts";
import type { FilesTranslate } from "../i18n.ts";
import { MarkdownChangeContent } from "./markdown/content.tsx";
import { openSavedFileChanges } from "./navigation.ts";
import type { FileChangesResource } from "./resource.ts";
import type { FileChangeRange, FileChangesSnapshot } from "./types.ts";

export function FileChangePeekContent({
  snapshot,
  index,
  context,
  resource,
  panelContext,
  height,
  framed,
  mode = "source",
  t,
  onClose,
  onMove,
}: {
  snapshot: FileChangesSnapshot;
  index: number | null;
  context: RendererPluginContext;
  resource: FileChangesResource;
  panelContext: PanelContext | undefined;
  height: number;
  framed: boolean;
  mode?: "preview" | "source";
  t: FilesTranslate;
  onClose: (restore?: boolean) => void;
  onMove: (direction: "next" | "previous") => void;
}) {
  const [reviewBusy, setReviewBusy] = useState(false);
  const [saveFirst, setSaveFirst] = useState(false);
  const [failedRange, setFailedRange] = useState<FileChangeRange | null>(null);
  const [view, setView] = useState<"preview" | "source">("preview");
  useEffect(() => {
    if (!snapshot.dirty) {
      setSaveFirst(false);
      setReviewBusy(false);
      return;
    }
    if (!context.git.getStatus) return;
    const document = getDocument(resource.documentId);
    if (document?.source.kind !== "disk") return;
    const path = snapshot.path ?? document.source.path;
    let active = true;
    setReviewBusy(true);
    context.git
      .getStatus(snapshot.gitRoot ?? document.source.root)
      .then((status) => {
        if (active)
          setSaveFirst(!status.files.some((file) => file.path === path));
      })
      .catch(() => {
        // Opportunistic preflight only. The explicit review action reads again
        // and reports any technical failure through the host dialog facade.
      })
      .finally(() => {
        if (active) setReviewBusy(false);
      });
    return () => {
      active = false;
    };
  }, [
    context.git,
    resource.documentId,
    snapshot.dirty,
    snapshot.gitRoot,
    snapshot.path,
  ]);
  const [appearance, setAppearance] = useState(() =>
    context.appearance.current()
  );
  useEffect(
    () => context.appearance.onDidChange(setAppearance),
    [context.appearance]
  );
  const range = index === null ? undefined : snapshot.ranges[index];
  const renderError = Boolean(range && failedRange === range);
  const reportRenderError = useCallback(
    () => setFailedRange(range ?? null),
    [range]
  );
  const viewSaved = async () => {
    const document = getDocument(resource.documentId);
    const base = panelContext ?? context.panels.getActiveContext();
    if (document?.source.kind !== "disk" || !base) return;
    setReviewBusy(true);
    try {
      const result = await openSavedFileChanges({
        context,
        panelContext: base,
        root: snapshot.gitRoot ?? document.source.root,
        path: snapshot.path ?? document.source.path,
        snapshot,
        range,
      });
      if (result === "opened") onClose();
      else if (result === "save-first") setSaveFirst(true);
      else
        context.notifications.error(
          t(
            "filePanel.changes.reviewUnavailable",
            "No saved changes to review."
          )
        );
    } catch (error) {
      await context.dialogs.alert({
        title: t("filePanel.changes.reviewFailed", "Couldn't open changes"),
        body: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setReviewBusy(false);
    }
  };
  const reviewLabel = snapshot.dirty
    ? t("filePanel.changes.savedReview", "View saved changes")
    : t("filePanel.changes.fullReview", "Open full review");
  let statusText = t(
    "filePanel.changes.failed",
    "Couldn't compare changes. Try again."
  );
  if (snapshot.status === "loading" || snapshot.status === "updating")
    statusText = t("filePanel.changes.loading", "Comparing changes…");
  else if (snapshot.status === "ready" && !renderError)
    statusText = t("filePanel.changes.empty", "No changes compared with HEAD.");
  else if (snapshot.status === "on-demand")
    statusText = t(
      "filePanel.changes.onDemand",
      "This file is large. Compare it when needed."
    );
  const baseline = snapshot.dirty
    ? `${t("filePanel.changes.unsaved", "HEAD → current content · includes unsaved edits")} ${saveFirst ? t("filePanel.changes.saveFirst", "Save the file first") : t("filePanel.changes.savedOnly", "Full review includes saved changes only.")}`
    : t("filePanel.changes.baseline", "HEAD → current content");
  const sourceDiff = range ? (
    <PierDiffExcerpt
      appearance={{
        codeFontFamily: appearance.typography.codeFontFamily,
        codeFontSize: appearance.typography.codeFontSize,
        codeThemes: appearance.codeThemes,
        colorMode: appearance.theme,
      }}
      fileDiff={range.excerpt}
      maxHeight={height}
      onError={reportRenderError}
    />
  ) : null;
  const renderedDiff =
    range && mode === "preview" && view === "preview" ? (
      <MarkdownChangeContent
        appearance={appearance}
        context={context}
        fallback={sourceDiff}
        height={height}
        key={range.id}
        owner={resource}
        panelContext={panelContext}
        range={range}
        snapshot={snapshot}
        t={t}
      />
    ) : (
      sourceDiff
    );
  const body =
    range && !renderError ? (
      renderedDiff
    ) : (
      <div
        className="flex flex-col items-start gap-2 p-3 text-sm"
        role="status"
      >
        {statusText}
        {snapshot.status === "loading" ||
        snapshot.status === "updating" ||
        (snapshot.status === "ready" && !renderError) ? null : (
          <Button
            onClick={() => {
              setFailedRange(null);
              resource.calculate();
            }}
            variant="outline"
          >
            {t("filePanel.changes.retry", "Compare again")}
          </Button>
        )}
      </div>
    );
  const peek = (
    <section
      aria-description={baseline}
      aria-label={t("filePanel.changes.preview", "Change preview")}
      className={cn(
        "min-w-0 overflow-hidden bg-background font-sans text-foreground",
        framed && "rounded-md border border-border/70"
      )}
      data-slot="file-change-peek"
    >
      <div
        aria-label={t("filePanel.changes.preview", "Change preview")}
        className="flex flex-wrap items-center gap-2 border-border/60 border-b bg-muted/30 px-2 py-1"
        data-slot="file-change-peek-toolbar"
        role="toolbar"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
          {range && snapshot.ranges.length > 1 ? (
            <span aria-live="polite" className="shrink-0 text-xs tabular-nums">
              {`${(index ?? 0) + 1} / ${snapshot.ranges.length}`}
            </span>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="min-w-0 truncate text-muted-foreground text-xs">
                {t("filePanel.changes.baseline", "HEAD → current content")}
              </span>
            </TooltipTrigger>
            <TooltipContent>{baseline}</TooltipContent>
          </Tooltip>
          {snapshot.dirty ? (
            <Badge variant="outline">
              {t("filePanel.changes.unsavedLabel", "Unsaved")}
            </Badge>
          ) : null}
        </div>
        {mode === "preview" ? (
          <TabsList
            aria-label={t("filePanel.changes.display", "Change display")}
            variant="line"
          >
            <TabsTrigger className="text-xs" value="preview">
              {t("filePanel.changes.rendered", "Preview")}
            </TabsTrigger>
            <TabsTrigger className="text-xs" value="source">
              {t("filePanel.changes.source", "Source")}
            </TabsTrigger>
          </TabsList>
        ) : null}
        <div className="flex shrink-0 items-center gap-0.5">
          {snapshot.ranges.length > 1 ? (
            <>
              <PeekButton
                disabled={index === null || index === 0}
                label={t("filePanel.changes.previous", "Previous change")}
                onClick={() => onMove("previous")}
              >
                <ArrowUp data-icon />
              </PeekButton>
              <PeekButton
                disabled={index === null || index >= snapshot.ranges.length - 1}
                label={t("filePanel.changes.next", "Next change")}
                onClick={() => onMove("next")}
              >
                <ArrowDown data-icon />
              </PeekButton>
            </>
          ) : null}
          <PeekButton
            disabled={reviewBusy || saveFirst}
            label={
              saveFirst
                ? t("filePanel.changes.saveFirst", "Save the file first")
                : reviewLabel
            }
            onClick={() => {
              viewSaved();
            }}
          >
            <ExternalLink data-icon />
          </PeekButton>
          <PeekButton
            label={t("filePanel.changes.close", "Close preview")}
            onClick={() => onClose(true)}
          >
            <X data-icon />
          </PeekButton>
        </div>
      </div>
      {mode === "preview" ? (
        <TabsContent className="min-h-0" key={view} tabIndex={-1} value={view}>
          {body}
        </TabsContent>
      ) : (
        body
      )}
    </section>
  );
  return mode === "preview" ? (
    <Tabs
      asChild
      className="gap-0"
      onValueChange={(next) => {
        if (next === "preview" || next === "source") setView(next);
      }}
      value={view}
    >
      {peek}
    </Tabs>
  ) : (
    peek
  );
}
function PeekButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          size="icon"
          tone="muted"
          variant="ghost"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
