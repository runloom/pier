import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  clearPanelCloseGuards,
  runPanelCloseGuards,
} from "@/lib/workspace/panel-close-guards.ts";
import { registerTerminalPanelCloseGuard } from "@/panel-kits/terminal/register-close-guard.ts";
import { showAppConfirm } from "@/stores/app-dialog.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";

vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppConfirm: vi.fn(async () => true),
}));

describe("registerTerminalPanelCloseGuard", () => {
  beforeEach(async () => {
    await initI18n();
    clearPanelCloseGuards();
    useForegroundActivityStore.setState({ activities: {}, ts: 0 });
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: {}, version: 0 },
    });
    vi.mocked(showAppConfirm).mockReset();
    vi.mocked(showAppConfirm).mockResolvedValue(true);
  });

  afterEach(() => {
    clearPanelCloseGuards();
  });

  it("allows close without a dialog when the panel has no dangerous activity", async () => {
    registerTerminalPanelCloseGuard();
    await expect(
      runPanelCloseGuards({
        componentId: "terminal",
        panelId: "terminal-1",
      })
    ).resolves.toBe(true);
    expect(showAppConfirm).not.toHaveBeenCalled();
  });

  it("blocks close until the user confirms when an agent is active", async () => {
    useForegroundActivityStore.setState({
      activities: {
        "terminal-1": {
          agentId: "codex",
          kind: "agent",
          panelId: "terminal-1",
          source: "hook",
          spawnedAt: 1,
          status: "processing",
          subagentCount: 0,
          updatedAt: 2,
          windowId: "win-1",
        },
      },
      ts: 1,
    });
    vi.mocked(showAppConfirm).mockResolvedValueOnce(false);
    registerTerminalPanelCloseGuard();

    await expect(
      runPanelCloseGuards({
        componentId: "terminal",
        panelId: "terminal-1",
      })
    ).resolves.toBe(false);
    expect(showAppConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "destructive",
        size: "sm",
        title: "Close panel?",
      })
    );
  });
});
