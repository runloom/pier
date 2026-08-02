/**
 * OS 投递冷却（进程级）。仅约束系统通知横幅，不影响 inbox / 形态 B。
 *
 * 并发：`tryReserve` 在投递前占 in-flight 坑，防止 mark-after-async 双发；
 * shown=true → `commit`；shown=false → `release`。
 * 面板消失：`prune(liveAgentRefs)` 清掉已下线 agent 的冷却（重开视为新会话）。
 */
export interface OsCooldownStore {
  /** shown=true：记下成功时刻并清 in-flight。 */
  commit(key: string, now: number): void;
  /** 测试 / 诊断：直接写入最后成功时刻。 */
  mark(key: string, now: number): void;
  prune(liveAgentRefs: ReadonlySet<string>): void;
  /** shown=false / 投递失败：仅清 in-flight，不占冷却。 */
  release(key: string): void;
  shouldSkip(key: string, cooldownMs: number, now: number): boolean;
  /**
   * 若在冷却中或已有 in-flight 则 false；
   * 否则标记 in-flight 并返回 true（失败须 release，成功须 commit）。
   */
  tryReserve(key: string, cooldownMs: number, now: number): boolean;
}

export function createOsCooldownStore(): OsCooldownStore {
  const lastShown = new Map<string, number>();
  const inFlight = new Set<string>();

  function inCooldown(key: string, cooldownMs: number, now: number): boolean {
    if (cooldownMs <= 0) {
      return false;
    }
    const last = lastShown.get(key);
    if (last === undefined) {
      return false;
    }
    return now - last < cooldownMs;
  }

  return {
    tryReserve(key, cooldownMs, now) {
      if (inFlight.has(key) || inCooldown(key, cooldownMs, now)) {
        return false;
      }
      inFlight.add(key);
      return true;
    },
    commit(key, now) {
      inFlight.delete(key);
      lastShown.set(key, now);
    },
    release(key) {
      inFlight.delete(key);
    },
    mark(key, now) {
      lastShown.set(key, now);
    },
    prune(liveAgentRefs) {
      for (const key of [...lastShown.keys(), ...inFlight]) {
        const agentRef = extractAgentRefFromCooldownKey(key);
        if (agentRef && !liveAgentRefs.has(agentRef)) {
          lastShown.delete(key);
          inFlight.delete(key);
        }
      }
    },
    shouldSkip(key, cooldownMs, now) {
      return inFlight.has(key) || inCooldown(key, cooldownMs, now);
    },
  };
}

/** 从 makeOsCooldownKey 产物取回 agentRef。 */
export function extractAgentRefFromCooldownKey(key: string): string | null {
  const prefixes = [
    "agent.attention:waiting:",
    "agent.attention:error:",
    "agent.turn-finished:",
  ];
  for (const prefix of prefixes) {
    if (key.startsWith(prefix)) {
      const ref = key.slice(prefix.length);
      return ref.length > 0 ? ref : null;
    }
  }
  if (key.endsWith(":global")) {
    return null;
  }
  const colon = key.indexOf(":");
  if (colon > 0 && colon < key.length - 1) {
    return key.slice(colon + 1);
  }
  return null;
}
