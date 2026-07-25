import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import type { ProcessTableRow } from "./process-table.ts";

export interface PanelEnvMarker {
  panelId: string;
  pid: number;
  windowId: string;
}

/** 真实 panel 标记：排除源码/命令行里误匹配的正则字面量。 */
const PANEL_ID_RE = /(?:^|[\s\0])PIER_PANEL_ID=(terminal-[A-Za-z0-9._-]+)/;
const WINDOW_ID_RE = /(?:^|[\s\0])PIER_WINDOW_ID=([0-9]+)/;

const ELECTRON_COMM_RE =
  /Electron|PierDev|Pier Helper|chrome_crashpad|Helper \(GPU\)|Helper \(Plugin\)|Helper \(Renderer\)/i;

function parseMarkerFromBlob(pid: number, blob: string): PanelEnvMarker | null {
  const panelMatch = PANEL_ID_RE.exec(blob);
  const windowMatch = WINDOW_ID_RE.exec(blob);
  if (!(panelMatch?.[1] && windowMatch?.[1])) {
    return null;
  }
  return {
    panelId: panelMatch[1],
    pid,
    windowId: windowMatch[1],
  };
}

/**
 * 收集 rootPids 在进程表中的全部子孙（含自身）。
 */
export function collectSubtreePids(
  rootPids: readonly number[],
  processes: readonly ProcessTableRow[]
): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const row of processes) {
    const list = childrenByParent.get(row.ppid);
    if (list) {
      list.push(row.pid);
    } else {
      childrenByParent.set(row.ppid, [row.pid]);
    }
  }
  const result = new Set<number>();
  const stack = [...rootPids];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (pid === undefined || result.has(pid)) {
      continue;
    }
    result.add(pid);
    const children = childrenByParent.get(pid);
    if (children) {
      for (const child of children) {
        stack.push(child);
      }
    }
  }
  return [...result];
}

/**
 * 候选 PID：Pier 子树中「非 Electron Helper」的进程（login/zsh/node/agent…）。
 * macOS 上只有对指定 pid 用 `ps -E -p` 才能读到 environ；全表 `ps -axewww` 不带 env。
 */
export function candidatePidsForEnvScan(
  appPids: readonly number[],
  processes: readonly ProcessTableRow[]
): number[] {
  const byPid = new Map(processes.map((row) => [row.pid, row]));
  const subtree = collectSubtreePids(appPids, processes);
  const candidates: number[] = [];
  for (const pid of subtree) {
    if (appPids.includes(pid)) {
      // 本体进程通常没有 PIER_PANEL_ID，仍可跳过以省调用。
      continue;
    }
    const row = byPid.get(pid);
    if (row && ELECTRON_COMM_RE.test(row.name)) {
      continue;
    }
    candidates.push(pid);
  }
  return candidates;
}

function scanDarwinEnvForPids(pids: readonly number[]): PanelEnvMarker[] {
  if (pids.length === 0) {
    return [];
  }
  const markers: PanelEnvMarker[] = [];
  // 分批避免超长命令行；macOS ps -E -p a,b,c 可一次读多进程 environ。
  const batchSize = 80;
  for (let offset = 0; offset < pids.length; offset += batchSize) {
    const batch = pids.slice(offset, offset + batchSize);
    try {
      const output = execFileSync(
        "ps",
        ["-E", "-p", batch.join(","), "-o", "pid=", "-o", "command="],
        {
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
          timeout: 2000,
        }
      );
      for (const line of output.split("\n")) {
        if (!line.includes("PIER_PANEL_ID=")) {
          continue;
        }
        const trimmed = line.trimStart();
        const space = trimmed.indexOf(" ");
        if (space <= 0) {
          continue;
        }
        const pid = Number(trimmed.slice(0, space));
        if (!Number.isFinite(pid) || pid <= 0) {
          continue;
        }
        const marker = parseMarkerFromBlob(pid, trimmed.slice(space + 1));
        if (marker) {
          markers.push(marker);
        }
      }
    } catch {
      // 单批失败不拖垮整次采样
    }
  }
  return markers;
}

function scanLinuxProc(pids: readonly number[] | null): PanelEnvMarker[] {
  try {
    const markers: PanelEnvMarker[] = [];
    const entries =
      pids === null
        ? readdirSync("/proc").filter((entry) => /^\d+$/.test(entry))
        : pids.map(String);
    for (const entry of entries) {
      const pid = Number(entry);
      if (!Number.isFinite(pid) || pid <= 0) {
        continue;
      }
      try {
        const raw = readFileSync(`/proc/${pid}/environ`);
        const blob = raw.toString("utf8").replaceAll("\0", " ");
        if (!blob.includes("PIER_PANEL_ID=")) {
          continue;
        }
        const marker = parseMarkerFromBlob(pid, blob);
        if (marker) {
          markers.push(marker);
        }
      } catch {
        // 权限/竞态
      }
    }
    return markers;
  } catch {
    return [];
  }
}

/**
 * 扫描带 `PIER_PANEL_ID` + `PIER_WINDOW_ID` 的进程。
 *
 * @param appPids Electron `getAppMetrics` 的 pid（及可选 main pid）
 * @param processes 全机进程表（用于子树闭包）
 */
export function scanPanelEnvMarkers(input: {
  appPids: readonly number[];
  processes: readonly ProcessTableRow[];
}): PanelEnvMarker[] {
  if (process.platform === "win32") {
    return [];
  }
  const candidates = candidatePidsForEnvScan(input.appPids, input.processes);
  if (process.platform === "linux") {
    // Linux 可扫 /proc；优先子树候选，失败再全量。
    const scoped = scanLinuxProc(candidates);
    if (scoped.length > 0 || candidates.length === 0) {
      return scoped;
    }
    return scanLinuxProc(null);
  }
  return scanDarwinEnvForPids(candidates);
}
