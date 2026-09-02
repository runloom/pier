/**
 * Web Push 发送器（M2，规格 §12）：宿主自持 VAPID 密钥**直发**浏览器
 * Push Service（web.push.apple.com 等），不经会合云。
 *
 * - VAPID 私钥进 secrets-store（safeStorage）；公钥经命令
 *   `notifications.getPushPublicKey` 广告给壳。
 * - 句柄按 deviceId 落盘 pairing.json additive 字段 `pushHandles`；
 *   410/404（订阅失效）即删句柄。
 * - 节流：按 `${kind}:${agentRef ?? "global"}` 冷却（对齐 OS 冷却口径）。
 * - transport 可注入（测试假发送器）；默认惰性 import("web-push")。
 */
import type { PairingStore } from "@main/state/pairing-store.ts";
import type { SecretsStore } from "@main/state/secrets-store.ts";
import { parseAgentRef } from "@shared/contracts/agent/runtime-index.ts";
import type { AppNotification } from "@shared/contracts/notification-center.ts";
import type {
  PierPushHandle,
  PierRemotePushPayload,
} from "@shared/contracts/remote.ts";
import type { RemotePushCandidate } from "@shared/notification-delivery.ts";

export const VAPID_PUBLIC_SECRET_KEY = "remote.push.vapid.public";
export const VAPID_PRIVATE_SECRET_KEY = "remote.push.vapid.private";
/** VAPID subject：Apple 要求 mailto: 或 https URL。 */
export const VAPID_SUBJECT = "https://pier.codes";
/** 同一 (kind, agentRef) 的推送冷却窗口（对齐 attention 默认 cooldown）。 */
export const REMOTE_PUSH_COOLDOWN_MS = 180_000;

export interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushTransportError extends Error {
  statusCode?: number;
}

/** 发送一条 Web Push；失败抛错（statusCode 404/410 = 订阅失效）。 */
export type PushTransport = (
  subscription: WebPushSubscription,
  payloadJson: string,
  vapid: { publicKey: string; privateKey: string; subject: string }
) => Promise<void>;

export type VapidKeyGenerator = () => {
  publicKey: string;
  privateKey: string;
};

export interface RemotePushService {
  /** 投递候选：持有 webPush 句柄的设备 ∩ 存活配对设备。 */
  candidates(
    hasLiveSession: (deviceId: string) => boolean
  ): RemotePushCandidate[];
  /** 生成/加载 VAPID 密钥（幂等；惰性，默认关路径不得在 boot 调用）。 */
  ensureReady(): Promise<void>;
  handles(): PierPushHandle[];
  /** ensureReady 之后可用；供壳 `pushManager.subscribe` 用。 */
  publicKey(): string | null;
  registerHandle(deviceId: string, webPush: WebPushSubscription): void;
  /** 向指定设备发送（内部 ensureReady + 冷却 + 失效句柄清理）。 */
  send(
    notification: Pick<
      AppNotification,
      "kind" | "severity" | "title" | "body" | "agentRef" | "dedupeKey"
    >,
    deviceIds: string[]
  ): Promise<void>;
  unregisterHandle(deviceId: string): void;
}

async function defaultTransport(
  subscription: WebPushSubscription,
  payloadJson: string,
  vapid: { publicKey: string; privateKey: string; subject: string }
): Promise<void> {
  const webPush = await import("web-push");
  await webPush.default.sendNotification(subscription, payloadJson, {
    vapidDetails: {
      subject: vapid.subject,
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
    },
  });
}

async function defaultGenerateKeys(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const webPush = await import("web-push");
  return webPush.default.generateVAPIDKeys();
}

