/**
 * User login argv helper. Dump stays interactive (`-l -i -c`); background /
 * lifecycle one-shots use `-c` so the dump overlay PATH is not reclobbered.
 * Visible task tabs do not use this — they open Ghostty's default login shell
 * and type the script. Git / LSP stay binary + project env and must not use
 * this wrapper.
 */
import {
  agentShellCommandFlags,
  loginShellCommandFlags,
} from "./resolve-user-command-probe.ts";
import {
  quoteShellArg,
  resolveWrapperShell,
} from "./resolve-user-command-types.ts";

export interface LoginShellSpawnSpec {
  args: string[];
  command: string;
}

export type LoginShellFlagMode = "interactive" | "command";

/** Argv flags: dump/agent PTY use interactive `-l -i -c`; one-shot uses `-c`. */
export function loginShellFlagArgs(
  shellPath: string,
  mode: LoginShellFlagMode = "interactive"
): string[] {
  const flags =
    mode === "command"
      ? loginShellCommandFlags()
      : agentShellCommandFlags(shellPath);
  return flags.split(/\s+/).filter((part) => part.length > 0);
}

/**
 * Spawn spec for a one-shot `$SHELL -c` running `script` (dump PATH wins).
 * Windows stays `cmd /d /s /c` (dump is skipped on win32).
 */
export function loginShellSpawnSpec(
  script: string,
  env?: Record<string, string>
): LoginShellSpawnSpec {
  if (process.platform === "win32") {
    const command = env?.ComSpec ?? process.env.ComSpec ?? "cmd.exe";
    return { args: ["/d", "/s", "/c", script], command };
  }
  const command = resolveWrapperShell(env);
  return {
    args: [...loginShellFlagArgs(command, "command"), script],
    command,
  };
}

/** Ghostty / command-line form of {@link loginShellSpawnSpec}. */
export function wrapLoginShellCommandLine(
  script: string,
  env?: Record<string, string>
): string {
  const spec = loginShellSpawnSpec(script, env);
  const flags = spec.args.slice(0, -1);
  const body = spec.args.at(-1) ?? script;
  return [quoteShellArg(spec.command), ...flags, quoteShellArg(body)].join(" ");
}

/**
 * Dump script: `cd` into the project root (or HOME) then printenv, so direnv /
 * mise / asdf directory hooks run. Zed dumps at the project root, not each cwd.
 */
export function buildLoginShellDumpCommand(
  jsonCommand: string,
  dumpCwd?: string
): string {
  if (!dumpCwd) {
    return jsonCommand;
  }
  const dir = dumpCwd.startsWith("-") ? `./${dumpCwd}` : dumpCwd;
  return `cd ${quoteShellArg(dir)}; ${jsonCommand}`;
}
