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
});

export type StoredHost = z.infer<typeof storedHostSchema>;

const STORAGE_KEY = "pier.mobile.hosts";

export function hostKey(host: string, port: number): string {
  return `${host}:${port}`;
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

/** 按 host:port upsert；新的排前面（最近配对优先）。 */
export function saveHost(
  host: StoredHost,
  storage: Storage = window.localStorage
): void {
  const rest = loadHosts(storage).filter(
    (entry) => hostKey(entry.host, entry.port) !== hostKey(host.host, host.port)
  );
  storage.setItem(STORAGE_KEY, JSON.stringify([host, ...rest]));
}

export function removeHost(
  host: string,
  port: number,
  storage: Storage = window.localStorage
): void {
  const rest = loadHosts(storage).filter(
    (entry) => hostKey(entry.host, entry.port) !== hostKey(host, port)
  );
  storage.setItem(STORAGE_KEY, JSON.stringify(rest));
}
