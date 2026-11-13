import { destroyPdfResources } from "@plugins/builtin/files/renderer/preview/pdf/resources.ts";
import { describe, expect, it, vi } from "vitest";

describe("destroyPdfResources", () => {
  it("destroys the loading task, worker and injected port", () => {
    const destroyTask = vi.fn(async () => undefined);
    const destroyWorker = vi.fn();
    const terminate = vi.fn();

    destroyPdfResources({
      loadingTask: { destroy: destroyTask },
      port: { terminate },
      worker: { destroy: destroyWorker },
    });

    expect(destroyTask).toHaveBeenCalledOnce();
    expect(destroyWorker).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("terminates the port even when worker teardown throws", () => {
    const terminate = vi.fn();

    destroyPdfResources({
      loadingTask: { destroy: async () => undefined },
      port: { terminate },
      worker: {
        destroy: () => {
          throw new Error("already gone");
        },
      },
    });

    expect(terminate).toHaveBeenCalledOnce();
  });
});
