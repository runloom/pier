import { delimiter, join } from "node:path";
import type { SessionMap, SessionPaneBinding } from "../main/session-map.ts";
import { flagString } from "./parse.ts";
import type { ControlResult, JsonCommand, TmuxFlags } from "./types.ts";

export interface VerbContext {
  commands: JsonCommand[];
  /** shim 进程 cwd（= agent 终端 cwd）；split/new 未带 -c 时继承。 */
  cwd?: string | undefined;
  env: NodeJS.Dict<string>;
  flags: TmuxFlags;
  invoke: (command: JsonCommand) => Promise<ControlResult>;
  map: SessionMap;
  rest: string[];
  workDir: string;
}

export interface VerbOutcome {
  exitCode: number;
  map?: SessionMap;
  stderr: string;
  stdout: string;
}

export function ok(stdout = "", map?: SessionMap): VerbOutcome {
  return { exitCode: 0, ...(map ? { map } : {}), stderr: "", stdout };
}

export function fail(message: string, exitCode = 1): VerbOutcome {
  const line = message.endsWith("\n") ? message : `${message}\n`;
  return { exitCode, stderr: line, stdout: "" };
}

const SHELL_SAFE_RE = /^[A-Za-z0-9_./:@%+=,-]+$/;
const ALREADY_SHELL_WRAPPED_RE =
  /^(?:\/bin\/(?:sh|bash|zsh)|\/usr\/bin\/(?:sh|bash|zsh))\s+-[a-zA-Z]*c\s+/u;
const IDENTITY_ENV_KEYS = new Set([
  "PATH",
  "PIER_CONTROL_SOCKET",
  "PIER_WINDOW_ID",
  "TMUX",
  "TMUX_PANE",
]);

export function quoteShellArg(value: string): string {
  if (SHELL_SAFE_RE.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Ghostty execs a single argv; tmux pane commands are shell expressions. */
export function shellInvokedCommand(rest: string[]): string | undefined {
  if (rest.length === 0) {
    return;
  }
  const joined = rest.join(" ");
  if (ALREADY_SHELL_WRAPPED_RE.test(joined.trim())) {
    return joined;
  }
  return `/bin/sh -c ${quoteShellArg(joined)}`;
}

function shimBin(workDir: string): string {
  return join(workDir, "bin");
}

function pathWithShimFirst(
  pathValue: string | undefined,
  workDir: string
): string {
  const bin = shimBin(workDir);
  const parts = (pathValue ?? "")
    .split(delimiter)
    .filter((part) => part && part !== bin);
  return [bin, ...parts].join(delimiter);
}

function envFromDashE(flags: TmuxFlags): Record<string, string> {
  const raw = flagString(flags, "-e");
  if (!raw) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq);
    if (IDENTITY_ENV_KEYS.has(key) || key.startsWith("PIER_")) {
      continue;
    }
    next[key] = line.slice(eq + 1);
  }
  return next;
}

export function childLaunchEnv(
  env: NodeJS.Dict<string>,
  paneId: string,
  workDir: string
): Record<string, string> {
  const next: Record<string, string> = {
    PATH: pathWithShimFirst(env.PATH, workDir),
    TMUX_PANE: paneId,
  };
  if (env.TMUX) {
    next.TMUX = env.TMUX;
  }
  if (env.PIER_CONTROL_SOCKET) {
    next.PIER_CONTROL_SOCKET = env.PIER_CONTROL_SOCKET;
  }
  if (env.PIER_WINDOW_ID) {
    next.PIER_WINDOW_ID = env.PIER_WINDOW_ID;
  }
  return next;
}

export function paneLaunchFields(ctx: VerbContext, paneId: string) {
  const command = shellInvokedCommand(ctx.rest);
  return {
    env: {
      ...envFromDashE(ctx.flags),
      ...childLaunchEnv(ctx.env, paneId, ctx.workDir),
    },
    // 真实 tmux 语义：split/new 未带 -c 时继承发起方 cwd（= 项目目录），
    // 避免 teammate 落到 home 触发 Claude Code 的 workspace trust 确认。
    cwd: flagString(ctx.flags, "-c") ?? ctx.cwd ?? process.cwd(),
    ...(command ? { command } : {}),
  };
}

export async function invokeTracked(
  ctx: VerbContext,
  command: JsonCommand
): Promise<ControlResult> {
  ctx.commands.push(command);
  return await ctx.invoke(command);
}

export function requireBinding(
  ctx: VerbContext,
  paneId: string
): SessionPaneBinding | VerbOutcome {
  const binding = ctx.map.panes[paneId];
  if (!binding) {
    return fail(`pane not found: ${paneId}`);
  }
  return binding;
}

export function mappedPanelIds(map: SessionMap): string[] {
  return Object.values(map.panes).map((pane) => pane.panelId);
}
