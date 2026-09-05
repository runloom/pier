import { FileChangesWorker } from "@plugins/builtin/files/renderer/git-changes/worker-client.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const request = { before: "a", after: "b", path: "a.md", version: 1 };
afterEach(() => vi.useRealTimers());
describe("comparison Worker lifecycle", () => {
  it("terminates a timed-out computation with no renderer fallback", async () => {
    vi.useFakeTimers();
    const worker = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    };
    const client = new FileChangesWorker(() => worker as unknown as Worker);
    const result = client.compare(request, 2000);
    const rejection = expect(result).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(2000);
    await rejection;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it("cancels the previous request and ignores unrelated generations", async () => {
    const workers: {
      postMessage: ReturnType<typeof vi.fn>;
      terminate: ReturnType<typeof vi.fn>;
      onmessage: ((event: MessageEvent) => void) | null;
    }[] = [];
    const client = new FileChangesWorker(() => {
      const worker = {
        postMessage: vi.fn(),
        terminate: vi.fn(),
        onmessage: null,
      };
      workers.push(worker);
      return worker as unknown as Worker;
    });
    const first = client.compare(request, 2000);
    const second = client.compare({ ...request, version: 2 }, 2000);
    expect(await first).toBeNull();
    expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);
    workers[1]?.onmessage?.({
      data: { version: 1, result: { markers: new Map(), ranges: [] } },
    } as MessageEvent);
    expect(workers[1]?.terminate).not.toHaveBeenCalled();
    client.cancel();
    expect(await second).toBeNull();
  });
});
