import type {
  PanelTransferPlacement,
  PanelTransferResult,
} from "@shared/contracts/panel-transfer.ts";
import { resolveManagedPlacement } from "./finish-drag.ts";
import {
  classifyTransferCursor,
  type createPanelTransferRendererPort,
  panelTransferFailure,
} from "./helpers.ts";
import type { SpeculativeTransferWindow } from "./speculative-window.ts";
import type {
  PanelTransferCaller,
  PanelTransferGeometryPort,
  PanelTransferLiveOffer,
  PanelTransferTargetRef,
  PanelTransferWindowPort,
} from "./types.ts";
import { PANEL_TRANSFER_DROP_WAIT_MS } from "./types.ts";

export interface DropPanelTransferContext {
  geometry: PanelTransferGeometryPort;
  getOffer(transferId: string): PanelTransferLiveOffer | undefined;
  getTombstone(transferId: string): PanelTransferResult | undefined;
  pruneTombstones(): void;
  renderer: ReturnType<typeof createPanelTransferRendererPort>;
  speculative: SpeculativeTransferWindow;
  tryClaim(
    live: PanelTransferLiveOffer,
    target: PanelTransferTargetRef,
    placement: PanelTransferPlacement
  ): Promise<PanelTransferResult> | PanelTransferResult;
  waitForOffer(
    transferId: string,
    timeoutMs: number
  ): Promise<PanelTransferLiveOffer | null>;
  windows: PanelTransferWindowPort;
}

export async function dropPanelTransfer(
  ctx: DropPanelTransferContext,
  caller: PanelTransferCaller,
  input: { placement: PanelTransferPlacement; transferId: string }
): Promise<PanelTransferResult> {
  ctx.pruneTombstones();
  const tombstone = ctx.getTombstone(input.transferId);
  if (tombstone) {
    return tombstone;
  }
  let live = ctx.getOffer(input.transferId);
  if (!live) {
    live =
      (await ctx.waitForOffer(input.transferId, PANEL_TRANSFER_DROP_WAIT_MS)) ??
      undefined;
  }
  if (!live) {
    return panelTransferFailure("expired", "offer not found");
  }
  if (live.source.runtimeWindowId === caller.runtimeWindowId) {
    return panelTransferFailure(
      "invalid_offer",
      "drop must target a different window"
    );
  }
  if (live.unsupported || live.capability === "unsupported") {
    return panelTransferFailure(
      "not_supported",
      "panel transfer not supported"
    );
  }
  // Warm tear-off windows sit under the cursor (often on another
  // display). HTML5 drop would otherwise claim them as managed and
  // skip revealHost. If classification (ignoring the ghost) hits a
  // real user window, claim that window's Path B placement instead
  // of forcing a root tear-off.
  if (ctx.speculative.hiddenIds().has(caller.runtimeWindowId)) {
    const classification = classifyTransferCursor(
      ctx.geometry,
      ctx.windows,
      live.source.runtimeWindowId,
      ctx.speculative.hiddenIds()
    );
    if (
      classification.kind === "managed" &&
      classification.windowId !== caller.runtimeWindowId
    ) {
      const placement = await resolveManagedPlacement(
        ctx.renderer,
        ctx.geometry,
        live.transferId,
        classification.windowId
      );
      return await ctx.tryClaim(
        live,
        {
          kind: "managed",
          runtimeWindowId: classification.windowId,
          windowRecordId: classification.recordId,
        },
        placement
      );
    }
    if (classification.kind === "source") {
      // Ghost covered the source; finishDrag owns same-window abort.
      return panelTransferFailure(
        "already_claimed",
        "transfer already claimed"
      );
    }
    return await ctx.tryClaim(
      live,
      {
        kind: "internal",
        runtimeWindowId: `pending:${live.transferId}`,
        windowRecordId: `pending:${live.transferId}`,
      },
      { kind: "root" }
    );
  }
  return await ctx.tryClaim(
    live,
    {
      kind: "managed",
      runtimeWindowId: caller.runtimeWindowId,
      windowRecordId: caller.windowRecordId,
    },
    input.placement
  );
}
