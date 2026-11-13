import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { ReactNode } from "react";
import type {
  FilesDocument,
  FilesDocumentPreview,
} from "../../document/types.ts";
import type { FileEditorController } from "../../editor/controller.ts";
import type { FilesTranslate } from "../../i18n.ts";
import { FileDocumentPreview } from "../../preview/document/index.tsx";
import { FileImagePreview } from "../../preview/image.tsx";
import { FilesFindUnavailableNotice } from "../../search/use-find-unavailable.ts";
import { FileDeletedOnDiskChrome } from "../deleted-on-disk/bar.tsx";

/**
 * A failed reload keeps the previous preview on the document record so the
 * deleted-on-disk chrome can still render it, but the read error must win:
 * otherwise the failure is invisible and Retry has no visible effect.
 */
export function shouldRenderPreviewBranch(
  document: Pick<FilesDocument, "loadState" | "preview">
): document is Pick<FilesDocument, "loadState"> & {
  preview: FilesDocumentPreview;
} {
  return document.preview !== null && document.loadState !== "error";
}

export function FilePanelPreviewBranch(props: {
  context: RendererPluginContext;
  controller: FileEditorController;
  document: FilesDocument;
  panelId: string | undefined;
  preview: FilesDocumentPreview;
  searchRequest: number;
  t: FilesTranslate;
}): ReactNode {
  const { context, controller, document, panelId, preview, t } = props;
  return (
    <FileDeletedOnDiskChrome
      controller={controller}
      document={document}
      panelId={panelId}
      t={t}
    >
      <FilesFindUnavailableNotice
        context={context}
        panelId={panelId}
        searchRequest={props.searchRequest}
        t={t}
      >
        {preview.kind === "image" ? (
          <FileImagePreview context={context} document={document} t={t} />
        ) : (
          <FileDocumentPreview
            context={context}
            document={document}
            onReload={() => {
              controller
                .reloadDocumentFromDisk(document.id)
                .catch(() => undefined);
            }}
            preview={preview}
            t={t}
          />
        )}
      </FilesFindUnavailableNotice>
    </FileDeletedOnDiskChrome>
  );
}
