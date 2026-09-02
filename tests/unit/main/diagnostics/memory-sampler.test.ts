import { describe, expect, it, vi } from "vitest";
import {
  buildProcessMemorySample,
  installProcessMemorySampler,
  MEMORY_SAMPLE_EVENT,
  MEMORY_SAMPLE_INITIAL_DELAY_MS,
  MEMORY_SAMPLE_INTERVAL_MS,
  MEMORY_SAMPLE_WARN_EVENT,
} from "../../../../src/main/diagnostics/memory-sampler.ts";

const MB_KB = 1024;
const MB_BYTES = 1_048_576;
const RENDERER_LABELS_BY_PID = new Map<number, string>([
  [83_400, "main"],
  [40_609, "https://grok.com"],
]);

describe("process memory sample", () => {
  it("labels window renderers by internal id, helpers by origin, and converts KB to MB", () => {
    const sample = buildProcessMemorySample({
      describeRendererPid: (pid) => RENDERER_LABELS_BY_PID.get(pid) ?? null,
      mainUsage: {
        arrayBuffers: 5 * MB_BYTES,
        external: 10 * MB_BYTES,
        heapTotal: 200 * MB_BYTES,
        heapUsed: 150 * MB_BYTES,
        rss: 600 * MB_BYTES,
      },
      metrics: [
        {
          memory: { workingSetSize: 600 * MB_KB },
          pid: 82_346,
          type: "Browser",
        },
        {
          memory: {
            peakWorkingSetSize: 1500 * MB_KB,
            workingSetSize: 1362 * MB_KB,
          },
          pid: 83_400,
          type: "Tab",
        },
        { memory: { workingSetSize: 421 * MB_KB }, pid: 40_609, type: "Tab" },
        {
          memory: { workingSetSize: 59 * MB_KB },
          pid: 82_376,
          serviceName: "network.mojom.NetworkService",
          type: "Utility",
        },
      ],
    });

    expect(
      sample.processes.map((row) => [row.label, row.workingSetMB])
    ).toEqual([
      ["main", 1362],
      [null, 600],
      ["https://grok.com", 421],
      ["network.mojom.NetworkService", 59],
    ]);
    expect(sample.processes[0]?.peakWorkingSetMB).toBe(1500);
    expect(sample.totalWorkingSetMB).toBe(2442);
    expect(sample.main).toEqual({
      arrayBuffersMB: 5,
      externalMB: 10,
      heapTotalMB: 200,
      heapUsedMB: 150,
      rssMB: 600,
    });
    // Only window renderers over 1 GB are flagged — the hidden helper is not.
    expect(sample.rendererOverThreshold.map((row) => row.pid)).toEqual([
      83_400,
    ]);
  });

  it("samples after the boot delay, then hourly, and warns only over threshold", () => {
    vi.useFakeTimers();
    try {
      const logger = { info: vi.fn(), warn: vi.fn() };
      let workingSetMB = 300;
      const collect = vi.fn(() =>
        buildProcessMemorySample({
          describeRendererPid: () => "main",
          mainUsage: { external: 0, heapTotal: 0, heapUsed: 0, rss: 0 },
          metrics: [
            {
              memory: { workingSetSize: workingSetMB * MB_KB },
              pid: 1,
              type: "Tab",
            },
          ],
        })
      );
      const dispose = installProcessMemorySampler({ collect, logger });

      vi.advanceTimersByTime(MEMORY_SAMPLE_INITIAL_DELAY_MS - 1);
      expect(collect).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(collect).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        MEMORY_SAMPLE_EVENT,
        expect.objectContaining({ totalWorkingSetMB: 300 })
      );
      expect(logger.warn).not.toHaveBeenCalled();

      workingSetMB = 1400;
      vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS);
      expect(collect).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(
        MEMORY_SAMPLE_WARN_EVENT,
        expect.objectContaining({ thresholdMB: 1024 })
      );

      dispose();
      vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS * 3);
      expect(collect).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the schedule alive when one collection throws", () => {
    vi.useFakeTimers();
    try {
      const logger = { info: vi.fn(), warn: vi.fn() };
      const collect = vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("metrics unavailable");
        })
        .mockImplementation(() =>
          buildProcessMemorySample({
            describeRendererPid: () => null,
            mainUsage: { external: 0, heapTotal: 0, heapUsed: 0, rss: 0 },
            metrics: [],
          })
        );
      const dispose = installProcessMemorySampler({ collect, logger });
      vi.advanceTimersByTime(MEMORY_SAMPLE_INITIAL_DELAY_MS);
      expect(logger.warn).toHaveBeenCalledWith(
        "process memory sample failed",
        expect.objectContaining({ error: expect.any(Error) })
      );
      vi.advanceTimersByTime(MEMORY_SAMPLE_INTERVAL_MS);
      expect(logger.info).toHaveBeenCalledTimes(1);
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
