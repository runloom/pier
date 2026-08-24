// @vitest-environment node

import {
  BRIDGE_MAX_CONCURRENT_CALLS,
  BRIDGE_MAX_FRAME_BYTES,
  type BridgeMethodDescriptor,
  parseBridgeFrame,
} from "@shared/contracts/plugin/bridge.ts";
import { describe, expect, it, vi } from "vitest";
import { SandboxBridge } from "@/lib/plugins/sandbox/bridge.ts";

const TOKEN = "bridge-token-abc123";
const HELLO = { proto: 1, t: "hello", token: TOKEN };

function uplink(body: Record<string, unknown>): string {
  return JSON.stringify({ ...body, token: TOKEN });
}

function makeMethods(overrides?: Record<string, BridgeMethodDescriptor>) {
  const methods = new Map<string, BridgeMethodDescriptor>([
    ["ping", { capabilities: [], handler: () => ({ pong: true }) }],
    [
      "file.read",
      {
        capabilities: ["file:read" as never],
        handler: (params) => ({ params }),
      },
    ],
  ]);
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) methods.set(k, v);
  }
  return methods;
}

function makeBridge(overrides?: {
  capabilities?: readonly string[];
  allowedChannels?: readonly string[];
}) {
  const sent: unknown[] = [];
  const frozen: string[] = [];
  const bridge = new SandboxBridge({
    allowedChannels: overrides?.allowedChannels ?? [],
    grantedCapabilities: (overrides?.capabilities ?? []) as never,
    methods: makeMethods(),
    pluginId: "third.demo",
    onFrozen: (reason) => frozen.push(reason),
    send: (frame) => {
      sent.push(frame);
    },
    token: TOKEN,
  });
  return {
    bridge,
    frozen,
    last(): Record<string, unknown> {
      return sent.at(-1) as Record<string, unknown>;
    },
    sent,
  };
}

