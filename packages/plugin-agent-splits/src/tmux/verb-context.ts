import { delimiter, join } from "node:path";
import {
  loadSessionMap,
  type SessionMap,
  type SessionPaneBinding,
  saveSessionMap,
} from "../main/session-map.ts";
import { flagString } from "./parse.ts";
import {
  type ControlResult,
  type JsonCommand,
  type TmuxFlags,
  windowIdFromResult,
} from "./types.ts";

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

/**
 * 把某个面板的所有绑定改写到宿主当前窗口。返回新 map 而不是原地改，
 * 方便调用方决定是否落盘（跨窗移动的位置刷新是缓存维护，不应阻断命令）。
 */
export function rebindPanelWindow(
  map: SessionMap,
  panelId: string,
  windowId: string
): { changed: boolean; map: SessionMap } {
  let changed = false;
  const panes = { ...map.panes };
  for (const [paneId, binding] of Object.entries(panes)) {
    if (binding.panelId === panelId && binding.windowId !== windowId) {
      panes[paneId] = { ...binding, windowId };
      changed = true;
    }
  }
  return { changed, map: { ...map, panes } };
}

function refreshBindingWindow(
  ctx: VerbContext,
  panelId: string,
  windowId: string
): void {
  // 以磁盘最新版本为底，避免覆盖其他 shim 进程刚写入的 pane。
  const latest = loadSessionMap(ctx.workDir, ctx.map.sessionId) ?? ctx.map;
  const rebound = rebindPanelWindow(latest, panelId, windowId);
  // 即使绑定无需改写也采纳磁盘版本：后续失败回滚用它写盘，
  // 不能把其它 shim 已写入的 pane 丢掉。
  ctx.map = rebound.map;
  if (!rebound.changed) {
    return;
  }
  try {
    saveSessionMap(ctx.workDir, ctx.map);
  } catch {
    // 位置刷新是缓存维护：写盘失败仍让本次命令继续，下一条命令会再次核对。
  }
}

/**
 * 取命令绑定的面板：split / new-window 的参照 pane 在 `referencePanelId`。
 */
function commandPanelId(command: JsonCommand): string | undefined {
  if (typeof command.panelId === "string") {
    return command.panelId;
  }
  return typeof command.referencePanelId === "string"
    ? command.referencePanelId
    : undefined;
}

/**
 * 带 windowId 的命令失败且宿主回报 not_found 时，面板可能已被拖到其他窗口：
 * 不带窗口再查一次当前位置，命中不同窗口就回填 map 并重试一次。
 * 面板确实消失或结果未知时保持原失败，不掩盖真实错误。
 */
async function retryInCurrentWindow(
  ctx: VerbContext,
  command: JsonCommand
): Promise<ControlResult | null> {
  const panelId = commandPanelId(command);
  const windowId =
    typeof command.windowId === "string" ? command.windowId : undefined;
  if (!(panelId && windowId)) {
    return null;
  }
  const probe: JsonCommand = { type: "terminal.get", panelId };
  ctx.commands.push(probe);
  let probeResult: ControlResult;
  try {
    probeResult = await ctx.invoke(probe);
  } catch {
    // 位置核验是尽力而为：通道失败时保留原始失败结果。
    return null;
  }
  const current = windowIdFromResult(probeResult);
  if (!(probeResult.ok && current) || current === windowId) {
    return null;
  }
  refreshBindingWindow(ctx, panelId, current);
  const retry: JsonCommand = { ...command, windowId: current };
  ctx.commands.push(retry);
  try {
    return await ctx.invoke(retry);
  } catch {
    // 重试本身也可能超时 / 断链：交回原始 not_found，让调用方走失败清理，
    // 而不是把异常抛过 openAllocated 的 removePane 回收。
    return null;
  }
}

export async function invokeTracked(
  ctx: VerbContext,
  command: JsonCommand
): Promise<ControlResult> {
  ctx.commands.push(command);
  const result = await ctx.invoke(command);
  if (result.ok || result.error.code !== "not_found") {
    return result;
  }
  return (await retryInCurrentWindow(ctx, command)) ?? result;
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