export function createRemotePushService(args: {
  store: PairingStore;
  secrets: SecretsStore;
  transport?: PushTransport;
  generateKeys?: () => Promise<{ publicKey: string; privateKey: string }>;
  now?: () => number;
  cooldownMs?: number;
}): RemotePushService {
  const { store, secrets } = args;
  const transport = args.transport ?? defaultTransport;
  const generateKeys = args.generateKeys ?? defaultGenerateKeys;
  const now = args.now ?? Date.now;
  const cooldownMs = args.cooldownMs ?? REMOTE_PUSH_COOLDOWN_MS;

  let vapid: { publicKey: string; privateKey: string } | null = null;
  let ensurePromise: Promise<void> | null = null;
  /** `${kind}:${agentRef ?? "global"}` → 冷却截止时刻。 */
  const cooldownUntil = new Map<string, number>();

  async function ensure(): Promise<void> {
    if (vapid !== null) {
      return;
    }
    const [publicKey, privateKey] = await Promise.all([
      secrets.get(VAPID_PUBLIC_SECRET_KEY),
      secrets.get(VAPID_PRIVATE_SECRET_KEY),
    ]);
    if (publicKey !== null && privateKey !== null) {
      vapid = { publicKey, privateKey };
      return;
    }
    const generated = await generateKeys();
    await secrets.set(VAPID_PUBLIC_SECRET_KEY, generated.publicKey);
    await secrets.set(VAPID_PRIVATE_SECRET_KEY, generated.privateKey);
    vapid = generated;
  }

  function handlesOf(state = store.get()): PierPushHandle[] {
    return state.pushHandles ?? [];
  }

  function unregisterHandle(deviceId: string): void {
    store.mutate((current) => ({
      ...current,
      pushHandles: (current.pushHandles ?? []).filter(
        (handle) => handle.deviceId !== deviceId
      ),
    }));
  }

  return {
    ensureReady() {
      if (!ensurePromise) {
        ensurePromise = ensure().finally(() => {
          if (vapid === null) {
            ensurePromise = null;
          }
        });
      }
      return ensurePromise;
    },

    publicKey() {
      return vapid?.publicKey ?? null;
    },

    registerHandle(deviceId, webPush) {
      store.mutate((current) => ({
        ...current,
        pushHandles: [
          ...(current.pushHandles ?? []).filter(
            (handle) => handle.deviceId !== deviceId
          ),
          { deviceId, shell: "web", webPush },
        ],
      }));
    },

    unregisterHandle,

    handles() {
      return handlesOf().map((handle) => ({ ...handle }));
    },

    candidates(hasLiveSession) {
      const paired = new Set(
        store.get().devices.map((device) => device.deviceId)
      );
      return handlesOf()
        .filter(
          (handle) =>
            handle.webPush !== undefined && paired.has(handle.deviceId)
        )
        .map((handle) => ({
          deviceId: handle.deviceId,
          hasLiveSession: hasLiveSession(handle.deviceId),
        }));
    },

    async send(notification, deviceIds) {
      if (deviceIds.length === 0) {
        return;
      }
      const cooldownKey = `${notification.kind}:${notification.agentRef ?? "global"}`;
      const ts = now();
      if ((cooldownUntil.get(cooldownKey) ?? 0) > ts) {
        return;
      }
      cooldownUntil.set(cooldownKey, ts + cooldownMs);

      await this.ensureReady();
      const keys = vapid;
      if (keys === null) {
        return;
      }
      // 会话深链：panelId 跨窗不唯一，必须带 window。
      // agentRef 解析只在 main（parseAgentRef 纪律）；无法解析 → 回收件箱。
      const parsed = notification.agentRef
        ? parseAgentRef(notification.agentRef)
        : undefined;
      const payload: PierRemotePushPayload = {
        title: notification.title,
        ...(notification.body === undefined ? {} : { body: notification.body }),
        path: parsed
          ? `/session?panel=${encodeURIComponent(parsed.panelId)}&window=${encodeURIComponent(parsed.windowId)}`
          : "/notifications",
        ...(notification.dedupeKey === undefined
          ? {}
          : { dedupeKey: notification.dedupeKey }),
      };
      const payloadJson = JSON.stringify(payload);
      const byDevice = new Map(
        handlesOf().map((handle) => [handle.deviceId, handle])
      );
      await Promise.all(
        deviceIds.map(async (deviceId) => {
          const handle = byDevice.get(deviceId);
          if (!handle?.webPush) {
            return;
          }
          try {
            await transport(handle.webPush, payloadJson, {
              ...keys,
              subject: VAPID_SUBJECT,
            });
          } catch (error) {
            const statusCode = (error as PushTransportError).statusCode;
            if (statusCode === 404 || statusCode === 410) {
              // 订阅失效（浏览器撤回/过期）：清句柄，下次不再推。
              unregisterHandle(deviceId);
              return;
            }
            console.warn(
              "[remote-push] send failed:",
              error instanceof Error ? error.message : String(error)
            );
          }
        })
      );
    },
  };
}
