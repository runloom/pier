import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPanelCloseGuards,
  registerPanelCloseGuard,
  runPanelCloseGuards,
} from "@/lib/workspace/panel-close-guards.ts";

describe("panel-close-guards", () => {
  afterEach(() => {
    clearPanelCloseGuards();
  });

  it("allows close when no guards are registered", async () => {
    await expect(
      runPanelCloseGuards({
        componentId: "pier.files.filePanel",
        panelId: "panel-1",
      })
    ).resolves.toBe(true);
  });

  it("only runs guards for the matching componentId", async () => {
    const matching = vi.fn(async () => false);
    const other = vi.fn(async () => true);
    registerPanelCloseGuard("pier.files.filePanel", matching);
    registerPanelCloseGuard("terminal", other);

    await expect(
      runPanelCloseGuards({
        componentId: "pier.files.filePanel",
        panelId: "panel-1",
        params: { source: { kind: "untitled", id: "x", name: "x.md" } },
      })
    ).resolves.toBe(false);
    expect(matching).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
  });

  it("short-circuits after the first veto", async () => {
    const first = vi.fn(async () => false);
    const second = vi.fn(async () => true);
    registerPanelCloseGuard("pier.files.filePanel", first);
    registerPanelCloseGuard("pier.files.filePanel", second);

    await expect(
      runPanelCloseGuards({
        componentId: "pier.files.filePanel",
        panelId: "panel-1",
      })
    ).resolves.toBe(false);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });
});
