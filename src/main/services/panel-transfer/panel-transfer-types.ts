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
  placement?: PanelTransferPlacement | undefined;
  snapshot?: PanelTransferSourceSnapshot | undefined;
  source: PanelTransferCaller;
  target?: PanelTransferTargetRef | undefined;
  targetPanelId?: string | undefined;
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
    drafts: NonNullable<PanelTransferPreparedSource["drafts"]>;
    sourceOwner: string;
    targetOwner: string;
    transferId: string;
  }): Promise<void>;
  rollbackDrafts(input: {
    drafts: NonNullable<PanelTransferPreparedSource["drafts"]>;
    sourceOwner: string;
    targetOwner: string;
    transferId: string;
  }): Promise<void>;
  stageDrafts(input: {
    drafts: NonNullable<PanelTransferPreparedSource["drafts"]>;
    sourceOwner: string;
    targetOwner: string;
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
  /**
   * Canonical current lifecycle for a terminal panel (task run id; shells
   * return ""). Main fills the transfer snapshot from here — renderers never
   * forge lifecycle identity.
   */
  getCurrentLifecycleId(input: {
    panelId: string;
    sourceWindowId: string;
  }): string;
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
  /**
   * Content area in screen DIP coordinates (excludes title bar / traffic
   * lights). Used to convert screen cursor → renderer clientX/clientY for
   * resolvePlacement. Falls back to outer bounds when unavailable.
   */
  getWindowContentBounds(windowId: string): WindowBounds | null;
  /**
   * Runtime window ids in true z-order (front → back), or null when the
   * platform cannot report it. Overlapping windows resolve cursor hits by
   * what the user visually sees on top.
   */
  getWindowZOrderTopFirst(): string[] | null;
  /**
   * True while the primary mouse button is pressed. Used by finishDrag to
   * distinguish Escape/system cancel from a real release. When unavailable
   * (non-macOS / addon missing), callers treat as released.
   */
  isLeftMouseButtonDown(): boolean;
}

export interface PanelTransferWindowPort {
  closeAfterTransfer(
    lease: WindowTransitionLease,
    windowId: string,
    transferId: string
  ): Promise<void>;
  /**
   * Cold-path open-record cleanup when an internal transfer target was
   * markWindowRecordOpen'd but no live BaseWindow/lease remains (e.g.
   * recoverPending pre-commit abort). Must flush durable open-window state.
   */
  closeOpenWindowRecord(recordId: string): Promise<void>;
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
    /** Monotonic focus sequence — higher means more recently focused. */
    lastFocusedAt?: number | undefined;
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
/** Max wait for a late offer registration when drop/finishDrag races offer IPC. */
export const PANEL_TRANSFER_DROP_WAIT_MS = 2000;
/** finishDrag waits this long for the async offer() IPC to land. */
export const PANEL_TRANSFER_FINISH_OFFER_WAIT_MS = 1000;
/** Wait for a newly created transfer target's Dockview api before stageTarget. */
export const PANEL_TRANSFER_TARGET_READY_WAIT_MS = 20_000;
export const PANEL_TRANSFER_TARGET_READY_POLL_MS = 50;
export const PANEL_TRANSFER_PROBE_TIMEOUT_MS = 500;
export const PANEL_TRANSFER_CLAIM_TOTAL_MS = 45_000;
export const PANEL_TRANSFER_TOMBSTONE_TTL_MS = 10 * 60_000;
export const PANEL_TRANSFER_NEW_WINDOW_CURSOR_OFFSET = 48;
export const PANEL_TRANSFER_SHOW_HOLD_REASON = "panel-transfer";
