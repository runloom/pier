import type { AgentKind } from "./contracts/agent.ts";
import type { AgentUsageEntry } from "./contracts/agent-usage.ts";
import { usageFrecency } from "./frecency.ts";

// agent 自动选取优先序（claude 首位，去 claude-agent-teams）。
export const AGENT_AUTO_PICK_ORDER: readonly AgentKind[] = [
  "claude",
  "openclaude",
  "codebuddy",
  "qodercli",
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

const AUTO_PICK_INDEX = new Map(
  AGENT_AUTO_PICK_ORDER.map((agentId, index) => [agentId, index])
);

export interface RankAgentsOptions {
  detected: readonly AgentKind[];
  disabled: readonly AgentKind[];
  now: number;
  preferred: AgentKind | "blank" | null;
  recentSuccessAt?: ReadonlyMap<AgentKind, number>;
  usage?: readonly AgentUsageEntry[];
}

/**
 * 默认项固定置顶；其余先按用户主动使用的 frecency，再按一次性调用近期成功，
 * 最后以目录顺序稳定打破平局。
 */
export function rankAgents({
  detected,
  disabled,
  now,
  preferred,
  recentSuccessAt,
  usage = [],
}: RankAgentsOptions): AgentKind[] {
  const detectedSet = new Set(detected);
  const disabledSet = new Set(disabled);
  const usageByAgent = new Map(usage.map((entry) => [entry.agentId, entry]));
  return AGENT_AUTO_PICK_ORDER.filter(
    (agentId) => detectedSet.has(agentId) && !disabledSet.has(agentId)
  ).sort((left, right) => {
    if (preferred !== "blank") {
      if (left === preferred) {
        return -1;
      }
      if (right === preferred) {
        return 1;
      }
    }
    const leftUsage = usageByAgent.get(left);
    const rightUsage = usageByAgent.get(right);
    const usageDelta =
      (rightUsage ? usageFrecency(rightUsage, now) : 0) -
      (leftUsage ? usageFrecency(leftUsage, now) : 0);
    if (usageDelta !== 0) {
      return usageDelta;
    }
    const successDelta =
      (recentSuccessAt?.get(right) ?? 0) - (recentSuccessAt?.get(left) ?? 0);
    if (successDelta !== 0) {
      return successDelta;
    }
    return (AUTO_PICK_INDEX.get(left) ?? 0) - (AUTO_PICK_INDEX.get(right) ?? 0);
  });
}

export function pickAgent(
  preferred: AgentKind | "blank" | null,
  detected: readonly AgentKind[],
  disabled: readonly AgentKind[]
): AgentKind | null {
  if (preferred === "blank") {
    return null;
  }
  return (
    rankAgents({
      detected,
      disabled,
      now: Date.now(),
      preferred,
    })[0] ?? null
  );
}
