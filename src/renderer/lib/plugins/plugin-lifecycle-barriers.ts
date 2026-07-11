import { PluginLifecycleCompletionTracker } from "./plugin-lifecycle-completions.ts";
import { PluginLifecycleDrainTracker } from "./plugin-lifecycle-drains.ts";
import {
  asLifecycleParticipant,
  invokeLifecycleFinalizers,
} from "./plugin-lifecycle-finalizers.ts";
import { runGuardedLifecycle } from "./plugin-lifecycle-guarded-run.ts";
import {
  cancelRuntimeLifecyclePreparations,
  runLifecyclePreparation,
} from "./plugin-lifecycle-preparation.ts";
import { PluginLifecycleReceiptStore } from "./plugin-lifecycle-receipts.ts";
import {
  type CommittedReceiptLease,
  DEFAULT_BARRIER_TIMEOUT_MS,
  type RegisteredParticipant,
  type RendererPluginSuspendBarrier,
  type RendererPluginSuspendParticipant,
  type RendererPluginSuspendReason,
  type RunBarrierOptions,
  type SuspendSession,
} from "./plugin-lifecycle-types.ts";

export class PluginLifecycleBarrierRegistry {
  private readonly barriersByPlugin = new Map<
    string,
    Set<RendererPluginSuspendParticipant>
  >();
  private readonly completions = new PluginLifecycleCompletionTracker();
  private readonly drainTracker = new PluginLifecycleDrainTracker();
  private readonly finalizations = new Map<string, Promise<void>>();
  private readonly finalizerDrains = new Map<string, Promise<unknown>>();
  private readonly pendingAbortCompensations = new Set<string>();
  private readonly preparationDrains = new Map<string, Promise<unknown>>();
  private readonly receipts = new PluginLifecycleReceiptStore();
  private readonly sessions = new Map<string, SuspendSession>();

  clear(pluginId: string): void {
    this.barriersByPlugin.delete(pluginId);
    this.receipts.clearPlugin(pluginId);
  }

  cancelRuntimePreparations(): void {
    cancelRuntimeLifecyclePreparations(this.sessions.values());
  }

  pluginIds(): readonly string[] {
    return [...this.barriersByPlugin.keys()];
  }

  isPluginDraining(pluginId: string): boolean {
    return this.drainTracker.has(pluginId);
  }

  waitForPluginDrain(pluginId: string): Promise<void> {
    return this.drainTracker.wait(pluginId);
  }

  register(
    pluginId: string,
    barrier: RendererPluginSuspendBarrier | RendererPluginSuspendParticipant
  ): () => void {
    if (pluginId.length === 0) {
      throw new Error("plugin lifecycle barrier requires a plugin id");
    }
    const participant = asLifecycleParticipant(barrier);
    let barriers = this.barriersByPlugin.get(pluginId);
    if (!barriers) {
      barriers = new Set();
      this.barriersByPlugin.set(pluginId, barriers);
    }
    barriers.add(participant);
    return () => {
      const current = this.barriersByPlugin.get(pluginId);
      current?.delete(participant);
      if (current?.size === 0) {
        this.barriersByPlugin.delete(pluginId);
      }
    };
  }

  async finalize(
    transitionId: string,
    outcome: "abort" | "commit"
  ): Promise<void> {
    const previous = this.finalizations.get(transitionId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => this.finalizeOnce(transitionId, outcome));
    this.finalizations.set(transitionId, operation);
    try {
      await operation;
    } finally {
      if (this.finalizations.get(transitionId) === operation) {
        this.finalizations.delete(transitionId);
      }
    }
  }

  private async finalizeOnce(
    transitionId: string,
    outcome: "abort" | "commit"
  ): Promise<void> {
    if (this.preparationDrains.has(transitionId)) {
      if (outcome === "abort") {
        this.pendingAbortCompensations.add(transitionId);
        return;
      }
      throw new Error(
        `plugin lifecycle preparation is still draining: ${transitionId}`
      );
    }
    if (this.finalizerDrains.has(transitionId)) {
      if (outcome === "abort") {
        this.pendingAbortCompensations.add(transitionId);
        return;
      }
      throw new Error(
        `plugin lifecycle finalization is still draining: ${transitionId}`
      );
    }
    const completed = this.completions.get(transitionId);
    if (completed) {
      if (completed === "commit" && outcome === "abort") {
        const committed = this.receipts.committedSession(transitionId);
        if (committed) {
          await this.invokeFinalizers(
            committed.participants,
            "abort",
            committed.reason,
            transitionId
          );
          this.completeAbortTransition(transitionId);
        }
        return;
      }
      if (completed !== outcome) {
        throw new Error(
          `plugin lifecycle transition already finalized: ${transitionId}:${completed}`
        );
      }
      return;
    }
    const session = this.sessions.get(transitionId);
    if (!session && outcome === "abort") {
      const committed = this.receipts.committedSession(transitionId);
      if (committed) {
        await this.invokeFinalizers(
          committed.participants,
          "abort",
          committed.reason,
          transitionId
        );
        this.completeAbortTransition(transitionId);
      }
      return;
    }
    if (!session) {
      return;
    }
    if (outcome === "abort") {
      session.controller.abort();
    }
    await session.preparation.catch(() => undefined);
    if (!this.sessions.has(transitionId)) {
      return;
    }
    await this.invokeFinalizers(
      session.participants,
      outcome,
      session.reason,
      transitionId
    );
    if (outcome === "abort") {
      this.completeAbortTransition(transitionId);
    } else {
      this.sessions.delete(transitionId);
      this.completions.remember(transitionId, outcome);
    }
    if (outcome === "commit") this.receipts.recordCommit(session);
  }

