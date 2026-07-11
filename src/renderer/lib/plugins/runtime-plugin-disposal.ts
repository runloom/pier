import { closeOverlaysForPlugin } from "@/stores/plugin-overlay.store.ts";
import type { ExternalTransitionAuthorization } from "./external-transition-gate.ts";
import { clearHostGroupContentForPlugin } from "./host-group-content-context.tsx";
import { pluginLifecycleBarriers } from "./plugin-lifecycle-barriers.ts";
import type {
  CommittedReceiptLease,
  RendererPluginSuspendReason,
} from "./plugin-lifecycle-types.ts";

type LifecycleDisposalLease =
  | {
      reason: RendererPluginSuspendReason;
      receipt: CommittedReceiptLease | undefined;
      source: "local";
    }
  | {
      reason: "plugin-disable" | "plugin-reload";
      receipt: CommittedReceiptLease;
      source: "main";
    };

export interface ActiveRendererPlugin {
  dispose: () => void;
  kind: "builtin" | "external";
  signature: string;
  state: "active" | "cleanup-failed";
}

export async function suspendAndDisposeOwnedRendererPlugin(input: {
  active: Map<string, ActiveRendererPlugin>;
  mainAuthorization?: ExternalTransitionAuthorization | undefined;
  pluginId: string;
  reason: RendererPluginSuspendReason;
  shouldContinue(): boolean;
}): Promise<void> {
  const owned = input.active.get(input.pluginId);
  if (!owned) return;
  await suspendAndDisposeRendererPlugin({
    dispose: owned.dispose,
    mainAuthorization: input.mainAuthorization,
    onDisposeFailed: () => {
      if (input.active.get(input.pluginId) === owned) {
        owned.state = "cleanup-failed";
      }
    },
    onDisposed: () => input.active.delete(input.pluginId),
    pluginId: input.pluginId,
    reason: input.reason,
    shouldContinue: input.shouldContinue,
  });
}

export async function suspendAndDisposeRendererPlugin(input: {
  dispose(): void;
  mainAuthorization?: ExternalTransitionAuthorization | undefined;
  onDisposeFailed?(): void;
  onDisposed(): void;
  pluginId: string;
  reason: RendererPluginSuspendReason;
  shouldContinue(): boolean;
}): Promise<void> {
  const {
    dispose,
    mainAuthorization,
    onDisposeFailed,
    onDisposed,
    pluginId,
    reason,
    shouldContinue,
  } = input;
  if (!shouldContinue()) return;

  let lease: LifecycleDisposalLease | null = null;
  if (reason === "runtime-refresh" && mainAuthorization) {
    const preparedDisable =
      await pluginLifecycleBarriers.consumePreparedOrCommitted(
        pluginId,
        mainAuthorization.reason,
        shouldContinue,
        { retainCommit: true, transitionId: mainAuthorization.transitionId }
      );
    if (preparedDisable) {
      const receipt = pluginLifecycleBarriers.acquireCommittedLease(
        pluginId,
        mainAuthorization.reason,
        mainAuthorization.transitionId
      );
      if (!receipt) return;
      lease = {
        reason: mainAuthorization.reason,
        receipt,
        source: "main",
      };
    } else if (!shouldContinue()) return;
  }
  if (!lease) {
    if (!shouldContinue()) return;
    const committed = await pluginLifecycleBarriers.runGuarded(
      pluginId,
      reason,
      shouldContinue,
      { retainCommit: true }
    );
    if (!committed) return;
    lease = {
      reason,
      receipt: pluginLifecycleBarriers.acquireCommittedLease(pluginId, reason),
      source: "local",
    };
  }
  if (!lease) return;
  if (lease.source === "local" && !shouldContinue()) {
    if (lease.receipt) {
      await pluginLifecycleBarriers.finalize(
        lease.receipt.transitionId,
        "abort"
      );
    }
    return;
  }
  if (lease.receipt && !lease.receipt.isCurrent()) return;
  try {
    dispose();
  } catch (error) {
    onDisposeFailed?.();
    console.error("[renderer-plugin-runtime] dispose failed:", error);
    clearHostGroupContentForPlugin(pluginId);
    closeOverlaysForPlugin(pluginId);
    throw error;
  }
  pluginLifecycleBarriers.consumeCommitted(
    pluginId,
    lease.reason,
    lease.receipt?.transitionId
  );
  onDisposed();
  pluginLifecycleBarriers.clear(pluginId);
  clearHostGroupContentForPlugin(pluginId);
  closeOverlaysForPlugin(pluginId);
}
