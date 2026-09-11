/**
 * Declared Node range precheck (not third-party stderr). Unparsable input
 * never blocks.
 */

import semver from "semver";
import type { HostNodeRuntime } from "../../process-environment/host-node-runtime.ts";

export function satisfiesNodeRequirement(
  version: string,
  range: string
): boolean {
  const parsed = semver.coerce(version);
  if (!parsed) {
    return true;
  }
  try {
    return semver.satisfies(parsed, range);
  } catch {
    return true;
  }
}

/**
 * Host precheck for a declared engine range. Never throws; a missing Node fact
 * degrades to the CLI's own failure output instead of blocking the run.
 */
export async function findUnmetNodeRequirement(input: {
  getHostNodeRuntime?: (() => Promise<HostNodeRuntime | null>) | undefined;
  requiredNode: string;
}): Promise<HostNodeRuntime | null> {
  const { getHostNodeRuntime, requiredNode } = input;
  if (!getHostNodeRuntime) {
    return null;
  }
  try {
    const node = await getHostNodeRuntime();
    return node && !satisfiesNodeRequirement(node.version, requiredNode)
      ? node
      : null;
  } catch {
    return null;
  }
}
