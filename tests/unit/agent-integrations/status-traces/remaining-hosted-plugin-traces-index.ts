import { HERMES_STATUS_TRACE } from "./hermes-plugin-trace.ts";
import { KILO_STATUS_TRACE } from "./kilo-plugin-trace.ts";
import { MIMO_CODE_STATUS_TRACE } from "./mimo-code-plugin-trace.ts";

export const REMAINING_HOSTED_PLUGIN_STATUS_TRACES = [
  KILO_STATUS_TRACE,
  MIMO_CODE_STATUS_TRACE,
  HERMES_STATUS_TRACE,
] as const;
