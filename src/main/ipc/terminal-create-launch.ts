import type { TaskPanelMetadata } from "@shared/contracts/tasks.ts";
import type { CreateTerminalArgs } from "@shared/contracts/terminal.ts";
import type {
  ResolvedTerminalLaunchOptions,
  TerminalLaunchOptions,
} from "@shared/contracts/terminal-launch.ts";
import { terminalLaunchRegistry } from "../state/terminal-launch-state.ts";
import type { TerminalPanelSession } from "../state/terminal-session-state.ts";

const SHELL_SAFE_RE = /^[A-Za-z0-9_./:@%+=,-]+$/;
const RESTORED_TASK_SHELL_FALLBACK = "/bin/zsh";

function shellQuote(value: string): string {
  if (SHELL_SAFE_RE.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function restoredTaskResultCommand(task: TaskPanelMetadata): string {
  const displayStatus = task.status === "running" ? "cancelled" : task.status;
  const lines = [
    "[pier] restored task",
    `Task: ${task.label}`,
    `Status: ${displayStatus}`,
    ...(task.exitCode === undefined ? [] : [`Exit code: ${task.exitCode}`]),
    `Command: ${task.rawCommand}`,
    `CWD: ${task.cwd}`,
  ];
  const restoredShell =
    process.env.SHELL?.startsWith("/") === true
      ? process.env.SHELL
      : RESTORED_TASK_SHELL_FALLBACK;
  const script = [
    ...lines.map((line) => `printf '%s\\n' ${shellQuote(line)}`),
    "printf '\\n'",
    `exec ${shellQuote(restoredShell)} -l`,
  ].join("; ");
  return `/bin/sh -lc ${shellQuote(script)}`;
}

function restoredTaskLaunchOptions(
  task: TaskPanelMetadata,
  cwd: string | undefined
): ResolvedTerminalLaunchOptions {
  return {
    command: restoredTaskResultCommand(task),
    cwd: cwd ?? task.cwd,
  };
}

export function nativeLaunchOptions(
  launch: TerminalLaunchOptions | null,
  cwd: string | undefined,
  options: { restoredSession?: boolean } = {}
): ResolvedTerminalLaunchOptions | undefined {
  const nativeLaunch = {
    ...(options.restoredSession
      ? {}
      : {
          ...(launch?.command && { command: launch.command }),
          ...(launch?.env && { env: launch.env }),
        }),
    ...(cwd && { cwd }),
  };
  return Object.keys(nativeLaunch).length > 0 ? nativeLaunch : undefined;
}

export function readCreateLaunch(
  args: CreateTerminalArgs
): ResolvedTerminalLaunchOptions | null {
  return args.launchId ? terminalLaunchRegistry.read(args.launchId) : null;
}

export function resolveCreateTerminalLaunch(
  args: CreateTerminalArgs,
  saved: TerminalPanelSession | null
): {
  context: CreateTerminalArgs["context"];
  nativeLaunch: ResolvedTerminalLaunchOptions | undefined;
  task?: TaskPanelMetadata | undefined;
} {
  const launch = readCreateLaunch(args);
  const explicitCreate = Boolean(launch);
  const context = explicitCreate
    ? (args.context ?? saved?.context)
    : (saved?.context ?? args.context);
  const cwd = context?.cwd ?? launch?.cwd;
  const task = explicitCreate
    ? (args.task ?? saved?.task)
    : (saved?.task ?? args.task);
  if (task && !launch) {
    const restoredTask: TaskPanelMetadata =
      task.status === "running" ? { ...task, status: "cancelled" } : task;
    return {
      context,
      nativeLaunch: restoredTaskLaunchOptions(restoredTask, cwd),
      task: restoredTask,
    };
  }
  return {
    context,
    nativeLaunch: nativeLaunchOptions(launch, cwd, {
      restoredSession: Boolean(saved && !explicitCreate),
    }),
    ...(task && { task }),
  };
}

export function consumeCreateLaunch(args: CreateTerminalArgs): void {
  if (args.launchId) {
    terminalLaunchRegistry.consume(args.launchId);
  }
}
