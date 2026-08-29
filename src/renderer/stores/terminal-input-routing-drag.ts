/** Dockview sash 拖拽期间的全屏 web 输入捕获。tab 拖拽由 workspace 边界管理。 */

import { recordTerminalInputRoutingTrace } from "@/lib/terminal-debug/input-routing-trace.ts";
import {
  getTerminalFocusRoutingDebugSnapshot,
  registerTerminalFullscreenWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing-slice.ts";

const SASH_DRAG_WATCHER_CLEANUP_KEY =
  "__pierTerminalInputRoutingSashDragCleanup__";

interface SashDragWatcherDocument extends Document {
  [SASH_DRAG_WATCHER_CLEANUP_KEY]?: () => void;
}

type SashDragEndReason =
  | "pointerup"
  | "pointercancel"
  | "window-blur"
  | "dispose";

function webOwnerCount(): number {
  return getTerminalFocusRoutingDebugSnapshot().webRequestIds.length;
}

function beginFullscreenWebInputCapture(id: string): () => void {
  const route = registerTerminalFullscreenWebOverlay(id);
  const releaseWebFocus = requestTerminalWebFocus(id);
  return () => {
    releaseWebFocus();
    route.dispose();
  };
}

let sashDragWatcherInstalled = false;
let nextSashSessionSequence = 1;

export function installTerminalInputRoutingSashDragWatcher(): void {
  if (sashDragWatcherInstalled) {
    return;
  }
  const watcherDocument = document as SashDragWatcherDocument;
  watcherDocument[SASH_DRAG_WATCHER_CLEANUP_KEY]?.();
  sashDragWatcherInstalled = true;

  let sashDragActive = false;
  let endSashDrag: ((reason: SashDragEndReason) => void) | null = null;
  const beginSashDrag = () => {
    if (sashDragActive) {
      return;
    }
    sashDragActive = true;
    // sessionId 同时作为 owner id，owner-stuck 可回指具体会话。
    const sessionId = `dockview-sash-drag:${nextSashSessionSequence}`;
    nextSashSessionSequence += 1;
    const startedAt = performance.now();
    // 分栏/浮层改大小不藏 native，只拦输入。
    const endSashCapture = beginFullscreenWebInputCapture(sessionId);
    recordTerminalInputRoutingTrace({
      action: "started",
      sessionId,
      source: "workspace-sash-drag",
      webOwnerCount: webOwnerCount(),
    });
    const cleanup = (reason: SashDragEndReason) => {
      if (!sashDragActive) {
        return;
      }
      sashDragActive = false;
      endSashCapture();
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", onBlur);
      endSashDrag = null;
      recordTerminalInputRoutingTrace({
        action: reason === "dispose" ? "disposed" : "ended",
        elapsedMs: Math.min(
          60_000,
          Math.max(0, Math.round(performance.now() - startedAt))
        ),
        reason,
        sessionId,
        source: "workspace-sash-drag",
        webOwnerCount: webOwnerCount(),
      });
    };
    const onPointerUp = () => cleanup("pointerup");
    const onPointerCancel = () => cleanup("pointercancel");
    const onBlur = () => cleanup("window-blur");
    endSashDrag = cleanup;
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", onBlur);
  };

  const onPointerDown = (e: PointerEvent) => {
    const t = e.target as HTMLElement;
    if (!(t.closest(".dv-sash") || t.closest(".dv-resize-container"))) {
      return;
    }
    beginSashDrag();
  };

  document.addEventListener("pointerdown", onPointerDown, true);

  watcherDocument[SASH_DRAG_WATCHER_CLEANUP_KEY] = () => {
    endSashDrag?.("dispose");
    document.removeEventListener("pointerdown", onPointerDown, true);
    sashDragWatcherInstalled = false;
    delete watcherDocument[SASH_DRAG_WATCHER_CLEANUP_KEY];
  };
}

export function resetTerminalInputRoutingSashDragForTests(): void {
  sashDragWatcherInstalled = false;
  nextSashSessionSequence = 1;
}
