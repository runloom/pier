/**
 * N1 收件箱：带 panelId 的条目点击标已读并落入会话。
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsPage } from "../../../apps/mobile-web/src/pages/notifications.tsx";

const { commandMock } = vi.hoisted(() => ({ commandMock: vi.fn() }));

vi.mock("../../../apps/mobile-web/src/lib/session.ts", () => ({
  getMobileClient: () => ({ command: commandMock }),
}));

vi.mock("../../../apps/mobile-web/src/lib/push.ts", () => ({
  canSubscribe: () => false,
  subscribeWebPush: vi.fn(),
}));

describe("NotificationsPage（N1 点击落会话）", () => {
  beforeEach(() => {
    window.location.hash = "#/notifications";
    commandMock.mockReset();
    commandMock.mockImplementation((command: { type: string }) => {
      if (command.type === "notifications.list") {
        return Promise.resolve({
          items: [
            {
              id: "n-session",
              kind: "agent.attention",
              panelId: "p-wait",
              windowId: "w1",
              read: false,
              severity: "warning",
              title: "需要你处理",
              ts: Date.now(),
            },
            {
              id: "n-plain",
              kind: "app.update",
              read: false,
              severity: "info",
              title: "有更新",
              ts: Date.now(),
            },
          ],
          unreadCount: 2,
        });
      }
      return Promise.resolve({ marked: 1 });
    });
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
  });

  it("非 standalone 只给加主屏引导，不出现会失败的订阅按钮", async () => {
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("push-hint").textContent).toContain(
        "添加到主屏幕"
      );
    });
    expect(screen.queryByTestId("push-enable")).toBeNull();
  });

  it("带 panelId 的条目点击 = 标已读 + 进会话", async () => {
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("notification-open-n-session")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("notification-open-n-session"));
    expect(window.location.hash).toBe("#/session?panel=p-wait&window=w1");
    expect(
      commandMock.mock.calls.some(
        (call: unknown[]) =>
          (call[0] as { type: string; id?: string }).type ===
            "notifications.mark-read" &&
          (call[0] as { id?: string }).id === "n-session"
      )
    ).toBe(true);
  });

  it("无 panelId 的条目只标已读、不跳转", async () => {
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("notification-read-n-plain")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("notification-read-n-plain"));
    await waitFor(() => {
      expect(
        commandMock.mock.calls.some(
          (call: unknown[]) =>
            (call[0] as { type: string; id?: string }).id === "n-plain"
        )
      ).toBe(true);
    });
    expect(window.location.hash).toBe("#/notifications");
  });
});
