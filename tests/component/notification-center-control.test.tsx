import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import type { AppNotification } from "@shared/contracts/notification-center.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationCenterControl } from "@/components/common/notification-center-control.tsx";
import { initI18n } from "@/i18n/index.ts";
import { useNotificationCenterStore } from "@/stores/notification-center.store.ts";
import { useNotificationCenterPopoverStore } from "@/stores/notification-center-popover.store.ts";
import { useNotificationCenterPrefsStore } from "@/stores/notification-center-prefs.store.ts";

vi.mock("@/lib/notifications/notification-actions.ts", () => ({
  runNotificationAction: vi.fn(),
}));

const overlayDisposeMock = vi.fn();
const webFocusReleaseMock = vi.fn();
const registerFullscreenOverlayMock = vi.fn((_id: string) => ({
  dispose: overlayDisposeMock,
}));
const requestWebFocusMock = vi.fn((_id: string) => webFocusReleaseMock);
const restoreTerminalFocusMock = vi.fn();
const markOutsideIfNeededMock = vi.fn(
  (_id: string, _target: EventTarget | null): boolean => false
);
const consumeOutsideMock = vi.fn((_id?: string): boolean => false);
const showAppAlertMock = vi.fn(
  async (_opts?: unknown): Promise<void> => undefined
);

vi.mock("@/stores/terminal-input-routing-slice.ts", () => ({
  registerTerminalFullscreenWebOverlay: (id: string) =>
    registerFullscreenOverlayMock(id),
  requestTerminalWebFocus: (id: string) => requestWebFocusMock(id),
}));

vi.mock(
  "@/lib/workspace/restore-terminal-focus-after-web-overlay-dismiss.ts",
  () => ({
    consumeWebOverlayOutsideDismiss: (id: string) => consumeOutsideMock(id),
    markWebOverlayOutsideDismissIfNeeded: (
      id: string,
      target: EventTarget | null
    ) => markOutsideIfNeededMock(id, target),
    restoreTerminalFocusAfterWebOverlayDismiss: () =>
      restoreTerminalFocusMock(),
  })
);

vi.mock("@/stores/app-dialog.store.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/app-dialog.store.ts")>();
  return {
    ...actual,
    showAppAlert: (opts: unknown) => showAppAlertMock(opts),
  };
});

const markAllReadMock = vi.fn<() => Promise<void>>();
const setDndMock = vi.fn<(enabled: boolean) => Promise<void>>();

function seed(items: AppNotification[], dndEnabled = false) {
  useNotificationCenterStore.setState({
    dndEnabled,
    hydrated: true,
    items,
    seq: 1,
    unreadCount: items.filter((i) => !i.read).length,
  });
}

function item(
  id: string,
  severity: AppNotification["severity"] = "info"
): AppNotification {
  return {
    id,
    kind: "app.update",
    read: false,
    severity,
    source: "host",
    title: `msg-${id}`,
    trigger: "system-event",
    ts: Date.now(),
  };
}

