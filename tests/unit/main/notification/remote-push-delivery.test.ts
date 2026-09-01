// @vitest-environment node
/**
 * NCS × remotePush 接线（M2 Task 8）：候选注入 → resolveDeliveryPlan 第三
 * 通道 → deliverRemotePush 只收无前台会话设备；有 key-window 仍推；
 * 无候选 / DND 非 error 不推。
 */
import { createNotificationCenterService } from "@main/services/notification-center/service.ts";
import type { NotificationHistoryStore } from "@main/services/notification-center/store.ts";
import {
  type AppNotification,
  DEFAULT_NOTIFICATION_CENTER_PREFS,
} from "@shared/contracts/notification-center.ts";
import type { RemotePushCandidate } from "@shared/notification-delivery.ts";
import { describe, expect, it } from "vitest";

function memoryHistory(): NotificationHistoryStore {
  let state: AppNotification[] = [];
  return {
    flush: async () => undefined,
    items: () => [...state],
    markAllRead: () => {
      state = state.map((item) => ({ ...item, read: true }));
    },
    markRead: () => false,
    mergeExisting: () => null,
    prepend: (item) => {
      state = [item, ...state];
    },
    pruneExpired: () => undefined,
    removeWhere: () => 0,
  };
}

async function makeService(args: {
  candidates: RemotePushCandidate[];
  dndEnabled?: boolean;
}) {
  const delivered: Array<{ title: string; deviceIds: string[] }> = [];
  const service = await createNotificationCenterService({
    broadcast: () => undefined,
    deliverRemotePush: (notification, target) => {
      delivered.push({
        deviceIds: target.deviceIds,
        title: notification.title,
      });
    },
    history: memoryHistory(),
    readFocusBase: () => ({ hasFocusedPierWindow: true }),
    readPrefs: async () => ({
      ...DEFAULT_NOTIFICATION_CENTER_PREFS,
      dndEnabled: args.dndEnabled ?? false,
    }),
    readRemotePushCandidates: () => args.candidates,
    writeDnd: async () => undefined,
  });
  return { delivered, service };
}

const ATTENTION_REPORT = {
  agentRef: "11:p1",
  kind: "agent.attention",
  severity: "warning",
  source: "host",
  title: "需要你处理",
  trigger: "system-event",
} as const;

describe("NCS remotePush 接线", () => {
  it("有 key-window 仍推；只推无前台会话设备", async () => {
    const { delivered, service } = await makeService({
      candidates: [
        { deviceId: "d-idle", hasLiveSession: false },
        { deviceId: "d-live", hasLiveSession: true },
      ],
    });
    service.ingest(ATTENTION_REPORT);
    expect(delivered).toEqual([{ deviceIds: ["d-idle"], title: "需要你处理" }]);
  });

  it("无候选零调用；非 OS 白名单 kind 零调用", async () => {
    const none = await makeService({ candidates: [] });
    none.service.ingest(ATTENTION_REPORT);
    expect(none.delivered).toEqual([]);

    const wrongKind = await makeService({
      candidates: [{ deviceId: "d-idle", hasLiveSession: false }],
    });
    wrongKind.service.ingest({
      ...ATTENTION_REPORT,
      kind: "app.update",
      severity: "success",
    });
    expect(wrongKind.delivered).toEqual([]);
  });

  it("DND 挡非 error 的远程推送（与 toast 同规则）", async () => {
    const { delivered, service } = await makeService({
      candidates: [{ deviceId: "d-idle", hasLiveSession: false }],
      dndEnabled: true,
    });
    service.ingest(ATTENTION_REPORT);
    expect(delivered).toEqual([]);
  });
});
