import { createFakeTerminalBackend } from "@main/services/runtime-control/fake-backend.ts";
import { clampScreenText } from "@main/services/runtime-control/screen-text.ts";
import { createRuntimeControlService } from "@main/services/runtime-control/service.ts";
import { describe, expect, it } from "vitest";

describe("clampScreenText", () => {
  it("strips ansi and clamps lines/bytes", () => {
    const raw = `\u001b[31mred\u001b[0m\n${"x".repeat(100)}`;
    const out = clampScreenText(raw, 1, 20);
    expect(out.text.includes("\u001b")).toBe(false);
    expect(out.truncated).toBe(true);
    expect(Buffer.byteLength(out.text, "utf8")).toBeLessThanOrEqual(20);
  });

  it("byte clamp keeps the newest tail after line clamp", () => {
    const raw = "AAAA\nBBBB\nCCCC";
    const out = clampScreenText(raw, 10, 4);
    expect(out.truncated).toBe(true);
    expect(out.text).toBe("CCCC");
  });

  it("byte clamp does not split multi-byte code points", () => {
    const out = clampScreenText("😀", 10, 3);
    expect(out.truncated).toBe(true);
    expect(out.text).toBe("");
    expect(Buffer.byteLength(out.text, "utf8")).toBe(0);
  });
});

