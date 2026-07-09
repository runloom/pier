import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useEffect, useMemo } from "react";
import {
  ensureDiskDocument,
  getDocument,
  markDocumentError,
  markDocumentLoaded,
  markDocumentLoading,
  removeDocument,
  restoreUntitledDocumentFromPanelSource,
} from "./files-document-store.ts";
import type {
  FilesDocument,
  FilesDocumentPanelSource,
} from "./files-document-types.ts";
import type { FilesTranslate } from "./files-i18n.ts";

export type FilePanelFilesApi = Pick<
  RendererPluginContext["files"],
  "readText" | "stat" | "writeText"
>;

export const MAX_EDITABLE_FILE_BYTES = 10 * 1024 * 1024;

// 抽出的错误消息 fallback。异常路径都调这个,保持文案与 t() key 一致,方便 i18n。
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
}

function commandErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  if (!("code" in error)) {
    return null;
  }
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function isFileConflictError(error: unknown): boolean {
  return commandErrorCode(error) === "file_conflict";
}

export function useDocumentId(
  source: FilesDocumentPanelSource | null
): string | null {
  return useMemo(() => {
    if (!source) {
      return null;
    }
    if (source.kind === "untitled") {
      return source.id;
    }
    return ensureDiskDocument({ path: source.path, root: source.root }).id;
  }, [source]);
}

export function useRestoreUntitledDocument(
  source: FilesDocumentPanelSource | null
): void {
  useEffect(() => {
    if (source?.kind !== "untitled") {
      return;
    }
    restoreUntitledDocumentFromPanelSource(source);
  }, [source]);
}

// disk 文档首次进入 idle 状态时触发 readText;idempotent —— 已 loading/loaded/error
// 的文档不会重复读,rerender 也不会二次 IPC。errorMessage fallback 与
// t("filePanel.errors.read.fallback") 双保险,避免 empty error 视觉塌陷。
export function useDiskDocumentLoader(
  document: FilesDocument | null,
  files: FilePanelFilesApi | undefined,
  t: FilesTranslate
): void {
  useEffect(() => {
    if (!files || document?.source.kind !== "disk") {
      return;
    }

    const activeDocument = getDocument(document.id);
    if (activeDocument?.loadState !== "idle") {
      return;
    }

    markDocumentLoading(document.id);
    const loadingDocument = getDocument(document.id);
    if (loadingDocument?.loadState !== "loading") {
      return;
    }

    const { path, root } = document.source;
    const load = async () => {
      const stat = await files.stat({ path, root }).catch(() => null);
      // P0 守卫:超大文件不进 CodeMirror(渲染进程会被拖死)。
      if (stat?.size != null && stat.size > MAX_EDITABLE_FILE_BYTES) {
        markDocumentError(
          document.id,
          t(
            "filePanel.errors.tooLarge",
            "File is too large to open in the editor (>10 MB)."
          )
        );
        return;
      }
      const contents = await files.readText({ path, root });
      // 二进制嗅探:前 8000 字符含 NUL 视为二进制,只读提示。
      if (contents.slice(0, 8000).includes("\u0000")) {
        markDocumentError(
          document.id,
          t(
            "filePanel.errors.binary",
            "Binary files cannot be opened in the text editor."
          )
        );
        return;
      }
      markDocumentLoaded(document.id, contents, stat?.mtimeMs ?? null);
    };
    load().catch((readError: unknown) => {
      markDocumentError(
        document.id,
        errorMessage(
          readError,
          t("filePanel.errors.read.fallback", "Unable to read file contents.")
        )
      );
    });
  }, [document, files, t]);
}

// untitled 面板卸载时清掉对应内存文档;disk 文档保留。避免面板关闭后 store 里
// 残留 untitled 记录累计。
export function useRemoveUntitledOnUnmount(
  source: FilesDocumentPanelSource | null,
  document: FilesDocument | null
): void {
  const sourceDocumentId = source?.kind === "untitled" ? source.id : null;
  const isUntitledDocument = document?.source.kind === "untitled";

  useEffect(() => {
    if (!(sourceDocumentId && isUntitledDocument)) {
      return;
    }

    return () => {
      removeDocument(sourceDocumentId);
    };
  }, [isUntitledDocument, sourceDocumentId]);
}

// Preview→Pinned 自动 promote:用户在 preview panel 里做第一次修改时,
// 把 params.pinned 从 undefined/false 就地翻成 true。同一 dockview panel
// 不换 id、不 unmount,CodeMirror 状态、undo history、光标位置全保留。
// tab header 通过 onDidParametersChange 收到新 params 后视觉去斜体。
//
// pinned 已经是 true 时 no-op,避免在 promote 之后每次 dirty=true 反复
// updateParameters 触发 dockview 事件风暴。
export function usePromoteOnDirty(
  document: FilesDocument | null,
  api:
    | { updateParameters: (params: Record<string, unknown>) => void }
    | undefined,
  params: Record<string, unknown> | undefined
): void {
  useEffect(() => {
    if (!(document && api)) {
      return;
    }
    if (params?.pinned === true) {
      return;
    }
    if (!document.dirty) {
      return;
    }
    api.updateParameters({ ...(params ?? {}), pinned: true });
  }, [api, document, params]);
}
