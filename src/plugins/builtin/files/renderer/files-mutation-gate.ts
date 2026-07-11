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

  async suspend(signal: AbortSignal): Promise<void> {
    this.#suspended = true;
    try {
      while (this.#inFlight.size > 0) {
        await this.#waitForCurrent(signal);
      }
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
