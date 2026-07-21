import { waitForSettledWithAbort } from "./files-async-drain.ts";

export class FilesMutationSuspendedError extends Error {
  constructor() {
    super("Files mutations are suspended");
    this.name = "FilesMutationSuspendedError";
  }
}

export class FilesMutationGate {
  readonly #inFlight = new Set<Promise<unknown>>();
  #suspended = false;

  get suspended(): boolean {
    return this.#suspended;
  }

  async run<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.#suspended) {
      throw new FilesMutationSuspendedError();
    }
    const pending = Promise.resolve().then(operation);
    this.#inFlight.add(pending);
    try {
      return await pending;
    } finally {
      this.#inFlight.delete(pending);
    }
  }

  /**
   * Drain in-flight mutations without flipping the global suspended flag.
   * Shared by transfer-scoped barriers so they reuse the same Promise set.
   */
  async waitForInFlight(signal: AbortSignal): Promise<void> {
    while (this.#inFlight.size > 0) {
      await this.#waitForCurrent(signal);
    }
  }

  async suspend(signal: AbortSignal): Promise<void> {
    this.#suspended = true;
    try {
      await this.waitForInFlight(signal);
    } catch (error) {
      this.#suspended = false;
      throw error;
    }
  }

  resume(): void {
    this.#suspended = false;
  }

  async #waitForCurrent(signal: AbortSignal): Promise<void> {
    await waitForSettledWithAbort(
      this.#inFlight,
      signal,
      "Files mutation drain aborted"
    );
  }
}
