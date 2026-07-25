import { execFileSync } from "node:child_process";

/**
 * OS 进程表一行（跨平台归一）。
 * - rssBytes：物理常驻（ps rss × 1024）
 * - cpuPercent：单核比例（ps %cpu / 100；可 >1）
 */
export interface ProcessTableRow {
  cpuPercent: number;
  name: string;
  pid: number;
  ppid: number;
  rssBytes: number;
}

function parseLeadingInts(
  line: string,
  count: number
): { rest: string; values: number[] } | null {
  const values: number[] = [];
  let index = 0;
  for (let i = 0; i < count; i += 1) {
    while (index < line.length && line[index] === " ") {
      index += 1;
    }
    const start = index;
    while (index < line.length && line[index] !== " ") {
      index += 1;
    }
    if (start === index) {
      return null;
    }
    const value = Number(line.slice(start, index));
    if (!Number.isFinite(value)) {
      return null;
    }
    values.push(value);
  }
  while (index < line.length && line[index] === " ") {
    index += 1;
  }
  return { rest: line.slice(index), values };
}

/**
 * 读取全机进程表（pid/ppid/rss/cpu/name）。
 * macOS/Linux 用一次 `ps`；Windows 返回空（P1 shallow）。
 */
export function listProcessTable(): ProcessTableRow[] {
  if (process.platform === "win32") {
    return [];
  }
  try {
    // pid ppid rss(KB) %cpu comm
    const output = execFileSync(
      "ps",
      ["-ax", "-o", "pid=,ppid=,rss=,%cpu=,comm="],
      {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        timeout: 1500,
      }
    );
    const rows: ProcessTableRow[] = [];
    for (const line of output.split("\n")) {
      if (line.trim().length === 0) {
        continue;
      }
      const parsed = parseLeadingInts(line, 4);
      if (!parsed) {
        continue;
      }
      const [pid, ppid, rssKb, cpuPoints] = parsed.values;
      if (
        pid === undefined ||
        ppid === undefined ||
        rssKb === undefined ||
        cpuPoints === undefined ||
        pid <= 0
      ) {
        continue;
      }
      const name = parsed.rest.trim() || "?";
      rows.push({
        cpuPercent: Math.max(0, cpuPoints) / 100,
        name,
        pid,
        ppid,
        rssBytes: Math.max(0, rssKb) * 1024,
      });
    }
    return rows;
  } catch {
    return [];
  }
}

/**
 * 从 shell 根 pid 出发，在进程表里收集子孙（含自身）。
 */
export function collectDescendantPids(
  rootPid: number,
  processes: readonly ProcessTableRow[]
): Set<number> {
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
  const stack = [rootPid];
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
  return result;
}
