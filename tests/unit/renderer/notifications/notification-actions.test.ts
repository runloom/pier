import type { AppNotification } from "@shared/contracts/notification-center.ts";
import { describe, expect, it } from "vitest";
import { isNotificationActionAvailable } from "@/lib/notifications/actions.ts";

function notification(
  overrides: Partial<AppNotification> = {}
): AppNotification {
  return {
    id: "n1",
    kind: "task-run.finished",
    read: false,
    severity: "success",
    source: "host",
    title: "x",
    trigger: "system-event",
    ts: 1,
    ...overrides,
  };
}

const EMPTY_STATE = { agentEntries: [], runs: {} };

describe("isNotificationActionAvailable", () => {
  it("open-output: available only while the run is in the task-runs snapshot", () => {
    const n = notification({ actionParams: { runId: "r1" } });
    expect(isNotificationActionAvailable(n, "open-output", EMPTY_STATE)).toBe(
      false
    );
    expect(
      isNotificationActionAvailable(n, "open-output", {
        ...EMPTY_STATE,
        runs: { r1: {} },
      })
    ).toBe(true);
    expect(
      isNotificationActionAvailable(notification(), "open-output", EMPTY_STATE)
    ).toBe(false);
  });

  it("focus-panel: available only while the agent is in the runtime index", () => {
    const n = notification({ agentRef: "11\u0000p1" });
    expect(isNotificationActionAvailable(n, "focus-panel", EMPTY_STATE)).toBe(
      false
    );
    expect(
      isNotificationActionAvailable(n, "focus-panel", {
        ...EMPTY_STATE,
        agentEntries: [{ agentRef: "11\u0000p1" }],
      })
    ).toBe(true);
    expect(
      isNotificationActionAvailable(notification(), "focus-panel", EMPTY_STATE)
    ).toBe(false);
  });

  it("other actions are always available", () => {
    expect(
      isNotificationActionAvailable(notification(), "relaunch", EMPTY_STATE)
    ).toBe(true);
  });
});
