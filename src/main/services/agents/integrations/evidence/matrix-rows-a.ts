import { AGENT_STATUS_EVIDENCE_ROWS_A_1 } from "./matrix-rows-a-1.ts";
import { AGENT_STATUS_EVIDENCE_ROWS_A_2 } from "./matrix-rows-a-2.ts";

export const AGENT_STATUS_EVIDENCE_ROWS_A = {
  ...AGENT_STATUS_EVIDENCE_ROWS_A_1,
  ...AGENT_STATUS_EVIDENCE_ROWS_A_2,
} as const;
