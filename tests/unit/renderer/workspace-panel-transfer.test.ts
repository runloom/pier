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
  constructor(
    type: string,
    init?: { dataTransfer?: FakeDataTransfer | null; cancelable?: boolean }
  ) {
    super(type, { bubbles: true, cancelable: init?.cancelable ?? true });
    this.dataTransfer = init?.dataTransfer ?? new FakeDataTransfer();
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
    it("maps center+group → tab end, edge → split, no group → root", () => {
      const api = createApi([
        panel({ component: "welcome", id: "welcome-1" }),
        panel({ component: "welcome", id: "welcome-2" }),
      ]);
      const group = {
        id: "group-1",
        panels: api.panels,
      };

      expect(
        __panelTransferInternals.computePlacementFromDrop(
          {
            group: group as never,
            nativeEvent: new FakeDragEvent("drop") as unknown as DragEvent,
            position: "center",
          },
          "welcome-1",
          api as never
        )
      ).toEqual({ groupId: "group-1", index: 2, kind: "tab" });

      expect(
        __panelTransferInternals.computePlacementFromDrop(
          {
            group: group as never,
            nativeEvent: new FakeDragEvent("drop") as unknown as DragEvent,
            position: "left",
          },
          "welcome-1",
          api as never
        )
      ).toEqual({
        direction: "left",
        kind: "split",
        referenceGroupId: "group-1",
      });

      expect(
        __panelTransferInternals.computePlacementFromDrop(
          {
            group: undefined,
            nativeEvent: new FakeDragEvent("drop") as unknown as DragEvent,
            position: "center",
          },
          "welcome-1",
          api as never
        )
      ).toEqual({ kind: "root" });
    });
  });

  describe("drag lifecycle", () => {
    it("calls finishDrag on dragend and cancel on Escape", async () => {
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

      __panelTransferInternals.setActiveDrag({
        capability: "movable",
        componentId: "welcome",
        panelId: "welcome-1",
        transferId: TRANSFER_ID,
      });
      handlers.onEscape(TRANSFER_ID);
      await vi.waitFor(() =>
        expect(pier.cancel).toHaveBeenCalledWith(TRANSFER_ID)
      );
      expect(__panelTransferInternals.getActiveDrag()).toBeNull();
    });

    it("accepts unhandled dragover when MIME types are present", () => {
      const handlers = createWorkspacePanelTransferHandlers(() => null);
      const dataTransfer = new FakeDataTransfer();
      dataTransfer.setData(PANEL_TRANSFER_MIME, "{}");
      const native = new FakeDragEvent("dragover", { dataTransfer });
      const accept = vi.fn();
      const preventSpy = vi.spyOn(native, "preventDefault");

      handlers.onUnhandledDragOver({
        accept,
        nativeEvent: native as unknown as DragEvent,
      });

      expect(preventSpy).toHaveBeenCalled();
      expect(dataTransfer.dropEffect).toBe("move");
      expect(accept).toHaveBeenCalled();
    });

    it("skips unhandled dragover accept when local activeDrag is set", () => {
      const handlers = createWorkspacePanelTransferHandlers(() => null);
      __panelTransferInternals.setActiveDrag({
        capability: "movable",
        componentId: "welcome",
        panelId: "welcome-1",
        transferId: TRANSFER_ID,
      });
      const dataTransfer = new FakeDataTransfer();
      dataTransfer.setData(PANEL_TRANSFER_MIME, "{}");
      const native = new FakeDragEvent("dragover", { dataTransfer });
      const accept = vi.fn();
      const preventSpy = vi.spyOn(native, "preventDefault");

      handlers.onUnhandledDragOver({
        accept,
        nativeEvent: native as unknown as DragEvent,
      });

      expect(preventSpy).not.toHaveBeenCalled();
      expect(accept).not.toHaveBeenCalled();
    });

    it("same-window onDidDrop does not call panelTransfer.drop", async () => {
      const pier = installPier();
      const welcome = panel({ component: "welcome", id: "welcome-1" });
      const api = {
        panels: [welcome],
        removePanel: vi.fn(),
        totalPanels: 1,
      };
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
      const native = new FakeDragEvent("drop", { dataTransfer });

      handlers.onDidDrop({
        group: { id: "group-1", panels: [welcome] } as never,
        nativeEvent: native as unknown as DragEvent,
        position: "center",
      });

      await Promise.resolve();
      expect(pier.drop).not.toHaveBeenCalled();
    });

    it("foreign onDidDrop parses MIME transferId and reports placement", async () => {
      const pier = installPier();
      const welcome = panel({ component: "welcome", id: "welcome-1" });
      const api = {
        panels: [welcome],
        removePanel: vi.fn(),
        totalPanels: 1,
      };
      const handlers = createWorkspacePanelTransferHandlers(() => api as never);
      expect(__panelTransferInternals.getActiveDrag()).toBeNull();

      const foreignId = "foreign-transfer-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const dataTransfer = new FakeDataTransfer();
      dataTransfer.setData(
        PANEL_TRANSFER_MIME,
        JSON.stringify({ transferId: foreignId })
      );
      dataTransfer.setData(
        "text/plain",
        `${PANEL_TRANSFER_TEXT_PREFIX}${foreignId}`
      );
      const native = new FakeDragEvent("drop", { dataTransfer });

      handlers.onDidDrop({
        group: { id: "group-1", panels: [welcome] } as never,
        nativeEvent: native as unknown as DragEvent,
        position: "center",
      });

      await vi.waitFor(() =>
        expect(pier.drop).toHaveBeenCalledWith({
          placement: { groupId: "group-1", index: 1, kind: "tab" },
          transferId: foreignId,
        })
      );
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
  });
});
