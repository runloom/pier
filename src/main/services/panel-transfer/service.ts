import type {
  PanelTransferOffer,
  PanelTransferOverlayPreview,
  PanelTransferPlacement,
  PanelTransferResult,
} from "@shared/contracts/panel-transfer.ts";
import { isPanelTransferCopyableComponent } from "@shared/contracts/panel-transfer.ts";
import { PanelTransferJournal } from "../../state/panel-transfer-journal.ts";
import type { RendererCommandService } from "../renderer-command-service.ts";
import { dropPanelTransfer } from "./drop.ts";
import { finishPanelTransferDrag } from "./finish-drag.ts";
import {
  createNoopPanelTransferFilesPort,
  createNoopPanelTransferTerminalPort,
  createPanelTransferRendererPort,
  panelTransferFailure,
  samePanelTransferCaller,
} from "./helpers.ts";
import { createPanelTransferLifecycleMethods } from "./lifecycle.ts";
import { createBoundOverlayPreview } from "./overlay-preview.ts";
import {
  createResolveDefaultPlacement,
  type RelocateLiveOffer,
  relocatePanelTransfer,
} from "./relocate.ts";
import { materializeInternalTransferWindow } from "./speculative-window.ts";
import {
  type PanelTransferTransactionDeps,
  runClaimedTransfer,
} from "./transaction.ts";
import {
  type OverlayPreviewScheduler,
  PANEL_TRANSFER_CLAIM_TOTAL_MS,
  PANEL_TRANSFER_OFFER_TTL_MS,
  PANEL_TRANSFER_TOMBSTONE_TTL_MS,
  type PanelTransferFilesPort,
  type PanelTransferGeometryPort,
  type PanelTransferJournalRecord,
  type PanelTransferLiveOffer,
  type PanelTransferService,
  type PanelTransferTargetRef,
  type PanelTransferTerminalPort,
  type PanelTransferWindowPort,
  type PanelTransferWorkspacePort,
} from "./types.ts";

export {
  createNoopPanelTransferFilesPort,
  createNoopPanelTransferTerminalPort,
} from "./helpers.ts";

type LiveOffer = PanelTransferLiveOffer;

export interface CreatePanelTransferServiceArgs {
  /** Omit in tests that do not exercise overlay so no cursor poll starts. */
  broadcastOverlayPreview?: (preview: PanelTransferOverlayPreview) => void;
  files?: PanelTransferFilesPort;
  geometry: PanelTransferGeometryPort;
  journal?: PanelTransferJournal;
  now?: () => number;
  overlayPreviewSchedule?: OverlayPreviewScheduler;
  pluginMutation: <T>(operation: () => Promise<T>) => Promise<T>;
  rendererCommand: RendererCommandService;
  reportJournalParseFailure?:
    | ((path: string, error: unknown) => void)
    | undefined;
  terminal?: PanelTransferTerminalPort;
  userDataDir: string;
  windows: PanelTransferWindowPort;
  workspace: PanelTransferWorkspacePort;
}

