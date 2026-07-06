import { afterEach, describe, expect, it, vi } from "vitest";
import { showAppQuitConfirmation } from "../../../src/main/app-quit/quit-confirmation.ts";
import type { QuitActivitySummary } from "../../../src/main/app-quit/quit-decision.ts";

interface RendererQuitConfirmationRequest {
  readonly quitId: string;
  readonly summaries: readonly QuitActivitySummary[];
}

type RendererQuitConfirmationSendRequest = (
  request: RendererQuitConfirmationRequest
) => Promise<unknown> | unknown;

interface RendererMediatedQuitConfirmationArgs {
  readonly createQuitId: () => string;
  readonly sendRequest: RendererQuitConfirmationSendRequest;
  readonly summaries: readonly QuitActivitySummary[];
  readonly timeoutMs?: number;
}

const showRendererQuitConfirmation = showAppQuitConfirmation as unknown as (
  args: RendererMediatedQuitConfirmationArgs
) => Promise<boolean>;

function shellSummary(index = 1): QuitActivitySummary {
  return {
    kind: "shell",
    label: `shell ${index}`,
    panelId: `panel-${index}`,
    commandLine: `cmd ${index}`,
    windowId: "window-1",
  };
}

function showConfirmation({
  createQuitId = () => "quit-1",
  sendRequest,
  summaries = [shellSummary()],
  timeoutMs,
}: {
  createQuitId?: () => string;
  sendRequest: RendererQuitConfirmationSendRequest;
  summaries?: readonly QuitActivitySummary[];
  timeoutMs?: number;
}): Promise<boolean> {
  return showRendererQuitConfirmation({
    createQuitId,
    sendRequest,
    summaries,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

describe("showAppQuitConfirmation renderer transport", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a correlated quit request with raw summaries through the injected renderer transport", async () => {
    const summaries = [shellSummary(1), shellSummary(2)];
    const sendRequest = vi.fn(
      async (request: RendererQuitConfirmationRequest) => ({
        quitId: request.quitId,
        decision: "cancel",
      })
    );

    await expect(
      showConfirmation({
        createQuitId: () => "quit-transport-1",
        sendRequest,
        summaries,
      })
    ).resolves.toBe(false);

    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(sendRequest).toHaveBeenCalledWith({
      quitId: "quit-transport-1",
      summaries,
    });
  });

  it("transports every summary field unchanged so the renderer dialog owns presentation", async () => {
    const longCommand = `pnpm test ${"x".repeat(260)}`;
    const summaries: readonly QuitActivitySummary[] = [
      {
        kind: "shell",
        label: "shell with a long command",
        panelId: "panel-shell",
        commandLine: longCommand,
        windowId: "window-shell",
      },
      {
        kind: "agent",
        label: "agent-42",
        panelId: "panel-agent",
        windowId: "window-agent",
      },
      {
        kind: "task",
        label: "build:watch",
        panelId: "panel-task",
        windowId: "window-task",
      },
      ...Array.from({ length: 7 }, (_, index) => shellSummary(index + 2)),
    ];
    let sentRequest: RendererQuitConfirmationRequest | undefined;
    const sendRequest = vi.fn((request: RendererQuitConfirmationRequest) => {
      sentRequest = request;
      return { quitId: request.quitId, decision: "cancel" };
    });

    await showConfirmation({ sendRequest, summaries });

    expect(sentRequest?.summaries).toEqual(summaries);
    expect(sentRequest?.summaries).toHaveLength(10);
    expect(sentRequest?.summaries[0]).toMatchObject({
      commandLine: longCommand,
      label: "shell with a long command",
      panelId: "panel-shell",
      windowId: "window-shell",
    });
  });

  it("returns true only for a quit decision matching the generated quit id", async () => {
    const sendRequest = vi.fn(
      async (request: RendererQuitConfirmationRequest) => ({
        quitId: request.quitId,
        decision: "quit",
      })
    );

    await expect(showConfirmation({ sendRequest })).resolves.toBe(true);
  });

  it("returns false for a matching cancel decision", async () => {
    const sendRequest = vi.fn(
      async (request: RendererQuitConfirmationRequest) => ({
        quitId: request.quitId,
        decision: "cancel",
      })
    );

    await expect(showConfirmation({ sendRequest })).resolves.toBe(false);
  });

  it("does not accept a quit decision correlated to a different quit request", async () => {
    const sendRequest = vi.fn(async () => ({
      quitId: "other-quit",
      decision: "quit",
    }));

    await expect(
      showConfirmation({
        createQuitId: () => "expected-quit",
        sendRequest,
      })
    ).resolves.toBe(false);
  });

  it.each([
    {
      name: "unknown decision",
      payload: { quitId: "quit-1", decision: "restart" },
    },
    { name: "missing decision", payload: { quitId: "quit-1" } },
    { name: "missing quit id", payload: { decision: "quit" } },
    { name: "non-object payload", payload: "quit" },
    { name: "null payload", payload: null },
  ] as const)("returns false for $name from the renderer", async ({
    payload,
  }) => {
    const sendRequest = vi.fn(async () => payload);

    await expect(showConfirmation({ sendRequest })).resolves.toBe(false);
  });

  it("returns false when the renderer request cannot be sent", async () => {
    const sendRequest = vi.fn(() => {
      throw new Error("renderer unavailable");
    });

    await expect(showConfirmation({ sendRequest })).resolves.toBe(false);
  });

  it("honors a caller-supplied defensive timeout when the renderer does not answer", async () => {
    vi.useFakeTimers();
    const sendRequest = vi.fn(() => Promise.withResolvers<never>().promise);

    const result = showConfirmation({ sendRequest, timeoutMs: 50 });

    await vi.advanceTimersByTimeAsync(49);
    await expect(
      Promise.race([result, Promise.resolve("still-pending" as const)])
    ).resolves.toBe("still-pending");

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(false);
  });

  it("does not use the transport response window as its default timeout", async () => {
    vi.useFakeTimers();
    const sendRequest = vi.fn(() => Promise.withResolvers<never>().promise);

    const result = showConfirmation({ sendRequest });

    await vi.advanceTimersByTimeAsync(30_000);
    await expect(
      Promise.race([result, Promise.resolve("still-pending" as const)])
    ).resolves.toBe("still-pending");
  });
});
