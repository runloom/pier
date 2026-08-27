/**
 * Shared Class A CLI resolve helper for official plugins (codex/grok/…).
 * Host supplies resolveUserCommand; plugins map absolute / via-shell to spawn.
 * Aligned with host panel agent last-mile (missing → via-shell, full sticky, shell flags).
 */

export type ResolveUserCommandFn = (
  commandName: string,
  request?: { cwd?: string }
) => Promise<
  | { kind: "absolute"; path: string }
  | { kind: "via-shell" }
  | { kind: "missing"; error: string }
>;

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function agentShellCommandFlags(shellPath: string): string[] {
  const base = shellPath.split("/").pop()?.toLowerCase() ?? "";
  if (base === "fish") {
    return ["-l", "-i", "-c"];
  }
  if (base === "nu" || base === "nushell") {
    return ["-i", "-l", "-c"];
  }
  return ["-lic"];
}

/** Host-apply sticky keys except PATH/MANPATH (rc rebuilds PATH after login). */
const STICKY_EXACT = new Set([
  "NVM_DIR",
  "NVM_BIN",
  "NVM_CD_FLAGS",
  "NVM_INC",
  "FNM_DIR",
  "FNM_MULTISHELL_PATH",
  "FNM_NODE_VERSION",
  "FNM_ARCH",
  "ASDF_DIR",
  "ASDF_DATA_DIR",
  "MISE_DATA_DIR",
  "MISE_SHELL",
  "MISE_CONFIG_DIR",
  "VOLTA_HOME",
  "BUN_INSTALL",
  "PNPM_HOME",
  "GOPATH",
  "GOROOT",
  "GOBIN",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "JAVA_HOME",
  "ANDROID_HOME",
  "ANDROID_SDK_ROOT",
  "PYENV_ROOT",
  "RBENV_ROOT",
  "SDKMAN_DIR",
  "CONDA_PREFIX",
  "CONDA_DEFAULT_ENV",
  "VIRTUAL_ENV",
  "CODEX_HOME",
  "GROK_HOME",
  "CLAUDE_CONFIG_DIR",
]);
const STICKY_PREFIX = /^(NVM|FNM|ASDF|MISE|VOLTA|PYENV|RBENV|SDKMAN|CONDA)_/;

export function buildClassAStickyPrelude(
  env: Record<string, string | undefined>
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      continue;
    }
    if (STICKY_EXACT.has(key) || STICKY_PREFIX.test(key)) {
      parts.push(`export ${key}=${shellQuote(value)}`);
    }
  }
  return parts.join("; ");
}

/**
 * absolute → cmd=path;
 * via-shell **or missing** → user $SHELL + flags + sticky after rc (same as panel agent);
 * no resolver → bare commandName.
 */
export async function resolveClassASpawnTarget(
  commandName: string,
  args: string[],
  env: Record<string, string | undefined>,
  resolveUserCommand: ResolveUserCommandFn | undefined,
  cwd?: string
): Promise<{ args: string[]; cmd: string }> {
  if (!resolveUserCommand) {
    return { args, cmd: commandName };
  }
  const resolved = await resolveUserCommand(commandName, cwd ? { cwd } : {});
  if (resolved.kind === "absolute") {
    return { args, cmd: resolved.path };
  }
  // via-shell and missing: run under user interactive shell (functions / late PATH).
  const shell =
    (typeof env.SHELL === "string" && env.SHELL.startsWith("/")
      ? env.SHELL
      : undefined) ?? "/bin/zsh";
  const line = [commandName, ...args].map(shellQuote).join(" ");
  const sticky = buildClassAStickyPrelude(env);
  const body = sticky ? `${sticky}; ${line}` : line;
  const flags = agentShellCommandFlags(shell);
  // Last flag is -c; body is the command string argument.
  return {
    args: [...flags.slice(0, -1), flags.at(-1) ?? "-c", body].filter(
      (part): part is string => typeof part === "string" && part.length > 0
    ),
    cmd: shell,
  };
}
