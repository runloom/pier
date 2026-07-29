import type { AgentKind } from "@shared/contracts/agent.ts";
import { AGENT_STATUS_EVIDENCE_ROWS_A } from "./evidence-matrix-rows-a.ts";
import { AGENT_STATUS_EVIDENCE_ROWS_B } from "./evidence-matrix-rows-b.ts";
import type {
  AgentStatusEventMapping,
  AgentStatusEvidence,
  AgentStatusEvidenceDimension,
  AgentStatusEvidenceLevel,
} from "./evidence-matrix-types.ts";

export type {
  AgentStatusEventMapping,
  AgentStatusEvidence,
  AgentStatusEvidenceDimension,
  AgentStatusEvidenceLevel,
} from "./evidence-matrix-types.ts";

/** Complete typed evidence source: every AgentKind is explicit in one row group. */
export const AGENT_STATUS_EVIDENCE = {
  ...AGENT_STATUS_EVIDENCE_ROWS_A,
  ...AGENT_STATUS_EVIDENCE_ROWS_B,
} as const satisfies Readonly<Record<AgentKind, AgentStatusEvidence>>;

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
