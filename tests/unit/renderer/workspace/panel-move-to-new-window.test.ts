import { beforeEach, describe, expect, it, vi } from "vitest";

const offer = vi.fn();
const relocate = vi.fn();
const showAppAlert = vi.fn();
const listOtherWindowInfos = vi.fn();
const isPanelTransferMovable = vi.fn((_componentId?: string) => true);
const isPanelTransferCopyableComponent = vi.fn(
  (componentId: string) => componentId === "pier.files.filePanel"
);

const panels = [
  {
    id: "panel-welcome",
    params: { foo: "bar" },
    title: "Welcome",
    view: { contentComponent: "welcome" },
  },
  {
    id: "panel-files",
    params: { path: "/tmp/a.ts" },
    title: "a.ts",
    view: { contentComponent: "pier.files.filePanel" },
  },
];

vi.mock("@shared/contracts/panel-transfer.ts", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@shared/contracts/panel-transfer.ts")
    >();
  return {
    ...actual,
    isPanelTransferCopyableComponent: (componentId: string) =>
      isPanelTransferCopyableComponent(componentId),
  };
});

vi.mock("@/components/workspace/transfer/adapters.ts", () => ({
  isPanelTransferMovable: (componentId: string) =>
    isPanelTransferMovable(componentId),
}));

vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppAlert: (input: unknown) => showAppAlert(input),
}));

vi.mock("@/components/workspace/transfer/pick-window.ts", () => ({
  listOtherWindowInfos,
}));

vi.mock("@/stores/workspace.store.ts", () => ({
  useWorkspaceStore: {
    getState: () => ({
      api: {
        activePanel: { id: "panel-welcome" },
        panels,
      },
    }),
  },
}));

vi.mock("i18next", () => ({
  default: {
    getFixedT: () => (key: string) => key,
    language: "en",
    t: (key: string) => key,
  },
}));

describe("panel relocate commands", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    isPanelTransferMovable.mockReturnValue(true);
    isPanelTransferCopyableComponent.mockImplementation(
      (componentId: string) => componentId === "pier.files.filePanel"
    );
    listOtherWindowInfos.mockReset();
    listOtherWindowInfos.mockResolvedValue([]);
    offer.mockResolvedValue({ accepted: true });
    relocate.mockResolvedValue({ ok: true, targetPanelId: "panel-welcome" });
    (globalThis as { window?: { pier?: { panelTransfer?: unknown } } }).window =
      {
        pier: {
          panelTransfer: {
            offer,
            relocate,
          },
        },
      };
  });

  it("offers a move transfer and relocates into a new window", async () => {
    const { movePanelToNewWindow } = await import(
      "@/components/workspace/transfer/relocate.ts"
    );
    await movePanelToNewWindow("panel-welcome");
    expect(offer).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "movable",
        mode: "move",
        panel: expect.objectContaining({
          componentId: "welcome",
          panelId: "panel-welcome",
          title: "Welcome",
        }),
        version: 1,
      })
    );
    expect(relocate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "new-window" },
        transferId: expect.any(String),
      })
    );
    expect(showAppAlert).not.toHaveBeenCalled();
  });

  it("copy into new window uses mode copy for files panels", async () => {
    relocate.mockResolvedValue({ ok: true, targetPanelId: "panel-files-copy" });
    const { copyPanelToNewWindow } = await import(
      "@/components/workspace/transfer/relocate.ts"
    );
    await copyPanelToNewWindow("panel-files");
    expect(offer).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "movable",
        mode: "copy",
        panel: expect.objectContaining({
          componentId: "pier.files.filePanel",
          panelId: "panel-files",
        }),
      })
    );
    expect(relocate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "new-window" },
      })
    );
  });

  it("surfaces transfer failures without throwing", async () => {
    relocate.mockResolvedValue({
      code: "not_supported",
      message: "nope",
      ok: false,
    });
    const { movePanelToNewWindow } = await import(
      "@/components/workspace/transfer/relocate.ts"
    );
    await movePanelToNewWindow("panel-welcome");
    expect(showAppAlert).toHaveBeenCalled();
  });

  it("moves into an explicit other window", async () => {
    const { movePanelToWindow } = await import(
      "@/components/workspace/transfer/relocate.ts"
    );
    await movePanelToWindow("panel-welcome", "w-2");
    expect(relocate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "window", windowId: "w-2" },
        transferId: expect.any(String),
      })
    );
  });

  it("copies into an explicit other window", async () => {
    const { copyPanelToWindow } = await import(
      "@/components/workspace/transfer/relocate.ts"
    );
    await copyPanelToWindow("panel-files", "w-2");
    expect(offer).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "movable",
        mode: "copy",
      })
    );
    expect(relocate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "window", windowId: "w-2" },
      })
    );
  });

  it("move to other window alerts when no other window exists", async () => {
    const { movePanelToOtherWindow } = await import(
      "@/components/workspace/transfer/relocate.ts"
    );
    await movePanelToOtherWindow("panel-welcome");
    expect(relocate).not.toHaveBeenCalled();
    expect(showAppAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "workspace.panelTransfer.noOtherWindowsTitle",
        body: "workspace.panelTransfer.noOtherWindows",
      })
    );
  });

  it("move to other window alerts when listing windows fails", async () => {
    listOtherWindowInfos.mockRejectedValueOnce(new Error("ipc down"));
    const { movePanelToOtherWindow } = await import(
      "@/components/workspace/transfer/relocate.ts"
    );
    await movePanelToOtherWindow("panel-welcome");
    expect(relocate).not.toHaveBeenCalled();
    expect(showAppAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "workspace.panelTransfer.pickWindowFailed",
        body: "ipc down",
      })
    );
  });

  it("move to other window uses the most recently focused other window", async () => {
    const { movePanelToOtherWindow } = await import(
      "@/components/workspace/transfer/relocate.ts"
    );
    listOtherWindowInfos.mockResolvedValueOnce([
      { focused: false, id: "w-2", recordId: "r-2" },
    ]);
    await movePanelToOtherWindow("panel-welcome");
    expect(relocate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "window", windowId: "w-2" },
      })
    );

    relocate.mockClear();
    listOtherWindowInfos.mockResolvedValueOnce([
      { focused: false, id: "w-2", recordId: "r-2" },
      { focused: false, id: "w-3", recordId: "r-3" },
    ]);
    await movePanelToOtherWindow("panel-welcome");
    expect(relocate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "window", windowId: "w-2" },
      })
    );
  });
});
