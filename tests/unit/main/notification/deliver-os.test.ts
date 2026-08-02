import {
  createDeliverOs,
  resetDeliverOsDegradedLatchForTests,
} from "@main/services/notification-center/deliver-os.ts";
import { DEFAULT_AGENT_ATTENTION_SETTINGS } from "@shared/contracts/agent/attention.ts";
import type { AppNotification } from "@shared/contracts/notification-center.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const showSystemNotification = vi.fn();
const maybePlayAfterShown = vi.fn();
const focusAgentFromNotificationClick = vi.fn();
const broadcastAgentAttentionDegraded = vi.fn();
const broadcastSystemNotificationPermissionChanged = vi.fn();

vi.mock("@main/services/system-notification.ts", () => ({
  showSystemNotification: (...args: unknown[]) =>
    showSystemNotification(...args),
}));

vi.mock("@main/services/agent-attention/notification-audio.ts", () => ({
  decideNotificationAudio: () => ({
    appSoundId: "abstract-sound1",
    silent: true,
  }),
  maybePlayAfterShown: (...args: unknown[]) => maybePlayAfterShown(...args),
  toShowAudio: (d: { silent: boolean }) => ({ silent: d.silent }),
}));

vi.mock("@main/services/agent-attention/notification-click-focus.ts", () => ({
  focusAgentFromNotificationClick: (...args: unknown[]) =>
    focusAgentFromNotificationClick(...args),
}));

vi.mock("../../app-core/window-broadcasts.ts", () => ({
  broadcastAgentAttentionDegraded: (...args: unknown[]) =>
    broadcastAgentAttentionDegraded(...args),
  broadcastSystemNotificationPermissionChanged: (...args: unknown[]) =>
    broadcastSystemNotificationPermissionChanged(...args),
  sendAttentionSoundPlayToOneWindow: () => true,
}));

// deliver-os imports broadcasts with relative path from services/notification-center
vi.mock("@main/app-core/window-broadcasts.ts", () => ({
  broadcastAgentAttentionDegraded: (...args: unknown[]) =>
    broadcastAgentAttentionDegraded(...args),
  broadcastSystemNotificationPermissionChanged: (...args: unknown[]) =>
    broadcastSystemNotificationPermissionChanged(...args),
  sendAttentionSoundPlayToOneWindow: () => true,
}));

function notification(
  overrides: Partial<AppNotification> = {}
): AppNotification {
  return {
    id: "n1",
    kind: "agent.attention",
    read: false,
    severity: "warning",
    source: "agent-attention",
    title: "Need you",
    trigger: "system-event",
    ts: 1,
    agentRef: "11\0p1",
    dedupeKey: "agent.attention:waiting:11\0p1",
    ...overrides,
  };
}

describe("createDeliverOs", () => {
  beforeEach(() => {
    resetDeliverOsDegradedLatchForTests();
    showSystemNotification.mockReset();
    maybePlayAfterShown.mockReset();
    focusAgentFromNotificationClick.mockReset();
    broadcastAgentAttentionDegraded.mockReset();
    broadcastSystemNotificationPermissionChanged.mockReset();
    showSystemNotification.mockResolvedValue({ shown: true });
  });

  it("shows OS and plays sound only when shown", async () => {
    const deliver = createDeliverOs({
      getAttentionSettings: () => DEFAULT_AGENT_ATTENTION_SETTINGS,
      getIndex: () => null,
    });
    await expect(deliver(notification(), {})).resolves.toBe(true);
    expect(showSystemNotification).toHaveBeenCalledTimes(1);
    expect(maybePlayAfterShown).toHaveBeenCalledTimes(1);

    showSystemNotification.mockResolvedValue({
      reason: "denied",
      shown: false,
    });
    maybePlayAfterShown.mockClear();
    await expect(deliver(notification({ id: "n2" }), {})).resolves.toBe(false);
    expect(maybePlayAfterShown).not.toHaveBeenCalled();
  });

  it("still shows when runtime index is unbound", async () => {
    const deliver = createDeliverOs({
      getAttentionSettings: () => DEFAULT_AGENT_ATTENTION_SETTINGS,
      getIndex: () => null,
    });
    await expect(deliver(notification(), {})).resolves.toBe(true);
    expect(showSystemNotification).toHaveBeenCalled();
  });

  it("onClick marks read and deep-links when index present", async () => {
    const markReadByDedupeKey = vi.fn();
    const index = { focus: vi.fn() } as never;
    showSystemNotification.mockImplementation(async (_req, options) => {
      await options?.onClick?.({
        agentRef: "11\0p1",
        kind: "agent.attention",
        title: "Need you",
      });
      return { shown: true };
    });
    const deliver = createDeliverOs({
      getAttentionSettings: () => DEFAULT_AGENT_ATTENTION_SETTINGS,
      getIndex: () => index,
      markReadByDedupeKey,
    });
    await deliver(notification(), {});
    expect(markReadByDedupeKey).toHaveBeenCalledWith(
      "agent.attention:waiting:11\0p1"
    );
    expect(focusAgentFromNotificationClick).toHaveBeenCalled();
  });

  it("degraded latch fires once for denied/unsupported", async () => {
    showSystemNotification.mockImplementation(async (_req, options) => {
      options?.onUnavailable?.("denied");
      options?.onUnavailable?.("denied");
      return { shown: false, reason: "denied" };
    });
    const deliver = createDeliverOs({
      getAttentionSettings: () => DEFAULT_AGENT_ATTENTION_SETTINGS,
      getIndex: () => null,
    });
    await deliver(notification(), {});
    expect(broadcastAgentAttentionDegraded).toHaveBeenCalledTimes(1);
  });
});
