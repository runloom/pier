/**
 * `PDFWorker.destroy()` only terminates the worker the library created itself.
 * A worker injected as a `port` is owned by the host, so its thread must be
 * terminated explicitly after the loading task has been torn down.
 */
export function destroyPdfResources(input: {
  loadingTask: { destroy(): Promise<void> };
  port: { terminate(): void };
  worker: { destroy(): void };
}): void {
  input.loadingTask.destroy().catch(() => undefined);
  try {
    input.worker.destroy();
  } catch {
    // Already torn down with the loading task.
  }
  input.port.terminate();
}
