import type { PanelEnvMarker } from "./panel-env-scan.ts";
import {
  collectDescendantPids,
  type ProcessTableRow,
} from "./process-table.ts";
import {
  bindTerminalResourcePids,
  clearTerminalResourceBinding,
  listTerminalResourceSessions,
  registerTerminalResourceSession,
  type TerminalResourceRegistration,
} from "./terminal-session-registry.ts";

function basenameCommand(name: string): string {
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  const base = slash >= 0 ? name.slice(slash + 1) : name;
  return base.replace(/^-/, "");
}

function isLogin(name: string): boolean {
  return basenameCommand(name) === "login";
}

function isShell(name: string): boolean {
  const base = basenameCommand(name).toLowerCase();
  return (
    base === "zsh" ||
    base === "bash" ||
    base === "fish" ||
    base === "sh" ||
    base === "nu"
  );
}

export interface ResolvedSessionRoot {
  loginPid: number | null;
  rootPid: number | null;
  shellPid: number | null;
}

/**
 * 从任一标记/候选 pid 向上解析会话根。
 *
 * 聚合根优先 login（ppid 通常落在 Electron 进程集合）：整棵 PTY 子树都在其下，
 * 避免「嵌套 zsh 当根」漏掉同 login 下 agent/MCP，也避免 markers 顺序导致抖根。
 * 无 login 时退回最外层 shell，再退回 startPid。
 */
export function resolveRootFromPid(
  startPid: number,
  processes: readonly ProcessTableRow[]
): ResolvedSessionRoot {
  const byPid = new Map(processes.map((row) => [row.pid, row]));
  let rootPid: number | null = startPid;
  let shellPid: number | null = null;
  let loginPid: number | null = null;
  let current: number | null = startPid;
  for (let depth = 0; depth < 16 && current !== null; depth += 1) {
    const row = byPid.get(current);
    if (!row) {
      break;
    }
    if (isShell(row.name)) {
      // 向上爬：后命中的 shell 更靠外
      shellPid = current;
      if (loginPid === null) {
        rootPid = current;
      }
    }
    if (isLogin(row.name)) {
      loginPid = current;
      rootPid = current;
      break;
    }
    current = row.ppid;
  }
  // seed/标记直接钉在 login 上时，补一层 login 的 shell 子进程（取最小 pid，确定）
  if (loginPid !== null && shellPid === null) {
    let bestShell: number | null = null;
    for (const row of processes) {
      if (
        row.ppid === loginPid &&
        isShell(row.name) &&
        (bestShell === null || row.pid < bestShell)
      ) {
        bestShell = row.pid;
      }
    }
    shellPid = bestShell;
  }
  return { loginPid, rootPid, shellPid };
}

/**
 * 同 panel 多个 env 标记时选最稳的解析结果：优先带 login 的根，其次较小 rootPid。
 */
export function pickPreferredResolvedRoot(
  resolved: readonly ResolvedSessionRoot[]
): ResolvedSessionRoot | null {
  if (resolved.length === 0) {
    return null;
  }
  let best: ResolvedSessionRoot | null = null;
  for (const candidate of resolved) {
    if (candidate.rootPid === null) {
      continue;
    }
    if (best === null || best.rootPid === null) {
      best = candidate;
      continue;
    }
    const bestHasLogin = best.loginPid !== null;
    const candidateHasLogin = candidate.loginPid !== null;
    if (candidateHasLogin !== bestHasLogin) {
      if (candidateHasLogin) {
        best = candidate;
      }
      continue;
    }
    if (candidate.rootPid < best.rootPid) {
      best = candidate;
    }
  }
  return best;
}

/**
 * 在 Pier 子树里发现 login→shell 会话根（尚可被登记表认领）。
 * 聚合根固定为 login（无 shell 子进程时同样用 login）。
 */
