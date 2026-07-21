/**
 * Shared helpers for cross-window panel transfer (renderer side).
 */

import type {
  JsonValue,
  PanelTransferResult,
} from "@shared/contracts/panel-transfer.ts";
import {
  PANEL_TRANSFER_MIME,
  PANEL_TRANSFER_TEXT_PREFIX,
} from "@shared/contracts/panel-transfer.ts";
import type { DockviewApi } from "dockview-react";
import i18next from "i18next";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

export type DockviewPanel = DockviewApi["panels"][number];
export type DockviewGroup = NonNullable<DockviewApi["activeGroup"]>;

export interface TabDragEventLike {
  nativeEvent: DragEvent | PointerEvent;
  panel: DockviewPanel;
}

export interface UnhandledDragOverEventLike {
  accept?(): void;
  group?: DockviewGroup;
  nativeEvent: DragEvent | PointerEvent;
  position?: string;
}

export interface DidDropEventLike {
  group?: DockviewGroup | undefined;
  nativeEvent: DragEvent | PointerEvent;
  /** Header drops: the tab at the insertion index (undefined = append). */
  panel?: { id: string } | undefined;
  position?: string | undefined;
}

export interface WillDropEventLike {
  nativeEvent: DragEvent | PointerEvent;
  preventDefault(): void;
}

export function pierPanelTransfer() {
  const api = globalThis.window?.pier?.panelTransfer;
  if (!api) {
    throw new Error("window.pier.panelTransfer is not available");
  }
  return api;
}

export function isRealDragEvent(
  native: DragEvent | PointerEvent
): native is DragEvent & { dataTransfer: DataTransfer } {
  return native instanceof DragEvent && native.dataTransfer !== null;
}

export function panelComponentOf(panel: DockviewPanel): string | undefined {
  const view = panel.view as { contentComponent?: string } | undefined;
  return view?.contentComponent;
}

export function panelParamsOf(
  panel: DockviewPanel
): Readonly<Record<string, unknown>> {
  return panel.params ?? {};
}

/**
 * Dockview `Parameters` is `{ [key: string]: any }`; panels only set
 * JSON-serializable values (validated upstream by main's Zod contract). This
 * helper narrows to `Record<string, JsonValue>` for the offer / snapshot
 * payloads; main re-validates before persisting, so this is a renderer-local
 * convenience, not a trust boundary.
 */
export function panelJsonParamsOf(
  panel: DockviewPanel
): Record<string, JsonValue> {
  return (panel.params ?? {}) as Record<string, JsonValue>;
}

export function panelTitleOf(panel: DockviewPanel): string {
  return panel.title ?? panel.id;
}

export function stampMovableDataTransfer(
  dataTransfer: DataTransfer,
  transferId: string,
  panel: DockviewPanel,
  componentId: string
): void {
  const payload = JSON.stringify({
    panel: {
      componentId,
      panelId: panel.id,
      title: panelTitleOf(panel),
    },
    transferId,
    version: 1,
  });
  dataTransfer.setData(PANEL_TRANSFER_MIME, payload);
  dataTransfer.setData(
    "text/plain",
    `${PANEL_TRANSFER_TEXT_PREFIX}${transferId}`
  );
  dataTransfer.effectAllowed = "move";
}

/** Parse a Pier panel-transfer id from MIME JSON or text/plain prefix. */
export function readPanelTransferId(
  dataTransfer: DataTransfer | null
): string | null {
  if (!dataTransfer) {
    return null;
  }
  const mime = dataTransfer.getData(PANEL_TRANSFER_MIME);
  if (mime) {
    try {
      const parsed = JSON.parse(mime) as { transferId?: unknown };
      if (
        typeof parsed.transferId === "string" &&
        parsed.transferId.length > 0
      ) {
        return parsed.transferId;
      }
    } catch {
      // fall through to text/plain
    }
  }
  const text = dataTransfer.getData("text/plain");
  if (text.startsWith(PANEL_TRANSFER_TEXT_PREFIX)) {
    const id = text.slice(PANEL_TRANSFER_TEXT_PREFIX.length);
    return id.length > 0 ? id : null;
  }
  return null;
}

export async function showPanelTransferFailure(
  result: Extract<PanelTransferResult, { ok: false }>
): Promise<void> {
  const t = i18next.getFixedT(i18next.language);
  const title =
    result.code === "not_supported"
      ? t("workspace.panelTransfer.unsupportedTitle", {
          defaultValue: "This tab can’t move to another window",
        })
      : t("workspace.panelTransfer.dropFailedTitle", {
          defaultValue: "Couldn’t move the tab",
        });
  const genericBody =
    result.code === "not_supported"
      ? t("workspace.panelTransfer.unsupportedBody", {
          defaultValue: "This kind of tab doesn’t support cross-window moves.",
        })
      : t("workspace.panelTransfer.dropFailedBody", {
          defaultValue: "The tab couldn’t be moved to that window.",
        });
  // Surface technical detail so silent race/timeout failures are diagnosable.
  const detail = result.message.trim();
  const body =
    detail.length > 0 && result.code !== "not_supported"
      ? `${genericBody}\n\n${detail}`
      : genericBody;
  await showAppAlert({ body, size: "default", title });
}
