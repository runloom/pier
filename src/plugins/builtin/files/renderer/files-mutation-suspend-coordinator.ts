import {
  FilesMutationGate,
  FilesMutationSuspendedError,
} from "./files-mutation-gate.ts";

export type FilesMutationSuspendScope =
  | { kind: "all" }
  | { kind: "transfer"; documentId: string; panelId: string };

function transferScopeKey(scope: {
  documentId: string;
  panelId: string;
}): string {
  return `${scope.panelId}\0${scope.documentId}`;
}

/**
 * Serial mutation barriers for Files.
 *
 * Reuses {@link FilesMutationGate}'s single in-flight set for drains.
 * Plugin disable uses `{ kind: "all" }`; panel transfer uses a document/panel
 * scope so other documents keep mutating. Global `all` overrides local
 * transfer scopes. Suspend calls are serialized to avoid inverse-wait
 * deadlocks between scopes.
 */
export class FilesMutationSuspendCoordinator {
  readonly #gate: FilesMutationGate;
  readonly #transferScopes = new Map<
    string,
    { documentId: string; panelId: string }
  >();
  #allActive = false;
  #tail: Promise<void> = Promise.resolve();

  constructor(gate: FilesMutationGate = new FilesMutationGate()) {
    this.#gate = gate;
  }

  get gate(): FilesMutationGate {
    return this.#gate;
  }

  async run<T>(
    operation: () => Promise<T> | T,
    scope?: { documentId?: string; panelId?: string }
  ): Promise<T> {
    if (this.isSuspended(scope)) {
      throw new FilesMutationSuspendedError();
    }
    return await this.#gate.run(operation);
  }

  isSuspended(scope?: { documentId?: string; panelId?: string }): boolean {
    if (this.#allActive || this.#gate.suspended) {
      return true;
    }
    if (!scope) {
      return false;
    }
    for (const active of this.#transferScopes.values()) {
      if (
        (scope.documentId !== undefined &&
          active.documentId === scope.documentId) ||
        (scope.panelId !== undefined && active.panelId === scope.panelId)
      ) {
        return true;
      }
    }
    return false;
  }

  async suspend(
    scope: FilesMutationSuspendScope,
    signal: AbortSignal
  ): Promise<void> {
    await this.#enqueue(async () => {
      if (scope.kind === "all") {
        await this.#gate.suspend(signal);
        this.#allActive = true;
        return;
      }
      // Transfer: drain the shared in-flight set, then block only this
      // document/panel. Do not flip the global gate suspended flag so other
      // documents keep working. Global `all` already blocks everything.
      await this.#gate.waitForInFlight(signal);
      this.#transferScopes.set(transferScopeKey(scope), {
        documentId: scope.documentId,
        panelId: scope.panelId,
      });
    });
  }

  resume(scope: FilesMutationSuspendScope): void {
    if (scope.kind === "all") {
      this.#allActive = false;
      this.#gate.resume();
      return;
    }
    this.#transferScopes.delete(transferScopeKey(scope));
  }

  /** Release every barrier (close / dispose paths). */
  resumeAll(): void {
    this.#allActive = false;
    this.#transferScopes.clear();
    this.#gate.resume();
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.#tail.then(operation, operation);
    this.#tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}
