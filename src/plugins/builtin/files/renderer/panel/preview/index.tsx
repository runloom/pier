import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { ReactNode } from "react";
import { getDocument } from "../../document/store.ts";
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
  const reload = () => {
    controller.reloadDocumentFromDisk(document.id).catch(() => {
      // A read failure already surfaces through the document error state;
      // anything else (document gone, reload unavailable) would be silent.
      if (getDocument(document.id)?.loadState !== "error") {
        context.notifications.error(
          t(
            "filePanel.documentPreview.reloadFailed",
            "Couldn't reload the document. Try again."
          )
        );
      }
    });
  };
  const body =
    preview.kind === "image" ? (
      <FileImagePreview context={context} document={document} t={t} />
    ) : (
      <FileDocumentPreview
        context={context}
        document={document}
        onReload={reload}
        preview={preview}
        t={t}
      />
    );
  return (
    <FileDeletedOnDiskChrome
      controller={controller}
      document={document}
      panelId={panelId}
      t={t}
    >
      <FilesFindUnavailableNotice
        context={context}
        fallbackMessage={
          preview.kind === "image"
            ? undefined
            : "Find isn't available in document previews."
        }
        messageKey={
          preview.kind === "image"
            ? undefined
            : "filePanel.documentPreview.findUnavailable"
        }
        panelId={panelId}
        searchRequest={props.searchRequest}
        t={t}
      >
        {body}
      </FilesFindUnavailableNotice>
    </FileDeletedOnDiskChrome>
  );
}
