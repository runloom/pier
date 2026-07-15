/**
 * Background task 进程登记表：覆盖 unclean 退出后的 OS 孤儿回收。
 * 只杀「本 app 登记过」且命令指纹仍匹配的 pid/pgid，禁止扫端口或全局 node。
 */
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";

interface LedgerEntry {
  /** 启动命令摘要，用于 PID 复用后的身份校验。 */
  commandHint: string;
  pid: number;
  runId: string;
  startedAt: number;
}

interface LedgerFile {
  entries: LedgerEntry[];
  version: 1;
}

/** 超过此年龄的登记一律丢弃，不再尝试杀（降低长期 PID 复用风险）。 */
const MAX_LEDGER_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function ledgerPath(): string {
  return join(app.getPath("userData"), "background-task-process-ledger.json");
}

function normalizeCommandHint(command: string): string {
  return command.trim().replace(/\s+/g, " ").slice(0, 240);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readProcessCommandLine(pid: number): string | null {
  if (process.platform === "win32") {
    try {
      const output = execFileSync(
        "wmic",
        [
          "process",
          "where",
          `ProcessId=${pid}`,
          "get",
          "CommandLine",
          "/value",
        ],
        { encoding: "utf8", timeout: 2000, windowsHide: true }
      );
      const match = /CommandLine=(.*)/.exec(output);
      const line = match?.[1]?.trim();
      return line && line.length > 0 ? line : null;
    } catch {
      return null;
    }
  }
  try {
    const line = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
    return line.length > 0 ? line : null;
  } catch {
    return null;
  }
}

function commandMatchesHint(commandLine: string, hint: string): boolean {
  if (hint.length === 0) {
    return false;
  }
  const normalized = normalizeCommandHint(commandLine);
  return (
    normalized === hint ||
    normalized.includes(hint) ||
    hint.includes(normalized.slice(0, Math.min(hint.length, 80)))
  );
}

function signalProcessTree(pid: number, signal: NodeJS.Signals): void {
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // Fall through to direct pid.
    }
  }
  try {
    process.kill(pid, signal);
  } catch {
    // Already gone.
  }
}

let writeChain: Promise<void> = Promise.resolve();

function enqueueLedgerWrite<T>(work: () => Promise<T>): Promise<T> {
  const run = writeChain.then(work, work);
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function readLedger(): Promise<LedgerFile> {
  try {
    const raw = await readFile(ledgerPath(), "utf8");
    const parsed = JSON.parse(raw) as LedgerFile;
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
      return { entries: [], version: 1 };
    }
    return {
      entries: parsed.entries.filter(
        (entry) =>
          typeof entry?.pid === "number" &&
          entry.pid > 0 &&
          typeof entry.runId === "string" &&
          entry.runId.length > 0 &&
          typeof entry.commandHint === "string" &&
          typeof entry.startedAt === "number"
      ),
      version: 1,
    };
  } catch {
    return { entries: [], version: 1 };
  }
}

async function writeLedger(file: LedgerFile): Promise<void> {
  await writeFile(ledgerPath(), `${JSON.stringify(file)}\n`, "utf8");
}

export async function rememberBackgroundTaskProcess(entry: {
  command: string;
  pid: number;
  runId: string;
  startedAt?: number;
}): Promise<void> {
  if (!(entry.pid > 0 && entry.runId.length > 0)) {
    return;
  }
  const commandHint = normalizeCommandHint(entry.command);
  if (commandHint.length === 0) {
    return;
  }
  await enqueueLedgerWrite(async () => {
    const file = await readLedger();
    const next = file.entries.filter(
      (candidate) => candidate.runId !== entry.runId
    );
    next.push({
      commandHint,
      pid: entry.pid,
      runId: entry.runId,
      startedAt: entry.startedAt ?? Date.now(),
    });
    await writeLedger({ entries: next, version: 1 });
  });
}

export async function forgetBackgroundTaskProcess(
  runId: string
): Promise<void> {
  if (runId.length === 0) {
    return;
  }
  await enqueueLedgerWrite(async () => {
    const file = await readLedger();
    const next = file.entries.filter((entry) => entry.runId !== runId);
    if (next.length === file.entries.length) {
      return;
    }
    await writeLedger({ entries: next, version: 1 });
  });
}

function shouldReclaimEntry(
  entry: LedgerEntry,
  nowMs: number
): { reclaim: boolean; reason: "alive-match" | "gone" | "stale" | "mismatch" } {
  if (nowMs - entry.startedAt > MAX_LEDGER_AGE_MS) {
    return { reclaim: false, reason: "stale" };
  }
  if (!processAlive(entry.pid)) {
    return { reclaim: false, reason: "gone" };
  }
  const commandLine = readProcessCommandLine(entry.pid);
  if (!(commandLine && commandMatchesHint(commandLine, entry.commandHint))) {
    return { reclaim: false, reason: "mismatch" };
  }
  return { reclaim: true, reason: "alive-match" };
}

/**
 * 启动时回收上进程残留的 background 任务进程。
 * TERM → 短等 → KILL；仅对命令指纹仍匹配的存活 pid 动手。
 * 返回实际发信号的条目数。
 */
export async function reconcileOrphanedBackgroundProcesses(
  options: { graceMs?: number; now?: () => number } = {}
): Promise<number> {
  const graceMs = options.graceMs ?? 500;
  const nowMs = (options.now ?? Date.now)();

  return await enqueueLedgerWrite(async () => {
    const file = await readLedger();
    if (file.entries.length === 0) {
      return 0;
    }

    const survivors: LedgerEntry[] = [];
    for (const entry of file.entries) {
      const decision = shouldReclaimEntry(entry, nowMs);
      if (decision.reclaim) {
        survivors.push(entry);
      }
    }

    for (const entry of survivors) {
      signalProcessTree(entry.pid, "SIGTERM");
    }
    if (survivors.length > 0 && graceMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, graceMs);
      });
    }
    for (const entry of survivors) {
      if (!processAlive(entry.pid)) {
        continue;
      }
      const commandLine = readProcessCommandLine(entry.pid);
      if (commandLine && commandMatchesHint(commandLine, entry.commandHint)) {
        signalProcessTree(entry.pid, "SIGKILL");
      }
    }

    await writeLedger({ entries: [], version: 1 });
    return survivors.length;
  });
}

export function clearBackgroundTaskProcessLedgerQueueForTests(): void {
  writeChain = Promise.resolve();
}
