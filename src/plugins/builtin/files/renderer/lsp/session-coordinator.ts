import type { Transport } from "@codemirror/lsp-client";
import type {
  LspPolicyPrefs,
  LspSessionClosedEvent,
  LspSessionEnsureRequest,
  LspSessionEnsureResult,
  LspSessionMessageEvent,
} from "@shared/contracts/lsp.ts";

export interface LspFacade {
  close: (sessionId: string) => Promise<boolean>;
  ensureSession: (
    request: LspSessionEnsureRequest
  ) => Promise<LspSessionEnsureResult | null>;
  onClosed: (listener: (event: LspSessionClosedEvent) => void) => () => void;
  onMessage: (listener: (event: LspSessionMessageEvent) => void) => () => void;
  onPolicyChanged: (listener: (prefs: LspPolicyPrefs) => void) => () => void;
  send: (sessionId: string, message: string) => Promise<boolean>;
}

export function getLspFacade(): LspFacade | null {
  const root = globalThis as unknown as {
    pier?: { lsp?: LspFacade };
    window?: { pier?: { lsp?: LspFacade } };
  };
  return root.window?.pier?.lsp ?? root.pier?.lsp ?? null;
}

export class SessionTransport implements Transport {
  readonly #lspFacade: LspFacade;
  readonly #handlers = new Set<(value: string) => void>();
  readonly #sessionId: string;
  readonly #unsubscribeClosed: () => void;
  readonly #unsubscribeMessage: () => void;
  #closing = false;
  #disposed = false;
  #sendFailed = false;
  #sendQueue: Promise<void> = Promise.resolve();

  constructor(input: {
    facade: LspFacade;
    onClosed: (event: LspSessionClosedEvent) => void;
    onSendFailure: () => void;
    sessionId: string;
  }) {
    this.#lspFacade = input.facade;
    this.#sessionId = input.sessionId;
    this.#unsubscribeMessage = input.facade.onMessage((event) => {
      if (event.sessionId !== input.sessionId || this.#disposed) {
        return;
      }
      for (const handler of this.#handlers) {
        handler(event.message);
      }
    });
    this.#unsubscribeClosed = input.facade.onClosed((event) => {
      if (event.sessionId === input.sessionId && !this.#disposed) {
        input.onClosed(event);
      }
    });
    const failSend = () => {
      if (this.#closing || this.#disposed || this.#sendFailed) {
        return;
      }
      this.#sendFailed = true;
      input.onSendFailure();
    };
    this.#onSendFailure = failSend;
  }

  readonly #onSendFailure: () => void;

  send(message: string): void {
    if (this.#closing || this.#disposed || this.#sendFailed) {
      return;
    }
    this.#sendQueue = this.#sendQueue.then(async () => {
      try {
        const sent = await this.#lspFacade.send(this.#sessionId, message);
        if (!sent) {
          this.#onSendFailure();
        }
      } catch {
        this.#onSendFailure();
      }
    });
  }

  subscribe(handler: (value: string) => void): void {
    if (!this.#disposed) {
      this.#handlers.add(handler);
    }
  }

  unsubscribe(handler: (value: string) => void): void {
    this.#handlers.delete(handler);
  }

  async flushAndDispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#closing = true;
    const sendQueue = this.#sendQueue;
    await sendQueue;
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#handlers.clear();
    this.#unsubscribeClosed();
    this.#unsubscribeMessage();
  }
}

type RootAttachmentValidity = () => boolean;

interface RootAcquisitionCohort {
  readonly key: string;
  readonly pending: Set<RootSessionAcquisition>;
  readonly sessions: Map<string, RootSessionClaim>;
}

interface RootSessionAcquisition {
  readonly cohort: RootAcquisitionCohort;
  readonly isValid: RootAttachmentValidity;
}

interface RootSessionClaim {
  claimed: boolean;
  closeRequested: boolean;
  readonly facade: LspFacade;
  readonly sessionId: string;
}

interface RootSessionIdentity {
  cacheKey: string;
  facade: LspFacade;
  sessionId: string;
}

const acquisitionCohorts = new Map<string, RootAcquisitionCohort>();

export function beginRootSessionAcquisition(
  key: string,
  isValid: RootAttachmentValidity
): RootSessionAcquisition {
  let cohort = acquisitionCohorts.get(key);
  if (!cohort) {
    cohort = {
      key,
      pending: new Set(),
      sessions: new Map(),
    };
    acquisitionCohorts.set(key, cohort);
  }
  const acquisition = { cohort, isValid };
  cohort.pending.add(acquisition);
  return acquisition;
}

function getRootSessionClaim(
  acquisition: RootSessionAcquisition,
  input: RootSessionIdentity
): RootSessionClaim {
  const key = `${input.cacheKey}\0${input.sessionId}`;
  let claim = acquisition.cohort.sessions.get(key);
  if (!claim) {
    claim = {
      claimed: false,
      closeRequested: false,
      facade: input.facade,
      sessionId: input.sessionId,
    };
    acquisition.cohort.sessions.set(key, claim);
  }
  return claim;
}

export function claimRootSession(
  acquisition: RootSessionAcquisition,
  input: RootSessionIdentity
): void {
  getRootSessionClaim(acquisition, input).claimed = true;
}

export function deferStaleRootSessionClose(
  acquisition: RootSessionAcquisition,
  input: RootSessionIdentity,
  claimedByCachedClient: boolean
): void {
  const claim = getRootSessionClaim(acquisition, input);
  if (claimedByCachedClient) {
    claim.claimed = true;
  }
}

export function finishRootSessionAcquisition(
  acquisition: RootSessionAcquisition
): void {
  const { cohort } = acquisition;
  cohort.pending.delete(acquisition);
  let hasPendingClaimant = false;
  for (const pending of cohort.pending) {
    if (pending.isValid()) {
      hasPendingClaimant = true;
      break;
    }
  }
  if (!hasPendingClaimant) {
    for (const claim of cohort.sessions.values()) {
      if (claim.claimed || claim.closeRequested) {
        continue;
      }
      claim.closeRequested = true;
      claim.facade.close(claim.sessionId).catch(() => undefined);
    }
  }
  if (
    cohort.pending.size === 0 &&
    acquisitionCohorts.get(cohort.key) === cohort
  ) {
    acquisitionCohorts.delete(cohort.key);
  }
}

export function resetRootSessionAcquisitionsForTests(): void {
  acquisitionCohorts.clear();
}
