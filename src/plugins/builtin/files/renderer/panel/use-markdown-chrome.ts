import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { type MouseEvent as ReactMouseEvent, useCallback, useRef } from "react";
import { FILES_FILE_PANEL_ID } from "../../manifest.ts";
import type { FilesDocument } from "../document/types.ts";
import type { FilesTranslate } from "../i18n.ts";
import type { MarkdownInternalTarget } from "../markdown/ir-renderer.tsx";
import { FILES_MARKDOWN_PREVIEW_SURFACE } from "../markdown/preview-preferences.ts";
import { openMarkdownInternal } from "./markdown/navigation.ts";

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
  handleCopyMarkdownAnchor: (anchor: string) => Promise<void>;
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
      // 「跳转到源码」目标：被右键的最内层块的源码起始 offset。
      const sourceOffsetRaw =
        event.target instanceof Element
          ? event.target
              .closest("[data-source-offset]")
              ?.getAttribute("data-source-offset")
          : undefined;
      const sourceOffset =
        sourceOffsetRaw === undefined || sourceOffsetRaw === null
          ? undefined
          : Number(sourceOffsetRaw);
      context.contextMenu
        .popup(
          FILES_MARKDOWN_PREVIEW_SURFACE,
          { x: event.clientX, y: event.clientY },
          {
            metadata: {
              documentId: document.id,
              editorSessionId,
              hasHeadings,
              ...(sourceOffset !== undefined && Number.isFinite(sourceOffset)
                ? { sourceOffset }
                : {}),
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
      openMarkdownInternal({
        context,
        root: document.source.root,
        target,
        panelContext,
      });
    },
    [context, document, panelContext]
  );

  // Heading anchor copy: clipboard write + success toast here, clipboard
  // failures through the same filePanel.editor.clipboardFailed alert channel
  // as code copy. No rethrow — the alert is the user-facing feedback.
  const handleCopyMarkdownAnchor = useCallback(
    async (anchor: string) => {
      try {
        await navigator.clipboard.writeText(anchor);
      } catch (error) {
        if (context) {
          await context.dialogs.alert({
            body: error instanceof Error ? error.message : String(error),
            title: t(
              "filePanel.editor.clipboardFailed",
              "Clipboard unavailable"
            ),
          });
        }
        return;
      }
      context?.notifications.success(
        t("filePanel.markdown.anchorCopied", "Anchor copied")
      );
    },
    [context, t]
  );

  const handleCopyMarkdownCode = useCallback(
    async (code: string) => {
      try {
        await navigator.clipboard.writeText(code);
      } catch (error) {
        if (context) {
          await context.dialogs.alert({
            body: error instanceof Error ? error.message : String(error),
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
    handleCopyMarkdownAnchor,
    handleCopyMarkdownCode,
    handleMarkdownPreviewContextMenu,
    handleOpenExternal,
    handleOpenMarkdownInternal,
  };
}
