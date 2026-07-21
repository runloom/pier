import {
  PANEL_TRANSFER_MIME,
  PANEL_TRANSFER_TEXT_PREFIX,
} from "@shared/contracts/panel-transfer.ts";
import type { RendererCommandEnvelope } from "@shared/contracts/renderer-command.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flushWorkspaceLayoutMock = vi.hoisted(() => vi.fn(async () => undefined));
const clearCurrentWindowLayoutMock = vi.hoisted(() =>
  vi.fn(async () => undefined)
);

vi.mock("@/lib/workspace/workspace-layout-persistence.ts", () => ({
  flushWorkspaceLayout: flushWorkspaceLayoutMock,
}));

vi.mock("@/stores/workspace-panel-helpers.ts", () => ({
  clearCurrentWindowLayout: clearCurrentWindowLayoutMock,
}));

import {
  clearCorePanelTransferForTests,
  isPanelTransferMovable,
  panelTransferRegistrationOf,
  registerCorePanelTransfer,
} from "@/components/workspace/panel-transfer-adapters.ts";
import {
  restoreEmbeddedTransferPanels,
  rewriteMissingComponentsToUnavailable,
} from "@/components/workspace/panel-transfer-layout-rewrite.ts";
import {
  getFrozenSourceSnapshot,
  isFinalizeRecorded,
  isPanelRelocationSuppressed,
  isWorkspaceBootstrapGateActive,
  recordFinalize,
  releaseWorkspaceBootstrapGate,
  resetPanelTransferRuntimeForTests,
  setWorkspaceBootstrapGate,
} from "@/components/workspace/panel-transfer-runtime.ts";
import {
  __panelTransferInternals,
  createWorkspacePanelTransferHandlers,
  resolvePlacementFromClientPoint,
  runPanelTransferRendererCommand,
} from "@/components/workspace/workspace-panel-transfer.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const TRANSFER_ID = "9af45a46-24f2-4ac0-9371-fbe78ca295dc";

class FakeDataTransfer {
  readonly store = new Map<string, string>();
  effectAllowed = "none";
  dropEffect = "none";
  get types(): string[] {
    return [...this.store.keys()];
  }
  setData(type: string, value: string): void {
    this.store.set(type, value);
  }
  getData(type: string): string {
    return this.store.get(type) ?? "";
  }
  clearData(): void {
    this.store.clear();
  }
}

class FakeDragEvent extends Event {
  dataTransfer: FakeDataTransfer | null;
  clientX: number;
  clientY: number;
  constructor(
    type: string,
    init?: {
      dataTransfer?: FakeDataTransfer | null;
      cancelable?: boolean;
      clientX?: number;
      clientY?: number;
    }
  ) {
    super(type, { bubbles: true, cancelable: init?.cancelable ?? true });
    this.dataTransfer = init?.dataTransfer ?? new FakeDataTransfer();
    this.clientX = init?.clientX ?? 0;
    this.clientY = init?.clientY ?? 0;
  }
}

function installDragGlobals(): void {
  Object.defineProperty(globalThis, "DragEvent", {
    configurable: true,
    value: FakeDragEvent,
  });
  Object.defineProperty(globalThis, "DataTransfer", {
    configurable: true,
    value: FakeDataTransfer,
  });
}

function panel(opts: {
  id: string;
  component: string;
  title?: string;
  params?: Record<string, unknown>;
}) {
  return {
    api: { setActive: vi.fn() },
    id: opts.id,
    title: opts.title ?? opts.id,
    params: opts.params ?? {},
    view: { contentComponent: opts.component },
  };
}

function createApi(panels: ReturnType<typeof panel>[]) {
  const list = [...panels];
  return {
    activeGroup: { id: "group-1", panels: list },
    activePanel: list[0] ?? null,
    groups: [{ id: "group-1", panels: list }],
    addPanel: vi.fn((opts: { id: string; component: string }) => {
      const created = panel({
        component: opts.component,
        id: opts.id,
      });
      list.push(created);
      return created;
    }),
    panels: list,
    removePanel: vi.fn((target: { id: string }) => {
      const index = list.findIndex((entry) => entry.id === target.id);
      if (index >= 0) {
        list.splice(index, 1);
      }
    }),
    get totalPanels() {
      return list.length;
    },
  };
}

