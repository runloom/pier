import type { UsageAggregateSnapshot } from "@shared/contracts/usage-data.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  initUsageDataBridge,
  useUsageDataStore,
} from "@/stores/usage-data.store.ts";

function makeSnapshot(
  patch: Partial<UsageAggregateSnapshot["overall"]> = {}
): UsageAggregateSnapshot {
  return {
    overall: {
      buckets: [],
      coverage: { complete: true, from: "2026-07-11", to: "2026-07-11" },
      observedAt: 1,
      summary: {
        byModel: [],
        estimatedCostMicrousd: null,
        latestDayTokens: 0,
        periodTokens: 0,
        sourceCount: 0,
        todayEstimatedCostMicrousd: null,
      },
      ...patch,
    },
    sources: [],
  };
}

interface UsageDataMock {
  emit: (snapshot: UsageAggregateSnapshot) => void;
  listeners: Array<(snapshot: UsageAggregateSnapshot) => void>;
  onChanged: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
  refreshAll: ReturnType<typeof vi.fn>;
}

function installMockPier(
  initial: UsageAggregateSnapshot | Error
): UsageDataMock {
  const listeners: Array<(snapshot: UsageAggregateSnapshot) => void> = [];
  const onChanged = vi.fn((cb: (snapshot: UsageAggregateSnapshot) => void) => {
    listeners.push(cb);
    return () => {
      const idx = listeners.indexOf(cb);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  });
  const read = vi.fn(() =>
    initial instanceof Error
      ? Promise.reject(initial)
      : Promise.resolve(initial)
  );
  const refreshAll = vi.fn(() => Promise.resolve());
  const mock: UsageDataMock = {
    emit: (snapshot) => {
      for (const cb of listeners) cb(snapshot);
    },
    listeners,
    onChanged,
    read,
    refreshAll,
  };
  (window as unknown as { pier: { usageData: unknown } }).pier = {
    usageData: { onChanged, read, refreshAll },
  };
  return mock;
}

describe("usage-data store", () => {
  beforeEach(() => {
    useUsageDataStore.getState().reset();
  });

  it("hydrates from the initial read and then applies broadcast increments", async () => {
    const initial = makeSnapshot({ observedAt: 100 });
    const mock = installMockPier(initial);
    const bridge = initUsageDataBridge();
    // 允许微任务队列 flush，read() 的 then 才能把初值灌进 store
    await Promise.resolve();
    await Promise.resolve();
    expect(useUsageDataStore.getState().loadStatus).toBe("ready");
    expect(useUsageDataStore.getState().snapshot?.overall.observedAt).toBe(100);

    mock.emit(makeSnapshot({ observedAt: 200 }));
    expect(useUsageDataStore.getState().snapshot?.overall.observedAt).toBe(200);

    bridge.dispose();
  });

  it("ignores stale broadcasts whose observedAt regresses", async () => {
    const mock = installMockPier(makeSnapshot({ observedAt: 100 }));
    const bridge = initUsageDataBridge();
    await Promise.resolve();
    await Promise.resolve();
    mock.emit(makeSnapshot({ observedAt: 50 }));
    expect(useUsageDataStore.getState().snapshot?.overall.observedAt).toBe(100);
    bridge.dispose();
  });

  it("stops receiving broadcasts after dispose", async () => {
    const mock = installMockPier(makeSnapshot({ observedAt: 10 }));
    const bridge = initUsageDataBridge();
    await Promise.resolve();
    await Promise.resolve();
    bridge.dispose();
    expect(mock.listeners).toHaveLength(0);
    // reset 后 store 回到初始态
    expect(useUsageDataStore.getState().loadStatus).toBe("idle");
    expect(useUsageDataStore.getState().snapshot).toBeNull();
  });

  it("survives a failed initial read and still accepts subsequent broadcasts", async () => {
    const mock = installMockPier(new Error("initial boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bridge = initUsageDataBridge();
    await Promise.resolve();
    await Promise.resolve();
    expect(useUsageDataStore.getState().loadStatus).toBe("error");
    expect(useUsageDataStore.getState().error).toBe("initial boom");

    mock.emit(makeSnapshot({ observedAt: 42 }));
    expect(useUsageDataStore.getState().loadStatus).toBe("ready");
    expect(useUsageDataStore.getState().error).toBeNull();
    expect(useUsageDataStore.getState().snapshot?.overall.observedAt).toBe(42);
    bridge.dispose();
    errorSpy.mockRestore();
  });
});
