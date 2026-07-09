import { Button } from "@pier/ui/button.tsx";
import { Save } from "lucide-react";
import { useCallback, useEffect } from "react";
import type { FileEditorController } from "./file-editor-controller.ts";
import {
  DocumentStatusDot,
  LanguageBadge,
  ViewModeButton,
} from "./file-panel-status.tsx";
import type {
  FilesDocumentPanelSource,
  FileViewMode,
} from "./files-document-types.ts";
import type { FilesTranslate } from "./files-i18n.ts";
import { useFilesDocument } from "./use-files-document.ts";

// 顶部 chrome 的右侧 action 集群:状态圆点 + language 标签 + mode 切换(仅
// markdown) + Save。逻辑收在专门组件里,是因为需要拿当前 document 才知道
// save 是否 enabled、是否 markdown 等信息;chrome 布局代码只负责摆位置,
// 不重复业务判断。
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

  const canSave =
    document?.source.kind === "disk" &&
    document.capabilities.includes("save") &&
    document.dirty &&
    !document.readOnly &&
    document.loadState === "loaded" &&
    document.saveState === "idle";

  const handleSave = useCallback(async () => {
    if (!(canSave && document)) {
      return;
    }
    await controller.saveDocument(document.id, panelId);
  }, [canSave, controller, document, panelId]);

  useEffect(() => {
    if (!panelId) {
      return;
    }
    return controller.registerPanelModeHandler(panelId, onModeChange);
  }, [controller, onModeChange, panelId]);

  if (!document) {
    return null;
  }

  const isMarkdown = document.language === "markdown";
  const showDiffToggle =
    mode === "diff" || document.conflictDiskContents !== null;

  return (
    <>
      <DocumentStatusDot document={document} t={t} />
      <LanguageBadge document={document} t={t} />
      {isMarkdown || showDiffToggle ? (
        <div className="ml-1 flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
          <ViewModeButton
            active={mode === "source"}
            onClick={() => onModeChange("source")}
          >
            {t("filePanel.view.source", "Source")}
          </ViewModeButton>
          {isMarkdown ? (
            <ViewModeButton
              active={mode === "preview"}
              onClick={() => onModeChange("preview")}
            >
              {t("filePanel.view.preview", "Preview")}
            </ViewModeButton>
          ) : null}
          {showDiffToggle ? (
            <ViewModeButton
              active={mode === "diff"}
              onClick={() => onModeChange("diff")}
            >
              {t("filePanel.view.diff", "Diff")}
            </ViewModeButton>
          ) : null}
        </div>
      ) : null}
      {document.source.kind === "disk" ? (
        <Button
          disabled={!canSave}
          onClick={handleSave}
          size="xs"
          type="button"
          variant="outline"
        >
          <Save data-icon="inline-start" />
          {t("filePanel.save", "Save")}
        </Button>
      ) : null}
    </>
  );
}
