import type {
  PanelTransferOffer,
  PanelTransferPlacement,
  PanelTransferResult,
} from "@shared/contracts/panel-transfer.ts";
import { PanelTransferJournal } from "../../state/panel-transfer-journal.ts";
import type { RendererCommandService } from "../renderer-command-service.ts";
import { finishPanelTransferDrag } from "./panel-transfer-finish-drag.ts";
import {
  computeTransferNewWindowBounds,
  createNoopPanelTransferFilesPort,
  createNoopPanelTransferTerminalPort,
  createPanelTransferRendererPort,
  panelTransferFailure,
  samePanelTransferCaller,
} from "./panel-transfer-helpers.ts";
import { createPanelTransferLifecycleMethods } from "./panel-transfer-lifecycle.ts";
import {
  type PanelTransferTransactionDeps,
  runClaimedTransfer,
} from "./panel-transfer-transaction.ts";
import {
  PANEL_TRANSFER_CLAIM_TOTAL_MS,
  PANEL_TRANSFER_DROP_WAIT_MS,
  PANEL_TRANSFER_OFFER_TTL_MS,
  PANEL_TRANSFER_SHOW_HOLD_REASON,
  PANEL_TRANSFER_TOMBSTONE_TTL_MS,
  type PanelTransferCaller,
  type PanelTransferFilesPort,
  type PanelTransferGeometryPort,
  type PanelTransferJournalRecord,
  type PanelTransferService,
  type PanelTransferTargetRef,
  type PanelTransferTerminalPort,
  type PanelTransferWindowPort,
  type PanelTransferWorkspacePort,
} from "./panel-transfer-types.ts";

export {
  createNoopPanelTransferFilesPort,
  createNoopPanelTransferTerminalPort,
} from "./panel-transfer-helpers.ts";

interface LiveOffer {
  abort: AbortController;
  accepted: boolean;
  capability: PanelTransferOffer["capability"];
  claim?: {
    deferred: PromiseWithResolvers<PanelTransferResult>;
    kind: "internal" | "managed";
    placement: PanelTransferPlacement;
    runnerStarted: boolean;
    target: PanelTransferTargetRef;
  };
  expiresAt: number;
  offer: PanelTransferOffer;
  source: PanelTransferCaller;
  transferId: string;
  unsupported?: true;
}

export interface CreatePanelTransferServiceArgs {
  files?: PanelTransferFilesPort;
  geometry: PanelTransferGeometryPort;
  journal?: PanelTransferJournal;
  now?: () => number;
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
    placement: PanelTransferPlacement
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
    const deferred = Promise.withResolvers<PanelTransferResult>();
    live.claim = {
      deferred,
      kind: target.kind,
      placement,
      runnerStarted: false,
      target,
    };
    queueMicrotask(() => {
      startClaimRunner(live).catch((error: unknown) => {
        live.claim?.deferred.resolve(
          panelTransferFailure(
            "transfer_failed",
            error instanceof Error ? error.message : String(error)
          )
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
      const result = await args.pluginMutation(() =>
        args.windows.runExclusive(async (lease) => {
          let target = claim.target;
          let record: PanelTransferJournalRecord = {
            createdAt: now(),
            offer: live.offer as Extract<
              PanelTransferOffer,
              { capability: "movable" }
            >,
            phase: "claimed",
            placement: claim.placement,
            source: live.source,
            target,
            targetPanelId: live.offer.panel.panelId,
            transferId: live.transferId,
            updatedAt: now(),
          };

          if (
            claim.kind === "internal" &&
            target.runtimeWindowId.startsWith("pending:")
          ) {
            const bounds = computeTransferNewWindowBounds(
              args.geometry,
              live.source.runtimeWindowId
            );
            const created = await args.windows.createForTransfer(lease, {
              bounds,
              transferId: live.transferId,
            });
            target = {
              kind: "internal",
              runtimeWindowId: created.windowId,
              windowRecordId: created.recordId,
            };
            claim.target = target;
            record = { ...record, target };
            args.windows.holdRendererShow(
              created.windowId,
              PANEL_TRANSFER_SHOW_HOLD_REASON
            );
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
      rememberTombstone(live.transferId, result);
      claim.deferred.resolve(result);
    } catch (error) {
      const result = panelTransferFailure(
        "transfer_failed",
        error instanceof Error ? error.message : String(error)
      );
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
      pruneTombstones();
      const tombstone = tombstones.get(input.transferId);
      if (tombstone) return tombstone.result;
      let live = offers.get(input.transferId);
      if (!live) {
        live =
          (await waitForOffer(input.transferId, PANEL_TRANSFER_DROP_WAIT_MS)) ??
          undefined;
      }
      if (!live) return panelTransferFailure("expired", "offer not found");
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
      return await tryClaim(
        live,
        {
          kind: "managed",
          runtimeWindowId: caller.runtimeWindowId,
          windowRecordId: caller.windowRecordId,
        },
        input.placement
      );
    },

    async finishDrag(caller, transferId) {
      const tombstone = tombstones.get(transferId);
      if (tombstone) {
        return tombstone.result;
      }
      return await finishPanelTransferDrag(
        {
          clearOffer,
          geometry: args.geometry,
          getOffer: (id) => offers.get(id),
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
  };

  return service;
}
