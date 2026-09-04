import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearFrozenOfferParamsForTests,
  setActiveDrag,
} from "@/components/workspace/transfer/dnd.ts";
import {
  applyPanelTransferOverlayPreview,
  createPanelTransferOverlayPreviewSession,
  resetPanelTransferOverlayPreviewForTests,
} from "@/components/workspace/transfer/overlay-preview.ts";
import {
  PANEL_TRANSFER_IN_TRANSIT_ATTR,
  resetPanelTransferTearOffForTests,
} from "@/components/workspace/transfer/tear-off.ts";

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

function rect(r: { bottom: number; left: number; right: number; top: number }) {
  return {
    ...r,
    height: r.bottom - r.top,
    width: r.right - r.left,
    x: r.left,
    y: r.top,
  };
}

function createGroup(input: { id: string; left: number; right: number }): {
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
    value: () =>
      rect({
        bottom: 40,
        left: input.left + 10,
        right: input.left + 110,
        top: 12,
      }),
  });
  const tabsRoot = document.createElement("div");
  tabsRoot.className = "dv-tabs-and-actions-container";
  tabsRoot.append(tabEl);
  Object.defineProperty(tabsRoot, "getBoundingClientRect", {
    value: () =>
      rect({ bottom: 40, left: input.left, right: input.right, top: 12 }),
  });
  const contentEl = document.createElement("div");
  contentEl.className = "dv-content-container";
  Object.defineProperty(contentEl, "getBoundingClientRect", {
    value: () =>
      rect({ bottom: 500, left: input.left, right: input.right, top: 40 }),
  });
  const groupEl = document.createElement("div");
  groupEl.className = "dockview-theme-pier";
  groupEl.append(tabsRoot, contentEl);
  Object.defineProperty(groupEl, "getBoundingClientRect", {
    value: () =>
      rect({ bottom: 500, left: input.left, right: input.right, top: 0 }),
  });
  document.body.append(groupEl);
  return {
    clearOverlay,
    group: {
      element: groupEl,
      id: input.id,
      model: { contentDropTarget: { clearOverlay, showOverlay } },
      panels: [{ id: `${input.id}-p1` }, { id: `${input.id}-p2` }],
    },
    showOverlay,
  };
}