describe("RuntimeControlService", () => {
  it("start → turn accepted → screen → terminate", async () => {
    const backend = createFakeTerminalBackend();
    const service = createRuntimeControlService({
      bootId: "boot_test",
      backend,
      nowMs: () => 1_700_000_000_000,
    });

    const started = await service.start({
      agentId: "codex",
      cwd: "/tmp/repo",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(started.data.runtime.bootId).toBe("boot_test");
    expect(started.data.runtime.runtimeId).toBe(started.data.panelId);
    expect(started.data.runtime.generation).toBe(1);
    expect(started.data.agentId).toBe("codex");

    const ref = started.data.runtime;
    const turned = await service.turn({
      ...ref,
      text: "hello\n",
    });
    expect(turned).toEqual({
      ok: true,
      data: { accepted: true, runtime: ref },
    });

    backend.setViewport(started.data.panelId, "hello\nworld");
    const screened = await service.screen({
      ...ref,
      maxLines: 200,
      maxBytes: 65_536,
    });
    expect(screened.ok).toBe(true);
    if (!screened.ok) {
      return;
    }
    expect(screened.data.screen.text).toContain("world");
    expect(screened.data.screen.truncated).toBe(false);
    expect(screened.data.screen.capturedAt).toBe(1_700_000_000_000);

    const stopped = await service.terminate(ref);
    expect(stopped.ok).toBe(true);

    const after = await service.turn({ ...ref, text: "nope" });
    expect(after.ok).toBe(false);
    if (!after.ok) {
      expect(after.code).toBe("runtime_gone");
    }
  });

  it("rejects stale generation and wrong boot", async () => {
    const backend = createFakeTerminalBackend();
    const service = createRuntimeControlService({
      bootId: "boot_a",
      backend,
    });
    const started = await service.start({ agentId: "claude" });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const ref = started.data.runtime;

    const stale = await service.screen({
      ...ref,
      generation: 99,
      maxLines: 10,
      maxBytes: 100,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.code).toBe("stale_generation");
    }

    const wrongBoot = await service.turn({
      ...ref,
      bootId: "boot_other",
      text: "x",
    });
    expect(wrongBoot.ok).toBe(false);
    if (!wrongBoot.ok) {
      expect(wrongBoot.code).toBe("boot_changed");
    }
  });

  it("bumps generation when the same runtimeId is reused", async () => {
    const fixedId = "panel_reuse";
    let creates = 0;
    const backend = {
      async create() {
        creates += 1;
        return {
          panelId: fixedId,
          windowId: "win_1",
          runtimeId: fixedId,
          cwd: "/tmp",
        };
      },
      async sendText() {
        return true;
      },
      async readViewport() {
        return { text: "x", rows: 1, cols: 1 };
      },
      async interrupt() {
        return true;
      },
      async terminate() {
        return true;
      },
    };
    const service = createRuntimeControlService({
      bootId: "boot_g",
      backend,
    });
    const a = await service.start({ agentId: "codex" });
    const b = await service.start({ agentId: "codex" });
    expect(a.ok && b.ok).toBe(true);
    if (!(a.ok && b.ok)) {
      return;
    }
    expect(creates).toBe(2);
    expect(a.data.runtime.generation).toBe(1);
    expect(b.data.runtime.generation).toBe(2);
    const oldTurn = await service.turn({
      ...a.data.runtime,
      text: "old\n",
    });
    expect(oldTurn.ok).toBe(false);
    if (!oldTurn.ok) {
      expect(oldTurn.code).toBe("stale_generation");
    }
    const newTurn = await service.turn({
      ...b.data.runtime,
      text: "new\n",
    });
    expect(newTurn.ok).toBe(true);
  });

  it("interrupt records control signal without closing", async () => {
    const backend = createFakeTerminalBackend();
    const service = createRuntimeControlService({
      bootId: "boot_i",
      backend,
    });
    const started = await service.start({ agentId: "codex" });
    if (!started.ok) {
      return;
    }
    const ref = started.data.runtime;
    const result = await service.interrupt(ref);
    expect(result.ok).toBe(true);
    const panel = backend.panels.get(started.data.panelId);
    expect(panel?.sent).toContain("\u0003");
    expect(panel?.closed).toBe(false);
  });

  it("wait until exited after terminate", async () => {
    const backend = createFakeTerminalBackend();
    let now = 0;
    const service = createRuntimeControlService({
      bootId: "boot_w",
      backend,
      nowMs: () => now,
    });
    const started = await service.start({ agentId: "codex" });
    if (!started.ok) {
      return;
    }
    const ref = started.data.runtime;
    const stopped = await service.terminate(ref);
    expect(stopped.ok).toBe(true);
    const waited = await service.wait({
      ...ref,
      until: "exited",
      timeoutMs: 100,
      nowMs: () => now,
      sleepMs: async () => {
        now += 10;
      },
    });
    expect(waited.ok).toBe(true);
    if (waited.ok) {
      expect(waited.data.reached).toBe(true);
      expect(waited.data.until).toBe("exited");
    }
  });

  it("wait until ready does not treat running as ready", async () => {
    const backend = createFakeTerminalBackend();
    let now = 0;
    const service = createRuntimeControlService({
      bootId: "boot_ready",
      backend,
      nowMs: () => now,
    });
    const started = await service.start({ agentId: "codex" });
    if (!started.ok) {
      return;
    }
    // start sets fact=running
    const waited = await service.wait({
      ...started.data.runtime,
      until: "ready",
      timeoutMs: 30,
      nowMs: () => now,
      sleepMs: async () => {
        now += 20;
      },
    });
    expect(waited.ok).toBe(true);
    if (waited.ok) {
      expect(waited.data.reached).toBe(false);
    }
  });

  it("wait timeout returns reached:false without inventing success", async () => {
    const backend = createFakeTerminalBackend();
    let now = 0;
    const service = createRuntimeControlService({
      bootId: "boot_t",
      backend,
      nowMs: () => now,
    });
    const started = await service.start({ agentId: "codex" });
    if (!started.ok) {
      return;
    }
    const waited = await service.wait({
      ...started.data.runtime,
      until: "exited",
      timeoutMs: 30,
      nowMs: () => now,
      sleepMs: async () => {
        now += 20;
      },
    });
    expect(waited.ok).toBe(true);
    if (waited.ok) {
      expect(waited.data.reached).toBe(false);
    }
  });

  it("watch streams fact samples until exited", async () => {
    const backend = createFakeTerminalBackend();
    let now = 0;
    const service = createRuntimeControlService({
      bootId: "boot_watch",
      backend,
      nowMs: () => now,
    });
    const started = await service.start({ agentId: "codex" });
    if (!started.ok) {
      return;
    }
    const ref = started.data.runtime;
    const samples: string[] = [];
    const watchPromise = service.watch({
      ...ref,
      timeoutMs: 500,
      pollMs: 20,
      nowMs: () => now,
      sleepMs: async () => {
        now += 25;
        if (now === 50) {
          await service.terminate(ref);
        }
      },
      onSample: (s) => samples.push(s.fact),
    });
    const watched = await watchPromise;
    expect(watched.ok).toBe(true);
    if (watched.ok) {
      expect(watched.data.ended).toBe(true);
      expect(watched.data.reason).toBe("exited");
      expect(samples.length).toBeGreaterThanOrEqual(1);
      expect(samples.at(-1)).toBe("exited");
    }
  });

  it("E6: screen strips ANSI/control and never exposes content cursor fields", async () => {
    const backend = createFakeTerminalBackend();
    const service = createRuntimeControlService({
      bootId: "boot_e6",
      backend,
    });
    const started = await service.start({ agentId: "codex" });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const ref = started.data.runtime;
    backend.setViewport(
      started.data.panelId,
      "\u001b[32mgreen\u001b[0m\nframe-a\nframe-b\n\u001b]0;title\u0007"
    );
    const screened = await service.screen({
      ...ref,
      maxLines: 50,
      maxBytes: 4096,
    });
    expect(screened.ok).toBe(true);
    if (!screened.ok) {
      return;
    }
    const screen = screened.data.screen;
    expect(screen.text.includes("\u001b")).toBe(false);
    expect(screen.text).toContain("green");
    expect(screen.text).toContain("frame-b");
    // 单帧 viewport：无 scrollback/history/cursor 字段
    expect(screen).not.toHaveProperty("scrollback");
    expect(screen).not.toHaveProperty("history");
    expect(screen).not.toHaveProperty("cursor");
    expect(screen).toMatchObject({
      rows: expect.any(Number),
      cols: expect.any(Number),
      truncated: expect.any(Boolean),
      capturedAt: expect.any(Number),
    });
  });

  it("E6: turn only returns accepted + runtime (no work verdict)", async () => {
    const backend = createFakeTerminalBackend();
    const service = createRuntimeControlService({
      bootId: "boot_e6t",
      backend,
    });
    const started = await service.start({ agentId: "codex" });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const turned = await service.turn({
      ...started.data.runtime,
      text: "ping\n",
    });
    expect(turned.ok).toBe(true);
    if (!turned.ok) {
      return;
    }
    expect(turned.data).toEqual({
      accepted: true,
      runtime: started.data.runtime,
    });
    expect(turned.data).not.toHaveProperty("success");
    expect(turned.data).not.toHaveProperty("failed");
    expect(turned.data).not.toHaveProperty("completed");
  });

  it("listRuntimeSummaries projects open runtimes without screen text", async () => {
    const backend = createFakeTerminalBackend();
    const service = createRuntimeControlService({
      bootId: "boot_sum",
      backend,
    });
    const started = await service.start({ agentId: "codex", cwd: "/r" });
    expect(started.ok).toBe(true);
    const rows = service.listRuntimeSummaries();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      bootId: "boot_sum",
      agentId: "codex",
      closed: false,
      cwd: "/r",
    });
    expect(rows[0]).not.toHaveProperty("text");
  });

  it("screen clamps large viewport", async () => {
    const backend = createFakeTerminalBackend();
    const service = createRuntimeControlService({
      bootId: "boot_s",
      backend,
    });
    const started = await service.start({ agentId: "codex" });
    if (!started.ok) {
      return;
    }
    backend.setViewport(
      started.data.panelId,
      Array.from({ length: 50 }, (_, i) => `line-${i}`).join("\n")
    );
    const screened = await service.screen({
      ...started.data.runtime,
      maxLines: 5,
      maxBytes: 10_000,
    });
    expect(screened.ok).toBe(true);
    if (!screened.ok) {
      return;
    }
    expect(screened.data.screen.truncated).toBe(true);
    expect(screened.data.screen.text.split("\n").length).toBeLessThanOrEqual(5);
  });
});
