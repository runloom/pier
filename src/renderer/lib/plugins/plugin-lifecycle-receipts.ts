import type {
  CommittedReceiptLease,
  RendererPluginSuspendReason,
  SuspendSession,
} from "./plugin-lifecycle-types.ts";

type CommittedSession = Pick<
  SuspendSession,
  "participants" | "reason" | "transitionId"
>;

export class PluginLifecycleReceiptStore {
  private readonly receiptsByPlugin = new Map<
    string,
    Array<{ reason: RendererPluginSuspendReason; transitionId: string }>
  >();
  private readonly sessions = new Map<string, CommittedSession>();

  clearPlugin(pluginId: string): void {
    const transitionIds = new Set(
      (this.receiptsByPlugin.get(pluginId) ?? []).map(
        (receipt) => receipt.transitionId
      )
    );
    this.receiptsByPlugin.delete(pluginId);
    for (const transitionId of transitionIds) {
      const stillReferenced = [...this.receiptsByPlugin.values()].some(
        (receipts) =>
          receipts.some((receipt) => receipt.transitionId === transitionId)
      );
      if (!stillReferenced) this.sessions.delete(transitionId);
    }
  }

  committedSession(transitionId: string): CommittedSession | undefined {
    return this.sessions.get(transitionId);
  }

  acquire(
    pluginId: string,
    reason: RendererPluginSuspendReason,
    expectedTransitionId?: string
  ): CommittedReceiptLease | undefined {
    const transitionId =
      expectedTransitionId ?? this.findTransition(pluginId, reason);
    if (!(transitionId && this.has(pluginId, reason, transitionId))) return;
    return {
      isCurrent: () => this.has(pluginId, reason, transitionId),
      transitionId,
    };
  }

  consume(
    pluginId: string,
    reason: RendererPluginSuspendReason,
    expectedTransitionId?: string
  ): boolean {
    const receipts = this.receiptsByPlugin.get(pluginId);
    const index =
      receipts?.findIndex(
        (item) =>
          item.reason === reason &&
          (!expectedTransitionId || item.transitionId === expectedTransitionId)
      ) ?? -1;
    if (!(receipts && index >= 0)) return false;
    const transitionId = receipts[index]?.transitionId;
    receipts.splice(index, 1);
    if (receipts.length === 0) this.receiptsByPlugin.delete(pluginId);
    const stillReferenced = [...this.receiptsByPlugin.values()].some((items) =>
      items.some((item) => item.transitionId === transitionId)
    );
    if (!stillReferenced && transitionId) this.sessions.delete(transitionId);
    return true;
  }

  findTransition(
    pluginId: string,
    reason: RendererPluginSuspendReason
  ): string | undefined {
    return this.receiptsByPlugin
      .get(pluginId)
      ?.find((receipt) => receipt.reason === reason)?.transitionId;
  }

  has(
    pluginId: string,
    reason: RendererPluginSuspendReason,
    transitionId: string
  ): boolean {
    return (
      this.receiptsByPlugin
        .get(pluginId)
        ?.some(
          (receipt) =>
            receipt.reason === reason && receipt.transitionId === transitionId
        ) ?? false
    );
  }

  recordCommit(session: SuspendSession): void {
    if (session.participants.length === 0) return;
    this.sessions.set(session.transitionId, {
      participants: session.participants,
      reason: session.reason,
      transitionId: session.transitionId,
    });
    for (const { pluginId } of session.participants) {
      const receipts = this.receiptsByPlugin.get(pluginId) ?? [];
      if (
        !receipts.some((item) => item.transitionId === session.transitionId)
      ) {
        receipts.push({
          reason: session.reason,
          transitionId: session.transitionId,
        });
        this.receiptsByPlugin.set(pluginId, receipts);
      }
    }
  }

  removeTransition(transitionId: string): void {
    this.sessions.delete(transitionId);
    for (const [pluginId, receipts] of this.receiptsByPlugin) {
      const remaining = receipts.filter(
        (receipt) => receipt.transitionId !== transitionId
      );
      if (remaining.length === 0) {
        this.receiptsByPlugin.delete(pluginId);
      } else {
        this.receiptsByPlugin.set(pluginId, remaining);
      }
    }
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  pluginIds(): readonly string[] {
    return [...this.receiptsByPlugin.keys()];
  }

  transitionIds(pluginIds: ReadonlySet<string>): readonly string[] {
    const transitionIds = new Set<string>();
    for (const pluginId of pluginIds) {
      for (const receipt of this.receiptsByPlugin.get(pluginId) ?? []) {
        transitionIds.add(receipt.transitionId);
      }
    }
    return [...transitionIds];
  }
}
