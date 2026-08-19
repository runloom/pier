import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { FILES_FILE_PANEL_ID } from "../../manifest.ts";
import type { FilesTranslate } from "../i18n.ts";

export const FILES_CANVAS_PREVIEW_SURFACE = "files/canvas-preview";

export function selectCanvasPreviewContents(root: HTMLElement | null): boolean {
  if (!root) {
    return false;
  }
  const target = root.querySelector<HTMLElement>(
    '[data-slot="file-canvas-host"]'
  );
  if (!target) {
    return false;
  }
  const selection = window.getSelection();
  if (!selection) {
    return false;
  }
  const range = document.createRange();
  range.selectNodeContents(target);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export function isNativeTextEditContextTarget(
  event: Pick<ReactMouseEvent, "nativeEvent" | "target">
): boolean {
  const native = event.nativeEvent;
  const path =
    typeof native.composedPath === "function" ? native.composedPath() : [];
  const nodes = path.length > 0 ? path : [event.target];
  return nodes.some((node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    const tag = node.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      node.isContentEditable
    );
  });
}

function readSelectedText(): string {
  return (
    window
      .getSelection()
      ?.toString()
      .replace(/\u00a0/g, " ") ?? ""
  );
}

export function useCanvasPreviewContextMenu(options: {
  context: RendererPluginContext;
  panelContext?: PanelContext | undefined;
  panelId?: string | undefined;
  path: string;
  root: string;
  t: FilesTranslate;
}): {
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  previewRootRef: RefObject<HTMLDivElement | null>;
} {
  const { context, panelContext, panelId, path, root, t } = options;
  const previewRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!panelId) {
      return;
    }
    return context.contextMenu.registerSelectionSelectAllProvider(panelId, () =>
      selectCanvasPreviewContents(previewRootRef.current)
    );
  }, [context, panelId]);

  const onContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!panelId) {
        return;
      }
      // Keep the panel shell from stealing the event; leave native cut/copy
      // on inputs and comment composers.
      event.stopPropagation();
      if (isNativeTextEditContextTarget(event)) {
        return;
      }
      const selectedText = readSelectedText();
      event.preventDefault();
      context.contextMenu
        .popup(
          FILES_CANVAS_PREVIEW_SURFACE,
          { x: event.clientX, y: event.clientY },
          {
            metadata: {
              path,
              root,
              ...(panelContext?.projectRootPath
                ? { projectRoot: panelContext.projectRootPath }
                : {}),
              ...(selectedText.length > 0 ? { selectedText } : {}),
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
                "filePanel.canvas.contextMenuFailed",
                "Unable to open preview menu"
              ),
            })
            .catch(() => undefined);
        });
    },
    [context, panelContext, panelId, path, root, t]
  );

  return { onContextMenu, previewRootRef };
}
