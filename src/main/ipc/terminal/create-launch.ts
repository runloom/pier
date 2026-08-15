import type { AgentKind } from "@shared/contracts/agent.ts";
import type { TaskPanelMetadata } from "@shared/contracts/tasks.ts";
import type {
  ResolvedTerminalLaunchOptions,
  TerminalLaunchOptions,
} from "@shared/contracts/terminal/launch.ts";
import type {
  CreateTerminalArgs,
  TerminalAgentPanelMetadata,
} from "@shared/contracts/terminal.ts";
import { omitTerminalEmulatorEnv } from "../../services/process-environment/clean-env.ts";
import {
  agentShellCommandFlags,
  buildResolvedAgentSurfaceCommand,
  extractBareCommandName,
  isAlreadyShellWrappedCommand as isShellCommandWrapped,
  PANEL_COMMAND_RESOLVE_TIMEOUT_MS,
  quoteShellArg,
  resolveUserCommand,
  resolveWrapperShell,
} from "../../services/process-environment/resolve-user-command.ts";
import { terminalLaunchRegistry } from "../../state/terminal-launch-state.ts";
import type { TerminalPanelSession } from "../../state/terminal-session-state.ts";

const RESTORED_TASK_SHELL_FALLBACK = "/bin/zsh";
/** Ghostty surface prefixes — do not wrap again. */
const GHOSTTY_COMMAND_PREFIX_RE = /^(?:shell:|direct:)/u;

export {
  agentShellCommandFlags,
  resolveWrapperShell as resolveAgentWrapperShell,
} from "../../services/process-environment/resolve-user-command.ts";

export function isAlreadyShellWrappedCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }
  if (GHOSTTY_COMMAND_PREFIX_RE.test(trimmed)) {
    return true;
  }
  return isShellCommandWrapped(trimmed);
}

/**
 * Sync fallback wrap (`$SHELL -lic`). Product agent path uses async
 * {@link withAgentLoginShellSafeCommand} (resolve absolute / via-shell + sticky).
 */
export function wrapAgentTerminalCommand(
  command: string,
  shellPath?: string
): string {
  const trimmed = command.trim();
  if (!trimmed || isAlreadyShellWrappedCommand(trimmed)) {
    return trimmed;
  }
  const shell = shellPath ?? resolveWrapperShell();
  return `${quoteShellArg(shell)} ${agentShellCommandFlags(shell)} ${quoteShellArg(trimmed)}`;
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
    ...lines.map((line) => `printf '%s\\n' ${quoteShellArg(line)}`),
    "printf '\\n'",
    `exec ${quoteShellArg(restoredShell)} -l`,
  ].join("; ");
  // P2: tasks stay /bin/sh -lc (env-only contract; not agent resolve path).
  return `/bin/sh -lc ${quoteShellArg(script)}`;
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
  // Keep logical agent command unwrapped here: this object is also persisted
  // for resume adapters (`agent.launch.command`). Spawn wrap is last-mile only.
  const nativeLaunch = {
    ...(options.restoredSession
      ? {}
      : {
          ...(launch?.agentId && { agentId: launch.agentId }),
          ...(launch?.command && { command: launch.command }),
          ...(launch?.env && { env: launch.env }),
        }),
    ...(cwd && { cwd }),
  };
  return Object.keys(nativeLaunch).length > 0 ? nativeLaunch : undefined;
}

/**
 * Last-mile agent surface command.
 * Shebang scripts cannot lead the PTY — spawn `$SHELL -lic`.
 * Native binaries stay `/bin/sh -c 'exec …'`.
 */
export interface AgentLoginShellSurface {
  launch: ResolvedTerminalLaunchOptions | undefined;
}

