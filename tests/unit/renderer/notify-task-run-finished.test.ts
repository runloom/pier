import type {
  AppNotification,
  NotificationReport,
} from "@shared/contracts/notification-center.ts";
import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  openTaskRunOutput,
  revealTaskRun,
} from "@/lib/actions/task-run-operations.ts";
import { runNotificationAction } from "@/lib/notifications/notification-actions.ts";
import { resetSystemNotifyRecentKeysForTests } from "@/lib/notifications/system-notify.ts";
import {
  clearTaskRunFinishedNotificationsForTests,
  notifyTaskRunFinishedIfNeeded,
} from "@/panel-kits/terminal/notify-task-run-finished.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useNotificationCenterStore } from "@/stores/notification-center.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";

const reportMock = vi.fn<(r: NotificationReport) => Promise<null>>();
const markReadByDedupeKeyMock = vi.fn(async () => undefined);

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
    stopRequestedAt?: number;
    termination?: "force" | "interrupt" | "superseded";
  } = {}
): TaskRunControlEntry {
  const termination =
    options.termination ?? (options.force ? "force" : undefined);
  return {
    // 默认 background：与设置「后台任务完成时弹出」一致；前台任务另测静默。
    mode: options.mode ?? "background",
    nodes: {
      test: {
        label: "Test suite",
        panelId: "terminal-task",
        status,
        taskId: "test",
        ...(options.exitCode === undefined
          ? {}
          : { exitCode: options.exitCode }),
        ...(options.stopRequestedAt === undefined
          ? {}
          : { stopRequestedAt: options.stopRequestedAt }),
        ...(termination ? { termination } : {}),
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

function lastReport(): NotificationReport {
  return reportMock.mock.calls.at(-1)?.[0] as NotificationReport;
}

function reportAsNotification(report: NotificationReport): AppNotification {
  return {
    ...report,
    // toast 副本 id 前缀触发 markReadByDedupeKey（与 main 回投形态 B 一致）
    id: "toast:test",
    read: false,
    ts: Date.now(),
  };
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
        report: reportMock,
      },
    };
  });

  afterEach(() => {
    seedTaskRuns([]);
    clearTaskRunFinishedNotificationsForTests();
    (window as { pier?: unknown }).pier = undefined;
  });

  it("does not report for active runs", () => {
    notifyTaskRunFinishedIfNeeded(run("running"));
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("does not report for foreground terminal-tab runs (strong UI feedback)", () => {
    notifyTaskRunFinishedIfNeeded(
      run("succeeded", { mode: "terminal-tab", runId: "fg-ok" })
    );
    notifyTaskRunFinishedIfNeeded(
      run("failed", { mode: "terminal-tab", runId: "fg-fail", exitCode: 1 })
    );
    notifyTaskRunFinishedIfNeeded(
      run("cancelled", { mode: "terminal-tab", runId: "fg-cancel" })
    );
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("reports a rich card once and open-output opens background output", () => {
    const current = run("succeeded");
    seedTaskRuns([current]);
    notifyTaskRunFinishedIfNeeded(current);
    notifyTaskRunFinishedIfNeeded(current);

    expect(reportMock).toHaveBeenCalledTimes(1);
    const report = lastReport();
    expect(report.title).toBe("Task finished");
    expect(report.body).toBe("Test suite · took 42s");
    expect(report.kind).toBe("task-run.finished");
    expect(report.severity).toBe("success");
    expect(report.actions).toEqual([
      { id: "open-output", labelKey: "terminal.runtimeControl.viewDetails" },
    ]);

    const notification = reportAsNotification(report);
    runNotificationAction(notification, "open-output");
    expect(openTaskRunOutput).toHaveBeenCalledWith(current, "Test suite");
    expect(revealTaskRun).not.toHaveBeenCalled();
    expect(markReadByDedupeKeyMock).toHaveBeenCalledWith(
      `task-run:${current.runId}`
    );
  });

  it("open-output opens background output on failure", () => {
    const current = run("failed", { mode: "background" });
    seedTaskRuns([current]);
    notifyTaskRunFinishedIfNeeded(current);

    const notification = reportAsNotification(lastReport());
    expect(notification.title).toBe("Task failed");
    expect(notification.severity).toBe("error");

    runNotificationAction(notification, "open-output");
    expect(openTaskRunOutput).toHaveBeenCalledWith(current, "Test suite");
    expect(revealTaskRun).not.toHaveBeenCalled();
  });

  it("failed detail includes exit code and duration", () => {
    notifyTaskRunFinishedIfNeeded(run("failed", { exitCode: 1 }));
    expect(lastReport().body).toBe("Test suite · exit code 1 · took 42s");
  });

  it("surfaces view-details failures with an alert", async () => {
    vi.mocked(openTaskRunOutput).mockRejectedValueOnce(new Error("boom"));
    const current = run("succeeded", {
      mode: "background",
      runId: "run-alert",
    });
    seedTaskRuns([current]);
    notifyTaskRunFinishedIfNeeded(current);

    runNotificationAction(reportAsNotification(lastReport()), "open-output");
    await vi.waitFor(() => {
      expect(showAppAlert).toHaveBeenCalledWith({
        body: "boom",
        title: "Couldn't open task output",
      });
    });
  });

  it("uses an error-severity report for forced cancellation even after stopRequestedAt", () => {
    notifyTaskRunFinishedIfNeeded(
      run("cancelled", {
        force: true,
        runId: "run-force",
        stopRequestedAt: 2000,
      })
    );
    const report = lastReport();
    expect(report.title).toBe("Task force-stopped");
    expect(report.severity).toBe("error");
    expect(report.body).toBe("Test suite · ran for 42s");
  });

  it("does not notify user-requested stop (interrupt)", () => {
    notifyTaskRunFinishedIfNeeded(
      run("cancelled", { termination: "interrupt", runId: "run-stop" })
    );
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("does not notify user-requested stop via stopRequestedAt (panel close path)", () => {
    notifyTaskRunFinishedIfNeeded(
      run("cancelled", {
        runId: "run-panel-close",
        stopRequestedAt: 2000,
      })
    );
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("uses a neutral info severity for unexpected cancellation", () => {
    notifyTaskRunFinishedIfNeeded(run("cancelled"));
    const report = lastReport();
    expect(report.title).toBe("Task cancelled");
    expect(report.severity).toBe("info");
    expect(report.body).toBe("Test suite · ran for 42s");
  });

  it("does not notify when cancellation is a restart supersession", () => {
    notifyTaskRunFinishedIfNeeded(
      run("cancelled", { termination: "superseded", runId: "run-superseded" })
    );
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("still notifies unexpected cancel after a superseded run was skipped", () => {
    notifyTaskRunFinishedIfNeeded(
      run("cancelled", { termination: "superseded", runId: "run-a" })
    );
    notifyTaskRunFinishedIfNeeded(run("cancelled", { runId: "run-b" }));
    expect(reportMock).toHaveBeenCalledTimes(1);
    expect(lastReport().title).toBe("Task cancelled");
  });
});
