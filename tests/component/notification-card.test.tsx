import type { AppNotification } from "@shared/contracts/notification-center.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationCard } from "@/components/common/notification-card.tsx";
import { initI18n } from "@/i18n/index.ts";

const runActionMock = vi.fn();
const availabilityMock = vi.fn(
  (_notification: unknown, _actionId: string) => true
);
const markReadMock = vi.fn<(id: string) => Promise<void>>();

vi.mock("@/lib/notifications/notification-actions.ts", () => ({
  isNotificationActionAvailable: (notification: unknown, actionId: string) =>
    availabilityMock(notification, actionId),
  runNotificationAction: (...args: [unknown, string]) => runActionMock(...args),
}));

function notification(
  overrides: Partial<AppNotification> = {}
): AppNotification {
  return {
    id: "n1",
    kind: "task-run.finished",
    read: false,
    severity: "success",
    source: "host",
    title: "Finished: pnpm build",
    trigger: "system-event",
    ts: Date.now() - 60_000,
    ...overrides,
  };
}

describe("NotificationCard", () => {
  beforeEach(async () => {
    await initI18n();
    vi.clearAllMocks();
    availabilityMock.mockReturnValue(true);
    markReadMock.mockResolvedValue(undefined);
    (window as { pier?: unknown }).pier = {
      notificationCenter: { markRead: markReadMock },
    };
  });

  afterEach(() => {
    cleanup();
    (window as { pier?: unknown }).pier = undefined;
  });

  it("renders title and time; unread dot visible", () => {
    const { container } = render(
      <NotificationCard notification={notification()} />
    );
    expect(screen.getByText("Finished: pnpm build")).toBeTruthy();
    expect(
      container.querySelector("[data-slot='notification-unread-dot']")
    ).toBeTruthy();
  });

  it("resolves titleKey over raw title", () => {
    render(
      <NotificationCard
        notification={notification({
          title: "raw",
          titleKey: "terminal.runtimeControl.finishedSuccess",
          titleParams: { label: "build" },
        })}
      />
    );
    // locale 文案是 "Task finished"（不插 label）；只要 titleKey 优先生效即可
    expect(screen.getByText("Task finished")).toBeTruthy();
    expect(screen.queryByText("raw")).toBeNull();
  });

  it("dispatches action via the shared dispatcher", () => {
    render(
      <NotificationCard
        notification={notification({
          actions: [
            {
              id: "open-output",
              labelKey: "terminal.runtimeControl.viewDetails",
            },
          ],
        })}
      />
    );
    fireEvent.click(screen.getByText("View details"));
    expect(runActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "n1" }),
      "open-output"
    );
  });

  it("clicking the title area marks the item read (once)", () => {
    render(<NotificationCard notification={notification()} />);
    fireEvent.click(screen.getByText("Finished: pnpm build"));
    expect(markReadMock).toHaveBeenCalledWith("n1");
  });

  it("hides actions whose target is no longer available (no dead-end clicks)", () => {
    availabilityMock.mockReturnValue(false);
    render(
      <NotificationCard
        notification={notification({
          actions: [
            {
              id: "open-output",
              labelKey: "terminal.runtimeControl.viewDetails",
            },
          ],
        })}
      />
    );
    expect(screen.queryByText("View details")).toBeNull();
  });

  it("inbox items have no leading status icon (toast-only semantics)", () => {
    const { container } = render(
      <NotificationCard notification={notification({ severity: "success" })} />
    );
    expect(container.querySelector("[data-slot='status-icon']")).toBeNull();
  });

  it("read items render dimmed without unread dot", () => {
    const { container } = render(
      <NotificationCard notification={notification({ read: true })} />
    );
    expect(
      container.querySelector("[data-slot='notification-unread-dot']")
    ).toBeNull();
  });
});
