import type { AppNotification } from "@shared/contracts/notification-center.ts";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { showNotificationToast } from "@/lib/notifications/show-notification-toast.tsx";

vi.mock("sonner", () => ({
  toast: Object.assign(
    vi.fn(() => 1),
    { dismiss: vi.fn() }
  ),
}));

vi.mock("@/lib/notifications/notification-actions.ts", () => ({
  isNotificationActionAvailable: vi.fn(() => true),
  runNotificationAction: vi.fn(),
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
    title: "后台任务「pnpm build」已完成",
    trigger: "system-event",
    ts: Date.now(),
    ...overrides,
  };
}

describe("showNotificationToast（形态 B）", () => {
  beforeEach(async () => {
    await initI18n();
    vi.clearAllMocks();
  });

  it("renders standard shadcn toast: title + detail + outline action + close, no icon", () => {
    showNotificationToast(
      notification({
        actions: [
          {
            id: "open-output",
            labelKey: "terminal.runtimeControl.viewDetails",
          },
        ],
        body: "用时 42 秒",
      })
    );
    const [title, options] = vi.mocked(toast).mock.calls[0] ?? [];
    expect(title).toBe("后台任务「pnpm build」已完成");
    expect(options).toMatchObject({
      action: { label: "View details" },
      className: "pier-msg-toast",
      closeButton: true,
      description: "用时 42 秒",
      duration: 4000,
      style: {
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
        "--border-radius": "16px",
        "--width": "min(360px, calc(100vw - 32px))",
      },
    });
    expect(options).not.toHaveProperty("icon");
  });

  it("detail falls back to source/type line when body is absent", () => {
    showNotificationToast(notification({ body: undefined }));
    const options = vi.mocked(toast).mock.calls[0]?.[1];
    expect(options?.description).toBe("Task");
  });

  it("duration tiers by severity", () => {
    showNotificationToast(notification({ severity: "error" }));
    expect(vi.mocked(toast).mock.calls[0]?.[1]?.duration).toBe(10_000);
    showNotificationToast(notification({ severity: "warning" }));
    expect(vi.mocked(toast).mock.calls[1]?.[1]?.duration).toBe(6000);
  });

  it("omits action button when no actions", () => {
    showNotificationToast(notification({ actions: undefined }));
    expect(vi.mocked(toast).mock.calls[0]?.[1]?.action).toBeUndefined();
  });

  it("toast dismissal never marks the message read (unread lifecycle)", () => {
    showNotificationToast(notification());
    const options = vi.mocked(toast).mock.calls[0]?.[1] ?? {};
    // 结构保证：toast 不携带任何消散回调——自动消失/点 X 都不会标已读
    expect(options).not.toHaveProperty("onDismiss");
    expect(options).not.toHaveProperty("onAutoClose");
    expect(options).not.toHaveProperty("cancel");
  });
});
