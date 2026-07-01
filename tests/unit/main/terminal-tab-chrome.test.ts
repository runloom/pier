import { taskExitTabPatch } from "@main/ipc/terminal-tab-chrome.ts";
import { describe, expect, it, vi } from "vitest";

vi.mock("@main/state/terminal-session-state.ts", () => ({
  updateTerminalPanelTab: vi.fn(),
}));

describe("task exit tab patch", () => {
  it("derives succeeded chrome from process exit code 0", () => {
    expect(
      taskExitTabPatch({
        code: 0,
        reason: "process",
        source: "native-process-close",
      })
    ).toEqual({
      state: {
        colorToken: "success",
        label: "Succeeded",
        status: "succeeded",
      },
    });
  });

  it("derives failed chrome from non-zero process exit code", () => {
    expect(
      taskExitTabPatch({
        code: 2,
        reason: "process",
        source: "native-process-close",
      })
    ).toEqual({
      state: {
        colorToken: "destructive",
        label: "Failed 2",
        status: "failed",
      },
    });
  });

  it("derives failed chrome for process exit without a code", () => {
    expect(
      taskExitTabPatch({
        reason: "process",
        source: "native-process-close",
      })
    ).toEqual({
      state: {
        colorToken: "destructive",
        label: "Failed",
        status: "failed",
      },
    });
  });

  it("derives cancelled chrome for user closure", () => {
    expect(
      taskExitTabPatch({
        reason: "user",
        source: "panel-close",
      })
    ).toEqual({
      state: {
        colorToken: "warning",
        label: "Cancelled",
        status: "cancelled",
      },
    });
  });
});
