import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * OS 进程表一行（跨平台归一）。
 * - rssBytes：物理常驻（ps rss × 1024）
 * - cpuPercent：单核比例（ps %cpu / 100；可 >1）
 *   注意：Linux 的 %cpu 是进程生命周期均值，不是瞬时值；采样层会按平台处理。
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

function parseProcessTableOutput(output: string): ProcessTableRow[] {
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
}

const PS_ARGS = ["-ax", "-o", "pid=,ppid=,rss=,%cpu=,comm="] as const;

/**
 * 异步读取全机进程表（采样路径用，避免堵死 main）。
 */
export async function listProcessTable(): Promise<ProcessTableRow[]> {
  if (process.platform === "win32") {
    return [];
  }
  try {
    const { stdout } = await execFileAsync("ps", [...PS_ARGS], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 1500,
    });
    return parseProcessTableOutput(stdout);
  } catch {
    return [];
  }
}

/**
 * 同步读取（仅 create 后差分认领等短路径；勿用于 2s 轮询）。
 */
export function listProcessTableSync(): ProcessTableRow[] {
  if (process.platform === "win32") {
    return [];
  }
  try {
    const output = execFileSync("ps", [...PS_ARGS], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 1500,
    });
    return parseProcessTableOutput(output);
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
