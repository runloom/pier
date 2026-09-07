import { describe, expect, it, vi } from "vitest";
import { createNativeProcessRegistry } from "../../../../../src/main/ipc/terminal/process/registry.ts";
import {
  signalNativeTerminalProcess,
  stopNativeTerminalProcess,
} from "../../../../../src/main/ipc/terminal/process/stop.ts";

describe("native terminal process ownership", () => {
  it("uses distinct native identities for ordinary shell incarnations", () => {
    const registry = createNativeProcessRegistry();
    const first = registry.begin("1::shell", { lifecycleId: "" });
    registry.closed(first);
    const next = registry.begin("1::shell", { lifecycleId: "" });
    expect(first.lifecycleId).toMatch(/^shell:/);
    expect(next.lifecycleId).not.toBe(first.lifecycleId);
    expect(registry.exited("1::shell", first.lifecycleId, 0)).toBe(false);
  });

  it("window disposal cancels pending creates and closes only its current owners", () => {
    const registry = createNativeProcessRegistry();
    const guard = registry.creationGuard("1::pending");
    const closed = registry.begin("1::p");
    const moved = registry.begin("1::moved");
    registry.move("1::moved", "2::moved");
    registry.closeWindow(1);
    expect(guard()).toBe(false);
    expect(closed).toMatchObject({ closed: true, exited: false });
    expect(moved.closed).toBe(false);
  });
  it("keeps increasing generations after close and ignores an old exit", () => {
    const registry = createNativeProcessRegistry();
    const first = registry.begin("1::p", { savedGeneration: 4 });
    registry.created(first);
    registry.closed(first);
    const second = registry.begin("1::p");
    registry.created(second);
    expect(second.generation).toBe(6);
    expect(registry.exited("1::p", first.lifecycleId, 137)).toBe(false);
    expect(second.exited).toBe(false);
  });

  it("retains an exit observed before the create acknowledgement", () => {
    const registry = createNativeProcessRegistry();
    const process = registry.begin("1::p");
    registry.exited("1::p", process.lifecycleId, 0);
    registry.created(process);
    expect(process).toMatchObject({ created: true, exited: true, exitCode: 0 });
    expect(registry.inputGuard("1::p")()).toBe(false);
  });

  it("invalidates queued input when ownership moves, keeping the same process", () => {
    const registry = createNativeProcessRegistry();
    const process = registry.begin("1::p");
    registry.created(process);
    const guard = registry.inputGuard("1::p");
    registry.move("1::p", "2::p");
    expect(guard()).toBe(false);
    expect(registry.get("2::p")).toBe(process);
    expect(registry.inputGuard("2::p")()).toBe(true);
  });

  it("does not claim a closed surface is an observed process exit", () => {
    const registry = createNativeProcessRegistry();
    const process = registry.begin("1::p");
    registry.created(process);
    registry.closed(process);
    expect(process.exited).toBe(false);
  });

  it("records an exit against the resolved native key from a callback alias", () => {
    const registry = createNativeProcessRegistry();
    const process = registry.begin("1::child", { lifecycleId: "life" });
    registry.created(process);
    expect(
      registry.exited(
        registry.getForCallback(1, "native::child")?.nativePanelId ?? "",
        "life",
        0
      )
    ).toBe(true);
    expect(process.exited).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  it("marks explicit close on one process without affecting siblings", () => {
    const registry = createNativeProcessRegistry();
    const parent = registry.begin("1::parent", { lifecycleId: "agent-parent" });
    const child = registry.begin("1::child", { lifecycleId: "agent-child" });
    registry.created(parent);
    registry.created(child);
    registry.markClosing(child);
    expect(child.closing).toBe(true);
    expect(parent.closing).toBe(false);
    expect(registry.getForCallback(1, "native::child")).toBe(child);
    expect(registry.getForCallback(1, "1::parent")).toBe(parent);
  });

  it("does not miss a create that happens during the initial waitFor check", async () => {
    const registry = createNativeProcessRegistry();
    const process = registry.begin("1::p");
    let checks = 0;
    const pending = registry.waitFor("1::p", (candidate) => {
      checks += 1;
      if (checks === 1) {
        registry.created(process);
        return false;
      }
      return candidate.created;
    });
    await expect(pending).resolves.toBe(process);
  });
});

describe("stop and retain terminal", () => {
  it("coalesces duplicate stop requests for the same physical process", async () => {
    const registry = createNativeProcessRegistry();
    const process = registry.begin("1::p");
    registry.created(process);
    const addon = { signalTerminalProcess: vi.fn(() => true) };
    const first = stopNativeTerminalProcess(addon, process, registry);
    expect(stopNativeTerminalProcess(addon, process, registry)).toBe(first);
    expect(addon.signalTerminalProcess).toHaveBeenCalledTimes(1);
    registry.exited("1::p", process.lifecycleId, 143);
    await expect(first).resolves.toEqual({ ok: true });
  });
  it("escalates an ignored TERM but only succeeds on the real exit, retaining the surface", async () => {
    vi.useFakeTimers();
    try {
      const registry = createNativeProcessRegistry();
      const process = registry.begin("1::p");
      registry.created(process);
      const signals: boolean[] = [];
      const addon = {
        signalTerminalProcess: (_key: string, _id: string, force: boolean) => {
          signals.push(force);
          return true;
        },
      };
      let complete = false;
      const pending = stopNativeTerminalProcess(addon, process, registry).then(
        (result) => {
          complete = true;
          return result;
        }
      );
      await vi.advanceTimersByTimeAsync(1999);
      expect(signals).toEqual([false]);
      expect(complete).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signals).toEqual([false, true]);
      expect(complete).toBe(false);
      registry.exited("1::p", process.lifecycleId, 137);
      await expect(pending).resolves.toEqual({ ok: true });
      expect(process.closed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns timeout instead of a false successful termination", async () => {
    vi.useFakeTimers();
    try {
      const registry = createNativeProcessRegistry();
      const process = registry.begin("1::p");
      registry.created(process);
      const pending = stopNativeTerminalProcess(
        { signalTerminalProcess: () => true },
        process,
        registry
      );
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toMatchObject({ ok: false });
      expect(process.exited).toBe(false);
      expect(process.closed).toBe(false);
      expect(process.stopping).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("signals a close without waiting for an exit receipt", () => {
    const registry = createNativeProcessRegistry();
    const process = registry.begin("1::p");
    registry.created(process);
    const addon = { signalTerminalProcess: vi.fn(() => true) };
    expect(signalNativeTerminalProcess(addon, process, true, registry)).toBe(
      true
    );
    expect(addon.signalTerminalProcess).toHaveBeenCalledWith(
      "1::p",
      process.lifecycleId,
      true
    );
    expect(process.exited).toBe(false);
    expect(process.closed).toBe(false);
    expect(process.stopping).toBe(false);
  });

  it("rejects an older native addon without destroying the surface", async () => {
    const registry = createNativeProcessRegistry();
    const process = registry.begin("1::p");
    registry.created(process);
    expect(
      await stopNativeTerminalProcess({}, process, registry)
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("unsupported"),
    });
    expect(process.closed).toBe(false);
  });
});
