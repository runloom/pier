import {
  handleTaskExitTitle,
  notifyTerminalPanelClosed,
  setTerminalPanelClosedHandler,
} from "@main/ipc/terminal-panel-closed.ts";
import { TASK_EXIT_TITLE_PREFIX } from "@shared/contracts/tasks.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("terminal panel closed lifecycle", () => {
  afterEach(() => {
    setTerminalPanelClosedHandler(null);
  });

  it("notifies the registered handler for panel close and task exit marker", () => {
    const handler = vi.fn();
    setTerminalPanelClosedHandler(handler);

    notifyTerminalPanelClosed("terminal-1");
    const exitCode = handleTaskExitTitle(
      "terminal-2",
      `${TASK_EXIT_TITLE_PREFIX}0`
    );

    expect(exitCode).toBe(0);
    expect(handler).toHaveBeenCalledWith("terminal-1");
    expect(handler).toHaveBeenCalledWith("terminal-2");
  });

  it("does not handle ordinary terminal titles", () => {
    const handler = vi.fn();
    setTerminalPanelClosedHandler(handler);

    expect(handleTaskExitTitle("terminal-1", "vim")).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });
});
