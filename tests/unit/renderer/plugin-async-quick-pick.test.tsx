import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { createRendererPluginContext } from "@/lib/plugins/host-context.ts";

describe("plugin async quick pick", () => {
  beforeEach(() => {
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
  });

  it("adapts loading/errorText and forwards onQueryChange with the host AbortSignal", async () => {
    const onQueryChange = vi.fn<
      (query: string, signal: AbortSignal) => Promise<void>
    >(async () => undefined);
    const context = createRendererPluginContext();

    context.commandPalette.openQuickPick({
      errorText: "Boom",
      items: [{ id: "one", label: "One" }],
      loading: true,
      onAccept: () => undefined,
      onQueryChange,
      title: "Async plugin pick",
    });

    const quickPick = useCommandPaletteController.getState().quickPick;
    expect(quickPick).toMatchObject({
      errorText: "Boom",
      loading: true,
      title: "Async plugin pick",
    });

    if (!quickPick?.onQueryChange) {
      throw new Error("expected adapted onQueryChange");
    }
    const controller = new AbortController();
    await quickPick.onQueryChange("query", controller.signal);
    expect(onQueryChange).toHaveBeenCalledWith("query", controller.signal);
    expect(onQueryChange.mock.calls[0]?.[1]).toBe(controller.signal);
  });
});