describe("sandbox bridge (Phase 2 M2)", () => {
  it("completes handshake and answers a whitelisted call", async () => {
    const { bridge, last } = makeBridge({ capabilities: ["file:read"] });
    bridge.handleIncoming(JSON.stringify(HELLO));
    expect(bridge.getState()).toBe("ready");
    expect(last()).toMatchObject({ proto: 1, t: "ready" });

    bridge.handleIncoming(
      uplink({
        id: 1,
        method: "file.read",
        params: { p: 1 },
        t: "call",
      })
    );
    await vi.waitFor(() => {
      expect(last()).toMatchObject({ id: 1, ok: true });
    });
  });

  it("freezes on token mismatch and ignores everything afterwards", () => {
    const { bridge, frozen } = makeBridge();
    bridge.handleIncoming(JSON.stringify({ ...HELLO, token: "wrong-token" }));

    expect(bridge.getState()).toBe("frozen");
    expect(frozen).toEqual(["token mismatch"]);

    // 冻结后即使令牌正确也不再处理。
    bridge.handleIncoming(JSON.stringify(HELLO));
    expect(bridge.getState()).toBe("frozen");
  });

  it("freezes when any frame arrives before handshake", () => {
    const { bridge, frozen } = makeBridge();
    bridge.handleIncoming(
      uplink({ id: 1, method: "ping", params: {}, t: "call" })
    );
    expect(bridge.getState()).toBe("frozen");
    expect(frozen).toEqual(['frame "call" before handshake']);
  });

  it("replies unknown_method for unregistered methods without invoking anything", async () => {
    const { bridge, last } = makeBridge();
    bridge.handleIncoming(JSON.stringify(HELLO));
    bridge.handleIncoming(
      uplink({ id: 7, method: "evil.exec", params: {}, t: "call" })
    );
    await vi.waitFor(() => {
      expect(last()).toMatchObject({
        error: { code: "unknown_method" },
        id: 7,
        ok: false,
      });
    });
  });

  it("denies calls whose declared capability is not granted", async () => {
    const { bridge, last } = makeBridge({ capabilities: [] }); // 未授 file:read
    bridge.handleIncoming(JSON.stringify(HELLO));
    bridge.handleIncoming(
      uplink({ id: 2, method: "file.read", params: {}, t: "call" })
    );
    await vi.waitFor(() => {
      expect(last()).toMatchObject({
        error: { code: "denied", message: "missing capability: file:read" },
        id: 2,
        ok: false,
      });
    });
  });

  it("converts handler exceptions into internal_error results", async () => {
    const methods = makeMethods({
      boom: {
        capabilities: [],
        handler: () => {
          throw new Error("handler exploded");
        },
      },
    });
    const sent: unknown[] = [];
    const bridge = new SandboxBridge({
      grantedCapabilities: [],
      methods,
      pluginId: "third.demo",
      send: (frame) => {
        sent.push(frame);
      },
      token: TOKEN,
    });
    bridge.handleIncoming(JSON.stringify(HELLO));
    bridge.handleIncoming(
      uplink({ id: 3, method: "boom", params: {}, t: "call" })
    );
    await vi.waitFor(() => {
      expect(sent.at(-1)).toMatchObject({
        error: { code: "internal_error", message: "handler exploded" },
        ok: false,
      });
    });
  });

  it("enforces the concurrency cap", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const methods = makeMethods({
      hang: { capabilities: [], handler: () => gate.then(() => null) },
    });
    const sent: unknown[] = [];
    const bridge = new SandboxBridge({
      grantedCapabilities: [],
      methods,
      pluginId: "third.demo",
      send: (frame) => {
        sent.push(frame);
      },
      token: TOKEN,
    });
    bridge.handleIncoming(JSON.stringify(HELLO));

    for (let i = 1; i <= BRIDGE_MAX_CONCURRENT_CALLS; i += 1) {
      bridge.handleIncoming(
        uplink({ id: i, method: "hang", params: {}, t: "call" })
      );
    }
    bridge.handleIncoming(
      uplink({
        id: BRIDGE_MAX_CONCURRENT_CALLS + 1,
        method: "hang",
        params: {},
        t: "call",
      })
    );
    await vi.waitFor(() => {
      expect(sent.at(-1)).toMatchObject({
        error: { code: "denied", message: "concurrency limit reached" },
        id: BRIDGE_MAX_CONCURRENT_CALLS + 1,
      });
    });
    release();
  });

  it("times out a hung call", async () => {
    vi.useFakeTimers();
    try {
      const methods = makeMethods({
        hang: {
          capabilities: [],
          handler: () => new Promise<null>(() => undefined),
        },
      });
      const sent: unknown[] = [];
      const bridge = new SandboxBridge({
        grantedCapabilities: [],
        methods,
        pluginId: "third.demo",
        send: (frame) => {
          sent.push(frame);
        },
        token: TOKEN,
      });
      bridge.handleIncoming(JSON.stringify(HELLO));
      bridge.handleIncoming(
        uplink({ id: 9, method: "hang", params: {}, t: "call" })
      );
      await vi.advanceTimersByTimeAsync(10_000);
      expect(sent.at(-1)).toMatchObject({
        error: { code: "timeout" },
        id: 9,
        ok: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("only delivers events for subscribed whitelist channels", () => {
    const sent: unknown[] = [];
    const bridge = new SandboxBridge({
      allowedChannels: ["pier.workspace"],
      grantedCapabilities: [],
      methods: makeMethods(),
      pluginId: "third.demo",
      send: (frame) => {
        sent.push(frame);
      },
      token: TOKEN,
    });
    bridge.handleIncoming(JSON.stringify(HELLO));
    bridge.handleIncoming(
      uplink({ channel: "pier.workspace", t: "subscribe" })
    );
    bridge.handleIncoming(uplink({ channel: "pier.secrets", t: "subscribe" }));

    bridge.pushEvent("pier.workspace", { a: 1 });
    bridge.pushEvent("pier.secrets", { secret: true });

    const events = sent.filter(
      (frame) => (frame as { t: string }).t === "event"
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: "pier.workspace",
      payload: { a: 1 },
    });
  });

  it("freezes on oversized or unparseable frames", () => {
    const { bridge, frozen } = makeBridge();
    bridge.handleIncoming("{not json");
    expect(bridge.getState()).toBe("frozen");
    expect(frozen).toEqual(["unparseable or oversized frame"]);
  });

  it("dispose notifies the host and rejects in-flight calls", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const methods = makeMethods({
      hang: { capabilities: [], handler: () => gate.then(() => null) },
    });
    const disposed = vi.fn();
    const sent: unknown[] = [];
    const bridge = new SandboxBridge({
      grantedCapabilities: [],
      methods,
      onDisposed: disposed,
      pluginId: "third.demo",
      send: (frame) => {
        sent.push(frame);
      },
      token: TOKEN,
    });
    bridge.handleIncoming(JSON.stringify(HELLO));
    bridge.handleIncoming(
      uplink({ id: 5, method: "hang", params: {}, t: "call" })
    );
    bridge.dispose();

    expect(disposed).toHaveBeenCalledTimes(1);
    expect(sent.at(-1)).toMatchObject({ t: "disposed" });
    const result = sent
      .filter((f) => (f as { t: string }).t === "result")
      .at(-1);
    expect(result).toMatchObject({ error: { code: "internal_error" }, id: 5 });
    release();
  });
});

describe("sandbox bridge audit emission (M3)", () => {
  it("emits call-denied audits for capability refusals, capped at 20", () => {
    const audits: { detail: string; event: string }[] = [];
    const bridge = new SandboxBridge({
      grantedCapabilities: [],
      methods: makeMethods(),
      onAudit: (event) => {
        audits.push(event);
      },
      pluginId: "third.demo",
      send: () => undefined,
      token: TOKEN,
    });
    bridge.handleIncoming(JSON.stringify(HELLO));
    for (let i = 1; i <= 25; i += 1) {
      bridge.handleIncoming(
        uplink({ id: i, method: "file.read", params: {}, t: "call" })
      );
    }
    // 25 次拒绝只记前 20 条 —— 防恶意刷日志。
    expect(audits.filter((a) => a.event === "call-denied")).toHaveLength(20);
  });

  it("emits a frozen audit on protocol violation", () => {
    const audits: { detail: string; event: string }[] = [];
    const bridge = new SandboxBridge({
      grantedCapabilities: [],
      methods: makeMethods(),
      onAudit: (event) => {
        audits.push(event);
      },
      pluginId: "third.demo",
      send: () => undefined,
      token: TOKEN,
    });
    bridge.handleIncoming(JSON.stringify({ ...HELLO, token: "bad" }));
    expect(audits).toEqual([{ detail: "token mismatch", event: "frozen" }]);
  });
});

describe("sandbox bridge uplink token (every frame)", () => {
  it("freezes a post-handshake call whose token does not match", () => {
    const { bridge, frozen } = makeBridge();
    bridge.handleIncoming(JSON.stringify(HELLO));
    bridge.handleIncoming(
      JSON.stringify({
        id: 1,
        method: "ping",
        params: {},
        t: "call",
        token: "other-token",
      })
    );
    expect(bridge.getState()).toBe("frozen");
    expect(frozen).toEqual(["token mismatch"]);
  });

  it("rejects a call frame that omits the token", () => {
    const { bridge, frozen } = makeBridge();
    bridge.handleIncoming(JSON.stringify(HELLO));
    bridge.handleIncoming(
      JSON.stringify({ id: 1, method: "ping", params: {}, t: "call" })
    );
    expect(bridge.getState()).toBe("frozen");
    expect(frozen).toEqual(["unparseable or oversized frame"]);
  });
});

describe("parseBridgeFrame UTF-8 cap", () => {
  it("accepts a small CJK payload", () => {
    const raw = uplink({
      id: 1,
      method: "ping",
      params: { note: "文".repeat(32) },
      t: "call",
    });
    expect(parseBridgeFrame(raw)).toMatchObject({ t: "call" });
  });

  it("rejects CJK payloads whose UTF-8 size exceeds the cap while UTF-16 length fits", () => {
    const cjk = "文".repeat(Math.ceil(BRIDGE_MAX_FRAME_BYTES / 2));
    expect(cjk.length).toBeLessThanOrEqual(BRIDGE_MAX_FRAME_BYTES);
    const raw = JSON.stringify({
      id: 1,
      method: "ping",
      params: { cjk },
      t: "call",
      token: TOKEN,
    });
    expect(raw.length).toBeLessThanOrEqual(BRIDGE_MAX_FRAME_BYTES * 2);
    expect(new TextEncoder().encode(raw).byteLength).toBeGreaterThan(
      BRIDGE_MAX_FRAME_BYTES
    );
    expect(parseBridgeFrame(raw)).toBeNull();
  });
});
