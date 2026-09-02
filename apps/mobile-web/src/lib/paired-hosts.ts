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

/**
 * 同一台开发机：稳定键相同，或 host:port 相同且至少一侧是无 hostId 的
 * LAN 存量。两侧都有 hostId 时只认 hostId——会合占位 host:port
 * （同一 relay 主机名）不得把两台机并成一条。
 */
export function hostsShareIdentity(a: StoredHost, b: StoredHost): boolean {
  if (storedHostKey(a) === storedHostKey(b)) {
    return true;
  }
  if (a.hostId !== undefined && b.hostId !== undefined) {
    return false;
  }
  return hostKey(a.host, a.port) === hostKey(b.host, b.port);
}

/** 新记录覆盖令牌；缺席的会合字段从旧记录补上（LAN 再配对不丢跨网能力）。 */
function mergeStoredHost(
  incoming: StoredHost,
  existing: StoredHost
): StoredHost {
  return {
    ...existing,
    ...incoming,
    ...(incoming.hostId === undefined && existing.hostId !== undefined
      ? {
          fingerprint: existing.fingerprint,
          hostId: existing.hostId,
          relayUrl: existing.relayUrl,
        }
      : {}),
  };
}

function dedupeHosts(hosts: StoredHost[]): StoredHost[] {
  const out: StoredHost[] = [];
  for (const host of hosts) {
    const index = out.findIndex((entry) => hostsShareIdentity(entry, host));
    if (index === -1) {
      out.push(host);
      continue;
    }
    const existing = out[index];
    if (existing === undefined) {
      out.push(host);
      continue;
    }
    out[index] = mergeStoredHost(existing, host);
  }
  return out;
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
  const hosts = parsed.flatMap((entry) => {
    const result = storedHostSchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
  const deduped = dedupeHosts(hosts);
  if (deduped.length !== hosts.length) {
    storage.setItem(STORAGE_KEY, JSON.stringify(deduped));
  }
  return deduped;
}

/** 按同一台机 upsert（hostId 或 LAN host:port）；新的排前面。 */
export function saveHost(
  host: StoredHost,
  storage: Storage = window.localStorage
): void {
  const current = loadHosts(storage);
  const superseded = current.filter((entry) => hostsShareIdentity(entry, host));
  const rest = current.filter((entry) => !hostsShareIdentity(entry, host));
  const merged = superseded.reduce(
    (incoming, existing) => mergeStoredHost(incoming, existing),
    host
  );
  storage.setItem(STORAGE_KEY, JSON.stringify([merged, ...rest]));
}

/** 按同一台机移除（hostId 键也会清掉同 host:port 的 LAN 别名）。 */
export function removeHostByKey(
  key: string,
  storage: Storage = window.localStorage
): void {
  const current = loadHosts(storage);
  const target = current.find((entry) => storedHostKey(entry) === key);
  const rest =
    target === undefined
      ? current.filter((entry) => storedHostKey(entry) !== key)
      : current.filter((entry) => !hostsShareIdentity(entry, target));
  storage.setItem(STORAGE_KEY, JSON.stringify(rest));
}
