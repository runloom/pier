import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { type MouseEvent as ReactMouseEvent, useCallback, useRef } from "react";
import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import { createFileFilePanelInstanceId } from "./file-panel-id.ts";
import type {
  FilesDocument,
  FilesDocumentPanelSource,
} from "./files-document-types.ts";
import type { FilesTranslate } from "./files-i18n.ts";
import type { MarkdownInternalTarget } from "./markdown-ir-renderer.tsx";
import { FILES_MARKDOWN_PREVIEW_SURFACE } from "./markdown-preview-preferences.ts";

export function useFilePanelMarkdownChrome({
  context,
  document,
  editorSessionId,
  panelContext,
  panelId,
  t,
}: {
  context: RendererPluginContext | undefined;
  document: FilesDocument | undefined;
  editorSessionId: string;
  panelContext: PanelContext | undefined;
  panelId: string | undefined;
  t: FilesTranslate;
}): {
  handleCopyMarkdownCode: (code: string) => Promise<void>;
  handleMarkdownPreviewContextMenu: (
    event: ReactMouseEvent<HTMLDivElement>
  ) => void;
  handleOpenExternal: (url: string) => Promise<void>;
  handleOpenMarkdownInternal: (target: MarkdownInternalTarget) => void;
} {
  const externalUrlInFlightRef = useRef<string | null>(null);

  const handleMarkdownPreviewContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!(document && context && panelId)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const hasHeadings = Boolean(
        event.currentTarget.querySelector('[data-slot="markdown-preview-toc"]')
      );
      context.contextMenu
        .popup(
          FILES_MARKDOWN_PREVIEW_SURFACE,
          { x: event.clientX, y: event.clientY },
          {
            metadata: {
              documentId: document.id,
              editorSessionId,
              hasHeadings,
              ...(document.source.kind === "disk"
                ? {
                    path: document.source.path,
                    root: document.source.root,
                    ...(panelContext?.projectRootPath
                      ? { projectRoot: panelContext.projectRootPath }
                      : {}),
                  }
                : {}),
            },
            sourcePanelComponent: FILES_FILE_PANEL_ID,
            ...(panelContext ? { sourcePanelContext: panelContext } : {}),
            sourcePanelId: panelId,
          }
        )
        .catch((err: unknown) => {
          context.dialogs
            .alert({
              body: err instanceof Error ? err.message : String(err),
              title: t(
                "filePanel.markdown.contextMenuFailed",
                "Unable to open preview menu"
              ),
            })
            .catch(() => undefined);
        });
    },
    [context, document, editorSessionId, panelContext, panelId, t]
  );

  const handleOpenExternal = useCallback(
    async (url: string) => {
      if (!context || externalUrlInFlightRef.current === url) {
        return;
      }
      if (externalUrlInFlightRef.current) {
        context.notifications.info(
          t(
            "filePanel.markdown.externalOpenBusy",
            "Another external link is already opening."
          )
        );
        return;
      }
      externalUrlInFlightRef.current = url;
      try {
        const result = await context.externalNavigation.open(url);
        if (!result.opened && result.reason === "busy") {
          context.notifications.info(
            t(
              "filePanel.markdown.externalOpenBusy",
              "Another external link is already opening."
            )
          );
        } else if (!result.opened) {
          await context.dialogs.alert({
            body: t(
              "filePanel.markdown.externalOpenFailed.description",
              "The external link could not be opened."
            ),
            size: "sm",
            title: t(
              "filePanel.markdown.externalOpenFailed.title",
              "Unable to open link"
            ),
          });
        }
      } catch (error) {
        await context.dialogs
          .alert({
            body: error instanceof Error ? error.message : String(error),
            size: "default",
            title: t(
              "filePanel.markdown.externalOpenFailed.title",
              "Unable to open link"
            ),
          })
          .catch(() => undefined);
      } finally {
        if (externalUrlInFlightRef.current === url) {
          externalUrlInFlightRef.current = null;
        }
      }
    },
    [context, t]
  );

  const handleOpenMarkdownInternal = useCallback(
    (target: MarkdownInternalTarget) => {
      if (!(context && document?.source.kind === "disk")) return;
      const nextSource: FilesDocumentPanelSource = {
        kind: "disk",
        path: target.path,
        root: document.source.root,
      };
      context.panels.openInstance({
        componentId: FILES_FILE_PANEL_ID,
        ...(panelContext ? { context: panelContext } : {}),
        dropUnpinnedInstances: true,
        instanceId: createFileFilePanelInstanceId(nextSource),
        params: {
          ...(target.fragment ? { markdownAnchor: target.fragment } : {}),
          ...(target.fragment
            ? { markdownAnchorRequestId: crypto.randomUUID() }
            : {}),
          pinned: false,
          source: nextSource,
        },
        title: target.path.split("/").at(-1) ?? target.path,
      });
    },
    [context, document, panelContext]
  );

  const handleCopyMarkdownCode = useCallback(
    async (code: string) => {
      try {
        await navigator.clipboard.writeText(code);
      } catch (error) {
        if (context) {
          await context.dialogs.alert({
            body: error instanceof Error ? error.message : String(error),
            size: "default",
            title: t(
              "filePanel.editor.clipboardFailed",
              "Clipboard unavailable"
            ),
          });
        }
        throw error;
      }
    },
    [context, t]
  );

  return {
    handleCopyMarkdownCode,
    handleMarkdownPreviewContextMenu,
    handleOpenExternal,
    handleOpenMarkdownInternal,
  };
}
