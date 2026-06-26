import { createRendererCommandService } from "@main/services/renderer-command-service.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { RendererCommandEnvelope } from "@shared/contracts/renderer-command.ts";
import { describe, expect, it, vi } from "vitest";

const context: PanelContext = {
  contextId: "ctx-pier",
  cwd: "/Users/xyz/ABC/pier",
  openedPath: "/Users/xyz/ABC/pier",
  projectRoot: "/Users/xyz/ABC/pier",
  source: "command",
  updatedAt: 1_772_000_000_000,
  worktreeKey: "/Users/xyz/ABC/pier",
};

describe("createRendererCommandService", () => {
  it("发送 renderer command 并等待结果", async () => {
    let sent: RendererCommandEnvelope | null = null;
    let focus: boolean | undefined;
    const service = createRendererCommandService({
      createRequestId: () => "renderer-req-1",
      host: {
        send(envelope, _windowId, options) {
          sent = envelope;
          focus = options?.focus;
          return true;
        },
      },
      timeoutMs: 1000,
    });

    const promise = service.execute({
      context,
      type: "panel.open",
    });
    expect(sent).toEqual({
      command: {
        context,
        type: "panel.open",
      },
      requestId: "renderer-req-1",
    });
    expect(focus).toBe(true);
    service.resolve({
      data: { panelId: "terminal-1" },
      ok: true,
      requestId: "renderer-req-1",
    });

    await expect(promise).resolves.toEqual({
      data: { panelId: "terminal-1" },
      ok: true,
      requestId: "renderer-req-1",
    });
  });

  it("查询类 renderer command 不主动聚焦窗口", async () => {
    let focus: boolean | undefined;
    const service = createRendererCommandService({
      createRequestId: () => "renderer-req-list",
      host: {
        send(_envelope, _windowId, options) {
          focus = options?.focus;
          return true;
        },
      },
      timeoutMs: 1000,
    });

    const promise = service.execute({ type: "panel.list" });
    expect(focus).toBe(false);
    service.resolve({
      data: [],
      ok: true,
      requestId: "renderer-req-list",
    });

    await expect(promise).resolves.toEqual({
      data: [],
      ok: true,
      requestId: "renderer-req-list",
    });
  });

  it("flush layout command 不主动聚焦窗口", async () => {
    let focus: boolean | undefined;
    const service = createRendererCommandService({
      createRequestId: () => "renderer-req-flush",
      host: {
        send(_envelope, _windowId, options) {
          focus = options?.focus;
          return true;
        },
      },
      timeoutMs: 1000,
    });

    const promise = service.execute({
      type: "workspace.flushLayout",
      windowId: "main",
    });
    expect(focus).toBe(false);
    service.resolve({
      data: null,
      ok: true,
      requestId: "renderer-req-flush",
    });

    await expect(promise).resolves.toEqual({
      data: null,
      ok: true,
      requestId: "renderer-req-flush",
    });
  });

  it("显式 focus=false 时不主动聚焦窗口", async () => {
    let focus: boolean | undefined;
    const service = createRendererCommandService({
      createRequestId: () => "renderer-req-background",
      host: {
        send(_envelope, _windowId, options) {
          focus = options?.focus;
          return true;
        },
      },
      timeoutMs: 1000,
    });

    const promise = service.execute({
      focus: false,
      context,
      type: "panel.open",
    });
    expect(focus).toBe(false);
    service.resolve({
      data: { panelId: "terminal-1" },
      ok: true,
      requestId: "renderer-req-background",
    });

    await expect(promise).resolves.toEqual({
      data: { panelId: "terminal-1" },
      ok: true,
      requestId: "renderer-req-background",
    });
  });

  it("无可用 renderer 窗口时返回失败", async () => {
    const service = createRendererCommandService({
      createRequestId: () => "renderer-req-2",
      host: { send: () => false },
      timeoutMs: 1000,
    });

    await expect(
      service.execute({ context, type: "panel.open" })
    ).resolves.toEqual({
      error: {
        code: "platform_unavailable",
        message: "no renderer window available",
      },
      ok: false,
      requestId: "renderer-req-2",
    });
  });

  it("renderer 超时时返回失败", async () => {
    vi.useFakeTimers();
    const service = createRendererCommandService({
      createRequestId: () => "renderer-req-3",
      host: { send: () => true },
      timeoutMs: 1000,
    });

    const promise = service.execute({ context, type: "panel.open" });
    vi.advanceTimersByTime(1000);

    await expect(promise).resolves.toEqual({
      error: {
        code: "platform_unavailable",
        message: "renderer command timed out",
      },
      ok: false,
      requestId: "renderer-req-3",
    });
    vi.useRealTimers();
  });

  it("透传 renderer 失败结果", async () => {
    const service = createRendererCommandService({
      createRequestId: () => "renderer-req-4",
      host: { send: () => true },
      timeoutMs: 1000,
    });

    const promise = service.execute({ context, type: "panel.open" });
    service.resolve({
      error: { message: "workspace api not ready" },
      ok: false,
      requestId: "renderer-req-4",
    });

    await expect(promise).resolves.toEqual({
      error: { message: "workspace api not ready" },
      ok: false,
      requestId: "renderer-req-4",
    });
  });
});
