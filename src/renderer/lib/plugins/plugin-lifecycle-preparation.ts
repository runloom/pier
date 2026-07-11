import { lifecyclePreparationTimeoutError } from "./plugin-lifecycle-finalizers.ts";
import type { SuspendSession } from "./plugin-lifecycle-types.ts";

export function cancelRuntimeLifecyclePreparations(
  sessions: Iterable<SuspendSession>
): void {
  for (const session of sessions) {
    if (session.transitionId.startsWith("runtime:")) {
      session.controller.abort();
    }
  }
}

export async function compensateLifecyclePreparationFailure(
  transitionId: string,
  preparationError: unknown,
  abort: () => Promise<void>
): Promise<void> {
  try {
    await abort();
  } catch (compensationError) {
    throw new AggregateError(
      [preparationError, compensationError],
      `plugin lifecycle preparation and abort compensation failed: ${transitionId}`
    );
  }
}

export async function runLifecyclePreparation(
  session: SuspendSession,
  timeoutMs: number,
  beginDrain: (pluginIds: ReadonlySet<string>, drain: Promise<unknown>) => void
): Promise<void> {
  let abortListener: (() => void) | undefined;
  let drainStarted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const participantResults = Promise.allSettled(
      session.participants.map(({ participant }) =>
        Promise.resolve().then(() =>
          participant.prepare({
            reason: session.reason,
            signal: session.controller.signal,
            transitionId: session.transitionId,
          })
        )
      )
    );
    const beginParticipantDrain = () => {
      if (drainStarted) return;
      drainStarted = true;
      beginDrain(
        new Set(session.participants.map((item) => item.pluginId)),
        participantResults
      );
    };
    const aborted = new Promise<never>((_resolve, reject) => {
      abortListener = () => {
        beginParticipantDrain();
        reject(
          new DOMException(
            `plugin lifecycle preparation aborted: ${session.transitionId}`,
            "AbortError"
          )
        );
      };
      if (session.controller.signal.aborted) {
        abortListener();
      } else {
        session.controller.signal.addEventListener("abort", abortListener, {
          once: true,
        });
      }
    });
    const results = await Promise.race([
      participantResults,
      aborted,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            lifecyclePreparationTimeoutError(
              session.transitionId,
              session.reason,
              timeoutMs
            )
          );
          session.controller.abort();
        }, timeoutMs);
      }),
    ]);
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `plugin lifecycle preparation failed: ${session.reason}`
      );
    }
  } finally {
    if (abortListener) {
      session.controller.signal.removeEventListener("abort", abortListener);
    }
    if (timer) {
      clearTimeout(timer);
    }
  }
}
