import type { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { LspServerLaunchSpec } from "@shared/contracts/lsp-provider.ts";

export const LSP_EXIT_GRACE_MS = 1000;
export const LSP_TERM_GRACE_MS = 1000;

export type LspChildProcess = EventEmitter & {
  readonly pid?: number | undefined;
  kill(signal?: NodeJS.Signals): boolean;
  readonly stderr: NodeJS.ReadableStream;
  readonly stdin: NodeJS.WritableStream & {
    readonly writable: boolean;
    readonly writableEnded?: boolean;
  };
  readonly stdout: NodeJS.ReadableStream;
};

export interface ProcessTreeHandle {
  close(): Promise<void>;
  forceTerminate(): Promise<void>;
  gracefulTerminate(): Promise<void>;
  isAlive(): Promise<boolean>;
  readonly terminal: Promise<void>;
}

interface PosixProcessTreeOptions {
  pgid: number;
  pollIntervalMs?: number;
  processKill?: (pid: number, signal: NodeJS.Signals | 0) => boolean;
}

function isEsrch(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ESRCH";
}

export function createPosixProcessTreeHandle(
  options: PosixProcessTreeOptions
): ProcessTreeHandle {
  const processKill = options.processKill ?? process.kill.bind(process);
  const intervalMs = options.pollIntervalMs ?? 50;
  const terminal = Promise.withResolvers<void>();
  let terminalSettled = false;
  let pollTimer: NodeJS.Timeout | null = null;

  const settleTerminal = () => {
    if (terminalSettled) {
      return;
    }
    terminalSettled = true;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    terminal.resolve();
  };

  const probe = (): boolean => {
    if (terminalSettled) {
      return false;
    }
    try {
      processKill(-options.pgid, 0);
      return true;
    } catch (error) {
      if (isEsrch(error)) {
        settleTerminal();
        return false;
      }
      throw error;
    }
  };

  const schedulePoll = () => {
    if (terminalSettled || pollTimer) {
      return;
    }
    pollTimer = setTimeout(() => {
      pollTimer = null;
      try {
        if (probe()) {
          schedulePoll();
        }
      } catch {
        schedulePoll();
      }
    }, intervalMs);
    pollTimer.unref?.();
  };
  schedulePoll();

  const signal = (value: NodeJS.Signals) => {
    if (terminalSettled) {
      return;
    }
    try {
      processKill(-options.pgid, value);
    } catch (error) {
      if (isEsrch(error)) {
        settleTerminal();
        return;
      }
      throw error;
    }
  };

  return {
    terminal: terminal.promise,
    async close() {
      await terminal.promise;
    },
    async forceTerminate() {
      signal("SIGKILL");
    },
    async gracefulTerminate() {
      signal("SIGTERM");
    },
    async isAlive() {
      return probe();
    },
  };
}

export interface WindowsJobAddon {
  assignProcess(job: unknown, process: unknown): void;
  close(handle: unknown): void;
  createJob(): unknown;
  openProcess(pid: number): unknown;
  queryActiveProcesses(job: unknown): number;
  terminateJob(job: unknown): void;
  terminateProcessAndWait(process: unknown, timeoutMs: number): Promise<void>;
}

export interface WindowsSupervisor {
  child: LspChildProcess;
  closeControl(): void;
  readonly ready: Promise<void>;
  sendStart(launch: LspServerLaunchSpec): void;
  readonly terminal: Promise<void>;
}

interface LaunchWindowsProcessTreeOptions {
  addon: WindowsJobAddon;
  launch: LspServerLaunchSpec;
  spawnSupervisor: () => WindowsSupervisor;
}

const WINDOWS_SUPERVISOR_TERMINATION_TIMEOUT_MS = 2000;
const WINDOWS_JOB_POLL_INTERVAL_MS = 50;
const retainedWindowsProcessTrees = new WeakMap<object, ProcessTreeHandle>();

export function getRetainedWindowsProcessTree(
  error: unknown
): ProcessTreeHandle | undefined {
  return typeof error === "object" && error !== null
    ? retainedWindowsProcessTrees.get(error)
    : undefined;
}

async function terminateCapturedSupervisor(
  supervisor: WindowsSupervisor
): Promise<void> {
  const timeout = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    timeout.reject(new Error("Windows LSP supervisor termination timed out"));
  }, WINDOWS_SUPERVISOR_TERMINATION_TIMEOUT_MS);
  timer.unref?.();
  try {
    supervisor.child.kill("SIGKILL");
    await Promise.race([supervisor.terminal, timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
}

function createFailedSetupProcessTree(
  addon: WindowsJobAddon,
  job: unknown,
  supervisor: WindowsSupervisor,
  processHandle: unknown
): ProcessTreeHandle {
  let jobClosed = false;
  let processHandleClosed = processHandle === undefined;
  let supervisorTerminal = false;
  supervisor.terminal.then(() => {
    supervisorTerminal = true;
  });

  const terminate = async () => {
    supervisor.closeControl();
    if (processHandle === undefined) {
      await terminateCapturedSupervisor(supervisor);
      return;
    }
    await Promise.all([
      Promise.resolve().then(() =>
        addon.terminateProcessAndWait(
          processHandle,
          WINDOWS_SUPERVISOR_TERMINATION_TIMEOUT_MS
        )
      ),
      supervisor.terminal,
    ]);
  };

  return {
    terminal: supervisor.terminal,
    async close() {
      await supervisor.terminal;
      if (!processHandleClosed) {
        addon.close(processHandle);
        processHandleClosed = true;
      }
      if (!jobClosed) {
        addon.close(job);
        jobClosed = true;
      }
    },
    forceTerminate: terminate,
    gracefulTerminate: terminate,
    async isAlive() {
      return !supervisorTerminal;
    },
  };
}

function createAssignedProcessTree(
  addon: WindowsJobAddon,
  job: unknown,
  supervisor: WindowsSupervisor,
  processHandle: unknown,
  initialActiveProcesses?: number,
  requireJobTermination = false
): ProcessTreeHandle {
  let activeProcesses = initialActiveProcesses ?? -1;
  let supervisorTerminal = false;
  let terminalSettled = false;
  let jobClosed = false;
  let processHandleClosed = processHandle === undefined;
  let pollTimer: NodeJS.Timeout | null = null;
  const terminal = Promise.withResolvers<void>();

  const settleIfTerminal = () => {
    if (terminalSettled || !(supervisorTerminal && activeProcesses === 0)) {
      return;
    }
    terminalSettled = true;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    terminal.resolve();
  };

  const refresh = () => {
    if (terminalSettled) {
      return;
    }
    activeProcesses = addon.queryActiveProcesses(job);
    settleIfTerminal();
  };

  const schedulePoll = () => {
    if (terminalSettled || pollTimer) {
      return;
    }
    pollTimer = setTimeout(() => {
      pollTimer = null;
      try {
        refresh();
      } finally {
        schedulePoll();
      }
    }, WINDOWS_JOB_POLL_INTERVAL_MS);
    pollTimer.unref?.();
  };

  supervisor.terminal.then(() => {
    supervisorTerminal = true;
    refresh();
  });
  schedulePoll();

  const terminate = () => {
    if (requireJobTermination) {
      addon.terminateJob(job);
      refresh();
      return;
    }
    refresh();
    if (activeProcesses > 0) {
      addon.terminateJob(job);
      refresh();
    }
  };

  return {
    terminal: terminal.promise,
    async close() {
      await terminal.promise;
      if (!processHandleClosed) {
        addon.close(processHandle);
        processHandleClosed = true;
      }
      if (!jobClosed) {
        addon.close(job);
        jobClosed = true;
      }
    },
    async forceTerminate() {
      terminate();
    },
    async gracefulTerminate() {
      terminate();
    },
    async isAlive() {
      refresh();
      return activeProcesses > 0;
    },
  };
}

export async function launchWindowsProcessTree(
  options: LaunchWindowsProcessTreeOptions
): Promise<ProcessTreeHandle> {
  const job = options.addon.createJob();
  let processHandle: unknown;
  let supervisor: WindowsSupervisor | undefined;
  let setupState: "unassigned" | "assigned" | "started" = "unassigned";
  try {
    supervisor = options.spawnSupervisor();
    await supervisor.ready;
    const pid = supervisor.child.pid;
    if (!pid) {
      throw new Error("Windows LSP supervisor did not expose a process id");
    }
    processHandle = options.addon.openProcess(pid);
    options.addon.assignProcess(job, processHandle);
    setupState = "assigned";
    supervisor.sendStart(options.launch);
    setupState = "started";
    const activeProcesses = options.addon.queryActiveProcesses(job);

    if (!(supervisor && processHandle !== undefined)) {
      throw new Error("Windows LSP supervisor setup completed without handles");
    }

    return createAssignedProcessTree(
      options.addon,
      job,
      supervisor,
      processHandle,
      activeProcesses
    );
  } catch (error) {
    if (!supervisor) {
      options.addon.close(job);
      throw error;
    }
    const retainedTree =
      setupState === "unassigned"
        ? createFailedSetupProcessTree(
            options.addon,
            job,
            supervisor,
            processHandle
          )
        : createAssignedProcessTree(
            options.addon,
            job,
            supervisor,
            processHandle,
            undefined,
            true
          );
    try {
      await retainedTree.gracefulTerminate();
      await retainedTree.close();
    } catch (cleanupError) {
      if (typeof cleanupError === "object" && cleanupError !== null) {
        retainedWindowsProcessTrees.set(cleanupError, retainedTree);
      }
      throw cleanupError;
    }
    throw error;
  }
}

export function resolveWindowsJobAddonPath(): string {
  if (process.platform !== "win32") {
    throw new Error(
      "The Windows LSP Job Object addon is only available on win32"
    );
  }
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  if (resourcesPath) {
    const packagedPath = join(
      resourcesPath,
      "lsp-windows-job",
      process.arch,
      "lsp_windows_job.node"
    );
    if (existsSync(packagedPath)) {
      return packagedPath;
    }
  }

  const artifactRelative = join(
    "native",
    "lsp-windows-job",
    "artifacts",
    process.arch,
    "Release",
    "lsp_windows_job.node"
  );
  const candidates: string[] = [
    // Vitest / electron-vite may rewrite import.meta.url; prefer repo cwd.
    join(process.cwd(), artifactRelative),
    join(
      process.cwd(),
      "native",
      "lsp-windows-job",
      "build",
      "Release",
      "lsp_windows_job.node"
    ),
  ];
  try {
    candidates.push(
      fileURLToPath(
        new URL(
          `../../native/lsp-windows-job/artifacts/${process.arch}/Release/lsp_windows_job.node`,
          import.meta.url
        )
      ),
      fileURLToPath(
        new URL(
          `../../../../native/lsp-windows-job/artifacts/${process.arch}/Release/lsp_windows_job.node`,
          import.meta.url
        )
      )
    );
  } catch {
    // Non-file import.meta.url (transformed modules).
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0] ?? artifactRelative;
}

export function loadWindowsJobAddon(): WindowsJobAddon {
  if (process.platform !== "win32") {
    throw new Error(
      "The Windows LSP Job Object addon cannot be loaded off win32"
    );
  }
  const require = createRequire(import.meta.url);
  return require(resolveWindowsJobAddonPath()) as WindowsJobAddon;
}

export function resolveWindowsSupervisorPath(): string {
  return fileURLToPath(
    new URL("./lsp-windows-process-supervisor.js", import.meta.url)
  );
}
