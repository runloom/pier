import type { CreateTerminalResult } from "@shared/contracts/terminal.ts";

const pending = new Map<string, Promise<void>>();
/** Serialize physical create/close operations, keeping cancellation identity at enqueue time. */
export function serializeTerminalOperation<T>(
  key: string,
  operation: () => Promise<T>
): Promise<T> {
  const run = (pending.get(key) ?? Promise.resolve()).then(operation);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  pending.set(key, tail);
  tail.then(() => {
    if (pending.get(key) === tail) pending.delete(key);
  });
  return run;
}
export function serializeTerminalCreate(
  key: string,
  isCurrent: () => boolean,
  create: () => Promise<CreateTerminalResult>
): Promise<CreateTerminalResult> {
  return serializeTerminalOperation(key, async () =>
    isCurrent()
      ? create()
      : { ok: false, error: "terminal closed or moved before launch" }
  );
}
