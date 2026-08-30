import type {
  PanelTransferPlacement,
  PanelTransferRelocateTarget,
  PanelTransferResult,
} from "@shared/contracts/panel-transfer.ts";
import { panelTransferPlacementSchema } from "@shared/contracts/panel-transfer.ts";
import { panelTransferFailure, samePanelTransferCaller } from "./helpers.ts";
import type { PanelTransferRendererPort } from "./renderer-port.ts";
import type {
  PanelTransferCaller,
  PanelTransferTargetRef,
  PanelTransferWindowPort,
} from "./types.ts";
import { PANEL_TRANSFER_FINISH_OFFER_WAIT_MS } from "./types.ts";

/**
 * Minimal offer surface for intentional relocate. Service `LiveOffer` is
 * structurally compatible; keep this narrow so relocate stays free of the
 * full offer lifecycle type.
 */
export interface RelocateLiveOffer {
  capability: "movable" | "unsupported";
  offer: {
    capability: "movable" | "unsupported";
    mode?: "move" | "copy" | undefined;
  };
  source: PanelTransferCaller;
  transferId: string;
  unsupported?: true | undefined;
}

export interface RelocateContext {
  getOffer(transferId: string): RelocateLiveOffer | undefined;
  pruneTombstones(): void;
  /**
   * Ask the target renderer for default intentional placement (active group
   * end tab). Optional so unit tests can inject a fixed placement.
   */
  resolveDefaultPlacement?(windowId: string): Promise<PanelTransferPlacement>;
  tryClaim(
    live: RelocateLiveOffer,
    target: PanelTransferTargetRef,
    placement: PanelTransferPlacement,
    options?: { focusOnCommit?: boolean }
  ): Promise<PanelTransferResult> | PanelTransferResult;
  waitForOffer(
    transferId: string,
    timeoutMs: number
  ): Promise<RelocateLiveOffer | null>;
  windows: PanelTransferWindowPort;
}

export function createResolveDefaultPlacement(
  renderer: Pick<PanelTransferRendererPort, "resolveDefaultPlacement">
): (windowId: string) => Promise<PanelTransferPlacement> {
  return async (windowId) => {
    try {
      const result = await renderer.resolveDefaultPlacement({ windowId });
      if (!result.ok) {
        return { kind: "root" };
      }
      const parsed = panelTransferPlacementSchema.safeParse(result.data);
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      // Target unavailable — fall back to root.
    }
    return { kind: "root" };
  };
}

export async function relocatePanelTransfer(
  ctx: RelocateContext,
  caller: PanelTransferCaller,
  input: {
    placement?: PanelTransferPlacement;
    target: PanelTransferRelocateTarget;
    transferId: string;
  }
): Promise<PanelTransferResult> {
  ctx.pruneTombstones();

  let live = ctx.getOffer(input.transferId);
  if (!live) {
    live =
      (await ctx.waitForOffer(
        input.transferId,
        PANEL_TRANSFER_FINISH_OFFER_WAIT_MS
      )) ?? undefined;
  }
  if (!live) {
    return panelTransferFailure("expired", "offer not found");
  }
  if (
    !samePanelTransferCaller(live.source, caller) &&
    live.source.runtimeWindowId !== caller.runtimeWindowId
  ) {
    return panelTransferFailure(
      "invalid_offer",
      "relocate requires source window"
    );
  }
  if (live.unsupported || live.capability === "unsupported") {
    return panelTransferFailure(
      "not_supported",
      "panel transfer not supported"
    );
  }
  if (live.offer.capability !== "movable") {
    return panelTransferFailure(
      "not_supported",
      "panel transfer not supported"
    );
  }

  const target = input.target;
  if (target.kind === "new-window") {
    return await ctx.tryClaim(
      live,
      {
        kind: "internal",
        runtimeWindowId: `pending:${live.transferId}`,
        windowRecordId: `pending:${live.transferId}`,
      },
      input.placement ?? { kind: "root" },
      // Menu-initiated relocate: raise the new window once it commits
      // (it is created showInactive + show-held, so nothing else focuses it).
      { focusOnCommit: true }
    );
  }

  if (target.windowId === caller.runtimeWindowId) {
    return panelTransferFailure(
      "invalid_offer",
      "relocate target must be a different window"
    );
  }
  const listed = ctx.windows.list();
  const found = listed.find((window) => window.id === target.windowId);
  if (!found) {
    return panelTransferFailure(
      "target_unavailable",
      "target window not found"
    );
  }

  let placement = input.placement;
  if (!placement) {
    placement = ctx.resolveDefaultPlacement
      ? await ctx.resolveDefaultPlacement(found.id)
      : { kind: "root" };
  }

  return await ctx.tryClaim(
    live,
    {
      kind: "managed",
      runtimeWindowId: found.id,
      windowRecordId: found.recordId,
    },
    placement,
    { focusOnCommit: true }
  );
}
