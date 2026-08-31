/**
 * 在线表 + 设备名册（全内存，重启即弃；事实源是宿主 pairing-store 的连接期投影）。
 * relay 只见通行证哈希；verifyPass 恒常数时间比较（服务端设计 §3/§4）。
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { RosterEntry } from "@shared/contracts/relay/index.ts";

export interface UplinkPort {
  close(): void;
  send(json: string): void;
}

interface HostEntry {
  lastSeenAt: number;
  roster: Map<string, string>;
  uplink: UplinkPort;
}

export interface RelayRegistry {
  /** 应用名册增删；返回被移除的 deviceId（调用方据此断开 downlink）。 */
  applyRosterUpdate(
    hostId: string,
    upsert: RosterEntry[] | undefined,
    remove: string[] | undefined
  ): string[];
  hasDevice(hostId: string, deviceId: string): boolean;
  isOnline(hostId: string): boolean;
  rosterSize(hostId: string): number;
  /** 只在 uplink 仍是当前连接时下线（防旧连接迟到 close 误踢新连接）。 */
  setOffline(hostId: string, uplink: UplinkPort): boolean;
  /** 上线并担保名册；同 hostId 重复拨号返回被踢的旧连接（后来者胜）。 */
  setOnline(
    hostId: string,
    uplink: UplinkPort,
    roster: RosterEntry[]
  ): UplinkPort | null;
  touch(hostId: string): void;
  uplinkOf(hostId: string): UplinkPort | null;
  /** 常数时间核对通行证；宿主离线或不在名册一律 false。 */
  verifyPass(hostId: string, deviceId: string, relayPass: string): boolean;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function constantTimeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function createRelayRegistry(
  now: () => number = Date.now
): RelayRegistry {
  const hosts = new Map<string, HostEntry>();

  return {
    setOnline(hostId, uplink, roster) {
      const previous = hosts.get(hostId)?.uplink ?? null;
      hosts.set(hostId, {
        uplink,
        roster: new Map(
          roster.map((entry) => [entry.deviceId, entry.relayPassHash])
        ),
        lastSeenAt: now(),
      });
      return previous;
    },
    setOffline(hostId, uplink) {
      const entry = hosts.get(hostId);
      if (!entry || entry.uplink !== uplink) {
        return false;
      }
      hosts.delete(hostId);
      return true;
    },
    isOnline(hostId) {
      return hosts.has(hostId);
    },
    uplinkOf(hostId) {
      return hosts.get(hostId)?.uplink ?? null;
    },
    verifyPass(hostId, deviceId, relayPass) {
      const expected = hosts.get(hostId)?.roster.get(deviceId);
      if (!expected) {
        return false;
      }
      return constantTimeEqualHex(sha256Hex(relayPass), expected);
    },
    hasDevice(hostId, deviceId) {
      return hosts.get(hostId)?.roster.has(deviceId) ?? false;
    },
    rosterSize(hostId) {
      return hosts.get(hostId)?.roster.size ?? 0;
    },
    applyRosterUpdate(hostId, upsert, remove) {
      const entry = hosts.get(hostId);
      if (!entry) {
        return [];
      }
      for (const item of upsert ?? []) {
        entry.roster.set(item.deviceId, item.relayPassHash);
      }
      const removed: string[] = [];
      for (const deviceId of remove ?? []) {
        if (entry.roster.delete(deviceId)) {
          removed.push(deviceId);
        }
      }
      entry.lastSeenAt = now();
      return removed;
    },
    touch(hostId) {
      const entry = hosts.get(hostId);
      if (entry) {
        entry.lastSeenAt = now();
      }
    },
  };
}
