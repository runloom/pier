import { beforeEach, describe, expect, it } from "vitest";
import {
  clearTerminalResourceSessionsForWindow,
  listTerminalResourceSessions,
  registerTerminalResourceSession,
  resetTerminalResourceRegistryForTests,
} from "../../../src/main/services/pier-resource/terminal-session-registry.ts";

describe("terminal resource registry", () => {
  beforeEach(() => {
    resetTerminalResourceRegistryForTests();
  });

  it("clears all sessions for a window id", () => {
    registerTerminalResourceSession({ panelId: "a", windowId: "10" });
    registerTerminalResourceSession({ panelId: "b", windowId: "10" });
    registerTerminalResourceSession({ panelId: "c", windowId: "11" });
    clearTerminalResourceSessionsForWindow("10");
    expect(listTerminalResourceSessions().map((s) => s.panelId)).toEqual(["c"]);
  });
});
