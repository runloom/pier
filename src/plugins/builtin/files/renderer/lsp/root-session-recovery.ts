import type { LspSessionClosedEvent } from "@shared/contracts/lsp.ts";
import type { FilesLanguageServiceStatus } from "../panel/language-service-status.ts";
import {
  disabledFilesLspStatus,
  type FilesLspRootAttachment,
  lspReconnectAttempt,
  type RecoveryReason,
  type RootGeneration,
  type RootSessionInput,
} from "./root-recovery-types.ts";
import type { LspFacade } from "./session-coordinator.ts";

export interface RootRecoveryHost {
  adoptEnsured(
    ensured: import("@shared/contracts/lsp.ts").LspSessionEnsureSuccess,
    epoch: number,
    recovering: boolean
  ): Promise<boolean>;
  readonly attachments: Set<FilesLspRootAttachment>;
  cancelStableResetTimer(): void;
  closeStaleSession(sessionId: string): void;
  disposeCurrent(closeSession: boolean): void;
  readonly facade: LspFacade;
  getCurrent(): RootGeneration | null;
  getOperationEpoch(): number;
  getPolicyObserved(): boolean;
  getPolicyPrefs(): import("@shared/contracts/lsp.ts").LspPolicyPrefs;
  getRecoveryAttempt(): number;
  getRecoveryTimer(): ReturnType<typeof setTimeout> | null;
  getTerminal(): boolean;
  readonly hostClosedSessions: Set<string>;
  incrementOperationEpoch(): void;
  readonly input: RootSessionInput;
  invalidateAsyncWork(): void;
  isCurrentEpoch(epoch: number): boolean;
  requestForCurrentAttachment(): import("@shared/contracts/lsp.ts").LspSessionEnsureRequest;
  serverId(): string;
  setPaused(value: boolean): void;
  setRecoveryAttempt(value: number): void;
  setRecoveryTimer(value: ReturnType<typeof setTimeout> | null): void;
  setTerminal(value: boolean): void;
  setWaitingForPolicy(value: boolean): void;
  transition(status: FilesLanguageServiceStatus): void;
}

export function handleRootSendFailure(
  host: RootRecoveryHost,
  generation: number,
  sessionId: string
): void {
  const current = host.getCurrent();
  if (
    !current ||
    current.generation !== generation ||
    current.sessionId !== sessionId ||
    current.faulted
  ) {
    return;
  }
  handleRootRecoverableFailure(host, current, "send-failed", true);
}

export function handleRootClosed(
  host: RootRecoveryHost,
  generation: number,
  sessionId: string,
  event: LspSessionClosedEvent
): void {
  const current = host.getCurrent();
  if (
    !current ||
    current.generation !== generation ||
    current.sessionId !== sessionId ||
    current.faulted
  ) {
    return;
  }
  host.hostClosedSessions.add(sessionId);
  if (event.reason === "exited" || event.reason === "failed") {
    handleRootRecoverableFailure(host, current, event.reason, false);
    return;
  }
  if (event.cause === "policy-disabled") {
    host.setWaitingForPolicy(true);
    host.setPaused(false);
    host.invalidateAsyncWork();
    const disabled: FilesLanguageServiceStatus = (host.getPolicyObserved()
      ? disabledFilesLspStatus(host.getPolicyPrefs(), host.input.isWorktree)
      : null) ?? { reason: "globally-disabled", state: "disabled" };
    host.transition(disabled);
    host.disposeCurrent(false);
    return;
  }
  if (event.cause === "idle-release" || event.cause === "workspace-evicted") {
    host.setPaused(true);
    host.setWaitingForPolicy(false);
    host.invalidateAsyncWork();
    host.transition({
      reason: event.cause,
      serverId: current.serverId,
      state: "paused",
    });
    host.disposeCurrent(false);
    return;
  }
  host.setTerminal(true);
  host.invalidateAsyncWork();
  host.input.onDelete();
  host.disposeCurrent(false);
  for (const attachment of host.attachments) {
    attachment.publish(null);
  }
}

export function handleRootRecoverableFailure(
  host: RootRecoveryHost,
  current: RootGeneration,
  reason: RecoveryReason,
  closeSession: boolean
): void {
  if (current.faulted) {
    return;
  }
  current.faulted = true;
  host.cancelStableResetTimer();
  host.incrementOperationEpoch();
  host.disposeCurrent(closeSession);
  if (!current.ready) {
    if (host.getRecoveryAttempt() > 0 && host.attachments.size > 0) {
      scheduleRootRecovery(host, "initialize-failed");
    } else {
      host.transition({
        reason: "initialize-failed",
        serverId: current.serverId,
        state: "error",
      });
    }
    return;
  }
  scheduleRootRecovery(host, reason);
}

export function scheduleRootRecovery(
  host: RootRecoveryHost,
  reason: RecoveryReason
): void {
  if (
    host.getTerminal() ||
    host.attachments.size === 0 ||
    host.getRecoveryTimer()
  ) {
    return;
  }
  const retry = lspReconnectAttempt(host.getRecoveryAttempt() + 1);
  if (!retry) {
    host.transition({
      reason: "retry-exhausted",
      serverId: host.serverId(),
      state: "error",
    });
    return;
  }
  host.setRecoveryAttempt(retry.attempt);
  host.transition({
    attempt: retry.attempt,
    delayMs: retry.delayMs,
    reason,
    serverId: host.serverId(),
    state: "retrying",
  });
  const epoch = host.getOperationEpoch();
  host.setRecoveryTimer(
    setTimeout(() => {
      host.setRecoveryTimer(null);
      attemptRootRecovery(host, epoch, reason).catch(() => undefined);
    }, retry.delayMs)
  );
}

export async function attemptRootRecovery(
  host: RootRecoveryHost,
  epoch: number,
  reason: RecoveryReason
): Promise<void> {
  const ensured = await host.facade
    .ensureSession(host.requestForCurrentAttachment())
    .catch(() => null);
  if (!host.isCurrentEpoch(epoch)) {
    if (ensured?.ok) {
      host.closeStaleSession(ensured.sessionId);
    }
    return;
  }
  if (!ensured?.ok) {
    if (ensured?.reason === "cleanup-failed") {
      host.transition({
        ...(ensured.serverId ? { serverId: ensured.serverId } : {}),
        reason: "cleanup-failed",
        state: "error",
      });
      return;
    }
    scheduleRootRecovery(host, reason);
    return;
  }
  const adopted = await host.adoptEnsured(ensured, epoch, true);
  if (!adopted && host.isCurrentEpoch(epoch) && !host.getRecoveryTimer()) {
    scheduleRootRecovery(host, reason);
  }
}
