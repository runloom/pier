import { commitLifecycleTransition } from "./plugin-lifecycle-commit.ts";
import { compensateLifecyclePreparationFailure } from "./plugin-lifecycle-preparation.ts";
import type {
  CommittedReceiptLease,
  RendererPluginSuspendReason,
} from "./plugin-lifecycle-types.ts";

interface GuardedLifecycleRegistry {
  acquireCommittedLease(
    pluginId: string,
    reason: RendererPluginSuspendReason
  ): CommittedReceiptLease | undefined;
  consumeCommitted(
    pluginId: string,
    reason: RendererPluginSuspendReason,
    transitionId?: string
  ): boolean;
  finalize(transitionId: string, outcome: "abort" | "commit"): Promise<void>;
  prepare(
    pluginId: string,
    reason: RendererPluginSuspendReason,
    transitionId: string
  ): Promise<void>;
}

export async function runGuardedLifecycle(input: {
  options: { retainCommit?: boolean };
  pluginId: string;
  reason: RendererPluginSuspendReason;
  registry: GuardedLifecycleRegistry;
  shouldCommit(): boolean;
}): Promise<boolean> {
  const { options, pluginId, reason, registry, shouldCommit } = input;
  if (!shouldCommit()) return false;
  const existing = registry.acquireCommittedLease(pluginId, reason);
  if (existing) {
    if (!shouldCommit()) {
      await registry.finalize(existing.transitionId, "abort");
      return false;
    }
    if (!options.retainCommit) {
      registry.consumeCommitted(pluginId, reason, existing.transitionId);
    }
    return true;
  }
  const transitionId = `runtime:${crypto.randomUUID()}`;
  try {
    await registry.prepare(pluginId, reason, transitionId);
  } catch (error) {
    await compensateLifecyclePreparationFailure(transitionId, error, () =>
      registry.finalize(transitionId, "abort")
    );
    if (
      !shouldCommit() &&
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      return false;
    }
    throw error;
  }
  if (!shouldCommit()) {
    await registry.finalize(transitionId, "abort");
    return false;
  }
  await commitLifecycleTransition({
    finalize: (outcome) => registry.finalize(transitionId, outcome),
    pluginId,
  });
  if (!shouldCommit()) {
    await registry.finalize(transitionId, "abort");
    return false;
  }
  if (!options.retainCommit) {
    registry.consumeCommitted(pluginId, reason, transitionId);
  }
  return true;
}
