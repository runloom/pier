import type { AppNotification } from "@shared/contracts/notification-center.ts";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationToastPreviewBridge } from "@/components/common/notification-toast-preview-bridge.tsx";
import {
  resetNotificationCenterHydrationForTests,
  useNotificationCenterStore,
} from "@/stores/notification-center.store.ts";

const showToastMock = vi.fn<(n: AppNotification) => void>();

vi.mock("@/lib/notifications/show-notification-toast.tsx", () => ({
  showNotificationToast: (n: AppNotification) => showToastMock(n),
}));

function item(overrides: Partial<AppNotification> = {}): AppNotification {
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

function apply(items: AppNotification[], seq: number): void {
  useNotificationCenterStore.getState().apply({
    dndEnabled: false,
    items,
    seq,
    unreadCount: items.filter((i) => !i.read).length,
  });
}

describe("NotificationToastPreviewBridge", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetNotificationCenterHydrationForTests();
    useNotificationCenterStore.setState({
      dndEnabled: false,
      hydrated: false,
      items: [],
      seq: -1,
      unreadCount: 0,
    });
  });

  it("primes on hydration: history is never replayed as toast", async () => {
    render(<NotificationToastPreviewBridge />);
    // 等预览桥完成水合订阅（then 微任务挂接）后再 apply
    await new Promise((r) => setTimeout(r, 0));
    apply([item({ id: "old-1" }), item({ id: "old-2" })], 1);
    await new Promise((r) => setTimeout(r, 0));
    expect(showToastMock).not.toHaveBeenCalled();
    // 正向对照：水合后的新事件仍正常弹（排除「订阅根本没生效」的假阳性）
    apply(
      [item({ id: "old-1" }), item({ id: "old-2" }), item({ id: "fresh" })],
      2
    );
    await vi.waitFor(() => {
      expect(showToastMock).toHaveBeenCalledTimes(1);
    });
    expect(showToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fresh" })
    );
  });

  it("toasts only new whitelisted unread items after priming", async () => {
    render(<NotificationToastPreviewBridge />);
    await new Promise((r) => setTimeout(r, 0));
    apply([item({ id: "old" })], 1);
    // 等水合 then 回调完成订阅与 seen 灌入，再推下一条广播
    await new Promise((r) => setTimeout(r, 0));
    apply([item({ id: "old" }), item({ id: "new-agent" })], 2);
    await vi.waitFor(() => {
      expect(showToastMock).toHaveBeenCalledTimes(1);
    });
    expect(showToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "new-agent" })
    );
  });

  it("pre-hydration events are primed as history, not toasted", async () => {
    render(<NotificationToastPreviewBridge />);
    await new Promise((r) => setTimeout(r, 0));
    // 水合前抢先到达的广播本就在 main 快照里：水合 resolve 时无法与历史区分，
    // 一律按历史 prime（已进 inbox），不回放 toast。
    apply([item({ id: "early" })], 1);
    await new Promise((r) => setTimeout(r, 0));
    expect(showToastMock).not.toHaveBeenCalled();
    // 正向对照：prime 之后的新事件仍正常弹
    apply([item({ id: "early" }), item({ id: "later" })], 2);
    await vi.waitFor(() => {
      expect(showToastMock).toHaveBeenCalledTimes(1);
    });
    expect(showToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "later" })
    );
  });

  it("skips read items and non-whitelisted kinds", async () => {
    render(<NotificationToastPreviewBridge />);
    await new Promise((r) => setTimeout(r, 0));
    apply([], 1);
    await new Promise((r) => setTimeout(r, 0));
    apply(
      [
        item({ id: "read-item", read: true }),
        item({ id: "sys", kind: "app.update", severity: "info" }),
        item({ id: "ok-item" }),
      ],
      2
    );
    // 已读与非白名单不弹，但同批的白名单未读项必须弹（正向对照）
    await vi.waitFor(() => {
      expect(showToastMock).toHaveBeenCalledTimes(1);
    });
    expect(showToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ok-item" })
    );
  });

  it("re-toasts when a merged repeat bumps repeatCount (same id)", async () => {
    render(<NotificationToastPreviewBridge />);
    await new Promise((r) => setTimeout(r, 0));
    apply([item({ id: "a1" })], 1);
    await new Promise((r) => setTimeout(r, 0));
    apply([item({ id: "a1" }), item({ id: "a2" })], 2);
    await vi.waitFor(() => {
      expect(showToastMock).toHaveBeenCalledTimes(1);
    });
    // dedupe 合并保留原 id 但 repeatCount+1：同一 agent 再次需要注意 → 重新弹预览
    apply([item({ id: "a1", repeatCount: 2 }), item({ id: "a2" })], 3);
    await vi.waitFor(() => {
      expect(showToastMock).toHaveBeenCalledTimes(2);
    });
    expect(showToastMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "a1", repeatCount: 2 })
    );
  });

  it("DND silences non-error previews", async () => {
    render(<NotificationToastPreviewBridge />);
    await new Promise((r) => setTimeout(r, 0));
    apply([], 1);
    await new Promise((r) => setTimeout(r, 0));
    useNotificationCenterStore.getState().apply({
      dndEnabled: true,
      items: [item({ id: "d1" })],
      seq: 2,
      unreadCount: 1,
    });
    expect(showToastMock).not.toHaveBeenCalled();
    useNotificationCenterStore.getState().apply({
      dndEnabled: true,
      items: [item({ id: "d1" }), item({ id: "e1", severity: "error" })],
      seq: 3,
      unreadCount: 2,
    });
    await vi.waitFor(() => {
      expect(showToastMock).toHaveBeenCalledTimes(1);
    });
    expect(showToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "e1" })
    );
  });
});
