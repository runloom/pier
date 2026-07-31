import { createLocalControlRegistrationOwner } from "@main/adapters/cli/local-control-registration.ts";
import type { RegisteredLocalControl } from "@main/adapters/cli/register-local-control.ts";
import { describe, expect, it, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("local control registration owner", () => {
  it("aborts a pending registration and closes a result that arrives after quit", async () => {
    const pending = deferred<RegisteredLocalControl>();
    const close = vi.fn(async () => undefined);
    const receivedSignals: AbortSignal[] = [];
    const owner = createLocalControlRegistrationOwner({
      logError: vi.fn(),
      register: (signal) => {
        receivedSignals.push(signal);
        return pending.promise;
      },
    });

    owner.start();
    const closing = owner.close();

    expect(receivedSignals[0]?.aborted).toBe(true);
    pending.resolve({ close, socketPath: "/tmp/pier.sock" });
    await closing;

    expect(close).toHaveBeenCalledOnce();
  });

  it("closes an already registered server once and ignores duplicate lifecycle calls", async () => {
    const close = vi.fn(async () => undefined);
    const register = vi.fn(async () => ({
      close,
      socketPath: "/tmp/pier.sock",
    }));
    const owner = createLocalControlRegistrationOwner({
      logError: vi.fn(),
      register,
    });

    owner.start();
    owner.start();
    await Promise.resolve();
    await owner.close();
    await owner.close();

    expect(register).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports and rejects when a late registration cannot be closed", async () => {
    const pending = deferred<RegisteredLocalControl>();
    const failure = new Error("late close failed");
    const logError = vi.fn();
    const owner = createLocalControlRegistrationOwner({
      logError,
      register: async () => await pending.promise,
    });

    owner.start();
    const closing = owner.close();
    pending.resolve({
      close: vi.fn(async () => {
        throw failure;
      }),
      socketPath: "/tmp/pier.sock",
    });

    await expect(closing).rejects.toBe(failure);
    expect(logError).toHaveBeenCalledWith(failure);
  });
});
