import type { DockviewApi } from "dockview-react";
import { recordTerminalInputRoutingTrace } from "@/lib/terminal-debug/input-routing-trace.ts";
import {
  getTerminalFocusRoutingDebugSnapshot,
  registerTerminalFullscreenWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing-slice.ts";

const TAB_DRAG_FALLBACK_MS = 5000;

type TabDragEndReason =
  | "dockview-will-drop"
  | "dockview-did-drop"
  | "window-dragend"
  | "escape"
  | "fallback-timeout"
  | "superseded"
  | "dispose";

interface ActiveTabDragSession {
  disposeCapture: () => void;
  panelId: string;
  sessionId: string;
  startedAt: number;
  timeoutId: number;
}

function webOwnerCount(): number {
  return getTerminalFocusRoutingDebugSnapshot().webRequestIds.length;
}

function createWebCapture(ownerId: string): () => void {
  const overlay = registerTerminalFullscreenWebOverlay(ownerId);
  const releaseFocus = requestTerminalWebFocus(ownerId);
  let disposed = false;
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    releaseFocus();
    overlay.dispose();
  };
}

/**
 * Dockview tab 拖拽期间接管终端输入。开始与正常 drop 来自 Dockview；源窗口
 * capture-phase dragend 覆盖跨窗口、窗口外释放与取消。每个 session 只释放自身 owner。
 */
export function attachWorkspaceTerminalTabDragInputCapture(
  api: Pick<DockviewApi, "onDidDrop" | "onWillDragPanel" | "onWillDrop">
): () => void {
  let activeSession: ActiveTabDragSession | null = null;
  let nextSessionSequence = 1;

  const finishSession = (sessionId: string, reason: TabDragEndReason): void => {
    const session = activeSession;
    if (!session || session.sessionId !== sessionId) {
      return;
    }
    activeSession = null;
    window.clearTimeout(session.timeoutId);
    session.disposeCapture();
    const elapsedMs = Math.max(
      0,
      Math.round(performance.now() - session.startedAt)
    );
    let action: "disposed" | "ended" | "fallback-timeout" = "ended";
    if (reason === "fallback-timeout") {
      action = "fallback-timeout";
    } else if (reason === "dispose") {
      action = "disposed";
    }
    recordTerminalInputRoutingTrace({
      action,
      elapsedMs,
      panelId: session.panelId,
      reason,
      sessionId: session.sessionId,
      source: "workspace-tab-drag",
      webOwnerCount: webOwnerCount(),
    });
  };

  const startSession = (panelId: string): void => {
    if (activeSession) {
      // 上一会话未收到结束信号即被新拖拽顶替；勿记 dispose（那是工作台卸载）。
      finishSession(activeSession.sessionId, "superseded");
    }
    const sessionId = `dockview-tab-drag:${nextSessionSequence}`;
    nextSessionSequence += 1;
    const startedAt = performance.now();
    const session: ActiveTabDragSession = {
      disposeCapture: createWebCapture(sessionId),
      panelId,
      sessionId,
      startedAt,
      timeoutId: 0,
    };
    activeSession = session;
    session.timeoutId = window.setTimeout(() => {
      finishSession(sessionId, "fallback-timeout");
    }, TAB_DRAG_FALLBACK_MS);
    recordTerminalInputRoutingTrace({
      action: "started",
      panelId,
      sessionId,
      source: "workspace-tab-drag",
      webOwnerCount: webOwnerCount(),
    });
  };

  const willDragPanelDispose = api.onWillDragPanel((event) => {
    startSession(event.panel.id);
  });
  const didDropDispose = api.onDidDrop(() => {
    const sessionId = activeSession?.sessionId;
    if (!sessionId) {
      return;
    }
    queueMicrotask(() => {
      finishSession(sessionId, "dockview-did-drop");
    });
  });
  // 同实例 tab 移动走 onWillDrop → onMove，不发 onDidDrop；后者留给外来 payload。
  const willDropDispose = api.onWillDrop(() => {
    const sessionId = activeSession?.sessionId;
    if (!sessionId) {
      return;
    }
    queueMicrotask(() => {
      finishSession(sessionId, "dockview-will-drop");
    });
  });
  const onDragEnd = (): void => {
    const sessionId = activeSession?.sessionId;
    if (!sessionId) {
      return;
    }
    finishSession(sessionId, "window-dragend");
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") {
      return;
    }
    const sessionId = activeSession?.sessionId;
    if (!sessionId) {
      return;
    }
    finishSession(sessionId, "escape");
  };

  window.addEventListener("dragend", onDragEnd, { capture: true });
  window.addEventListener("keydown", onKeyDown, { capture: true });

  return () => {
    const sessionId = activeSession?.sessionId;
    if (sessionId) {
      finishSession(sessionId, "dispose");
    }
    willDragPanelDispose?.dispose();
    didDropDispose?.dispose();
    willDropDispose?.dispose();
    window.removeEventListener("dragend", onDragEnd, { capture: true });
    window.removeEventListener("keydown", onKeyDown, { capture: true });
  };
}
