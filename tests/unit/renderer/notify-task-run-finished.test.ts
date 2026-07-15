import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  openTaskRunOutput,
  revealTaskRun,
} from "@/lib/actions/task-run-operations.ts";
import {
  clearTaskRunFinishedNotificationsForTests,
  notifyTaskRunFinishedIfNeeded,
} from "@/panel-kits/terminal/notify-task-run-finished.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/actions/task-run-operations.ts", () => ({
  openTaskRunOutput: vi.fn(async () => undefined),
  revealTaskRun: vi.fn(async () => true),
}));

vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppAlert: vi.fn(async () => undefined),
}));

function toastActionOnClick(
  options: { action?: unknown } | undefined
): (() => void) | null {
  const action = options?.action;
  if (
    !(
      action &&
      typeof action === "object" &&
      "onClick" in action &&
      typeof action.onClick === "function"
    )
  ) {
    return null;
  }
  const onClick = action.onClick as (event?: unknown) => void;
  return () => {
    onClick();
  };
}

function run(
  status: TaskRunControlEntry["status"],
  options: {
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
        ...(options.force ? { termination: "force" as const } : {}),
      },
    },
    projectRootPath: "/repo",
    rootTaskId: "test",
    runId: options.runId ?? "run-1",
    startedAt: 1000,
    status,
    updatedAt: 5000,
  };
}

describe("notifyTaskRunFinishedIfNeeded", () => {
  beforeEach(async () => {
    await initI18n();
    clearTaskRunFinishedNotificationsForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearTaskRunFinishedNotificationsForTests();
  });

  it("does not toast for active runs", () => {
    notifyTaskRunFinishedIfNeeded(run("running"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts success once and reveals the terminal panel on view details", () => {
    const current = run("succeeded");
    notifyTaskRunFinishedIfNeeded(current);
    notifyTaskRunFinishedIfNeeded(current);

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(
      "Task finished: Test suite",
      expect.objectContaining({
        action: expect.objectContaining({ label: "View details" }),
      })
    );

    const onClick = toastActionOnClick(
      vi.mocked(toast.success).mock.calls[0]?.[1]
    );
    expect(onClick).not.toBeNull();
    onClick?.();
    expect(revealTaskRun).toHaveBeenCalledWith(current);
    expect(openTaskRunOutput).not.toHaveBeenCalled();
  });

  it("opens background output from the toast action", () => {
    const current = run("failed", { mode: "background" });
    notifyTaskRunFinishedIfNeeded(current);

    expect(toast.error).toHaveBeenCalledWith(
      "Task failed: Test suite",
      expect.objectContaining({
        action: expect.objectContaining({ label: "View details" }),
      })
    );

    const onClick = toastActionOnClick(
      vi.mocked(toast.error).mock.calls[0]?.[1]
    );
    expect(onClick).not.toBeNull();
    onClick?.();
    expect(openTaskRunOutput).toHaveBeenCalledWith(current, "Test suite");
    expect(revealTaskRun).not.toHaveBeenCalled();
  });

  it("surfaces view-details failures with an alert", async () => {
    vi.mocked(openTaskRunOutput).mockRejectedValueOnce(new Error("boom"));
    const current = run("succeeded", {
      mode: "background",
      runId: "run-alert",
    });
    notifyTaskRunFinishedIfNeeded(current);

    const onClick = toastActionOnClick(
      vi.mocked(toast.success).mock.calls[0]?.[1]
    );
    expect(onClick).not.toBeNull();
    onClick?.();
    await vi.waitFor(() => {
      expect(showAppAlert).toHaveBeenCalledWith({
        body: "boom",
        title: "Failed to open task output",
      });
    });
  });

  it("uses a force-stop toast for forced cancellation", () => {
    notifyTaskRunFinishedIfNeeded(run("cancelled", { force: true }));
    expect(toast.error).toHaveBeenCalledWith(
      "Task force-stopped: Test suite",
      expect.any(Object)
    );
  });
});
