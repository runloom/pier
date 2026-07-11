import type { RegisteredLocalControl } from "./register-local-control.ts";

export interface LocalControlRegistrationOwner {
  close(): Promise<void>;
  start(): void;
}

export interface CreateLocalControlRegistrationOwnerArgs {
  logError(error: unknown): void;
  register(signal: AbortSignal): Promise<RegisteredLocalControl>;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * 统一持有 local-control 的“注册中 / 已注册 / 退出中”状态。
 * close 会 abort 并等待 pending start 收口；若注册结果迟到，结果必须立即自清理，
 * 且清理失败要同时写日志并向退出屏障返回失败。
 */
export function createLocalControlRegistrationOwner({
  logError,
  register,
}: CreateLocalControlRegistrationOwnerArgs): LocalControlRegistrationOwner {
  let abortController: AbortController | null = null;
  let closePromise: Promise<void> | null = null;
  let closed = false;
  let control: RegisteredLocalControl | null = null;
  let pendingRegistration: Promise<void> | null = null;
  let pendingCleanupFailure: unknown = null;
  let started = false;

  return {
    async close() {
      if (closePromise) {
        return await closePromise;
      }
      closed = true;
      abortController?.abort();
      abortController = null;
      const current = control;
      control = null;
      closePromise = (async () => {
        if (current) {
          try {
            await current.close();
          } catch (error) {
            logError(error);
            pendingCleanupFailure = error;
          }
        }
        await pendingRegistration;
        if (pendingCleanupFailure) {
          throw pendingCleanupFailure;
        }
      })();
      return await closePromise;
    },
    start() {
      if (started || closed) {
        return;
      }
      started = true;
      abortController = new AbortController();
      pendingRegistration = register(abortController.signal)
        .then(async (registered) => {
          if (closed) {
            try {
              await registered.close();
            } catch (error) {
              logError(error);
              pendingCleanupFailure = error;
            }
            return;
          }
          control = registered;
        })
        .catch((error: unknown) => {
          if (!(closed && isAbortError(error))) {
            logError(error);
          }
        });
    },
  };
}