export function createPanelTransferService(
  args: CreatePanelTransferServiceArgs
): PanelTransferService {
  const now = args.now ?? Date.now;
  const journal = args.journal ?? new PanelTransferJournal(args.userDataDir);
  const files = args.files ?? createNoopPanelTransferFilesPort();
  const terminal = args.terminal ?? createNoopPanelTransferTerminalPort();
  const renderer = createPanelTransferRendererPort(args.rendererCommand);
  const { overlayPreview, speculative } = createBoundOverlayPreview({
    geometry: args.geometry,
    windows: args.windows,
    ...(args.broadcastOverlayPreview === undefined
      ? {}
      : { broadcast: args.broadcastOverlayPreview }),
    ...(args.overlayPreviewSchedule === undefined
      ? {}
      : { schedule: args.overlayPreviewSchedule }),
  });
  const deps: PanelTransferTransactionDeps = {
    files,
    journal,
    renderer,
    terminal,
    windows: args.windows,
    workspace: args.workspace,
  };

  const offers = new Map<string, LiveOffer>();
  const offersBySourceWindow = new Map<string, string>();
  const tombstones = new Map<
    string,
    { expiresAt: number; result: PanelTransferResult }
  >();
  const windowAbort = new Map<string, AbortController>();
  const offerWaiters = new Map<
    string,
    Set<(offer: LiveOffer | null) => void>
  >();

  const pruneTombstones = () => {
    const t = now();
    for (const [id, entry] of tombstones) {
      if (entry.expiresAt <= t) tombstones.delete(id);
    }
  };

  const rememberTombstone = (
    transferId: string,
    result: PanelTransferResult
  ) => {
    pruneTombstones();
    tombstones.set(transferId, {
      expiresAt: now() + PANEL_TRANSFER_TOMBSTONE_TTL_MS,
      result,
    });
  };

  const notifyOffer = (transferId: string, offer: LiveOffer | null) => {
    const waiters = offerWaiters.get(transferId);
    if (!waiters) return;
    offerWaiters.delete(transferId);
    for (const waiter of waiters) waiter(offer);
  };

  const waitForOffer = async (
    transferId: string,
    timeoutMs: number
  ): Promise<LiveOffer | null> => {
    const existing = offers.get(transferId);
    if (existing) return existing;
    const { promise, resolve } = Promise.withResolvers<LiveOffer | null>();
    let settled = false;
    const finish = (value: LiveOffer | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let waiters = offerWaiters.get(transferId);
    if (!waiters) {
      waiters = new Set();
      offerWaiters.set(transferId, waiters);
    }
    waiters.add(finish);
    const timer = setTimeout(() => {
      waiters?.delete(finish);
      if (waiters && waiters.size === 0) offerWaiters.delete(transferId);
      finish(offers.get(transferId) ?? null);
    }, timeoutMs);
    try {
      return await promise;
    } finally {
      clearTimeout(timer);
    }
  };

  const clearOffer = (transferId: string) => {
    overlayPreview?.seal(transferId);
    speculative.discard(transferId);
    const live = offers.get(transferId);
    if (!live) return;
    offers.delete(transferId);
    if (offersBySourceWindow.get(live.source.runtimeWindowId) === transferId) {
      offersBySourceWindow.delete(live.source.runtimeWindowId);
    }
    notifyOffer(transferId, null);
  };

  const tryClaim = (
    live: LiveOffer,
    target: PanelTransferTargetRef,
    placement: PanelTransferPlacement,
    options?: { focusOnCommit?: boolean }
  ): Promise<PanelTransferResult> | PanelTransferResult => {
    if (live.unsupported || live.capability === "unsupported") {
      return panelTransferFailure(
        "not_supported",
        "panel transfer not supported"
      );
    }
    if (live.claim) {
      if (
        live.claim.target.runtimeWindowId === target.runtimeWindowId &&
        JSON.stringify(live.claim.placement) === JSON.stringify(placement)
      ) {
        return live.claim.deferred.promise;
      }
      return panelTransferFailure(
        "already_claimed",
        "transfer already claimed"
      );
    }
    if (now() > live.expiresAt) {
      return panelTransferFailure("expired", "offer expired");
    }
    overlayPreview?.seal(live.transferId);
    const deferred = Promise.withResolvers<PanelTransferResult>();
    live.claim = {
      deferred,
      focusOnCommit: options?.focusOnCommit ?? false,
      kind: target.kind,
      placement,
      runnerStarted: false,
      target,
    };
    queueMicrotask(() => {
      startClaimRunner(live).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          "[panelTransfer] claim runner rejected",
          `transferId=${live.transferId}`,
          `panelId=${live.offer.panel.panelId}`,
          `component=${live.offer.panel.componentId}`,
          message
        );
        live.claim?.deferred.resolve(
          panelTransferFailure("transfer_failed", message)
        );
      });
    });
    return deferred.promise;
  };

  const startClaimRunner = async (live: LiveOffer): Promise<void> => {
    const claim = live.claim;
    if (!claim || claim.runnerStarted) return;
    claim.runnerStarted = true;
    const claimAbort = new AbortController();
    const onParentAbort = () => claimAbort.abort(live.abort.signal.reason);
    live.abort.signal.addEventListener("abort", onParentAbort, { once: true });
    const claimTimer = setTimeout(() => {
      claimAbort.abort(new DOMException("claim timed out", "AbortError"));
    }, PANEL_TRANSFER_CLAIM_TOTAL_MS);

    try {
      if (
        claim.kind === "internal" &&
        claim.target.runtimeWindowId.startsWith("pending:")
      ) {
        await speculative.awaitReady(live.transferId);
      }
      const result = await args.pluginMutation(() =>
        args.windows.runExclusive(async (lease) => {
          let target = claim.target;
          const movableOffer = live.offer as Extract<
            PanelTransferOffer,
            { capability: "movable" }
          >;
          const transferMode = movableOffer.mode ?? "move";
          let record: PanelTransferJournalRecord = {
            createdAt: now(),
            offer: movableOffer,
            phase: "claimed",
            placement: claim.placement,
            source: live.source,
            target,
            targetPanelId:
              transferMode === "copy"
                ? crypto.randomUUID()
                : movableOffer.panel.panelId,
            transferId: live.transferId,
            updatedAt: now(),
          };

          if (
            claim.kind === "internal" &&
            target.runtimeWindowId.startsWith("pending:")
          ) {
            const created = await materializeInternalTransferWindow({
              geometry: args.geometry,
              lease,
              sourceWindowId: live.source.runtimeWindowId,
              speculative,
              transferId: live.transferId,
              windows: args.windows,
            });
            target = {
              kind: "internal",
              runtimeWindowId: created.windowId,
              windowRecordId: created.recordId,
            };
            claim.target = target;
            record = { ...record, target };
          }

          return await runClaimedTransfer({
            abortSignal: claimAbort.signal,
            deps,
            lease,
            placement: claim.placement,
            record,
            source: live.source,
            target,
          });
        })
      );
      // Menu relocate: focus after commit. Drag-created windows already
      // revealHost'd; do not steal focus from a managed drop target.
      if (result.ok && claim.focusOnCommit && claim.kind !== "internal") {
        try {
          args.windows.focus(claim.target.runtimeWindowId);
        } catch (focusError) {
          console.error(
            "[panelTransfer] focus target failed",
            `transferId=${live.transferId}`,
            `target=${claim.target.runtimeWindowId}`,
            focusError instanceof Error
              ? focusError.message
              : String(focusError)
          );
        }
      }
      rememberTombstone(live.transferId, result);
      claim.deferred.resolve(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        "[panelTransfer] claim failed",
        `transferId=${live.transferId}`,
        `panelId=${live.offer.panel.panelId}`,
        `component=${live.offer.panel.componentId}`,
        `targetKind=${claim.kind}`,
        message
      );
      const result = panelTransferFailure("transfer_failed", message);
      rememberTombstone(live.transferId, result);
      claim.deferred.resolve(result);
    } finally {
      clearTimeout(claimTimer);
      live.abort.signal.removeEventListener("abort", onParentAbort);
      clearOffer(live.transferId);
    }
  };

  const lifecycle = createPanelTransferLifecycleMethods({
    clearOffer,
    deps,
    journal,
    offers,
    pluginMutation: args.pluginMutation,
    pruneTombstones,
    rememberTombstone,
    reportJournalParseFailure: args.reportJournalParseFailure,
    tombstones,
    windowAbort,
    windows: args.windows,
  });

  const service: PanelTransferService = {
    ...lifecycle,

    async offer(caller, offer) {
      pruneTombstones();
      const existingId = offersBySourceWindow.get(caller.runtimeWindowId);
      if (existingId && existingId !== offer.transferId) {
        await service.cancel(caller, existingId);
      }
      const existing = offers.get(offer.transferId);
      if (existing) {
        if (!samePanelTransferCaller(existing.source, caller)) {
          return { accepted: false };
        }
        return { accepted: existing.accepted };
      }
      const tombstone = tombstones.get(offer.transferId);
      if (tombstone) return { accepted: tombstone.result.ok };

      // Copy is files-only; reject early so callers never claim a non-copyable
      // offer. Move remains the default for all movable components.
      if (
        offer.capability === "movable" &&
        offer.mode === "copy" &&
        !isPanelTransferCopyableComponent(offer.panel.componentId)
      ) {
        return { accepted: false };
      }

      const live: LiveOffer = {
        abort: new AbortController(),
        accepted: offer.capability === "movable",
        capability: offer.capability,
        expiresAt: now() + PANEL_TRANSFER_OFFER_TTL_MS,
        offer,
        source: caller,
        transferId: offer.transferId,
        ...(offer.capability === "unsupported"
          ? { unsupported: true as const }
          : {}),
      };
      offers.set(offer.transferId, live);
      offersBySourceWindow.set(caller.runtimeWindowId, offer.transferId);
      notifyOffer(offer.transferId, live);
      overlayPreview?.start(offer.transferId, caller.runtimeWindowId);
      setTimeout(() => {
        const current = offers.get(offer.transferId);
        if (current === live && !current.claim) {
          if (offer.capability === "movable") {
            live.abort.abort(new DOMException("offer expired", "AbortError"));
          }
          clearOffer(offer.transferId);
        }
      }, PANEL_TRANSFER_OFFER_TTL_MS).unref?.();
      return { accepted: live.accepted };
    },

    async drop(caller, input) {
      overlayPreview?.seal(input.transferId);
      return await dropPanelTransfer(
        {
          geometry: args.geometry,
          getOffer: (id) => offers.get(id),
          getTombstone: (id) => tombstones.get(id)?.result,
          pruneTombstones,
          renderer,
          speculative,
          tryClaim,
          waitForOffer,
          windows: args.windows,
        },
        caller,
        input
      );
    },

    async finishDrag(caller, transferId) {
      overlayPreview?.seal(transferId);
      const tombstone = tombstones.get(transferId);
      if (tombstone) {
        return tombstone.result;
      }
      return await finishPanelTransferDrag(
        {
          clearOffer,
          geometry: args.geometry,
          getOffer: (id) => offers.get(id),
          ignoreWindowIds: () => speculative.hiddenIds(),
          pruneTombstones,
          rememberTombstone,
          renderer,
          tryClaim,
          waitForOffer,
          windows: args.windows,
        },
        caller,
        transferId
      );
    },

    async relocate(caller, input) {
      const tombstone = tombstones.get(input.transferId);
      if (tombstone) {
        return tombstone.result;
      }
      return await relocatePanelTransfer(
        {
          getOffer: (id) => offers.get(id) as RelocateLiveOffer | undefined,
          pruneTombstones,
          resolveDefaultPlacement: createResolveDefaultPlacement(renderer),
          tryClaim: (live, target, placement, options) =>
            tryClaim(live as LiveOffer, target, placement, options),
          waitForOffer: async (id, timeoutMs) =>
            (await waitForOffer(id, timeoutMs)) as RelocateLiveOffer | null,
          windows: args.windows,
        },
        caller,
        input
      );
    },
  };

  return service;
}
