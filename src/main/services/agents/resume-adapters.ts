import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import { splitShellCommandWords } from "@shared/agent-command-detection.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { TerminalAgentRestoreLaunchOptions } from "@shared/contracts/terminal/launch.ts";
import type { TerminalAgentPanelMetadata } from "@shared/contracts/terminal.ts";

type ResumeUnsupportedReason =
  | "missing-launch-command"
  | "missing-session-id"
  | "unsupported-agent";

type AgentResumeBuild = (
  args: ResumeBuildArgs
) => TerminalAgentRestoreLaunchOptions;

export interface AgentResumeAdapter {
  agentId: AgentKind;
  build?: AgentResumeBuild;
  support: "session-id" | "unsupported";
}

export type AgentResumeResolution =
  | {
      launch: TerminalAgentRestoreLaunchOptions;
      resumed: true;
    }
  | {
      launch: TerminalAgentRestoreLaunchOptions;
      reason: ResumeUnsupportedReason;
      resumed: false;
    };

interface ResumeBuildArgs {
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

function stripFlags(
  words: readonly string[],
  flagsWithValue: ReadonlySet<string>,
  booleanFlags: ReadonlySet<string> = new Set()
): string[] {
  const out: string[] = [];
  let skipNext = false;
  for (const word of words) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (flagsWithValue.has(word)) {
      skipNext = true;
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
function stripEqualsPrefixed(
  words: readonly string[],
  prefixes: readonly string[]
): string[] {
  return words.filter(
    (word) => !prefixes.some((prefix) => word.startsWith(`${prefix}=`))
  );
}

function baseCommand(
  launch: TerminalAgentRestoreLaunchOptions,
  agentId: AgentKind
): string | null {
  return launch.command ?? getAgentCatalogEntry(agentId)?.launchCmd ?? null;
}

function withCommand(
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

function unsupported(agentId: AgentKind): AgentResumeAdapter {
  return { agentId, support: "unsupported" };
}

function sessionAdapter(
  agentId: AgentKind,
  build: AgentResumeBuild
): AgentResumeAdapter {
  return { agentId, build, support: "session-id" };
}

function appendResumeFlag(
  args: ResumeBuildArgs,
  flag: string
): TerminalAgentRestoreLaunchOptions {
  const words = stripEqualsPrefixed(
    stripFlags(
      args.words,
      new Set([flag, "-r"]),
      new Set(["--continue", "-c", "--resume-picker"])
    ),
    [flag, "-r"]
  );
  return withCommand(args.launch, args.cwd, [...words, flag, args.sessionId]);
}

function codexResume(args: ResumeBuildArgs): TerminalAgentRestoreLaunchOptions {
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

function opencodeFamilyResume(
  args: ResumeBuildArgs
): TerminalAgentRestoreLaunchOptions {
  const words = stripEqualsPrefixed(
    stripFlags(
      args.words,
      new Set(["--session", "-s"]),
      new Set(["--continue", "-c", "--fork"])
    ),
    ["--session", "-s"]
  );
  return withCommand(args.launch, args.cwd, [
    ...words,
    "--session",
    args.sessionId,
  ]);
}

function ampResume(args: ResumeBuildArgs): TerminalAgentRestoreLaunchOptions {
  return withCommand(args.launch, args.cwd, [
    ...args.words,
    "threads",
    "continue",
    args.sessionId,
  ]);
}

/** Copilot CLI documents `copilot --resume=<uuid>` (equals form). */
function copilotResume(
  args: ResumeBuildArgs
): TerminalAgentRestoreLaunchOptions {
  const words = stripEqualsPrefixed(
    stripFlags(
      args.words,
      new Set(["--resume", "-r"]),
      new Set(["--continue", "-c", "--resume-picker"])
    ),
    ["--resume", "-r"]
  );
  return withCommand(args.launch, args.cwd, [
    ...words,
    `--resume=${args.sessionId}`,
  ]);
}

/**
 * Kimi accepts `--session`/`--resume` with short `-S`/`-r`, and `-C` for
 * continue (not only `-c`). Prefer `--resume <id>` for Pier restore.
 */
function kimiResume(args: ResumeBuildArgs): TerminalAgentRestoreLaunchOptions {
  const words = stripEqualsPrefixed(
    stripFlags(
      args.words,
      new Set(["--resume", "--session", "-r", "-S"]),
      new Set(["--continue", "-c", "-C", "--resume-picker"])
    ),
    ["--resume", "--session", "-r", "-S"]
  );
  return withCommand(args.launch, args.cwd, [
    ...words,
    "--resume",
    args.sessionId,
  ]);
}

/**
 * Antigravity (agy): resume a conversation by id.
 * Docs: `agy --conversation <id>`; `-c` / `--continue` is "latest only".
 */
function antigravityResume(
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
function clineResume(args: ResumeBuildArgs): TerminalAgentRestoreLaunchOptions {
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
function gooseResume(args: ResumeBuildArgs): TerminalAgentRestoreLaunchOptions {
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

export const AGENT_RESUME_ADAPTERS = {
  aider: unsupported("aider"),
  amp: sessionAdapter("amp", ampResume),
  ante: unsupported("ante"),
  // Antigravity docs / cheat sheet: `--conversation <id>` (not `--resume`).
  antigravity: sessionAdapter("antigravity", antigravityResume),
  // Augment docs: `auggie --resume <sessionId>`.
  aug: sessionAdapter("aug", (args) => appendResumeFlag(args, "--resume")),
  autohand: unsupported("autohand"),
  claude: sessionAdapter("claude", (args) =>
    appendResumeFlag(args, "--resume")
  ),
  // Cline CLI reference: `--id <session-id>`.
  cline: sessionAdapter("cline", clineResume),
  codebuddy: sessionAdapter("codebuddy", (args) =>
    appendResumeFlag(args, "--resume")
  ),
  codebuff: unsupported("codebuff"),
  codex: sessionAdapter("codex", codexResume),
  // Command Code docs: `-r, --resume [name|id]`.
  "command-code": sessionAdapter("command-code", (args) =>
    appendResumeFlag(args, "--resume")
  ),
  // Continue `cn --resume` is "latest only" — no stable id form for Pier.
  continue: unsupported("continue"),
  copilot: sessionAdapter("copilot", copilotResume),
  crush: unsupported("crush"),
  // cursor-agent --help: `--resume [chatId]`.
  cursor: sessionAdapter("cursor", (args) =>
    appendResumeFlag(args, "--resume")
  ),
  // Devin docs: `-r, --resume <SESSION_ID>`.
  devin: sessionAdapter("devin", (args) => appendResumeFlag(args, "--resume")),
  // droid --help: `-r, --resume [sessionId]`.
  droid: sessionAdapter("droid", (args) => appendResumeFlag(args, "--resume")),
  gemini: sessionAdapter("gemini", (args) =>
    appendResumeFlag(args, "--resume")
  ),
  // Goose: `goose session -r --session-id <id>` (hook persists session_id).
  goose: sessionAdapter("goose", gooseResume),
  grok: sessionAdapter("grok", (args) => appendResumeFlag(args, "--resume")),
  // Hermes CLI: `-r, --resume <session_id>`.
  hermes: sessionAdapter("hermes", (args) =>
    appendResumeFlag(args, "--resume")
  ),
  kilo: sessionAdapter("kilo", opencodeFamilyResume),
  // kimi --help: `--session`/`--resume` (`-S`/`-r`); `-C` continue.
  kimi: sessionAdapter("kimi", kimiResume),
  kiro: sessionAdapter("kiro", (args) => appendResumeFlag(args, "--resume-id")),
  "mimo-code": sessionAdapter("mimo-code", opencodeFamilyResume),
  // Mistral Vibe docs: `vibe --resume SESSION_ID`.
  "mistral-vibe": sessionAdapter("mistral-vibe", (args) =>
    appendResumeFlag(args, "--resume")
  ),
  omp: sessionAdapter("omp", (args) => appendResumeFlag(args, "--resume")),
  openclaw: unsupported("openclaw"),
  openclaude: sessionAdapter("openclaude", (args) =>
    appendResumeFlag(args, "--resume")
  ),
  opencode: sessionAdapter("opencode", opencodeFamilyResume),
  pi: sessionAdapter("pi", (args) => appendResumeFlag(args, "--resume")),
  qodercli: sessionAdapter("qodercli", (args) =>
    appendResumeFlag(args, "--resume")
  ),
  // Qwen Code docs: `qwen --resume <session-id>`.
  "qwen-code": sessionAdapter("qwen-code", (args) =>
    appendResumeFlag(args, "--resume")
  ),
  // Rovo only documents `--restore` without a pinable session id.
  rovo: unsupported("rovo"),
} satisfies Record<AgentKind, AgentResumeAdapter>;

export function resolveAgentResumeLaunch(args: {
  agent: TerminalAgentPanelMetadata;
  cwd: string | undefined;
}): AgentResumeResolution {
  const adapter = AGENT_RESUME_ADAPTERS[args.agent.agentId];
  if (adapter.support === "unsupported" || !adapter.build) {
    return {
      launch: args.agent.launch,
      reason: "unsupported-agent",
      resumed: false,
    };
  }
  const sessionId = args.agent.resume?.sessionId.trim();
  if (!sessionId) {
    return {
      launch: args.agent.launch,
      reason: "missing-session-id",
      resumed: false,
    };
  }
  const command = baseCommand(args.agent.launch, args.agent.agentId);
  if (!command) {
    return {
      launch: args.agent.launch,
      reason: "missing-launch-command",
      resumed: false,
    };
  }
  const words = splitShellCommandWords(command, 64);
  if (words.length === 0) {
    return {
      launch: args.agent.launch,
      reason: "missing-launch-command",
      resumed: false,
    };
  }
  return {
    launch: adapter.build({
      cwd: args.cwd,
      launch: args.agent.launch,
      sessionId,
      words,
    }),
    resumed: true,
  };
}
