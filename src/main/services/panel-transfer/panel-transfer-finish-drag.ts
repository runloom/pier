import type {
  PanelTransferPlacement,
  PanelTransferResult,
} from "@shared/contracts/panel-transfer.ts";
import { panelTransferPlacementSchema } from "@shared/contracts/panel-transfer.ts";
import {
  classifyTransferCursor,
  type createPanelTransferRendererPort,
  panelTransferFailure,
  samePanelTransferCaller,
} from "./panel-transfer-helpers.ts";
import type {
  PanelTransferCaller,
  PanelTransferGeometryPort,
  PanelTransferTargetRef,
  PanelTransferWindowPort,
} from "./panel-transfer-types.ts";
import { PANEL_TRANSFER_FINISH_OFFER_WAIT_MS } from "./panel-transfer-types.ts";

export interface FinishDragLiveOffer {
  abort: AbortController;
  capability: "movable" | "unsupported";
  claim?: {
    deferred: PromiseWithResolvers<PanelTransferResult>;
    kind: "internal" | "managed";
    placement: PanelTransferPlacement;
    target: PanelTransferTargetRef;
  };
  source: PanelTransferCaller;
  transferId: string;
  unsupported?: true;
}

export interface FinishDragContext {
  clearOffer(transferId: string): void;
  geometry: PanelTransferGeometryPort;
  getOffer(transferId: string): FinishDragLiveOffer | undefined;
  pruneTombstones(): void;
  rememberTombstone(transferId: string, result: PanelTransferResult): void;
  renderer: ReturnType<typeof createPanelTransferRendererPort>;
  tryClaim(
    live: FinishDragLiveOffer,
    target: PanelTransferTargetRef,
    placement: PanelTransferPlacement
  ): Promise<PanelTransferResult> | PanelTransferResult;
  waitForOffer(
    transferId: string,
    timeoutMs: number
  ): Promise<FinishDragLiveOffer | null>;
  windows: PanelTransferWindowPort;
}

/**
 * Peer channel (HTML5 drop ↔ finishDrag) may win the race. `already_claimed`
 * means the transfer is already running — silent for the losing caller.
 */
async function claimOrJoinPeer(
  result: Promise<PanelTransferResult> | PanelTransferResult
): Promise<PanelTransferResult | null> {
  const resolved = await result;
  if (!resolved.ok && resolved.code === "already_claimed") {
    return null;
  }
  return resolved;
}

async function resolveManagedPlacement(
  renderer: ReturnType<typeof createPanelTransferRendererPort>,
  geometry: PanelTransferGeometryPort,
  transferId: string,
  targetWindowId: string
): Promise<PanelTransferPlacement> {
  const cursor = geometry.getCursorScreenPoint();
  const contentBounds =
    geometry.getWindowContentBounds(targetWindowId) ??
    geometry.getWindowBounds(targetWindowId);
  if (!contentBounds) {
    return { kind: "root" };
  }
  const originX = contentBounds.x ?? 0;
  const originY = contentBounds.y ?? 0;
  const clientX = cursor.x - originX;
  const clientY = cursor.y - originY;
  try {
    const result = await renderer.resolvePlacement({
      clientX,
      clientY,
      transferId,
      windowId: targetWindowId,
    });
    if (!result.ok) {
      return { kind: "root" };
    }
    const parsed = panelTransferPlacementSchema.safeParse(result.data);
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // Target renderer unavailable — fall back to root placement.
  }
  return { kind: "root" };
}

export async function finishPanelTransferDrag(
  ctx: FinishDragContext,
  caller: PanelTransferCaller,
  transferId: string
): Promise<PanelTransferResult | null> {
  ctx.pruneTombstones();

  let live = ctx.getOffer(transferId);
  if (!live) {
    live =
      (await ctx.waitForOffer(
        transferId,
        PANEL_TRANSFER_FINISH_OFFER_WAIT_MS
      )) ?? undefined;
  }
  if (!live) {
    // Offer never registered (e.g. rejected by schema). Same-window
    // releases stay silent; only a real cross-window attempt reports.
    const missedClassification = classifyTransferCursor(
      ctx.geometry,
      ctx.windows,
      caller.runtimeWindowId
    );
    if (missedClassification.kind === "source") {
      return null;
    }
    return panelTransferFailure("expired", "offer not found");
  }
  if (
    !samePanelTransferCaller(live.source, caller) &&
    live.source.runtimeWindowId !== caller.runtimeWindowId
  ) {
    return panelTransferFailure(
      "invalid_offer",
      "finishDrag requires source window"
    );
  }
  // Path B: Escape/system cancel keeps the primary button pressed through
  // dragend; a real release reports button-up. Query before classifying.
  if (ctx.geometry.isLeftMouseButtonDown()) {
    live.abort.abort(
      new DOMException("drag cancelled (button still down)", "AbortError")
    );
    ctx.clearOffer(transferId);
    return null;
  }

  if (live.claim) {
    if (live.claim.kind === "managed") {
      return null;
    }
    return await live.claim.deferred.promise;
  }

  const classification = classifyTransferCursor(
    ctx.geometry,
    ctx.windows,
    live.source.runtimeWindowId
  );
  if (classification.kind === "source") {
    // Same-window release: Dockview already handled reorder/split. Silent
    // for both movable and unsupported panels — no cross-window attempt.
    live.abort.abort(new DOMException("same-window abort", "AbortError"));
    ctx.clearOffer(transferId);
    return null;
  }

  if (live.unsupported || live.capability === "unsupported") {
    // Only a genuine cross-window attempt (managed / outside) surfaces
    // the "can't move this tab" feedback.
    ctx.clearOffer(transferId);
    const result = panelTransferFailure(
      "not_supported",
      "panel transfer not supported"
    );
    ctx.rememberTombstone(transferId, result);
    return result;
  }

  if (classification.kind === "managed") {
    const placement = await resolveManagedPlacement(
      ctx.renderer,
      ctx.geometry,
      live.transferId,
      classification.windowId
    );
    // HTML5 drop may claim during the placement await; join silently.
    // 经宽化引用重读：上方 151 行的检查已把 live.claim 窄化为 undefined，
    // 而 claim 是 await 期间由外部写入同一对象的。
    const liveAfterPlacement: FinishDragLiveOffer = live;
    if (liveAfterPlacement.claim) {
      if (liveAfterPlacement.claim.kind === "managed") {
        return null;
      }
      return await liveAfterPlacement.claim.deferred.promise;
    }
    return await claimOrJoinPeer(
      ctx.tryClaim(
        live,
        {
          kind: "managed",
          runtimeWindowId: classification.windowId,
          windowRecordId: classification.recordId,
        },
        placement
      )
    );
  }

  return await claimOrJoinPeer(
    ctx.tryClaim(
      live,
      {
        kind: "internal",
        runtimeWindowId: `pending:${transferId}`,
        windowRecordId: `pending:${transferId}`,
      },
      { kind: "root" }
    )
  );
}
