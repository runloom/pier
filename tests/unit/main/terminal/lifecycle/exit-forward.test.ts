import { describe, expect, it } from "vitest";
import { createNativeProcessRegistry } from "../../../../../src/main/ipc/terminal/process/registry.ts";
import {
  isDismissingTerminal,
  recordNativeProcessExit,
  shouldKeepTerminalTabOnProcessExit,
} from "../../../../../src/main/ipc/terminal/task/exit-forward.ts";

describe("terminal exit forward policy", () => {
  it("treats closing and closed receipts as dismissing", () => {
    const registry = createNativeProcessRegistry();
    const process = registry.begin("1::p");
    expect(isDismissingTerminal(process)).toBe(false);
    registry.markClosing(process);
    expect(isDismissingTerminal(process)).toBe(true);
    registry.closed(process);
    expect(isDismissingTerminal(process)).toBe(true);
  });

  it("records the exit on the resolved native key", () => {
    const registry = createNativeProcessRegistry();
    const process = registry.begin("1::child", { lifecycleId: "life" });
    recordNativeProcessExit(
      registry,
      registry.getForCallback(1, "native::child"),
      "native::child",
      "life",
      9
    );
    expect(process).toMatchObject({ exited: true, exitCode: 9 });
  });

  it("keeps the tab for OSC agent presence on an ordinary shell surface", () => {
    expect(
      shouldKeepTerminalTabOnProcessExit({
        hadAgentPresence: true,
        isAgentSurface: false,
        isTaskSurface: false,
        process: undefined,
        shouldRetainFromOwner: false,
      })
    ).toBe(true);
    expect(
      shouldKeepTerminalTabOnProcessExit({
        hadAgentPresence: false,
        isAgentSurface: false,
        isTaskSurface: false,
        process: undefined,
        shouldRetainFromOwner: false,
      })
    ).toBe(false);
  });
});