describe("NotificationCenterControl", () => {
  beforeEach(async () => {
    await initI18n();
    vi.clearAllMocks();
    consumeOutsideMock.mockReturnValue(false);
    markOutsideIfNeededMock.mockReturnValue(false);
    markAllReadMock.mockResolvedValue(undefined);
    setDndMock.mockResolvedValue(undefined);
    showAppAlertMock.mockResolvedValue(undefined);
    useNotificationCenterPopoverStore.setState({ open: false });
    (window as { pier?: unknown }).pier = {
      notificationCenter: {
        markAllRead: markAllReadMock,
        setDnd: setDndMock,
      },
    };
    useNotificationCenterPrefsStore.setState({
      prefs: {
        dndEnabled: false,
        mutedKinds: [],
        retentionDays: 7,
        showUnreadBadge: true,
      },
    });
  });

  afterEach(() => {
    cleanup();
    (window as { pier?: unknown }).pier = undefined;
  });

  it("renders unread badge for attention items and opts out of titlebar drag region", () => {
    seed([item("a", "warning"), item("b", "error")]);
    render(
      <TooltipProvider>
        <NotificationCenterControl />
      </TooltipProvider>
    );
    expect(screen.getByText("2")).toBeTruthy();
    const trigger = screen.getByRole("button", {
      name: "Notifications, 2 unread",
    });
    expect(trigger.className).toContain("app-no-drag");
  });

  it("does not badge flow-level (success/info) unread items", () => {
    seed([item("a", "info"), item("b", "success")]);
    render(
      <TooltipProvider>
        <NotificationCenterControl />
      </TooltipProvider>
    );
    expect(screen.queryByText("2")).toBeNull();
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });

  it("hides badge when showUnreadBadge pref is off", () => {
    useNotificationCenterPrefsStore.setState({
      prefs: {
        dndEnabled: false,
        mutedKinds: [],
        retentionDays: 7,
        showUnreadBadge: false,
      },
    });
    seed([item("a", "warning")]);
    render(
      <TooltipProvider>
        <NotificationCenterControl />
      </TooltipProvider>
    );
    expect(screen.queryByText("1")).toBeNull();
  });

  it("hides mark-all-read when there is no unread", async () => {
    seed([]);
    render(
      <TooltipProvider>
        <NotificationCenterControl />
      </TooltipProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("No notifications")).toBeTruthy();
    expect(screen.queryByText("Mark all as read")).toBeNull();
  });

  it("mark-all-read and dnd close only after successful IPC", async () => {
    seed([item("a", "warning")]);
    render(
      <TooltipProvider>
        <NotificationCenterControl />
      </TooltipProvider>
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Notifications, 1 unread" })
    );
    expect(await screen.findByText("msg-a")).toBeTruthy();
    fireEvent.click(screen.getByText("Mark all as read"));
    await vi.waitFor(() => {
      expect(markAllReadMock).toHaveBeenCalled();
      expect(
        document.querySelector('[data-slot="popover-content"]')
      ).toBeNull();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Notifications, 1 unread" })
    );
    await screen.findByText("msg-a");
    fireEvent.click(screen.getByRole("button", { name: "Do Not Disturb" }));
    await vi.waitFor(() => {
      expect(setDndMock).toHaveBeenCalledWith(true);
      expect(
        document.querySelector('[data-slot="popover-content"]')
      ).toBeNull();
    });
  });

  it("keeps popover open and alerts when mark-all-read fails", async () => {
    markAllReadMock.mockRejectedValueOnce(new Error("ipc down"));
    seed([item("a", "warning")]);
    render(
      <TooltipProvider>
        <NotificationCenterControl />
      </TooltipProvider>
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Notifications, 1 unread" })
    );
    await screen.findByText("msg-a");
    fireEvent.click(screen.getByText("Mark all as read"));
    await vi.waitFor(() => {
      expect(showAppAlertMock).toHaveBeenCalled();
    });
    expect(
      document.querySelector('[data-slot="popover-content"]')
    ).toBeTruthy();
  });

  it("pages the list: first 20 visible, scroll loads more", async () => {
    seed(Array.from({ length: 25 }, (_, i) => item(String(i), "warning")));
    render(
      <TooltipProvider>
        <NotificationCenterControl />
      </TooltipProvider>
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Notifications, 25 unread" })
    );
    expect(await screen.findByText("msg-0")).toBeTruthy();
    expect(screen.getByText("msg-19")).toBeTruthy();
    expect(screen.queryByText("msg-20")).toBeNull();
    expect(screen.getByTestId("notification-center-load-more")).toBeTruthy();

    const list = screen.getByTestId("notification-center-list");
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(list, "clientHeight", {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(list, "scrollTop", {
      configurable: true,
      value: 560,
    });
    fireEvent.scroll(list);

    expect(await screen.findByText("msg-20")).toBeTruthy();
    expect(screen.getByText("msg-24")).toBeTruthy();
    expect(screen.queryByTestId("notification-center-load-more")).toBeNull();
  });

  it("opens when popover store is set (command palette path)", async () => {
    seed([item("a", "warning")]);
    render(
      <TooltipProvider>
        <NotificationCenterControl />
      </TooltipProvider>
    );
    useNotificationCenterPopoverStore.getState().setOpen(true);
    expect(await screen.findByText("msg-a")).toBeTruthy();
  });

  it("closes itself when a dialog opens (unblocks deferred dialog mount)", async () => {
    seed([item("a", "warning")]);
    render(
      <TooltipProvider>
        <NotificationCenterControl />
      </TooltipProvider>
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Notifications, 1 unread" })
    );
    await screen.findByText("msg-a");
    const { useCommandPaletteController } = await import(
      "@/lib/command-palette/controller.ts"
    );
    useCommandPaletteController.setState({ open: true });
    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-slot="popover-content"]')
      ).toBeNull();
    });
    useCommandPaletteController.setState({ open: false });
  });

  it("closes itself when app-dialog / content-dialog opens", async () => {
    const { useAppDialogStore } = await import("@/stores/app-dialog.store.ts");
    const { useAppContentDialogStore } = await import(
      "@/stores/app-content-dialog.store.ts"
    );
    for (const activate of [
      () => {
        useAppDialogStore.setState({
          current: { kind: "alert", title: "t" } as never,
        });
      },
      () => {
        useAppContentDialogStore.setState({
          stack: [{ id: "d1" } as never],
        });
      },
    ]) {
      seed([item("a", "warning")]);
      const { unmount } = render(
        <TooltipProvider>
          <NotificationCenterControl />
        </TooltipProvider>
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Notifications, 1 unread" })
      );
      await screen.findByText("msg-a");
      activate();
      await vi.waitFor(() => {
        expect(
          document.querySelector('[data-slot="popover-content"]')
        ).toBeNull();
      });
      unmount();
      useAppDialogStore.setState({ current: null });
      useAppContentDialogStore.setState({ stack: [] });
    }
  });

  it("routes terminal clicks to web while open and pins keyboard focus", async () => {
    seed([item("a", "warning")]);
    render(
      <TooltipProvider>
        <NotificationCenterControl />
      </TooltipProvider>
    );
    expect(registerFullscreenOverlayMock).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Notifications, 1 unread" })
    );
    await screen.findByText("msg-a");
    expect(registerFullscreenOverlayMock).toHaveBeenCalledWith(
      "overlay:notification-center"
    );
    expect(requestWebFocusMock).toHaveBeenCalledWith("notification-center");
    fireEvent.keyDown(document.body, { key: "Escape" });
    await vi.waitFor(() => {
      expect(overlayDisposeMock).toHaveBeenCalled();
      expect(webFocusReleaseMock).toHaveBeenCalled();
    });
    expect(restoreTerminalFocusMock).not.toHaveBeenCalled();
  });

  it("restores terminal focus when open effect cleans up after outside mark", async () => {
    consumeOutsideMock.mockReturnValue(true);
    seed([item("a", "warning")]);
    render(
      <TooltipProvider>
        <NotificationCenterControl />
      </TooltipProvider>
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Notifications, 1 unread" })
    );
    await screen.findByText("msg-a");
    fireEvent.keyDown(document.body, { key: "Escape" });
    await vi.waitFor(() => {
      expect(consumeOutsideMock).toHaveBeenCalledWith(
        "overlay:notification-center"
      );
      expect(restoreTerminalFocusMock).toHaveBeenCalled();
    });
  });
});
