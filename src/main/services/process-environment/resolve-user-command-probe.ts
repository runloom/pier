/**
 * Interactive-shell probe: script build, parse, spawn (file-size split).
 * Class A: shell spawn with PES-resolved env for command resolution only.
 */
import { spawn } from "node:child_process";
import { basename } from "node:path";
import type { ResolvedUserCommand } from "./resolve-user-command-types.ts";
import { quoteShellArg } from "./resolve-user-command-types.ts";

export const PIER_CMD_START = "__PIER_CMD_START__";
export const PIER_CMD_END = "__PIER_CMD_END__";

export function agentShellCommandFlags(shellPath: string): string {
  const base = basename(shellPath).toLowerCase();
  if (base === "fish") {
    return "-l -i -c";
  }
  if (base === "nu" || base === "nushell") {
    return "-i -l -c";
  }
  return "-lic";
}

/**
 * One-shot `$SHELL -c` (no `-l` / `-i`). PATH already comes from the
 * login+interactive dump overlay; a second login would reclobber PATH via
 * `.zprofile`. Dump / agent PTY keep {@link agentShellCommandFlags}.
 */
export function loginShellCommandFlags(): string {
  return "-c";
}

export function shellFamily(
  shellPath: string
): "zsh" | "bash" | "fish" | "nu" | "posix" {
  const base = basename(shellPath).toLowerCase();
  if (base === "zsh" || base.endsWith("zsh")) {
    return "zsh";
  }
  if (base === "bash" || base.endsWith("bash")) {
    return "bash";
  }
  if (base === "fish") {
    return "fish";
  }
  if (base === "nu" || base === "nushell") {
    return "nu";
  }
  return "posix";
}

/** Detect already-wrapped surface commands (sh/zsh/fish -c forms). */
export function isAlreadyShellWrappedCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }
  return /(?:^|\s)(?:\/\S+\/)?(?:ba)?sh\s+-[il]*c\s+|(?:^|\s)(?:\/\S+\/)?zsh\s+-[il]*c\s+|(?:^|\s)(?:\/\S+\/)?fish\s+-[ilc\s-]*-c\s+/u.test(
    trimmed
  );
}

/**
 * Probe script: login+interactive so .zshrc functions/aliases exist.
 * Framed with markers so MOTD/rc stdout noise cannot hijack parse.
 */
export function buildUserCommandProbeScript(
  commandName: string,
  family: ReturnType<typeof shellFamily>
): string {
  const q = quoteShellArg(commandName);
  const start = `printf '%s\\n' '${PIER_CMD_START}'`;
  const end = `printf '%s\\n' '${PIER_CMD_END}'`;
  if (family === "fish") {
    return [
      start,
      `set -l cmd ${q}`,
      "if functions -q $cmd",
      "  printf 'VIA_SHELL\\n'",
      "else",
      "  set -l p (command -s -- $cmd 2>/dev/null)",
      '  if test -n "$p"; and test -x "$p"',
      "    printf 'ABS\\n%s\\n' $p",
      "  else",
      "    printf 'MISSING\\n'",
      "  end",
      "end",
      end,
    ].join("\n");
  }
  if (family === "nu") {
    return [
      start,
      `let cmd = ${JSON.stringify(commandName)}`,
      "try {",
      "  let p = (which $cmd | get path.0?)",
      "  if $p != null { print 'ABS'; print $p } else { print 'MISSING' }",
      "} catch { print 'MISSING' }",
      end,
    ].join("\n");
  }
  const zshTest = ['if [ -n "${', 'ZSH_VERSION-}" ]; then'].join("");
  const bashTest = ['elif [ -n "${', 'BASH_VERSION-}" ]; then'].join("");
  const zshBranch = [
    zshTest,
    "  if (( $+aliases[$cmd] )) || (( $+functions[$cmd] )); then",
    "    printf 'VIA_SHELL\\n'",
    "  else",
    '    p=$(whence -p -- "$cmd" 2>/dev/null) || p=',
    '    if [ -n "$p" ] && [ -x "$p" ]; then printf \'ABS\\n%s\\n\' "$p"',
    "    else printf 'MISSING\\n'; fi",
    "  fi",
  ].join("\n");
  const bashBranch = [
    bashTest,
    '  if alias "$cmd" >/dev/null 2>&1 || declare -F "$cmd" >/dev/null 2>&1; then',
    "    printf 'VIA_SHELL\\n'",
    "  else",
    '    p=$(type -P -- "$cmd" 2>/dev/null) || p=',
    '    if [ -n "$p" ] && [ -x "$p" ]; then printf \'ABS\\n%s\\n\' "$p"',
    "    else printf 'MISSING\\n'; fi",
    "  fi",
  ].join("\n");
  const posixBranch = [
    "else",
    '  p=$(command -v -- "$cmd" 2>/dev/null) || p=',
    '  case "$p" in',
    "    /*) if [ -x \"$p\" ]; then printf 'ABS\\n%s\\n' \"$p\"; else printf 'MISSING\\n'; fi ;;",
    "    *) printf 'VIA_SHELL\\n' ;;",
    "  esac",
    "fi",
  ].join("\n");
  return [`cmd=${q}`, start, zshBranch, bashBranch, posixBranch, end].join(
    "\n"
  );
}

export function extractProbeProtocolBody(stdout: string): string {
  const start = stdout.lastIndexOf(PIER_CMD_START);
  if (start < 0) {
    return stdout;
  }
  const after = start + PIER_CMD_START.length;
  const end = stdout.indexOf(PIER_CMD_END, after);
  if (end < 0) {
    return stdout.slice(after);
  }
  return stdout.slice(after, end);
}

export function parseUserCommandProbeOutput(
  stdout: string
): ResolvedUserCommand {
  const body = extractProbeProtocolBody(stdout);
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let kindIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === "ABS" || line === "VIA_SHELL" || line === "MISSING") {
      kindIndex = i;
      break;
    }
  }
  if (kindIndex < 0) {
    return {
      kind: "missing",
      error: `unrecognized probe output: ${stdout.slice(0, 120)}`,
    };
  }
  const kind = lines[kindIndex];
  if (kind === "ABS") {
    const path = lines[kindIndex + 1];
    if (path?.startsWith("/")) {
      return { kind: "absolute", path };
    }
    return { kind: "missing", error: "ABS without absolute path" };
  }
  if (kind === "VIA_SHELL") {
    return { kind: "via-shell" };
  }
  return {
    kind: "missing",
    error: "command not found on PATH or as shell function/alias",
  };
}

export function runUserCommandProbe(input: {
  cwd?: string | undefined;
  env: Record<string, string>;
  script: string;
  shell: string;
  timeoutMs: number;
}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const flags = agentShellCommandFlags(input.shell)
    .split(/\s+/)
    .filter(Boolean);
  return new Promise((resolve, reject) => {
    const child = spawn(input.shell, [...flags, input.script], {
      cwd: input.cwd,
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const finish = (value: {
      code: number | null;
      stdout: string;
      stderr: string;
    }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const collectedStdout = () => Buffer.concat(stdout).toString("utf8");
    const timer = setTimeout(() => {
      const partial = collectedStdout();
      const parsed = parseUserCommandProbeOutput(partial);
      if (parsed.kind !== "missing") {
        child.kill();
        finish({
          code: null,
          stderr: Buffer.concat(stderr).toString("utf8"),
          stdout: partial,
        });
        return;
      }
      child.kill();
      fail(
        new Error(`user command resolve timed out after ${input.timeoutMs}ms`)
      );
    }, input.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    });
    child.on("close", (code) => {
      finish({
        code,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: collectedStdout(),
      });
    });
  });
}
