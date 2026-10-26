import { EventEmitter } from "node:events";
import {
  captureRendererHangSample,
  findRendererProcessMetric,
  RENDERER_HANG_SAMPLE_SECONDS,
  RENDERER_HANG_SAMPLE_TIMEOUT_MS,
} from "@main/windows/renderer-hang-capture.ts";
import { describe, expect, it, vi } from "vitest";

class FakeStderr extends EventEmitter {}

class FakeChild extends EventEmitter {
  kill = vi.fn(() => true);
  stderr = new FakeStderr();
}

const FILE = "/tmp/pier-diag/hang-abc123-4242.txt";

describe("captureRendererHangSample", () => {
  it("samples the renderer pid into the diagnostics directory", async () => {
    const child = new FakeChild();
    const spawnFn = vi.fn(() => child as never);
    const promise = captureRendererHangSample({
      diagnosticsDir: "/tmp/pier-diag",
      fileExists: () => true,
      incidentId: "abc123",
      pid: 4242,
      platform: "darwin",
      spawnFn,
      timeoutMs: 2000,
    });

    child.emit("close", 0);

    await expect(promise).resolves.toEqual({ file: FILE, ok: true });
    expect(spawnFn).toHaveBeenCalledWith(
      "/usr/bin/sample",
      ["4242", String(RENDERER_HANG_SAMPLE_SECONDS), "-file", FILE],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
  });

  it("gives the sampler enough time to attach to a GC-stuck renderer", () => {
    // 事故 08a3a7ffd9fa 用 2s 超时 + 1s 采样，采样器还没挂上就被杀掉，
    // 栈文件为空。这个下限就是那次事故留下的牙印。
    expect(RENDERER_HANG_SAMPLE_TIMEOUT_MS).toBeGreaterThanOrEqual(6000);
    expect(RENDERER_HANG_SAMPLE_SECONDS).toBeGreaterThanOrEqual(3);
    expect(RENDERER_HANG_SAMPLE_TIMEOUT_MS).toBeGreaterThan(
      RENDERER_HANG_SAMPLE_SECONDS * 1000
    );
  });

  it("does not report a stack file on timeout: sample writes only at the end", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      const promise = captureRendererHangSample({
        diagnosticsDir: "/tmp/pier-diag",
        // 采样中途被杀，`sample` 还什么都没写。
        fileExists: () => false,
        incidentId: "abc123",
        pid: 4242,
        platform: "darwin",
        spawnFn: vi.fn(() => child as never),
        timeoutMs: 1500,
      });

      await vi.advanceTimersByTimeAsync(1500);

      await expect(promise).resolves.toEqual({
        file: null,
        ok: false,
        reason: "timeout",
      });
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps sampler stderr separate from the failure reason on timeout", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      const promise = captureRendererHangSample({
        diagnosticsDir: "/tmp/pier-diag",
        fileExists: () => false,
        incidentId: "abc123",
        pid: 4242,
        platform: "darwin",
        spawnFn: vi.fn(() => child as never),
        timeoutMs: 1500,
      });

      // 这是 `sample` 的正常启动横幅，不是错误——放在 stderr 字段里，
      // 不要塞进 error，否则「采样太慢」和「无权采样」分不开。
      const banner = "Sampling process 4242 for 3 seconds with 1 millisecond";
      child.stderr.emit("data", Buffer.from(banner));
      await vi.advanceTimersByTimeAsync(1500);

      await expect(promise).resolves.toEqual({
        file: null,
        ok: false,
        reason: "timeout",
        stderr: banner,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats exit 0 without a file as a failure", async () => {
    // `sample` 写不了文件时仍然 exit 0，错误只在 stderr。
    const child = new FakeChild();
    const promise = captureRendererHangSample({
      diagnosticsDir: "/tmp/pier-diag",
      fileExists: () => false,
      incidentId: "abc123",
      pid: 4242,
      platform: "darwin",
      spawnFn: vi.fn(() => child as never),
      timeoutMs: 2000,
    });

    const message = "Unable to open/create sample file /tmp/pier-diag/x.txt";
    child.stderr.emit("data", Buffer.from(message));
    child.emit("close", 0);

    await expect(promise).resolves.toEqual({
      error: message,
      file: null,
      ok: false,
      reason: "no-file",
      stderr: message,
    });
  });

  it("reports spawn errors without throwing", async () => {
    const child = new FakeChild();
    const promise = captureRendererHangSample({
      diagnosticsDir: "/tmp/pier-diag",
      fileExists: () => false,
      incidentId: "abc123",
      pid: 4242,
      platform: "darwin",
      spawnFn: vi.fn(() => child as never),
      timeoutMs: 2000,
    });

    child.emit("error", new Error("no sample binary"));

    await expect(promise).resolves.toEqual({
      error: "no sample binary",
      file: null,
      ok: false,
      reason: "spawn-error",
    });
  });

  it("surfaces stderr instead of a bare exit code on nonzero exit", async () => {
    const child = new FakeChild();
    const promise = captureRendererHangSample({
      diagnosticsDir: "/tmp/pier-diag",
      fileExists: () => true,
      incidentId: "abc123",
      pid: 4242,
      platform: "darwin",
      spawnFn: vi.fn(() => child as never),
      timeoutMs: 2000,
    });

    child.stderr.emit("data", Buffer.from("cannot attach to process 4242"));
    child.emit("close", 1);

    await expect(promise).resolves.toEqual({
      error: "cannot attach to process 4242",
      file: FILE,
      ok: false,
      reason: "nonzero-exit",
      stderr: "cannot attach to process 4242",
    });
  });

  it("falls back to the exit code when stderr stays empty", async () => {
    const child = new FakeChild();
    const promise = captureRendererHangSample({
      diagnosticsDir: "/tmp/pier-diag",
      fileExists: () => true,
      incidentId: "abc123",
      pid: 4242,
      platform: "darwin",
      spawnFn: vi.fn(() => child as never),
      timeoutMs: 2000,
    });

    child.emit("close", 1);

    await expect(promise).resolves.toEqual({
      error: "exit 1",
      file: FILE,
      ok: false,
      reason: "nonzero-exit",
    });
  });

  it("caps a single oversized stderr chunk instead of appending it whole", async () => {
    const child = new FakeChild();
    const promise = captureRendererHangSample({
      diagnosticsDir: "/tmp/pier-diag",
      fileExists: () => false,
      incidentId: "abc123",
      pid: 4242,
      platform: "darwin",
      spawnFn: vi.fn(() => child as never),
      timeoutMs: 2000,
    });

    child.stderr.emit("data", Buffer.from("x".repeat(4096)));
    child.emit("close", 1);

    const result = await promise;
    expect(result.stderr?.length).toBe(512);
    expect(result.error?.length).toBe(512);
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
