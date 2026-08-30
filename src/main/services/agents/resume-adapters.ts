import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import { splitShellCommandWords } from "@shared/agent-command-detection.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { TerminalAgentRestoreLaunchOptions } from "@shared/contracts/terminal/launch.ts";
import type {
  TerminalAgentPanelMetadata,
  TerminalTryResumeLastSpec,
} from "@shared/contracts/terminal.ts";
import {
  ampResume,
  antigravityResume,
  appendResumeFlag,
  clineResume,
  codexResume,
  copilotResume,
  gooseResume,
  kimiResume,
  opencodeFamilyResume,
  piResume,
  type ResumeBuildArgs,
  stripEqualsPrefixed,
  stripFlags,
  withCommand,
} from "./resume-command-builders.ts";

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

function baseCommand(
  launch: TerminalAgentRestoreLaunchOptions,
  agentId: AgentKind
): string | null {
  return launch.command ?? getAgentCatalogEntry(agentId)?.launchCmd ?? null;
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
  // gemini-cli bundle (sessionUtils.ts): `--resume {number}|{uuid}|latest` —
  // uuid form is implemented even though --help only mentions number/latest.
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
  // Kimi Code 0.38.x: pin by id is `--session <id>`; `--resume` was removed
  // with the legacy kimi-cli generation.
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
  // pi 0.84.4: `--resume` is a picker-only boolean; pin by id with
  // `--session-id <id>` (exact project session id, recreated when missing).
  pi: sessionAdapter("pi", piResume),
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

/**
 * User-triggered fallback when Pier has no session id: agent-native
 * "last / continue" form only. No disk scan. Null when the agent has no
 * documented last-session entry point.
 */
export function resolveAgentResumeLastLaunch(args: {
  agentId: AgentKind;
  cwd: string | undefined;
  launch: TerminalAgentRestoreLaunchOptions;
}): TerminalAgentRestoreLaunchOptions | null {
  if (AGENT_RESUME_ADAPTERS[args.agentId].support === "unsupported") {
    return null;
  }
  const command = baseCommand(args.launch, args.agentId);
  if (!command) {
    return null;
  }
  const words = splitShellCommandWords(command, 64);
  if (words.length === 0) {
    return null;
  }
  if (args.agentId === "codex") {
    const [binary, ...rest] = words;
    const base = binary
      ? [binary, ...stripFlags(rest, new Set(), new Set(["resume", "fork"]))]
      : words;
    return withCommand(args.launch, args.cwd, [...base, "resume", "--last"]);
  }
  if (CONTINUE_LAST_AGENTS.has(args.agentId)) {
    const cleaned = stripEqualsPrefixed(
      stripFlags(
        words,
        new Set(["--resume-id"]),
        new Set(["--continue", "-c", "--resume-picker"]),
        new Set(["--resume", "-r"])
      ),
      ["--resume", "-r", "--resume-id"]
    );
    return withCommand(args.launch, args.cwd, [...cleaned, "--continue"]);
  }
  return null;
}

export function agentRestoreCreateFields(args: {
  agentRestore: "cold-start" | "resumed" | "unsupported" | undefined;
  cwd: string | undefined;
  restoredAgent: TerminalAgentPanelMetadata | undefined;
}): {
  agentRestore?: "cold-start" | "resumed" | "unsupported";
  tryResumeLast?: TerminalTryResumeLastSpec;
} {
  const tryLast = coldStartTryResumeLast(args);
  return {
    ...(args.agentRestore === undefined
      ? {}
      : { agentRestore: args.agentRestore }),
    ...(tryLast ? { tryResumeLast: tryLast } : {}),
  };
}

export function coldStartTryResumeLast(args: {
  agentRestore: "cold-start" | "resumed" | "unsupported" | undefined;
  cwd: string | undefined;
  restoredAgent: TerminalAgentPanelMetadata | undefined;
}): TerminalTryResumeLastSpec | undefined {
  if (args.agentRestore !== "cold-start" || !args.restoredAgent) {
    return;
  }
  const last = resolveAgentResumeLastLaunch({
    agentId: args.restoredAgent.agentId,
    cwd: args.cwd ?? args.restoredAgent.launch.cwd,
    launch: args.restoredAgent.launch,
  });
  if (!last?.command) {
    return;
  }
  return {
    agentId: args.restoredAgent.agentId,
    command: last.command,
    ...(last.cwd ? { cwd: last.cwd } : {}),
  };
}

/**
 * Only agents with verified cwd-scoped "continue latest" CLI docs.
 * Broader clones (gemini/omp/pi/…) are omitted until flags are confirmed —
 * wrong flags cause a failed relaunch worse than no toast action.
 */
const CONTINUE_LAST_AGENTS: ReadonlySet<AgentKind> = new Set([
  "claude",
  "openclaude",
]);
