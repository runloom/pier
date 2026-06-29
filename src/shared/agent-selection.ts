import type { AgentKind } from "./contracts/agent.ts";

// orca tui-agent-config 注册序（claude 首位，去 claude-agent-teams）。
export const AGENT_AUTO_PICK_ORDER: readonly AgentKind[] = [
  "claude",
  "openclaude",
  "codex",
  "grok",
  "copilot",
  "opencode",
  "mimo-code",
  "ante",
  "pi",
  "omp",
  "gemini",
  "antigravity",
  "aider",
  "goose",
  "amp",
  "kilo",
  "kiro",
  "crush",
  "aug",
  "autohand",
  "cline",
  "codebuff",
  "command-code",
  "continue",
  "cursor",
  "droid",
  "kimi",
  "mistral-vibe",
  "qwen-code",
  "rovo",
  "hermes",
  "openclaw",
  "devin",
];

export function pickAgent(
  preferred: AgentKind | "blank" | null,
  detected: readonly AgentKind[],
  disabled: readonly AgentKind[]
): AgentKind | null {
  if (preferred === "blank") {
    return null;
  }
  const det = new Set(detected);
  const dis = new Set(disabled);
  if (preferred && det.has(preferred) && !dis.has(preferred)) {
    return preferred;
  }
  for (const a of AGENT_AUTO_PICK_ORDER) {
    if (det.has(a) && !dis.has(a)) {
      return a;
    }
  }
  return null;
}