function installPier(overrides: Record<string, unknown> = {}) {
  const offer = vi.fn(async () => undefined);
  const drop = vi.fn(async () => undefined);
  const finishDrag = vi.fn(async () => null);
  const cancel = vi.fn(async () => undefined);
  const bootstrap = vi.fn(async () => ({ pending: [] }));
  const ready = vi.fn(async () => ({ ok: true as const }));
  const resolve = vi.fn();
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      panelTransfer: { bootstrap, cancel, drop, finishDrag, offer, ready },
      rendererCommand: { resolve },
      ...overrides,
    },
  });
  return { bootstrap, cancel, drop, finishDrag, offer, ready, resolve };
}

describe("workspace panel transfer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    flushWorkspaceLayoutMock.mockClear();
    clearCurrentWindowLayoutMock.mockClear();
    resetPanelTransferRuntimeForTests();
    clearCorePanelTransferForTests();
    __panelTransferInternals.setActiveDrag(null);
    installDragGlobals();
    useWorkspaceStore.getState().setApi(null);
  });

  afterEach(() => {
    resetPanelTransferRuntimeForTests();
    clearCorePanelTransferForTests();
    __panelTransferInternals.setActiveDrag(null);
    useWorkspaceStore.getState().setApi(null);
    Reflect.deleteProperty(window, "pier");
  });

  describe("onWillDragPanel MIME stamping", () => {
    it("writes MIME + text/plain token only for movable panels", async () => {
      const pier = installPier();
      const welcome = panel({ component: "welcome", id: "welcome-1" });
      const api = createApi([welcome]);
      const handlers = createWorkspacePanelTransferHandlers(() => api as never);
      const dataTransfer = new FakeDataTransfer();
      const native = new FakeDragEvent("dragstart", { dataTransfer });

      handlers.onWillDragPanel({
        nativeEvent: native as unknown as DragEvent,
        panel: welcome as never,
      });

      expect(dataTransfer.getData(PANEL_TRANSFER_MIME)).toContain("welcome-1");
      expect(dataTransfer.getData("text/plain")).toMatch(
        new RegExp(`^${PANEL_TRANSFER_TEXT_PREFIX}`)
      );
      expect(dataTransfer.effectAllowed).toBe("move");
      await vi.waitFor(() => expect(pier.offer).toHaveBeenCalled());
      expect(pier.offer).toHaveBeenCalledWith(
        expect.objectContaining({
          capability: "movable",
          panel: expect.objectContaining({
            componentId: "welcome",
            panelId: "welcome-1",
          }),
        })
      );
    });

    it("does not write tokens for unsupported panels", async () => {
      const pier = installPier();
      const external = panel({
        component: "pier.external.unknown",
        id: "external-1",
      });
      const api = createApi([external]);
      const handlers = createWorkspacePanelTransferHandlers(() => api as never);
      const dataTransfer = new FakeDataTransfer();
      const native = new FakeDragEvent("dragstart", { dataTransfer });

      expect(isPanelTransferMovable("pier.external.unknown")).toBe(false);

      handlers.onWillDragPanel({
        nativeEvent: native as unknown as DragEvent,
        panel: external as never,
      });

      expect(dataTransfer.getData(PANEL_TRANSFER_MIME)).toBe("");
      expect(dataTransfer.getData("text/plain")).toBe("");
      await vi.waitFor(() => expect(pier.offer).toHaveBeenCalled());
      expect(pier.offer).toHaveBeenCalledWith(
        expect.objectContaining({
          capability: "unsupported",
          panel: expect.objectContaining({
            componentId: "pier.external.unknown",
            panelId: "external-1",
          }),
        })
      );
    });
  });

  describe("placement mapping", () => {
    it("resolvePlacementFromDidDrop consumes dockview drop state verbatim", () => {
      const groupPanels = [{ id: "p1" }, { id: "p2" }];
      const group = { id: "group-1", panels: groupPanels };
      const drop = (
        overrides: Partial<{
          group: typeof group | undefined;
          panel: { id: string } | undefined;
          position: string | undefined;
        }>
      ) =>
        __panelTransferInternals.resolvePlacementFromDidDrop({
          group,
          ...overrides,
        });

      // Content center → append tab.
      expect(drop({ position: "center" })).toEqual({
        groupId: "group-1",
        index: 2,
        kind: "tab",
      });

      // Content edge quadrant → split against that group (the quadrant is
      // exactly the overlay dockview showed — no geometry re-derivation).
      expect(drop({ position: "left" })).toEqual({
        direction: "left",
        kind: "split",
        referenceGroupId: "group-1",
      });
      expect(drop({ position: "bottom" })).toEqual({
        direction: "below",
        kind: "split",
        referenceGroupId: "group-1",
      });

      // Header drop: dockview reports center + the tab at the insertion
      // index (left/right tab-half → index already resolved upstream).
      expect(drop({ panel: { id: "p2" }, position: "center" })).toEqual({
        groupId: "group-1",
        index: 1,
        kind: "tab",
      });

      // Root drop target: edge positions split the whole grid.
      expect(drop({ group: undefined, position: "center" })).toEqual({
        kind: "root",
      });
      expect(drop({ group: undefined, position: "right" })).toEqual({
        direction: "right",
        kind: "split",
      });
    });

    it("resolvePlacementFromClientPoint mirrors dockview overlay activation", () => {
      const rect = (r: {
        left: number;
        top: number;
        right: number;
        bottom: number;
      }) => ({
        ...r,
        height: r.bottom - r.top,
        width: r.right - r.left,
        x: r.left,
        y: r.top,
      });
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
      groupEl.append(tabsRoot, contentEl);
      Object.defineProperty(groupEl, "getBoundingClientRect", {
        value: () => rect({ bottom: 500, left: 0, right: 400, top: 0 }),
      });

      const api = {
        groups: [
          {
            element: groupEl,
            id: "group-1",
            panels: [{ id: "p1" }, { id: "p2" }],
          },
        ],
      };

      expect(resolvePlacementFromClientPoint(api as never, 30, 20)).toEqual({
        groupId: "group-1",
        index: 0,
        kind: "tab",
      });
      expect(resolvePlacementFromClientPoint(api as never, 90, 20)).toEqual({
        groupId: "group-1",
        index: 1,
        kind: "tab",
      });

      // Content center (inner 60% per axis) → append tab.
      expect(resolvePlacementFromClientPoint(api as never, 200, 250)).toEqual({
        groupId: "group-1",
        index: 2,
        kind: "tab",
      });

      // 20%-per-axis quadrants over the content element (400×460 starting
      // at y=40), matching dockview's DEFAULT_ACTIVATION_SIZE. x=60 is 15%
      // of the width — inside the overlay's split zone but outside the old
      // 48px band (the WYSIWYG regression this mirrors).
      expect(resolvePlacementFromClientPoint(api as never, 60, 250)).toEqual({
        direction: "left",
        kind: "split",
        referenceGroupId: "group-1",
      });
      expect(resolvePlacementFromClientPoint(api as never, 390, 250)).toEqual({
        direction: "right",
        kind: "split",
        referenceGroupId: "group-1",
      });
      // y=60 is 4% of the content height (measured from the content top,
      // not the group top which includes the tab strip).
      expect(resolvePlacementFromClientPoint(api as never, 200, 60)).toEqual({
        direction: "above",
        kind: "split",
        referenceGroupId: "group-1",
      });
      expect(resolvePlacementFromClientPoint(api as never, 200, 480)).toEqual({
        direction: "below",
        kind: "split",
        referenceGroupId: "group-1",
      });

      expect(resolvePlacementFromClientPoint(api as never, 900, 900)).toEqual({
        kind: "root",
      });
    });
  });

  describe("drag lifecycle", () => {
    it("calls finishDrag on dragend", async () => {
      const pier = installPier();
      const handlers = createWorkspacePanelTransferHandlers(() => null);
      __panelTransferInternals.setActiveDrag({
        capability: "movable",
        componentId: "welcome",
        panelId: "welcome-1",
        transferId: TRANSFER_ID,
      });

      handlers.onDragEnd(TRANSFER_ID);
      await vi.waitFor(() =>
        expect(pier.finishDrag).toHaveBeenCalledWith(TRANSFER_ID)
      );
      expect(__panelTransferInternals.getActiveDrag()).toBeNull();
    });

    it("onWillDrop suppresses dockview's stale dragend commit only for outside releases", () => {
      installPier();
      const handlers = createWorkspacePanelTransferHandlers(() => null);

      // Release outside the viewport (desktop / another window): the sticky
      // overlay armed by dndOverlayMounting "absolute" must not commit an
      // in-window move — the bounds channel owns the outcome.
      const outside = new FakeDragEvent("dragend", {
        clientX: -40,
        clientY: 200,
      });
      const outsidePrevent = vi.fn();
      handlers.onWillDrop({
        nativeEvent: outside as unknown as DragEvent,
        preventDefault: outsidePrevent,
      });
      expect(outsidePrevent).toHaveBeenCalledTimes(1);

      // Release beyond the far edge is outside too.
      const farOutside = new FakeDragEvent("dragend", {
        clientX: window.innerWidth + 60,
        clientY: 10,
      });
      const farPrevent = vi.fn();
      handlers.onWillDrop({
        nativeEvent: farOutside as unknown as DragEvent,
        preventDefault: farPrevent,
      });
      expect(farPrevent).toHaveBeenCalledTimes(1);

      // In-window release keeps dockview's sticky-overlay dragend commit.
      const inside = new FakeDragEvent("dragend", {
        clientX: 100,
        clientY: 100,
      });
      const insidePrevent = vi.fn();
      handlers.onWillDrop({
        nativeEvent: inside as unknown as DragEvent,
        preventDefault: insidePrevent,
      });
      expect(insidePrevent).not.toHaveBeenCalled();

      // Real drop events are never suppressed regardless of coordinates.
      const realDrop = new FakeDragEvent("drop", {
        clientX: -40,
        clientY: -40,
      });
      const dropPrevent = vi.fn();
      handlers.onWillDrop({
        nativeEvent: realDrop as unknown as DragEvent,
        preventDefault: dropPrevent,
      });
      expect(dropPrevent).not.toHaveBeenCalled();
    });

    it("onWillDragPanel returns transferId after stamping MIME", () => {
      installPier();
      const welcome = panel({ component: "welcome", id: "welcome-1" });
      const api = createApi([welcome]);
      const handlers = createWorkspacePanelTransferHandlers(() => api as never);
      const dataTransfer = new FakeDataTransfer();
      const native = new FakeDragEvent("dragstart", { dataTransfer });

      const transferId = handlers.onWillDragPanel({
        nativeEvent: native as unknown as DragEvent,
        panel: welcome as never,
      });

      expect(transferId).toEqual(expect.any(String));
      expect(dataTransfer.getData("text/plain")).toBe(
        `${PANEL_TRANSFER_TEXT_PREFIX}${transferId}`
      );
      expect(__panelTransferInternals.getActiveDrag()?.transferId).toBe(
        transferId
      );
    });

    it("foreign onDidDrop claims via pier.drop with dockview's drop state", async () => {
      const pier = installPier();
      const api = createApi([panel({ component: "welcome", id: "welcome-1" })]);
      const handlers = createWorkspacePanelTransferHandlers(() => api as never);
      expect(__panelTransferInternals.getActiveDrag()).toBeNull();

      const foreignId = "9af45a46-24f2-4ac0-9371-fbe78ca295dd";
      const dataTransfer = new FakeDataTransfer();
      dataTransfer.setData(
        PANEL_TRANSFER_MIME,
        JSON.stringify({ transferId: foreignId })
      );

      // Edge-quadrant drop on a group → split claim (the overlay quadrant
      // dockview reported is consumed verbatim — cross-window split).
      handlers.onDidDrop({
        group: { id: "group-1", panels: api.panels },
        nativeEvent: new FakeDragEvent("drop", {
          dataTransfer,
        }) as unknown as DragEvent,
        position: "left",
      } as never);
      await vi.waitFor(() =>
        expect(pier.drop).toHaveBeenCalledWith({
          placement: {
            direction: "left",
            kind: "split",
            referenceGroupId: "group-1",
          },
          transferId: foreignId,
        })
      );

      // Group-less drop (root drop target, empty-grid center) → root.
      pier.drop.mockClear();
      handlers.onDidDrop({
        nativeEvent: new FakeDragEvent("drop", {
          dataTransfer,
        }) as unknown as DragEvent,
      } as never);
      await vi.waitFor(() =>
        expect(pier.drop).toHaveBeenCalledWith({
          placement: { kind: "root" },
          transferId: foreignId,
        })
      );
    });

    it("same-window active drag never claims via onDidDrop", async () => {
      const pier = installPier();
      const api = createApi([panel({ component: "welcome", id: "welcome-1" })]);
      const handlers = createWorkspacePanelTransferHandlers(() => api as never);
      __panelTransferInternals.setActiveDrag({
        capability: "movable",
        componentId: "welcome",
        panelId: "welcome-1",
        transferId: TRANSFER_ID,
      });

      const dataTransfer = new FakeDataTransfer();
      dataTransfer.setData(
        PANEL_TRANSFER_MIME,
        JSON.stringify({ transferId: TRANSFER_ID })
      );
      handlers.onDidDrop({
        nativeEvent: new FakeDragEvent("drop", {
          dataTransfer,
        }) as unknown as DragEvent,
      } as never);

      await Promise.resolve();
      expect(pier.drop).not.toHaveBeenCalled();
    });

    it("accepts foreign unhandled dragover so Dockview can show its overlay", () => {
      installPier();
      const handlers = createWorkspacePanelTransferHandlers(() => null);
      const dataTransfer = new FakeDataTransfer();
      dataTransfer.setData(PANEL_TRANSFER_MIME, "{}");
      const native = new FakeDragEvent("dragover", { dataTransfer });
      const accept = vi.fn();
      const preventSpy = vi.spyOn(native, "preventDefault");

      handlers.onUnhandledDragOver({
        accept,
        nativeEvent: native as unknown as DragEvent,
      } as never);

      expect(preventSpy).toHaveBeenCalled();
      expect(dataTransfer.dropEffect).toBe("move");
      expect(accept).toHaveBeenCalled();

      // Local drags stay with Dockview.
      __panelTransferInternals.setActiveDrag({
        capability: "movable",
        componentId: "welcome",
        panelId: "welcome-1",
        transferId: TRANSFER_ID,
      });
      const acceptLocal = vi.fn();
      handlers.onUnhandledDragOver({
        accept: acceptLocal,
        nativeEvent: new FakeDragEvent("dragover", {
          dataTransfer,
        }) as unknown as DragEvent,
      } as never);
      expect(acceptLocal).not.toHaveBeenCalled();
    });
  });

  describe("renderer commands", () => {
    it("prepareSource freezes a snapshot and enables relocation suppression", async () => {
      const pier = installPier();
      const welcome = panel({
        component: "welcome",
        id: "welcome-1",
        params: { note: "hi" },
      });
      const api = createApi([welcome]);
      useWorkspaceStore.getState().setApi(api as never);

      const handled = await runPanelTransferRendererCommand({
        command: {
          sourcePanelId: "welcome-1",
          transferId: TRANSFER_ID,
          type: "panelTransfer.prepareSource",
        },
        requestId: "prepare-1",
      });

      expect(handled).toBe(true);
      expect(getFrozenSourceSnapshot(TRANSFER_ID)).toMatchObject({
        panel: {
          componentId: "welcome",
          panelId: "welcome-1",
          params: { note: "hi" },
        },
        prepared: { drafts: [] },
        runtimeKind: "web",
      });
      expect(isPanelRelocationSuppressed()).toBe(true);
      expect(pier.resolve).toHaveBeenCalledWith({
        data: {
          panel: {
            componentId: "welcome",
            panelId: "welcome-1",
            params: { note: "hi" },
            title: "welcome-1",
          },
          prepared: { drafts: [] },
          runtimeKind: "web",
        },
        ok: true,
        requestId: "prepare-1",
      });
    });

    it("stageTarget adds an inert panel with nested position.index for tabs", async () => {
      const pier = installPier();
      const existing = panel({ component: "welcome", id: "welcome-keep" });
      const api = createApi([existing]);
      useWorkspaceStore.getState().setApi(api as never);

      await runPanelTransferRendererCommand({
        command: {
          panel: {
            componentId: "welcome",
            panelId: "welcome-moved",
            params: { from: "source" },
            title: "Welcome",
          },
          placement: { groupId: "group-1", index: 1, kind: "tab" },
          prepared: { drafts: [] },
          targetPanelId: "welcome-moved",
          transferId: TRANSFER_ID,
          type: "panelTransfer.stageTarget",
        },
        requestId: "stage-1",
      });

      expect(api.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          component: "welcome",
          id: "welcome-moved",
          inactive: true,
          position: {
            direction: "within",
            index: 1,
            referenceGroup: "group-1",
          },
          title: "Welcome",
        })
      );
      expect(flushWorkspaceLayoutMock).toHaveBeenCalled();
      expect(pier.resolve).toHaveBeenCalledWith({
        data: null,
        ok: true,
        requestId: "stage-1",
      });
    });

    it("finalize(target, commit) activates the staged panel and blocks late gate sets", async () => {
      const pier = installPier();
      const existing = panel({ component: "welcome", id: "welcome-keep" });
      const api = createApi([existing]);
      useWorkspaceStore.getState().setApi(api as never);

      await runPanelTransferRendererCommand({
        command: {
          panel: {
            componentId: "welcome",
            panelId: "welcome-moved",
            title: "Welcome",
          },
          placement: { kind: "root" },
          prepared: { drafts: [] },
          targetPanelId: "welcome-moved",
          transferId: TRANSFER_ID,
          type: "panelTransfer.stageTarget",
        },
        requestId: "stage-activate",
      });

      await runPanelTransferRendererCommand({
        command: {
          outcome: "commit",
          role: "target",
          transferId: TRANSFER_ID,
          type: "panelTransfer.finalize",
        },
        requestId: "finalize-activate",
      });

      const staged = api.panels.find((p) => p.id === "welcome-moved");
      // Moved panels land active — the sole panel of a fresh transfer window
      // must not stay inactive/blank.
      expect(staged?.api.setActive).toHaveBeenCalled();
      expect(pier.resolve).toHaveBeenCalledWith({
        data: null,
        ok: true,
        requestId: "finalize-activate",
      });

      // Race guard: the transfer-startup boot path setting the gate AFTER
      // finalize already released it must be a no-op (tombstoned).
      setWorkspaceBootstrapGate(TRANSFER_ID, "awaiting-stage-target");
      expect(isWorkspaceBootstrapGateActive()).toBe(false);
    });

    it("releaseSource removes under suppression and clears layout when last panel", async () => {
      const pier = installPier();
      const only = panel({ component: "welcome", id: "welcome-1" });
      const api = createApi([only]);
      useWorkspaceStore.getState().setApi(api as never);

      await runPanelTransferRendererCommand({
        command: {
          sourcePanelId: "welcome-1",
          transferId: TRANSFER_ID,
          type: "panelTransfer.releaseSource",
        },
        requestId: "release-1",
      });

      expect(api.removePanel).toHaveBeenCalledWith(only);
      expect(clearCurrentWindowLayoutMock).toHaveBeenCalled();
      expect(flushWorkspaceLayoutMock).not.toHaveBeenCalled();
      expect(pier.resolve).toHaveBeenCalledWith({
        data: null,
        ok: true,
        requestId: "release-1",
      });
    });

    it("releaseSource flushes when other panels remain", async () => {
      installPier();
      const keep = panel({ component: "welcome", id: "welcome-keep" });
      const moving = panel({ component: "welcome", id: "welcome-1" });
      const api = createApi([keep, moving]);
      useWorkspaceStore.getState().setApi(api as never);

      await runPanelTransferRendererCommand({
        command: {
          sourcePanelId: "welcome-1",
          transferId: TRANSFER_ID,
          type: "panelTransfer.releaseSource",
        },
        requestId: "release-2",
      });

      expect(api.removePanel).toHaveBeenCalledWith(moving);
      expect(clearCurrentWindowLayoutMock).not.toHaveBeenCalled();
      expect(flushWorkspaceLayoutMock).toHaveBeenCalled();
    });

    it("finalize is idempotent for the same key and rejects conflicting outcomes", async () => {
      const pier = installPier();
      const welcome = panel({ component: "welcome", id: "welcome-1" });
      const api = createApi([welcome]);
      useWorkspaceStore.getState().setApi(api as never);

      await runPanelTransferRendererCommand({
        command: {
          sourcePanelId: "welcome-1",
          transferId: TRANSFER_ID,
          type: "panelTransfer.prepareSource",
        },
        requestId: "prepare-before-finalize",
      });

      const first = await runPanelTransferRendererCommand({
        command: {
          outcome: "commit",
          role: "source",
          transferId: TRANSFER_ID,
          type: "panelTransfer.finalize",
        },
        requestId: "finalize-1",
      });
      expect(first).toBe(true);
      expect(pier.resolve).toHaveBeenCalledWith({
        data: null,
        ok: true,
        requestId: "finalize-1",
      });
      expect(isPanelRelocationSuppressed()).toBe(false);
      expect(getFrozenSourceSnapshot(TRANSFER_ID)).toBeNull();

      const recorded = recordFinalize(
        TRANSFER_ID,
        "finalize",
        "source",
        "commit"
      );
      expect(recorded.alreadyRecorded).toBe(false);
      expect(
        isFinalizeRecorded(TRANSFER_ID, "finalize", "source", "commit")
      ).toBe(true);
      expect(
        recordFinalize(TRANSFER_ID, "finalize", "source", "commit")
      ).toEqual({ alreadyRecorded: true, conflictingOutcome: null });
      expect(
        recordFinalize(TRANSFER_ID, "finalize", "source", "abort")
      ).toEqual({ alreadyRecorded: false, conflictingOutcome: "commit" });

      pier.resolve.mockClear();
      const conflicting = await runPanelTransferRendererCommand({
        command: {
          outcome: "abort",
          role: "source",
          transferId: TRANSFER_ID,
          type: "panelTransfer.finalize",
        },
        requestId: "finalize-conflict",
      });
      expect(conflicting).toBe(true);
      expect(pier.resolve).toHaveBeenCalledWith({
        error: {
          message: expect.stringContaining("conflicting outcome"),
        },
        ok: false,
        requestId: "finalize-conflict",
      });
    });
  });

  describe("bootstrap gate + placeholder rewrite", () => {
    it("blocks via active gate flag until released", () => {
      expect(isWorkspaceBootstrapGateActive()).toBe(false);
      setWorkspaceBootstrapGate(TRANSFER_ID, "pending-transfer-restore");
      expect(isWorkspaceBootstrapGateActive()).toBe(true);
      releaseWorkspaceBootstrapGate();
      expect(isWorkspaceBootstrapGateActive()).toBe(false);
    });

    it("short-circuits workspace store add/close mutations while gate active", async () => {
      const welcome = panel({ component: "welcome", id: "welcome-1" });
      const api = {
        activePanel: welcome,
        addPanel: vi.fn(),
        panels: [welcome],
        removePanel: vi.fn(),
        totalPanels: 1,
      };
      useWorkspaceStore.getState().setApi(api as never);
      setWorkspaceBootstrapGate(TRANSFER_ID, "pending-transfer-restore");

      useWorkspaceStore.getState().addPanel({
        component: "welcome",
        id: "welcome-blocked",
        title: "Blocked",
      });
      expect(useWorkspaceStore.getState().addTerminal()).toBeNull();
      expect(await useWorkspaceStore.getState().closePanel("welcome-1")).toBe(
        false
      );
      expect(await useWorkspaceStore.getState().closeActivePanel()).toBe(false);
      expect(api.addPanel).not.toHaveBeenCalled();
      expect(api.removePanel).not.toHaveBeenCalled();

      releaseWorkspaceBootstrapGate();
    });

    it("rewrites missing components to placeholders and restores when known again", () => {
      const layout = {
        grid: { root: { data: [], type: "branch" } },
        panels: {
          "missing-1": {
            contentComponent: "pier.missing.plugin",
            id: "missing-1",
            params: { path: "/tmp/a" },
            title: "Missing",
          },
        },
      };

      const rewritten = rewriteMissingComponentsToUnavailable(layout as never, {
        knownComponents: new Set(["welcome", "terminal"]),
        role: "target",
      });
      expect(rewritten.rewritten).toBe(true);
      const placeholder = (
        rewritten.layout.panels as unknown as Record<
          string,
          Record<string, unknown>
        >
      )["missing-1"];
      expect(placeholder?.contentComponent).toBe("panel-transfer-unavailable");
      expect(placeholder?.params).toMatchObject({
        originalDescriptor: {
          componentId: "pier.missing.plugin",
          panelId: "missing-1",
          title: "Missing",
        },
        transferRole: "target",
      });

      const restored = restoreEmbeddedTransferPanels(
        rewritten.layout,
        new Set(["pier.missing.plugin", "welcome"])
      );
      expect(restored.restored).toBe(true);
      const panelState = (
        restored.layout.panels as unknown as Record<
          string,
          Record<string, unknown>
        >
      )["missing-1"];
      expect(panelState?.contentComponent).toBe("pier.missing.plugin");
      expect(panelState?.params).toEqual({ path: "/tmp/a" });
    });
  });

  describe("custom registration prepare", () => {
    it("invokes custom prepareSource when registered", async () => {
      installPier();
      const prepareSource = vi.fn(async () => ({
        drafts: [{ sourceKey: "a", targetKey: "b" }],
        state: { marker: true },
      }));
      registerCorePanelTransfer("pier.test.custom", {
        finalize: vi.fn(async () => undefined),
        kind: "custom",
        prepareSource,
        restore: vi.fn(async () => undefined),
        stageTarget: vi.fn(async () => undefined),
      });
      expect(panelTransferRegistrationOf("pier.test.custom")?.kind).toBe(
        "custom"
      );

      const custom = panel({
        component: "pier.test.custom",
        id: "custom-1",
        params: { scope: "x" },
      });
      const api = createApi([custom]);
      useWorkspaceStore.getState().setApi(api as never);

      await runPanelTransferRendererCommand({
        command: {
          sourcePanelId: "custom-1",
          transferId: TRANSFER_ID,
          type: "panelTransfer.prepareSource",
        },
        requestId: "prepare-custom",
      } as RendererCommandEnvelope);

      expect(prepareSource).toHaveBeenCalledWith({
        panelId: "custom-1",
        params: { scope: "x" },
        transferId: TRANSFER_ID,
      });
      expect(getFrozenSourceSnapshot(TRANSFER_ID)?.prepared).toEqual({
        drafts: [{ sourceKey: "a", targetKey: "b" }],
        state: { marker: true },
      });
    });

    it("stageTarget merges custom adapter params over offered source params", async () => {
      installPier();
      registerCorePanelTransfer("pier.test.custom-stage", {
        finalize: vi.fn(async () => undefined),
        kind: "custom",
        prepareSource: vi.fn(async () => ({ drafts: [] })),
        restore: vi.fn(async () => undefined),
        stageTarget: vi.fn(async () => ({
          params: { source: { id: "rewritten" } },
        })),
      });
      const api = createApi([]);
      useWorkspaceStore.getState().setApi(api as never);

      const offeredContext = { contextId: "ctx:a", cwd: "/repo" };
      await runPanelTransferRendererCommand({
        command: {
          panel: {
            componentId: "pier.test.custom-stage",
            panelId: "custom-stage-1",
            params: {
              context: offeredContext,
              pinned: true,
              source: { id: "original" },
            },
            title: "Doc",
          },
          placement: { kind: "root" },
          prepared: { drafts: [] },
          targetPanelId: "custom-stage-1",
          transferId: TRANSFER_ID,
          type: "panelTransfer.stageTarget",
        },
        requestId: "stage-custom-merge",
      } as RendererCommandEnvelope);

      // Adapter output patches (source rewritten) but must not drop shared
      // params like the workspace context anchor or pinned state.
      expect(api.addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "custom-stage-1",
          params: {
            context: offeredContext,
            pinned: true,
            source: { id: "rewritten" },
          },
        })
      );
    });
  });
});
