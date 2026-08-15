import { Button } from "@pier/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  isProjectCanvasPath,
  liveModuleProjectContentDirectories,
  projectCanvasLocation,
} from "@shared/live-module-canvas-path.ts";
import { Code2, Eye, ShieldCheck } from "lucide-react";
import { useCallback } from "react";
import type {
  FilesDocumentPanelSource,
  FileViewMode,
} from "../document/types.ts";
import { useFilesDocument } from "../document/use-document.ts";
import type { FileEditorController } from "../editor/controller.ts";
import type { FilesTranslate } from "../i18n.ts";
import { FilesMutationSuspendedError } from "../mutation/gate.ts";
import { CanvasCommentsButton } from "../preview/canvas-comments-button.tsx";
import { CanvasReloadButton } from "../preview/canvas-toolbar.tsx";
import {
  DocumentFormatBadge,
  DocumentStatusDot,
  LanguageBadge,
  LanguageServiceStatus,
} from "./status.tsx";

// 顶部 chrome 的右侧信息与视图集群：状态、语言、格式和视图切换。保存由
// Cmd+S、自动保存与关闭保护链负责，不在编辑区重复提供按钮。
// Markdown 分屏预览不走 panel 内 split：用 dockview 多 panel 分屏即可。
export function ResolvedFilePanelActions({
  context,
  editorSessionId,
  controller,
  mode,
  onModeChange,
  panelId,
  source,
  t,
}: {
  context?: RendererPluginContext | undefined;
  controller: FileEditorController;
  editorSessionId: string;
  mode: FileViewMode;
  onModeChange: (mode: FileViewMode) => void;
  panelId: string | undefined;
  source: FilesDocumentPanelSource;
  t: FilesTranslate;
}) {
  const documentId = controller.documentId(source);
  const document = useFilesDocument(documentId);

  const handleConfirmDurability = useCallback(async () => {
    if (!document?.durabilityUnknown) {
      return;
    }
    try {
      await controller.runMutation(() =>
        controller.confirmDocumentDurability(document.id)
      );
    } catch (error) {
      if (!(error instanceof FilesMutationSuspendedError)) {
        throw error;
      }
    }
  }, [controller, document]);

  const handleProtectionError = useCallback(
    (message: string) => {
      controller.showDraftProtectionError(message).catch(() => undefined);
    },
    [controller]
  );

  // Mode handler (with markdown content-anchor capture) is registered by
  // ResolvedFilePanel so Eye/Code and showSourceMode share one path.

  if (!document) {
    return null;
  }
  if (document.preview || document.readOnlyReason === "binary") {
    return null;
  }

  const diskRoot =
    document.source.kind === "disk" ? document.source.root : null;
  const contentDirectories = diskRoot
    ? liveModuleProjectContentDirectories(diskRoot)
    : undefined;
  const supportsPreview =
    document.language === "markdown" ||
    document.language === "canvas" ||
    (document.source.kind === "disk" &&
      isProjectCanvasPath(document.source.path, contentDirectories));
  const isCanvas =
    document.language === "canvas" ||
    (document.source.kind === "disk" &&
      isProjectCanvasPath(document.source.path, contentDirectories));
  const canvasRelPath =
    source.kind === "disk"
      ? (projectCanvasLocation(
          source.path,
          liveModuleProjectContentDirectories(source.root)
        )?.relPath ?? null)
      : null;
  const showDiffToggle =
    mode === "diff" || document.conflictDiskContents !== null;
  const canvasCommentPath =
    document.source.kind === "disk" ? document.source.path : null;
  const showCanvasComments =
    isCanvas && mode === "preview" && canvasCommentPath !== null;

  return (
    <>
      <DocumentStatusDot
        document={document}
        onProtectionError={handleProtectionError}
        t={t}
      />
      <LanguageBadge
        context={context}
        controller={controller}
        document={document}
        onLanguageApplied={(language) => {
          if (
            mode === "preview" &&
            language !== "markdown" &&
            language !== "canvas"
          ) {
            if (panelId) {
              controller.setPanelMode(panelId, "source");
              return;
            }
            onModeChange("source");
          }
        }}
        t={t}
      />
      <LanguageServiceStatus
        documentId={document.id}
        ownerId={editorSessionId}
        t={t}
      />
      <DocumentFormatBadge
        context={context}
        controller={controller}
        document={document}
        t={t}
      />
      {/* Canvas preview: annotate → reload → source toggle. */}
      {showCanvasComments && canvasCommentPath ? (
        <CanvasCommentsButton path={canvasCommentPath} t={t} />
      ) : null}
      {isCanvas && mode === "preview" && canvasRelPath ? (
        <CanvasReloadButton moduleId={canvasRelPath} t={t} />
      ) : null}
      {supportsPreview ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={
                mode === "preview"
                  ? t("filePanel.view.switchToSource", "Switch to source")
                  : t("filePanel.view.switchToPreview", "Switch to preview")
              }
              className={
                // Spacing: first control after format badge when no canvas tools.
                showCanvasComments || (isCanvas && mode === "preview")
                  ? undefined
                  : "ml-1"
              }
              onClick={() => {
                const next = mode === "preview" ? "source" : "preview";
                if (panelId) {
                  controller.setPanelMode(panelId, next);
                  return;
                }
                onModeChange(next);
              }}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              {mode === "preview" ? (
                <Code2 data-icon="inline-start" />
              ) : (
                <Eye data-icon="inline-start" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {mode === "preview"
              ? t("filePanel.view.switchToSource", "Switch to source")
              : t("filePanel.view.switchToPreview", "Switch to preview")}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {showDiffToggle ? (
        <Button
          aria-label={t("filePanel.view.diff", "Diff")}
          className="ml-1"
          onClick={() => {
            const next = mode === "diff" ? "source" : "diff";
            if (panelId) {
              controller.setPanelMode(panelId, next);
              return;
            }
            onModeChange(next);
          }}
          size="xs"
          type="button"
          variant={mode === "diff" ? "secondary" : "ghost"}
        >
          {t("filePanel.view.diff", "Diff")}
        </Button>
      ) : null}
      {document.source.kind === "disk" && document.durabilityUnknown ? (
        <Button
          onClick={handleConfirmDurability}
          size="xs"
          type="button"
          variant="outline"
        >
          <ShieldCheck data-icon="inline-start" />
          {t("filePanel.durability.confirm", "Confirm saved")}
        </Button>
      ) : null}
    </>
  );
}