  async prepare(
    pluginId: string,
    reason: RendererPluginSuspendReason,
    transitionId: string,
    options: RunBarrierOptions = {}
  ): Promise<void> {
    await this.prepareParticipants(
      this.participantsFor([pluginId]),
      [pluginId],
      reason,
      transitionId,
      options
    );
  }

  async prepareAll(
    reason: RendererPluginSuspendReason,
    transitionId: string,
    options: RunBarrierOptions = {}
  ): Promise<void> {
    const pluginIds = [
      ...new Set([...this.pluginIds(), ...this.receipts.pluginIds()]),
    ];
    await this.prepareParticipants(
      this.participantsFor(pluginIds),
      pluginIds,
      reason,
      transitionId,
      options
    );
  }

  async runGuarded(
    pluginId: string,
    reason: RendererPluginSuspendReason,
    shouldCommit: () => boolean,
    options: { retainCommit?: boolean } = {}
  ): Promise<boolean> {
    return runGuardedLifecycle({
      options,
      pluginId,
      reason,
      registry: this,
      shouldCommit,
    });
  }

  consumeCommitted(
    pluginId: string,
    reason: RendererPluginSuspendReason,
    transitionId?: string
  ): boolean {
    return this.receipts.consume(pluginId, reason, transitionId);
  }

  acquireCommittedLease(
    pluginId: string,
    reason: RendererPluginSuspendReason,
    transitionId?: string
  ): CommittedReceiptLease | undefined {
    return this.receipts.acquire(pluginId, reason, transitionId);
  }

  async abortReceipt(
    pluginId: string,
    reason: RendererPluginSuspendReason
  ): Promise<void> {
    const transitionId = this.receipts.findTransition(pluginId, reason);
    if (transitionId) await this.finalize(transitionId, "abort");
  }

  async consumePreparedOrCommitted(
    pluginId: string,
    reason: RendererPluginSuspendReason,
    shouldCommit: () => boolean = () => true,
    options: { retainCommit?: boolean; transitionId?: string } = {}
  ): Promise<boolean> {
    const prepared = [...this.sessions.values()].find(
      (session) =>
        session.status === "prepared" &&
        session.reason === reason &&
        (!options.transitionId ||
          session.transitionId === options.transitionId) &&
        session.participants.some((item) => item.pluginId === pluginId)
    );
    if (prepared) {
      if (!shouldCommit()) {
        await this.finalize(prepared.transitionId, "abort");
        return false;
      }
      await this.finalize(prepared.transitionId, "commit");
      if (!shouldCommit()) {
        await this.finalize(prepared.transitionId, "abort");
        return false;
      }
    }
    let committedTransitionId = options.transitionId;
    if (
      committedTransitionId &&
      !this.receipts.has(pluginId, reason, committedTransitionId)
    ) {
      committedTransitionId = undefined;
    } else if (!committedTransitionId) {
      committedTransitionId = this.receipts.findTransition(pluginId, reason);
    }
    if (committedTransitionId && !shouldCommit()) {
      await this.finalize(committedTransitionId, "abort");
      return false;
    }
    return options.retainCommit
      ? committedTransitionId !== undefined
      : this.receipts.consume(pluginId, reason, options.transitionId);
  }

  private participantsFor(
    pluginIds: readonly string[]
  ): readonly RegisteredParticipant[] {
    return pluginIds.flatMap((pluginId) =>
      [...(this.barriersByPlugin.get(pluginId) ?? [])].map((participant) => ({
        participant,
        pluginId,
      }))
    );
  }

