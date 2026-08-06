import type { AppNotification } from "@shared/contracts/notification-center.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationCard } from "@/components/common/notifications/card.tsx";
import { initI18n } from "@/i18n/index.ts";

const runActionMock = vi.fn();
const availabilityMock = vi.fn(
  (_notification: unknown, _actionId: string) => true
);
const markReadMock = vi.fn<(id: string) => Promise<void>>();

vi.mock("@/lib/notifications/actions.ts", () => ({
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
    const onActionRun = vi.fn();
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
        onActionRun={onActionRun}
      />
    );
    fireEvent.click(screen.getByText("View details"));
    expect(runActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "n1" }),
      "open-output"
    );
    expect(onActionRun).toHaveBeenCalledTimes(1);
  });

  it("works without onActionRun (optional callback)", () => {
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
    expect(runActionMock).toHaveBeenCalled();
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

  it("shows full multi-line body without line-clamp truncation", () => {
    const body =
      "第一行说明完整展示。\n第二行详情也不应被省略。\n第三行继续可见。";
    const { container } = render(
      <NotificationCard notification={notification({ body })} />
    );
    const description = container.querySelector(
      "[data-slot='item-description']"
    );
    expect(description).not.toBeNull();
    expect(description?.textContent).toBe(body);
    expect(description?.className).toContain("line-clamp-none");
    expect(description?.className).toContain("whitespace-pre-wrap");
    expect(description?.className).not.toMatch(/\bline-clamp-2\b/);
  });
});
