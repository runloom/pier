import { PANEL_TRANSFER_MIME } from "@shared/contracts/panel-transfer.ts";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCorePanelTransferForTests } from "@/components/workspace/panel-transfer-adapters.ts";
import {
  isWorkspaceBootstrapGateActive,
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

const flushWorkspaceLayoutMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/workspace/workspace-layout-persistence.ts", () => ({
  flushWorkspaceLayout: flushWorkspaceLayoutMock,
}));

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
}

class FakeDragEvent extends Event {
  dataTransfer: FakeDataTransfer | null;
  clientX: number;
  constructor(
    type: string,
    init?: {
      dataTransfer?: FakeDataTransfer | null;
      clientX?: number;
      cancelable?: boolean;
    }
  ) {
    super(type, { bubbles: true, cancelable: init?.cancelable ?? true });
    this.dataTransfer = init?.dataTransfer ?? new FakeDataTransfer();
    this.clientX = init?.clientX ?? 0;
  }
}

function installDragGlobals(): void {
  Object.defineProperty(globalThis, "DragEvent", {
    configurable: true,
    value: FakeDragEvent,
  });
}

function panel(opts: { id: string; component: string }) {
  return {
    id: opts.id,
    title: opts.id,
    params: {},
    view: { contentComponent: opts.component },
  };
}

describe("workspace panel transfer (component)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    flushWorkspaceLayoutMock.mockClear();
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

  it("bootstrap gate blocks flagged user mutations while transfer commands still run", async () => {
    const resolve = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        rendererCommand: { resolve },
      },
    });

    setWorkspaceBootstrapGate(TRANSFER_ID, "pending-transfer-restore");
    expect(isWorkspaceBootstrapGateActive()).toBe(true);
    expect(!isWorkspaceBootstrapGateActive()).toBe(false);

    const existing = panel({ component: "welcome", id: "welcome-keep" });
    const api = {
      activeGroup: { id: "group-1", panels: [existing] },
      addPanel: vi.fn(),
      panels: [existing],
      removePanel: vi.fn(),
      totalPanels: 1,
    };
    useWorkspaceStore.getState().setApi(api as never);

    const handled = await runPanelTransferRendererCommand({
      command: {
        panel: {
          componentId: "welcome",
          panelId: "welcome-staged",
          title: "Welcome",
        },
        placement: { kind: "root" },
        prepared: { drafts: [] },
        targetPanelId: "welcome-staged",
        transferId: TRANSFER_ID,
        type: "panelTransfer.stageTarget",
      },
      requestId: "stage-while-gated",
    });

    expect(handled).toBe(true);
    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "welcome",
        id: "welcome-staged",
        inactive: true,
      })
    );
    expect(isWorkspaceBootstrapGateActive()).toBe(true);

    // User mutation paths are gated while transfer stage still works.
    const addCallsBefore = api.addPanel.mock.calls.length;
    useWorkspaceStore.getState().addPanel({
      component: "welcome",
      id: "user-blocked",
      title: "Blocked",
    });
    expect(useWorkspaceStore.getState().addTerminal()).toBeNull();
    expect(api.addPanel.mock.calls.length).toBe(addCallsBefore);

    releaseWorkspaceBootstrapGate();
    expect(isWorkspaceBootstrapGateActive()).toBe(false);
  });

  it("releases the gate after target-active ready settles", async () => {
    const ready = vi.fn(async () => ({ ok: true as const }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        panelTransfer: { ready },
      },
    });

    setWorkspaceBootstrapGate(TRANSFER_ID, "pending-transfer-restore");
    const result = await window.pier.panelTransfer.ready(TRANSFER_ID);
    expect(result).toEqual({ ok: true });
    releaseWorkspaceBootstrapGate();
    expect(isWorkspaceBootstrapGateActive()).toBe(false);
    expect(ready).toHaveBeenCalledWith(TRANSFER_ID);
  });

  it("inert staged panel options keep inactive:true (no real content flash)", async () => {
    const resolve = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        rendererCommand: { resolve },
      },
    });
    const existing = panel({ component: "welcome", id: "welcome-keep" });
    const api = {
      addPanel: vi.fn(),
      panels: [existing],
      removePanel: vi.fn(),
      totalPanels: 1,
    };
    useWorkspaceStore.getState().setApi(api as never);

    await runPanelTransferRendererCommand({
      command: {
        panel: {
          componentId: "welcome",
          panelId: "welcome-inert",
          title: "Welcome",
        },
        placement: { groupId: "group-1", index: 0, kind: "tab" },
        prepared: { drafts: [] },
        targetPanelId: "welcome-inert",
        transferId: TRANSFER_ID,
        type: "panelTransfer.stageTarget",
      },
      requestId: "inert-stage",
    });

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "welcome-inert",
        inactive: true,
      })
    );

    function InertProbe({ inactive }: { inactive: boolean }) {
      return inactive ? (
        <div data-testid="inert-skeleton" />
      ) : (
        <div data-testid="real-content">live</div>
      );
    }
    const staged = api.addPanel.mock.calls[0]?.[0] as { inactive?: boolean };
    const view = render(<InertProbe inactive={staged?.inactive === true} />);
    expect(view.getByTestId("inert-skeleton")).toBeTruthy();
    expect(view.queryByTestId("real-content")).toBeNull();
  });

  it("dual-channel handlers: dragend finishes, foreign drop claims, local drop skips", async () => {
    const finishDrag = vi.fn(async () => null);
    const drop = vi.fn(async () => ({ ok: true, targetPanelId: "p" }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        panelTransfer: {
          cancel: vi.fn(),
          drop,
          finishDrag,
          offer: vi.fn(),
        },
      },
    });

    const handlers = createWorkspacePanelTransferHandlers(() => null);
    expect(handlers).toHaveProperty("onWillDragPanel");
    expect(handlers).toHaveProperty("onDragEnd");
    expect(handlers).toHaveProperty("onDidDrop");
    expect(handlers).toHaveProperty("onUnhandledDragOver");

    __panelTransferInternals.setActiveDrag({
      capability: "movable",
      componentId: "welcome",
      panelId: "welcome-1",
      transferId: TRANSFER_ID,
    });
    handlers.onDragEnd(TRANSFER_ID);
    await vi.waitFor(() =>
      expect(finishDrag).toHaveBeenCalledWith(TRANSFER_ID)
    );

    // Local drag active → foreign drop path must not claim.
    __panelTransferInternals.setActiveDrag({
      capability: "movable",
      componentId: "welcome",
      panelId: "welcome-1",
      transferId: TRANSFER_ID,
    });
    const localTransfer = new FakeDataTransfer();
    localTransfer.setData(
      PANEL_TRANSFER_MIME,
      JSON.stringify({ transferId: TRANSFER_ID })
    );
    handlers.onDidDrop({
      nativeEvent: new FakeDragEvent("drop", {
        dataTransfer: localTransfer,
      }) as unknown as DragEvent,
    } as never);
    await Promise.resolve();
    expect(drop).not.toHaveBeenCalled();
  });
});
