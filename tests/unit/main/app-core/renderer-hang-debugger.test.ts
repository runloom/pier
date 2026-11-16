// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

interface FakeSession {
  attach: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  isAttached: ReturnType<typeof vi.fn>;
  listeners: Map<string, (...args: unknown[]) => void>;
  on: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  sendCommand: ReturnType<typeof vi.fn>;
}

function fakeSession(
  handlers: Record<string, () => unknown> = {}
): FakeSession {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const session: FakeSession = {
    attach: vi.fn(),
    detach: vi.fn(),
    isAttached: vi.fn(() => true),
    listeners,
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
    }),
    removeListener: vi.fn(
      (event: string, listener: (...args: unknown[]) => void) => {
        if (listeners.get(event) === listener) {
          listeners.delete(event);
        }
      }
    ),
    sendCommand: vi.fn(async (method: string) => {
      const handler = handlers[method];
      return handler ? handler() : {};
    }),
  };
  return session;
}

function fakeWebContents(session: FakeSession): {
  debugger: FakeSession;
  on: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
} {
  return {
    debugger: session,
    on: vi.fn(),
    removeListener: vi.fn(),
  };
}

function emitPaused(session: FakeSession, callFrames: unknown[]): void {
  session.listeners.get("message")?.(
    {},
    "Debugger.paused",
    { callFrames },
    undefined
  );
}

describe("renderer hang debugger", () => {
  it("captures function names and source positions from the hung renderer", async () => {
    const session = fakeSession({
      "Debugger.pause": () => {
        queueMicrotask(() =>
          emitPaused(session, [
            {
              functionName: "walkBlockTree",
              location: { columnNumber: 7, lineNumber: 41 },
              url: "file:///Applications/Pier.app/Contents/Resources/app.asar/out/renderer/assets/markdown-abc.js",
            },
            {
              functionName: "",
              location: { columnNumber: 0, lineNumber: 0 },
              url: "",
            },
          ])
        );
        return {};
      },
    });
    const webContents = fakeWebContents(session);
    const { attachRendererHangDebugger } = await import(
      "@main/windows/renderer-hang-debugger.ts"
    );

    const handle = attachRendererHangDebugger(webContents as never, {
      memorySampleIntervalMs: 60_000,
      session: session as never,
    });

    expect(handle).not.toBeNull();
    const capture = await handle?.captureStack({ timeoutMs: 500 });

    expect(capture).toEqual({
      frames: [
        {
          column: 8,
          functionName: "walkBlockTree",
          line: 42,
          url: "assets/markdown-abc.js",
        },
        {
          column: 1,
          functionName: "(anonymous)",
          line: 1,
          url: "",
        },
      ],
      ok: true,
    });
    // 抓完必须回到运行态，不能把 renderer 留在暂停里。
    expect(session.sendCommand).toHaveBeenCalledWith("Debugger.resume");
    handle?.dispose();
    expect(session.detach).toHaveBeenCalledOnce();
    expect(webContents.removeListener).toHaveBeenCalledWith(
      "did-finish-load",
      expect.any(Function)
    );
  });

  it("clears an armed pause-on-next-statement when the renderer had no stack", async () => {
    const session = fakeSession();
    const webContents = fakeWebContents(session);
    const { attachRendererHangDebugger } = await import(
      "@main/windows/renderer-hang-debugger.ts"
    );
    const handle = attachRendererHangDebugger(webContents as never, {
      memorySampleIntervalMs: 60_000,
      session: session as never,
    });

    const capture = await handle?.captureStack({ timeoutMs: 20 });

    expect(capture).toEqual({ frames: [], ok: false, reason: "timeout" });
    // 空闲时 pause 会挂成「下一条语句暂停」；只有 disable 能保证不误冻。
    expect(session.sendCommand).toHaveBeenCalledWith("Debugger.disable");
    handle?.dispose();
  });

  it("samples JS heap, DOM nodes, and listeners for breadcrumb enrichment", async () => {
    const session = fakeSession({
      "Memory.getDOMCounters": () => ({
        documents: 3,
        jsEventListeners: 4567,
        nodes: 89_012,
      }),
      "Runtime.getHeapUsage": () => ({
        backingStorageSize: 12 * 1024 * 1024,
        embedderHeapUsedSize: 1024,
        totalSize: 64 * 1024 * 1024,
        usedSize: 31 * 1024 * 1024,
      }),
    });
    const webContents = fakeWebContents(session);
    const { attachRendererHangDebugger } = await import(
      "@main/windows/renderer-hang-debugger.ts"
    );

    const handle = attachRendererHangDebugger(webContents as never, {
      memorySampleIntervalMs: 60_000,
      now: () => 1234,
      session: session as never,
    });

    await vi.waitFor(() => {
      expect(handle?.getLastMemorySample()).toEqual({
        backingStorageMb: 12,
        domNodes: 89_012,
        eventListeners: 4567,
        jsHeapTotalMb: 64,
        jsHeapUsedMb: 31,
        sampledAt: 1234,
      });
    });
    handle?.dispose();
  });

  it("stays out of the way when the debugger cannot attach", async () => {
    const session = fakeSession();
    session.isAttached.mockImplementation(() => {
      throw new Error("debugger unavailable");
    });
    const webContents = fakeWebContents(session);
    const { attachRendererHangDebugger } = await import(
      "@main/windows/renderer-hang-debugger.ts"
    );

    expect(
      attachRendererHangDebugger(webContents as never, {
        session: session as never,
      })
    ).toBeNull();
  });
});
