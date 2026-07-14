import { GIT_EXEC_MAX_NUL_RECORD_BYTES } from "./git-exec-raw-contract.ts";

export class GitExecNulRecordParser {
  readonly #buffer: Buffer;
  #pendingBytes = 0;
  readonly #maxRecordBytes: number;

  constructor(maxRecordBytes = GIT_EXEC_MAX_NUL_RECORD_BYTES) {
    if (
      !Number.isSafeInteger(maxRecordBytes) ||
      maxRecordBytes <= 0 ||
      maxRecordBytes > GIT_EXEC_MAX_NUL_RECORD_BYTES
    ) {
      throw new RangeError("Git NUL record limit is outside the hard boundary");
    }
    this.#maxRecordBytes = maxRecordBytes;
    this.#buffer = Buffer.allocUnsafe(maxRecordBytes);
  }

  get hasIncompleteRecord(): boolean {
    return this.#pendingBytes > 0;
  }

  push(chunk: Buffer, onRecord: (record: Buffer) => boolean): boolean {
    let start = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] !== 0) {
        continue;
      }
      const segment = chunk.subarray(start, index);
      const record = this.#joinRecord(segment);
      this.#reset();
      if (!onRecord(record)) {
        return false;
      }
      start = index + 1;
    }

    const remainder = chunk.subarray(start);
    if (remainder.length > 0) {
      this.#pendingBytes += remainder.length;
      if (this.#pendingBytes > this.#maxRecordBytes) {
        throw new RangeError(
          "Git NUL record exceeds the configured byte limit"
        );
      }
      remainder.copy(
        this.#buffer,
        this.#pendingBytes - remainder.length,
        0,
        remainder.length
      );
    }
    return true;
  }

  #joinRecord(segment: Buffer): Buffer {
    const totalBytes = this.#pendingBytes + segment.length;
    if (totalBytes > this.#maxRecordBytes) {
      throw new RangeError("Git NUL record exceeds the configured byte limit");
    }
    if (this.#pendingBytes === 0) {
      return Buffer.from(segment);
    }
    const record = Buffer.allocUnsafe(totalBytes);
    this.#buffer.copy(record, 0, 0, this.#pendingBytes);
    segment.copy(record, this.#pendingBytes);
    return record;
  }

  #reset(): void {
    this.#pendingBytes = 0;
  }
}
