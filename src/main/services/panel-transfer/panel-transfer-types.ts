import type {
  PanelTransferBootstrapState,
  PanelTransferOffer,
  PanelTransferPhase,
  PanelTransferPlacement,
  PanelTransferPreparedSource,
  PanelTransferResult,
  PanelTransferSourceSnapshot,
} from "@shared/contracts/panel-transfer.ts";
import type { WindowBounds } from "../../windows/window-manager.ts";
import type { WindowTransitionLease } from "../window-service.ts";

export interface PanelTransferCaller {
  navigationGeneration: number;
  runtimeWindowId: string;
  webContentsId: number;
  windowRecordId: string;
}

export type PanelTransferTargetKind = "internal" | "managed";

export interface PanelTransferTargetRef {
  kind: PanelTransferTargetKind;
  runtimeWindowId: string;
  windowRecordId: string;
}

export interface PanelTransferJournalRecord {
  createdAt: number;
  offer: Extract<PanelTransferOffer, { capability: "movable" }>;
  phase: PanelTransferPhase;
  placement?: PanelTransferPlacement;
  snapshot?: PanelTransferSourceSnapshot;
  source: PanelTransferCaller;
  target?: PanelTransferTargetRef;
  targetPanelId?: string;
  transferId: string;
  updatedAt: number;
}

export interface PanelTransferJournalFile {
  transfers: PanelTransferJournalRecord[];
  version: 1;
}

export interface PanelTransferTombstone {
  expiresAt: number;
  result: PanelTransferResult;
  transferId: string;
}

export interface PanelTransferSideEffectKey {
  phase: PanelTransferPhase;
  transferId: string;
}

export function sideEffectKey(
  transferId: string,
  phase: PanelTransferPhase
): string {
  return `${transferId}:${phase}`;
}

/** Files draft stage/copy port — Task 5 fills production. */
export interface PanelTransferFilesPort {
  commitDrafts(input: {
    drafts: PanelTransferPreparedSource["drafts"];
    transferId: string;
  }): Promise<void>;
  rollbackDrafts(input: {
    drafts: PanelTransferPreparedSource["drafts"];
    transferId: string;
  }): Promise<void>;
  stageDrafts(input: {
    drafts: PanelTransferPreparedSource["drafts"];
    transferId: string;
  }): Promise<void>;
}

/** Terminal ownership move port — Task 6 fills production. */
export interface PanelTransferTerminalPort {
  commitMove(input: {
    lifecycleId: string;
    panelId: string;
    sourceWindowId: string;
    targetWindowId: string;
    transferId: string;
  }): Promise<void>;
  rollback(input: { transferId: string }): Promise<void>;
  stageLease(input: {
    lifecycleId: string;
    panelId: string;
    sourceWindowId: string;
    targetWindowId: string;
    transferId: string;
  }): Promise<void>;
}

export interface PanelTransferWorkspacePort {
  clearLayout(recordId: string): Promise<void>;
  /** True when target already has a panel with this stable id. */
  hasPanelId(input: {
    panelId: string;
    windowRecordId: string;
  }): Promise<boolean>;
}

export interface PanelTransferGeometryPort {
  getCursorScreenPoint(): { x: number; y: number };
  getDisplayWorkAreaNear(point: { x: number; y: number }): {
    height: number;
    width: number;
    x: number;
    y: number;
  };
  getWindowBounds(windowId: string): WindowBounds | null;
}

export interface PanelTransferWindowPort {
  closeAfterTransfer(
    lease: WindowTransitionLease,
    windowId: string,
    transferId: string
  ): Promise<void>;
  createForTransfer(
    lease: WindowTransitionLease,
    input: { bounds: WindowBounds; transferId: string }
  ): Promise<{ recordId: string; windowId: string }>;
  destroyForTransfer(
    lease: WindowTransitionLease,
    windowId: string,
    transferId: string
  ): Promise<void>;
  holdRendererShow(windowId: string, reason: string): void;
  list(): Array<{
    focused: boolean;
    id: string;
    recordId: string;
  }>;
  releaseRendererShow(windowId: string, reason: string): void;
  runExclusive<T>(
    operation: (lease: WindowTransitionLease) => Promise<T>
  ): Promise<T>;
}

export interface PanelTransferService {
  bootstrap(caller: PanelTransferCaller): Promise<PanelTransferBootstrapState>;
  cancel(caller: PanelTransferCaller, transferId: string): Promise<void>;
  drop(
    caller: PanelTransferCaller,
    input: { placement: PanelTransferPlacement; transferId: string }
  ): Promise<PanelTransferResult>;
  finishDrag(
    caller: PanelTransferCaller,
    transferId: string
  ): Promise<PanelTransferResult | null>;
  flushJournal(): Promise<void>;
  offer(
    caller: PanelTransferCaller,
    offer: PanelTransferOffer
  ): Promise<{ accepted: boolean }>;
  ready(
    caller: PanelTransferCaller,
    transferId: string
  ): Promise<PanelTransferResult | null>;
  recoverPending(): Promise<void>;
  settleWindowBeforeClose(
    lease: WindowTransitionLease,
    windowId: string,
    reason: "app-quit" | "window-close"
  ): Promise<void>;
  signalWindowClosing(
    windowId: string,
    reason: "app-quit" | "window-close"
  ): void;
}

export const PANEL_TRANSFER_OFFER_TTL_MS = 120_000;
export const PANEL_TRANSFER_DROP_WAIT_MS = 2000;
export const PANEL_TRANSFER_FINISH_DROP_WINDOW_MS = 500;
export const PANEL_TRANSFER_CLAIM_TOTAL_MS = 45_000;
export const PANEL_TRANSFER_TOMBSTONE_TTL_MS = 10 * 60_000;
export const PANEL_TRANSFER_NEW_WINDOW_CURSOR_OFFSET = 48;
export const PANEL_TRANSFER_SHOW_HOLD_REASON = "panel-transfer";
