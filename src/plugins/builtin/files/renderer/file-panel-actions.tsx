import { Button } from "@pier/ui/button.tsx";
import type { PluginConfigurationApi } from "@plugins/api/configuration.ts";
import { Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  FILES_AUTO_SAVE_DELAY_MS,
  FILES_AUTO_SAVE_SETTING_KEY,
} from "../settings.ts";
import { type FilePanelFilesApi, useDocumentId } from "./file-panel-hooks.ts";
import {
  type FileConflictChoice,
  saveDiskDocument,
} from "./file-panel-save.ts";
import { registerFilePanelSave } from "./file-panel-save-registry.ts";
import {
  DocumentStatusDot,
  LanguageBadge,
  ViewModeButton,
} from "./file-panel-status.tsx";
import { useFilesDocument } from "./files-document-store.ts";
import type {
  FilesDocumentPanelSource,
  FileViewMode,
} from "./files-document-types.ts";
import type { FilesTranslate } from "./files-i18n.ts";

// 顶部 chrome 的右侧 action 集群:状态圆点 + language 标签 + mode 切换(仅
// markdown) + Save。逻辑收在专门组件里,是因为需要拿当前 document 才知道
// save 是否 enabled、是否 markdown 等信息;chrome 布局代码只负责摆位置,
// 不重复业务判断。
export function ResolvedFilePanelActions({
  configuration,
  files,
  mode,
  onModeChange,
  onSavingChange,
  panelId,
  resolveConflict,
  saving,
  source,
  t,
}: {
  configuration?: PluginConfigurationApi;
  files: FilePanelFilesApi | undefined;
  mode: FileViewMode;
  onModeChange: (mode: FileViewMode) => void;
  onSavingChange: (saving: boolean) => void;
  panelId: string | undefined;
  resolveConflict?: () => Promise<FileConflictChoice>;
  saving: boolean;
  source: FilesDocumentPanelSource;
  t: FilesTranslate;
}) {
  const documentId = useDocumentId(source);
  const document = useFilesDocument(documentId ?? "");

  const canSave =
    document?.source.kind === "disk" &&
    document.capabilities.includes("save") &&
    document.dirty &&
    !document.readOnly &&
    document.loadState === "loaded" &&
    !saving;

  const handleSave = useCallback(async () => {
    if (!(canSave && document)) {
      return;
    }
    await saveDiskDocument({
      documentId: document.id,
      files,
      onModeChange,
      onSavingChange,
      ...(resolveConflict ? { resolveConflict } : {}),
      t,
    });
  }, [
    canSave,
    document,
    files,
    onModeChange,
    onSavingChange,
    resolveConflict,
    t,
  ]);

  // Cmd+S 走宿主 keybinding → pier.files.save action → activeInstanceId 查
  // 本注册表命中此 fn。unmount 或 panelId 变更时旧闭包清理,防止 stale save
  // 覆盖新 doc。
  useEffect(() => {
    if (!panelId) {
      return;
    }
    return registerFilePanelSave(panelId, handleSave);
  }, [handleSave, panelId]);

  // autoSave afterDelay(默认关):最后一次编辑 1s 后自动保存。冲突场景
  // (外部改动 + expectedMtimeMs 不符)仍会弹 覆盖/对比/取消,不静默覆盖。
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(
    () => configuration?.get<boolean>(FILES_AUTO_SAVE_SETTING_KEY) === true
  );
  useEffect(() => {
    if (!configuration) {
      return;
    }
    setAutoSaveEnabled(
      configuration.get<boolean>(FILES_AUTO_SAVE_SETTING_KEY) === true
    );
    return configuration.onDidChange((event) => {
      if (event.affectsConfiguration(FILES_AUTO_SAVE_SETTING_KEY)) {
        setAutoSaveEnabled(
          configuration.get<boolean>(FILES_AUTO_SAVE_SETTING_KEY) === true
        );
      }
    });
  }, [configuration]);
  const documentContents = document?.currentContents;
  // documentContents 不在 effect 体内使用,但它是「最后一次编辑」的重置信号:
  // 每次输入都重排 1s 定时器(afterDelay 语义)。
  // biome-ignore lint/correctness/useExhaustiveDependencies: documentContents 是刻意的 debounce 重置依赖。
  useEffect(() => {
    if (!(autoSaveEnabled && canSave)) {
      return;
    }
    const timer = setTimeout(() => {
      handleSave().catch(() => undefined);
    }, FILES_AUTO_SAVE_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [autoSaveEnabled, canSave, documentContents, handleSave]);

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
