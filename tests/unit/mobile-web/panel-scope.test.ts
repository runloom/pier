import { describe, expect, it } from "vitest";
import {
  findUniqueScoped,
  matchesPanelScope,
  panelScopeKey,
} from "../../../apps/mobile-web/src/lib/panel-scope.ts";

describe("panel-scope", () => {
  const entries = [
    { panelId: "p1", windowId: "w1" },
    { panelId: "p1", windowId: "w2" },
    { panelId: "p2", windowId: "w1" },
  ];

  it("keys window and panel together", () => {
    expect(panelScopeKey("w1", "p1")).toBe("w1\u0000p1");
    expect(panelScopeKey("w1", "p1")).not.toBe(panelScopeKey("w2", "p1"));
  });

  it("matches all windows when windowId is omitted", () => {
    expect(matchesPanelScope(entries[0]!, "p1", undefined)).toBe(true);
    expect(matchesPanelScope(entries[1]!, "p1", undefined)).toBe(true);
    expect(matchesPanelScope(entries[2]!, "p1", undefined)).toBe(false);
  });

  it("fails closed on collision unless windowId is provided", () => {
    expect(findUniqueScoped(entries, "p1", undefined, (e) => e)).toBeNull();
    expect(findUniqueScoped(entries, "p1", "w2", (e) => e)).toEqual({
      panelId: "p1",
      windowId: "w2",
    });
    expect(findUniqueScoped(entries, "p2", undefined, (e) => e)).toEqual({
      panelId: "p2",
      windowId: "w1",
    });
  });
});
