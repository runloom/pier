import { Button } from "@pier/ui/button.tsx";
import { ToggleGroup, ToggleGroupItem } from "@pier/ui/toggle-group.tsx";
import { ShieldCheck } from "lucide-react";
import { useCallback, useEffect } from "react";
import type { FileEditorController } from "./file-editor-controller.ts";
import {
  DocumentFormatBadge,
  DocumentStatusDot,
  LanguageBadge,
} from "./file-panel-status.tsx";
import type {
  FilesDocumentPanelSource,
  FileViewMode,
} from "./files-document-types.ts";
import type { FilesTranslate } from "./files-i18n.ts";
import { FilesMutationSuspendedError } from "./files-mutation-gate.ts";
import { useFilesDocument } from "./use-files-document.ts";

// 顶部 chrome 的右侧信息与视图集群：状态、语言、格式和视图切换。保存由
// Cmd+S、自动保存与关闭保护链负责，不在编辑区重复提供按钮。
export function ResolvedFilePanelActions({
  controller,
  mode,
  onModeChange,
  panelId,
  source,
  t,
}: {
  controller: FileEditorController;
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

  useEffect(() => {
    if (!panelId) {
      return;
    }
    return controller.registerPanelModeHandler(panelId, onModeChange);
  }, [controller, onModeChange, panelId]);

  if (!document) {
    return null;
  }
  if (document.preview || document.readOnlyReason === "binary") {
    return null;
  }

  const isMarkdown = document.language === "markdown";
  const showDiffToggle =
    mode === "diff" || document.conflictDiskContents !== null;

  return (
    <>
      <DocumentStatusDot
        document={document}
        onProtectionError={handleProtectionError}
        t={t}
      />
      <LanguageBadge document={document} t={t} />
      <DocumentFormatBadge document={document} />
      {isMarkdown || showDiffToggle ? (
        <ToggleGroup
          className="ml-1"
          onValueChange={(value) => {
            if (value) onModeChange(value as FileViewMode);
          }}
          size="sm"
          type="single"
          value={mode}
          variant="outline"
        >
          <ToggleGroupItem value="source">
            {t("filePanel.view.source", "Source")}
          </ToggleGroupItem>
          {isMarkdown ? (
            <ToggleGroupItem value="preview">
              {t("filePanel.view.preview", "Preview")}
            </ToggleGroupItem>
          ) : null}
          {showDiffToggle ? (
            <ToggleGroupItem value="diff">
              {t("filePanel.view.diff", "Diff")}
            </ToggleGroupItem>
          ) : null}
        </ToggleGroup>
      ) : null}
      {document.source.kind === "disk" && document.durabilityUnknown ? (
        <Button
          onClick={handleConfirmDurability}
          size="xs"
          type="button"
          variant="outline"
        >
          <ShieldCheck data-icon="inline-start" />
          {t("filePanel.durability.confirm", "Confirm write")}
        </Button>
      ) : null}
    </>
  );
}
