import { destroyPdfResources } from "@plugins/builtin/files/renderer/preview/pdf/resources.ts";
import { describe, expect, it, vi } from "vitest";

describe("destroyPdfResources", () => {
  it("awaits the loading task before destroying the worker and port", async () => {
    const order: string[] = [];
    const destroyTask = vi.fn(async () => {
      order.push("task");
    });
    const destroyWorker = vi.fn(() => {
      order.push("worker");
    });
    const terminate = vi.fn(() => {
      order.push("port");
    });

    const pending = destroyPdfResources({
      loadingTask: { destroy: destroyTask },
      port: { terminate },
      worker: { destroy: destroyWorker },
    });
    expect(order).toEqual(["task"]);

    await pending;
    expect(order).toEqual(["task", "worker", "port"]);
  });

  it("still tears down the worker and port when the loading task rejects", async () => {
    const terminate = vi.fn();
    const destroyWorker = vi.fn();

    await destroyPdfResources({
      loadingTask: {
        destroy: async () => {
          throw new Error("already destroyed");
        },
      },
      port: { terminate },
      worker: { destroy: destroyWorker },
    });

    expect(destroyWorker).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("terminates the port even when worker teardown throws", async () => {
    const terminate = vi.fn();

    await destroyPdfResources({
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
