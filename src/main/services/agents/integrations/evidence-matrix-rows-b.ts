import { AGENT_STATUS_EVIDENCE_ROWS_B_1 } from "./evidence-matrix-rows-b-1.ts";
import { AGENT_STATUS_EVIDENCE_ROWS_B_2 } from "./evidence-matrix-rows-b-2.ts";

export const AGENT_STATUS_EVIDENCE_ROWS_B = {
  ...AGENT_STATUS_EVIDENCE_ROWS_B_1,
  ...AGENT_STATUS_EVIDENCE_ROWS_B_2,
} as const;
