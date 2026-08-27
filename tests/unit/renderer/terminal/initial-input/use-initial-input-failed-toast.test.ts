import type { TerminalInitialInputFailedEvent } from "@shared/contracts/terminal.ts";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInitialInputFailedToast } from "@/panel-kits/terminal/hooks/use-initial-input-failed-toast.ts";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

vi.mock("@/i18n/use-t.ts", () => ({
  useT: () => (key: string) => key,
}));

describe("useInitialInputFailedToast", () => {
  let emit: ((event: TerminalInitialInputFailedEvent) => void) | undefined;

  beforeEach(() => {
    toastError.mockReset();
    emit = undefined;
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          onInitialInputFailed: (
            cb: (event: TerminalInitialInputFailedEvent) => void
          ) => {
            emit = cb;
            return () => {
              emit = undefined;
            };
          },
        },
      },
    });
  });

  it("toasts setup copy for a matching panel", () => {
    renderHook(() => useInitialInputFailedToast("terminal-1"));
    emit?.({
      kind: "setup",
      panelId: "terminal-1",
      textDelivered: false,
    });
    expect(toastError).toHaveBeenCalledWith(
      "terminal.initialInput.setupFailed"
    );
  });

  it("toasts setup enter copy when text was delivered", () => {
    renderHook(() => useInitialInputFailedToast("terminal-1"));
    emit?.({
      kind: "setup",
      panelId: "terminal-1",
      textDelivered: true,
    });
    expect(toastError).toHaveBeenCalledWith(
      "terminal.initialInput.setupEnterFailed"
    );
  });

  it("toasts prompt copy for agent task text", () => {
    renderHook(() => useInitialInputFailedToast("terminal-1"));
    emit?.({
      kind: "prompt",
      panelId: "terminal-1",
      textDelivered: false,
    });
    expect(toastError).toHaveBeenCalledWith(
      "terminal.initialInput.promptFailed"
    );
  });

  it("toasts task copy when command injection fails", () => {
    renderHook(() => useInitialInputFailedToast("terminal-1"));
    emit?.({
      kind: "task",
      panelId: "terminal-1",
      textDelivered: false,
    });
    expect(toastError).toHaveBeenCalledWith("terminal.initialInput.taskFailed");
  });

  it("toasts task enter copy when the command is already typed", () => {
    renderHook(() => useInitialInputFailedToast("terminal-1"));
    emit?.({
      kind: "task",
      panelId: "terminal-1",
      textDelivered: true,
    });
    expect(toastError).toHaveBeenCalledWith(
      "terminal.initialInput.taskEnterFailed"
    );
  });

  it("ignores events for other panels", () => {
    renderHook(() => useInitialInputFailedToast("terminal-1"));
    emit?.({
      kind: "setup",
      panelId: "terminal-other",
      textDelivered: false,
    });
    expect(toastError).not.toHaveBeenCalled();
  });
});
