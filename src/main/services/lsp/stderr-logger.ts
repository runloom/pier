import type { RuntimeLogger } from "./session-runtime.ts";

interface LspStderrLoggerInput {
  readonly chunkBytes: number;
  readonly logger: RuntimeLogger;
  readonly serverId: string;
  readonly sessionBytes: number;
  readonly sessionId: string;
}

export class LspStderrLogger {
  readonly #input: LspStderrLoggerInput;
  #loggedBytes = 0;
  #suppressed = false;

  constructor(input: LspStderrLoggerInput) {
    this.#input = input;
  }

  write(chunk: Buffer): void {
    if (this.#loggedBytes >= this.#input.sessionBytes) {
      this.#warnSuppressed();
      return;
    }
    let offset = 0;
    while (
      offset < chunk.byteLength &&
      this.#loggedBytes < this.#input.sessionBytes
    ) {
      const remainingBudget = this.#input.sessionBytes - this.#loggedBytes;
      const length = Math.min(
        Math.floor(this.#input.chunkBytes / 3),
        Math.floor(remainingBudget / 3),
        chunk.byteLength - offset
      );
      if (length === 0) {
        break;
      }
      const text = chunk.subarray(offset, offset + length).toString("utf8");
      this.#input.logger.warn(
        "[lsp]",
        this.#input.sessionId,
        this.#input.serverId,
        text
      );
      this.#loggedBytes += Buffer.byteLength(text, "utf8");
      offset += length;
    }
    if (offset < chunk.byteLength) {
      this.#warnSuppressed();
    }
  }

  #warnSuppressed(): void {
    if (this.#suppressed) {
      return;
    }
    this.#suppressed = true;
    this.#input.logger.warn(
      "[lsp]",
      this.#input.sessionId,
      "stderr suppressed after 64KiB"
    );
  }
}
