import { EventEmitter } from "node:events";
import {
  captureRendererHangSample,
  findRendererProcessMetric,
} from "@main/windows/renderer-hang-capture.ts";
import { describe, expect, it, vi } from "vitest";

class FakeChild extends EventEmitter {
  kill = vi.fn(() => true);
}

describe("captureRendererHangSample", () => {
  it("samples the renderer pid into the diagnostics directory", async () => {
    const child = new FakeChild();
    const spawnFn = vi.fn(() => child as never);
    const promise = captureRendererHangSample({
      diagnosticsDir: "/tmp/pier-diag",
      incidentId: "abc123",
      pid: 4242,
      platform: "darwin",
      spawnFn,
      timeoutMs: 2000,
    });

    child.emit("exit", 0);

    await expect(promise).resolves.toEqual({
      file: "/tmp/pier-diag/hang-abc123-4242.txt",
      ok: true,
    });
    expect(spawnFn).toHaveBeenCalledWith(
      "/usr/bin/sample",
      ["4242", "1", "-file", "/tmp/pier-diag/hang-abc123-4242.txt"],
      { stdio: "ignore" }
    );
  });

  it("kills the sampler and reports timeout", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      const spawnFn = vi.fn(() => child as never);
      const promise = captureRendererHangSample({
        diagnosticsDir: "/tmp/pier-diag",
        incidentId: "abc123",
        pid: 4242,
        platform: "darwin",
        spawnFn,
        timeoutMs: 1500,
      });

      await vi.advanceTimersByTimeAsync(1500);

      await expect(promise).resolves.toEqual({
        file: "/tmp/pier-diag/hang-abc123-4242.txt",
        ok: false,
        reason: "timeout",
      });
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports spawn errors without throwing", async () => {
    const child = new FakeChild();
    const promise = captureRendererHangSample({
      diagnosticsDir: "/tmp/pier-diag",
      incidentId: "abc123",
      pid: 4242,
      platform: "darwin",
      spawnFn: vi.fn(() => child as never),
      timeoutMs: 2000,
    });

    child.emit("error", new Error("no sample binary"));

    await expect(promise).resolves.toEqual({
      error: "no sample binary",
      file: "/tmp/pier-diag/hang-abc123-4242.txt",
      ok: false,
      reason: "spawn-error",
    });
  });

  it("skips sampling before spawn on non-macOS", async () => {
    const spawnFn = vi.fn(() => new FakeChild() as never);
    await expect(
      captureRendererHangSample({
        diagnosticsDir: "/tmp/pier-diag",
        incidentId: "abc123",
        pid: 4242,
        platform: "linux",
        spawnFn,
      })
    ).resolves.toEqual({
      file: null,
      ok: false,
      reason: "platform",
    });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("skips sampling when the renderer pid is missing", async () => {
    const spawnFn = vi.fn(() => new FakeChild() as never);
    await expect(
      captureRendererHangSample({
        diagnosticsDir: "/tmp/pier-diag",
        incidentId: "abc123",
        pid: null,
        platform: "darwin",
        spawnFn,
      })
    ).resolves.toEqual({
      file: null,
      ok: false,
      reason: "invalid-pid",
    });
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

describe("findRendererProcessMetric", () => {
  it("maps the hung renderer's CPU and memory rows", () => {
    expect(
      findRendererProcessMetric(
        [
          { pid: 1, type: "Browser" },
          {
            cpu: { percentCPUUsage: 123.46 },
            memory: {
              peakWorkingSetSize: 204_800,
              workingSetSize: 102_400,
            },
            pid: 4242,
            type: "Tab",
          },
        ],
        4242
      )
    ).toEqual({
      cpuPercent: 123.5,
      peakWorkingSetMb: 200,
      pid: 4242,
      type: "Tab",
      workingSetMb: 100,
    });
  });

  it("returns null when the renderer pid has no metric row", () => {
    expect(findRendererProcessMetric([{ pid: 1, type: "Browser" }], 4242)).toBe(
      null
    );
    expect(findRendererProcessMetric([], null)).toBe(null);
  });
});