export function discoverLoginShellRoots(input: {
  appPids: readonly number[];
  claimedRootPids: ReadonlySet<number>;
  processes: readonly ProcessTableRow[];
}): Array<{ loginPid: number; rootPid: number; shellPid: number | null }> {
  const byPid = new Map(input.processes.map((row) => [row.pid, row]));
  const childrenByParent = new Map<number, number[]>();
  for (const row of input.processes) {
    const list = childrenByParent.get(row.ppid);
    if (list) {
      list.push(row.pid);
    } else {
      childrenByParent.set(row.ppid, [row.pid]);
    }
  }

  const appSet = new Set(input.appPids);
  const logins = input.processes.filter(
    (row) => isLogin(row.name) && appSet.has(row.ppid)
  );

  const discovered: Array<{
    loginPid: number;
    rootPid: number;
    shellPid: number | null;
  }> = [];

  for (const login of logins) {
    if (input.claimedRootPids.has(login.pid)) {
      continue;
    }
    const children = childrenByParent.get(login.pid) ?? [];
    let shellPid: number | null = null;
    for (const childPid of children) {
      const child = byPid.get(childPid);
      if (child && isShell(child.name)) {
        shellPid = child.pid;
        break;
      }
    }
    // 聚合根始终是 login，保证整棵 PTY 子树（含旁路子进程）计入
    const rootPid = login.pid;
    discovered.push({ loginPid: login.pid, rootPid, shellPid });
  }

  discovered.sort((a, b) => a.loginPid - b.loginPid);
  return discovered;
}

/** 列出 app 子进程中的 login pid（create 前后差分用）。 */
export function listAppLoginPids(
  appPids: readonly number[],
  processes: readonly ProcessTableRow[]
): number[] {
  const appSet = new Set(appPids);
  return processes
    .filter((row) => isLogin(row.name) && appSet.has(row.ppid))
    .map((row) => row.pid)
    .sort((a, b) => a - b);
}

/**
 * 把 env 标记 / 新发现的 login shell 绑回登记表。
 *
 * 绑定优先级：
 * 1) 已有 seedPid（create 时写入）——最稳，不依赖 env
 * 2) env 标记（panel 身份稳定）——可对未登记 panel 先 auto-register；根取 login
 * 3) 无标记时：仅在 **唯一** unclaimed 会话 + **唯一** 未占用 login 时 1:1 认领
 */
