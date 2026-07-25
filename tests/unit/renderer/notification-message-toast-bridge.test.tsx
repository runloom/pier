import type { AppNotification } from "@shared/contracts/notification-center.ts";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationMessageToastBridge } from "@/components/common/notification-message-toast-bridge.tsx";

const showToastMock = vi.fn<(n: AppNotification) => void>();

vi.mock("@/lib/notifications/show-notification-toast.tsx", () => ({
  showNotificationToast: (n: AppNotification) => showToastMock(n),
}));

type MessageToastCallback = (notification: AppNotification) => void;

function notification(
  overrides: Partial<AppNotification> = {}
): AppNotification {
  return {
    id: "n1",
    kind: "agent.attention",
    read: false,
    severity: "warning",
    source: "agent-attention",
    title: "需要你处理",
    trigger: "system-event",
    ts: Date.now(),
    ...overrides,
  };
}

function stubPierNotificationCenter(
  api: Record<string, unknown> | undefined
): void {
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: api === undefined ? undefined : { notificationCenter: api },
    writable: true,
  });
}

describe("NotificationMessageToastBridge", () => {
  let captured: MessageToastCallback | null = null;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    captured = null;
    unsubscribe.mockClear();
    showToastMock.mockClear();
    stubPierNotificationCenter({
      onMessageToast: (cb: MessageToastCallback) => {
        captured = cb;
        return unsubscribe;
      },
    });
  });

  afterEach(() => {
    cleanup();
    stubPierNotificationCenter(undefined);
  });

  it("renders shape-B toast only from main single-window message-toast", () => {
    render(<NotificationMessageToastBridge />);
    expect(captured).not.toBeNull();
    const item = notification({ id: "fresh", body: "detail" });
    captured?.(item);
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith(item);
  });

  it("unsubscribes on unmount", () => {
    const view = render(<NotificationMessageToastBridge />);
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("renders without the notificationCenter api", () => {
    stubPierNotificationCenter(undefined);
    expect(() => {
      render(<NotificationMessageToastBridge />);
    }).not.toThrow();
    expect(showToastMock).not.toHaveBeenCalled();
  });
});
