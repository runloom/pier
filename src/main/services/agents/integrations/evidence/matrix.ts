import type { AgentKind } from "@shared/contracts/agent.ts";
import { withHostTerminalEscapeEvidence } from "./host-terminal-escape.ts";
import { AGENT_STATUS_EVIDENCE_ROWS_A } from "./matrix-rows-a.ts";
import { AGENT_STATUS_EVIDENCE_ROWS_B } from "./matrix-rows-b.ts";
import type {
  AgentStatusEventMapping,
  AgentStatusEvidence,
  AgentStatusEvidenceDimension,
  AgentStatusEvidenceLevel,
} from "./matrix-types.ts";

export type {
  AgentStatusEventMapping,
  AgentStatusEvidence,
  AgentStatusEvidenceDimension,
  AgentStatusEvidenceLevel,
} from "./matrix-types.ts";

const AGENT_STATUS_EVIDENCE_RAW = {
  ...AGENT_STATUS_EVIDENCE_ROWS_A,
  ...AGENT_STATUS_EVIDENCE_ROWS_B,
} as const satisfies Readonly<Record<AgentKind, AgentStatusEvidence>>;

/**
 * Complete typed evidence: row groups + 全局 host 裸 Esc 取消能力
 * （见 `host-terminal-escape.ts`）。
 */
export const AGENT_STATUS_EVIDENCE = Object.fromEntries(
  Object.entries(AGENT_STATUS_EVIDENCE_RAW).map(([agentId, row]) => [
    agentId,
    withHostTerminalEscapeEvidence(row),
  ])
) as Readonly<Record<AgentKind, AgentStatusEvidence>>;

export function evidenceDimensionsForEventMappings(
  eventMappings: readonly AgentStatusEventMapping[]
): ReadonlyMap<
  AgentStatusEvidenceDimension,
  readonly AgentStatusEvidenceLevel[]
> {
  const dimensions = new Map<
    AgentStatusEvidenceDimension,
    AgentStatusEvidenceLevel[]
  >();
  for (const event of eventMappings) {
    if (event.dimension === "control") {
      continue;
    }
    const current = dimensions.get(event.dimension) ?? [];
    current.push(event.level);
    dimensions.set(event.dimension, current);
  }
  return dimensions;
}
