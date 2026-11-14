/**
 * `PDFWorker.destroy()` only terminates the worker the library created itself.
 * A worker injected as a `port` is owned by the host, so its thread must be
 * terminated only after the loading task has finished tearing down the PDF.js
 * document: terminating the port first skips the library's cleanup.
 */
export async function destroyPdfResources(input: {
  loadingTask: { destroy(): Promise<void> };
  port: { terminate(): void };
  worker: { destroy(): void };
}): Promise<void> {
  try {
    await input.loadingTask.destroy();
  } catch {
    // The loading task may already be rejected/destroyed.
  }
  try {
    input.worker.destroy();
  } catch {
    // Already torn down with the loading task.
  }
  input.port.terminate();
}
