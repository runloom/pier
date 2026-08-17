export { AMP_PLUGIN_STATUS_TRACE } from "./amp-plugin-trace.ts";
export { CODEBUDDY_RECONCILER_STATUS_TRACE } from "./codebuddy-reconciler-trace.ts";
export { EXTENSION_PLUGIN_STATUS_TRACES } from "./extension-plugin-traces.ts";
export { INACTIVE_AGENT_STATUS_TRACES } from "./inactive-traces.ts";
export { NESTED_HOOK_STATUS_TRACES } from "./nested-hook-traces.ts";
export { runAgentStatusTrace } from "./status-trace-harness.ts";
export type {
  AgentStatusTraceFixture,
  InactiveAgentStatusTraceFixture,
} from "./status-trace-types.ts";

import { AMP_PLUGIN_STATUS_TRACE } from "./amp-plugin-trace.ts";
import { CODEBUDDY_RECONCILER_STATUS_TRACE } from "./codebuddy-reconciler-trace.ts";
import { EXTENSION_PLUGIN_STATUS_TRACES } from "./extension-plugin-traces.ts";
import { FLAT_COMMAND_STATUS_TRACES } from "./flat-command-traces.ts";
import { HOSTED_PLUGIN_STATUS_TRACES } from "./hosted-plugin-traces.ts";
import { NESTED_HOOK_STATUS_TRACES } from "./nested-hook-traces.ts";
import { RECONCILER_STATUS_TRACES } from "./reconciler-traces.ts";
import { REMAINING_HOSTED_PLUGIN_STATUS_TRACES } from "./remaining-hosted-plugin-traces-index.ts";
import { SPECIAL_COMMAND_STATUS_TRACES } from "./special-command-traces.ts";
import type { AgentStatusTraceFixture } from "./status-trace-types.ts";

export { FLAT_COMMAND_STATUS_TRACES } from "./flat-command-traces.ts";
export { HOSTED_PLUGIN_STATUS_TRACES } from "./hosted-plugin-traces.ts";
export { RECONCILER_STATUS_TRACES } from "./reconciler-traces.ts";
export { SPECIAL_COMMAND_STATUS_TRACES } from "./special-command-traces.ts";
export const ACTIVE_AGENT_STATUS_TRACES: readonly AgentStatusTraceFixture[] = [
  ...NESTED_HOOK_STATUS_TRACES,
  ...FLAT_COMMAND_STATUS_TRACES,
  ...HOSTED_PLUGIN_STATUS_TRACES,
  ...REMAINING_HOSTED_PLUGIN_STATUS_TRACES,
  ...RECONCILER_STATUS_TRACES,
  CODEBUDDY_RECONCILER_STATUS_TRACE,
  ...SPECIAL_COMMAND_STATUS_TRACES,
  ...BRANCHING_COMMAND_STATUS_TRACES,
  AMP_PLUGIN_STATUS_TRACE,
  ...EXTENSION_PLUGIN_STATUS_TRACES,
];

import { BRANCHING_COMMAND_STATUS_TRACES } from "./branching-command-traces.ts";

export { BRANCHING_COMMAND_STATUS_TRACES } from "./branching-command-traces.ts";
