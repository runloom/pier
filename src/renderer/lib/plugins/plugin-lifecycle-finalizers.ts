import type {
  RendererPluginSuspendParticipant,
  RendererPluginSuspendReason,
} from "./plugin-lifecycle-types.ts";

export interface LifecycleFinalizerParticipant {
  participant: RendererPluginSuspendParticipant;
  pluginId: string;
}

export function asLifecycleParticipant(
  participant:
    | ((reason: RendererPluginSuspendReason) => Promise<void> | void)
    | RendererPluginSuspendParticipant
): RendererPluginSuspendParticipant {
  return typeof participant === "function"
    ? { prepare: ({ reason }) => participant(reason) }
    : participant;
}

export function lifecyclePreparationTimeoutError(
  transitionId: string,
  reason: RendererPluginSuspendReason,
  timeoutMs: number
): Error {
  return new Error(
    `plugin lifecycle preparation timed out: ${transitionId}:${reason}:${timeoutMs}ms`
  );
}

export async function invokeLifecycleFinalizers(
  participants: readonly LifecycleFinalizerParticipant[],
  outcome: "abort" | "commit",
  reason: RendererPluginSuspendReason,
  transitionId: string,
  timeoutMs: number,
  onTimeout: (drain: Promise<PromiseSettledResult<unknown>[]>) => void
): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finalizers = Promise.allSettled(
    participants.map(({ participant }) =>
      Promise.resolve().then(() =>
        participant[outcome]?.(reason, {
          signal: controller.signal,
          transitionId,
        })
      )
    )
  );
  const results = await Promise.race([
    finalizers,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        onTimeout(finalizers);
        reject(
          new Error(
            `plugin lifecycle ${outcome} timed out: ${transitionId}:${reason}:${timeoutMs}ms`
          )
        );
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `plugin lifecycle ${outcome} failed: ${reason}`
    );
  }
}
