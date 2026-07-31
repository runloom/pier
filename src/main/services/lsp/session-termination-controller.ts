import type {
  LspSessionCloseCause,
  LspSessionClosedEvent,
} from "@shared/contracts/lsp.ts";
import { cancellableDelay } from "./json-rpc.ts";
import {
  LSP_EXIT_GRACE_MS,
  LSP_TERM_GRACE_MS,
  type LspChildProcess,
  type ProcessTreeHandle,
} from "./process-termination.ts";
import type { LspSessionPhase, RuntimeLogger } from "./session-runtime.ts";

interface LspTerminationControllerInput {
  readonly child: LspChildProcess;
  readonly logger: RuntimeLogger;
  readonly onOutcome: (event: LspSessionClosedEvent) => void;
  readonly processTree: ProcessTreeHandle;
  readonly rejectPendingRequests: (message: string) => void;
  readonly sessionId: string;
  readonly setPhase: (phase: LspSessionPhase) => void;
}

type UnrequestedCloseReason = "exited" | "failed";

export class LspSessionTerminationController {
  readonly #childTerminal = Promise.withResolvers<void>();
  readonly #input: LspTerminationControllerInput;
  readonly #runtimeTerminal = Promise.withResolvers<void>();
  #abnormalOutcomeQueued = false;
  #abnormalOutcomeReason: UnrequestedCloseReason | null = null;
  #childTerminalSettled = false;
  #closePromise: Promise<void> | null = null;
  #outcomeSent = false;
  #requestedCloseCause: LspSessionCloseCause | null = null;
  #runtimeTerminalSettled = false;
  #terminationAttempt: Promise<void> | null = null;
  #terminationState: "idle" | "running" | "failed" | "complete" = "idle";

  constructor(input: LspTerminationControllerInput) {
    this.#input = input;
  }

  get closePromise(): Promise<void> | null {
    return this.#closePromise;
  }

  get requestedCloseCause(): LspSessionCloseCause | null {
    return this.#requestedCloseCause;
  }

  get terminal(): Promise<void> {
    return this.#runtimeTerminal.promise;
  }

  get terminationAttempt(): Promise<void> | null {
    return this.#terminationAttempt;
  }