export async function withAgentLoginShellSafeCommand(
  launch: ResolvedTerminalLaunchOptions | undefined,
  agentId: AgentKind | undefined
): Promise<AgentLoginShellSurface> {
  if (!(launch && agentId && launch.command)) {
    return { launch };
  }
  const trimmed = launch.command.trim();
  if (!trimmed || isAlreadyShellWrappedCommand(trimmed)) {
    return { launch };
  }

  const env = launch.env ?? {};
  const shell = resolveWrapperShell(env);
  const bare = extractBareCommandName(trimmed);
  let resolved: Awaited<ReturnType<typeof resolveUserCommand>>;
  if (bare?.startsWith("/")) {
    // Already absolute — thin exec wrap, no interactive probe.
    resolved = { kind: "absolute", path: bare };
  } else if (bare) {
    resolved = await resolveUserCommand({
      commandName: bare,
      cwd: launch.cwd,
      env,
      shell,
      timeoutMs: PANEL_COMMAND_RESOLVE_TIMEOUT_MS,
    });
  } else {
    resolved = { kind: "via-shell" };
  }

  if (resolved.kind === "missing") {
    resolved = { kind: "via-shell" };
  }

  const command = buildResolvedAgentSurfaceCommand({
    commandLine: trimmed,
    env,
    resolved,
    shell,
  });
  if (command === launch.command) {
    return { launch };
  }
  return { launch: { ...launch, command } };
}

export function readCreateLaunch(
  args: CreateTerminalArgs
): ResolvedTerminalLaunchOptions | null {
  return args.launchId ? terminalLaunchRegistry.read(args.launchId) : null;
}

export function resolveCreateTerminalLaunch(
  args: CreateTerminalArgs,
  saved: TerminalPanelSession | null,
  options: { taskLive?: boolean } = {}
): {
  context: CreateTerminalArgs["context"];
  /** launcher 启动的 agent 身份（+按钮/命令面板）——用于会话即时点亮。 */
  launchAgentId?: AgentKind | undefined;
  nativeLaunch: ResolvedTerminalLaunchOptions | undefined;
  restoredAgent?: TerminalAgentPanelMetadata | undefined;
  restoredAgentLaunch?: boolean | undefined;
  task?: TaskPanelMetadata | undefined;
} {
  const launch = readCreateLaunch(args);
  const explicitCreate = Boolean(launch);
  const context = explicitCreate
    ? (args.context ?? saved?.context)
    : (saved?.context ?? args.context);
  const cwd =
    context?.cwd ??
    context?.worktreeRoot ??
    context?.projectRootPath ??
    context?.gitRoot ??
    launch?.cwd;
  const task = explicitCreate
    ? (args.task ?? saved?.task)
    : (saved?.task ?? args.task);
  const savedAgent = explicitCreate ? undefined : saved?.agent;
  if (task && !launch) {
    if (options.taskLive) {
      return {
        context,
        nativeLaunch: nativeLaunchOptions(null, cwd, {
          restoredSession: true,
        }),
        task,
      };
    }
    const restoredTask: TaskPanelMetadata =
      task.status === "running" ? { ...task, status: "cancelled" } : task;
    return {
      context,
      nativeLaunch: restoredTaskLaunchOptions(restoredTask, cwd),
      task: restoredTask,
    };
  }
  if (savedAgent?.status === "running") {
    return {
      context,
      launchAgentId: savedAgent.agentId,
      nativeLaunch: nativeLaunchOptions(savedAgent.launch, cwd),
      restoredAgent: savedAgent,
      restoredAgentLaunch: true,
    };
  }
  return {
    context,
    ...(launch?.agentId ? { launchAgentId: launch.agentId } : {}),
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

/**
 * 每个终端 PTY 注入面板级状态环境变量：PIER_WINDOW_ID + PIER_PANEL_ID 精确
 * 路由 agent hook 事件到「窗口+面板」。
 *
 * 始终剥离历史 PIER_AGENT_CALLER_* 环境变量，避免子进程继承误身份。
 * 同时丢掉 dump/宿主的 TERM 等模拟器键，让 Ghostty 自己设置能力。
 */
export function withPanelStatusEnv(
  nativeLaunch: ResolvedTerminalLaunchOptions | undefined,
  panelId: string,
  windowId: string,
  hookEnv: Record<string, string>
): ResolvedTerminalLaunchOptions {
  const {
    PIER_AGENT_CALLER_BINDING: _parentBinding,
    PIER_AGENT_CALLER_CREDENTIAL_FILE: _parentCredential,
    ...baseEnv
  } = {
    ...(nativeLaunch?.env ?? {}),
  };
  return {
    ...(nativeLaunch ?? {}),
    env: omitTerminalEmulatorEnv({
      ...baseEnv,
      ...hookEnv,
      PIER_PANEL_ID: panelId,
      PIER_WINDOW_ID: windowId,
    }),
  };
}
