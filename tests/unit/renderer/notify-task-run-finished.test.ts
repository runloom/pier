import type { AppNotification } from "@shared/contracts/notification-center.ts";
import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  openTaskRunOutput,
  revealTaskRun,
} from "@/lib/actions/task-run-operations.ts";
import { runNotificationAction } from "@/lib/notifications/notification-actions.ts";
import {
  registerSystemToastRenderer,
  resetSystemNotifyRecentKeysForTests,
} from "@/lib/notifications/system-notify.ts";
import {
  clearTaskRunFinishedNotificationsForTests,
  notifyTaskRunFinishedIfNeeded,
} from "@/panel-kits/terminal/notify-task-run-finished.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useNotificationCenterStore } from "@/stores/notification-center.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";

const toastRendererMock = vi.fn<(n: AppNotification) => void>();
const markReadByDedupeKeyMock = vi.fn(async () => undefined);
registerSystemToastRenderer(toastRendererMock);

vi.mock("@/lib/actions/task-run-operations.ts", () => ({
  openTaskRunOutput: vi.fn(async () => undefined),
  revealTaskRun: vi.fn(async () => true),
}));

vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppAlert: vi.fn(async () => undefined),
}));

function run(
  status: TaskRunControlEntry["status"],
  options: {
    exitCode?: number;
    force?: boolean;
    mode?: TaskRunControlEntry["mode"];
    runId?: string;
  } = {}
): TaskRunControlEntry {
  return {
    mode: options.mode ?? "terminal-tab",
    nodes: {
      test: {
        label: "Test suite",
        panelId: "terminal-task",
        status,
        taskId: "test",
        ...(options.exitCode === undefined
          ? {}
          : { exitCode: options.exitCode }),
        ...(options.force ? { termination: "force" as const } : {}),
      },
    },
    projectRootPath: "/repo",
    rootTaskId: "test",
    runId: options.runId ?? "run-1",
    startedAt: 1000,
    status,
    updatedAt: 43_000,
  };
}

function seedTaskRuns(entries: TaskRunControlEntry[]): void {
  useTaskRunsStore.setState({
    error: null,
    initialized: true,
    snapshot: {
      runs: Object.fromEntries(entries.map((entry) => [entry.runId, entry])),
      version: 1,
    },
  });
}

function lastToastNotification(): AppNotification {
  return toastRendererMock.mock.calls.at(-1)?.[0] as AppNotification;
}

describe("notifyTaskRunFinishedIfNeeded", () => {
  beforeEach(async () => {
    await initI18n();
    vi.clearAllMocks();
    clearTaskRunFinishedNotificationsForTests();
    resetSystemNotifyRecentKeysForTests();
    seedTaskRuns([]);
    useNotificationCenterStore.setState({
      dndEnabled: false,
      hydrated: true,
      items: [],
      seq: 0,
      unreadCount: 0,
    });
    (window as { pier?: unknown }).pier = {
      notificationCenter: {
        markRead: vi.fn(async () => undefined),
        markReadByDedupeKey: markReadByDedupeKeyMock,
      },
    };
  });

  afterEach(() => {
    seedTaskRuns([]);
    clearTaskRunFinishedNotificationsForTests();
    (window as { pier?: unknown }).pier = undefined;
  });

  it("does not toast for active runs", () => {
    notifyTaskRunFinishedIfNeeded(run("running"));
    expect(toastRendererMock).not.toHaveBeenCalled();
  });

  it("toasts a rich card once and open-output reveals the terminal panel", () => {
    const current = run("succeeded");
    seedTaskRuns([current]);
    notifyTaskRunFinishedIfNeeded(current);
    notifyTaskRunFinishedIfNeeded(current);

    expect(toastRendererMock).toHaveBeenCalledTimes(1);
    const notification = lastToastNotification();
    expect(notification.title).toBe("Finished: Test suite");
    expect(notification.body).toBe("Took 42s");
    expect(notification.kind).toBe("task-run.finished");
    expect(notification.severity).toBe("success");
    expect(notification.actions).toEqual([
      { id: "open-output", labelKey: "terminal.runtimeControl.viewDetails" },
    ]);

    runNotificationAction(notification, "open-output");
    expect(revealTaskRun).toHaveBeenCalledWith(current);
    expect(openTaskRunOutput).not.toHaveBeenCalled();
    // toast 副本不在 NCS 历史中：按 dedupeKey 标已读
    expect(markReadByDedupeKeyMock).toHaveBeenCalledWith(
      `task-run:${current.runId}`
    );
  });

  it("open-output opens background output", () => {
    const current = run("failed", { mode: "background" });
    seedTaskRuns([current]);
    notifyTaskRunFinishedIfNeeded(current);

    const notification = lastToastNotification();
    expect(notification.title).toBe("Failed: Test suite");
    expect(notification.severity).toBe("error");

    runNotificationAction(notification, "open-output");
    expect(openTaskRunOutput).toHaveBeenCalledWith(current, "Test suite");
    expect(revealTaskRun).not.toHaveBeenCalled();
  });

  it("failed detail includes exit code and duration", () => {
    notifyTaskRunFinishedIfNeeded(run("failed", { exitCode: 1 }));
    expect(lastToastNotification().body).toBe("Exit code 1 · took 42s");
  });

  it("surfaces view-details failures with an alert", async () => {
    vi.mocked(openTaskRunOutput).mockRejectedValueOnce(new Error("boom"));
    const current = run("succeeded", {
      mode: "background",
      runId: "run-alert",
    });
    seedTaskRuns([current]);
    notifyTaskRunFinishedIfNeeded(current);

    runNotificationAction(lastToastNotification(), "open-output");
    await vi.waitFor(() => {
      expect(showAppAlert).toHaveBeenCalledWith({
        body: "boom",
        title: "Couldn't open task output",
      });
    });
  });

  it("uses an error-severity toast for forced cancellation", () => {
    notifyTaskRunFinishedIfNeeded(run("cancelled", { force: true }));
    const notification = lastToastNotification();
    expect(notification.title).toBe("Force-stopped: Test suite");
    expect(notification.severity).toBe("error");
    expect(notification.body).toBe("Ran for 42s");
  });

  it("uses a neutral info severity for normal cancellation (not success)", () => {
    notifyTaskRunFinishedIfNeeded(run("cancelled"));
    const notification = lastToastNotification();
    expect(notification.title).toBe("Cancelled: Test suite");
    expect(notification.severity).toBe("info");
    expect(notification.body).toBe("Ran for 42s");
  });
});
