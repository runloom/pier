import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  PIER_PROJECTION_ROOT_AGENTS,
  PIER_PROJECTION_ROOT_CLAUDE,
} from "@shared/contracts/project-skills.ts";

/**
 * Which installed agents scan each Pier projection root.
 * Mirrors `adapter-facts.ts` discoveryRoots that include these targets —
 * UI chrome only; plan/apply still uses the main registry.
 */
export type PierDiscoveryChannelId = "agents" | "claude";

export interface PierDiscoveryChannel {
  /** Agent kinds that include this root in discoveryRoots. */
  agentKinds: readonly AgentKind[];
  id: PierDiscoveryChannelId;
  root: string;
}

export const PIER_DISCOVERY_CHANNELS: readonly PierDiscoveryChannel[] = [
  {
    id: "agents",
    root: PIER_PROJECTION_ROOT_AGENTS,
    agentKinds: [
      "codex",
      "opencode",
      "cursor",
      "gemini",
      "antigravity",
      "amp",
      "copilot",
      "kimi",
      "crush",
      "aug",
      "command-code",
      "rovo",
      "pi",
      "devin",
      "kilo",
      "codebuff",
      "mistral-vibe",
      "autohand",
      "openclaw",
      "mimo-code",
    ],
  },
  {
    id: "claude",
    root: PIER_PROJECTION_ROOT_CLAUDE,
    agentKinds: [
      "claude",
      "opencode",
      "cursor",
      "amp",
      "copilot",
      "cline",
      "crush",
      "aug",
      "kilo",
      "codebuff",
      "autohand",
      "mimo-code",
      "omp",
      "openclaude",
    ],
  },
];
