import type { ManagedPluginOperationResult } from "@shared/contracts/plugin/managed.ts";

function isManagedOperationFailure(
  result: unknown
): result is Extract<ManagedPluginOperationResult, { ok: false }> {
  return (
    typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    result.ok === false &&
    "error" in result &&
    typeof result.error === "object" &&
    result.error !== null &&
    "message" in result.error &&
    typeof result.error.message === "string"
  );
}

/**
 * Turn resolved `{ ok: false }` managed-plugin IPC results into thrown Errors
 * so callers can use a single catch / toast.promise error path.
 */
export function rejectFailedManagedPluginOperation<T>(
  op: Promise<T>
): Promise<T> {
  return op.then((result) => {
    if (isManagedOperationFailure(result)) {
      throw new Error(result.error.message);
    }
    return result;
  });
}
