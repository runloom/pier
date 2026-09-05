import type { CompareRequest, FileChanges } from "./types.ts";

export class FileChangesWorker {
  #worker: Worker | null = null;
  #cancel: (() => void) | null = null;
  readonly #create: () => Worker;
  constructor(
    create = () =>
      new Worker(new URL("./compare.worker.ts", import.meta.url), {
        type: "module",
      })
  ) {
    this.#create = create;
  }

  compare(
    input: CompareRequest,
    timeoutMs: number
  ): Promise<FileChanges | null> {
    this.cancel();
    return new Promise((resolve, reject) => {
      const worker = this.#create();
      this.#worker = worker;
      const finish = () => {
        clearTimeout(timer);
        worker.terminate();
        if (this.#worker === worker) {
          this.#worker = null;
          this.#cancel = null;
        }
      };
      const timer = setTimeout(() => {
        finish();
        reject(new Error("timeout"));
      }, timeoutMs);
      this.#cancel = () => {
        finish();
        resolve(null);
      };
      worker.onerror = () => {
        finish();
        reject(new Error("worker-failed"));
      };
      worker.onmessage = (
        event: MessageEvent<{
          version: number;
          result?: FileChanges;
          error?: string;
        }>
      ) => {
        if (event.data.version !== input.version) return;
        finish();
        if (event.data.result) resolve(event.data.result);
        else reject(new Error(event.data.error ?? "comparison-failed"));
      };
      worker.postMessage(input);
    });
  }
  cancel(): void {
    this.#cancel?.();
  }
}
