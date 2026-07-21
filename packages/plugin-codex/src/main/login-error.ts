/** doAdd 登录错误分类结果：errorState 落 snapshot.lastLoginError，failure 由 add() 抛出。 */
export interface ClassifiedLoginError {
  errorState: { at: number; message: string } | null;
  failure: Error;
}

/** 取消错误，与渲染层 `isLoginCancellation` 的判定保持一致。 */
export function loginCancelledError(): Error {
  const error = new Error("Login cancelled");
  error.name = "AbortError";
  return error;
}

/**
 * 登录错误分类：
 * - 超时（aborted 且 timedOut）→ 设错误态 + 抛出，调用方报错。
 * - 用户主动取消（aborted 非超时 / 原生 AbortError）→ 不设错误态，抛 name
 *   "AbortError" 的哨兵错误，调用方据此静默处理（不弹失败 toast）。
 * - 一般失败 → 设错误态 + 抛出。
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

import { LOGIN_TIMEOUT_MINUTES } from "../shared/constants.ts";