export function reconcileTerminalSessionRoots(input: {
  appPids: readonly number[];
  markers: readonly PanelEnvMarker[];
  processes: readonly ProcessTableRow[];
}): TerminalResourceRegistration[] {
  // 1) 标记侧：未登记的 panel 先写入登记表（reload 竞态 / marker-only）
  for (const marker of input.markers) {
    registerTerminalResourceSession({
      panelId: marker.panelId,
      windowId: marker.windowId,
    });
  }

  const sessions = listTerminalResourceSessions();

  const markersByPanel = new Map<string, PanelEnvMarker[]>();
  for (const marker of input.markers) {
    const key = `${marker.windowId}\0${marker.panelId}`;
    const list = markersByPanel.get(key);
    if (list) {
      list.push(marker);
    } else {
      markersByPanel.set(key, [marker]);
    }
  }

  for (const session of sessions) {
    const key = `${session.windowId}\0${session.panelId}`;

    // seedPid：create 时钉死的 login/pty 子进程，优先且每拍可刷新 shell 信息
    if (session.seedPid !== null) {
      const seedAlive = input.processes.some(
        (row) => row.pid === session.seedPid
      );
      if (seedAlive) {
        const resolved = resolveRootFromPid(session.seedPid, input.processes);
        if (resolved.rootPid !== null) {
          bindTerminalResourcePids({
            loginPid: resolved.loginPid,
            panelId: session.panelId,
            rootPid: resolved.rootPid,
            shellPid: resolved.shellPid,
            windowId: session.windowId,
          });
          continue;
        }
      }
      // seed 已死：清掉绑定与 seed，避免 0 指标 / 占 claimed；再走 marker
      clearTerminalResourceBinding({
        clearSeed: true,
        panelId: session.panelId,
        windowId: session.windowId,
      });
    }

    const markers = markersByPanel.get(key);
    if (!markers || markers.length === 0) {
      continue;
    }
    const resolvedList = markers.map((marker) =>
      resolveRootFromPid(marker.pid, input.processes)
    );
    const preferred = pickPreferredResolvedRoot(resolvedList);
    if (!preferred || preferred.rootPid === null) {
      continue;
    }
    bindTerminalResourcePids({
      loginPid: preferred.loginPid,
      panelId: session.panelId,
      rootPid: preferred.rootPid,
      shellPid: preferred.shellPid,
      windowId: session.windowId,
    });
  }

  // 2) 仍无 root 的登记：仅在无歧义（1 会话 + 1 发现）时认领
  const refreshed = listTerminalResourceSessions();
  const livePids = new Set(input.processes.map((row) => row.pid));
  const claimed = new Set<number>();
  for (const session of refreshed) {
    // 只认领仍存活的 pid，避免复用/僵尸占坑
    if (session.rootPid !== null && livePids.has(session.rootPid)) {
      claimed.add(session.rootPid);
    }
    if (session.loginPid !== null && livePids.has(session.loginPid)) {
      claimed.add(session.loginPid);
    }
    if (session.shellPid !== null && livePids.has(session.shellPid)) {
      claimed.add(session.shellPid);
    }
    if (session.seedPid !== null && livePids.has(session.seedPid)) {
      claimed.add(session.seedPid);
    }
  }

  const unclaimedSessions = refreshed
    .filter((s) => s.rootPid === null)
    .sort((a, b) => a.createdAt - b.createdAt);
  const discovered = discoverLoginShellRoots({
    appPids: input.appPids,
    claimedRootPids: claimed,
    processes: input.processes,
  });

  if (unclaimedSessions.length === 1 && discovered.length === 1) {
    const session = unclaimedSessions[0];
    const root = discovered[0];
    if (session && root) {
      bindTerminalResourcePids({
        loginPid: root.loginPid,
        panelId: session.panelId,
        rootPid: root.rootPid,
        shellPid: root.shellPid,
        windowId: session.windowId,
      });
    }
  }
  // 多会话 + 多 login：宁可不绑，也不要 FIFO 错配（等 seed / env 标记）

  return listTerminalResourceSessions();
}

export function aggregateFromRoot(
  rootPid: number,
  processes: readonly ProcessTableRow[],
  options: { excludePids?: ReadonlySet<number> } = {}
): {
  cpuPercent: number;
  memoryBytes: number;
  processCount: number;
  topProcess: {
    cpuPercent: number;
    memoryBytes: number;
    name: string;
    pid: number;
  } | null;
} {
  const byPid = new Map(processes.map((row) => [row.pid, row]));
  const tree = collectDescendantPids(rootPid, processes);
  let cpuPercent = 0;
  let memoryBytes = 0;
  let processCount = 0;
  let topProcess: {
    cpuPercent: number;
    memoryBytes: number;
    name: string;
    pid: number;
  } | null = null;
  for (const pid of tree) {
    if (options.excludePids?.has(pid)) {
      continue;
    }
    const row = byPid.get(pid);
    if (!row) {
      continue;
    }
    processCount += 1;
    cpuPercent += row.cpuPercent;
    memoryBytes += row.rssBytes;
    if (
      topProcess === null ||
      row.cpuPercent > topProcess.cpuPercent ||
      (row.cpuPercent === topProcess.cpuPercent &&
        row.rssBytes > topProcess.memoryBytes)
    ) {
      topProcess = {
        cpuPercent: row.cpuPercent,
        memoryBytes: row.rssBytes,
        name: basenameCommand(row.name),
        pid: row.pid,
      };
    }
  }
  return {
    cpuPercent,
    memoryBytes,
    processCount,
    topProcess,
  };
}