  private async prepareParticipants(
    participants: readonly RegisteredParticipant[],
    requestedPluginIds: readonly string[],
    reason: RendererPluginSuspendReason,
    transitionId: string,
    options: RunBarrierOptions
  ): Promise<void> {
    const completed = this.completions.get(transitionId);
    if (completed) {
      throw new Error(
        `plugin lifecycle transition already finalized: ${transitionId}:${completed}`
      );
    }
    const existing = this.sessions.get(transitionId);
    if (existing) {
      if (existing.reason !== reason) {
        throw new Error(
          `plugin lifecycle transition reason mismatch: ${transitionId}`
        );
      }
      return await existing.preparation;
    }
    const requestedPlugins = new Set(requestedPluginIds);
    for (const committedTransitionId of this.receipts.transitionIds(
      requestedPlugins
    )) {
      if (committedTransitionId !== transitionId) {
        await this.finalize(committedTransitionId, "abort");
      }
    }
    const drainingPlugin = [...requestedPlugins].find((pluginId) =>
      this.drainTracker.has(pluginId)
    );
    if (drainingPlugin) {
      throw new Error(
        `plugin lifecycle preparation is still aborting: ${drainingPlugin}`
      );
    }
    let conflicting = [...this.sessions.values()].find((session) =>
      session.participants.some((item) => requestedPlugins.has(item.pluginId))
    );
    if (conflicting?.controller.signal.aborted) {
      await this.finalize(conflicting.transitionId, "abort");
      conflicting = [...this.sessions.values()].find((session) =>
        session.participants.some((item) => requestedPlugins.has(item.pluginId))
      );
    }
    if (conflicting) {
      throw new Error(
        `plugin lifecycle transition already active: ${conflicting.transitionId}`
      );
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? DEFAULT_BARRIER_TIMEOUT_MS;
    const session: SuspendSession = {
      controller,
      participants,
      preparation: Promise.resolve(),
      reason,
      status: "preparing",
      transitionId,
    };
    const preparation = runLifecyclePreparation(
      session,
      timeoutMs,
      (pluginIds, drain) => {
        this.preparationDrains.set(transitionId, drain);
        const recovery = drain.then(async () => {
          if (this.preparationDrains.get(transitionId) === drain) {
            this.preparationDrains.delete(transitionId);
          }
          const retryRequested =
            this.pendingAbortCompensations.delete(transitionId);
          try {
            await this.finalize(transitionId, "abort");
          } catch (error) {
            if (!retryRequested) throw error;
            await this.finalize(transitionId, "abort");
          }
        });
        this.drainTracker.track(pluginIds, recovery);
        recovery.catch((recoveryError: unknown) => {
          console.error(
            "[plugins] lifecycle preparation recovery failed:",
            recoveryError
          );
        });
      }
    );
    session.preparation = preparation;
    this.sessions.set(transitionId, session);
    try {
      await preparation;
      session.status = "prepared";
    } catch (error) {
      controller.abort();
      if (this.preparationDrains.has(transitionId)) throw error;
      try {
        await this.invokeFinalizers(
          participants,
          "abort",
          reason,
          transitionId
        );
        this.completeAbortTransition(transitionId);
      } catch (compensationError) {
        throw new AggregateError(
          [error, compensationError],
          `plugin lifecycle preparation and abort compensation failed: ${reason}`
        );
      }
      throw error;
    }
  }

  private completeAbortTransition(transitionId: string): void {
    this.pendingAbortCompensations.delete(transitionId);
    this.preparationDrains.delete(transitionId);
    this.sessions.delete(transitionId);
    this.receipts.removeTransition(transitionId);
    this.completions.remember(transitionId, "abort");
  }

  private async invokeFinalizers(
    participants: readonly RegisteredParticipant[],
    outcome: "abort" | "commit",
    reason: RendererPluginSuspendReason,
    transitionId: string
  ): Promise<void> {
    await invokeLifecycleFinalizers(
      participants,
      outcome,
      reason,
      transitionId,
      DEFAULT_BARRIER_TIMEOUT_MS,
      (drain) => {
        this.finalizerDrains.set(transitionId, drain);
        const pluginIds = new Set(
          participants.map((participant) => participant.pluginId)
        );
        const recovery = drain.then(async (results) => {
          if (this.finalizerDrains.get(transitionId) === drain) {
            this.finalizerDrains.delete(transitionId);
          }
          if (outcome === "abort") {
            const retryRequested =
              this.pendingAbortCompensations.delete(transitionId);
            const failures = results.flatMap((result) =>
              result.status === "rejected" ? [result.reason] : []
            );
            if (failures.length > 0) {
              if (retryRequested) {
                await this.finalize(transitionId, "abort");
                return;
              }
              throw new AggregateError(
                failures,
                `plugin lifecycle abort failed after timeout: ${reason}`
              );
            }
            this.completeAbortTransition(transitionId);
          } else {
            this.pendingAbortCompensations.delete(transitionId);
            await this.finalize(transitionId, "abort");
          }
        });
        this.drainTracker.track(pluginIds, recovery);
        recovery.catch((recoveryError: unknown) => {
          console.error(
            "[plugins] lifecycle delayed finalization recovery failed:",
            recoveryError
          );
        });
      }
    );
  }
}

export const pluginLifecycleBarriers = new PluginLifecycleBarrierRegistry();
