import { app } from "electron";
import { listProcessTableSync, type ProcessTableRow } from "./process-table.ts";
import {
  listAppLoginPids,
  resolveRootFromPid,
} from "./resolve-session-roots.ts";
import {
  bindTerminalResourceSeed,
  listTerminalResourceSessions,
} from "./terminal-session-registry.ts";

const RETRY_DELAYS_MS = [0, 30, 80, 150] as const;

/** macOS Ghostty 才走 login 差分；其它平台立刻返回，避免空等 260ms。 */
export function canClaimLoginSeed(): boolean {
  return process.platform === "darwin";
}

export interface ClaimLoginDeps {
  collectAppPids: () => number[];
  listClaimedSeedPids: () => ReadonlySet<number>;
  listProcessTableSync: () => ProcessTableRow[];
  sleep: (ms: number) => Promise<void>;
}

const defaultDeps: ClaimLoginDeps = {
  collectAppPids,
  listClaimedSeedPids: listClaimedPidsFromRegistry,
  listProcessTableSync,
  sleep,
};

let deps: ClaimLoginDeps = defaultDeps;

/** 串行化 snapshot→create→claim，避免并发 create 抢同一 newborn login。 */
let spawnLockTail: Promise<unknown> = Promise.resolve();

/**
 * 终端 spawn 临界区：create 前 snapshot + create + seed claim 必须同锁串行。
 */
export function withTerminalSpawnLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = spawnLockTail.then(() => fn());
  spawnLockTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * 在 spawn 锁内：snapshot → create → 单次 tryClaim。
 * create 成功后后台补认领（不阻塞调用方）。
 */
export async function createTerminalAndSeedResource(input: {
  create: () => boolean;
  panelId: string;
  windowId: string;
}): Promise<boolean> {
  let loginPidsBefore: number[] = [];
  const ok = await withTerminalSpawnLock(() => {
    loginPidsBefore = snapshotAppLoginPids();
    const created = input.create();
    if (created && canClaimLoginSeed()) {
      tryClaimLoginSeedOnce({
        loginPidsBefore,
        panelId: input.panelId,
        windowId: input.windowId,
      });
    }
    return created;
  });
  if (ok && canClaimLoginSeed()) {
    claimLoginAfterTerminalCreate({
      loginPidsBefore,
      panelId: input.panelId,
      windowId: input.windowId,
    }).catch(() => undefined);
  }
  return ok;
}

/**
 * createTerminal 成功后：用进程表差分认领新出现的 login，写入 seedPid。
 * 仅 darwin；排除 registry 已占用 pid；多 newborn 时继续重试直至超时（不首拍硬失败）。
 */
export async function claimLoginAfterTerminalCreate(input: {
  loginPidsBefore: readonly number[];
  panelId: string;
  windowId: string;
}): Promise<number | null> {
  if (!canClaimLoginSeed()) {
    return null;
  }
  if (input.panelId.length === 0 || input.windowId.length === 0) {
    return null;
  }
  // 已有 seed 则跳过（快速路径 / 重复调用）
  if (panelAlreadySeeded(input.windowId, input.panelId)) {
    return null;
  }

  const beforeSet = new Set(input.loginPidsBefore);
  for (const delay of RETRY_DELAYS_MS) {
    if (delay > 0) {
      await deps.sleep(delay);
    }
    if (panelAlreadySeeded(input.windowId, input.panelId)) {
      return null;
    }
    const seedPid = tryClaimOnce({
      beforeSet,
      panelId: input.panelId,
      windowId: input.windowId,
    });
    if (seedPid !== null) {
      return seedPid;
    }
  }
  return null;
}

/**
 * 单次尝试（无 sleep）。供 spawn 锁内快速认领；login 尚未出现时返回 null。
 */
export function tryClaimLoginSeedOnce(input: {
  loginPidsBefore: readonly number[];
  panelId: string;
  windowId: string;
}): number | null {
  if (!canClaimLoginSeed()) {
    return null;
  }
  if (input.panelId.length === 0 || input.windowId.length === 0) {
    return null;
  }
  if (panelAlreadySeeded(input.windowId, input.panelId)) {
    return null;
  }
  return tryClaimOnce({
    beforeSet: new Set(input.loginPidsBefore),
    panelId: input.panelId,
    windowId: input.windowId,
  });
}

export function snapshotAppLoginPids(): number[] {
  if (!canClaimLoginSeed()) {
    return [];
  }
  const processes = deps.listProcessTableSync();
  return listAppLoginPids(deps.collectAppPids(), processes);
}

/** 测试用 */
export function setClaimLoginDepsForTests(
  partial: Partial<ClaimLoginDeps>
): void {
  deps = { ...defaultDeps, ...partial };
}

export function resetClaimLoginDepsForTests(): void {
  deps = defaultDeps;
  spawnLockTail = Promise.resolve();
}

function tryClaimOnce(input: {
  beforeSet: ReadonlySet<number>;
  panelId: string;
  windowId: string;
}): number | null {
  const processes = deps.listProcessTableSync();
  const appPids = deps.collectAppPids();
  const after = listAppLoginPids(appPids, processes);
  const claimed = deps.listClaimedSeedPids();
  const newborn = after.filter(
    (pid) => !(input.beforeSet.has(pid) || claimed.has(pid))
  );
  // 0 个：login 尚未出现 → 调用方重试
  // >1 个：仍有并发歧义 → 调用方重试（勿硬失败绑错）
  if (newborn.length !== 1) {
    return null;
  }
  const seedPid = newborn[0];
  if (seedPid === undefined) {
    return null;
  }
  const resolved = resolveRootFromPid(seedPid, processes);
  bindTerminalResourceSeed({
    loginPid: resolved.loginPid ?? seedPid,
    panelId: input.panelId,
    rootPid: resolved.rootPid ?? seedPid,
    seedPid,
    shellPid: resolved.shellPid,
    windowId: input.windowId,
  });
  return seedPid;
}

function panelAlreadySeeded(windowId: string, panelId: string): boolean {
  return listTerminalResourceSessions().some(
    (session) =>
      session.windowId === windowId &&
      session.panelId === panelId &&
      session.seedPid !== null
  );
}

function listClaimedPidsFromRegistry(): Set<number> {
  const claimed = new Set<number>();
  for (const session of listTerminalResourceSessions()) {
    if (session.seedPid !== null) {
      claimed.add(session.seedPid);
    }
    if (session.loginPid !== null) {
      claimed.add(session.loginPid);
    }
    if (session.rootPid !== null) {
      claimed.add(session.rootPid);
    }
  }
  return claimed;
}

function collectAppPids(): number[] {
  try {
    const metrics = app.getAppMetrics();
    return [...new Set([process.pid, ...metrics.map((metric) => metric.pid)])];
  } catch {
    return [process.pid];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