  beginAbnormal(reason: UnrequestedCloseReason): void {
    this.#input.rejectPendingRequests("LSP session closed");
    if (reason === "failed" || this.#abnormalOutcomeReason === null) {
      this.#abnormalOutcomeReason = reason;
    }
    if (!this.#abnormalOutcomeQueued) {
      this.#abnormalOutcomeQueued = true;
      queueMicrotask(() => {
        queueMicrotask(() => {
          this.#abnormalOutcomeQueued = false;
          this.#emitOutcome(this.#abnormalOutcomeReason ?? reason);
        });
      });
    }
    if (!this.#closePromise) {
      const attempt = this.terminateTree(reason).catch((error: unknown) => {
        this.#input.logger.error("[lsp] process-tree cleanup failed", {
          error,
          sessionId: this.#input.sessionId,
        });
        throw error;
      });
      this.#trackAttempt(attempt);
      attempt.catch(() => undefined);
    }
  }

  beginClose(
    cause: LspSessionCloseCause,
    closeTask: () => Promise<void>
  ): Promise<void> {
    if (this.#closePromise) {
      return this.#closePromise;
    }
    this.#requestedCloseCause = cause;
    const attempt = Promise.resolve().then(closeTask);
    this.#trackAttempt(attempt);
    return attempt;
  }

  handleChildExit(): void {
    if (this.#requestedCloseCause) {
      this.#emitOutcome("exited");
    } else {
      this.beginAbnormal("exited");
    }
  }

  retryTermination = async (): Promise<void> => {
    if (this.#terminationState === "complete") {
      return;
    }
    if (
      this.#terminationState === "failed" ||
      this.#terminationState === "idle"
    ) {
      const attempt = this.terminateTree(
        this.#requestedCloseCause ? "exited" : "failed"
      );
      this.#terminationAttempt = attempt;
      await attempt;
      return;
    }
    if (await this.#input.processTree.isAlive()) {
      await this.#input.processTree.gracefulTerminate();
    }
  };

  settleChildTerminal = (): void => {
    if (!this.#childTerminalSettled) {
      this.#childTerminalSettled = true;
      this.#childTerminal.resolve();
    }
  };

  async terminateTree(reason: UnrequestedCloseReason): Promise<void> {
    this.#terminationState = "running";
    this.#input.setPhase("terminating");
    // Only force-settle runtime.terminal for failures *before* finishAtTerminals.
    // processTree.close() failures must leave terminal open so retry can settle
    // it after a successful second close (see session-host retry tests).
    let reachedFinish = false;
    try {
      this.#endStdin();
      if (!(await this.#waitForTreeTerminal(LSP_EXIT_GRACE_MS))) {
        if (await this.#input.processTree.isAlive()) {
          await this.#boundedTreeOp(() =>
            this.#input.processTree.gracefulTerminate()
          );
        }
        if (
          !(await this.#waitForTreeTerminal(LSP_TERM_GRACE_MS)) &&
          (await this.#input.processTree.isAlive())
        ) {
          await this.#boundedTreeOp(() =>
            this.#input.processTree.forceTerminate()
          );
        }
      }
      reachedFinish = true;
      await this.#finishAtTerminals(reason);
      this.#terminationState = "complete";
    } catch (error) {
      this.#terminationState = "failed";
      this.settleChildTerminal();
      if (!(reachedFinish || this.#runtimeTerminalSettled)) {
        this.#runtimeTerminalSettled = true;
        this.#runtimeTerminal.reject(
          error instanceof Error ? error : new Error(String(error))
        );
      }
      throw error;
    }
  }

  #emitOutcome(unrequestedReason: UnrequestedCloseReason): void {
    if (this.#outcomeSent) {
      return;
    }
    this.#outcomeSent = true;
    const event: LspSessionClosedEvent = this.#requestedCloseCause
      ? {
          cause: this.#requestedCloseCause,
          reason: "closed",
          sessionId: this.#input.sessionId,
        }
      : { reason: unrequestedReason, sessionId: this.#input.sessionId };
    this.#input.onOutcome(event);
  }

  #endStdin(): void {
    if (this.#input.child.stdin.writableEnded) {
      return;
    }
    try {
      this.#input.child.stdin.end();
    } catch {
      // Process-tree termination remains authoritative.
    }
  }

  async #finishAtTerminals(reason: UnrequestedCloseReason): Promise<void> {
    await this.#childTerminal.promise;
    // Bound wait: if the tree never signals terminal after kill attempts,
    // still run close + settle so ensure cannot hang indefinitely.
    await this.#waitForTreeTerminal(LSP_TERM_GRACE_MS);
    this.#emitOutcome(this.#abnormalOutcomeReason ?? reason);
    this.#input.setPhase("closed");
    await this.#input.processTree.close();
    if (!this.#runtimeTerminalSettled) {
      this.#runtimeTerminalSettled = true;
      this.#runtimeTerminal.resolve();
    }
  }

  #trackAttempt(attempt: Promise<void>): void {
    this.#terminationAttempt = attempt;
    this.#closePromise = attempt;
  }

  async #boundedTreeOp(operation: () => Promise<void>): Promise<void> {
    const timer = cancellableDelay(LSP_TERM_GRACE_MS);
    try {
      await Promise.race([operation(), timer.promise]);
    } finally {
      timer.cancel();
    }
  }

  async #waitForTreeTerminal(timeoutMs: number): Promise<boolean> {
    const timer = cancellableDelay(timeoutMs);
    const result = await Promise.race([
      this.#input.processTree.terminal.then(() => true),
      timer.promise.then(() => false),
    ]);
    timer.cancel();
    return result;
  }
}
