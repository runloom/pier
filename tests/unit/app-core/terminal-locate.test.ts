import { pickUniquePanel } from "@main/app-core/commands/terminal-locate.ts";
import { describe, expect, it } from "vitest";

describe("pickUniquePanel", () => {
  const panels = [
    { id: "term-1", windowId: "w1" },
    { id: "term-1", windowId: "w2" },
    { id: "term-2", windowId: "w1" },
  ];

  it("returns the only panel when windowId is omitted and id is unique", () => {
    expect(pickUniquePanel(panels, "term-2", undefined, (p) => p.id)).toEqual({
      item: { id: "term-2", windowId: "w1" },
      ok: true,
    });
  });

  it("fails closed when windowId is omitted and id collides across windows", () => {
    expect(pickUniquePanel(panels, "term-1", undefined, (p) => p.id)).toEqual({
      ok: false,
      reason: "ambiguous",
    });
  });

  it("selects the scoped window when windowId is provided", () => {
    expect(pickUniquePanel(panels, "term-1", "w2", (p) => p.id)).toEqual({
      item: { id: "term-1", windowId: "w2" },
      ok: true,
    });
  });

  it("returns missing when the scoped window has no such panel", () => {
    expect(pickUniquePanel(panels, "term-2", "w2", (p) => p.id)).toEqual({
      ok: false,
      reason: "missing",
    });
  });
});
