/**
 * Re-exports runner factory. Install execution lives in runner/node.ts only.
 */
export { createNodeLifecycleRunner } from "./runner/node.ts";
export type {
  LifecycleRunner,
  LifecycleRunOptions,
  LifecycleRunResult,
} from "./runner/types.ts";
