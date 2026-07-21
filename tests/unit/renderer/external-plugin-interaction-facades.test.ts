import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { createExternalRendererPluginContext } from "@/lib/plugins/external-plugin-context.ts";

const toast = vi.hoisted(() => ({
  dismiss: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(() => "toast-1"),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

const entry: PluginRegistryEntry = {
  effectivePermissions: [],
  enabled: true,
  manifest: {
    apiVersion: 1,
    commands: [],
    engines: { pier: ">=0.1.0" },
    id: "pier.test-interactions",
    name: "Test Interactions",
    panels: [],
    permissions: [],
    settingsPages: [],
    source: { kind: "official" },
    terminalStatusItems: [],
    version: "1.0.0",
    workbenchWidgets: [],
  },
  runtime: { canToggle: true, enabled: true, kind: "external" },
};

const bridge = {
  invoke: vi.fn(() => Promise.resolve({ data: null, ok: true })),
  subscribe: vi.fn(() => () => undefined),
};

describe("external plugin interaction facades", () => {
  afterEach(() => {
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
    vi.clearAllMocks();
  });

  it("adapts plugin quick picks to the host command palette", async () => {
    const context = createExternalRendererPluginContext(
      entry,
      bridge,
      () => []
    );
    const item = { id: "one", label: "One" };
    const onAccept = vi.fn();

    context.commandPalette.openQuickPick({
      items: [item],
      onAccept,
      title: "Choose",
    });

    const state = useCommandPaletteController.getState();
    expect(state.mode).toBe("quick-pick");
    expect(state.quickPick?.items).toEqual([item]);
    await state.quickPick?.onAccept(state.quickPick.items?.[0] as never);
    expect(onAccept).toHaveBeenCalledWith(item);
  });

  it("does not let one plugin facade update another facade's picker", () => {
    const contextA = createExternalRendererPluginContext(
      entry,
      bridge,
      () => []
    );
    const contextB = createExternalRendererPluginContext(
      {
        ...entry,
        manifest: { ...entry.manifest, id: "pier.test-interactions-b" },
      },
      bridge,
      () => []
    );
    contextA.commandPalette.openQuickPick({
      items: [{ id: "a", label: "A" }],
      onAccept: vi.fn(),
      title: "Picker A",
    });
    contextB.commandPalette.openQuickPick({
      items: [{ id: "b", label: "B" }],
      onAccept: vi.fn(),
      title: "Picker B",
    });

    contextA.commandPalette.updateQuickPick({ title: "Stale A" });
    expect(useCommandPaletteController.getState().quickPick?.title).toBe(
      "Picker B"
    );

    contextB.commandPalette.updateQuickPick({ title: "Updated B" });
    expect(useCommandPaletteController.getState().quickPick?.title).toBe(
      "Updated B"
    );
  });

  it("updates and completes one loading toast by id", () => {
    const context = createExternalRendererPluginContext(
      entry,
      bridge,
      () => []
    );

    const loading = context.notifications.loading("Opening…");
    loading.update("Still opening…");
    loading.success("Opened");
    loading.info("Info");
    loading.dismiss();

    expect(toast.loading).toHaveBeenNthCalledWith(1, "Opening…");
    expect(toast.loading).toHaveBeenNthCalledWith(2, "Still opening…", {
      id: "toast-1",
    });
    expect(toast.success).toHaveBeenCalledWith("Opened", { id: "toast-1" });
    expect(toast.info).toHaveBeenCalledWith("Info", { id: "toast-1" });
    expect(toast.dismiss).toHaveBeenCalledWith("toast-1");
  });
});
