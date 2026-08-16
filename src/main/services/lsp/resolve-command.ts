import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";

/**
 * Resolve a bare CLI name or absolute path for language-server launch.
 * Uses `which` / `where` without a shell. Returns null when not found.
 */
export function resolveCommandOnPath(command: string): string | null {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (isAbsolute(trimmed)) {
    return trimmed;
  }
  if (/[\r\n"]/.test(trimmed) || trimmed.includes("\0")) {
    return null;
  }
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [trimmed], {
    encoding: "utf8",
    timeout: 3000,
  });
  if (result.status !== 0 || !result.stdout) {
    return null;
  }
  const path = result.stdout.split(/\r?\n/, 1)[0]?.trim();
  return path && path.length > 0 ? path : null;
}

/**
 * First PATH hit among candidates (e.g. pyright-langserver vs basedpyright).
 */
export function resolveFirstCommandOnPath(
  candidates: readonly string[]
): string | null {
  for (const candidate of candidates) {
    const resolved = resolveCommandOnPath(candidate);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

/**
 * Windows `.bat` / `.cmd` wrappers need `cmd.exe /c`; unix binaries launch directly.
 */
export function launchSpecForResolvedBinary(
  binary: string,
  args: readonly string[]
): { args: string[]; command: string } | null {
  if (process.platform === "win32" && /\.(?:bat|cmd)$/i.test(binary)) {
    if (/["\r\n]/.test(binary)) {
      return null;
    }
    const quotedArgs = args.map((arg) =>
      /[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg
    );
    return {
      args: ["/d", "/s", "/c", `"${binary}" ${quotedArgs.join(" ")}`.trim()],
      command: process.env.ComSpec ?? "cmd.exe",
    };
  }
  return { args: [...args], command: binary };
}

function isLaunchAbsolutePath(pathValue: string): boolean {
  return (
    isAbsolute(pathValue) ||
    /^[A-Za-z]:[\\/]/u.test(pathValue) ||
    pathValue.startsWith("\\\\")
  );
}

function commandLeafName(command: string): string {
  return (
    command.split(/[\\/]/u).at(-1)?.trim().toLowerCase() ??
    command.toLowerCase()
  );
}

function isWindowsCmdHost(command: string): boolean {
  const leaf = commandLeafName(command);
  return leaf === "cmd.exe" || leaf === "cmd";
}

function scriptPathFromCmdLaunch(args: readonly string[]): string | null {
  const cIndex = args.findIndex((arg) => arg.toLowerCase() === "/c");
  const commandLine = cIndex >= 0 ? args[cIndex + 1] : undefined;
  if (!commandLine) {
    return null;
  }
  const quoted = /^"([^"]+)"/u.exec(commandLine.trim());
  const script = quoted?.[1]?.trim();
  if (script && isLaunchAbsolutePath(script) && !/[\r\n]/.test(script)) {
    return script;
  }
  return null;
}

/**
 * Underlying binary path from a launch spec. Never returns `cmd.exe`:
 * Windows `.cmd` wrappers keep the quoted script path instead.
 */
export function binaryPathFromLaunchSpec(launch: {
  args: readonly string[];
  command: string;
}): string | null {
  if (isWindowsCmdHost(launch.command)) {
    return scriptPathFromCmdLaunch(launch.args);
  }
  if (isLaunchAbsolutePath(launch.command)) {
    return launch.command;
  }
  return resolveCommandOnPath(launch.command);
}
