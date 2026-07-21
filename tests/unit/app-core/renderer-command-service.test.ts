import { createRendererCommandService } from "@main/services/renderer-command-service.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { RendererCommandEnvelope } from "@shared/contracts/renderer-command.ts";
import { describe, expect, it, vi } from "vitest";

const context: PanelContext = {
  contextId: "ctx-pier",
  cwd: "/Users/xyz/ABC/pier",
  openedPath: "/Users/xyz/ABC/pier",
  projectRootPath: "/Users/xyz/ABC/pier",
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
          return 42;
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
    service.resolve(
      {
        data: { panelId: "terminal-1" },
        ok: true,
        requestId: "renderer-req-1",
      },
      42
    );

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
          return 42;
        },
      },
      timeoutMs: 1000,
    });

    const promise = service.execute({ type: "panel.list" });
    expect(focus).toBe(false);
    service.resolve(
      {
        data: [],
        ok: true,
        requestId: "renderer-req-list",
      },
      42
    );

    await expect(promise).resolves.toEqual({
      data: [],
      ok: true,
      requestId: "renderer-req-list",
    });
  });

  it("关闭 panel 时不主动聚焦窗口", async () => {
    let focus: boolean | undefined;
    const service = createRendererCommandService({
      createRequestId: () => "renderer-req-close",
      host: {
        send(_envelope, _windowId, options) {
          focus = options?.focus;
          return 42;
        },
      },
      timeoutMs: 1000,
    });

    const promise = service.execute({
      panelId: "terminal-1",
      type: "panel.close",
    });
    expect(focus).toBe(false);
    service.resolve(
      {
        data: null,
        ok: true,
        requestId: "renderer-req-close",
      },
      42
    );

    await expect(promise).resolves.toEqual({
      data: null,
      ok: true,
      requestId: "renderer-req-close",
    });
  });

  it("flush layout command 不主动聚焦窗口", async () => {
    let focus: boolean | undefined;
    const service = createRendererCommandService({
      createRequestId: () => "renderer-req-flush",
      host: {
        send(_envelope, _windowId, options) {
          focus = options?.focus;
          return 42;
        },
      },
      timeoutMs: 1000,
    });

    const promise = service.execute({
      type: "workspace.flushLayout",
      windowId: "main",
    });
    expect(focus).toBe(false);
    service.resolve(
      {
        data: null,
        ok: true,
        requestId: "renderer-req-flush",
      },
      42
    );

    await expect(promise).resolves.toEqual({
      data: null,
      ok: true,
      requestId: "renderer-req-flush",
    });
  });

  it.each([
    {
      command: {
        reason: "window-close" as const,
        transitionId: "close-1",
        type: "workspace.prepareClose" as const,
        windowId: "main",
      },
      requestId: "renderer-req-prepare-close",
    },
    {
      command: {
        generation: 1,
        pluginId: "pier.files",
        transitionId: "disable-1",
        type: "plugin.prepareDisable" as const,
        windowId: "main",
      },
      requestId: "renderer-req-prepare-disable",
    },
  ])("$command.type 不主动聚焦窗口", async ({ command, requestId }) => {
    let focus: boolean | undefined;
    const service = createRendererCommandService({
      createRequestId: () => requestId,
      host: {
        send(_envelope, _windowId, options) {
          focus = options?.focus;
          return 42;
        },
      },
      timeoutMs: 1000,
    });

    const promise = service.execute(command);
    expect(focus).toBe(false);
    service.resolve({ data: null, ok: true, requestId }, 42);

    await expect(promise).resolves.toEqual({
      data: null,
      ok: true,
      requestId,
    });
  });

  it("显式 focus=false 时不主动聚焦窗口", async () => {
    let focus: boolean | undefined;
    const service = createRendererCommandService({
      createRequestId: () => "renderer-req-background",
      host: {
        send(_envelope, _windowId, options) {
          focus = options?.focus;
          return 42;
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
    service.resolve(
      {
        data: { panelId: "terminal-1" },
        ok: true,
        requestId: "renderer-req-background",
      },
      42
    );

    await expect(promise).resolves.toEqual({
      data: { panelId: "terminal-1" },
      ok: true,
      requestId: "renderer-req-background",
    });
  });

  it("terminal.open 默认聚焦但保留 focus=false", async () => {
    const focusValues: Array<boolean | undefined> = [];
    const service = createRendererCommandService({
      createRequestId: () => `renderer-req-terminal-${focusValues.length + 1}`,
      host: {
        send(_envelope, _windowId, options) {
          focusValues.push(options?.focus);
          return 42;
        },
      },
      timeoutMs: 1000,
    });

    const foreground = service.execute({
      context,
      launchId: "launch-foreground",
      type: "terminal.open",
    });
    service.resolve(
      {
        data: { panelId: "terminal-foreground" },
        ok: true,
        requestId: "renderer-req-terminal-1",
      },
      42
    );
    await expect(foreground).resolves.toEqual({
      data: { panelId: "terminal-foreground" },
      ok: true,
      requestId: "renderer-req-terminal-1",
    });

    const background = service.execute({
      context,
      focus: false,
      launchId: "launch-background",
      type: "terminal.open",
    });
    service.resolve(
      {
        data: { panelId: "terminal-background" },
        ok: true,
        requestId: "renderer-req-terminal-2",
      },
      42
    );
    await expect(background).resolves.toEqual({
      data: { panelId: "terminal-background" },
      ok: true,
      requestId: "renderer-req-terminal-2",
    });

    expect(focusValues).toEqual([true, false]);
  });

  it("无可用 renderer 窗口时返回失败", async () => {
    const service = createRendererCommandService({
      createRequestId: () => "renderer-req-2",
      host: { send: () => null },
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
      host: { send: () => 42 },
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
      host: { send: () => 42 },
      timeoutMs: 1000,
    });

    const promise = service.execute({ context, type: "panel.open" });
    service.resolve(
      {
        error: { message: "workspace api not ready" },
        ok: false,
        requestId: "renderer-req-4",
      },
      42
    );

    await expect(promise).resolves.toEqual({
      error: { message: "workspace api not ready" },
      ok: false,
      requestId: "renderer-req-4",
    });
  });

  it("忽略 webContents 不匹配的 renderer 回复", async () => {
    const service = createRendererCommandService({
      createRequestId: () => "renderer-req-mismatch",
      host: { send: () => 7 },
      timeoutMs: 1000,
    });

    const promise = service.execute({ context, type: "panel.open" });
    service.resolve(
      {
        data: { panelId: "wrong" },
        ok: true,
        requestId: "renderer-req-mismatch",
      },
      99
    );
    service.resolve(
      {
        data: { panelId: "terminal-ok" },
        ok: true,
        requestId: "renderer-req-mismatch",
      },
      7
    );

    await expect(promise).resolves.toEqual({
      data: { panelId: "terminal-ok" },
      ok: true,
      requestId: "renderer-req-mismatch",
    });
  });

  it("routes panelTransfer commands only via execute options windowId", async () => {
    const sent: Array<{
      commandType: string;
      windowId: string | undefined;
      focus: boolean | undefined;
    }> = [];
    const service = createRendererCommandService({
      createRequestId: () => "renderer-req-transfer",
      host: {
        send(envelope, windowId, options) {
          sent.push({
            commandType: envelope.command.type,
            focus: options?.focus,
            windowId,
          });
          if (windowId === "source-win") {
            return 11;
          }
          if (windowId === "target-win") {
            return 22;
          }
          return null;
        },
      },
      timeoutMs: 1000,
    });

    const prepare = service.execute(
      {
        sourcePanelId: "panel-1",
        transferId: "11111111-1111-4111-8111-111111111111",
        type: "panelTransfer.prepareSource",
      },
      { windowId: "source-win" }
    );
    service.resolve(
      { data: { panel: {} }, ok: true, requestId: "renderer-req-transfer" },
      11
    );
    await expect(prepare).resolves.toMatchObject({ ok: true });

    const stage = service.execute(
      {
        panel: {
          componentId: "files",
          panelId: "panel-1",
          title: "a",
        },
        placement: { kind: "root" },
        prepared: {},
        targetPanelId: "panel-1",
        transferId: "11111111-1111-4111-8111-111111111111",
        type: "panelTransfer.stageTarget",
      },
      { windowId: "target-win" }
    );
    service.resolve(
      { data: null, ok: true, requestId: "renderer-req-transfer" },
      22
    );
    await expect(stage).resolves.toMatchObject({ ok: true });

    expect(sent).toEqual([
      {
        commandType: "panelTransfer.prepareSource",
        focus: false,
        windowId: "source-win",
      },
      {
        commandType: "panelTransfer.stageTarget",
        focus: false,
        windowId: "target-win",
      },
    ]);
  });

  it("rejects panelTransfer commands without explicit windowId (no focused fallback)", async () => {
    let sendCalled = false;
    const service = createRendererCommandService({
      createRequestId: () => "renderer-req-transfer-missing",
      host: {
        send() {
          sendCalled = true;
          return 1;
        },
      },
      timeoutMs: 1000,
    });

    await expect(
      service.execute({
        sourcePanelId: "panel-1",
        transferId: "11111111-1111-4111-8111-111111111111",
        type: "panelTransfer.prepareSource",
      })
    ).resolves.toEqual({
      error: {
        code: "not_found",
        message: "panel transfer renderer command requires windowId",
      },
      ok: false,
      requestId: "renderer-req-transfer-missing",
    });
    expect(sendCalled).toBe(false);
  });
});
