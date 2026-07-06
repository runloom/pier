import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import { splitShellCommandWords } from "@shared/agent-command-detection.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { TerminalAgentPanelMetadata } from "@shared/contracts/terminal.ts";
import type { TerminalAgentRestoreLaunchOptions } from "@shared/contracts/terminal-launch.ts";

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
  const words = stripFlags(
    args.words,
    new Set([flag, "-r"]),
    new Set(["--continue", "-c", "--resume-picker"])
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
  const words = stripFlags(
    args.words,
    new Set(["--session", "-s"]),
    new Set(["--continue", "-c", "--fork"])
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

export const AGENT_RESUME_ADAPTERS = {
  aider: unsupported("aider"),
  amp: sessionAdapter("amp", ampResume),
  ante: unsupported("ante"),
  antigravity: unsupported("antigravity"),
  aug: unsupported("aug"),
  autohand: unsupported("autohand"),
  claude: sessionAdapter("claude", (args) =>
    appendResumeFlag(args, "--resume")
  ),
  cline: unsupported("cline"),
  codebuddy: sessionAdapter("codebuddy", (args) =>
    appendResumeFlag(args, "--resume")
  ),
  codebuff: unsupported("codebuff"),
  codex: sessionAdapter("codex", codexResume),
  "command-code": unsupported("command-code"),
  continue: unsupported("continue"),
  copilot: unsupported("copilot"),
  crush: unsupported("crush"),
  cursor: unsupported("cursor"),
  devin: unsupported("devin"),
  droid: unsupported("droid"),
  gemini: sessionAdapter("gemini", (args) =>
    appendResumeFlag(args, "--resume")
  ),
  goose: unsupported("goose"),
  grok: unsupported("grok"),
  hermes: unsupported("hermes"),
  kilo: sessionAdapter("kilo", opencodeFamilyResume),
  kimi: unsupported("kimi"),
  kiro: sessionAdapter("kiro", (args) => appendResumeFlag(args, "--resume-id")),
  "mimo-code": sessionAdapter("mimo-code", opencodeFamilyResume),
  "mistral-vibe": unsupported("mistral-vibe"),
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
  "qwen-code": unsupported("qwen-code"),
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
