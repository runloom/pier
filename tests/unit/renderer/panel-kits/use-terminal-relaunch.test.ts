import { act, cleanup, renderHook } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { useTerminalRelaunch } from "@/panel-kits/terminal/use-terminal-relaunch.ts";
import type { TerminalRelaunchRequest } from "@/stores/terminal-relaunch.store.ts";

describe("useTerminalRelaunch", () => {
  let close: Mock<
    (panelId: string, options?: { reason?: string }) => Promise<void>
  >;

  beforeEach(() => {
    close = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          close,
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "pier");
  });

  it("starts relaunch by clearing ready and closing the panel", () => {
    const relaunchRequest: TerminalRelaunchRequest = {
      launchId: "launch-2",
      panelId: "terminal-1",
      sequence: 2,
    };
    const setNativeTerminalReady = vi.fn();

    renderHook(() =>
      useTerminalRelaunch({
        activeSequence: 1,
        clearTerminalError: vi.fn(),
        panelId: "terminal-1",
        relaunchRequest,
        sessionReadVersionRef: { current: 0 },
        setActiveLaunch: vi.fn(),
        setNativeTerminalReady,
        setSavedSession: vi.fn(),
        showTerminalError: vi.fn(),
      })
    );

    expect(setNativeTerminalReady).toHaveBeenCalledWith(false);
    expect(close).toHaveBeenCalledWith("terminal-1", { reason: "relaunch" });
  });

  it("ignores relaunch when sequence matches the active launch", () => {
    const relaunchRequest: TerminalRelaunchRequest = {
      launchId: "launch-1",
      panelId: "terminal-1",
      sequence: 1,
    };

    renderHook(() =>
      useTerminalRelaunch({
        activeSequence: 1,
        clearTerminalError: vi.fn(),
        panelId: "terminal-1",
        relaunchRequest,
        sessionReadVersionRef: { current: 0 },
        setActiveLaunch: vi.fn(),
        setNativeTerminalReady: vi.fn(),
        setSavedSession: vi.fn(),
        showTerminalError: vi.fn(),
      })
    );

    expect(close).not.toHaveBeenCalled();
  });

  it("applies active launch after close resolves", async () => {
    let resolveClose: (() => void) | undefined;
    close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveClose = resolve;
        })
    );

    const setActiveLaunch = vi.fn();
    const setSavedSession = vi.fn();
    const relaunchRequest: TerminalRelaunchRequest = {
      launchId: "launch-3",
      panelId: "terminal-1",
      sequence: 3,
    };

    renderHook(() =>
      useTerminalRelaunch({
        activeSequence: 1,
        clearTerminalError: vi.fn(),
        panelId: "terminal-1",
        relaunchRequest,
        sessionReadVersionRef: { current: 0 },
        setActiveLaunch,
        setNativeTerminalReady: vi.fn(),
        setSavedSession,
        showTerminalError: vi.fn(),
      })
    );

    expect(setActiveLaunch).not.toHaveBeenCalled();

    await act(async () => {
      resolveClose?.();
      await Promise.resolve();
    });

    expect(setActiveLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        launchId: "launch-3",
        sequence: 3,
        taskOutput: undefined,
      })
    );
    expect(setSavedSession).toHaveBeenCalledWith(null);
  });
});
