import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { stopTaskRun } from "@/lib/actions/task-run-operations.ts";
import {
  clearPanelCloseGuards,
  runPanelCloseGuards,
} from "@/lib/workspace/panel-close-guards.ts";
import { registerTerminalPanelCloseGuard } from "@/panel-kits/terminal/register-close-guard.ts";
import { showAppConfirm } from "@/stores/app-dialog.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";

vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppAlert: vi.fn(async () => undefined),
  showAppConfirm: vi.fn(async () => true),
}));

vi.mock("@/lib/actions/task-run-operations.ts", () => ({
  stopTaskRun: vi.fn(async () => undefined),
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
    vi.mocked(stopTaskRun).mockReset();
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
    expect(stopTaskRun).not.toHaveBeenCalled();
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
    expect(stopTaskRun).not.toHaveBeenCalled();
  });

  it("confirms and stops active task runs before allowing close", async () => {
    const run = {
      mode: "background" as const,
      nodes: {
        dev: {
          label: "dev",
          status: "running" as const,
          taskId: "dev",
          windowId: "win-1",
        },
      },
      originPanelId: "terminal-1",
      ownerWindowId: "win-1",
      projectRootPath: "/repo",
      rootTaskId: "dev",
      runId: "run-dev",
      startedAt: 1,
      status: "running" as const,
      updatedAt: 2,
    };
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: { runs: { "run-dev": run }, version: 1 },
    });
    registerTerminalPanelCloseGuard();

    await expect(
      runPanelCloseGuards({
        componentId: "terminal",
        panelId: "terminal-1",
      })
    ).resolves.toBe(true);
    expect(showAppConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "destructive",
        title: "Close panel?",
      })
    );
    expect(stopTaskRun).toHaveBeenCalledWith(run, false);
  });

  it("does not stop tasks when the user cancels the close confirm", async () => {
    useTaskRunsStore.setState({
      error: null,
      initialized: true,
      snapshot: {
        runs: {
          "run-dev": {
            mode: "background",
            nodes: {
              dev: {
                label: "dev",
                status: "running",
                taskId: "dev",
                windowId: "win-1",
              },
            },
            originPanelId: "terminal-1",
            ownerWindowId: "win-1",
            projectRootPath: "/repo",
            rootTaskId: "dev",
            runId: "run-dev",
            startedAt: 1,
            status: "running",
            updatedAt: 2,
          },
        },
        version: 1,
      },
    });
    vi.mocked(showAppConfirm).mockResolvedValueOnce(false);
    registerTerminalPanelCloseGuard();

    await expect(
      runPanelCloseGuards({
        componentId: "terminal",
        panelId: "terminal-1",
      })
    ).resolves.toBe(false);
    expect(stopTaskRun).not.toHaveBeenCalled();
  });
});
