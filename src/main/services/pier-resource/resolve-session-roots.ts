import type { PanelEnvMarker } from "./panel-env-scan.ts";
import {
  collectDescendantPids,
  type ProcessTableRow,
} from "./process-table.ts";
import {
  bindTerminalResourcePids,
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
 * 从任一标记/候选 pid 向上解析 shell/login 根。
 * 供 env 标记绑定与 assemble 时 marker-only 聚合共用。
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
  for (let depth = 0; depth < 10 && current !== null; depth += 1) {
    const row = byPid.get(current);
    if (!row) {
      break;
    }
    if (isShell(row.name)) {
      shellPid = current;
      rootPid = current;
    }
    if (isLogin(row.name)) {
      loginPid = current;
      if (shellPid === null) {
        rootPid = current;
      }
      break;
    }
    current = row.ppid;
  }
  return { loginPid, rootPid, shellPid };
}

/**
 * 在 Pier 子树里发现 login→shell 会话根（尚可被登记表认领）。
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
    // 无 shell 子进程时，login 下可能直接跑 agent（bun/node）——用 login 作根
    const rootPid = shellPid ?? login.pid;
    if (input.claimedRootPids.has(rootPid)) {
      continue;
    }
    discovered.push({ loginPid: login.pid, rootPid, shellPid });
  }

  discovered.sort((a, b) => a.loginPid - b.loginPid);
  return discovered;
}

/**
 * 把 env 标记 / 新发现的 login shell 绑回登记表。
 *
 * 绑定优先级：
 * 1) env 标记（panel 身份稳定）——可对未登记 panel 先 auto-register
 * 2) 无标记时：仅在 **唯一** unclaimed 会话 + **唯一** 未占用 login 时 1:1 认领
 *    （禁止多会话 FIFO 索引 zip，避免错绑 CPU/内存）
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
    const markers = markersByPanel.get(key);
    if (!markers || markers.length === 0) {
      continue;
    }
    const startPid = markers[0]?.pid;
    if (startPid === undefined) {
      continue;
    }
    const resolved = resolveRootFromPid(startPid, input.processes);
    bindTerminalResourcePids({
      loginPid: resolved.loginPid,
      panelId: session.panelId,
      rootPid: resolved.rootPid,
      shellPid: resolved.shellPid,
      windowId: session.windowId,
    });
  }

  // 2) 仍无 root 的登记：仅在无歧义（1 会话 + 1 发现）时认领
  const refreshed = listTerminalResourceSessions();
  const claimed = new Set<number>();
  for (const session of refreshed) {
    if (session.rootPid !== null) {
      claimed.add(session.rootPid);
    }
    if (session.loginPid !== null) {
      claimed.add(session.loginPid);
    }
    if (session.shellPid !== null) {
      claimed.add(session.shellPid);
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
  // 多会话 + 多 login：宁可不绑，也不要 FIFO 错配（等 env 标记）

  return listTerminalResourceSessions();
}

export function aggregateFromRoot(
  rootPid: number,
  processes: readonly ProcessTableRow[]
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
  let topProcess: {
    cpuPercent: number;
    memoryBytes: number;
    name: string;
    pid: number;
  } | null = null;
  for (const pid of tree) {
    const row = byPid.get(pid);
    if (!row) {
      continue;
    }
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
    processCount: tree.size,
    topProcess,
  };
}
