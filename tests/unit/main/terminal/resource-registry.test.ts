import { beforeEach, describe, expect, it } from "vitest";
import {
  bindTerminalResourceSeed,
  clearTerminalResourceSessionsForWindow,
  listTerminalResourceSessions,
  registerTerminalResourceSession,
  resetTerminalResourceRegistryForTests,
} from "../../../../src/main/services/pier-resource/terminal-session-registry.ts";

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

  it("bindTerminalResourceSeed writes seed and root without env", () => {
    bindTerminalResourceSeed({
      loginPid: 99,
      panelId: "panel",
      rootPid: 99,
      seedPid: 99,
      shellPid: 100,
      windowId: "1",
    });
    const [session] = listTerminalResourceSessions();
    expect(session).toMatchObject({
      loginPid: 99,
      panelId: "panel",
      rootPid: 99,
      seedPid: 99,
      shellPid: 100,
      windowId: "1",
    });
  });

  it("register can attach seedPid to an existing empty registration", () => {
    registerTerminalResourceSession({ panelId: "a", windowId: "1" });
    registerTerminalResourceSession({
      panelId: "a",
      seedPid: 42,
      windowId: "1",
    });
    expect(listTerminalResourceSessions()[0]?.seedPid).toBe(42);
  });
});
