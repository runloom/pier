import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeWebOverlayOutsideDismiss,
  markWebOverlayOutsideDismiss,
  markWebOverlayOutsideDismissIfNeeded,
  resetWebOverlayOutsideDismissForTests,
  restoreTerminalFocusAfterWebOverlayDismiss,
  shouldMarkWebOverlayOutsideDismiss,
} from "@/lib/workspace/restore-terminal-focus-after-web-overlay-dismiss.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { useTerminalStore } from "@/stores/terminal.store.ts";
import {
  clearTransientWebClickFocus,
  requestTerminalFocusIntent,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing-slice.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

vi.mock("@/stores/terminal-input-routing-slice.ts", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/stores/terminal-input-routing-slice.ts")
    >();
  return {
    ...actual,
    clearTransientWebClickFocus: vi.fn(actual.clearTransientWebClickFocus),
    requestTerminalFocusIntent: vi.fn(actual.requestTerminalFocusIntent),
  };
});

describe("restoreTerminalFocusAfterWebOverlayDismiss", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWebOverlayOutsideDismissForTests();
    useKeybindingScope.setState({
      activePanelComponent: null,
      activePanelId: null,
      activePanelKind: null,
    });
    useWorkspaceStore.setState({ api: null });
    useTerminalStore.setState({ activeOverlayId: null });
  });

  it("tracks outside-dismiss mark/consume per owner", () => {
    expect(consumeWebOverlayOutsideDismiss("a")).toBe(false);
    markWebOverlayOutsideDismiss("a");
    markWebOverlayOutsideDismiss("b");
    expect(consumeWebOverlayOutsideDismiss("a")).toBe(true);
    expect(consumeWebOverlayOutsideDismiss("a")).toBe(false);
    expect(consumeWebOverlayOutsideDismiss("b")).toBe(true);
  });

  it("shouldMark: terminal-anchor / body / html only", () => {
    const anchor = document.createElement("div");
    anchor.className = "terminal-anchor";
    document.body.appendChild(anchor);
    const button = document.createElement("button");
    document.body.appendChild(button);
    const trigger = document.createElement("button");
    trigger.setAttribute("data-slot", "popover-trigger");
    document.body.appendChild(trigger);
    const tree = document.createElement("div");
    tree.setAttribute("role", "treeitem");
    document.body.appendChild(tree);

    expect(shouldMarkWebOverlayOutsideDismiss(anchor)).toBe(true);
    expect(shouldMarkWebOverlayOutsideDismiss(document.body)).toBe(true);
    expect(shouldMarkWebOverlayOutsideDismiss(document.documentElement)).toBe(
      true
    );
    expect(shouldMarkWebOverlayOutsideDismiss(null)).toBe(true);
    expect(shouldMarkWebOverlayOutsideDismiss(button)).toBe(false);
    expect(shouldMarkWebOverlayOutsideDismiss(trigger)).toBe(false);
    expect(shouldMarkWebOverlayOutsideDismiss(tree)).toBe(false);

    anchor.remove();
    button.remove();
    trigger.remove();
    tree.remove();
  });

  it("markIfNeeded respects shouldMark", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    expect(markWebOverlayOutsideDismissIfNeeded("o", button)).toBe(false);
    expect(consumeWebOverlayOutsideDismiss("o")).toBe(false);

    expect(markWebOverlayOutsideDismissIfNeeded("o", document.body)).toBe(true);
    expect(consumeWebOverlayOutsideDismiss("o")).toBe(true);
    button.remove();
  });

  it("focuses the active terminal panel from keybinding scope", () => {
    useKeybindingScope.setState({
      activePanelComponent: "terminal",
      activePanelId: "term-1",
      activePanelKind: "terminal",
    });
    restoreTerminalFocusAfterWebOverlayDismiss();
    expect(requestTerminalFocusIntent).toHaveBeenCalledWith("term-1");
  });

  it("falls back to workspace activePanel when scope lacks terminal", () => {
    useWorkspaceStore.setState({
      api: {
        activePanel: {
          id: "term-2",
          view: { contentComponent: "terminal" },
        },
      } as never,
    });
    restoreTerminalFocusAfterWebOverlayDismiss();
    expect(requestTerminalFocusIntent).toHaveBeenCalledWith("term-2");
  });

  it("clears transient pier.click when no terminal is active", () => {
    const release = requestTerminalWebFocus("pier.click");
    restoreTerminalFocusAfterWebOverlayDismiss();
    expect(requestTerminalFocusIntent).not.toHaveBeenCalled();
    expect(clearTransientWebClickFocus).toHaveBeenCalled();
    release();
  });

  it("yields terminal overlay focus before restoring", () => {
    const yieldSpy = vi.spyOn(useTerminalStore.getState(), "yieldToTerminal");
    useKeybindingScope.setState({
      activePanelComponent: "terminal",
      activePanelId: "term-1",
      activePanelKind: "terminal",
    });
    useTerminalStore.getState().activateOverlay("terminal-search");
    restoreTerminalFocusAfterWebOverlayDismiss();
    expect(yieldSpy).toHaveBeenCalled();
    expect(useTerminalStore.getState().activeOverlayId).toBeNull();
  });
});
