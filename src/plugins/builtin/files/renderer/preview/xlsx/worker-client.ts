import type { XlsxWorkerRequest, XlsxWorkerResponse } from "./protocol.ts";
import XlsxWorker from "./worker.ts?worker&inline";

export interface XlsxWorkerLike {
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<XlsxWorkerResponse>) => void) | null;
  postMessage(message: XlsxWorkerRequest): void;
  terminate(): void;
}

export function createXlsxWorker(): XlsxWorkerLike {
  return new XlsxWorker() as unknown as XlsxWorkerLike;
}
