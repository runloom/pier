import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachWorkspacePanelTransfer } from "@/components/workspace/transfer/attach.ts";
import { resetPanelTransferOverlayPreviewForTests } from "@/components/workspace/transfer/overlay-preview.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const TRANSFER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const { registerOverlayDispose } = vi.hoisted(() => ({
  registerOverlayDispose: vi.fn(),
}));

vi.mock("@/stores/terminal-input-routing-slice.ts", () => ({
  registerTerminalFullscreenWebOverlay: () => ({
    dispose: registerOverlayDispose,
    flush: vi.fn(),
  }),
}));

vi.mock("@/lib/ipc/window-ipc.ts", () => ({
  getWindowContext: async () => ({ windowId: "w-1" }),
}));

function rect(r: { bottom: number; left: number; right: number; top: number }) {
  return {
    ...r,
    height: r.bottom - r.top,
    width: r.right - r.left,
    x: r.left,
    y: r.top,
  };
}

function createGroup(): {
  clearOverlay: ReturnType<typeof vi.fn>;
  group: {
    element: HTMLElement;
    id: string;
    model: {
      contentDropTarget: {
        clearOverlay: ReturnType<typeof vi.fn>;
        showOverlay: ReturnType<typeof vi.fn>;
      };
    };
    panels: Array<{ id: string }>;
  };
  showOverlay: ReturnType<typeof vi.fn>;
} {
  const showOverlay = vi.fn();
  const clearOverlay = vi.fn();
  const tabEl = document.createElement("div");
  tabEl.className = "dv-tab";
  Object.defineProperty(tabEl, "getBoundingClientRect", {
    value: () => rect({ bottom: 40, left: 10, right: 110, top: 12 }),
  });
  const tabsRoot = document.createElement("div");
  tabsRoot.className = "dv-tabs-and-actions-container";
  tabsRoot.append(tabEl);
  Object.defineProperty(tabsRoot, "getBoundingClientRect", {
    value: () => rect({ bottom: 40, left: 0, right: 400, top: 12 }),
  });
  const contentEl = document.createElement("div");
  contentEl.className = "dv-content-container";
  Object.defineProperty(contentEl, "getBoundingClientRect", {
    value: () => rect({ bottom: 500, left: 0, right: 400, top: 40 }),
  });
  const groupEl = document.createElement("div");
  groupEl.className = "dockview-theme-pier";
  groupEl.append(tabsRoot, contentEl);
  Object.defineProperty(groupEl, "getBoundingClientRect", {
    value: () => rect({ bottom: 500, left: 0, right: 400, top: 0 }),
  });
  document.body.append(groupEl);
  return {
    clearOverlay,
    group: {
      element: groupEl,
      id: "group-1",
      model: { contentDropTarget: { clearOverlay, showOverlay } },
      panels: [{ id: "group-1-p1" }],
    },
    showOverlay,
  };
}

describe("attachWorkspacePanelTransfer overlay cleanup", () => {
  let dispose: (() => void) | undefined;
  let previewListener: ((preview: unknown) => void) | undefined;

  beforeEach(() => {
    registerOverlayDispose.mockClear();
    resetPanelTransferOverlayPreviewForTests();
    document.body.replaceChildren();
    previewListener = undefined;
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        panelTransfer: {
          finishDrag: vi.fn(async () => null),
          offer: vi.fn(async () => undefined),
          onOverlayPreview: (cb: (preview: unknown) => void) => {
            previewListener = cb;
            return () => {
              previewListener = undefined;
            };
          },
        },
      },
    });
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    resetPanelTransferOverlayPreviewForTests();
    useWorkspaceStore.setState({ api: null });
    document.body.replaceChildren();
  });

  it("clears a leftover drop overlay after dragend and ignores later live previews", async () => {
    const { group, showOverlay, clearOverlay } = createGroup();
    const api = {
      groups: [group],
      onDidDrop: () => ({ dispose: vi.fn() }),
      onUnhandledDragOver: () => ({ dispose: vi.fn() }),
      onWillDragPanel: () => ({ dispose: vi.fn() }),
      onWillDrop: () => ({ dispose: vi.fn() }),
    };
    useWorkspaceStore.setState({ api: api as never });
    dispose = attachWorkspacePanelTransfer(api as never);
    await Promise.resolve();
    previewListener?.({
      clientX: 200,
      clientY: 250,
      kind: "target",
      transferId: TRANSFER_ID,
      windowId: "w-1",
    });
    expect(showOverlay).toHaveBeenCalledWith("center");
    showOverlay.mockClear();
    clearOverlay.mockClear();

    window.dispatchEvent(new Event("dragend"));
    expect(clearOverlay).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(clearOverlay).toHaveBeenCalled();

    previewListener?.({
      clientX: 20,
      clientY: 250,
      kind: "target",
      transferId: TRANSFER_ID,
      windowId: "w-1",
    });
    expect(showOverlay).not.toHaveBeenCalled();
  });

  it("keeps a later transfer preview after the previous dragend sealed its id", async () => {
    const nextId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const { group, showOverlay, clearOverlay } = createGroup();
    const api = {
      groups: [group],
      onDidDrop: () => ({ dispose: vi.fn() }),
      onUnhandledDragOver: () => ({ dispose: vi.fn() }),
      onWillDragPanel: () => ({ dispose: vi.fn() }),
      onWillDrop: () => ({ dispose: vi.fn() }),
    };
    useWorkspaceStore.setState({ api: api as never });
    dispose = attachWorkspacePanelTransfer(api as never);
    await Promise.resolve();
    previewListener?.({
      clientX: 200,
      clientY: 250,
      kind: "target",
      transferId: TRANSFER_ID,
      windowId: "w-1",
    });
    window.dispatchEvent(new Event("dragend"));
    await Promise.resolve();
    showOverlay.mockClear();
    clearOverlay.mockClear();

    previewListener?.({
      clientX: 200,
      clientY: 250,
      kind: "target",
      transferId: nextId,
      windowId: "w-1",
    });
    expect(showOverlay).toHaveBeenCalledWith("center");
    expect(clearOverlay).not.toHaveBeenCalled();
  });
});