describe("panel transfer overlay preview (renderer)", () => {
  beforeEach(() => {
    registerOverlayDispose.mockClear();
    resetPanelTransferOverlayPreviewForTests();
    resetPanelTransferTearOffForTests();
    setActiveDrag(null);
    document.body.replaceChildren();
  });

  afterEach(() => {
    resetPanelTransferOverlayPreviewForTests();
    resetPanelTransferTearOffForTests();
    clearFrozenOfferParamsForTests();
    setActiveDrag(null);
    document.body.replaceChildren();
  });

  it("does not clear the source window overlay while the pointer stays here", () => {
    const { group, showOverlay, clearOverlay } = createGroup({
      id: "group-1",
      left: 0,
      right: 400,
    });
    applyPanelTransferOverlayPreview(
      { kind: "source", transferId: TRANSFER_ID, windowId: "main" },
      { getApi: () => ({ groups: [group] }) as never, windowId: "main" }
    );
    expect(showOverlay).not.toHaveBeenCalled();
    expect(clearOverlay).not.toHaveBeenCalled();
  });

  it("does not clear overlay when this window id is still unknown on source", () => {
    const { group, clearOverlay } = createGroup({
      id: "group-1",
      left: 0,
      right: 400,
    });
    applyPanelTransferOverlayPreview(
      { kind: "source", transferId: TRANSFER_ID, windowId: "main" },
      { getApi: () => ({ groups: [group] }) as never, windowId: null }
    );
    expect(clearOverlay).not.toHaveBeenCalled();
  });

  it("clears Dockview overlay when the cursor leaves this window", () => {
    const { group, clearOverlay } = createGroup({
      id: "group-1",
      left: 0,
      right: 400,
    });
    applyPanelTransferOverlayPreview(
      { kind: "outside", transferId: TRANSFER_ID },
      { getApi: () => ({ groups: [group] }) as never, windowId: "main" }
    );
    expect(clearOverlay).toHaveBeenCalled();
  });

  it("drives Dockview showOverlay on the hovered foreign window", () => {
    const first = createGroup({ id: "group-1", left: 0, right: 400 });
    const second = createGroup({ id: "group-2", left: 400, right: 800 });
    const api = { groups: [first.group, second.group] };
    applyPanelTransferOverlayPreview(
      {
        clientX: 200,
        clientY: 250,
        kind: "target",
        transferId: TRANSFER_ID,
        windowId: "w-1",
      },
      { getApi: () => api as never, windowId: "w-1" }
    );
    expect(first.showOverlay).toHaveBeenCalledWith("center");
    expect(second.clearOverlay).toHaveBeenCalled();
    expect(second.showOverlay).not.toHaveBeenCalled();

    first.showOverlay.mockClear();
    second.clearOverlay.mockClear();
    applyPanelTransferOverlayPreview(
      {
        clientX: 20,
        clientY: 250,
        kind: "target",
        transferId: TRANSFER_ID,
        windowId: "w-1",
      },
      { getApi: () => api as never, windowId: "w-1" }
    );
    expect(first.showOverlay).toHaveBeenCalledWith("left");

    applyPanelTransferOverlayPreview(
      { kind: "source", transferId: TRANSFER_ID, windowId: "main" },
      { getApi: () => api as never, windowId: "w-1" }
    );
    expect(first.clearOverlay).toHaveBeenCalled();
    expect(registerOverlayDispose).toHaveBeenCalled();
  });

  it("shows the later group without the earlier group's clear wiping the overlay", () => {
    const first = createGroup({ id: "group-1", left: 0, right: 400 });
    const second = createGroup({ id: "group-2", left: 400, right: 800 });
    applyPanelTransferOverlayPreview(
      {
        clientX: 600,
        clientY: 250,
        kind: "target",
        transferId: TRANSFER_ID,
        windowId: "w-1",
      },
      {
        getApi: () => ({ groups: [first.group, second.group] }) as never,
        windowId: "w-1",
      }
    );
    expect(first.clearOverlay).toHaveBeenCalled();
    expect(second.showOverlay).toHaveBeenCalledWith("center");
    const lastClear = first.clearOverlay.mock.invocationCallOrder.at(-1);
    const showOrder = second.showOverlay.mock.invocationCallOrder.at(-1);
    expect(lastClear).toBeDefined();
    expect(showOrder).toBeDefined();
    expect(lastClear ?? 0).toBeLessThan(showOrder ?? 0);
  });

  it("hides the source tab when the cursor leaves every Pier window", () => {
    const { group } = createGroup({ id: "group-1", left: 0, right: 400 });
    const tab = document.createElement("div");
    tab.className = "dv-tab";
    const inner = document.createElement("div");
    inner.dataset.panelTabId = "panel-1";
    tab.append(inner);
    document.body.append(tab);
    setActiveDrag({
      capability: "movable",
      componentId: "welcome",
      panelId: "panel-1",
      params: {},
      transferId: TRANSFER_ID,
    });
    applyPanelTransferOverlayPreview(
      { kind: "outside", transferId: TRANSFER_ID },
      { getApi: () => ({ groups: [group] }) as never, windowId: "main" }
    );
    expect(tab.hasAttribute(PANEL_TRANSFER_IN_TRANSIT_ATTR)).toBe(true);
  });

  it("releases a leftover fullscreen web overlay when end(id) has no live session", () => {
    const first = createGroup({ id: "group-1", left: 0, right: 400 });
    applyPanelTransferOverlayPreview(
      {
        clientX: 200,
        clientY: 250,
        kind: "target",
        transferId: TRANSFER_ID,
        windowId: "w-1",
      },
      { getApi: () => ({ groups: [first.group] }) as never, windowId: "w-1" }
    );
    expect(first.showOverlay).toHaveBeenCalledWith("center");
    registerOverlayDispose.mockClear();
    first.clearOverlay.mockClear();

    const session = createPanelTransferOverlayPreviewSession({
      getApi: () => ({ groups: [first.group] }) as never,
      getWindowId: () => "w-1",
    });
    session.end(TRANSFER_ID);
    expect(registerOverlayDispose).toHaveBeenCalled();
    expect(first.clearOverlay).toHaveBeenCalled();
  });

  it("clears Dockview overlay when the transfer preview session ends", () => {
    const first = createGroup({ id: "group-1", left: 0, right: 400 });
    const session = createPanelTransferOverlayPreviewSession({
      getApi: () => ({ groups: [first.group] }) as never,
      getWindowId: () => "w-1",
    });
    session.apply({
      clientX: 200,
      clientY: 250,
      kind: "target",
      transferId: TRANSFER_ID,
      windowId: "w-1",
    });
    expect(first.showOverlay).toHaveBeenCalledWith("center");
    first.clearOverlay.mockClear();
    first.showOverlay.mockClear();

    session.end();
    expect(first.clearOverlay).toHaveBeenCalled();

    session.apply({
      clientX: 20,
      clientY: 250,
      kind: "target",
      transferId: TRANSFER_ID,
      windowId: "w-1",
    });
    expect(first.showOverlay).not.toHaveBeenCalled();
    expect(first.clearOverlay).toHaveBeenCalled();
  });

  it("accepts live previews again after a new drag begins", () => {
    const first = createGroup({ id: "group-1", left: 0, right: 400 });
    const session = createPanelTransferOverlayPreviewSession({
      getApi: () => ({ groups: [first.group] }) as never,
      getWindowId: () => "w-1",
    });
    session.end();
    session.begin(TRANSFER_ID);
    session.apply({
      clientX: 200,
      clientY: 250,
      kind: "target",
      transferId: TRANSFER_ID,
      windowId: "w-1",
    });
    expect(first.showOverlay).toHaveBeenCalledWith("center");
  });

  it("does not let a stale clear for A tear down live B", () => {
    const first = createGroup({ id: "group-1", left: 0, right: 400 });
    const nextId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const session = createPanelTransferOverlayPreviewSession({
      getApi: () => ({ groups: [first.group] }) as never,
      getWindowId: () => "w-1",
    });
    session.begin(TRANSFER_ID);
    session.apply({
      clientX: 200,
      clientY: 250,
      kind: "target",
      transferId: TRANSFER_ID,
      windowId: "w-1",
    });
    session.begin(nextId);
    session.apply({
      clientX: 200,
      clientY: 250,
      kind: "target",
      transferId: nextId,
      windowId: "w-1",
    });
    expect(first.showOverlay).toHaveBeenCalled();
    first.clearOverlay.mockClear();
    first.showOverlay.mockClear();

    session.apply({ kind: "clear", transferId: TRANSFER_ID });
    expect(first.clearOverlay).not.toHaveBeenCalled();

    session.apply({
      clientX: 20,
      clientY: 250,
      kind: "target",
      transferId: TRANSFER_ID,
      windowId: "w-1",
    });
    expect(first.showOverlay).not.toHaveBeenCalled();
    expect(first.clearOverlay).not.toHaveBeenCalled();
  });

  it("begin of B ends A so a late A preview cannot return after B ends", () => {
    const first = createGroup({ id: "group-1", left: 0, right: 400 });
    const nextId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const session = createPanelTransferOverlayPreviewSession({
      getApi: () => ({ groups: [first.group] }) as never,
      getWindowId: () => "w-1",
    });
    session.begin(TRANSFER_ID);
    session.apply({
      clientX: 200,
      clientY: 250,
      kind: "target",
      transferId: TRANSFER_ID,
      windowId: "w-1",
    });
    session.begin(nextId);
    session.apply({
      clientX: 200,
      clientY: 250,
      kind: "target",
      transferId: nextId,
      windowId: "w-1",
    });
    session.end(nextId);
    first.showOverlay.mockClear();
    first.clearOverlay.mockClear();

    session.apply({
      clientX: 20,
      clientY: 250,
      kind: "target",
      transferId: TRANSFER_ID,
      windowId: "w-1",
    });
    expect(first.showOverlay).not.toHaveBeenCalled();
  });
});
