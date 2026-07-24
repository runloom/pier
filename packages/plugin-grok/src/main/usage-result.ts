import { USAGE_TEMPORARILY_UNAVAILABLE_ERROR } from "../shared/constants.ts";
import type { AccountUsageResult } from "./types.ts";
import { BILLING_TIMEOUT_ERROR } from "./usage-fetch-timeouts.ts";

export { USAGE_TEMPORARILY_UNAVAILABLE_ERROR } from "../shared/constants.ts";

export const SESSION_EXPIRED_RELOGIN_ERROR =
  "Grok session expired — re-login required";
export const ACCESS_DENIED_ERROR =
  "Grok account cannot access billing for this product";

export function abortedResult(): AccountUsageResult {
  return { status: "error", error: "Aborted", windows: [] };
}

export function timedOutResult(): AccountUsageResult {
  return { status: "error", error: BILLING_TIMEOUT_ERROR, windows: [] };
}

export function authFailureResult(detail?: string): AccountUsageResult {
  return {
    status: "error",
    error: detail
      ? `${SESSION_EXPIRED_RELOGIN_ERROR} (${detail})`
      : SESSION_EXPIRED_RELOGIN_ERROR,
    windows: [],
  };
}

export function transientFailureResult(detail?: string): AccountUsageResult {
  return {
    status: "error",
    error: detail
      ? `${USAGE_TEMPORARILY_UNAVAILABLE_ERROR} (${detail})`
      : USAGE_TEMPORARILY_UNAVAILABLE_ERROR,
    windows: [],
  };
}

export function accessDeniedResult(detail?: string): AccountUsageResult {
  return {
    status: "error",
    error: detail ? `${ACCESS_DENIED_ERROR} (${detail})` : ACCESS_DENIED_ERROR,
    windows: [],
  };
}
