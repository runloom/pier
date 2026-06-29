import type { AgentKind } from "./contracts/agent.ts";

export const AGENT_AUTO_PICK_ORDER: readonly AgentKind[] = [
  "claude",
  "codex",
  "gemini",
  "aider",
  "opencode",
  "cursor",
  "copilot",
  "droid",
  "kimi",
  "pi",
  "amp",
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
