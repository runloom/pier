/**
 * 已配对宿主的 localStorage 持久化（M1 Web 壳）：
 * - 键 pier.mobile.hosts；值为一台或多台 { host, port, deviceId, deviceToken }；
 * - deviceToken 原文只存本机浏览器，语义对齐 pairing-store（宿主侧只存 hash）。
 */
import { z } from "zod";

const storedHostSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  deviceId: z.string().min(1),
  deviceToken: z.string().min(1),
  /** 设备自报名（pair 请求体 name），仅列表展示。 */
  name: z.string().min(1).max(64).optional(),
  pairedAt: z.number().int().nonnegative(),
  /** M2 additive：宿主身份 id（会合路由）。缺省 = M1 纯 LAN 存量。 */
  hostId: z.string().min(1).optional(),
  /** M2 additive：宿主指纹（E2E / relayPass 派生盐）。 */
  fingerprint: z.string().min(1).optional(),
  /** M2 additive：会合 wss 基址；有值即可跨网连接。 */
  relayUrl: z.string().min(1).optional(),
});

export type StoredHost = z.infer<typeof storedHostSchema>;

const STORAGE_KEY = "pier.mobile.hosts";

export function hostKey(host: string, port: number): string {
  return `${host}:${port}`;
}

/**
 * 宿主稳定键：relay 宿主用 hostId（多台经同一 relayUrl 不撞键）；
 * direct（M1）宿主无 hostId 回落 host:port，行为不变。
 */
export function storedHostKey(stored: StoredHost): string {
  return stored.hostId ?? hostKey(stored.host, stored.port);
}

/** 可经会合跨网连接：三要素齐备（relayUrl + hostId + fingerprint）。 */
export function canReachViaRelay(stored: StoredHost): stored is StoredHost & {
  relayUrl: string;
  hostId: string;
  fingerprint: string;
} {
  return (
    stored.relayUrl !== undefined &&
    stored.hostId !== undefined &&
    stored.fingerprint !== undefined
  );
}

/** 读取宿主列表；损坏/漂移数据静默丢弃，不炸 UI。 */
export function loadHosts(
  storage: Storage = window.localStorage
): StoredHost[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.flatMap((entry) => {
    const result = storedHostSchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
}

/** 按稳定键 upsert（relay=hostId / direct=host:port）；新的排前面。 */
export function saveHost(
  host: StoredHost,
  storage: Storage = window.localStorage
): void {
  const key = storedHostKey(host);
  const rest = loadHosts(storage).filter(
    (entry) => storedHostKey(entry) !== key
  );
  storage.setItem(STORAGE_KEY, JSON.stringify([host, ...rest]));
}

/** 按稳定键移除（relay=hostId / direct=host:port）。 */
export function removeHostByKey(
  key: string,
  storage: Storage = window.localStorage
): void {
  const rest = loadHosts(storage).filter(
    (entry) => storedHostKey(entry) !== key
  );
  storage.setItem(STORAGE_KEY, JSON.stringify(rest));
}
