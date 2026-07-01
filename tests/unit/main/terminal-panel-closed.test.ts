import {
  notifyTerminalPanelClosed,
  notifyTerminalPanelExit,
  parseTaskExitTitle,
  setTerminalPanelClosedHandler,
} from "@main/ipc/terminal-panel-closed.ts";
import { TASK_EXIT_TITLE_PREFIX } from "@shared/contracts/tasks.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("terminal panel closed lifecycle", () => {
  afterEach(() => {
    setTerminalPanelClosedHandler(null);
  });

  it("notifies the registered handler for panel close and task exit", () => {
    const handler = vi.fn();
    setTerminalPanelClosedHandler(handler);

    notifyTerminalPanelClosed("terminal-1");
    notifyTerminalPanelExit("terminal-2", 0);

    expect(handler).toHaveBeenCalledWith("terminal-1");
    expect(handler).toHaveBeenCalledWith("terminal-2", 0);
  });

  it("passes the window id through panel close and task exit notifications", () => {
    const handler = vi.fn();
    setTerminalPanelClosedHandler(handler);

    notifyTerminalPanelClosed("terminal-1", "window-a");
    notifyTerminalPanelExit("terminal-2", 1, "window-b");

    expect(handler).toHaveBeenCalledWith("terminal-1", undefined, "window-a");
    expect(handler).toHaveBeenCalledWith("terminal-2", 1, "window-b");
  });

  it("parses task exit titles without notifying the close handler", () => {
    const handler = vi.fn();
    setTerminalPanelClosedHandler(handler);

    expect(parseTaskExitTitle(`${TASK_EXIT_TITLE_PREFIX}2`)).toBe(2);
    expect(parseTaskExitTitle(`${TASK_EXIT_TITLE_PREFIX}-5`)).toBe(1);
    expect(parseTaskExitTitle("pier-task-exit:nope")).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not parse ordinary terminal titles", () => {
    const handler = vi.fn();
    setTerminalPanelClosedHandler(handler);

    expect(parseTaskExitTitle("vim")).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });
});
