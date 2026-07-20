import { LOGIN_TIMEOUT_MINUTES } from "../shared/constants.ts";

/** doAdd login error classification: errorState → snapshot.lastLoginError. */
export interface ClassifiedLoginError {
  errorState: { at: number; message: string } | null;
  failure: Error;
}

/** Cancellation error matching the renderer's `isLoginCancellation` check. */
export function loginCancelledError(): Error {
  const error = new Error("Login cancelled");
  error.name = "AbortError";
  return error;
}

/**
 * Login error classification:
 * - timeout (aborted + timedOut) → error state + throw
 * - user cancel (aborted non-timeout / AbortError) → no error state, AbortError
 * - other failure → error state + throw
 */
export function classifyLoginError(
  err: unknown,
  ctx: { aborted: boolean; at: number; timedOut: boolean }
): ClassifiedLoginError {
  const e = err instanceof Error ? err : new Error(String(err));
  if (ctx.aborted && ctx.timedOut) {
    const message = `Login timed out after ${LOGIN_TIMEOUT_MINUTES} minutes`;
    return { errorState: { at: ctx.at, message }, failure: new Error(message) };
  }
  if (ctx.aborted || e.name === "AbortError") {
    const cancelled = new Error("Login cancelled");
    cancelled.name = "AbortError";
    return { errorState: null, failure: cancelled };
  }
  return { errorState: { at: ctx.at, message: e.message }, failure: e };
}
