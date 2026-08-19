import {
  DEFAULT_LSP_POLICY_PREFS,
  type LspPolicyPrefs,
  type LspSessionClosedEvent,
  type LspSessionEnsureRequest,
  type LspSessionEnsureSuccess,
} from "@shared/contracts/lsp.ts";
import type { FilesLanguageServiceStatus } from "../panel/language-service-status.ts";
import { createFilesLspRootGeneration } from "./root-generation.ts";
import {
  disabledFilesLspStatus,
  type FilesLspRootAttachment,
  type FilesLspRootLease,
  LSP_RECONNECT_RESET_MS,
  type RecoveryReason,
  type RootGeneration,
  type RootSessionInput,
  statusForEnsureFailure,
} from "./root-recovery-types.ts";
import {
  handleRootClosed,
  handleRootSendFailure,
  type RootRecoveryHost,
  scheduleRootRecovery,
} from "./root-session-recovery.ts";
import type { LspFacade } from "./session-coordinator.ts";
export class FilesLspRootSession {
  readonly attachments = new Set<FilesLspRootAttachment>();
  readonly cacheKey: string;
  readonly #lspFacade: LspFacade;
  readonly #input: RootSessionInput;
  #current: RootGeneration | null = null;
  #generation = 0;
  readonly #hostClosedSessions = new Set<string>();
  #operationEpoch = 0;
  #policyPrefs = DEFAULT_LSP_POLICY_PREFS;
  #policyObserved = false;
  #recoveryAttempt = 0;
  #recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  #stableResetTimer: ReturnType<typeof setTimeout> | null = null;
  #status: FilesLanguageServiceStatus = { state: "starting" };
  #terminal = false;
  #emptyReleasePending = false;
  #waitingForPolicy = false;
  #paused = false;
  #immediateEnsurePending = false;
  constructor(input: RootSessionInput) {
    this.#input = input;
    this.#lspFacade = input.facade;
    this.cacheKey = input.cacheKey;
  }
  get closed(): boolean {
    return this.#terminal;
  }
  get sessionId(): string {
    return this.#current?.sessionId ?? this.#input.ensured.sessionId;
  }
  async initialize(): Promise<boolean> {
    const epoch = this.#operationEpoch;
    return this.#adoptEnsured(this.#input.ensured, epoch, false);
  }
  abandon(): void {
    if (this.#terminal || this.attachments.size > 0) {
      return;
    }
    this.#terminal = true;
    this.#invalidateAsyncWork();
    this.#input.onDelete();
    this.#disposeCurrent(true);
  }
  attach(attachment: FilesLspRootAttachment): FilesLspRootLease | null {
    if (this.#terminal) {
      attachment.publish(null);
      return null;
    }
    this.attachments.add(attachment);
    attachment.publish(this.#status);
    const current = this.#current;
    if (current?.ready && !current.faulted) {
      attachment.connect(current.client, attachment.languageId!);
    }
    let released = false;
    return {
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.#releaseAttachment(attachment);
      },
      resume: () => {
        if (!released) {
          this.resume();
        }
      },
      setPolicy: (prefs) => {
        if (!released) {
          this.setPolicy(prefs);
        }
      },
      touch: () => {
        if (!released) {
          this.touch();
        }
      },
    };
  }
  setPolicy(prefs: LspPolicyPrefs): void {
    if (this.#terminal) {
      return;
    }
    this.#policyPrefs = prefs;
    this.#policyObserved = true;
    const disabled = disabledFilesLspStatus(prefs, this.#input.isWorktree);
    if (disabled) {
      if (!this.#waitingForPolicy || this.#status.state !== "disabled") {
        this.#waitingForPolicy = true;
        this.#paused = false;
        this.#invalidateAsyncWork();
        this.#transition(disabled);
        this.#disposeCurrent(false);
      }
      return;
    }
    if (!this.#waitingForPolicy) {
      return;
    }
    this.#waitingForPolicy = false;
    this.#startImmediateEnsure();
  }
  resume(): void {
    if (this.#terminal || !this.#paused) {
      return;
    }
    if (
      this.#policyObserved &&
      disabledFilesLspStatus(this.#policyPrefs, this.#input.isWorktree)
    ) {
      return;
    }
    this.#paused = false;
    this.#startImmediateEnsure();
  }
  /**
   * 可见保活：健康态经 ensure-reused 刷新 main 侧 lastTouchAt，防止用户
   * 正在阅读的可见编辑器被空闲回收。暂停/禁用/未就绪时不打扰恢复状态机。
   */
  touch(): void {
    if (this.#terminal || this.#paused || this.#waitingForPolicy) {
      return;
    }
    const current = this.#current;
    if (!current?.ready || current.faulted) {
      return;
    }
    this.#lspFacade
      .ensureSession(this.#requestForCurrentAttachment())
      .then((ensured) => {
        if (ensured?.ok && ensured.sessionId !== current.sessionId) {
          // 竞态：main 侧已重建会话。touch 不收编新会话（交给恢复路径），
          // 只避免泄漏这次 ensure 产生的空闲消费者。
          this.#closeStaleSession(ensured.sessionId);
        }
      })
      .catch(() => undefined);
  }
  #releaseAttachment(attachment: FilesLspRootAttachment): void {
    if (!this.attachments.delete(attachment)) {
      return;
    }
    attachment.disconnect();
    attachment.publish(null);
    if (this.attachments.size > 0 || this.#emptyReleasePending) {
      return;
    }
    this.#emptyReleasePending = true;
    queueMicrotask(() => {
      this.#emptyReleasePending = false;
      if (
        this.#terminal ||
        this.attachments.size > 0 ||
        this.#input.shouldRetainWithoutAttachments()
      ) {
        return;
      }
      this.#terminal = true;
      this.#invalidateAsyncWork();
      this.#input.onDelete();
      this.#disposeCurrent(true);
    });
  }
  #transition(status: FilesLanguageServiceStatus): void {
    this.#status = status;
    for (const attachment of this.attachments) {
      attachment.publish(status);
    }
  }
  #disconnectAttachments(): void {
    for (const attachment of this.attachments) {
      attachment.disconnect();
    }
  }
  #invalidateAsyncWork(): void {
    this.#operationEpoch += 1;
    this.#cancelRecoveryTimer();
    this.#cancelStableResetTimer();
    this.#immediateEnsurePending = false;
  }
  #cancelRecoveryTimer(): void {
    if (this.#recoveryTimer !== null) {
      clearTimeout(this.#recoveryTimer);
      this.#recoveryTimer = null;
    }
  }
  #cancelStableResetTimer(): void {
    if (this.#stableResetTimer !== null) {
      clearTimeout(this.#stableResetTimer);
      this.#stableResetTimer = null;
    }
  }
  #disposeCurrent(closeSession: boolean): void {
    const current = this.#current;
    if (!current) {
      return;
    }
    this.#current = null;
    current.faulted = true;
    this.#disconnectAttachments();
    current.workspace?.closeOpenFiles();
    current.transport.flushAndDispose().then(async () => {
      current.client.disconnect();
      if (closeSession) {
        await this.#lspFacade.close(current.sessionId).catch(() => false);
      }
    });
  }
  async #adoptEnsured(
    ensured: LspSessionEnsureSuccess,
    epoch: number,
    recovering: boolean
  ): Promise<boolean> {
    if (!this.#isCurrentEpoch(epoch)) {
      this.#closeStaleSession(ensured.sessionId);
      return false;
    }
    const serverRoot =
      ensured.rootPath.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
    const expectedKey = `${ensured.workspaceKey}\0${ensured.serverId}\0${serverRoot}`;
    if (expectedKey !== this.cacheKey) {
      this.#closeStaleSession(ensured.sessionId);
      return false;
    }
    const generation = ++this.#generation;
    const current = createFilesLspRootGeneration({
      ensured,
      facade: this.#lspFacade,
      generation,
      onClosed: (event) => {
        this.#handleClosed(generation, ensured.sessionId, event);
      },
      onDisplayFile: this.#input.onDisplayFile,
      onSendFailure: () => {
        this.#handleSendFailure(generation, ensured.sessionId);
      },
      serverRoot,
    });
    this.#current = current;
    this.#input.onSessionChanged(ensured.sessionId);
    current.client.connect(current.transport);
    try {
      await current.client.initializing;
    } catch {
      if (this.#current === current && !current.faulted) {
        this.#disposeCurrent(true);
        if (recovering) {
          this.#scheduleRecovery("initialize-failed");
        } else {
          this.#transition({
            reason: "initialize-failed",
            serverId: ensured.serverId,
            state: "error",
          });
        }
      }
      return false;
    }
    if (
      !this.#isCurrentEpoch(epoch) ||
      this.#current !== current ||
      current.faulted
    ) {
      if (this.#current === current) {
        this.#disposeCurrent(true);
      } else {
        this.#closeStaleSession(ensured.sessionId);
      }
      return false;
    }
    current.ready = true;
    for (const attachment of this.attachments) {
      attachment.connect(current.client, attachment.languageId!);
    }
    this.#transition({ serverId: ensured.serverId, state: "ready" });
    if (this.#recoveryAttempt > 0) {
      this.#scheduleStableReset(current);
    }
    return true;
  }
  #handleSendFailure(generation: number, sessionId: string): void {
    handleRootSendFailure(this.#recoveryHost(), generation, sessionId);
  }
  #handleClosed(
    generation: number,
    sessionId: string,
    event: LspSessionClosedEvent
  ): void {
    handleRootClosed(this.#recoveryHost(), generation, sessionId, event);
  }
  #scheduleRecovery(reason: RecoveryReason): void {
    scheduleRootRecovery(this.#recoveryHost(), reason);
  }
  #recoveryHost(): RootRecoveryHost {
    return {
      adoptEnsured: (ensured, epoch, recovering) =>
        this.#adoptEnsured(ensured, epoch, recovering),
      attachments: this.attachments,
      cancelStableResetTimer: () => {
        this.#cancelStableResetTimer();
      },
      closeStaleSession: (sessionId) => {
        this.#closeStaleSession(sessionId);
      },
      disposeCurrent: (closeSession) => {
        this.#disposeCurrent(closeSession);
      },
      facade: this.#lspFacade,
      getCurrent: () => this.#current,
      getOperationEpoch: () => this.#operationEpoch,
      getPolicyObserved: () => this.#policyObserved,
      getPolicyPrefs: () => this.#policyPrefs,
      getRecoveryAttempt: () => this.#recoveryAttempt,
      getRecoveryTimer: () => this.#recoveryTimer,
      getTerminal: () => this.#terminal,
      hostClosedSessions: this.#hostClosedSessions,
      incrementOperationEpoch: () => {
        this.#operationEpoch += 1;
      },
      input: this.#input,
      invalidateAsyncWork: () => {
        this.#invalidateAsyncWork();
      },
      isCurrentEpoch: (epoch) => this.#isCurrentEpoch(epoch),
      requestForCurrentAttachment: () => this.#requestForCurrentAttachment(),
      serverId: () => this.#serverId(),
      setPaused: (value) => {
        this.#paused = value;
      },
      setRecoveryAttempt: (value) => {
        this.#recoveryAttempt = value;
      },
      setRecoveryTimer: (value) => {
        this.#recoveryTimer = value;
      },
      setTerminal: (value) => {
        this.#terminal = value;
      },
      setWaitingForPolicy: (value) => {
        this.#waitingForPolicy = value;
      },
      transition: (status) => {
        this.#transition(status);
      },
    };
  }
  #startImmediateEnsure(): void {
    if (
      this.#immediateEnsurePending ||
      this.#terminal ||
      this.attachments.size === 0
    ) {
      return;
    }
    this.#invalidateAsyncWork();
    this.#immediateEnsurePending = true;
    const epoch = this.#operationEpoch;
    this.#transition({ serverId: this.#serverId(), state: "starting" });
    this.#lspFacade
      .ensureSession(this.#requestForCurrentAttachment())
      .catch(() => null)
      .then(async (ensured) => {
        if (!this.#isCurrentEpoch(epoch)) {
          if (ensured?.ok) {
            this.#closeStaleSession(ensured.sessionId);
          }
          return;
        }
        this.#immediateEnsurePending = false;
        if (!ensured) {
          this.#transition({
            reason: "bridge-unavailable",
            serverId: this.#serverId(),
            state: "error",
          });
          return;
        }
        if (!ensured.ok) {
          this.#transition(statusForEnsureFailure(ensured));
          return;
        }
        await this.#adoptEnsured(ensured, epoch, false);
      });
  }
  #scheduleStableReset(current: RootGeneration): void {
    this.#cancelStableResetTimer();
    this.#stableResetTimer = setTimeout(() => {
      this.#stableResetTimer = null;
      if (
        this.#current === current &&
        current.ready &&
        !current.faulted &&
        !this.#terminal
      ) {
        this.#recoveryAttempt = 0;
      }
    }, LSP_RECONNECT_RESET_MS);
  }
  #requestForCurrentAttachment(): LspSessionEnsureRequest {
    const firstAttachment = this.attachments.values().next().value;
    return {
      ...this.#input.request,
      ...(firstAttachment ? { filePath: firstAttachment.absolutePath } : {}),
      ...(firstAttachment?.requestedLanguageId
        ? { languageId: firstAttachment.requestedLanguageId }
        : {}),
    };
  }
  #serverId(): string {
    return this.#current?.serverId ?? this.#input.ensured.serverId;
  }
  #isCurrentEpoch(epoch: number): boolean {
    return !this.#terminal && epoch === this.#operationEpoch;
  }
  #closeStaleSession(sessionId: string): void {
    if (
      this.#current?.sessionId === sessionId ||
      this.#hostClosedSessions.has(sessionId)
    ) {
      return;
    }
    this.#lspFacade.close(sessionId).catch(() => false);
  }
}
