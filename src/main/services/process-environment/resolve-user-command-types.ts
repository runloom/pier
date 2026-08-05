/**
 * Shared types and shell quoting for user-command resolve (file-size split).
 */

const SHELL_SAFE_RE = /^[A-Za-z0-9_./:@%+=,-]+$/;

export type ResolvedUserCommand =
  | { kind: "absolute"; path: string }
  | { kind: "via-shell" }
  | { kind: "missing"; error: string };

export interface ResolveUserCommandRequest {
  /** Command name only (no args), e.g. `codex`. */
  commandName: string;
  cwd?: string | undefined;
  env?: Record<string, string> | undefined;
  /**
   * Skip interactive escalate after PATH miss (detect cheap path only).
   * Default false: PATH miss → interactive function/alias probe.
   */
  pathOnly?: boolean | undefined;
  shell?: string | undefined;
  timeoutMs?: number | undefined;
}

/** Panel last-mile: fail open quickly to via-shell. */
export const PANEL_COMMAND_RESOLVE_TIMEOUT_MS = 3000;
/** Detect escalate / default interactive probe. */
export const DETECT_COMMAND_RESOLVE_TIMEOUT_MS = 2500;

export function quoteShellArg(value: string): string {
  if (SHELL_SAFE_RE.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function resolveWrapperShell(
  env?: Record<string, string> | undefined
): string {
  const candidates = [env?.SHELL, process.env.SHELL];
  for (const raw of candidates) {
    const shell = raw?.trim();
    if (shell?.startsWith("/") && !shell.includes("\0")) {
      return shell;
    }
  }
  if (process.platform === "darwin") {
    return "/bin/zsh";
  }
  if (process.platform === "win32") {
    return "cmd.exe";
  }
  return "/bin/sh";
}

/** First bare token of a simple command line (no shell meta). */
export function extractBareCommandName(commandLine: string): string | null {
  const trimmed = commandLine.trim();
  if (!trimmed) {
    return null;
  }
  if (/[|;&<>(){}]/.test(trimmed) || trimmed.includes("\n")) {
    return null;
  }
  const match = /^([A-Za-z0-9_./:@%+=,-]+)/.exec(trimmed);
  return match?.[1] ?? null;
}
