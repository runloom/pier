import type { TerminalAgentRestoreLaunchOptions } from "@shared/contracts/terminal/launch.ts";

/**
 * 各 agent 原生「钉 id 恢复」命令拼装器。宿主只存恢复索引（sessionId +
 * cwd + agentId），重启后经这里拼出该家 CLI 的原生 resume 命令再 spawn；
 * flag 语义全部按各家 CLI --help / dist 一手核对（见各 builder 注释与
 * resume-adapters.ts 的 registry 注释）。
 */
export interface ResumeBuildArgs {
  cwd: string | undefined;
  launch: TerminalAgentRestoreLaunchOptions;
  sessionId: string;
  words: string[];
}

const SHELL_SAFE_RE = /^[A-Za-z0-9_./:@%+=,-]+$/;

function shellQuote(value: string): string {
  if (SHELL_SAFE_RE.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandFromWords(words: readonly string[]): string {
  return words.map(shellQuote).join(" ");
}

export function stripFlags(
  words: readonly string[],
  flagsWithValue: ReadonlySet<string>,
  booleanFlags: ReadonlySet<string> = new Set(),
  optionalValueFlags: ReadonlySet<string> = new Set()
): string[] {
  const out: string[] = [];
  let skipNext = false;
  for (const [index, word] of words.entries()) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (flagsWithValue.has(word)) {
      skipNext = true;
      continue;
    }
    if (optionalValueFlags.has(word)) {
      // `-r [id]` style: bare form opens a picker, so only consume the next
      // word when it is a value (not another flag).
      const next = words[index + 1];
      skipNext = next !== undefined && !next.startsWith("-");
      continue;
    }
    if (booleanFlags.has(word)) {
      continue;
    }
    out.push(word);
  }
  return out;
}

/** Drop `--flag=value` / `-r=value` tokens left after token-based stripFlags. */
export function stripEqualsPrefixed(
  words: readonly string[],
  prefixes: readonly string[]
): string[] {
  return words.filter(
    (word) => !prefixes.some((prefix) => word.startsWith(`${prefix}=`))
  );
}

export function withCommand(
  launch: TerminalAgentRestoreLaunchOptions,
  cwd: string | undefined,
  words: readonly string[]
): TerminalAgentRestoreLaunchOptions {
  return {
    ...(launch.agentId && { agentId: launch.agentId }),
    command: commandFromWords(words),
    ...((cwd ?? launch.cwd) ? { cwd: cwd ?? launch.cwd } : {}),
  };
}

/**
 * Resume flags in this family take an optional value (`-r [id]`; bare form is
 * a picker — or plain boolean on kiro), so a bare token must not swallow the
 * following flag.
 */
export function appendResumeFlag(
  args: ResumeBuildArgs,
  flag: string
): TerminalAgentRestoreLaunchOptions {
  const words = stripEqualsPrefixed(
    stripFlags(
      args.words,
      new Set(),
      new Set(["--continue", "-c", "--resume-picker"]),
      new Set([flag, "-r"])
    ),
    [flag, "-r"]
  );
  return withCommand(args.launch, args.cwd, [...words, flag, args.sessionId]);
}

export function codexResume(
  args: ResumeBuildArgs
): TerminalAgentRestoreLaunchOptions {
  const [binary, ...rest] = args.words;
  const words = binary
    ? [binary, ...stripFlags(rest, new Set(), new Set(["resume", "fork"]))]
    : args.words;
  return withCommand(args.launch, args.cwd, [
    ...words,
    "resume",
    args.sessionId,
  ]);
}

export function opencodeFamilyResume(
  args: ResumeBuildArgs
): TerminalAgentRestoreLaunchOptions {
  // `--cloud-fork` is kilo-only (fetch from cloud + fork, "use with
  // --session"); stripping it is a no-op for opencode/mimo.
  const words = stripEqualsPrefixed(
    stripFlags(
      args.words,
      new Set(["--session", "-s"]),
      new Set(["--continue", "-c", "--fork", "--cloud-fork"])
    ),
    ["--session", "-s"]
  );
  return withCommand(args.launch, args.cwd, [
    ...words,
    "--session",
    args.sessionId,
  ]);
}

export function ampResume(
  args: ResumeBuildArgs
): TerminalAgentRestoreLaunchOptions {
  return withCommand(args.launch, args.cwd, [
    ...args.words,
    "threads",
    "continue",
    args.sessionId,
  ]);
}

/** Copilot CLI documents `copilot --resume=<uuid>` (equals form). */
export function copilotResume(
  args: ResumeBuildArgs
): TerminalAgentRestoreLaunchOptions {
  const words = stripEqualsPrefixed(
    stripFlags(
      args.words,
      new Set(),
      new Set(["--continue", "-c", "--resume-picker"]),
      new Set(["--resume", "-r"])
    ),
    ["--resume", "-r"]
  );
  return withCommand(args.launch, args.cwd, [
    ...words,
    `--resume=${args.sessionId}`,
  ]);
}

/**
 * Kimi Code (0.38.x --help 核对): `-S, --session [id]` is the only pin-by-id
 * entry — legacy kimi-cli's `--resume`/`-r` no longer exists (commander exits
 * on unknown option). `--session` also existed on legacy kimi-cli, so it is
 * safe across both generations. `--agent`/`--agent-file` "cannot be combined
 * with --session/--continue", so strip them alongside session/continue flags;
 * legacy resume tokens are stripped defensively from stored launch commands.
 */
export function kimiResume(
  args: ResumeBuildArgs
): TerminalAgentRestoreLaunchOptions {
  // `-S, --session [id]` and legacy `--resume`/`-r` are picker-when-bare;
  // `--agent <name>`/`--agent-file <path>` always take a value.
  const optionalValueFlags = ["--session", "-S", "--resume", "-r"] as const;
  const words = stripEqualsPrefixed(
    stripFlags(
      args.words,
      new Set(["--agent", "--agent-file"]),
      new Set(["--continue", "-c", "-C"]),
      new Set(optionalValueFlags)
    ),
    [...optionalValueFlags, "--agent", "--agent-file"]
  );
  return withCommand(args.launch, args.cwd, [
    ...words,
    "--session",
    args.sessionId,
  ]);
}

/**
 * Antigravity (agy): resume a conversation by id.
 * Docs: `agy --conversation <id>`; `-c` / `--continue` is "latest only".
 */
export function antigravityResume(
  args: ResumeBuildArgs
): TerminalAgentRestoreLaunchOptions {
  const words = stripEqualsPrefixed(
    stripFlags(
      args.words,
      new Set(["--conversation"]),
      new Set(["--continue", "-c"])
    ),
    ["--conversation"]
  );
  return withCommand(args.launch, args.cwd, [
    ...words,
    "--conversation",
    args.sessionId,
  ]);
}

/**
 * Cline: `cline --id <session-id>`.
 * Do not strip bare `-c` — on Cline that is `--cwd`, not continue.
 */
export function clineResume(
  args: ResumeBuildArgs
): TerminalAgentRestoreLaunchOptions {
  const words = stripEqualsPrefixed(
    stripFlags(args.words, new Set(["--id"]), new Set()),
    ["--id"]
  );
  return withCommand(args.launch, args.cwd, [...words, "--id", args.sessionId]);
}

/**
 * Goose: resume via session subcommand using the hook session id.
 * Form: `goose session -r --session-id <id>` (not `--name`; hooks persist id).
 */
export function gooseResume(
  args: ResumeBuildArgs
): TerminalAgentRestoreLaunchOptions {
  const binary = args.words[0] ?? "goose";
  let rest = args.words.slice(1);
  if (rest[0] === "session") {
    rest = rest.slice(1);
  }
  rest = stripEqualsPrefixed(
    stripFlags(
      rest,
      new Set(["--name", "--session-id", "--path", "-n"]),
      new Set(["-r", "--resume", "--continue", "-c"])
    ),
    ["--name", "--session-id", "--path", "-n"]
  );
  return withCommand(args.launch, args.cwd, [
    binary,
    "session",
    "-r",
    "--session-id",
    args.sessionId,
    ...rest,
  ]);
}

/**
 * pi (0.84.4 dist 核对): `--resume`/`-r` is a picker-only boolean — a trailing
 * id would be consumed as the first prompt message. Pin by id via
 * `--session-id <id>`: exact project session id; resumes when present,
 * otherwise warns and creates a new session with the same id (graceful cold
 * start that keeps Pier's resume index stable). `--session <path|id>` is
 * unfit for unattended restore: a cross-project match blocks on an
 * interactive fork prompt and a missing session exits 1. pi exits 1 when
 * `--session-id` is combined with `--session`/`--continue`/`--resume`, and
 * `--fork` refuses an existing target id, so strip all of them.
 */
export function piResume(
  args: ResumeBuildArgs
): TerminalAgentRestoreLaunchOptions {
  const words = stripEqualsPrefixed(
    stripFlags(
      args.words,
      new Set(["--session", "--session-id", "--fork"]),
      new Set(["--continue", "-c", "--resume", "-r"])
    ),
    ["--session", "--session-id", "--fork"]
  );
  return withCommand(args.launch, args.cwd, [
    ...words,
    "--session-id",
    args.sessionId,
  ]);
}
