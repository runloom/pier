import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface PendingWrite {
  content: string;
  resolve(): void;
}

const writes: PendingWrite[] = [];
let activeWrites = 0;
let maxActiveWrites = 0;

vi.mock("write-file-atomic", () => ({
  default: vi.fn(
    async (_filePath: string, content: string) =>
      await new Promise<void>((resolve) => {
        activeWrites += 1;
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
        writes.push({
          content,
          resolve: () => {
            activeWrites -= 1;
            resolve();
          },
        });
      })
  ),
}));

describe("debouncedJsonStore", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    writes.length = 0;
    activeWrites = 0;
    maxActiveWrites = 0;
    tempDir = await mkdtemp(join(tmpdir(), "pier-debounced-store-"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(tempDir, { force: true, recursive: true });
  });

  it("serializes a forced flush behind an in-flight debounced write", async () => {
    const { debouncedJsonStore } = await import(
      "@main/state/debounced-store.ts"
    );
    const store = debouncedJsonStore({
      debounceMs: 10,
      defaults: { value: 0 },
      filePath: join(tempDir, "state.json"),
    });

    await store.init();
    store.mutate((state) => ({ ...state, value: 1 }));
    await vi.advanceTimersByTimeAsync(10);
    await vi.waitFor(() => {
      expect(writes).toHaveLength(1);
    });

    store.mutate((state) => ({ ...state, value: 2 }));
    const flushPromise = store.flush();
    await Promise.resolve();

    expect(writes).toHaveLength(1);
    expect(activeWrites).toBe(1);
    expect(maxActiveWrites).toBe(1);

    writes[0]?.resolve();
    await vi.waitFor(() => {
      expect(writes).toHaveLength(2);
    });
    expect(activeWrites).toBe(1);
    expect(maxActiveWrites).toBe(1);

    writes[1]?.resolve();
    await flushPromise;
    expect(writes.map((write) => write.content)).toEqual([
      '{\n  "value": 1\n}\n',
      '{\n  "value": 2\n}\n',
    ]);
  });

  it("waits for an in-flight debounced write when flushing clean state", async () => {
    const { debouncedJsonStore } = await import(
      "@main/state/debounced-store.ts"
    );
    const store = debouncedJsonStore({
      debounceMs: 10,
      defaults: { value: 0 },
      filePath: join(tempDir, "state.json"),
    });

    await store.init();
    store.mutate((state) => ({ ...state, value: 1 }));
    await vi.advanceTimersByTimeAsync(10);
    await vi.waitFor(() => {
      expect(writes).toHaveLength(1);
    });

    let didFlush = false;
    const flushPromise = store.flush().then(() => {
      didFlush = true;
    });
    await Promise.resolve();

    expect(didFlush).toBe(false);

    writes[0]?.resolve();
    await flushPromise;
    expect(didFlush).toBe(true);
  });

  it("waits for an in-flight debounced write before clearing the file", async () => {
    const { debouncedJsonStore } = await import(
      "@main/state/debounced-store.ts"
    );
    const store = debouncedJsonStore({
      debounceMs: 10,
      defaults: { value: 0 },
      filePath: join(tempDir, "state.json"),
    });

    await store.init();
    store.mutate((state) => ({ ...state, value: 1 }));
    await vi.advanceTimersByTimeAsync(10);
    await vi.waitFor(() => {
      expect(writes).toHaveLength(1);
    });

    let didClear = false;
    const clearPromise = store.clear().then(() => {
      didClear = true;
    });
    await Promise.resolve();

    expect(didClear).toBe(false);

    writes[0]?.resolve();
    await clearPromise;
    expect(didClear).toBe(true);
    expect(store.get()).toEqual({ value: 0 });
  });
});
